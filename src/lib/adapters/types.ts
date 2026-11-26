import type { SafeFetch } from "../http";
import type { Logger } from "../logger";
import type { ProductQuery, RawListing } from "../types";

export interface AdapterContext {
  fetch: SafeFetch;
  timeoutMs: number;
  logger: Logger;
  signal?: AbortSignal;
  now: () => Date;
}

export interface StoreAdapter {
  id: string;
  domain: string;
  label: string;
  search(query: ProductQuery, ctx: AdapterContext): Promise<RawListing[]>;
}

export type AdapterErrorCode =
  | "parse_failed"
  | "payload_missing"
  | "timeout"
  | "circuit_open"
  | "unknown";

export class AdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}
