import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  base64ToBytes,
  detectImageMimeType,
  validateImageBytes,
} from "@/lib/vision/image";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex");
const WEBP = Buffer.from("5249464624000000574542505650384c", "hex");

describe("image magic bytes", () => {
  it("recognizes the three allowed formats", () => {
    expect(detectImageMimeType(PNG)).toBe("image/png");
    expect(detectImageMimeType(JPEG)).toBe("image/jpeg");
    expect(detectImageMimeType(WEBP)).toBe("image/webp");
  });

  it("rejects unknown bytes", () => {
    expect(detectImageMimeType(Buffer.from("not an image"))).toBeNull();
  });
});

describe("validateImageBytes", () => {
  it("accepts matching declared MIME types", () => {
    expect(validateImageBytes("image/png", PNG)).toBeNull();
    expect(validateImageBytes("image/jpeg", JPEG)).toBeNull();
    expect(validateImageBytes("image/webp", WEBP)).toBeNull();
  });

  it("rejects spoofed magic bytes, unsupported types, empty files, and oversize files", () => {
    expect(validateImageBytes("image/png", JPEG)).toMatch(/do not match/);
    expect(validateImageBytes("image/gif", PNG)).toMatch(/JPG, PNG, and WebP/);
    expect(validateImageBytes("image/png", new Uint8Array(0))).toMatch(/empty/);
    expect(
      validateImageBytes("image/png", new Uint8Array(MAX_IMAGE_BYTES + 1)),
    ).toMatch(/3 MB/);
  });
});

describe("base64ToBytes", () => {
  it("decodes strict Base64", () => {
    expect(base64ToBytes(Buffer.from("hello").toString("base64"))).toEqual(
      new Uint8Array(Buffer.from("hello")),
    );
  });

  it("rejects data URLs, whitespace, and invalid characters", () => {
    expect(base64ToBytes("data:image/png;base64,AAAA")).toBeNull();
    expect(base64ToBytes("AAAA AAAA")).toBeNull();
    expect(base64ToBytes("****")).toBeNull();
  });
});
