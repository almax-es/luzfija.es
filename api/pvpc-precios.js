export const config = { runtime: 'edge' };

// Dominios permitidos (whitelist)
const ALLOWED_ORIGINS = [
  'https://luzfija.es',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
];

// Validar origin y devolver el permitido (o fallback a luzfija.es)
function getAllowedOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return ALLOWED_ORIGINS[0]; // Fallback a luzfija.es
}

// --- Util: offset (minutos) de una zona horaria para una fecha dada ---
function tzOffsetMinutes(timeZone, date) {
  // Intento 1: "GMT+1" / "GMT+2"
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const tzName = parts.find(p => p.type === 'timeZoneName')?.value || '';
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const hh = Number(m[2] || 0);
    const mm = Number(m[3] || 0);
    return sign * (hh * 60 + mm);
  }

  // Fallback: aproximación comparando “lo que sería” la misma fecha en esa TZ
  // (suele funcionar igual, pero dejo el intento 1 como principal)
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const p = dtf.formatToParts(date);
  const get = (t) => Number(p.find(x => x.type === t)?.value || 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Convierte YYYY-MM-DD (España) -> timestamp ms de 00:00 Europe/Madrid
function madridMidnightTs(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error('Bad date format (expected YYYY-MM-DD)');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);

  // 00:00 de ese día "en Madrid" = UTC - offsetMadrid
  const approxUTC = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  const offsetMin = tzOffsetMinutes('Europe/Madrid', approxUTC);
  return Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetMin * 60000;
}

// TTL hasta la próxima 00:01 en Madrid (para que se renueve al cambiar el día)
function secondsUntilNextMadrid0001() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t) => Number(parts.find(p => p.type === t)?.value || 0);
  const h = get('hour'), m = get('minute'), s = get('second');

  const nowSec = h * 3600 + m * 60 + s;
  const targetSec = 60; // 00:01:00
  let diff = targetSec - nowSec;
  if (diff <= 0) diff += 24 * 3600;
  return Math.max(60, diff);
}

function jsonResponse(request, obj, { status = 200, cacheControl = 'no-store' } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': cacheControl,
    },
  });
}

export default async function handler(request) {
  // Preflight OPTIONS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': getAllowedOrigin(request),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'Method not allowed' }, { status: 405, cacheControl: 'no-store' });
  }

  try {
    const url = new URL(request.url);

    const date = url.searchParams.get('date'); // YYYY-MM-DD
    const zona = url.searchParams.get('zona') || '1';      // 1 = Península/Baleares (según tu ejemplo)
    const imp  = url.searchParams.get('imp')  || '1';      // 1 = con impuestos (según tu ejemplo)
    const debug = url.searchParams.get('debug') === '1';

    if (!date) {
      return jsonResponse(request, { error: 'Missing date (YYYY-MM-DD)' }, { status: 400, cacheControl: 'no-store' });
    }

    const ts = madridMidnightTs(date);
    const cnmcUrl = `https://comparador.cnmc.gob.es/api/preciosPVPC/get/${ts}-${zona}-${imp}`;

    // Timeout para que nunca se quede colgado (mismo patrón que proxy.js)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    let res;
    try {
      res = await fetch(cnmcUrl, {
        signal: controller.signal,
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return jsonResponse(
        request,
        { error: 'CNMC_UPSTREAM_ERROR', status: res.status, body: debug ? body.slice(0, 500) : undefined, cnmcUrl: debug ? cnmcUrl : undefined },
        { status: 502, cacheControl: 'no-store' }
      );
    }

    const data = await res.json();

    const arr = data?.preciosHora;
    if (!Array.isArray(arr) || arr.length !== 24) {
      return jsonResponse(
        request,
        { error: 'CNMC_BAD_SHAPE', got: Array.isArray(arr) ? arr.length : typeof arr, cnmcUrl: debug ? cnmcUrl : undefined },
        { status: 502, cacheControl: 'no-store' }
      );
    }

    // prices[] (€/kWh) en orden 0..23
    const prices = arr.map(x => Number(x.precio));

    // Cache en Vercel hasta 00:01 Madrid (renueva con cambio de día)
    const ttl = secondsUntilNextMadrid0001();
    const cacheControl = `public, s-maxage=${ttl}, stale-while-revalidate=60`;

    return jsonResponse(
      request,
      {
        date,
        zona: Number(zona),
        imp: Number(imp),
        prices,
        stats: {
          avg: Number(data.precio_horario_medio),
          min: Number(data.precio_horario_min),
          max: Number(data.precio_horario_max),
        },
        ...(debug ? { ts, cnmcUrl, raw: data } : {}),
      },
      { status: 200, cacheControl }
    );

  } catch (e) {
    return jsonResponse(request, { error: 'PVPC_CNMC_FAILED', message: String(e?.message || e) }, { status: 502, cacheControl: 'no-store' });
  }
}
