/* global self, caches, fetch */

const CACHE_NAME = "npc-shell-v1";
const OFFLINE_FALLBACK = "/";
const APP_SHELL = [
  "/",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];
const CACHEABLE_DESTINATIONS = new Set([
  "style",
  "script",
  "image",
  "font",
  "manifest",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API responses include search SSE, product text, and photo uploads. Never cache them.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(OFFLINE_FALLBACK, copy)),
            );
          }
          return response;
        })
        .catch(async () => (await caches.match(OFFLINE_FALLBACK)) || Response.error()),
    );
    return;
  }

  const shouldCache =
    CACHEABLE_DESTINATIONS.has(request.destination) ||
    url.pathname.startsWith("/_next/static/") ||
    APP_SHELL.includes(url.pathname);
  if (!shouldCache) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});
