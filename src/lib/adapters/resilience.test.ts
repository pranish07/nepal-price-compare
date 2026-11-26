import { describe, expect, it } from "vitest";
import { FetchError } from "../http";
import { createNoopLogger } from "../logger";
import type { RawListing } from "../types";
import { CircuitOpenError, withResilience } from "./resilience";
import { AdapterError, type AdapterContext, type StoreAdapter } from "./types";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function context(): AdapterContext {
  return {
    fetch: {
      async html() {
        throw new Error("not used");
      },
    },
    timeoutMs: 50,
    logger: createNoopLogger(),
    now: () => NOW,
  };
}

function adapterWith(search: StoreAdapter["search"]): StoreAdapter {
  return {
    id: "fake",
    domain: "fake.example",
    label: "Fake",
    search,
  };
}

const listing: RawListing = {
  sellerId: "fake.example",
  url: "https://fake.example/product",
  title: "Melaclear Cream 20g",
  fetchedAt: NOW.toISOString(),
  source: "adapter",
};

describe("withResilience", () => {
  it("returns a successful result without retrying", async () => {
    let calls = 0;
    const adapter = withResilience(
      adapterWith(async () => {
        calls += 1;
        return [listing];
      }),
      { sleep: async () => undefined, random: () => 0 },
    );

    const result = await adapter.search({ name: "Melaclear Cream" }, context());
    expect(result).toEqual([listing]);
    expect(calls).toBe(1);
  });

  it("retries one transient timeout with jitter", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const adapter = withResilience(
      adapterWith(async () => {
        calls += 1;
        if (calls === 1) throw new FetchError("timeout", "slow");
        return [listing];
      }),
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 0.5,
      },
    );

    const result = await adapter.search({ name: "Melaclear Cream" }, context());
    expect(result).toEqual([listing]);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([350]);
  });

  it("does not retry a non-retryable parse failure", async () => {
    let calls = 0;
    const adapter = withResilience(
      adapterWith(async () => {
        calls += 1;
        throw new AdapterError("parse_failed", "bad page");
      }),
      { sleep: async () => undefined, random: () => 0 },
    );

    await expect(adapter.search({ name: "x" }, context())).rejects.toMatchObject({
      code: "parse_failed",
    });
    expect(calls).toBe(1);
  });

  it("times out and retries once, then reports a timeout", async () => {
    let calls = 0;
    const adapter = withResilience(
      adapterWith(
        async (_query, ctx) =>
          new Promise<RawListing[]>((_resolve, reject) => {
            calls += 1;
            ctx.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      ),
      { timeoutMs: 5, sleep: async () => undefined, random: () => 0 },
    );

    await expect(adapter.search({ name: "x" }, context())).rejects.toMatchObject({
      name: "AdapterError",
      code: "timeout",
    });
    expect(calls).toBe(2);
  });

  it("opens the circuit after repeated failures and half-opens later", async () => {
    let now = 0;
    let calls = 0;
    let shouldFail = true;
    const adapter = withResilience(
      adapterWith(async () => {
        calls += 1;
        if (shouldFail) throw new AdapterError("parse_failed", "down");
        return [listing];
      }),
      {
        failureThreshold: 2,
        halfOpenMs: 100,
        now: () => now,
        sleep: async () => undefined,
        random: () => 0,
      },
    );

    await expect(adapter.search({ name: "x" }, context())).rejects.toBeInstanceOf(AdapterError);
    await expect(adapter.search({ name: "x" }, context())).rejects.toBeInstanceOf(AdapterError);
    await expect(adapter.search({ name: "x" }, context())).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(calls).toBe(2);

    now = 150;
    shouldFail = false;
    const result = await adapter.search({ name: "x" }, context());
    expect(result).toEqual([listing]);
    expect(calls).toBe(3);
  });
});
