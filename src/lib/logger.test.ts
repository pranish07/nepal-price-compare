import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, createNoopLogger, safeUrlForLog } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeUrlForLog", () => {
  it("drops query strings and fragments", () => {
    expect(safeUrlForLog("https://example.com/product/abc?secret=1#x")).toBe(
      "https://example.com/product/abc",
    );
  });

  it("marks invalid input", () => {
    expect(safeUrlForLog("nope")).toBe("[invalid-url]");
  });
});

describe("createLogger", () => {
  it("writes one JSON line and redacts secrets", () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const logger = createLogger("req-1", { base: { route: "/api/search" } });
    logger.warn("source.failed", {
      apiKey: "super-secret",
      authorization: "Bearer x",
      url: "https://example.com/a?token=1",
      durationMs: 12,
    });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      level: "warn",
      event: "source.failed",
      requestId: "req-1",
      route: "/api/search",
      apiKey: "[redacted]",
      authorization: "[redacted]",
      url: "https://example.com/a",
      durationMs: 12,
    });
  });

  it("does not write in silent mode", () => {
    const write = vi.spyOn(process.stdout, "write");
    const logger = createNoopLogger();
    logger.error("boom");
    expect(write).not.toHaveBeenCalled();
  });
});
