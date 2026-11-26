import { isDifferentSize } from "./match";
import { normalizeCity } from "./normalize";
import { formatNPR, formatPricePerUnit } from "./price";
import { formatSize } from "./size";
import type {
  Badge,
  Listing,
  ProductQuery,
  ScoreBreakdown,
} from "./types";

export const RANK_WEIGHTS = {
  price: 0.5,
  stock: 0.2,
  delivery: 0.15,
  trust: 0.15,
} as const;

export interface RankOptions {
  city?: string;
  includeDifferentSizes?: boolean;
}

export interface RankResult {
  listings: Listing[];
  badges: Badge[];
  notes: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function priceScore(price: number | undefined, minPrice: number | undefined): number {
  if (price === undefined || minPrice === undefined) return 0.5;
  if (price <= 0) return 1;
  return clamp01(minPrice / price);
}

function stockScore(inStock: boolean | undefined): number {
  if (inStock === undefined) return 0.5;
  return inStock ? 1 : 0.1;
}

function mentionsCity(text: string | undefined, city: string): boolean {
  if (!text || !city) return false;
  const normalized = ` ${normalizeCity(text)} `;
  return normalized.includes(` ${city} `);
}

function deliveryScore(listing: Listing, city: string | undefined): number {
  if (!city) return 0.5;
  if (mentionsCity(listing.location, city)) return 1;
  const delivery = listing.delivery ?? "";
  if (/\b(not|no)\b.{0,20}deliver/i.test(delivery) && mentionsCity(delivery, city)) return 0;
  if (mentionsCity(delivery, city)) return 1;
  if (/(across|all|anywhere in|nationwide).{0,20}nepal|nepal.{0,20}(nationwide|delivery)/i.test(delivery)) {
    return 1;
  }
  return 0.5;
}

function trustScore(listing: Listing): number {
  const signals = listing.trust;
  if (!signals) return 0.5;
  const values: number[] = [];
  if (signals.authenticityStated !== undefined) values.push(signals.authenticityStated ? 1 : 0);
  if (signals.physicalPickup !== undefined) values.push(signals.physicalPickup ? 1 : 0);
  if (signals.reviews !== undefined) values.push(signals.reviews > 0 ? 1 : 0);
  if (values.length === 0) return 0.5;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function withScores(
  listings: Listing[],
  city: string | undefined,
): { listing: Listing; breakdown: Omit<ScoreBreakdown, "total"> }[] {
  const prices = listings
    .map((listing) => listing.price?.amount)
    .filter((price): price is number => price !== undefined);
  const minPrice = prices.length > 0 ? Math.min(...prices) : undefined;

  return listings.map((listing) => {
    const breakdown: Omit<ScoreBreakdown, "total"> = {
      price: priceScore(listing.price?.amount, minPrice),
      stock: stockScore(listing.inStock),
      delivery: deliveryScore(listing, city),
      trust: trustScore(listing),
    };
    const total =
      RANK_WEIGHTS.price * breakdown.price +
      RANK_WEIGHTS.stock * breakdown.stock +
      RANK_WEIGHTS.delivery * breakdown.delivery +
      RANK_WEIGHTS.trust * breakdown.trust;
    return {
      listing: {
        ...listing,
        rankScore: Math.round(total * 1000) / 1000,
        scoreBreakdown: {
          ...breakdown,
          total: Math.round(total * 1000) / 1000,
        },
      },
      breakdown,
    };
  });
}

function cheapestPool(listings: Listing[], includeDifferentSizes: boolean): Listing[] {
  const priced = listings.filter((listing) => listing.price !== undefined);
  const exact = priced.filter(
    (listing) => includeDifferentSizes || !isDifferentSize(listing),
  );
  const pool = exact.length > 0 ? exact : priced;
  const inStock = pool.filter((listing) => listing.inStock !== false);
  return inStock.length > 0 ? inStock : pool;
}

function valuePool(listings: Listing[], includeDifferentSizes: boolean): Listing[] {
  const priced = listings.filter((listing) => listing.price !== undefined);
  const exact = priced.filter(
    (listing) => includeDifferentSizes || !isDifferentSize(listing),
  );
  const pool = exact.length > 0 ? exact : priced;
  const inStock = pool.filter((listing) => listing.inStock !== false);
  return inStock.length > 0 ? inStock : pool;
}

function sizeLabel(listing: Listing): string {
  return listing.size ? formatSize(listing.size) : "";
}

function cheapestReason(listing: Listing): string {
  const size = sizeLabel(listing);
  const price = listing.price ? formatNPR(listing.price.amount) : "not listed";
  return size
    ? `Lowest listed price for the same ${size} size at ${price}.`
    : `Lowest listed price at ${price}; size was not listed.`;
}

function valueReason(listing: Listing): string {
  const price = listing.price ? formatNPR(listing.price.amount) : "not listed";
  const perUnit = listing.pricePerUnit
    ? ` (${formatPricePerUnit(listing.pricePerUnit)})`
    : "";
  const stock = listing.inStock === true ? ", in stock" : "";
  const delivery = listing.delivery ? `, ${listing.delivery}` : "";
  return `Best overall balance: ${price}${perUnit}${stock}${delivery}.`;
}

function closestReason(listing: Listing, city: string, cityLabel: string): string {
  if (mentionsCity(listing.location, city)) {
    return `Seller location matches ${cityLabel}${listing.price ? ` at ${formatNPR(listing.price.amount)}` : ""}.`;
  }
  return `Delivers to ${cityLabel}${listing.price ? ` at ${formatNPR(listing.price.amount)}` : ""}.`;
}

function badge(kind: Badge["kind"], listing: Listing, reason: string): Badge {
  return {
    kind,
    listingId: listing.id,
    sellerName: listing.sellerName ?? listing.sellerId,
    url: listing.url,
    reason,
  };
}

/**
 * Pure ranking function. Missing signals are neutral; they are never treated as
 * negative evidence. All weights live in RANK_WEIGHTS.
 */
export function rankListings(
  input: Listing[],
  query: ProductQuery,
  options: RankOptions = {},
): RankResult {
  const requestedCity = (options.city ?? query.city)?.trim() ?? "";
  const city = normalizeCity(requestedCity);
  const cityLabel = requestedCity || city;
  const includeDifferentSizes = options.includeDifferentSizes ?? false;
  const scored = withScores(input, city);
  const ranked = scored
    .map((entry) => entry.listing)
    .sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));

  const badges: Badge[] = [];
  const notes: string[] = [];

  const cheapestCandidates = cheapestPool(ranked, includeDifferentSizes).sort(
    (a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity),
  );
  const cheapest = cheapestCandidates[0];
  if (cheapest) {
    badges.push(badge("cheapest", cheapest, cheapestReason(cheapest)));
    if (isDifferentSize(cheapest)) {
      notes.push("The cheapest listing has a different size; verify the unit before comparing.");
    }
  }

  const valueCandidates = valuePool(ranked, includeDifferentSizes).sort(
    (a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0),
  );
  const bestValue =
    valueCandidates.find((listing) => listing.id !== cheapest?.id) ?? valueCandidates[0];
  if (bestValue) {
    badges.push(badge("best_value", bestValue, valueReason(bestValue)));
  }

  if (city) {
    const locationMatches = ranked.filter(
      (listing) =>
        mentionsCity(listing.location, city) || mentionsCity(listing.delivery, city),
    );
    // Prefer the same size for "Closest" too; a different-size listing is only
    // used as a fallback so the badge never implies an exact product match.
    const exactLocationMatches = locationMatches.filter(
      (listing) => includeDifferentSizes || !isDifferentSize(listing),
    );
    const closestCandidates = (
      exactLocationMatches.length > 0 ? exactLocationMatches : locationMatches
    ).sort((a, b) => {
      const locationA = mentionsCity(a.location, city) ? 0 : 1;
      const locationB = mentionsCity(b.location, city) ? 0 : 1;
      if (locationA !== locationB) return locationA - locationB;
      return (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity);
    });
    const closest =
      closestCandidates.find((listing) => listing.id !== cheapest?.id) ?? closestCandidates[0];
    if (closest) {
      badges.push(badge("closest", closest, closestReason(closest, city, cityLabel)));
    } else {
      notes.push(`No seller listed a location or delivery option matching ${cityLabel}.`);
    }
  }

  if (ranked.length === 0) {
    notes.push("No exact matches found. Try a different size, or paste a store link.");
  }

  return { listings: ranked, badges, notes };
}
