import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONFIG } from "../src/lib/config";
import {
  identifyProduct,
  queryFromGuess,
  VisionError,
  VISION_MESSAGES,
  type IdentifyProductDeps,
} from "../src/lib/vision/identifyProduct";
import {
  base64ToBytes,
  detectImageMimeType,
  isImageMimeType,
  MAX_IMAGE_BYTES,
  type ImageMimeType,
} from "../src/lib/vision/image";

/** Exactly one image source must be supplied. */
export const IdentifyProductImageInputSchema = z
  .object({
    image_path: z.string().trim().min(1).optional(),
    image_base64: z.string().trim().min(1).optional(),
    mime_type: z.string().trim().min(1).optional(),
  })
  .refine(
    (value) => Boolean(value.image_path) !== Boolean(value.image_base64),
    { message: "Provide exactly one of image_path or image_base64." },
  );

export type IdentifyProductImageInput = z.infer<typeof IdentifyProductImageInputSchema>;

export interface PreparedMcpImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
}

export interface McpDeps {
  apiKey: string;
  model: string;
  fetch: IdentifyProductDeps["fetch"];
}

/** Reads the key and model from the environment; neither is baked into code. */
export function envMcpDeps(): McpDeps {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    model: process.env.GEMINI_MODEL?.trim() ?? "",
    fetch: (url, init) => fetch(url, init),
  };
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Validates the MCP input without calling Gemini. File paths must resolve inside
 * the project (including through symlinks) so tools cannot read arbitrary files.
 */
export function prepareMcpImage(input: unknown, projectRoot: string = process.cwd()): PreparedMcpImage {
  const parsed = IdentifyProductImageInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Provide exactly one of image_path or image_base64.");
  }

  const { image_path: imagePath, image_base64: imageBase64, mime_type: declaredMime } = parsed.data;
  let bytes: Uint8Array | null;

  if (imagePath) {
    const root = path.resolve(projectRoot);
    const resolved = path.resolve(root, imagePath);
    if (!isInsideRoot(root, resolved)) {
      throw new Error("image_path must stay inside the project folder.");
    }

    let real: string;
    try {
      real = realpathSync(resolved);
    } catch {
      throw new Error("Image file not found.");
    }
    if (!isInsideRoot(root, real)) {
      throw new Error("image_path must stay inside the project folder.");
    }

    let size: number;
    try {
      const stat = statSync(real);
      if (!stat.isFile()) throw new Error("image_path must point to a file.");
      size = stat.size;
    } catch (error) {
      if (error instanceof Error && error.message === "image_path must point to a file.") throw error;
      throw new Error("Image file not found.");
    }
    if (size > MAX_IMAGE_BYTES) throw new Error("Choose an image smaller than 3 MB.");

    try {
      bytes = new Uint8Array(readFileSync(real));
    } catch {
      throw new Error("Image file not found.");
    }
  } else {
    bytes = base64ToBytes(imageBase64 ?? "");
    if (!bytes) throw new Error("image_base64 must be plain Base64 without a data URL.");
  }

  if (bytes.byteLength === 0) throw new Error("That image is empty. Choose a different file.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Choose an image smaller than 3 MB.");

  const detected = detectImageMimeType(bytes);
  if (!detected) throw new Error("Only JPG, PNG, and WebP images are supported.");
  if (declaredMime) {
    if (!isImageMimeType(declaredMime)) {
      throw new Error("Only JPG, PNG, and WebP images are supported.");
    }
    if (declaredMime !== detected) {
      throw new Error("The image contents do not match mime_type.");
    }
  }

  return { bytes, mimeType: detected };
}

/** Reuses the web app's core and normalization; no second Gemini implementation. */
export async function identifyFromMcpInput(
  input: unknown,
  deps: McpDeps,
  projectRoot: string = process.cwd(),
): Promise<{ guess: import("../src/lib/types").ProductGuess; query: import("../src/lib/types").ProductQuery }> {
  const prepared = prepareMcpImage(input, projectRoot);
  const guess = await identifyProduct(
    {
      imageBase64: Buffer.from(prepared.bytes).toString("base64"),
      mimeType: prepared.mimeType,
    },
    deps,
  );
  const { query } = queryFromGuess(guess);
  return { guess, query };
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof VisionError) return error.message;
  if (error instanceof Error) return error.message;
  return VISION_MESSAGES.upstream;
}

/** Creates the stdio MCP server. Startup lives in `mcp/cli.ts`. */
export function createMcpServer(deps: McpDeps = envMcpDeps()): McpServer {
  const server = new McpServer({
    name: "nepal-price-compare",
    version: CONFIG.version,
  });

  server.registerTool(
    "identify_product_image",
    {
      title: "Identify a beauty product photo",
      description:
        "Identify a beauty product from a local image and return a normalized product query. Uses the free Gemini API.",
      inputSchema: IdentifyProductImageInputSchema,
    },
    async (args) => {
      try {
        if (!deps.apiKey || !deps.model) {
          throw new Error("Set GEMINI_API_KEY and GEMINI_MODEL before starting the MCP server.");
        }
        const result = await identifyFromMcpInput(args, deps);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: safeErrorMessage(error) }],
        };
      }
    },
  );

  return server;
}
