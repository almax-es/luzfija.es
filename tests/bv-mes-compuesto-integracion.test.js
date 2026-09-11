import { describe, it, expect } from 'vitest';

// Cadena COMPLETA del mes compuesto, de los registros horarios al coste simulado. Existe porque
// cada pieza tenia ya su prueba aislada, pero ninguna demostraba que la clave del mes destino
// sobrevive a todas las capas intermedias. El caso elegido es el unico en el que el destino NO
// es el tramo reciente: febrero con un bisiesto por medio.
import '../js/lf-config.js';
import '../js/lf-csv-utils.js';
import '../js/lf-ssaa.js';
import '../js/bv/bv-sim-monthly.js';
import '../js/bv/bv-ui-helpers.js';

describe('Mes compuesto - integracion de punta a punta con destino antiguo', () => {
  const tarifa = {
    nombre: 'Dummy con BV',
    tipo: '1P',
    p1: 0.1,
    p2: 0.1,
    cPunta: 0.12,
    cLlano: 0.1,
    cValle: 0.08,
    fv: { exc: 0.06, bv: true, tipo: 'SIMPLE + BV', tope: 'ENERGIA', reglaBV: 'BV MES ANTERIOR', precioBV: 0 }
  };

  function curvaHoraria(inicio, fin) {
    const records = [];
    let cursor = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
    const ultimo = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate());
    while (cursor <= ultimo) {
      for (let hora = 1; hora <= 24; hora += 1) {
        records.push({
          fecha: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
          hora,
          kwh: 0.4,
          excedente: hora >= 11 && hora <= 16 ? 0.3 : 0
        });
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return records;
  }

  // Recorre las mismas capas que el simulador solar, en el mismo orden.
  function cadenaCompleta(records) {
    const utils = window.LF.csvUtils;
    const manualUi = window.BVSim.manualUi;
    const span = utils.validateCsvSpanFromRecords(records, {
      maxDays: 370, requireExactly12Months: true, coverageThreshold: 80
    });
    if (!span.ok) throw new Error(span.error);
    const recortados = span.stitch ? utils.applyEdgeStitchPlan(records, span.stitch) : records;
    const meses13 = window.BVSim.bucketizeByMonth(recortados, 'Península', {});
    const { monthDataMap } = manualUi.pickLatestMonthData(meses13);
    const entries = {};
    const metaByIndex = {};
    monthDataMap.forEach((data, index) => {
      entries[index] = { p1: data.p1, p2: data.p2, p3: data.p3, vert: data.vert };
      metaByIndex[index] = data.meta;
    });
    const months = manualUi.buildSimulationMonths(entries, { currentYear: 2030, monthMetaByIndex: metaByIndex });
    return { span, recortados, months, manualUi };
  }

  const records = curvaHoraria(new Date(2024, 1, 13), new Date(2025, 1, 11));

  it('el CSV de 365 dias llega entero hasta las doce filas de simulacion', () => {
    const { recortados, months, manualUi } = cadenaCompleta(records);

    const diasCiviles = new Set(recortados.map((r) => r.fecha.toDateString())).size;
    expect(diasCiviles).toBe(365);
    expect(months).toHaveLength(12);
    expect(manualUi.getConsumptionCoverageDays(months)).toBe(365);
    expect(manualUi.hasFullAnnualConsumptionCoverage(months)).toBe(true);
  });

  it('la clave del mes destino sobrevive a todas las capas, no solo al plan', () => {
    // currentYear se pasa a proposito como 2030: si alguna capa reconstruyese la clave con el
    // año del entorno en vez de con la metadata, aparecerian claves de 2030.
    const { months } = cadenaCompleta(records);
    const febrero = months.find((month) => month.key.endsWith('-02'));

    expect(febrero.key).toBe('2024-02');
    expect(febrero.daysInMonth).toBe(29);
    expect(febrero.sourceKeys).toEqual(['2024-02', '2025-02']);
    expect(months.some((month) => month.key.startsWith('2030'))).toBe(false);
  });

  it('la ventana de doce meses va de febrero de 2024 a enero de 2025', () => {
    const { span, months } = cadenaCompleta(records);

    expect(span.monthsUsed[0]).toBe('2024-02');
    expect(span.monthsUsed[11]).toBe('2025-01');
    expect(new Set(months.map((m) => m.key)).size).toBe(12);
    expect(months.some((m) => m.key === '2025-02')).toBe(false);
  });

  it('la simulacion economica encadena el saldo BV en el orden rotado, empezando por el mes compuesto', () => {
    const { months, manualUi } = cadenaCompleta(records);
    const rotados = manualUi.rotateMonthsByStart(months, '2024-02');

    expect(rotados[0].key).toBe('2024-02');

    const resultado = window.BVSim.simulateForTarifaDemo({
      months: rotados,
      tarifa,
      potenciaP1: 4.6,
      potenciaP2: 4.6,
      bvSaldoInicial: 25,
      zonaFiscal: 'Península',
      esVivienda: true,
      ssaaDataset: null
    });

    expect(resultado.rows).toHaveLength(12);
    expect(resultado.rows[0].key).toBe('2024-02');
    // El saldo de cada mes es el de cierre del anterior: si alguna capa reordenase por indice de
    // calendario en vez de respetar el array recibido, la cadena se rompe aqui.
    resultado.rows.forEach((row, index) => {
      if (index === 0) expect(row.bvSaldoPrev).toBeCloseTo(25, 6);
      else expect(row.bvSaldoPrev).toBeCloseTo(resultado.rows[index - 1].bvSaldoFin, 6);
    });
    expect(Number.isFinite(resultado.totals.pagado)).toBe(true);
  });

  it('el mes compuesto cobra la potencia por los dias que realmente aporta', () => {
    const { months } = cadenaCompleta(records);
    const febrero = months.find((month) => month.key === '2024-02');
    const fila = window.BVSim.calcMonthForTarifa({
      month: febrero,
      tarifa,
      potenciaP1: 4.6,
      potenciaP2: 4.6,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península'
    });

    // 17 dias del tramo de 2024 mas 11 del de 2025; el dia 12 no esta en el archivo.
    expect(febrero.daysWithData).toBe(28);
    expect(fila.dias).toBe(28);
  });
});
