import { MemoryDailyCreditLedger, type DailyCreditLedger } from "./budget";
import { isKvConfigured } from "./config";

export type { DailyCreditLedger } from "./budget";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket =
      existing && now < existing.resetAt
        ? existing
        : { count: 0, resetAt: now + this.windowMs };

    if (bucket.count >= this.limit) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt: bucket.resetAt,
      };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 10_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (now >= value.resetAt) this.buckets.delete(bucketKey);
      }
    }

    return {
      allowed: true,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }
}

export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, this.windowSeconds, "NX"],
      ]),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`KV rate limit failed: ${response.status}`);
    const payload = (await response.json()) as Array<{ result?: number }>;
    const count = Number(payload[0]?.result ?? 0);
    const allowed = count <= this.limit;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt: this.now() + this.windowSeconds * 1000,
    };
  }
}

export function createRateLimiter(
  limit: number,
  windowSeconds: number,
): RateLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (isKvConfigured() && url && token) {
    return new UpstashRateLimiter(url.replace(/\/$/, ""), token, limit, windowSeconds);
  }
  return new MemoryRateLimiter(limit, windowSeconds * 1000);
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

const DAILY_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local ceiling = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
if used + amount > ceiling then
  return -1
end
local newValue = redis.call('INCRBY', KEYS[1], amount)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return newValue
`;

export class UpstashDailyCreditLedger implements DailyCreditLedger {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly ceiling: number,
    private readonly now: () => Date = () => new Date(),
    private readonly namespace = "credits",
  ) {}

  private key(): string {
    return `npc:v1:${this.namespace}:${this.now().toISOString().slice(0, 10)}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  async trySpend(credits: number): Promise<boolean> {
    const response = await fetch(`${this.url}/eval`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        script: DAILY_SCRIPT,
        keys: [this.key()],
        args: [this.ceiling, credits, 172_800],
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`KV ledger failed: ${response.status}`);
    const payload = (await response.json()) as { result?: number };
    return Number(payload.result ?? -1) >= 0;
  }

  async used(): Promise<number> {
    const response = await fetch(`${this.url}/get/${encodeURIComponent(this.key())}`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`KV ledger failed: ${response.status}`);
    const payload = (await response.json()) as { result?: string | null };
    return Number.parseInt(payload.result ?? "0", 10) || 0;
  }

  async remaining(): Promise<number> {
    return Math.max(0, this.ceiling - (await this.used()));
  }
}

export function createDailyLedger(ceiling: number, namespace = "credits"): DailyCreditLedger {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (isKvConfigured() && url && token) {
    return new UpstashDailyCreditLedger(
      url.replace(/\/$/, ""),
      token,
      ceiling,
      () => new Date(),
      namespace,
    );
  }
  return new MemoryDailyCreditLedger(ceiling);
}
