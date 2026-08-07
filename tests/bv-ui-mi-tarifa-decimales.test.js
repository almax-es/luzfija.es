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

const MT_IDS = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc'];

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
  exc = '0,07432198'
} = {}) {
  document.getElementById('mtPunta').value = punta;
  document.getElementById('mtLlano').value = llano;
  document.getElementById('mtValle').value = valle;
  document.getElementById('mtP1').value = p1;
  document.getElementById('mtP2').value = p2;
  document.getElementById('mtExc').value = exc;
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
