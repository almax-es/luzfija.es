import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 *
 * Fail-closed (19/08/2026): si window.LF.csvUtils.assertXlsxSheetWithinLimits no esta
 * disponible (p. ej. un futuro error de orden de scripts), los tres importadores XLSX
 * deben rechazar el archivo en vez de procesarlo sin haber comprobado sus dimensiones.
 * Aqui se carga cada modulo real con esa funcion deliberadamente ausente de csvUtils, y se
 * confirma que el resultado es un rechazo con el mensaje de fail-closed, no un intento de
 * parseo.
 */

class MockFileReader {
  readAsArrayBuffer() {
    setTimeout(() => this.onload({ target: { result: new ArrayBuffer(8) } }), 5);
  }
}

function loadCsvUtilsWithoutGuard(win) {
  const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
  new Function('window', utilsCode)(win);
  delete win.LF.csvUtils.assertXlsxSheetWithinLimits;
}

function fakeXlsxWorkbook() {
  return {
    read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: { '!ref': 'A1:B2' } } })),
    utils: { sheet_to_json: vi.fn(() => { throw new Error('sheet_to_json no deberia llamarse: el guard fail-closed debe cortar antes'); }) }
  };
}

describe('Fail-closed cuando falta assertXlsxSheetWithinLimits', () => {
  it('lf-csv-import.js (home): procesarXLSXConsumos rechaza el archivo', async () => {
    const win = { LF: {}, document: { createElement: vi.fn(() => ({})), head: { appendChild: vi.fn() }, baseURI: 'http://localhost' } };
    loadCsvUtilsWithoutGuard(win);
    const importCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
    new Function('window', 'lfDbg', 'FileReader', importCode)(win, vi.fn(), MockFileReader);

    global.XLSX = fakeXlsxWorkbook();
    const result = await win.LF.procesarXLSXConsumos({ name: 'test.xlsx' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No se pudo validar el archivo Excel/);
    expect(global.XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
    delete global.XLSX;
  });

  it('bv-import.js (solar): BVSim.importFile rechaza el archivo', async () => {
    const win = { LF: {}, BVSim: {}, document: { createElement: vi.fn(() => ({})), head: { appendChild: vi.fn() }, baseURI: 'http://localhost' } };
    loadCsvUtilsWithoutGuard(win);
    const bvImportCode = fs.readFileSync(path.resolve(__dirname, '../js/bv/bv-import.js'), 'utf8');
    new Function('window', 'FileReader', bvImportCode)(win, MockFileReader);

    global.XLSX = fakeXlsxWorkbook();
    const result = await win.BVSim.importFile({ name: 'test.xlsx' });

    expect(result.ok).toBe(false);
    expect(result.error || '').toMatch(/No se pudo validar el archivo Excel/);
    expect(global.XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
    delete global.XLSX;
  });

  it('pvpc-stats-csv.js (observatorio): parseCsvOrXlsx rechaza el archivo', async () => {
    const win = { LF: {}, document: { createElement: vi.fn(() => ({})), head: { appendChild: vi.fn() }, baseURI: 'http://localhost' } };
    loadCsvUtilsWithoutGuard(win);
    const statsCode = fs.readFileSync(path.resolve(__dirname, '../js/pvpc-stats-csv.js'), 'utf8');
    new Function('window', statsCode)(win);

    global.XLSX = fakeXlsxWorkbook();
    const file = { name: 'test.xlsx', size: 100, arrayBuffer: async () => new ArrayBuffer(8) };

    await expect(win.LF.pvpcStatsCsvHelpers.parseCsvOrXlsx(file)).rejects.toThrow(/No se pudo validar el archivo Excel/);
    expect(global.XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
    delete global.XLSX;
  });
});
