// Service Worker básico para LuzFija.es
// Estrategia: App Shell (Pre-cache) + Runtime Caching (Contenido bajo demanda)

// IMPORTANTE: Al hacer deploy, actualiza CACHE_VERSION con la fecha/hora actual para forzar actualización.
// Bump this on every deploy to force clients to pick up the latest precache.
const CACHE_VERSION = "20260209-085205";
const CACHE_NAME = `luzfija-static-${CACHE_VERSION}`;


// Scope (para que funcione igual en dominio raíz y en subcarpetas de GitHub Pages)
const SCOPE = self.registration.scope;
const INDEX_PATH = new URL("index.html", SCOPE).pathname;
const TARIFAS_PATH = new URL("tarifas.json", SCOPE).pathname;
const NOVEDADES_PATH = new URL("novedades.json", SCOPE).pathname;

// ASSETS completos del sitio para precache best-effort.
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "pro.css",
  "fonts.css",
  "fonts/outfit-latin-100-normal.woff2",
  "fonts/outfit-latin-200-normal.woff2",
  "fonts/outfit-latin-300-normal.woff2",
  "fonts/outfit-latin-400-normal.woff2",
  "fonts/outfit-latin-500-normal.woff2",
  "fonts/outfit-latin-600-normal.woff2",
  "fonts/outfit-latin-700-normal.woff2",
  "fonts/outfit-latin-800-normal.woff2",
  "fonts/outfit-latin-900-normal.woff2",
  // Scripts de configuración
  "js/theme.js",
  "js/config.js",
  "js/lf-config.js",
  // Módulos LuzFija (Core)
  "js/lf-utils.js",
  "js/lf-csv-utils.js",
  "js/lf-state.js",
  "js/lf-ui.js",
  "js/lf-tooltips.js",
  "js/lf-cache.js",
  "js/lf-inputs.js",
  "js/lf-calc.js",
  "js/lf-render.js",
  "js/lf-csv-import.js",
  "js/lf-tarifa-custom.js",
  "js/lf-app.js",
  "js/pvpc.js",
  "js/factura.js",
  "js/index-extra.js",
  "js/tracking.js",
  "js/shell-lite.js",
  "js/desglose-factura.js",
  "js/desglose-integration.js",
  // Observatorio PVPC
  "estadisticas/index.html",
  "estadisticas/estadisticas.css",
  "estadisticas/estadisticas-mejorado.css",
  "js/pvpc-stats-engine.js",
  "js/pvpc-stats-ui.js",
  "vendor/chartjs/chart.umd.js",
  // Simulador Batería Virtual
  "comparador-tarifas-solares.html",
  "bv-sim.css",
  "comparador-solar-mejorado.css",
  "js/bv/bv-ui.js",
  "js/bv/bv-sim-monthly.js",
  "js/bv/bv-import.js",
  // Páginas principales
  "guias.html",
  "guias/index.html", // Índice de guías (ligero)
  "calcular-factura-luz.html",
  "comparar-pvpc-tarifa-fija.html",
  "privacidad.html",
  "aviso-legal.html",
  "404.html",
  // Recursos base
  "manifest.webmanifest",
  "logo-512.png",
  "icon-192.png",
  "og.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "desglose-factura.css",
  "vendor/jsqr/jsQR.js"
];

// Núcleo obligatorio para que la app principal arranque incluso offline.
// Si alguno falla, cancelamos instalación para no activar un SW roto.
const CORE_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "pro.css",
  "fonts.css",
  "fonts/outfit-latin-400-normal.woff2",
  "js/theme.js",
  "js/config.js",
  "js/lf-config.js",
  "js/lf-utils.js",
  "js/lf-csv-utils.js",
  "js/lf-state.js",
  "js/lf-ui.js",
  "js/lf-tooltips.js",
  "js/lf-cache.js",
  "js/lf-inputs.js",
  "js/lf-calc.js",
  "js/lf-render.js",
  "js/lf-csv-import.js",
  "js/lf-tarifa-custom.js",
  "js/lf-app.js",
  "js/pvpc.js",
  "js/tracking.js",
  "manifest.webmanifest",
  "favicon.ico",
  "icon-192.png",
  "apple-touch-icon.png"
];

const CORE_ASSET_SET = new Set(CORE_ASSETS);
const OPTIONAL_ASSETS = ASSETS.filter((p) => !CORE_ASSET_SET.has(p));

async function precacheRequired(cache, assets) {
  for (const asset of assets) {
    await cache.add(new URL(asset, SCOPE));
  }
}

async function precacheOptional(cache, assets) {
  if (!assets.length) return;
  const failed = [];
  await Promise.all(
    assets.map(async (asset) => {
      try {
        await cache.add(new URL(asset, SCOPE));
      } catch (_) {
        failed.push(asset);
      }
    })
  );

  if (failed.length) {
    // No abortamos instalación por extras: se llenarán en runtime según navegación.
    console.warn("[SW] Optional precache failures:", failed.length, failed.join(", "));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheRequired(cache, CORE_ASSETS);
      await precacheOptional(cache, OPTIONAL_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpieza de caches antiguas: esto asegura que tras un bump,
      // la caché se purga y se fuerza a red para archivos no listados en ASSETS.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Listener para mensajes del cliente (actualizar en demanda)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(new URL("api/", SCOPE).pathname)) return;

  // Navegación (HTML): network-first
  // Esto asegura que si entras a una guía (no precacheada), se intente bajar la última versión.
  // Si falla (offline), intentará servirla si ya la visitaste antes (estará en caché runtime).
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req);
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          return (await cache.match(req)) || (await cache.match(INDEX_PATH)) || Response.error();
        }
      })()
    );
    return;
  }

  // Tarifas: SIEMPRE red (sin caché)
  if (url.pathname === TARIFAS_PATH) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req, { cache: "no-store" });
        } catch (_) {
          return Response.error();
        }
      })()
    );
    // Limpiar cualquier resto cacheado de tarifas
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.delete(new Request(TARIFAS_PATH));
        } catch (_) {}
      })()
    );
    return;
  }

  // Novedades: stale-while-revalidate
  if (url.pathname === NOVEDADES_PATH) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = new Request(NOVEDADES_PATH);
        const cached = (await cache.match(cacheKey)) || (await cache.match(req));
        const fetchPromise = fetch(req, { cache: "no-store" })
          .then(async (fresh) => {
            await cachePutSafe(cache, cacheKey, fresh);
            return fresh;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(fetchPromise);
          return cached;
        }
        return (await fetchPromise) || Response.error();
      })()
    );
    return;
  }

  // Datos PVPC y Excedentes: network-first
  if (url.pathname.includes('/data/pvpc/') || url.pathname.includes('/data/surplus/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          return (await cache.match(req)) || Response.error();
        }
      })()
    );
    return;
  }

  // Resto (Imágenes de guías, scripts secundarios, etc.): stale-while-revalidate
  // Se cachean "al vuelo" la primera vez que se visitan.
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
