// Service worker Salonia : mise en cache de l'interface pour un usage hors-ligne.
const VERSION = "salonia-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const PRECACHE = ["/offline", "/login", "/icons/192", "/icons/512"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Fichiers statiques versionnés : cache d'abord.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages : réseau d'abord, puis la dernière version en cache, puis la page hors-ligne.
  // Les pages connectées (/dashboard) ne sont jamais mises en cache : données personnelles.
  if (request.mode === "navigate") {
    const cacheable = !url.pathname.startsWith("/dashboard");
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && cacheable) {
            const copy = res.clone();
            caches.open(PAGES_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) || caches.match("/offline")),
    );
  }
});
