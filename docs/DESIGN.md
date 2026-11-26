# DESIGN.md — Nepal Price Compare (v1)

Status: M0 approved by spike results in `SPIKES.md`. This document is the source of truth for
scope, assumptions, interfaces, and trade-offs. Decisions that changed during implementation are
recorded in `DECISIONS.md`.

## 1. Problem and scope

A user pastes a product URL, types a product name, or uploads a clear label photo and gets a
comparison of Nepali sellers of that exact product: price in NPR, stock, location, delivery, price per
unit, plus **Cheapest** and **Best value** picks with a template-generated explanation.

V1 is deliberately narrow:

- Skincare/beauty only.
- Nepal only, NPR only.
- No accounts, no price history, no login-walled sources. Image upload is an optional entry aid, not
  a source of inventory or proof of identity.
- No claims about efficacy, safety, or medical outcomes.

## 2. Constraints that drive the design

| Constraint | Design consequence |
| --- | --- |
| Zero recurring cost | Vercel Hobby, no database, no headless browser. Store adapters are plain HTTP + Cheerio. |
| 2,500 one-time Serper credits | Serper is a fallback discovery channel, never the primary path. Hard per-request and per-day budgets. |
| One developer | Few moving parts. Pure functions for matching/ranking. Adapters are one file + one registry line. |
| Latency | Stream over SSE. Each source resolves independently. A slow store cannot block the final result. |
| Trust | Every price carries a source URL and `fetchedAt`. Missing values are `null` and render as "not listed". |
| Free Gemini tier | Image identification is optional, budgeted, and never a paid API. Free-tier data may be used to improve Google products, so the exact privacy notice is shown before upload. |
| Untrusted model output | A photo guess is normalized with the existing parser and always confirmed by a human before search. |

## 3. Assumptions (and how each is verified)

| # | Assumption | Verification | Status |
| --- | --- | --- | --- |
| A1 | Bonjour exposes search results in HTML at `/shop/?s=` and allows it | Live fetch; robots.txt check | **Verified** (14 results, 2.7 s) |
| A2 | Bonjour's `/wp-json/` is blocked by robots.txt | Read robots.txt | **Verified** — not used |
| A3 | Beauty Essentials exposes search at `/shop?search=` with embedded JSON | Live fetch; parse probe | **Verified** (17 products) |
| A4 | Beauty Essentials allows `/shop` and product pages | Read robots.txt | **Verified** |
| A5 | Serper honors `num > 10` | Requires a live key | **Unverified** — design does not depend on it; uses `num: 10` + `page` |
| A6 | A page fetch stays under 2 MB and 8 s | Live samples (247 KB, 791 KB, 0.1–2.9 s) | **Verified for the two adapters**; caps still enforced for all sources |
| A7 | Price-per-unit is meaningful for cosmetics | Domain reasoning; sizes are mass or volume | **Partially verified** — mass and volume are kept separate; no density conversion |
| A8 | A 6 h cache is acceptable for prices | Product decision | **Accepted** — configurable via `CACHE_TTL_SECONDS` |
| A9 | Vercel Hobby allows a 60 s streaming function | Vercel docs | **Verified by documentation**; route sets `maxDuration = 60` |
| A10 | In-memory rate limits/cache are per-instance on serverless | Platform behavior | **Known limitation**; KV adapter is provided and recommended |
| A11 | A free stable Gemini model accepts inline images and structured JSON | Official docs read 2026-11-26; `SPIKES.md` §7 | **Verified by documentation**, not live |
| A12 | camelCase `responseSchema` is accepted by live v1beta REST | Official JS examples and protobuf JSON aliases | **Assumed**; no key was available; tests assert the outgoing body |
| A13 | Numeric free-tier RPM/RPD limits | Signed-in AI Studio page required; docs say limits are not guaranteed | **Unverified**; app enforces its own 10/IP/hour and 200/day ceilings |
| A14 | Free-tier content may be used to improve Google products | Official model card | **Verified by documentation**; exact privacy notice shown in UI |

## 4. Non-goals

Accounts, price history/charts, alerts, automatic trust in a photo guess, non-beauty categories,
scraping behind login, checkout integration, claims about product efficacy, and "complete market
coverage". The UI always says the result set is partial.

## 5. Architecture

```
                 ┌──────────────────────────────┐
  user input ───▶│ /api/detect                  │  URL: safe fetch + extract
  (URL or text)  │  -> ProductQuery + preview    │  text: parse + normalize
                 └──────────────┬───────────────┘
   label photo ──▶ /api/detect-image ──> Gemini REST ──> sanitized guess ──┐
   (optional)       10/IP/hour, 200/day ceiling                            │
                                │                                        │
                                └────── user confirms/edits ◀────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ POST /api/search (SSE)       │
                 │  rate limit + daily ceiling  │
                 │  cache / single-flight       │
                 └──────────────┬───────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  StoreAdapter[]          Serper discovery         (optional) direct URL
  (no credits)            (budgeted credits)        listing
        │                       │
        └───────────┬───────────┘
                    ▼
          fetch + extract (safe HTTP, caps)
                    ▼
          match + dedupe + rank (pure)
                    ▼
          stream `listing` events, then `done`
```

Detailed module map: `ARCHITECTURE.md`. Data contracts: `DATA_MODEL.md`.

## 6. Core interfaces

```ts
// Adapter boundary. Adding a store = one file + one registry line.
export interface StoreAdapter {
  id: string;
  domain: string;
  search(q: ProductQuery, ctx: AdapterContext): Promise<RawListing[]>;
}

export interface AdapterContext {
  fetch: SafeFetch;          // SSRF-guarded, timeout/size capped
  timeoutMs: number;
  logger: Logger;
  signal?: AbortSignal;
  now: () => Date;           // injectable clock for deterministic fetchedAt
}

// Discovery channel. Returns candidate URLs, never prices.
export interface Discovery {
  discover(q: ProductQuery, budget: CreditBudget, ctx: Ctx): Promise<Candidate[]>;
}

// Cache: in-memory by default, Upstash/KV-ready.
export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// Safe fetch: validates URL, pins DNS, re-validates redirects, caps bytes/time.
export interface SafeFetch {
  html(url: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<FetchedPage>;
}

// Optional image entry point. The guess is untrusted until the user confirms it.
export interface ProductGuess {
  brand: string | null;
  name: string | null;
  size: string | null;
  confidence: number; // 0..1
}

export function identifyProduct(
  input: { imageBase64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" },
  deps: { apiKey: string; model: string; fetch: typeof fetch },
): Promise<ProductGuess>;
```

The pipeline is dependency-injected so integration tests can supply fake adapters and a fake fetch.
No module reaches for global state except the default singletons in `src/lib/container.ts`.

## 7. Data flow and failure isolation

- Adapters and Serper run in parallel. Each has its own timeout, one jittered retry, and a circuit
  breaker (3 consecutive failures → open 60 s → half-open).
- A failed source contributes a `source` event with `status: "error"` and an error class. It never
  rejects the request.
- Page fetches are capped at 25 per request, concurrency 6, 8 s each, 2 MB each, with a 500 ms
  per-domain delay. A timeout yields a skipped candidate, not a failed request.
- The final event is always sent (even if zero listings) with coverage and budget.
- `AbortSignal` from the HTTP request cancels outstanding work; SSE writes stop on disconnect.

## 8. Matching and ranking

Matching is deterministic and unit-tested:

1. Normalize brand/name (case, punctuation, aliases such as `Dr.Althea` → `dr althea`).
2. Parse size into a canonical `{value, unit: "g" | "ml"}`. `oz` → g, `fl oz` → ml. Mass and volume
   are never converted into each other.
3. Score = `0.45 × token coverage + 0.35 × brand signal + 0.20 × size signal`.
   - Missing signals are neutral (0.5), never penalized.
   - Below `0.55` (`CONFIG.matchThreshold`) → discard.
   - Size differs by more than 5 % → keep, flag `different-size`, exclude from Cheapest unless
     `includeDifferentSizes` is true.
   - Different unit family → flag `size-unit-mismatch`, same exclusion.
4. Dedupe by seller domain, keeping the highest match score, then the lowest price.

Ranking is a pure function with one weights object:

```ts
export const RANK_WEIGHTS = {
  price: 0.50,
  stock: 0.20,
  delivery: 0.15,
  trust: 0.15,
} as const;
```

- Price score = `minPrice / price` (cheapest = 1). Missing price = neutral 0.5, but such a listing
  can never be Cheapest.
- Stock: in stock = 1, out of stock = 0.1, unknown = 0.5.
- Delivery: city match or "across Nepal" = 1, unknown = 0.5, explicitly excluded = 0.
- Trust: average of stated authenticity, physical pickup, reviews; unknown = 0.5.
- Badges: Cheapest (lowest eligible price), Best value (highest composite), Closest (location match;
  only shown when at least one listing has a location).
- Reasons are templates, no LLM.

## 9. Caching, rate limiting, and budgets

- Cache key: `npc:v1:search:<normalized brand|name|size>` (city-independent). TTL 6 h; stale window
  24 h. Serve stale immediately and revalidate best-effort (single-flight).
- Single-flight: concurrent identical keys share one pipeline promise.
- Per-IP limit: 10 searches/hour on `/api/search` (in-memory or Upstash).
- Serper credits: max 8 per uncached search, max 3 query variants, page 1 always, page 2 only if
  page 1 has ≥ 3 Nepal-relevant results, page 3 only if page 2 added a new Nepali store (and the
  per-request page cap is 2, so v1 never actually reaches page 3; the rule is encoded and tested).
- Global daily ceiling: `SERPER_DAILY_CREDIT_CEILING` (default 100). Fail closed with a friendly
  message. The counter is in-memory by default and resets on cold start; use Upstash for a durable
  ceiling.

## 10. Security model

The app fetches user-supplied URLs, so the URL validator is a security boundary:

- Only `http:`/`https:`, no credentials, no empty host.
- Resolve DNS and reject private, loopback, link-local, CGNAT, multicast, reserved, documentation,
  cloud-metadata, IPv6 unique-local/link-local, and IPv4-mapped IPv6 ranges.
- Re-validate on every redirect (max 3) and pin the resolved IP for the request.
- Enforce 8 s timeout, 2 MB cap, `text/html` allowlist, and no automatic redirect following.
- Never render fetched HTML. React escapes text; no `dangerouslySetInnerHTML`.
- Strict CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `frame-ancestors 'none'`.
- Secrets are server-only env vars. Logs include request IDs, never secrets or full user URLs with
  query strings (URLs are logged as origin + path only).
- Image bytes are checked against magic bytes and a 3 MB cap; the Gemini key is sent in a header, not
  a URL. Model output is parsed defensively, capped, stripped of control characters, and rendered as
  text. Upstream error bodies are never returned; MCP file paths must stay inside the project.

## 11. Observability

- One JSON line per event: `{ ts, level, event, requestId, ...fields }`.
- Per-source: `sourceId`, `status`, `durationMs`, `errorClass`, `listingCount`.
- Per-request: credits spent, cache hit/miss, fetch count, total duration.
- `/api/detect-image` logs `requestId`, `status`, `durationMs`, and `confidence`; never the image or
  API key. Errors log only typed codes or error classes.
- `/api/health` returns version, uptime, Serper/Gemini/KV configuration booleans, and cache mode.
- Dev-only debug panel in the UI shows budget and per-source timings.

## 12. UX

Mobile-first single page:

1. One input (URL or product name), optional city selector.
2. Detected-product card, editable (name, brand, size, city), with warnings for missing size and, for
   photos, confidence below 0.5. A skeleton appears while Gemini is working.
3. Top-3 cards: Cheapest, Best value, Closest to city (omitted honestly when data is missing).
4. Full sortable table with seller, price, per-unit, stock, location, delivery, match, fetched at,
   and a source link.
5. Coverage line: "checked 8, responded 6, listings 5" plus credits used and cache status.
6. Loading skeletons per source; empty and error states; "paste another store's link" box.
7. Accessible labels, keyboard-sortable table headers, visible focus, contrast-checked palette.

## 13. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Store HTML changes | Adapter returns wrong/empty data | Saved-HTML contract tests with golden output; adapter errors are isolated |
| Serper quota exhaustion | Discovery degrades | Adapters are primary; hard budget; daily ceiling; friendly message |
| In-memory cache/rate limit on serverless | Limits are per-instance | KV-ready interface; document; recommend Upstash |
| Price/stock stale up to 6 h | Wrong price shown | Show `fetchedAt`; link to seller; "verify on seller site" |
| False match | User sees wrong product | Similarity threshold; size flag; editable query; "different size" excluded from Cheapest |
| SSRF bypass | Server-side request to internal network | Deny-by-default IP ranges, DNS pinning, redirect re-validation, dedicated test suite |
| Gemini quota or bad extraction | Photo upload unavailable or wrong product | Per-IP limit, global daily ceiling, fail-closed busy message, low-confidence warning, editable card, text fallback |
| Free-tier data use | Private photo leaves the app | Exact privacy notice before upload; no private-photo upload recommended; key stays server-side |
| robots.txt/ToS changes | Legal/ethical risk | Adapters document their allowed paths; no `/wp-json/`; identify with UA; link back |
| Vercel function duration | Truncated stream | `maxDuration = 60`; per-source timeouts; final event always sent |

## 14. Open questions (non-blocking for v1)

1. Should "Cheapest" include out-of-stock listings? **Decision:** no; out-of-stock is shown but not
   badged. Revisit if users ask.
2. Should price-per-unit use per 10 g/ml for readability? **Decision:** store per g/ml and display
   per g/ml with 2 decimals; the table header makes the unit explicit.
3. Should delivery be a store-level fact or listing-level? **Decision:** listing-level when extracted;
   Beauty Essentials' store-level text is attached to its listings with the search URL as source.
   Bonjour shows "not listed".
4. Should we add more stores before launch? **Decision:** no. Two adapters prove the pattern; add
   stores after the first real usage data.

## 15. Verification plan

- `npm run typecheck`, `npm run lint`, `npm test` locally and in GitHub Actions.
- Contract tests read real saved HTML from `src/test/fixtures/` and assert golden values.
- Integration test runs the pipeline with three fake adapters: one slow, one failing, one returning
  junk. It asserts the response completes, the failing source is reported, and the slow source does
  not block the final event beyond its timeout.
- Security tests cover IPv4/IPv6/metadata/redirect cases.
- Manual smoke test against the live sites is documented in `README.md` and is opt-in (network
  tests are not part of CI).
- Gemini tests use fake `fetch`, a synthetic PNG, and a recorded response. No CI job calls Gemini or
  spends a free-tier request. Live extraction quality remains unverified until a key is supplied.

## 16. Acceptance mapping

| Milestone | Evidence |
| --- | --- |
| M0 | `DESIGN.md`, `SPIKES.md`, raw captures in `../spikes/` |
| M1 | `src/lib/extract/*` + `bonjour-product.html` fixture test; asserts Dr. Althea / 20 g / NPR 2000 / in stock |
| M2 | `src/lib/adapters/*` + fixtures; failing-adapter integration test |
| M3 | `src/lib/match.ts`, `rank.ts`, unit tests; per-gram and badge tests |
| M4 | `src/lib/serper.ts`, `budget.ts`; paging/credit tests with fake fetch |
| M5 | `/api/search` SSE, cache, rate limit, SSRF tests |
| M6 | UI, README, `.env.example`, Vercel notes, CI |
| M7 | `src/lib/vision/*`, `/api/detect-image`, MCP tool, `SPIKES.md` §7, fake-fetch tests |
