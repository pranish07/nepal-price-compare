# KNOWN_LIMITATIONS.md — Nepal Price Compare

This file is intentionally blunt. It describes what the current build does not prove or does not do.

## Coverage and data freshness

- Only two stores have built-in adapters: Bonjour and Beauty Essentials. Serper can surface other
  stores only when a key is configured and a candidate page can be parsed generically.
- Results are a **partial survey**, never a complete market comparison. Every `SearchResult` is
  marked `partial: true`.
- Prices and stock are snapshots at `fetchedAt`. They can change immediately after a fetch.
- Fixtures are saved real HTML from a point in time. They prove parser behavior, not that a live
  store still returns the same markup.
- No login-walled, app-only, image-based, or location-gated inventory is accessible.

## Unverified external behavior

- **Serper `num > 10` is unverified.** There is no `SERPER_API_KEY` in the development environment.
  Production code always sends `num: 10`. `npm run verify:serper -- "query" --num=20` is provided to
  check the behavior manually; it spends credits when a key is set.
- p50 first result < 3 s and p95 complete < 15 s are **design targets**, not load-test results.
  Real latency depends on third-party store speed, DNS, network, and Serper availability. The SSE
  design improves perceived speed but cannot guarantee those percentiles.
- Vercel Hobby streaming behavior was reasoned about from the documented 60 s function limit; no
  deployment-level performance test was run.

## Matching and ranking

- Matching is a weighted token/brand/size heuristic with threshold `0.55`. It can reject valid
  products with unusual titles or accept unrelated products with overlapping tokens.
- Generic tokens carry only 0.25 weight, but this is still a heuristic, not catalog-grade identity.
- Price-per-unit is computed only within a unit family. g and ml are never converted.
- Ranking treats missing stock, delivery, or trust data as neutral (0.5), not as evidence of poor
  quality. Missing prices are shown as "not listed" and excluded from Cheapest.
- "Closest" uses text mentions of the requested city in location or delivery fields. It is not a
  distance calculation.
- Badge reasons are generated templates, not store-authored claims.

## Cost and shared state

- The default cache, rate limits, and daily Serper ledger are **per process**. On serverless with
  multiple instances, a user may get a fresh bucket on another instance. Upstash variables should
  be set for production-grade shared limits.
- Rate limiting uses `x-forwarded-for`/`x-real-ip`. If those headers are not trustworthy in a given
  deployment, the effective limit can be bypassed or misapplied.
- The 8-credit cap applies per uncached search. A stale cache hit triggers background revalidation,
  which may spend credits again, though it is single-flighted per key.
- The daily ceiling fails closed for Serper discovery only; adapter results still stream.

## Image OCR

- OCR is English-only (`eng`). Nepali-language labels are not recognised.
- Tesseract.js can misread small text, stylised fonts, glare, or angled photos. The confirmation
  step is required; OCR output is never treated as a verified product identity.
- OCR can still return wrong text. It is shown in the editable confirmation step rather than being
  auto-accepted; manual entry is always available.
- Canvas preprocessing helps small or low-contrast labels but cannot recover text that is out of
  focus, heavily rotated, or not visible in the photo.
- The first OCR loads the WASM core and language data from jsDelivr (about several MB) and relies on
  browser caching thereafter. This uses no paid API but does require network access.
- File validation accepts common browser image types up to 8 MB. HEIC and unsupported formats are
  rejected rather than silently transcodes.
- The browser worker/CSP path was built and the assets/header were checked locally, but no automated
  browser test exercised drag-and-drop, IndexedDB caching, or a real camera photo.

## Security boundary

- URLs are validated by resolving DNS and pinning the connection to a checked IP. This greatly
  reduces ordinary SSRF risk but is not a guarantee against every DNS-rebinding or malicious-TLS
  scenario. There is no certificate pinning.
- Only ports 80/443 and HTML content types are accepted. Redirects are revalidated up to 3 hops.
- Serper response links and candidate pages are untrusted input and pass through the same fetcher,
  but a compromised store can still serve misleading content. Verify prices on the seller site.

## UX and scope

- V1 is skincare/beauty, Nepal, and NPR only. No accounts, price history, alerts, or efficacy/safety
  claims.
- Top-3 cards are a convenience view; the full table is the authoritative comparison.
- Accessibility follows semantic HTML basics (labels, roles, keyboard-operable controls). A full
  screen-reader or WCAG audit has not been performed.
- No automated browser test verifies visual layout on real devices.

## Operational

- Store markup or RSC payload changes can break an adapter silently; coverage will report an error
  or zero listings rather than inventing data.
- `npm test` uses local fixtures and HTTP/DNS fakes. It does not call live stores or Serper.
- The Serper verification script prints response shape only and never prints the API key, but its
  output should still be handled normally because it reveals query/host information.
