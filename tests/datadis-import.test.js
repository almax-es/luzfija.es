import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Importacion directa desde Datadis (js/lf-datadis.js).
 *
 * Los fixtures reproducen lo MEDIDO contra la API real (29-30/10/2026): errores de login como
 * HTTP 500 con { message }, dia de 23 h que SALTA la etiqueta 03 y dia de 25 h que la REPITE.
 * Ninguna prueba toca la red.
 */

// ---- Entorno minimo (mismo patron que csv-import.test.js) ----
class MockFileReader {
  readAsText(file) {
    setTimeout(() => { this.onload({ target: { result: file._content || '' } }); }, 0);
  }
  readAsArrayBuffer() { setTimeout(() => { this.onload({ target: { result: new ArrayBuffer(8) } }); }, 0); }
}

global.window = {
  LF: {
    toast: vi.fn(),
    round2: (n) => Math.round(n * 100) / 100,
    csvUtils: {}
  }
};
global.lfDbg = vi.fn();
global.FileReader = MockFileReader;

new Function('window', fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8'))(global.window);
new Function('window', 'lfDbg', 'FileReader',
  fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8'))(global.window, global.lfDbg, MockFileReader);

const realProcesar = global.window.LF.procesarCSVConsumos;

const storage = new Map();
const almacen = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};
vi.stubGlobal('localStorage', almacen);
const fallosGuardados = () => (storage.has('lf_datadis_fallos') ? JSON.parse(storage.get('lf_datadis_fallos')).n : 0);

const sourceDatadis = fs.readFileSync(path.resolve(__dirname, '../js/lf-datadis.js'), 'utf8');
function cargarModulo() {
  new Function('window', 'document', sourceDatadis)(global.window, { getElementById: () => null });
  return global.window.LF.datadis;
}
let D = cargarModulo();

// ---- Fixtures ----
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

/** Ultimo domingo de marzo/octubre de ese ano (cambios de hora, Orden PCM/186/2022 y siguientes). */
function ultimoDomingo(y, mes) {
  const d = new Date(y, mes, 0);
  return d.getDate() - d.getDay();
}
/** 'primavera' (23 h) | 'otono' (25 h) | 'normal', con la fecha REAL del cambio de cada ano. */
function tipoDia(f) {
  const [y, m, d] = f.split('/').map(Number);
  if (m === 3 && d === ultimoDomingo(y, 3)) return 'primavera';
  if (m === 10 && d === ultimoDomingo(y, 10)) return 'otono';
  return 'normal';
}

/** timeCurve de un dia con las etiquetas reales de Datadis. */
function diaDatadis(fecha, { kwh = 0.5, tipo = 'normal', surplus = null } = {}) {
  let etiquetas = Array.from({ length: 24 }, (_, i) => i + 1);
  if (tipo === 'primavera') etiquetas = etiquetas.filter((h) => h !== 3);
  if (tipo === 'otono') etiquetas = [1, 2, 3, 3, ...Array.from({ length: 21 }, (_, i) => i + 4)];
  return etiquetas.map((h) => ({
    cups: 'ES0000000000000000AB',
    date: fecha,
    time: `${pad(h)}:00`,
    consumptionKWh: kwh,
    obtainMethod: 'Real',
    surplusEnergyKWh: surplus,
    generationEnergyKWh: null,
    selfConsumptionEnergyKWh: null
  }));
}

function añoCompleto(rango, opciones = {}) {
  const [y0, m0, d0] = rango.iniYmd.split('/').map(Number);
  const [y1, m1, d1] = rango.finYmd.split('/').map(Number);
  const filas = [];
  for (let d = new Date(y0, m0 - 1, d0); d <= new Date(y1, m1 - 1, d1); d.setDate(d.getDate() + 1)) {
    const f = ymd(d);
    const tipo = tipoDia(f);
    filas.push(...diaDatadis(f, { tipo, ...opciones }));
  }
  return filas;
}

// ---- Tests de las utilidades puras ----
describe('rangoUltimosDias', () => {
  it('termina AYER y abarca exactamente 365 dias', () => {
    const r = D.rangoUltimosDias(new Date(2026, 9, 30));
    expect(r.finYmd).toBe('2026/10/29');
    expect(r.iniYmd).toBe('2025/10/30');
    expect(r.iniMes).toBe('2025/10');
    expect(r.finMes).toBe('2026/10');
    const [a, b] = [r.iniYmd, r.finYmd].map((s) => { const [y, m, d] = s.split('/').map(Number); return new Date(y, m - 1, d); });
    expect(Math.round((b - a) / 86400000) + 1).toBe(365);
  });

  it('cruza correctamente el cambio de mes y de año', () => {
    const r = D.rangoUltimosDias(new Date(2027, 0, 1));
    expect(r.finYmd).toBe('2026/12/31');
    expect(r.finMes).toBe('2026/12');
  });
});

describe('construirCsv', () => {
  it('dia normal: horas 1..24, decimal con coma, sin CUPS reales', () => {
    const { csv, filasUsadas } = D.construirCsv(diaDatadis('2026/05/10', { kwh: 0.622 }));
    const lineas = csv.trim().split('\r\n');
    expect(lineas[0]).toBe('CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion');
    expect(lineas[1]).toBe('CUPS;10/05/2026;1;0,622;Real');
    expect(lineas[24]).toBe('CUPS;10/05/2026;24;0,622;Real');
    expect(filasUsadas).toBe(24);
    expect(csv).not.toContain('ES0000000000000000AB');
  });

  it('dia de 23 h: conserva el salto de la etiqueta 03 (no desplaza el resto)', () => {
    const { csv, filasUsadas } = D.construirCsv(diaDatadis('2026/03/29', { tipo: 'primavera' }));
    const horas = csv.trim().split('\r\n').slice(1).map((l) => Number(l.split(';')[2]));
    expect(filasUsadas).toBe(23);
    expect(horas.slice(0, 4)).toEqual([1, 2, 4, 5]);
    expect(horas.at(-1)).toBe(24);
    expect(horas).not.toContain(3);
  });

  it('dia de 25 h: numera 1..25 cronologicamente (la etiqueta 03 llega repetida)', () => {
    const { csv, filasUsadas } = D.construirCsv(diaDatadis('2026/10/25', { tipo: 'otono' }));
    const horas = csv.trim().split('\r\n').slice(1).map((l) => Number(l.split(';')[2]));
    expect(filasUsadas).toBe(25);
    expect(horas).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('omite las lecturas sin consumo en vez de inventar un 0', () => {
    const filas = diaDatadis('2026/05/10');
    filas[4].consumptionKWh = null;
    filas[5].consumptionKWh = undefined;
    const { filasUsadas } = D.construirCsv(filas);
    expect(filasUsadas).toBe(22);
  });

  it('solo anade la columna de excedentes si hay excedentes reales', () => {
    expect(D.construirCsv(diaDatadis('2026/05/10')).csv.split('\r\n')[0]).not.toContain('Energia_vertida_kWh');
    expect(D.construirCsv(diaDatadis('2026/05/10')).hayExcedentes).toBe(false);

    const conSol = diaDatadis('2026/05/10');
    conSol[12].surplusEnergyKWh = 0.8;
    const r = D.construirCsv(conSol);
    expect(r.hayExcedentes).toBe(true);
    const lineas = r.csv.trim().split('\r\n');
    expect(lineas[0]).toBe('CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion;Energia_vertida_kWh');
    expect(lineas[13].split(';')[5]).toBe('0,8');
    expect(lineas[1].split(';')[5]).toBe('0');
  });

  it('filtra al rango pedido y descarta filas malformadas', () => {
    const rango = { iniYmd: '2026/05/10', finYmd: '2026/05/10' };
    const filas = [...diaDatadis('2026/05/09'), ...diaDatadis('2026/05/10'), ...diaDatadis('2026/05/11'), { date: 'x' }, null];
    const r = D.construirCsv(filas, rango);
    expect(r.filasUsadas).toBe(24);
    expect(r.diasConDatos).toBe(1);
  });

  it('un metodo de obtencion desconocido se marca como estimado (nada libre llega al CSV)', () => {
    const filas = diaDatadis('2026/05/10');
    filas[0].obtainMethod = 'Real;DROP';
    const csv = D.construirCsv(filas).csv;
    expect(csv).not.toContain('DROP');
    expect(csv.split('\r\n')[1].endsWith(';Estimada')).toBe(true);
  });
});

describe('rarezas de distribuidoras', () => {
  it('fila 00:00 de mas en un dia que ya trae sus 24 horas: se descarta SIN renumerar el dia', () => {
    const filas = [{ ...diaDatadis('2026/05/10')[0], time: '00:00', consumptionKWh: '' }, ...diaDatadis('2026/05/10', { kwh: 0.7 })];
    const { csv, filasUsadas } = D.construirCsv(filas);
    const horas = csv.trim().split('\r\n').slice(1).map((l) => Number(l.split(';')[2]));
    expect(filasUsadas).toBe(24);
    expect(horas).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('fila 00:00 de mas el dia del cambio de hora de octubre: sigue siendo un dia de 25 h', () => {
    const filas = [{ ...diaDatadis('2026/10/25')[0], time: '00:00' }, ...diaDatadis('2026/10/25', { tipo: 'otono' })];
    const horas = D.construirCsv(filas).csv.trim().split('\r\n').slice(1).map((l) => Number(l.split(';')[2]));
    expect(horas).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('consumo vacio ("") es "sin dato", no 0 kWh; un numero en texto con coma si vale', () => {
    const filas = diaDatadis('2026/05/10');
    filas[0].consumptionKWh = '';
    filas[1].consumptionKWh = '0,125';
    const { csv, filasUsadas } = D.construirCsv(filas);
    expect(filasUsadas).toBe(23);
    expect(csv).toContain('CUPS;10/05/2026;2;0,125;Real');
    const rango = { iniYmd: '2026/05/10', finYmd: '2026/05/10', iniMes: '2026/05', finMes: '2026/05' };
    expect(D.evaluarCobertura(filas, rango).meses[0].horas).toBe(23);
  });

  it('Datadis rechaza consultas que empiezan hace mas de 2 anos POR MES', () => {
    const hoy = new Date(2026, 9, 30);
    expect(D.inicioMasAntiguo(hoy)).toEqual(new Date(2024, 10, 1));
    expect(D.inicioMasAntiguo(new Date(2026, 9, 1))).toEqual(new Date(2024, 9, 1));
    expect(D.rangoPersonalizado('2024-10-31', '2025-10-30', hoy).error).toBe('antiguo');
    expect(D.rangoPersonalizado('2024-11-01', '2025-10-31', hoy).rango).toBeTruthy();
  });

  it('con varios contratos usa el vigente (sin fecha de fin o el mas reciente)', () => {
    const resp = { contract: [
      { startDate: '2026/07/16', endDate: '', contractedPowerkW: [4.6, 4.6], selfConsumptionTypeDesc: 'Con excedentes y compensación Individual - Consumo' },
      { startDate: '2020/01/01', endDate: '2026/07/15', contractedPowerkW: [3.3, 3.3], selfConsumptionTypeCode: '00' }
    ] };
    expect(D.leerPotencias(resp)).toEqual({ p1: 4.6, p2: 4.6 });
    expect(D.leerAutoconsumo(resp)).toBe('con');
    const cerrados = { contract: [
      { startDate: '2021/01/01', endDate: '2022/01/01', contractedPowerkW: [3.3] },
      { startDate: '2023/05/01', endDate: '2024/01/01', contractedPowerkW: [5.75] }
    ] };
    expect(D.leerPotencias(cerrados)).toEqual({ p1: 5.75, p2: 5.75 });
  });
});

describe('integracion con el parser canonico', () => {
  it('365 dias con los dos cambios de hora: el importador los acepta y cuenta 8760 lecturas', async () => {
    const rango = D.rangoUltimosDias(new Date(2026, 9, 30));
    const { csv, filasUsadas } = D.construirCsv(añoCompleto(rango), rango);
    expect(filasUsadas).toBe(365 * 24); // 363*24 + 23 + 25
    const r = await realProcesar({ name: 'datadis.csv', _content: csv });
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(365);
    expect(r.datosReales).toBe(8760);
    expect(r.datosEstimados).toBe(0);
    expect(Number(String(r.totalKwh).replace(/\./g, '').replace(',', '.'))).toBeCloseTo(4380, 1);
  });

  it('el dia de primavera no pierde ni desplaza ninguna hora en la curva horaria', async () => {
    const rango = { iniYmd: '2026/03/28', finYmd: '2026/03/30', iniMes: '2026/03', finMes: '2026/03' };
    const filas = [...diaDatadis('2026/03/28'), ...diaDatadis('2026/03/29', { tipo: 'primavera' }), ...diaDatadis('2026/03/30')];
    const r = await realProcesar({ name: 'datadis.csv', _content: D.construirCsv(filas, rango).csv });
    expect(r.ok).toBe(true);
    const dia29 = (r.consumosHorarios || []).filter((c) => `${c.fecha.getFullYear()}-${pad(c.fecha.getMonth() + 1)}-${pad(c.fecha.getDate())}` === '2026-03-29');
    expect(dia29.length).toBe(23);
    expect(dia29.map((c) => c.hora)).not.toContain(3);
  });
});

describe('documento (NIF/NIE/CIF)', () => {
  it('normaliza mayusculas, espacios, puntos y guiones', () => {
    expect(D.normalizarDocumento(' 12.345.678-z ')).toBe('12345678Z');
    expect(D.normalizarDocumento('x-1234567-l')).toBe('X1234567L');
  });
  it('acepta DNI y NIE con letra correcta y deja pasar CIF y formatos raros', () => {
    expect(D.errorDocumento('12345678Z')).toBe('');
    expect(D.errorDocumento('X1234567L')).toBe('');
    expect(D.errorDocumento('Y0000000Z')).toBe('');
    expect(D.errorDocumento('B12345678')).toBe('');
    expect(D.errorDocumento('K1234567S')).toBe('');
  });
  it('detecta letra de control erronea, DNI sin letra y vacio', () => {
    expect(D.errorDocumento('12345678A')).toBe('letra');
    expect(D.errorDocumento('X1234567A')).toBe('letra');
    expect(D.errorDocumento('12345678')).toBe('sinletra');
    expect(D.errorDocumento('')).toBe('vacio');
  });
});

describe('leerPotencias', () => {
  it('lee P1 y P2 del contrato', () => {
    expect(D.leerPotencias({ contract: [{ contractedPowerkW: [3.45, 4.6] }] })).toEqual({ p1: 3.45, p2: 4.6 });
  });
  it('si solo hay P1 usa la misma para P2', () => {
    expect(D.leerPotencias({ contract: [{ contractedPowerkW: [5.75] }] })).toEqual({ p1: 5.75, p2: 5.75 });
  });
  it('rechaza valores no creibles o respuestas sin contrato', () => {
    expect(D.leerPotencias({ contract: [{ contractedPowerkW: [0, 3] }] })).toBeNull();
    expect(D.leerPotencias({ contract: [{ contractedPowerkW: [500, 3] }] })).toBeNull();
    expect(D.leerPotencias({ contract: [] })).toBeNull();
    expect(D.leerPotencias(null)).toBeNull();
    expect(D.leerPotencias({ contract: [{ contractedPowerkW: ['3,45'] }] })).toBeNull();
  });
});

describe('suministros', () => {
  it('acepta array directo (v1) o { supplies } (v2) y descarta entradas incompletas', () => {
    const a = { cups: 'ES1', distributorCode: '2', pointType: 5 };
    expect(D.normalizarSuministros([a, { cups: '' }, null, { cups: 'ES2' }])).toEqual([a]);
    expect(D.normalizarSuministros({ supplies: [a] })).toEqual([a]);
    expect(D.normalizarSuministros({})).toEqual([]);
  });
  it('enmascara el CUPS en pantalla', () => {
    expect(D.cupsEnmascarado('ES0031300050554001AB')).toBe('ES0031…01AB');
  });
});

// ---- Flujo completo con fetch simulado ----
// ---- Periodo (home) y 12 meses (solar) ----
describe('rangos', () => {
  it('solar: los 12 ultimos meses naturales completos', () => {
    expect(D.rangoMesesCompletos(new Date(2026, 9, 30))).toEqual({ iniYmd: '2025/10/01', finYmd: '2026/09/30', iniMes: '2025/10', finMes: '2026/09' });
    expect(D.rangoMesesCompletos(new Date(2026, 0, 1))).toEqual({ iniYmd: '2025/01/01', finYmd: '2025/12/31', iniMes: '2025/01', finMes: '2025/12' });
  });

  it('home, otro periodo: acepta un rango valido y pide los meses que lo cubren', () => {
    const r = D.rangoPersonalizado('2026-09-15', '2026-10-14', new Date(2026, 9, 30));
    expect(r.rango).toEqual({ iniYmd: '2026/09/15', finYmd: '2026/10/14', iniMes: '2026/09', finMes: '2026/10' });
    expect(D.rangoPersonalizado('2025-10-30', '2026-10-29', new Date(2026, 9, 30)).rango).toBeTruthy(); // 365 dias justos
  });

  it('home, otro periodo: rechaza sin llamar a Datadis lo que no puede funcionar', () => {
    const hoy = new Date(2026, 9, 30);
    expect(D.rangoPersonalizado('', '2026-10-01', hoy).error).toBe('formato');
    expect(D.rangoPersonalizado('2026-02-30', '2026-03-01', hoy).error).toBe('formato');
    expect(D.rangoPersonalizado('2026-10-10', '2026-10-01', hoy).error).toBe('orden');
    expect(D.rangoPersonalizado('2026-10-01', '2026-10-30', hoy).error).toBe('futuro');
    expect(D.rangoPersonalizado('2025-10-29', '2026-10-29', hoy).error).toBe('largo');
    expect(D.rangoPersonalizado('2024-10-29', '2024-11-29', hoy).error).toBe('antiguo');
    expect(D.textoError({ code: 'periodo', detalle: 'largo' })).toContain('365 días');
    expect(D.textoError({ code: 'periodo', detalle: 'largo' })).toContain('No hemos llamado a Datadis');
  });

  it('nombres de mes en castellano', () => {
    expect(D.etiquetaMes('2025/10')).toBe('octubre de 2025');
  });
});

// ---- Excedentes: dato, cero y ausencia NO son lo mismo ----
function mesesSolar(rango, surplusPorMes) {
  const filas = [];
  const [y0, m0] = rango.iniMes.split('/').map(Number);
  for (let i = 0; i < 12; i++) {
    const inicio = new Date(y0, m0 - 1 + i, 1);
    const mes = `${inicio.getFullYear()}/${pad(inicio.getMonth() + 1)}`;
    const surplus = typeof surplusPorMes === 'function' ? surplusPorMes(mes, i) : surplusPorMes;
    for (let d = new Date(inicio); d.getMonth() === inicio.getMonth(); d.setDate(d.getDate() + 1)) {
      const f = ymd(d);
      const tipo = tipoDia(f);
      filas.push(...diaDatadis(f, { tipo, surplus }));
    }
  }
  return filas;
}

describe('evaluarExcedentes', () => {
  const rango = D.rangoMesesCompletos(new Date(2026, 9, 30));

  it('12 meses con dato: completo', () => {
    const ev = D.evaluarExcedentes(mesesSolar(rango, 0.4), rango);
    expect(ev.estado).toBe('completo');
    expect(ev.hayPositivos).toBe(true);
    expect(ev.meses.length).toBe(12);
    expect(ev.mesesSinDato).toEqual([]);
  });

  it('null en todo el año: ausente (no es un cero)', () => {
    const ev = D.evaluarExcedentes(mesesSolar(rango, null), rango);
    expect(ev.estado).toBe('ausente');
    expect(ev.hayPositivos).toBe(false);
  });

  it('ceros reales en todo el año: completo y sin positivos', () => {
    const ev = D.evaluarExcedentes(mesesSolar(rango, 0), rango);
    expect(ev.estado).toBe('completo');
    expect(ev.hayPositivos).toBe(false);
  });

  it('meses sin dato entre meses con dato: parcial, y dice cuales', () => {
    const ev = D.evaluarExcedentes(mesesSolar(rango, (mes) => (mes === '2026/07' || mes === '2026/08' ? null : 0.3)), rango);
    expect(ev.estado).toBe('parcial');
    expect(ev.mesesSinDato).toEqual(['2026/07', '2026/08']);
  });

  it('distribuidoras que no envian el cero: noches en null y dias con valor siguen siendo meses con dato', () => {
    const filas = mesesSolar(rango, 0.3).map((f) => (Number(f.time.slice(0, 2)) >= 11 && Number(f.time.slice(0, 2)) <= 16 ? f : { ...f, surplusEnergyKWh: null }));
    const ev = D.evaluarExcedentes(filas, rango);
    expect(ev.estado).toBe('completo');
    expect(ev.mesesSinDato).toEqual([]);
    expect(ev.horasSinDato).toBeGreaterThan(5000);
  });

  it('unas pocas horas sueltas sin dato no rompen el mes, pero se cuentan', () => {
    const filas = mesesSolar(rango, 0.3);
    filas[100].surplusEnergyKWh = null;
    filas[101].surplusEnergyKWh = null;
    const ev = D.evaluarExcedentes(filas, rango);
    expect(ev.estado).toBe('completo');
    expect(ev.horasSinDato).toBe(2);
  });

  it('un mes a cero mientras el resto vierte se señala', () => {
    const ev = D.evaluarExcedentes(mesesSolar(rango, (mes) => (mes === '2026/01' ? 0 : 0.3)), rango);
    expect(ev.estado).toBe('completo');
    expect(ev.mesesACero).toEqual(['2026/01']);
  });
});

describe('leerAutoconsumo', () => {
  const c = (campos) => ({ contract: [{ contractedPowerkW: [3.45], ...campos }] });
  it('por la descripcion', () => {
    expect(D.leerAutoconsumo(c({ selfConsumptionTypeDesc: 'Con excedentes y compensación Individual - Consumo' }))).toBe('con');
    expect(D.leerAutoconsumo(c({ selfConsumptionTypeDesc: 'Sin Excedentes Individual – Consumo' }))).toBe('sin');
    expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: '00', selfConsumptionTypeDesc: 'Sin Autoconsumo' }))).toBe('no');
  });
  it('sin descripcion: indicios de autoconsumo de tipo desconocido', () => {
    expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: '99' }))).toBe('si');
    expect(D.leerAutoconsumo(c({ installedCapacityKW: 4.1 }))).toBe('si');
    expect(D.leerAutoconsumo(c({ cau: 'ES0031300000000000AA1A000' }))).toBe('si');
  });
  it('por el codigo de la tabla 113 (codificacion antigua y nueva) cuando no hay descripcion', () => {
    for (const code of ['11', '31', '32', '33']) expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: code }))).toBe('sin');
    for (const code of ['12', '41', '43', '51', '58', '64', '74']) expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: code }))).toBe('con');
    for (const code of ['0C', '01', '2A', '2G']) expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: code }))).toBe('si');
  });

  it('"no hay autoconsumo" exige prueba positiva (codigo 0); si el contrato no dice nada, no se sabe', () => {
    expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: '00' }))).toBe('no');
    expect(D.leerAutoconsumo(c({ selfConsumptionTypeCode: null }))).toBeNull();
    expect(D.leerAutoconsumo(c({}))).toBeNull();
    expect(D.leerAutoconsumo(null)).toBeNull();
  });
});

describe('decidirSolar: nunca un ranking como si no hubiera excedentes cuando puede haberlos', () => {
  const ev = (estado, hayPositivos, extra = {}) => ({ estado, hayPositivos, meses: [], mesesSinDato: [], mesesACero: [], horasSinDato: 0, ...extra });
  it.each([
    // [autoconsumo, estado, positivos, accion, excedentes]
    ['con', 'completo', true, 'importar', 'con'],
    [null, 'completo', true, 'importar', 'con'],
    ['con', 'ausente', false, 'bloquear', undefined],
    ['con', 'parcial', false, 'bloquear', undefined],
    ['sin', 'ausente', false, 'importar', 'sin'],
    ['no', 'ausente', false, 'importar', 'sin'],
    ['no', 'parcial', false, 'importar', 'sin'],
    ['si', 'ausente', false, 'confirmar', 'sin'],
    [null, 'ausente', false, 'confirmar', 'sin'],
    ['con', 'completo', false, 'confirmar', 'con']
  ])('contrato %s, excedentes %s (positivos %s) -> %s', (auto, estado, pos, accion, excedentes) => {
    const d = D.decidirSolar(auto, ev(estado, pos));
    expect(d.accion).toBe(accion);
    if (excedentes) expect(d.excedentes).toBe(excedentes);
  });

  it('un mes de sol entero sin dato mientras otros vierten: BLOQUEA', () => {
    expect(D.decidirSolar('con', ev('parcial', true, { mesesSinDato: ['2026/07'] }))).toMatchObject({ accion: 'bloquear', motivo: 'parcial' });
    expect(D.decidirSolar(null, ev('parcial', true, { mesesSinDato: ['2025/12', '2026/04'] }))).toMatchObject({ accion: 'bloquear' });
  });

  it('solo meses de invierno sin dato: pregunta (puede ser un cero que la distribuidora no envia)', () => {
    expect(D.decidirSolar('con', ev('parcial', true, { mesesSinDato: ['2025/12', '2026/01'] }))).toMatchObject({ accion: 'confirmar', excedentes: 'con', motivo: 'meses-sin-dato' });
  });

  it('un mes entero a 0 mientras otros vierten: pregunta (puede ser un hueco publicado como 0)', () => {
    expect(D.decidirSolar('con', ev('completo', true, { mesesACero: ['2026/07'] }))).toMatchObject({ accion: 'confirmar', excedentes: 'con', motivo: 'meses-cero' });
  });
});

describe('cobertura del consumo contra lo que deberia llegar', () => {
  const rango = { iniYmd: '2025/10/01', finYmd: '2026/09/30', iniMes: '2025/10', finMes: '2026/09' };

  it('horas esperadas con cambios de hora y rangos parciales', () => {
    expect(D.horasEsperadasMes('2026/03', rango)).toBe(31 * 24 - 1);
    expect(D.horasEsperadasMes('2025/10', rango)).toBe(31 * 24 + 1);
    expect(D.horasEsperadasMes('2026/02', rango)).toBe(28 * 24);
    expect(D.horasEsperadasMes('2026/09', { ...rango, finYmd: '2026/09/10' })).toBe(10 * 24);
  });

  it('año completo: 12 meses usados, sin fallos ni huecos', () => {
    const c = D.evaluarCobertura(mesesSolar(rango, 0.3), rango);
    expect(c.usados.length).toBe(12);
    expect(c.fallos).toEqual([]);
    expect(c.huecos).toEqual([]);
  });

  it('falta el ultimo mes entero: es un fallo (no basta con que los otros 11 esten completos)', () => {
    const c = D.evaluarCobertura(mesesSolar(rango, 0.3).filter((f) => !f.date.startsWith('2026/09')), rango);
    expect(c.fallos.map((m) => m.mes)).toEqual(['2026/09']);
  });

  it('faltan dias enteros en medio: cuentan contra las horas que deberian existir', () => {
    const c = D.evaluarCobertura(mesesSolar(rango, 0.3).filter((f) => !/^2026\/05\/(0[1-3])$/.test(f.date)), rango);
    expect(c.fallos.map((m) => m.mes)).toEqual(['2026/05']);
    expect(c.fallos[0].cobertura).toBeCloseTo(28 / 31, 3);
  });

  it('meses vacios al principio (suministro reciente) y un primer mes a medias: se omiten', () => {
    const filas = mesesSolar(rango, 0.3).filter((f) => f.date >= '2025/12/15');
    const c = D.evaluarCobertura(filas, rango);
    expect(c.omitidos).toEqual(['2025/10', '2025/11', '2025/12']);
    expect(c.usados[0]).toBe('2026/01');
    expect(c.fallos).toEqual([]);
  });

  it('una hora suelta de menos: se acepta como hueco y se avisa', () => {
    const filas = mesesSolar(rango, 0.3);
    filas.splice(500, 1);
    const c = D.evaluarCobertura(filas, rango);
    expect(c.fallos).toEqual([]);
    expect(c.huecos.length).toBe(1);
  });
});

describe('construirCsv con modo de excedentes', () => {
  it("'con': siempre la columna; una hora sin dato va a 0", () => {
    const filas = diaDatadis('2026/05/10', { surplus: 0.2 });
    filas[3].surplusEnergyKWh = null;
    const lineas = D.construirCsv(filas, null, 'con').csv.trim().split('\r\n');
    expect(lineas[0]).toContain('Energia_vertida_kWh');
    expect(lineas[4].split(';')[5]).toBe('0');
    expect(lineas[5].split(';')[5]).toBe('0,2');
  });
  it("'sin': nunca la columna, aunque haya excedentes", () => {
    const csv = D.construirCsv(diaDatadis('2026/05/10', { surplus: 0.2 }), null, 'sin').csv;
    expect(csv).not.toContain('Energia_vertida_kWh');
  });
});

describe('importar (fetch simulado)', () => {
  const CLAVE = 'q!HPmJ&jcM=100%';
  const SUM = { cups: 'ES0000000000000000AB', distributorCode: '2', pointType: 5, address: 'CALLE 1', province: 'Zaragoza', validDateTo: '' };
  let llamadas;
  let respuestas;
  let textoCsv;

  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  beforeEach(() => {
    D = cargarModulo(); // cache en memoria limpia: cada test parte de una pagina recien cargada
    storage.clear();
    llamadas = [];
    textoCsv = null;
    respuestas = {
      login: () => json(200, 'aaaa.bbbb.cccc'),
      supplies: () => json(200, [SUM]),
      contract: () => json(200, { contract: [{ contractedPowerkW: [3.45, 3.45] }] }),
      consumo: () => json(200, { timeCurve: añoCompleto(D.rangoUltimosDias(new Date())) })
    };
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      llamadas.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/nikola-auth/tokens/login')) return respuestas.login();
      if (u.includes('get-supplies')) return respuestas.supplies();
      if (u.includes('get-contract-detail')) return respuestas.contract();
      if (u.includes('get-consumption-data')) return respuestas.consumo(u);
      throw new Error('URL inesperada ' + u);
    }));
    global.window.LF.procesarCSVConsumos = async (file) => {
      textoCsv = await file.text();
      return realProcesar({ name: 'datadis.csv', _content: textoCsv });
    };
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('localStorage', almacen); });

  const ejecutar = (extra = {}) => D.importar({
    nif: '12345678Z', clave: CLAVE, conPotencia: true,
    senal: new AbortController().signal, onProgreso: () => {}, elegirSuministro: async (l) => l[0], ...extra
  });

  it('flujo feliz: solo habla con datadis.es, no filtra la clave en ninguna URL y codifica bien &, % y !', async () => {
    const r = await ejecutar();
    expect(r.ok).toBe(true);
    expect(r.formato).toBe('Datadis');
    expect(r.dias).toBe(365);
    expect(r.potenciaContratada).toEqual({ p1: 3.45, p2: 3.45 });
    expect(r.warnings.join(' ')).toContain('Potencia contratada leída de tu contrato');

    for (const l of llamadas) {
      expect(l.url.startsWith('https://datadis.es/')).toBe(true);
      expect(l.url).not.toContain('q!HPm');
      expect(l.init.credentials).toBe('omit');
    }
    const login = llamadas[0];
    expect(login.init.method).toBe('POST');
    expect(login.init.body).toBe('username=12345678Z&password=q%21HPmJ%26jcM%3D100%25');
    for (const l of llamadas.slice(1)) expect(l.init.headers.Authorization).toBe('Bearer aaaa.bbbb.cccc');

    const consumo = llamadas.find((l) => l.url.includes('get-consumption-data-v2'));
    const q = new URL(consumo.url).searchParams;
    expect(q.get('measurementType')).toBe('0');
    expect(q.get('pointType')).toBe('5');
    expect(q.get('distributorCode')).toBe('2');
    const rango = D.rangoUltimosDias(new Date());
    expect(q.get('startDate')).toBe(rango.iniMes);
    expect(q.get('endDate')).toBe(rango.finMes);
  });

  it('los avisos de la vista previa hablan de Datadis, no de un CSV, y orientan a quien tiene placas', async () => {
    const r = await ejecutar({ conPotencia: false });
    const avisos = r.warnings.join('\n');
    expect(avisos).not.toMatch(/CSV procesado|excedentes=0/);
    expect(avisos).toContain('✓ Datos de Datadis procesados:');
    expect(avisos).toContain('Si tienes placas');
  });

  it('el CSV intermedio no lleva el CUPS ni la direccion', async () => {
    await ejecutar();
    expect(textoCsv).not.toContain(SUM.cups);
    expect(textoCsv).not.toContain('CALLE 1');
  });

  it('no repite la consulta de consumo (Datadis la rechaza 24 h): la segunda importacion usa la memoria', async () => {
    await ejecutar();
    await ejecutar();
    expect(llamadas.filter((l) => l.url.includes('get-consumption-data')).length).toBe(1);
  });

  it('la potencia es opcional: sin marcar no se pide el contrato', async () => {
    const r = await ejecutar({ conPotencia: false });
    expect(llamadas.some((l) => l.url.includes('get-contract-detail'))).toBe(false);
    expect(r.potenciaContratada).toBeUndefined();
  });

  it('si falla el contrato se importan igualmente los consumos', async () => {
    respuestas.contract = () => json(500, { message: 'Internal' });
    const r = await ejecutar();
    expect(r.ok).toBe(true);
    expect(r.potenciaContratada).toBeUndefined();
  });

  it('contrasena incorrecta: cuenta el fallo, no consulta nada mas y avisa; a los 2 fallos se detiene', async () => {
    respuestas.login = () => json(500, { status: 500, error: 'Internal Server Error', message: 'Bad credentials' });
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    expect(fallosGuardados()).toBe(1);
    expect(D.textoError({ code: 'credenciales' })).toContain('Te queda un intento');
    expect(llamadas.length).toBe(1);

    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    expect(fallosGuardados()).toBe(2);
    expect(D.textoError({ code: 'credenciales' })).toContain('no seguimos intentándolo');
  });

  it('un login correcto reinicia el contador de fallos', async () => {
    storage.set('lf_datadis_fallos', JSON.stringify({ n: 1, t: Date.now() }));
    await ejecutar();
    expect(storage.has('lf_datadis_fallos')).toBe(false);
  });

  it('el token se acepta tambien entre comillas o dentro de { token }', async () => {
    respuestas.login = () => json(200, '"aaaa.bbbb.cccc"');
    expect((await ejecutar({ conPotencia: false })).ok).toBe(true);
    D = cargarModulo();
    respuestas.login = () => json(200, { token: 'aaaa.bbbb.cccc' });
    expect((await ejecutar({ conPotencia: false })).ok).toBe(true);
    for (const l of llamadas.filter((x) => !x.url.includes('login'))) expect(l.init.headers.Authorization).toBe('Bearer aaaa.bbbb.cccc');
  });

  it('respuesta vacia o "null" al pedir el periodo: se trata como sin datos y se pide mes a mes', async () => {
    const rango = D.rangoUltimosDias(new Date());
    const todas = añoCompleto(rango);
    respuestas.consumo = (u) => {
      const q = new URL(u).searchParams;
      return q.get('startDate') === q.get('endDate') ? json(200, { timeCurve: todas.filter((f) => f.date.startsWith(q.get('startDate'))) }) : json(200, 'null');
    };
    expect((await ejecutar({ conPotencia: false })).dias).toBe(365);
  });

  it('el aviso de consulta repetida en texto plano tambien se reconoce', async () => {
    respuestas.consumo = () => json(500, 'Consulta repetida: espere 24h');
    await expect(ejecutar({ conPotencia: false })).rejects.toMatchObject({ code: 'repeticion' });
  });

  it('credenciales rechazadas con 401 o 403 tambien cuentan como fallo de contraseña', async () => {
    respuestas.login = () => json(403, '');
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    expect(fallosGuardados()).toBe(1);
  });

  it('si la consulta del periodo falla con 500, pide mes a mes y se queda con lo que llegue', async () => {
    const rango = D.rangoUltimosDias(new Date());
    const todas = añoCompleto(rango);
    respuestas.consumo = (u) => {
      const q = new URL(u).searchParams;
      if (q.get('startDate') !== q.get('endDate')) return json(500, { message: 'Internal Server Error' });
      return json(200, { timeCurve: todas.filter((f) => f.date.startsWith(q.get('startDate'))) });
    };
    const r = await ejecutar({ conPotencia: false });
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(365);
    const consultas = llamadas.filter((l) => l.url.includes('get-consumption-data'));
    expect(consultas.length).toBe(1 + 13);
    // del mas reciente al mas antiguo
    expect(new URL(consultas[1].url).searchParams.get('startDate')).toBe(rango.finMes);
  });

  it('si la consulta del periodo llega vacia tambien prueba mes a mes', async () => {
    const rango = D.rangoUltimosDias(new Date());
    const todas = añoCompleto(rango);
    respuestas.consumo = (u) => {
      const q = new URL(u).searchParams;
      return json(200, { timeCurve: q.get('startDate') === q.get('endDate') ? todas.filter((f) => f.date.startsWith(q.get('startDate'))) : [] });
    };
    const r = await ejecutar({ conPotencia: false });
    expect(r.dias).toBe(365);
  });

  it('si fallan el periodo y todos los meses, devuelve el error original', async () => {
    respuestas.consumo = () => json(500, { message: 'Internal Server Error' });
    await expect(ejecutar({ conPotencia: false })).rejects.toMatchObject({ code: 'http', paso: 'consumos' });
  });

  it('una consulta repetida (429) no dispara las consultas mes a mes', async () => {
    respuestas.consumo = () => json(429, '');
    await expect(ejecutar({ conPotencia: false })).rejects.toMatchObject({ code: 'repeticion' });
    expect(llamadas.filter((l) => l.url.includes('get-consumption-data')).length).toBe(1);
  });

  it('usuario bloqueado: lo distingue y explica como desbloquearlo', async () => {
    respuestas.login = () => json(500, { message: 'User blocked' });
    await expect(ejecutar()).rejects.toMatchObject({ code: 'bloqueado' });
    expect(D.textoError({ code: 'bloqueado' })).toContain('¿Has olvidado tu contraseña?');
    expect(storage.has('lf_datadis_fallos')).toBe(false);
  });

  it('consulta repetida (HTTP 429): mensaje de 24 horas', async () => {
    respuestas.consumo = () => json(429, '');
    await expect(ejecutar()).rejects.toMatchObject({ code: 'repeticion' });
    expect(D.textoError({ code: 'repeticion' })).toContain('24 horas');
  });

  it('red caida: error de red sin contar fallo de login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(ejecutar()).rejects.toMatchObject({ code: 'red' });
    expect(storage.has('lf_datadis_fallos')).toBe(false);
  });

  it('sin suministros y sin consumos devuelven errores propios', async () => {
    respuestas.supplies = () => json(200, []);
    await expect(ejecutar()).rejects.toMatchObject({ code: 'sinsuministros' });

    respuestas.supplies = () => json(200, [SUM]);
    respuestas.consumo = () => json(200, { timeCurve: [] });
    await expect(ejecutar({ conPotencia: false })).rejects.toMatchObject({ code: 'sindatos' });
  });

  it('varios suministros: pregunta cual y consulta el elegido', async () => {
    const otro = { ...SUM, cups: 'ES9999999999999999ZZ', distributorCode: '3' };
    respuestas.supplies = () => json(200, [SUM, otro]);
    const elegir = vi.fn(async (lista) => lista[1]);
    await ejecutar({ elegirSuministro: elegir });
    expect(elegir).toHaveBeenCalledTimes(1);
    const consumo = llamadas.find((l) => l.url.includes('get-consumption-data'));
    expect(new URL(consumo.url).searchParams.get('cups')).toBe(otro.cups);
    expect(new URL(consumo.url).searchParams.get('distributorCode')).toBe('3');
  });

  it('NIF con la letra mal: no llama a Datadis ni gasta intento', async () => {
    await expect(ejecutar({ nif: '12345678A' })).rejects.toMatchObject({ code: 'documento', detalle: 'letra' });
    expect(llamadas.length).toBe(0);
    expect(fallosGuardados()).toBe(0);
    expect(D.textoError({ code: 'documento', detalle: 'letra' })).toContain('no has gastado ningún intento');
  });

  it('envia el documento normalizado aunque se escriba en minusculas y con guion', async () => {
    await ejecutar({ nif: '12345678-z' });
    expect(llamadas[0].init.body.startsWith('username=12345678Z&')).toBe(true);
  });

  it('con el almacenamiento bloqueado el contador sigue funcionando en memoria', async () => {
    const roto = () => { throw new Error('SecurityError'); };
    vi.stubGlobal('localStorage', { getItem: roto, setItem: roto, removeItem: roto });
    respuestas.login = () => json(500, { message: 'Bad credentials' });
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    expect(D.textoError({ code: 'credenciales' })).toContain('Te queda un intento');
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    expect(D.textoError({ code: 'credenciales' })).toContain('no seguimos intentándolo');
  });

  it('si solo falla la escritura (getItem funciona y devuelve null) tampoco vuelve a 0', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} });
    respuestas.login = () => json(500, { message: 'Bad credentials' });
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    expect(D.textoError({ code: 'credenciales' })).toContain('no seguimos intentándolo');
  });

  it('un contador viejo que no se pudo borrar no sobrevive a un login correcto', async () => {
    storage.set('lf_datadis_fallos', JSON.stringify({ n: 1, t: Date.now() - 1000 }));
    vi.stubGlobal('localStorage', {
      getItem: almacen.getItem,
      setItem: () => { throw new Error('QuotaExceeded'); },
      removeItem: () => { throw new Error('SecurityError'); }
    });
    await ejecutar(); // login correcto: reinicio que no se puede escribir
    respuestas.login = () => json(500, { message: 'Bad credentials' });
    await expect(ejecutar()).rejects.toMatchObject({ code: 'credenciales' });
    // Con el dato viejo contado serian 2 (agotado); debe ser 1
    expect(D.textoError({ code: 'credenciales' })).toContain('Te queda un intento');
  });

  it('vuelve a leer el contador justo antes del login: si otra pestana ya agoto los intentos, no envia nada', async () => {
    // Web Locks: este login espera turno mientras la otra pestana termina el suyo
    vi.stubGlobal('navigator', { locks: { request: async (_nombre, fn) => { await Promise.resolve(); return fn(); } } });
    const peticion = {
      nif: '12345678Z', clave: 'x', conPotencia: false,
      senal: new AbortController().signal, onProgreso: () => {}, elegirSuministro: async (l) => l[0]
    };
    const promesa = D.importar(peticion);
    // otra pestana registra el segundo fallo mientras esta espera turno
    storage.set('lf_datadis_fallos', JSON.stringify({ n: 2, t: Date.now() }));
    await expect(promesa).rejects.toMatchObject({ code: 'agotado' });
    expect(llamadas.length).toBe(0);
    expect(D.textoError({ code: 'agotado' })).toContain('otra pestaña');
  });

  it('serializa el login entre pestanas con Web Locks y nunca lo repite si ya empezo', async () => {
    const nombres = [];
    vi.stubGlobal('navigator', { locks: { request: async (nombre, fn) => { nombres.push(nombre); return fn(); } } });
    await ejecutar();
    expect(nombres).toEqual(['lf-datadis-login']);

    // El login empieza dentro del bloqueo y falla con un error inesperado: no se reintenta fuera
    llamadas = [];
    respuestas.login = () => { throw new TypeError('rotura inesperada'); };
    await expect(ejecutar()).rejects.toBeTruthy();
    expect(llamadas.filter((l) => l.url.includes('login')).length).toBe(1);

    // El API de bloqueos falla ANTES de empezar: se hace el login una sola vez, sin el
    llamadas = [];
    respuestas.login = () => json(200, 'aaaa.bbbb.cccc');
    vi.stubGlobal('navigator', { locks: { request: async () => { throw new Error('locks no disponible'); } } });
    await ejecutar();
    expect(llamadas.filter((l) => l.url.includes('login')).length).toBe(1);
  });

  it('suelta la contrasena nada mas usarla en el login', async () => {
    const peticion = {
      nif: '12345678Z', clave: 'secreta', conPotencia: false,
      senal: new AbortController().signal, onProgreso: () => {}, elegirSuministro: async (l) => l[0]
    };
    const promesa = D.importar(peticion);
    expect(peticion.clave).toBe('');
    await promesa;
    expect(llamadas[0].init.body).toContain('password=secreta');
  });

  it('el contador de fallos caduca a las 24 horas', () => {
    storage.set('lf_datadis_fallos', JSON.stringify({ n: 2, t: Date.now() - 25 * 60 * 60 * 1000 }));
    expect(D.textoError({ code: 'credenciales' })).toContain('Te queda un intento');
    expect(storage.has('lf_datadis_fallos')).toBe(false);
    storage.set('lf_datadis_fallos', JSON.stringify({ n: 2, t: Date.now() - 60 * 1000 }));
    expect(D.textoError({ code: 'credenciales' })).toContain('no seguimos intentándolo');
  });

  it('cancelar durante la descarga NO aborta la consulta de consumos: termina y queda en memoria', async () => {
    const ctrl = new AbortController();
    let senalConsumo = null;
    const original = global.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      if (String(url).includes('get-consumption-data')) {
        senalConsumo = init.signal;
        ctrl.abort(); // el usuario cancela mientras Datadis prepara la respuesta
      }
      return original(url, init);
    }));
    await expect(ejecutar({ senal: ctrl.signal, conPotencia: false })).rejects.toMatchObject({ code: 'cancelado' });
    expect(senalConsumo.aborted).toBe(false);

    // Segundo intento en la misma pagina: no vuelve a pedir los consumos (Datadis lo rechazaria 24 h)
    vi.stubGlobal('fetch', original);
    const r = await ejecutar({ conPotencia: false });
    expect(r.ok).toBe(true);
    expect(llamadas.filter((l) => l.url.includes('get-consumption-data')).length).toBe(1);
  });

  it('un error de Datadis al pedir consumos avisa del limite de 24 horas', async () => {
    respuestas.consumo = () => json(500, { message: 'Internal Server Error' });
    const e = await ejecutar({ conPotencia: false }).catch((x) => x);
    expect(e).toMatchObject({ code: 'http', paso: 'consumos' });
    expect(D.textoError(e)).toContain('últimas 24 horas');
    expect(D.textoError({ code: 'http', status: 500 })).not.toContain('24 horas');
  });

  it('cancelar la eleccion de suministro aborta sin descargar consumos', async () => {
    respuestas.supplies = () => json(200, [SUM, { ...SUM, cups: 'ES2' }]);
    await expect(ejecutar({ elegirSuministro: async () => null })).rejects.toMatchObject({ code: 'cancelado' });
    expect(llamadas.some((l) => l.url.includes('get-consumption-data'))).toBe(false);
  });

  // ---- Home: otro periodo ----
  it('home con otro periodo: pide los meses que lo cubren y solo usa sus dias', async () => {
    const hoy = new Date();
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    const ini = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - 44);
    const isoF = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const { rango } = D.rangoPersonalizado(isoF(ini), isoF(fin));
    const r = await ejecutar({ rango, conPotencia: false });
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(45);
    const q = new URL(llamadas.find((l) => l.url.includes('get-consumption-data')).url).searchParams;
    expect(q.get('startDate')).toBe(rango.iniMes);
    expect(q.get('endDate')).toBe(rango.finMes);
  });

  it('home: excedentes solo en dias FUERA del periodo elegido no crean la columna de excedentes', async () => {
    const rango = { iniYmd: '2026/09/15', finYmd: '2026/10/14', iniMes: '2026/09', finMes: '2026/10' };
    const filas = [];
    for (let d = new Date(2026, 8, 1); d <= new Date(2026, 9, 31); d.setDate(d.getDate() + 1)) {
      const f = ymd(d);
      filas.push(...diaDatadis(f, { tipo: tipoDia(f), surplus: f <= '2026/09/14' ? 0.4 : null }));
    }
    respuestas.consumo = () => json(200, { timeCurve: filas });
    await ejecutar({ rango, conPotencia: false });
    expect(textoCsv.split('\r\n')[0]).not.toContain('Energia_vertida_kWh');
  });

  it('home: si faltan excedentes de algunos meses lo dice expresamente', async () => {
    const rango = D.rangoUltimosDias(new Date());
    respuestas.consumo = () => json(200, { timeCurve: añoCompleto(rango).map((f) => ({ ...f, surplusEnergyKWh: f.date.slice(5, 7) === '07' ? null : 0.2 })) });
    const r = await ejecutar({ conPotencia: false });
    expect(r.warnings.join('\n')).toMatch(/no ha enviado ningún dato de excedentes de julio de \d{4}/);
  });

  // ---- Simulador solar ----
  describe('destino solar', () => {
    const rangoSolar = () => D.rangoMesesCompletos(new Date());
    const ejecutarSolar = (extra = {}) => ejecutar({ destino: 'solar', conPotencia: false, confirmar: vi.fn(async () => true), ...extra });
    const contrato = (campos) => () => json(200, { contract: [{ contractedPowerkW: [4.6, 4.6], ...campos }] });

    it('pide los 12 meses completos y SIEMPRE el contrato (para saber si hay autoconsumo)', async () => {
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), 0.3) });
      await ejecutarSolar();
      const q = new URL(llamadas.find((l) => l.url.includes('get-consumption-data')).url).searchParams;
      expect(q.get('startDate')).toBe(rangoSolar().iniMes);
      expect(q.get('endDate')).toBe(rangoSolar().finMes);
      expect(llamadas.some((l) => l.url.includes('get-contract-detail'))).toBe(true);
    });

    it('con excedentes completos: CSV con la columna de excedentes y sin confirmar nada', async () => {
      respuestas.contract = contrato({ selfConsumptionTypeDesc: 'Con excedentes y compensación Individual - Consumo' });
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), 0.3) });
      const confirmar = vi.fn(async () => true);
      const r = await ejecutarSolar({ confirmar });
      expect(r.destino).toBe('solar');
      const csv = await r.fichero.text();
      expect(csv.split('\r\n')[0]).toContain('Energia_vertida_kWh');
      expect(csv).not.toContain(SUM.cups);
      expect(confirmar).not.toHaveBeenCalled();
      expect(r.avisos[0]).toMatch(/^Datos de Datadis: \w+ de \d{4} a \w+ de \d{4}\.$/);
    });

    it('contrato con excedentes y Datadis sin excedentes: BLOQUEA (nunca ranking a 0)', async () => {
      respuestas.contract = contrato({ selfConsumptionTypeDesc: 'Con excedentes y compensación Individual - Consumo' });
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), null) });
      const e = await ejecutarSolar().catch((x) => x);
      expect(e).toMatchObject({ code: 'solar' });
      expect(D.textoError(e)).toContain('ni un kWh vertido en todo el periodo');
    });

    it('un mes de sol entero sin excedentes: BLOQUEA y nombra el mes', async () => {
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), (mes) => (mes.endsWith('/07') ? null : 0.3)) });
      const e = await ejecutarSolar().catch((x) => x);
      expect(e).toMatchObject({ code: 'solar' });
      expect(D.textoError(e)).toMatch(/ningún dato de excedentes de julio de \d{4}/);
    });

    it('solo un mes de invierno sin excedentes: pregunta y, si se confirma, lo importa a 0 diciendolo', async () => {
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), (mes) => (mes.endsWith('/12') ? null : 0.3)) });
      const confirmar = vi.fn(async () => true);
      const r = await ejecutarSolar({ confirmar });
      expect(confirmar.mock.calls[0][0]).toMatch(/diciembre de \d{4}/);
      expect(confirmar.mock.calls[0][1]).toBe('Importar con esos meses a 0');
      expect(r.avisos.join(' ')).toMatch(/Importado con 0 kWh vertidos en diciembre de \d{4}, como has confirmado/);
    });

    it('distribuidora que no envia el cero (noches en null): importa sin preguntar y lo explica', async () => {
      const filas = mesesSolar(rangoSolar(), 0.3).map((f) => {
        const h = Number(f.time.slice(0, 2));
        return h >= 11 && h <= 16 ? f : { ...f, surplusEnergyKWh: null };
      });
      respuestas.consumo = () => json(200, { timeCurve: filas });
      const confirmar = vi.fn(async () => true);
      const r = await ejecutarSolar({ confirmar });
      expect(confirmar).not.toHaveBeenCalled();
      expect(r.avisos.join(' ')).toContain('no envió el dato de excedentes y se han tomado como 0 kWh');
    });

    it('falta el ultimo mes entero: BLOQUEA (no se aceptan 11 de 12)', async () => {
      const ultimo = rangoSolar().finMes;
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), 0.3).filter((f) => !f.date.startsWith(ultimo)) });
      const e = await ejecutarSolar().catch((x) => x);
      expect(e).toMatchObject({ code: 'solar' });
      expect(D.textoError(e)).toContain(`${D.etiquetaMes(ultimo)} (0 %)`);
    });

    it('faltan dias en medio del año: BLOQUEA con la cobertura del mes', async () => {
      const mes = rangoSolar().iniMes;
      const medio = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + 6, 1);
      const mesMedio = `${medio.getFullYear()}/${pad(medio.getMonth() + 1)}`;
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), 0.3).filter((f) => !(f.date.startsWith(mesMedio) && Number(f.date.slice(8)) <= 3)) });
      const e = await ejecutarSolar().catch((x) => x);
      expect(e).toMatchObject({ code: 'solar' });
      expect(D.textoError(e)).toContain(D.etiquetaMes(mesMedio));
      expect(D.textoError(e)).toContain('infravaloraría tu consumo');
    });

    it('distribuidora que rechaza el primer mes del contrato: mes a mes, y ese mes queda fuera avisando', async () => {
      const r0 = rangoSolar();
      const todas = mesesSolar(r0, 0.3);
      respuestas.consumo = (u) => {
        const q = new URL(u).searchParams;
        if (q.get('startDate') !== q.get('endDate') || q.get('startDate') === r0.iniMes) return json(500, { message: 'Internal Server Error' });
        return json(200, { timeCurve: todas.filter((f) => f.date.startsWith(q.get('startDate'))) });
      };
      const r = await ejecutarSolar();
      expect(r.fichero.name).toBe('datadis-11-meses.csv');
      expect(r.avisos.join(' ')).toContain('se simulan 11 meses');
    });

    it('suministro reciente (sin los primeros meses): importa los que hay y lo dice', async () => {
      const r0 = rangoSolar();
      const inicio = new Date(Number(r0.iniMes.slice(0, 4)), Number(r0.iniMes.slice(5, 7)) - 1 + 3, 1);
      const desde = `${inicio.getFullYear()}/${pad(inicio.getMonth() + 1)}/01`;
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(r0, 0.3).filter((f) => f.date >= desde) });
      const r = await ejecutarSolar();
      expect(r.fichero.name).toBe('datadis-9-meses.csv');
      expect(r.avisos.join(' ')).toContain('se simulan 9 meses');
      const csv = await r.fichero.text();
      const [y, m] = desde.split('/');
      expect(csv.split('\r\n')[1]).toContain(`01/${m}/${y}`);
    });

    it('autoconsumo sin excedentes: importa el consumo con excedentes a 0 sin preguntar', async () => {
      respuestas.contract = contrato({ selfConsumptionTypeDesc: 'Sin Excedentes Individual – Consumo' });
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), null) });
      const confirmar = vi.fn(async () => true);
      const r = await ejecutarSolar({ confirmar });
      expect(await r.fichero.text()).not.toContain('Energia_vertida_kWh');
      expect(confirmar).not.toHaveBeenCalled();
      expect(r.avisos.join(' ')).toContain('autoconsumo sin excedentes');
    });

    it('sin autoconsumo: importa solo el consumo', async () => {
      respuestas.contract = contrato({ selfConsumptionTypeCode: '00' });
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), null) });
      const r = await ejecutarSolar();
      expect(await r.fichero.text()).not.toContain('Energia_vertida_kWh');
      expect(r.avisos.join(' ')).toContain('no tiene autoconsumo');
    });

    it('contrato no disponible y sin excedentes: PREGUNTA; si no confirma, no importa', async () => {
      respuestas.contract = () => json(500, { message: 'Error interno distribuidora' });
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), null) });
      const confirmar = vi.fn(async () => false);
      await expect(ejecutarSolar({ confirmar })).rejects.toMatchObject({ code: 'cancelado' });
      expect(confirmar).toHaveBeenCalledTimes(1);
      expect(confirmar.mock.calls[0][1]).toBe('No vierto excedentes: importar solo el consumo');
    });

    it('contrato con excedentes y 0 kWh todo el año: pregunta antes de importar ceros', async () => {
      respuestas.contract = contrato({ selfConsumptionTypeDesc: 'Con excedentes y compensación Individual - Consumo' });
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), 0) });
      const confirmar = vi.fn(async () => true);
      const r = await ejecutarSolar({ confirmar });
      expect(confirmar.mock.calls[0][1]).toBe('Importar con excedentes a 0');
      expect(await r.fichero.text()).toContain('Energia_vertida_kWh');
    });

    it('un mes a 0 kWh entre meses que vierten: pregunta nombrando el mes; si no confirma, no importa', async () => {
      respuestas.contract = contrato({ selfConsumptionTypeDesc: 'Con excedentes y compensación Individual - Consumo' });
      const filas = mesesSolar(rangoSolar(), (_mes, i) => (i === 9 ? 0 : 0.3));
      respuestas.consumo = () => json(200, { timeCurve: filas });
      const confirmar = vi.fn(async () => false);
      await expect(ejecutarSolar({ confirmar })).rejects.toMatchObject({ code: 'cancelado' });
      const mesCero = D.evaluarExcedentes(filas, rangoSolar()).mesesACero[0];
      expect(confirmar.mock.calls[0][0]).toContain(D.etiquetaMes(mesCero));
      expect(confirmar.mock.calls[0][1]).toBe('Importar con esos meses a 0');
    });

    it('la potencia del contrato solo se devuelve si se pide', async () => {
      respuestas.consumo = () => json(200, { timeCurve: mesesSolar(rangoSolar(), 0.3) });
      expect((await ejecutarSolar({ conPotencia: false })).potencias).toBeNull();
      D = cargarModulo();
      expect((await ejecutarSolar({ conPotencia: true })).potencias).toEqual({ p1: 3.45, p2: 3.45 });
    });
  });
});

// ---- Contratos estaticos (privacidad, carga, CSP) ----
describe('contratos estaticos de lf-datadis.js', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  it('no persiste datos personales ni los manda a analitica o a la consola', () => {
    expect(sourceDatadis).not.toMatch(/sessionStorage\.|indexedDB|document\.cookie/);
    expect(sourceDatadis).not.toMatch(/\bconsole\./);
    expect(sourceDatadis).not.toMatch(/__LF_trackDetail|goatcounter|trackCsvEvent|sendBeacon/i);
    // localStorage solo para el contador de fallos de login ({ n, t }), nunca credenciales ni datos
    const usos = sourceDatadis.match(/localStorage\.\w+\(([^)]*)\)/g) || [];
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u).toContain('FALLOS_KEY');
    expect(sourceDatadis).toContain('JSON.stringify({ n, t: ahora })');
    // La referencia local a la contrasena se suelta al terminar el login, pase lo que pase
    expect(sourceDatadis).toMatch(/finally \{\s*claveLogin = '';\s*\}/);
  });

  it('tracking.js no escucha clics ni cambios dentro del modal de Datadis', () => {
    const tracking = fs.readFileSync(path.join(root, 'js/tracking.js'), 'utf8');
    for (const evento of ['click', 'change']) {
      const i = tracking.indexOf(`document.addEventListener('${evento}', function(e) {`);
      expect(i, `listener global de ${evento}`).toBeGreaterThan(-1);
      expect(tracking.slice(i, i + 400)).toContain(".closest('#modalFactura, .lf-dd-modal')");
    }
    expect(sourceDatadis).toContain("'modal-content card lf-dd-modal'");
  });

  it('el unico host al que se conecta es datadis.es', () => {
    const urls = sourceDatadis.match(/https?:\/\/[a-z0-9.-]+/gi) || [];
    for (const u of urls) expect(['https://datadis.es', 'http://www.w3.org']).toContain(u);
  });

  it('index.html: se carga con defer despues de lf-csv-import.js y la CSP admite datadis.es', () => {
    const scripts = [...html.matchAll(/<script src="([^"]+)"[^>]*>/g)].map((m) => ({ src: m[1].split('?')[0], tag: m[0] }));
    const iCsv = scripts.findIndex((s) => s.src === 'js/lf-csv-import.js');
    const iDd = scripts.findIndex((s) => s.src === 'js/lf-datadis.js');
    expect(iDd).toBeGreaterThan(iCsv);
    expect(scripts[iDd].tag).toMatch(/\bdefer\b/);
    expect(scripts[iDd].tag).not.toMatch(/\basync\b/);
    const connect = html.match(/connect-src ([^;]*);/)[1].trim().split(/\s+/);
    expect(connect).toEqual(["'self'", 'https://luzfija.goatcounter.com', 'https://datadis.es']);
  });

  it('simulador solar: se carga tras bv-ui.js (sin async) y su CSP admite datadis.es', () => {
    const solar = fs.readFileSync(path.join(root, 'comparador-tarifas-solares.html'), 'utf8');
    const scripts = [...solar.matchAll(/<script src="([^"]+)"[^>]*>/g)].map((m) => ({ src: m[1].split('?')[0], tag: m[0] }));
    const iUi = scripts.findIndex((s) => s.src === '/js/bv/bv-ui.js');
    const iDd = scripts.findIndex((s) => s.src === '/js/lf-datadis.js');
    expect(iUi).toBeGreaterThan(-1);
    expect(iDd).toBe(iUi + 1);
    expect(scripts[iDd].tag).not.toMatch(/\basync\b/);
    const connect = solar.match(/connect-src ([^;]*);/)[1].trim().split(/\s+/);
    expect(connect).toContain('https://datadis.es');
  });

  it('bv-ui.js publica la entrada que usa la importacion solar y devuelve si se publico', () => {
    const ui = fs.readFileSync(path.join(root, 'js/bv/bv-ui.js'), 'utf8');
    expect(ui).toContain('window.BVSim.importarFichero = (file, opciones) => handleFile(file, opciones);');
    expect(ui).toMatch(/async function handleFile\(file, opciones = \{\}\)/);
    expect(sourceDatadis).toContain('window.BVSim.importarFichero(r.fichero, { avisos })');
  });

  it('el Service Worker lo precachea como opcional (fuera de CORE_ASSETS)', () => {
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const core = sw.slice(sw.indexOf('const CORE_ASSETS'), sw.indexOf('const CORE_ASSET_SET'));
    expect(sw).toContain('"js/lf-datadis.js"');
    expect(core).not.toContain('lf-datadis.js');
  });

  it('el interruptor de apagado existe y esta activo', () => {
    expect(sourceDatadis).toMatch(/const DATADIS_IMPORT_ENABLED = true;/);
  });
});
