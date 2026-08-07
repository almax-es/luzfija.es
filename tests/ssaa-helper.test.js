import { describe, expect, it } from 'vitest';

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

    expect(charge).toEqual({
      aplica: true,
      rate: 0.02357,
      eur: 2.36,
      month: '2026-04'
    });
  });

  it('does not apply to PVPC or tariffs that already include SSAA', () => {
    expect(window.LF.ssaa.mustApply({ incluyeServiciosAjuste: false, esPVPC: true })).toBe(false);
    expect(window.LF.ssaa.mustApply({ incluyeServiciosAjuste: true })).toBe(false);
    expect(window.LF.ssaa.mustApply({})).toBe(false);
  });
});
