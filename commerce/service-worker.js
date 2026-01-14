const CACHE_NAME = "durand-commerce-v4";
const CORE_ASSETS = [
  "./commerce",
  "./commerce.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "../assets/auth.js",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/favicon-32x32.png",
  "/assets/icons/favicon-16x16.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  const accept = req.headers.get("accept") || "";
  const isHtml = accept.includes("text/html");

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./commerce")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});