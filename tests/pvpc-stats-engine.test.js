import { beforeAll, describe, expect, it } from 'vitest';

process.env.TZ = 'America/Los_Angeles';

beforeAll(async () => {
  await import('../js/pvpc-stats-engine.js');
});

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
        return ok({
          from: '2024-01-01',
          to: '2024-01-01',
          days: { '2024-01-01': [[1704067200, 0.12]] }
        });
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
      expect(Object.keys(first.days)).toEqual(['2024-01-01']);
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

  it('loads only months listed in zone index manifest', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    const ok = (data) => ({ ok: true, json: async () => data });

    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);

      if (u.endsWith('/data/pvpc/8742/index.json')) {
        return ok({
          files: [
            { file: '2024-01.json' },
            { file: '2024-03.json' }
          ]
        });
      }
      if (u.endsWith('/data/pvpc/8742/2024-01.json')) {
        return ok({
          from: '2024-01-01',
          to: '2024-01-31',
          days: { '2024-01-01': [[1704067200, 0.12]] }
        });
      }
      if (u.endsWith('/data/pvpc/8742/2024-03.json')) {
        return ok({
          from: '2024-03-01',
          to: '2024-03-31',
          days: { '2024-03-01': [[1709251200, 0.2]] }
        });
      }

      throw new Error(`Unexpected fetch: ${u}`);
    };

    try {
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();

      const yearData = await window.PVPC_STATS.loadYearData(8742, 2024, 'pvpc');
      expect(Object.keys(yearData.days).sort()).toEqual(['2024-01-01', '2024-03-01']);
      expect(calls.some((u) => u.endsWith('/data/pvpc/8742/2024-02.json'))).toBe(false);
    } finally {
      global.fetch = originalFetch;
      window.PVPC_STATS.cache.clear();
      window.PVPC_STATS.manifestCache.clear();
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
        return ok({
          timezone: 'Europe/Madrid',
          from: '2024-04-01',
          to: '2024-04-01',
          days: {
            '2024-04-01': [
              [1711922400, 1],
              [1711926000, 2]
            ]
          }
        });
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
