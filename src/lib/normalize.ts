import { parseSize, stripSize } from "./size";
import type { ProductQuery, Size } from "./types";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "of", "on", "or", "the", "to", "with", "x",
  "new", "original", "authentic", "genuine", "official", "buy", "online", "shop",
  "nepal", "nepali", "kathmandu", "price", "sale", "best", "free", "delivery",
  "available", "stock", "instock", "outofstock", "ml", "gm", "gms", "oz",
]);

/**
 * Tokens that describe a product category rather than a specific product.
 * They count for much less during matching, so "345 Relief Cream" cannot match
 * "Melaclear Cream" on the shared word "cream" alone.
 */
export const GENERIC_TOKENS = new Set([
  "cream", "serum", "toner", "cleanser", "lotion", "moisturizer", "moisturiser",
  "sunscreen", "sunblock", "mask", "essence", "ampoule", "mist", "gel", "foam",
  "balm", "oil", "patch", "patches", "set", "kit", "mini", "travel", "size",
  "spf", "pa", "plus", "ex", "refill", "stick", "cushion", "foundation", "lip",
  "eye", "face", "body", "hair", "scalp", "shampoo", "conditioner", "treatment",
  "peel", "pad", "pads", "sheet", "wash", "water", "milk", "butter", "bar",
  "powder", "pencil", "liner", "tint", "gloss", "mascara", "primer", "concealer",
  "blush", "highlighter", "bronzer", "setting", "spray", "fixer", "tonerpad",
  "skin", "care", "beauty", "product", "products", "item",
]);

interface BrandEntry {
  canonical: string;
  aliases: string[];
}

/**
 * A deliberately small, editable brand dictionary. Unknown brands still work:
 * matching falls back to name tokens and treats a missing brand as neutral.
 */
const BRANDS: BrandEntry[] = [
  { canonical: "Dr. Althea", aliases: ["dr althea", "dr.althea", "dralthea"] },
  { canonical: "Beauty of Joseon", aliases: ["beauty of joseon", "boj"] },
  { canonical: "SKIN1004", aliases: ["skin1004", "skin 1004"] },
  { canonical: "COSRX", aliases: ["cosrx"] },
  { canonical: "Anua", aliases: ["anua"] },
  { canonical: "Round Lab", aliases: ["round lab", "roundlab"] },
  { canonical: "Isntree", aliases: ["isntree", "isn tree"] },
  { canonical: "Torriden", aliases: ["torriden"] },
  { canonical: "Numbuzin", aliases: ["numbuzin", "no numbuzin"] },
  { canonical: "Some By Mi", aliases: ["some by mi", "somebymi"] },
  { canonical: "Purito", aliases: ["purito"] },
  { canonical: "Dear Klairs", aliases: ["dear klairs", "klairs"] },
  { canonical: "Laneige", aliases: ["laneige"] },
  { canonical: "Innisfree", aliases: ["innisfree"] },
  { canonical: "Etude House", aliases: ["etude house", "etude"] },
  { canonical: "Missha", aliases: ["missha"] },
  { canonical: "The Face Shop", aliases: ["the face shop", "face shop"] },
  { canonical: "Sulwhasoo", aliases: ["sulwhasoo"] },
  { canonical: "Hada Labo", aliases: ["hada labo", "hadalabo"] },
  { canonical: "CeraVe", aliases: ["cerave"] },
  { canonical: "Cetaphil", aliases: ["cetaphil"] },
  { canonical: "La Roche-Posay", aliases: ["la roche posay", "la roche-posay", "laroche posay"] },
  { canonical: "Neutrogena", aliases: ["neutrogena"] },
  { canonical: "The Ordinary", aliases: ["the ordinary", "ordinary"] },
  { canonical: "Paula's Choice", aliases: ["paulas choice", "paula's choice"] },
  { canonical: "Bioderma", aliases: ["bioderma"] },
  { canonical: "Avene", aliases: ["avene", "avène"] },
  { canonical: "Simple", aliases: ["simple"] },
  { canonical: "Garnier", aliases: ["garnier"] },
  { canonical: "Maybelline", aliases: ["maybelline"] },
  { canonical: "L'Oreal", aliases: ["loreal", "l'oreal", "l oreal"] },
  { canonical: "Nivea", aliases: ["nivea"] },
  { canonical: "Vaseline", aliases: ["vaseline"] },
  { canonical: "Sebamed", aliases: ["sebamed"] },
  { canonical: "Minimalist", aliases: ["minimalist"] },
  { canonical: "Plum", aliases: ["plum"] },
  { canonical: "Mamaearth", aliases: ["mamaearth"] },
  { canonical: "Dot & Key", aliases: ["dot and key", "dot & key"] },
  { canonical: "Axis-Y", aliases: ["axis y", "axis-y"] },
  { canonical: "Pyunkang Yul", aliases: ["pyunkang yul"] },
  { canonical: "I'm From", aliases: ["im from", "i'm from"] },
  { canonical: "Jumiso", aliases: ["jumiso"] },
  { canonical: "Kaine", aliases: ["kaine"] },
  { canonical: "Mixsoon", aliases: ["mixsoon"] },
  { canonical: "Mediheal", aliases: ["mediheal"] },
  { canonical: "Abib", aliases: ["abib"] },
  { canonical: "Dr. Jart+", aliases: ["dr jart", "dr. jart+", "dr jart+"] },
  { canonical: "Haruharu Wonder", aliases: ["haruharu wonder", "haruharu"] },
  { canonical: "Heimish", aliases: ["heimish"] },
  { canonical: "Banila Co", aliases: ["banila co", "banila"] },
  { canonical: "Benton", aliases: ["benton"] },
  { canonical: "Holika Holika", aliases: ["holika holika"] },
  { canonical: "Peripera", aliases: ["peripera"] },
  { canonical: "Rom&nd", aliases: ["romand", "rom&nd", "rom and"] },
  { canonical: "Clio", aliases: ["clio"] },
  { canonical: "3CE", aliases: ["3ce"] },
  { canonical: "Unleashia", aliases: ["unleashia"] },
  { canonical: "Hince", aliases: ["hince"] },
  { canonical: "Espoir", aliases: ["espoir"] },
  { canonical: "Beplain", aliases: ["beplain"] },
  { canonical: "Illiyoon", aliases: ["illiyoon"] },
  { canonical: "Aestura", aliases: ["aestura"] },
  { canonical: "Real Barrier", aliases: ["real barrier"] },
  { canonical: "Make P:rem", aliases: ["make prem", "makeprem"] },
  { canonical: "Hikari", aliases: ["hikari"] },
  { canonical: "Frudia", aliases: ["frudia"] },
  { canonical: "Elizavecca", aliases: ["elizavecca"] },
  { canonical: "Secret Key", aliases: ["secret key"] },
  { canonical: "A'pieu", aliases: ["apieu", "a'pieu"] },
  { canonical: "Nature Republic", aliases: ["nature republic"] },
  { canonical: "Skinfood", aliases: ["skinfood"] },
  { canonical: "The Saem", aliases: ["the saem"] },
  { canonical: "Sidmool", aliases: ["sidmool"] },
  { canonical: "Atopalm", aliases: ["atopalm"] },
  { canonical: "Zeroid", aliases: ["zeroid"] },
  { canonical: "One Thing", aliases: ["one thing"] },
];

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** `Dr.Althea` → `dr althea`, `L'Oréal` → `loreal`. */
export function normalizeBrand(value: string): string {
  return normalizeWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, " "),
  );
}

/** Normalizes free text for token comparison. Numbers are preserved. */
export function normalizeName(value: string): string {
  return normalizeWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, " "),
  );
}

export function tokenize(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

interface NormalizedBrandEntry {
  canonical: string;
  alias: string;
}

const NORMALIZED_BRANDS: NormalizedBrandEntry[] = BRANDS.flatMap((brand) =>
  brand.aliases.map((alias) => ({ canonical: brand.canonical, alias: normalizeBrand(alias) })),
).sort((a, b) => b.alias.length - a.alias.length);

/** Finds the longest known brand alias present as a whole phrase. */
export function detectBrand(text: string): string | undefined {
  const normalized = ` ${normalizeName(text)} `;
  for (const entry of NORMALIZED_BRANDS) {
    if (normalized.includes(` ${entry.alias} `)) return entry.canonical;
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandRegex(alias: string): RegExp {
  const words = normalizeBrand(alias).split(" ").filter(Boolean).map(escapeRegExp);
  return new RegExp(`(^|[\\s\\-|,])${words.join("[\\s.\\-]*")}(?=[\\s\\-|,]|$)`, "i");
}

/** Removes the detected brand from a title, tolerating `Dr.Althea` vs `Dr. Althea`. */
export function stripBrand(text: string, brand: string | undefined): string {
  if (!brand) return text;
  const entry = BRANDS.find((b) => b.canonical === brand);
  if (!entry) return text;
  let result = text;
  for (const alias of entry.aliases) {
    const next = result.replace(brandRegex(alias), " ");
    if (next !== result) {
      result = next;
      break;
    }
  }
  return normalizeWhitespace(result);
}

const STORE_SUFFIXES = [
  /[-–—|]\s*bonjour\s+nepal\s*$/i,
  /[-–—|]\s*beauty\s+essentials\s*$/i,
  /\|\s*bonjour\s+nepal\s*$/i,
  /\|\s*beauty\s+essentials\s*$/i,
];

export function cleanProductName(raw: string, brand?: string): string {
  let value = normalizeWhitespace(raw);
  for (const suffix of STORE_SUFFIXES) value = value.replace(suffix, " ");
  value = stripBrand(value, brand);
  value = stripSize(value);
  value = value
    .replace(/^[\s\-–—|,:;]+/, "")
    .replace(/[\s\-–—|,:;]+$/, "")
    .replace(/^new\s+/i, "")
    .replace(/^authentic\s+/i, "")
    .replace(/^original\s+/i, "");
  value = normalizeWhitespace(value);
  return value || normalizeWhitespace(stripSize(raw)) || normalizeWhitespace(raw);
}

export interface ParsedProductText {
  name: string;
  brand?: string;
  size?: Size;
}

/**
 * Parses a typed product name. Size is optional: the UI asks for it when it is
 * missing, because price-per-unit is otherwise impossible to compute honestly.
 */
export function parseProductText(text: string): ParsedProductText {
  const brand = detectBrand(text);
  const size = parseSize(text) ?? undefined;
  const name = cleanProductName(text, brand);
  return {
    name,
    ...(brand ? { brand } : {}),
    ...(size ? { size: { value: size.value, unit: size.unit } } : {}),
  };
}

/**
 * Builds a deliberately broad store-discovery term. Store search engines often
 * return irrelevant or zero results for a full "brand + product + size" phrase,
 * so we query the brand when known, otherwise the most distinctive name token.
 * Exact-product matching happens later in matchListing, not in the store query.
 */
export function searchText(query: Pick<ProductQuery, "name" | "brand">): string {
  const brand = normalizeWhitespace(query.brand ?? "");
  if (brand) return brand;

  const name = normalizeWhitespace(query.name);
  const distinctive = tokenize(name).find((token) => !GENERIC_TOKENS.has(token));
  return distinctive ?? name;
}

export function normalizeCity(value: string | undefined): string {
  return value ? normalizeName(value) : "";
}

/** City-independent cache key. Size is part of the key; city is not. */
export function normalizeQueryKey(query: ProductQuery): string {
  const brand = query.brand ? normalizeBrand(query.brand) : "";
  const name = normalizeName(query.name);
  const size = query.size
    ? `${Math.round(query.size.value * 1000) / 1000}${query.size.unit}`
    : "";
  return `${brand}|${name}|${size}`;
}

export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return Boolean(url.hostname.includes(".")) && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}
