import { describe, it, expect } from 'vitest';

// Ronda 37 (15/09/2026): cruce de dos cambios que se probaron por separado, el cosido del mes
// partido (11/09) y la hora repetida de octubre en base 1-24 de Datadis (12/09). Los tests de
// Datadis empiezan el dia 1 y no cosen; los del cosido usan curvas de 24 horas. Aqui el dia del
// cambio de hora cae dentro del mes cosido, y en un caso justo en el dia que se recorta por
// solape: tiene que irse con sus 25 horas, no dejar la repetida suelta.
import '../js/lf-config.js';
import '../js/lf-csv-utils.js';
import '../js/lf-ssaa.js';
import '../js/bv/bv-sim-monthly.js';
import '../js/bv/bv-ui-helpers.js';

const dos = (n) => String(n).padStart(2, '0');

// Forma real de Datadis: base 1-24 y la hora repetida sin marca que la distinga. El kWh cambia
// con el año civil para que conservar el tramo equivocado se note en la energia.
function datadis(inicio, fin) {
  const filas = [['cups', 'fecha', 'hora', 'consumo_kWh', 'metodoObtencion']];
  const octubre = new Set(['2025/10/26', '2026/10/25']);
  let d = new Date(inicio);
  while (d <= fin) {
    const fecha = `${d.getFullYear()}/${dos(d.getMonth() + 1)}/${dos(d.getDate())}`;
    const kwh = d.getFullYear() === 2025 ? '0,500' : '0,400';
    for (let h = 1; h <= 24; h += 1) {
      if (fecha === '2026/03/29' && h === 3) continue;
      filas.push(['ES0031', fecha, `${dos(h)}:00`, kwh, 'Real']);
      if (octubre.has(fecha) && h === 3) filas.push(['ES0031', fecha, `${dos(h)}:00`, '0,700', 'Real']);
    }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return filas;
}

// Mismas capas y mismo orden que bv-import.js + bv-ui.js.
function cadena(filas) {
  const u = window.LF.csvUtils;
  const manualUi = window.BVSim.manualUi;
  const parsed = u.parseEnergyTableRows(filas, {
    headerRowIndex: 0, parseNumber: u.parseNumberFlexibleCSV, zonaFiscal: 'Península'
  });
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
    octubre: months.find((m) => m.key.endsWith('-10')),
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
    expect(r.octubre.daysWithData).toBe(31);
    expect(r.octubre.sourceKeys).toEqual(['2025-10', '2026-10']);
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
    expect(r.octubre.daysWithData).toBe(31);
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
    expect(r.octubre.daysWithData).toBe(31);
    expect(r.cobertura).toBe(365);
  });
});
