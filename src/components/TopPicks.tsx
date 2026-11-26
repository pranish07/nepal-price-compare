import { formatNPR, formatPricePerUnit } from "@/lib/price";
import { formatSize } from "@/lib/size";
import type { Badge, Listing } from "@/lib/types";

const BADGE_META = {
  cheapest: {
    label: "Cheapest",
    blurb: "Lowest listed price",
    className: "border-emerald-300 bg-emerald-50",
    labelClass: "text-emerald-900",
  },
  best_value: {
    label: "Best value",
    blurb: "Price, stock, delivery, trust",
    className: "border-sky-300 bg-sky-50",
    labelClass: "text-sky-900",
  },
  closest: {
    label: "Closest to you",
    blurb: "Location or delivery match",
    className: "border-violet-300 bg-violet-50",
    labelClass: "text-violet-900",
  },
} as const;

interface TopPicksProps {
  badges: Badge[];
  listings: Listing[];
  city?: string;
}

export function TopPicks({ badges, listings, city }: TopPicksProps) {
  const byId = new Map(listings.map((listing) => [listing.id, listing]));

  return (
    <section aria-labelledby="picks-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="picks-heading" className="text-xl font-semibold tracking-tight">
            Top picks
          </h2>
          <p className="text-sm text-neutral-600">
            {city ? `Ranked with ${city} selected for delivery.` : "Add a city to rank delivery fit."}
          </p>
        </div>
        <p className="text-xs text-neutral-500">Every pick links to the seller page.</p>
      </div>

      {badges.length === 0 ? (
        <div className="card mt-3 p-5 text-sm text-neutral-600">
          No picks are available because no listing had a usable price. The table below still shows
          what each seller listed.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((badge) => {
            const listing = byId.get(badge.listingId);
            if (!listing) return null;
            const meta = BADGE_META[badge.kind];
            const differentSize = listing.flags.includes("different-size") || listing.flags.includes("size-unit-mismatch");
            return (
              <article key={badge.kind} className={`rounded-2xl border p-4 shadow-sm ${meta.className}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`text-sm font-bold uppercase tracking-wide ${meta.labelClass}`}>
                    {meta.label}
                  </h3>
                  <span className="text-[11px] font-medium text-neutral-600">{meta.blurb}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-neutral-900">{badge.sellerName}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-neutral-950">
                  {listing.price ? formatNPR(listing.price.amount) : "not listed"}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-700">
                  <div>
                    <dt className="text-neutral-500">Per unit</dt>
                    <dd className="font-medium">{formatPricePerUnit(listing.pricePerUnit)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Size</dt>
                    <dd className="font-medium">{formatSize(listing.size)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Stock</dt>
                    <dd className="font-medium">
                      {listing.inStock === true ? "In stock" : listing.inStock === false ? "Out of stock" : "not listed"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Location</dt>
                    <dd className="font-medium">{listing.location ?? "not listed"}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm text-neutral-800">{badge.reason}</p>
                {differentSize ? (
                  <p className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                    Different size — not used for Cheapest
                  </p>
                ) : null}
                <a
                  href={badge.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="link mt-3 inline-block text-sm"
                >
                  View at seller
                </a>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
