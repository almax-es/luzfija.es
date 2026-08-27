/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// 14/08/2026 (novena ronda): calculate() capturaba `values` UNA vez al principio y hacia
// varios `await` (red, PVPC, render por chunks) antes de terminar. Si el usuario editaba el
// formulario durante ese hueco, el resultado pintado correspondia a los valores ANTERIORES,
// pero `state.pending = false` se ejecutaba sin comparar con el estado actual del
// formulario, borrando en silencio el aviso "Cambios pendientes" aunque lo mostrado ya no
// coincidiera con lo que el usuario veia en los inputs.

const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');

function boot(overrides = {}) {
  document.body.innerHTML = `
    <span id="statusText"></span><button id="btnCalc"></button>
    <button id="btnMenu"></button><div id="menuPanel"></div><button id="btnShare"></button>
  `;
  const state = { pending: false, rows: [], lastSignature: null, debounce: null, generation: 0 };
  let values = { p1: '1' };

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
    // markPending real: pone pending a true e incrementa generation (mismo efecto que
    // lf-ui.js, del que depende esta regresion: signatureFromValues() no cubre "Mi tarifa"
    // ni la curva CSV, asi que calculate() usa generation, no la firma, para detectar edits).
    markPending: vi.fn(() => { state.pending = true; state.generation = (state.generation || 0) + 1; }),
    applyThemeClass: vi.fn(),
    updateThemeIcon: vi.fn(),
    toggleTheme: vi.fn(),
    initTooltips: vi.fn(),
    fetchTarifas: vi.fn(async () => true),
    getInputValues: vi.fn(() => values),
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
    ...overrides
  };

  new Function('window', code)(window);

  return { state, setValues: (v) => { values = v; } };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.LF;
  delete window.calculate;
  delete window.runCalculation;
  delete window.__LF_CALC_INFLIGHT;
});

describe('calculate(): editar durante un calculo en curso no borra el aviso de pendiente', () => {
  it('editar mientras calculateLocal esta en vuelo deja state.pending en true al terminar', async () => {
    let resolveCalc;
    const calcGate = new Promise((res) => { resolveCalc = res; });
    const { state, setValues } = boot({
      calculateLocal: vi.fn(async () => { await calcGate; })
    });

    const pending = window.calculate(true, false);
    await Promise.resolve();
    await Promise.resolve();

    // El usuario edita el formulario MIENTRAS el calculo (con los valores viejos) sigue en
    // vuelo: el listener real de input dispara markPending() de forma independiente.
    setValues({ p1: '2' });
    window.LF.markPending();

    resolveCalc();
    await pending;

    expect(state.pending).toBe(true);
  });

  it('sin ediciones durante el calculo, pending se limpia normalmente (regresion)', async () => {
    const { state } = boot({ calculateLocal: vi.fn(async () => {}) });

    await window.calculate(true, false);

    expect(state.pending).toBe(false);
  });

  // 14/08/2026, residual detectado por ChatGPT: signatureFromValues() solo cubre los
  // inputs "normales" (p1/p2/dias/consumos/zona/...), no "Mi tarifa" ni la curva CSV. Una
  // comparacion de firma sola no detecta un cambio que solo toque esos campos. Por eso el
  // fix usa state.generation (incrementado en markPending(), que SI se llama desde "Mi
  // tarifa" via scheduleCalculateDebounced en lf-tarifa-custom.js), no la firma.
  it('editar "Mi tarifa" durante el calculo deja pending en true aunque los inputs normales no cambien', async () => {
    let resolveCalc;
    const calcGate = new Promise((res) => { resolveCalc = res; });
    const { state } = boot({
      calculateLocal: vi.fn(async () => { await calcGate; })
    });

    const pending = window.calculate(true, false);
    await Promise.resolve();
    await Promise.resolve();

    // Los inputs "normales" (values) NO cambian: signatureFromValues() daria igual antes y
    // despues. Solo "Mi tarifa" cambia, y su propio listener llama a markPending()
    // (mismo camino que scheduleCalculateDebounced en produccion), sin tocar `values`.
    window.LF.markPending();

    resolveCalc();
    await pending;

    expect(state.pending).toBe(true);
  });

  // 14/08/2026, segundo residual detectado por ChatGPT: markPending() (y su bump de
  // generation) solo se disparaba al VENCER el debounce de scheduleCalculateDebounced()
  // (200ms despues de la edicion), no en el momento de editar. Si el usuario pulsaba
  // Calcular ANTES de que venciera ese debounce, calculate() capturaba startGeneration
  // ANTES del bump; cuando el debounce vencia DURANTE el propio calculo (que ya incluia ese
  // cambio), generation cambiaba igualmente y el resultado se marcaba "pendiente" en falso,
  // aunque el calculo ya reflejara exactamente lo que el usuario acababa de escribir.
  // Corregido incrementando pending/generation SINCRONICAMENTE al principio de
  // scheduleCalculateDebounced(), y cancelando cualquier debounce vivo al arrancar
  // calculate() (esos cambios ya estan en el snapshot que se va a capturar).
  it('pulsar Calcular antes de que venza el debounce de 200ms no deja "pendiente" en falso positivo', async () => {
    const { state } = boot({ calculateLocal: vi.fn(async () => {}) });

    // El usuario edita: dispara el mismo camino que un listener de input real
    // (scheduleCalculateDebounced), pero AUN NO han pasado los 200ms del debounce.
    window.scheduleCalculateDebounced();

    // Pulsa Calcular de inmediato: el snapshot que captura YA incluye ese cambio.
    await window.calculate(true, false);

    // Aunque el debounce original venza mas tarde (200ms reales desde la edicion), su
    // callback ya no debe reintroducir "pendiente": calculate() lo cancelo al arrancar.
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(state.pending).toBe(false);
  });

  it('editar justo despues de pulsar Calcular SI deja "pendiente" (regresion)', async () => {
    let resolveCalc;
    const calcGate = new Promise((res) => { resolveCalc = res; });
    const { state } = boot({
      calculateLocal: vi.fn(async () => { await calcGate; })
    });

    const pending = window.calculate(true, false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // El usuario edita 20ms despues de pulsar Calcular, via el camino real (debounce), no
    // llamando a markPending() directamente.
    window.scheduleCalculateDebounced();

    resolveCalc();
    await pending;

    expect(state.pending).toBe(true);
  });

  // 15/08/2026, residual detectado por ChatGPT (novena ronda, 4a revision): este listener muta
  // state.useAnnualConsumptionEstimate directamente (no es un input con su propio listener de
  // input/scheduleCalculateDebounced), asi que sin un bump explicito state.generation no se
  // enteraba de este cambio. Si ya habia un calculo en vuelo, el nuevo runCalculation() de aqui
  // se descarta por __LF_CALC_INFLIGHT, y el calculo viejo terminaba sin detectar que el
  // filtrado por limite anual (que si afecta a calculateLocal()) acababa de cambiar.
  it('el toggle de estimacion anual durante un calculo en curso deja pending en true', async () => {
    let resolveCalc;
    const calcGate = new Promise((res) => { resolveCalc = res; });
    const { state } = boot({
      calculateLocal: vi.fn(async () => { await calcGate; })
    });

    // El listener real de 'lf:annual-consumption-estimate-change' vive dentro del handler de
    // DOMContentLoaded (junto con el resto del cableado de la home), no se expone aparte: hay
    // que dispararlo para registrarlo de verdad, no reimplementar su efecto a mano.
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const pending = window.calculate(true, false);
    await Promise.resolve();
    await Promise.resolve();

    // El toggle real dispara este evento (lf-render.js) en vez de un input: sin el bump de
    // generation, este cambio no invalidaba nada.
    document.dispatchEvent(new window.CustomEvent('lf:annual-consumption-estimate-change', {
      detail: { enabled: true }
    }));

    resolveCalc();
    await pending;

    expect(state.pending).toBe(true);
  });

  // Ronda 13: `state.generation` solo cubre productores del formulario. El auto-refresh
  // puede sustituir baseTarifasCache/__LF_tarifasMeta mientras calculateLocal sigue en un
  // await posterior al snapshot. Si el commit solo mira generation, un ranking construido
  // con la version anterior queda etiquetado como "Resultados actualizados".
  it('un cambio de version del catalogo durante calculateLocal deja el resultado pendiente', async () => {
    let resolveCalc;
    const calcGate = new Promise((res) => { resolveCalc = res; });
    const calculateLocal = vi.fn(async () => { await calcGate; });
    const { state } = boot({
      __LF_tarifasMeta: { updatedAt: '2026-08-01T00:00:00Z' },
      baseTarifasCache: [{ nombre: 'Catalogo v1' }],
      calculateLocal
    });

    const pending = window.calculate(true, false);
    // No mutar la metadata hasta que calculate() haya copiado el catalogo y entrado
    // realmente en el await posterior. Asi el test discrimina el hueco que se audita.
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(1));

    // Mismo productor real que el auto-refresh: lf-cache.js sustituye cache + metadata
    // cuando termina una descarga valida. No hay edicion del formulario ni bump de generation.
    window.LF.baseTarifasCache = [{ nombre: 'Catalogo v2' }];
    window.LF.__LF_tarifasMeta = { updatedAt: '2026-08-26T00:00:00Z' };

    resolveCalc();
    await pending;

    expect(state.pending).toBe(true);
    expect(window.LF.setStatus).toHaveBeenLastCalledWith(
      'Tarifas actualizadas. Pulsa Calcular para aplicar la nueva versión.',
      'idle'
    );
  });

  // Ronda 13: una edicion valida durante un calculo programa el debounce y vuelve a
  // presentar "Pulsa Calcular". Antes, ese segundo click entraba en runCalculation(), veia
  // __LF_CALC_INFLIGHT y se perdia. La peticion se serializa y se ejecuta al terminar la vieja.
  it('una peticion de Calcular durante un calculo en vuelo se ejecuta despues si no hubo mas cambios', async () => {
    let resolveFirst;
    const firstGate = new Promise((res) => { resolveFirst = res; });
    let callCount = 0;
    const calculateLocal = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) await firstGate;
    });
    const { state } = boot({ calculateLocal });

    window.runCalculation(false);
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(1));

    // Edit real: bump sincronico de pending/generation. El click siguiente ocurre mientras
    // el primer calculo sigue en vuelo, asi que debe quedar en cola, no descartarse.
    window.scheduleCalculateDebounced();
    window.runCalculation(false);

    resolveFirst();
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(state.pending).toBe(false));
  });

  // La cola no autoriza a aplicar cambios hechos DESPUES del click que la creo. Si el usuario
  // sigue editando mientras espera, generation cambia y el recalculo automatico debe abortarse;
  // queda el aviso pendiente para que el usuario decida cuando volver a calcular.
  it('una edicion posterior a la peticion encolada impide aplicar automaticamente ese estado nuevo', async () => {
    let resolveFirst;
    const firstGate = new Promise((res) => { resolveFirst = res; });
    let callCount = 0;
    const calculateLocal = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) await firstGate;
    });
    const { state } = boot({ calculateLocal });

    window.runCalculation(false);
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(1));

    window.scheduleCalculateDebounced(); // cambio A
    window.runCalculation(false);        // el usuario pide calcular A
    window.scheduleCalculateDebounced(); // cambio B, posterior a esa peticion

    resolveFirst();
    await vi.waitFor(() => expect(window.__LF_CALC_INFLIGHT).toBe(false));

    expect(calculateLocal).toHaveBeenCalledTimes(1);
    expect(state.pending).toBe(true);
  });


  // Ronda 13: el evento de solicitud describe el inicio de un calculo aceptado, no un
  // click que se queda esperando detras de otro. El results-ready viejo debe cerrar
  // primero su lifecycle para que AECC/tracking no atribuyan esas filas a la peticion nueva.
  it('una peticion encolada anuncia results-requested solo despues del results-ready anterior', async () => {
    let resolveFirst;
    const firstGate = new Promise((res) => { resolveFirst = res; });
    let callCount = 0;
    const events = [];
    const onRequested = () => events.push('requested');
    const onReady = () => events.push('ready');
    document.addEventListener('lf:results-requested', onRequested);
    document.addEventListener('lf:results-ready', onReady);

    const calculateLocal = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        await firstGate;
        document.dispatchEvent(new CustomEvent('lf:results-ready', {
          detail: { origin: 'home', rows: 1 }
        }));
      }
    });
    boot({ calculateLocal });

    window.runCalculation(false, true);
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(1));

    window.scheduleCalculateDebounced();
    window.runCalculation(false, true);
    expect(events).toEqual(['requested']);

    resolveFirst();
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(2));

    expect(events).toEqual(['requested', 'ready', 'requested']);
    document.removeEventListener('lf:results-requested', onRequested);
    document.removeEventListener('lf:results-ready', onReady);
  });

  // Los recalculos internos (auto-refresh, factura/CSV) ya llamaban runCalculation sin
  // lf:results-requested. El nuevo punto unico de emision no debe convertirlos en una
  // accion de usuario ni inflar calculo-realizado/home.
  it('runCalculation sin anuncio conserva silenciosos los recalculos internos', async () => {
    const requested = vi.fn();
    document.addEventListener('lf:results-requested', requested);
    const calculateLocal = vi.fn(async () => {});
    boot({ calculateLocal });

    window.runCalculation(false);
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(window.__LF_CALC_INFLIGHT).toBe(false));

    expect(requested).not.toHaveBeenCalled();
    document.removeEventListener('lf:results-requested', requested);
  });

  // 26/08/2026, residual de la ronda 13 detectado por Codex: renderAll() pone
  // state.pending = false en lf-render.js:886 ANTES de renderTable(), y setStatus(...,'ok')
  // rehabilita el boton ahi mismo. Durante el render por chunks queda una ventana con
  // __LF_CALC_INFLIGHT=true, pending=false y boton pulsable: la cola solo guardaba la
  // peticion `if (state.pending)`, asi que ese click se perdia igual que antes del fix.
  // Encolar SIEMPRE durante inflight; la igualdad de generation al drenar sigue siendo
  // quien impide aplicar ediciones posteriores que el usuario no pidio calcular.
  it('un click durante el render (pending ya limpio) no se pierde', async () => {
    let abrirRender;
    const renderGate = new Promise((res) => { abrirRender = res; });
    const calculateLocal = vi.fn(async () => {
      // Replica el orden real: renderAll limpia pending y DESPUES sigue renderizando.
      window.LF.state.pending = false;
      if (calculateLocal.mock.calls.length === 1) await renderGate;
    });
    const { state } = boot({ calculateLocal });

    state.pending = true;
    state.generation = 1;
    window.runCalculation(false);
    await vi.waitFor(() => expect(calculateLocal).toHaveBeenCalledTimes(1));
    // La ventana: el calculo sigue en vuelo pero el aviso pendiente ya se limpio.
    expect(state.pending).toBe(false);
    expect(window.__LF_CALC_INFLIGHT).toBe(true);

    window.runCalculation(false);
    abrirRender();
    await vi.waitFor(() => expect(window.__LF_CALC_INFLIGHT).toBe(false));
    expect(calculateLocal).toHaveBeenCalledTimes(2);
  });

});
