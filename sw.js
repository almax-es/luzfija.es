// Service Worker básico para LuzFija.es
// Estrategia: App Shell (Pre-cache) + Runtime Caching (Contenido bajo demanda)

// IMPORTANTE: Al hacer deploy, actualiza CACHE_VERSION con la fecha/hora actual para forzar actualización.
// Bump this on every deploy to force clients to pick up the latest precache.
const CACHE_VERSION = "20260722-121753";
const CACHE_NAME = `luzfija-static-${CACHE_VERSION}`;
// El build 20260620-051941 contenía un handler del simulador solar que podía
// llamar `target.closest()` sobre un target no-Element. A diferencia de las
// pestañas nuevas, esas pestañas viejas no cargan lf-sw-update.js y pueden
// permanecer abiertas durante semanas. Al activar este SW, migramos solo esas
// pestañas del simulador a los assets corregidos. La condición es deliberadamente
// exacta y se puede retirar cuando deje de haber clientes con esa caché.
const LEGACY_SOLAR_CLOSEST_CACHE = "luzfija-static-20260620-051941";


// Scope (para que funcione igual en dominio raíz y en subcarpetas de GitHub Pages)
const SCOPE = self.registration.scope;
const INDEX_PATH = new URL("index.html", SCOPE).pathname;
const TARIFAS_PATH = new URL("tarifas.json", SCOPE).pathname;
const GUIDES_SEARCH_INDEX_PATH = new URL("data/guides-search-index.json", SCOPE).pathname;
const GOAT_SCRIPT_PATH = new URL("vendor/goatcounter/count.js", SCOPE).pathname;
const ASSISTANT_REFERENCE_PATHS = new Set([
  new URL("llms.txt", SCOPE).pathname,
  new URL("llms-full.txt", SCOPE).pathname
]);

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
  "js/error-bootstrap.js",
  "js/lf-config.js",
  // Módulos LuzFija (Core)
  "js/lf-utils.js",
  "js/lf-ssaa.js",
  "js/lf-csv-utils.js",
  "js/lf-surplus-prices.js",
  "js/lf-state.js",
  "js/lf-ui.js",
  "js/lf-tooltips.js",
  "js/lf-cache.js",
  "js/lf-inputs.js",
  "js/lf-calc.js",
  "js/lf-render.js",
  "js/lf-csv-import.js",
  "js/lf-tarifa-custom.js",
  "js/lf-sw-update.js",
  "js/lf-app.js",
  "js/pvpc.js",
  "js/factura-parsers.js",
  "js/factura.js",
  "js/index-extra.js",
  "js/index-extra-loader.js",
  "js/tracking.js",
  "js/aecc-banner.js",
  "js/shell-lite.js",
  "js/guides-search.js",
  "js/desglose-calculo.js",
  "js/desglose-render.js",
  "js/desglose-factura.js",
  "js/desglose-integration.js",
  // Observatorio PVPC
  "estadisticas/index.html",
  "estadisticas/estadisticas.css",
  "estadisticas/estadisticas-mejorado.css",
  "js/pvpc-stats-engine.js",
  "js/pvpc-stats-csv.js",
  "js/pvpc-stats-ui.js",
  "vendor/chartjs/chart.umd.js",
  // Simulador Batería Virtual
  "comparador-tarifas-solares.html",
  "bv-sim.css",
  "comparador-solar-mejorado.css",
  "js/bv/bv-ui-helpers.js",
  "js/bv/bv-ui.js",
  "js/bv/bv-sim-monthly.js",
  "js/bv/bv-import.js",
  // Páginas principales
  "guias.html",
  "guias/index.html", // Índice de guías (ligero)
  "data/guides-search-index.json",
  "calcular-factura-luz.html",
  "comparar-pvpc-tarifa-fija.html",
  "privacidad.html",
  "aviso-legal.html",
  "como-funciona-luzfija.html",
  "404.html",
  // Recursos base
  "manifest.webmanifest",
  "logo-512.png",
  "icon-192.png",
  "og.png",
  "img/aecc-logo.svg",
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
  "js/error-bootstrap.js",
  "js/theme.js",
  "js/config.js",
  "js/lf-config.js",
  "js/lf-utils.js",
  "js/lf-ssaa.js",
  "js/lf-csv-utils.js",
  "js/lf-surplus-prices.js",
  "js/lf-state.js",
  "js/lf-ui.js",
  "js/lf-tooltips.js",
  "js/lf-cache.js",
  "js/lf-inputs.js",
  "js/lf-calc.js",
  "js/lf-render.js",
  "js/lf-csv-import.js",
  "js/lf-tarifa-custom.js",
  "js/lf-sw-update.js",
  "js/lf-app.js",
  "js/pvpc.js",
  // La home los carga siempre y tienen dependencias de orden estrictas.
  // Deben instalarse de forma atomica con el shell: si falta uno, activar el
  // SW nuevo dejaria factura/desglose a medias y produciria errores en cascada.
  "js/factura-parsers.js",
  "js/factura.js",
  "js/desglose-calculo.js",
  "js/desglose-render.js",
  "js/desglose-factura.js",
  "js/desglose-integration.js",
  "js/tracking.js",
  "manifest.webmanifest",
  "favicon.ico",
  "icon-192.png",
  "apple-touch-icon.png"
];

const CORE_ASSET_SET = new Set(CORE_ASSETS);
const OPTIONAL_ASSETS = ASSETS.filter((p) => !CORE_ASSET_SET.has(p));
const REQUIRED_ROUTE_GROUPS = {
  solar: [
    "comparador-tarifas-solares.html",
    "bv-sim.css",
    "comparador-solar-mejorado.css",
    "js/shell-lite.js",
    "js/bv/bv-ui-helpers.js",
    "js/bv/bv-ui.js",
    "js/bv/bv-sim-monthly.js",
    "js/bv/bv-import.js"
  ],
  estadisticas: [
    "estadisticas/index.html",
    "estadisticas/estadisticas.css",
    "estadisticas/estadisticas-mejorado.css",
    "js/shell-lite.js",
    "js/pvpc-stats-engine.js",
    "js/pvpc-stats-csv.js",
    "js/pvpc-stats-ui.js",
    "vendor/chartjs/chart.umd.js"
  ]
};

const PRECACHE_REQUIRED_ATTEMPTS = 3;
const PRECACHE_OPTIONAL_ATTEMPTS = 2;

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function addToCacheWithRetry(cache, asset, attempts) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // El nombre de cache identifica el build, pero los assets se guardan con
      // URL estable (sin ?v=). Forzar `reload` evita que el HTTP cache del
      // navegador (max-age=600 en producción) introduzca bytes de un deploy
      // anterior dentro de la cache recién nombrada.
      const request = new Request(new URL(asset, SCOPE), { cache: "reload" });
      await cache.add(request);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await waitFor(150 * attempt);
    }
  }
  throw lastError || new Error(`No se pudo precachear ${asset}`);
}

async function precacheRequired(cache, assets) {
  for (const asset of assets) {
    await addToCacheWithRetry(cache, asset, PRECACHE_REQUIRED_ATTEMPTS);
  }
}

async function precacheOptional(cache, assets) {
  if (!assets.length) return;
  const failed = [];
  await Promise.all(
    assets.map(async (asset) => {
      try {
        await addToCacheWithRetry(cache, asset, PRECACHE_OPTIONAL_ATTEMPTS);
      } catch (_) {
        failed.push(asset);
      }
    })
  );

  if (failed.length) {
    // No abortamos instalación por extras: se llenarán en runtime según navegación.
    console.warn("[SW] Optional precache failures:", failed.length, failed.join(", "));
  }
  return failed;
}

function assertRequiredRouteGroups(failedAssets) {
  if (!failedAssets || !failedAssets.length) return;
  const failedSet = new Set(failedAssets);
  const incompleteGroups = Object.entries(REQUIRED_ROUTE_GROUPS)
    .filter(([, assets]) => assets.some((asset) => failedSet.has(asset)))
    .map(([name]) => name);
  if (incompleteGroups.length) {
    throw new Error(`Precache incompleto para rutas: ${incompleteGroups.join(", ")}`);
  }
}

async function reloadLegacySolarClients(cacheKeys) {
  if (!cacheKeys.includes(LEGACY_SOLAR_CLOSEST_CACHE)) return;

  const solarPath = new URL("comparador-tarifas-solares.html", SCOPE).pathname;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(clients.map(async (client) => {
    try {
      if (new URL(client.url).pathname === solarPath) await client.navigate(client.url);
    } catch (_) {
      // El cliente puede cerrarse entre matchAll() y navigate().
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheRequired(cache, CORE_ASSETS);
      const optionalFailures = await precacheOptional(cache, OPTIONAL_ASSETS);
      // Solar y estadísticas pueden tolerar extras ausentes, pero no una cadena
      // funcional partida. Si falla su núcleo, conservar el SW anterior y volver
      // a intentar la instalación en la siguiente comprobación de actualización.
      assertRequiredRouteGroups(optionalFailures);
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
      await reloadLegacySolarClients(keys);
    })()
  );
});

// Listener para mensajes del cliente (actualizar en demanda / consultar versión)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  // GET_VERSION: el cliente usa CACHE_VERSION como identidad del deploy para su
  // guard anti-bucle de recarga (una recarga por versión y pestaña).
  if (event.data && event.data.type === "GET_VERSION") {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: CACHE_VERSION });
    }
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
          // fetch() resuelve también ante HTTP 4xx/5xx. Para errores transitorios
          // del servidor o rate limiting, preferir una copia visitada y sana.
          // Los 404/410 reales se conservan para no revivir páginas retiradas.
          if (fresh.status === 408 || fresh.status === 429 || fresh.status >= 500) {
            return (await cache.match(req, { ignoreSearch: true })) ||
              (await cache.match(INDEX_PATH)) || fresh;
          }
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          return (await cache.match(req, { ignoreSearch: true })) || (await cache.match(INDEX_PATH)) || Response.error();
        }
      })()
    );
    return;
  }

  // Scripts/CSS: network-first para evitar ejecutar JS/CSS obsoleto durante horas.
  // Mantiene fallback a caché para modo offline.
  if (req.destination === "script" || req.destination === "style" || req.destination === "worker") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req, { cache: "no-cache" });
          // fetch() no rechaza en HTTP 4xx/5xx. No entregar una respuesta de
          // error si tenemos el asset sano en la cache del build activo.
          if (!fresh.ok) throw new Error(`HTTP ${fresh.status}`);
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          // El sender de GoatCounter sigue siendo network-only: sin red no puede
          // enviar y no queremos ejecutar copias antiguas. tracking.js sí debe
          // recuperarse desde la caché del build activo para poder observar el
          // resto de fallos de carga; activate purga las cachés de builds previos.
          if (url.pathname === GOAT_SCRIPT_PATH) {
            return Response.error();
          }
          // Recursos versionados (?v=...): intentar fallback por pathname exacto
          // para no mezclar query-strings entre builds.
          if (url.search) {
            const versionedFallback = await cache.match(new Request(url.pathname));
            return versionedFallback || Response.error();
          }
          return (await cache.match(req, { ignoreSearch: true })) || Response.error();
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

  // Índice de búsqueda de guías: network-first para no mezclar una UI nueva con un índice viejo.
  if (url.pathname === GUIDES_SEARCH_INDEX_PATH || ASSISTANT_REFERENCE_PATHS.has(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          return (await cache.match(req, { ignoreSearch: true })) || Response.error();
        }
      })()
    );
    return;
  }

  // Datos PVPC, Excedentes y SSAA: network-first
  if (url.pathname.includes('/data/pvpc/') || url.pathname.includes('/data/surplus/') || url.pathname.includes('/data/ssaa/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          await cachePutSafe(cache, req, fresh);
          return fresh;
        } catch (_) {
          return (await cache.match(req, { ignoreSearch: true })) || Response.error();
        }
      })()
    );
    return;
  }

  // Resto (imágenes y otros estáticos): stale-while-revalidate
  // Se cachean "al vuelo" la primera vez que se visitan.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
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
