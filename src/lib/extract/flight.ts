function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parsePossiblyEscapedJson(raw: string): unknown {
  let value: unknown = tryParseJson(raw);
  if (value !== undefined) return value;
  let current = raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const unescaped = JSON.parse(`"${current}"`) as string;
      value = tryParseJson(unescaped);
      if (value !== undefined) return value;
      current = unescaped;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Extracts a JSON object embedded in a Next.js RSC flight payload. The payload
 * is a JavaScript string, so quotes are backslash-escaped. We scan for the
 * balanced braces first, then decode the string once or twice.
 */
export function extractEmbeddedObject<T = unknown>(
  html: string,
  marker: string,
): T | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = html.indexOf("{", markerIndex + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        const parsed = parsePossiblyEscapedJson(html.slice(start, i + 1));
        return parsed === undefined ? null : (parsed as T);
      }
    }
  }
  return null;
}
