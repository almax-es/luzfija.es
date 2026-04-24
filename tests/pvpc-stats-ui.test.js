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

  it('rejects personal CSV/XLSX files above 10 MB before reading them', async () => {
    const { parseCsvOrXlsx } = window.LF.pvpcStatsCsvHelpers;
    const hugeFile = {
      name: 'huge.csv',
      size: 10 * 1024 * 1024 + 1,
      text: () => {
        throw new Error('should not read file contents');
      }
    };

    await expect(parseCsvOrXlsx(hugeFile)).rejects.toThrow(/10 MB/);
  });

  it('maps DST fallback days with exact CNMC hours, including hora 25 and later hours', () => {
    const { getHourIndex, buildCnmcHourIndexMap, getVisualHourBucket } = window.LF.pvpcStatsCsvHelpers;
    const baseTs = Date.parse('2024-10-26T22:00:00Z') / 1000; // 00:00 local del 27/10/2024
    const dayHours = Array.from({ length: 25 }, (_, i) => [baseTs + i * 3600, i / 100]);

    const byCnmcHour = buildCnmcHourIndexMap(dayHours, 'Europe/Madrid');

    expect(byCnmcHour.get(3)).toBe(2);   // Primera 02:00 local
    expect(byCnmcHour.get(25)).toBe(3);  // Segunda 02:00 local
    expect(byCnmcHour.get(4)).toBe(4);   // 03:00 local, ya desplazada

    expect(getHourIndex(3, new Date('2024-10-27T00:00:00'), dayHours, 'Europe/Madrid')).toBe(2);
    expect(getHourIndex(25, new Date('2024-10-27T00:00:00'), dayHours, 'Europe/Madrid')).toBe(3);
    expect(getHourIndex(4, new Date('2024-10-27T00:00:00'), dayHours, 'Europe/Madrid')).toBe(4);

    expect(getVisualHourBucket(24, new Date('2024-10-27T00:00:00'))).toBe(23);
    expect(getVisualHourBucket(25, new Date('2024-10-27T00:00:00'))).toBe(2);
    expect(getVisualHourBucket(4, new Date('2024-10-27T00:00:00'))).toBe(3);

    const hourly = new Array(24).fill(0);
    hourly[getVisualHourBucket(24)] += 1;
    hourly[getVisualHourBucket(25)] += 1;

    expect(hourly).toHaveLength(24);
    expect(hourly[23]).toBe(1);
    expect(hourly[2]).toBe(1);
  });
});
