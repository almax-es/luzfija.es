import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Imprescindible cargar el modulo real: validateInputFormat solo aplica el
// limite de decimales si window.LF.esNumericoValido existe; sin el cae a una
// regex de respaldo que acepta cualquier cifra y el test pasaria en falso.
import '../js/lf-utils.js';

/**
 * @vitest-environment jsdom
 */

// Regresion del issue #14 en el simulador solar. La home y el simulador tienen
// validaciones separadas de "Mi tarifa": la home usa validateMiTarifa
// (js/lf-tarifa-custom.js) y el simulador usa validateInputFormat sobre los
// mismos campos. Ambas usaban 6 decimales; si solo se sube el limite en la home,
// el simulador seguiria marcando en rojo precios de factura legitimos.
//
// Ojo con los ids: la compensacion de excedentes es mtPrecioExc en la home pero
// mtExc aqui.

const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const loadBvUi = new Function('window', uiCode);

const MT_IDS = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc', 'mtPrecioBV'];

// bv-ui registra el arranque y varios handlers sobre document/window, objetos
// que sobreviven a cada test. Se capturan todos para que cada boot quede aislado.
let documentHandlers = [];
let windowHandlers = [];
let documentAddEventListenerSpy = null;
let windowAddEventListenerSpy = null;

function bootSolarUi() {
  const customInputs = MT_IDS
    .map((id) => `<input id="${id}" class="input" type="text" value="">`)
    .join('\n');
  document.body.innerHTML = `
    <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
    <input id="bv-file" type="file">
    <button id="upload-csv-btn"></button>
    <span id="file-name"></span>
    <div id="file-selected-msg"></div>
    <button id="remove-file"></button>
    <input id="bv-p1" value="3,45">
    <input id="bv-p2" value="3,45">
    <input id="bv-saldo-inicial" value="0">
    <div class="bv-cs" id="bv-mes-inicio">
      <button type="button" id="bv-mes-inicio-btn" disabled aria-haspopup="listbox" aria-expanded="false">
        <span class="bv-cs-value">Orden de la tabla (por defecto)</span>
      </button>
      <ul id="bv-mes-inicio-list"></ul>
    </div>
    <select id="bv-zona-fiscal"><option value="Península" selected>Península</option></select>
    <div id="bv-vivienda-canarias-wrapper"></div>
    <input id="bv-vivienda-canarias" type="checkbox">
    <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
    <div id="bv-results-container"></div>
    <div id="bv-results"></div>
    <div id="bv-status-container"></div>
    <div id="bv-status"></div>
    <div id="bv-manual-grid"></div>
    <div id="bv-data-status"></div>
    ${customInputs}
    <input id="mtBV" type="checkbox">
    <input id="mtSinSSAA" type="checkbox">
    <input id="mtCompensacionIndexada" type="checkbox">
    <input id="mtTopeParcial" type="checkbox">
  `;

  window.matchMedia = vi.fn((query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));

  window.BVSim = {};
  // Sin mocks de LF: aqui interesan el esNumericoValido y el parseNum reales.
  expect(typeof window.LF.esNumericoValido).toBe('function');
  expect(typeof window.LF.parseNum).toBe('function');
  // Dependencias que bv-ui exige para no abortar por init incompleto.
  window.BVSim.loadTarifasBV = vi.fn();
  window.BVSim.simulateForAllTarifasBV = vi.fn();
  window.BVSim.simulateMonthly = vi.fn();

  const nativeDocumentAddEventListener = document.addEventListener.bind(document);
  documentAddEventListenerSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    nativeDocumentAddEventListener(type, listener, options);
    documentHandlers.push({ type, listener, options });
  });
  const nativeWindowAddEventListener = window.addEventListener.bind(window);
  windowAddEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    nativeWindowAddEventListener(type, listener, options);
    windowHandlers.push({ type, listener, options });
  });

  loadBvUi(window);
  // Todo bv-ui vive dentro de un handler de DOMContentLoaded.
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  // Doble centinela sobre el tooltip flotante, que cada init crea una vez:
  //  - 0 => el modulo no llego a inicializarse y no hay listeners que
  //    ejercitar, asi que cualquier "no marca error" pasaria en falso.
  //  - >1 => el afterEach dejo de desregistrar y este boot esta reejecutando
  //    los handlers de los tests anteriores.
  expect(document.querySelectorAll('.bv-floating-tooltip')).toHaveLength(1);
}

function type(id, value) {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  return el;
}

function setCustomTarifa({
  punta = '0,12345678',
  llano = '',
  valle = '',
  p1 = '0,08765432',
  p2 = '',
  exc = '0,07432198',
  bv = false,
  precioBV = '',
  sinSSAA = false,
  compensacionIndexada = false,
  topeParcial = false
} = {}) {
  document.getElementById('mtPunta').value = punta;
  document.getElementById('mtLlano').value = llano;
  document.getElementById('mtValle').value = valle;
  document.getElementById('mtP1').value = p1;
  document.getElementById('mtP2').value = p2;
  document.getElementById('mtExc').value = exc;
  document.getElementById('mtBV').checked = bv;
  document.getElementById('mtPrecioBV').value = precioBV;
  document.getElementById('mtSinSSAA').checked = sinSSAA;
  document.getElementById('mtCompensacionIndexada').checked = compensacionIndexada;
  document.getElementById('mtTopeParcial').checked = topeParcial;
}

beforeEach(() => {
  vi.useFakeTimers();
  documentHandlers = [];
  windowHandlers = [];
  documentAddEventListenerSpy = null;
  windowAddEventListenerSpy = null;
});

afterEach(() => {
  documentHandlers.forEach(({ type, listener, options }) => {
    document.removeEventListener(type, listener, options);
  });
  windowHandlers.forEach(({ type, listener, options }) => {
    window.removeEventListener(type, listener, options);
  });
  documentHandlers = [];
  windowHandlers = [];
  if (documentAddEventListenerSpy) documentAddEventListenerSpy.mockRestore();
  if (windowAddEventListenerSpy) windowAddEventListenerSpy.mockRestore();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.BVSim = {};
});

describe('Simulador solar - "Mi tarifa": precision decimal (issue #14)', () => {
  it('centinela: la validacion en vivo esta conectada y marca un precio fuera de rango', () => {
    bootSolarUi();

    // 5 EUR/kWh supera el tope de 1: si esto no marca error, el listener no
    // esta enganchado y el resto de asserts de este fichero no valdrian nada.
    expect(type('mtPunta', '5').classList.contains('error')).toBe(true);
  });

  it('acepta precios de energia con 7 decimales y coma', () => {
    bootSolarUi();

    expect(type('mtPunta', '0,1118785').classList.contains('error')).toBe(false);
    expect(type('mtLlano', '0,0379625').classList.contains('error')).toBe(false);
    expect(type('mtValle', '0,1112950').classList.contains('error')).toBe(false);
  });

  it('acepta 8 decimales con coma en energia, potencia y compensacion', () => {
    bootSolarUi();

    expect(type('mtPunta', '0,12345678').classList.contains('error')).toBe(false);
    expect(type('mtP1', '0,12345678').classList.contains('error')).toBe(false);
    expect(type('mtP2', '0,08765432').classList.contains('error')).toBe(false);
    expect(type('mtExc', '0,07432198').classList.contains('error')).toBe(false);
  });

  it('rechaza 9 decimales con coma en energia, potencia y compensacion', () => {
    bootSolarUi();

    expect(type('mtPunta', '0,123456789').classList.contains('error')).toBe(true);
    expect(type('mtP1', '0,123456789').classList.contains('error')).toBe(true);
    expect(type('mtExc', '0,074321987').classList.contains('error')).toBe(true);
  });

  it('mantiene los topes monetarios con 8 decimales (1 EUR/kWh y 0,5 EUR/kWh)', () => {
    bootSolarUi();

    expect(type('mtPunta', '1,00000001').classList.contains('error')).toBe(true);
    expect(type('mtP1', '1,00000001').classList.contains('error')).toBe(true);
    expect(type('mtExc', '0,50000001').classList.contains('error')).toBe(true);
  });

  it('el boton inicia la simulacion con precios de 8 decimales', () => {
    bootSolarUi();
    setCustomTarifa();
    const requested = vi.fn();
    document.addEventListener('lf:results-requested', requested);

    document.getElementById('bv-simulate').click();

    expect(requested).toHaveBeenCalledTimes(1);
    expect(document.getElementById('bv-simulate').disabled).toBe(true);
    expect(document.getElementById('toastText').textContent).toBe('');
  });

  it.each([
    ['energia', { punta: '0,123456789' }, 'precios de energía'],
    ['potencia', { p1: '0,087654329' }, 'precios de potencia'],
    ['compensacion', { exc: '0,074321987' }, 'precio de compensación']
  ])('el boton bloquea 9 decimales en %s', (_campo, override, expectedMessage) => {
    bootSolarUi();
    setCustomTarifa(override);
    const requested = vi.fn();
    document.addEventListener('lf:results-requested', requested);

    document.getElementById('bv-simulate').click();

    expect(requested).not.toHaveBeenCalled();
    expect(window.BVSim.simulateForAllTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('bv-simulate').disabled).toBe(false);
    expect(document.getElementById('toastText').textContent).toContain(expectedMessage);
  });
});

describe('Simulador solar - "Mi tarifa": 0 explicito no se confunde con vacio (14/08/2026)', () => {
  it('un P2=0 explicito se conserva, no se sustituye por P1', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', llano: '0,10', valle: '0,10', p1: '0,10', p2: '0' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa).not.toBeNull();
    expect(tarifa.p1).toBe(0.10);
    expect(tarifa.p2).toBe(0);
  });

  it('P1 vacio de verdad SI hereda el valor de P2 (comportamiento de fallback intacto)', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', llano: '0,10', valle: '0,10', p1: '', p2: '0,05' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.p1).toBe(0.05);
    expect(tarifa.p2).toBe(0.05);
  });

  it('1P con un solo precio de energia relleno lo replica a los tres periodos (regresion)', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,12', llano: '', valle: '', p1: '0,08', p2: '' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.tipo).toBe('1P');
    expect(tarifa.cPunta).toBe(0.12);
    expect(tarifa.cLlano).toBe(0.12);
    expect(tarifa.cValle).toBe(0.12);
  });

  it('Punta relleno + Llano=0 explicito cuentan como 3P, no como 1P replicada', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,12', llano: '0', valle: '', p1: '0,08', p2: '' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.tipo).toBe('3P');
    expect(tarifa.cPunta).toBe(0.12);
    expect(tarifa.cLlano).toBe(0);
    // Valle vacio de verdad hereda el primer precio de energia relleno (Punta).
    expect(tarifa.cValle).toBe(0.12);
  });

  it.each([
    ['compensacion vacia', ''],
    ['compensacion cero explicito', '0']
  ])('BV marcada con %s se normaliza a fv.bv=false', (_caso, excRaw) => {
    // INVARIANTE: fv.bv significa "BV aplicable", no "el checkbox estaba marcado". Este
    // productor es el del simulador; bv-sim-monthly.js activa la BV mirando solo fv.bv,
    // mientras lf-calc.js y desglose-calculo.js exigen ademas tipo === 'SIMPLE + BV'. Emitir
    // bv:true sin compensacion cobraba la cuota mensual aqui y no en home, dando importes
    // distintos para la misma configuracion del usuario.
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', llano: '0,10', valle: '0,10', p1: '0,08', p2: '0,08', exc: excRaw, bv: true, precioBV: '2,99' });

    const tarifa = window.BVSim._getCustomTarifa();

    // El cero explicito importa aparte del vacio: una implementacion por truthiness del
    // valor crudo — `indexada || Boolean(rawExc)` — pasaria el caso '' y fallaria con '0',
    // porque Boolean('0') es true.
    expect(tarifa.fv.exc).toBe(0);
    expect(tarifa.fv.bv).toBe(false);
    expect(tarifa.fv.reglaBV).toBe('NO APLICA');
    expect(tarifa.fv.tipo).toBe('NO COMPENSA');
  });

  it('BV con compensacion indexada sigue activa (exc = -1 compensa)', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', llano: '0,10', valle: '0,10', p1: '0,08', p2: '0,08', exc: '', bv: true, precioBV: '2,99', compensacionIndexada: true });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.fv.exc).toBe(-1);
    expect(tarifa.fv.bv).toBe(true);
    expect(tarifa.fv.reglaBV).toBe('BV MES ANTERIOR');
    expect(tarifa.fv.tipo).toBe('SIMPLE + BV');
  });

  it('todos los campos de energia vacios sigue devolviendo null (regresion)', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '', llano: '', valle: '', p1: '0,08', p2: '' });

    expect(window.BVSim._getCustomTarifa()).toBeNull();
  });
});

describe('Simulador solar - "Mi tarifa": cuota mensual de bateria virtual (14/08/2026)', () => {
  it('con BV activa, la cuota mensual se incluye en fv.precioBV', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', p1: '0,08', bv: true, precioBV: '2,99' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.fv.bv).toBe(true);
    expect(tarifa.fv.precioBV).toBe(2.99);
  });

  it('sin BV, precioBV es siempre 0 aunque el campo tenga contenido (regresion)', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', p1: '0,08', bv: false, precioBV: '2,99' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.fv.bv).toBe(false);
    expect(tarifa.fv.precioBV).toBe(0);
  });

  it('con BV activa y cuota explicita 0, se acepta y precioBV es 0', () => {
    bootSolarUi();
    setCustomTarifa({ punta: '0,10', p1: '0,08', bv: true, precioBV: '0' });

    const tarifa = window.BVSim._getCustomTarifa();

    // Una BV gratuita sigue activa: la cuota no es requisito de activacion. Sin estos
    // asserts, `bv: hasBV && compensa && precioBV > 0` pasaria el test.
    expect(tarifa.fv.bv).toBe(true);
    expect(tarifa.fv.reglaBV).toBe('BV MES ANTERIOR');
    expect(tarifa.fv.tipo).toBe('SIMPLE + BV');
    expect(tarifa.fv.precioBV).toBe(0);
  });
});

// 14/08/2026: sin estos tres, "Mi tarifa" no podia reproducir 17 de las 118 tarifas activas
// que usan al menos una de estas condiciones economicas. Ver AUDITORIA-IA.md.
describe('Simulador solar - "Mi tarifa": opciones avanzadas (14/08/2026)', () => {
  it('por defecto, incluyeServiciosAjuste es true (sin SSAA aparte)', () => {
    bootSolarUi();
    setCustomTarifa();

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.incluyeServiciosAjuste).toBe(true);
  });

  it('mtSinSSAA marcado produce incluyeServiciosAjuste: false (SSAA se cobra aparte)', () => {
    bootSolarUi();
    setCustomTarifa({ sinSSAA: true });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.incluyeServiciosAjuste).toBe(false);
  });

  it('mtCompensacionIndexada marcada produce fv.exc=-1, ignorando el precio fijo', () => {
    bootSolarUi();
    setCustomTarifa({ exc: '0,07', compensacionIndexada: true });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.fv.exc).toBe(-1);
    expect(tarifa.fv.tipo).toBe('SIMPLE');
  });

  it('mtTopeParcial marcado produce fv.tope: ENERGIA_PARCIAL', () => {
    bootSolarUi();
    setCustomTarifa({ exc: '0,07', topeParcial: true });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.fv.tope).toBe('ENERGIA_PARCIAL');
  });

  it('por defecto (sin marcar), fv.tope sigue siendo ENERGIA (regresion)', () => {
    bootSolarUi();
    setCustomTarifa({ exc: '0,07' });

    const tarifa = window.BVSim._getCustomTarifa();

    expect(tarifa.fv.tope).toBe('ENERGIA');
    expect(tarifa.fv.exc).toBe(0.07);
  });
});
