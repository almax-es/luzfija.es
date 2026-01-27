import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

global.window = {
  LF: {
    toast: vi.fn(),
    formatMoney: vi.fn(),
    round2: (n) => Math.round(n * 100) / 100,
    csvUtils: {}
  },
  BVSim: {},
  document: {
    createElement: vi.fn(() => ({})),
    head: { appendChild: vi.fn() },
    baseURI: 'http://localhost'
  }
};

global.document = global.window.document;
global.lfDbg = vi.fn();

class MockFileReader {
  readAsText(file) {
    setTimeout(() => {
      if (file.name.includes('error')) {
        this.onerror();
      } else {
        this.onload({ target: { result: file._content || '' } });
      }
    }, 5);
  }
  readAsArrayBuffer(file) {
    setTimeout(() => {
      if (file.name.includes('error')) {
        this.onerror();
      } else {
        this.onload({ target: { result: new ArrayBuffer(8) } });
      }
    }, 5);
  }
}

global.FileReader = MockFileReader;

const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
const utilsFn = new Function('window', utilsCode);
utilsFn(global.window);

const importCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
const importFn = new Function('window', 'lfDbg', 'FileReader', importCode);
importFn(global.window, global.lfDbg, MockFileReader);

const bvImportCode = fs.readFileSync(path.resolve(__dirname, '../js/bv/bv-import.js'), 'utf8');
const bvImportFn = new Function('window', 'FileReader', bvImportCode);
bvImportFn(global.window, MockFileReader);

describe('Importación robusta CSV (Datadis, e-distribución, i-DE)', () => {
  const { procesarCSVConsumos } = window.LF;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Procesa Datadis nuevo con Hora "01:00" y neteo horario', async () => {
    const csvContent = fs.readFileSync(path.resolve(__dirname, 'fixtures/datadis_nuevo.csv'), 'utf8');
    const file = { name: 'datadis.csv', _content: csvContent };

    const result = await procesarCSVConsumos(file);
    const records = result.consumosHorarios;

    expect(records).toHaveLength(2);
    expect(records.some(r => r.hora === 1)).toBe(true);
    expect(records.some(r => r.hora === 2)).toBe(true);

    const totalImport = records.reduce((acc, r) => acc + r.kwh, 0);
    const totalExport = records.reduce((acc, r) => acc + r.excedente, 0);

    expect(totalImport).toBeCloseTo(1.0, 6);
    expect(totalExport).toBeCloseTo(0.4, 6);
    records.forEach((r) => {
      expect(!(r.kwh > 0 && r.excedente > 0)).toBe(true);
    });
  });

  it('Procesa e-distribución con CUPS vacío y hora 25', async () => {
    const csvContent = fs.readFileSync(path.resolve(__dirname, 'fixtures/edistribucion_octubre.csv'), 'utf8');
    const file = { name: 'edistribucion.csv', _content: csvContent };

    const result = await procesarCSVConsumos(file);
    const records = result.consumosHorarios;

    expect(records).toHaveLength(2);
    expect(records.some(r => r.hora === 25)).toBe(true);

    const totalImport = records.reduce((acc, r) => acc + r.kwh, 0);
    const totalExport = records.reduce((acc, r) => acc + r.excedente, 0);

    expect(totalImport).toBeCloseTo(1.0, 6);
    expect(totalExport).toBeCloseTo(0.3, 6);
  });

  it('Procesa i-DE con consumo/generación simultáneos y Wh', async () => {
    const csvContent = fs.readFileSync(path.resolve(__dirname, 'fixtures/ide_bruto.csv'), 'utf8');
    const file = { name: 'ide.csv', _content: csvContent };

    const result = await procesarCSVConsumos(file);
    const records = result.consumosHorarios;

    expect(records).toHaveLength(2);

    const totalImport = records.reduce((acc, r) => acc + r.kwh, 0);
    const totalExport = records.reduce((acc, r) => acc + r.excedente, 0);

    expect(totalImport).toBeCloseTo(0.3, 6);
    expect(totalExport).toBeCloseTo(0.3, 6);
    records.forEach((r) => {
      expect(!(r.kwh > 0 && r.excedente > 0)).toBe(true);
    });

    expect(result.warnings.some(w => w.toLowerCase().includes('wh'))).toBe(true);
    expect(result.warnings.some(w => w.toLowerCase().includes('formato de hora'))).toBe(true);
    expect(result.warnings.some(w => w.toLowerCase().includes('neteo'))).toBe(true);
  });

  it('Detecta cabecera aunque no sea la primera línea', async () => {
    const csvContent = fs.readFileSync(path.resolve(__dirname, 'fixtures/cabecera_no_primera_linea.csv'), 'utf8');
    const file = { name: 'cabecera.csv', _content: csvContent };

    const result = await procesarCSVConsumos(file);
    const records = result.consumosHorarios;

    expect(records).toHaveLength(1);
    expect(records[0].kwh).toBeCloseTo(1.0, 6);
  });

  it('Interpreta celdas vacías como 0 sin descartar filas', async () => {
    const csvContent = fs.readFileSync(path.resolve(__dirname, 'fixtures/celdas_vacias.csv'), 'utf8');
    const file = { name: 'celdas.csv', _content: csvContent };

    const result = await procesarCSVConsumos(file);
    const records = result.consumosHorarios;

    expect(records).toHaveLength(2);
    const totalImport = records.reduce((acc, r) => acc + r.kwh, 0);
    const totalExport = records.reduce((acc, r) => acc + r.excedente, 0);
    expect(totalImport).toBeCloseTo(0.4, 6);
    expect(totalExport).toBeCloseTo(0.5, 6);
    expect(result.warnings.some(w => w.toLowerCase().includes('celdas vacías'))).toBe(true);
  });

  it('Permite importar en BV con warning de excedentes ausentes', async () => {
    const csvContent = `CUPS;Fecha;Hora;Consumo_kWh;Método
ES123;01/01/2024;1;1,0;R`;
    const file = {
      name: 'consumo-solo.csv',
      _content: csvContent,
      size: csvContent.length,
      type: 'text/csv'
    };

    const result = await window.BVSim.importFile(file);

    expect(result.ok).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.some(w => w.toLowerCase().includes('excedentes'))).toBe(true);
  });
});
