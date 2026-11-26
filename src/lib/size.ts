import type { Size, SizeUnit } from "./types";

export type SizeFamily = "mass" | "volume";

export interface ParsedSize extends Size {
  family: SizeFamily;
  /** The exact substring that was parsed, for debugging and tests. */
  raw: string;
}

const OUNCE_GRAMS = 28.349523125;
const FLUID_OUNCE_ML = 29.5735295625;

/**
 * Matches `20g`, `20 g`, `20GM`, `0.7 oz`, `1.01fl oz`, `100 ml`.
 * Deliberately requires a unit so that `SPF 50` and model numbers are ignored.
 */
export const SIZE_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|fluid\s*ounces?|oz|ounces?|ml|millilit(?:er|re)s?|g|gm|gms|grams?)\b/i;

export const SIZE_GLOBAL_PATTERN = new RegExp(SIZE_PATTERN.source, "gi");

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function canonicalUnit(rawUnit: string): { unit: SizeUnit; family: SizeFamily; factor: number } {
  const u = rawUnit.toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (u === "oz" || u === "ounce" || u === "ounces") {
    return { unit: "g", family: "mass", factor: OUNCE_GRAMS };
  }
  if (u.startsWith("floz") || u.startsWith("fluidounce")) {
    return { unit: "ml", family: "volume", factor: FLUID_OUNCE_ML };
  }
  if (u === "ml" || u.startsWith("millilit")) {
    return { unit: "ml", family: "volume", factor: 1 };
  }
  return { unit: "g", family: "mass", factor: 1 };
}

export function parseSize(input: string | undefined | null): ParsedSize | null {
  if (!input) return null;
  const match = SIZE_PATTERN.exec(input);
  if (!match) return null;
  const rawValue = match[1];
  const rawUnit = match[2];
  if (!rawValue || !rawUnit) return null;

  const value = Number.parseFloat(rawValue.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return null;

  const { unit, family, factor } = canonicalUnit(rawUnit);
  return {
    value: round(value * factor),
    unit,
    family,
    raw: match[0],
  };
}

export function formatSize(size: Size | undefined | null): string {
  if (!size) return "not listed";
  const value = Number.isInteger(size.value)
    ? String(size.value)
    : String(Math.round(size.value * 100) / 100);
  return `${value} ${size.unit}`;
}

export function sameSizeFamily(a: Size, b: Size): boolean {
  return a.unit === b.unit;
}

/** Ratio of the two values in the same family; always >= 1. */
export function sizeRatio(a: Size, b: Size): number {
  if (a.unit !== b.unit) return Number.POSITIVE_INFINITY;
  const smaller = Math.min(a.value, b.value);
  const larger = Math.max(a.value, b.value);
  return smaller === 0 ? Number.POSITIVE_INFINITY : larger / smaller;
}

export function sizesMatch(a: Size, b: Size, tolerance = 0.05): boolean {
  if (a.unit !== b.unit) return false;
  return sizeRatio(a, b) <= 1 + tolerance;
}

export function stripSize(text: string): string {
  return text.replace(SIZE_GLOBAL_PATTERN, " ").replace(/\s+/g, " ").trim();
}
