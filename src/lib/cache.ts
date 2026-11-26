import { CONFIG, isKvConfigured } from "./config";
import { normalizeQueryKey } from "./normalize";
import type { ProductQuery } from "./types";

export interface CacheEntry<T> {
  value: T;
  stale: boolean;
  cachedAt: string;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    staleSeconds?: number,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface MemoryEntry {
  value: unknown;
  freshUntil: number;
  staleUntil: number;
  cachedAt: string;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries = 500,
  ) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const now = this.now();
    if (now > entry.staleUntil) {
      this.entries.delete(key);
      return null;
    }
    return {
      value: entry.value as T,
      stale: now > entry.freshUntil,
      cachedAt: entry.cachedAt,
    };
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    staleSeconds = CONFIG.cacheStaleSeconds,
  ): Promise<void> {
    const now = this.now();
    const windowSeconds = Math.max(ttlSeconds, staleSeconds);
    this.entries.set(key, {
      value,
      freshUntil: now + ttlSeconds * 1000,
      staleUntil: now + windowSeconds * 1000,
      cachedAt: new Date(now).toISOString(),
    });
    this.prune();
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    if (this.entries.size <= this.maxEntries) return;
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.staleUntil) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

interface StoredCacheValue {
  value: unknown;
  freshUntil: number;
  staleUntil: number;
  cachedAt: string;
}

export class UpstashCacheStore implements CacheStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const response = await fetch(`${this.url}/get/${encodeURIComponent(key)}`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`KV GET failed: ${response.status}`);
    const payload = (await response.json()) as { result?: string | null };
    if (!payload.result) return null;
    const stored = JSON.parse(payload.result) as StoredCacheValue;
    const now = this.now();
    if (now > stored.staleUntil) return null;
    return {
      value: stored.value as T,
      stale: now > stored.freshUntil,
      cachedAt: stored.cachedAt,
    };
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    staleSeconds = CONFIG.cacheStaleSeconds,
  ): Promise<void> {
    const now = this.now();
    const windowSeconds = Math.max(ttlSeconds, staleSeconds);
    const stored: StoredCacheValue = {
      value,
      freshUntil: now + ttlSeconds * 1000,
      staleUntil: now + windowSeconds * 1000,
      cachedAt: new Date(now).toISOString(),
    };
    const response = await fetch(
      `${this.url}/set/${encodeURIComponent(key)}?EX=${windowSeconds}`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(stored),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error(`KV SET failed: ${response.status}`);
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(`${this.url}/del/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: this.headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`KV DEL failed: ${response.status}`);
  }
}

export function createCacheStore(): CacheStore {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (isKvConfigured() && url && token) {
    return new UpstashCacheStore(url.replace(/\/$/, ""), token);
  }
  return new MemoryCacheStore();
}

export function cacheKeyFor(query: ProductQuery): string {
  return `npc:v1:search:${normalizeQueryKey(query)}`;
}

/** Concurrent identical searches share one pipeline execution. */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}
