import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
const csvCode = fs.readFileSync(path.resolve(__dirname, '../js/pvpc-stats-csv.js'), 'utf8');
const uiCode = fs.readFileSync(path.resolve(__dirname, '../js/pvpc-stats-ui.js'), 'utf8');
const loadCsvUtils = new Function('window', utilsCode);
const loadPvpcStatsCsv = new Function('window', csvCode);
const loadPvpcStatsUi = new Function('window', uiCode);

function buildV2Month(ym, overrides = {}) {
  const [year, month] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDate = (ts) => formatter.format(new Date(ts * 1000));
  const days = {};
  for (let day = 1; day <= last; day += 1) {
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    const guess = Date.UTC(year, month - 1, day) / 1000;
    let start = null;
    for (let shift = -14 * 3600; shift <= 14 * 3600; shift += 3600) {
      const candidate = guess + shift;
      if (localDate(candidate) === date && localDate(candidate - 3600) !== date) { start = candidate; break; }
    }
    days[date] = [];
    for (let ts = start; localDate(ts) === date; ts += 3600) days[date].push([ts, 0.04]);
  }
  Object.assign(days, overrides);
  return { schema_version: 2, timezone: 'Europe/Madrid', from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days };
}

describe('PVPC stats UI CSV fallback helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.LF = {};
    window.__LF_pvpcStatsCsvLoaded = false;

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    loadCsvUtils(window);
    loadPvpcStatsCsv(window);
    loadPvpcStatsUi(window);
  });

  it('preserves the hour from fecha_hora values in the XLSX fallback path', () => {
    const { parseDateFlexible } = window.LF.csvUtils;
    const { parseDateHourValue, getHourIndex } = window.LF.pvpcStatsCsvHelpers;

    const parsed = parseDateHourValue('2026-04-01 13:45', parseDateFlexible);

    expect(parsed.fecha).toBeInstanceOf(Date);
    expect(parsed.fecha.getFullYear()).toBe(2026);
    expect(parsed.fecha.getMonth()).toBe(3);
    expect(parsed.fecha.getDate()).toBe(1);
    expect(parsed.hora).toBe(14);
    expect(getHourIndex(parsed.hora, parsed.fecha)).toBe(13);
  });

  it('falls back to date-only parsing when there is no hour in the cell', () => {
    const { parseDateFlexible } = window.LF.csvUtils;
    const { parseDateHourValue } = window.LF.pvpcStatsCsvHelpers;

    const parsed = parseDateHourValue('2026-04-01', parseDateFlexible);

    expect(parsed.fecha).toBeInstanceOf(Date);
    expect(parsed.hora).toBeNull();
  });

  it('rejects personal CSV/XLSX files above 10 MB before reading them', async () => {
    const { parseCsvOrXlsx } = window.LF.pvpcStatsCsvHelpers;
    const hugeFile = {
      name: 'huge.csv',
      size: 10 * 1024 * 1024 + 1,
      text: () => {
        throw new Error('should not read file contents');
      }
    };

    await expect(parseCsvOrXlsx(hugeFile)).rejects.toThrow(/10 MB/);
  });


  it('reintenta el mes de excedentes del fallback tras un 503 en la misma sesion', async () => {
    delete window.LF.surplusPrices;
    // Dia civil COMPLETO en Europe/Madrid (24h desde 1774994400 = 2026-04-01 00:00
    // local): un unico punto horario ya no pasa el validador compartido de cobertura
    // (bloqueante 2, 12/08/2026).
    const fullDay = Array.from({ length: 24 }, (_, h) => [1774994400 + h * 3600, 0.04]);
    let attempts = 0;
    global.fetch = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => buildV2Month('2026-04', { '2026-04-01': fullDay })
      };
    };

    try {
      const first = await window.__LF_PvpcStatsCsv.loadSurplusMonth('8741', '2026-04');
      const second = await window.__LF_PvpcStatsCsv.loadSurplusMonth('8741', '2026-04');

      expect(first).toBeNull();
      expect(second?.days?.['2026-04-01']).toHaveLength(24);
      expect(attempts).toBe(2);
    } finally {
      delete global.fetch;
    }
  });

  it('reintenta un payload de excedentes malformado aunque responda HTTP 200', async () => {
    delete window.LF.surplusPrices;
    // Dia civil COMPLETO en Europe/Madrid para el segundo intento (el primero sigue
    // siendo invalido por si solo: la fecha declarada no pertenece al mes pedido).
    const fullDay = Array.from({ length: 24 }, (_, h) => [1774994400 + h * 3600, 0.04]);
    let attempts = 0;
    global.fetch = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: true, json: async () => ({ days: { '2026-05-01': [[1777586400, 0.04]] } }) };
      return {
        ok: true,
        json: async () => buildV2Month('2026-04', { '2026-04-01': fullDay })
      };
    };

    try {
      const first = await window.__LF_PvpcStatsCsv.loadSurplusMonth('8741', '2026-04');
      const second = await window.__LF_PvpcStatsCsv.loadSurplusMonth('8741', '2026-04');

      expect(first).toBeNull();
      expect(second?.days?.['2026-04-01']).toHaveLength(24);
      expect(attempts).toBe(2);
    } finally {
      delete global.fetch;
    }
  });

  it('maps DST fallback days with exact CNMC hours, including hora 25 and later hours', () => {
    const { getHourIndex, buildCnmcHourIndexMap, getVisualHourBucket } = window.LF.pvpcStatsCsvHelpers;
    const baseTs = Date.parse('2024-10-26T22:00:00Z') / 1000; // 00:00 local del 27/10/2024
    const dayHours = Array.from({ length: 25 }, (_, i) => [baseTs + i * 3600, i / 100]);

    const byCnmcHour = buildCnmcHourIndexMap(dayHours, 'Europe/Madrid');

    expect(byCnmcHour.get(3)).toBe(2);   // Primera 02:00 local
    expect(byCnmcHour.get(25)).toBe(3);  // Segunda 02:00 local
    expect(byCnmcHour.get(4)).toBe(4);   // 03:00 local, ya desplazada

    expect(getHourIndex(3, new Date('2024-10-27T00:00:00'), dayHours, 'Europe/Madrid')).toBe(2);
    expect(getHourIndex(25, new Date('2024-10-27T00:00:00'), dayHours, 'Europe/Madrid')).toBe(3);
    expect(getHourIndex(4, new Date('2024-10-27T00:00:00'), dayHours, 'Europe/Madrid')).toBe(4);

    expect(getVisualHourBucket(24, new Date('2024-10-27T00:00:00'))).toBe(23);
    expect(getVisualHourBucket(25, new Date('2024-10-27T00:00:00'))).toBe(2);
    expect(getVisualHourBucket(4, new Date('2024-10-27T00:00:00'))).toBe(3);

    const hourly = new Array(24).fill(0);
    hourly[getVisualHourBucket(24)] += 1;
    hourly[getVisualHourBucket(25)] += 1;

    expect(hourly).toHaveLength(24);
    expect(hourly[23]).toBe(1);
    expect(hourly[2]).toBe(1);
  });

  // Reproduccion exacta del hallazgo de Codex (bloqueante 2, 12/08/2026): un mes de
  // excedentes HTTP 200 con un dia HISTORICO (no "hoy") muy incompleto no puede tratarse
  // como sano en el importador CSV del Observatorio.
  it('rechaza loadSurplusMonth si un día histórico llega con muchas horas ausentes', async () => {
    delete window.LF.surplusPrices;
    const fullDay = Array.from({ length: 24 }, (_, h) => [1774994400 + h * 3600, 0.04]);
    global.fetch = async () => ({
      ok: true,
      json: async () => buildV2Month('2026-04', { '2026-04-01': fullDay.slice(0, 10) })
    });

    try {
      const result = await window.__LF_PvpcStatsCsv.loadSurplusMonth('8741', '2026-04');
      expect(result).toBeNull();
    } finally {
      delete global.fetch;
    }
  });
});

// Anadido 25/07/2026: el observatorio era el unico de los tres importadores que NO enviaba
// el motivo del error a analitica, asi que en GoatCounter se veia
// 'csv-import-error/estadisticas/csv' sin poder saber por que habia fallado.
describe('Observatorio: el evento de error CSV lleva el motivo', () => {
  it('emite csv-import-error con extension Y codigo de error como tercer segmento', () => {
    expect(uiCode).toMatch(
      /trackStatsEvent\(\s*'csv-import-error'\s*,\s*\[\s*'estadisticas'\s*,\s*extension\s*,\s*errorCode\s*\]/
    );
  });

  it('el codigo sale de csvErrorCodeForTracking, nunca del mensaje literal', () => {
    expect(uiCode).toMatch(/const errorCode = window\.LF\?\.csvUtils\?\.csvErrorCodeForTracking\?\.\(/);
    // Nunca debe enviarse err.message como segmento del path.
    expect(uiCode).not.toMatch(/trackStatsEvent\([^)]*err\?\.message/);
  });
});


describe('Observatorio: cobertura parcial del CSV de excedentes', () => {
  it('muestra la energía aportada completa y no inventa importe para un mes sin precio', () => {
    expect(uiCode).toContain('Number.isFinite(stats.inputKwh) ? stats.inputKwh : stats.totalKwh');
    expect(uiCode).toContain("row.pricedHours > 0 ? fmtEur(row.eur) : '—'");
    expect(uiCode).toContain('La compensación y el precio medio solo incluyen la energía con precio disponible.');
  });
});


describe('Observatorio: recomendaciones horarias con cobertura parcial', () => {
  it('no crea un bloque de 3 horas si alguna de sus horas todavía no tiene datos', () => {
    const { computeWindowOptions } = window.__LF_PvpcStatsUiHelpers;

    expect(computeWindowOptions([0.10, 0.20, null, null], 3)).toEqual([]);

    // Solo la ventana 0-3 esta completa; la que empieza en 1 incluye un null y se descarta.
    // La media se compara con tolerancia: (0,10+0,20+0,30)/3 da 0.20000000000000004 en
    // coma flotante, asi que una igualdad exacta contra 0.20 falla sin que haya bug.
    const ventanas = computeWindowOptions([0.10, 0.20, 0.30, null], 3);
    expect(ventanas).toHaveLength(1);
    expect(ventanas[0].start).toBe(0);
    expect(ventanas[0].end).toBe(3);
    expect(ventanas[0].avg).toBeCloseTo(0.20, 10);
  });
});


describe('Observatorio: una carga obsoleta no puede pintar un error sobre la selección actual', () => {
  it('comprueba el token antes de mostrar el error del primer loadYearData', () => {
    expect(uiCode).toMatch(
      /catch \(e\) \{\s*\/\/[\s\S]*?if \(myToken !== _rerenderToken\) return;\s*showError\('Error cargando dataset local\.'\)/
    );
  });
});


describe('Observatorio: degradacion explicita por meses remotos fallidos', () => {
  it('muestra que los indicadores son parciales e identifica los meses fallidos', () => {
    expect(uiCode).toContain('datos parciales');
    expect(uiCode).toMatch(/status\.failedMonths\.join\(', '\)/);
  });

  it('marca rolling 12m y YoY si el año previo es parcial aunque el visible esté completo', () => {
    const { getKpiPartialFlags } = window.__LF_PvpcStatsUiHelpers;

    expect(getKpiPartialFlags({ partial: false }, { partial: true }, { partial: true }))
      .toEqual({ current: false, rolling12m: true, yoy: true });
    expect(getKpiPartialFlags({ partial: false }, { partial: true }, { partial: false }))
      .toEqual({ current: false, rolling12m: true, yoy: false });
    expect(getKpiPartialFlags({ partial: true }, { partial: false }, { partial: false }))
      .toEqual({ current: true, rolling12m: true, yoy: true });
    expect(getKpiPartialFlags({ partial: false, provisional: true }, { partial: false }, { partial: false }))
      .toEqual({ current: true, rolling12m: true, yoy: true });
  });
});

// Auditoría temática de importaciones 24/08/2026: si la selección B falla, el estado de A
// no puede sobrevivir oculto y reaparecer cuando un rerender posterior llama refreshCsvStats().
describe('Observatorio: una importación fallida invalida el CSV anterior', () => {
  it('limpia records y reloj de zona antes de borrar la UI en el catch de importación', () => {
    expect(uiCode).toMatch(
      /trackStatsEvent\(\s*'csv-import-error'[\s\S]*?csvState\.records\s*=\s*null;\s*csvState\.canaryClock\s*=\s*null;\s*renderCsvStats\(null\)/
    );
  });


  it('un refresco posterior de año/zona no puede reusar A porque refreshCsvStats corta sin records', () => {
    expect(uiCode).toMatch(
      /const refreshCsvStats\s*=\s*async\s*\([^)]*\)\s*=>\s*\{\s*if\s*\(!csvState\.records\)\s*return;/
    );
    expect(uiCode).toMatch(/await refreshCsvStats\(\(\) => myToken === _rerenderToken\)/);
  });
});
