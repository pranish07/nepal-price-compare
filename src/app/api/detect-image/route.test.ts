import { describe, expect, it, vi } from "vitest";
import {
  handleDetectImage,
  type DetectImageRouteDeps,
} from "@/app/api/detect-image/route";
import type { Logger } from "@/lib/logger";
import type { DailyCreditLedger, RateLimiter } from "@/lib/rate-limit";
import { MAX_IMAGE_BYTES } from "@/lib/vision/image";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex");

function formData(bytes: Uint8Array, type: string, name = "label.png"): FormData {
  const form = new FormData();
  form.set("image", new File([bytes as unknown as BlobPart], name, { type }));
  return form;
}

function request(form: FormData): Request {
  return new Request("http://localhost/api/detect-image", { method: "POST", body: form });
}

function makeLogger() {
  const entries: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const logger = {
    requestId: "test",
    debug: () => undefined,
    info: (event: string, fields?: Record<string, unknown>) => entries.push({ event, fields }),
    warn: (event: string, fields?: Record<string, unknown>) => entries.push({ event, fields }),
    error: (event: string, fields?: Record<string, unknown>) => entries.push({ event, fields }),
  } as Logger;
  return { logger, entries };
}

function makeDeps(overrides: Partial<DetectImageRouteDeps> = {}) {
  const identifyMock = vi.fn(async () => ({
    brand: "La Roche-Posay",
    name: "Cicaplast Baume B5",
    size: null,
    confidence: 0.82,
  }));
  const limiter: RateLimiter = {
    check: vi.fn(async () => ({ allowed: true, limit: 10, remaining: 9, resetAt: 0 })),
  };
  const ledger: DailyCreditLedger = {
    trySpend: vi.fn(async () => true),
    used: vi.fn(async () => 0),
    remaining: vi.fn(async () => 200),
  };
  const { logger, entries } = makeLogger();
  const deps: DetectImageRouteDeps = {
    imageLimiter: limiter,
    geminiLedger: ledger,
    identify: identifyMock as unknown as DetectImageRouteDeps["identify"],
    apiKey: "test-key",
    model: "gemini-3.5-flash-lite",
    logger,
    now: () => 1_000,
    ...overrides,
  };
  return { deps, identifyMock, limiter, ledger, entries };
}

describe("/api/detect-image", () => {
  it("identifies an image and returns a normalized query", async () => {
    const { deps, identifyMock, entries } = makeDeps();
    const response = await handleDetectImage(request(formData(PNG, "image/png")), deps);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      guess: { confidence: number; size: string | null };
      query: { brand: string; name: string };
      warnings: string[];
    };
    expect(body.guess.confidence).toBe(0.82);
    expect(body.guess.size).toBeNull();
    expect(body.query.brand).toBe("la roche posay");
    expect(body.query.name).toBe("cicaplast baume b5");
    expect(body.warnings).toContain("No size was detected. Add it for an exact price-per-unit comparison.");
    expect(identifyMock).toHaveBeenCalledWith(
      { imageBase64: PNG.toString("base64"), mimeType: "image/png" },
      expect.objectContaining({ apiKey: "test-key", model: "gemini-3.5-flash-lite" }),
    );
    expect(entries).toContainEqual({
      event: "detect_image.result",
      fields: { status: 200, confidence: 0.82, durationMs: 0 },
    });
  });

  it("rejects missing config, bad MIME types, spoofed magic bytes, and oversize files", async () => {
    const unconfigured = makeDeps({ apiKey: "" });
    expect((await handleDetectImage(request(formData(PNG, "image/png")), unconfigured.deps)).status).toBe(503);

    const wrongMime = makeDeps();
    expect(
      (await handleDetectImage(request(formData(PNG, "image/gif")), wrongMime.deps)).status,
    ).toBe(415);

    const spoofed = makeDeps();
    expect(
      (await handleDetectImage(request(formData(JPEG, "image/png")), spoofed.deps)).status,
    ).toBe(415);

    const oversize = makeDeps();
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(
      (await handleDetectImage(request(formData(big, "image/png")), oversize.deps)).status,
    ).toBe(413);
    expect(oversize.identifyMock).not.toHaveBeenCalled();
  });

  it("fails closed on the per-IP rate limit", async () => {
    const { deps, ledger, identifyMock } = makeDeps();
    vi.mocked(deps.imageLimiter.check).mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 0,
    });

    const response = await handleDetectImage(request(formData(PNG, "image/png")), deps);
    expect(response.status).toBe(429);
    expect(ledger.trySpend).not.toHaveBeenCalled();
    expect(identifyMock).not.toHaveBeenCalled();
    expect(((await response.json()) as { error: string }).error).toMatch(/type the product name/);
  });

  it("fails closed on the Gemini daily ceiling", async () => {
    const { deps, ledger, identifyMock } = makeDeps();
    vi.mocked(ledger.trySpend).mockResolvedValueOnce(false);

    const response = await handleDetectImage(request(formData(PNG, "image/png")), deps);
    expect(response.status).toBe(429);
    expect(identifyMock).not.toHaveBeenCalled();
    expect(((await response.json()) as { error: string }).error).toBe(
      "Image detection is busy, type the product name instead.",
    );
  });

  it("maps typed vision errors without exposing upstream details", async () => {
    const { deps } = makeDeps({
      identify: vi.fn(async () => {
        throw new Error("raw upstream body with key");
      }) as unknown as DetectImageRouteDeps["identify"],
    });
    const response = await handleDetectImage(request(formData(PNG, "image/png")), deps);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/raw upstream body with key/);
  });
});
