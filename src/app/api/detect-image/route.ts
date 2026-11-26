import { randomUUID } from "node:crypto";
import { CONFIG } from "@/lib/config";
import { getContainer } from "@/lib/container";
import { createLogger, type Logger } from "@/lib/logger";
import {
  clientIpFromHeaders,
  type DailyCreditLedger,
  type RateLimiter,
} from "@/lib/rate-limit";
import type { DetectImageResult } from "@/lib/types";
import {
  identifyProduct,
  queryFromGuess,
  VisionError,
  VISION_MESSAGES,
  type VisionErrorCode,
} from "@/lib/vision/identifyProduct";
import {
  isImageMimeType,
  MAX_IMAGE_BYTES,
  validateImageBytes,
  type ImageMimeType,
} from "@/lib/vision/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUSY_MESSAGE = VISION_MESSAGES.quota;
const STATUS_BY_CODE: Record<VisionErrorCode, number> = {
  quota: 429,
  upstream: 502,
  parse: 422,
  not_product: 422,
};

export interface DetectImageRouteDeps {
  imageLimiter: RateLimiter;
  geminiLedger: DailyCreditLedger;
  identify: typeof identifyProduct;
  apiKey: string;
  model: string;
  logger: Logger;
  now: () => number;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const logger = createLogger(requestId, { base: { route: "/api/detect-image" } });
  const container = getContainer();

  return handleDetectImage(request, {
    imageLimiter: container.imageLimiter,
    geminiLedger: container.geminiLedger,
    identify: identifyProduct,
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    model: CONFIG.geminiModel,
    logger,
    now: () => Date.now(),
  });
}

/** Exported for route tests; production callers use POST and the DI container. */
export async function handleDetectImage(
  request: Request,
  deps: DetectImageRouteDeps,
): Promise<Response> {
  const startedAt = deps.now();

  const finish = (status: number, body: Record<string, unknown>, confidence: number | null = null) => {
    deps.logger.info("detect_image.result", {
      status,
      confidence,
      durationMs: deps.now() - startedAt,
    });
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  };

  if (!deps.apiKey || !deps.model) {
    deps.logger.warn("detect_image.not_configured");
    return finish(503, {
      error: "Image detection is not configured. Type the product name instead.",
    });
  }

  const ip = clientIpFromHeaders(request.headers);
  try {
    const limit = await deps.imageLimiter.check(`npc:v1:rl:detect-image:${ip}`);
    if (!limit.allowed) return finish(429, { error: BUSY_MESSAGE });
  } catch (error) {
    deps.logger.warn("detect_image.rate_limit.failed", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
    return finish(429, { error: BUSY_MESSAGE });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return finish(400, { error: "Send the photo as multipart form data in the `image` field." });
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return finish(400, { error: "Attach a photo in the `image` field." });
  }
  if (!isImageMimeType(image.type)) {
    return finish(415, { error: "Only JPG, PNG, and WebP images are supported." });
  }
  if (image.size === 0) {
    return finish(400, { error: "That image is empty. Choose a different file." });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return finish(413, { error: "Choose an image smaller than 3 MB." });
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const validation = validateImageBytes(image.type, bytes);
  if (validation) return finish(415, { error: validation });

  try {
    const allowed = await deps.geminiLedger.trySpend(1);
    if (!allowed) {
      deps.logger.warn("detect_image.ceiling_reached");
      return finish(429, { error: BUSY_MESSAGE });
    }
  } catch (error) {
    deps.logger.warn("detect_image.ledger.failed", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
    return finish(429, { error: BUSY_MESSAGE });
  }

  try {
    const guess = await deps.identify(
      { imageBase64: Buffer.from(bytes).toString("base64"), mimeType: image.type as ImageMimeType },
      {
        apiKey: deps.apiKey,
        model: deps.model,
        fetch: (url, init) => globalThis.fetch(url, init),
      },
    );
    const { query, warnings } = queryFromGuess(guess);
    const result: DetectImageResult = { guess, query, warnings };
    return finish(200, result, guess.confidence);
  } catch (error) {
    if (error instanceof VisionError) {
      deps.logger.warn("detect_image.vision_error", { code: error.code });
      return finish(STATUS_BY_CODE[error.code], { error: error.message });
    }
    deps.logger.error("detect_image.error", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
    return finish(502, { error: VISION_MESSAGES.upstream });
  }
}
