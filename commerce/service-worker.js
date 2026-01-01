const CACHE_NAME = "durand-commerce-v5";
const CORE_ASSETS = [
  "./commerce",
  "./commerce.html",
  "./garantie.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",

  "/assets/auth.js",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/favicon-32x32.png",
  "/assets/icons/favicon-16x16.png",
];

function canCacheRequest(req) {
  try {
    const url = new URL(req.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.origin !== self.location.origin) return false;
    if (req.method !== "GET") return false;
    if (req.headers.has("range")) return false;
    return true;
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(
        CORE_ASSETS.map(async (url) => {
          try {
            const req = new Request(url, { cache: "reload" });
            const res = await fetch(req);
            if (res && res.ok) await cache.put(req, res.clone());
          } catch (_) {}
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (!canCacheRequest(req)) return;

  const accept = req.headers.get("accept") || "";
  const isHtml =
    accept.includes("text/html") ||
    req.mode === "navigate";

  if (isHtml) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, res.clone());
          }
          return res;
        } catch (_) {
          const cached = await caches.match(req);
          return cached || (await caches.match("./commerce")) || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, res.clone());
      }
      return res;
    })()
  );
});
