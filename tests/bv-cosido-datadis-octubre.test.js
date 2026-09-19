import { beforeEach, describe, it, expect, vi } from 'vitest';

// Ronda 37 (15/09/2026): cruce de dos cambios que se probaron por separado, el cosido del mes
// partido (11/09) y la hora repetida de octubre en base 1-24 de Datadis (12/09). Los tests de
// Datadis empiezan el dia 1 y no cosen; los del cosido usan curvas de 24 horas. Aqui el dia del
// cambio de hora cae dentro del mes cosido, y en un caso justo en el dia que se recorta por
// solape: tiene que irse con sus 25 horas, no dejar la repetida suelta. Tambien marzo (23 horas),
// y los dos consumidores economicos de los tramos (SSAA e indexado) sobre la fila que sale de la
// cadena real, no sobre una fila escrita a mano.
//
// Los datos se generan aqui a proposito: ningun fixture real sirve. `1.csv` no llega a 13 meses
// y numera octubre con hora 25 explicita (CNMC), no con la hora repetida de Datadis.
import '../js/lf-config.js';
// lf-csv-import.js toma round2 de lf-utils.js al cargarse, igual que en produccion.
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';
import '../js/lf-csv-import.js';
import '../js/lf-ssaa.js';
import '../js/lf-surplus-prices.js';
import '../js/bv/bv-sim-monthly.js';
import '../js/bv/bv-ui-helpers.js';

const dos = (n) => String(n).padStart(2, '0');
const CAMBIO_OCTUBRE = new Set(['2025/10/26', '2026/10/25']);
const CAMBIO_MARZO = new Set(['2025/03/30', '2026/03/29']);

// Forma real de Datadis: base 1-24, la hora repetida sin marca que la distinga y la hora que no
// existe simplemente ausente. El kWh cambia con el año civil para que conservar el tramo
// equivocado se note en la energia.
function datadis(inicio, fin) {
  const filas = [['cups', 'fecha', 'hora', 'consumo_kWh', 'metodoObtencion']];
  let d = new Date(inicio);
  while (d <= fin) {
    const fecha = `${d.getFullYear()}/${dos(d.getMonth() + 1)}/${dos(d.getDate())}`;
    const kwh = d.getFullYear() === 2025 ? '0,500' : '0,400';
    for (let h = 1; h <= 24; h += 1) {
      if (CAMBIO_MARZO.has(fecha) && h === 3) continue;
      filas.push(['ES0031', fecha, `${dos(h)}:00`, kwh, 'Real']);
      if (CAMBIO_OCTUBRE.has(fecha) && h === 3) filas.push(['ES0031', fecha, `${dos(h)}:00`, '0,700', 'Real']);
    }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return filas;
}

const parsear = (filas) => {
  const u = window.LF.csvUtils;
  return u.parseEnergyTableRows(filas, {
    headerRowIndex: 0, parseNumber: u.parseNumberFlexibleCSV, zonaFiscal: 'Península'
  });
};

// Mismas capas y mismo orden que bv-import.js + bv-ui.js.
function cadena(filas) {
  const u = window.LF.csvUtils;
  const manualUi = window.BVSim.manualUi;
  const parsed = parsear(filas);
  const span = u.validateCsvSpanFromRecords(parsed.records, {
    maxDays: 370, requireExactly12Months: true, coverageThreshold: 80
  });
  if (!span.ok) throw new Error(span.error);
  const recs = span.stitch ? u.applyEdgeStitchPlan(parsed.records, span.stitch) : parsed.records;
  const { monthDataMap } = manualUi.pickLatestMonthData(window.BVSim.bucketizeByMonth(recs, 'Península', {}));
  const entries = {};
  const metaByIndex = {};
  monthDataMap.forEach((data, index) => {
    entries[index] = { p1: data.p1, p2: data.p2, p3: data.p3, vert: data.vert };
    metaByIndex[index] = data.meta;
  });
  const months = manualUi.buildSimulationMonths(entries, { currentYear: 2030, monthMetaByIndex: metaByIndex });
  const suma = (lista) => lista.reduce((acc, r) => acc + r.kwh, 0);
  return {
    parsed,
    recs,
    months,
    mes: (mm) => months.find((m) => m.key.endsWith(`-${mm}`)),
    horasDe: (ymd) => recs.filter((r) => u.ymdLocal(r.fecha) === ymd).length,
    energiaFichero: suma(parsed.records),
    energiaRegistros: suma(recs),
    energiaFilas: months.reduce((acc, m) => acc + m.importTotalKWh, 0),
    cobertura: manualUi.getConsumptionCoverageDays(months)
  };
}

describe('Mes cosido con la hora repetida de octubre de Datadis (base 1-24)', () => {
  it('365 dias desde mitad de octubre: el dia de 25 horas del tramo antiguo se conserva entero', () => {
    const r = cadena(datadis(new Date(2025, 9, 15), new Date(2026, 9, 14)));

    expect(r.recs).toHaveLength(8760);
    expect(r.horasDe('2025-10-26')).toBe(25);
    expect(r.energiaRegistros).toBeCloseTo(r.energiaFichero, 6);
    expect(r.energiaFilas).toBeCloseTo(r.energiaFichero, 2);
    expect(r.mes('10').daysWithData).toBe(31);
    expect(r.mes('10').sourceKeys).toEqual(['2025-10', '2026-10']);
    expect(r.cobertura).toBe(365);
  });

  it('366 dias con el dia de 25 horas en el solape: se recorta con sus 25 filas', () => {
    const r = cadena(datadis(new Date(2025, 9, 26), new Date(2026, 9, 26)));

    expect(r.parsed.records).toHaveLength(8785);
    expect(r.recs).toHaveLength(8760);
    expect(r.horasDe('2025-10-26')).toBe(0);
    expect(r.horasDe('2026-10-26')).toBe(24);
    expect(r.horasDe('2026-10-25')).toBe(25);
    // Sale el dia de 2025 completo: 24 horas a 0,500 y la repetida a 0,700.
    const esperado = r.energiaFichero - (24 * 0.5 + 0.7);
    expect(r.energiaRegistros).toBeCloseTo(esperado, 6);
    expect(r.energiaFilas).toBeCloseTo(esperado, 2);
    expect(r.mes('10').daysWithData).toBe(31);
    expect(r.cobertura).toBe(365);
  });

  it('366 dias con el solape en un dia normal: el octubre cosido lleva dos dias reales de 25 horas', () => {
    const r = cadena(datadis(new Date(2025, 9, 25), new Date(2026, 9, 25)));

    // No es un duplicado: 26/10/2025 y 25/10/2026 son dos dias distintos y los dos tuvieron
    // 25 horas. 365 dias con dos de 25 y uno de 23 dan 8761 registros.
    expect(r.recs).toHaveLength(8761);
    expect(r.horasDe('2025-10-25')).toBe(0);
    expect(r.horasDe('2025-10-26')).toBe(25);
    expect(r.horasDe('2026-10-25')).toBe(25);
    const esperado = r.energiaFichero - 24 * 0.5;
    expect(r.energiaRegistros).toBeCloseTo(esperado, 6);
    expect(r.energiaFilas).toBeCloseTo(esperado, 2);
    expect(r.mes('10').daysWithData).toBe(31);
    expect(r.cobertura).toBe(365);
  });
});

describe('Mes cosido con el dia de 23 horas de marzo', () => {
  it('365 dias desde mitad de marzo: el dia de 23 horas del tramo antiguo se conserva entero', () => {
    const r = cadena(datadis(new Date(2025, 2, 15), new Date(2026, 2, 14)));

    expect(r.recs).toHaveLength(8760);
    expect(r.horasDe('2025-03-30')).toBe(23);
    expect(r.energiaFilas).toBeCloseTo(r.energiaFichero, 2);
    expect(r.mes('03').daysWithData).toBe(31);
    expect(r.mes('03').sourceKeys).toEqual(['2025-03', '2026-03']);
    expect(r.cobertura).toBe(365);
  });

  it('366 dias con el dia de 23 horas en el solape: se recorta con sus 23 filas', () => {
    const r = cadena(datadis(new Date(2025, 2, 30), new Date(2026, 2, 30)));

    expect(r.parsed.records).toHaveLength(8783);
    expect(r.recs).toHaveLength(8760);
    expect(r.horasDe('2025-03-30')).toBe(0);
    expect(r.horasDe('2026-03-29')).toBe(23);
    expect(r.horasDe('2026-03-30')).toBe(24);
    const esperado = r.energiaFichero - 23 * 0.5;
    expect(r.energiaRegistros).toBeCloseTo(esperado, 6);
    expect(r.energiaFilas).toBeCloseTo(esperado, 2);
    expect(r.cobertura).toBe(365);
  });
});

describe('El mismo fichero en la home y en el simulador solar', () => {
  it('la home procesa los 366 dias sin coser; el solar descuenta exactamente el dia recortado', async () => {
    const filas = datadis(new Date(2025, 9, 26), new Date(2026, 9, 26));
    const texto = filas.map((fila) => fila.join(';')).join('\n');
    // Flujo real de la home, no solo su frontera: lectura del fichero, validacion del periodo,
    // descarte de meses si lo hubiera y reparto P1/P2/P3 (procesarCSVConsumos, lf-csv-import.js).
    const home = await window.LF.procesarCSVConsumos(new File([texto], 'datadis.csv', { type: 'text/csv' }));
    const solar = cadena(filas);
    const aNumero = (valor) => Number(String(valor).replace(',', '.'));

    expect(home.error).toBeUndefined();
    expect(home.ok).toBe(true);
    expect(home.dias).toBe(366);
    expect(home.consumosHorarios).toHaveLength(8785);
    expect(aNumero(home.totalKwh)).toBeCloseTo(solar.energiaFichero, 2);
    expect(aNumero(home.punta) + aNumero(home.llano) + aNumero(home.valle)).toBeCloseTo(solar.energiaFichero, 1);
    // La diferencia entre las dos herramientas es el dia repetido y nada mas.
    expect(solar.energiaFichero - solar.energiaFilas).toBeCloseTo(24 * 0.5 + 0.7, 2);
  });
});

describe('Consumidores economicos de los tramos sobre la fila de la cadena real', () => {
  // 26/10/2025-26/10/2026: el tramo antiguo aporta los dias 27-31 (120 h) y el reciente los dias
  // 1-26 con el de 25 horas (625 h). El 26/10/2025 recortado no puede contar en ningun consumidor.
  const r = () => cadena(datadis(new Date(2025, 9, 26), new Date(2026, 9, 26)));

  it('SSAA: cada tramo paga la tasa de su mes con el consumo que de verdad aporta', () => {
    const octubre = r().mes('10');
    expect(octubre.segments.map((s) => [s.key, s.days, s.kwh])).toEqual([
      ['2025-10', 5, 60],
      ['2026-10', 26, 250.3]
    ]);

    const res = window.BVSim.calcMonthForTarifa({
      month: octubre,
      tarifa: {
        nombre: 'Dummy con SSAA repercutidos', tipo: '1P',
        p1: 0.1, p2: 0.1, cPunta: 0.1, cLlano: 0.1, cValle: 0.1,
        incluyeServiciosAjuste: false, fv: { exc: 0, bv: false }
      },
      potenciaP1: 4.6,
      potenciaP2: 4.6,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península',
      ssaaDataset: {
        latest_complete_month: '2026-10',
        latest_value: 0.01,
        values: { '2025-10': 0.02, '2026-10': 0.01 }
      }
    });

    // 60 x 0,02 + 250,3 x 0,01 = 3,703. Con la clave de la fila sola saldria 310,3 x 0,01 = 3,10.
    expect(res.ssaaMonth).toBe('2025-10 + 2026-10');
    expect(res.ssaaEur).toBeCloseTo(3.70, 2);
  });

  describe('indexado con la traza horaria real', () => {
    const PRECIO = { '2025': 0.05, '2026': 0.10 };

    function diaCivil(ymd, precio) {
      const [y, m, d] = ymd.split('-').map(Number);
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
      });
      const ymdDe = (ts) => {
        const p = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day}`;
      };
      const guess = Date.UTC(y, m - 1, d) / 1000;
      let inicio = null;
      for (let shift = -14 * 3600; shift <= 14 * 3600; shift += 3600) {
        if (ymdDe(guess + shift) === ymd && ymdDe(guess + shift - 3600) !== ymd) { inicio = guess + shift; break; }
      }
      const puntos = [];
      for (let ts = inicio; ymdDe(ts) === ymd; ts += 3600) puntos.push([ts, precio]);
      return puntos;
    }

    function mesV2(ym) {
      const [year, month] = ym.split('-').map(Number);
      const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const days = {};
      for (let day = 1; day <= ultimo; day += 1) {
        const fecha = `${ym}-${dos(day)}`;
        days[fecha] = diaCivil(fecha, PRECIO[ym.slice(0, 4)]);
      }
      return { schema_version: 2, timezone: 'Europe/Madrid', from: `${ym}-01`, to: `${ym}-${dos(ultimo)}`, days };
    }

    beforeEach(() => {
      window.LF.surplusPrices._clearCaches();
      global.fetch = vi.fn(async (url) => {
        const ym = /(\d{4}-\d{2})\.json$/.exec(String(url))[1];
        return { ok: true, json: async () => mesV2(ym) };
      });
    });

    it('suma los dos tramos a su precio real, con la hora 25 valorada y sin el dia recortado', async () => {
      const cad = r();
      // 0,1 kWh vertidos en cada hora conservada, incluida la repetida de octubre.
      const traza = cad.recs.map((rec) => Object.assign({}, rec, { excedente: 0.1 }));
      const stats = await window.LF.surplusPrices.computeHourlyCompensation(traza, { geo: '8741' });

      const tramo2025 = stats.monthlyRows.find((row) => row.ym === '2025-10');
      const tramo2026 = stats.monthlyRows.find((row) => row.ym === '2026-10');
      expect(tramo2025.missing).toBe(0);
      expect(tramo2026.missing).toBe(0);
      expect(tramo2025.pricedHours).toBe(120);
      expect(tramo2026.pricedHours).toBe(625);

      const [octubre] = window.LF.surplusPrices.applyMonthlyIndexedValues([cad.mes('10')], stats);
      // 120 x 0,1 x 0,05 + 625 x 0,1 x 0,10 = 0,60 + 6,25. Con el dia recortado dentro saldria
      // 6,975; sin la hora 25, 6,84.
      expect(octubre.indexedSurplusEur).toBeCloseTo(6.85, 2);
    });
  });
});
