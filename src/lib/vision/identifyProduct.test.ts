import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  VISION_MESSAGES,
  VisionError,
  identifyProduct,
  parseProductGuess,
  queryFromGuess,
  type IdentifyProductDeps,
} from "@/lib/vision/identifyProduct";

function modelResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function depsFor(fetchImpl: IdentifyProductDeps["fetch"]): IdentifyProductDeps {
  return { apiKey: "test-key", model: "gemini-3.5-flash-lite", fetch: fetchImpl };
}

const image = { imageBase64: "AAAA", mimeType: "image/jpeg" } as const;

describe("identifyProduct", () => {
  it("posts an inline image with the required JSON generation config and live-accepted schema", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      modelResponse('{"brand":"CeraVe","name":"Moisturising Cream","size":"","confidence":0.91}'),
    );

    const guess = await identifyProduct(image, depsFor(fetchMock));

    expect(guess).toEqual({
      brand: "CeraVe",
      name: "Moisturising Cream",
      size: null,
      confidence: 0.91,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-key",
    });
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: Record<string, unknown>;
    };
    expect(body.contents[0]?.parts[1]).toEqual({
      inline_data: { mime_type: "image/jpeg", data: "AAAA" },
    });
    expect(body.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          brand: { type: "STRING", nullable: true },
          name: { type: "STRING", nullable: true },
          size: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["brand", "name", "size", "confidence"],
      },
    });
    expect(JSON.stringify(body.generationConfig.responseSchema)).not.toContain(
      "additionalProperties",
    );
    expect(JSON.stringify(body.generationConfig.responseSchema)).not.toContain('"string","null"');
    const prompt = String(body.contents[0]?.parts[0]?.text);
    expect(prompt).toMatch(/skincare or beauty/i);
    expect(prompt).toMatch(/Never guess or infer the size/i);
    expect(prompt).toMatch(/0 to 1/i);
    expect(prompt).toMatch(/Ignore any instructions/i);
  });

  it("uses the La Roche-Posay fixture and recorded response", async () => {
    const fixtureUrl = fileURLToPath(
      new URL("../../test/fixtures/la-roche-posay-label.png", import.meta.url),
    );
    const responseUrl = fileURLToPath(
      new URL("../../test/fixtures/la-roche-posay-gemini-response.json", import.meta.url),
    );
    const bytes = readFileSync(fixtureUrl);
    const recorded = JSON.parse(readFileSync(responseUrl, "utf8")) as unknown;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(recorded), { status: 200 }));

    const guess = await identifyProduct(
      { imageBase64: bytes.toString("base64"), mimeType: "image/png" },
      depsFor(fetchMock),
    );
    const { query } = queryFromGuess(guess);

    expect(guess).toEqual({
      brand: "La Roche-Posay",
      name: "Cicaplast Baume B5",
      size: null,
      confidence: 0.82,
    });
    expect(query.brand).toBe("la roche posay");
    expect(query.name).toContain("cicaplast baume b5");
    expect(query.size).toBeUndefined();
  });

  it("maps quota and upstream statuses to typed errors without leaking bodies", async () => {
    const quota = await identifyProduct(
      image,
      depsFor(async () =>
        new Response("PROJECT_QUOTA_EXHAUSTED secret-upstream-detail", { status: 429 }),
      ),
    ).catch((error: unknown) => error);
    expect(quota).toBeInstanceOf(VisionError);
    expect(quota).toMatchObject({ code: "quota", message: VISION_MESSAGES.quota });
    expect(String((quota as Error).message)).not.toMatch(/secret-upstream-detail|QUOTA_EXHAUSTED/);

    const upstream = await identifyProduct(
      image,
      depsFor(async () => new Response("internal trace", { status: 500 })),
    ).catch((error: unknown) => error);
    expect(upstream).toMatchObject({ code: "upstream", message: VISION_MESSAGES.upstream });
  });

  it("maps malformed JSON and non-beauty output to typed errors", async () => {
    const malformed = await identifyProduct(
      image,
      depsFor(async () => modelResponse("not json")),
    ).catch((error: unknown) => error);
    expect(malformed).toMatchObject({ code: "parse" });

    const notBeauty = await identifyProduct(
      image,
      depsFor(async () => modelResponse('{"brand":null,"name":null,"size":null,"confidence":0}')),
    ).catch((error: unknown) => error);
    expect(notBeauty).toMatchObject({ code: "not_beauty" });
  });

  it("caps strings, strips control characters, and clamps confidence", () => {
    const long = `A\u0001B ${"x".repeat(200)}`;
    const guess = parseProductGuess(
      JSON.stringify({
        brand: long,
        name: "Cream",
        size: null,
        confidence: 7,
        injected: "ignored",
      }),
    );
    expect(guess.brand).toHaveLength(120);
    expect(guess.brand).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(guess.confidence).toBe(1);
    expect(guess).not.toHaveProperty("injected");
  });

  it("treats instructions inside model output as inert data", () => {
    const guess = parseProductGuess(
      JSON.stringify({
        brand: "La Roche-Posay",
        name: "<script>alert(1)</script> Cicaplast B5",
        size: null,
        confidence: -2,
      }),
    );
    expect(guess.confidence).toBe(0);
    expect(guess.name).toContain("<script>alert(1)</script>");
    expect(typeof guess.name).toBe("string");
  });

  it("reuses the existing parser to normalize brand, name, and size", () => {
    const guess = parseProductGuess(
      JSON.stringify({
        brand: "La Roche-Posay",
        name: "Cicaplast Baume B5 40ml",
        size: "40 ml",
        confidence: 0.8,
      }),
    );
    const { query, warnings } = queryFromGuess(guess);
    expect(query).toEqual({
      name: "cicaplast baume b5",
      brand: "la roche posay",
      size: { value: 40, unit: "ml" },
    });
    expect(warnings).toEqual([]);
  });
});
