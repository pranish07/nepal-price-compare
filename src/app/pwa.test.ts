import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import createManifest from "./manifest";

const manifest = createManifest();
const publicDir = path.resolve(process.cwd(), "public");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

function pngSize(file: string): { width: number; height: number } | null {
  const bytes = readFileSync(file);
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng || bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("declares an installable standalone app", () => {
    expect(manifest.name).toBe("Nepal Price Compare");
    expect(manifest.short_name).toBe("Price Compare");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#065f46");
  });

  it("references existing, correctly sized PNG icons including a maskable icon", () => {
    const icons = manifest.icons as ManifestIcon[];
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);

    for (const icon of icons) {
      const file = path.join(publicDir, icon.src.replace(/^\//, ""));
      expect(existsSync(file)).toBe(true);
      expect(icon.type).toBe("image/png");

      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(file)).toEqual({ width, height });
    }
  });
});

describe("service worker", () => {
  const sw = readFileSync(path.join(publicDir, "sw.js"), "utf8");

  it("caches an app shell and never caches API or photo requests", () => {
    expect(sw).toContain('const OFFLINE_FALLBACK = "/"');
    expect(sw).toContain("cache.addAll(APP_SHELL)");

    const apiGuard = sw.indexOf('url.pathname.startsWith("/api/")');
    const cachePut = sw.indexOf("cache.put(request, copy)");
    expect(apiGuard).toBeGreaterThan(-1);
    expect(cachePut).toBeGreaterThan(-1);
    expect(apiGuard).toBeLessThan(cachePut);
  });
});
