export const config = { runtime: 'edge' };

// Dominios permitidos (whitelist)
const ALLOWED_ORIGINS = [
  'https://luzfija.es',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
];

// Calcular segundos hasta medianoche (nota: en Edge Functions puede variar según el PoP)
function getSecondsUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const diff = tomorrow - now;
  return Math.max(60, Math.floor(diff / 1000));
}

// Validar origin y devolver el permitido (o null si no permitido)
function getAllowedOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Sin Origin header = petición directa o same-origin
    return ALLOWED_ORIGINS[0]; // Fallback a luzfija.es
  }
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return null; // No permitido
}

// Detectar si es localhost (dev) para no cachear
function isLocalhost(request) {
  const origin = request.headers.get('origin');
  return origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));
}

function corsBase(request) {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(request),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin', // CRÍTICO: evitar cache poisoning
  };
}

function corsPreflight(request) {
  const reqHeaders = request.headers.get('access-control-request-headers') || 'Content-Type';
  return {
    ...corsBase(request),
    'Access-Control-Allow-Headers': reqHeaders,
    'Access-Control-Max-Age': '86400',
    // Varía por Origin (cache poisoning) y headers pedidos
    'Vary': 'Origin, Access-Control-Request-Headers',
  };
}

function corsActual(request) {
  // Para respuestas GET / errores no hace falta Allow-Headers
  return { ...corsBase(request) };
}

export default async function handler(request) {
  // Validar origin si viene de CORS
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsPreflight(request) });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsActual(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsActual(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsActual(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Solo permitir HTTPS (seguridad)
    if (target.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'Only HTTPS URLs allowed' }), {
        status: 400,
        headers: { ...corsActual(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Solo permitir CNMC + endpoint PVPC (evita SSRF y cosas raras)
    if (target.hostname !== 'comparador.cnmc.gob.es' || !target.pathname.startsWith('/api/ofertas/pvpc')) {
      return new Response(JSON.stringify({ error: 'Only CNMC PVPC is allowed' }), {
        status: 403,
        headers: { ...corsActual(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Timeout para que nunca se quede colgado
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);

    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    }).finally(() => clearTimeout(t));

    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

    // ✅ Si upstream NO es 2xx → NO CACHEAR
    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...corsActual(request),
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    }

    // ✅ Solo cachear 2xx (NO cachear localhost para evitar cache poisoning)
    const ttl = getSecondsUntilMidnight();
    const cacheControl = isLocalhost(request) 
      ? 'no-store' 
      : `public, s-maxage=${ttl}, stale-while-revalidate=60`;
    
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...corsActual(request),
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        ...(isLocalhost(request) ? {} : { 'CDN-Cache-Control': `max-age=${ttl}` }),
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsActual(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
