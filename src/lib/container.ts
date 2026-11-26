import { STORE_ADAPTERS } from "./adapters/registry";
import { createCacheStore, SingleFlight } from "./cache";
import { CONFIG } from "./config";
import { DomainLimiter, safeFetch } from "./http";
import type { PipelineDeps } from "./pipeline";
import { createDailyLedger, createRateLimiter, type RateLimiter } from "./rate-limit";
import { SerperClient } from "./serper";

export interface AppContainer {
  deps: PipelineDeps;
  searchLimiter: RateLimiter;
  detectLimiter: RateLimiter;
}

function createContainer(): AppContainer {
  const deps: PipelineDeps = {
    adapters: STORE_ADAPTERS,
    serper: new SerperClient(),
    cache: createCacheStore(),
    fetcher: safeFetch,
    dailyLedger: createDailyLedger(CONFIG.serperDailyCeiling),
    limiter: new DomainLimiter(CONFIG.perDomainDelayMs),
    singleFlight: new SingleFlight(),
    now: () => new Date(),
    config: CONFIG,
  };

  return {
    deps,
    searchLimiter: createRateLimiter(CONFIG.searchRateLimitPerHour, 3600),
    detectLimiter: createRateLimiter(CONFIG.detectRateLimitPerHour, 3600),
  };
}

const globalForContainer = globalThis as unknown as {
  __nepalPriceCompareContainer?: AppContainer;
};

/** One container per process, including across Next.js dev hot reloads. */
export function getContainer(): AppContainer {
  if (!globalForContainer.__nepalPriceCompareContainer) {
    globalForContainer.__nepalPriceCompareContainer = createContainer();
  }
  return globalForContainer.__nepalPriceCompareContainer;
}
