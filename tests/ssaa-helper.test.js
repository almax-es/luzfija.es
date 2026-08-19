import { describe, expect, it } from 'vitest';

import '../js/lf-csv-utils.js';
import '../js/lf-ssaa.js';

describe('LF SSAA helper', () => {
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
        json: async () => ({
          latest_complete_month: '2026-06',
          latest_value: 0.02,
          values: { '2026-06': 0.02 }
        })
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
