import { describe, expect, it } from "vitest";
import { parseProductText } from "@/lib/normalize";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_OCR_CHARS,
  cleanOcrText,
  validateImageFile,
} from "@/lib/ocr";

function fakeFile(type: string, size: number): File {
  return { type, size } as File;
}

describe("validateImageFile", () => {
  it("accepts browser image types within the size cap", () => {
    for (const type of ACCEPTED_IMAGE_TYPES) {
      expect(validateImageFile(fakeFile(type, 1024))).toBeNull();
    }
  });

  it("rejects unsupported types, empty files, and oversized files", () => {
    expect(validateImageFile(fakeFile("application/pdf", 1024))).toMatch(/JPG/);
    expect(validateImageFile(fakeFile("image/png", 0))).toMatch(/empty/);
    expect(validateImageFile(fakeFile("image/png", MAX_IMAGE_BYTES + 1))).toMatch(/8 MB/);
  });
});

describe("cleanOcrText", () => {
  it("flattens a multi-line label and removes prices, links, emails, and barcodes", () => {
    const raw = [
      "DR. ALTHEA",
      "Melaclear Cream",
      "20g",
      "Rs. 2,000",
      "https://bonjournp.com/product/123",
      "support@example.com",
      "9876543210",
      "— — —",
    ].join("\n");

    expect(cleanOcrText(raw)).toBe("DR. ALTHEA Melaclear Cream 20g");
  });

  it("keeps size-only and numeric product-name lines", () => {
    expect(cleanOcrText("345 Relief Cream\n20g")).toBe("345 Relief Cream 20g");
    expect(cleanOcrText("20 g\n50ml")).toBe("20 g 50ml");
  });

  it("removes invisible characters and limits runaway OCR output", () => {
    expect(cleanOcrText("Dr.\u200B Althea\n\nMelaclear")).toBe("Dr. Althea Melaclear");
    const long = "Product ".repeat(500);
    expect(cleanOcrText(long)).toHaveLength(MAX_OCR_CHARS);
  });

  it("produces text the existing detector can parse", () => {
    const cleaned = cleanOcrText("DR. ALTHEA\nMelaclear Cream\n20g\nRs. 2,000");
    expect(parseProductText(cleaned)).toEqual({
      name: "Melaclear Cream",
      brand: "Dr. Althea",
      size: { value: 20, unit: "g" },
    });
  });
});
