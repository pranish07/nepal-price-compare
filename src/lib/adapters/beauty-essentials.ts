import { z } from "zod";
import { extractEmbeddedObject } from "../extract/flight";
import { extractStoreSignals } from "../extract/dom";
import { searchText } from "../normalize";
import { parseSize } from "../size";
import type { RawListing } from "../types";
import { AdapterError, type AdapterContext, type StoreAdapter } from "./types";

const BASE_URL = "https://beautyessentials.com.np";

const numberish = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return undefined;
    const parsed = typeof value === "number" ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  });

const VariantSchema = z.object({
  id: z.string().optional(),
  variantName: z.string().nullable().optional(),
  price: numberish,
  salePrice: numberish,
  stockQuantity: z.number().nullable().optional(),
});

const ProductSchema = z.object({
  name: z.string(),
  slug: z.string(),
  category: z.object({ slug: z.string() }).nullable().optional(),
  brand: z.object({ name: z.string() }).nullable().optional(),
  variants: z.array(VariantSchema).default([]),
  featuredImage: z.string().nullable().optional(),
  defaultVariantId: z.string().optional(),
  priceMin: numberish,
});

const PayloadSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(ProductSchema),
});

type BeautyProduct = z.infer<typeof ProductSchema>;

function chooseVariant(product: BeautyProduct) {
  if (product.variants.length === 0) return undefined;
  return (
    product.variants.find((variant) => variant.id === product.defaultVariantId) ??
    product.variants[0]
  );
}

/**
 * Beauty Essentials is a Next.js store. Its /shop?search= page embeds a full
 * product response in the RSC payload, including brand, size, sale price and
 * exact stock quantity. One HTML fetch replaces a JSON API.
 */
export const beautyEssentialsAdapter: StoreAdapter = {
  id: "beauty-essentials",
  domain: "beautyessentials.com.np",
  label: "Beauty Essentials",

  async search(query, ctx: AdapterContext): Promise<RawListing[]> {
    const searchUrl = `${BASE_URL}/shop?search=${encodeURIComponent(searchText(query))}`;
    const page = await ctx.fetch.html(searchUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });

    const payload = extractEmbeddedObject<unknown>(page.body, "initialProductsResponse");
    const parsed = PayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AdapterError(
        "payload_missing",
        "Beauty Essentials search payload was missing or had an unexpected shape.",
      );
    }

    const signals = extractStoreSignals(page.body);
    const fetchedAt = ctx.now().toISOString();

    const listings: RawListing[] = parsed.data.data.map((product) => {
      const variant = chooseVariant(product);
      const price = variant?.salePrice ?? variant?.price ?? product.priceMin;
      const originalPrice =
        variant?.salePrice !== undefined &&
        variant.price !== undefined &&
        variant.price > variant.salePrice
          ? variant.price
          : undefined;
      const stockQuantity = variant?.stockQuantity;
      const size = parseSize(variant?.variantName ?? product.name) ?? parseSize(product.name);
      const categorySlug = product.category?.slug;
      const productUrl = categorySlug
        ? `${BASE_URL}/shop/${categorySlug}/${product.slug}`
        : `${BASE_URL}/shop/${product.slug}`;

      return {
        sellerId: "beautyessentials.com.np",
        sellerName: "Beauty Essentials",
        url: productUrl,
        title: product.name,
        price: price !== undefined ? { amount: price, currency: "NPR" } : undefined,
        originalPrice:
          originalPrice !== undefined ? { amount: originalPrice, currency: "NPR" } : undefined,
        size: size ? { value: size.value, unit: size.unit } : undefined,
        inStock: stockQuantity === null || stockQuantity === undefined ? undefined : stockQuantity > 0,
        location: signals.location,
        delivery: signals.delivery,
        image: product.featuredImage ?? undefined,
        brand: product.brand?.name ?? undefined,
        fetchedAt,
        source: "adapter",
        ...(signals.location || signals.delivery ? { sourceUrl: searchUrl } : {}),
      };
    });

    ctx.logger.info("adapter.search.ok", {
      adapter: "beauty-essentials",
      listings: listings.length,
    });

    return listings;
  },
};
