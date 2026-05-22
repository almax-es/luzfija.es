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

  it('buildCnmcHourIndexMap asigna hora 25 a la segunda ocurrencia en cambio horario de otoño', () => {
    // Oct 27 2024: clocks go back at 03:00 CEST → 02:00 CET; 25-hour day
    // UTC Oct 26 22:00 = local Oct 27 00:00 CEST (+2)
    const dstHours = Array.from({ length: 25 }, (_, i) => {
      const ts = Math.floor(Date.UTC(2024, 9, 26, 22 + i, 0, 0) / 1000);
      return [ts, 0.05];
    });
    const map = window.LF.surplusPrices.buildCnmcHourIndexMap(dstHours, 'Europe/Madrid');
    // First 02:00 (CEST) → cnmcHour 3 → array index 2
    expect(map.get(3)).toBe(2);
    // Second 02:00 (CET) → cnmcHour 25 → array index 3
    expect(map.get(25)).toBe(3);
    // 03:00 CET → cnmcHour 4 → array index 4
    expect(map.get(4)).toBe(4);
    expect(map.size).toBe(25);
  });

  it('contabiliza missing cuando el mes no tiene datos disponibles', async () => {
    global.fetch.mockResolvedValue({ ok: false });
    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 }
    ], { geo: '8741' });
    expect(stats.totalKwh).toBe(0);
    expect(stats.totalEur).toBe(0);
    expect(stats.missing).toBe(1);
    expect(stats.monthlyRows[0].missing).toBe(1);
  });

  it('contabiliza missing parcial cuando solo algunas fechas tienen datos', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, 0.10];
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        timezone: 'Europe/Madrid',
        days: { '2025-01-01': hours }
        // '2025-01-02' ausente → missing
      })
    });
    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      { fecha: new Date(2025, 0, 2), hora: 11, excedente: 3 }
    ], { geo: '8741' });
    expect(stats.totalKwh).toBe(2);
    expect(stats.totalEur).toBeCloseTo(0.20, 8);
    expect(stats.missing).toBe(1);
    expect(stats.monthlyRows[0].missing).toBe(1);
  });

  it('calcula eur negativo en monthlyRows cuando los precios son negativos (el caller aplica Math.max)', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, -0.05];
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ timezone: 'Europe/Madrid', days: { '2025-01-01': hours } })
    });
    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 }
    ], { geo: '8741' });
    expect(stats.totalEur).toBeCloseTo(-0.10, 8);
    expect(stats.monthlyRows[0].eur).toBeCloseTo(-0.10, 8);
    // applyMonthlyIndexedValues inyecta el eur negativo tal cual; bv-sim-monthly aplica Math.max(0, eur)
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2025-01', exportTotalKWh: 2 }],
      stats
    );
    expect(mapped[0].indexedSurplusEur).toBeCloseTo(-0.10, 8);
    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-base');
  });
});
