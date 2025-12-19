export const config = { runtime: 'edge' };

// Calcular segundos hasta medianoche (nota: en Edge Functions puede variar según el PoP)
function getSecondsUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const diff = tomorrow - now;
  return Math.max(60, Math.floor(diff / 1000));
}

// Calcular segundos hasta medianoche de España (solo para ESIOS/PVPC)
function getSecondsUntilMidnightSpain() {
  const now = new Date();
  const nowSpain = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  
  const midnight = new Date(nowSpain);
  midnight.setHours(24, 0, 0, 0);
  
  const diff = midnight - nowSpain;
  return Math.max(60, Math.floor(diff / 1000));
}

function corsBase() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function corsPreflight(request) {
  const reqHeaders = request.headers.get('access-control-request-headers') || 'Content-Type';
  return {
    ...corsBase(),
    'Access-Control-Allow-Headers': reqHeaders,
    'Access-Control-Max-Age': '86400',
    // Solo varía por los headers pedidos en preflight
    'Vary': 'Access-Control-Request-Headers',
  };
}

function corsActual() {
  // Para respuestas GET / errores no hace falta Allow-Headers
  return { ...corsBase() };
}

export default async function handler(request) {
  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsPreflight(request) });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Permitir CNMC (PVPC) y ESIOS (precios horarios)
    const isCNMC = target.hostname === 'comparador.cnmc.gob.es' && target.pathname.startsWith('/api/ofertas/pvpc');
    const isESIOS = target.hostname === 'api.esios.ree.es' && target.pathname.startsWith('/indicators');

    if (!isCNMC && !isESIOS) {
      return new Response(JSON.stringify({ error: 'Only CNMC PVPC and ESIOS are allowed' }), {
        status: 403,
        headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
          ...corsActual(),
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    }

    // ✅ Solo cachear 2xx
    // CNMC: mantener lógica original (hasta medianoche del servidor)
    // ESIOS: cachear hasta medianoche de España con revalidación larga
    let cacheControl, cdnCache;
    
    if (isESIOS) {
      // Para ESIOS: cachear hasta medianoche de España
      const ttlSpain = getSecondsUntilMidnightSpain();
      cacheControl = `public, s-maxage=${ttlSpain}, stale-while-revalidate=86400`;
      cdnCache = `max-age=${ttlSpain}`;
    } else {
      // Para CNMC: lógica original
      const ttl = getSecondsUntilMidnight();
      cacheControl = `public, s-maxage=${ttl}, stale-while-revalidate=60`;
      cdnCache = `max-age=${ttl}`;
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...corsActual(),
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'CDN-Cache-Control': cdnCache,
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
