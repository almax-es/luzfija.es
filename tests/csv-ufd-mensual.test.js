import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// UFD (Naturgy) "consumptions.xlsx" con granularidad MENSUAL (14/11/2026). Llego por el aviso de
// importacion fallida ("No se identificó la columna obligatoria de hora") y se implemento a partir
// de la cabecera y la muestra anonimizada del aviso, sin el fichero. La hoja se llama
// "consumptions"; las celdas se escriben como texto, igual que en el XLSX horario de UFD del mismo
// portal (todas t="str", decimal con coma).
const require = createRequire(import.meta.url);
globalThis.XLSX = require('../vendor/xlsx/xlsx.full.min.js');
import '../js/lf-config.js';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';
import '../js/lf-csv-import.js';
import '../js/bv/bv-import.js';

const X = globalThis.XLSX;
const u = () => window.LF.csvUtils;

const CABECERA = [
  'Código universal de punto de suministro', 'Fecha', 'Consumo (kWh)',
  'P1 (kWh)', 'P2 (kWh)', 'P3 (kWh)', 'Método de obtención'
];
// Muestra literal del aviso (CUPS sustituido).
const MUESTRA = [
  ['11/2025', '454,64', '147,27', '119,37', '188,00', 'Estimado'],
  ['12/2025', '365,57', '161,85', '112,76', '90,96', 'Estimado'],
  ['01/2026', '865,56', '279,47', '206,30', '379,79', 'Estimado'],
  ['02/2026', '568,51', '195,77', '155,66', '217,09', 'Estimado'],
  ['03/2026', '492,40', '169,62', '124,05', '198,73', 'Estimado'],
  ['04/2026', '255,91', '83,82', '94,18', '77,91', 'Estimado']
];
const CUPS = 'ES0000000000000000XX0F';

function ficheroXlsx(filas, cabecera = CABECERA) {
  const aoa = [cabecera, ...filas.map((f) => [CUPS, ...f])];
  const ws = X.utils.aoa_to_sheet(aoa.map((f) => f.map(() => null)));
  aoa.forEach((fila, r) => fila.forEach((v, c) => {
    ws[X.utils.encode_cell({ r, c })] = { t: 's', v };
  }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'consumptions');
  return new File([X.write(wb, { type: 'array', bookType: 'xlsx' })], 'consumptions.xlsx');
}

const parse = (filas, opciones = {}) => u().parseEnergyTableRows(
  [CABECERA, ...filas.map((f) => [CUPS, ...f])],
  { headerRowIndex: 0, today: new Date(2026, 10, 14), ...opciones }
);

describe('UFD mensual: importacion completa con un XLSX real', () => {
  it('la home suma P1/P2/P3 de los 6 meses y cuenta los dias naturales', async () => {
    const r = await window.LF.procesarXLSXConsumos(ficheroXlsx(MUESTRA));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    // P1 = 147,27+161,85+279,47+195,77+169,62+83,82
    expect(r.punta).toBe('1037,80');
    expect(r.llano).toBe('812,32');
    expect(r.valle).toBe('1152,48');
    expect(r.totalKwh).toBe('3002,60');
    // nov 30 + dic 31 + ene 31 + feb 28 + mar 31 + abr 30
    expect(r.dias).toBe(181);
    expect(r.isDatadisMonthly).toBe(true);
    expect(r.consumosHorarios).toBeNull();
    expect(r.tieneExcedentes).toBe(false);
    // Sin "36 estimadas": el Estimado se avisa por meses, no por registros sinteticos.
    expect(r.datosReales + r.datosEstimados).toBe(0);
    expect(r.warnings.join('\n')).toMatch(/marca como «Estimado» todos los meses/);
    expect(r.warnings.join('\n')).toMatch(/cada mes como completo/);
  });

  it('el simulador solar lo importa como consumo mensual sin excedentes', async () => {
    const r = await window.BVSim.importFile(ficheroXlsx(MUESTRA), 'Península');
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.meta.isDatadisMonthly).toBe(true);
    expect(r.meta.hasExcedenteColumn).toBe(false);
    expect(r.records.every((rec) => rec.excedente === 0)).toBe(true);
  });
});

describe('UFD mensual: parser', () => {
  it('detecta el formato por la cabecera normalizada del aviso', () => {
    expect(u().isMonthlyPeriodColumnsFormat([
      'codigo_universal_de_punto_de_suministro', 'fecha', 'consumo_kwh',
      'p1_kwh', 'p2_kwh', 'p3_kwh', 'metodo_de_obtencion'
    ])).toBe(true);
  });

  it('no captura una curva horaria que ademas traiga columnas por periodo', () => {
    expect(u().isMonthlyPeriodColumnsFormat(['fecha', 'hora', 'p1_kwh', 'p2_kwh', 'p3_kwh'])).toBe(false);
  });

  it('descarta el mes en curso y lo avisa', () => {
    const res = parse([...MUESTRA, ['11/2026', '100,00', '30,00', '30,00', '40,00', 'Estimado']]);
    const meses = new Set(res.records.map((r) => `${r.fecha.getFullYear()}-${r.fecha.getMonth() + 1}`));
    expect(meses.has('2026-11')).toBe(false);
    expect(res.records).toHaveLength(18);
    expect(res.warnings.join('\n')).toMatch(/Se ha descartado noviembre 2026/i);
  });

  it('solo con el mes en curso, rechaza en vez de importar nada', () => {
    expect(() => parse([['11/2026', '100,00', '30,00', '30,00', '40,00', 'Real']]))
      .toThrow(/solo trae el mes en curso/);
  });

  it('distingue meses reales y estimados', () => {
    const res = parse([
      ['01/2026', '10,00', '3,00', '3,00', '4,00', 'Real'],
      ['02/2026', '10,00', '3,00', '3,00', '4,00', 'Estimado']
    ]);
    expect(res.warnings.join('\n')).toMatch(/1 de 2 meses \(febrero 2026\)/i);
  });

  it('sin meses estimados no hay aviso de Estimado', () => {
    const res = parse([['01/2026', '10,00', '3,00', '3,00', '4,00', 'Real']]);
    expect(res.warnings.join('\n')).not.toMatch(/Estimado/);
  });

  it('rechaza un total que no cuadra con P1+P2+P3', () => {
    expect(() => parse([['01/2026', '12,00', '3,00', '3,00', '4,00', 'Real']]))
      .toThrow(/no coincide con P1 \+ P2 \+ P3/);
  });

  it('rechaza un mes duplicado', () => {
    expect(() => parse([MUESTRA[0], MUESTRA[0]])).toThrow(/mes duplicado/);
  });

  it('rechaza un periodo vacio o negativo', () => {
    expect(() => parse([['01/2026', '10,00', '', '6,00', '4,00', 'Real']])).toThrow(/"P1" no contiene un número válido/);
    expect(() => parse([['01/2026', '10,00', '3,00', '-3,00', '10,00', 'Real']])).toThrow(/"P2" no contiene/);
  });

  it('rechaza datos diarios (fecha completa que no es dia 1)', () => {
    expect(() => parse([['01/01/2026', '10,00', '3,00', '3,00', '4,00', 'Real'], ['02/01/2026', '10,00', '3,00', '3,00', '4,00', 'Real']]))
      .toThrow(/fecha no reconocida.*02\/01\/2026/s);
  });

  it('acepta el mes guardado como fecha de dia 1 y como AAAA/MM', () => {
    const res = parse([['01/01/2026', '10,00', '3,00', '3,00', '4,00', 'Real'], ['2026/02', '10,00', '3,00', '3,00', '4,00', 'Real']]);
    expect(res.records).toHaveLength(6);
  });

  it('rechaza un resumen 3.0TD con P4-P6', () => {
    const cab = ['Fecha', 'P1 (kWh)', 'P2 (kWh)', 'P3 (kWh)', 'P4 (kWh)', 'P5 (kWh)', 'P6 (kWh)'];
    expect(() => u().parseEnergyTableRows([cab, ['01/2026', '1', '1', '1', '1', '1', '1']], { headerRowIndex: 0 }))
      .toThrow(/3\.0TD/);
  });
});
