import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { CONFIG } from "./config";
import { UnsafeUrlError, validatePublicUrl, type Resolver } from "./ssrf";

export type FetchErrorCode =
  | "timeout"
  | "too_large"
  | "bad_content_type"
  | "http_error"
  | "redirect_limit"
  | "network"
  | "aborted"
  | "invalid_response";

export class FetchError extends Error {
  readonly code: FetchErrorCode;
  readonly status?: number;
  constructor(code: FetchErrorCode, message: string, status?: number) {
    super(message);
    this.name = "FetchError";
    this.code = code;
    this.status = status;
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  fetchedAt: string;
}

export interface SafeFetch {
  html(
    url: string,
    options?: {
      timeoutMs?: number;
      maxBytes?: number;
      signal?: AbortSignal;
      maxRedirects?: number;
      resolve?: Resolver;
    },
  ): Promise<FetchedPage>;
}

interface RequestResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function requestOnce(
  url: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    };
    const succeed = (value: RequestResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };

    const onAbort = () => {
      request.destroy(new FetchError("aborted", "Request aborted."));
    };

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.protocol === "https:" ? hostname : undefined,
        headers: {
          Host: url.host,
          "User-Agent": CONFIG.userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "identity",
          Connection: "close",
        },
        lookup: ((_host: string, lookupOptions: unknown, callback: (...args: unknown[]) => void) => {
          if (typeof lookupOptions === "object" && lookupOptions !== null && "all" in lookupOptions) {
            callback(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        }) as never,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers["content-type"] ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase();

        if (status >= 300 && status < 400) {
          response.resume();
          succeed({ status, headers: response.headers, body: Buffer.alloc(0) });
          return;
        }

        if (status < 200 || status >= 400) {
          response.resume();
          fail(new FetchError("http_error", `Upstream returned HTTP ${status}.`, status));
          return;
        }

        if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
          response.resume();
          fail(
            new FetchError(
              "bad_content_type",
              `Unsupported content type: ${contentType || "missing"}.`,
              status,
            ),
          );
          return;
        }

        const declaredLength = Number.parseInt(
          String(response.headers["content-length"] ?? ""),
          10,
        );
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.resume();
          fail(new FetchError("too_large", "Response is larger than the allowed size.", status));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            request.destroy(
              new FetchError("too_large", "Response exceeded the size cap.", status),
            );
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          succeed({ status, headers: response.headers, body: Buffer.concat(chunks) });
        });

        response.on("error", (error) => {
          fail(error instanceof FetchError ? error : new FetchError("network", error.message));
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new FetchError("timeout", `Request timed out after ${timeoutMs} ms.`));
    });

    request.on("error", (error) => {
      if (error instanceof FetchError) {
        fail(error);
      } else if (signal?.aborted) {
        fail(new FetchError("aborted", "Request aborted."));
      } else {
        fail(new FetchError("network", error.message));
      }
    });

    if (signal) {
      if (signal.aborted) {
        request.destroy(new FetchError("aborted", "Request aborted."));
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    request.end();
  });
}

/**
 * SSRF-guarded HTML fetch:
 * - validates and resolves DNS before connecting, pinning the resolved IP
 * - re-validates every redirect (max 3)
 * - enforces timeout, byte cap, and a text/html allowlist
 */
export async function safeFetchHtml(
  rawUrl: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
    maxRedirects?: number;
    resolve?: Resolver;
  } = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? CONFIG.fetchTimeoutMs;
  const maxBytes = options.maxBytes ?? CONFIG.maxBytesPerPage;
  const maxRedirects = options.maxRedirects ?? 3;

  let current = await validatePublicUrl(rawUrl, { resolve: options.resolve });

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (options.signal?.aborted) throw new FetchError("aborted", "Request aborted.");

    const result = await requestOnce(
      current.url,
      current.address,
      current.family,
      timeoutMs,
      maxBytes,
      options.signal,
    );

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.location;
      if (!location) {
        throw new FetchError("invalid_response", "Redirect without a Location header.");
      }
      if (redirects === maxRedirects) {
        throw new FetchError("redirect_limit", "Too many redirects.");
      }
      let next: URL;
      try {
        next = new URL(location, current.url);
      } catch {
        throw new FetchError("invalid_response", "Redirect location is invalid.");
      }
      try {
        current = await validatePublicUrl(next.toString(), { resolve: options.resolve });
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          throw new FetchError("network", `Redirect blocked: ${error.reason}`);
        }
        throw error;
      }
      continue;
    }

    return {
      url: current.url.toString(),
      status: result.status,
      contentType: String(result.headers["content-type"] ?? ""),
      body: result.body.toString("utf8"),
      bytes: result.body.byteLength,
      fetchedAt: new Date().toISOString(),
    };
  }

  throw new FetchError("redirect_limit", "Too many redirects.");
}

export const safeFetch: SafeFetch = { html: safeFetchHtml };

export class DomainLimiter {
  private lastRequestAt = new Map<string, number>();
  private chains = new Map<string, Promise<void>>();

  constructor(
    private readonly delayMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async wait(hostname: string): Promise<void> {
    const host = hostname.toLowerCase();
    const previous = this.chains.get(host) ?? Promise.resolve();
    const next = previous.then(async () => {
      const last = this.lastRequestAt.get(host);
      if (last !== undefined) {
        const waitMs = this.delayMs - (this.now() - last);
        if (waitMs > 0) await this.sleep(waitMs);
      }
      this.lastRequestAt.set(host, this.now());
    });
    this.chains.set(
      host,
      next.catch(() => undefined),
    );
    await next;
  }
}
