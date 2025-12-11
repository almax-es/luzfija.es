// Service Worker básico para LuzFija.es
const CACHE_NAME = "luzfija-static-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/pvpc.js",
  "/factura.js",
  "/tarifas.json",
  "/logo-512.png",
  "/icon-192.png",
  "/og.png",
  "/favicon.ico",
  "/favicon.png",
  "/favicon.svg",
  "/guias.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Solo manejamos peticiones GET
  if (req.method !== "GET") {
    return;
  }

  const url = new URL(req.url);

  // No interceptamos llamadas a la API PVPC ni a otros endpoints dinámicos
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Estratégia cache-first para estáticos
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        return cached;
      }
      return fetch(req).then(res => {
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});
