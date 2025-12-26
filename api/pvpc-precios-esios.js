export const config = { runtime: 'edge' };

// Tu token de ESIOS
const ESIOS_TOKEN = process.env.ESIOS_API_KEY;

// Indicadores de ESIOS para PVPC 2.0TD
const INDICADORES = {
  peninsula: 1001,  // PVPC 2.0TD Península
  ceuta_melilla: 1002, // PVPC 2.0TD Ceuta y Melilla
  canarias: 1003,  // PVPC 2.0TD Canarias
  baleares: 1001,  // Mismo que península (geo_id diferente)
};

// Mapeo zona → geo_id
const GEO_IDS = {
  '1': 8741, // Península
  '2': 8742, // Canarias
  '3': 8743, // Baleares
  '4': 8744, // Ceuta
  '5': 8745, // Melilla
};

// Mapeo zona → indicador
function getIndicadorByZona(zona) {
  if (zona === '2') return INDICADORES.canarias;
  if (zona === '4' || zona === '5') return INDICADORES.ceuta_melilla;
  return INDICADORES.peninsula; // Por defecto península (incluye Baleares)
}

// TTL hasta la próxima 00:01 en Madrid
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

function jsonResponse(obj, { status = 200, cacheControl = 'no-store' } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheControl,
    },
  });
}

// Parsear fecha YYYY-MM-DD a rango ISO para ESIOS
function getDateRange(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error('Bad date format (expected YYYY-MM-DD)');
  
  // Start: YYYY-MM-DDT00:00:00+01:00 (horario de invierno) o +02:00 (verano)
  // End: YYYY-MM-DDT23:59:59+01:00 o +02:00
  // ESIOS acepta fechas en hora local de Madrid
  
  // Para simplificar, usamos +01:00 (CET) como base
  // ESIOS interpreta correctamente las fechas locales
  const start = `${dateStr}T00:00:00+01:00`;
  const end = `${dateStr}T23:59:59+01:00`;
  
  return { start, end };
}

export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date'); // YYYY-MM-DD
    const zona = url.searchParams.get('zona') || '1'; // 1=Península, 2=Canarias, etc.
    const imp = url.searchParams.get('imp') || '1'; // Para compatibilidad (no usado en ESIOS)
    const debug = url.searchParams.get('debug') === '1';

    if (!date) {
      return jsonResponse({ error: 'Missing date (YYYY-MM-DD)' }, { status: 400 });
    }

    // Validar zona
    if (!GEO_IDS[zona]) {
      return jsonResponse({ error: 'Invalid zona' }, { status: 400 });
    }

    const indicador = getIndicadorByZona(zona);
    const geoId = GEO_IDS[zona];
    const { start, end } = getDateRange(date);

    // Construir URL de ESIOS
    // https://api.esios.ree.es/indicators/{id}?start_date={start}&end_date={end}&geo_ids[]={geo_id}
    const esiosUrl = `https://api.esios.ree.es/indicators/${indicador}?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&geo_ids[]=${geoId}&time_trunc=hour`;

    const res = await fetch(esiosUrl, {
      headers: {
        'Accept': 'application/json; application/vnd.esios-api-v2+json',
        'Content-Type': 'application/json',
        'x-api-key': ESIOS_TOKEN,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return jsonResponse(
        { 
          error: 'ESIOS_UPSTREAM_ERROR', 
          status: res.status, 
          body: debug ? body.slice(0, 500) : undefined,
          esiosUrl: debug ? esiosUrl : undefined,
        },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Procesar respuesta de ESIOS
    const values = data?.indicator?.values;
    if (!Array.isArray(values)) {
      return jsonResponse(
        { 
          error: 'ESIOS_BAD_SHAPE', 
          got: typeof values,
          esiosUrl: debug ? esiosUrl : undefined,
        },
        { status: 502 }
      );
    }

    // Filtrar y ordenar por hora (ESIOS devuelve datos en UTC)
    // Necesitamos convertir a hora local de Madrid y extraer 24 valores (00:00-23:00)
    const hourlyData = new Map();
    
    for (const item of values) {
      // datetime viene en UTC, tz_time viene en hora local (Madrid)
      const datetime = new Date(item.datetime_utc || item.datetime);
      const madridDate = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(datetime);
      
      const [datePart, timePart] = madridDate.split(' ');
      const hour = parseInt(timePart.split(':')[0], 10);
      
      // Solo guardamos si es del día solicitado
      if (datePart === date && hour >= 0 && hour <= 23) {
        // Los valores vienen en €/MWh, convertir a €/kWh
        const priceKwh = (item.value || 0) / 1000;
        hourlyData.set(hour, priceKwh);
      }
    }

    // Asegurar que tenemos 24 horas (0-23)
    if (hourlyData.size !== 24) {
      // Si es un día futuro y aún no hay datos, devolver error específico
      const requestDate = new Date(date);
      const now = new Date();
      if (requestDate > now) {
        return jsonResponse(
          { 
            error: 'NO_DATA_YET', 
            message: 'Los precios para este día aún no están disponibles',
            available_hours: hourlyData.size,
          },
          { status: 404 }
        );
      }
      
      // Si faltan datos de un día pasado, es un error
      if (debug) {
        return jsonResponse(
          { 
            error: 'INCOMPLETE_DATA', 
            got: hourlyData.size,
            expected: 24,
            esiosUrl,
            raw: data,
          },
          { status: 502 }
        );
      }
    }

    // Construir array de precios ordenado [0..23]
    const prices = [];
    for (let h = 0; h < 24; h++) {
      prices.push(hourlyData.get(h) || 0);
    }

    // Calcular estadísticas
    const validPrices = prices.filter(p => p > 0);
    const avg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
    const min = Math.min(...validPrices);
    const max = Math.max(...validPrices);

    // Cache hasta 00:01 Madrid (renueva con cambio de día)
    const ttl = secondsUntilNextMadrid0001();
    const cacheControl = `public, s-maxage=${ttl}, stale-while-revalidate=60`;

    return jsonResponse(
      {
        date,
        zona: Number(zona),
        imp: Number(imp), // Por compatibilidad
        prices,
        stats: {
          avg: Number(avg.toFixed(6)),
          min: Number(min.toFixed(6)),
          max: Number(max.toFixed(6)),
        },
        source: 'esios',
        ...(debug ? { esiosUrl, rawValues: values.length, hourlyDataSize: hourlyData.size } : {}),
      },
      { status: 200, cacheControl }
    );

  } catch (e) {
    return jsonResponse(
      { error: 'PVPC_ESIOS_FAILED', message: String(e?.message || e) }, 
      { status: 502 }
    );
  }
}
