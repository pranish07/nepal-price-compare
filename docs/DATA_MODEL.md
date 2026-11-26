# DATA_MODEL.md — Nepal Price Compare

All externally visible shapes are defined with Zod in `src/lib/types.ts`. TypeScript types are
inferred from those schemas, so a runtime parse and a compile-time type cannot drift apart.

## 1. Core value objects

| Type | Fields | Notes |
| --- | --- | --- |
| `Size` | `value: number > 0`, `unit: "g" \| "ml"` | Canonical units only. `oz` is converted to `g`/`ml`; g and ml are never converted to each other. |
| `ProductQuery` | `name`, optional `brand`, `size`, `city` | `city` affects ranking only, never the cache key. |
| `Money` | `amount: number >= 0`, `currency: "NPR"` | NPR is the only supported currency. |
| `TrustSignals` | optional `authenticityStated`, `physicalPickup`, `reviews` | Booleans/count as reported by the store; absent means unknown. |

## 2. Listings

`RawListing` is what a source reported before comparison:

- `sellerId`, optional `sellerName`;
- `url` (product link) and optional `sourceUrl` (where store-level facts came from);
- `title`, optional `brand`, `size`, `price`, `originalPrice`, `inStock`, `location`, `delivery`,
  `image`, `trust`;
- `fetchedAt`: ISO timestamp of the fetch that produced the listing;
- `source`: `"adapter" | "serper" | "direct"`. `"direct"` is used by `/api/detect` previews.

`Listing` extends `RawListing` with:

- `id`: `<sellerId>:<hash of url>`;
- `matchScore`: 0–1 from the matcher;
- optional `pricePerUnit`: `{ amount, unit }`;
- `flags`: strings such as `missing-price`, `out-of-stock`, `different-size`,
  `size-unit-mismatch`;
- optional `rankScore` and `scoreBreakdown` (`price`, `stock`, `delivery`, `trust`, `total`).

**Traceability invariant:** every displayed number comes from a fetched source page. `url` plus
`fetchedAt` identifies where and when it was observed. Missing values stay `undefined` and the UI
prints "not listed"; the app never estimates a price, location, or delivery promise.

## 3. Badges

`Badge` contains `kind` (`cheapest | best_value | closest`), `listingId`, `sellerName`, `url`, and a
template-generated `reason` string. Badges are derived from listings, never stored as source data.

- `cheapest`: lowest listed NPR among exact-size, known-price, in-stock listings when available.
- `best_value`: highest rank excluding the Cheapest listing when possible.
- `closest`: city match by seller location or delivery text, preferring exact-size listings; only
  emitted when a city was supplied.

## 4. Coverage, budget, and result

`SourceReport` records `id`, `label`, `kind`, `status`, `durationMs`, `listingCount`, and optional
`errorClass`/`message`. Statuses: `ok`, `error`, `timeout`, `skipped`, `circuit_open`.

`Coverage` records `checked`, `responded`, `failed`, `listings`, and the sorted source reports.
`checked` is the number of adapters plus one Serper source, whether or not Serper was configured.

`BudgetReport` records `creditsUsed/creditsMax`, `fetchesUsed/fetchesMax`,
`cacheStatus` (`hit | miss | stale | coalesced`), `cacheHits`, and `cacheMisses`.

`SearchResult` combines `query`, `listings`, `badges`, `coverage`, `budget`, `generatedAt`,
`notes`, and `partial: true`. The literal `true` prevents accidentally claiming complete coverage.

## 5. Cache shape

`CachedSearch` stores `query`, unranked-but-matched-and-deduplicated `listings`, `coverage`,
`budget`, and `generatedAt`. City and `includeDifferentSizes` are deliberately excluded from the
cache entry so one fetch can be re-ranked per request. Cache keys are
`npc:v1:search:<normalized brand|name|size>`.

Cache hits replay listings and re-run `rankListings()` with the current city. The returned budget
reports 0 credits and 0 fetches even though the cached payload contains the original counts.

## 6. Events and detection

`PipelineEvent` is a discriminated union: `status`, `source`, `listing`, `done`, `error`. The `done`
event carries the complete `SearchResult` so a late client can ignore intermediate frames.

`/api/detect` accepts `{ input }` and returns `DetectResult`: a parsed `query`, optional raw
`preview`, `warnings`, and optional `sourceUrl`/`fetchedAt`. Text detection never fetches; URL
detection uses the same SSRF-safe fetcher and extractor as search.

## 7. Example final event payload (abridged)

```json
{
  "query": { "name": "Melaclear Cream", "brand": "Dr. Althea", "size": { "value": 20, "unit": "g" }, "city": "Kathmandu" },
  "listings": [
    {
      "id": "bonjour:1a2b3c4d",
      "sellerId": "bonjour",
      "sellerName": "Bonjour",
      "url": "https://bonjournp.com/product/dr-althea-melaclear-cream-20gm/",
      "title": "Dr. Althea Melaclear Cream 20gm",
      "price": { "amount": 2000, "currency": "NPR" },
      "size": { "value": 20, "unit": "g" },
      "fetchedAt": "2026-01-01T00:00:00.000Z",
      "source": "adapter",
      "flags": [],
      "matchScore": 1,
      "rankScore": 0.95
    }
  ],
  "badges": [],
  "coverage": { "checked": 3, "responded": 2, "failed": 0, "listings": 1, "sources": [] },
  "budget": {
    "creditsUsed": 0,
    "creditsMax": 8,
    "fetchesUsed": 2,
    "fetchesMax": 25,
    "cacheStatus": "miss",
    "cacheHits": 0,
    "cacheMisses": 1
  },
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "notes": ["Results are a partial survey..."],
  "partial": true
}
```

The values above illustrate shape only. Real searches must be verified against the source URLs
returned in each listing.
