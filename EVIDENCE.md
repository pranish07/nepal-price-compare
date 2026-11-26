# EVIDENCE.md — M0–M6 verification record

Date: 2026-11-26. Environment: local Windows, Node v25.1.0, Next.js 16.4.6, Vitest 4.1.12.
Everything below was actually run. Commands are reproducible from the repository root unless stated
otherwise. No Serper key was present, so no Serper credits were spent.

Milestone labels map to the project's delivery themes: M0 feasibility, M1 extraction, M2 matching,
M3 safety/cost controls, M4 streaming/UI, M5 tests/CI/docs, M6 end-to-end smoke, M7 image OCR.

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
Test Files  19 passed (19)
Tests       174 passed (174)
Duration    ~12 s
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
CI: `.github/workflows/ci.yml` runs `npm ci`, typecheck, lint, test, build on Node 22.

Initial GitHub run `45748944754` failed at `npm ci` because the Windows/npm 11-generated lockfile
omitted platform-optional `@emnapi/*` entries required by npm 10 on Linux. Commit `b5c0cfe`
regenerated `package-lock.json` with npm 10. Re-run `45749158192` passed every step in 39 s.
The OCR commit `8ff5a33` reintroduced the same npm 11 lockfile shape and run `45751719069` failed at
`npm ci` again. Commit `0dd26dd` regenerated the lockfile with npm 10; run `45752247031` passed
typecheck, lint, 168 tests, and build in 33 s.
The quality-guard commit `1fcb5fd` passed CI run `45753315051` in 42 s with 171 tests. The
non-blocking OCR commit `1bc5aab` passed CI run `45754334780` in 32 s with 171 tests; local
`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` also passed.
GitHub reports a non-fatal annotation that `actions/checkout@v4` and `actions/setup-node@v4` target
Node 20 and are forced onto Node 24 by the runner; this did not affect the job.

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

## M7 — Image upload OCR

A synthetic label PNG was generated locally with the text `DR. ALTHEA` and `Melaclear Cream 20g`.
Tesseract.js 7.0.0 was then run in Node with the same pinned core/language assets used by the
browser wrapper:

OCR output before cleanup:

```json
{ "text": "DR. ALTHEA\nMelaclear Cream 20g\n", "confidence": 92 }
```

Flattened text posted to the existing detector:

```text
POST /api/detect {"input":"DR. ALTHEA Melaclear Cream 20g"} → 200
{"query":{"name":"Melaclear Cream","brand":"Dr. Althea",
          "size":{"value":20,"unit":"g"}},"warnings":[]}
```

`cleanOcrText` flattening, the advisory `isConfidentOcr` check, `scoreOcrText`, and the `/api/detect`
hand-off are covered by `src/lib/ocr.test.ts`; the 19-file / 174-test run above includes those cases.
No image was uploaded to the server: the browser sends only the cleaned text to `/api/detect`.

A user-reported photo produced this garbled OCR instead of a product name:

```text
A a ge 7 8 #4 R\ Pl Je wo PF, 3 Pre 4&8 ~~ AN bh ; J A A Py DOLPO > —N
```

That string remains a regression case for `isConfidentOcr`. A second photo produced this even
shorter noise:

```text
i> <I he i: i | on
```

Neither string is silently trusted now. `recognizeImage` runs `PSM.AUTO`, `PSM.SINGLE_BLOCK`, and
`PSM.SPARSE_TEXT` with auto-rotation on the same preprocessed canvas and keeps the highest
`scoreOcrText` result. If the chosen text still fails the advisory `isConfidentOcr` check, the upload
card shows it in an editable box with **Use this text** and **Type product name instead**; this is a
correction path, not a hard rejection. Only completely empty OCR shows a retake hint. Contrast
preprocessing was reduced from 1.5 to 1.25. This remains an API-key-free, on-browser OCR flow.

Local asset and header checks:

```text
GET /tesseract/worker.min.js → 200
Content-Type: application/javascript; charset=UTF-8
Content-Length: 111307

GET / → Content-Security-Policy:
default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; font-src 'self';
connect-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; object-src 'none';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

The production build served by `next build` contains a separate 41 KB chunk containing the OCR API
layer; the WASM core and language data remain CDN-loaded on first use.

After pushing `8ff5a33`, the lockfile fix `0dd26dd`, the quality-guard commit `1fcb5fd`, and the
non-blocking OCR commit `1bc5aab`, the live Vercel deployment was checked:

```text
GET https://nepal-price-compare.vercel.app/ → contains "Or upload a product photo"
    and "bright light, straight-on, text fills frame"
GET https://nepal-price-compare.vercel.app/_next/static/immutable/chunks/1u-fs37ggwk7z.js
    → contains "No text was found in that image" and no longer contains
      "That label was too hard to read"
GET https://nepal-price-compare.vercel.app/tesseract/worker.min.js → 200, 111307 bytes,
    Content-Type: application/javascript; charset=utf-8
GET https://nepal-price-compare.vercel.app/ → CSP includes wasm-unsafe-eval, cdn.jsdelivr.net,
    worker-src 'self' blob:, and blob: in img-src
GET https://nepal-price-compare.vercel.app/api/health → status ok, serperConfigured true,
    kvConfigured false, cacheMode memory
```

## Not proven

- Serper `num > 10`, daily ceiling behavior with real Upstash, and GitHub Actions execution.
- p50/p95 under load, multi-instance rate limiting, and visual layout on real devices.
- Real-browser OCR drag-and-drop, Web Worker CSP behavior, IndexedDB caching, and camera photos.
- Complete seller coverage, authenticity, or stock after `fetchedAt`.
