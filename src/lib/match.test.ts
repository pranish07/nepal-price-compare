import { describe, expect, it } from "vitest";
import {
  dedupeBySeller,
  isDifferentSize,
  listingId,
  matchAndBuild,
  matchListing,
  toListing,
} from "./match";
import type { ProductQuery, RawListing } from "./types";

const query: ProductQuery = {
  name: "Melaclear Cream",
  brand: "Dr. Althea",
  size: { value: 20, unit: "g" },
};

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    sellerId: "shop-a",
    sellerName: "Shop A",
    url: "https://shop-a.example/product/melaclear",
    title: "Dr. Althea Melaclear Cream 20g",
    price: { amount: 2000, currency: "NPR" },
    size: { value: 20, unit: "g" },
    inStock: true,
    brand: "Dr. Althea",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    source: "adapter",
    ...overrides,
  };
}

describe("matchListing", () => {
  it("accepts an exact product", () => {
    const outcome = matchListing(query, raw());
    expect(outcome).not.toBeNull();
    expect(outcome?.score).toBe(1);
    expect(outcome?.flags).toEqual([]);
  });

  it("rejects a different product that only shares a generic word", () => {
    expect(
      matchListing(
        query,
        raw({ title: "Dr. Althea 345 Relief Cream 50ml", size: { value: 50, unit: "ml" } }),
      ),
    ).toBeNull();
  });

  it("rejects a product with a conflicting brand", () => {
    expect(
      matchListing(query, raw({ title: "COSRX Melaclear Cream 20g", brand: "COSRX" })),
    ).toBeNull();
  });

  it("keeps a different size but flags it", () => {
    const outcome = matchListing(
      query,
      raw({ title: "Dr. Althea Melaclear Cream 50g", size: { value: 50, unit: "g" } }),
    );
    expect(outcome).not.toBeNull();
    expect(outcome?.flags).toContain("different-size");
  });

  it("flags a mass/volume unit mismatch", () => {
    const outcome = matchListing(
      query,
      raw({ title: "Dr. Althea Melaclear Cream 50ml", size: { value: 50, unit: "ml" } }),
    );
    expect(outcome).not.toBeNull();
    expect(outcome?.flags).toContain("size-unit-mismatch");
  });

  it("flags missing prices and out-of-stock listings", () => {
    const outcome = matchListing(
      query,
      raw({ price: undefined, inStock: false }),
    );
    expect(outcome?.flags).toEqual(
      expect.arrayContaining(["missing-price", "out-of-stock"]),
    );
  });

  it("accepts a title match when the listing has no brand field", () => {
    const outcome = matchListing(query, raw({ brand: undefined }));
    expect(outcome).not.toBeNull();
    // The brand still appears in the title, so it is a positive signal.
    expect(outcome?.brandSignal).toBe(1);
  });

  it("treats a missing brand as neutral when the title has no brand", () => {
    const outcome = matchListing(
      query,
      raw({ title: "Melaclear Cream 20g", brand: undefined }),
    );
    expect(outcome).not.toBeNull();
    expect(outcome?.brandSignal).toBe(0.5);
  });
});

describe("listing identity", () => {
  it("is stable for the same seller and URL", () => {
    expect(listingId(raw())).toBe(listingId(raw()));
  });

  it("changes when the URL changes", () => {
    expect(listingId(raw())).not.toBe(
      listingId(raw({ url: "https://shop-a.example/product/other" })),
    );
  });
});

describe("toListing", () => {
  it("computes price per unit from price and size", () => {
    const outcome = matchListing(query, raw());
    expect(outcome).not.toBeNull();
    const listing = toListing(raw(), outcome!);
    expect(listing.pricePerUnit).toEqual({ amount: 100, unit: "g" });
    expect(listing.id).toBe(listingId(raw()));
  });
});

describe("dedupeBySeller", () => {
  it("keeps one listing per seller, preferring the lower price", () => {
    const cheap = matchAndBuild(
      query,
      raw({ url: "https://shop-a.example/cheap", price: { amount: 1800, currency: "NPR" } }),
    );
    const expensive = matchAndBuild(
      query,
      raw({ url: "https://shop-a.example/expensive", price: { amount: 2200, currency: "NPR" } }),
    );
    const other = matchAndBuild(
      query,
      raw({
        sellerId: "shop-b",
        url: "https://shop-b.example/product",
        price: { amount: 1900, currency: "NPR" },
      }),
    );

    const deduped = dedupeBySeller([expensive!, cheap!, other!]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((item) => item.sellerId === "shop-a")?.price?.amount).toBe(1800);
  });

  it("prefers the better match before the lower price", () => {
    const exact = matchAndBuild(
      query,
      raw({ url: "https://shop-a.example/exact", price: { amount: 2500, currency: "NPR" } }),
    );
    const partial = matchAndBuild(
      query,
      raw({
        url: "https://shop-a.example/partial",
        title: "Dr. Althea Melaclear Cream",
        size: undefined,
        price: { amount: 1000, currency: "NPR" },
      }),
    );
    const deduped = dedupeBySeller([partial!, exact!]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.url).toBe("https://shop-a.example/exact");
  });
});

describe("isDifferentSize", () => {
  it("recognises both mismatch flags", () => {
    const outcome = matchListing(
      query,
      raw({ title: "Dr. Althea Melaclear Cream 50ml", size: { value: 50, unit: "ml" } }),
    );
    const listing = toListing(raw(), outcome!);
    expect(isDifferentSize(listing)).toBe(true);
    expect(
      isDifferentSize(
        toListing(raw(), matchListing(query, raw())!),
      ),
    ).toBe(false);
  });
});
