// proxy.js — Proxy CORS para CNMC PVPC API
// Proyecto: LuzFija.es - Comparador educativo de tarifas eléctricas
// Licencia: MIT
// Contacto: hola@luzfija.es
// Repositorio: https://github.com/almax-es/luzfija.es
// 
// Propósito: Este proxy permite consultar la API pública de la CNMC
// para obtener datos del PVPC (Precio Voluntario al Pequeño Consumidor)
// desde navegadores web, solucionando las restricciones de CORS.
// 
// Uso educativo: Proyecto gratuito sin ánimo de lucro para ayudar
// a consumidores a comparar tarifas eléctricas en España.

export const config = {
  runtime: 'edge',
};

// Hosts permitidos (solo CNMC)
const ALLOWED_HOSTS = new Set(['comparador.cnmc.gob.es']);

// Paths permitidos (solo endpoint de PVPC)
const ALLOWED_PATH_PREFIXES = ['/api/ofertas/pvpc'];

export default async function handler(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Solo GET
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return new Response(
        JSON.stringify({
          error: "Missing 'url' parameter",
          usage: '?url=https://comparador.cnmc.gob.es/api/ofertas/pvpc?...',
          project: 'LuzFija.es - Educational price comparison tool',
          contact: 'hola@luzfija.es',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Validar URL
    let url;
    try {
      url = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid 'url' parameter" }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Validaciones de seguridad
    if (url.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'Only HTTPS is allowed' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Solo hosts permitidos (CNMC)
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden target host',
          allowed: Array.from(ALLOWED_HOSTS),
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Solo paths permitidos (endpoint PVPC)
    if (
      ALLOWED_PATH_PREFIXES.length &&
      !ALLOWED_PATH_PREFIXES.some((p) => url.pathname.startsWith(p))
    ) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden target path',
          allowed_prefixes: ALLOWED_PATH_PREFIXES,
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Fetch a CNMC con headers de identificación y headers de navegador
    let response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          // Headers de navegador (necesarios para que CNMC acepte la petición)
          'accept': 'application/json, text/plain, */*',
          'sec-ch-ua': '"Chromium";v="143", "Not A(Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Linux"',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          // Headers de identificación del proyecto
          'From': 'hola@luzfija.es',
          'X-Proxy-For': 'https://luzfija.es',
          'X-Project-Purpose': 'Educational non-profit energy price comparison',
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (fetchErr) {
      console.error('Fetch error:', fetchErr);
      return new Response(
        JSON.stringify({
          error: 'Request timeout or network error',
          details: fetchErr.message,
        }),
        {
          status: 504,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Si la respuesta no es OK, devolver error detallado
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`CNMC API error ${response.status}:`, errorText);

      return new Response(
        JSON.stringify({
          error: `CNMC API returned ${response.status}`,
          details: errorText.substring(0, 500),
        }),
        {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Leer respuesta
    const bodyText = await response.text();

    // Intentar parsear como JSON
    let bodyJson;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // Si no es JSON, devolver tal cual
      return new Response(bodyText, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
          'X-Proxy-By': 'LuzFija.es Educational Tool',
        },
      });
    }

    // Devolver JSON con headers CORS y de identificación
    return new Response(JSON.stringify(bodyJson), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
        'X-Proxy-By': 'LuzFija.es Educational Tool',
        'X-Project-Contact': 'hola@luzfija.es',
      },
    });
  } catch (err) {
    console.error('Proxy error:', err);
    return new Response(
      JSON.stringify({
        error: 'Internal proxy error',
        details: err.message,
        project: 'LuzFija.es',
        contact: 'hola@luzfija.es',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
