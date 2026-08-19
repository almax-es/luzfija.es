import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

/**
 * @vitest-environment jsdom
 *
 * assertXlsxSheetWithinLimits() (19/08/2026): un XLSX puede declarar en su cabecera un
 * rango de hoja (!ref) muy superior a sus celdas realmente ocupadas; XLSX.read() confia en
 * ese rango declarado. Este guard rechaza antes de sheet_to_json() cualquier hoja cuyo
 * rango declarado supere limites generosos (ningun consumo horario real, ni de varios
 * anos, se acerca a ellos). Se prueba contra la libreria XLSX real (no un mock) para que
 * decode_range() se comporte exactamente como en produccion.
 */

const require = createRequire(import.meta.url);
let XLSX;
let assertXlsxSheetWithinLimits;

beforeAll(() => {
  XLSX = require('../vendor/xlsx/xlsx.full.min.js');
  ({ assertXlsxSheetWithinLimits } = window.LF.csvUtils);
});

function sheetWithRef(ref) {
  return { '!ref': ref };
}

describe('assertXlsxSheetWithinLimits', () => {
  it('no lanza para una hoja real pequeña', () => {
    const ws = XLSX.utils.aoa_to_sheet([[1, 2, 3], [4, 5, 6]]);
    expect(() => assertXlsxSheetWithinLimits(ws, XLSX)).not.toThrow();
  });

  it('acepta exactamente 150.000 filas (frontera inferior)', () => {
    const ws = sheetWithRef('A1:E150000');
    expect(() => assertXlsxSheetWithinLimits(ws, XLSX)).not.toThrow();
  });

  it('rechaza 150.001 filas (frontera superior)', () => {
    const ws = sheetWithRef('A1:E150001');
    expect(() => assertXlsxSheetWithinLimits(ws, XLSX)).toThrow(/dimensiones excesivas/);
  });

  it('acepta exactamente 2.000.000 de celdas (frontera inferior)', () => {
    // 100.000 filas x 20 columnas = 2.000.000 celdas, por debajo del limite de filas
    const ws = sheetWithRef('A1:T100000');
    expect(() => assertXlsxSheetWithinLimits(ws, XLSX)).not.toThrow();
  });

  it('rechaza una hoja por encima de 2.000.000 de celdas', () => {
    const ws = sheetWithRef('A1:U100000'); // 100.000 x 21 = 2.100.000, por encima del limite
    expect(() => assertXlsxSheetWithinLimits(ws, XLSX)).toThrow(/dimensiones excesivas/);
  });

  it('con sheets:0 la segunda hoja patologica no llega a materializarse', () => {
    const wb = XLSX.utils.book_new();
    const wsNormal = XLSX.utils.aoa_to_sheet([[1, 2], [3, 4]]);
    XLSX.utils.book_append_sheet(wb, wsNormal, 'Normal');
    const wsBig = XLSX.utils.aoa_to_sheet(
      Array.from({ length: 50000 }, (_, i) => [i, i, i, i, i, i])
    );
    XLSX.utils.book_append_sheet(wb, wsBig, 'Enorme');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const workbook = XLSX.read(buf, { type: 'array', sheets: 0 });
    expect(workbook.SheetNames).toEqual(['Normal', 'Enorme']);
    expect(workbook.Sheets['Enorme']).toBeUndefined();

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(() => assertXlsxSheetWithinLimits(firstSheet, XLSX)).not.toThrow();
  });

  it('no lanza si la hoja no tiene !ref (nada que comprobar)', () => {
    expect(() => assertXlsxSheetWithinLimits({}, XLSX)).not.toThrow();
    expect(() => assertXlsxSheetWithinLimits(null, XLSX)).not.toThrow();
  });

  it('con un !ref mal formado no lanza ni revienta (decode_range devuelve rango vacio)', () => {
    const ws = sheetWithRef('esto-no-es-un-rango');
    expect(() => assertXlsxSheetWithinLimits(ws, XLSX)).not.toThrow();
  });

  it('no lanza si falta la libreria XLSX (nada que decodificar)', () => {
    const ws = sheetWithRef('A1:E150001');
    expect(() => assertXlsxSheetWithinLimits(ws, null)).not.toThrow();
    expect(() => assertXlsxSheetWithinLimits(ws, {})).not.toThrow();
  });
});
