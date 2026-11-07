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

  it('el resultado no depende del orden de las filas (fichero descendente)', () => {
    // La hora 25 se decide antes de recorrer las filas: en orden descendente la marca 03:00 del
    // 26/10 llega antes que las dos 02:00 y, si se decidiera sobre la marcha, chocaria con la
    // hora 3 y cancelaria la importacion por "filas duplicadas".
    const rows = buildRows(Date.UTC(2025, 8, 30, 22), Date.UTC(2025, 9, 31, 23), 'end');
    const desc = [rows[0], ...rows.slice(1).reverse()];
    const clave = (res) => res.records.map(r => `${r.fecha.getMonth()}|${r.fecha.getDate()}|${r.hora}|${r.periodo}`).sort();
    const asc = parse(rows);
    const inv = parse(desc);
    expect(inv.records.length).toBe(745);
    expect(clave(inv)).toEqual(clave(asc));

    // Sin INV/VER tampoco se cancela; las dos lecturas repetidas se reparten por orden de aparicion,
    // como en la lectura de hora inicial.
    const sinInv = desc.map(r => r.filter((_, k) => k !== 2));
    const res = parse(sinInv);
    expect(res.records.length).toBe(745);
    const horas26 = res.records.filter(r => r.fecha.getMonth() === 9 && r.fecha.getDate() === 26).map(r => r.hora).sort((a, b) => a - b);
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

/**
 * Equivalencia entre convenciones, con reloj real en Peninsula y en Canarias. La misma lectura
 * horaria escrita con marca inicial o final debe producir el mismo registro (dia, hora CNMC,
 * kWh, periodo). Cubre los dos cambios de hora: en primavera la lectura anterior al salto se
 * rotula con la hora saltada (03:00 en Peninsula, 02:00 en Canarias) porque la intermedia no
 * existe, y en otono la marca repetida cambia de hora en cada zona.
 */
const reloj = (tz) => (ms) => {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset'
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  const off = (o.timeZoneName.match(/([+-]\d\d)/) || [])[1];
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, verano: tz === 'Europe/Madrid' ? off === '+02' : off === '+01' };
};
const inicioMes = (tz, y, m) => {
  const loc = reloj(tz);
  for (let t = Date.UTC(y, m - 1, 1) - 3 * HOUR; t < Date.UTC(y, m - 1, 1) + 3 * HOUR; t += HOUR) {
    const p = loc(t);
    if (p.y === y && p.m === m && p.d === 1 && p.h === 0) return t;
  }
  throw new Error('inicio de mes no encontrado');
};

describe('Misma curva en marca final e inicial (Peninsula, Canarias y Ceuta/Melilla)', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });
  const casos = [];
  // Ceuta y Melilla comparten reloj con la Peninsula; su periodo se recalcula y la hora final se
  // detecta por la forma del fichero, no por la columna PERIODO.
  for (const [zona, tz] of [['Península', 'Europe/Madrid'], ['Canarias', 'Atlantic/Canary'], ['CeutaMelilla', 'Europe/Madrid']]) {
    // 2024-03: el cambio de hora cae el ultimo dia del mes (31/03), y su 23:00 coincide en tiempo real
    // con la 00:00 del 1/04.
    for (const [y, m] of [[2024, 3], [2025, 3], [2025, 4], [2025, 10], [2025, 11], [2026, 3]]) casos.push([zona, tz, y, m]);
  }
  it.each(casos)('%s %s %i-%i', (zona, tz, y, m) => {
    const loc = reloj(tz);
    const t0 = inicioMes(tz, y, m);
    const t1 = inicioMes(tz, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
    const build = (conv) => {
      const rows = [HEADER];
      let i = 0;
      for (let t = t0; t < t1; t += HOUR, i++) {
        const ini = loc(t);
        const marca = conv === 'end' ? loc(t + HOUR) : ini;
        rows.push(['test', stamp(marca), marca.verano ? '1' : '0', periodoDe(ini), String(1000 + i), '0']);
      }
      return rows;
    };
    const clave = (res) => res.records.map(r => `${r.fecha.getDate()}|${r.hora}|${r.kwh.toFixed(3)}|${r.periodo}`).sort();
    const fin = u.parseEnergyTableRows(build('end'), { headerRowIndex: 0, zonaFiscal: zona });
    const ini = u.parseEnergyTableRows(build('start'), { headerRowIndex: 0, zonaFiscal: zona });
    expect(fin.warnings.some(w => /hora final/i.test(w))).toBe(true);
    expect(ini.warnings.some(w => /hora final/i.test(w))).toBe(false);
    expect(fin.records.length).toBe(ini.records.length);
    expect(clave(fin)).toEqual(clave(ini));
    expect(new Set(fin.records.map(r => r.fecha.getMonth() + 1))).toEqual(new Set([m]));
  });
});

describe('Ceuta y Melilla: hora final por la forma del fichero', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });
  const parseCM = (rows) => u.parseEnergyTableRows(rows, { headerRowIndex: 0, zonaFiscal: 'CeutaMelilla' });
  const hayAviso = (res) => res.warnings.some(w => /hora final/i.test(w));

  it('noviembre en hora final: 30 dias y periodos con el horario de Ceuta', () => {
    const res = parseCM(buildRows(Date.UTC(2025, 9, 31, 23), Date.UTC(2025, 10, 30, 23), 'end'));
    expect(hayAviso(res)).toBe(true);
    expect(res.records.some(r => r.fecha.getMonth() === 11)).toBe(false);
    expect(new Set(res.records.map(r => r.fecha.getDate())).size).toBe(30);
    // Lunes 03/11/2025: la lectura 10:00-11:00 (marca 11:00) es llano en Ceuta y la 11:00-12:00 punta.
    const lunes = (h) => res.records.find(r => r.fecha.getDate() === 3 && r.hora === h);
    expect(lunes(11).periodo).toBe('P2');
    expect(lunes(12).periodo).toBe('P1');
  });

  it('SALVAGUARDA: hora inicial con la primera lectura perdida (01:00 ... 23:00) no se toca', () => {
    const rows = buildRows(Date.UTC(2025, 9, 31, 23), Date.UTC(2025, 10, 30, 23), 'start');
    rows.splice(1, 1); // fuera la 00:00 del dia 1: ahora empieza a las 01:00 y acaba a las 23:00
    expect(rows[1][1]).toBe('2025/11/01 01:00');
    expect(hayAviso(parseCM(rows))).toBe(false);
  });

  it('SALVAGUARDA: un fichero que empieza a mitad de dia no da la senal', () => {
    const rows = buildRows(Date.UTC(2025, 10, 1, 13), Date.UTC(2025, 10, 30, 23), 'end');
    expect(rows[1][1]).toBe('2025/11/01 15:00');
    expect(hayAviso(parseCM(rows))).toBe(false);
  });
});

describe('Aviso de duplicados el dia del cambio de hora de octubre', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });
  const mensaje = (rows, zona) => {
    try { u.parseEnergyTableRows(rows, { headerRowIndex: 0, zonaFiscal: zona }); return null; } catch (e) { return e.message; }
  };

  it('un fichero peninsular importado con Canarias sugiere revisar la zona', () => {
    const msg = mensaje(buildRows(Date.UTC(2025, 8, 30, 22), Date.UTC(2025, 9, 31, 23), 'end'), 'Canarias');
    expect(msg).toMatch(/filas duplicadas para la misma fecha y hora \(2025-10-26/);
    expect(msg).toMatch(/cambio de hora de octubre/);
    expect(msg).toMatch(/cambia la zona/);
    // La categoria de analitica sigue siendo la misma.
    expect(u.csvErrorCodeForTracking(msg)).toBe('periodo-duplicado');
  });

  it('un duplicado en un dia normal conserva el consejo de siempre', () => {
    const rows = buildRows(Date.UTC(2025, 9, 31, 23), Date.UTC(2025, 10, 30, 23), 'end');
    rows.push([...rows[100]]);
    const msg = mensaje(rows, 'Península');
    expect(msg).toMatch(/filas duplicadas/);
    expect(msg).not.toMatch(/cambio de hora/);
    expect(msg).toMatch(/se exportó o se pegó dos veces/);
  });
});
