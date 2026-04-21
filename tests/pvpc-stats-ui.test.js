import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
const uiCode = fs.readFileSync(path.resolve(__dirname, '../js/pvpc-stats-ui.js'), 'utf8');
const loadCsvUtils = new Function('window', utilsCode);
const loadPvpcStatsUi = new Function('window', uiCode);

describe('PVPC stats UI CSV fallback helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.LF = {};

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    loadCsvUtils(window);
    loadPvpcStatsUi(window);
  });

  it('preserves the hour from fecha_hora values in the XLSX fallback path', () => {
    const { parseDateFlexible } = window.LF.csvUtils;
    const { parseDateHourValue, getHourIndex } = window.LF.pvpcStatsCsvHelpers;

    const parsed = parseDateHourValue('2026-04-01 13:45', parseDateFlexible);

    expect(parsed.fecha).toBeInstanceOf(Date);
    expect(parsed.fecha.getFullYear()).toBe(2026);
    expect(parsed.fecha.getMonth()).toBe(3);
    expect(parsed.fecha.getDate()).toBe(1);
    expect(parsed.hora).toBe(14);
    expect(getHourIndex(parsed.hora, parsed.fecha)).toBe(13);
  });

  it('falls back to date-only parsing when there is no hour in the cell', () => {
    const { parseDateFlexible } = window.LF.csvUtils;
    const { parseDateHourValue } = window.LF.pvpcStatsCsvHelpers;

    const parsed = parseDateHourValue('2026-04-01', parseDateFlexible);

    expect(parsed.fecha).toBeInstanceOf(Date);
    expect(parsed.hora).toBeNull();
  });
});
