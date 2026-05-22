import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../js/lf-surplus-prices.js';

describe('LF surplus hourly prices', () => {
  beforeEach(() => {
    window.LF.surplusPrices._clearCaches();
    global.fetch = vi.fn();
  });

  it('calcula compensación horaria y media mensual desde data/surplus', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, h === 10 ? 0.08 : h === 11 ? 0.10 : 0.01];
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        timezone: 'Europe/Madrid',
        days: {
          '2025-01-01': hours
        }
      })
    });

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      { fecha: new Date(2025, 0, 1), hora: 12, excedente: 3 }
    ], { geo: '8741' });

    expect(global.fetch).toHaveBeenCalledWith('/data/surplus/8741/2025-01.json');
    expect(stats.totalKwh).toBe(5);
    expect(stats.totalEur).toBeCloseTo(0.46, 8);
    expect(stats.avgPrice).toBeCloseTo(0.092, 8);
    expect(stats.monthlyRows[0]).toMatchObject({
      ym: '2025-01',
      kwh: 5
    });
    expect(stats.monthlyRows[0].eur).toBeCloseTo(0.46, 8);
  });

  it('inyecta crédito indexado mensual en meses agregados sin tocar otros meses', () => {
    const months = [
      { key: '2025-01', exportTotalKWh: 5 },
      { key: '2025-02', exportTotalKWh: 7 }
    ];

    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(months, {
      monthlyRows: [
        { ym: '2025-01', kwh: 5, eur: 0.46, avg: 0.092, missing: 0 }
      ]
    });

    expect(mapped[0]).toMatchObject({
      key: '2025-01',
      indexedSurplusEur: 0.46,
      indexedAvgPrice: 0.092,
      indexedSurplusSource: 'hourly-index-base'
    });
    expect(mapped[1]).toEqual(months[1]);
  });

  it('mapea zonas fiscales del simulador a geos de excedentes', () => {
    expect(window.LF.surplusPrices.getSurplusGeoCandidates('Península')).toEqual(['8741']);
    expect(window.LF.surplusPrices.getSurplusGeoCandidates('Canarias')).toEqual(['8742']);
    expect(window.LF.surplusPrices.getSurplusGeoCandidates('CeutaMelilla')).toEqual(['8744', '8745']);
  });
});
