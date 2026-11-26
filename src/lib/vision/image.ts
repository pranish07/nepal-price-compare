/**
 * Shared image guard for the HTTP route and the local MCP server.
 * The model accepts more formats; this app deliberately allows only three.
 */

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4;

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** Reads the magic bytes; never trusts the declared MIME type by itself. */
export function detectImageMimeType(bytes: Uint8Array): ImageMimeType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/** Returns a safe, generic rejection message or null when the bytes are usable. */
export function validateImageBytes(mimeType: string, bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return "That image is empty. Choose a different file.";
  if (bytes.byteLength > MAX_IMAGE_BYTES) return "Choose an image smaller than 3 MB.";
  if (!isImageMimeType(mimeType)) return "Only JPG, PNG, and WebP images are supported.";

  const detected = detectImageMimeType(bytes);
  if (!detected || detected !== mimeType) {
    return "The image contents do not match its file type.";
  }
  return null;
}

/** Strict Base64 decode; rejects whitespace, data URLs, and oversized payloads. */
export function base64ToBytes(value: string): Uint8Array | null {
  if (!value || value.length % 4 !== 0 || value.length > MAX_BASE64_LENGTH) return null;
  if (!BASE64_PATTERN.test(value)) return null;

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
