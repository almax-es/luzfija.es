import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

/**
 * El simulador solar no puede producir importes con una carga incompleta (ronda 26,
 * 08/09/2026).
 *
 * `js/bv/bv-sim-monthly.js` esta escrito a la defensiva y sobrevive a la ausencia de sus
 * proveedores fiscales, pero al hacerlo miente en el resultado en vez de callarse:
 *
 *   - sin `lf-config.js`, `CFG` queda vacio y el motor cae a sus ramas locales: IEE 0,00 y
 *     impuesto indirecto 0,00. Escenario medido: 125 kWh a 0,10 EUR/kWh en 30 dias pasa de
 *     17,81 EUR a 14,04 EUR, sin marcar la fila de ninguna forma.
 *   - sin `lf-ssaa.js`, el fallback devuelve `{ aplica:false, available:true }`, que
 *     traduce "no se si hay que aplicar SSAA" por "no aplica". Una tarifa con
 *     `incluyeServiciosAjuste:false` pierde su coste de servicios de ajuste: 20,85 EUR
 *     pasan a 17,81 EUR. Como `aplica` es false, tampoco entra en la rama `dataUnavailable`
 *     que existe justo para eso.
 *
 * Las dos ausencias son de CARGA, no de dato: en produccion los dos ficheros van siempre
 * antes que bv-ui.js en comparador-tarifas-solares.html (la unica pagina que lo carga). Por
 * eso la decision se toma aqui, en el gate de arranque que ya existe, y no repartiendo
 * fail-closed por el motor: si el proveedor no esta, no hay simulador, igual que ya ocurre
 * cuando falta `bv-ui-helpers.js` o `LF.parseNum`.
 *
 * Ojo al leer los asserts: se comprueba el ESTADO VISIBLE (controles deshabilitados y
 * mensaje), no una llamada interna. Un guard que se ejecute pero no bloquee la UI dejaria
 * al usuario calculando igual.
 */

const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const loadBvUi = new Function('window', uiCode);

// Modulos reales cargados a mano (no con import) para poder retirar uno concreto en cada
// caso: un import se evalua una sola vez y no se puede "descargar".
function runModule(relPath) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  new Function('window', code)(window);
}

const CONTROLES = ['bv-simulate', 'upload-csv-btn', 'bv-file'];

function montarDom() {
  document.body.innerHTML = `
    <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
    <input id="bv-file" type="file">
    <button id="upload-csv-btn"></button>
    <span id="file-name"></span>
    <div id="file-selected-msg"></div>
    <button id="remove-file"></button>
    <input id="bv-p1" value="3,45">
    <input id="bv-p2" value="3,45">
    <select id="bv-zona-fiscal"><option value="Península" selected>Península y Baleares</option></select>
    <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
    <div id="bv-results-container"></div>
    <div id="bv-results"></div>
    <div id="bv-status-container"></div>
    <div id="bv-status"></div>
    <div id="bv-manual-grid"></div>
  `;
}

// Publica el minimo que el gate exige APARTE de los proveedores fiscales, para que el unico
// motivo posible de aborto sea el que cada caso retira.
function montarNucleoSimulacion() {
  window.BVSim = {};
  window.BVSim.loadTarifasBV = vi.fn();
  window.BVSim.simulateForAllTarifasBV = vi.fn();
  window.BVSim.simulateMonthly = vi.fn();
  window.BVSim.importFile = vi.fn();
}

function arrancar({ conConfig = true, conSsaa = true } = {}) {
  montarDom();
  window.matchMedia = vi.fn((query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));

  delete window.LF_CONFIG;
  window.LF = {};
  runModule('js/lf-utils.js');
  if (conConfig) runModule('js/lf-config.js');
  if (conSsaa) runModule('js/lf-ssaa.js');

  montarNucleoSimulacion();
  loadBvUi(window);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
}

function estaBloqueado() {
  return CONTROLES.every((id) => document.getElementById(id)?.disabled === true);
}

describe('Simulador solar: los proveedores fiscales son dependencia de arranque', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('sin lf-config.js no arranca: bloquea los controles y lo dice', () => {
    arrancar({ conConfig: false });

    expect(window.LF_CONFIG).toBeUndefined();
    expect(estaBloqueado()).toBe(true);
    expect(document.getElementById('bv-status').textContent)
      .toContain('La página no terminó de cargarse');
    expect(document.getElementById('bv-status-container').style.display).toBe('block');
  });

  it('sin lf-ssaa.js tampoco arranca', () => {
    arrancar({ conSsaa: false });

    expect(window.LF.ssaa).toBeUndefined();
    expect(estaBloqueado()).toBe(true);
    expect(document.getElementById('bv-status').textContent)
      .toContain('La página no terminó de cargarse');
  });

  it('con un LF_CONFIG presente pero sin las funciones fiscales tampoco arranca', () => {
    // Un objeto a medias no es "configuracion disponible": el motor leeria
    // `CFG.calcularIEE` como undefined y volveria a sus ramas locales de cero.
    montarDom();
    window.matchMedia = vi.fn(() => ({
      matches: false, media: '', addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}
    }));
    window.LF = {};
    runModule('js/lf-utils.js');
    runModule('js/lf-ssaa.js');
    window.LF_CONFIG = { territorios: {}, iee: { porcentaje: 5.11269632 } };
    montarNucleoSimulacion();
    loadBvUi(window);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(estaBloqueado()).toBe(true);
  });

  // Centinela positivo: sin el, los tres casos de arriba pasarian aunque el gate abortase
  // SIEMPRE, que dejaria el simulador muerto para todo el mundo.
  it('con los dos proveedores presentes el simulador arranca con normalidad', () => {
    arrancar();

    expect(typeof window.LF_CONFIG.calcularIEE).toBe('function');
    expect(typeof window.LF.ssaa.calcCharge).toBe('function');
    expect(CONTROLES.some((id) => document.getElementById(id)?.disabled === true)).toBe(false);
    expect(document.getElementById('bv-status').textContent)
      .not.toContain('La página no terminó de cargarse');
  });
});
