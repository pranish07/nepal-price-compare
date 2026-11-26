# Nepal Price Compare

**Live demo:** [https://nepal-price-compare.vercel.app/](https://nepal-price-compare.vercel.app/)

Compare products across Nepali sellers. Paste a product URL, type a product name, or upload a
product photo. Confirm the detected product, then get a streamed comparison with NPR prices, stock,
location, delivery, price per unit where available, and **Cheapest / Best value / Closest** picks.

Photo identification accepts many retail products, including shoes, clothing, electronics, household
goods, and beauty products. Built-in price adapters currently focus on beauty stores; other
categories depend on the optional Serper fallback. V1 remains Nepal/NPR only with no accounts, no
price history, and no complete-market claims. Results are always labelled as a partial survey.

## Quick start

Requirements: Node.js 20.9+ (Node 22 LTS recommended) and npm.

```bash
git clone <your-repo-url> nepal-price-compare
cd nepal-price-compare
npm install
cp .env.example .env.local   # optional; text/link search runs without any keys
npm run dev
```

Open http://localhost:3000. Try `Dr. Althea Melaclear Cream 20g` with city `Kathmandu`, or upload a
clear photo of a product label and confirm the detected name before searching.

Serper discovery is optional. Without `SERPER_API_KEY` the app uses only its built-in store
adapters and says so in the coverage panel. No credit is spent. Photo identification needs both
`GEMINI_API_KEY` and `GEMINI_MODEL`; without them, text and URL entry still work.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint flat config (Next.js core-web-vitals + TypeScript) |
| `npm test` | Vitest suite including real-HTML contract tests; no live Gemini calls |
| `npm run test:watch` | Vitest watch mode |
| `npm run mcp` | Build and start the local stdio MCP server (`identify_product_image` only) |
| `npm run verify:serper` | Optional live Serper probe (spends credits; see below) |

## Environment variables

Copy `.env.example` to `.env.local`. Everything is optional for text/link search. Serper discovery
requires its key; photo identification requires both Gemini variables.

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
| `IMAGE_DETECT_RATE_LIMIT_PER_HOUR` | `10` | Per-IP photo detection limit. |
| `GEMINI_API_KEY` | unset | Enables free Gemini REST photo identification. Server-only; never sent to the browser. |
| `GEMINI_MODEL` | unset | Model used by the Gemini REST call. No runtime fallback; `.env.example` suggests `gemini-3.5-flash-lite`. |
| `GEMINI_DAILY_CEILING` | `200` | Global daily image-detection ceiling; fail closed. |

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

### `POST /api/detect-image`

Detects a retail product from a photo using the free Gemini REST API. Send multipart form
data with one `image` field. Only JPG, PNG, and WebP are accepted, magic bytes are checked, and the
file must be at most 3 MB. The API key stays on the server and is sent to Google in the
`x-goog-api-key` header. The prompt accepts shoes, clothing, electronics, household goods, beauty
products, and other consumer products when brand or model text is readable.

```bash
curl -s http://localhost:3000/api/detect-image \
  -F 'image=@label.png;type=image/png'
```

```json
{
  "guess": {
    "brand": "La Roche-Posay",
    "name": "Cicaplast Baume B5",
    "size": null,
    "confidence": 0.82
  },
  "query": {
    "name": "cicaplast baume b5",
    "brand": "la roche posay"
  },
  "warnings": ["No size was detected. Add it for an exact price-per-unit comparison."]
}
```

The response is always passed through the editable confirmation step. Errors are JSON with an
`error` string; quota, busy, or upstream failures suggest typing the product name instead. Logs
contain `requestId`, `durationMs`, `status`, and `confidence`, never the image or API key.

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

Returns version, uptime, `serperConfigured`, `geminiConfigured`, `kvConfigured`, `cacheMode`, and
timestamp. `geminiConfigured` is a boolean only; it never exposes the key or model.

## Image upload (free Gemini REST)

The home page accepts `image/*` from the file picker or drag-and-drop. The browser first downscales
the photo to at most 1024 px on the long edge and re-encodes it as JPEG at quality 0.85, then posts it
to `/api/detect-image`. The server allows JPG, PNG, and WebP up to 3 MB and verifies the magic bytes
before sending the image to Google.

- The exact privacy notice is shown before upload: **Photos are sent to Google's free Gemini API;
  free-tier data may be used to improve Google products. Don't upload private photos.**
- The model is asked for general retail product information, with `null` values when text is not
  clearly readable, no guessed size, confidence from 0 to 1, and `null` + `0` for non-product photos
  or generic objects without readable brand/model text.
- Only g/ml pack sizes fit the app's canonical size field. Shoe, clothing, and other non-pack sizes
  are left out of the query with a warning; type them in the product name if they matter.
- Model output is treated as untrusted: JSON parsing is guarded, strings are trimmed and capped at
  120 characters, control characters are stripped, and confidence is clamped. React renders the guess
  as text, never as HTML.
- The existing name/brand/size parser converts the guess into a `ProductQuery`. The editable
  confirmation card shows how Gemini read the photo. Confidence below 0.5 shows **Not sure, please
  check**; a missing pack size shows the existing missing-size warning.
- A skeleton appears while detection runs. Quota, busy, malformed, and upstream errors show a friendly
  inline message with a **Type product name instead** button. Text and URL search are unaffected.
- Per-IP detection is limited to 10/hour and the global daily ceiling defaults to 200. If a limiter
  or ledger is unavailable, the route fails closed: **Image detection is busy, type the product name
  instead.**
- No Gemini request runs in CI. The La Roche-Posay test uses a synthetic PNG and a recorded response;
  live extraction quality is not claimed. See `docs/SPIKES.md` §7.

The earlier on-device Tesseract OCR code remains in the repository as historical implementation, but
the current UI uses Gemini.

## Installable PWA

The app ships with a web app manifest (`src/app/manifest.ts`), a hand-built vector logo
(`src/app/icon.svg`), PNG icons for Android and iOS, and a small app-shell service worker
(`public/sw.js`). `PwaRegister` registers it only in production builds.

- Install from Chrome/Edge's address-bar install icon, or iOS **Share → Add to Home Screen**.
- Standalone display, portrait orientation, teal theme color, and 192/512 icons including a maskable
  icon.
- The service worker precaches the home shell and icons, uses network-first for navigations, and
  cache-first for same-origin scripts, styles, images, fonts, and the manifest. API routes, SSE
  streams, text detection, and photo uploads are **never** cached.
- Offline support is limited to the cached UI shell; searches and photo identification still need a
  network connection. There are no push notifications or background sync.
- `/sw.js` is served with `no-cache`, a strict same-origin CSP, and
  `Content-Type: application/javascript`.
- Check locally with `npm run build && npm start`, then open http://localhost:3000. Registration is
  skipped in `next dev` so stale chunks never hide code changes.

## Local MCP server

`npm run mcp` builds `mcp/server.ts` to `.mcp-build/` and starts a local stdio server using the
official `@modelcontextprotocol/sdk` v1. It exposes one tool, `identify_product_image`, which takes
exactly one of `image_path` or `image_base64` plus an optional `mime_type`, calls the same
`identifyProduct()` core as the web route, and returns JSON text containing `guess` and the normalized
`query`. Paths must stay inside the project, images are limited to 3 MB JPG/PNG/WebP, and the key and
model come only from the environment.

Example client configuration (replace the absolute path):

```json
{
  "mcpServers": {
    "nepal-price-compare": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/nepal-price-compare",
      "env": {
        "GEMINI_API_KEY": "your-free-key",
        "GEMINI_MODEL": "gemini-3.5-flash-lite"
      }
    }
  }
}
```

There is deliberately no `search_prices` tool: reusing the price pipeline would spend Serper credits
by default. See decision D28 in `docs/DECISIONS.md`.

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
   credit ceiling and rate limits are shared across instances. Add `GEMINI_API_KEY` and
   `GEMINI_MODEL` only if photo identification should be enabled; the model name is required at
   runtime and is not defaulted in code.
4. `/api/search` sets `maxDuration = 60`; `/api/detect-image` sets 30. The Hobby plan supports
   streaming responses of that length. Heartbeat comments keep proxies from closing idle streams.
5. Do not enable Vercel Analytics/Speed Insights if you need the strictest possible zero recurring
   cost setup; the app itself needs no paid services.

No database, Redis server, headless browser, or paid search API is required. Upstash free tier is
optional.

## Adding a store adapter

1. Check the store's `robots.txt` and terms. Record what you verified in `docs/SPIKES.md` or
   `docs/DECISIONS.md`.
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
src/app/api/{detect,detect-image,search,health}/route.ts  HTTP + SSE entry points
src/app/{manifest.ts,icon.svg}                             PWA manifest and vector logo
src/components/                                           client UI (incl. ImageUpload, PwaRegister)
public/{sw.js,icon-*.png,apple-touch-icon.png}             service worker and PWA icons
src/lib/vision/{image,identifyProduct,client}.ts          image guards, Gemini core, browser resize
src/lib/ocr.ts                                            historical on-device OCR (not used by UI)
public/tesseract/                                         historical self-hosted Tesseract assets
mcp/{server,cli}.ts                                       local stdio MCP server
tsconfig.mcp.json                                         CommonJS MCP build config
src/lib/adapters/                                         store-specific parsers + resilience
src/lib/extract/                                          generic product/JSON-LD/RSC extraction
src/lib/{match,rank,sort,normalize,size,price}.ts         pure comparison logic
src/lib/{budget,cache,rate-limit,serper}.ts               cost and quota guards
src/lib/{ssrf,http}.ts                                    SSRF-safe fetching
src/lib/pipeline.ts                                       orchestration, streaming, isolation
src/test/fixtures/                                        saved HTML and image/response test doubles
spikes/                                                   raw spike captures
docs/                                                     design, decisions, evidence, limitations
```

Further reading: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`,
`docs/KNOWN_LIMITATIONS.md`, `docs/DESIGN.md`, `docs/SPIKES.md`, `docs/EVIDENCE.md`.

## Honesty notes

- Every number comes from a source page and carries a URL plus `fetchedAt`.
- Gemini photo identification is a convenience for entering a product name, not proof of product
  identity. Always check the editable fields.
- Missing data is displayed as "not listed", never inferred from a domain or a competitor.
- Different sizes are kept but flagged and excluded from Cheapest.
- We do not claim complete coverage, authenticity, or product efficacy. Verify on the seller site.

## Verified live vs assumed

- **Verified live earlier:** store fetches, parser fixtures, `/api/detect`, and the production
  `/api/health` response before Gemini was added.
- **Verified from official docs on 2026-11-26:** a free stable model with image input and structured
  output, inline `generateContent` image parts, and the privacy implication of free-tier data use.
  Sources are listed in `docs/SPIKES.md` §7.
- **Verified live on 2026-11-26:** a Gemini REST request with an inline image returned HTTP 200 using
  camelCase `responseSchema` in the legacy Schema proto shape. The initial JSON Schema shape returned
  400 and was fixed; details are in `docs/SPIKES.md` §7 and decision D30.
- **Verified in a local production build on 2026-11-26:** `/` links the manifest, icon, and Apple touch
  icon; `/manifest.webmanifest` lists all PNG sizes; `/sw.js` returns 200 with `no-cache` and a strict
  same-origin CSP. Real-device installation and offline launch were not browser-tested.
- **Not verified live:** extraction quality on a real product photo.
- **Not publicly verified:** numeric free-tier RPM/RPD limits require signing in to AI Studio, so the
  app enforces its own per-IP and global ceilings.
- **Not a real photo:** the La Roche-Posay fixture is synthetic and its recorded response is a test
  double. The live diagnostic used the same synthetic PNG only to verify request acceptance.
