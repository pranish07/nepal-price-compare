import { describe, expect, it } from "vitest";
import { RANK_WEIGHTS, rankListings } from "./rank";
import type { Listing, ProductQuery } from "./types";

const query: ProductQuery = {
  name: "Melaclear Cream",
  brand: "Dr. Althea",
  size: { value: 20, unit: "g" },
};

function listing(
  overrides: Partial<Listing> & Pick<Listing, "id">,
): Listing {
  return {
    sellerId: overrides.id,
    sellerName: `Seller ${overrides.id}`,
    url: `https://${overrides.id}.example/product`,
    title: "Dr. Althea Melaclear Cream 20g",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    source: "adapter",
    matchScore: 1,
    flags: [],
    ...overrides,
  };
}

const a = listing({
  id: "a",
  price: { amount: 2000, currency: "NPR" },
  size: { value: 20, unit: "g" },
  inStock: true,
  location: "Pokhara, Nepal",
});
const b = listing({
  id: "b",
  price: { amount: 2700, currency: "NPR" },
  size: { value: 20, unit: "g" },
  inStock: true,
  location: "Kathmandu, Nepal",
});
const c = listing({
  id: "c",
  price: { amount: 1500, currency: "NPR" },
  size: { value: 50, unit: "g" },
  inStock: true,
  flags: ["different-size"],
  location: "Kathmandu, Nepal",
});

describe("RANK_WEIGHTS", () => {
  it("sum to one", () => {
    const sum = Object.values(RANK_WEIGHTS).reduce((total, weight) => total + weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("rankListings badges", () => {
  it("picks the cheapest exact-size in-stock listing", () => {
    const result = rankListings([a, b, c], query);
    const cheapest = result.badges.find((badge) => badge.kind === "cheapest");
    expect(cheapest?.listingId).toBe("a");
  });

  it("can include different sizes when asked", () => {
    const result = rankListings([a, b, c], query, { includeDifferentSizes: true });
    const cheapest = result.badges.find((badge) => badge.kind === "cheapest");
    expect(cheapest?.listingId).toBe("c");
    expect(result.notes.join(" ")).toMatch(/different size/i);
  });

  it("picks a best value that is not the cheapest when possible", () => {
    const result = rankListings([a, b, c], query);
    const value = result.badges.find((badge) => badge.kind === "best_value");
    expect(value?.listingId).toBe("b");
  });

  it("picks the closest seller by location", () => {
    const result = rankListings([a, b, c], { ...query, city: "Kathmandu" });
    const closest = result.badges.find((badge) => badge.kind === "closest");
    expect(closest?.listingId).toBe("b");
    expect(closest?.reason).toContain("Kathmandu");
  });

  it("falls back to a different-size seller only when no exact size matches", () => {
    const pokhara = listing({
      id: "pokhara",
      price: { amount: 2000, currency: "NPR" },
      location: "Pokhara, Nepal",
    });
    const kathmandu = listing({
      id: "kathmandu",
      price: { amount: 1500, currency: "NPR" },
      size: { value: 50, unit: "g" },
      flags: ["different-size"],
      location: "Kathmandu, Nepal",
    });
    const result = rankListings([pokhara, kathmandu], { ...query, city: "Kathmandu" });
    const closest = result.badges.find((badge) => badge.kind === "closest");
    expect(closest?.listingId).toBe("kathmandu");
  });

  it("explains when no seller matches the city", () => {
    const result = rankListings([a, b, c], { ...query, city: "Dharan" });
    expect(result.badges.some((badge) => badge.kind === "closest")).toBe(false);
    expect(result.notes.join(" ")).toContain("No seller listed a location or delivery option matching Dharan.");
  });

  it("does not add a closest badge without a city", () => {
    const result = rankListings([a, b, c], query);
    expect(result.badges.some((badge) => badge.kind === "closest")).toBe(false);
  });

  it("notes when there are no matches", () => {
    const result = rankListings([], query);
    expect(result.badges).toEqual([]);
    expect(result.notes.join(" ")).toContain("No exact matches found");
  });
});

describe("rankListings scoring", () => {
  it("orders listings by rank score", () => {
    const result = rankListings([a, b], query);
    expect(result.listings[0]?.rankScore).toBeGreaterThanOrEqual(
      result.listings[1]?.rankScore ?? 0,
    );
  });

  it("penalises out-of-stock listings", () => {
    const out = listing({
      id: "out",
      price: { amount: 2000, currency: "NPR" },
      inStock: false,
    });
    const inStock = listing({
      id: "in",
      price: { amount: 2200, currency: "NPR" },
      inStock: true,
    });
    const result = rankListings([out, inStock], query);
    expect(result.listings[0]?.id).toBe("in");
    expect(result.listings[1]?.scoreBreakdown?.stock).toBe(0.1);
  });

  it("treats missing signals as neutral", () => {
    const bare = listing({ id: "bare", price: undefined });
    const result = rankListings([bare], query);
    expect(result.listings[0]?.scoreBreakdown).toEqual({
      price: 0.5,
      stock: 0.5,
      delivery: 0.5,
      trust: 0.5,
      total: 0.5,
    });
  });

  it("scores delivery to the requested city", () => {
    const delivers = listing({
      id: "delivers",
      price: { amount: 2000, currency: "NPR" },
      delivery: "Free delivery in Kathmandu",
    });
    const result = rankListings([delivers], { ...query, city: "Kathmandu" });
    expect(result.listings[0]?.scoreBreakdown?.delivery).toBe(1);
  });

  it("scores nationwide delivery", () => {
    const delivers = listing({
      id: "nationwide",
      price: { amount: 2000, currency: "NPR" },
      delivery: "Delivery across Nepal",
    });
    const result = rankListings([delivers], { ...query, city: "Dharan" });
    expect(result.listings[0]?.scoreBreakdown?.delivery).toBe(1);
  });

  it("scores stated trust signals", () => {
    const trusted = listing({
      id: "trusted",
      price: { amount: 2000, currency: "NPR" },
      trust: { authenticityStated: true, physicalPickup: true, reviews: 12 },
    });
    const result = rankListings([trusted], query);
    expect(result.listings[0]?.scoreBreakdown?.trust).toBe(1);
  });
});
