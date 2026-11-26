import { describe, expect, it } from "vitest";
import {
  formatSize,
  parseSize,
  sameSizeFamily,
  sizeRatio,
  sizesMatch,
  stripSize,
} from "./size";

describe("parseSize", () => {
  it("parses a compact mass size", () => {
    const size = parseSize("Dr. Althea Melaclear Cream 20g");
    expect(size).toMatchObject({ value: 20, unit: "g", family: "mass", raw: "20g" });
  });

  it("accepts a space, uppercase unit, and comma decimal", () => {
    expect(parseSize("20 g")).toMatchObject({ value: 20, unit: "g" });
    expect(parseSize("20GM")).toMatchObject({ value: 20, unit: "g" });
    expect(parseSize("0,7 oz")).toMatchObject({ value: 19.845, unit: "g" });
  });

  it("converts ounces to grams and fluid ounces to millilitres", () => {
    expect(parseSize("0.7 oz")).toMatchObject({ value: 19.845, unit: "g", family: "mass" });
    expect(parseSize("1.01fl oz")).toMatchObject({
      value: 29.869,
      unit: "ml",
      family: "volume",
    });
  });

  it("parses millilitres", () => {
    expect(parseSize("100 ml")).toMatchObject({ value: 100, unit: "ml", family: "volume" });
    expect(parseSize("50ML")).toMatchObject({ value: 50, unit: "ml" });
  });

  it("never converts between mass and volume", () => {
    expect(parseSize("20g")?.unit).toBe("g");
    expect(parseSize("20ml")?.unit).toBe("ml");
  });

  it("ignores numbers without a unit", () => {
    expect(parseSize("SPF 50")).toBeNull();
    expect(parseSize("345 Relief Cream")).toBeNull();
    expect(parseSize("")).toBeNull();
    expect(parseSize(undefined)).toBeNull();
  });

  it("rejects impossible values", () => {
    expect(parseSize("0 g")).toBeNull();
    expect(parseSize("200000 g")).toBeNull();
  });
});

describe("formatSize", () => {
  it("shows missing sizes honestly", () => {
    expect(formatSize(undefined)).toBe("not listed");
    expect(formatSize(null)).toBe("not listed");
  });

  it("formats integers and rounds decimals", () => {
    expect(formatSize({ value: 20, unit: "g" })).toBe("20 g");
    expect(formatSize({ value: 19.845, unit: "g" })).toBe("19.85 g");
  });
});

describe("size comparison", () => {
  it("only compares the same family", () => {
    expect(sameSizeFamily({ value: 20, unit: "g" }, { value: 20, unit: "ml" })).toBe(false);
    expect(sizeRatio({ value: 20, unit: "g" }, { value: 20, unit: "ml" })).toBe(Infinity);
  });

  it("computes a ratio that is always >= 1", () => {
    expect(sizeRatio({ value: 20, unit: "g" }, { value: 50, unit: "g" })).toBe(2.5);
    expect(sizeRatio({ value: 50, unit: "g" }, { value: 20, unit: "g" })).toBe(2.5);
  });

  it("treats sizes within the tolerance as matching", () => {
    expect(sizesMatch({ value: 20, unit: "g" }, { value: 20, unit: "g" })).toBe(true);
    expect(sizesMatch({ value: 20, unit: "g" }, { value: 21, unit: "g" })).toBe(true);
    expect(sizesMatch({ value: 20, unit: "g" }, { value: 25, unit: "g" })).toBe(false);
  });
});

describe("stripSize", () => {
  it("removes every size token and collapses whitespace", () => {
    expect(stripSize("Dr. Althea Melaclear Cream 20g")).toBe("Dr. Althea Melaclear Cream");
    expect(stripSize("Toner 100 ml refill")).toBe("Toner refill");
  });
});
