import { load } from "cheerio";
import { cleanProductName, detectBrand } from "../normalize";
import { parseSize } from "../size";
import type { ProductQuery, RawListing } from "../types";
import { extractDom, extractStoreSignals } from "./dom";
import { extractJsonLd } from "./jsonld";
import { extractMeta } from "./meta";

export interface ExtractedProduct {
  query: ProductQuery;
  listing: RawListing;
  warnings: string[];
}

function absoluteHttpUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hostnameSellerId(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function availabilityToStock(availability: string | undefined): boolean | undefined {
  if (!availability) return undefined;
  if (/instock|in stock/i.test(availability)) return true;
  if (/outofstock|out of stock|soldout|sold out/i.test(availability)) return false;
  return undefined;
}

/**
 * Extracts a product using, in order: schema.org JSON-LD, Open Graph/product
 * meta tags, then DOM heuristics. Missing values stay missing.
 */
export function extractProduct(
  html: string,
  finalUrl: string,
  fetchedAt: string,
): ExtractedProduct | null {
  const $ = load(html);
  const jsonld = extractJsonLd($, html);
  const meta = extractMeta($);
  const dom = extractDom($);
  const signals = extractStoreSignals(html);

  const rawTitle = jsonld?.name ?? meta.title ?? dom.title;
  if (!rawTitle) return null;

  const brand = jsonld?.brand ?? meta.brand ?? detectBrand(rawTitle);
  const warnings: string[] = [];

  let price = jsonld?.price ?? meta.price ?? dom.price;
  const statedCurrency = (jsonld?.currency ?? meta.currency ?? "").trim().toUpperCase();
  const looksNepali =
    new URL(finalUrl).hostname.endsWith(".np") ||
    /\bNPR\b|\bRs\.?\s?\d|रू/i.test(html);

  if (price !== undefined) {
    if (statedCurrency && statedCurrency !== "NPR") {
      warnings.push(`Price is listed in ${statedCurrency}, not NPR, so it was not used.`);
      price = undefined;
    } else if (!statedCurrency) {
      if (!looksNepali) {
        warnings.push("The page did not state a currency; NPR was assumed. Verify on the seller site.");
      }
    }
  }

  const availability = jsonld?.availability ?? meta.availability;
  const inStock = availabilityToStock(availability) ?? dom.inStock;
  const size =
    jsonld?.size ??
    meta.size ??
    dom.size ??
    (() => {
      const parsed = parseSize(rawTitle);
      return parsed ? { value: parsed.value, unit: parsed.unit } : undefined;
    })();

  const image = absoluteHttpUrl(jsonld?.image ?? meta.image ?? dom.image, finalUrl);
  const originalPrice =
    jsonld?.originalPrice && price !== undefined && jsonld.originalPrice > price
      ? jsonld.originalPrice
      : dom.originalPrice && price !== undefined && dom.originalPrice > price
        ? dom.originalPrice
        : undefined;

  const sellerId = hostnameSellerId(finalUrl);
  const listing: RawListing = {
    sellerId,
    sellerName: meta.siteName ?? sellerId,
    url: finalUrl,
    title: rawTitle,
    price: price !== undefined ? { amount: price, currency: "NPR" } : undefined,
    originalPrice: originalPrice !== undefined ? { amount: originalPrice, currency: "NPR" } : undefined,
    size,
    inStock,
    location: signals.location,
    delivery: signals.delivery,
    image,
    brand,
    fetchedAt,
    source: "direct",
    ...(signals.location || signals.delivery ? { sourceUrl: finalUrl } : {}),
  };

  if (price === undefined) warnings.push("No price was found on this page.");
  if (!size) warnings.push("No size was found. Add it for a price-per-unit comparison.");

  const query: ProductQuery = {
    name: cleanProductName(rawTitle, brand),
    ...(brand ? { brand } : {}),
    ...(size ? { size } : {}),
  };

  return { query, listing, warnings };
}
