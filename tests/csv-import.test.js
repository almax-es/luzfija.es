import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// 1. Mock de dependencias globales
global.window = {
  LF: {
    toast: vi.fn(),
    formatMoney: vi.fn(),
    round2: (n) => Math.round(n * 100) / 100,
    // Aquí inyectaremos los mocks de csvUtils
    csvUtils: {}
  },
  // Mock para lazy load
  document: {
    createElement: vi.fn(() => ({})),
    head: { appendChild: vi.fn() },
    baseURI: 'http://localhost'
  }
};
global.document = global.window.document;
global.lfDbg = vi.fn();

// 2. Mock FileReader
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

// 3. Cargar lf-csv-utils.js (dependencia real)
const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
const utilsFn = new Function('window', utilsCode);
utilsFn(global.window);

// 4. Cargar lf-csv-import.js
const importCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
const importFn = new Function('window', 'lfDbg', 'FileReader', importCode);
importFn(global.window, global.lfDbg, MockFileReader);


describe('Importación CSV/XLSX (lf-csv-import.js)', () => {
  const { procesarCSVConsumos, procesarXLSXConsumos } = window.LF;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('procesarCSVConsumos', () => {
    it('Debe procesar un CSV válido correctamente', async () => {
      const csvContent = `CUPS;Fecha;Hora;Consumo_kWh;Método
ES12345;01/01/2024;1;1,234;R
ES12345;01/01/2024;2;2,456;R`;
      
      const file = { name: 'test.csv', _content: csvContent };
      
      const result = await procesarCSVConsumos(file);
      
      expect(result.dias).toBe(1);
      expect(result.totalKwh).not.toBe('0,00');
      // total = 1.234 + 2.456 = 3.69
      expect(result.totalKwh.replace(',', '.')).toBe('3.69');
      expect(result.formato).toBe('CSV');
    });

    it('Debe lanzar error con CSV vacío', async () => {
      const file = { name: 'empty.csv', _content: '' };
      await expect(procesarCSVConsumos(file)).rejects.toThrow('CSV vacío o inválido'); 
    });

    it('Debe manejar errores de lectura', async () => {
      const file = { name: 'error.csv' }; // Trigger mock error
      await expect(procesarCSVConsumos(file)).rejects.toThrow();
    });
  });

  describe('procesarXLSXConsumos', () => {
    // Mockear XLSX globalmente para que ensureXLSX lo detecte y no intente cargar script
    beforeEach(() => {
      global.XLSX = {
        read: vi.fn(),
        utils: { sheet_to_json: vi.fn() }
      };
    });

    it('Debe procesar un Excel válido', async () => {
      // Configurar mock de XLSX para devolver datos
      // El parser estandar espera que la columna Fecha contenga "dd/mm/yyyy HH:mm"
      // Y que el consumo esté en Wh (Vatios hora)
      const mockData = [
        ['CUPS', 'Fecha', 'Hora', 'Consumo_kWh', 'Generacion_kWh', 'Metodo'], // Header
        ['ES...', '01/01/2024 00:00', 1, 1234, 0, 'R'], // 1234 Wh = 1.234 kWh
        ['ES...', '01/01/2024 01:00', 2, 2456, 0, 'R']  // 2456 Wh = 2.456 kWh
      ];
      
      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { 'Sheet1': {} }
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const file = { name: 'test.xlsx' };
      
      const result = await procesarXLSXConsumos(file);
      
      expect(result.dias).toBe(1);
      expect(result.totalKwh.replace(',', '.')).toBe('3.69');
      expect(result.formato).toBe('XLSX');
    });

    it('Debe detectar formato Matriz Horaria (H01..H24)', async () => {
      // Header fila 0: Fecha, H01...H24
      const header = ['Fecha', 'H01', 'H02', 'H03', 'H04'];
      for(let i=5; i<=24; i++) header.push(`H${String(i).padStart(2,'0')}`);
      
      const row = ['01/01/2024', 1, 1, 1, 1]; // Fecha + H01..H04
      for(let i=5; i<=24; i++) row.push(1); // H05..H24

      const mockData = [header, row];

      global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { 'Sheet1': {} }
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const file = { name: 'matriz.xlsx' };
      const result = await procesarXLSXConsumos(file);

      expect(result.dias).toBe(1);
      // 24 horas * 1 kWh = 24 kWh
      expect(result.totalKwh.replace(',', '.')).toBe('24.00');
    });

    it('Debe lanzar error si no encuentra columnas válidas', async () => {
      const mockData = [
        ['ColumnaRandom', 'OtraCosa'],
        ['Valor', 'Valor']
      ];
       global.XLSX.read.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { 'Sheet1': {} }
      });
      global.XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const file = { name: 'invalid.xlsx' };
      await expect(procesarXLSXConsumos(file)).rejects.toThrow();
    });
  });

});
