import type { PricePerUnit, Size } from "./types";

const CURRENCY_NOISE = /(?:npr|rs\.?|inr|रू|₨|₹|\$|usd)/gi;

/**
 * Parses a price from seller text. Returns null when no sensible number is
 * present. Nepali stores overwhelmingly use `Rs. 2,000.00` / `NPR 2,000`.
 */
export function parsePrice(input: string | undefined | null): number | null {
  if (!input) return null;
  const cleaned = input.replace(CURRENCY_NOISE, " ").replace(/\s+/g, " ").trim();
  const match = /-?\d[\d,]*(?:\.\d{1,2})?/.exec(cleaned);
  if (!match) return null;
  const raw = match[0];
  const normalized = raw.includes(",")
    ? raw.replace(/,/g, "")
    : raw;
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return null;
  return Math.round(value * 100) / 100;
}

export function formatNPR(amount: number): string {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return `NPR ${amount.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function computePricePerUnit(price: number, size: Size | undefined): PricePerUnit | undefined {
  if (!size || size.value <= 0 || price < 0) return undefined;
  return {
    amount: Math.round((price / size.value) * 100) / 100,
    unit: size.unit,
  };
}

export function formatPricePerUnit(ppu: PricePerUnit | undefined): string {
  if (!ppu) return "not listed";
  return `NPR ${ppu.amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}/${ppu.unit}`;
}
