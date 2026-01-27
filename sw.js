// Service Worker básico para LuzFija.es
// Nota: antes era "cache-first" puro, lo que dejaba CSS/JS/tarifas.json congelados en móvil.
// Ahora usamos:
// - HTML (navegación): network-first con fallback a cache
// - tarifas.json: stale-while-revalidate (sirve cache al instante y actualiza en segundo plano)
// - resto de estáticos: stale-while-revalidate (sirve cache rápido y actualiza en segundo plano)

// IMPORTANTE: Al hacer deploy, actualiza CACHE_VERSION con la fecha/hora actual para forzar actualización.
// Bump this on every deploy to force clients to pick up the latest precache.
const CACHE_VERSION = "20260127-123000";
const CACHE_NAME = `luzfija-static-${CACHE_VERSION}`;


// Scope (para que funcione igual en dominio raíz y en subcarpetas de GitHub Pages)
const SCOPE = self.registration.scope;
const INDEX_PATH = new URL("index.html", SCOPE).pathname;
const TARIFAS_PATH = new URL("tarifas.json", SCOPE).pathname;
const NOVEDADES_PATH = new URL("novedades.json", SCOPE).pathname;
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
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
  // Scripts de configuración (deben cargarse antes del render)
  "js/theme.js",
  "js/config.js",
  // Config regulatoria (usada por el comparador; imprescindible también offline)
  "js/lf-config.js",
  // Módulos LuzFija (nueva estructura modular)
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
  "js/desglose-factura.js",
  "js/desglose-integration.js",
  // Observatorio PVPC (Nueva Sección)
  "estadisticas/index.html",
  "estadisticas/estadisticas.css",
  "js/pvpc-stats-engine.js",
  "js/pvpc-stats-ui.js",
  "js/pvpc-stats-worker.js",
  "vendor/chartjs/chart.umd.js",
  // Simulador Batería Virtual
  "comparador-tarifas-solares.html",
  "bv-sim.css",
  "js/bv/bv-ui.js",
  "js/bv/bv-sim-monthly.js",
  "js/bv/bv-import.js",
  // Guías y contenido estático (Carga Completa)
  "guias.html",
  "guias/index.html",
  "guias/aerotermia-termo-electrico-y-bomba-de-calor-consumos-reales-y-tarifas.html",
  "guias/autoconsumo-avanzado-excedentes-compensacion-y-bateria-virtual.html",
  "guias/autoconsumo-y-placas-solares-lo-basico.html",
  "guias/bono-social-electrico-quien-puede-pedirlo-y-como.html",
  "guias/coche-electrico-que-tarifa-elegir-y-como-cargar-barato.html",
  "guias/como-adaptar-tus-horarios-para-pagar-menos-luz.html",
  "guias/como-cambiar-de-compania-sin-cortes-y-sin-que-te-li-en.html",
  "guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html",
  "guias/como-reclamar-a-comercializadora-distribuidora.html",
  "guias/como-ver-tu-consumo-horario-real-el-del-contador-no-el-estimado.html",
  "guias/cups-que-es-y-donde-encontrarlo.html",
  "guias/diferencia-entre-comercializadora-y-distribuidora.html",
  "guias/errores-tipicos-en-la-factura-de-la-luz.html",
  "guias/estafas-y-llamadas-comerciales-como-detectarlas-y-que-hacer.html",
  "guias/instalar-punto-recarga-garaje-comunitario.html",
  "guias/la-letra-pequena-topes-de-kwh-cuotas-descuentos-y-permanencias.html",
  "guias/lectura-real-vs-estimada-como-evitar-sustos-y-facturones.html",
  "guias/mudanza-y-alquiler-cambio-de-titular-alta-baja-y-cosas-que-nadie-te-dice.html",
  "guias/pvpc-vs-mercado-libre-cuando-te-conviene-cada-uno.html",
  "guias/que-es-p1-p2-y-p3-en-tu-factura.html",
  "guias/que-potencia-contratar-segun-tu-casa-y-tus-habitos.html",
  "guias/servicios-extra-y-mantenimiento-como-detectarlos-y-quitarlos.html",
  "guias/tarifas-indexadas-pool-cuota-cuando-interesan-y-cuando-no.html",
  // Imágenes
  "img/adaptar-horarios-ahorro-luz.png",
  "img/aerotermia-consumo-eficiente.png",
  "img/bateria-virtual-excedentes-solar.png",
  "img/bono-social-descuento-factura.png",
  "img/cambio-compania-luz-sin-cortes.png",
  "img/coche-electrico-carga-barata.png",
  "img/diferencia-distribuidora-comercializadora.png",
  "img/donde-encontrar-codigo-cups-contador.png",
  "img/errores-factura-luz-aviso.png",
  "img/estafas-llamadas-comerciales-luz.png",
  "img/horarios-luz-p1-p2-p3-2026.png",
  "img/lectura-real-vs-estimada-luz.png",
  "img/letra-pequena-tarifas-trampas.png",
  "img/mudanza-cambio-titular-luz.png",
  "img/partes-factura-luz-esquema.png",
  "img/placas-solares-autoconsumo-basico.png",
  "img/potencia-contratada-equilibrio.png",
  "img/punto-recarga-garaje-comunitario.png",
  "img/pvpc-vs-mercado-libre-comparativa.png",
  "img/reclamar-factura-luz-guia.png",
  "img/servicios-extra-mantenimiento-eliminar.png",
  "img/tarifas-indexadas-pool-cuota-explicacion.png",
  "img/vampiro-standby-consumo-fantasma.png",
  "img/adaptar-horarios-ahorro-luz.webp",
  "img/aerotermia-consumo-eficiente.webp",
  "img/bateria-virtual-excedentes-solar.webp",
  "img/bono-social-descuento-factura.webp",
  "img/cambio-compania-luz-sin-cortes.webp",
  "img/coche-electrico-carga-barata.webp",
  "img/diferencia-distribuidora-comercializadora.webp",
  "img/donde-encontrar-codigo-cups-contador.webp",
  "img/errores-factura-luz-aviso.webp",
  "img/estafas-llamadas-comerciales-luz.webp",
  "img/horarios-luz-p1-p2-p3-2026.webp",
  "img/lectura-real-vs-estimada-luz.webp",
  "img/letra-pequena-tarifas-trampas.webp",
  "img/mudanza-cambio-titular-luz.webp",
  "img/partes-factura-luz-esquema.webp",
  "img/placas-solares-autoconsumo-basico.webp",
  "img/potencia-contratada-equilibrio.webp",
  "img/punto-recarga-garaje-comunitario.webp",
  "img/pvpc-vs-mercado-libre-comparativa.webp",
  "img/reclamar-factura-luz-guia.webp",
  "img/servicios-extra-mantenimiento-eliminar.webp",
  "img/tarifas-indexadas-pool-cuota-explicacion.webp",
  "img/vampiro-standby-consumo-fantasma.webp",
  // Varios
  "manifest.webmanifest",
  "logo-512.png",
  "icon-192.png",
  "og.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "desglose-factura.css",
  "calcular-factura-luz.html",
  "comparar-pvpc-tarifa-fija.html",
  "privacidad.html",
  "aviso-legal.html",
  "404.html",
  "novedades.json",
  "data/pvpc/index.json",
  "vendor/jsqr/jsQR.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((p) => new URL(p, SCOPE))))
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
  if (url.pathname.startsWith(new URL("api/", SCOPE).pathname)) return;

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
          return (await cache.match(req)) || (await cache.match(INDEX_PATH)) || Response.error();
        }
      })()
    );
    return;
  }

  // Tarifas: stale-while-revalidate (sirve cache al instante y actualiza en segundo plano)
  if (url.pathname === TARIFAS_PATH) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Normalizamos la clave para que funcione también si la app pide /tarifas.json?v=...
        const cacheKey = new Request(TARIFAS_PATH);
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

  // Novedades: stale-while-revalidate (no es crítico; si falla, el front lo ignora)
  if (url.pathname === NOVEDADES_PATH) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Normalizamos la clave para que funcione también si la app pide /novedades.json?v=...
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

  // Datos PVPC: network-first (siempre intenta obtener datos frescos primero)
  if (url.pathname.includes('/data/pvpc/')) {
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