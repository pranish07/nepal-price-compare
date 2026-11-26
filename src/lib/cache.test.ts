import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryCacheStore,
  SingleFlight,
  UpstashCacheStore,
  cacheKeyFor,
} from "./cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MemoryCacheStore", () => {
  it("returns fresh, then stale, then missing values", async () => {
    let now = 0;
    const store = new MemoryCacheStore(() => now, 10);
    await store.set("k", { value: 1 }, 10, 20);

    const fresh = await store.get<{ value: number }>("k");
    expect(fresh).toMatchObject({ value: { value: 1 }, stale: false });

    now = 11_000;
    const stale = await store.get<{ value: number }>("k");
    expect(stale).toMatchObject({ value: { value: 1 }, stale: true });

    now = 21_000;
    expect(await store.get("k")).toBeNull();
  });

  it("deletes entries", async () => {
    const store = new MemoryCacheStore(() => 0, 10);
    await store.set("k", 1, 10, 20);
    await store.delete("k");
    expect(await store.get("k")).toBeNull();
  });

  it("prunes the oldest entries beyond the cap", async () => {
    const store = new MemoryCacheStore(() => 0, 2);
    await store.set("a", 1, 10, 20);
    await store.set("b", 2, 10, 20);
    await store.set("c", 3, 10, 20);

    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).not.toBeNull();
    expect(await store.get("c")).not.toBeNull();
  });
});

describe("cacheKeyFor", () => {
  it("is city-independent but size-sensitive", () => {
    const base = { name: "Melaclear Cream", brand: "Dr. Althea", size: { value: 20, unit: "g" as const } };
    expect(cacheKeyFor({ ...base, city: "Kathmandu" })).toBe(
      cacheKeyFor({ ...base, city: "Pokhara" }),
    );
    expect(cacheKeyFor({ ...base, size: { value: 50, unit: "g" } })).not.toBe(
      cacheKeyFor(base),
    );
  });
});

describe("SingleFlight", () => {
  it("runs one function for concurrent identical keys", async () => {
    const flight = new SingleFlight();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = flight.run("k", async () => {
      calls += 1;
      await gate;
      return 42;
    });
    expect(flight.isInFlight("k")).toBe(true);

    const second = flight.run("k", async () => {
      calls += 1;
      return 99;
    });
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
    expect(flight.isInFlight("k")).toBe(false);
  });
});

describe("UpstashCacheStore", () => {
  it("reads and decodes a stored entry", async () => {
    const now = 1_000;
    const stored = {
      value: { hello: "world" },
      freshUntil: now + 1_000,
      staleUntil: now + 2_000,
      cachedAt: "2026-01-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ result: JSON.stringify(stored) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new UpstashCacheStore("https://kv.test", "token", () => now);
    const entry = await store.get<{ hello: string }>("npc:key");

    expect(entry).toEqual({
      value: { hello: "world" },
      stale: false,
      cachedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://kv.test/get/npc%3Akey",
      expect.objectContaining({
        headers: { Authorization: "Bearer token" },
        cache: "no-store",
      }),
    );
  });

  it("writes with a TTL and deletes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: "OK" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new UpstashCacheStore("https://kv.test", "token", () => 0);

    await store.set("k", { a: 1 }, 10, 20);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://kv.test/set/k?EX=20",
      expect.objectContaining({ method: "POST" }),
    );

    await store.delete("k");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://kv.test/del/k",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the backend rejects a request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const store = new UpstashCacheStore("https://kv.test", "token", () => 0);
    await expect(store.get("k")).rejects.toThrow("KV GET failed");
  });
});
