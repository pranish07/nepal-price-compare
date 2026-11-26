import { randomUUID } from "node:crypto";
import { getContainer } from "@/lib/container";
import { createLogger } from "@/lib/logger";
import { runSearch } from "@/lib/pipeline";
import { clientIpFromHeaders } from "@/lib/rate-limit";
import { formatSse } from "@/lib/sse";
import { SearchRequestSchema, type PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    { error: message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const logger = createLogger(requestId, { base: { route: "/api/search" } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Send a JSON body with a `query` object.");
  }

  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "That search is not valid. Check the product name, size, and city.");
  }

  const ip = clientIpFromHeaders(request.headers);
  try {
    const limit = await getContainer().searchLimiter.check(`npc:v1:rl:search:${ip}`);
    if (!limit.allowed) {
      const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
      return jsonError(
        429,
        `You have reached the search limit (${limit.limit} per hour). Please try again later.`,
        { retryAfter },
      );
    }
  } catch (error) {
    // A rate-limit backend outage must not take the whole app down. The daily
    // Serper ceiling still fails closed inside the pipeline.
    logger.warn("rate_limit.failed", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSse(event)));
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);

      try {
        const result = await runSearch(parsed.data, getContainer().deps, {
          emit: send,
          logger,
          signal: abort.signal,
        });
        logger.info("search.response", {
          listings: result.listings.length,
          credits: result.budget.creditsUsed,
          cacheStatus: result.budget.cacheStatus,
        });
      } catch (error) {
        logger.error("search.failed", {
          errorClass: error instanceof Error ? error.name : "unknown",
        });
        send({
          type: "error",
          code: "search_failed",
          message: "The search could not be completed. Please try again.",
        });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
