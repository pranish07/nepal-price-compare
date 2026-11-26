import { randomUUID } from "node:crypto";
import { CONFIG } from "@/lib/config";
import { getContainer } from "@/lib/container";
import { extractProduct } from "@/lib/extract";
import { FetchError, safeFetchHtml } from "@/lib/http";
import { createLogger } from "@/lib/logger";
import { looksLikeUrl, parseProductText } from "@/lib/normalize";
import { clientIpFromHeaders } from "@/lib/rate-limit";
import { UnsafeUrlError } from "@/lib/ssrf";
import {
  DetectRequestSchema,
  type DetectResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    { error: message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const logger = createLogger(requestId, { base: { route: "/api/detect" } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Send a JSON body with an `input` string.");
  }

  const parsed = DetectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Enter a product name or a store URL.");
  }

  const ip = clientIpFromHeaders(request.headers);
  try {
    const limit = await getContainer().detectLimiter.check(`npc:v1:rl:detect:${ip}`);
    if (!limit.allowed) {
      return jsonError(
        429,
        `You have reached the link-detection limit (${limit.limit} per hour). Please try again later.`,
      );
    }
  } catch (error) {
    logger.warn("rate_limit.failed", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
  }

  const input = parsed.data.input;

  if (looksLikeUrl(input)) {
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    try {
      const page = await safeFetchHtml(input, {
        timeoutMs: CONFIG.fetchTimeoutMs,
        maxBytes: CONFIG.maxBytesPerPage,
        signal: abort.signal,
      });
      const product = extractProduct(page.body, page.url, page.fetchedAt);
      if (!product) {
        return jsonError(
          422,
          "A product could not be detected on that page. Try pasting the product name instead.",
        );
      }
      const result: DetectResult = {
        query: product.query,
        preview: product.listing,
        warnings: product.warnings,
        sourceUrl: page.url,
        fetchedAt: page.fetchedAt,
      };
      logger.info("detect.url.ok", {
        host: new URL(page.url).hostname,
        warnings: product.warnings.length,
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        logger.warn("detect.url.blocked", { reason: error.reason });
        return jsonError(400, "That URL is not allowed. Use a public http or https product page.");
      }
      if (error instanceof FetchError) {
        logger.warn("detect.url.failed", { errorClass: error.code });
        if (error.code === "timeout") {
          return jsonError(504, "That page took too long to respond. Try the product name instead.");
        }
        if (error.code === "bad_content_type") {
          return jsonError(415, "That URL is not an HTML product page.");
        }
        if (error.code === "too_large") {
          return jsonError(413, "That page is too large to read safely.");
        }
        return jsonError(502, "That page could not be read. Try the product name instead.");
      }
      logger.error("detect.url.error", {
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      return jsonError(500, "Something went wrong while reading that page.");
    }
  }

  const text = parseProductText(input);
  if (!text.name.trim()) {
    return jsonError(400, "Enter a product name, for example `Dr. Althea Melaclear Cream 20g`.");
  }

  const warnings = text.size
    ? []
    : ["No size was detected. Add it for an accurate price-per-unit comparison."];

  const result: DetectResult = {
    query: text,
    warnings,
  };
  logger.info("detect.text.ok", { hasSize: Boolean(text.size), hasBrand: Boolean(text.brand) });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
