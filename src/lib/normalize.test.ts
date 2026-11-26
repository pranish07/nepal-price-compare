import { describe, expect, it } from "vitest";
import {
  cleanProductName,
  detectBrand,
  looksLikeUrl,
  normalizeBrand,
  normalizeCity,
  normalizeName,
  normalizeQueryKey,
  parseProductText,
  searchText,
  stripBrand,
  tokenize,
} from "./normalize";

describe("normalizeBrand", () => {
  it("normalizes punctuation, accents, and ampersands", () => {
    expect(normalizeBrand("Dr.Althea")).toBe("dr althea");
    expect(normalizeBrand("L'Oréal")).toBe("loreal");
    expect(normalizeBrand("Dot & Key")).toBe("dot and key");
  });
});

describe("detectBrand", () => {
  it("finds known brands including multi-word names", () => {
    expect(detectBrand("Dr. Althea Melaclear Cream 20g")).toBe("Dr. Althea");
    expect(detectBrand("Beauty of Joseon Relief Sun 50ml")).toBe("Beauty of Joseon");
    expect(detectBrand("COSRX Snail Mucin 96")).toBe("COSRX");
  });

  it("returns undefined for unknown brands", () => {
    expect(detectBrand("Some random cream")).toBeUndefined();
  });
});

describe("stripBrand and cleanProductName", () => {
  it("removes the brand tolerantly", () => {
    expect(stripBrand("Dr.Althea Melaclear Cream", "Dr. Althea")).toBe("Melaclear Cream");
  });

  it("removes store suffixes, brand, size, and marketing prefixes", () => {
    expect(
      cleanProductName("Dr. Althea Melaclear Cream 20g – Bonjour Nepal", "Dr. Althea"),
    ).toBe("Melaclear Cream");
    expect(cleanProductName("Authentic COSRX Snail Mucin 100ml", "COSRX")).toBe(
      "Snail Mucin",
    );
  });

  it("keeps the original text when cleaning would empty it", () => {
    expect(cleanProductName("Dr. Althea", "Dr. Althea")).toBe("Dr. Althea");
  });
});

describe("parseProductText", () => {
  it("splits a typed product into name, brand, and size", () => {
    expect(parseProductText("Dr. Althea Melaclear Cream 20g")).toEqual({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 20, unit: "g" },
    });
  });

  it("omits size when the user did not type one", () => {
    expect(parseProductText("COSRX Snail Mucin Essence")).toEqual({
      name: "Snail Mucin Essence",
      brand: "COSRX",
    });
  });
});

describe("tokenize", () => {
  it("drops stopwords but keeps numbers", () => {
    expect(tokenize("Buy Dr. Althea Melaclear Cream 20g in Nepal")).toEqual([
      "dr",
      "althea",
      "melaclear",
      "cream",
      "20g",
    ]);
  });
});

describe("searchText", () => {
  it("uses the brand when known so store search stays broad", () => {
    expect(searchText({ brand: "Dr. Althea", name: "Melaclear Cream" })).toBe("Dr. Althea");
  });

  it("uses the most distinctive name token when no brand is known", () => {
    expect(searchText({ name: "Melaclear Cream" })).toBe("melaclear");
    expect(searchText({ name: "Vitamin C Serum" })).toBe("vitamin");
  });
});

describe("normalizeCity", () => {
  it("normalizes city text for matching", () => {
    expect(normalizeCity("Kathmandu")).toBe("kathmandu");
    expect(normalizeCity(undefined)).toBe("");
  });
});

describe("normalizeQueryKey", () => {
  it("is city-independent", () => {
    const a = normalizeQueryKey({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 20, unit: "g" },
      city: "Kathmandu",
    });
    const b = normalizeQueryKey({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 20, unit: "g" },
      city: "Pokhara",
    });
    expect(a).toBe(b);
  });

  it("changes when the size changes", () => {
    const small = normalizeQueryKey({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 20, unit: "g" },
    });
    const large = normalizeQueryKey({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 50, unit: "g" },
    });
    expect(small).not.toBe(large);
  });
});

describe("looksLikeUrl", () => {
  it("detects http(s) URLs with and without a scheme", () => {
    expect(looksLikeUrl("https://bonjournp.com/product/x/")).toBe(true);
    expect(looksLikeUrl("bonjournp.com/product/x")).toBe(true);
  });

  it("rejects plain text and non-http schemes", () => {
    expect(looksLikeUrl("dr althea cream")).toBe(false);
    expect(looksLikeUrl("ftp://example.com/x")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });
});

describe("normalizeName", () => {
  it("lowercases and removes punctuation", () => {
    expect(normalizeName("Dr. Althea – Melaclear Cream!")).toBe(
      "dr althea melaclear cream",
    );
  });
});
