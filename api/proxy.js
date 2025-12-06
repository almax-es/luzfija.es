export const config = { runtime: 'edge' };

// Calcular segundos hasta medianoche (ojo: en Edge puede no ser “hora España” si el PoP es otro)
function getSecondsUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const diff = tomorrow - now;
  return Math.max(60, Math.floor(diff / 1000));
}

function corsHeaders(request) {
  // Evita '*' en Allow-Headers: responde con lo que pide el navegador
  const reqHeaders = request.headers.get('access-control-request-headers') || 'Content-Type';
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': reqHeaders,
    'Vary': 'Origin',
  };
}

export default async function handler(request) {
  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
      });
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
      });
    }

    // Solo permitir CNMC + endpoint PVPC (evita SSRF y cosas raras)
    if (target.hostname !== 'comparador.cnmc.gob.es' || !target.pathname.startsWith('/api/ofertas/pvpc')) {
      return new Response(JSON.stringify({ error: 'Only CNMC PVPC is allowed' }), {
        status: 403,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
      });
    }

    // Timeout para que nunca “se quede colgado”
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        // 👇 IMPORTANTE: NO pongas User-Agent en Edge
        // 'User-Agent': '...',  <-- quítalo
      },
    }).finally(() => clearTimeout(t));

    const ttl = getSecondsUntilMidnight();
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';

    return new Response(response.body, {
      status: response.status,
      headers: {
        ...corsHeaders(request),
        'Content-Type': contentType,
        'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=60`,
        'CDN-Cache-Control': `max-age=${ttl}`,
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
    });
  }
}
