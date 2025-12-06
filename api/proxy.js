// worker.js — Proxy CORS limitado + caché edge + identificación (CNMC PVPC)
// Proyecto: LuzFija.es - Comparador educativo de tarifas eléctricas
// Licencia: MIT
// Contacto: hola@luzfija.es
// Repositorio: https://github.com/almax-es/luzfija.es

const ALLOWED_HOSTS = new Set(["comparador.cnmc.gob.es"]);

// 🔒 Path exacto de tu endpoint
const ALLOWED_PATH_PREFIXES = ["/api/ofertas/pvpc"];

const CACHE_TTL_SECONDS = 3600; // 1h

// 📊 Headers identificativos mejorados
const PROJECT_HEADERS = {
  "User-Agent": "LuzFija.es/1.0 (+https://luzfija.es; hola@luzfija.es) Educational Price Comparison Tool",
  "From": "hola@luzfija.es",
  "X-Proxy-For": "https://luzfija.es",
  "X-Project-Purpose": "Educational non-profit energy price comparison",
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Solo GET
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      const urlObj = new URL(request.url);
      const target = urlObj.searchParams.get("url");
      
      if (!target) {
        return json({ 
          error: "Missing 'url' parameter",
          usage: "?url=https://comparador.cnmc.gob.es/api/ofertas/pvpc?..."
        }, 400);
      }

      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        return json({ error: "Invalid 'url' parameter" }, 400);
      }

      // Validaciones de seguridad
      if (targetUrl.protocol !== "https:") {
        return json({ error: "Only https is allowed" }, 400);
      }
      
      if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
        return json({ 
          error: "Forbidden target host",
          allowed: Array.from(ALLOWED_HOSTS)
        }, 403);
      }
      
      if (
        ALLOWED_PATH_PREFIXES.length &&
        !ALLOWED_PATH_PREFIXES.some((p) => targetUrl.pathname.startsWith(p))
      ) {
        return json({ 
          error: "Forbidden target path",
          allowed_prefixes: ALLOWED_PATH_PREFIXES
        }, 403);
      }

      // Cache edge (por URL del worker incluyendo ?url=...)
      const cache = caches.default;
      const cacheKey = new Request(urlObj.toString(), { method: "GET" });

      // Intentar desde caché primero
      const cached = await cache.match(cacheKey);
      if (cached) {
        // Añadir header indicando que viene de caché
        const headers = new Headers(cached.headers);
        headers.set("X-Cache", "HIT");
        headers.set("X-Cache-Date", headers.get("date") || "unknown");
        
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers,
        });
      }

      // Fetch al origen con headers identificativos
      const upstreamResponse = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json, text/plain, */*",
          ...PROJECT_HEADERS,
        },
      });

      const body = await upstreamResponse.arrayBuffer();
      const headers = new Headers(upstreamResponse.headers);

      // Forzar CORS
      for (const [k, v] of Object.entries(corsHeaders())) {
        headers.set(k, v);
      }

      // Headers de caché y debugging
      headers.set("X-Cache", "MISS");
      headers.set("X-Cache-TTL", `${CACHE_TTL_SECONDS}s`);
      headers.set("X-Proxy-By", "LuzFija.es Worker");
      
      // Forzar cacheabilidad (edge)
      headers.set("cache-control", `public, max-age=${CACHE_TTL_SECONDS}`);
      headers.set("cdn-cache-control", `public, max-age=${CACHE_TTL_SECONDS}`);

      const response = new Response(body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
      });

      // Cachear solo éxitos (200-299)
      if (upstreamResponse.status >= 200 && upstreamResponse.status < 300) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
      
    } catch (err) {
      console.error("Proxy error:", err);
      
      return json({ 
        error: err?.message || "Proxy error",
        details: err?.stack?.split('\n')[0] || "Unknown error",
        timestamp: new Date().toISOString(),
        worker_version: "1.0.0"
      }, 500);
    }
  },
};
