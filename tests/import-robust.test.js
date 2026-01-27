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

  it('Validación de rango de fechas (máximo 370 días)', () => {
    const { validateCsvSpanFromRecords } = window.LF.csvUtils;
    const day = 86400000;
    const start = new Date('2024-01-01').getTime();

    // Caso OK: 360 días
    const recordsOk = [
      { fecha: new Date(start) },
      { fecha: new Date(start + 360 * day) }
    ];
    expect(validateCsvSpanFromRecords(recordsOk).ok).toBe(true);

    // Caso Error: 371 días (rango total 372)
    const recordsFail = [
      { fecha: new Date(start) },
      { fecha: new Date(start + 371 * day) }
    ];
    const res = validateCsvSpanFromRecords(recordsFail);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('372 días');
  });

  it('Validación de meses distintos (máximo 12)', () => {
    const { validateCsvSpanFromRecords } = window.LF.csvUtils;
    const records = [];
    // Generar 13 meses distintos (Ene 2024 - Ene 2025)
    for (let i = 0; i < 13; i++) {
      records.push({ fecha: new Date(2024, i, 15) });
    }
    
    // Aunque el rango de días sea aceptable (366 + 15 aprox = ~380? no, 13 meses is > 370 days usually)
    // Wait, 13 months distinct could be within 370 days?
    // Jan 1 2024 to Jan 1 2025 is 13 distinct months (Jan, Feb... Dec, Jan) and 367 days.
    // So checking months distinct is valuable.
    
    // Let's force a case where days are OK but months are > 12?
    // Hard to do unless skipping days.
    // But let's just test the months logic.
    
    const res = validateCsvSpanFromRecords(records);
    // Either fails by days or months.
    expect(res.ok).toBe(false);
    // It might fail by days first (366 + ~15 > 370).
    // Let's try to trigger specifically the month limit if possible, or just accept any failure.
    
    // To trigger strictly month limit: 
    // Data: 2024-01-31 and 2025-01-01.
    // Diff days: 366 (leap) + 1 = 367 days. OK (<370).
    // Distinct months: Jan, Feb... Dec, Jan? No, only Jan and Jan?
    // Distinct months logic uses "YYYY-MM".
    // 2024-01, 2025-01. That's 2 distinct months.
    
    // To hit >12 months with <370 days:
    // 2024-01-31 -> Month 1
    // ...
    // 2025-01-01 -> Month 13
    // Span: 31 Jan to 1 Jan = 337 days? No.
    // 1 Jan 2024 to 1 Jan 2025 = 367 days.
    // Months: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan. (13 months).
    // So 13 months can fit in 367 days.
    
    const records13 = [];
    const base = new Date('2024-01-01');
    for(let i=0; i<13; i++) {
        // 1st of each month
        records13.push({ fecha: new Date(base.getFullYear(), base.getMonth() + i, 1) });
    }
    // Range: 2024-01-01 to 2025-01-01. Days: 367.
    // validateCsvSpanFromRecords checks days > 370. 367 is OK.
    // Then checks months > 12. 13 > 12. Error.
    
    const res13 = validateCsvSpanFromRecords(records13, { maxDays: 370 });
    expect(res13.ok).toBe(false);
    expect(res13.error).toContain('13 meses distintos');
  });
});
