# EVIDENCE.md — M0–M6 verification record

Date: 2026-11-26. Environment: local Windows, Node v25.1.0, Next.js 16.4.6, Vitest 4.1.12.
Everything below was actually run. Commands are reproducible from the repository root unless stated
otherwise. No Serper key was present, so no Serper credits were spent.

Milestone labels map to the project's delivery themes: M0 feasibility, M1 extraction, M2 matching,
M3 safety/cost controls, M4 streaming/UI, M5 tests/CI/docs, M6 end-to-end smoke.

## M0 — Feasibility and robots compliance

Evidence: `SPIKES.md` and raw captures in `spikes/`.

- Bonjour `/wp-json/` is disallowed by `robots.txt`; it was not used.
- Bonjour `/shop/?s=dr+althea` returned 200 with 14 product URLs in the spike capture.
- Beauty `/shop?search=dr+althea` returned 200 with 17 products in the saved RSC payload.
- Serper `num > 10` remains **unverified** because no key exists. This is not claimed as passing.

Additional live discovery check from `SPIKES.md` §6:

| Store | Full detected name | Broad term |
| --- | --- | --- |
| Bonjour | 6 unrelated cards | `dr althea` → 11 cards including the target |
| Beauty Essentials | 0 payload products | `dr althea` → 17 products including the target |

This produced decision D21: store search uses the brand alone when known.

## M1 — Extraction from real pages

Evidence: `src/test/fixtures/*.html`, `src/lib/extract/extract.test.ts`,
`src/lib/adapters/adapters.test.ts`.

- Bonjour product fixture: `Melaclear Cream`, brand `Dr. Althea`, size 20 g, NPR 2,000,
  original NPR 3,000, in stock.
- Bonjour search fixture: 11 cards parsed, including the target.
- Beauty fixture: 17 products parsed; target has NPR 2,700, original NPR 3,000, 20 g,
  brand `Dr. Althea`, location `Dharan, Sunsari, Nepal`, and three delivery statements.
- Live `/api/detect` URL preview (see M6) confirmed the Bonjour parser against the current site.

JSON-LD, DOM metadata, and RSC extraction are all covered by tests. Missing fields stay undefined.

## M2 — Matching, ranking, and badges

Evidence: `src/lib/match.test.ts`, `src/lib/rank.test.ts`, `src/lib/sort.test.ts`,
`src/lib/size.test.ts`, `src/lib/price.test.ts`, and the M6 search result.

- Match threshold is 0.55; generic tokens have weight 0.25.
- Different-size and unit-family mismatches are kept with flags and excluded from Cheapest by
  default.
- Ranking weights are price 0.50, stock 0.20, delivery 0.15, trust 0.15; missing signals are
  neutral.
- Live search produced two exact-size listings and generated `cheapest` and `best_value` badges.
  No `closest` badge was generated for Kathmandu because neither listing claimed Kathmandu
  location/delivery; the note said so explicitly.

## M3 — Safety and cost controls

Evidence: `src/lib/ssrf.test.ts`, `src/lib/http.test.ts`, `src/lib/budget.test.ts`,
`src/lib/cache.test.ts`, `src/lib/rate-limit.test.ts`, `src/lib/serper.test.ts`, and M6 smoke calls.

- SSRF tests cover private/loopback/link-local/metadata hosts, IPv6, IPv4-mapped addresses,
  unsupported ports/protocols, credentials, and redirect revalidation.
- Live `POST /api/detect` with `http://127.0.0.1:3000/api/health` returned HTTP 400.
- Credit budget caps an uncached search at 8; daily ledger and per-request budget charge before each
  Serper call.
- Cache is 6 h fresh / 24 h stale with single-flight; empty results use 10 min.
- `/api/health` reported `serperConfigured: false`, `kvConfigured: false`, `cacheMode: "memory"`.
- `npm run verify:serper -- "Dr. Althea Melaclear Cream Nepal" --num=20` printed:
  `SERPER_API_KEY is not set. Skipping without spending credits.` Exit code 0.

## M4 — Streaming API and UI

Evidence: `src/lib/sse.test.ts`, `src/lib/pipeline.test.ts`, `src/components/SearchApp.tsx`, and M6
SSE capture.

- `/api/search` returned `text/event-stream; charset=utf-8`.
- Uncached event order: `status, source, listing, source, listing, source, done`.
- Cached event order: `status, listing, listing, done` (no source work).
- `done` is always sent and carries coverage and budget.
- `GET /` returned `<title>Nepal Price Compare — skincare prices from Nepali sellers</title>` and the
  "Paste a product link" UI copy.
- Streamed listings are rendered in a live table while the search is running; badges appear on
  `done`.

## M5 — Tests, CI, and documentation

Commands and observed results:

```text
$ npm run typecheck
> tsc --noEmit
(no output; exit 0)

$ npm run lint
> eslint .
(no output; exit 0)

$ npm test
Test Files  18 passed (18)
Tests       162 passed (162)
Duration    ~13 s
```

Vitest prints a non-fatal config-loader warning about `vitest.config.ts` ESM syntax. The tests pass.

```text
$ npm run build
✓ Compiled successfully
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/detect
├ ƒ /api/health
└ ƒ /api/search
```

Documentation present: `README.md`, `DESIGN.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`,
`DECISIONS.md`, `KNOWN_LIMITATIONS.md`, `SPIKES.md`, `EVIDENCE.md`, `.env.example`.
CI: `.github/workflows/ci.yml` runs `npm ci`, typecheck, lint, test, build on Node 22. CI itself was
not executed on GitHub; the same four commands were executed locally with the results above.

## M6 — End-to-end smoke test

Dev server: `npm run dev -- --hostname 127.0.0.1 --port 3000`.

Health:

```text
GET /api/health → 200
{"status":"ok","version":"0.1.0","uptimeSeconds":7,
 "serperConfigured":false,"kvConfigured":false,"cacheMode":"memory",
 "timestamp":"2026-11-26T02:54:28.777Z"}
```

Detection, typed text:

```text
POST /api/detect {"input":"Dr. Althea Melaclear Cream 20g"} → 200
{"query":{"name":"Melaclear Cream","brand":"Dr. Althea",
          "size":{"value":20,"unit":"g"}},"warnings":[]}
```

Detection, real URL:

```text
POST /api/detect {"input":"https://bonjournp.com/product/dr-althea-melaclear-cream-20gm/"} → 200
query: Melaclear Cream / Dr. Althea / 20 g
preview: NPR 2,000, original NPR 3,000, inStock true, source "direct"
fetchedAt: 2026-11-26T02:54:37.049Z
```

Uncached search (query above with city `Kathmandu`):

```text
status=200 contentType=text/event-stream; charset=utf-8
firstListingMs=2492 totalMs=5062
listingEvents=2 eventTypes=status,source,listing,source,listing,source,done
doneListings=2 badges=cheapest,best_value
coverage: checked=3 responded=2 failed=0 listings=2
sources:
  beauty-essentials ok 1 listing 1116 ms
  bonjour          ok 1 listing 3666 ms
  serper           skipped 0 listings 6 ms
budget: creditsUsed=0/8 fetchesUsed=2/25 cacheStatus=miss cacheMisses=1
partial=true
prices: Bonjour Nepal NPR 2,000 (20 g); Beauty Essentials NPR 2,700 (20 g)
```

The observed first-result latency was 2,492 ms and completion was 5,062 ms. These are two single
samples, not p50/p95 measurements.

Second identical search:

```text
firstListingMs=137 totalMs=138
listingEvents=2 eventTypes=status,listing,listing,done
budget: creditsUsed=0/8 fetchesUsed=0/25 cacheStatus=hit cacheHits=1 cacheMisses=0
```

This verifies the 0-credit / 0-fetch second-search requirement in a live process.

## Not proven

- Serper `num > 10`, daily ceiling behavior with real Upstash, and GitHub Actions execution.
- p50/p95 under load, multi-instance rate limiting, and visual layout on real devices.
- Complete seller coverage, authenticity, or stock after `fetchedAt`.
