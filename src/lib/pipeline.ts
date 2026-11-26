import { BudgetExceededError, CreditBudget, type DailyCreditLedger } from "./budget";
import { cacheKeyFor, type CacheStore, type SingleFlight } from "./cache";
import type { AppConfig } from "./config";
import type { StoreAdapter } from "./adapters/types";
import { AdapterError } from "./adapters/types";
import { CircuitOpenError } from "./adapters/resilience";
import { extractProduct } from "./extract";
import { FetchError, type SafeFetch } from "./http";
import type { DomainLimiter } from "./http";
import type { Logger } from "./logger";
import { dedupeBySeller, matchAndBuild } from "./match";
import { rankListings } from "./rank";
import type { SerperDiscovery } from "./serper";
import {
  CachedSearchSchema,
  SearchRequestSchema,
  type Badge,
  type CachedSearch,
  type Coverage,
  type Listing,
  type PipelineEvent,
  type ProductQuery,
  type SearchRequest,
  type SearchResult,
  type SourceReport,
} from "./types";

export interface PipelineDeps {
  adapters: StoreAdapter[];
  serper: SerperDiscovery;
  cache: CacheStore;
  fetcher: SafeFetch;
  dailyLedger: DailyCreditLedger;
  limiter: DomainLimiter;
  singleFlight: SingleFlight;
  now: () => Date;
  config: AppConfig;
}

export type EmitFn = (event: PipelineEvent) => void;

export interface RunOptions {
  emit: EmitFn;
  logger: Logger;
  signal?: AbortSignal;
}

const PARTIAL_NOTE =
  "Results are a partial survey of Nepali sellers, not a complete market comparison. Verify price and stock on the seller site.";

function errorStatus(error: unknown): SourceReport["status"] {
  if (error instanceof AdapterError && error.code === "timeout") return "timeout";
  if (error instanceof CircuitOpenError) return "circuit_open";
  if (error instanceof FetchError && error.code === "timeout") return "timeout";
  return "error";
}

function errorClass(error: unknown): string {
  if (error instanceof AdapterError) return error.code;
  if (error instanceof FetchError) return error.code;
  if (error instanceof BudgetExceededError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

function friendlyMessage(status: SourceReport["status"]): string {
  switch (status) {
    case "timeout":
      return "This store did not respond in time.";
    case "circuit_open":
      return "This store failed repeatedly and was temporarily skipped.";
    case "skipped":
      return "This source was not used for this search.";
    default:
      return "This store could not be read.";
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function budgetedFetch(
  fetcher: SafeFetch,
  budget: CreditBudget,
  limiter: DomainLimiter,
  signal: AbortSignal | undefined,
): SafeFetch {
  return {
    async html(url, options) {
      budget.useFetches(1);
      try {
        await limiter.wait(new URL(url).hostname);
      } catch {
        // A malformed URL will be rejected by the fetcher with a clear error.
      }
      return fetcher.html(url, { ...options, signal: options?.signal ?? signal });
    },
  };
}

function buildResult(
  query: ProductQuery,
  listings: Listing[],
  badges: Badge[],
  coverage: Coverage,
  budget: SearchResult["budget"],
  notes: string[],
  generatedAt: string,
): SearchResult {
  return {
    query,
    listings,
    badges,
    coverage,
    budget,
    generatedAt,
    notes,
    partial: true,
  };
}

function cacheToResult(
  cached: CachedSearch,
  query: ProductQuery,
  includeDifferentSizes: boolean,
  cacheStatus: "hit" | "stale" | "coalesced",
  generatedAt: string,
): SearchResult {
  const ranked = rankListings(cached.listings, query, {
    city: query.city,
    includeDifferentSizes,
  });
  return buildResult(
    query,
    ranked.listings,
    ranked.badges,
    cached.coverage,
    {
      ...cached.budget,
      creditsUsed: 0,
      fetchesUsed: 0,
      cacheStatus,
      cacheHits: cacheStatus === "hit" || cacheStatus === "stale" ? 1 : 0,
      cacheMisses: 0,
    },
    ranked.notes,
    generatedAt,
  );
}

async function executePipeline(
  request: SearchRequest,
  deps: PipelineDeps,
  options: RunOptions,
): Promise<SearchResult> {
  const query = request.query;
  const budget = new CreditBudget({
    maxCredits: deps.config.maxSerperCredits,
    maxFetches: deps.config.maxFetchesPerRequest,
  });
  const sources: SourceReport[] = [];
  const matched: Listing[] = [];
  const emittedSellerIds = new Set<string>();
  const startedAt = deps.now().toISOString();

  const safeEmit: EmitFn = (event) => {
    try {
      options.emit(event);
    } catch {
      // A disconnected client must not break the pipeline.
    }
  };

  const emitListing = (listing: Listing) => {
    if (emittedSellerIds.has(listing.sellerId)) return;
    emittedSellerIds.add(listing.sellerId);
    safeEmit({ type: "listing", listing });
  };

  safeEmit({
    type: "status",
    phase: "discovery",
    message: `Checking ${deps.adapters.length} store adapter(s) and Serper discovery.`,
  });

  const fetchForAdapters = budgetedFetch(deps.fetcher, budget, deps.limiter, options.signal);

  const adapterTasks = deps.adapters.map(async (adapter) => {
    const sourceStarted = Date.now();
    try {
      const rawListings = await adapter.search(query, {
        fetch: fetchForAdapters,
        timeoutMs: deps.config.adapterTimeoutMs,
        logger: options.logger,
        signal: options.signal,
        now: deps.now,
      });
      const listings = dedupeBySeller(
        rawListings
          .map((raw) => matchAndBuild(query, raw))
          .filter((listing): listing is Listing => listing !== null),
      );
      for (const listing of listings) {
        matched.push(listing);
        emitListing(listing);
      }
      const report: SourceReport = {
        id: adapter.id,
        label: adapter.label,
        kind: "adapter",
        status: "ok",
        durationMs: Date.now() - sourceStarted,
        listingCount: listings.length,
      };
      sources.push(report);
      safeEmit({ type: "source", source: report });
      options.logger.info("source.ok", {
        sourceId: adapter.id,
        kind: "adapter",
        durationMs: report.durationMs,
        listings: report.listingCount,
      });
    } catch (error) {
      const status = errorStatus(error);
      const report: SourceReport = {
        id: adapter.id,
        label: adapter.label,
        kind: "adapter",
        status,
        durationMs: Date.now() - sourceStarted,
        listingCount: 0,
        errorClass: errorClass(error),
        message: friendlyMessage(status),
      };
      sources.push(report);
      safeEmit({ type: "source", source: report });
      options.logger.warn("source.failed", {
        sourceId: adapter.id,
        kind: "adapter",
        status,
        errorClass: report.errorClass,
        durationMs: report.durationMs,
      });
    }
  });

  const serperTask = (async () => {
    const sourceStarted = Date.now();
    try {
      const discovery = await deps.serper.discover(query, budget, {
        logger: options.logger,
        dailyLedger: deps.dailyLedger,
        signal: options.signal,
      });

      const adapterDomains = new Set(deps.adapters.map((adapter) => adapter.domain));
      const candidates = discovery.candidates.filter(
        (candidate) => !adapterDomains.has(candidate.host),
      );

      const fetchBudget = Math.min(
        candidates.length,
        budget.remainingFetches(),
        deps.config.maxFetchesPerRequest,
      );
      const toFetch = candidates.slice(0, Math.max(0, fetchBudget));

      let extractFailures = 0;
      const extracted = await mapLimit(
        toFetch,
        deps.config.fetchConcurrency,
        async (candidate) => {
          if (options.signal?.aborted) return null;
          try {
            budget.useFetches(1);
            await deps.limiter.wait(candidate.host);
            const page = await deps.fetcher.html(candidate.url, {
              timeoutMs: deps.config.fetchTimeoutMs,
              signal: options.signal,
            });
            const product = extractProduct(page.body, page.url, page.fetchedAt);
            if (!product) {
              extractFailures += 1;
              return null;
            }
            const listing = matchAndBuild(query, { ...product.listing, source: "serper" });
            if (!listing) return null;
            return listing;
          } catch (error) {
            extractFailures += 1;
            options.logger.debug("serper.candidate.failed", {
              host: candidate.host,
              errorClass: errorClass(error),
            });
            return null;
          }
        },
      );

      const serperListings = dedupeBySeller(
        extracted.filter((listing): listing is Listing => listing !== null),
      );
      for (const listing of serperListings) {
        matched.push(listing);
        emitListing(listing);
      }

      const status: SourceReport["status"] = discovery.error
        ? "error"
        : discovery.skippedReason
          ? "skipped"
          : "ok";
      const report: SourceReport = {
        id: "serper",
        label: "Serper discovery",
        kind: "serper",
        status,
        durationMs: Date.now() - sourceStarted,
        listingCount: serperListings.length,
        ...(status === "skipped"
          ? { message: discovery.skippedReason }
          : status === "error"
            ? { message: "Serper discovery could not be completed.", errorClass: "serper" }
            : {}),
      };
      if (extractFailures > 0 && status === "ok") {
        report.message = `${extractFailures} candidate page(s) could not be read.`;
      }
      sources.push(report);
      safeEmit({ type: "source", source: report });
      options.logger.info("source.ok", {
        sourceId: "serper",
        kind: "serper",
        status,
        credits: discovery.creditsSpent,
        candidates: candidates.length,
        fetched: toFetch.length,
        listings: serperListings.length,
        durationMs: report.durationMs,
      });
    } catch (error) {
      const status = errorStatus(error);
      const report: SourceReport = {
        id: "serper",
        label: "Serper discovery",
        kind: "serper",
        status,
        durationMs: Date.now() - sourceStarted,
        listingCount: 0,
        errorClass: errorClass(error),
        message: friendlyMessage(status),
      };
      sources.push(report);
      safeEmit({ type: "source", source: report });
      options.logger.warn("source.failed", {
        sourceId: "serper",
        kind: "serper",
        status,
        errorClass: report.errorClass,
      });
    }
  })();

  await Promise.allSettled([...adapterTasks, serperTask]);

  const unique = dedupeBySeller(matched);
  const ranked = rankListings(unique, query, {
    city: query.city,
    includeDifferentSizes: request.includeDifferentSizes,
  });

  const notes = [...ranked.notes];
  if (sources.some((source) => source.status === "error" || source.status === "timeout")) {
    notes.push("Some stores did not respond; the comparison is partial.");
  }
  if (sources.some((source) => source.id === "serper" && source.status === "skipped")) {
    notes.push("Serper discovery was skipped, so only stores with a built-in adapter were checked.");
  }
  notes.push(PARTIAL_NOTE);

  const coverage: Coverage = {
    checked: deps.adapters.length + 1,
    responded: sources.filter((source) => source.status === "ok").length,
    failed: sources.filter(
      (source) => source.status === "error" || source.status === "timeout" || source.status === "circuit_open",
    ).length,
    listings: ranked.listings.length,
    sources: [...sources].sort((a, b) => a.id.localeCompare(b.id)),
  };

  const generatedAt = deps.now().toISOString();
  const result = buildResult(
    query,
    ranked.listings,
    ranked.badges,
    coverage,
    {
      ...budget.snapshot(),
      cacheStatus: "miss",
      cacheHits: 0,
      cacheMisses: 1,
    },
    notes,
    generatedAt,
  );

  const cached: CachedSearch = {
    query,
    listings: unique,
    coverage,
    budget: result.budget,
    generatedAt,
  };
  const ttl = ranked.listings.length > 0 ? deps.config.cacheTtlSeconds : deps.config.emptyResultTtlSeconds;
  try {
    await deps.cache.set(cacheKeyFor(query), cached, ttl, deps.config.cacheStaleSeconds);
  } catch (error) {
    options.logger.warn("cache.set.failed", { errorClass: errorClass(error) });
  }

  options.logger.info("search.done", {
    durationMs: Date.now() - new Date(startedAt).getTime(),
    listings: ranked.listings.length,
    credits: result.budget.creditsUsed,
    fetches: result.budget.fetchesUsed,
    cacheStatus: result.budget.cacheStatus,
  });

  safeEmit({ type: "done", result });
  return result;
}

/**
 * Runs a search with cache, single-flight, budgets, streaming, and failure
 * isolation. A second identical search within the TTL costs 0 Serper credits.
 */
export async function runSearch(
  input: SearchRequest,
  deps: PipelineDeps,
  options: RunOptions,
): Promise<SearchResult> {
  const request = SearchRequestSchema.parse(input);
  const query = request.query;
  const key = cacheKeyFor(query);
  const generatedAt = deps.now().toISOString();

  let cachedEntry: Awaited<ReturnType<CacheStore["get"]>> = null;
  try {
    cachedEntry = await deps.cache.get(key);
  } catch (error) {
    options.logger.warn("cache.get.failed", { errorClass: errorClass(error) });
  }

  if (cachedEntry) {
    const parsed = CachedSearchSchema.safeParse(cachedEntry.value);
    if (parsed.success) {
      const cacheStatus = cachedEntry.stale ? "stale" : "hit";
      const result = cacheToResult(
        parsed.data,
        query,
        request.includeDifferentSizes,
        cacheStatus,
        generatedAt,
      );
      options.emit({ type: "status", phase: "cache", message: `Served from cache (${cacheStatus}).` });
      for (const listing of result.listings) {
        options.emit({ type: "listing", listing });
      }
      options.emit({ type: "done", result });

      if (cachedEntry.stale) {
        void deps.singleFlight
          .run(key, () =>
            executePipeline(request, deps, {
              emit: () => undefined,
              logger: options.logger,
              signal: undefined,
            }),
          )
          .catch((error: unknown) => {
            options.logger.warn("cache.revalidate.failed", { errorClass: errorClass(error) });
          });
      }

      options.logger.info("search.done", {
        cacheStatus,
        listings: result.listings.length,
        credits: 0,
      });
      return result;
    }
    options.logger.warn("cache.invalid", { key });
  }

  const coalesced = deps.singleFlight.isInFlight(key);
  const shared = await deps.singleFlight.run(key, () => executePipeline(request, deps, options));

  if (!coalesced) return shared;

  // Do not mutate the shared result: another request owns it.
  const result: SearchResult = {
    ...shared,
    budget: {
      ...shared.budget,
      cacheStatus: "coalesced",
      cacheHits: 0,
      cacheMisses: 0,
    },
  };
  options.emit({ type: "status", phase: "cache", message: "Joined an identical search already in progress." });
  for (const listing of result.listings) {
    options.emit({ type: "listing", listing });
  }
  options.emit({ type: "done", result });
  return result;
}
