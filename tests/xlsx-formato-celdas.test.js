import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// Ronda 39 (15/09/2026): los tres importadores leian la hoja con sheet_to_json raw:false, que
// entrega el texto FORMATEADO de cada celda con convencion en-US. Verificado con la libreria real:
// una fecha d/m/yy entraba con dia y mes cambiados, "1:00 PM" como la hora 1 y 1,2349 kWh con
// formato "0.0" como 1,2, todo sin aviso. Estos tests escriben y releen un XLSX de verdad (el
// formato de cada celda viaja en el fichero) y lo pasan por los importadores reales.
const require = createRequire(import.meta.url);
globalThis.XLSX = require('../vendor/xlsx/xlsx.full.min.js');
import '../js/lf-config.js';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';
import '../js/lf-csv-import.js';
import '../js/bv/bv-import.js';
import '../js/pvpc-stats-csv.js';

const X = globalThis.XLSX;
const serie = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const ymd = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;

function ficheroXlsx(cabecera, filas, { date1904 = false } = {}) {
  const ws = X.utils.aoa_to_sheet([cabecera, ...filas.map((fila) => fila.map(() => null))]);
  filas.forEach((fila, r) => fila.forEach((celda, c) => {
    ws[X.utils.encode_cell({ r: r + 1, c })] = typeof celda === 'object'
      ? celda
      : { t: typeof celda === 'number' ? 'n' : 's', v: celda };
  }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Curva');
  if (date1904) wb.Workbook = { WBProps: { date1904: true } };
  return new File([X.write(wb, { type: 'array', bookType: 'xlsx' })], 'curva.xlsx');
}

// Los tres importadores productivos, con la misma hoja.
async function importarEnLosTres(file) {
  const home = await window.LF.procesarXLSXConsumos(file);
  const solar = await window.BVSim.importFile(file, 'Península');
  const observatorio = await window.__LF_PvpcStatsCsv.parseCsvOrXlsx(file, 'Península');
  expect(home.error).toBeUndefined();
  expect(solar.error).toBeUndefined();
  return {
    home: home.consumosHorarios,
    solar: solar.records,
    observatorio: observatorio.records
  };
}

const CABECERA = ['Fecha', 'Hora', 'Consumo kWh'];

describe('XLSX: fechas con formato de celda', () => {
  const tresFilas = (z) => [
    [{ t: 'n', v: serie(2025, 4, 1), z }, 1, 0.5],
    [{ t: 'n', v: serie(2025, 4, 1), z }, 2, 0.5],
    [{ t: 'n', v: serie(2025, 4, 2), z }, 1, 0.5]
  ];

  it('d/m/yy no intercambia dia y mes (1 y 2 de abril, no 4 de enero y 4 de febrero)', async () => {
    const r = await importarEnLosTres(ficheroXlsx(CABECERA, tresFilas('d/m/yy')));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => ymd(rec.fecha))).toEqual(['2025-04-01', '2025-04-01', '2025-04-02']);
    }
  });

  it('el formato de fecha por defecto de Excel (m/d/yy, integrado 14) da la misma fecha', async () => {
    const r = await importarEnLosTres(ficheroXlsx(CABECERA, tresFilas('m/d/yy')));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => ymd(rec.fecha))).toEqual(['2025-04-01', '2025-04-01', '2025-04-02']);
    }
  });

  it('una celda de fecha y hora d/m/yy h:mm conserva fecha y hora', async () => {
    const fila = (h) => [{ t: 'n', v: serie(2025, 4, 1) + h / 24, z: 'd/m/yy h:mm' }, 0.5];
    const r = await importarEnLosTres(ficheroXlsx(['fecha_hora', 'Consumo kWh'], [fila(0), fila(1), fila(13)]));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => ymd(rec.fecha))).toEqual(['2025-04-01', '2025-04-01', '2025-04-01']);
      // fecha_hora es reloj local 0-23: las 00:00, 01:00 y 13:00 son las horas CNMC 1, 2 y 14.
      expect(records.map((rec) => rec.hora)).toEqual([1, 2, 14]);
    }
  });

  it('el sistema de fechas 1904 no desplaza la fecha', async () => {
    const z = 'dd/mm/yyyy';
    const filas = [[{ t: 'n', v: serie(2025, 4, 1) - 1462, z }, 1, 0.5], [{ t: 'n', v: serie(2025, 4, 1) - 1462, z }, 2, 0.5]];
    const r = await importarEnLosTres(ficheroXlsx(CABECERA, filas, { date1904: true }));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => ymd(rec.fecha))).toEqual(['2025-04-01', '2025-04-01']);
    }
  });
});

describe('XLSX: horas y consumos con formato de celda', () => {
  const fecha = { t: 'n', v: serie(2025, 10, 20), z: 'dd/mm/yyyy' };

  it('h:mm AM/PM se lee en reloj de 24 horas: la 1:00 PM es la hora 13, no la 1', async () => {
    const filas = [11, 12, 13].map((h) => [fecha, { t: 'n', v: h / 24, z: 'h:mm AM/PM' }, 0.5]);
    const r = await importarEnLosTres(ficheroXlsx(CABECERA, filas));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => rec.hora)).toEqual([11, 12, 13]);
    }
  });

  it('un formato que redondea (0.0 o 0) no recorta el consumo de la celda', async () => {
    const filas = [
      [fecha, 1, { t: 'n', v: 1.2349, z: '0.0' }],
      [fecha, 2, { t: 'n', v: 1.6, z: '0' }]
    ];
    const r = await importarEnLosTres(ficheroXlsx(CABECERA, filas));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => rec.kwh)).toEqual([1.2349, 1.6]);
    }
  });

  it('las celdas de TEXTO siguen llegando tal cual: "01/04/2025", "13" y "1,25"', async () => {
    const r = await importarEnLosTres(ficheroXlsx(CABECERA, [['01/04/2025', '13', '1,25'], ['01/04/2025', '14', '0,5']]));
    for (const records of Object.values(r)) {
      expect(records.map((rec) => [ymd(rec.fecha), rec.hora, rec.kwh])).toEqual([
        ['2025-04-01', 13, 1.25],
        ['2025-04-01', 14, 0.5]
      ]);
    }
  });
});

describe('xlsxRowsFromSheet', () => {
  const filas = (sheet) => window.LF.csvUtils.xlsxRowsFromSheet(sheet, X);

  it('alinea cada celda con su fila y columna aunque el rango no empiece en A1 y haya una fila vacia', () => {
    const sheet = {
      '!ref': 'B3:D6',
      B3: { t: 's', v: 'Fecha' }, C3: { t: 's', v: 'Hora' }, D3: { t: 's', v: 'Consumo' },
      B4: { t: 'n', v: serie(2025, 4, 1), z: 'd/m/yy' },
      C4: { t: 'n', v: 13 / 24, z: 'h:mm AM/PM' },
      D4: { t: 'n', v: 1.2349, z: '0.0' },
      B6: { t: 's', v: '02/04/2025' }, C6: { t: 's', v: '14' }, D6: { t: 's', v: '1,25' }
    };
    expect(filas(sheet)).toEqual([
      ['Fecha', 'Hora', 'Consumo'],
      ['01/04/2025', '13:00', '1.2349'],
      [],
      ['02/04/2025', '14', '1,25']
    ]);
  });

  it('un formato sin dia es un mes (forma del Datadis mensual) y [h]:mm admite las 24:00', () => {
    const sheet = {
      '!ref': 'A1:B2',
      A1: { t: 's', v: 'Fecha' }, B1: { t: 's', v: 'Hora' },
      A2: { t: 'n', v: serie(2026, 1, 1), z: 'yyyy/mm' },
      B2: { t: 'n', v: 1, z: '[h]:mm' }
    };
    expect(filas(sheet)[1]).toEqual(['2026/01', '24:00']);
  });

  // Revision de la ronda 39: el primer clasificador trataba como hora todo formato sin dia ni anho.
  it('un formato solo de mes (mmm, [$-es-ES]mmmm) es un mes, no una hora', () => {
    const sheet = {
      '!ref': 'A1:B2',
      A1: { t: 's', v: 'Mes' }, B1: { t: 's', v: 'Mes largo' },
      A2: { t: 'n', v: serie(2025, 4, 1), z: 'mmm' },
      B2: { t: 'n', v: serie(2025, 4, 1), z: '[$-es-ES]mmmm' }
    };
    expect(filas(sheet)[1]).toEqual(['2025/04', '2025/04']);
  });

  it('una duracion en minutos o segundos acumulados conserva el texto de Excel, no se pliega a un reloj', () => {
    const sheet = {
      '!ref': 'A1:C2',
      A1: { t: 's', v: 'Duracion' }, B1: { t: 's', v: 'Minutos' }, C1: { t: 's', v: 'Hora' },
      A2: { t: 'n', v: 1 / 24, z: '[mm]:ss' },
      B2: { t: 'n', v: 1 / 24, z: 'mm:ss' },
      C2: { t: 'n', v: 13 / 24, z: 'hh:mm:ss' }
    };
    const formateado = X.utils.sheet_to_json(sheet, { header: 1, raw: false })[1];
    const resultado = filas(sheet)[1];
    // 60 minutos seguirian siendo "60:00" (rechazado por el parser), no una hora 01 valida.
    expect(resultado[0]).toBe(formateado[0]);
    expect(resultado[0]).not.toBe('01:00');
    expect(resultado[1]).toBe(formateado[1]);
    expect(resultado[2]).toBe('13:00');
  });

  it('las celdas vacias materializadas (stubs) y las combinadas no desplazan ni cambian nada', () => {
    const sheet = {
      '!ref': 'A1:C3',
      '!merges': [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }],
      A1: { t: 's', v: 'Fecha' }, B1: { t: 's', v: 'Hora' }, C1: { t: 's', v: 'Consumo' },
      A2: { t: 'n', v: serie(2025, 4, 1), z: 'd/m/yy' },
      B2: { t: 'z' },
      C2: { t: 'n', v: 1.2349, z: '0.0' },
      B3: { t: 'n', v: 2 },
      C3: { t: 'z' }
    };
    const esperado = X.utils.sheet_to_json(sheet, { header: 1, raw: false });
    esperado[1][0] = '01/04/2025';
    esperado[1][2] = '1.2349';
    expect(filas(sheet)).toEqual(esperado);
  });

  it('con una libreria sin utilidades de celda (mocks) devuelve lo mismo que raw:false', () => {
    const datos = [['Fecha', 'Hora', 'Consumo'], ['01/01/2026', '1', '0,5']];
    const falso = { utils: { sheet_to_json: () => datos } };
    expect(window.LF.csvUtils.xlsxRowsFromSheet({ '!ref': 'A1:C2' }, falso)).toBe(datos);
  });
});
