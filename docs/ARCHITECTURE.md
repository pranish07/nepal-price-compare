# ARCHITECTURE.md — Nepal Price Compare

This document describes how the running system is put together. `DESIGN.md` defines scope and
contracts; `DECISIONS.md` explains why the design took its current shape.

## 1. Shape of the system

A small Next.js App Router application runs entirely on one Node.js runtime. It has no database, no
queue, and no browser automation. Search work is done with plain HTTP plus Cheerio, and results are
returned as Server-Sent Events (SSE).

```
Browser ──POST /api/detect──> detect route ──> SSRF-safe fetch ──> generic extractor
   │
   ├──POST /api/detect-image> image route ──> MIME/magic-byte guard ──> Gemini REST
   │                              │                                      │
   │                              └─ per-IP limit + daily ceiling         └─ untrusted guess
   │                                                                          │
   │                                             existing name/size parser ────┘
   │                                                     │
   └──POST /api/search──> search route ──> rate limit ──> runSearch()
                                                          │
                     ┌────────────────────────────────────┼─────────────────────────────┐
                     │                                    │                             │
              cache.get(key)                     adapter tasks                   Serper task
                     │                            (Bonjour, Beauty)             (optional key)
              hit/stale/miss                           │                             │
                     │                        budgeted fetch                 candidate URLs
                     │                        per-domain delay                 generic fetch
                     │                             │                             │
                     └──────────────────── match → dedupe → rank → cache.set ─────┘
                                                          │
                                                    done event + SearchResult
```

The UI renders `listing` events as they arrive, then replaces the live table with ranked output and
badges when `done` arrives. A disconnected client is ignored by the pipeline rather than treated as
an error.

## 2. Modules

| Area | Files | Responsibility |
| --- | --- | --- |
| HTTP entry points | `src/app/api/{detect,detect-image,search,health}/route.ts` | Validate input, rate limit, identify photos, stream SSE, map errors to status codes. |
| Client | `src/components/` | Image upload/downscale, product confirmation, live results, top-3 cards, sortable table, source status, empty/error states. |
| Vision | `src/lib/vision/{image,identifyProduct,client}.ts` | MIME/magic-byte guards, strict Base64, Gemini REST call, untrusted-output sanitization, browser resize. |
| MCP | `mcp/{server,cli}.ts`, `tsconfig.mcp.json` | Local stdio tool wrapping the same vision core; compiled to CommonJS by `npm run mcp`. |
| Orchestration | `src/lib/pipeline.ts` | Cache lookup, single-flight, parallel source execution, event emission, budgets, final result. |
| Store adapters | `src/lib/adapters/` | Store-specific URL construction and parsing. Shared timeout/retry/circuit-breaker wrapper. |
| Extraction | `src/lib/extract/` | JSON-LD, DOM metadata, and embedded RSC product extraction shared by adapters and Serper candidates. |
| Comparison | `src/lib/{match,rank,sort,normalize,size,price}.ts` | Pure scoring, badge selection, sorting, units, and NPR formatting. |
| Cost controls | `src/lib/{budget,cache,rate-limit,serper}.ts` | Credit/fetch budgets, TTL cache, rate limits, Serper paging. |
| Safe fetching | `src/lib/{ssrf,http}.ts` | DNS validation, IP pinning, redirect revalidation, size/time caps. |
| Wiring | `src/lib/container.ts` | Builds one process-wide dependency container. |

All routes use the Node.js runtime because SSRF validation uses `node:dns` and `node:http(s)`.

## 3. Search lifecycle

1. **Validate.** `SearchRequestSchema` (Zod) accepts a product name, optional brand, optional size,
   optional city, and `includeDifferentSizes`.
2. **Rate limit.** The client IP is taken from `x-forwarded-for` or `x-real-ip`. A failure in the
   rate-limit backend is logged and does not take down the app.
3. **Cache lookup.** The key is `npc:v1:search:<normalized brand|name|size>`. City is excluded so a
   Kathmandu search can serve a Dharan search without refetching; city-sensitive ranking is redone
   on every hit. A fresh hit emits status, listings, and done with 0 credits and 0 fetches. A stale
   hit (after 6 h, within 24 h) is served immediately and triggers a background single-flight
   revalidation.
4. **Single-flight.** Concurrent identical uncached searches share one pipeline execution. The
   joining request gets `cacheStatus: "coalesced"` and still receives a complete event stream.
5. **Discovery.** Adapter tasks and the optional Serper task start together. Adapter results may
   stream before Serper finishes. Serper supplies candidate URLs only; prices are always read from
   the candidate store page.
6. **Isolation.** Each source task is wrapped so its errors become a `source` event with status
   `ok | error | timeout | skipped | circuit_open`. `Promise.allSettled` means one slow or broken
   store cannot reject the whole search. A circuit breaker skips a store after 3 failures in 60 s.
7. **Comparison.** Raw listings are matched to the query, deduplicated per seller (best match, then
   lowest price), and ranked. Different-size listings are retained with a flag but excluded from
   Cheapest unless requested.
8. **Persist and finish.** The cache write is awaited before `done`, which guarantees a later
   identical search sees the entry. The final event carries coverage and the budget snapshot.
   Empty results use a shorter 10-minute TTL.

## 4. Streaming contract

`POST /api/search` returns `text/event-stream` with heartbeat comments every 15 seconds. Event
frames are `event: <type>` followed by a JSON `data:` line:

| Event | Payload | When |
| --- | --- | --- |
| `status` | `{ phase, message }` | Cache hit, coalescing, or discovery start. |
| `source` | `SourceReport` | Each source finishes, succeeds, or fails. |
| `listing` | `Listing` | A matched listing arrives (including on cache hits). |
| `done` | `SearchResult` | Always sent on a completed search, even with zero listings. |
| `error` | `{ code, message }` | Only for a whole-request failure. |

The client parser lives in `src/components/SearchApp.tsx`. `src/lib/sse.ts` owns frame formatting and
is contract-tested.

## 5. Cost and abuse controls

- **Serper:** at most 3 variants × 2 pages, capped at 8 credits per uncached search. Credits are
  charged to the daily ledger and the per-request budget *before* each call, so a ledger outage
  cannot overspend. The daily ceiling fails closed with a skipped source rather than an app error.
- **HTML:** at most 25 fetches per search, 8 s timeout, 2 MB per page, 6-way concurrency, and a
  500 ms per-host delay.
- **Adapters:** 9 s timeout, at most one jittered retry, and a 3-failure/60 s circuit breaker.
- **Users:** 10 searches/hour, 30 link/text detections/hour, and 10 image detections/hour per IP by default.
- **Gemini:** global `GEMINI_DAILY_CEILING` (default 200) is charged before the REST call. The
  limiter/ledger failing closed returns the same busy message as an exhausted budget.
- **Cache:** 6 h fresh, 24 h stale window, 10 min for empty results.

The default implementations are in-process: fast, free, and suitable for a single instance. With
Upstash Redis REST credentials, cache, rate limits, and the daily ledger switch to shared durable
implementations. This matters on Vercel, where multiple instances do not share memory.

## 6. Security boundary

`validatePublicUrl` runs before every HTML request:

- only `http:` and `https:`, ports 80/443, no embedded credentials;
- blocked localhost/metadata/internal hostnames and IPv6 zone identifiers;
- DNS resolution for every hostname, rejecting private, loopback, link-local, CGNAT, multicast,
  reserved, 6to4, NAT64, Teredo, and IPv4-mapped non-unicast ranges via `ipaddr.js`;
- connection pinned to the validated IP, with SNI still using the original hostname;
- every redirect revalidated, maximum 3 hops;
- `text/html` / `application/xhtml+xml` only, with declared and streamed size checks.

User-supplied product text is Zod-validated and only used to build query strings or display text.
Search pages from Serper are treated as untrusted URLs and go through the same fetcher.

Image uploads are checked against declared MIME type **and** magic bytes, capped at 3 MB, and sent as
inline Base64 to Gemini with the key in `x-goog-api-key`. Model output is untrusted: JSON parsing is
guarded, strings are trimmed/capped/stripped of control characters, confidence is clamped, and React
renders it as text. Upstream bodies are never returned to clients. The MCP tool accepts a Base64 blob
or a path whose resolved and real paths both stay inside the project.

## 7. Deployment notes

- `next build` emits a static `/` and dynamic API routes.
- `/api/search` sets `maxDuration = 60`; `/api/detect` and `/api/detect-image` set 30. Heartbeats
  prevent proxy idle timeouts in the browser.
- No environment variable is required for local text/link search. For production, set Upstash
  credentials if shared limits are needed, set `SERPER_API_KEY` only if the one-time credits should
  be used, and set both `GEMINI_API_KEY` and `GEMINI_MODEL` to enable photo identification. There is
  no runtime model fallback; `/api/health` exposes only a `geminiConfigured` boolean.
- Store adapters are the extension point for more sellers; generic extraction is reused for Serper
  candidates. See the adapter guide in `README.md`.

## 8. Performance posture

The design target is p50 first result under 3 s and p95 completion under 15 s. Streaming and cache
hits are the main mechanisms. Real latency depends on third-party stores and is not guaranteed by
a local test suite; see `KNOWN_LIMITATIONS.md` and `EVIDENCE.md` for what was actually measured.
Gemini vision latency was not measured live; the REST call has a 20 s timeout inside the 30 s route.

## 9. Image identification and MCP

The browser downsizes the selected photo to 1024 px on the long edge and re-encodes it as JPEG q0.85.
`/api/detect-image` checks the file, spends the per-IP and global budgets, then calls
`identifyProduct()` with `temperature: 0`, `responseMimeType: "application/json"`, and a bounded
`responseSchema`. `parseProductGuess()` sanitizes the JSON, and `queryFromGuess()` reuses
`parseProductText()` and the size parser so image results and typed results share one normalization
path. The client shows a skeleton, then an editable `ProductConfirm` card with a low-confidence
warning; searching continues through the normal SSE pipeline.

`mcp/server.ts` registers `identify_product_image` on the official v1 SDK. It accepts exactly one of
`image_path` or `image_base64`, uses the same core and normalization, and returns JSON text with
`guess` and `query`. It is a local/dev tool only; there is no `search_prices` tool because that would
spend Serper credits by default. No live Gemini call is made by tests or CI.
