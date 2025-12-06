export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
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

    // Solo CNMC
    if (url.hostname !== 'comparador.cnmc.gob.es') {
      return new Response(JSON.stringify({ error: 'Forbidden host' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Fetch con headers que imitan un navegador real (como usa la web oficial de CNMC)
    let response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'sec-ch-ua': '"Chromium";v="143", "Not A(Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Linux"',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (fetchErr) {
      console.error('Fetch error:', fetchErr);
      return new Response(
        JSON.stringify({ 
          error: 'Request timeout or network error',
          details: fetchErr.message 
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

    // Si no es OK, devolver error detallado
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`CNMC API error ${response.status}:`, errorText);
      
      return new Response(
        JSON.stringify({ 
          error: `CNMC API returned ${response.status}`,
          details: errorText.substring(0, 500)
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
        },
      });
    }

    // Devolver JSON
    return new Response(JSON.stringify(bodyJson), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return new Response(
      JSON.stringify({
        error: 'Internal proxy error',
        details: err.message,
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
