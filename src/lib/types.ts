import { z } from "zod";

/**
 * Canonical size units. Input units such as `oz` are converted by the parser;
 * stored sizes are always mass (g) or volume (ml) and are never converted
 * between families.
 */
export const SizeUnitSchema = z.enum(["g", "ml"]);
export type SizeUnit = z.infer<typeof SizeUnitSchema>;

export const SizeSchema = z.object({
  value: z.number().positive(),
  unit: SizeUnitSchema,
});
export type Size = z.infer<typeof SizeSchema>;

export const ProductQuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(100).optional(),
  size: SizeSchema.optional(),
  city: z.string().trim().min(1).max(80).optional(),
});
export type ProductQuery = z.infer<typeof ProductQuerySchema>;

export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.literal("NPR"),
});
export type Money = z.infer<typeof MoneySchema>;

export const TrustSignalsSchema = z.object({
  authenticityStated: z.boolean().optional(),
  physicalPickup: z.boolean().optional(),
  reviews: z.number().nonnegative().optional(),
});
export type TrustSignals = z.infer<typeof TrustSignalsSchema>;

/**
 * A listing exactly as a source reported it. `source: "direct"` is used by
 * /api/detect previews, which are neither adapter nor Serper results.
 */
export const RawListingSchema = z.object({
  sellerId: z.string().min(1),
  sellerName: z.string().min(1).optional(),
  url: z.url(),
  title: z.string().min(1),
  price: MoneySchema.optional(),
  originalPrice: MoneySchema.optional(),
  size: SizeSchema.optional(),
  inStock: z.boolean().optional(),
  location: z.string().min(1).optional(),
  delivery: z.string().min(1).optional(),
  image: z.url().optional(),
  brand: z.string().min(1).optional(),
  trust: TrustSignalsSchema.optional(),
  /** ISO timestamp of the fetch that produced this listing. */
  fetchedAt: z.iso.datetime(),
  source: z.enum(["adapter", "serper", "direct"]),
  /** URL the store-level facts (location/delivery) came from, if different. */
  sourceUrl: z.url().optional(),
});
export type RawListing = z.infer<typeof RawListingSchema>;

export const PricePerUnitSchema = z.object({
  amount: z.number().nonnegative(),
  unit: SizeUnitSchema,
});
export type PricePerUnit = z.infer<typeof PricePerUnitSchema>;

export const ScoreBreakdownSchema = z.object({
  price: z.number(),
  stock: z.number(),
  delivery: z.number(),
  trust: z.number(),
  total: z.number(),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const ListingSchema = RawListingSchema.extend({
  id: z.string().min(1),
  matchScore: z.number().min(0).max(1),
  pricePerUnit: PricePerUnitSchema.optional(),
  flags: z.array(z.string()),
  rankScore: z.number().optional(),
  scoreBreakdown: ScoreBreakdownSchema.optional(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const BadgeKindSchema = z.enum(["cheapest", "best_value", "closest"]);
export type BadgeKind = z.infer<typeof BadgeKindSchema>;

export const BadgeSchema = z.object({
  kind: BadgeKindSchema,
  listingId: z.string(),
  sellerName: z.string(),
  url: z.url(),
  reason: z.string(),
});
export type Badge = z.infer<typeof BadgeSchema>;

export const SourceStatusSchema = z.enum([
  "ok",
  "error",
  "timeout",
  "skipped",
  "circuit_open",
]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceReportSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["adapter", "serper"]),
  status: SourceStatusSchema,
  durationMs: z.number().nonnegative(),
  listingCount: z.number().int().nonnegative(),
  errorClass: z.string().optional(),
  message: z.string().optional(),
});
export type SourceReport = z.infer<typeof SourceReportSchema>;

export const CoverageSchema = z.object({
  checked: z.number().int().nonnegative(),
  responded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  listings: z.number().int().nonnegative(),
  sources: z.array(SourceReportSchema),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const BudgetReportSchema = z.object({
  creditsUsed: z.number().int().nonnegative(),
  creditsMax: z.number().int().nonnegative(),
  fetchesUsed: z.number().int().nonnegative(),
  fetchesMax: z.number().int().nonnegative(),
  cacheStatus: z.enum(["hit", "miss", "stale", "coalesced"]),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
});
export type BudgetReport = z.infer<typeof BudgetReportSchema>;

export const SearchResultSchema = z.object({
  query: ProductQuerySchema,
  listings: z.array(ListingSchema),
  badges: z.array(BadgeSchema),
  coverage: CoverageSchema,
  budget: BudgetReportSchema,
  generatedAt: z.iso.datetime(),
  notes: z.array(z.string()),
  partial: z.literal(true),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const CachedSearchSchema = z.object({
  query: ProductQuerySchema,
  listings: z.array(ListingSchema),
  coverage: CoverageSchema,
  budget: BudgetReportSchema,
  generatedAt: z.iso.datetime(),
});
export type CachedSearch = z.infer<typeof CachedSearchSchema>;

export const SearchRequestSchema = z.object({
  query: ProductQuerySchema,
  includeDifferentSizes: z.boolean().optional().default(false),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const DetectRequestSchema = z.object({
  input: z.string().trim().min(3).max(2000),
});
export type DetectRequest = z.infer<typeof DetectRequestSchema>;

export const DetectResultSchema = z.object({
  query: ProductQuerySchema,
  preview: RawListingSchema.optional(),
  warnings: z.array(z.string()),
  sourceUrl: z.url().optional(),
  fetchedAt: z.iso.datetime().optional(),
});
export type DetectResult = z.infer<typeof DetectResultSchema>;

/** Untrusted model output before it is normalized into a ProductQuery. */
export const ProductGuessSchema = z.object({
  brand: z.string().max(120).nullable(),
  name: z.string().max(120).nullable(),
  size: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
});
export type ProductGuess = z.infer<typeof ProductGuessSchema>;

export const DetectImageResultSchema = z.object({
  guess: ProductGuessSchema,
  query: ProductQuerySchema,
  warnings: z.array(z.string()),
});
export type DetectImageResult = z.infer<typeof DetectImageResultSchema>;

export type PipelineEvent =
  | { type: "status"; phase: string; message: string }
  | { type: "source"; source: SourceReport }
  | { type: "listing"; listing: Listing }
  | { type: "done"; result: SearchResult }
  | { type: "error"; code: string; message: string };
