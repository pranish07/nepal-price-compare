import { describe, expect, it, vi } from "vitest";
import { CreditBudget, MemoryDailyCreditLedger } from "./budget";
import { createNoopLogger } from "./logger";
import {
  SerperClient,
  buildQueryVariants,
  isNepalRelevant,
  isNepaliStore,
} from "./serper";
import type { ProductQuery } from "./types";

const query: ProductQuery = { name: "Melaclear Cream", brand: "Dr. Althea" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function budget(maxCredits = 8): CreditBudget {
  return new CreditBudget({ maxCredits, maxFetches: 25 });
}

function context(ceiling = 100) {
  return {
    logger: createNoopLogger(),
    dailyLedger: new MemoryDailyCreditLedger(ceiling),
  };
}

const relevantResults = [
  { title: "Melaclear Nepal", link: "https://a.com.np/p", snippet: "NPR 2000" },
  { title: "Melaclear Nepal", link: "https://b.com.np/p", snippet: "NPR 2100" },
  { title: "Melaclear Nepal", link: "https://c.com.np/p", snippet: "NPR 2200" },
];

describe("buildQueryVariants", () => {
  it("builds at most three unique variants", () => {
    expect(buildQueryVariants(query)).toEqual([
      "Dr. Althea Melaclear Cream price Nepal",
      "Dr. Althea Melaclear Cream Nepal",
      "Melaclear Cream buy Nepal",
    ]);
  });

  it("respects the variant cap", () => {
    expect(buildQueryVariants(query, 1)).toHaveLength(1);
  });
});

describe("Nepal relevance", () => {
  it("accepts .np domains, NPR, and Nepali cities", () => {
    expect(isNepalRelevant({ title: "x", link: "https://shop.com.np/p", snippet: "" })).toBe(true);
    expect(isNepalRelevant({ title: "Cream NPR 2000", link: "https://shop.com/p", snippet: "" })).toBe(true);
    expect(isNepalRelevant({ title: "Cream in Kathmandu", link: "https://shop.com/p", snippet: "" })).toBe(true);
    expect(isNepalRelevant({ title: "Cream", link: "https://shop.com/p", snippet: "Rs. 2000" })).toBe(true);
  });

  it("rejects unrelated results", () => {
    expect(isNepalRelevant({ title: "Cream", link: "https://shop.com/p", snippet: "USD 20" })).toBe(false);
  });

  it("recognises Nepali stores by domain or store text", () => {
    expect(isNepaliStore({ title: "x", link: "https://shop.com.np/p", snippet: "" })).toBe(true);
    expect(isNepaliStore({ title: "Shop in Dharan", link: "https://shop.com/p", snippet: "" })).toBe(true);
    expect(isNepaliStore({ title: "Shop", link: "https://shop.com/p", snippet: "" })).toBe(false);
    expect(isNepaliStore({ title: "x", link: "not a url", snippet: "" })).toBe(false);
  });
});

describe("SerperClient without an API key", () => {
  it("skips discovery and spends nothing", async () => {
    const fetchImpl = vi.fn();
    const client = new SerperClient({ apiKey: "", fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.discover(query, budget(), context());
    expect(result).toMatchObject({ candidates: [], creditsSpent: 0, queries: [] });
    expect(result.skippedReason).toContain("SERPER_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("SerperClient discovery", () => {
  it("pages each variant and deduplicates URLs", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.page === 1) return json({ organic: relevantResults });
      return json({
        organic: [{ title: "Melaclear Nepal", link: "https://d.com.np/p", snippet: "NPR 2300" }],
      });
    });

    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxVariants: 3,
      maxPages: 2,
    });
    const result = await client.discover(query, budget(), context());

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(bodies.map((body) => body.page)).toEqual([1, 2, 1, 2, 1, 2]);
    for (const body of bodies) {
      expect(body).toMatchObject({ gl: "np", hl: "en", num: 10 });
    }
    expect(result.creditsSpent).toBe(6);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://a.com.np/p",
      "https://b.com.np/p",
      "https://c.com.np/p",
      "https://d.com.np/p",
    ]);
  });

  it("does not page when the page cap is one", async () => {
    const fetchImpl = vi.fn(async () => json({ organic: relevantResults }));
    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxVariants: 3,
      maxPages: 1,
    });
    const result = await client.discover(query, budget(), context());
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.creditsSpent).toBe(3);
  });

  it("stops when the per-request budget runs out", async () => {
    const fetchImpl = vi.fn(async () => json({ organic: relevantResults }));
    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxVariants: 3,
      maxPages: 1,
    });
    const result = await client.discover(query, budget(2), context());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.creditsSpent).toBe(2);
    expect(result.skippedReason).toContain("budget exhausted");
  });

  it("fails closed when the daily ceiling is reached", async () => {
    const fetchImpl = vi.fn(async () => json({ organic: relevantResults }));
    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.discover(query, budget(), context(0));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.creditsSpent).toBe(0);
    expect(result.skippedReason).toContain("Daily Serper credit ceiling");
  });

  it("reports an HTTP failure without retrying the variant", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "nope" }, 500));
    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.discover(query, budget(), context());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.creditsSpent).toBe(1);
    expect(result.error).toContain("HTTP 500");
  });

  it("filters out results with no Nepal signal", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        organic: [
          { title: "Cream", link: "https://amazon.com/p", snippet: "USD 20" },
          { title: "Cream", link: "https://sephora.com/p", snippet: "USD 30" },
        ],
      }),
    );
    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxVariants: 3,
      maxPages: 2,
    });
    const result = await client.discover(query, budget(), context());
    expect(result.candidates).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("caps candidates at twenty", async () => {
    const many = Array.from({ length: 25 }, (_value, index) => ({
      title: "Melaclear Nepal",
      link: `https://shop${index}.com.np/p`,
      snippet: "NPR 2000",
    }));
    const fetchImpl = vi.fn(async () => json({ organic: many }));
    const client = new SerperClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxVariants: 1,
      maxPages: 1,
    });
    const result = await client.discover(query, budget(), context());
    expect(result.candidates).toHaveLength(20);
  });
});
