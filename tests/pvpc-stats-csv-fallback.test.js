import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
// lf-config.js aporta roundMoneyProducts, que es el contrato monetario que ambas rutas
// deben respetar. Sin el, el fallback devolveria el acumulado crudo y la frontera de
// medio centimo de mas abajo no se podria distinguir.
import '../js/lf-config.js';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

/**
 * Ruta FALLBACK de `computeCsvCompensation` (js/pvpc-stats-csv.js).
 *
 * En condiciones normales esa funcion delega en `window.LF.surplusPrices`
 * (js/lf-surplus-prices.js) y su propio cuerpo no se ejecuta. Solo corre si ese modulo no
 * llego a cargarse, que es justo el escenario de las defensas de carga parcial.
 * Al no ejecutarse en el camino feliz es facil que se quede atras: durante la ronda 8
 * (16/08/2026) el modulo normal aprendio a distinguir "sin cobertura" de "cero" y la UI
 * empezo a exigir `pricedHours` para decidir si muestra el importe, pero este no se
 * actualizo. Estos tests fijan el contrato que la UI espera de AMBAS rutas.
 */

// Construye un dia civil completo en el formato real del dataset: [ts_segundos, precio].
function buildFullCivilDay(ymd, timeZone = 'Europe/Madrid', precio = 0.1) {
  const [y, m, d] = ymd.split('-').map(Number);
  const startGuessUtc = Date.UTC(y, m - 1, d) / 1000;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  });
  const ymdOf = (ts) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  let start = null;
  for (let shift = -14 * 3600; shift <= 14 * 3600; shift += 3600) {
    const c = startGuessUtc + shift;
    if (ymdOf(c) === ymd && ymdOf(c - 3600) !== ymd) { start = c; break; }
  }
  if (start === null) throw new Error(`No se pudo anclar ${ymd}`);
  const points = [];
  for (let ts = start; ymdOf(ts) === ymd; ts += 3600) points.push([ts, precio]);
  return points;
}

function buildSurplusMonth(ym, { geoId = 8741, indicator = 1739 } = {}) {
  const [year, month] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = {};
  for (let d = 1; d <= last; d += 1) {
    const ymd = `${ym}-${String(d).padStart(2, '0')}`;
    days[ymd] = buildFullCivilDay(ymd);
  }
  return {
    schema_version: 2, geo_id: geoId, timezone: 'Europe/Madrid', indicator,
    unit: 'EUR/kWh', epoch_unit: 's', from: `${ym}-01`,
    to: `${ym}-${String(last).padStart(2, '0')}`, days
  };
}

const GEO = '8741';
const DIA_CON_PRECIO = '2025-10-01';
const DIA_SIN_PRECIO = '2021-05-15';

function registrosDe(ymd, excedentePorHora) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Array.from({ length: 24 }, (_, h) => ({
    fecha: new Date(Date.UTC(y, m - 1, d, 12)), // mediodia UTC: dia civil inequivoco
    hora: h + 1,
    excedente: excedentePorHora
  }));
}

describe('Observatorio (fallback sin lf-surplus-prices): cobertura parcial', () => {
  let computeCsvCompensation;

  beforeAll(async () => {
    await import('../js/pvpc-stats-csv.js');
    computeCsvCompensation = window.__LF_PvpcStatsCsv.computeCsvCompensation;
  });

  beforeEach(() => {
    // Sin este modulo, computeCsvCompensation ejecuta su propio cuerpo (lo que probamos).
    if (window.LF) delete window.LF.surplusPrices;
    window.__LF_PvpcStatsCsv.csvMonthCache?.clear?.();
    window.PVPC_STATS = {
      runWithConcurrency: async (tareas) => { for (const t of tareas) await t(); }
    };
    global.fetch = vi.fn(async (url) => {
      const ym = String(url).match(/(\d{4}-\d{2})/)?.[1];
      if (ym !== '2025-10') return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        // La cobertura mensual es fail-closed: el validador exige el mes natural
        // completo, asi que un fixture con un solo dia se descartaria entero.
        json: async () => buildSurplusMonth('2025-10')
      };
    });
  });

  it('conserva la energia aportada aunque un mes no tenga precios, y no lo saca como mejor/peor', async () => {
    const stats = await computeCsvCompensation(
      [...registrosDe(DIA_CON_PRECIO, 0.2), ...registrosDe(DIA_SIN_PRECIO, 0.3)],
      GEO
    );

    // `totalKwh` mantiene su semantica: solo lo valorado (alimenta el calculo economico).
    expect(stats.totalKwh).toBeCloseTo(4.8, 6);
    // `inputKwh` es lo que el usuario aporto: 4,8 valorados + 7,2 sin precio.
    expect(stats.inputKwh).toBeCloseTo(12, 6);
    expect(stats.missing).toBe(24);
    expect(stats.missingKwh).toBeCloseTo(7.2, 6);

    // El mes sin un solo precio no figura como mejor ni peor. Ojo al leer esto: aqui la
    // razon NO es el filtro `comparableMonthlyRows`, sino que este modulo ni siquiera crea
    // la fila de un mes sin horas valoradas. Comprobado por mutacion (16/08/2026): quitar
    // ese filtro no hace fallar ningun test, porque es defensivo e inalcanzable en esta
    // ruta. Se conserva por simetria con js/lf-surplus-prices.js, donde SI es alcanzable.
    expect(stats.best.ym).toBe('2025-10');
    expect(stats.worst.ym).toBe('2025-10');
    expect(stats.monthlyRows.map((r) => r.ym)).toEqual(['2025-10']);
    expect(stats.monthlyRows.every((r) => Number.isFinite(r.avg))).toBe(true);
  });

  it('rechaza un 200 completo de otro indicador y reintenta en la siguiente búsqueda', async () => {
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts += 1;
      return {
        ok: true,
        status: 200,
        json: async () => buildSurplusMonth('2025-10', { indicator: attempts === 1 ? 1001 : 1739 })
      };
    });

    const first = await computeCsvCompensation(registrosDe(DIA_CON_PRECIO, 0.2), GEO);
    const second = await computeCsvCompensation(registrosDe(DIA_CON_PRECIO, 0.2), GEO);

    expect(first.totalKwh).toBe(0);
    expect(first.monthlyRows).toEqual([]);
    expect(attempts).toBe(2);
    expect(second.monthlyRows[0]?.pricedHours).toBe(24);
  });

  it('expone pricedHours para que la tabla muestre el importe y no un guion', async () => {
    const stats = await computeCsvCompensation(registrosDe(DIA_CON_PRECIO, 0.2), GEO);

    const fila = stats.monthlyRows.find((r) => r.ym === '2025-10');
    expect(fila.pricedHours).toBe(24);
    // Sin cobertura ausente, la energia aportada coincide con la valorada.
    expect(fila.inputKwh).toBeCloseTo(fila.kwh, 6);
    expect(stats.inputKwh).toBeCloseTo(stats.totalKwh, 6);
  });
});

/**
 * Frontera monetaria entre las dos rutas (ronda 26, 08/09/2026).
 *
 * El fallback acumulaba `kwh * price` y devolvia el crudo, mientras el proveedor comun
 * normaliza los operandos con `LF_CONFIG.roundMoneyProducts`. En una frontera de medio
 * centimo eso separaba los dos caminos: 85 x 0,095 = 8,075 se pintaba como "8,07 EUR"
 * por el fallback y como "8,08 EUR" por el modulo canonico, para el mismo CSV.
 */
describe('Observatorio: el importe no depende de que ruta lo calcule', () => {
  const YM = '2025-10';
  const FRONTERA_KWH = 85;
  const FRONTERA_PRECIO = 0.095;
  let computeCsvCompensation;
  let computeHourlyCompensation;

  // Una sola hora valorada: aisla el producto que cae en la frontera. Con 24 horas
  // iguales la suma volveria a un valor exacto y la diferencia se esconderia.
  const registroFrontera = [{
    fecha: new Date(Date.UTC(2025, 9, 1, 12)),
    hora: 13,
    excedente: FRONTERA_KWH
  }];

  beforeAll(async () => {
    await import('../js/pvpc-stats-csv.js');
    await import('../js/lf-surplus-prices.js');
    computeCsvCompensation = window.__LF_PvpcStatsCsv.computeCsvCompensation;
    computeHourlyCompensation = window.LF.surplusPrices.computeHourlyCompensation;
  });

  beforeEach(() => {
    window.__LF_PvpcStatsCsv.csvMonthCache?.clear?.();
    window.PVPC_STATS = {
      runWithConcurrency: async (tareas) => { for (const t of tareas) await t(); }
    };
    global.fetch = vi.fn(async (url) => {
      const ym = String(url).match(/(\d{4}-\d{2})/)?.[1];
      if (ym !== YM) return { ok: false, status: 404, json: async () => ({}) };
      const mes = buildSurplusMonth(YM);
      Object.keys(mes.days).forEach((ymd) => {
        mes.days[ymd] = buildFullCivilDay(ymd, 'Europe/Madrid', FRONTERA_PRECIO);
      });
      return { ok: true, status: 200, json: async () => mes };
    });
  });

  it('el fallback normaliza el importe del mes igual que el modulo canonico', async () => {
    delete window.LF.surplusPrices;
    const stats = await computeCsvCompensation(registroFrontera, GEO);

    const fila = stats.monthlyRows.find((r) => r.ym === YM);
    expect(fila.kwh).toBeCloseTo(FRONTERA_KWH, 6);
    // 85 x 0,095 = 8,075 exacto en decimal. Sin normalizar, toFixed(2) lo baja a 8,07.
    expect(fila.eur).toBe(8.08);
    expect(fila.eur.toFixed(2)).toBe('8.08');
    expect(stats.totalEur).toBe(8.08);
  });

  it('el precio medio sigue saliendo del acumulado crudo, no del importe redondeado', async () => {
    delete window.LF.surplusPrices;
    const stats = await computeCsvCompensation(registroFrontera, GEO);

    const fila = stats.monthlyRows.find((r) => r.ym === YM);
    // 8,08 / 85 daria 0,09505...: el redondeo del importe no puede contaminar el EUR/kWh.
    expect(fila.avg).toBeCloseTo(FRONTERA_PRECIO, 10);
    expect(stats.avgPrice).toBeCloseTo(FRONTERA_PRECIO, 10);
  });

  it('las dos rutas devuelven el mismo importe para el mismo CSV', async () => {
    const canonico = await computeHourlyCompensation(registroFrontera, { geo: GEO });
    delete window.LF.surplusPrices;
    window.__LF_PvpcStatsCsv.csvMonthCache?.clear?.();
    const fallback = await computeCsvCompensation(registroFrontera, GEO);

    expect(fallback.totalEur).toBe(canonico.totalEur);
    expect(fallback.monthlyRows.map((r) => [r.ym, r.eur]))
      .toEqual(canonico.monthlyRows.map((r) => [r.ym, r.eur]));
  });
});
