import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

function addCalendarDay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function localMidnightEpoch(dateStr, timeZone) {
  const utcGuess = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  });

  for (let shiftHours = -14; shiftHours <= 14; shiftHours += 1) {
    const candidate = utcGuess + (shiftHours * 3600);
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate * 1000))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    if (`${parts.year}-${parts.month}-${parts.day}` === dateStr && parts.hour === '00') {
      return candidate;
    }
  }
  throw new Error(`No se pudo resolver medianoche local para ${dateStr} en ${timeZone}`);
}

function buildDayPairs(dateStr, flatPrice = null, timeZone = 'Europe/Madrid') {
  const baseTs = localMidnightEpoch(dateStr, timeZone);
  const nextTs = localMidnightEpoch(addCalendarDay(dateStr), timeZone);
  const hours = (nextTs - baseTs) / 3600;
  return Array.from({ length: hours }, (_, i) => [baseTs + (i * 3600), flatPrice != null ? flatPrice : 0.1 + (i / 1000)]);
}

function okJson(data, { geoId = 8741, timezone = 'Europe/Madrid', indicator = 1001 } = {}) {
  const payload = data && data.days ? {
    schema_version: 2,
    geo_id: geoId,
    timezone,
    indicator,
    unit: 'EUR/kWh',
    epoch_unit: 's',
    ...data
  } : data;
  return {
    ok: true,
    json: async () => payload
  };
}

describe('index-extra PVPC month cache', () => {
  beforeEach(() => {
    vi.resetModules();

    document.body.innerHTML = `
      <select id="zonaFiscal">
        <option value="Península">Península</option>
        <option value="Canarias">Canarias</option>
        <option value="CeutaMelilla">Ceuta y Melilla</option>
      </select>
    `;

    localStorage.clear();
    delete window.LF;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.LF;
  });

  it('purga una promesa rechazada para permitir reintentos del modal', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return okJson({ days: { '2026-04-22': buildDayPairs('2026-04-22') } });
    });

    await import('../js/lf-csv-utils.js');
    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };
    await expect(helpers.fetchDay('2026-04-22', ctx)).rejects.toThrow('network down');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const day = await helpers.fetchDay('2026-04-22', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(day.entries).toHaveLength(24);
  });

  it('refetchea el mes cacheado cuando el día pedido aún no existía', async () => {
    const monthDay22 = { days: { '2026-04-22': buildDayPairs('2026-04-22') } };
    const monthBothDays = {
      days: {
        '2026-04-22': buildDayPairs('2026-04-22'),
        '2026-04-23': buildDayPairs('2026-04-23', 0.5)
      }
    };

    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return okJson(calls === 1 ? monthDay22 : monthBothDays);
    });

    await import('../js/lf-csv-utils.js');
    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };
    await helpers.fetchDay('2026-04-22', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const day23 = await helpers.fetchDay('2026-04-23', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(day23.entries.every((entry) => entry.price === 0.5)).toBe(true);
  });

  it('precios de mañana: un solo refetch si aún no están publicados, y aparecen cuando el dataset se actualiza', async () => {
    document.getElementById('zonaFiscal').value = 'Península';

    const monthDay22 = { days: { '2026-04-22': buildDayPairs('2026-04-22') } };
    const monthBothDays = {
      days: {
        '2026-04-22': buildDayPairs('2026-04-22'),
        '2026-04-23': buildDayPairs('2026-04-23')
      }
    };

    let publicado = false;
    global.fetch = vi.fn(async () => okJson(publicado ? monthBothDays : monthDay22));

    await import('../js/lf-csv-utils.js');
    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };
    await helpers.fetchDay('2026-04-22', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Mañana aún no publicado: exactamente un refetch y error controlado, sin bucle
    await expect(helpers.fetchDay('2026-04-23', ctx)).rejects.toThrow('Sin datos');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Dataset actualizado (publicación vespertina): la siguiente petición lo recoge
    publicado = true;
    const day = await helpers.fetchDay('2026-04-23', ctx);
    expect(day.entries).toHaveLength(24);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    // Y queda cacheado: repetir la petición no vuelve a pedir el fichero
    await helpers.fetchDay('2026-04-23', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
  it('refetchea un día HTTP 200 malformado antes de mostrar la vista rápida', async () => {
    // Payload numéricamente correcto pero asociado al día civil equivocado: no basta
    // con tener 24 puntos contiguos; sus timestamps deben pertenecer al día pedido.
    const malformed = buildDayPairs('2026-04-21');
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return okJson({
        days: {
          '2026-04-22': calls === 1 ? malformed : buildDayPairs('2026-04-22', 0.2)
        }
      });
    });

    await import('../js/lf-csv-utils.js');
    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const day = await helpers.fetchDay('2026-04-22', { geo: 8741, tz: 'Europe/Madrid' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(day.entries).toHaveLength(24);
    expect(day.entries.every((entry) => entry.price === 0.2)).toBe(true);
  });

  it('refetchea un mes completo de otro indicador antes de publicar una cifra en la vista rápida', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return okJson({
          indicator: 1739,
          days: { '2026-04-22': buildDayPairs('2026-04-22', 9.99) }
        });
      }
      return okJson({ days: { '2026-04-22': buildDayPairs('2026-04-22', 0.2) } });
    });

    await import('../js/lf-csv-utils.js');
    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const day = await helpers.fetchDay('2026-04-22', { geo: 8741, tz: 'Europe/Madrid' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(day.entries.every((entry) => entry.price === 0.2)).toBe(true);
  });

});
