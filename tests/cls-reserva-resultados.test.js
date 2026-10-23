/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * CLS del footer en escritorio (Core Web Vitals, 22-23/10/2026).
 *
 * renderAll() abria #seccionResultados cuando terminaba la red (tarifas + PVPC), casi siempre
 * mas de 500 ms despues del clic en Calcular. La tabla (99 filas) empujaba entonces el footer y,
 * si estaba a la vista (monitor alto o pagina scrolleada), Chrome lo contaba como salto: CLS
 * 0,155 con el footer asomando 182 px y 0,39-0,43 con 488 px (clic real). Search Console lo
 * marco el 16/10/2026 ("CLS > 0,1 (ordenador)", 18 URLs, 0,16 en campo).
 *
 * El primer arreglo (22/10) fue un hueco permanente `.grid:not(.has-results){min-height:100vh}`:
 * no cubria a quien scrollea antes de calcular (0,22 con scroll 500). El definitivo (23/10)
 * abre la seccion en el MISMO tick del clic con espacio reservado, dentro de los 500 ms que
 * Chrome no cuenta, y la libera al terminar. Medido con clic real y 1,5 s de red simulada:
 * 0,0001 con la pagina a 500 px y al fondo (control sin el arreglo: 0,3906), 0,001 arriba.
 *
 * Nada falla en consola si se rompe: solo empeora el CLS de campo semanas despues. Estos tests
 * vigilan las tres piezas: la reserva/liberacion, que calculate() reserve ANTES del primer
 * await, y que no vuelva el hueco permanente.
 */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------------------------------
// 1) lf-render.js: reserveResultsSpace() / releaseResultsSpace()
// ---------------------------------------------------------------------------------------
const renderCode = read('js/lf-render.js');

function bootRender() {
  document.body.innerHTML = `
    <div class="grid">
      <section class="card" id="formCard"></section>
      <section class="card" id="seccionResultados">
        <div id="heroKpis"><div id="kpiBest"></div><div id="kpiPrice"></div></div>
        <div id="statsBar"><div id="statMin"></div><div id="statAvg"></div><div id="statMax"></div></div>
        <div id="toolbar"></div>
        <div id="pvpcInfo"></div>
        <div id="resultsLiveStatus" role="status"></div>
        <div id="solarHomeEstimatorNotice" hidden></div>
        <div id="consumoLimitsNotice" hidden></div>
        <div id="chartTopBody"></div>
        <div class="tableWrap">
          <table id="table"><thead><tr><th data-sort="totalNum"><span id="si_totalNum"></span></th></tr></thead>
            <tbody id="tbody"></tbody></table>
          <div id="emptyBox"></div>
          <p>* Impuestos</p>
        </div>
      </section>
    </div>
    <button id="scrollToResults" style="display:none"></button>
  `;
  const seccion = document.getElementById('seccionResultados');
  seccion.scrollIntoView = vi.fn();
  window.LF = {
    $: (id) => document.getElementById(id),
    state: { rows: [], filter: 'all', sort: { key: 'totalNum', dir: 'asc' } },
    el: {
      heroKpis: document.getElementById('heroKpis'),
      kpiBest: document.getElementById('kpiBest'),
      kpiPrice: document.getElementById('kpiPrice'),
      statsBar: document.getElementById('statsBar'),
      statMin: document.getElementById('statMin'),
      statAvg: document.getElementById('statAvg'),
      statMax: document.getElementById('statMax'),
      toolbar: document.getElementById('toolbar'),
      pvpcInfo: document.getElementById('pvpcInfo'),
      resultsLiveStatus: document.getElementById('resultsLiveStatus'),
      chartTopBody: document.getElementById('chartTopBody'),
      table: document.getElementById('table'),
      tbody: document.getElementById('tbody'),
      emptyBox: document.getElementById('emptyBox'),
      sortIcons: { totalNum: document.getElementById('si_totalNum') }
    },
    formatMoney: (n) => n + ' €',
    escapeHtml: (s) => s,
    lfDbg: vi.fn(),
    setStatus: vi.fn(),
    toast: vi.fn(),
    animateCounter: vi.fn((elx, text) => { if (elx) elx.textContent = text; }),
    createSuccessParticles: vi.fn(),
    initTooltips: vi.fn(),
    bindTooltipElement: vi.fn(),
    updateSortIcons: vi.fn(),
    parseNum: (v) => Number(String(v ?? '').replace(',', '.')) || 0,
    yieldControl: vi.fn(() => Promise.resolve())
  };
  new Function('window', renderCode)(window);
  return { seccion, grid: document.querySelector('.grid') };
}

function setGeometry(seccion, { top, innerHeight, height = 2000 }) {
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  seccion.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height });
}

const avisoTop = (seccion) => seccion.style.getPropertyValue('--lf-aviso-top');

describe('reserva de espacio para resultados (lf-render.js)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete window.LF;
  });

  it('abre la seccion en el acto, pasa el grid a dos columnas y reserva hasta el borde de la ventana', () => {
    const { seccion, grid } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });

    expect(window.LF.reserveResultsSpace()).toBe(true);

    expect(seccion.classList.contains('visible')).toBe(true);
    expect(seccion.classList.contains('is-reserving')).toBe(true);
    expect(grid.classList.contains('has-results')).toBe(true);
    // 900 - 188 + 160 de margen: el footer queda por debajo del borde inferior.
    expect(seccion.style.minHeight).toBe('872px');
  });

  it('con la pagina scrolleada (seccion por encima de la ventana) reserva mas', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: -312, innerHeight: 900 });
    window.LF.reserveResultsSpace();
    expect(seccion.style.minHeight).toBe('1372px');
  });

  // Revision de ChatGPT, 23/10/2026: con el aviso siempre arriba, a pagina bajada la tarjeta
  // se veia vacia. Se coloca 96 px por debajo de lo visible de la tarjeta.
  it('coloca el aviso donde se ve: bajo la cabecera si esta a la vista, bajo el borde de la ventana si no', () => {
    const arriba = bootRender();
    setGeometry(arriba.seccion, { top: 188, innerHeight: 900 });
    window.LF.reserveResultsSpace();
    expect(avisoTop(arriba.seccion)).toBe('96px');

    const bajada = bootRender();
    setGeometry(bajada.seccion, { top: -312, innerHeight: 900 });
    window.LF.reserveResultsSpace();
    expect(avisoTop(bajada.seccion)).toBe('408px');
  });

  it('al fallar recoloca el aviso de error por si el usuario scrolleo durante la espera, y al acertar lo limpia', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace());
    setGeometry(seccion, { top: -600, innerHeight: 900 });
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace()); // segundo fallo, ya bajado
    expect(avisoTop(seccion)).toBe('696px');

    const abierta = window.LF.reserveResultsSpace();
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(abierta);
    expect(avisoTop(seccion)).toBe('');
  });

  it('si la seccion ya cae por debajo de la ventana (movil) no fija altura', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 1200, innerHeight: 700 });
    expect(window.LF.reserveResultsSpace()).toBe(true);
    expect(seccion.style.minHeight).toBe('');
  });

  it('no hace nada si los resultados ya estaban visibles (recalculos posteriores)', () => {
    const { seccion } = bootRender();
    seccion.classList.add('visible');
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    expect(window.LF.reserveResultsSpace()).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.style.minHeight).toBe('');
  });

  // 23/10/2026: cerrar la seccion al fallar devolvia el footer a la vista ~4 s despues del clic
  // y Chrome lo contaba (0,0646 con la pagina a 500 px). Se queda abierta con su altura.
  it('si el calculo termina sin pintar resultados, NO cierra la seccion: aviso de error y misma altura', () => {
    const { seccion, grid } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const abierta = window.LF.reserveResultsSpace();

    window.LF.releaseResultsSpace(abierta);

    expect(seccion.classList.contains('visible')).toBe(true);
    expect(grid.classList.contains('has-results')).toBe(true);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.classList.contains('is-error')).toBe(true);
    expect(seccion.style.minHeight).toBe('872px');
  });

  it('el reintento tras un fallo reutiliza la seccion sin moverla y libera todo si sale bien', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace()); // primer intento: falla

    // Segundo Calcular: misma altura, el aviso pasa a "Calculando…".
    setGeometry(seccion, { top: -500, innerHeight: 900 });
    const abierta = window.LF.reserveResultsSpace();
    expect(abierta).toBe(true);
    expect(seccion.classList.contains('is-error')).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(true);
    expect(seccion.style.minHeight).toBe('872px');

    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(abierta);

    expect(seccion.classList.contains('visible')).toBe(true);
    expect(seccion.classList.contains('is-error')).toBe(false);
    expect(seccion.style.minHeight).toBe('');
  });

  it('dos fallos seguidos: el segundo vuelve a dejar el aviso de error', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace());
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace());
    expect(seccion.classList.contains('is-error')).toBe(true);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.style.minHeight).toBe('872px');
  });

  it('tras un renderAll correcto, liberar solo quita la altura y deja los resultados', async () => {
    const { seccion, grid } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const abierta = window.LF.reserveResultsSpace();

    await window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa A', precio: '50,00 €' },
      stats: null,
      resultados: []
    });
    // El aviso "Calculando…" se retira en cuanto hay resultados, antes de liberar la altura.
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.style.minHeight).toBe('872px');

    window.LF.releaseResultsSpace(abierta);

    expect(seccion.classList.contains('visible')).toBe(true);
    expect(grid.classList.contains('has-results')).toBe(true);
    expect(seccion.style.minHeight).toBe('');
  });
});

// ---------------------------------------------------------------------------------------
// 2) lf-app.js: calculate() reserva ANTES del primer await y libera en el finally
// ---------------------------------------------------------------------------------------
const appCode = read('js/lf-app.js');

function bootApp(overrides = {}) {
  document.body.innerHTML = `
    <span id="statusText"></span><button id="btnCalc"></button>
    <button id="btnMenu"></button><div id="menuPanel"><button id="btnShare"></button></div>
  `;
  const state = { pending: false, rows: [], lastSignature: null, debounce: null, generation: 0 };
  window.LF = {
    $: (id) => document.getElementById(id),
    el: {
      statusText: document.getElementById('statusText'),
      btnCalc: document.getElementById('btnCalc'),
      btnMenu: document.getElementById('btnMenu'),
      menuPanel: document.getElementById('menuPanel'),
      btnShare: document.getElementById('btnShare'),
      inputs: {}
    },
    state,
    initElements: vi.fn(),
    formatValueForDisplay: (v) => v,
    copyText: vi.fn(),
    toast: vi.fn(),
    setStatus: vi.fn(),
    markPending: vi.fn(),
    applyThemeClass: vi.fn(),
    updateThemeIcon: vi.fn(),
    toggleTheme: vi.fn(),
    initTooltips: vi.fn(),
    fetchTarifas: vi.fn(async () => true),
    getInputValues: vi.fn(() => ({ p1: '1' })),
    signatureFromValues: vi.fn((v) => JSON.stringify(v)),
    validateInputs: vi.fn(() => true),
    loadInputs: vi.fn(),
    saveInputs: vi.fn(),
    updateKwhHint: vi.fn(),
    updateZonaFiscalUI: vi.fn(),
    updateSolarUI: vi.fn(),
    calculateLocal: vi.fn(async () => {}),
    renderTable: vi.fn(),
    updateSortIcons: vi.fn(),
    initCSVImporter: vi.fn(),
    updateMiTarifaForm: vi.fn(),
    agregarMiTarifa: vi.fn(() => null),
    validateMiTarifa: vi.fn(() => true),
    baseTarifasCache: [],
    cachedTarifas: [],
    reserveResultsSpace: vi.fn(() => true),
    releaseResultsSpace: vi.fn(),
    ...overrides
  };
  new Function('window', appCode)(window);
  return state;
}

describe('calculate() y la reserva de espacio (lf-app.js)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete window.LF;
    delete window.calculate;
    delete window.runCalculation;
    delete window.__LF_CALC_INFLIGHT;
  });

  it('reserva de forma sincrona, antes de la primera descarga (dentro de la ventana del clic)', async () => {
    bootApp({ fetchTarifas: vi.fn(() => new Promise(() => {})) });

    window.calculate(true, false); // sin await: lo que importa es lo que ya ocurrio

    const { reserveResultsSpace, fetchTarifas } = window.LF;
    expect(reserveResultsSpace).toHaveBeenCalledTimes(1);
    expect(fetchTarifas).toHaveBeenCalledTimes(1);
    expect(reserveResultsSpace.mock.invocationCallOrder[0])
      .toBeLessThan(fetchTarifas.mock.invocationCallOrder[0]);
  });

  it('libera al terminar, pasando si la abrio este calculo', async () => {
    bootApp();
    await window.calculate(true, false);
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true);
    expect(window.LF.releaseResultsSpace.mock.invocationCallOrder[0])
      .toBeGreaterThan(window.LF.calculateLocal.mock.invocationCallOrder[0]);
  });

  it('tambien libera (pasa a aviso de error) cuando falla la descarga sin catalogo de sesion', async () => {
    bootApp({ fetchTarifas: vi.fn(async () => false), baseTarifasCache: [] });
    await window.calculate(true, false);
    expect(window.LF.calculateLocal).not.toHaveBeenCalled();
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true);
  });

  it('tambien libera si el calculo lanza un error', async () => {
    bootApp({ calculateLocal: vi.fn(async () => { throw new Error('boom'); }) });
    await window.calculate(true, false);
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true);
  });

  it('no reserva nada si los datos no validan (no se abre un ranking que no va a llegar)', async () => {
    bootApp({ validateInputs: vi.fn(() => false) });
    await window.calculate(true, false);
    expect(window.LF.reserveResultsSpace).not.toHaveBeenCalled();
    expect(window.LF.releaseResultsSpace).not.toHaveBeenCalled();
  });

  it('funciona aunque lf-render.js no exponga la reserva (acceso opcional, sin romper el arranque)', async () => {
    bootApp({ reserveResultsSpace: undefined, releaseResultsSpace: undefined });
    await expect(window.calculate(true, false)).resolves.toBeUndefined();
    expect(window.LF.calculateLocal).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------
// 3) styles.css: sin hueco permanente, y el aviso de espera no ocupa sitio en el flujo
// ---------------------------------------------------------------------------------------
describe('CSS de la reserva (styles.css)', () => {
  const css = read('styles.css');

  it('no vuelve el hueco permanente bajo el formulario (sustituido por la reserva al clic)', () => {
    expect(css).not.toMatch(/\.grid:not\(\.has-results\)\s*\{[^}]*min-height/);
  });

  it('los avisos "Calculando…" y de error van fuera de flujo: cambiarlos no puede desplazar nada', () => {
    const regla = css.match(/#seccionResultados\.is-reserving::after,\s*#seccionResultados\.is-error::after\s*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla[1]).toMatch(/position:\s*absolute/);
    expect(regla[1]).toMatch(/top:\s*var\(--lf-aviso-top,\s*96px\)/);
    // La regla propia del error solo cambia texto y color, nunca la posicion.
    const error = css.match(/#seccionResultados\.is-error::after\s*\{([^}]*)\}/);
    expect(error).not.toBeNull();
    expect(error[1]).not.toMatch(/position:\s*(static|relative)/);
  });

  it('la nota de impuestos se oculta con visibility, no con display (reaparecer no mueve nada)', () => {
    const regla = css.match(/#seccionResultados\.is-reserving \.tableWrap > p,\s*#seccionResultados\.is-error \.tableWrap > p\s*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla[1]).toMatch(/visibility:\s*hidden/);
    expect(regla[1]).not.toMatch(/display:/);
  });
});
