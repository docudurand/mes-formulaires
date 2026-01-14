const CACHE_NAME = "durand-commerce-v3";
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }

  if (url.pathname.endsWith("/commerce/links.json")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  const isHtml = req.headers.get("accept")?.includes("text/html");
  if (isHtml) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        caches.match(req).then((r) => r || caches.match("./commerce"))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
    )
  );
});

