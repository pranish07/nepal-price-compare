import { describe, expect, it, vi } from "vitest";
import type { StoreAdapter } from "./adapters/types";
import { MemoryDailyCreditLedger } from "./budget";
import { MemoryCacheStore, SingleFlight, type CacheStore } from "./cache";
import { CONFIG, type AppConfig } from "./config";
import { DomainLimiter } from "./http";
import { createNoopLogger } from "./logger";
import { matchAndBuild } from "./match";
import { runSearch, type PipelineDeps } from "./pipeline";
import type { SerperCandidate, SerperDiscovery } from "./serper";
import type {
  CachedSearch,
  Listing,
  PipelineEvent,
  ProductQuery,
  RawListing,
} from "./types";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const logger = createNoopLogger();

const config: AppConfig = {
  ...CONFIG,
  cacheTtlSeconds: 3_600,
  cacheStaleSeconds: 86_400,
  maxFetchesPerRequest: 25,
  fetchTimeoutMs: 1_000,
  adapterTimeoutMs: 1_000,
  perDomainDelayMs: 0,
};

const query: ProductQuery = {
  name: "Melaclear Cream",
  brand: "Dr. Althea",
  size: { value: 20, unit: "g" },
};

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    sellerId: "shop-a.example",
    sellerName: "Shop A",
    url: "https://shop-a.example/product/melaclear",
    title: "Dr. Althea Melaclear Cream 20g",
    price: { amount: 2000, currency: "NPR" },
    size: { value: 20, unit: "g" },
    inStock: true,
    brand: "Dr. Althea",
    fetchedAt: NOW_ISO,
    source: "adapter",
    ...overrides,
  };
}

function productPage(price = 1900): string {
  const payload = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Dr. Althea Melaclear Cream 20g",
    brand: { name: "Dr. Althea" },
    offers: {
      price: String(price),
      priceCurrency: "NPR",
      availability: "http://schema.org/InStock",
    },
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body></body></html>`;
}

function adapter(id: string, search: StoreAdapter["search"]): StoreAdapter {
  return { id, domain: `${id}.example`, label: id, search };
}

function serperWith(
  candidates: SerperCandidate[] = [],
  extra: { skippedReason?: string; error?: string } = {},
): SerperDiscovery {
  return {
    async discover(_query, budget) {
      if (candidates.length > 0) budget.spendCredits(1);
      return {
        candidates,
        creditsSpent: candidates.length > 0 ? 1 : 0,
        queries: candidates.length > 0 ? ["test query"] : [],
        ...extra,
      };
    },
  };
}

function candidate(index: number): SerperCandidate {
  const host = `other${index}.example`;
  return {
    url: `https://${host}/product/melaclear`,
    title: "Dr. Althea Melaclear Cream 20g",
    snippet: "NPR 1900",
    query: "test query",
    page: 1,
    host,
  };
}

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    adapters: [],
    serper: serperWith(),
    cache: new MemoryCacheStore(),
    fetcher: {
      async html(url: string) {
        return {
          url,
          status: 200,
          contentType: "text/html",
          body: productPage(),
          bytes: productPage().length,
          fetchedAt: NOW_ISO,
        };
      },
    },
    dailyLedger: new MemoryDailyCreditLedger(100),
    limiter: new DomainLimiter(0),
    singleFlight: new SingleFlight(),
    now: () => NOW,
    config,
    ...overrides,
  };
}

async function search(deps: PipelineDeps, events: PipelineEvent[] = []) {
  return runSearch(
    { query, includeDifferentSizes: false },
    deps,
    { emit: (event) => events.push(event), logger },
  );
}

describe("runSearch", () => {
  it("runs adapters, ranks results, and streams events", async () => {
    const events: PipelineEvent[] = [];
    const adapters = [
      adapter("shop-a", async () => [raw()]),
      adapter("shop-b", async () => [
        raw({
          sellerId: "shop-b.example",
          sellerName: "Shop B",
          url: "https://shop-b.example/product/melaclear",
          price: { amount: 2200, currency: "NPR" },
        }),
      ]),
    ];
    const result = await search(makeDeps({ adapters }), events);

    expect(result.listings).toHaveLength(2);
    expect(result.coverage).toMatchObject({
      checked: 3,
      responded: 3,
      failed: 0,
      listings: 2,
    });
    expect(result.budget).toMatchObject({
      cacheStatus: "miss",
      creditsUsed: 0,
      fetchesUsed: 0,
      cacheMisses: 1,
    });
    expect(result.partial).toBe(true);

    const types = events.map((event) => event.type);
    expect(types[0]).toBe("status");
    expect(types.at(-1)).toBe("done");
    expect(types.filter((type) => type === "listing")).toHaveLength(2);
    expect(types.filter((type) => type === "source")).toHaveLength(3);
  });

  it("isolates a failing store and reports partial coverage", async () => {
    const adapters = [
      adapter("shop-a", async () => [raw()]),
      adapter("broken", async () => {
        throw new Error("boom");
      }),
    ];
    const result = await search(makeDeps({ adapters }));

    expect(result.listings).toHaveLength(1);
    expect(result.coverage).toMatchObject({ checked: 3, responded: 2, failed: 1 });
    expect(result.coverage.sources.find((source) => source.id === "broken")).toMatchObject({
      status: "error",
      listingCount: 0,
    });
    expect(result.notes.join(" ")).toContain("Some stores did not respond");
  });

  it("fetches Serper candidates and extracts their products", async () => {
    const result = await search(
      makeDeps({ serper: serperWith([candidate(1)]) }),
    );

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      sellerId: "other1.example",
      source: "serper",
      price: { amount: 1900, currency: "NPR" },
    });
    expect(result.coverage.sources.find((source) => source.id === "serper")).toMatchObject({
      status: "ok",
      listingCount: 1,
    });
    expect(result.budget.creditsUsed).toBe(1);
    expect(result.budget.fetchesUsed).toBe(1);
  });

  it("reports Serper as skipped when it is not configured", async () => {
    const result = await search(
      makeDeps({
        serper: serperWith([], {
          skippedReason: "SERPER_API_KEY is not configured; using store adapters only.",
        }),
      }),
    );

    expect(result.coverage.sources.find((source) => source.id === "serper")?.status).toBe(
      "skipped",
    );
    expect(result.coverage).toMatchObject({ checked: 1, responded: 0, failed: 0 });
    expect(result.notes.join(" ")).toContain("Serper discovery was skipped");
  });

  it("honors the per-request fetch budget for Serper candidates", async () => {
    const result = await search(
      makeDeps({
        config: { ...config, maxFetchesPerRequest: 1 },
        serper: serperWith([candidate(1), candidate(2), candidate(3)]),
      }),
    );

    expect(result.budget.fetchesUsed).toBe(1);
    expect(result.listings).toHaveLength(1);
  });

  it("serves an identical second search from cache for zero credits and fetches", async () => {
    let adapterCalls = 0;
    const deps = makeDeps({
      adapters: [
        adapter("shop-a", async () => {
          adapterCalls += 1;
          return [raw()];
        }),
      ],
      serper: serperWith([candidate(1)]),
    });

    const first = await search(deps);
    expect(first.budget).toMatchObject({ cacheStatus: "miss", creditsUsed: 1, fetchesUsed: 1 });

    const second = await search(deps);
    expect(adapterCalls).toBe(1);
    expect(second.listings).toHaveLength(first.listings.length);
    expect(second.budget).toMatchObject({
      cacheStatus: "hit",
      creditsUsed: 0,
      fetchesUsed: 0,
      cacheHits: 1,
      cacheMisses: 0,
    });
  });

  it("coalesces concurrent identical searches", async () => {
    let adapterCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = makeDeps({
      adapters: [
        adapter("shop-a", async () => {
          adapterCalls += 1;
          await gate;
          return [raw()];
        }),
      ],
    });

    const first = search(deps);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = search(deps);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(adapterCalls).toBe(1);
    expect([a.budget.cacheStatus, b.budget.cacheStatus].sort()).toEqual([
      "coalesced",
      "miss",
    ]);
  });

  it("serves stale cache immediately and revalidates in the background", async () => {
    const listing = matchAndBuild(query, raw());
    expect(listing).not.toBeNull();
    const cached: CachedSearch = {
      query,
      listings: [listing as Listing],
      coverage: { checked: 1, responded: 0, failed: 0, listings: 1, sources: [] },
      budget: {
        creditsUsed: 0,
        creditsMax: 8,
        fetchesUsed: 0,
        fetchesMax: 25,
        cacheStatus: "miss",
        cacheHits: 0,
        cacheMisses: 1,
      },
      generatedAt: NOW_ISO,
    };

    class StaleOnceCache implements CacheStore {
      private served = false;
      async get<T>() {
        if (this.served) return null;
        this.served = true;
        return { value: cached as unknown as T, stale: true, cachedAt: NOW_ISO };
      }
      async set() {}
      async delete() {}
    }

    let adapterCalls = 0;
    const deps = makeDeps({
      cache: new StaleOnceCache(),
      adapters: [
        adapter("shop-a", async () => {
          adapterCalls += 1;
          return [raw()];
        }),
      ],
    });

    const result = await search(deps);
    expect(result.budget.cacheStatus).toBe("stale");
    expect(result.budget.cacheHits).toBe(1);

    await vi.waitFor(() => {
      expect(adapterCalls).toBe(1);
    });
  });
});
