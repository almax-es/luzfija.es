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

  describe('parseEnergyTableRows privacy contract', () => {
    it('No incluye CUPS ni strings libres del CSV en los registros parseados', () => {
      const cups = 'ES0021000000000000AB';
      const rows = [
        ['CUPS', 'Fecha', 'Hora', 'Consumo_kWh', 'Método'],
        [cups, '01/01/2024', '1', '1,234', 'Real']
      ];

      const result = csvUtils.parseEnergyTableRows(rows, { headerRowIndex: 0 });

      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        hora: 1,
        kwh: 1.234,
        excedente: 0,
        autoconsumo: 0,
        esReal: true
      });
      expect(JSON.stringify(result)).not.toContain(cups);
      expect(Object.keys(result.records[0]).join('|').toLowerCase()).not.toContain('cups');
      expect(Object.keys(result.records[0])).toEqual([
        'fecha',
        'hora',
        'kwh',
        'excedente',
        'autoconsumo',
        'periodo',
        'esReal'
      ]);
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

    it('Debe rechazar fechas imposibles (rollover JavaScript)', () => {
      expect(csvUtils.parseDateFlexible('31/02/2025')).toBeNull();
      expect(csvUtils.parseDateFlexible('2025-02-31')).toBeNull();
      expect(csvUtils.parseDateFlexible('29/02/2025')).toBeNull();  // 2025 no es bisiesto
      expect(csvUtils.parseDateFlexible('2025-13-01')).toBeNull();  // mes 13 formato ISO
      expect(csvUtils.parseDateFlexible('31/13/2025')).toBeNull();  // mes 13 formato ES
      expect(csvUtils.parseDateFlexible('00/06/2025')).toBeNull();  // día 0
      expect(csvUtils.parseDateFlexible('2025-02-31T00:00')).toBeNull();    // ISO con T, rollover
      expect(csvUtils.parseDateFlexible('2025-02-31T00:00:00Z')).toBeNull(); // ISO con T y Z
    });

    it('Debe aceptar fecha ISO con T válida', () => {
      const date = csvUtils.parseDateFlexible('2024-02-29T00:00');
      expect(date).not.toBeNull();
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(1);
      expect(date.getDate()).toBe(29);
    });

    it('Debe aceptar 29/02 en año bisiesto', () => {
      const date = csvUtils.parseDateFlexible('29/02/2024');
      expect(date).not.toBeNull();
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(1);
      expect(date.getDate()).toBe(29);
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

// ===== DATADIS MENSUAL =====

const DATADIS_HEADER = 'CUPS;Fecha;Valle;Llano;Punta;Energia_vertida_kWh;Energia_generada_kWh;Energia_autoconsumida_kWh;Consumo_Anual';

function datadisRow(mes, valle, llano, punta, vert, gen, auto) {
  return `ES001;${mes};${valle};${llano};${punta};${vert};${gen};${auto};`;
}

function makeDatadisCSV12Months() {
  const lines = [DATADIS_HEADER];
  for (let m = 1; m <= 12; m++) {
    const mes = `2025/${String(m).padStart(2, '0')}`;
    lines.push(datadisRow(mes, 100, 50, 30, 20, 80, 60));
  }
  return lines.join('\n');
}

describe('parseDateFlexible - formato YYYY/MM (Datadis)', () => {
  let csvUtils;
  beforeAll(() => { csvUtils = window.LF.csvUtils; });

  it('Debe parsear YYYY/MM como día 1 del mes', () => {
    const date = csvUtils.parseDateFlexible('2025/01');
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(1);
  });

  it('Debe parsear YYYY/MM de agosto correctamente', () => {
    const date = csvUtils.parseDateFlexible('2025/08');
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(1);
  });

  it('No debe confundir YYYY/MM con YYYY/MM/DD', () => {
    const date = csvUtils.parseDateFlexible('2025/01/15');
    expect(date.getDate()).toBe(15);
  });
});

describe('isDatadisMonthlyFormat', () => {
  let csvUtils;
  beforeAll(() => { csvUtils = window.LF.csvUtils; });

  it('Detecta formato Datadis con las tres columnas solares', () => {
    const headers = ['CUPS', 'Fecha', 'Valle', 'Llano', 'Punta', 'Energia_vertida_kWh', 'Energia_generada_kWh', 'Energia_autoconsumida_kWh', 'Consumo_Anual'];
    const headersNorm = headers.map(h => csvUtils.normalizeHeaderName(h));
    expect(csvUtils.isDatadisMonthlyFormat(headersNorm)).toBe(true);
  });

  it('Detecta formato Datadis con al menos una columna solar', () => {
    const headers = ['Fecha', 'Valle', 'Llano', 'Punta', 'Energia_vertida_kWh'];
    const headersNorm = headers.map(h => csvUtils.normalizeHeaderName(h));
    expect(csvUtils.isDatadisMonthlyFormat(headersNorm)).toBe(true);
  });

  it('Rechaza CSV horario normal (sin valle/llano/punta)', () => {
    const headers = ['CUPS', 'Fecha', 'Hora', 'Consumo_kWh'];
    const headersNorm = headers.map(h => csvUtils.normalizeHeaderName(h));
    expect(csvUtils.isDatadisMonthlyFormat(headersNorm)).toBe(false);
  });

  it('Rechaza si solo tiene valle/llano/punta pero sin columna solar', () => {
    const headers = ['Fecha', 'Valle', 'Llano', 'Punta'];
    const headersNorm = headers.map(h => csvUtils.normalizeHeaderName(h));
    expect(csvUtils.isDatadisMonthlyFormat(headersNorm)).toBe(false);
  });
});

describe('parseEnergyTableRows - Datadis mensual', () => {
  let csvUtils;
  beforeAll(() => { csvUtils = window.LF.csvUtils; });

  function makeRows(dataLines) {
    return [
      ['CUPS', 'Fecha', 'Valle', 'Llano', 'Punta', 'Energia_vertida_kWh', 'Energia_generada_kWh', 'Energia_autoconsumida_kWh', 'Consumo_Anual'],
      ...dataLines
    ];
  }

  it('Produce 3 registros sintéticos por mes para 12 meses', () => {
    const rows = makeRows(
      Array.from({ length: 12 }, (_, i) => {
        const m = String(i + 1).padStart(2, '0');
        return ['ES001', `2025/${m}`, '100', '50', '30', '20', '80', '60', ''];
      })
    );
    const result = csvUtils.parseEnergyTableRows(rows);
    expect(result.isDatadisMonthly).toBe(true);
    expect(result.records).toHaveLength(36);
    expect(result.hasExcedenteColumn).toBe(true);
    expect(result.hasAutoconsumoColumn).toBe(true);
  });

  it('Asigna periodos P3/P2/P1 a los registros por mes', () => {
    const rows = makeRows([['ES001', '2025/06', '100', '50', '30', '20', '80', '60', '']]);
    const result = csvUtils.parseEnergyTableRows(rows);
    const periodos = result.records.map(r => r.periodo).sort();
    expect(periodos).toEqual(['P1', 'P2', 'P3']);
    const p3 = result.records.find(r => r.periodo === 'P3');
    expect(p3.kwh).toBe(100);
    const p2 = result.records.find(r => r.periodo === 'P2');
    expect(p2.kwh).toBe(50);
    const p1 = result.records.find(r => r.periodo === 'P1');
    expect(p1.kwh).toBe(30);
    expect(p1.excedente).toBe(20);
    expect(p1.autoconsumo).toBe(60);
  });

  it('Fecha de los registros es día 1 del mes', () => {
    const rows = makeRows([['ES001', '2025/03', '100', '50', '30', '20', '80', '60', '']]);
    const result = csvUtils.parseEnergyTableRows(rows);
    result.records.forEach(r => {
      expect(r.fecha.getFullYear()).toBe(2025);
      expect(r.fecha.getMonth()).toBe(2);
      expect(r.fecha.getDate()).toBe(1);
    });
  });

  it('Lanza error si Generada ≠ Vertida + Autoconsumida (bug Codex: Generada=0, Vertida=1, Autoconsumida=1)', () => {
    const rows = makeRows([['ES001', '2025/01', '100', '50', '30', '1', '0', '1', '']]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).toThrow(/inconsistentes/i);
  });

  it('Lanza error si la diferencia supera 0.05 kWh', () => {
    const rows = makeRows([['ES001', '2025/01', '100', '50', '30', '20', '81', '60', '']]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).toThrow(/inconsistentes/i);
  });

  it('Acepta diferencia de flotante pequeña (≤0.05 kWh)', () => {
    // gen=80.03, vert=20, auto=60 → diff=0.03 → ok
    const rows = makeRows([['ES001', '2025/01', '100', '50', '30', '20', '80,03', '60', '']]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).not.toThrow();
  });

  it('Lanza error si columnas solares no son numéricas', () => {
    const rows = makeRows([['ES001', '2025/01', '100', '50', '30', 'N/A', '80', '60', '']]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).toThrow(/no num/i);
  });

  it('Lanza error si una fila tiene datos pero fecha vacía', () => {
    const rows = makeRows([
      ['ES001', '2025/01', '100', '50', '30', '20', '80', '60', ''],
      ['ES001', '',        '4',   '5',  '6',  '1',  '2',  '1',  '']
    ]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).toThrow(/sin fecha/i);
  });

  it('Lanza error si una fila no vacía tiene fecha inválida', () => {
    const rows = makeRows([
      ['ES001', '2025/01', '100', '50', '30', '20', '80', '60', ''],
      ['ES001', 'bad-date', '100', '50', '30', '20', '80', '60', '']
    ]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).toThrow(/fecha no reconocida/i);
  });

  it('Lanza error si Valle/Llano/Punta no son numéricos', () => {
    const rows = makeRows([['ES001', '2025/01', 'N/A', '50', '30', '20', '80', '60', '']]);
    expect(() => csvUtils.parseEnergyTableRows(rows)).toThrow(/valle/i);
  });

  it('Lanza error si falta alguna de las tres columnas de generación solar', () => {
    // Tiene Vertida pero le faltan Generada y Autoconsumida
    // → isDatadisMonthlyFormat devuelve true, pero parseDatadisMonthlyRows detecta que faltan
    const rowsNoSolar = [
      ['Fecha', 'Valle', 'Llano', 'Punta', 'Energia_vertida_kWh'],
      ['2025/01', '100', '50', '30', '20']
    ];
    expect(() => csvUtils.parseEnergyTableRows(rowsNoSolar)).toThrow(/tres columnas/i);
  });
});

describe('validateCsvSpanFromRecords - Datadis mensual', () => {
  let csvUtils;
  beforeAll(() => { csvUtils = window.LF.csvUtils; });

  function makeDatadisRecords12Months() {
    return Array.from({ length: 12 }, (_, i) => ({
      fecha: new Date(2025, i, 1)
    }));
  }

  it('Sin flag: span enero-diciembre = 335 días (día 1 a día 1)', () => {
    const records = makeDatadisRecords12Months();
    const result = csvUtils.validateCsvSpanFromRecords(records, { maxDays: 370 });
    expect(result.ok).toBe(true);
    expect(result.spanDays).toBeLessThan(366);
  });

  it('Con isDatadisMonthly: span usa último día de diciembre (≈365)', () => {
    const records = makeDatadisRecords12Months();
    const result = csvUtils.validateCsvSpanFromRecords(records, { maxDays: 370, isDatadisMonthly: true });
    expect(result.ok).toBe(true);
    expect(result.spanDays).toBeGreaterThanOrEqual(365);
    expect(result.endYmd).toBe('2025-12-31');
  });

  it('Con isDatadisMonthly: detecta 12 meses correctamente', () => {
    const records = makeDatadisRecords12Months();
    const result = csvUtils.validateCsvSpanFromRecords(records, { maxDays: 370, isDatadisMonthly: true });
    expect(result.monthsDistinct).toBe(12);
  });
});

describe('Regresión: CSV horario estándar no afectado por cambios Datadis', () => {
  it('CSV horario Endesa sigue parseando igual', async () => {
    const csvContent = `CUPS;Fecha;Hora;Consumo_kWh;Método
ES12345;01/06/2025;1;1,234;Real
ES12345;01/06/2025;2;2,100;Real`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const file = new File([blob], 'endesa.csv', { type: 'text/csv' });
    const resultado = await window.LF.procesarCSVConsumos(file);
    expect(resultado.ok).toBe(true);
    expect(resultado.isDatadisMonthly).toBeFalsy();
    expect(resultado.dias).toBe(1);
    const total = parseFloat(resultado.totalKwh.replace(',', '.'));
    expect(total).toBeCloseTo(3.334, 2);
  });
});
