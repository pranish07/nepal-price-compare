function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const contact = process.env.CRAWLER_CONTACT?.trim() || "https://github.com/nepal-price-compare";

export const CONFIG = {
  appName: "Nepal Price Compare",
  version: "0.1.0",
  userAgent: `NepalPriceCompare/0.1 (+${contact}; contact: ${contact})`,

  // Search cache. City is deliberately excluded from the key.
  cacheTtlSeconds: intFromEnv("CACHE_TTL_SECONDS", 6 * 60 * 60),
  cacheStaleSeconds: intFromEnv("CACHE_STALE_SECONDS", 24 * 60 * 60),
  emptyResultTtlSeconds: 10 * 60,

  // Fetch budget for a single search request.
  maxFetchesPerRequest: intFromEnv("MAX_FETCHES_PER_REQUEST", 25),
  fetchTimeoutMs: intFromEnv("FETCH_TIMEOUT_MS", 8_000),
  maxBytesPerPage: intFromEnv("MAX_BYTES_PER_PAGE", 2 * 1024 * 1024),
  fetchConcurrency: intFromEnv("FETCH_CONCURRENCY", 6),
  perDomainDelayMs: intFromEnv("PER_DOMAIN_DELAY_MS", 500),

  // Serper discovery.
  maxSerperCredits: intFromEnv("MAX_SERPER_CREDITS_PER_SEARCH", 8),
  maxSerperVariants: intFromEnv("MAX_SERPER_VARIANTS", 3),
  maxSerperPages: intFromEnv("MAX_SERPER_PAGES", 2),
  serperDailyCeiling: intFromEnv("SERPER_DAILY_CREDIT_CEILING", 100),
  serperTimeoutMs: intFromEnv("SERPER_TIMEOUT_MS", 10_000),

  // Rate limits.
  searchRateLimitPerHour: intFromEnv("SEARCH_RATE_LIMIT_PER_HOUR", 10),
  detectRateLimitPerHour: intFromEnv("DETECT_RATE_LIMIT_PER_HOUR", 30),
  imageDetectRateLimitPerHour: intFromEnv("IMAGE_DETECT_RATE_LIMIT_PER_HOUR", 10),

  // Free Gemini image detection. The model is never defaulted in runtime code.
  geminiModel: process.env.GEMINI_MODEL?.trim() || "",
  geminiDailyCeiling: intFromEnv("GEMINI_DAILY_CEILING", 200),

  // Matching / ranking.
  matchThreshold: 0.55,
  sizeTolerance: 0.05,
  adapterTimeoutMs: intFromEnv("ADAPTER_TIMEOUT_MS", 9_000),
  circuitFailureThreshold: 3,
  circuitHalfOpenMs: 60_000,
} as const;

export type AppConfig = typeof CONFIG;

export function isSerperConfigured(): boolean {
  return Boolean(process.env.SERPER_API_KEY?.trim());
}

export function isKvConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_MODEL?.trim());
}
