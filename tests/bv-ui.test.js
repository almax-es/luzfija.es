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
  });
});
