import type { CheerioAPI } from "cheerio";
import { parsePrice } from "../price";
import { parseSize } from "../size";
import type { Size } from "../types";

export interface DomProduct {
  title?: string;
  price?: number;
  originalPrice?: number;
  inStock?: boolean;
  image?: string;
  size?: Size;
}

function firstText($: CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = $(selector).first();
    const text = element.attr("content") ?? element.text();
    if (text && text.trim()) return text.trim();
  }
  return undefined;
}

function firstAttr($: CheerioAPI, selectors: string[], attribute: string): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().attr(attribute);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractDom($: CheerioAPI): DomProduct {
  const title = firstText($, [
    'h1[itemprop="name"]',
    "h1.product_title",
    "h1.product-title",
    "h1",
    '[itemprop="name"]',
  ]);

  const priceText = firstText($, [
    '.price ins .amount',
    ".price ins",
    '[itemprop="price"]',
    ".product-price .amount",
    ".product-price",
    ".price .amount",
    ".price",
    "[data-price]",
  ]);

  const originalText = firstText($, [
    ".price del .amount",
    ".price del",
    ".old-price",
    ".regular-price",
    ".was-price",
  ]);

  const availability =
    firstAttr($, ['[itemprop="availability"]'], "href") ??
    firstAttr($, ['[itemprop="availability"]'], "content") ??
    firstText($, [".stock", ".availability", ".product-stock"]);

  const bodyText = $("body").text().replace(/\s+/g, " ").toLowerCase();
  const hasOutOfStockClass = $('[class*="outofstock"], [class*="out-of-stock"]').length > 0;

  let inStock: boolean | undefined;
  if (availability) {
    if (/instock|in stock/i.test(availability)) inStock = true;
    else if (/outofstock|out of stock|soldout|sold out/i.test(availability)) inStock = false;
  }
  if (inStock === undefined && hasOutOfStockClass) inStock = false;
  if (inStock === undefined) {
    if (/out of stock|sold out/.test(bodyText)) inStock = false;
    else if (/in stock|add to cart/.test(bodyText)) inStock = true;
  }

  const image = firstAttr($, ['[itemprop="image"]'], "src") ??
    firstAttr($, ['[itemprop="image"]'], "content") ??
    firstAttr($, [".product img", "main img", "img"], "src");

  const parsedSize = parseSize(title);

  return {
    title,
    price: priceText ? (parsePrice(priceText) ?? undefined) : undefined,
    originalPrice: originalText ? (parsePrice(originalText) ?? undefined) : undefined,
    inStock,
    image,
    size: parsedSize ? { value: parsedSize.value, unit: parsedSize.unit } : undefined,
  };
}

export interface StoreSignals {
  location?: string;
  delivery?: string;
}

/**
 * Store-level facts that appear on the page itself. We only return text that is
 * literally present; nothing is inferred from the domain or the store name.
 */
export function extractStoreSignals(html: string): StoreSignals {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  const locationMatch = text.match(
    /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?),\s*(?:[A-Z][a-zA-Z]+,\s*)?Nepal\b/,
  );
  // Page text often prefixes the address with a label such as "INFO" or
  // "ADDRESS". Those labels are not part of the location.
  const location = locationMatch?.[0]
    .replace(/^(?:[A-Z]{2,}\s+)+/, "")
    .trim();

  // Work on short segments so a delivery sentence cannot swallow navigation,
  // phone numbers, or other store copy that happens to follow it.
  const segments = text
    .split(/[.;·|•]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const findSegment = (pattern: RegExp): string | undefined => {
    for (const segment of segments) {
      const match = segment.match(pattern);
      if (match?.[0]) return match[0].trim();
    }
    return undefined;
  };

  const deliveryParts: string[] = [];
  const freeDelivery = findSegment(
    /Free (?:home )?delivery (?:in|within) [A-Z][a-zA-Z]+/i,
  );
  if (freeDelivery) deliveryParts.push(freeDelivery);
  const acrossNepal = findSegment(/Delivery across Nepal\b[^.;·|•]{0,60}/i);
  if (acrossNepal) deliveryParts.push(acrossNepal);
  const cashOnDelivery = findSegment(/Cash on delivery in [A-Z][a-zA-Z]+/i);
  if (cashOnDelivery) deliveryParts.push(cashOnDelivery);

  return {
    ...(location ? { location } : {}),
    delivery: deliveryParts.length > 0 ? [...new Set(deliveryParts)].join("; ") : undefined,
  };
}
