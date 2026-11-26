import { z } from "zod";
import type { CreditBudget, DailyCreditLedger } from "./budget";
import { CONFIG } from "./config";
import type { Logger } from "./logger";
import type { ProductQuery } from "./types";

const OrganicResultSchema = z.object({
  title: z.string().optional(),
  link: z.string(),
  snippet: z.string().optional(),
  position: z.number().optional(),
});

const SerperResponseSchema = z.object({
  organic: z.array(OrganicResultSchema).optional(),
  credits: z.number().optional(),
});

export type OrganicResult = z.infer<typeof OrganicResultSchema>;

export interface SerperCandidate {
  url: string;
  title: string;
  snippet: string;
  query: string;
  page: number;
  host: string;
}

export interface SerperDiscoveryContext {
  logger: Logger;
  dailyLedger: DailyCreditLedger;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  candidates: SerperCandidate[];
  creditsSpent: number;
  queries: string[];
  skippedReason?: string;
  error?: string;
}

export interface SerperDiscovery {
  discover(
    query: ProductQuery,
    budget: CreditBudget,
    ctx: SerperDiscoveryContext,
  ): Promise<DiscoveryResult>;
}

export class SerperError extends Error {
  constructor(
    readonly code: "serper_http" | "serper_parse" | "daily_ceiling" | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "SerperError";
  }
}

const NEPAL_RELEVANCE =
  /\bNPR\b|\bRs\.?\s?\d|रू|\bNepal\b|\bKathmandu\b|\bPokhara\b|\bLalitpur\b|\bBhaktapur\b|\bDharan\b|\bBiratnagar\b|\bChitwan\b|\bButwal\b|\bNepalgunj\b|\bDhangadhi\b|\.np(?:\/|$)/i;

const NEPAL_STORE_SIGNAL =
  /\bNepal\b|\bKathmandu\b|\bPokhara\b|\bLalitpur\b|\bBhaktapur\b|\bDharan\b|\bBiratnagar\b|\bChitwan\b|\bButwal\b|\bNepalgunj\b|\bDhangadhi\b/i;

export function isNepalRelevant(result: Pick<OrganicResult, "title" | "link" | "snippet">): boolean {
  const text = `${result.title ?? ""} ${result.snippet ?? ""} ${result.link}`;
  return NEPAL_RELEVANCE.test(text);
}

export function isNepaliStore(result: Pick<OrganicResult, "title" | "link" | "snippet">): boolean {
  try {
    const host = new URL(result.link).hostname;
    if (host.endsWith(".np")) return true;
  } catch {
    return false;
  }
  const text = `${result.title ?? ""} ${result.snippet ?? ""}`;
  return NEPAL_STORE_SIGNAL.test(text);
}

export function buildQueryVariants(query: ProductQuery, max = CONFIG.maxSerperVariants): string[] {
  const base = [query.brand ?? "", query.name].filter(Boolean).join(" ").trim();
  const variants = [
    `${base} price Nepal`,
    `${base} Nepal`,
    `${query.name} buy Nepal`,
  ];
  return [...new Set(variants)].slice(0, max);
}

function normalizeCandidateUrl(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export interface SerperClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxVariants?: number;
  maxPages?: number;
  timeoutMs?: number;
}

/**
 * Serper is a discovery channel: it returns candidate URLs, never prices.
 * Credits are charged before each call and capped by both the per-request
 * budget and the daily ledger. `num` is fixed at 10 because we do not rely on
 * Serper honoring larger values; paging uses `page`.
 */
export class SerperClient implements SerperDiscovery {
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxVariants: number;
  private readonly maxPages: number;
  private readonly timeoutMs: number;

  constructor(options: SerperClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.SERPER_API_KEY?.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxVariants = options.maxVariants ?? CONFIG.maxSerperVariants;
    this.maxPages = options.maxPages ?? CONFIG.maxSerperPages;
    this.timeoutMs = options.timeoutMs ?? CONFIG.serperTimeoutMs;
  }

  private async searchPage(
    query: string,
    page: number,
    budget: CreditBudget,
    ctx: SerperDiscoveryContext,
  ): Promise<OrganicResult[]> {
    if (!this.apiKey) throw new SerperError("serper_parse", "SERPER_API_KEY is not configured.");
    if (budget.remainingCredits() < 1) {
      throw new SerperError("serper_parse", "Per-request credit budget exhausted.");
    }

    const dailyOk = await ctx.dailyLedger.trySpend(1);
    if (!dailyOk) {
      throw new SerperError("daily_ceiling", "Daily Serper credit ceiling reached.");
    }
    budget.spendCredits(1);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.fetchImpl("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, gl: "np", hl: "en", page, num: 10 }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SerperError("serper_http", `Serper returned HTTP ${response.status}.`);
      }

      const json = (await response.json()) as unknown;
      const parsed = SerperResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new SerperError("serper_parse", "Serper response had an unexpected shape.");
      }

      ctx.logger.info("serper.call", {
        query,
        page,
        credits: 1,
        results: parsed.data.organic?.length ?? 0,
      });

      return parsed.data.organic ?? [];
    } catch (error) {
      if (timedOut) throw new SerperError("serper_http", "Serper request timed out.");
      if (error instanceof SerperError) throw error;
      if (ctx.signal?.aborted) throw new SerperError("aborted", "Serper request aborted.");
      throw new SerperError(
        "serper_http",
        error instanceof Error ? error.message : "Serper request failed.",
      );
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  }

  async discover(
    query: ProductQuery,
    budget: CreditBudget,
    ctx: SerperDiscoveryContext,
  ): Promise<DiscoveryResult> {
    if (!this.apiKey) {
      return {
        candidates: [],
        creditsSpent: 0,
        queries: [],
        skippedReason: "SERPER_API_KEY is not configured; using store adapters only.",
      };
    }

    const variants = buildQueryVariants(query, this.maxVariants);
    const candidates: SerperCandidate[] = [];
    const seenUrls = new Set<string>();
    const seenHosts = new Set<string>();
    const queries: string[] = [];
    const startCredits = budget.creditsUsed;
    let skippedReason: string | undefined;
    let error: string | undefined;

    const addResults = (results: OrganicResult[], query: string, page: number) => {
      for (const result of results) {
        if (!isNepalRelevant(result)) continue;
        const url = normalizeCandidateUrl(result.link);
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        let host = "";
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        seenHosts.add(host);
        candidates.push({
          url,
          title: result.title ?? host,
          snippet: result.snippet ?? "",
          query,
          page,
          host,
        });
      }
    };

    for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
      const variant = variants[variantIndex];
      if (!variant) continue;
      if (budget.remainingCredits() < 1) {
        skippedReason = "Per-request Serper credit budget exhausted.";
        break;
      }

      try {
        queries.push(variant);
        const page1 = await this.searchPage(variant, 1, budget, ctx);
        addResults(page1, variant, 1);

        const page1Relevant = page1.filter(isNepalRelevant);
        if (page1Relevant.length < 3 || this.maxPages < 2) continue;
        if (budget.remainingCredits() < 1) {
          skippedReason = "Per-request Serper credit budget exhausted.";
          break;
        }

        const hostsBeforePage2 = new Set(seenHosts);
        const page2 = await this.searchPage(variant, 2, budget, ctx);
        addResults(page2, variant, 2);

        const page2Relevant = page2.filter(isNepalRelevant);
        const addedNewNepaliStore = page2Relevant.some((result) => {
          if (!isNepaliStore(result)) return false;
          try {
            const host = new URL(result.link).hostname.replace(/^www\./, "");
            return !hostsBeforePage2.has(host);
          } catch {
            return false;
          }
        });

        // Page 3 is allowed only for the first variant, only when page 2 added a
        // new Nepali store, and only when the page cap is explicitly raised.
        if (variantIndex === 0 && this.maxPages >= 3 && addedNewNepaliStore) {
          if (budget.remainingCredits() >= 1) {
            const page3 = await this.searchPage(variant, 3, budget, ctx);
            addResults(page3, variant, 3);
          }
        }
      } catch (caught) {
        if (caught instanceof SerperError && caught.code === "daily_ceiling") {
          skippedReason = caught.message;
        } else if (caught instanceof SerperError && caught.code === "aborted") {
          error = caught.message;
        } else {
          error = caught instanceof Error ? caught.message : "Serper discovery failed.";
        }
        ctx.logger.warn("serper.discovery.failed", {
          query: variant,
          errorClass: caught instanceof SerperError ? caught.code : "unknown",
        });
        break;
      }
    }

    return {
      candidates: candidates.slice(0, 20),
      creditsSpent: budget.creditsUsed - startCredits,
      queries,
      ...(skippedReason ? { skippedReason } : {}),
      ...(error ? { error } : {}),
    };
  }
}
