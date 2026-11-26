import { CONFIG } from "../config";
import { FetchError } from "../http";
import type { ProductQuery } from "../types";
import {
  AdapterError,
  type AdapterContext,
  type StoreAdapter,
} from "./types";

export class CircuitOpenError extends AdapterError {
  constructor(adapterId: string) {
    super("circuit_open", `Circuit breaker is open for ${adapterId}.`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  halfOpenMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  canRequest(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open" && this.now() - this.openedAt >= this.options.halfOpenMs) {
      this.state = "half-open";
      return true;
    }
    return this.state === "half-open";
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.options.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  snapshot(): { state: string; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

export interface ResilienceOptions {
  timeoutMs?: number;
  failureThreshold?: number;
  halfOpenMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AdapterError) return error.code === "timeout";
  if (error instanceof FetchError) {
    return error.code === "timeout" || error.code === "network";
  }
  return false;
}

function errorClass(error: unknown): string {
  if (error instanceof AdapterError) return error.code;
  if (error instanceof FetchError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new AdapterError("timeout", `Adapter timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Wraps an adapter with a per-call timeout, at most one jittered retry, and a
 * circuit breaker (3 consecutive failures -> open for 60 s -> half-open).
 */
export function withResilience(
  adapter: StoreAdapter,
  options: ResilienceOptions = {},
): StoreAdapter {
  const timeoutMs = options.timeoutMs ?? CONFIG.adapterTimeoutMs;
  const breaker = new CircuitBreaker({
    failureThreshold: options.failureThreshold ?? CONFIG.circuitFailureThreshold,
    halfOpenMs: options.halfOpenMs ?? CONFIG.circuitHalfOpenMs,
    now: options.now,
  });
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  return {
    ...adapter,
    async search(query: ProductQuery, ctx: AdapterContext) {
      if (!breaker.canRequest()) {
        throw new CircuitOpenError(adapter.id);
      }

      const started = Date.now();
      let lastError: unknown;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const listings = await withTimeout(
            (signal) =>
              adapter.search(query, {
                ...ctx,
                signal,
                timeoutMs: ctx.timeoutMs ?? timeoutMs,
              }),
            ctx.timeoutMs ?? timeoutMs,
            ctx.signal,
          );
          breaker.onSuccess();
          return listings;
        } catch (error) {
          lastError = error;
          if (attempt === 0 && isRetryable(error)) {
            const jitter = 200 + Math.floor(random() * 300);
            ctx.logger.warn("adapter.search.retry", {
              adapter: adapter.id,
              errorClass: errorClass(error),
              jitterMs: jitter,
            });
            await sleep(jitter);
            continue;
          }
          break;
        }
      }

      breaker.onFailure();
      ctx.logger.warn("adapter.search.failed", {
        adapter: adapter.id,
        errorClass: errorClass(lastError),
        durationMs: Date.now() - started,
        circuitState: breaker.snapshot().state,
      });
      throw lastError instanceof Error ? lastError : new Error("Adapter failed.");
    },
  };
}
