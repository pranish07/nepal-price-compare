# Spike results (M0)

Date: 2026-11-26. All requests used `User-Agent: NepalPriceCompare/0.1 (+contact: dev@example.com)`.
Raw captures are in `spikes/`.

## 1. Does bonjournp.com expose `/wp-json/wc/store/v1/products?search=...`?

**Yes, but we will not use it.**

- `GET https://bonjournp.com/wp-json/wc/store/v1/products?search=dr%20althea&per_page=5` → `200`, body `[]`.
- `GET https://bonjournp.com/wp-json/wc/store/v1/products?per_page=2` → `200`, 26,690 bytes, valid WooCommerce Store API JSON.
- The endpoint exists and returns full product JSON.

**Blocker:** `https://bonjournp.com/robots.txt` contains `Disallow: /wp-json/`. Using it would violate
the project's robots.txt constraint, even though the endpoint is technically public. Decision: do not
call it.

**Working alternative (verified):** `GET https://bonjournp.com/shop/?s=dr+althea` → `200`, 247 KB,
14 unique product URLs including the M1 product. `robots.txt` disallows `/?s=` (root) but not
`/shop/?s=`, and explicitly allows `/shop/`, `/product/`, `/product-category/`. The HTML contains
title, current price, original price, image, and `instock`/`outofstock` in the card class.

Caveat: `/shop/?s=` took 2.7–2.9 s in two samples. The 8 s fetch timeout covers it, but it is the
slowest adapter and is marked as such in the UI debug panel.

## 2. How does beautyessentials.com.np expose product search?

**Server-rendered HTML with an embedded JSON payload.** No API key, no credits.

- `GET https://beautyessentials.com.np/shop?search=dr+althea` → `200`, 791 KB.
- `GET https://beautyessentials.com.np/search?q=...` → `404` (the `/search` path does not exist).
- The working URL is `/shop?search=<query>`; `q`, `query`, and `products?search=` are ignored or 404.

The page is a Next.js App Router page. It embeds a complete product response in the RSC flight data:

```
initialProductsResponse\":{
  "success":true,
  "data":[
    {
      "name":"Melaclear Cream",
      "slug":"melaclear-cream",
      "category":{"name":"Moisturizer","slug":"moisturizer"},
      "brand":{"name":"Dr. Althea","slug":"dr-althea"},
      "variants":[{"variantName":"20g","price":3000,"salePrice":2700,"stockQuantity":3}],
      "featuredImage":"https://ik.imagekit.io/...",
      "priceMin":2700,"priceMax":2700
    }
  ],
  "meta":{...}
}
```

The array had 17 products for `dr althea`, including all expected variants. This is richer than the
Bonjour card HTML: brand, size, sale price, and exact stock quantity are all present. The extraction
approach (balanced-brace scan, then double JSON decode) is proven in `spikes/parse_probe.mjs`.

The same search page also contains store-level facts: `Dharan, Sunsari, Nepal`,
`Free delivery in Dharan`, `Delivery across Nepal`, `Cash on delivery in Dharan`. We can attach these
to listings with the search URL as the source.

Product detail pages are 1.3 MB and do not expose `product:price:amount` meta tags. They do embed the
same product JSON in RSC data, but the adapter does not need detail pages because the search payload
already has price, stock, size, brand, and image.

## 3. Does Serper return more than 10 organic results when `num > 10`?

**Unverified.** No `SERPER_API_KEY` was available in this environment, so no live call was made.
We will not claim otherwise.

What the public documentation says (third-party OpenAPI mirrors and a 2026-08-08 unofficial reference):

- `num` is documented as `1–100`.
- Third-party notes say `11–100` results may consume **2 credits** per call, while `1–10` consumes 1.
- The project brief explicitly says not to assume `num` is honored.

**Decision:** do not depend on `num`. Request `num: 10` and paginate with `page`. Each call is
budgeted as 1 credit, and the budget object throws if a call would exceed 8. A live verification
script is provided at `scripts/verify-serper.mjs`; it must be run with a real key before relying on
any `num > 10` behavior.

## 4. Do both sites allow the planned requests per robots.txt?

| Site | Path | robots.txt | Verdict |
| --- | --- | --- | --- |
| bonjournp.com | `/shop/?s=<query>` | `Allow: /shop/`; `Disallow: /?s=` only matches root query | **Allowed** |
| bonjournp.com | `/product/<slug>/` | `Allow: /product/` | **Allowed** |
| bonjournp.com | `/wp-json/...` | `Disallow: /wp-json/` | **Blocked — not used** |
| beautyessentials.com.np | `/shop?search=<query>` | `Allow: /`; disallows `/dashboard`, `/checkout`, `/cart`, `/sign-in`, `/sign-up`, `/unauthorized` | **Allowed** |
| beautyessentials.com.np | `/shop/<category>/<slug>` | `Allow: /` | **Allowed** |

Neither site requires login for the pages we fetch. We identify with a clear User-Agent, keep
concurrency low, and link every result back to the seller.

## 5. Additional findings

- Bonjour's `/shop/?s=` result set included an out-of-stock item (`outofstock` in the card class), so
  stock is observable from the search page without a detail fetch.
- Beauty Essentials search result order was "newest" by default; we do not rely on order.
- Both sites return HTML well under the 2 MB cap (247 KB and 791 KB). The 2 MB cap is still enforced.
- Beauty Essentials is a Next.js app; its `robots.txt` `Host` directive and sitemap are present.
- Bonjour's sitemap root returns `301`; not needed for v1.

## 6. Live discovery-query check (M6 smoke test)

A live probe on 2026-11-26 compared the full detected name with a broader term:

| Store | Query | Result |
| --- | --- | --- |
| bonjournp.com | `Dr. Althea Melaclear Cream` | 6 product cards, none matching the target |
| bonjournp.com | `dr althea` | 11 product cards, including `Dr.Althea Melaclear Cream – 20 g` |
| bonjournp.com | `Melaclear` | 6 unrelated cards |
| beautyessentials.com.np | `Dr. Althea Melaclear Cream` | `initialProductsResponse.data` length 0 |
| beautyessentials.com.np | `dr althea` | 17 products, including `Melaclear Cream` |
| beautyessentials.com.np | `Melaclear` | 1 product, `Melaclear Cream` |

Conclusion: store search should use the brand alone when known, or the most distinctive name token
otherwise. Exact-product matching remains a separate local step. This changed `searchText` and is
recorded as decision D21 in `DECISIONS.md`.

## Reproduction

```bash
cd spikes
node parse_probe.mjs                 # proves beauty payload extraction
# raw captures: bonjour_shop_search.html, bonjour_product.html,
#               beauty_shop_search_dr_althea.html, beauty_product.html
```
