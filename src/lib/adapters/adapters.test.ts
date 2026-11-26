import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNoopLogger } from "../logger";
import type { FetchedPage } from "../http";
import type { ProductQuery } from "../types";
import { beautyEssentialsAdapter } from "./beauty-essentials";
import { bonjourAdapter } from "./bonjour";
import { AdapterError, type AdapterContext } from "./types";

const fixtures = join(process.cwd(), "src", "test", "fixtures");
const NOW = new Date("2026-01-01T00:00:00.000Z");
const query: ProductQuery = {
  name: "Melaclear Cream",
  brand: "Dr. Althea",
  size: { value: 20, unit: "g" },
};

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function contextFor(body: string): AdapterContext {
  return {
    fetch: {
      async html(url: string): Promise<FetchedPage> {
        return {
          url,
          status: 200,
          contentType: "text/html",
          body,
          bytes: Buffer.byteLength(body),
          fetchedAt: NOW.toISOString(),
        };
      },
    },
    timeoutMs: 2_000,
    logger: createNoopLogger(),
    now: () => NOW,
  };
}

describe("Bonjour adapter", () => {
  it("parses the real search page into listings", async () => {
    const listings = await bonjourAdapter.search(
      query,
      contextFor(fixture("bonjour-shop-search.html")),
    );

    expect(listings).toHaveLength(11);
    for (const listing of listings) {
      expect(listing.sellerId).toBe("bonjournp.com");
      expect(listing.source).toBe("adapter");
      expect(listing.url).toContain("/product/");
      expect(listing.fetchedAt).toBe(NOW.toISOString());
    }

    const melaclear = listings.find((listing) => /melaclear/i.test(listing.title));
    expect(melaclear).toBeDefined();
    expect(melaclear).toMatchObject({
      price: { amount: 2000, currency: "NPR" },
      size: { value: 20, unit: "g" },
      brand: "Dr. Althea",
    });
  });

  it("returns an empty array for a genuine empty search", async () => {
    const listings = await bonjourAdapter.search(
      query,
      contextFor("<html><body><p>No products were found matching your selection.</p></body></html>"),
    );
    expect(listings).toEqual([]);
  });

  it("raises parse_failed when the page has neither products nor an empty marker", async () => {
    await expect(
      bonjourAdapter.search(query, contextFor("<html><body>hello</body></html>")),
    ).rejects.toMatchObject({ name: "AdapterError", code: "parse_failed" });
  });
});

describe("Beauty Essentials adapter", () => {
  it("parses the RSC payload into listings with stock and store signals", async () => {
    const listings = await beautyEssentialsAdapter.search(
      query,
      contextFor(fixture("beauty-shop-search.html")),
    );

    expect(listings).toHaveLength(17);
    const melaclear = listings.find((listing) => listing.title === "Melaclear Cream");
    expect(melaclear).toBeDefined();
    expect(melaclear).toMatchObject({
      sellerId: "beautyessentials.com.np",
      sellerName: "Beauty Essentials",
      url: "https://beautyessentials.com.np/shop/moisturizer/melaclear-cream",
      price: { amount: 2700, currency: "NPR" },
      originalPrice: { amount: 3000, currency: "NPR" },
      size: { value: 20, unit: "g" },
      inStock: true,
      brand: "Dr. Althea",
      location: "Dharan, Sunsari, Nepal",
      source: "adapter",
    });
    expect(melaclear!.delivery).toContain("Free delivery in Dharan");
    expect(melaclear!.delivery).toContain("Delivery across Nepal");
    expect(melaclear!.delivery).toContain("Cash on delivery in Dharan");
  });

  it("marks zero stock as out of stock", async () => {
    const listings = await beautyEssentialsAdapter.search(
      query,
      contextFor(fixture("beauty-shop-search.html")),
    );
    const soldOut = listings.find((listing) => listing.title === "Stretchfit Calming Pad");
    expect(soldOut?.inStock).toBe(false);
  });

  it("raises payload_missing when the RSC payload is absent", async () => {
    await expect(
      beautyEssentialsAdapter.search(query, contextFor("<html><body>nothing</body></html>")),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});
