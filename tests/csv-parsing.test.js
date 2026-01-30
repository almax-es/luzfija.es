import { describe, it, expect, beforeAll } from 'vitest';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js'; // Nueva biblioteca
import '../js/lf-csv-import.js';
import '../js/bv/bv-import.js';

/**
 * Tests para la refactorización de parsing CSV robusto
 * Verifican que ambos importadores (lf-csv-import.js y bv-import.js)
 * usen correctamente las funciones comunes de lf-csv-utils.js
 */
describe('CSV Utils - Parsing Robusto', () => {
  let csvUtils;

  beforeAll(() => {
    csvUtils = window.LF.csvUtils;
  });

  describe('stripBomAndTrim', () => {
    it('Debe eliminar BOM UTF-8', () => {
      const withBom = '\uFEFFCUPS';
      expect(csvUtils.stripBomAndTrim(withBom)).toBe('CUPS');
    });

    it('Debe eliminar espacios en blanco', () => {
      expect(csvUtils.stripBomAndTrim('  CUPS  ')).toBe('CUPS');
    });

    it('Debe manejar valores null/undefined', () => {
      expect(csvUtils.stripBomAndTrim(null)).toBe('');
      expect(csvUtils.stripBomAndTrim(undefined)).toBe('');
    });
  });

  describe('stripOuterQuotes', () => {
    it('Debe eliminar comillas dobles exteriores', () => {
      expect(csvUtils.stripOuterQuotes('"valor"')).toBe('valor');
    });

    it('Debe eliminar comillas simples exteriores', () => {
      expect(csvUtils.stripOuterQuotes("'valor'")).toBe('valor');
    });

    it('Debe respetar comillas internas', () => {
      expect(csvUtils.stripOuterQuotes('"valor con "comillas" internas"')).toBe('valor con "comillas" internas');
    });

    it('NO debe eliminar comillas desbalanceadas', () => {
      expect(csvUtils.stripOuterQuotes('"valor')).toBe('"valor');
    });
  });

  describe('parseNumberFlexibleCSV', () => {
    it('Debe parsear formato ES con coma decimal: 1.234,56', () => {
      expect(csvUtils.parseNumberFlexibleCSV('1.234,56')).toBe(1234.56);
    });

    it('Debe parsear formato US con punto decimal: 1,234.56', () => {
      expect(csvUtils.parseNumberFlexibleCSV('1,234.56')).toBe(1234.56);
    });

    it('Debe parsear formato simple con coma: 1234,56', () => {
      expect(csvUtils.parseNumberFlexibleCSV('1234,56')).toBe(1234.56);
    });

    it('Debe parsear formato simple con punto: 1234.56', () => {
      expect(csvUtils.parseNumberFlexibleCSV('1234.56')).toBe(1234.56);
    });

    it('Debe manejar números entrecomillados (E-REDES)', () => {
      expect(csvUtils.parseNumberFlexibleCSV('"1,234"')).toBe(1.234);
    });

    it('Debe retornar NaN para valores vacíos', () => {
      expect(csvUtils.parseNumberFlexibleCSV('')).toBeNaN();
      expect(csvUtils.parseNumberFlexibleCSV(null)).toBeNaN();
    });
  });

  describe('splitCSVLine', () => {
    it('Debe splitear CSV básico con punto y coma', () => {
      const result = csvUtils.splitCSVLine('A;B;C', ';');
      expect(result).toEqual(['A', 'B', 'C']);
    });

    it('Debe splitear CSV básico con coma', () => {
      const result = csvUtils.splitCSVLine('A,B,C', ',');
      expect(result).toEqual(['A', 'B', 'C']);
    });

    it('Debe respetar campos entrecomillados con separador interno', () => {
      const result = csvUtils.splitCSVLine('12345;"01/01/2024";1;"1,234";R', ';');
      expect(result).toEqual(['12345', '01/01/2024', '1', '1,234', 'R']);
    });

    it('Debe manejar comillas escapadas ""', () => {
      const result = csvUtils.splitCSVLine('A;"Valor con ""comillas"" escapadas";C', ';');
      expect(result).toEqual(['A', 'Valor con "comillas" escapadas', 'C']);
    });

    it('Debe manejar campos vacíos', () => {
      const result = csvUtils.splitCSVLine('A;;C', ';');
      expect(result).toEqual(['A', '', 'C']);
    });

    it('Debe manejar último campo vacío', () => {
      const result = csvUtils.splitCSVLine('A;B;', ';');
      expect(result).toEqual(['A', 'B', '']);
    });
  });

  describe('detectCSVSeparator', () => {
    it('Debe detectar punto y coma como separador', () => {
      const header = 'CUPS;Fecha;Hora;Consumo_kWh';
      expect(csvUtils.detectCSVSeparator(header)).toBe(';');
    });

    it('Debe detectar coma como separador', () => {
      const header = 'CUPS,Date,Hour,Consumption';
      expect(csvUtils.detectCSVSeparator(header)).toBe(',');
    });

    it('Debe elegir punto y coma si hay igual cantidad', () => {
      const header = 'A;B,C';
      expect(csvUtils.detectCSVSeparator(header)).toBe(';');
    });

    it('Debe asumir punto y coma si no hay separadores', () => {
      const header = 'CUPS';
      expect(csvUtils.detectCSVSeparator(header)).toBe(';');
    });
  });

  describe('parseDateFlexible', () => {
    it('Debe parsear formato dd/mm/yyyy', () => {
      const date = csvUtils.parseDateFlexible('25/12/2024');
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(11); // Diciembre
      expect(date.getDate()).toBe(25);
    });

    it('Debe parsear formato dd-mm-yyyy', () => {
      const date = csvUtils.parseDateFlexible('25-12-2024');
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(25);
    });

    it('Debe parsear formato yyyy-mm-dd (ISO)', () => {
      const date = csvUtils.parseDateFlexible('2024-12-25');
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(25);
    });

    it('Debe ignorar componente hora', () => {
      const date = csvUtils.parseDateFlexible('25/12/2024 14:30:00');
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(25);
    });

    it('Debe retornar null para fechas inválidas', () => {
      expect(csvUtils.parseDateFlexible('invalid')).toBeNull();
      expect(csvUtils.parseDateFlexible('')).toBeNull();
      expect(csvUtils.parseDateFlexible(null)).toBeNull();
    });

    it('Debe aceptar objetos Date como pass-through', () => {
      const originalDate = new Date(2024, 11, 25);
      const result = csvUtils.parseDateFlexible(originalDate);
      expect(result).toBe(originalDate);
    });
  });

  describe('getFestivosNacionales', () => {
    it('Debe retornar un Set de fechas para 2025', () => {
      const festivos = csvUtils.getFestivosNacionales(2025);
      expect(festivos).toBeInstanceOf(Set);
      expect(festivos.size).toBeGreaterThan(0);
    });

    it('Debe incluir festivos fijos (Navidad)', () => {
      const festivos = csvUtils.getFestivosNacionales(2025);
      expect(festivos.has('2025-12-25')).toBe(true);
    });

    it('NO debe incluir festivos móviles (CNMC BOE-A-2020-1066)', () => {
      // Viernes Santo 2025 = 18 de Abril (móvil)
      // La normativa CNMC excluye los festivos sin fecha fija
      const festivos = csvUtils.getFestivosNacionales(2025);
      expect(festivos.has('2025-04-18')).toBe(false);
    });

    it('Debe cachear resultados (mismo objeto para mismo año)', () => {
      const festivos1 = csvUtils.getFestivosNacionales(2025);
      const festivos2 = csvUtils.getFestivosNacionales(2025);
      expect(festivos1).toBe(festivos2);
    });

    it('Debe retornar Set vacío para años inválidos', () => {
      const festivos = csvUtils.getFestivosNacionales(NaN);
      expect(festivos).toBeInstanceOf(Set);
      expect(festivos.size).toBe(0);
    });
  });

  describe('getPeriodoHorarioCSV', () => {
    it('Debe clasificar festivo como P3 (Valle)', () => {
      const navidad = new Date(2025, 11, 25);
      expect(csvUtils.getPeriodoHorarioCSV(navidad, 12)).toBe('P3');
    });

    it('Debe clasificar fin de semana como P3 (Valle)', () => {
      const sabado = new Date(2025, 0, 4);
      expect(csvUtils.getPeriodoHorarioCSV(sabado, 12)).toBe('P3');
    });

    it('Debe clasificar hora punta laborable como P1', () => {
      const lunes = new Date(2025, 0, 8); // 8 Enero 2025 (Miercoles laborable)
      expect(csvUtils.getPeriodoHorarioCSV(lunes, 11)).toBe('P1'); // 10-11h
      expect(csvUtils.getPeriodoHorarioCSV(lunes, 20)).toBe('P1'); // 19-20h
    });

    it('Debe clasificar hora llano laborable como P2', () => {
      const lunes = new Date(2025, 0, 8); // 8 Enero 2025
      expect(csvUtils.getPeriodoHorarioCSV(lunes, 9)).toBe('P2'); // 08-09h
      expect(csvUtils.getPeriodoHorarioCSV(lunes, 16)).toBe('P2'); // 15-16h
    });

    it('Debe clasificar hora valle laborable (0-8h) como P3', () => {
      const lunes = new Date(2025, 0, 8);
      expect(csvUtils.getPeriodoHorarioCSV(lunes, 5)).toBe('P3'); // 04-05h
    });
  });
});

/**
 * Tests de integración: Verificar que ambos importadores usen correctamente
 * las funciones de csvUtils
 */
describe('Integración - lf-csv-import.js', () => {
  it('Debe parsear CSV con comillas y comas decimales', async () => {
    const csvContent = `CUPS;Fecha;Hora;Consumo_kWh;Método
ES12345;01/01/2024;1;"1,234";Real
ES12345;01/01/2024;2;"2,456";Real`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });

    const resultado = await window.LF.procesarCSVConsumos(file);
    expect(resultado.totalKwh).not.toBe('NaN,00');
    expect(resultado.dias).toBe(1);
  });

  it('Debe parsear CSV con separador coma en vez de punto y coma', async () => {
    const csvContent = `CUPS,Fecha,Hora,Consumo_kWh,Método
ES12345,01/01/2024,1,1.234,Real
ES12345,01/01/2024,2,2.456,Real`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });

    const resultado = await window.LF.procesarCSVConsumos(file);
    expect(resultado.totalKwh).not.toBe('NaN,00');
    expect(resultado.dias).toBe(1);
  });

  it('Debe ajustar hora 0..23 y rechazar horas fuera de rango', async () => {
    const csvContent = `CUPS;Fecha;Hora;Consumo_kWh;Método
ES12345;01/01/2024;0;"1,234";Real
ES12345;01/01/2024;26;"2,456";Real
ES12345;01/01/2024;1;"3,456";Real`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });

    const resultado = await window.LF.procesarCSVConsumos(file);
    // Debe ajustar hora=0 y descartar hora=26
    expect(resultado.dias).toBe(1);
    // Total debe ser 1.234 + 3.456 = 4.69 kWh
    const totalKwhNum = parseFloat(resultado.totalKwh.replace(',', '.'));
    expect(totalKwhNum).toBeCloseTo(4.69, 2);
  });

  it('Debe rechazar valores de kWh absurdos (>10000)', async () => {
    const csvContent = `CUPS;Fecha;Hora;Consumo_kWh;Método
ES12345;01/01/2024;1;"999999";Real
ES12345;01/01/2024;2;"1,234";Real`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });

    const resultado = await window.LF.procesarCSVConsumos(file);
    // Solo debe contar el registro con kwh=1.234
    const totalKwhNum = parseFloat(resultado.totalKwh.replace(',', '.'));
    expect(totalKwhNum).toBeCloseTo(1.234, 2);
  });
});

