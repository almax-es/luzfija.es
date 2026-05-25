import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const uiCode = fs.readFileSync(path.resolve(__dirname, '../js/bv/bv-ui.js'), 'utf8');
const loadBvUi = new Function('window', uiCode);

describe('BV UI manual month helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.BVSim = {};
    loadBvUi(window);
    window.BVSim._hourlyTraceState = {
      records: null,
      zonaFiscal: null,
      dirty: false,
      reason: '',
      stats: null
    };
    window.BVSim._hourlyTraceControls = window.BVSim.manualUi.createHourlyTraceControls(
      window.BVSim._hourlyTraceState,
      (value) => String(value || '')
    );
  });

  it('pickLatestMonthData conserva el mes más reciente y su metadata real', () => {
    const { monthDataMap, yearsFound } = window.BVSim.manualUi.pickLatestMonthData([
      {
        key: '2024-01',
        daysWithData: 31,
        daysInMonth: 31,
        importByPeriod: { P1: 1, P2: 2, P3: 3 },
        exportTotalKWh: 4
      },
      {
        key: '2025-01',
        daysWithData: 10,
        daysInMonth: 31,
        importByPeriod: { P1: 12, P2: 8, P3: 5 },
        exportTotalKWh: 3
      }
    ]);

    expect(Array.from(yearsFound).sort()).toEqual([2024, 2025]);
    expect(monthDataMap.get(0)).toEqual({
      year: 2025,
      p1: 12,
      p2: 8,
      p3: 5,
      vert: 3,
      meta: {
        key: '2025-01',
        daysWithData: 10,
        daysInMonth: 31
      }
    });
  });

  it('buildSimulationMonths conserva key y daysWithData importados al simular desde la tabla manual', () => {
    const months = window.BVSim.manualUi.buildSimulationMonths([
      { p1: 12, p2: 8, p3: 5, vert: 3 }
    ], {
      currentYear: 2026,
      monthMetaByIndex: {
        0: { key: '2025-01', daysWithData: 10, daysInMonth: 31 }
      }
    });

    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({
      key: '2025-01',
      daysWithData: 10,
      daysInMonth: 31,
      importTotalKWh: 25,
      exportTotalKWh: 3,
      importByPeriod: { P1: 12, P2: 8, P3: 5 }
    });
  });

  it('buildSimulationMonths usa año actual y mes completo cuando no existe metadata CSV', () => {
    const months = window.BVSim.manualUi.buildSimulationMonths([
      { p1: 12, p2: 8, p3: 5, vert: 3 }
    ], {
      currentYear: 2026
    });

    expect(months).toHaveLength(1);
    expect(months[0].key).toBe('2026-01');
    expect(months[0].daysWithData).toBe(31);
    expect(months[0].daysInMonth).toBe(31);
  });

  it('rotateMonthsByStart rota un ciclo anual desde el mes elegido sin mutar el original', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      key: `2026-${String(i + 1).padStart(2, '0')}`
    }));

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-05');

    expect(rotated.map((month) => month.key)).toEqual([
      '2026-05', '2026-06', '2026-07', '2026-08',
      '2026-09', '2026-10', '2026-11', '2026-12',
      '2026-01', '2026-02', '2026-03', '2026-04'
    ]);
    expect(months[0].key).toBe('2026-01');
    expect(rotated).not.toBe(months);
    expect(rotated[0]).toBe(months[4]);
  });

  it('rotateMonthsByStart funciona con periodos parciales', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
      .map((key) => ({ key }));

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-08');

    expect(rotated.map((month) => month.key)).toEqual([
      '2026-08', '2026-09', '2026-10', '2026-05', '2026-06', '2026-07'
    ]);
  });

  it('rotateMonthsByStart no cambia el orden si el mes no existe o no se elige', () => {
    const months = [{ key: '2026-03' }, { key: '2026-04' }];

    expect(window.BVSim.manualUi.rotateMonthsByStart(months, '').map((month) => month.key))
      .toEqual(['2026-03', '2026-04']);
    expect(window.BVSim.manualUi.rotateMonthsByStart(months, '2026-08').map((month) => month.key))
      .toEqual(['2026-03', '2026-04']);
  });

  it('rotateMonthsByStart conserva los datos enriquecidos de cada mes', () => {
    const months = [
      { key: '2026-01', indexedSurplusEur: 1.23 },
      { key: '2026-02', indexedSurplusEur: 4.56 }
    ];

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-02');

    expect(rotated[0]).toMatchObject({
      key: '2026-02',
      indexedSurplusEur: 4.56
    });
    expect(rotated[0]).toBe(months[1]);
  });

  it('setHourlyTraceFromImport limpia el trace cuando meta.hasExcedenteColumn es false', () => {
    const { setFromImport, canUse, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 3 }],
      meta: { hasExcedenteColumn: false }
    }, 'Península');

    expect(window.BVSim._hourlyTraceState.records).toBeNull();
    expect(window.BVSim._hourlyTraceState.reason).toBe('no-hourly-surplus-column');
    expect(canUse('Península')).toBe(false);
    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('no tiene columna de excedentes');
  });

  it('invalidateHourlyTrace no pisa el motivo no-hourly-surplus-column cuando no hay records', () => {
    const { setFromImport, invalidate } = window.BVSim._hourlyTraceControls;

    setFromImport({ ok: true, records: [], meta: { hasExcedenteColumn: false } }, 'Península');
    invalidate('manual-edit');

    expect(window.BVSim._hourlyTraceState.records).toBeNull();
    expect(window.BVSim._hourlyTraceState.reason).toBe('no-hourly-surplus-column');
    expect(window.BVSim._hourlyTraceState.dirty).toBe(false);
  });

  it('reimportar un CSV sin excedentes limpia records y stats previos', () => {
    const { setFromImport } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 3 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = { totalKwh: 3, missing: 0 };

    setFromImport({ ok: true, records: [], meta: { hasExcedenteColumn: false } }, 'Península');

    expect(window.BVSim._hourlyTraceState.records).toBeNull();
    expect(window.BVSim._hourlyTraceState.stats).toBeNull();
    expect(window.BVSim._hourlyTraceState.reason).toBe('no-hourly-surplus-column');
  });

  it('buildIndexedFallbackMsg distingue CSV activo con excedentes a cero de ausencia de CSV', () => {
    const { setFromImport, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('Sin CSV con excedentes activo');

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 0 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = { totalKwh: 0, missing: 0 };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('no registra excedentes');
  });

  it('buildIndexedFallbackMsg prioriza zona distinta y missing total sobre ramas nuevas', () => {
    const { setFromImport, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 2 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = { totalKwh: 0, missing: 0 };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Canarias'))
      .toContain('El CSV importado es de <strong>Península</strong>');

    window.BVSim._hourlyTraceState.zonaFiscal = 'Canarias';
    window.BVSim._hourlyTraceState.stats = { totalKwh: 0, missing: 2 };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Canarias'))
      .toContain('No hay precios del índice disponibles');
  });

  it('inicializa DOMContentLoaded sin usar variables antes de inicializarlas', () => {
    document.body.innerHTML = `
      <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
      <input id="bv-file" type="file">
      <button id="upload-csv-btn"></button>
      <span id="file-name"></span>
      <div id="file-selected-msg"></div>
      <button id="remove-file"></button>
      <input id="bv-p1" value="3.45">
      <input id="bv-p2" value="3.45">
      <input id="bv-saldo-inicial" value="0">
      <select id="bv-mes-inicio"><option value="">Orden de la tabla (por defecto)</option></select>
      <select id="bv-zona-fiscal"><option value="Península" selected>Península</option></select>
      <div id="bv-vivienda-canarias-wrapper"></div>
      <input id="bv-vivienda-canarias" type="checkbox">
      <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
      <div id="bv-results-container"></div>
      <div id="bv-results"></div>
      <div id="bv-status-container"></div>
      <div id="bv-status"></div>
      <div id="bv-manual-grid"></div>
      <div id="bv-data-status"></div>
    `;
    window.BVSim = {};
    loadBvUi(window);

    expect(() => document.dispatchEvent(new Event('DOMContentLoaded'))).not.toThrow();
    expect(window.BVSim._hourlyTraceControls).toBeTruthy();
  });
});
