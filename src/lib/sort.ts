import type { Listing } from "./types";

export type SortKey =
  | "rank"
  | "seller"
  | "price"
  | "perUnit"
  | "stock"
  | "match"
  | "fetched";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDirection;
}

function valueFor(listing: Listing, key: SortKey): number | string | undefined {
  switch (key) {
    case "rank":
      return listing.rankScore;
    case "seller":
      return (listing.sellerName ?? listing.sellerId).toLowerCase();
    case "price":
      return listing.price?.amount;
    case "perUnit":
      return listing.pricePerUnit?.amount;
    case "stock":
      return listing.inStock === undefined ? undefined : listing.inStock ? 1 : 0;
    case "match":
      return listing.matchScore;
    case "fetched":
      return new Date(listing.fetchedAt).getTime();
    default:
      return undefined;
  }
}

/** Missing values always sort last, regardless of direction. */
export function sortListings(
  listings: Listing[],
  key: SortKey,
  direction: SortDirection,
): Listing[] {
  const sorted = [...listings].sort((a, b) => {
    const aValue = valueFor(a, key);
    const bValue = valueFor(b, key);
    if (aValue === undefined && bValue === undefined) return 0;
    if (aValue === undefined) return 1;
    if (bValue === undefined) return -1;
    const comparison =
      typeof aValue === "string" && typeof bValue === "string"
        ? aValue.localeCompare(bValue)
        : Number(aValue) - Number(bValue);
    return direction === "asc" ? comparison : -comparison;
  });
  return sorted;
}
