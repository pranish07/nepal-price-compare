# Nepal Price Compare

**Live demo:** [https://nepal-price-compare.vercel.app/](https://nepal-price-compare.vercel.app/)

Compare skincare products across Nepali sellers. Paste a product URL, type a product name, or upload
a photo of the label. Confirm the detected product, then get a streamed comparison with NPR prices,
stock, location, delivery, price per unit, and **Cheapest / Best value / Closest** picks.

V1 is intentionally narrow: skincare/beauty, Nepal, NPR, no accounts, no price history, no complete
market claims. Results are always labelled as a partial survey.

## Quick start

Requirements: Node.js 20.9+ (Node 22 LTS recommended) and npm.

```bash
git clone <your-repo-url> nepal-price-compare
cd nepal-price-compare
npm install
cp .env.example .env.local   # optional; the app runs without any keys
npm run dev
```

Open http://localhost:3000. Try `Dr. Althea Melaclear Cream 20g` with city `Kathmandu`, or upload a
clear photo of a product label and confirm the detected name before searching.

Serper discovery is optional. Without `SERPER_API_KEY` the app uses only its built-in store
adapters and says so in the coverage panel. No credit is spent.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint flat config (Next.js core-web-vitals + TypeScript) |
| `npm test` | Vitest, 171 tests including real-HTML contract tests |
| `npm run test:watch` | Vitest watch mode |
| `npm run verify:serper` | Optional live Serper probe (spends credits; see below) |

## Environment variables

Copy `.env.example` to `.env.local`. Everything is optional except when you want durable limits or
Serper discovery.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERPER_API_KEY` | unset | Enables discovery. Without it, Serper is skipped and costs 0. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | unset | Enables durable cache, rate limits, and daily credit ledger. Strongly recommended on serverless. |
| `CRAWLER_CONTACT` | GitHub project URL | Contact URL included in the crawler User-Agent. |
| `CACHE_TTL_SECONDS` | `21600` (6 h) | Fresh-cache lifetime. |
| `CACHE_STALE_SECONDS` | `86400` (24 h) | Stale-while-revalidate window. |
| `MAX_SERPER_CREDITS_PER_SEARCH` | `8` | Hard per-uncached-search credit cap. |
| `MAX_SERPER_VARIANTS` | `3` | Query variants. |
| `MAX_SERPER_PAGES` | `2` | Page cap. Page 3 logic is encoded but disabled in v1. |
| `SERPER_DAILY_CREDIT_CEILING` | `100` | Global daily ceiling; fail closed. |
| `SERPER_TIMEOUT_MS` | `10000` | Serper request timeout. |
| `MAX_FETCHES_PER_REQUEST` | `25` | HTML fetches per uncached search. |
| `FETCH_TIMEOUT_MS` | `8000` | Per-page timeout. |
| `MAX_BYTES_PER_PAGE` | `2097152` (2 MB) | Per-page size cap. |
| `FETCH_CONCURRENCY` | `6` | Parallel candidate fetches. |
| `PER_DOMAIN_DELAY_MS` | `500` | Minimum delay between requests to one host. |
| `ADAPTER_TIMEOUT_MS` | `9000` | Per-adapter timeout. |
| `SEARCH_RATE_LIMIT_PER_HOUR` | `10` | Per-IP search limit. |
| `DETECT_RATE_LIMIT_PER_HOUR` | `30` | Per-IP link/text detection limit. |

## API

### `POST /api/detect`

Detect and preview a product from a URL or typed text. Does not spend Serper credits.

```bash
curl -s http://localhost:3000/api/detect \
  -H 'Content-Type: application/json' \
  -d '{"input":"https://bonjournp.com/product/dr-althea-melaclear-cream-20gm/"}'
```

```json
{
  "query": { "name": "Melaclear Cream", "brand": "Dr. Althea", "size": { "value": 20, "unit": "g" } },
  "preview": { "...": "RawListing with price, sourceUrl, fetchedAt, source: direct" },
  "warnings": [],
  "sourceUrl": "https://bonjournp.com/product/dr-althea-melaclear-cream-20gm/",
  "fetchedAt": "2026-01-01T00:00:00.000Z"
}
```

Text input works too: `{"input":"Dr. Althea Melaclear Cream 20g"}`.

### `POST /api/search` (Server-Sent Events)

```bash
curl -N http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"name":"Melaclear Cream","brand":"Dr. Althea","size":{"value":20,"unit":"g"},"city":"Kathmandu"}}'
```

Event frames are `event: <type>` plus a JSON `data:` line. Types:

- `status` — phase message (`discovery`, `cache`).
- `source` — per-source outcome (`ok | error | timeout | skipped | circuit_open`).
- `listing` — a matched listing as soon as its source responds.
- `done` — final `SearchResult` with coverage and budget. Always sent, even with zero listings.
- `error` — only when the whole request fails.

The browser renders streamed listings while the search is still running; rankings and badges appear
on `done`.

### `GET /api/health`

Returns version, uptime, `serperConfigured`, `kvConfigured`, `cacheMode`, and timestamp.

## Image upload (OCR)

The home page accepts JPG, PNG, WebP, GIF, or BMP images up to 8 MB. OCR runs **in the browser** with
[Tesseract.js](https://tesseract.projectnaptha.com/): the photo is never uploaded. Three page-layout
modes are tried and the best-looking result is chosen; the flattened text is posted to `/api/detect`,
which reuses the existing name/brand/size parser. The user then confirms or edits the fields in
`ProductConfirm` before the normal `/api/search` pipeline starts.

- Tesseract.js is dynamically imported only when an image is chosen, so the initial page load stays
  small.
- `public/tesseract/worker.min.js` is self-hosted. The WASM core and English language data are
  fetched from jsDelivr on first use and cached by the browser. There is no paid vision API and no
  new environment variable.
- The CSP allows the jsDelivr worker assets, `wasm-unsafe-eval`, blob image previews, and the local
  Web Worker. `workerBlobURL: false` keeps the worker at a same-origin URL.
- Before OCR, the browser upscales small images and applies grayscale + contrast in a canvas. Tesseract
  then runs automatic, single-block, and sparse-text passes with auto-rotation; a small scoring
  function prefers brand, size, and skincare words and penalises isolated letters and symbol runs.
- If the result still looks uncertain, the raw text appears in an editable box with a **Use this text**
  button and a direct **Type product name instead** shortcut. It is not rejected or hidden.
- OCR is English-only and best-effort. It can misread fonts, packaging angles, or low-resolution
  photos; the editable confirmation step is part of the flow, not an optional extra.
- File type, size, readable-text, and `/api/detect` failures are shown inline. No OCR result is
  treated as verified without user confirmation.

## Credit budget

Serper is discovery only — it never supplies prices. Each call costs one credit and is charged to
both the per-request budget and the global daily ledger *before* the request. An uncached search
spends at most 8 credits:

1. Up to 3 query variants.
2. Page 1 for each variant.
3. Page 2 only when page 1 returned at least 3 Nepal-relevant results.
4. Page 3 only for variant 1, only when page 2 introduced a new `.np` store, and only when
   `MAX_SERPER_PAGES >= 3` (it is 2 in v1, so this never happens in production but is tested).

An identical second search is a cache hit: **0 credits, 0 fetches**. If the daily ceiling is
reached, discovery is skipped with a friendly message; adapter results still stream.

`npm run verify:serper` makes a real Serper request (1 credit) and prints response shape. Use it to
check the unverified `num > 10` assumption:

```bash
SERPER_API_KEY=... npm run verify:serper -- "Dr. Althea Melaclear Cream Nepal" --num=20
```

It prints the requested `num`, HTTP status, number of organic results, and top result hosts. It
never prints the API key.

## Deploying to Vercel (Hobby / free)

1. Import the repository; framework preset **Next.js**, root directory `nepal-price-compare` if the
   repo root contains other folders.
2. Node version 20.9+ (22 recommended). Build command `npm run build`; output is detected by Next.
3. Add env vars in Project Settings. For a real deployment, set the two Upstash vars so the daily
   credit ceiling and rate limits are shared across instances.
4. `/api/search` sets `maxDuration = 60`; the Hobby plan supports streaming responses of that
   length. Heartbeat comments keep proxies from closing idle streams.
5. Do not enable Vercel Analytics/Speed Insights if you need the strictest possible zero recurring
   cost setup; the app itself needs no paid services.

No database, Redis server, headless browser, or paid search API is required. Upstash free tier is
optional.

## Adding a store adapter

1. Check the store's `robots.txt` and terms. Record what you verified in `SPIKES.md` or
   `DECISIONS.md`.
2. Create `src/lib/adapters/<store>.ts` exporting a `StoreAdapter`:

   ```ts
   export const myAdapter: StoreAdapter = {
     id: "my-store",
     domain: "store.com.np",
     label: "My Store",
     async search(query, ctx) {
       const page = await ctx.fetch.html(
         `https://store.com.np/search?q=${encodeURIComponent(searchText(query))}`,
         { timeoutMs: ctx.timeoutMs, signal: ctx.signal },
       );
       // Return RawListing[]; leave unknown fields undefined.
     },
   };
   ```

3. Add it to `STORE_ADAPTERS` in `src/lib/adapters/registry.ts`. It automatically gets the shared
   timeout/retry/circuit-breaker wrapper and appears in coverage.
4. Save a real HTML response to `src/test/fixtures/` and add a contract test. Never invent prices
   in tests — assert against the saved HTML.
5. If the store needs a special parse (RSC JSON, embedded state), keep that code inside the adapter
   or `src/lib/extract/`, not in the pipeline.

## Repository layout

```
src/app/api/{detect,search,health}/route.ts   HTTP + SSE entry points
src/components/                               client UI (incl. ImageUpload)
src/lib/ocr.ts                                browser OCR wrapper + text cleanup
public/tesseract/                             self-hosted Tesseract worker + license
src/lib/adapters/                             store-specific parsers + resilience
src/lib/extract/                              generic product/JSON-LD/RSC extraction
src/lib/{match,rank,sort,normalize,size,price}.ts  pure comparison logic
src/lib/{budget,cache,rate-limit,serper}.ts   cost and quota guards
src/lib/{ssrf,http}.ts                        SSRF-safe fetching
src/lib/pipeline.ts                           orchestration, streaming, isolation
src/test/fixtures/                            real saved HTML for contract tests
spikes/                                       raw spike captures
```

Further reading: `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `KNOWN_LIMITATIONS.md`,
`DESIGN.md`, `SPIKES.md`, `EVIDENCE.md`.

## Honesty notes

- Every number comes from a source page and carries a URL plus `fetchedAt`.
- Image OCR is a convenience for entering a product name, not proof of product identity.
- Missing data is displayed as "not listed", never inferred from a domain or a competitor.
- Different sizes are kept but flagged and excluded from Cheapest.
- We do not claim complete coverage, authenticity, or product efficacy. Verify on the seller site.
