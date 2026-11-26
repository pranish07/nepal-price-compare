/**
 * Browser-side OCR wrapper. Tesseract.js is imported only when a user chooses
 * an image, so the normal search page does not download the OCR runtime.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_OCR_CHARS = 2000;

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;

const CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0";
const LANG_PATH = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int";
const WORKER_PATH = "/tesseract/worker.min.js";

export interface OcrProgress {
  status: string;
  /** Percentage from 0 to 100. */
  progress: number;
}

export interface OcrResult {
  text: string;
  /** Tesseract page confidence. This is a heuristic, not an accuracy guarantee. */
  confidence: number;
}

/** Validates the file before a preview URL or OCR work is created. */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return "Choose a JPG, PNG, WebP, GIF, or BMP image.";
  }
  if (file.size === 0) return "That image is empty. Choose a different file.";
  if (file.size > MAX_IMAGE_BYTES) return "Choose an image smaller than 8 MB.";
  return null;
}

/**
 * OCR often splits a label over several lines and adds prices, URLs, or store
 * footers. We keep alphanumeric lines, drop obvious non-product noise, and
 * flatten the rest into a single phrase for `/api/detect`.
 */
export function cleanOcrText(raw: string): string {
  const lines = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (!/[a-z0-9]/i.test(line)) return false;
      const compact = line.replace(/\s+/g, "");
      if (/^https?:\/\//i.test(compact) || /^www\./i.test(compact)) return false;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compact)) return false;
      if (/^(?:rs\.?|npr\.?|₨)\s?[\d,]+(?:\.\d+)?$/i.test(line)) return false;
      // A long digit-only line is usually a barcode or phone number. Size
      // lines such as "20g" are deliberately kept.
      if (/^[\d\s()+.-]{7,}$/.test(line) && !/\d+\s*(?:g|ml)\b/i.test(line)) return false;
      return true;
    });

  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_OCR_CHARS);
}

/** Runs Tesseract in a Web Worker in the user's browser. No image is uploaded. */
export async function recognizeImage(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: WORKER_PATH,
    workerBlobURL: false,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    gzip: true,
    logger: (message) => {
      const fraction = Number.isFinite(message.progress) ? message.progress : 0;
      onProgress?.({
        status: message.status || "Reading image",
        progress: Math.min(100, Math.max(0, Math.round(fraction * 100))),
      });
    },
  });

  try {
    const result = await worker.recognize(file, {}, { text: true });
    return {
      text: result.data.text ?? "",
      confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : 0,
    };
  } finally {
    // A failed OCR job must still release its worker; ignore cleanup errors so
    // the original failure remains the one shown to the user.
    try {
      await worker.terminate();
    } catch {
      // no-op
    }
  }
}
