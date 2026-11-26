import fs from "node:fs";

function extractEmbeddedObject(html, marker) {
  const i = html.indexOf(marker);
  if (i === -1) return null;
  const start = html.indexOf("{", i + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let escaped = false;
  let inString = false;
  let out = "";
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    out += c;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return JSON.parse(JSON.parse(`"${out}"`));
}

const html = fs.readFileSync("beauty_shop_search_dr_althea.html", "utf8");
const parsed = extractEmbeddedObject(html, "initialProductsResponse");
console.log("data length:", parsed.data.length);
console.log("first keys:", Object.keys(parsed.data[0]));
console.log("total keys:", Object.keys(parsed));
console.log("sample:", JSON.stringify(parsed.data[2], null, 2));
