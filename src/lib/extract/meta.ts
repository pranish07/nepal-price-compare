import type { CheerioAPI } from "cheerio";
import { parsePrice } from "../price";
import { parseSize } from "../size";
import type { Size } from "../types";

export interface MetaProduct {
  title?: string;
  brand?: string;
  price?: number;
  currency?: string;
  availability?: string;
  image?: string;
  siteName?: string;
  size?: Size;
}

function contentFor($: CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content") ?? $(selector).first().text();
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractMeta($: CheerioAPI): MetaProduct {
  const title =
    contentFor($, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]',
    ]) ?? ($("title").first().text().trim() || undefined);

  const priceText = contentFor($, [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[property="product:sale_price:amount"]',
    'meta[itemprop="price"]',
    'meta[name="price"]',
  ]);

  const currency = contentFor($, [
    'meta[property="product:price:currency"]',
    'meta[property="og:price:currency"]',
    'meta[itemprop="priceCurrency"]',
  ]);

  const availability = contentFor($, [
    'meta[property="product:availability"]',
    'meta[property="og:availability"]',
  ]);

  const image = contentFor($, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);

  const brand = contentFor($, [
    'meta[property="product:brand"]',
    'meta[property="og:brand"]',
  ]);

  const sizeText = contentFor($, [
    'meta[property="product:size"]',
    'meta[name="size"]',
  ]);

  const parsedSize = parseSize(sizeText ?? title);

  return {
    title,
    brand,
    price: priceText ? (parsePrice(priceText) ?? undefined) : undefined,
    currency,
    availability,
    image,
    siteName: contentFor($, ['meta[property="og:site_name"]']),
    size: parsedSize ? { value: parsedSize.value, unit: parsedSize.unit } : undefined,
  };
}
