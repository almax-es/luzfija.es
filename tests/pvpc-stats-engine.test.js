import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.TZ = 'America/Los_Angeles';

beforeAll(async () => {
  // hasUsableMonthPayload delega en window.LF.csvUtils.validatePvpcDayCoverage (bloqueante 2,
  // 12/08/2026): sin csvUtils cargado, falla cerrado y ningun mes se aceptaria.
  await import('../js/lf-csv-utils.js');
  await import('../js/pvpc-stats-engine.js');
});

// Genera un dia civil COMPLETO (23/24/25 puntos segun DST) para una zona horaria dada,
// usando exactamente el mismo criterio que produce el validador real: medianoche a
// medianoche en esa zona. Evita fixtures "casi validos" que el validador estricto
// rechazaria por motivos ajenos a lo que el test quiere comprobar.
function buildFullCivilDay(ymd, timeZone = 'Europe/Madrid', priceForHour = () => 0.1) {
  const [y, m, d] = ymd.split('-').map(Number);
  const startGuessUtc = Date.UTC(y, m - 1, d) / 1000;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  });
  const ymdOf = (ts) => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  let start = null;
  for (let shift = -14 * 3600; shift <= 14 * 3600; shift += 3600) {
    const candidate = startGuessUtc + shift;
    if (ymdOf(candidate) === ymd && ymdOf(candidate - 3600) !== ymd) { start = candidate; break; }
  }
  if (start === null) throw new Error(`No se pudo anclar medianoche local para ${ymd} en ${timeZone}`);
  const points = [];
  for (let ts = start, hour = 0; ymdOf(ts) === ymd; ts += 3600, hour += 1) {
    points.push([ts, priceForHour(hour)]);
  }
  return points;
}

function buildV2Month(ym, timeZone = 'Europe/Madrid', overrides = {}, identity = {}) {
  const [year, month] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = {};
  for (let day = 1; day <= last; day += 1) {
    const ymd = `${ym}-${String(day).padStart(2, '0')}`;
    days[ymd] = buildFullCivilDay(ymd, timeZone);
  }
  Object.assign(days, overrides);
  const geoId = identity.geoId ?? (timeZone === 'Atlantic/Canary' ? 8742 : 8741);
  const indicator = identity.indicator ?? 1001;
  return {
    schema_version: 2, geo_id: geoId, timezone: timeZone, indicator,
    unit: 'EUR/kWh', epoch_unit: 's',
    from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days
  };
}

function buildV2PublishedMonth(ym, lastPublishedDay, timeZone = 'Europe/Madrid', overrides = {}) {
  const month = buildV2Month(ym, timeZone, overrides);
  for (const date of Object.keys(month.days)) {
    if (Number(date.slice(-2)) > lastPublishedDay) delete month.days[date];
  }
  month.to = `${ym}-${String(lastPublishedDay).padStart(2, '0')}`;
  return month;
}

describe('PVPC_STATS date handling', () => {
  it('bins Canary hourly data using the dataset timezone instead of the runtime timezone', () => {
    // 2026-04-01 00:00/01:00/02:00 in Atlantic/Canary.
    const hours = [
      [1774998000, 1],
      [1775001600, 2],
      [1775005200, 3]
    ];

    const yearData = {
      days: {
        '2026-04-01': hours
      },
      meta: { year: 2026, geoId: 8742 }
    };

    const profile = window.PVPC_STATS.getHourlyProfile(yearData);
    expect(profile.data[0]).toBe(1);
    expect(profile.data[1]).toBe(2);
    expect(profile.data[2]).toBe(3);
  });

  it('no fabrica KPIs de 0 €/kWh cuando el año no tiene ninguna observación', () => {
    const kpis = window.PVPC_STATS.getKPIs({
      days: {},
      meta: { year: 2026, geoId: 8741, type: 'pvpc', timezone: 'Europe/Madrid' }
    });

    expect(kpis).toMatchObject({ avgPrice: null, minPrice: null, maxPrice: null, minHour: null, maxHour: null });
  });

  it('representa como null las horas todavía no publicadas de un perfil provisional', () => {
    const hours = [
      [Date.parse('2026-08-31T22:00:00Z') / 1000, 0.10], // 00:00 Madrid
      [Date.parse('2026-08-31T23:00:00Z') / 1000, 0.20], // 01:00
      [Date.parse('2026-09-01T00:00:00Z') / 1000, 0.30]  // 02:00
    ];
    const yearData = {
      days: { '2026-09-01': hours },
      meta: { year: 2026, geoId: 8741, type: 'pvpc', timezone: 'Europe/Madrid' }
    };

    const profile = window.PVPC_STATS.getHourlyProfile(yearData);

    expect(profile.data.slice(0, 3)).toEqual([0.10, 0.20, 0.30]);
    expect(profile.data[3]).toBeNull();
    expect(profile.data[23]).toBeNull();
  });

  it('formats rolling windows using the dataset timezone for Canary', () => {
    const yearData = {
      days: {
        '2026-04-01': [
          [1774998000, 0.1],
          [1775001600, 0.2],
          [1775005200, 0.3]
        ]
      },
      meta: { year: 2026, geoId: 8742 }
    };

    const stats = window.PVPC_STATS.getWindowStats(yearData, { duration: 2 });
    const midnightWindow = stats.windows.find((entry) => entry.label === '00:00–02:00');

    expect(midnightWindow).toBeTruthy();
    expect(midnightWindow.avg).toBeCloseTo(0.15, 5);
  });

  it('uses Madrid timezone for Canary surplus hourly analysis', () => {
    // 2026-04-01 00:00/01:00/02:00 in Europe/Madrid.
    const hours = [
      [1774994400, 1],
      [1774998000, 2],
      [1775001600, 3]
    ];

    const yearData = {
      days: {
        '2026-04-01': hours
      },
      meta: { year: 2026, geoId: 8742, type: 'surplus', timezone: 'Europe/Madrid' }
    };

    const profile = window.PVPC_STATS.getHourlyProfile(yearData);
    expect(profile.data[0]).toBe(1);
    expect(profile.data[1]).toBe(2);
    expect(profile.data[2]).toBe(3);

    const stats = window.PVPC_STATS.getWindowStats(yearData, { duration: 2 });
    const midnightWindow = stats.windows.find((entry) => entry.label === '00:00–02:00');

    expect(midnightWindow).toBeTruthy();
    expect(midnightWindow.avg).toBeCloseTo(1.5, 5);
  });

  it('parses weekday using a stable local date', () => {
    const ts = Math.floor(new Date(2024, 2, 10, 12, 0, 0).getTime() / 1000);
    const yearData = {
      days: {
        '2024-03-10': [[ts, 1]]
      },
      meta: { year: 2024 }
    };

    const profile = window.PVPC_STATS.getWeekdayProfile(yearData);
    expect(profile.data[6]).toBeCloseTo(1);
    expect(profile.data[5]).toBeCloseTo(0);
  });

  it('tracks completeness within a partial coverage range', () => {
    const days = {};
    const start = new Date(2021, 5, 1, 12, 0, 0);
    for (let i = 0; i < 30; i++) {
      const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().slice(0, 10);
      const ts = Math.floor(date.getTime() / 1000);
      days[dateStr] = [[ts, 0.2]];
    }

    const yearData = {
      days,
      meta: { year: 2021 }
    };

    const status = window.PVPC_STATS.getYearStatus(yearData);
    expect(status.coverageFrom).toBe('2021-06-01');
    expect(status.coverageTo).toBe('2021-06-30');
    expect(status.coverageCompleteness).toBeCloseTo(1, 5);
    expect(status.yearCompleteness).toBeLessThan(0.1);
  });
});

describe('PVPC_STATS manifest-aware loading', () => {
  it('deduplicates concurrent year loads for the same dataset', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    const ok = (data) => ({ ok: true, json: async () => data });

    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);

      if (u.endsWith('/data/pvpc/8741/index.json')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ok({
          files: [
            { file: '2024-01.json' }
          ]
        });
      }
      if (u.endsWith('/data/pvpc/8741/2024-01.json')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ok(buildV2Month('2024-01', 'Europe/Madrid'));
      }

      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();

      const [first, second] = await Promise.all([
        window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc'),
        window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc')
      ]);

      expect(first).toBe(second);
      expect(Object.keys(first.days)).toHaveLength(31);
      expect(first.days['2024-01-01']).toBeDefined();
      expect(calls.filter((u) => u.endsWith('/data/pvpc/8741/index.json'))).toHaveLength(1);
      expect(calls.filter((u) => u.endsWith('/data/pvpc/8741/2024-01.json'))).toHaveLength(1);
      expect(window.PVPC_STATS.inFlightYearData.size).toBe(0);
      expect(window.PVPC_STATS.inFlightGeoIndexes.size).toBe(0);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
    }
  });

  it('deduplicates concurrent manifest loads', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    const ok = (data) => ({ ok: true, json: async () => data });

    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);

      if (u.endsWith('/data/pvpc/8741/index.json')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ok({
          timezone: 'Europe/Madrid',
          files: [
            { file: '2024-01.json' }
          ]
        });
      }

      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();

      const [first, second] = await Promise.all([
        window.PVPC_STATS.loadGeoIndex('pvpc', 8741),
        window.PVPC_STATS.loadGeoIndex('pvpc', 8741)
      ]);

      expect(first).toBe(second);
      expect(first.monthsByYear.get(2024).has('01')).toBe(true);
      expect(calls).toEqual(['/data/pvpc/8741/index.json']);
      expect(window.PVPC_STATS.inFlightGeoIndexes.size).toBe(0);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
    }
  });

  it('un manifest degradado no puede ocultar meses de un año histórico ni volverlo completo', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    const ok = (data) => ({ ok: true, json: async () => data });

    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);

      if (u.endsWith('/data/pvpc/8742/index.json')) {
        // Febrero falta del manifest aunque pertenece a un año histórico cerrado.
        return ok({ files: [{ file: '2024-01.json' }, { file: '2024-03.json' }] });
      }
      if (u.endsWith('/data/pvpc/8742/2024-01.json')) return ok(buildV2Month('2024-01', 'Atlantic/Canary'));
      if (u.endsWith('/data/pvpc/8742/2024-03.json')) return ok(buildV2Month('2024-03', 'Atlantic/Canary'));
      if (/\/data\/pvpc\/8742\/2024-\d{2}\.json$/.test(u)) return { ok: false, status: 404 };
      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8742, 2024, 'pvpc');
      expect(yearData.meta.monthsExpected).toEqual(['01','02','03','04','05','06','07','08','09','10','11','12']);
      expect(yearData.meta.monthsLoaded).toEqual(['01', '03']);
      expect(yearData.meta.failedMonths).toContain('02');
      expect(yearData.meta.partial).toBe(true);
      expect(calls.some((u) => u.endsWith('/data/pvpc/8742/2024-02.json'))).toBe(true);
      expect(window.PVPC_STATS.cache.has('pvpc-8742-2024')).toBe(false);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
    }
  });



  it('marca un año parcial, no lo cachea y reintenta el mes fallido', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    let febFails = true;
    const ok = (data) => ({ ok: true, json: async () => data });

    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/data/pvpc/8741/index.json')) {
        return ok({
          timezone: 'Europe/Madrid',
          files: [{ file: '2024-01.json' }, { file: '2024-02.json' }]
        });
      }
      if (u.endsWith('/data/pvpc/8741/2024-01.json')) {
        return ok(buildV2Month('2024-01', 'Europe/Madrid'));
      }
      if (u.endsWith('/data/pvpc/8741/2024-02.json')) {
        if (febFails) return { ok: false, status: 503 };
        return ok(buildV2Month('2024-02', 'Europe/Madrid'));
      }
      const monthMatch = u.match(/\/data\/pvpc\/8741\/(2024-\d{2})\.json$/);
      if (monthMatch) return ok(buildV2Month(monthMatch[1], 'Europe/Madrid'));
      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();

      const partial = await window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc');
      expect(partial.meta).toMatchObject({
        monthsExpected: ['01','02','03','04','05','06','07','08','09','10','11','12'],
        monthsLoaded: ['01','03','04','05','06','07','08','09','10','11','12'],
        failedMonths: ['02'],
        partial: true
      });
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2024')).toBe(false);

      febFails = false;
      const complete = await window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc');
      expect(complete.meta.partial).toBe(false);
      expect(complete.meta.failedMonths).toEqual([]);
      expect(complete.meta.monthsLoaded).toEqual(['01','02','03','04','05','06','07','08','09','10','11','12']);
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2024')).toBe(true);
      expect(calls.filter((u) => u.endsWith('/data/pvpc/8741/2024-02.json'))).toHaveLength(2);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
    }
  });

  it('no hace negative-cache de un manifest que falla temporalmente', async () => {
    const originalFetch = global.fetch;
    let attempts = 0;
    global.fetch = async (url) => {
      const u = String(url);
      if (!u.endsWith('/data/pvpc/8741/index.json')) throw new Error(`Unexpected fetch: ${u}`);
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({ timezone: 'Europe/Madrid', files: [{ file: '2024-01.json' }] })
      };
    };

    try {
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
      const first = await window.PVPC_STATS.loadGeoIndex('pvpc', 8741);
      expect(first).toBeNull();
      expect(window.PVPC_STATS.manifestCache.has('pvpc-8741')).toBe(false);

      const second = await window.PVPC_STATS.loadGeoIndex('pvpc', 8741);
      expect(second.monthsByYear.get(2024).has('01')).toBe(true);
      expect(attempts).toBe(2);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
    }
  });

  it('reintenta un manifest HTTP 200 malformado sin hacer negative-cache', async () => {
    const originalFetch = global.fetch;
    let attempts = 0;
    global.fetch = async (url) => {
      const u = String(url);
      if (!u.endsWith('/data/pvpc/8741/index.json')) throw new Error(`Unexpected fetch: ${u}`);
      attempts += 1;
      if (attempts === 1) return { ok: true, json: async () => ({ files: [] }) };
      return {
        ok: true,
        json: async () => ({ timezone: 'Europe/Madrid', files: [{ file: '2024-01.json' }] })
      };
    };

    try {
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
      expect(await window.PVPC_STATS.loadGeoIndex('pvpc', 8741)).toBeNull();
      expect(window.PVPC_STATS.manifestCache.has('pvpc-8741')).toBe(false);

      const recovered = await window.PVPC_STATS.loadGeoIndex('pvpc', 8741);
      expect(recovered.monthsByYear.get(2024).has('01')).toBe(true);
      expect(attempts).toBe(2);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
    }
  });

  it('marca parcial un mes horario completo si la identidad no corresponde al dataset pedido', async () => {
    const originalFetch = global.fetch;
    const ok = (data) => ({ ok: true, json: async () => data });
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/data/pvpc/8741/index.json')) return ok({ files: [{ file: '2024-01.json' }] });
      const monthMatch = u.match(/\/data\/pvpc\/8741\/(2024-\d{2})\.json$/);
      if (monthMatch) {
        const month = buildV2Month(monthMatch[1], 'Europe/Madrid');
        if (monthMatch[1] === '2024-01') month.indicator = 1739;
        return ok(month);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc');
      expect(yearData.meta.failedMonths).toEqual(['01']);
      expect(yearData.meta.partial).toBe(true);
      expect(yearData.days['2024-01-01']).toBeUndefined();
      expect(yearData.days['2024-02-01']).toBeDefined();
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2024')).toBe(false);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
    }
  });

  it('trata un mes HTTP 200 malformado como parcial y lo reintenta en la misma sesión', async () => {
    const originalFetch = global.fetch;
    let monthAttempts = 0;
    const ok = (data) => ({ ok: true, json: async () => data });
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/data/pvpc/8741/index.json')) {
        return ok({ timezone: 'Europe/Madrid', files: [{ file: '2024-01.json' }] });
      }
      if (u.endsWith('/data/pvpc/8741/2024-01.json')) {
        monthAttempts += 1;
        // Malformado: la fecha declarada pertenece a otro mes. Este dia se rechaza por el
        // filtro de mes esperado, no por su cardinalidad, asi que un dia completo tambien
        // debe fallar aqui — es justo lo que este intento comprueba.
        if (monthAttempts === 1) return ok({ days: { '2024-02-01': buildFullCivilDay('2024-02-01', 'Europe/Madrid') } });
        return ok(buildV2Month('2024-01', 'Europe/Madrid'));
      }
      const monthMatch = u.match(/\/data\/pvpc\/8741\/(2024-\d{2})\.json$/);
      if (monthMatch) return ok(buildV2Month(monthMatch[1], 'Europe/Madrid'));
      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();

      const partial = await window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc');
      expect(partial.meta.failedMonths).toEqual(['01']);
      expect(partial.meta.partial).toBe(true);
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2024')).toBe(false);

      const recovered = await window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc');
      expect(recovered.meta.failedMonths).toEqual([]);
      expect(recovered.meta.partial).toBe(false);
      expect(monthAttempts).toBe(2);
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2024')).toBe(true);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
      window.PVPC_STATS.inFlightGeoIndexes.clear();
    }
  });

  it('preserves manifest timezone when loading Canary surplus data', async () => {
    const originalFetch = global.fetch;
    const ok = (data) => ({ ok: true, json: async () => data });

    global.fetch = async (url) => {
      const u = String(url);

      if (u.endsWith('/data/surplus/8742/index.json')) {
        return ok({
          timezone: 'Europe/Madrid',
          files: [
            { file: '2024-04.json' }
          ]
        });
      }
      if (u.endsWith('/data/surplus/8742/2024-04.json')) {
        const month = buildV2Month('2024-04', 'Europe/Madrid', {}, { geoId: 8742, indicator: 1739 });
        Object.keys(month.days).forEach((date) => {
          month.days[date] = buildFullCivilDay(date, 'Europe/Madrid', (h) => (h === 0 ? 1 : h === 1 ? 2 : 0));
        });
        return ok(month);
      }

      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8742, 2024, 'surplus');
      expect(yearData.meta.type).toBe('surplus');
      expect(yearData.meta.timezone).toBe('Europe/Madrid');

      const profile = window.PVPC_STATS.getHourlyProfile(yearData);
      expect(profile.data[0]).toBe(1);
      expect(profile.data[1]).toBe(2);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
    }
  });

  // Reproduccion exacta del hallazgo de Codex (bloqueante 2, 12/08/2026): un mes HTTP 200
  // con un dia HISTORICO (no "hoy") muy incompleto no puede aceptarse como sano ni
  // cachearse como completo, aunque el resto del payload tenga forma correcta.
  it('rechaza el mes entero si un día histórico (no hoy) llega con muchas horas ausentes', async () => {
    const originalFetch = global.fetch;
    const ok = (data) => ({ ok: true, json: async () => data });
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/data/pvpc/8741/index.json')) {
        return ok({ timezone: 'Europe/Madrid', files: [{ file: '2024-01.json' }] });
      }
      if (u.endsWith('/data/pvpc/8741/2024-01.json')) {
        // Dia historico con solo 10 de 24 horas: el bug real que reprodujo Codex.
        return ok(buildV2Month('2024-01', 'Europe/Madrid', {
          '2024-01-15': buildFullCivilDay('2024-01-15', 'Europe/Madrid').slice(0, 10)
        }));
      }
      const monthMatch = u.match(/\/data\/pvpc\/8741\/(2024-\d{2})\.json$/);
      if (monthMatch) return ok(buildV2Month(monthMatch[1], 'Europe/Madrid'));
      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8741, 2024, 'pvpc');
      expect(yearData.meta.partial).toBe(true);
      expect(yearData.meta.failedMonths).toEqual(['01']);
      expect(yearData.days['2024-02-01']).toBeDefined();
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2024')).toBe(false);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
    }
  });

  it('acepta un mes con un día DST corto (23h) y otro largo (25h), ambos completos', async () => {
    const originalFetch = global.fetch;
    const ok = (data) => ({ ok: true, json: async () => data });
    // Mismos anclajes verificados en tests/pvpc.test.js y tests/pvpc-day-coverage.test.js.
    const dstSpringForward = Array.from({ length: 23 }, (_, i) => [Date.parse('2026-03-28T23:00:00Z') / 1000 + i * 3600, 0.1]);
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/data/pvpc/8741/index.json')) {
        return ok({ timezone: 'Europe/Madrid', files: [{ file: '2026-03.json' }] });
      }
      if (u.endsWith('/data/pvpc/8741/2026-03.json')) {
        return ok(buildV2Month('2026-03', 'Europe/Madrid', { '2026-03-29': dstSpringForward }));
      }
      const monthMatch = u.match(/\/data\/pvpc\/8741\/(2026-\d{2})\.json$/);
      if (monthMatch) return ok(buildV2Month(monthMatch[1], 'Europe/Madrid'));
      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8741, 2026, 'pvpc');
      expect(yearData.meta.partial).toBe(false);
      expect(yearData.days['2026-03-29']).toHaveLength(23);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
    }
  });

  // Reproduccion exacta del bug real encontrado en produccion (bloqueante 2, 12/08/2026):
  // REE publica el dia siguiente sobre las 20:15, asi que un fichero mensual "de este mes"
  // puede traer ya una entrada de MANANA con menos de 24 puntos, sin que eso sea un dia
  // historico incompleto. Restringir allowPartial a `date === todayLocal` rechazaba el
  // mes entero en cuanto llegaba esa entrada (hallado verificando el validador contra los
  // ~19.000 dias reales de data/pvpc y data/surplus: 8742/2026-08-13 fallaba con
  // "missing-last-hour" siendo las 22:50 del 12/08/2026 en Canarias).
  it('acepta un mes cuyo dia de "manana" ya publicado llega incompleto (REE publica ~20:15)', async () => {
    const originalFetch = global.fetch;
    const ok = (data) => ({ ok: true, json: async () => data });
    const today = buildFullCivilDay('2026-08-12', 'Europe/Madrid');
    const tomorrowPartial = buildFullCivilDay('2026-08-13', 'Europe/Madrid').slice(0, 23);
    let monthAttempts = 0;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/data/pvpc/8741/index.json')) {
        return ok({ timezone: 'Europe/Madrid', files: [{ file: '2026-08.json' }] });
      }
      if (u.endsWith('/data/pvpc/8741/2026-08.json')) {
        monthAttempts += 1;
        return ok(buildV2PublishedMonth('2026-08', 13, 'Europe/Madrid', {
          '2026-08-12': today,
          '2026-08-13': tomorrowPartial
        }));
      }
      const monthMatch = u.match(/\/data\/pvpc\/8741\/(2026-\d{2})\.json$/);
      if (monthMatch) return ok(buildV2Month(monthMatch[1], 'Europe/Madrid'));
      throw new Error(`Unexpected fetch: ${u}`);
    };

    // 22:50 en Madrid (CEST, UTC+2) es 20:50Z, no 22:50Z: usar la hora local real
    // evita que "hoy" se desplace por error a 2026-08-13 y enmascare el bug.
    vi.setSystemTime(new Date('2026-08-12T20:50:00Z'));
    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8741, 2026, 'pvpc');
      expect(yearData.meta.partial).toBe(false);
      expect(yearData.meta.provisionalDays).toEqual(['2026-08-13']);
      expect(window.PVPC_STATS.getYearStatus(yearData).provisional).toBe(true);
      expect(window.PVPC_STATS.cache.has('pvpc-8741-2026')).toBe(false);
      expect(yearData.days['2026-08-12']).toHaveLength(24);
      expect(yearData.days['2026-08-13']).toHaveLength(23);
      await window.PVPC_STATS.loadYearData(8741, 2026, 'pvpc');
      expect(monthAttempts).toBe(2);
    } finally {
      vi.useRealTimers();
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
      window.PVPC_STATS.inFlightYearData.clear();
    }
  });
});

describe('PVPC_STATS alineacion multianual (29-feb reservado)', () => {
  // El eje de comparacion multianual tiene 366 posiciones y sus etiquetas se
  // generan sobre un anyo bisiesto. Si el indice se calculase sobre el anyo
  // real, los anyos no bisiestos desplazarian un dia todo el tramo marzo-
  // diciembre (1-mar caia bajo la etiqueta "29 feb").
  const labelFor = (index) => window.PVPC_STATS._comparisonLabels()[index];

  const dayWith = (dateStr, price) => ({
    days: { [dateStr]: [[0, price]] },
    meta: {}
  });

  it('reserva la posicion 59 para el 29-feb en todos los anyos', () => {
    expect(window.PVPC_STATS.canonicalDayIndex(2, 29)).toBe(59);
    expect(labelFor(59)).toBe('29 feb');
  });

  it('alinea 28-feb, 1-mar y 31-dic en un anyo NO bisiesto', () => {
    expect(window.PVPC_STATS.canonicalDayIndex(2, 28)).toBe(58);
    expect(window.PVPC_STATS.canonicalDayIndex(3, 1)).toBe(60);
    expect(window.PVPC_STATS.canonicalDayIndex(12, 31)).toBe(365);

    expect(labelFor(58)).toBe('28 feb');
    expect(labelFor(60)).toBe('1 mar');
    expect(labelFor(365)).toBe('31 dic');

    // 2023 no es bisiesto: el 1-mar debe caer en 60 ("1 mar"), no en 59.
    const ds = window.PVPC_STATS._buildYearDataset(dayWith('2023-03-01', 0.5), '2023');
    expect(ds.data[60]).toBe(0.5);
    expect(ds.data[59]).toBeNull();
  });

  it('alinea 28-feb, 1-mar y 31-dic en un anyo bisiesto', () => {
    const feb29 = window.PVPC_STATS._buildYearDataset(dayWith('2024-02-29', 0.1), '2024');
    expect(feb29.data[59]).toBe(0.1);

    const mar1 = window.PVPC_STATS._buildYearDataset(dayWith('2024-03-01', 0.2), '2024');
    expect(mar1.data[60]).toBe(0.2);

    const dic31 = window.PVPC_STATS._buildYearDataset(dayWith('2024-12-31', 0.3), '2024');
    expect(dic31.data[365]).toBe(0.3);
  });

  it('hace coincidir el mismo dia natural de un anyo bisiesto y uno no bisiesto', () => {
    const noBisiesto = window.PVPC_STATS._buildYearDataset(dayWith('2023-12-31', 1), '2023');
    const bisiesto = window.PVPC_STATS._buildYearDataset(dayWith('2024-12-31', 2), '2024');

    const idx = noBisiesto.data.findIndex((v) => v === 1);
    expect(bisiesto.data[idx]).toBe(2);
    expect(labelFor(idx)).toBe('31 dic');
  });

  it('toDailySeries usa el mismo eje canonico', () => {
    const serie = window.PVPC_STATS.toDailySeries(dayWith('2023-03-01', 0.7));
    expect(serie.values[60]).toBe(0.7);
    expect(serie.values[59]).toBeNull();
  });
});
