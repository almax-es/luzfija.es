// Service Worker básico para LuzFija.es
// Nota: antes era "cache-first" puro, lo que dejaba CSS/JS/tarifas.json congelados en móvil.
// Ahora usamos:
// - HTML (navegación): network-first con fallback a cache
// - tarifas.json: stale-while-revalidate (sirve cache al instante y actualiza en segundo plano)
// - resto de estáticos: stale-while-revalidate (sirve cache rápido y actualiza en segundo plano)

// IMPORTANTE: si cambias este fichero, incrementa CACHE_NAME para forzar la actualización.
// Bump de versión para forzar actualización de assets tras cambios (release incremental)
const CACHE_NAME = "luzfija-static-v4.15";

const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/pvpc.js",
  "/factura.js",
  // tarifas.json NO está en precache, se maneja con stale-while-revalidate
  "/guias.html",
  "/manifest.webmanifest",
  "/logo-512.png",
  "/icon-192.png",
  "/og.png",
  "/favicon.ico",
  "/favicon.png",
  "/favicon.svg",
  "/favicon-48x48.png",
  "/favicon-96x96.png",
  "/apple-touch-icon.png",
  "/tracking.js",
  "/desglose-factura.css",
  "/desglose-factura.js",
  "/desglose-integration.js",
  "/guias.css",
  "/calcular-factura-luz.html",
  "/comparar-pvpc-tarifa-fija.html",
  "/mejor-tarifa-placas-solares.html",
  "/mejor-tarifa-coche-electrico.html",
  "/mejor-tarifa-discriminacion-horaria.html",
  "/privacidad.html",
  "/aviso-legal.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpieza de caches antiguas
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));

      // El nuevo SW pasa a controlar a los clientes (si estaban sin controlador)
      await self.clients.claim();

      // FIX: Se ha eliminado la auto-recarga automática que causaba que el spinner
      // nunca dejara de girar. Los usuarios verán los cambios en la siguiente visita
      // o pueden hacer Ctrl+F5 para forzar la actualización si es necesario.
    })()
  );
});

async function cachePutSafe(cache, req, res) {
  try {
    if (res && res.ok) await cache.put(req, res.clone());
  } catch (_) {
    /* ignore */
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo manejamos peticiones GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo cacheamos same-origin
  if (url.origin !== self.location.origin) return;

  // No interceptamos llamadas a la API PVPC ni a otros endpoints dinámicos
  if (url.pathname.startsWith("/api/")) return;

  // Navegación (HTML): network-first
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req);
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          return (await cache.match(req)) || (await cache.match("/index.html")) || Response.error();
        }
      })()
    );
    return;
  }

  // Tarifas: stale-while-revalidate (sirve cache al instante y actualiza en segundo plano)
  if (url.pathname === "/tarifas.json") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Normalizamos la clave para que funcione también si la app pide /tarifas.json?v=...
        const cacheKey = new Request("/tarifas.json");
        const cached = (await cache.match(cacheKey)) || (await cache.match(req));

        const fetchPromise = fetch(req, { cache: "no-store" })
          .then(async (res) => {
            await cachePutSafe(cache, cacheKey, res);
            return res;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(fetchPromise);
          return cached;
        }

        const fresh = await fetchPromise;
        return fresh || Response.error();
      })()
    );
    return;
  }

  // Resto: stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then(async (fresh) => {
        await cachePutSafe(cache, req, fresh);
        return fresh;
      });

      if (cached) {
        event.waitUntil(fetchPromise.catch(() => {}));
        return cached;
      }

      try {
        return await fetchPromise;
      } catch (_) {
        return Response.error();
      }
    })()
  );
});
