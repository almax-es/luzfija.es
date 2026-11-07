import { describe, expect, it } from 'vitest';

import '../js/lf-csv-utils.js';
import '../js/lf-ssaa.js';

describe('LF SSAA helper', () => {
  const persistedDataset = (overrides = {}) => ({
    schema_version: 1,
    indicator: 10328,
    unit: 'EUR/kWh',
    timezone: 'Europe/Madrid',
    from: '2026-06',
    to: '2026-06',
    latest_complete_month: '2026-06',
    latest_value: 0.02,
    values: { '2026-06': 0.02 },
    ...overrides
  });
  const dataset = {
    latest_complete_month: '2026-04',
    latest_value: 0.02357,
    values: {
      '2026-04': 0.02357,
      '2026-05': 0.03123
    }
  };

  it('uses a monthly value only when the month is complete', () => {
    expect(window.LF.ssaa.getRateForMonth(dataset, '2026-04')).toBe(0.02357);
    expect(window.LF.ssaa.getRateForMonth(dataset, '2026-05')).toBe(0.02357);
  });

  it('reports the latest complete month when falling back from a partial month', () => {
    const charge = window.LF.ssaa.calcCharge(
      { nombre: 'Sin SSAA', incluyeServiciosAjuste: false },
      100,
      dataset,
      '2026-05'
    );

    expect(charge).toMatchObject({
      aplica: true,
      available: true,
      rate: 0.02357,
      eur: 2.36,
      month: '2026-04',
      reason: 'latest-complete-fallback'
    });
  });


  it('distingue dataset ausente de un coste SSAA legítimamente cero', () => {
    const charge = window.LF.ssaa.calcCharge(
      { nombre: 'Sin SSAA', incluyeServiciosAjuste: false },
      100,
      null,
      '2026-05'
    );
    expect(charge).toMatchObject({
      aplica: true,
      available: false,
      rate: null,
      eur: null,
      reason: 'dataset-unavailable'
    });
  });

  it('no sustituye un mes histórico ausente por el último valor publicado', () => {
    const charge = window.LF.ssaa.calcCharge(
      { nombre: 'Sin SSAA', incluyeServiciosAjuste: false },
      100,
      dataset,
      '2025-01'
    );
    expect(charge).toMatchObject({
      aplica: true,
      available: false,
      rate: null,
      eur: null,
      requestedMonth: '2025-01',
      reason: 'historical-month-unavailable'
    });
    expect(window.LF.ssaa.getRateForMonth(dataset, '2025-01')).toBeNull();
  });

  it('mantiene 0 € si no hay consumo aunque el dataset no esté disponible', () => {
    const charge = window.LF.ssaa.calcCharge(
      { nombre: 'Sin SSAA', incluyeServiciosAjuste: false },
      0,
      null,
      '2025-01'
    );
    expect(charge).toMatchObject({ aplica: true, available: true, rate: 0, eur: 0, month: null });
  });

  it('acepta un valor SSAA mensual explícitamente cero sin confundirlo con dato ausente', () => {
    const zeroDataset = {
      latest_complete_month: '2026-06',
      latest_value: 0,
      values: { '2026-06': 0 }
    };
    const charge = window.LF.ssaa.calcCharge(
      { nombre: 'Sin SSAA', incluyeServiciosAjuste: false },
      125,
      zeroDataset,
      '2026-06'
    );
    expect(charge).toMatchObject({ aplica: true, available: true, rate: 0, eur: 0, month: '2026-06' });
  });

  it('reintenta un HTTP 200 malformado en vez de conservarlo como dataset SSAA', async () => {
    const originalFetch = global.fetch;
    let attempts = 0;
    window.LF.ssaa._setDatasetForTests(null);
    global.fetch = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: true, json: async () => ({ latest_complete_month: '2026-05', latest_value: null, values: { '2026-05': null } }) };
      return {
        ok: true,
        json: async () => persistedDataset()
      };
    };

    try {
      expect(await window.LF.ssaa.loadDataset()).toBeNull();
      const recovered = await window.LF.ssaa.loadDataset();
      expect(attempts).toBe(2);
      expect(recovered?.values?.['2026-06']).toBe(0.02);
    } finally {
      global.fetch = originalFetch;
      window.LF.ssaa._setDatasetForTests(null);
    }
  });

  it('rechaza como no disponible un valor SSAA fuera del rango plausible del propio dataset', () => {
    const charge = window.LF.ssaa.calcCharge(
      { nombre: 'Sin SSAA', incluyeServiciosAjuste: false },
      300,
      { latest_complete_month: '2026-06', latest_value: 0.5, values: { '2026-06': 0.5 } },
      '2026-06'
    );

    expect(charge).toMatchObject({
      aplica: true, available: false, rate: null, eur: null, reason: 'historical-month-unavailable'
    });
  });

  it('no cachea el fichero SSAA si un mes histórico contiene un valor imposible aunque el último sea sano', async () => {
    const originalFetch = global.fetch;
    let attempts = 0;
    window.LF.ssaa._setDatasetForTests(null);
    global.fetch = async () => {
      attempts += 1;
      return {
        ok: true,
        json: async () => persistedDataset({
          from: '2026-05',
          values: { '2026-05': attempts === 1 ? 0.5 : 0.03, '2026-06': 0.02 }
        })
      };
    };

    try {
      expect(await window.LF.ssaa.loadDataset()).toBeNull();
      const recovered = await window.LF.ssaa.loadDataset();
      expect(attempts).toBe(2);
      expect(recovered?.values?.['2026-05']).toBe(0.03);
    } finally {
      global.fetch = originalFetch;
      window.LF.ssaa._setDatasetForTests(null);
    }
  });

  it('no cachea un SSAA 200 con unidad incompatible y reintenta el fichero corregido', async () => {
    const originalFetch = global.fetch;
    let attempts = 0;
    window.LF.ssaa._setDatasetForTests(null);
    global.fetch = async () => {
      attempts += 1;
      return {
        ok: true,
        json: async () => attempts === 1
          ? persistedDataset({ unit: 'EUR/MWh' })
          : persistedDataset()
      };
    };

    try {
      expect(await window.LF.ssaa.loadDataset()).toBeNull();
      const recovered = await window.LF.ssaa.loadDataset();
      expect(attempts).toBe(2);
      expect(recovered?.values?.['2026-06']).toBe(0.02);
    } finally {
      global.fetch = originalFetch;
      window.LF.ssaa._setDatasetForTests(null);
    }
  });

  it('does not apply to PVPC or tariffs that already include SSAA', () => {
    expect(window.LF.ssaa.mustApply({ incluyeServiciosAjuste: false, esPVPC: true })).toBe(false);
    expect(window.LF.ssaa.mustApply({ incluyeServiciosAjuste: true })).toBe(false);
    expect(window.LF.ssaa.mustApply({})).toBe(false);
  });
});

// ===== MES COMPUESTO POR TRAMOS =====
// El simulador solar cose en una sola fila los dos trozos del mes que un historico de 365 dias
// parte por la mitad. Los SSAA son un dataset mensual historico, asi que cada tramo tiene que
// pagar la tasa de SU mes: cobrar los 30 dias con la clave de un solo tramo aplica a los dias
// del otro año una tasa que no es la suya, y puede descartar una tasa publicada por el valor de
// reserva.
describe('LF SSAA - mes compuesto por dos tramos', () => {
  const tarifa = { incluyeServiciosAjuste: false };
  const dataset = {
    latest_complete_month: '2026-08',
    latest_value: 0.01883,
    values: { '2025-09': 0.01755, '2026-08': 0.01883 }
  };
  const segs = (over = {}) => [
    Object.assign({ key: '2025-09', days: 20, kwh: 200 }, over.a || {}),
    Object.assign({ key: '2026-09', days: 10, kwh: 100 }, over.b || {})
  ];

  it('reparte el consumo por tramos y aplica a cada uno la tasa de su mes', () => {
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 300, dataset, segs());

    // 200 x 0,01755 + 100 x 0,01883 (2026-09 no publicado, cae a 2026-08) = 5,393
    expect(charge.eur).toBeCloseTo(5.39, 10);
    expect(charge.aplica).toBe(true);
    expect(charge.available).toBe(true);
    expect(charge.month).toBe('2025-09 + 2026-08');
  });

  it('NO cobra el mes entero a la tasa de un solo tramo', () => {
    // Regresion del fallo: con la clave 2026-09 a secas serian 300 x 0,01883 = 5,65 EUR,
    // y con la de 2025-09, 5,27. El reparto correcto cae entre las dos.
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 300, dataset, segs());

    expect(charge.eur).not.toBeCloseTo(5.65, 2);
    expect(charge.eur).not.toBeCloseTo(5.27, 2);
  });

  it('la tasa devuelta es la media ponderada, para que kWh x tasa cuadre con el importe', () => {
    // La UI pinta "consumo x tasa = importe": con cualquier otra tasa el desglose mentiria.
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 300, dataset, segs());

    expect(300 * charge.rate).toBeCloseTo(5.393, 9);
    expect(charge.rate).toBeGreaterThan(0.01755);
    expect(charge.rate).toBeLessThan(0.01883);
  });

  it('reparte por dias cuando los tramos no traen su consumo', () => {
    // Metadata guardada antes de que el tramo llevase kWh: el reparto por dias es la mejor
    // aproximacion disponible y evita volver al sesgo de una sola clave.
    const sinKwh = [{ key: '2025-09', days: 20 }, { key: '2026-09', days: 10 }];
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 300, dataset, sinKwh);

    expect(charge.eur).toBeCloseTo(5.39, 10);
  });

  it('respeta el peso real del consumo aunque los dias digan otra cosa', () => {
    // Mismos dias, consumos muy distintos: manda el consumo.
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 300, dataset, [
      { key: '2025-09', days: 15, kwh: 290 },
      { key: '2026-09', days: 15, kwh: 10 }
    ]);

    expect(charge.eur).toBeCloseTo(5.28, 2);
  });

  it('falla CERRADO si a un tramo le falta la tasa, sin valorarlo con la del otro', () => {
    const datasetCorto = { latest_complete_month: null, latest_value: null, values: { '2025-09': 0.01755 } };
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 300, datasetCorto, segs());

    expect(charge.aplica).toBe(true);
    expect(charge.available).toBe(false);
    expect(charge.eur).toBeNull();
    expect(charge.requestedMonth).toBe('2026-09');
  });

  it('no aplica nada a una tarifa que ya incluye los servicios de ajuste', () => {
    const charge = window.LF.ssaa.calcChargeForSegments({ incluyeServiciosAjuste: true }, 300, dataset, segs());

    expect(charge.aplica).toBe(false);
    expect(charge.eur).toBe(0);
  });

  it('con un solo tramo se comporta exactamente como el calculo de un mes normal', () => {
    const unTramo = window.LF.ssaa.calcChargeForSegments(tarifa, 300, dataset, [{ key: '2025-09', days: 30, kwh: 300 }]);
    const normal = window.LF.ssaa.calcCharge(tarifa, 300, dataset, '2025-09');

    expect(unTramo).toEqual(normal);
  });

  it('consumo cero no inventa coste ni oculta los meses de origen', () => {
    const charge = window.LF.ssaa.calcChargeForSegments(tarifa, 0, dataset, segs());

    expect(charge.eur).toBe(0);
    expect(charge.available).toBe(true);
  });
});
