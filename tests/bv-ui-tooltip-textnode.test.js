import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Regresion permanente del error observado en produccion (build 20260620-051941):
//   "Uncaught TypeError: e.target.closest is not a function"
//   /js/bv/bv-ui.js:1368:32 | @/comparador-tarifas-solares.html
//
// Causa: los handlers de tooltip escuchan en `document`, y el `target` de un
// evento no siempre es un Element. Cuando es un nodo de texto (nodeType 3), que
// es lo que llega al pasar el raton por texto suelto, `.closest()` no existe y
// el handler revienta. El guard `instanceof Element` es lo que lo evita, y este
// test existe para que no se pueda quitar sin que salte la suite.

const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const loadBvUi = new Function('window', uiCode);

function stubMatchMedia({ hover, coarse }) {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('hover: hover') ? hover : (query.includes('pointer: coarse') ? coarse : false),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));
}

function bootDevice({ hover, coarse }) {
  document.body.innerHTML = '<div id="host">texto suelto sin envoltorio</div>';
  stubMatchMedia({ hover, coarse });
  window.BVSim = {};
  window.LF = window.LF || {};
  window.LF.parseNum = (val) => (val === null || val === undefined ? 0 : parseFloat(String(val).replace(',', '.')));
  window.BVSim.loadTarifasBV = vi.fn();
  window.BVSim.simulateForAllTarifasBV = vi.fn();
  window.BVSim.simulateMonthly = vi.fn();
  loadBvUi(window);
  // Todo bv-ui vive dentro de un handler de DOMContentLoaded: sin esto no se
  // registra ningun listener y el test pasaria sin probar nada.
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  // Centinela anti-test-vacuo: si el modulo no llego a inicializarse, el
  // tooltip flotante no existe y no hay handlers que ejercitar.
  expect(document.querySelector('.bv-floating-tooltip')).toBeTruthy();
}

let listenerErrors;
let onWindowError;

beforeEach(() => {
  listenerErrors = [];
  onWindowError = (e) => listenerErrors.push(e.message || String(e.error));
  window.addEventListener('error', onWindowError);
});

afterEach(() => {
  window.removeEventListener('error', onWindowError);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function firstTextNode() {
  const node = document.getElementById('host').firstChild;
  // Si esto deja de ser un nodo de texto, el test ya no prueba lo que dice.
  expect(node.nodeType).toBe(3);
  expect(node instanceof window.Element).toBe(false);
  return node;
}

describe('bv-ui: eventos cuyo target no es un Element', () => {
  it('no revienta en mouseover disparado desde un nodo de texto (dispositivo con hover)', () => {
    bootDevice({ hover: true, coarse: false });

    firstTextNode().dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));

    expect(listenerErrors).toEqual([]);
  });

  it('no revienta en mouseout disparado desde un nodo de texto (dispositivo con hover)', () => {
    bootDevice({ hover: true, coarse: false });

    firstTextNode().dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));

    expect(listenerErrors).toEqual([]);
  });

  it('no revienta en click disparado desde un nodo de texto (dispositivo tactil)', () => {
    // En tactil el handler de tap no sale por el early-return de `canHover`.
    bootDevice({ hover: false, coarse: true });

    firstTextNode().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(listenerErrors).toEqual([]);
  });

  it('sigue resolviendo el tooltip cuando el target si es un Element', () => {
    bootDevice({ hover: true, coarse: false });

    const trigger = document.createElement('span');
    trigger.className = 'bv-tooltip-trigger';
    trigger.setAttribute('data-tip', 'Coste fijo mensual de la bateria virtual');
    document.body.appendChild(trigger);

    trigger.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));

    expect(listenerErrors).toEqual([]);
    const tooltip = document.querySelector('.bv-floating-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toBe('Coste fijo mensual de la bateria virtual');
    expect(tooltip.style.display).toBe('block');
  });
});
