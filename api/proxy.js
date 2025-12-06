export const config = {
  runtime: 'edge',
};

// Calcular segundos hasta medianoche en España
function getSecondsUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const diff = tomorrow - now;
  return Math.max(60, Math.floor(diff / 1000));
}

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
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // Validar que existe el parámetro url
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Validar que es una URL válida
    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Solo permitir CNMC
    if (target.hostname !== 'comparador.cnmc.gob.es') {
      return new Response(JSON.stringify({ error: 'Only CNMC is allowed' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Fetch a CNMC
    const response = await fetch(target.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; LuzFija/1.0)',
      },
    });

    const data = await response.text();

    // Calcular TTL hasta medianoche
    const ttl = getSecondsUntilMidnight();

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Caché en Vercel CDN hasta medianoche
        'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=60`,
        'CDN-Cache-Control': `max-age=${ttl}`,
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
```

---

## 🔧 Cambios realizados:

1. ✅ **Función `getSecondsUntilMidnight()`** (líneas 4-12)
   - Calcula segundos hasta las 00:00 del día siguiente
   - Mínimo 60 segundos para evitar problemas

2. ✅ **Headers de caché actualizados** (líneas 89-91)
   - `Cache-Control: public, s-maxage=${ttl}` → Caché en CDN
   - `CDN-Cache-Control: max-age=${ttl}` → Refuerzo para CDN
   - TTL dinámico hasta medianoche

---

## 📋 Aplica el cambio:

1. **GitHub** → `api/proxy.js`
2. **Reemplaza** todo el contenido por el código de arriba
3. **Commit**: `"Añadir caché CDN hasta medianoche"`
4. **Espera 30-60 segundos**

---

## 🧪 Prueba que funciona:

### Test 1: Verificar que no se rompió
```
https://luzfija-es.vercel.app/api/proxy?url=test
