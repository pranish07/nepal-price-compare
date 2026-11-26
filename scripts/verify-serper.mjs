#!/usr/bin/env node
/**
 * Optional live probe for Serper response shape. It spends credits when a key is
 * present. The API key is sent as a header only and is never printed.
 *
 * Usage:
 *   SERPER_API_KEY=... npm run verify:serper -- "Dr. Althea Melaclear Cream Nepal" --num=20
 */
const apiKey = process.env.SERPER_API_KEY?.trim();

if (!apiKey) {
  console.log("SERPER_API_KEY is not set. Skipping without spending credits.");
  process.exit(0);
}

const args = process.argv.slice(2);
let num = 10;
let gl = "np";
const queryParts = [];

for (const arg of args) {
  if (arg.startsWith("--num=")) {
    num = Number.parseInt(arg.slice("--num=".length), 10);
  } else if (arg.startsWith("--gl=")) {
    gl = arg.slice("--gl=".length).trim().toLowerCase();
  } else if (arg === "--help" || arg === "-h") {
    console.log('Usage: npm run verify:serper -- "product query" [--num=10] [--gl=np]');
    process.exit(0);
  } else {
    queryParts.push(arg);
  }
}

const query = queryParts.join(" ").trim();

if (!query) {
  console.error("Provide a product query. Example: npm run verify:serper -- 'Melaclear Cream Nepal'");
  process.exit(2);
}
if (!Number.isInteger(num) || num < 1 || num > 100) {
  console.error("--num must be an integer between 1 and 100.");
  process.exit(2);
}
if (!/^[a-z]{2}$/.test(gl)) {
  console.error("--gl must be a two-letter country code.");
  process.exit(2);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);

try {
  console.log(`Requesting Serper: q=${JSON.stringify(query)} num=${num} gl=${gl} page=1`);
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num, gl, hl: "en", page: 1 }),
    signal: controller.signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `HTTP ${response.status}`;
    console.error(`Serper request failed: ${message}`);
    process.exitCode = 1;
  } else {
    const organic = Array.isArray(payload?.organic) ? payload.organic : [];
    const hosts = [];
    for (const result of organic) {
      try {
        const host = new URL(String(result.link ?? "")).hostname;
        if (!hosts.includes(host)) hosts.push(host);
      } catch {
        // Ignore malformed links in the response.
      }
    }
    console.log(`HTTP status: ${response.status}`);
    console.log(`Organic results returned: ${organic.length}`);
    console.log(`Top result hosts: ${hosts.slice(0, 10).join(", ") || "(none)"}`);
    if (typeof payload?.credits === "number") {
      console.log(`Credits reported by Serper: ${payload.credits}`);
    } else {
      console.log("Credits reported by Serper: not included in response");
    }
    console.log("Note: this probe cannot prove that Serper ignores num > 10; compare returned counts yourself.");
  }
} catch (error) {
  console.error(`Serper request failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
