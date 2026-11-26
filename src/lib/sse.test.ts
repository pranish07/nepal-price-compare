import { describe, expect, it } from "vitest";
import { formatSse } from "./sse";

describe("formatSse", () => {
  it("writes a named event with JSON data", () => {
    const frame = formatSse({ type: "status", phase: "cache", message: "Served from cache (hit)." });
    expect(frame).toBe(
      'event: status\ndata: {"type":"status","phase":"cache","message":"Served from cache (hit)."}\n\n',
    );
  });

  it("round-trips the done event", () => {
    const result = {
      query: { name: "Melaclear Cream" },
      listings: [],
      badges: [],
      coverage: { checked: 1, responded: 0, failed: 0, listings: 0, sources: [] },
      budget: {
        creditsUsed: 0,
        creditsMax: 8,
        fetchesUsed: 0,
        fetchesMax: 25,
        cacheStatus: "miss" as const,
        cacheHits: 0,
        cacheMisses: 1,
      },
      generatedAt: "2026-01-01T00:00:00.000Z",
      notes: [],
      partial: true as const,
    };
    const frame = formatSse({ type: "done", result });
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    expect(dataLine).toBeDefined();
    expect(JSON.parse(dataLine!.slice(6))).toEqual({ type: "done", result });
  });
});
