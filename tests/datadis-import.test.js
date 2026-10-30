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
    const tipo = f.endsWith('/03/29') ? 'primavera' : f.endsWith('/10/25') ? 'otono' : 'normal';
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
      if (u.includes('get-consumption-data')) return respuestas.consumo();
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
    expect(sourceDatadis).toContain('JSON.stringify({ n, t: Date.now() })');
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
