import type { CheerioAPI } from "cheerio";
import { parseSize } from "../size";
import type { Size } from "../types";

export interface JsonLdProduct {
  name?: string;
  brand?: string;
  price?: number;
  currency?: string;
  originalPrice?: number;
  availability?: string;
  image?: string;
  url?: string;
  size?: Size;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function typeIncludesProduct(value: unknown): boolean {
  if (typeof value === "string") return value.toLowerCase().includes("product");
  if (Array.isArray(value)) return value.some(typeIncludesProduct);
  return false;
}

function brandName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isObject(value)) return asString(value.name);
  return undefined;
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (isObject(value)) return asString(value.url) ?? asString(value.contentUrl);
  return undefined;
}

function offerFrom(value: unknown): JsonObject | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const offer = offerFrom(item);
      if (offer) return offer;
    }
    return undefined;
  }
  return isObject(value) ? value : undefined;
}

function collectNodes(value: unknown, out: JsonObject[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }
  if (!isObject(value)) return;
  if (typeIncludesProduct(value["@type"])) out.push(value);
  if (Array.isArray(value["@graph"])) collectNodes(value["@graph"], out);
}

function fromProductNode(node: JsonObject): JsonLdProduct {
  const offers = offerFrom(node.offers);
  const price =
    asNumber(offers?.price) ??
    asNumber(offers?.lowPrice) ??
    asNumber(node.price);
  const currency =
    asString(offers?.priceCurrency) ?? asString(node.priceCurrency);
  const availability =
    asString(offers?.availability) ?? asString(node.availability);
  const name = asString(node.name);
  const sizeText =
    asString(node.size) ??
    asString((node as { weight?: unknown }).weight) ??
    name;
  const parsedSize = sizeText ? parseSize(sizeText) : null;

  return {
    name,
    brand: brandName(node.brand),
    price,
    currency,
    originalPrice: asNumber(offers?.highPrice),
    availability,
    image: imageUrl(node.image),
    url: asString(offers?.url) ?? asString(node.url),
    size: parsedSize ? { value: parsedSize.value, unit: parsedSize.unit } : undefined,
  };
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Handles JSON-LD that has been escaped once or twice inside Next.js RSC data. */
function parseEscapedJson(raw: string): unknown {
  let value: unknown = tryParseJson(raw);
  if (value !== undefined) return value;
  let current = raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const unescaped = JSON.parse(`"${current}"`) as string;
      value = tryParseJson(unescaped);
      if (value !== undefined) return value;
      current = unescaped;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Fallback for product JSON-LD embedded in a JS/RSC string rather than a real
 * <script type="application/ld+json"> tag (Beauty Essentials does this).
 */
function extractEmbeddedProductJsonLd(html: string): JsonLdProduct | undefined {
  const marker = html.search(/@type\\*"\s*:\s*\\*"Product/);
  if (marker === -1) return undefined;
  const start = html.lastIndexOf("{", marker);
  if (start === -1) return undefined;

  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        const parsed = parseEscapedJson(html.slice(start, i + 1));
        if (isObject(parsed)) return fromProductNode(parsed);
        return undefined;
      }
    }
  }
  return undefined;
}

export function extractJsonLd($: CheerioAPI, html: string): JsonLdProduct | undefined {
  const products: JsonLdProduct[] = [];

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;
    const parsed = tryParseJson(raw);
    if (parsed === undefined) return;
    const nodes: JsonObject[] = [];
    collectNodes(parsed, nodes);
    for (const node of nodes) products.push(fromProductNode(node));
  });

  const best = products.find((product) => product.price !== undefined) ?? products[0];
  return best ?? extractEmbeddedProductJsonLd(html);
}
