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
});
