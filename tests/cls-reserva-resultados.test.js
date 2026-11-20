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
 * abre la seccion con espacio reservado dentro de los 500 ms que Chrome no cuenta, y la libera
 * al terminar. Medido con clic real y 1,5 s de red simulada: 0,0001 con la pagina a 500 px y al
 * fondo (control sin el arreglo: 0,3906), 0,001 arriba. Hasta el 12/11/2026 se abria en el
 * MISMO tick del clic; desde entonces, justo despues del primer pintado (INP de Calcular
 * 112-120 -> 40-48 ms con CPU 4x, mismo CLS) y siempre antes de pedir tarifas.json.
 *
 * Nada falla en consola si se rompe: solo empeora el CLS de campo semanas despues. Estos tests
 * vigilan las tres piezas: la reserva/liberacion, que calculate() pinte primero y reserve
 * ANTES de pedir tarifas.json, y que no vuelva el hueco permanente.
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

  it('no hace nada si los resultados ya estaban pintados (recalculos posteriores)', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const abierta = window.LF.reserveResultsSpace();
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(abierta);

    expect(window.LF.reserveResultsSpace()).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.style.minHeight).toBe('');
  });

  // 19/11/2026 (revision de ChatGPT, medido en Chrome 157 con clic real y tarifas a 1,5 s):
  // aplicar una factura, un CSV/XLSX o Datadis con resultados ya pintados vacia la seccion con
  // hideResultsToInitialState() pero la deja `.visible`. La reserva salia por "ya visible" y el
  // ranking nuevo crecia fuera de los 500 ms: CLS 0,27 en 1280x1440 y 0,37 en 2560x1440 con la
  // pagina arriba, 0,76 al fondo.
  it('tras vaciar los resultados (factura, CSV, Datadis) vuelve a reservar como la primera vez', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const primera = window.LF.reserveResultsSpace();
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(primera);
    expect(seccion.style.minHeight).toBe('');

    // El camino real: lf-ui.js vacia la seccion y avisa a lf-render.js.
    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    // El cuerpo se oculta en el mismo instante del vaciado, no 150 ms despues al reservar.
    expect(seccion.classList.contains('is-cleared')).toBe(true);

    setGeometry(seccion, { top: -300, innerHeight: 900 });
    const abierta = window.LF.reserveResultsSpace();
    expect(abierta).toBe(true);
    expect(seccion.classList.contains('visible')).toBe(true);
    expect(seccion.classList.contains('is-reserving')).toBe(true);
    expect(seccion.style.minHeight).toBe('1360px'); // 900 + 300 + 160
    expect(avisoTop(seccion)).not.toBe('');

    // Si este calculo falla, la tarjeta vaciada explica el fallo en vez de quedarse en blanco.
    window.LF.releaseResultsSpace(abierta);
    expect(seccion.classList.contains('is-error')).toBe(true);
    expect(seccion.style.minHeight).toBe('1360px');

    // Y el reintento correcto lo libera todo.
    const reintento = window.LF.reserveResultsSpace();
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(reintento);
    expect(seccion.classList.contains('is-error')).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.classList.contains('is-cleared')).toBe(false);
    expect(seccion.style.minHeight).toBe('');
  });

  // QA del 19/11/2026: una factura que pide revision no calcula sola y la tarjeta vaciada se veia
  // en blanco, sin explicacion. factura.js marca .is-pending; el siguiente calculo lo retira.
  it('factura en revision: aviso propio en la tarjeta vaciada, que cede a "Calculando…" y desaparece al pintar', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const primera = window.LF.reserveResultsSpace();
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(primera);

    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    seccion.classList.add('is-pending'); // lo que hace factura.js sin calculo automatico
    // Un segundo vaciado (otra factura, un CSV) parte de cero.
    window.LF.hideResultsToInitialState();
    expect(seccion.classList.contains('is-pending')).toBe(false);

    seccion.classList.add('is-pending');
    const abierta = window.LF.reserveResultsSpace();
    expect(seccion.classList.contains('is-pending')).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(true);
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(abierta);
    expect(seccion.className.trim()).toBe('card visible');
  });

  // Revision de ChatGPT, 19/11/2026: un calculo ya en vuelo cuando se aplico la factura en revision
  // traia el ranking de los datos ANTERIORES; renderAll() lo pintaba y retiraba el aviso.
  it('un calculo en vuelo que termina con la factura en revision no pinta resultados viejos ni marca error', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const abierta = window.LF.reserveResultsSpace(); // primer calculo, en vuelo
    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    seccion.classList.add('is-pending'); // factura.js, durante la espera
    window.LF.state.rows = [];

    await window.LF.renderAll({ success: true, resumen: { mejor: 'Vieja', precio: '9 €' }, stats: { precioMin: '1', precioMedio: '2', precioMax: '3' }, resultados: [{ nombre: 'Vieja', totalNum: 1 }] });
    expect(window.LF.el.tbody.children.length).toBe(0);
    expect(window.LF.el.kpiBest.textContent).toBe('');
    expect(window.LF.state.rows).toEqual([]);
    expect(seccion.classList.contains('is-pending')).toBe(true);
    expect(seccion.classList.contains('is-cleared')).toBe(true);

    window.LF.releaseResultsSpace(abierta);
    expect(seccion.classList.contains('is-error')).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.style.minHeight).not.toBe(''); // la altura se conserva, como en el error

    // El siguiente Calcular del usuario (con los datos de la factura) pinta con normalidad.
    const nueva = window.LF.reserveResultsSpace();
    expect(seccion.classList.contains('is-pending')).toBe(false);
    await window.LF.renderAll({ success: true, resumen: {}, stats: null, resultados: [] });
    window.LF.releaseResultsSpace(nueva);
    expect(seccion.className.trim()).toBe('card visible');
  });

  // Segunda revision de ChatGPT, 19/11/2026: la factura llega DESPUES del guard, mientras la tabla
  // se pinta por bloques. La tabla se cancela, pero la continuacion de renderAll() anunciaba el
  // resumen viejo y desplazaba la pagina hasta la tarjeta.
  it('vaciada a mitad del pintado por bloques: no anuncia el resumen viejo ni desplaza la pagina', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      let reanudar;
      window.LF.yieldControl = vi.fn(() => (reanudar ? Promise.resolve() : new Promise((r) => { reanudar = r; })));
      const filas = Array.from({ length: 25 }, (_, i) => ({ nombre: 'Vieja ' + i, tipo: '1P', totalNum: i, total: i + ' €', potencia: '1 €', consumo: '1 €', impuestos: '1 €', vsMejor: '', vsMejorNum: 0 }));
      const abierta = window.LF.reserveResultsSpace();
      const pintado = window.LF.renderAll({ success: true, resumen: { mejor: 'Vieja 0', precio: '0 €' }, stats: null, resultados: filas });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));

      new Function('window', read('js/lf-ui.js'))(window);
      window.LF.hideResultsToInitialState();
      seccion.classList.add('is-pending'); // factura.js
      reanudar();
      await pintado;
      await vi.advanceTimersByTimeAsync(10);

      expect(window.LF.el.tbody.children.length).toBe(0);
      expect(window.LF.el.resultsLiveStatus.textContent).not.toMatch(/Vieja/);
      expect(seccion.scrollIntoView).not.toHaveBeenCalled();
      window.LF.releaseResultsSpace(abierta);
      expect(seccion.classList.contains('is-error')).toBe(false);
      expect(seccion.classList.contains('is-pending')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // Tercera revision de ChatGPT, 19/11/2026: los vaciados de CSV/XLSX y Datadis no marcan .is-pending.
  // Un calculo en vuelo pintaba el ranking viejo, quedaba "pintado" y el calculo encolado del CSV ya
  // no reservaba altura. Ahora el ciclo de calculo descarta su resultado ante cualquier vaciado.
  it('CSV durante la red del primer calculo: no pinta lo viejo y el calculo encolado reserva y pinta', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const ciclo = window.LF.beginResultsCycle();
    const abierta = window.LF.reserveResultsSpace();
    const altura = seccion.style.minHeight;
    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState(); // CSV: sin .is-pending
    expect(window.LF.resultsCycleDiscarded(ciclo)).toBe(true);

    await window.LF.renderAll({ success: true, resumen: { mejor: 'Vieja', precio: '9 €' }, stats: null, resultados: [{ nombre: 'Vieja', totalNum: 1 }] });
    expect(window.LF.el.kpiBest.textContent).toBe('');
    expect(window.LF.state.rows).toEqual([]);

    // Hay calculo encolado: se deja todo como esta para el.
    window.LF.releaseResultsSpace(abierta, { descartado: true, sigue: true });
    expect(seccion.classList.contains('is-reserving')).toBe(true);
    expect(seccion.classList.contains('is-error')).toBe(false);
    expect(seccion.style.minHeight).toBe(altura);

    // El encolado: nuevo ciclo, reserva (la tarjeta NO cuenta como pintada) y pinta.
    const ciclo2 = window.LF.beginResultsCycle();
    expect(window.LF.reserveResultsSpace()).toBe(true);
    await window.LF.renderAll({ success: true, resumen: { mejor: 'Nueva', precio: '1 €' }, stats: null, resultados: [] });
    expect(window.LF.resultsCycleDiscarded(ciclo2)).toBe(false);
    window.LF.releaseResultsSpace(true, { descartado: false, sigue: false });
    expect(window.LF.el.kpiBest.textContent).toBe('Nueva');
    expect(seccion.className.trim()).toBe('card visible');
    expect(seccion.style.minHeight).toBe('');
  });

  it('vaciada con un calculo en vuelo y resultados previos: reserva en el acto (el encolado tarda)', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    seccion.classList.add('visible'); // resultados ya pintados: el calculo en vuelo no reservo
    new Function('window', read('js/lf-ui.js'))(window);
    window.__LF_CALC_INFLIGHT = true;
    try {
      window.LF.hideResultsToInitialState();
      expect(seccion.classList.contains('is-reserving')).toBe(true);
      expect(seccion.style.minHeight).toBe('872px');
    } finally {
      delete window.__LF_CALC_INFLIGHT;
    }
    // Sin calculo en vuelo no reserva: lo hace el calculo que arranca justo despues.
    const otra = bootRender();
    setGeometry(otra.seccion, { top: 188, innerHeight: 900 });
    otra.seccion.classList.add('visible');
    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    expect(otra.seccion.classList.contains('is-reserving')).toBe(false);
    expect(otra.seccion.style.minHeight).toBe('');
  });

  it('renderAll() de un ciclo descartado tampoco escribe su "Error de calculo"; fuera de ciclo si', async () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    const setStatus = window.LF.setStatus; // el que usa lf-render (lf-ui real lo sustituye en window.LF)
    window.LF.beginResultsCycle();
    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    await window.LF.renderAll({ success: false });
    expect(setStatus).not.toHaveBeenCalledWith('Error de cálculo', 'err');
    // Cerrado el ciclo, un renderAll() suelto ya no hereda el contador viejo.
    window.LF.endResultsCycle();
    await window.LF.renderAll({ success: false });
    expect(setStatus).toHaveBeenCalledWith('Error de cálculo', 'err');
  });

  it('descartado y sin calculo encolado: aviso de "pulsa Calcular", sin error y con su altura', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    window.LF.beginResultsCycle();
    const abierta = window.LF.reserveResultsSpace();
    const altura = seccion.style.minHeight;
    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    window.LF.releaseResultsSpace(abierta, { descartado: true, sigue: false });
    expect(seccion.classList.contains('is-pending')).toBe(true);
    expect(seccion.classList.contains('is-error')).toBe(false);
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.style.minHeight).toBe(altura);
  });

  it('si el calculo encolado no llega a arrancar (no valida), su "Calculando…" heredado pasa al aviso', () => {
    const { seccion } = bootRender();
    seccion.classList.add('visible', 'is-cleared', 'is-reserving');
    window.__LF_CALC_INFLIGHT = true; // con un calculo en vuelo la reserva es suya: no se toca
    window.LF.settleOrphanReservation();
    expect(seccion.classList.contains('is-reserving')).toBe(true);
    window.__LF_CALC_INFLIGHT = false;
    window.LF.settleOrphanReservation();
    expect(seccion.classList.contains('is-reserving')).toBe(false);
    expect(seccion.classList.contains('is-pending')).toBe(true);
    delete window.__LF_CALC_INFLIGHT;
  });

  it('CSV a mitad del pintado por bloques (sin .is-pending): ni anuncio, ni scroll, ni "Ver resultados"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      const ver = document.getElementById('scrollToResults');
      let reanudar;
      window.LF.yieldControl = vi.fn(() => (reanudar ? Promise.resolve() : new Promise((r) => { reanudar = r; })));
      const filas = Array.from({ length: 25 }, (_, i) => ({ nombre: 'Vieja ' + i, tipo: '1P', totalNum: i, total: i + ' €', potencia: '1 €', consumo: '1 €', impuestos: '1 €', vsMejor: '', vsMejorNum: 0 }));
      window.LF.beginResultsCycle();
      window.LF.reserveResultsSpace();
      const pintado = window.LF.renderAll({ success: true, resumen: { mejor: 'Vieja 0', precio: '0 €' }, stats: null, resultados: filas });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));
      expect(ver.style.display).toBe('block');

      new Function('window', read('js/lf-ui.js'))(window);
      window.LF.hideResultsToInitialState(); // CSV: sin .is-pending
      expect(ver.style.display).toBe('none');
      reanudar();
      await pintado;
      await vi.advanceTimersByTimeAsync(10);
      expect(window.LF.el.tbody.children.length).toBe(0);
      expect(window.LF.el.resultsLiveStatus.textContent).not.toMatch(/Vieja/);
      expect(seccion.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    }
  });

  // Revision de ChatGPT, 20/11/2026: con datos cambiados durante el calculo, renderAll() quitaba
  // `pending` y ponia "Resultados actualizados"; durante el pintado por bloques el desglose (cuyo guard
  // mira `pending`) se podia abrir sobre una fila vieja con los inputs nuevos.
  const filasDePrueba = (pref) => Array.from({ length: 25 }, (_, i) => ({ nombre: pref + ' ' + i, tipo: '1P', totalNum: i, total: i + ' €', potencia: '1 €', consumo: '1 €', impuestos: '1 €', vsMejor: '', vsMejorNum: 0 }));

  it('datos cambiados ANTES de pintar: pinta, pero sigue "pendiente", sin "Resultados actualizados" ni anuncio', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      const st = window.LF.state;
      st.generation = 1; st.pending = true; // el usuario edito durante la descarga
      const listos = []; document.addEventListener('lf:results-ready', (e) => listos.push(e.detail));
      let reanudar;
      window.LF.yieldControl = vi.fn(() => (reanudar ? Promise.resolve() : new Promise((r) => { reanudar = r; })));
      window.LF.reserveResultsSpace();
      const pintado = window.LF.renderAll({ success: true, generation: 0, resumen: { mejor: 'Vieja 0', precio: '0 €' }, stats: null, resultados: filasDePrueba('Vieja') });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));
      // En mitad del pintado (filas ya clicables) el desglose sigue bloqueado.
      expect(st.pending).toBe(true);
      expect(window.LF.setStatus).not.toHaveBeenCalledWith('Resultados actualizados', 'ok');
      reanudar();
      await pintado;
      await vi.advanceTimersByTimeAsync(10);
      expect(window.LF.el.tbody.children.length).toBe(25); // el ranking si se pinta (como pendiente)
      expect(st.pending).toBe(true);
      expect(window.LF.el.resultsLiveStatus.textContent).not.toMatch(/Resultados actualizados/);
      // results-ready se emite (cierra su ciclo) pero marcado no vigente; y no se desplaza la pagina.
      expect(listos.at(-1)).toMatchObject({ origin: 'home', rows: 25, vigente: false });
      expect(seccion.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('datos cambiados DURANTE el pintado: la edicion marca pendiente y no se anuncia el ranking viejo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      const st = window.LF.state;
      st.generation = 0;
      let reanudar;
      window.LF.yieldControl = vi.fn(() => (reanudar ? Promise.resolve() : new Promise((r) => { reanudar = r; })));
      window.LF.reserveResultsSpace();
      const pintado = window.LF.renderAll({ success: true, generation: 0, resumen: { mejor: 'Vieja 0', precio: '0 €' }, stats: null, resultados: filasDePrueba('Vieja') });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));
      expect(st.pending).toBe(false); // vigente al empezar: "actualizados", como siempre
      st.generation = 1; st.pending = true; // scheduleCalculateDebounced() de una edicion
      const listos = []; document.addEventListener('lf:results-ready', (e) => listos.push(e.detail));
      reanudar();
      await pintado;
      await vi.advanceTimersByTimeAsync(10);
      expect(st.pending).toBe(true);
      expect(window.LF.el.resultsLiveStatus.textContent).not.toMatch(/Vieja/);
      expect(listos.at(-1)).toMatchObject({ vigente: false });
      expect(seccion.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Revision de ChatGPT, 20/11/2026: el anuncio se escribe en el turno siguiente; en ese hueco una
  // edicion (generation) o un vaciado lo dejaban anunciar un resumen que ya no corresponde.
  it('el anuncio diferido no se escribe si en ese hueco cambian los datos o se vacia la tarjeta', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (const caso of ['edicion', 'vaciado']) {
        const { seccion } = bootRender();
        setGeometry(seccion, { top: 188, innerHeight: 900 });
        const st = window.LF.state;
        st.generation = 0;
        window.LF.reserveResultsSpace();
        await window.LF.renderAll({ success: true, generation: 0, resumen: { mejor: 'Vieja 0', precio: '0 €' }, stats: null, resultados: filasDePrueba('Vieja') });
        // La continuacion ya programo el anuncio (vigente en ese momento); aun no se ha escrito.
        if (caso === 'edicion') { st.generation = 1; st.pending = true; } else {
          new Function('window', read('js/lf-ui.js'))(window);
          window.LF.hideResultsToInitialState();
        }
        await vi.advanceTimersByTimeAsync(10);
        expect(window.LF.el.resultsLiveStatus.textContent, caso).not.toMatch(/Vieja/);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // Revision de ChatGPT, 20/11/2026: todo efecto de "hay resultados" pasa por resultadoVigente(d)
  // (generacion de los datos y version del catalogo).
  const limitesConInterruptor = { consumoKwh: 6512, excluidas: [{ tarifa: { nombre: 'Imagina 4000' }, tipo: 'maximo', limiteKwh: 4000 }] };

  it('catalogo cambiado durante el calculo: ni "actualizados", ni senal vigente, ni scroll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      const st = window.LF.state;
      st.generation = 0; st.pending = true;
      window.LF.__LF_tarifasMeta = { updatedAt: '2026-11-20T08:00' }; // el auto-refresh trajo otra version
      const listos = []; document.addEventListener('lf:results-ready', (e) => listos.push(e.detail));
      window.LF.reserveResultsSpace();
      await window.LF.renderAll({ success: true, generation: 0, tarifasVersion: '2026-11-19T08:00', resumen: { mejor: 'Vieja 0', precio: '0 €' }, stats: null, resultados: filasDePrueba('Vieja') });
      await vi.advanceTimersByTimeAsync(10);
      expect(st.pending).toBe(true);
      expect(window.LF.setStatus).not.toHaveBeenCalledWith('Resultados actualizados', 'ok');
      expect(window.LF.createSuccessParticles).not.toHaveBeenCalled();
      expect(listos.at(-1)).toMatchObject({ vigente: false });
      expect(seccion.scrollIntoView).not.toHaveBeenCalled();
      // Misma version: vigente.
      await window.LF.renderAll({ success: true, generation: 0, tarifasVersion: '2026-11-20T08:00', resumen: { mejor: 'Nueva 0', precio: '0 €' }, stats: null, resultados: filasDePrueba('Nueva') });
      await vi.advanceTimersByTimeAsync(10);
      expect(st.pending).toBe(false);
      expect(listos.at(-1)).toMatchObject({ vigente: true });
      expect(window.LF.createSuccessParticles).toHaveBeenCalled();
    } finally {
      delete window.LF.__LF_tarifasMeta;
      vi.useRealTimers();
    }
  });

  it('movil: "Ver resultados" no aparece para un ranking obsoleto, ni se queda si deja de serlo al pintar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true });
    try {
      // Obsoleto desde el principio.
      let { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      let ver = document.getElementById('scrollToResults');
      window.LF.state.generation = 1;
      let pausa;
      window.LF.yieldControl = vi.fn(() => (pausa ? Promise.resolve() : new Promise((r) => { pausa = r; })));
      const obsoleto = window.LF.renderAll({ success: true, generation: 0, resumen: {}, stats: null, resultados: filasDePrueba('Vieja') });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));
      expect(ver.style.display).toBe('none'); // ni siquiera asoma mientras se pinta
      pausa();
      await obsoleto;
      expect(ver.style.display).toBe('none');

      // Vigente al empezar (se muestra) y obsoleto durante el pintado (se retira).
      ({ seccion } = bootRender());
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      ver = document.getElementById('scrollToResults');
      window.LF.state.generation = 0;
      let reanudar;
      window.LF.yieldControl = vi.fn(() => (reanudar ? Promise.resolve() : new Promise((r) => { reanudar = r; })));
      const pintado = window.LF.renderAll({ success: true, generation: 0, resumen: {}, stats: null, resultados: filasDePrueba('Vieja') });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));
      expect(ver.style.display).toBe('block');
      window.LF.state.generation = 1; window.LF.state.pending = true;
      reanudar();
      await pintado;
      expect(ver.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    }
  });

  // Revision de ChatGPT, 20/11/2026: con un calculo YA terminado, editar no retiraba "Ver resultados"
  // (seguia 5 s llevando a un ranking pendiente); tampoco si se editaba con el pintado suspendido.
  // markPending()/setStatus() reales necesitan el estado y el boton Calcular.
  const conEstadoReal = () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="statusPill"><span id="statusText"></span></div><button id="btnCalc"><span id="btnText"></span><span id="btnSpinner"></span></button>');
    Object.assign(window.LF.el, { statusPill: document.getElementById('statusPill'), statusText: document.getElementById('statusText'), btnCalc: document.getElementById('btnCalc'), btnText: document.getElementById('btnText'), btnSpinner: document.getElementById('btnSpinner') });
    new Function('window', read('js/lf-ui.js'))(window);
  };

  it('movil: editar retira "Ver resultados" en el acto, con el calculo terminado o a mitad del pintado', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true });
    try {
      let { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      conEstadoReal(); // markPending() real
      let ver = document.getElementById('scrollToResults');
      window.LF.state.generation = 0;
      await window.LF.renderAll({ success: true, generation: 0, resumen: {}, stats: null, resultados: filasDePrueba('Nueva') });
      expect(ver.style.display).toBe('block');
      window.LF.markPending(); // el usuario edita con el calculo ya terminado
      expect(ver.style.display).toBe('none');
      await vi.advanceTimersByTimeAsync(6000); // el temporizador viejo no lo vuelve a tocar
      expect(ver.style.display).toBe('none');

      // A mitad del pintado: se retira en el acto, sin esperar a que termine.
      ({ seccion } = bootRender());
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      conEstadoReal();
      ver = document.getElementById('scrollToResults');
      window.LF.state.generation = 0;
      let reanudar;
      window.LF.yieldControl = vi.fn(() => (reanudar ? Promise.resolve() : new Promise((r) => { reanudar = r; })));
      const pintado = window.LF.renderAll({ success: true, generation: 0, resumen: {}, stats: null, resultados: filasDePrueba('Vieja') });
      await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));
      expect(ver.style.display).toBe('block');
      window.LF.markPending();
      expect(ver.style.display).toBe('none');
      reanudar();
      await pintado;
      expect(ver.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    }
  });

  it('el foco diferido del interruptor vuelve a mirar la vigencia al llegar el frame', async () => {
    const raf = window.requestAnimationFrame;
    const pendientes = [];
    window.requestAnimationFrame = (cb) => { pendientes.push(cb); return pendientes.length; };
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      document.activeElement?.blur?.();
      window.LF.state.generation = 0;
      window.LF.state.focusAnnualConsumptionEstimateToggle = true;
      await window.LF.renderAll({ success: true, generation: 0, resumen: {}, stats: null, resultados: [], limitesConsumo: limitesConInterruptor });
      const toggle = document.querySelector('#consumoLimitsNotice .consumo-estimate-toggle');
      window.LF.state.generation = 1; // edicion entre programar el foco y el frame
      pendientes.splice(0).forEach((cb) => cb(0));
      expect(document.activeElement).not.toBe(toggle);
    } finally {
      window.requestAnimationFrame = raf;
    }
  });

  it('el interruptor de la estimacion no roba el foco: ni con resultado obsoleto ni si el usuario esta en otro campo', async () => {
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => { cb(0); return 0; };
    try {
      const casos = [
        { nombre: 'obsoleto', generacionEstado: 1, enfocarOtro: false, espera: false },
        { nombre: 'otro campo', generacionEstado: 0, enfocarOtro: true, espera: false },
        { nombre: 'vigente y sin foco ajeno', generacionEstado: 0, enfocarOtro: false, espera: true }
      ];
      for (const caso of casos) {
        const { seccion } = bootRender();
        setGeometry(seccion, { top: 188, innerHeight: 900 });
        document.body.insertAdjacentHTML('beforeend', '<input id="campoUsuario">');
        if (caso.enfocarOtro) document.getElementById('campoUsuario').focus();
        else document.activeElement?.blur?.();
        window.LF.state.generation = caso.generacionEstado;
        window.LF.state.focusAnnualConsumptionEstimateToggle = true;
        await window.LF.renderAll({ success: true, generation: 0, resumen: {}, stats: null, resultados: [], limitesConsumo: limitesConInterruptor });
        const toggle = document.querySelector('#consumoLimitsNotice .consumo-estimate-toggle');
        expect(toggle, caso.nombre).toBeTruthy();
        expect(document.activeElement === toggle, caso.nombre).toBe(caso.espera);
        expect(window.LF.state.focusAnnualConsumptionEstimateToggle, caso.nombre).toBe(false);
      }
    } finally {
      window.requestAnimationFrame = raf;
    }
  });

  it('generacion vigente: "Resultados actualizados", pending limpio y anuncio, como siempre', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      const st = window.LF.state;
      st.generation = 3; st.pending = true;
      const listos = []; document.addEventListener('lf:results-ready', (e) => listos.push(e.detail));
      window.LF.reserveResultsSpace();
      await window.LF.renderAll({ success: true, generation: 3, resumen: { mejor: 'Nueva 0', precio: '0 €' }, stats: null, resultados: filasDePrueba('Nueva') });
      await vi.advanceTimersByTimeAsync(10);
      expect(st.pending).toBe(false);
      expect(window.LF.setStatus).toHaveBeenCalledWith('Resultados actualizados', 'ok');
      expect(window.LF.el.resultsLiveStatus.textContent).toMatch(/Nueva 0/);
      expect(listos.at(-1)).toMatchObject({ vigente: true });
      expect(seccion.scrollIntoView).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin vaciado, el pintado por bloques sigue anunciando y desplazando como siempre', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { seccion } = bootRender();
      setGeometry(seccion, { top: 188, innerHeight: 900 });
      const filas = Array.from({ length: 25 }, (_, i) => ({ nombre: 'Nueva ' + i, tipo: '1P', totalNum: i, total: i + ' €', potencia: '1 €', consumo: '1 €', impuestos: '1 €', vsMejor: '', vsMejorNum: 0 }));
      window.LF.reserveResultsSpace();
      await window.LF.renderAll({ success: true, resumen: { mejor: 'Nueva 0', precio: '0 €' }, stats: null, resultados: filas });
      await vi.advanceTimersByTimeAsync(10);
      expect(window.LF.el.resultsLiveStatus.textContent).toMatch(/Nueva 0/);
      expect(seccion.scrollIntoView).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('factura.js marca .is-pending solo cuando no calcula sola, despues de vaciar', () => {
    const fac = read('js/factura.js');
    const i = fac.indexOf('hideResultsToInitialState();\n\n        if (shouldAutoCalc)');
    expect(i).toBeGreaterThan(-1);
    const tramo = fac.slice(i, i + 2500);
    expect(tramo).toMatch(/if \(!shouldAutoCalc\) document\.getElementById\('seccionResultados'\)\?\.classList\.add\('is-pending'\);/);
  });

  // Revision de ChatGPT del arreglo, 19/11/2026: un renderTable() de filtro/orden suspendido entre
  // bloques podia reanudar tras el vaciado del CSV/Datadis y reescribir filas antiguas bajo
  // .is-cleared (invisibles, pero en el DOM). La factura ya cancelaba; ahora cancela el vaciado.
  it('vaciar cancela un renderTable() suspendido entre bloques: no vuelve a escribir filas antiguas', async () => {
    bootRender();
    let reanudar;
    // Solo la primera cesion queda suspendida; las siguientes siguen en el acto.
    window.LF.yieldControl = vi.fn(() => (reanudar
      ? Promise.resolve()
      : new Promise((resolve) => { reanudar = resolve; })));
    window.LF.state.rows = Array.from({ length: 25 }, (_, i) => ({
      nombre: 'Tarifa ' + i, tipo: '1P', totalNum: i, total: i + ' €', potencia: '1 €',
      consumo: '1 €', impuestos: '1 €', vsMejor: '', vsMejorNum: 0
    }));

    const render = window.LF.renderTable();
    await vi.waitFor(() => expect(window.LF.el.tbody.children.length).toBe(10));

    new Function('window', read('js/lf-ui.js'))(window);
    window.LF.hideResultsToInitialState();
    expect(window.LF.el.tbody.children.length).toBe(0);

    reanudar();
    await render;
    expect(window.LF.el.tbody.children.length).toBe(0);
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

    // Segundo Calcular sin mover la pagina: misma altura, el aviso pasa a "Calculando…".
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

  // Revision de ChatGPT, 23/10/2026: si tras el fallo el usuario baja la pagina, la reserva del
  // primer intento (872) ya no deja el footer fuera de la vista; al reintentar hay que ampliarla.
  it('reintentar tras bajar la pagina AMPLIA la reserva a la posicion actual', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: 188, innerHeight: 900 });
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace());
    expect(seccion.style.minHeight).toBe('872px');

    setGeometry(seccion, { top: -500, innerHeight: 900 });
    window.LF.reserveResultsSpace();
    expect(seccion.style.minHeight).toBe('1560px'); // 900 + 500 + 160
  });

  it('reintentar tras subir la pagina NO reduce la reserva (encogerla moveria el footer)', () => {
    const { seccion } = bootRender();
    setGeometry(seccion, { top: -500, innerHeight: 900 });
    window.LF.releaseResultsSpace(window.LF.reserveResultsSpace());
    expect(seccion.style.minHeight).toBe('1560px');

    setGeometry(seccion, { top: 188, innerHeight: 900 });
    window.LF.reserveResultsSpace();
    expect(seccion.style.minHeight).toBe('1560px');
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
// 2) lf-app.js: calculate() reserva tras el primer pintado, ANTES de la descarga, y libera en el finally
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

  it('pinta primero el estado del boton y reserva justo despues, antes de la primera descarga', async () => {
    // INP (12/11/2026): abrir el bloque en el mismo tick metia su layout en el clic. Ahora se
    // reserva tras el siguiente pintado, pero SIEMPRE antes de pedir tarifas.json (normalmente un
    // frame despues del clic, dentro de los 500 ms que Chrome excluye del CLS).
    vi.useFakeTimers();
    const frames = [];
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
    try {
      bootApp({ fetchTarifas: vi.fn(() => new Promise(() => {})) });
      window.calculate(true, false); // sin await: se inspecciona lo que ya ocurrio en cada paso
      const { reserveResultsSpace, fetchTarifas, setStatus } = window.LF;

      // En el tick del clic: estado "Calculando..." si; bloque y descarga todavia no.
      expect(setStatus).toHaveBeenCalledWith('Calculando...', 'loading');
      expect(reserveResultsSpace).not.toHaveBeenCalled();
      expect(fetchTarifas).not.toHaveBeenCalled();

      // Siguiente pintado (rAF) + tarea: se reserva y, despues, se descarga.
      frames.splice(0).forEach((cb) => cb(0));
      await vi.advanceTimersByTimeAsync(0);
      expect(reserveResultsSpace).toHaveBeenCalledTimes(1);
      expect(fetchTarifas).toHaveBeenCalledTimes(1);
      expect(reserveResultsSpace.mock.invocationCallOrder[0])
        .toBeLessThan(fetchTarifas.mock.invocationCallOrder[0]);
      expect(setStatus.mock.invocationCallOrder[0])
        .toBeLessThan(reserveResultsSpace.mock.invocationCallOrder[0]);
    } finally {
      window.requestAnimationFrame = realRaf;
      vi.useRealTimers();
    }
  });

  it('sin frames, el respaldo programado a 100 ms reserva igualmente, antes de la descarga', async () => {
    vi.useFakeTimers();
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0; // nunca llega un frame
    try {
      bootApp({ fetchTarifas: vi.fn(() => new Promise(() => {})) });
      window.calculate(true, false);
      const { reserveResultsSpace, fetchTarifas } = window.LF;
      await vi.advanceTimersByTimeAsync(99);
      expect(reserveResultsSpace).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(reserveResultsSpace).toHaveBeenCalledTimes(1);
      expect(fetchTarifas).toHaveBeenCalledTimes(1);
      expect(reserveResultsSpace.mock.invocationCallOrder[0])
        .toBeLessThan(fetchTarifas.mock.invocationCallOrder[0]);
    } finally {
      window.requestAnimationFrame = realRaf;
      vi.useRealTimers();
    }
  });

  it('libera al terminar, pasando si la abrio este calculo', async () => {
    bootApp();
    await window.calculate(true, false);
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true, { descartado: false, sigue: false });
    expect(window.LF.releaseResultsSpace.mock.invocationCallOrder[0])
      .toBeGreaterThan(window.LF.calculateLocal.mock.invocationCallOrder[0]);
  });

  it('tambien libera (pasa a aviso de error) cuando falla la descarga sin catalogo de sesion', async () => {
    bootApp({ fetchTarifas: vi.fn(async () => false), baseTarifasCache: [] });
    await window.calculate(true, false);
    expect(window.LF.calculateLocal).not.toHaveBeenCalled();
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true, { descartado: false, sigue: false });
  });

  it('tambien libera si el calculo lanza un error', async () => {
    bootApp({ calculateLocal: vi.fn(async () => { throw new Error('boom'); }) });
    await window.calculate(true, false);
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true, { descartado: false, sigue: false });
    // Estado corto (cabe en el ancho reservado; puede llegar tarde) y el detalle en el toast.
    expect(window.LF.setStatus).toHaveBeenLastCalledWith('No se pudo calcular', 'err');
    expect(window.LF.toast).toHaveBeenCalledWith('No se ha podido calcular. Inténtalo de nuevo.', 'err');
  });

  // Revision de ChatGPT, 19/11/2026: calculo en vuelo + factura que pide revision aplicada durante
  // la espera. Al terminar, el estado conserva la instruccion de la factura.
  it('si durante el calculo se aplico una factura en revision, no pisa su instruccion con "Cambios pendientes"', async () => {
    let soltar;
    let vaciados = 0;
    const state = bootApp({
      fetchTarifas: vi.fn(() => new Promise((r) => { soltar = r; })),
      beginResultsCycle: vi.fn(() => vaciados),
      resultsCycleDiscarded: vi.fn((c) => c !== vaciados)
    });
    document.body.insertAdjacentHTML('beforeend', '<section id="seccionResultados" class="card visible"></section>');
    const calc = window.calculate(true, false);
    await vi.waitFor(() => expect(window.LF.fetchTarifas).toHaveBeenCalled());
    // factura.js: markPending() + vaciar (markResultsCleared) + .is-pending, durante la espera
    state.generation += 1;
    vaciados += 1;
    document.getElementById('seccionResultados').classList.add('is-cleared', 'is-pending');
    window.LF.setStatus.mockClear();
    soltar(true);
    await calc;
    expect(window.LF.setStatus).not.toHaveBeenCalledWith('Cambios pendientes. Pulsa Calcular para actualizar.', 'idle');
    expect(state.pending).toBe(true);
    // El resultado se descarto: la firma sigue como la dejo el vaciado, y la liberacion lo sabe.
    expect(state.lastSignature).toBeNull();
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true, { descartado: true, sigue: false });
  });

  it('CSV con el calculo en vuelo: libera como descartado con "sigue" y arranca el encolado', async () => {
    let soltar;
    let vaciados = 0;
    const fetchTarifas = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { soltar = r; }))
      .mockImplementation(async () => true);
    const state = bootApp({
      fetchTarifas,
      beginResultsCycle: vi.fn(() => vaciados),
      resultsCycleDiscarded: vi.fn((c) => c !== vaciados),
      endResultsCycle: vi.fn(),
      settleOrphanReservation: vi.fn()
    });
    const primero = window.calculate(true, false);
    await vi.waitFor(() => expect(fetchTarifas).toHaveBeenCalledTimes(1));
    // lf-csv-import.js: inputs (generation) -> vaciado -> runCalculation() (se encola)
    state.generation += 1;
    vaciados += 1;
    expect(window.runCalculation()).toBe(false);
    soltar(true);
    await primero;
    expect(window.LF.releaseResultsSpace).toHaveBeenNthCalledWith(1, true, { descartado: true, sigue: true });
    expect(state.lastSignature).toBeNull();
    await vi.waitFor(() => expect(fetchTarifas).toHaveBeenCalledTimes(2)); // el encolado arranco
    // Y termina aqui: si siguiera en vuelo, su finally soltaria __LF_CALC_INFLIGHT en el test siguiente.
    await vi.waitFor(() => expect(window.LF.releaseResultsSpace).toHaveBeenCalledTimes(2));
    expect(window.__LF_CALC_INFLIGHT).toBe(false);

    // Revision de ChatGPT: con sucesor valido la reserva heredada es suya; el finally del descartado
    // no la convierte en aviso.
    expect(window.LF.settleOrphanReservation).not.toHaveBeenCalled();
    // El ciclo del descartado se cierra ANTES de que el sucesor abra el suyo (si no, lo cerraria).
    const { beginResultsCycle, endResultsCycle } = window.LF;
    expect(beginResultsCycle).toHaveBeenCalledTimes(2);
    expect(endResultsCycle.mock.invocationCallOrder[0]).toBeLessThan(beginResultsCycle.mock.invocationCallOrder[1]);
    // El motor recibe la generacion con la que arranco cada calculo (estimacion anual en lf-calc.js).
    expect(window.LF.calculateLocal.mock.calls[0][1]).toEqual({ generation: 0, tarifasVersion: null });
    expect(window.LF.calculateLocal.mock.calls[1][1]).toEqual({ generation: 1, tarifasVersion: null });
  });

  // Cuarta revision de ChatGPT, 19/11/2026: los caminos de ERROR de un ciclo descartado pisaban el
  // estado del flujo que vacio (p. ej. la instruccion de la factura en revision).
  const cicloSimulado = () => {
    const c = { vaciados: 0 };
    c.mocks = { beginResultsCycle: vi.fn(() => c.vaciados), resultsCycleDiscarded: vi.fn((x) => x !== c.vaciados), endResultsCycle: vi.fn(), settleOrphanReservation: vi.fn() };
    return c;
  };

  it('ciclo descartado + fallo de descarga sin catalogo: no escribe el error de los datos viejos', async () => {
    const c = cicloSimulado();
    let soltar;
    bootApp({ ...c.mocks, fetchTarifas: vi.fn(() => new Promise((r) => { soltar = r; })), baseTarifasCache: [] });
    const calc = window.calculate(true, false);
    await vi.waitFor(() => expect(window.LF.fetchTarifas).toHaveBeenCalled());
    c.vaciados += 1; // factura en revision aplicada durante la descarga
    window.LF.setStatus.mockClear();
    soltar(false);
    await calc;
    expect(window.LF.setStatus).not.toHaveBeenCalled();
    expect(window.LF.toast).not.toHaveBeenCalled();
    expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true, { descartado: true, sigue: false });
    expect(window.LF.endResultsCycle).toHaveBeenCalled();
  });

  it('ciclo descartado + fallo con catalogo de sesion: tampoco avisa de "calculando con la ultima descarga"', async () => {
    const c = cicloSimulado();
    let soltar;
    bootApp({ ...c.mocks, fetchTarifas: vi.fn(() => new Promise((r) => { soltar = r; })), baseTarifasCache: [{ nombre: 'x' }] });
    const calc = window.calculate(true, false);
    await vi.waitFor(() => expect(window.LF.fetchTarifas).toHaveBeenCalled());
    c.vaciados += 1;
    soltar(false);
    await calc;
    expect(window.LF.toast).not.toHaveBeenCalled();
  });

  it('ciclo descartado + excepcion del calculo: no escribe "No se pudo calcular"', async () => {
    const c = cicloSimulado();
    bootApp({ ...c.mocks, calculateLocal: vi.fn(async () => { c.vaciados += 1; throw new Error('boom'); }) });
    await window.calculate(true, false);
    expect(window.LF.setStatus).not.toHaveBeenCalledWith('No se pudo calcular', 'err');
    expect(window.LF.toast).not.toHaveBeenCalled();
  });

  it('el ciclo se abre antes del primer pintado: un vaciado en ese primer frame tambien lo descarta', async () => {
    vi.useFakeTimers();
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16);
    try {
      const c = cicloSimulado();
      bootApp({ ...c.mocks });
      const calc = window.calculate(true, false);
      c.vaciados += 1; // antes de que llegue afterNextPaint()
      await vi.advanceTimersByTimeAsync(1000);
      await calc;
      expect(window.LF.releaseResultsSpace).toHaveBeenCalledWith(true, { descartado: true, sigue: false });
    } finally {
      window.requestAnimationFrame = realRaf;
      vi.useRealTimers();
    }
  });

  it('si el calculo que heredo "Calculando…" falla antes de reservar, no lo deja colgado', async () => {
    const c = cicloSimulado();
    bootApp({ ...c.mocks, setStatus: vi.fn((t) => { if (t === 'Calculando...') throw new Error('DOM incompleto'); }) });
    await window.calculate(true, false);
    expect(window.LF.releaseResultsSpace).not.toHaveBeenCalled();
    expect(window.LF.settleOrphanReservation).toHaveBeenCalled();
  });

  it('al encolar se cancela el debounce de las ediciones: no pisa "Calculando..." con "Cambios pendientes"', async () => {
    vi.useFakeTimers();
    try {
      bootApp({ fetchTarifas: vi.fn(() => new Promise(() => {})) });
      window.calculate(true, false); // en vuelo
      await vi.advanceTimersByTimeAsync(150);
      // Un CSV rellena inputs (debounce de 200 ms) y pide calcular: se encola.
      window.LF.state.debounce = setTimeout(() => window.LF.setStatus('Cambios pendientes. Pulsa Calcular para actualizar.', 'idle'), 200);
      expect(window.runCalculation()).toBe(false);
      window.LF.setStatus.mockClear();
      await vi.advanceTimersByTimeAsync(300);
      expect(window.LF.setStatus).not.toHaveBeenCalledWith('Cambios pendientes. Pulsa Calcular para actualizar.', 'idle');
    } finally {
      vi.useRealTimers();
    }
  });

  // Revision de ChatGPT, 20/11/2026: recorrido integrado del catalogo. La version se captura junto a la
  // copia de tarifas; si el auto-refresh cambia `updatedAt` mientras se calcula, el motor (y por el, el
  // render) recibe la version VIEJA y calculate() lo marca pendiente con su aviso.
  it('auto-refresh durante el calculo: el motor recibe la version con la que calculo y queda pendiente', async () => {
    const raf = window.requestAnimationFrame;
    let descargado = false;
    // El auto-refresh llega en la pausa que hay entre copiar las tarifas y llamar al motor.
    window.requestAnimationFrame = (cb) => { if (descargado) window.LF.__LF_tarifasMeta = { updatedAt: 'v2' }; return setTimeout(() => cb(0), 0); };
    let st;
    try {
      st = bootApp({
        fetchTarifas: vi.fn(async () => { window.LF.__LF_tarifasMeta = { updatedAt: 'v1' }; descargado = true; return true; })
      });
      await window.calculate(true, false);
    } finally {
      window.requestAnimationFrame = raf;
    }
    expect(window.LF.calculateLocal.mock.calls[0][1]).toMatchObject({ tarifasVersion: 'v1' });
    expect(st.pending).toBe(true);
    expect(window.LF.setStatus).toHaveBeenCalledWith('Tarifas actualizadas. Pulsa Calcular para aplicar la nueva versión.', 'idle');
  });

  it('editar (scheduleCalculateDebounced) retira "Ver resultados"', () => {
    bootApp({ retirarVerResultados: vi.fn() });
    window.scheduleCalculateDebounced();
    expect(window.LF.retirarVerResultados).toHaveBeenCalled();
  });

  it('si los datos no validan, una reserva heredada no queda en "Calculando…"', async () => {
    bootApp({ validateInputs: vi.fn(() => false), settleOrphanReservation: vi.fn() });
    await window.calculate(true, false);
    expect(window.LF.settleOrphanReservation).toHaveBeenCalled();
  });

  it('si setStatus falla ANTES de reservar, tampoco libera', async () => {
    bootApp({ setStatus: vi.fn((texto) => { if (texto === 'Calculando...') throw new Error('boom en setStatus'); }) });
    await window.calculate(true, false);
    expect(window.LF.reserveResultsSpace).not.toHaveBeenCalled();
    expect(window.LF.releaseResultsSpace).not.toHaveBeenCalled();
    expect(window.__LF_CALC_INFLIGHT).toBe(false);
  });

  it('si algo falla ANTES de reservar, no libera: conserva el aviso de error de un intento anterior', async () => {
    // Revision de ChatGPT (12/11/2026): liberar con `false` borraria la altura y `.is-error`
    // que dejo un intento fallido previo, aunque este calculo nunca llego a reservar.
    bootApp({ saveInputs: vi.fn(() => { throw new Error('boom antes de reservar'); }) });
    await window.calculate(true, false);
    expect(window.LF.reserveResultsSpace).not.toHaveBeenCalled();
    expect(window.LF.releaseResultsSpace).not.toHaveBeenCalled();
    expect(window.__LF_CALC_INFLIGHT).toBe(false);
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

  it('el aviso de factura en revision tambien va fuera de flujo', () => {
    const regla = css.match(/#seccionResultados\.is-pending::after\s*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla[1]).toMatch(/position:\s*absolute/);
    expect(regla[1]).toMatch(/top:\s*var\(--lf-aviso-top,\s*96px\)/);
    expect(regla[1]).toMatch(/content:\s*"Revisa los datos/);
    expect(css).toMatch(/#seccionResultados\.is-pending\s*\{\s*position:\s*relative;/);
  });

  it('la nota de impuestos se oculta con visibility, no con display (reaparecer no mueve nada)', () => {
    const regla = css.match(/#seccionResultados\.is-reserving \.tableWrap > p,\s*#seccionResultados\.is-error \.tableWrap > p\s*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla[1]).toMatch(/visibility:\s*hidden/);
    expect(regla[1]).not.toMatch(/display:/);
  });

  // 19/11/2026: tras aplicar factura/CSV, la tarjeta vaciada conserva bloques visibles del
  // resultado anterior que bajaban al volver el ranking (0,27 en 1280x1440, pagina arriba).
  it('al vaciar, mientras reserva o con el error, el cuerpo de la tarjeta queda invisible (visibility, no display)', () => {
    const regla = css.match(/#seccionResultados\.is-cleared > \.body,\s*#seccionResultados\.is-reserving > \.body,\s*#seccionResultados\.is-error > \.body\s*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla[1]).toMatch(/visibility:\s*hidden/);
    expect(regla[1]).not.toMatch(/display:/);
  });

  it('tambien oculta las tarjetas de precios, que en movil fuerzan visibility:visible !important', () => {
    for (const estado of ['is-cleared', 'is-reserving', 'is-error']) {
      for (const sel of ['statsbar', 'statCard']) {
        expect(css).toMatch(new RegExp(`#seccionResultados\\.${estado} \\.${sel}[,\\s][^{]*\\{[^}]*visibility:\\s*hidden\\s*!important`));
      }
    }
  });

  // 19/11/2026: en tactil `* { transition-duration: .15s !important }` deja transition-property en
  // `all`, visibility incluida, y el cuerpo vaciado seguia visible 150 ms (Chrome 157 movil).
  it('al entrar en esos estados no hay transicion: el ocultado es inmediato tambien en pantallas tactiles', () => {
    expect(css).toMatch(/@media \(pointer: coarse\), \(hover: none\)[\s\S]*\*\s*\{\s*transition-duration:\s*0\.15s !important;/);
    for (const estado of ['is-cleared', 'is-reserving', 'is-error']) {
      for (const sel of ['> \\.body', '> \\.body \\*']) {
        expect(css).toMatch(new RegExp(`#seccionResultados\\.${estado} ${sel}[,\\s][^{]*\\{[^}]*transition-property:\\s*none\\s*!important`));
      }
    }
  });

  // 19/11/2026: hasta 520 px el boton encogia 7 px al cambiar el texto por el spinner y, al acabar
  // el calculo, empujaba todo lo de debajo (CLS 0,0035-0,0046 en cada calculo).
  it('el hueco del spinner de Calcular mide lo mismo que "⚡ Calcular" en cada tramo de anchura', () => {
    const tamano = (bloque, sel) => {
      const m = bloque.match(new RegExp(`${sel}\\s*\\{[^}]*font-size:\\s*(\\d+)px`));
      return m && Number(m[1]);
    };
    expect(css).toMatch(/\.btn\.primary #btnSpinner::before\s*\{[^}]*content:\s*"⚡";[^}]*width:\s*0;[^}]*visibility:\s*hidden;/);
    expect(css).toMatch(/\.btn\.primary #btnSpinner\s*\{[^}]*line-height:\s*1;[^}]*font-size:\s*26px/);
    const tramos = [
      ['@media \\(max-width: 768px\\)', 23],
      ['@media \\(min-width: 521px\\) and \\(max-width: 768px\\)', 20]
    ];
    for (const [media, px] of tramos) {
      const spinner = css.match(new RegExp(`${media}\\s*\\{\\s*\\.btn\\.primary #btnSpinner\\s*\\{\\s*font-size:\\s*(\\d+)px`));
      expect(spinner && Number(spinner[1])).toBe(px);
    }
    expect(css).toMatch(/@media \(min-width: 1101px\)\s*\{\s*\.grid\.has-results #btnCalc #btnSpinner\s*\{\s*font-size:\s*22px/);
    // Y #btnText sigue con esos mismos tamanos (si alguien los cambia, el test obliga a mirar los dos).
    expect(tamano(css, '\\.btn\\.primary #btnText')).toBe(26);
    expect(css).toMatch(/\.btn\.primary #btnText\s*\{\s*font-size:\s*23px;/);
    expect(css).toMatch(/\.btn\.primary #btnText\s*\{\s*font-size:\s*20px;/);
    expect(css).toMatch(/\.grid\.has-results #btnCalc #btnText\s*\{\s*font-size:\s*22px;/);
  });

  // 19/11/2026: de 1.100 a 1.440 px la barra de la cabecera pasaba de una fila a dos cuando
  // "Calculando..." se convertia en "Resultados actualizados" (CLS 0,072 por calculo a 1200x1920).
  it('el estado reserva, mientras calcula y despues, el ancho del mensaje de resultados', () => {
    const regla = css.match(/@media \(min-width: 769px\)\{\s*#statusPill\.loading #statusText, #statusPill\.ok #statusText, #statusPill\.err #statusText\{ display: inline-grid;[^}]*\}\s*#statusPill\.loading #statusText::after, #statusPill\.ok #statusText::after, #statusPill\.err #statusText::after\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    const contenido = regla[1].match(/content:\s*"([^"]+)"/);
    expect(contenido && contenido[1]).toBe('Resultados actualizados');
    expect(regla[1]).toMatch(/height:\s*0;/);
    expect(regla[1]).toMatch(/visibility:\s*hidden;/);
    // El texto real al terminar debe ser el mismo que se reserva.
    expect(read('js/lf-render.js')).toContain(`setStatus('${contenido[1]}', 'ok')`);
  });

  // Revision de ChatGPT, 19/11/2026: "No se ha podido calcular. Inténtalo de nuevo." (catch de
  // calculate) superaba el ancho reservado y puede llegar pasados los 500 ms del clic.
  it('ningun mensaje de estado loading/ok/err que pueda llegar tarde es mas largo que el reservado', () => {
    const reservado = 'Resultados actualizados';
    // Solo al pulsar Calcular o 200 ms despues de teclear: siempre dentro de los 500 ms de una entrada.
    const alClic = new Set(['Corrige los datos para calcular']);
    const mensajes = new Set();
    for (const f of ['js/lf-app.js', 'js/lf-render.js', 'js/lf-cache.js', 'js/lf-csv-import.js', 'js/factura.js', 'js/pvpc.js', 'js/lf-calc.js', 'js/lf-datadis.js']) {
      const src = read(f);
      for (const m of src.matchAll(/setStatus\(\s*'([^']+)'\s*,\s*'(ok|err|loading)'\s*\)/g)) mensajes.add(m[1]);
      if (f === 'js/lf-cache.js') for (const m of src.matchAll(/\bstatus:\s*'([^']+)'/g)) mensajes.add(m[1]);
    }
    expect(mensajes.size).toBeGreaterThan(5);
    const largos = [...mensajes].filter((t) => !alClic.has(t) && t.length > reservado.length);
    expect(largos).toEqual([]);
  });

  // Revision de ChatGPT, 19/11/2026: una regla nueva y mas especifica (p. ej. `#btnCalc.btn.primary
  // #btnSpinner` en un media) dejaria spinner y texto con tamanos distintos sin que el resto lo note.
  it('el tamano de letra de #btnText y #btnSpinner solo lo fijan las cuatro reglas emparejadas', () => {
    const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const reglas = (id) => [...limpio.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1].includes(id) && /font-size/.test(m[2]))
      .map((m) => m[1].trim().replace(/\s+/g, ' ').replace(id, '#X') + ' ' + m[2].match(/font-size:\s*(\d+)px/)[1]);
    const esperado = ['.btn.primary #X 26', '.btn.primary #X 23', '.btn.primary #X 20', '.grid.has-results #btnCalc #X 22'];
    expect(reglas('#btnText')).toEqual(esperado);
    expect(reglas('#btnSpinner')).toEqual(esperado);
  });

  it('index.html: el contenido de #seccionResultados vive en un .body hijo directo, y su cabecera fuera', () => {
    const html = read('index.html');
    const seccion = html.match(/<section class="card" id="seccionResultados">\s*<div class="head">[\s\S]*?<\/div>\s*<div class="body">/);
    expect(seccion).not.toBeNull();
  });
});
