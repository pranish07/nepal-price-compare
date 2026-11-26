import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRateLimiter,
  UpstashDailyCreditLedger,
  UpstashRateLimiter,
  clientIpFromHeaders,
} from "./rate-limit";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MemoryRateLimiter", () => {
  it("allows up to the limit inside the window, then resets", async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(2, 1_000, () => now);

    expect(await limiter.check("ip")).toMatchObject({ allowed: true, remaining: 1 });
    expect(await limiter.check("ip")).toMatchObject({ allowed: true, remaining: 0 });
    expect(await limiter.check("ip")).toMatchObject({ allowed: false, remaining: 0 });

    now = 1_001;
    expect(await limiter.check("ip")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("tracks keys independently", async () => {
    const limiter = new MemoryRateLimiter(1, 1_000, () => 0);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("b")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("uses the first forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIpFromHeaders(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});

describe("UpstashRateLimiter", () => {
  it("reads the incremented count and decides", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ result: 3 }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const limiter = new UpstashRateLimiter("https://kv.test", "token", 2, 3_600, () => 0);
    const result = await limiter.check("npc:rl:ip");

    expect(result).toEqual({ allowed: false, limit: 2, remaining: 0, resetAt: 3_600_000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://kv.test/pipeline",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("UpstashDailyCreditLedger", () => {
  it("accepts a positive eval result and rejects a negative one", async () => {
    const results = [5, -1];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: results.shift() }), { status: 200 })),
    );
    const ledger = new UpstashDailyCreditLedger(
      "https://kv.test",
      "token",
      10,
      () => new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(await ledger.trySpend(1)).toBe(true);
    expect(await ledger.trySpend(10)).toBe(false);
  });

  it("reads the daily usage and remaining ceiling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: "4" }), { status: 200 })),
    );
    const ledger = new UpstashDailyCreditLedger(
      "https://kv.test",
      "token",
      10,
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(await ledger.used()).toBe(4);
    expect(await ledger.remaining()).toBe(6);
  });
});
