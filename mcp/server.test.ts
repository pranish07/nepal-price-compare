import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  IdentifyProductImageInputSchema,
  identifyFromMcpInput,
  prepareMcpImage,
} from "./server";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = fileURLToPath(
  new URL("../src/test/fixtures/la-roche-posay-label.png", import.meta.url),
);
const recordedResponsePath = fileURLToPath(
  new URL("../src/test/fixtures/la-roche-posay-gemini-response.json", import.meta.url),
);

describe("identify_product_image input schema", () => {
  it("requires exactly one image source", () => {
    expect(IdentifyProductImageInputSchema.safeParse({ image_path: fixturePath }).success).toBe(true);
    expect(
      IdentifyProductImageInputSchema.safeParse({
        image_base64: Buffer.from("hello").toString("base64"),
        mime_type: "image/jpeg",
      }).success,
    ).toBe(true);
    expect(IdentifyProductImageInputSchema.safeParse({}).success).toBe(false);
    expect(
      IdentifyProductImageInputSchema.safeParse({
        image_path: fixturePath,
        image_base64: "AAAA",
      }).success,
    ).toBe(false);
  });
});

describe("prepareMcpImage", () => {
  it("accepts an in-project PNG fixture", () => {
    const prepared = prepareMcpImage({ image_path: fixturePath }, projectRoot);
    expect(prepared.mimeType).toBe("image/png");
    expect(prepared.bytes.byteLength).toBe(readFileSync(fixturePath).byteLength);
  });

  it("rejects path traversal and paths outside the project", () => {
    expect(() => prepareMcpImage({ image_path: "../outside.png" }, projectRoot)).toThrow(
      /project folder/,
    );
    expect(() => prepareMcpImage({ image_path: "/etc/passwd" }, projectRoot)).toThrow(
      /project folder/,
    );
  });

  it("rejects non-image bytes, mismatched MIME types, and oversized files", () => {
    const plain = Buffer.from("not an image").toString("base64");
    expect(() => prepareMcpImage({ image_base64: plain }, projectRoot)).toThrow(/JPG, PNG, and WebP/);

    const png = readFileSync(fixturePath).toString("base64");
    expect(() =>
      prepareMcpImage({ image_base64: png, mime_type: "image/jpeg" }, projectRoot),
    ).toThrow(/do not match/);

    const oversized = Buffer.alloc(3 * 1024 * 1024 + 1, 1).toString("base64");
    expect(() => prepareMcpImage({ image_base64: oversized }, projectRoot)).toThrow(/3 MB/);
  });

  it("rejects data URLs instead of plain Base64", () => {
    expect(() =>
      prepareMcpImage(
        { image_base64: `data:image/png;base64,${readFileSync(fixturePath).toString("base64")}` },
        projectRoot,
      ),
    ).toThrow(/plain Base64/);
  });
});

describe("identifyFromMcpInput", () => {
  it("reuses identifyProduct and returns the guess with a normalized query", async () => {
    const recorded = JSON.parse(readFileSync(recordedResponsePath, "utf8")) as unknown;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(recorded), { status: 200 }));

    const result = await identifyFromMcpInput(
      { image_path: fixturePath },
      { apiKey: "test-key", model: "gemini-3.5-flash-lite", fetch: fetchMock },
      projectRoot,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.guess.brand).toBe("La Roche-Posay");
    expect(result.guess.size).toBeNull();
    expect(result.query.brand).toBe("la roche posay");
    expect(result.query.name).toContain("cicaplast baume b5");
    expect(result.query.size).toBeUndefined();
  });
});
