import { describe, expect, it } from "vitest";
import type { Listing } from "./types";
import { sortListings } from "./sort";

function listing(overrides: Partial<Listing> & Pick<Listing, "id">): Listing {
  return {
    sellerId: overrides.id,
    url: `https://example.com/${overrides.id}`,
    title: `Product ${overrides.id}`,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    source: "adapter",
    matchScore: 1,
    flags: [],
    ...overrides,
  };
}

const priced = [
  listing({ id: "a", sellerName: "Alpha", price: { amount: 2000, currency: "NPR" } }),
  listing({
    id: "b",
    sellerName: "Beta",
    price: { amount: 1500, currency: "NPR" },
    pricePerUnit: { amount: 75, unit: "g" },
  }),
  listing({ id: "c", sellerName: "Gamma" }),
];

describe("sortListings", () => {
  it("sorts price ascending and descending, missing prices last", () => {
    expect(sortListings(priced, "price", "asc").map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortListings(priced, "price", "desc").map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts sellers alphabetically", () => {
    expect(sortListings(priced, "seller", "asc").map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts by price per unit and keeps missing values last", () => {
    expect(sortListings(priced, "perUnit", "asc").map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("sorts stock with missing values last", () => {
    const stock = [
      listing({ id: "in", inStock: true }),
      listing({ id: "out", inStock: false }),
      listing({ id: "unknown" }),
    ];
    expect(sortListings(stock, "stock", "desc").map((item) => item.id)).toEqual([
      "in",
      "out",
      "unknown",
    ]);
  });

  it("sorts by match score", () => {
    const matches = [
      listing({ id: "low", matchScore: 0.6 }),
      listing({ id: "high", matchScore: 0.95 }),
    ];
    expect(sortListings(matches, "match", "desc").map((item) => item.id)).toEqual([
      "high",
      "low",
    ]);
  });

  it("sorts by fetch time", () => {
    const fetches = [
      listing({ id: "old", fetchedAt: "2026-01-01T00:00:00.000Z" }),
      listing({ id: "new", fetchedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(sortListings(fetches, "fetched", "desc").map((item) => item.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("does not mutate the input array", () => {
    const before = priced.map((item) => item.id);
    sortListings(priced, "price", "asc");
    expect(priced.map((item) => item.id)).toEqual(before);
  });
});
