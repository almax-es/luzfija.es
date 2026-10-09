import { describe, it, expect, beforeAll } from 'vitest';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

/**
 * Ficheros fecha-hora con marcas de HORA FINAL (ronda 70, 09/10/2026).
 *
 * Forma real (XLSX de distribuidora con INV / VER, PERIODO TARIFARIO y valores en Wh): la
 * primera lectura del periodo lleva 01:00 y la ultima, 00:00 del dia siguiente. El PERIODO del
 * propio fichero lo prueba (punta empieza en la marca 11:00). Leidas como hora inicial, la
 * lectura de las 00:00 caia en el dia siguiente: un fichero de noviembre llegaba con un 1 de
 * diciembre (31 dias en la home, un mes fantasma de 1 dia en el simulador) y el cruce horario
 * con precios usaba el precio de la hora vecina (+23 % en excedentes indexados medido).
 *
 * El generador de marcas es independiente del parser: recorre instantes UTC y los formatea en
 * Europe/Madrid, de modo que el 26/10/2025 trae 25 marcas con la 02:00 repetida y su INV/VER.
 */

const HEADER = ['CUPS', 'FECHA-HORA', 'INV / VER', 'PERIODO TARIFARIO', 'CONSUMO Wh', 'GENERACION Wh'];

const parts = (ms) => {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset'
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, verano: /\+02/.test(o.timeZoneName) };
};

const FESTIVOS = new Set(['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25']);
// Periodo 2.0TD del instante de INICIO de la lectura, calculado aqui y no con el parser.
const periodoDe = ({ y, m, d, h }) => {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (dow === 0 || dow === 6 || FESTIVOS.has(mmdd)) return 'Valle';
  if ((h >= 10 && h < 14) || (h >= 18 && h < 22)) return 'Punta';
  if ((h >= 8 && h < 10) || (h >= 14 && h < 18) || h >= 22) return 'Llano';
  return 'Valle';
};
const stamp = ({ y, m, d, h }) =>
  `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:00`;

const HOUR = 3600 * 1000;

// Mes completo: instantes UTC [inicio, fin), una lectura por hora, 1 kWh (1000 Wh) cada una.
function buildRows(startUtc, endUtc, convention) {
  const rows = [HEADER];
  for (let t = startUtc; t < endUtc; t += HOUR) {
    const ini = parts(t);
    const marca = convention === 'end' ? parts(t + HOUR) : ini;
    rows.push(['test', stamp(marca), marca.verano ? '1' : '0', periodoDe(ini), '1000', '0']);
  }
  return rows;
}

describe('Marcas de hora final en ficheros fecha-hora con PERIODO', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });
  const parse = (rows) => u.parseEnergyTableRows(rows, { headerRowIndex: 0, zonaFiscal: 'Península' });
  const dias = (records) => new Set(records.map(r => `${r.fecha.getFullYear()}-${r.fecha.getMonth() + 1}-${r.fecha.getDate()}`)).size;

  it('noviembre completo: la marca 00:00 final es la hora 24 del 30/11, no un 1 de diciembre', () => {
    const rows = buildRows(Date.UTC(2025, 9, 31, 23), Date.UTC(2025, 10, 30, 23), 'end');
    expect(rows.length - 1).toBe(720);
    expect(rows[1][1]).toBe('2025/11/01 01:00');
    expect(rows[rows.length - 1][1]).toBe('2025/12/01 00:00');

    const res = parse(rows);
    expect(res.records.length).toBe(720);
    expect(res.records.some(r => r.fecha.getMonth() === 11)).toBe(false);
    expect(dias(res.records)).toBe(30);
    const ultima = res.records.find(r => r.fecha.getDate() === 30 && r.hora === 24);
    expect(ultima).toBeTruthy();
    expect(res.warnings.some(w => /hora final/i.test(w))).toBe(true);
    // El reparto por periodo sale de la columna del fichero y no cambia.
    const kwh = (p) => res.records.filter(r => r.periodo === p).reduce((s, r) => s + r.kwh, 0);
    expect(kwh('P1') + kwh('P2') + kwh('P3')).toBeCloseTo(720, 6);
  });

  it('octubre con cambio de hora: 25 horas el 26/10, sin duplicados y sin desbordar a noviembre', () => {
    // 01/10 00:00 local (CEST) = 30/09 22:00Z; 01/11 00:00 local (CET) = 31/10 23:00Z.
    const rows = buildRows(Date.UTC(2025, 8, 30, 22), Date.UTC(2025, 9, 31, 23), 'end');
    expect(rows.length - 1).toBe(745);
    const dia26 = rows.filter(r => String(r[1]).startsWith('2025/10/26')).map(r => r[1].slice(11) + '/' + r[2]);
    expect(dia26).toContain('02:00/1');
    expect(dia26).toContain('02:00/0');

    const res = parse(rows);
    expect(res.records.length).toBe(745);
    expect(res.records.some(r => r.fecha.getMonth() === 10)).toBe(false);
    expect(dias(res.records)).toBe(31);
    const horas26 = res.records.filter(r => r.fecha.getDate() === 26).map(r => r.hora).sort((a, b) => a - b);
    expect(horas26).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('CONTROL NEGATIVO: el mismo fichero con marcas de hora INICIAL no se toca', () => {
    const rows = buildRows(Date.UTC(2025, 9, 31, 23), Date.UTC(2025, 10, 30, 23), 'start');
    expect(rows[1][1]).toBe('2025/11/01 00:00');
    expect(rows[rows.length - 1][1]).toBe('2025/11/30 23:00');
    const res = parse(rows);
    expect(res.records.length).toBe(720);
    expect(dias(res.records)).toBe(30);
    expect(res.records.find(r => r.fecha.getDate() === 1 && r.hora === 1)).toBeTruthy();
    expect(res.warnings.some(w => /hora final/i.test(w))).toBe(false);
  });

  it('SALVAGUARDA: sin evidencia suficiente en el periodo (solo fin de semana) se conserva la lectura historica', () => {
    // 01-02/11/2025 son sabado y domingo: todo valle, la columna no distingue las dos lecturas.
    const rows = buildRows(Date.UTC(2025, 9, 31, 23), Date.UTC(2025, 10, 2, 23), 'end');
    const res = parse(rows);
    expect(res.warnings.some(w => /hora final/i.test(w))).toBe(false);
  });
});
