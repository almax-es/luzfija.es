export const config = { runtime: 'edge' };

// =========================================
// PVPC público (CNMC) + caché en Vercel CDN
// =========================================
//
// Objetivo:
// - Obtener los precios PVPC del día (o día siguiente) SIN token.
// - Cachear en Vercel (s-maxage) para que NO llame cada usuario.
// - NO tocar la lógica existente del proxy /api/proxy para la factura PVPC.
//
// Nota importante:
// - El JSON que has visto en /_nuxt/builds/meta/<id>.json NO contiene precios.
//   Solo da metadatos del build. Para los precios, Nuxt suele exponer payloads
//   en /_nuxt/data/<buildId>/... (esto puede cambiar si CNMC cambia su despliegue).

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
    'Vary': 'Access-Control-Request-Headers',
  };
}

function corsActual() {
  return { ...corsBase() };
}

function getTodayMadridYYYYMMDD() {
  // en-CA => YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getSecondsUntilMidnightMadrid() {
  // Edge runtime: calculamos “segundos hasta medianoche” usando hora local Madrid
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const h = get('hour');
  const m = get('minute');
  const s = get('second');

  const sinceMidnight = h * 3600 + m * 60 + s;
  const until = 86400 - sinceMidnight;
  // Expira un pelín después de medianoche (los precios cambian ~00:01)
  return Math.max(60, until + 90);
}

function pickCacheSeconds(requestedDate) {
  const today = getTodayMadridYYYYMMDD();
  if (!requestedDate) return 300;

  if (requestedDate === today) {
    return getSecondsUntilMidnightMadrid();
  }

  // Pasado: cache largo
  if (requestedDate < today) {
    return 86400 * 30;
  }

  // Futuro (normalmente “mañana”): refresco frecuente por si cambia la publicación
  return 300;
}

async function fetchText(url, { timeoutMs = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LuzFijaBot/1.0; +https://luzfija.es)',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        ...headers,
      },
    });
    return { res, text: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, { timeoutMs = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LuzFijaBot/1.0; +https://luzfija.es)',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.9',
        'Accept': 'application/json',
        ...headers,
      },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { res, json, text };
  } finally {
    clearTimeout(t);
  }
}

function extractBuildIdFromHtml(html) {
  // CNMC está usando Nuxt 3 (buildId como UUID en /_nuxt/builds/meta/<id>.json)
  const m = html.match(/\/_nuxt\/builds\/meta\/([0-9a-fA-F-]{36})\.json/);
  return m?.[1] || null;
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function normalizeToEurPerKwh(values) {
  // Heurística de unidades:
  // - Si media > 10 => probablemente €/MWh => /1000
  // - Si media > 1 y <= 10 => podría ser c€/kWh => /100
  // - Si media <= 1 => ya €/kWh
  const nums = values.filter(isFiniteNumber);
  const avg = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);

  if (avg > 10) return values.map((v) => (isFiniteNumber(v) ? v / 1000 : v));
  if (avg > 1) return values.map((v) => (isFiniteNumber(v) ? v / 100 : v));
  return values;
}

function find24PricesDeep(obj) {
  // Busca recursivamente un array de 24 precios.
  // Admite:
  // - [number, ...] (24)
  // - [{precio/value/price/valor: number, ...}, ...] (24)

  const queue = [obj];
  const seen = new Set();

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur) && cur.length === 24) {
      // Caso 1: array directo de números
      if (cur.every((v) => isFiniteNumber(v))) {
        return { prices: normalizeToEurPerKwh(cur), shape: 'array<number>' };
      }
      // Caso 2: array de objetos con campo precio
      if (cur.every((v) => v && typeof v === 'object')) {
        const keys = ['precio', 'price', 'valor', 'value', 'p'];
        for (const k of keys) {
          const vals = cur.map((it) => (it && isFiniteNumber(it[k]) ? it[k] : null));
          if (vals.every((v) => v !== null)) {
            return { prices: normalizeToEurPerKwh(vals), shape: `array<object>.${k}` };
          }
        }
      }
    }

    // Encola hijos
    if (Array.isArray(cur)) {
      for (const it of cur) queue.push(it);
    } else {
      for (const k of Object.keys(cur)) queue.push(cur[k]);
    }
  }

  return null;
}

async function getPvpcFromCnmcNuxt({ date }) {
  // 1) Descargar HTML de la página para extraer buildId
  const { res: pageRes, text: html } = await fetchText('https://comparador.cnmc.gob.es/preciosPVPC/inicio/', {
    headers: { 'Accept': 'text/html,application/xhtml+xml' },
  });

  if (!pageRes.ok || !html) {
    throw new Error(`CNMC page HTTP ${pageRes.status}`);
  }

  const buildId = extractBuildIdFromHtml(html);
  if (!buildId) {
    throw new Error('No buildId found in CNMC HTML');
  }

  // 2) (Opcional) tocar meta para “validar” el buildId (no trae precios)
  //    Si falla, seguimos igual.
  await fetchJson(`https://comparador.cnmc.gob.es/_nuxt/builds/meta/${buildId}.json`).catch(() => null);

  // 3) Intentar payloads Nuxt. Probamos varias query keys por si CNMC las cambia.
  const base = `https://comparador.cnmc.gob.es/_nuxt/data/${buildId}/preciosPVPC/inicio.json`;
  const qs = new URLSearchParams();

  const candidates = [];
  if (date) {
    // Variantes típicas
    candidates.push(`${base}?fecha=${encodeURIComponent(date)}`);
    candidates.push(`${base}?date=${encodeURIComponent(date)}`);
    candidates.push(`${base}?f=${encodeURIComponent(date)}`);
    candidates.push(`${base}?fechaPrecios=${encodeURIComponent(date)}`);
    candidates.push(`${base}?dia=${encodeURIComponent(date)}`);
  }
  // Sin query (a veces ya trae “hoy” por SSR)
  candidates.push(base);

  let lastErr = null;
  for (const url of candidates) {
    const { res, json, text } = await fetchJson(url);
    if (!res.ok || !json) {
      lastErr = new Error(`CNMC payload HTTP ${res.status} @ ${url}`);
      continue;
    }

    const found = find24PricesDeep(json);
    if (found?.prices?.length === 24) {
      return { buildId, url, foundShape: found.shape, prices: found.prices };
    }

    lastErr = new Error(`CNMC payload parsed but 24 prices not found @ ${url} (len=${text?.length || 0})`);
  }

  throw lastErr || new Error('CNMC payload not found');
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

  const url = new URL(request.url);
  const requestedDate = (url.searchParams.get('date') || '').trim();
  const date = requestedDate || getTodayMadridYYYYMMDD();

  // Validación suave
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' }), {
      status: 400,
      headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const data = await getPvpcFromCnmcNuxt({ date });

    const ttl = pickCacheSeconds(date);
    const cacheControl = `public, s-maxage=${ttl}, stale-while-revalidate=60`;

    return new Response(
      JSON.stringify({
        date,
        unit: '€/kWh',
        source: 'CNMC',
        buildId: data.buildId,
        debug: { url: data.url, foundShape: data.foundShape },
        prices: data.prices,
      }),
      {
        status: 200,
        headers: {
          ...corsActual(),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': cacheControl,
          'CDN-Cache-Control': `max-age=${ttl}`,
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'PVPC_CNMC_FAILED',
        message: String(err?.message || err),
      }),
      {
        status: 502,
        headers: { ...corsActual(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }
    );
  }
}
