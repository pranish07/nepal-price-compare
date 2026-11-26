import { load } from "cheerio";
import { detectBrand, searchText } from "../normalize";
import { parsePrice } from "../price";
import { parseSize } from "../size";
import type { RawListing } from "../types";
import { AdapterError, type AdapterContext, type StoreAdapter } from "./types";

const BASE_URL = "https://bonjournp.com";

function textOf(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Bonjour Nepal is WooCommerce. robots.txt disallows /wp-json/ but allows
 * /shop/, /product/, and /product-category/. We therefore use the HTML search
 * page at /shop/?s=..., which is allowed and needs no API key.
 */
export const bonjourAdapter: StoreAdapter = {
  id: "bonjour",
  domain: "bonjournp.com",
  label: "Bonjour Nepal",

  async search(query, ctx: AdapterContext): Promise<RawListing[]> {
    const searchUrl = `${BASE_URL}/shop/?s=${encodeURIComponent(searchText(query))}`;
    const page = await ctx.fetch.html(searchUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const $ = load(page.body);
    const fetchedAt = ctx.now().toISOString();
    const listings: RawListing[] = [];
    const seen = new Set<string>();

    const cards = $(".wd-product, li.product, .product-grid-item");
    cards.each((_index, element) => {
      const card = $(element);
      const href =
        card.find("h3.wd-entities-title a").attr("href") ??
        card.find("a.product-image-link").attr("href") ??
        card.find("a").first().attr("href");

      if (!href || !href.includes("/product/")) return;
      const url = new URL(href, BASE_URL).toString();
      if (seen.has(url)) return;
      seen.add(url);

      const title = textOf(
        card.find("h3.wd-entities-title a").text() ||
          card.find("img").first().attr("alt"),
      );
      if (!title) return;

      const currentSale = parsePrice(card.find(".price ins .amount").first().text());
      const allAmounts = card
        .find(".price .amount")
        .map((_i, amount) => parsePrice($(amount).text()))
        .get()
        .filter((value): value is number => value !== null);
      const price = currentSale ?? allAmounts[allAmounts.length - 1];
      const originalPrice = parsePrice(card.find(".price del .amount").first().text()) ?? undefined;

      const classNames = card.attr("class") ?? "";
      const inStock = classNames.includes("instock")
        ? true
        : classNames.includes("outofstock")
          ? false
          : undefined;

      const imageHref =
        card.find("img.attachment-medium_large").first().attr("src") ??
        card.find("img").first().attr("src") ??
        card.find("img").first().attr("data-src");

      const size = parseSize(title);
      const brand = detectBrand(title);

      listings.push({
        sellerId: "bonjournp.com",
        sellerName: "Bonjour Nepal",
        url,
        title,
        price: price !== undefined ? { amount: price, currency: "NPR" } : undefined,
        originalPrice:
          originalPrice !== undefined && price !== undefined && originalPrice > price
            ? { amount: originalPrice, currency: "NPR" }
            : undefined,
        size: size ? { value: size.value, unit: size.unit } : undefined,
        inStock,
        image: imageHref ? new URL(imageHref, BASE_URL).toString() : undefined,
        brand,
        fetchedAt,
        source: "adapter",
      });
    });

    if (listings.length === 0 && !/no products were found|no products found/i.test(page.body)) {
      throw new AdapterError(
        "parse_failed",
        "Bonjour search page contained no product cards and no empty-result marker.",
      );
    }

    ctx.logger.info("adapter.search.ok", {
      adapter: "bonjour",
      listings: listings.length,
      durationMs: Date.now() - new Date(fetchedAt).getTime(),
    });

    return listings;
  },
};
