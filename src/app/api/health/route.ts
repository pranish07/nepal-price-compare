import { CONFIG, isGeminiConfigured, isKvConfigured, isSerperConfigured } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: "ok",
      version: CONFIG.version,
      uptimeSeconds: Math.round(process.uptime()),
      serperConfigured: isSerperConfigured(),
      geminiConfigured: isGeminiConfigured(),
      kvConfigured: isKvConfigured(),
      cacheMode: isKvConfigured() ? "upstash" : "memory",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
