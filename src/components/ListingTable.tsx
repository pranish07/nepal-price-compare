import { formatNPR, formatPricePerUnit } from "@/lib/price";
import { formatSize } from "@/lib/size";
import { sortListings, type SortKey, type SortState } from "@/lib/sort";
import type { Listing } from "@/lib/types";

interface ListingTableProps {
  listings: Listing[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  highlightId?: string;
  title?: string;
  description?: string;
}

const COLUMNS: Array<{ key: SortKey | null; label: string; className?: string }> = [
  { key: "seller", label: "Seller" },
  { key: "price", label: "Price" },
  { key: "perUnit", label: "Per unit" },
  { key: null, label: "Size" },
  { key: "stock", label: "Stock" },
  { key: null, label: "Location" },
  { key: null, label: "Delivery" },
  { key: "match", label: "Match" },
  { key: "fetched", label: "Fetched at" },
  { key: null, label: "Source" },
];

function flagsFor(listing: Listing): Array<{ label: string; className: string }> {
  const flags: Array<{ label: string; className: string }> = [];
  if (listing.flags.includes("different-size")) {
    flags.push({ label: "different size", className: "bg-amber-100 text-amber-900" });
  }
  if (listing.flags.includes("size-unit-mismatch")) {
    flags.push({ label: "unit mismatch", className: "bg-amber-100 text-amber-900" });
  }
  if (listing.flags.includes("missing-price")) {
    flags.push({ label: "no price", className: "bg-neutral-200 text-neutral-700" });
  }
  if (listing.flags.includes("out-of-stock")) {
    flags.push({ label: "out of stock", className: "bg-red-100 text-red-800" });
  }
  return flags;
}

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  if (!column.key) {
    return (
      <th scope="col" className="whitespace-nowrap px-3 py-3 text-left font-semibold text-neutral-700">
        {column.label}
      </th>
    );
  }
  const key = column.key;
  const active = sort.key === key;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className="whitespace-nowrap px-3 py-3 text-left font-semibold text-neutral-700"
    >
      <button
        type="button"
        onClick={() => onSort(key)}
        className="inline-flex items-center gap-1 rounded text-left hover:text-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        {column.label}
        <span aria-hidden="true" className={active ? "text-emerald-700" : "text-neutral-400"}>
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function ListingTable({
  listings,
  sort,
  onSort,
  highlightId,
  title = "All listings",
  description = "Sort by any column. Missing data is shown as “not listed”, never estimated.",
}: ListingTableProps) {
  const sorted = sortListings(listings, sort.key, sort.dir);

  return (
    <section aria-labelledby="table-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="table-heading" className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-neutral-600">{description}</p>
        </div>
        <p className="text-xs text-neutral-500">{listings.length} listing(s)</p>
      </div>

      <div className="card mt-3 overflow-x-auto">
        <table className="min-w-[1000px] w-full border-collapse text-sm">
          <caption className="sr-only">
            Nepali seller listings with price, price per unit, stock, location, delivery, match
            score, fetch time, and a link to the seller.
          </caption>
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              {COLUMNS.map((column) => (
                <SortHeader
                  key={column.label}
                  column={column}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((listing) => {
              const flags = flagsFor(listing);
              const highlighted = listing.id === highlightId;
              return (
                <tr
                  key={listing.id}
                  className={`border-b border-neutral-100 align-top last:border-0 ${
                    highlighted ? "bg-emerald-50/70" : "bg-white"
                  }`}
                >
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-neutral-900">
                        {listing.sellerName ?? listing.sellerId}
                      </span>
                      {highlighted ? (
                        <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Cheapest
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 max-w-[220px] truncate text-xs text-neutral-500" title={listing.title}>
                      {listing.title}
                    </p>
                    {flags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {flags.map((flag) => (
                          <span
                            key={flag.label}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${flag.className}`}
                          >
                            {flag.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="font-semibold text-neutral-950">
                      {listing.price ? formatNPR(listing.price.amount) : "not listed"}
                    </span>
                    {listing.originalPrice ? (
                      <span className="ml-1 text-xs text-neutral-500 line-through">
                        {formatNPR(listing.originalPrice.amount)}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-800">
                    {formatPricePerUnit(listing.pricePerUnit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-800">
                    {formatSize(listing.size)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {listing.inStock === true ? (
                      <span className="font-medium text-emerald-800">In stock</span>
                    ) : listing.inStock === false ? (
                      <span className="font-medium text-red-700">Out of stock</span>
                    ) : (
                      <span className="text-neutral-500">not listed</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-neutral-800">{listing.location ?? "not listed"}</td>
                  <td className="max-w-[220px] px-3 py-3 text-neutral-800">
                    {listing.delivery ?? "not listed"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-800">
                    {Math.round(listing.matchScore * 100)}%
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                    <time dateTime={listing.fetchedAt}>
                      {new Date(listing.fetchedAt).toLocaleString("en-NP", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <a
                      href={listing.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="link text-sm"
                      aria-label={`View ${listing.sellerName ?? listing.sellerId} listing`}
                    >
                      View
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
