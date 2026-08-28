import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// Ronda 12: la UI no puede presentar un mes natural abierto como equivalente a un
// mes cerrado. El motor acepta correctamente el mes vigente hasta el ultimo dia
// publicado; la frontera que decide como etiquetarlo/compararlo es esta UI.
describe('Observatorio: cobertura de medias mensuales', () => {
  it('conserva la media hasta la fecha para tendencia, pero marca el mes abierto', () => {
    const { buildMonthlyFromDaily } = window.__LF_PvpcStatsUiHelpers;
    const labels = Array.from({ length: 25 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const monthly = buildMonthlyFromDaily(labels, labels.map(() => 0.20));

    expect(monthly.values[7]).toBeCloseTo(0.20, 10);
    expect(monthly.complete[7]).toBe(false);
    expect(monthly.coverageTo[7]).toBe('2026-08-25');
    expect(uiCode).toContain('media hasta ${ds.coverageTo[ctx.dataIndex]}');
  });

  it('no usa el mes abierto para mejor/peor mes cerrado aunque sea el extremo numerico', () => {
    const { buildMonthlyFromDaily, getMonthlyExtremes } = window.__LF_PvpcStatsUiHelpers;
    const labels = [];
    const values = [];
    for (let d = 1; d <= 31; d += 1) {
      labels.push(`2026-07-${String(d).padStart(2, '0')}`);
      values.push(0.10);
    }
    for (let d = 1; d <= 25; d += 1) {
      labels.push(`2026-08-${String(d).padStart(2, '0')}`);
      values.push(0.50);
    }

    const monthly = buildMonthlyFromDaily(labels, values);
    const pvpc = getMonthlyExtremes(monthly, false);
    const surplus = getMonthlyExtremes(monthly, true);

    // El mes es la asercion que discrimina (julio cerrado, no agosto abierto). El valor
    // se compara con tolerancia: la media acumula error IEEE-754 al sumar 31 sumandos,
    // igual que en el caso de cobertura parcial de mas arriba.
    for (const extremo of [pvpc.best, pvpc.worst, surplus.best, surplus.worst]) {
      expect(extremo.m).toBe(6);
      expect(extremo.v).toBeCloseTo(0.10, 10);
    }
    expect(uiCode).toContain('Mejor mes cerrado (media)');
  });

  it('no da por cerrado el ultimo dia natural si el motor lo marca provisional', () => {
    const { buildMonthlyFromDaily, computeMonthlyFromYearData } = window.__LF_PvpcStatsUiHelpers;
    const labels = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const monthly = buildMonthlyFromDaily(labels, labels.map(() => 0.20), ['2026-08-31']);
    const days = Object.fromEntries(labels.map((d) => [d, [[1, 0.20]]]));
    const comparison = computeMonthlyFromYearData({ meta: { year: 2026, provisionalDays: ['2026-08-31'] }, days });

    expect(monthly.complete[7]).toBe(false);
    expect(comparison.values[7]).toBeNull();
  });

  it('deja un hueco en la comparativa interanual para un mes natural aun abierto', () => {
    const { computeMonthlyFromYearData } = window.__LF_PvpcStatsUiHelpers;
    const days = {};
    for (let d = 1; d <= 31; d += 1) days[`2026-07-${String(d).padStart(2, '0')}`] = [[d, 0.10]];
    for (let d = 1; d <= 25; d += 1) days[`2026-08-${String(d).padStart(2, '0')}`] = [[100 + d, 0.50]];

    const monthly = computeMonthlyFromYearData({ meta: { year: 2026 }, days });

    expect(monthly.values[6]).toBeCloseTo(0.10, 10);
    expect(monthly.values[7]).toBeNull();
  });
});

// Ronda 12: un perfil agregado puede tener las 24 cubetas finitas aunque falte un
// mes entero o el ultimo dia solo tenga algunas horas. La UI debe conservar esa
// procedencia en el copy y no presentar el consejo como definitivo.
describe('Observatorio: procedencia de la recomendacion horaria', () => {
  it('distingue dias completos, dias provisionales y meses fallidos en vista anual', () => {
    const { getHourlyCoverageState } = window.__LF_PvpcStatsUiHelpers;
    const source = {
      days: {
        '2026-08-23': [],
        '2026-08-24': [],
        '2026-08-25': []
      }
    };
    const coverage = getHourlyCoverageState({
      failedMonths: ['02'],
      provisionalDays: ['2026-08-25']
    }, source, 'all');

    expect(coverage).toEqual({
      days: 3,
      completeDays: 2,
      provisionalDays: ['2026-08-25'],
      failedMonths: ['02'],
      partial: true,
      provisional: true
    });
    expect(uiCode).toContain('Consejo${adviceState}:');
    expect(uiCode).toContain('cobertura parcial');
  });

  it('mantiene el aviso si el mes seleccionado es precisamente el que fallo', () => {
    const { getHourlyCoverageState } = window.__LF_PvpcStatsUiHelpers;
    const coverage = getHourlyCoverageState({
      failedMonths: ['02'],
      provisionalDays: []
    }, { days: {} }, '02');

    expect(coverage.partial).toBe(true);
    expect(coverage.failedMonths).toEqual(['02']);
  });

  it('no hereda el fallo de otro mes al mirar un mes concreto que si esta completo', () => {
    const { getHourlyCoverageState } = window.__LF_PvpcStatsUiHelpers;
    const coverage = getHourlyCoverageState({
      failedMonths: ['02'],
      provisionalDays: ['2026-08-25']
    }, { days: { '2026-07-01': [], '2026-07-02': [] } }, '07');

    expect(coverage.partial).toBe(false);
    expect(coverage.provisional).toBe(false);
    expect(coverage.completeDays).toBe(2);
  });
});

// Ronda 12: los parametros son entrada hostil. Un enlace manipulado no puede dejar
// selects sin opcion representable ni duplicar series de comparacion.
describe('Observatorio: normalizacion del estado de URL', () => {
  it('conserva los valores validos compartidos por enlace', () => {
    const { parseParams } = window.__LF_PvpcStatsUiHelpers;
    history.replaceState(null, '', '/estadisticas/?type=surplus&geo=8742&year=2025&month=03&trendMode=monthly');

    expect(parseParams()).toMatchObject({
      type: 'surplus',
      geo: '8742',
      year: '2025',
      month: '03',
      trendMode: 'monthly'
    });
  });

  it('normaliza valores no representables antes de construir el estado', () => {
    const { parseParams } = window.__LF_PvpcStatsUiHelpers;
    const currentYear = String(new Date().getFullYear());
    history.replaceState(null, '', '/estadisticas/?type=otro&geo=9999&year=9999&month=13&trendMode=otro');

    const parsed = parseParams();

    expect(parsed).toMatchObject({
      type: 'pvpc',
      geo: '8741',
      year: currentYear,
      month: 'all',
      trendMode: 'daily'
    });
  });

  it('deduplica, filtra y limita compareYears sin aceptar decimales ni anos futuros', () => {
    const { normalizeSelectedYears } = window.__LF_PvpcStatsUiHelpers;
    const currentYear = new Date().getFullYear();
    const raw = `${currentYear},${currentYear},${currentYear - 1},2025.5,9999,2020,${currentYear - 2},${currentYear - 3},${currentYear - 4}`;

    const selected = normalizeSelectedYears(String(currentYear), raw);

    expect(selected.length).toBeLessThanOrEqual(4);
    expect(new Set(selected).size).toBe(selected.length);
    expect(selected.every((y) => Number.isInteger(y) && y >= 2021 && y <= currentYear)).toBe(true);
    expect(selected[0]).toBe(currentYear);
  });

  it('usa un ano base valido si el fallback recibe tambien un year hostil', () => {
    const { normalizeSelectedYears } = window.__LF_PvpcStatsUiHelpers;
    const currentYear = new Date().getFullYear();

    const selected = normalizeSelectedYears('9999', '');

    expect(selected[0]).toBe(currentYear);
    expect(selected.every((y) => y >= 2021 && y <= currentYear)).toBe(true);
  });
});

describe('Observatorio: rolling 12m se ancla en el ano seleccionado', () => {
  it('no muestra la media del ano anterior si el ano visible no cargo ninguna observacion', () => {
    const { computeRolling12m } = window.__LF_PvpcStatsUiHelpers;
    const previous = {
      days: {
        '2025-12-30': [[1, 0.10], [2, 0.20]],
        '2025-12-31': [[3, 0.30], [4, 0.40]]
      }
    };

    expect(computeRolling12m({ days: {} }, previous)).toBeNull();
  });

  it('sigue usando el ano anterior para completar la ventana cuando si existe ancla actual', () => {
    const { computeRolling12m } = window.__LF_PvpcStatsUiHelpers;
    const current = { days: { '2026-01-01': [[3, 0.30], [4, 0.30]] } };
    const previous = { days: { '2025-12-31': [[1, 0.10], [2, 0.10]] } };

    expect(computeRolling12m(current, previous)).toBeCloseTo(0.20, 10);
  });
});

describe('Observatorio: el selector de anyo no se rompe al cruzar el anyo', () => {
  it('el HTML no cablea anyos: la unica fuente del rango es el JS', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../estadisticas/index.html'), 'utf8');
    const select = html.match(/<select id="yearSelector"[^>]*>([\s\S]*?)<\/select>/);

    expect(select).not.toBeNull();
    expect(select[1]).not.toMatch(/<option/i);
  });

  it('genera las opciones desde DATASET_MIN_YEAR hasta el anyo en curso', () => {
    const { getAvailableYearsDesc, DATASET_MIN_YEAR } = window.__LF_PvpcStatsUiHelpers;
    const years = getAvailableYearsDesc(new Date('2026-08-25T10:00:00Z'));

    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(DATASET_MIN_YEAR);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });

  it('un anyo futuro sigue siendo seleccionable cuando el reloj llega a el (rollover)', () => {
    const { populateYearSelector } = window.__LF_PvpcStatsUiHelpers;
    const select = document.createElement('select');

    // 31/12/2026 a mediodia: 2027 no existe todavia y no debe ofrecerse.
    // OJO con la hora elegida: el rango sale de getFullYear(), que es hora LOCAL, asi
    // que a las 23:00Z del 31/12 en Europe/Madrid ya es 2027 y el test se volveria
    // contradictorio consigo mismo.
    populateYearSelector(select, new Date('2026-12-31T12:00:00Z'));
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('2027');

    // 01/01/2027: el mismo control tiene que admitir el anyo nuevo. Sin esto, el
    // <select> descarta el value y queda vacio mientras el estado ya usa 2027.
    populateYearSelector(select, new Date('2027-01-01T12:00:00Z'));
    select.value = '2027';
    expect(select.value).toBe('2027');
    expect(select.selectedIndex).toBe(0);
  });

  it('repoblar con el mismo rango no pierde la seleccion del usuario', () => {
    const { populateYearSelector } = window.__LF_PvpcStatsUiHelpers;
    const select = document.createElement('select');
    const hoy = new Date('2026-08-25T10:00:00Z');

    populateYearSelector(select, hoy);
    select.value = '2023';
    populateYearSelector(select, hoy);

    expect(select.value).toBe('2023');
  });


  it('applyStateToControls puebla el selector ANTES de asignarle el valor', () => {
    // Guardrail de cableado: el helper puede ser correcto y no servir de nada si nadie
    // lo llama, o si se llama despues de asignar el value (el <select> ya lo habria
    // descartado). Se comprueba sobre el cuerpo real de la funcion.
    const cuerpo = uiCode.match(/function applyStateToControls\([\s\S]*?\n  \}/);
    expect(cuerpo).not.toBeNull();

    const posPoblar = cuerpo[0].indexOf('populateYearSelector(els.year)');
    const posAsignar = cuerpo[0].indexOf('els.year.value = state.year');

    expect(posPoblar).toBeGreaterThan(-1);
    expect(posAsignar).toBeGreaterThan(-1);
    expect(posPoblar).toBeLessThan(posAsignar);
  });
});

describe('Observatorio: los canvas siguen el tema activo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.LF = {};
    delete window.__LF_PvpcStatsUiHelpers;
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });
    loadPvpcStatsUi(window);
  });

  it('aplica a ejes, rejilla y leyenda la paleta recibida sin animar', () => {
    const update = vi.fn();
    const chart = {
      options: {
        scales: {
          x: { ticks: { color: 'old' }, grid: { display: false } },
          y: { ticks: { color: 'old' }, grid: { color: 'old-grid' } }
        },
        plugins: { legend: { labels: { color: 'old' } } }
      },
      update
    };

    const applied = window.__LF_PvpcStatsUiHelpers.applyChartTheme(
      chart,
      'rgba(0,0,0,.08)',
      'rgba(0,0,0,.72)'
    );

    expect(applied).toBe(true);
    expect(chart.options.scales.x.ticks.color).toBe('rgba(0,0,0,.72)');
    expect(chart.options.scales.y.ticks.color).toBe('rgba(0,0,0,.72)');
    expect(chart.options.scales.y.grid.color).toBe('rgba(0,0,0,.08)');
    expect(chart.options.plugins.legend.labels.color).toBe('rgba(0,0,0,.72)');
    expect(update).toHaveBeenCalledWith('none');
  });

  it('deriva la paleta del tema web y cablea el boton real del shell', () => {
    const { getChartThemeColors } = window.__LF_PvpcStatsUiHelpers;
    document.documentElement.classList.remove('light-mode');
    expect(getChartThemeColors()).toEqual({
      gridColor: 'rgba(255,255,255,.08)',
      textColor: 'rgba(255,255,255,.78)'
    });

    document.documentElement.classList.add('light-mode');
    expect(getChartThemeColors()).toEqual({
      gridColor: 'rgba(0,0,0,.08)',
      textColor: 'rgba(0,0,0,.72)'
    });

    const attachBody = uiCode.match(/function attachThemeToggle\(\)[\s\S]*?\n  \}/)?.[0] || '';
    expect(attachBody).toContain("getElementById('btnTheme')");
    expect(attachBody).toContain('setTimeout(syncChartTheme, 0)');
  });

  it('limita las fechas del grafico de tendencia cuando el canvas es estrecho', () => {
    const { getTrendMaxTicksLimit } = window.__LF_PvpcStatsUiHelpers;

    expect(getTrendMaxTicksLimit('daily', 390)).toBe(3);
    expect(getTrendMaxTicksLimit('monthly', 390)).toBe(6);
    expect(getTrendMaxTicksLimit('daily', 900)).toBe(8);
    expect(getTrendMaxTicksLimit('monthly', 900)).toBe(12);
    expect(uiCode).toContain('ticks.maxTicksLimit = getTrendMaxTicksLimit(mode, size?.width)');
  });
});
