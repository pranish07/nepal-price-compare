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

import { parseProductText } from "./normalize";

const CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0";
const LANG_PATH = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int";
const WORKER_PATH = "/tesseract/worker.min.js";

/** Advisory threshold retained for diagnostics/tests; OCR output is no longer blocked on it. */
export const MIN_OCR_CONFIDENCE = 40;
const CONTRAST = 1.25;
const MIN_TARGET_WIDTH = 1600;
const MAX_TARGET_WIDTH = 2400;
const MAX_DIMENSION = 2600;

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

/**
 * Advisory quality signal. It is no longer used to block OCR output: a strict
 * threshold rejected real photos even when the text was usable. The UI always
 * shows the recognised text in an editable confirmation step instead.
 */
export function isConfidentOcr(text: string, confidence: number): boolean {
  const cleaned = cleanOcrText(text);
  if (!cleaned) return false;
  if (!Number.isFinite(confidence) || confidence < MIN_OCR_CONFIDENCE) return false;

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const meaningfulTokens = tokens.filter((token) => /[A-Za-z]{4,}/.test(token)).length;
  const singleLetters = tokens.filter((token) => /^[A-Za-z]$/.test(token)).length;

  // A product label normally has at least two word-like tokens. A known brand
  // counts as one because titles like "COSRX 100ml" are legitimate.
  if (meaningfulTokens < 2 && !parseProductText(cleaned).brand) return false;
  // Garbled OCR often degenerates into many isolated letters and symbols.
  if (tokens.length >= 5 && singleLetters / tokens.length > 0.25) return false;

  return true;
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be opened. Try a JPG or PNG."));
    };
    image.src = url;
  });
}

/**
 * Upscales small labels and applies grayscale + contrast in a canvas. This is
 * still entirely on-device and avoids sending the photo anywhere.
 */
async function preprocessImage(file: File): Promise<HTMLCanvasElement> {
  const loaded = await loadImage(file);
  try {
    const scale = Math.min(MAX_TARGET_WIDTH / loaded.width, Math.max(MIN_TARGET_WIDTH / loaded.width, 2));
    let width = Math.max(1, Math.round(loaded.width * scale));
    let height = Math.max(1, Math.round(loaded.height * scale));

    if (Math.max(width, height) > MAX_DIMENSION) {
      const reduce = MAX_DIMENSION / Math.max(width, height);
      width = Math.max(1, Math.round(width * reduce));
      height = Math.max(1, Math.round(height * reduce));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot prepare the image for reading.");

    context.drawImage(loaded.source, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    const pixels = frame.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      const grey = 0.299 * red + 0.587 * green + 0.114 * blue;
      const adjusted = Math.max(0, Math.min(255, Math.round((grey - 128) * CONTRAST + 128)));
      pixels[index] = adjusted;
      pixels[index + 1] = adjusted;
      pixels[index + 2] = adjusted;
    }
    context.putImageData(frame, 0, 0);
    return canvas;
  } finally {
    loaded.dispose();
  }
}

/** Runs Tesseract in a Web Worker in the user's browser. No image is uploaded. */
export async function recognizeImage(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  onProgress?.({ status: "Preparing image", progress: 0 });
  const image = await preprocessImage(file);
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
    const result = await worker.recognize(image, {}, { text: true });
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
