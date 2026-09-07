import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

const homeImportCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
const solarImportCode = fs.readFileSync(path.resolve(__dirname, '../js/bv/bv-import.js'), 'utf8');
const statsImportCode = fs.readFileSync(path.resolve(__dirname, '../js/pvpc-stats-csv.js'), 'utf8');
const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');

describe('XLSX: fórmulas sin valor cacheado en columnas relevantes', () => {
  const guard = (...args) => window.LF.csvUtils.assertRelevantXlsxFormulasResolved(...args);

  it('rechaza una fórmula sin resultado cacheado en consumo horario', () => {
    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ['01/01/2026', '1']
    ];
    const sheet = {
      C2: { t: 'e', f: '1+1', v: undefined }
    };

    expect(() => guard(sheet, rows, 0)).toThrow(/fórmula sin resultado calculado/i);
  });

  it('rechaza el stub real t:"z" con fórmula y v:0 que SheetJS expone con sheetStubs:true', () => {
    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ['01/01/2026', '1']
    ];
    const sheet = {
      C2: { t: 'z', f: '1/2', v: 0 }
    };

    expect(() => guard(sheet, rows, 0)).toThrow(/fórmula sin resultado calculado/i);
  });

  it('no confunde una celda vacía ordinaria t:"z" sin f con una fórmula sin cache', () => {
    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ['01/01/2026', '1']
    ];
    const sheet = {
      C2: { t: 'z', v: 0 }
    };

    expect(() => guard(sheet, rows, 0)).not.toThrow();
  });

  it('rechaza la fórmula tras escribir y releer un XLSX real con SheetJS', () => {
    const sourceSheet = XLSX.utils.aoa_to_sheet([
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ['01/01/2026', 1]
    ]);
    sourceSheet.C2 = { t: 'n', f: '1+1' };
    sourceSheet['!ref'] = 'A1:C2';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sourceSheet, 'Curva');

    const binary = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const reopened = XLSX.read(binary, { type: 'array', sheets: 0 });
    const sheet = reopened.Sheets.Curva;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

    expect(sheet.C2).toMatchObject({ t: 'e', f: '1+1' });
    expect(rows[1]).toEqual(['01/01/2026', '1']);
    expect(() => guard(sheet, rows, 0)).toThrow(/fórmula sin resultado calculado/i);
  });

  it('acepta la misma fórmula si el XLSX trae un resultado cacheado 0,5', () => {
    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ['01/01/2026', '1', '0,5']
    ];
    const sheet = {
      C2: { t: 'n', f: '1/2', v: 0.5 }
    };

    expect(() => guard(sheet, rows, 0)).not.toThrow();
  });

  it('no interpreta ni ejecuta el texto de una fórmula con resultado cacheado', () => {
    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ['01/01/2026', '1', '2']
    ];
    globalThis.__LF_XLSX_FORMULA_EXECUTED = false;
    const sheet = {
      C2: { t: 'n', f: 'globalThis.__LF_XLSX_FORMULA_EXECUTED = true', v: 2 }
    };

    expect(() => guard(sheet, rows, 0)).not.toThrow();
    expect(globalThis.__LF_XLSX_FORMULA_EXECUTED).toBe(false);
    delete globalThis.__LF_XLSX_FORMULA_EXECUTED;
  });

  it('no bloquea una fórmula sin cache en una columna irrelevante de notas', () => {
    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh', 'Notas'],
      ['01/01/2026', '1', '2']
    ];
    const sheet = {
      D2: { t: 'e', f: '1+1', v: undefined }
    };

    expect(() => guard(sheet, rows, 0)).not.toThrow();
  });

  it('protege las columnas H01..H24 de una matriz horaria', () => {
    const header = ['Fecha', ...Array.from({ length: 24 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`)];
    const rows = [header, ['01/01/2026']];
    const sheet = {
      B2: { t: 'e', f: '1+1', v: undefined }
    };

    expect(() => guard(sheet, rows, 0, { format: 'matrix' })).toThrow(/fórmula sin resultado calculado/i);
  });

  it('protege también las magnitudes solares del formato mensual Datadis', () => {
    const rows = [[
      'Fecha', 'Valle', 'Llano', 'Punta',
      'Energia_vertida_kWh', 'Energia_generada_kWh', 'Energia_autoconsumida_kWh'
    ], ['2026/01', '1', '2', '3', undefined, '5', '4']];
    const sheet = {
      E2: { t: 'e', f: '4-1', v: undefined }
    };

    expect(() => guard(sheet, rows, 0)).toThrow(/fórmula sin resultado calculado/i);
  });
});

describe('XLSX: el guard está cableado en los tres importadores productivos', () => {
  it('home lo aplica a matriz y tabla y materializa stubs', () => {
    expect(homeImportCode).toMatch(/XLSX\.read\([^;]+sheetStubs:\s*true/);
    expect(homeImportCode.match(/assertRelevantXlsxFormulasResolved\(/g)?.length || 0).toBeGreaterThanOrEqual(2);
  });

  it('solar lo aplica a matriz y tabla y materializa stubs', () => {
    expect(solarImportCode).toMatch(/XLSX\.read\([^;]+sheetStubs:\s*true/);
    expect(solarImportCode.match(/assertRelevantXlsxFormulasResolved\(/g)?.length || 0).toBeGreaterThanOrEqual(2);
  });

  it('Observatorio lo aplica antes del parser XLSX y materializa stubs', () => {
    expect(statsImportCode).toMatch(/XLSX\.read\([^;]+sheetStubs:\s*true/);
    expect(statsImportCode).toMatch(/assertRelevantXlsxFormulasResolved\(sheet, data, headerRowIndex\)/);
  });
});
