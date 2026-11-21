import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

import '../js/lf-utils.js';
import '../js/lf-config.js';
import '../js/lf-ssaa.js';

/**
 * @vitest-environment jsdom
 */

// INP del simulador solar y del observatorio (20/11/2026; INP de campo del simulador en movil 242 ms).
// Medido en movil emulado con CPU 4x:
//   - Cambiar el tema con resultados pintados: 850-980 ms en solar y 160-220 ms en el observatorio, porque
//     cada elemento animaba su color. Ahora `lf-theme-switching` (pro.css) anula las transiciones durante el
//     cambio, como toggleTheme() en la home: 80-96 ms y 64 ms.
//   - Tras simular habia ~41.000 elementos (el desglose mensual de 65 alternativas, ~3,8 MB de HTML): 0,9 s
//     de hilo bloqueado. El desglose de cada alternativa se construye al abrirlo.
//   - Cada toque activaba `.card:active { transform: scale(0.98) }` sobre la tarjeta que contiene todo el
//     simulador (~25.000 px con resultados): la pagina entera se encogia y se repintaba, 150-200 ms por toque.
//     Retirada la regla: 32-112 ms.

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

// rAF y setTimeout controlados: el cambio debe quitar la clase tras DOS frames, o a los 500 ms si no llegan.
function relojes(win) {
  const frames = [];
  const timers = [];
  win.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  win.setTimeout = (cb, ms) => { timers.push({ cb, ms }); return timers.length; };
  return {
    frame() { const lote = frames.splice(0); lote.forEach((cb) => cb()); },
    timers,
    vencer(ms) { timers.filter((t) => t.ms === ms).forEach((t) => t.cb()); }
  };
}

function comprobarCambioSinTransiciones(win, root, pulsar, reloj) {
  expect(root.classList.contains('lf-theme-switching')).toBe(false);
  const temaAntes = root.classList.contains('light-mode');
  pulsar();
  // Durante el cambio: transiciones anuladas y tema ya aplicado.
  expect(root.classList.contains('lf-theme-switching')).toBe(true);
  expect(root.classList.contains('light-mode')).toBe(!temaAntes);
  reloj.frame();
  expect(root.classList.contains('lf-theme-switching')).toBe(true); // un solo frame no basta
  reloj.frame();
  expect(root.classList.contains('lf-theme-switching')).toBe(false);

  // Dos clics rapidos: la retirada del primero no puede quitar la clase durante el segundo.
  pulsar();
  pulsar();
  reloj.vencer(500); // vence el respaldo del PRIMER clic... y el del segundo
  // El del segundo si la retira (es el vigente); lo que no puede pasar es quedarse puesta.
  expect(root.classList.contains('lf-theme-switching')).toBe(false);
  pulsar();
  const pendientes = reloj.timers.length;
  pulsar();
  // Retirar con los temporizadores del clic anterior no debe soltar la clase del clic en curso.
  reloj.timers.slice(0, pendientes).forEach((t) => t.cb());
  expect(root.classList.contains('lf-theme-switching')).toBe(true);
  reloj.frame();
  reloj.frame();
  expect(root.classList.contains('lf-theme-switching')).toBe(false);
}

describe('cambio de tema sin transiciones', () => {
  it('observatorio y paginas con shell-lite.js', () => {
    const dom = new JSDOM('<!doctype html><body><button id="btnTheme"></button></body>', {
      url: 'https://luzfija.es/estadisticas/', runScripts: 'outside-only'
    });
    const win = dom.window;
    win.LF = { initSwUpdate: vi.fn() };
    Object.defineProperty(win, 'caches', { configurable: true, value: { keys: () => new Promise(() => {}), delete: vi.fn() } });
    const reloj = relojes(win);
    win.eval(read('js/shell-lite.js'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    reloj.timers.splice(0).forEach((t) => t.cb()); // arranque diferido del shell
    const root = win.document.documentElement;
    comprobarCambioSinTransiciones(win, root, () => win.document.getElementById('btnTheme').click(), reloj);
    dom.window.close();
  });

  it('simulador solar (bv-ui.js)', () => {
    document.body.innerHTML = `
      <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
      <button id="btnTheme"></button>
      <input id="bv-file" type="file"><button id="upload-csv-btn"></button><span id="file-name"></span>
      <div id="file-selected-msg"></div><button id="remove-file"></button>
      <input id="bv-p1" value="3,45"><input id="bv-p2" value="3,45"><input id="bv-saldo-inicial" value="0">
      <div class="bv-cs" id="bv-mes-inicio"><button type="button" id="bv-mes-inicio-btn" disabled><span class="bv-cs-value"></span></button><ul id="bv-mes-inicio-list"></ul></div>
      <select id="bv-zona-fiscal"><option value="Península" selected>Península</option></select>
      <div id="bv-vivienda-canarias-wrapper"></div><input id="bv-vivienda-canarias" type="checkbox">
      <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
      <div id="bv-results-container"></div><div id="bv-results"></div>
      <div id="bv-status-container"></div><div id="bv-status"></div>
      <div id="bv-manual-grid"></div><div id="bv-data-status"></div>`;
    window.matchMedia = vi.fn((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    window.BVSim = { loadTarifasBV: vi.fn(), simulateForAllTarifasBV: vi.fn(), simulateMonthly: vi.fn() };
    const reloj = relojes(window);
    const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv')).filter((f) => /^bv-ui.*\.js$/.test(f)).sort()
      .map((f) => fs.readFileSync(path.resolve(__dirname, '../js/bv', f), 'utf8')).join('\n');
    new Function('window', uiCode)(window);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    expect(document.getElementById('btnTheme').dataset.bvBound).toBe('1');
    reloj.timers.splice(0);
    comprobarCambioSinTransiciones(window, document.documentElement, () => document.getElementById('btnTheme').click(), reloj);
  });

  it('pro.css (cargado en solar y observatorio) anula las transiciones con la clase', () => {
    const css = read('pro.css').replace(/\s+/g, ' ');
    expect(css).toContain('html.lf-theme-switching *');
    expect(css).toMatch(/html\.lf-theme-switching \*::after\{ transition: none !important; \}/);
    for (const html of ['comparador-tarifas-solares.html', 'estadisticas/index.html']) {
      expect(read(html)).toMatch(/<link rel="stylesheet" href="\/pro\.css/);
    }
  });
});

describe('resultados del simulador solar: desglose bajo demanda y sin :active en la tarjeta contenedora', () => {
  const src = read('js/bv/bv-ui.js');
  const alternativas = src.slice(src.indexOf('const alternativesHTML = rankedResults.slice(1).map('), src.indexOf("}).join('');", src.indexOf('const alternativesHTML')));

  it('las alternativas no construyen su desglose al pintar el ranking', () => {
    expect(alternativas).toContain('<details class="bv-alt-details" data-bv-desglose="${i + 1}">');
    expect(alternativas).not.toContain('buildTable(');
  });

  it('el boton "Ver desglose" lo construye una sola vez, con buildTable() y el resultado de su tarjeta', () => {
    const handler = src.slice(src.indexOf("resultsEl.querySelectorAll('.bv-alt-btn-toggle').forEach"), src.indexOf('const renderGeneration = ++resultRenderGeneration;'));
    expect(handler).toContain("if (details.dataset.bvDesglose && !details.dataset.bvDesgloseListo) {");
    expect(handler).toContain('const resultItem = rankedResults[Number(details.dataset.bvDesglose)];');
    expect(handler).toContain("details.insertAdjacentHTML('beforeend', buildTable(resultItem));");
    expect(handler).toContain("details.dataset.bvDesgloseListo = '1';");
    // Se construye ANTES de abrir: el usuario ve el contenido en el mismo clic.
    expect(handler.indexOf('buildTable(resultItem)')).toBeLessThan(handler.indexOf("details.toggleAttribute('open');"));
    // data-bv-desglose = i + 1 porque la tarjeta i es la alternativa rankedResults[i + 1] (la 0 es el ganador).
    expect(src).toContain('const alternativesHTML = rankedResults.slice(1).map((r, i) => {');
  });

  it('el ganador sigue trayendo su desglose hecho', () => {
    expect(src).toMatch(/Ver desglose detallado del ganador<\/summary>\s*\$\{buildTable\(winner\)\}/);
  });

  it('sin content-visibility en las tarjetas: en WebKit dejaba el boton "Ver desglose" sin respuesta al toque', () => {
    // Probado el 20/11/2026: con content-visibility:auto, en WebKit elementFromPoint() devolvia null sobre el
    // boton de una tarjeta recien llevada a la vista y el toque no hacia nada.
    expect(read('bv-sim.css')).not.toMatch(/\.bv-alt-card-compact\s*\{[^}]*content-visibility/);
  });

  it('ningun :active encoge la tarjeta contenedora (cada toque repintaba la pagina entera)', () => {
    // .card envuelve todo el simulador (~25.000 px tras simular): con .card:active { transform: scale(0.98) }
    // cada toque en cualquier sitio encogia y repintaba la pagina, 150-200 ms por toque en movil con CPU 4x.
    for (const f of ['comparador-solar-mejorado.css', 'bv-sim.css', 'styles.css', 'pro.css']) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, f).not.toMatch(/(^|[\s,}])\.card:active\b/);
    }
  });
});

describe('simulador solar: respuesta visual al calcular', () => {
  it('conserva la altura del boton y cambia las etiquetas sin animar visibility en tactil', () => {
    const css = read('bv-sim.css').replace(/\s+/g, ' ');
    expect(css).toContain('#bv-simulate .bv-btn-text { transition-property: none; }');
    expect(css).toContain('#bv-simulate[aria-busy="true"] .bv-btn-text { visibility: hidden; }');
    expect(css).toMatch(/#bv-simulate \.bv-btn-loading \{ display: none; position: absolute;/);
    expect(css).toContain('#bv-simulate[aria-busy="true"] .bv-btn-loading { display: flex; }');
  });
});
