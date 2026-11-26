/**
 * Browser-only image preparation. The original photo is downscaled and
 * re-encoded as JPEG so the server always receives a small, predictable file.
 */

import { MAX_IMAGE_BYTES } from "./image";

export const MAX_IMAGE_DIMENSION = 1024;
export const JPEG_QUALITY = 0.85;

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
      reject(new Error("That image could not be opened. Try a JPG, PNG, or WebP photo."));
    };
    image.src = url;
  });
}

/** Downscales to 1024 px on the long edge and re-encodes as JPEG q0.85. */
export async function prepareImageForUpload(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size === 0) {
    throw new Error("That image is empty. Choose a different file.");
  }

  const loaded = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / loaded.width, MAX_IMAGE_DIMENSION / loaded.height);
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image for upload.");

    context.drawImage(loaded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) throw new Error("That image could not be prepared. Try another photo.");
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error("That image is still too large. Try a smaller photo.");
    }
    return blob;
  } finally {
    loaded.dispose();
  }
}
