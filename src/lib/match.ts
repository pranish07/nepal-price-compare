import { CONFIG } from "./config";
import { GENERIC_TOKENS, normalizeBrand, normalizeName, tokenize } from "./normalize";
import { computePricePerUnit } from "./price";
import { sameSizeFamily, sizeRatio } from "./size";
import type { Listing, ProductQuery, RawListing } from "./types";

export interface MatchOptions {
  threshold?: number;
  sizeTolerance?: number;
}

export interface MatchOutcome {
  score: number;
  flags: string[];
  tokenCoverage: number;
  brandSignal: number;
  sizeSignal: number;
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function targetTokensFor(query: ProductQuery): string[] {
  const brandTokens = new Set(tokenize(query.brand ?? ""));
  const nameTokens = tokenize(query.name).filter((token) => !brandTokens.has(token));
  return uniqueTokens(nameTokens.length > 0 ? nameTokens : tokenize(query.name));
}

function weightedCoverage(targetTokens: string[], candidateTokens: Set<string>): number {
  let total = 0;
  let covered = 0;
  for (const token of targetTokens) {
    const weight = GENERIC_TOKENS.has(token) ? 0.25 : 1;
    total += weight;
    if (candidateTokens.has(token)) covered += weight;
  }
  return total === 0 ? 0 : covered / total;
}

function brandSignalFor(query: ProductQuery, listing: RawListing): number {
  if (!query.brand) return 0.5;
  const targetBrand = normalizeBrand(query.brand);
  const candidateBrand = listing.brand ? normalizeBrand(listing.brand) : "";
  if (candidateBrand && candidateBrand === targetBrand) return 1;
  if (candidateBrand && candidateBrand !== targetBrand) return 0.1;
  const candidateText = ` ${normalizeName(listing.title)} `;
  if (candidateText.includes(` ${targetBrand} `)) return 1;
  return 0.5;
}

function sizeSignalFor(
  query: ProductQuery,
  listing: RawListing,
  tolerance: number,
): { signal: number; flags: string[] } {
  if (!query.size || !listing.size) return { signal: 0.5, flags: [] };
  if (!sameSizeFamily(query.size, listing.size)) {
    return { signal: 0.3, flags: ["size-unit-mismatch"] };
  }
  if (sizeRatio(query.size, listing.size) <= 1 + tolerance) {
    return { signal: 1, flags: [] };
  }
  return { signal: 0.1, flags: ["different-size"] };
}

/**
 * Scores a candidate against the target. Returns null when the candidate is
 * clearly a different product. A size mismatch is kept and flagged; it is
 * excluded from "Cheapest" later unless the caller opts in.
 */
export function matchListing(
  query: ProductQuery,
  listing: RawListing,
  options: MatchOptions = {},
): MatchOutcome | null {
  const threshold = options.threshold ?? CONFIG.matchThreshold;
  const tolerance = options.sizeTolerance ?? CONFIG.sizeTolerance;

  const targetTokens = targetTokensFor(query);
  const candidateTokens = new Set(tokenize(`${listing.title} ${listing.brand ?? ""}`));
  const tokenCoverage = weightedCoverage(targetTokens, candidateTokens);

  if (tokenCoverage < 0.4) return null;

  const brandSignal = brandSignalFor(query, listing);
  if (query.brand && brandSignal < 0.3) return null;

  const { signal: sizeSignal, flags } = sizeSignalFor(query, listing, tolerance);
  const score =
    0.45 * tokenCoverage + 0.35 * brandSignal + 0.2 * sizeSignal;

  if (score < threshold) return null;

  if (!listing.price) flags.push("missing-price");
  if (listing.inStock === false) flags.push("out-of-stock");

  return {
    score: Math.round(score * 1000) / 1000,
    flags,
    tokenCoverage,
    brandSignal,
    sizeSignal,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function listingId(listing: Pick<RawListing, "sellerId" | "url">): string {
  return `${listing.sellerId}:${hashString(listing.url)}`;
}

export function toListing(
  raw: RawListing,
  outcome: MatchOutcome,
): Listing {
  return {
    ...raw,
    id: listingId(raw),
    matchScore: outcome.score,
    pricePerUnit:
      raw.price && raw.size ? computePricePerUnit(raw.price.amount, raw.size) : undefined,
    flags: outcome.flags,
  };
}

export function matchAndBuild(
  query: ProductQuery,
  raw: RawListing,
  options?: MatchOptions,
): Listing | null {
  const outcome = matchListing(query, raw, options);
  return outcome ? toListing(raw, outcome) : null;
}

function prefer(a: Listing, b: Listing): Listing {
  if (a.matchScore !== b.matchScore) return a.matchScore > b.matchScore ? a : b;
  const aPrice = a.price?.amount ?? Number.POSITIVE_INFINITY;
  const bPrice = b.price?.amount ?? Number.POSITIVE_INFINITY;
  return aPrice <= bPrice ? a : b;
}

/** One listing per seller domain, keeping the best match then the lowest price. */
export function dedupeBySeller(listings: Listing[]): Listing[] {
  const bySeller = new Map<string, Listing>();
  for (const listing of listings) {
    const existing = bySeller.get(listing.sellerId);
    bySeller.set(listing.sellerId, existing ? prefer(existing, listing) : listing);
  }
  return [...bySeller.values()];
}

export function isDifferentSize(listing: Listing): boolean {
  return listing.flags.includes("different-size") || listing.flags.includes("size-unit-mismatch");
}
