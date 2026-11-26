import { describe, expect, it } from "vitest";
import {
  computePricePerUnit,
  formatNPR,
  formatPricePerUnit,
  parsePrice,
} from "./price";

describe("parsePrice", () => {
  it("parses the common Nepali formats", () => {
    expect(parsePrice("Rs. 2,000.00")).toBe(2000);
    expect(parsePrice("NPR 2,700")).toBe(2700);
    expect(parsePrice("रू 1,800")).toBe(1800);
    expect(parsePrice("₨ 3,000")).toBe(3000);
    expect(parsePrice("₹ 999")).toBe(999);
  });

  it("parses a bare number", () => {
    expect(parsePrice("2000")).toBe(2000);
    expect(parsePrice("1,234.50")).toBe(1234.5);
  });

  it("returns null when there is no usable number", () => {
    expect(parsePrice("Free delivery")).toBeNull();
    expect(parsePrice("Out of stock")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });

  it("rejects numbers outside the sane range", () => {
    expect(parsePrice("99999999")).toBeNull();
  });
});

describe("formatNPR", () => {
  it("omits decimals for whole rupees", () => {
    expect(formatNPR(2000)).toBe("NPR 2,000");
  });

  it("keeps two decimals for paisa", () => {
    expect(formatNPR(1999.5)).toBe("NPR 1,999.50");
  });
});

describe("price per unit", () => {
  it("computes price per gram and per millilitre", () => {
    expect(computePricePerUnit(2700, { value: 20, unit: "g" })).toEqual({
      amount: 135,
      unit: "g",
    });
    expect(computePricePerUnit(2000, { value: 30, unit: "ml" })).toEqual({
      amount: 66.67,
      unit: "ml",
    });
  });

  it("returns undefined without a size", () => {
    expect(computePricePerUnit(2000, undefined)).toBeUndefined();
    expect(computePricePerUnit(2000, { value: 0, unit: "g" })).toBeUndefined();
  });

  it("formats missing and present values honestly", () => {
    expect(formatPricePerUnit(undefined)).toBe("not listed");
    expect(formatPricePerUnit({ amount: 135, unit: "g" })).toBe("NPR 135.00/g");
  });
});
