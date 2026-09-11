import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../js/lf-csv-utils.js';
import '../js/lf-config.js';
import '../js/lf-surplus-prices.js';

function buildFullCivilDay(ymd, timeZone = 'Europe/Madrid', priceForHour = () => 0.1) {
  const [y, m, d] = ymd.split('-').map(Number);
  const startGuessUtc = Date.UTC(y, m - 1, d) / 1000;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const ymdOf = (ts) => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  let start = null;
  for (let shift = -14 * 3600; shift <= 14 * 3600; shift += 3600) {
    const candidate = startGuessUtc + shift;
    if (ymdOf(candidate) === ymd && ymdOf(candidate - 3600) !== ymd) { start = candidate; break; }
  }
  if (start === null) throw new Error(`No se pudo anclar ${ymd}`);
  const points = [];
  for (let ts = start, hour = 0; ymdOf(ts) === ymd; ts += 3600, hour += 1) points.push([ts, priceForHour(hour)]);
  return points;
}

function buildV2Month(ym, timeZone = 'Europe/Madrid', overrides = {}) {
  const [year, month] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = {};
  for (let day = 1; day <= last; day += 1) {
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    days[date] = buildFullCivilDay(date, timeZone);
  }
  Object.assign(days, overrides);
  return { schema_version: 2, timezone: timeZone, from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days };
}

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
      json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': hours })
    });

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      { fecha: new Date(2025, 0, 1), hora: 12, excedente: 3 }
    ], { geo: '8741' });

    expect(global.fetch.mock.calls[0][0]).toBe('/data/surplus/8741/2025-01.json');
    expect(stats.totalKwh).toBe(5);
    expect(stats.totalEur).toBeCloseTo(0.46, 8);
    expect(stats.avgPrice).toBeCloseTo(0.092, 8);
    expect(stats.monthlyRows[0]).toMatchObject({
      ym: '2025-01',
      kwh: 5
    });
    expect(stats.monthlyRows[0].eur).toBeCloseTo(0.46, 8);
  });

  it('redondea el crédito monetario mensual indexado en una frontera .005 sin alterar la media cruda', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => buildV2Month('2025-01', 'Europe/Madrid', {
        '2025-01-01': buildFullCivilDay('2025-01-01', 'Europe/Madrid', () => 0.09)
      })
    });

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 26.5 }
    ], { geo: '8741' });

    expect(stats.totalEur).toBe(2.39);
    expect(stats.avgPrice).toBeCloseTo(0.09, 12);
    expect(stats.monthlyRows[0].eur).toBe(2.39);
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

  it('buildCnmcHourIndexMap usa la hora 1 repetida de Canarias para la clave 25', () => {
    const dstHours = Array.from({ length: 25 }, (_, i) => {
      const ts = Math.floor(Date.UTC(2024, 9, 26, 23 + i, 0, 0) / 1000);
      return [ts, 0.05];
    });

    const map = window.LF.surplusPrices.buildCnmcHourIndexMap(dstHours, 'Atlantic/Canary');

    expect(map.get(2)).toBe(1);
    expect(map.get(25)).toBe(2);
    expect(map.get(3)).toBe(3);
    expect(map.size).toBe(25);
  });

  it.each([
    {
      zona: 'Península',
      geo: '8741',
      timezone: 'Europe/Madrid',
      baseUtc: Date.UTC(2026, 2, 28, 23, 0, 0)
    },
    {
      zona: 'Canarias',
      geo: '8742',
      timezone: 'Atlantic/Canary',
      baseUtc: Date.UTC(2026, 2, 29, 0, 0, 0)
    }
  ])('valora las 23 horas del CCH-CONS de marzo sin huecos en $zona', async ({ zona, geo, timezone, baseUtc }) => {
    const dayHours = Array.from({ length: 23 }, (_, index) => [
      Math.floor((baseUtc + index * 3600000) / 1000),
      (index + 1) / 100
    ]);
    const rows = [
      ['Fecha', 'Hora', 'AE_kWh', 'AS_kWh'],
      ...Array.from({ length: 23 }, (_, index) => [
        '29/03/2026',
        String(index + 1),
        '0',
        '1'
      ])
    ];
    const parsed = window.LF.csvUtils.parseEnergyTableRows(rows, {
      headerRowIndex: 0,
      zonaFiscal: zona
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => buildV2Month('2026-03', timezone, { '2026-03-29': dayHours })
    });

    const stats = await window.LF.surplusPrices.computeHourlyCompensation(parsed.records, { geo });

    expect(stats.totalKwh).toBe(23);
    expect(stats.totalEur).toBeCloseTo(2.76, 8);
    expect(stats.missing).toBe(0);
  });

  it('_clearCaches invalida también el índice horario aunque el array clave siga referenciado', () => {
    const hours = Array.from({ length: 24 }, (_, h) => [
      Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000),
      0.05
    ]);
    const first = window.LF.surplusPrices.buildCnmcHourIndexMap(hours, 'Europe/Madrid');

    window.LF.surplusPrices._clearCaches();

    const second = window.LF.surplusPrices.buildCnmcHourIndexMap(hours, 'Europe/Madrid');
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
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

  it('no usa un mes totalmente sin cobertura como mejor/peor precio mensual', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, 0.10];
    });
    global.fetch.mockImplementation(async (url) => (
      String(url).endsWith('/2025-01.json')
        ? { ok: true, json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': hours }) }
        : { ok: false, status: 404 }
    ));

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      { fecha: new Date(2025, 1, 2), hora: 11, excedente: 3 }
    ], { geo: '8741' });

    expect(stats.monthlyRows[1]).toMatchObject({ ym: '2025-02', pricedHours: 0, missing: 1, avg: null });
    expect(stats.best?.ym).toBe('2025-01');
    expect(stats.worst?.ym).toBe('2025-01');
  });

  it('contabiliza missing parcial cuando solo algunas fechas tienen datos', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, 0.10];
    });
    global.fetch.mockImplementation(async (url) => (
      String(url).endsWith('/2025-01.json')
        ? { ok: true, json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': hours }) }
        : { ok: false, status: 404 }
    ));
    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      { fecha: new Date(2025, 1, 2), hora: 11, excedente: 3 }
    ], { geo: '8741' });
    expect(stats.totalKwh).toBe(2);
    expect(stats.inputKwh).toBe(5);
    expect(stats.totalEur).toBeCloseTo(0.20, 8);
    expect(stats.missing).toBe(1);
    expect(stats.missingKwh).toBe(3);
    expect(stats.monthlyRows[1].missing).toBe(1);
    expect(stats.monthlyRows[1].missingKwh).toBe(3);
    expect(stats.monthlyRows[1].inputKwh).toBe(3);
    expect(stats.monthlyRows[1].missingShare).toBe(1);
    expect(stats.monthlyRows[1].missingKwhShare).toBe(1);
  });

  it('rechaza crédito horario indexado si falta demasiada cobertura mensual', async () => {
    const months = [
      { key: '2025-01', exportTotalKWh: 5 }
    ];

    const stats = {
      partialCoverageRejected: false,
      monthlyRows: [
        { ym: '2025-01', kwh: 2, eur: 0.20, avg: 0.10, missing: 1, pricedHours: 1, missingShare: 0.5 }
      ]
    };

    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(months, stats);

    expect(stats.partialCoverageRejected).toBe(true);
    expect(mapped[0]).toMatchObject({
      key: '2025-01',
      indexedMissingHours: 1,
      indexedMissingKwh: 0,
      indexedPricedHours: 1,
      indexedSurplusWarning: 'partial-coverage-rejected',
      indexedSurplusSource: 'hourly-index-partial-rejected'
    });
    expect(mapped[0].indexedSurplusEur).toBeUndefined();
  });

  it('mantiene crédito horario indexado con missing residual dentro del umbral', () => {
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2025-01', exportTotalKWh: 50 }],
      {
        monthlyRows: [
          { ym: '2025-01', kwh: 48, eur: 4.8, avg: 0.10, missing: 1, pricedHours: 19, missingShare: 0.05 }
        ]
      }
    );

    expect(mapped[0]).toMatchObject({
      indexedSurplusEur: 4.8,
      indexedMissingHours: 1,
      indexedMissingKwh: 0,
      indexedPricedHours: 19,
      indexedSurplusWarning: 'partial',
      indexedSurplusSource: 'hourly-index-base'
    });
  });

  it('mantiene crédito horario indexado en el borde exacto del umbral de cobertura', () => {
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2025-01', exportTotalKWh: 20 }],
      {
        monthlyRows: [
          {
            ym: '2025-01',
            kwh: 18,
            eur: 1.8,
            avg: 0.10,
            missing: 2,
            missingKwh: 2,
            pricedHours: 18,
            missingShare: 0.10,
            missingKwhShare: 0.10
          }
        ]
      }
    );

    expect(mapped[0]).toMatchObject({
      indexedSurplusEur: 1.8,
      indexedMissingHours: 2,
      indexedMissingKwh: 2,
      indexedSurplusWarning: 'partial',
      indexedSurplusSource: 'hourly-index-base'
    });
  });

  it('rechaza crédito horario indexado si pocas horas missing concentran demasiados kWh', () => {
    const stats = {
      partialCoverageRejected: false,
      monthlyRows: [
        {
          ym: '2025-01',
          kwh: 4,
          eur: 0.4,
          avg: 0.10,
          missing: 1,
          missingKwh: 20,
          pricedHours: 19,
          missingShare: 0.05,
          missingKwhShare: 20 / 24
        }
      ]
    };

    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2025-01', exportTotalKWh: 24 }],
      stats
    );

    expect(stats.partialCoverageRejected).toBe(true);
    expect(mapped[0]).toMatchObject({
      indexedMissingHours: 1,
      indexedMissingKwh: 20,
      indexedSurplusWarning: 'partial-coverage-rejected',
      indexedSurplusSource: 'hourly-index-partial-rejected'
    });
    expect(mapped[0].indexedSurplusEur).toBeUndefined();
  });

  it('aplica la cobertura por mes: un mes bueno no cae por otro rechazado', () => {
    const stats = {
      partialCoverageRejected: false,
      monthlyRows: [
        { ym: '2025-01', kwh: 10, eur: 1.00, avg: 0.10, missing: 0, pricedHours: 10, missingShare: 0 },
        { ym: '2025-02', kwh: 2, eur: 0.20, avg: 0.10, missing: 8, pricedHours: 2, missingShare: 0.8 }
      ]
    };

    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([
      { key: '2025-01', exportTotalKWh: 10 },
      { key: '2025-02', exportTotalKWh: 10 }
    ], stats);

    expect(stats.partialCoverageRejected).toBe(true);
    expect(stats.partialCoverageRejectedMonths).toBe(1);
    expect(stats.partialCoverageTotalMonths).toBe(2);
    expect(mapped[0]).toMatchObject({
      indexedSurplusEur: 1,
      indexedSurplusSource: 'hourly-index-base'
    });
    expect(mapped[1]).toMatchObject({
      indexedSurplusSource: 'hourly-index-partial-rejected',
      indexedSurplusWarning: 'partial-coverage-rejected'
    });
    expect(mapped[1].indexedSurplusEur).toBeUndefined();
  });

  it('marca rechazo en escenario mixto cuando un mes no tiene ningún precio horario', () => {
    const stats = {
      partialCoverageRejected: false,
      monthlyRows: [
        { ym: '2025-01', kwh: 10, eur: 1.00, avg: 0.10, missing: 0, pricedHours: 10, missingShare: 0 },
        { ym: '2025-02', kwh: 0, eur: 0, avg: 0, missing: 8, pricedHours: 0, missingShare: 1 }
      ]
    };

    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([
      { key: '2025-01', exportTotalKWh: 10 },
      { key: '2025-02', exportTotalKWh: 8 }
    ], stats);

    expect(stats.partialCoverageRejected).toBe(true);
    expect(stats.partialCoverageRejectedMonths).toBe(1);
    expect(stats.partialCoverageTotalMonths).toBe(2);
    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-base');
    expect(mapped[1]).toMatchObject({
      indexedMissingHours: 8,
      indexedPricedHours: 0,
      indexedSurplusWarning: 'partial-coverage-rejected',
      indexedSurplusSource: 'hourly-index-partial-rejected'
    });
    expect(mapped[1].indexedSurplusEur).toBeUndefined();
  });


  it('reintenta un mes de excedentes tras un fallo HTTP transitorio en vez de cachear null', async () => {
    // Dia civil COMPLETO en Europe/Madrid (24 puntos desde 00:00 local): un unico punto
    // horario ya no pasa el validador compartido de cobertura (bloqueante 2, 12/08/2026).
    const fullDay = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, 0.07];
    });
    let attempts = 0;
    global.fetch.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': fullDay })
      };
    });

    const first = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 1, excedente: 1 }
    ], { geo: '8741' });
    expect(first.pricedHours).toBe(0);

    const second = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 1, excedente: 1 }
    ], { geo: '8741' });
    expect(attempts).toBe(2);
    expect(second.pricedHours).toBe(1);
  });

  it('reintenta un HTTP 200 malformado de excedentes en vez de cachearlo', async () => {
    // Dia civil COMPLETO en Europe/Madrid para el segundo intento (el primero sigue
    // siendo invalido por si solo: la fecha declarada no pertenece al mes pedido).
    const fullDay = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, 0.07];
    });
    let attempts = 0;
    global.fetch.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) return { ok: true, json: async () => ({ days: { '2025-02-01': [[1738364400, 0.07]] } }) };
      return {
        ok: true,
        json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': fullDay })
      };
    });

    const record = [{ fecha: new Date(2025, 0, 1), hora: 1, excedente: 1 }];
    const first = await window.LF.surplusPrices.computeHourlyCompensation(record, { geo: '8741' });
    const second = await window.LF.surplusPrices.computeHourlyCompensation(record, { geo: '8741' });

    expect(first.pricedHours).toBe(0);
    expect(attempts).toBe(2);
    expect(second.pricedHours).toBe(1);
  });

  it('rechaza y reintenta un 200 completo de excedentes con identidad explicitamente contradictoria', async () => {
    let attempts = 0;
    global.fetch.mockImplementation(async () => {
      attempts += 1;
      const month = buildV2Month('2025-01', 'Europe/Madrid');
      Object.assign(month, {
        geo_id: 8741,
        indicator: attempts === 1 ? 1001 : 1739,
        unit: 'EUR/kWh',
        epoch_unit: 's'
      });
      return { ok: true, json: async () => month };
    });

    const record = [{ fecha: new Date(2025, 0, 1), hora: 1, excedente: 1 }];
    const first = await window.LF.surplusPrices.computeHourlyCompensation(record, { geo: '8741' });
    const second = await window.LF.surplusPrices.computeHourlyCompensation(record, { geo: '8741' });

    expect(first.pricedHours).toBe(0);
    expect(attempts).toBe(2);
    expect(second.pricedHours).toBe(1);
  });

  it('calcula eur negativo en monthlyRows cuando los precios son negativos (el caller aplica Math.max)', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, -0.05];
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': hours })
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

  // Reproduccion exacta del hallazgo de Codex (bloqueante 2, 12/08/2026): un mes de
  // excedentes HTTP 200 con un dia HISTORICO (no "hoy") muy incompleto no puede tratarse
  // como sano. Antes solo se comprobaba "cada fila es un par numerico".
  it('rechaza el mes de excedentes si un día histórico llega con muchas horas ausentes', async () => {
    const fullDay = Array.from({ length: 24 }, (_, h) => {
      const ts = Math.floor(Date.UTC(2024, 11, 31, 23 + h, 0, 0) / 1000);
      return [ts, 0.07];
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => buildV2Month('2025-01', 'Europe/Madrid', { '2025-01-01': fullDay.slice(0, 10) })
    });

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 1, excedente: 1 }
    ], { geo: '8741' });

    expect(stats.pricedHours).toBe(0);
    expect(stats.missing).toBeGreaterThan(0);
  });
});

// ===== MES COMPUESTO POR DOS TRAMOS =====
// Un historico de 365 dias que empieza a mitad de mes parte un mes natural en dos trozos de
// años distintos, y la simulacion los cose en una sola fila. La traza horaria, en cambio, sigue
// agregando por año+mes reales: si el emparejamiento usa una sola clave, la fila declara el
// consumo y los dias de los dos tramos y cobra la compensacion de uno, sin aviso.
describe('applyMonthlyIndexedValues - mes compuesto por dos tramos', () => {
  const mes = (over = {}) => Object.assign({
    key: '2026-09',
    daysWithData: 30,
    daysInMonth: 30,
    exportTotalKWh: 300,
    sourceKeys: ['2025-09', '2026-09']
  }, over);

  const filaTramo = (ym, over = {}) => Object.assign({
    ym, kwh: 0, eur: 0, avg: 0, missing: 0, missingKwh: 0, pricedHours: 0, missingShare: 0, missingKwhShare: 0
  }, over);

  it('suma los euros y los kWh de los dos tramos de origen', () => {
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([mes()], {
      monthlyRows: [
        filaTramo('2025-09', { kwh: 200, eur: 20, avg: 0.10, pricedHours: 400 }),
        filaTramo('2026-09', { kwh: 100, eur: 5, avg: 0.05, pricedHours: 200 })
      ]
    });

    expect(mapped[0].indexedSurplusEur).toBeCloseTo(25, 10);
    expect(mapped[0].indexedPricedHours).toBe(600);
    // Precio medio ponderado por kWh, no media de los dos precios medios (que daria 0,075).
    expect(mapped[0].indexedAvgPrice).toBeCloseTo(25 / 300, 10);
    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-base');
    expect(mapped[0].indexedSurplusWarning).toBe('');
  });

  it('NO se queda con la fila de una sola clave cuando el mes tiene dos tramos', () => {
    // Test de regresion del fallo silencioso: con el emparejamiento por month.key a secas,
    // el mes cobraria solo los 5 € del tramo reciente de 10 dias.
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([mes()], {
      monthlyRows: [
        filaTramo('2025-09', { kwh: 200, eur: 20, avg: 0.10, pricedHours: 400 }),
        filaTramo('2026-09', { kwh: 100, eur: 5, avg: 0.05, pricedHours: 200 })
      ]
    });

    expect(mapped[0].indexedSurplusEur).not.toBeCloseTo(5, 10);
    expect(mapped[0].indexedSurplusEur).not.toBeCloseTo(20, 10);
  });

  it('trata un tramo sin excedentes como cero y conserva la valoracion del otro', () => {
    // computeHourlyCompensation crea fila para todo mes con algun excedente, valorado o
    // marcado como hueco: si una clave no aparece es que ese tramo no vertio nada.
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([mes()], {
      monthlyRows: [filaTramo('2025-09', { kwh: 200, eur: 20, avg: 0.10, pricedHours: 400 })]
    });

    expect(mapped[0].indexedSurplusEur).toBeCloseTo(20, 10);
    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-base');
  });

  it('decide el rechazo por cobertura sobre los totales sumados, no tramo a tramo', () => {
    // El tramo viejo esta limpio y el reciente tiene el 50 % de huecos. Sumados, los huecos
    // quedan en el 9,1 % de las horas, por debajo del umbral: el mes se conserva.
    const stats = {
      monthlyRows: [
        filaTramo('2025-09', { kwh: 200, eur: 20, avg: 0.10, pricedHours: 400 }),
        filaTramo('2026-09', { kwh: 10, eur: 1, avg: 0.10, missing: 40, missingKwh: 5, pricedHours: 40, missingShare: 0.5, missingKwhShare: 0.33 })
      ]
    };
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([mes()], stats);

    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-base');
    expect(mapped[0].indexedSurplusWarning).toBe('partial');
    expect(mapped[0].indexedMissingHours).toBe(40);
    expect(stats.partialCoverageRejected).toBe(false);
  });

  it('rechaza el mes compuesto cuando los huecos sumados pasan del umbral', () => {
    const stats = {
      monthlyRows: [
        filaTramo('2025-09', { kwh: 100, eur: 10, avg: 0.10, missing: 30, missingKwh: 30, pricedHours: 100 }),
        filaTramo('2026-09', { kwh: 50, eur: 5, avg: 0.10, missing: 20, missingKwh: 20, pricedHours: 50 })
      ]
    };
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([mes()], stats);

    expect(mapped[0].indexedSurplusEur).toBeUndefined();
    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-partial-rejected');
    expect(stats.partialCoverageRejected).toBe(true);
  });

  it('un mes de un solo tramo sigue emparejando por su propia clave', () => {
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [mes({ sourceKeys: undefined })],
      { monthlyRows: [filaTramo('2026-09', { kwh: 100, eur: 5, avg: 0.05, pricedHours: 200 })] }
    );

    expect(mapped[0].indexedSurplusEur).toBeCloseTo(5, 10);
  });
});

// La premisa de la que depende tratar un tramo sin fila como cero: computeHourlyCompensation
// distingue "este mes no vertio nada" (no hay fila) de "este mes vertio y no se pudo valorar"
// (hay fila con huecos). Si un dia algo de esto cambia, el mes compuesto empezaria a dar por
// cero un tramo que en realidad no tiene precios, y el test de arriba dejaria de proteger.
describe('computeHourlyCompensation - ausencia de fila frente a hueco de precios', () => {
  beforeEach(() => {
    window.LF.surplusPrices._clearCaches();
    global.fetch = vi.fn();
  });

  it('un mes sin ningun excedente no genera fila mensual', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => buildV2Month('2025-01', 'Europe/Madrid')
    });

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      // Febrero aparece en la curva pero sin verter nada: no debe pedir su fichero de precios
      // ni aparecer en monthlyRows.
      { fecha: new Date(2025, 1, 1), hora: 11, excedente: 0 }
    ], { geo: '8741' });

    expect(stats.monthlyRows.map((row) => row.ym)).toEqual(['2025-01']);
    expect(global.fetch.mock.calls.map((call) => call[0])).toEqual(['/data/surplus/8741/2025-01.json']);
  });

  it('un mes que vierte sin precios disponibles SI genera fila, marcada como hueco', async () => {
    global.fetch.mockImplementation(async (url) => (String(url).includes('2025-02')
      ? { ok: false, status: 404 }
      : { ok: true, json: async () => buildV2Month('2025-01', 'Europe/Madrid') }));

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 0, 1), hora: 11, excedente: 2 },
      { fecha: new Date(2025, 1, 1), hora: 11, excedente: 3 }
    ], { geo: '8741' });

    const febrero = stats.monthlyRows.find((row) => row.ym === '2025-02');
    expect(febrero).toBeDefined();
    expect(febrero.kwh).toBe(0);
    expect(febrero.missing).toBe(1);
    expect(febrero.missingKwh).toBe(3);
  });

  it('el mes compuesto rechaza el indexado si un tramo vertio sin precios, en vez de darlo por cero', async () => {
    // Caminos opuestos con la misma forma aparente: aqui el tramo reciente SI tiene fila (con
    // hueco), asi que el mes no puede tratarse como si ese tramo no hubiese vertido.
    global.fetch.mockImplementation(async (url) => (String(url).includes('2026-09')
      ? { ok: false, status: 404 }
      : { ok: true, json: async () => buildV2Month('2025-09', 'Europe/Madrid') }));

    const stats = await window.LF.surplusPrices.computeHourlyCompensation([
      { fecha: new Date(2025, 8, 11), hora: 12, excedente: 1 },
      { fecha: new Date(2026, 8, 1), hora: 12, excedente: 40 }
    ], { geo: '8741' });

    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues([{
      key: '2026-09',
      daysWithData: 30,
      daysInMonth: 30,
      exportTotalKWh: 41,
      sourceKeys: ['2025-09', '2026-09']
    }], stats);

    expect(mapped[0].indexedSurplusEur).toBeUndefined();
    expect(mapped[0].indexedSurplusSource).toBe('hourly-index-partial-rejected');
    expect(mapped[0].indexedMissingKwh).toBe(40);
  });
});

describe('applyMonthlyIndexedValues - procedencia de los tramos', () => {
  // Defensa en profundidad. La validacion principal vive en normalizeMonthMeta, pero esta suma
  // es el consumidor con mas que perder: un tramo ajeno traeria la compensacion de otro mes,
  // que ademas seguiria cobrandola por su cuenta.
  const filas = {
    monthlyRows: [
      { ym: '2025-09', kwh: 200, eur: 20, avg: 0.1, missing: 0, missingKwh: 0, pricedHours: 100, missingShare: 0, missingKwhShare: 0 },
      { ym: '2026-09', kwh: 100, eur: 5, avg: 0.05, missing: 0, missingKwh: 0, pricedHours: 100, missingShare: 0, missingKwhShare: 0 },
      { ym: '2026-07', kwh: 300, eur: 40, avg: 0.13, missing: 0, missingKwh: 0, pricedHours: 100, missingShare: 0, missingKwhShare: 0 }
    ]
  };

  it('ignora claves de origen de otro mes natural en vez de sumarlas', () => {
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2026-09', exportTotalKWh: 300, sourceKeys: ['2025-09', '2026-09', '2026-07'] }],
      filas
    );

    // 65 € seria la suma con el tramo inyectado; 5 € es la fila propia del mes.
    expect(mapped[0].indexedSurplusEur).not.toBeCloseTo(65, 2);
    expect(mapped[0].indexedSurplusEur).toBeCloseTo(5, 10);
  });

  it('ignora DOS claves cuando una es de otro mes natural, no solo cuando sobran', () => {
    // Sin este caso el guard quedaba cubierto solo por el numero de tramos: una metadata con
    // exactamente dos claves, una ajena, se colaba igual.
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2026-09', exportTotalKWh: 300, sourceKeys: ['2026-07', '2026-09'] }],
      filas
    );

    expect(mapped[0].indexedSurplusEur).not.toBeCloseTo(45, 2);
    expect(mapped[0].indexedSurplusEur).toBeCloseTo(5, 10);
  });

  it('sigue sumando los dos tramos legitimos del mismo mes natural', () => {
    const mapped = window.LF.surplusPrices.applyMonthlyIndexedValues(
      [{ key: '2026-09', exportTotalKWh: 300, sourceKeys: ['2025-09', '2026-09'] }],
      filas
    );

    expect(mapped[0].indexedSurplusEur).toBeCloseTo(25, 10);
  });
});
