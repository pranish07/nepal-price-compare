import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractProduct } from "./index";
import { extractStoreSignals } from "./dom";

const fixtures = join(process.cwd(), "src", "test", "fixtures");
const FETCHED_AT = "2026-01-01T00:00:00.000Z";

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function jsonLdHtml(product: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(product)}</script></head><body></body></html>`;
}

describe("extractProduct on the real Bonjour product page", () => {
  const html = fixture("bonjour-product.html");
  const product = extractProduct(
    html,
    "https://bonjournp.com/product/dr-althea-melaclear-cream-20gm/",
    FETCHED_AT,
  );

  it("extracts the product identity", () => {
    expect(product).not.toBeNull();
    expect(product!.query).toEqual({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 20, unit: "g" },
    });
  });

  it("extracts price, stock, and provenance", () => {
    expect(product!.listing).toMatchObject({
      sellerId: "bonjournp.com",
      sellerName: "Bonjour Nepal",
      url: "https://bonjournp.com/product/dr-althea-melaclear-cream-20gm/",
      price: { amount: 2000, currency: "NPR" },
      size: { value: 20, unit: "g" },
      inStock: true,
      brand: "Dr. Althea",
      fetchedAt: FETCHED_AT,
      source: "direct",
    });
    expect(product!.warnings).toEqual([]);
  });
});

describe("extractStoreSignals", () => {
  it("reads literal location and delivery text from the real search page", () => {
    const signals = extractStoreSignals(fixture("beauty-shop-search.html"));
    expect(signals.location).toBe("Dharan, Sunsari, Nepal");
    expect(signals.delivery).toBe(
      "Free delivery in Dharan; Delivery across Nepal; Cash on delivery in Dharan",
    );
  });

  it("does not invent signals when none are present", () => {
    expect(extractStoreSignals("<html><body>Hello</body></html>")).toEqual({});
  });
});

describe("extractProduct with embedded RSC JSON-LD", () => {
  it("decodes escaped JSON-LD and keeps the stated currency", () => {
    const payload = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Dr. Althea Melaclear Cream 20g",
      brand: { name: "Dr. Althea" },
      offers: {
        price: "2700",
        priceCurrency: "NPR",
        availability: "http://schema.org/InStock",
      },
      image: "https://cdn.example/melaclear.jpg",
    };
    const escaped = JSON.stringify(payload).replace(/"/g, '\\"');
    const html = `<html><body><script>self.__next_f.push([1,"${escaped}"])</script></body></html>`;

    const product = extractProduct(
      html,
      "https://beautyessentials.com.np/shop/moisturizer/melaclear-cream",
      FETCHED_AT,
    );

    expect(product).not.toBeNull();
    expect(product!.listing).toMatchObject({
      title: "Dr. Althea Melaclear Cream 20g",
      price: { amount: 2700, currency: "NPR" },
      size: { value: 20, unit: "g" },
      inStock: true,
      brand: "Dr. Althea",
      image: "https://cdn.example/melaclear.jpg",
    });
    expect(product!.query.name).toBe("Melaclear Cream");
  });
});

describe("extractProduct currency handling", () => {
  it("refuses a non-NPR price and says why", () => {
    const html = jsonLdHtml({
      "@type": "Product",
      name: "Dr. Althea Melaclear Cream 20g",
      brand: { name: "Dr. Althea" },
      offers: { price: "20.00", priceCurrency: "USD" },
    });
    const product = extractProduct(html, "https://example.com/product", FETCHED_AT);
    expect(product!.listing.price).toBeUndefined();
    expect(product!.warnings.join(" ")).toContain("USD");
  });

  it("assumes NPR for a .np store but warns when currency is unstated", () => {
    const html = jsonLdHtml({
      "@type": "Product",
      name: "Melaclear Cream 20g",
      offers: { price: "2000" },
    });
    const nepali = extractProduct(html, "https://shop.com.np/product", FETCHED_AT);
    expect(nepali!.listing.price).toEqual({ amount: 2000, currency: "NPR" });
    expect(nepali!.warnings.join(" ")).not.toContain("NPR was assumed");

    const foreign = extractProduct(html, "https://example.com/product", FETCHED_AT);
    expect(foreign!.listing.price).toEqual({ amount: 2000, currency: "NPR" });
    expect(foreign!.warnings.join(" ")).toContain("NPR was assumed");
  });
});

describe("extractProduct missing data", () => {
  it("returns null when there is no product title", () => {
    expect(extractProduct("<html><body></body></html>", "https://example.com/", FETCHED_AT)).toBeNull();
  });

  it("warns about a missing price and size instead of guessing", () => {
    const html = jsonLdHtml({
      "@type": "Product",
      name: "Mystery Cream",
      offers: { priceCurrency: "NPR" },
    });
    const product = extractProduct(html, "https://example.com/product", FETCHED_AT);
    expect(product!.listing.price).toBeUndefined();
    expect(product!.listing.size).toBeUndefined();
    expect(product!.warnings).toEqual(
      expect.arrayContaining([
        "No price was found on this page.",
        "No size was found. Add it for a price-per-unit comparison.",
      ]),
    );
  });

  it("reads out-of-stock availability", () => {
    const html = jsonLdHtml({
      "@type": "Product",
      name: "Melaclear Cream 20g",
      offers: {
        price: "2000",
        priceCurrency: "NPR",
        availability: "http://schema.org/OutOfStock",
      },
    });
    const product = extractProduct(html, "https://shop.com.np/product", FETCHED_AT);
    expect(product!.listing.inStock).toBe(false);
  });
});
