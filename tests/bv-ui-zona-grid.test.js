import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Modulos reales, no mocks: bv-ui aborta el arranque si falta window.LF.parseNum, y la
// deteccion de cambio de zona usa la normalizacion canonica de lf-csv-utils.
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

/**
 * @vitest-environment jsdom
 */

// Ciclo de vida de la PROCEDENCIA del grid (que zona se uso para repartir P1/P2/P3) y su
// interaccion con el selector de zona fiscal. Los helpers puros ya estan cubiertos en
// bv-ui.test.js; aqui se conduce el DOM real porque los fallos vividos en esta zona fueron
// todos de CABLEADO, no de logica:
//   - limpiar la procedencia en "quitar archivo" (que NO vacia el grid) dejaba el reparto de
//     la zona antigua sin recalculo ni bloqueo: se calculaba con horario de una zona y
//     fiscalidad de otra;
//   - el repoblado por cambio de zona anunciaba "Datos importados" sin haber importado nada.

const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const loadBvUi = new Function('window', uiCode);

// Repartos distintos por zona: es lo que permite demostrar que el recalculo ha ocurrido de
// verdad mirando el grid, en vez de fiarse de un toast.
const SPLIT_PENINSULA = { P1: 10, P2: 70, P3: 20 };
const SPLIT_CEUTA = { P1: 50, P2: 30, P3: 20 };

let documentHandlers = [];
let windowHandlers = [];
let documentAddEventListenerSpy = null;
let windowAddEventListenerSpy = null;
let toastMessages = [];
let toastObserver = null;
let setTimeoutSpy = null;
// bv-ui guarda la tabla con 800 ms de debounce (y programa toasts, scroll, etc.). Esos
// temporizadores cierran sobre el estado de SU arranque, asi que uno pendiente al terminar un
// test se dispara durante el siguiente y persiste la zona de la instancia anterior, pisando la
// recien escrita. En produccion no puede pasar (hay una sola instancia y vive toda la sesion);
// aqui hay que cancelarlos entre tests o el fichero se vuelve flaky segun la carga de la maquina.
let pendingTimers = [];

function esCeutaMelilla(zona) {
  const norm = window.LF.csvUtils.normalizeZonaFiscal(zona);
  return norm.includes('ceuta') && norm.includes('melilla');
}

function bootSolarUi() {
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
    <button id="btnShare"></button>
    <div class="bv-shared-scenario-notice" id="bv-shared-scenario-notice" role="status" hidden>
      <span id="bv-shared-scenario-text"></span>
      <button type="button" id="bv-save-shared-scenario">Guardar como mi configuración</button>
    </div>
    <div id="bv-share-dialog" hidden aria-hidden="true">
      <input id="bv-share-include-monthly" type="checkbox">
      <input id="bv-share-include-private" type="checkbox">
      <p id="bv-share-scope"></p>
      <button id="bv-share-cancel"></button>
      <button id="bv-share-confirm"></button>
    </div>
    <div class="bv-cs" id="bv-mes-inicio">
      <button type="button" id="bv-mes-inicio-btn" disabled aria-haspopup="listbox" aria-expanded="false">
        <span class="bv-cs-value">Orden de la tabla (por defecto)</span>
      </button>
      <ul id="bv-mes-inicio-list"></ul>
    </div>
    <!-- Etiquetas identicas a comparador-tarifas-solares.html: el valor interno y el texto
         visible NO coinciden, y los avisos deben usar el texto. -->
    <select id="bv-zona-fiscal">
      <option value="Península" selected>Península y Baleares</option>
      <option value="Canarias">Canarias</option>
      <option value="CeutaMelilla">Ceuta y Melilla</option>
    </select>
    <div id="bv-vivienda-canarias-wrapper"></div>
    <input id="bv-vivienda-canarias" type="checkbox">
    <input id="mtPunta" value="">
    <input id="mtLlano" value="">
    <input id="mtValle" value="">
    <input id="mtP1" value="">
    <input id="mtP2" value="">
    <input id="mtExc" value="">
    <input id="mtBV" type="checkbox">
    <input id="mtPrecioBV" value="">
    <input id="mtSinSSAA" type="checkbox">
    <input id="mtCompensacionIndexada" type="checkbox">
    <input id="mtTopeParcial" type="checkbox">
    <span id="bv-custom-tarifa-indicator"></span>
    <button id="bv-clear-custom-tarifa"></button>
    <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
    <div id="bv-results-container"></div>
    <div id="bv-results"></div>
    <div id="bv-status-container"></div>
    <div id="bv-status"></div>
    <span id="bv-save-indicator" class="bv-save-indicator"></span>
    <div id="bv-manual-grid"></div>
    <div id="bv-manual-totals-row" style="display:none">
      <span id="bv-total-p1"></span><span id="bv-total-p2"></span>
      <span id="bv-total-p3"></span><span id="bv-total-vert"></span>
    </div>
    <div id="bv-manual-totals-summary" style="display:none">
      <span id="bv-total-consumo"></span><span id="bv-total-excedentes"></span>
    </div>
    <div id="bv-data-status"></div>
    <button id="bv-export-manual"></button>
    <button id="bv-import-manual"></button>
    <button id="bv-reset-manual"></button>
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
  window.BVSim.loadTarifasBV = vi.fn();
  window.BVSim.simulateForAllTarifasBV = vi.fn();
  window.BVSim.simulateMonthly = vi.fn((importResult, potenciaP1, potenciaP2, zona) => ({
    ok: true,
    months: [{
      key: '2025-01',
      start: '2025-01-01',
      end: '2025-01-31',
      spanDays: 31,
      daysWithData: 31,
      daysInMonth: 31,
      coveragePct: 100,
      importByPeriod: esCeutaMelilla(zona) ? SPLIT_CEUTA : SPLIT_PENINSULA,
      importTotalKWh: 100,
      exportTotalKWh: 5
    }]
  }));
  window.BVSim.importFile = vi.fn(async () => ({
    ok: true,
    records: [{ fecha: new Date(2025, 0, 15), hora: 12, kwh: 1, excedente: 0.5, periodo: 'P1' }],
    meta: {
      rows: 1,
      start: '2025-01-15',
      end: '2025-01-15',
      months: 1,
      hasExcedenteColumn: true,
      hasAutoconsumoColumn: false,
      isDatadisMonthly: false
    },
    warnings: []
  }));

  const nativeSetTimeout = window.setTimeout.bind(window);
  setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation((fn, ms, ...args) => {
    const id = nativeSetTimeout(fn, ms, ...args);
    pendingTimers.push(id);
    return id;
  });

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
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  // Centinela de arranque: si bv-ui hubiera abortado por dependencias incompletas, el grid
  // estaria vacio y todos los asserts de abajo pasarian en falso.
  expect(document.querySelectorAll('#bv-manual-grid input.manual-input').length).toBe(48);
  // Doble centinela: cada init crea UN tooltip flotante. Mas de uno significa que han
  // quedado vivos los listeners de un arranque anterior y hay dos instancias de bv-ui
  // escribiendo sobre el mismo DOM con estados distintos.
  expect(document.querySelectorAll('.bv-floating-tooltip')).toHaveLength(1);

  // showToast pisa el mismo nodo de texto, asi que el ultimo toast borra al anterior: para
  // demostrar que uno NO se emite hay que capturarlos todos segun se escriben.
  // OJO: hay que leer los addedNodes de cada MutationRecord, NO el textContent del elemento.
  // El callback del observer es un microtask unico para todas las mutaciones del lote, asi
  // que dos showToast seguidos lo invocan UNA vez con el texto ya pisado por el segundo; leer
  // el elemento perderia el primero y el test pasaria en falso (verificado en jsdom).
  toastMessages = [];
  toastObserver = new window.MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        const text = node.textContent;
        if (text) toastMessages.push(text);
      });
    });
  });
  toastObserver.observe(document.getElementById('toastText'), {
    childList: true,
    characterData: true,
    subtree: true
  });
}

// Simula una recarga de pagina: se tira el DOM y todo el estado en memoria (incluido el
// importResult, que nunca se persiste) y se vuelve a arrancar sobre el MISMO localStorage.
// Es el escenario donde la proteccion de zona se apoya solo en lo persistido.
function reboot() {
  if (toastObserver) {
    toastObserver.disconnect();
    toastObserver = null;
  }
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
  // Una recarga real se lleva por delante los temporizadores de la pagina anterior; si no se
  // cancelan aqui, el guardado con debounce de la instancia vieja resucita su estado.
  cancelPendingTimers();
  if (setTimeoutSpy) setTimeoutSpy.mockRestore();
  bootSolarUi();
}

function cancelPendingTimers() {
  pendingTimers.forEach((id) => clearTimeout(id));
  pendingTimers = [];
}

// handleFile es async y encadena varios awaits antes de tocar el grid.
async function flush() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

async function importCsv() {
  const fileInput = document.getElementById('bv-file');
  const file = new File(['fecha;hora;consumo'], 'consumo.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event('change'));
  await flush();
}

async function setZona(value) {
  const select = document.getElementById('bv-zona-fiscal');
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
  await flush();
}

function gridValue(monthIndex, type) {
  return document.querySelector(
    `#bv-manual-grid input[data-month="${monthIndex}"][data-type="${type}"]`
  ).value;
}

function editGrid(monthIndex, type, value) {
  const input = document.querySelector(
    `#bv-manual-grid input[data-month="${monthIndex}"][data-type="${type}"]`
  );
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  return input;
}

function sharedPayload(shareMock) {
  const lastCall = shareMock.mock.calls[shareMock.mock.calls.length - 1];
  const url = new URL(lastCall[0].url);
  const encoded = url.searchParams.get('bv');
  return JSON.parse(decodeURIComponent(escape(window.atob(encoded))));
}

beforeEach(() => {
  vi.useRealTimers();
  documentHandlers = [];
  windowHandlers = [];
  documentAddEventListenerSpy = null;
  windowAddEventListenerSpy = null;
  setTimeoutSpy = null;
  pendingTimers = [];
  toastMessages = [];
  localStorage.clear();
  delete window.__LF_trackDetail;
});

afterEach(() => {
  // Lo PRIMERO: cancelar los temporizadores del arranque que termina. El guardado con
  // debounce de 800 ms cierra sobre el estado de su propia instancia, asi que uno que
  // sobreviva al test escribe en localStorage durante el siguiente con la zona de este.
  cancelPendingTimers();
  if (toastObserver) {
    toastObserver.disconnect();
    toastObserver = null;
  }
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
  if (setTimeoutSpy) setTimeoutSpy.mockRestore();
  // IMPORTANTE: los timers reales se restauran LOS ULTIMOS. Los tests de autosave activan
  // fake timers ANTES de bootSolarUi, que hace vi.spyOn(window, 'setTimeout'): el spy captura
  // entonces la implementacion FALSA como si fuera la original. Si vi.useRealTimers() corriera
  // antes que vi.restoreAllMocks(), este ultimo reinstalaria ese setTimeout falso y los tests
  // posteriores que esperan con setTimeout real (flush/importarBackup) se colgarian hasta el
  // timeout de 5 s. Paso exactamente eso; no reordenar estas dos lineas.
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
  window.BVSim = {};
  localStorage.clear();
});

describe('Simulador solar - procedencia del grid frente al selector de zona', () => {
  it('ofrece y aplica de forma reversible el filtro por estimación anual', async () => {
    bootSolarUi();
    const limitada = {
      nombre: 'Solar máximo 4000',
      p1: 0.05, p2: 0.02,
      cPunta: 0.15, cLlano: 0.12, cValle: 0.09,
      web: 'https://example.com/limitada',
      maxConsumoAnual: 4000,
      fv: { bv: false, exc: 0.05, tipo: 'SIMPLE', tope: 'ENERGIA' }
    };
    const sinLimite = {
      ...limitada,
      nombre: 'Solar sin límite',
      web: 'https://example.com/sin-limite',
      maxConsumoAnual: undefined
    };
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true,
      updatedAt: '2026-08-13T00:00:00Z',
      tarifasBV: [limitada, sinLimite]
    }));
    window.BVSim.simulateForAllTarifasBV.mockImplementation(({ tarifasBV, months }) => ({
      ok: true,
      results: tarifasBV.map((tarifa, index) => ({
        tarifa,
        totals: {
          pagado: 100 + index,
          real: 100 + index,
          bvFinal: 0,
          credit1Total: 0,
          credit2Total: 0
        },
        rows: [{
          key: months[0].key,
          dias: months[0].daysWithData,
          importTotalKWh: months[0].importTotalKWh,
          pot: 10,
          consEur: 75,
          credit1: 0,
          totalBase: 100 + index,
          totalPagar: 100 + index,
          bvSaldoPrev: 0,
          bvSaldoFin: 0
        }]
      }))
    }));
    editGrid(0, 'p1', '500');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    const results = document.getElementById('bv-results');
    expect(results.textContent).toContain('Estimación anual orientativa');
    expect(results.textContent).toContain('la época del año puede cambiar mucho el resultado');
    expect(results.textContent).toContain('Ranking completo (2 tarifas)');
    let toggle = results.querySelector('[data-consumo-estimate-toggle]');
    expect(toggle.dataset.consumoEstimateToggle).toBe('true');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);

    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(results.textContent).toContain('Estimación anual aplicada');
    expect(results.textContent).toContain('Solar máximo 4000');
    expect(results.textContent).toContain('Ranking completo (1 tarifa)');
    expect(window.BVSim.simulateForAllTarifasBV.mock.calls.at(-1)[0].tarifasBV.map((tarifa) => tarifa.nombre))
      .toEqual(['Solar sin límite']);
    toggle = results.querySelector('[data-consumo-estimate-toggle]');
    expect(toggle.textContent).toBe('Volver a mostrar esas tarifas');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);

    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(results.textContent).toContain('Ranking completo (2 tarifas)');
  });

  it('mantiene una tarifa con mínimo aunque la estimación anual quede por debajo', async () => {
    bootSolarUi();
    const tramoAlto = {
      nombre: 'Solar tramo 8000',
      p1: 0.05, p2: 0.02,
      cPunta: 0.15, cLlano: 0.12, cValle: 0.09,
      web: 'https://example.com/tramo-alto',
      minConsumoAnualExclusivo: 4000,
      maxConsumoAnual: 8000,
      fv: { bv: false, exc: 0.05, tipo: 'SIMPLE', tope: 'ENERGIA' }
    };
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true,
      updatedAt: '2026-08-13T00:00:00Z',
      tarifasBV: [tramoAlto]
    }));
    window.BVSim.simulateForAllTarifasBV.mockImplementation(({ tarifasBV, months }) => ({
      ok: true,
      results: tarifasBV.map((tarifa) => ({
        tarifa,
        totals: { pagado: 100, real: 100, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
        rows: [{
          key: months[0].key,
          dias: months[0].daysWithData,
          importTotalKWh: months[0].importTotalKWh,
          pot: 10,
          consEur: 75,
          credit1: 0,
          totalBase: 100,
          totalPagar: 100,
          bvSaldoPrev: 0,
          bvSaldoFin: 0
        }]
      }))
    }));
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    const results = document.getElementById('bv-results');
    expect(results.textContent).toContain('Ranking completo (1 tarifa)');
    expect(results.textContent).toContain('Solar tramo 8000');
    expect(results.textContent).not.toContain('Estimación anual orientativa');
    expect(window.BVSim.simulateForAllTarifasBV.mock.calls.at(-1)[0].tarifasBV).toEqual([tramoAlto]);
  });

  it('centinela: importar rellena el grid con el reparto de la zona y anota su procedencia', async () => {
    bootSolarUi();
    await importCsv();

    expect(gridValue(0, 'p1')).toBe('10');
    expect(gridValue(0, 'p2')).toBe('70');
    expect(window.BVSim._manualGridImportState).toMatchObject({
      zonaFiscal: 'Península',
      dirty: false
    });
    expect(window.BVSim._manualGridImportState.result).toBeTruthy();
  });

  it('quitar el archivo NO borra la procedencia: el grid conserva datos y el cambio de zona sigue recalculando', async () => {
    bootSolarUi();
    await importCsv();

    document.getElementById('remove-file').dispatchEvent(new window.Event('click'));

    // El boton retira la seleccion de fichero, pero el grid sigue lleno: su reparto sigue
    // siendo de Peninsula y por tanto la procedencia tiene que sobrevivir.
    expect(gridValue(0, 'p1')).toBe('10');
    expect(window.BVSim._manualGridImportState.result).toBeTruthy();
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('Península');

    await setZona('CeutaMelilla');

    // Si la procedencia se hubiera limpiado, no habria recalculo NI bloqueo y se calcularia
    // con reparto peninsular y fiscalidad de Ceuta/Melilla.
    expect(gridValue(0, 'p1')).toBe('50');
    expect(gridValue(0, 'p2')).toBe('30');
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('CeutaMelilla');
  });

  it('el recalculo por cambio de zona no se anuncia como una importacion', async () => {
    bootSolarUi();
    await importCsv();
    toastMessages = [];

    await setZona('CeutaMelilla');

    expect(toastMessages.some((msg) => msg.includes('Reparto P1/P2/P3 recalculado'))).toBe(true);
    expect(toastMessages.some((msg) => msg.includes('Datos importados'))).toBe(false);
  });

  it('el recalculo re-apunta la curva horaria a la zona nueva y caduca sus stats', async () => {
    bootSolarUi();
    await importCsv();
    window.BVSim._hourlyTraceState.stats = { totalKwh: 123 };

    await setZona('CeutaMelilla');

    expect(window.BVSim._hourlyTraceState.zonaFiscal).toBe('CeutaMelilla');
    expect(window.BVSim._hourlyTraceState.stats).toBeNull();
  });

  it('Península a Canarias no toca el grid: comparten horario CNMC', async () => {
    bootSolarUi();
    await importCsv();
    toastMessages = [];

    await setZona('Canarias');

    expect(gridValue(0, 'p1')).toBe('10');
    expect(toastMessages.some((msg) => msg.includes('Reparto P1/P2/P3 recalculado'))).toBe(false);
  });

  it('con el grid editado a mano no se recalcula y el calculo queda bloqueado con motivo', async () => {
    bootSolarUi();
    await importCsv();

    editGrid(0, 'p1', '999');
    expect(window.BVSim._manualGridImportState.dirty).toBe(true);

    await setZona('CeutaMelilla');

    // Sin pisar la edicion del usuario.
    expect(gridValue(0, 'p1')).toBe('999');

    document.getElementById('bv-simulate').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const status = document.getElementById('bv-status').textContent;
    expect(status).toContain('has editado la tabla a mano');
  });

  it('la zona de procedencia se persiste con los datos del grid', async () => {
    bootSolarUi();
    await importCsv();

    const guardado = JSON.parse(localStorage.getItem('bv_manual_data_v2'));

    // Si se guardase ANTES de anotar la procedencia, aqui habria la zona anterior (o nada) y
    // la proteccion tras recargar no serviria de nada.
    expect(guardado.zonaOrigen).toBe('Península');

    await setZona('CeutaMelilla');
    const trasRecalculo = JSON.parse(localStorage.getItem('bv_manual_data_v2'));
    expect(trasRecalculo.zonaOrigen).toBe('CeutaMelilla');
  });

  it('persiste los ajustes completos de la simulacion junto a la tabla manual', async () => {
    bootSolarUi();
    document.getElementById('bv-p1').value = '4,6';
    document.getElementById('bv-p2').value = '3,2';
    document.getElementById('bv-saldo-inicial').value = '12,50';
    document.getElementById('bv-zona-fiscal').value = 'Canarias';
    document.getElementById('bv-vivienda-canarias').checked = true;

    document.getElementById('bv-p1').dispatchEvent(new window.Event('input'));
    const guardado = JSON.parse(localStorage.getItem('bv_manual_data_v2'));

    expect(guardado.config).toMatchObject({
      p1: '4,6',
      p2: '3,2',
      saldoInicial: '12,50',
      zonaFiscal: 'Canarias',
      viviendaCanarias: true
    });

    reboot();
    await flush();

    expect(document.getElementById('bv-p1').value).toBe('4,6');
    expect(document.getElementById('bv-p2').value).toBe('3,2');
    expect(document.getElementById('bv-saldo-inicial').value).toBe('12,50');
    expect(document.getElementById('bv-zona-fiscal').value).toBe('Canarias');
    expect(document.getElementById('bv-vivienda-canarias').checked).toBe(true);
  });

  it('comparte solo ajustes por defecto y requiere opt-in para datos personales', async () => {
    const shareMock = vi.fn(async () => {});
    window.__LF_trackDetail = vi.fn();
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: shareMock });
    bootSolarUi();
    editGrid(0, 'p1', '123');
    document.getElementById('bv-saldo-inicial').value = '25';
    document.getElementById('mtPunta').value = '0,15';

    document.getElementById('btnShare').click();
    expect(document.getElementById('bv-share-dialog').hidden).toBe(false);
    expect(document.getElementById('bv-share-scope').textContent).toContain('ajustes generales');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith('compartir-abierto', ['solar'], expect.any(Object));
    document.getElementById('bv-share-confirm').click();
    await flush();

    const minimo = sharedPayload(shareMock);
    expect(minimo.version).toBe(2);
    expect(minimo.data).toEqual({});
    expect(minimo.config.saldoInicial).toBe('');
    expect(minimo.config.customTarifa).toBeNull();
    expect(window.__LF_trackDetail).toHaveBeenCalledWith('url-compartida', ['solar', 'minimo'], expect.any(Object));

    document.getElementById('btnShare').click();
    document.getElementById('bv-share-include-monthly').checked = true;
    document.getElementById('bv-share-include-private').checked = true;
    document.getElementById('bv-share-confirm').click();
    await flush();

    const completo = sharedPayload(shareMock);
    expect(completo.data[0].p1).toBe('123');
    expect(completo.config.saldoInicial).toBe('25');
    expect(completo.config.customTarifa.punta).toBe('0,15');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith('url-compartida', ['solar', 'completo'], expect.any(Object));
  });

  it('compartir mensuales preserva zonaOrigen (14/08/2026): sin ella, el receptor pierde el guardrail de eje horario', async () => {
    const shareMock = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: shareMock });
    bootSolarUi();
    await importCsv();
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('Península');

    // Sin datos mensuales: no hace falta zonaOrigen (no hay reparto P1/P2/P3 que proteger).
    document.getElementById('btnShare').click();
    document.getElementById('bv-share-confirm').click();
    await flush();
    expect(sharedPayload(shareMock).data.zonaOrigen).toBeUndefined();

    // Con datos mensuales: zonaOrigen debe viajar igual que en buildManualScenarioPayload()
    // (guardado local/backup), o la previsualizacion del receptor no puede bloquear un reparto
    // calculado con el eje horario equivocado.
    document.getElementById('btnShare').click();
    document.getElementById('bv-share-include-monthly').checked = true;
    document.getElementById('bv-share-confirm').click();
    await flush();
    expect(sharedPayload(shareMock).data.zonaOrigen).toBe('Península');
  });

  it('tras recargar la pagina, cruzar el eje horario bloquea el calculo', async () => {
    bootSolarUi();
    await importCsv();
    expect(gridValue(0, 'p1')).toBe('10');

    // Recarga: se pierden el DOM y el estado en memoria, sobrevive localStorage.
    reboot();
    await flush();

    // El fichero ya no esta, pero la zona de origen si.
    expect(window.BVSim._manualGridImportState.result).toBeNull();
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('Península');

    await setZona('CeutaMelilla');
    // Sin fichero no se puede rehacer el reparto: la tabla sigue con el de Península.
    expect(gridValue(0, 'p1')).toBe('10');

    document.getElementById('bv-simulate').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(document.getElementById('bv-status').textContent)
      .toContain('no se ha podido rehacer el reparto');
  });

  it('la via de escape desbloquea, persiste la zona y sobrevive a otra recarga', async () => {
    bootSolarUi();
    await importCsv();
    reboot();
    await flush();
    await setZona('CeutaMelilla');

    document.getElementById('bv-simulate').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Confirmacion inequivoca: el programa no puede verificar un ajuste manual.
    window.confirm = vi.fn(() => true);
    const confirmBtn = document.getElementById('bv-zona-confirm');
    expect(confirmBtn).toBeTruthy();
    confirmBtn.dispatchEvent(new window.Event('click'));

    expect(window.confirm).toHaveBeenCalled();
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('CeutaMelilla');
    expect(window.BVSim._manualGridImportState.result).toBeNull();
    expect(JSON.parse(localStorage.getItem('bv_manual_data_v2')).zonaOrigen).toBe('CeutaMelilla');

    // Ya no bloquea, y la aceptacion sobrevive a otra recarga.
    reboot();
    await flush();
    document.getElementById('bv-zona-fiscal').value = 'CeutaMelilla';
    document.getElementById('bv-simulate').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(document.getElementById('bv-status').textContent)
      .not.toContain('no se ha podido rehacer el reparto');
  });

  it('los avisos usan la etiqueta visible de la zona, nunca el valor interno', async () => {
    bootSolarUi();
    await importCsv();
    reboot();
    await flush();
    await setZona('CeutaMelilla');

    document.getElementById('bv-simulate').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const status = document.getElementById('bv-status');
    // El reparto venia de la zona cuyo valor interno es 'Península' pero que el usuario ve
    // como 'Península y Baleares'.
    expect(status.textContent).toContain('Península y Baleares');
    expect(document.getElementById('bv-zona-confirm').textContent).toContain('Ceuta y Melilla');
    // Ningun valor interno debe asomar en el texto que se lee.
    expect(status.textContent).not.toContain('CeutaMelilla');
  });

  it('cancelar la confirmacion deja el bloqueo intacto', async () => {
    bootSolarUi();
    await importCsv();
    reboot();
    await flush();
    await setZona('CeutaMelilla');

    document.getElementById('bv-simulate').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    window.confirm = vi.fn(() => false);
    document.getElementById('bv-zona-confirm').dispatchEvent(new window.Event('click'));

    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('Península');
    expect(JSON.parse(localStorage.getItem('bv_manual_data_v2')).zonaOrigen).toBe('Península');
  });
});

// Un escenario recibido por `?bv=` es una PREVISUALIZACION. El aviso en pantalla promete que
// no ha sustituido los datos guardados; si el autosave escribe en cuanto se toca un campo, esa
// promesa deja de ser cierta y el usuario pierde su escenario sin haber confirmado nada.
describe('BV: escenario compartido como previsualizacion', () => {
  const DATOS_LOCALES = { 0: { p1: '555', p2: '555', p3: '555', vert: '' } };

  function abrirEscenarioCompartido(datosCompartidos, config = null, {
    extraQuery = '',
    hash = ''
  } = {}) {
    const payload = { version: 2, data: datosCompartidos };
    if (config) payload.config = config;
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const prefix = extraQuery ? `${extraQuery}&` : '';
    window.history.replaceState(
      {},
      '',
      `/comparador-tarifas-solares.html?${prefix}bv=${encodeURIComponent(b64)}${hash}`
    );
  }

  async function readBlobText(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }

  async function importarBackup(backup) {
    const file = new File([JSON.stringify(backup)], 'respaldo.json', { type: 'application/json' });
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
      if (this.type !== 'file' || !String(this.accept).includes('json')) return;
      Object.defineProperty(this, 'files', { value: [file], configurable: true });
      this.dispatchEvent(new window.Event('change'));
    });
    document.getElementById('bv-import-manual').dispatchEvent(new window.Event('click'));
    for (let i = 0; i < 8; i++) await flush();
    inputClick.mockRestore();
  }

  const snapshotStorage = () => Object.fromEntries([
    'bv_manual_data_v2',
    'bv_custom_tarifa',
    'bv_manual_data_timestamp'
  ].map((key) => [key, localStorage.getItem(key)]));

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    localStorage.clear();
  });

  // Estos tests verifican un debounce de 800 ms. Esperar 900 ms de reloj real los hacia
  // flaky bajo carga: el callback podia ejecutarse mucho mas tarde por contencion de CPU.
  // Los casos que dependen del autosave activan fake timers ANTES de arrancar bv-ui y
  // avanzan exactamente mas alla del debounce, haciendo la prueba determinista y rapida.
  const bootConAutosaveControlado = () => {
    vi.useFakeTimers();
    bootSolarUi();
  };
  const esperarAutosave = async () => {
    await vi.advanceTimersByTimeAsync(801);
  };
  const leido = () => JSON.parse(localStorage.getItem('bv_manual_data_v2') || 'null');

  it('editar un campo del escenario compartido NO pisa los datos locales', async () => {
    localStorage.setItem('bv_manual_data_v2', JSON.stringify(DATOS_LOCALES));
    abrirEscenarioCompartido({ 0: { p1: '999', p2: '999', p3: '999', vert: '' } });

    bootConAutosaveControlado();
    expect(gridValue(0, 'p1')).toBe('999');
    // Abrir, por si solo, ya respetaba los datos locales.
    expect(leido()[0].p1).toBe('555');

    editGrid(0, 'p1', '111');
    await esperarAutosave();

    // Y tocar un campo tampoco debe escribir: no se ha pulsado "Guardar escenario".
    expect(leido()[0].p1).toBe('555');
    expect(document.getElementById('bv-save-indicator').textContent).toBe('Vista previa sin guardar');
  });

  it('editar Mi tarifa en la previsualizacion tampoco pisa su persistencia separada', async () => {
    const tarifaLocal = {
      punta: '0,10', llano: '0,11', valle: '0,12',
      p1: '0,07', p2: '0,03', exc: '0,06', bv: true, savedAt: 1
    };
    localStorage.setItem('bv_custom_tarifa', JSON.stringify(tarifaLocal));
    abrirEscenarioCompartido(
      { 0: { p1: '999', p2: '999', p3: '999', vert: '' } },
      {
        customTarifa: {
          punta: '0,20', llano: '0,21', valle: '0,22',
          p1: '0,08', p2: '0,04', exc: '0,07', bv: false
        }
      }
    );

    bootConAutosaveControlado();
    const punta = document.getElementById('mtPunta');
    expect(punta.value).toBe('0,20');

    punta.value = '0,30';
    punta.dispatchEvent(new window.Event('input', { bubbles: true }));
    await esperarAutosave();

    expect(JSON.parse(localStorage.getItem('bv_custom_tarifa'))).toEqual(tarifaLocal);
  });

  it('un enlace que EXCLUYE Mi tarifa no usa la tarifa personalizada local del receptor (14/08/2026)', () => {
    const tarifaLocal = {
      punta: '0,10', llano: '0,11', valle: '0,12',
      p1: '0,07', p2: '0,03', exc: '0,06', bv: true, savedAt: 1
    };
    localStorage.setItem('bv_custom_tarifa', JSON.stringify(tarifaLocal));
    // config sin customTarifa: exactamente lo que produce getSharedConfig() cuando el
    // remitente NO marca "Mi tarifa y saldo BV" en el dialogo de compartir.
    abrirEscenarioCompartido({}, { saldoInicial: '' });

    bootSolarUi();

    // El mismo enlace debe dar el mismo formulario sin tarifa, sin importar si el receptor
    // tenia guardada una "Mi tarifa" local: si no fuera asi, el ranking del escenario
    // compartido cambiaria segun el navegador que lo abra.
    expect(document.getElementById('mtPunta').value).toBe('');
    expect(document.getElementById('mtBV').checked).toBe(false);
    expect(window.BVSim._getCustomTarifa()).toBeNull();
    // Los datos locales del receptor no se tocan: siguen intactos hasta que pulse "Guardar".
    expect(JSON.parse(localStorage.getItem('bv_custom_tarifa'))).toEqual(tarifaLocal);
  });

  it('un enlace que SI incluye Mi tarifa usa la del enlace, no la local (regresion)', () => {
    localStorage.setItem('bv_custom_tarifa', JSON.stringify({
      punta: '0,99', llano: '0,99', valle: '0,99', p1: '0,99', p2: '0,99', exc: '0,99', bv: false
    }));
    abrirEscenarioCompartido({}, {
      customTarifa: { punta: '0,15', llano: '0,12', valle: '0,10', p1: '0,08', p2: '0,04', exc: '0,05', bv: false }
    });

    bootSolarUi();

    expect(document.getElementById('mtPunta').value).toBe('0,15');
  });

  it('sin enlace compartido, se sigue cargando la Mi tarifa local normalmente (regresion)', () => {
    localStorage.setItem('bv_custom_tarifa', JSON.stringify({
      punta: '0,15', llano: '0,12', valle: '0,10', p1: '0,08', p2: '0,04', exc: '0,05', bv: false
    }));

    bootSolarUi();

    expect(document.getElementById('mtPunta').value).toBe('0,15');
  });

  it('exporta el estado visible sin leer ni modificar la persistencia local', async () => {
    localStorage.setItem('bv_manual_data_v2', JSON.stringify(DATOS_LOCALES));
    localStorage.setItem('bv_manual_data_timestamp', 'anterior');
    abrirEscenarioCompartido({ 0: { p1: '999', p2: '999', p3: '999', vert: '' } });
    bootSolarUi();
    editGrid(0, 'p1', '111');

    let exportedBlob = null;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exportedBlob = blob;
      return 'blob:respaldo';
    });
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    document.getElementById('bv-export-manual').dispatchEvent(new window.Event('click'));
    expect(exportedBlob).toBeTruthy();
    const exported = JSON.parse(await readBlobText(exportedBlob));

    expect(exported.data[0].p1).toBe('111');
    expect(JSON.parse(localStorage.getItem('bv_manual_data_v2'))[0].p1).toBe('555');
    expect(localStorage.getItem('bv_manual_data_timestamp')).toBe('anterior');
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    anchorClick.mockRestore();
  });

  it('"Guardar escenario" es la unica transicion que adopta el escenario compartido', async () => {
    localStorage.setItem('bv_manual_data_v2', JSON.stringify(DATOS_LOCALES));
    abrirEscenarioCompartido(
      { 0: { p1: '999', p2: '999', p3: '999', vert: '' } },
      null,
      { extraQuery: 'utm_source=newsletter&debug=1', hash: '#resultado' }
    );

    bootConAutosaveControlado();
    editGrid(0, 'p1', '111');
    await esperarAutosave();
    expect(leido()[0].p1).toBe('555');

    document.getElementById('bv-save-shared-scenario').dispatchEvent(new window.Event('click'));

    // Adopta lo que hay en pantalla, incluida la edicion del usuario.
    expect(leido()[0].p1).toBe('111');
    const adoptedUrl = new URL(window.location.href);
    expect(adoptedUrl.searchParams.has('bv')).toBe(false);
    expect(adoptedUrl.searchParams.get('utm_source')).toBe('newsletter');
    expect(adoptedUrl.searchParams.get('debug')).toBe('1');
    expect(adoptedUrl.hash).toBe('#resultado');

    // Recargar ya no vuelve a dar prioridad al 999 de la URL compartida.
    reboot();
    expect(gridValue(0, 'p1')).toBe('111');
    expect(document.getElementById('bv-shared-scenario-notice').hidden).toBe(true);

    // Y a partir de ahi el autosave vuelve a funcionar con normalidad.
    editGrid(0, 'p2', '222');
    await esperarAutosave();
    expect(leido()[0].p2).toBe('222');
  });

  it('importar desde una previsualizacion aplica el respaldo y abandona solo ?bv=', async () => {
    localStorage.setItem('bv_manual_data_v2', JSON.stringify(DATOS_LOCALES));
    abrirEscenarioCompartido(
      { 0: { p1: '999', p2: '999', p3: '999', vert: '' } },
      null,
      { extraQuery: 'utm_source=backup', hash: '#manual' }
    );
    bootSolarUi();

    await importarBackup({
      version: 2,
      data: { 0: { p1: '321', p2: '123', p3: '222', vert: '7' } }
    });

    expect(gridValue(0, 'p1')).toBe('321');
    expect(JSON.parse(localStorage.getItem('bv_manual_data_v2'))[0].p1).toBe('321');
    expect(new URL(window.location.href).searchParams.has('bv')).toBe(false);
    expect(new URL(window.location.href).searchParams.get('utm_source')).toBe('backup');
    expect(window.location.hash).toBe('#manual');
    expect(document.getElementById('bv-shared-scenario-notice').hidden).toBe(true);
  });

  it('importar un respaldo restaura Mi tarifa y sincroniza su timestamp', async () => {
    bootSolarUi();
    await importarBackup({
      version: 2,
      data: {
        0: { p1: '12', p2: '13', p3: '14', vert: '15' },
        config: {
          p1: '4,4',
          p2: '3,3',
          zonaFiscal: 'Canarias',
          viviendaCanarias: true,
          customTarifa: {
            punta: '0,20', llano: '0,21', valle: '0,22',
            p1: '0,08', p2: '0,04', exc: '0,07', bv: true
          }
        }
      }
    });

    expect(document.getElementById('mtPunta').value).toBe('0,20');
    expect(document.getElementById('mtBV').checked).toBe(true);
    const custom = JSON.parse(localStorage.getItem('bv_custom_tarifa'));
    expect(custom.punta).toBe('0,20');
    expect(custom.savedAt).toBe(localStorage.getItem('bv_manual_data_timestamp'));
    expect(JSON.parse(localStorage.getItem('bv_manual_data_v2')).config.customTarifa)
      .not.toHaveProperty('savedAt');
  });

  it('migra respaldos v2 antiguos sin config sin borrar la configuracion visible', async () => {
    bootSolarUi();
    document.getElementById('bv-p1').value = '6,6';
    document.getElementById('mtPunta').value = '0,31';
    document.getElementById('mtP1').value = '0,09';
    document.getElementById('mtBV').checked = true;

    await importarBackup({
      version: 2,
      data: { 0: { p1: '45', p2: '46', p3: '47', vert: '48' } }
    });

    expect(gridValue(0, 'p1')).toBe('45');
    expect(document.getElementById('bv-p1').value).toBe('6,6');
    expect(document.getElementById('mtPunta').value).toBe('0,31');
    expect(document.getElementById('mtBV').checked).toBe(true);
    const persisted = JSON.parse(localStorage.getItem('bv_manual_data_v2'));
    expect(persisted.config.p1).toBe('6,6');
    expect(persisted.config.customTarifa.punta).toBe('0,31');
    expect(JSON.parse(localStorage.getItem('bv_custom_tarifa')).punta).toBe('0,31');
  });

  it('revierte las tres claves si falla la escritura de bv_custom_tarifa', async () => {
    const previous = {
      bv_manual_data_v2: JSON.stringify(DATOS_LOCALES),
      bv_custom_tarifa: null,
      bv_manual_data_timestamp: 'timestamp-viejo'
    };
    Object.entries(previous).forEach(([key, value]) => {
      if (value !== null) localStorage.setItem(key, value);
    });
    abrirEscenarioCompartido(
      { 0: { p1: '999', p2: '999', p3: '999', vert: '' } },
      {
        customTarifa: {
          punta: '0,20', llano: '0,21', valle: '0,22',
          p1: '0,08', p2: '0,04', exc: '0,07', bv: true
        }
      }
    );
    bootConAutosaveControlado();

    const nativeSetItem = Storage.prototype.setItem;
    let failed = false;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'bv_custom_tarifa' && !failed) {
        failed = true;
        throw new DOMException('fallo simulado', 'QuotaExceededError');
      }
      return nativeSetItem.call(this, key, value);
    });

    toastMessages = [];
    document.getElementById('bv-save-shared-scenario').dispatchEvent(new window.Event('click'));
    await flushMicrotasks();

    expect(snapshotStorage()).toEqual(previous);
    expect(new URL(window.location.href).searchParams.has('bv')).toBe(true);
    expect(document.getElementById('bv-shared-scenario-notice').hidden).toBe(false);
    expect(toastMessages.some((message) => message.includes('guardado como tu configuración'))).toBe(false);

    editGrid(0, 'p1', '111');
    await esperarAutosave();
    expect(snapshotStorage()).toEqual(previous);
    setItem.mockRestore();
  });

  it('revierte las tres claves si falla la eliminacion de bv_custom_tarifa', async () => {
    const previous = {
      bv_manual_data_v2: JSON.stringify(DATOS_LOCALES),
      bv_custom_tarifa: JSON.stringify({ punta: '0,10', savedAt: 'viejo' }),
      bv_manual_data_timestamp: 'timestamp-viejo'
    };
    Object.entries(previous).forEach(([key, value]) => localStorage.setItem(key, value));
    abrirEscenarioCompartido(
      { 0: { p1: '999', p2: '999', p3: '999', vert: '' } },
      { customTarifa: { punta: '', llano: '', valle: '', p1: '', p2: '', exc: '', bv: false } }
    );
    bootConAutosaveControlado();

    const nativeRemoveItem = Storage.prototype.removeItem;
    let failed = false;
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (key === 'bv_custom_tarifa' && !failed) {
        failed = true;
        throw new DOMException('fallo simulado', 'SecurityError');
      }
      return nativeRemoveItem.call(this, key);
    });

    toastMessages = [];
    document.getElementById('bv-save-shared-scenario').dispatchEvent(new window.Event('click'));
    await flushMicrotasks();

    expect(snapshotStorage()).toEqual(previous);
    expect(new URL(window.location.href).searchParams.has('bv')).toBe(true);
    expect(document.getElementById('bv-shared-scenario-notice').hidden).toBe(false);
    expect(toastMessages.some((message) => message.includes('guardado como tu configuración'))).toBe(false);

    editGrid(0, 'p1', '111');
    await esperarAutosave();
    expect(snapshotStorage()).toEqual(previous);
    removeItem.mockRestore();
  });

  it('sin escenario compartido el autosave sigue guardando desde el primer cambio', async () => {
    bootConAutosaveControlado();
    editGrid(0, 'p1', '333');
    await esperarAutosave();
    expect(leido()[0].p1).toBe('333');
  });

  it('el autosave normal nunca anuncia exito si falla localStorage', async () => {
    bootConAutosaveControlado();
    const nativeSetItem = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'bv_manual_data_v2' && !failed) {
        failed = true;
        throw new DOMException('fallo simulado', 'QuotaExceededError');
      }
      return nativeSetItem.call(this, key, value);
    });

    editGrid(0, 'p1', '444');
    await esperarAutosave();

    const indicator = document.getElementById('bv-save-indicator');
    expect(indicator.textContent).toBe('⚠️ No guardado');
    expect(indicator.classList.contains('save-error')).toBe(true);
    expect(indicator.textContent).not.toContain('✓ Guardado');
    expect(localStorage.getItem('bv_manual_data_v2')).toBeNull();
  });
});

describe('Tabla manual: validacion estricta y cero explicito (14/08/2026)', () => {
  it('un valor invalido en la tabla bloquea Calcular en vez de clamparlo en silencio', async () => {
    bootSolarUi();
    editGrid(0, 'p1', '-50');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('Corrige los valores en rojo');
  });

  it('"1,2,3" (formato ambiguo) tambien bloquea Calcular', async () => {
    bootSolarUi();
    editGrid(0, 'p1', '1,2,3');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('Corrige los valores en rojo');
  });

  it('un valor cargado desde un respaldo sin pasar por el evento input tambien se bloquea', async () => {
    bootSolarUi();
    // Simula un respaldo/URL compartida: escribe .value directamente, SIN disparar 'input'
    // (asi la clase .error nunca se marca por el listener en vivo).
    const input = document.querySelector('#bv-manual-grid input[data-month="0"][data-type="p1"]');
    input.value = '-50';

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('Corrige los valores en rojo');
  });

  it('acepta potencia contratada P1 = 0 kW cuando P2 es positiva', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-15T00:00:00Z', tarifasBV: []
    }));
    document.getElementById('bv-p1').value = '0';
    document.getElementById('bv-p2').value = '7,4';
    // Sin datos en la tabla el calculo se bloquea por falta de consumo, no por P1:
    // hay que rellenar un mes para que el test compruebe de verdad el limite de potencia.
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(document.getElementById('bv-p1').classList.contains('error')).toBe(false);
    expect(window.BVSim.loadTarifasBV).toHaveBeenCalled();
  });


  it('muestra los totales cuando un mes se aporta explicitamente como 0/0/0/0', () => {
    bootSolarUi();
    editGrid(0, 'p1', '0');
    editGrid(0, 'p2', '0');
    editGrid(0, 'p3', '0');
    editGrid(0, 'vert', '0');

    expect(document.getElementById('bv-manual-totals-row').style.display).toBe('grid');
    expect(document.getElementById('bv-manual-totals-summary').style.display).toBe('block');
    expect(document.getElementById('bv-total-p1').textContent).toBe('0');
    expect(document.getElementById('bv-total-p2').textContent).toBe('0');
    expect(document.getElementById('bv-total-p3').textContent).toBe('0');
    expect(document.getElementById('bv-total-vert').textContent).toBe('0');
    expect(document.getElementById('bv-total-consumo').textContent).toBe('0');
    expect(document.getElementById('bv-total-excedentes').textContent).toBe('0');
  });
  it('un valor valido normal sigue calculando sin bloqueo (regresion)', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: []
    }));
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).toHaveBeenCalled();
  });

  it('un mes con los 4 campos explicitamente a 0 no desaparece de la simulacion', async () => {
    bootSolarUi();
    let capturedMonths = null;
    const tarifaMinima = {
      nombre: 'Tarifa test', p1: 0.05, p2: 0.02,
      cPunta: 0.15, cLlano: 0.12, cValle: 0.09,
      web: 'https://example.com/test',
      fv: { bv: false, exc: 0, tipo: 'NO COMPENSA', tope: '—' }
    };
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima]
    }));
    window.BVSim.simulateForAllTarifasBV.mockImplementation(({ months }) => {
      capturedMonths = months;
      return { ok: true, results: [] };
    });

    ['p1', 'p2', 'p3', 'vert'].forEach((type) => editGrid(0, type, '0'));

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(capturedMonths).not.toBeNull();
    expect(capturedMonths.length).toBe(1);
  });

  it('un hueco mensual interno en la tabla manual bloquea Calcular', async () => {
    bootSolarUi();
    // Enero (mes 0) y Marzo (mes 2) rellenos, Febrero (mes 1) vacio: hueco interno.
    editGrid(0, 'p1', '100');
    editGrid(2, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('hueco');
  });

  it('meses consecutivos en la tabla manual NO bloquean Calcular (regresion)', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: []
    }));
    editGrid(0, 'p1', '100');
    editGrid(1, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).toHaveBeenCalled();
  });

  it('un "0" explicito guardado sobrevive a un recarga: no se muestra como campo vacio', async () => {
    vi.useFakeTimers();
    bootSolarUi();

    editGrid(0, 'p1', '0');
    editGrid(0, 'p2', '15');
    await vi.advanceTimersByTimeAsync(801);

    // collectManualGridData() guarda el .value crudo tal cual: comprobar que "0" (no "")
    // llego intacto a localStorage antes de la recarga.
    const guardado = JSON.parse(localStorage.getItem('bv_manual_data_v2'));
    expect(guardado[0].p1).toBe('0');

    reboot();

    expect(gridValue(0, 'p1')).toBe('0');
    expect(gridValue(0, 'p2')).toBe('15');
  });

  it('un mes con los 4 campos a 0 explicito no pierde la zona de procedencia al recargar', async () => {
    bootSolarUi();
    await importCsv();
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('Península');

    // Correccion manual: el usuario deja el mes importado a 0 en los 4 campos (p.ej. un mes
    // sin consumo real). loadManualData() debe seguir contando esto como "con datos" para no
    // perder la zona de procedencia que protege el eje horario tras recargar.
    editGrid(0, 'p1', '0');
    editGrid(0, 'p2', '0');
    editGrid(0, 'p3', '0');
    editGrid(0, 'vert', '0');
    await new Promise((resolve) => setTimeout(resolve, 850));

    reboot();

    expect(gridValue(0, 'p1')).toBe('0');
    expect(window.BVSim._manualGridImportState.zonaFiscal).toBe('Península');
  });

  it('un campo realmente vacio sigue restaurandose vacio (regresion)', async () => {
    vi.useFakeTimers();
    bootSolarUi();

    editGrid(0, 'p1', '15');
    // p2/p3/vert quedan vacios a proposito.
    await vi.advanceTimersByTimeAsync(801);

    reboot();

    expect(gridValue(0, 'p1')).toBe('15');
    expect(gridValue(0, 'p2')).toBe('');
  });
});

describe('Simulador solar - "Mi tarifa": precioBV no bloquea el calculo con BV desactivada (14/08/2026)', () => {
  function fillMiTarifaValida() {
    document.getElementById('mtPunta').value = '0,15';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,05';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,08';
  }

  it('BV off + precioBV con formato invalido no bloquea el calculo, y fv.precioBV es 0', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: []
    }));
    fillMiTarifaValida();
    document.getElementById('mtBV').checked = false;
    document.getElementById('mtPrecioBV').value = 'abc';
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).toHaveBeenCalled();
    expect(window.BVSim._getCustomTarifa().fv.precioBV).toBe(0);
  });

  it('activar BV manteniendo el mismo precioBV invalido si bloquea el calculo', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: []
    }));
    fillMiTarifaValida();
    document.getElementById('mtPrecioBV').value = 'abc';
    editGrid(0, 'p1', '100');

    const mtBVEl = document.getElementById('mtBV');
    mtBVEl.checked = true;
    mtBVEl.dispatchEvent(new window.Event('change'));

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('cuota de batería virtual');
  });

  it('desactivar BV quita la marca de error de precioBV', async () => {
    bootSolarUi();
    fillMiTarifaValida();
    const mtBVEl = document.getElementById('mtBV');
    const precioBVEl = document.getElementById('mtPrecioBV');

    mtBVEl.checked = true;
    mtBVEl.dispatchEvent(new window.Event('change'));
    precioBVEl.value = 'abc';
    precioBVEl.dispatchEvent(new window.Event('input'));
    expect(precioBVEl.classList.contains('error')).toBe(true);

    mtBVEl.checked = false;
    mtBVEl.dispatchEvent(new window.Event('change'));

    expect(precioBVEl.classList.contains('error')).toBe(false);
  });
});

describe('Simulador solar - "Limpiar cache" no borra datos del usuario (14/08/2026)', () => {
  it('preserva Mi tarifa, el escenario guardado y el opt-out; borra solo la cache PVPC', async () => {
    localStorage.setItem('bv_manual_data_v2', JSON.stringify({ 0: { p1: '100', p2: '', p3: '', vert: '' } }));
    localStorage.setItem('bv_custom_tarifa', JSON.stringify({ punta: '0,15', bv: false }));
    localStorage.setItem('bv_manual_data_timestamp', '2026-08-14T00:00:00.000Z');
    localStorage.setItem('almax_theme', 'light');
    localStorage.setItem('goatcounter_optout', 'true');
    localStorage.setItem('pvpc_cache_v3:algo-obsoleto', JSON.stringify({ fake: true }));

    bootSolarUi();
    window.confirm = vi.fn(() => true);
    const btn = document.createElement('button');
    btn.id = 'btnClearCache';
    document.body.appendChild(btn);

    btn.click();
    await flush();

    expect(localStorage.getItem('bv_manual_data_v2')).not.toBeNull();
    expect(localStorage.getItem('bv_custom_tarifa')).not.toBeNull();
    expect(localStorage.getItem('bv_manual_data_timestamp')).not.toBeNull();
    expect(localStorage.getItem('almax_theme')).toBe('light');
    expect(localStorage.getItem('goatcounter_optout')).toBe('true');
    expect(localStorage.getItem('pvpc_cache_v3:algo-obsoleto')).toBeNull();
  });
});

describe('Simulador solar - la tabla manual no "cura" valores invalidos al exportar/importar/compartir (14/08/2026)', () => {
  it('exportar con un valor invalido en la tabla bloquea en vez de generar un backup', () => {
    bootSolarUi();
    editGrid(0, 'p1', '1,2,3');

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    document.getElementById('bv-export-manual').dispatchEvent(new window.Event('click'));

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('Corrige los valores en rojo');
    createObjectUrl.mockRestore();
  });

  it('compartir mensuales con un valor invalido bloquea en vez de generar el enlace', async () => {
    const shareMock = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: shareMock });
    bootSolarUi();
    editGrid(0, 'p1', '1,2,3');

    document.getElementById('btnShare').click();
    document.getElementById('bv-share-include-monthly').checked = true;
    document.getElementById('bv-share-confirm').click();
    await flush();

    expect(shareMock).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('Corrige los valores en rojo');
  });

  it('importar un backup con un valor invalido se rechaza y no toca los datos anteriores', async () => {
    localStorage.setItem('bv_manual_data_v2', JSON.stringify({ 0: { p1: '50', p2: '', p3: '', vert: '' } }));
    bootSolarUi();

    const backup = {
      version: 2,
      data: { 0: { p1: '1,2,3', p2: '', p3: '', vert: '' } },
      app: 'LuzFija - Comparador Tarifas Solares'
    };
    const file = new File([JSON.stringify(backup)], 'respaldo.json', { type: 'application/json' });
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
      if (this.type !== 'file' || !String(this.accept).includes('json')) return;
      Object.defineProperty(this, 'files', { value: [file], configurable: true });
      this.dispatchEvent(new window.Event('change'));
    });
    document.getElementById('bv-import-manual').dispatchEvent(new window.Event('click'));
    for (let i = 0; i < 8; i++) await flush();
    inputClick.mockRestore();

    expect(document.getElementById('toastText').textContent).toContain('invalidos');
    expect(JSON.parse(localStorage.getItem('bv_manual_data_v2'))[0].p1).toBe('50');
  });

  it('un "1,2,3" restaurado (respaldo/enlace) no se convierte en silencio en "12,3" (regresion critica)', () => {
    bootSolarUi();
    localStorage.setItem('bv_manual_data_v2', JSON.stringify({ 0: { p1: '1,2,3', p2: '', p3: '', vert: '' } }));

    reboot();

    // El valor invalido se muestra TAL CUAL llego, marcado en rojo — nunca reformateado a
    // otro numero valido que el usuario no escribio ni confirmo.
    expect(gridValue(0, 'p1')).toBe('1,2,3');
    const input = document.querySelector('#bv-manual-grid input[data-month="0"][data-type="p1"]');
    expect(input.classList.contains('error')).toBe(true);
  });

  it('un valor valido normal se sigue reformateando igual que antes (regresion)', () => {
    bootSolarUi();
    localStorage.setItem('bv_manual_data_v2', JSON.stringify({ 0: { p1: '123.45', p2: '', p3: '', vert: '' } }));

    reboot();

    expect(gridValue(0, 'p1')).toBe('123,45');
    const input = document.querySelector('#bv-manual-grid input[data-month="0"][data-type="p1"]');
    expect(input.classList.contains('error')).toBe(false);
  });
});

describe('Simulador solar - "Mi tarifa": mtExc no bloquea el calculo con compensacion indexada (14/08/2026, residual)', () => {
  function fillMiTarifaValida() {
    document.getElementById('mtPunta').value = '0,15';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,05';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,08';
  }

  it('indexada ON + mtExc invalido: no bloquea el calculo', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: []
    }));
    fillMiTarifaValida();
    document.getElementById('mtExc').value = 'abc';
    document.getElementById('mtCompensacionIndexada').checked = true;
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).toHaveBeenCalled();
    expect(window.BVSim._getCustomTarifa().fv.exc).toBe(-1);
  });

  it('indexada OFF + el mismo mtExc invalido: si bloquea (regresion)', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: []
    }));
    fillMiTarifaValida();
    document.getElementById('mtExc').value = 'abc';
    document.getElementById('mtCompensacionIndexada').checked = false;
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(window.BVSim.loadTarifasBV).not.toHaveBeenCalled();
    expect(document.getElementById('toastText').textContent).toContain('número válido');
  });

  it('marcar indexada quita la marca de error de mtExc', () => {
    bootSolarUi();
    fillMiTarifaValida();
    const mtExcEl = document.getElementById('mtExc');
    const mtCompensacionIndexadaEl = document.getElementById('mtCompensacionIndexada');

    mtExcEl.value = 'abc';
    mtExcEl.dispatchEvent(new window.Event('input'));
    expect(mtExcEl.classList.contains('error')).toBe(true);

    mtCompensacionIndexadaEl.checked = true;
    mtCompensacionIndexadaEl.dispatchEvent(new window.Event('change'));

    expect(mtExcEl.classList.contains('error')).toBe(false);
  });
});

// 14/08/2026 (novena ronda): potencias (capturadas al pulsar Calcular), tabla mensual
// (capturada tras 100ms) y "Mi tarifa" (antes se leia despues de loadTarifasBV, un await de
// red sin duracion acotada) podian venir de tres instantes distintos si el usuario editaba
// mientras loadTarifasBV() seguia en vuelo. Corregido capturando todo ANTES de ese await, y
// avisando si algo cambio en el formulario mientras se calculaba.
describe('Simulador solar - Calcular no mezcla potencia/tabla/Mi tarifa de instantes distintos (14/08/2026)', () => {
  const tarifaMinima = {
    nombre: 'Tarifa test', p1: 0.05, p2: 0.02,
    cPunta: 0.15, cLlano: 0.12, cValle: 0.09,
    web: 'https://example.com/test',
    fv: { bv: false, exc: 0, tipo: 'NO COMPENSA', tope: '—' }
  };

  it('editar potencia y la tabla mientras loadTarifasBV() esta en vuelo no mezcla datos, y avisa de resultado desactualizado', async () => {
    bootSolarUi();
    let resolveTarifas;
    const tarifasGate = new Promise((res) => { resolveTarifas = res; });
    window.BVSim.loadTarifasBV.mockImplementation(() => tarifasGate);
    let capturedArgs = null;
    window.BVSim.simulateForAllTarifasBV.mockImplementation((args) => {
      capturedArgs = args;
      return {
        ok: true,
        results: [{
          tarifa: tarifaMinima,
          totals: { pagado: 10, real: 10, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
          rows: [{
            key: args.months[0].key,
            dias: args.months[0].daysWithData,
            importTotalKWh: args.months[0].importTotalKWh,
            pot: 1, consEur: 9, credit1: 0, totalBase: 10, totalPagar: 10,
            bvSaldoPrev: 0, bvSaldoFin: 0
          }]
        }]
      };
    });

    editGrid(0, 'p1', '100');
    document.getElementById('bv-p1').value = '3,45';

    document.getElementById('bv-simulate').click();
    // Deja pasar el setTimeout(100) interno antes de loadTarifasBV().
    await new Promise((resolve) => setTimeout(resolve, 150));

    // El usuario edita potencia Y la tabla MIENTRAS loadTarifasBV() sigue esperando.
    document.getElementById('bv-p1').value = '9,99';
    editGrid(0, 'p1', '900');

    resolveTarifas({ ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima] });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // La potencia usada en el calculo es la de ANTES del edit (captura coherente, no la
    // mezcla): 3.45, no 9.99.
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs.potenciaP1).toBe(3.45);
    expect(capturedArgs.months[0].importByPeriod.P1).toBe(100);

    // El resultado (ya calculado, pero desactualizado) NO se publica: no se hace commit
    // del ranking viejo, se avisa y se pide recalcular.
    expect(document.getElementById('bv-results').textContent).toContain('Has cambiado datos mientras se calculaba');
    expect(document.getElementById('bv-results').textContent).not.toContain('Ranking completo');
    expect(document.getElementById('toastText').textContent).toContain('Has cambiado datos mientras se calculaba');
  });

  it('sin ediciones durante la espera, el resultado no lleva el aviso de desactualizado (regresion)', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima]
    }));
    window.BVSim.simulateForAllTarifasBV.mockImplementation((args) => ({
      ok: true,
      results: [{
        tarifa: tarifaMinima,
        totals: { pagado: 10, real: 10, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
        rows: [{
          key: args.months[0].key,
          dias: args.months[0].daysWithData,
          importTotalKWh: args.months[0].importTotalKWh,
          pot: 1, consEur: 9, credit1: 0, totalBase: 10, totalPagar: 10,
          bvSaldoPrev: 0, bvSaldoFin: 0
        }]
      }]
    }));
    editGrid(0, 'p1', '100');

    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(document.getElementById('toastText').textContent).toContain('Cálculo completado');
    expect(document.getElementById('toastText').textContent).not.toContain('cambiado datos');
  });

  it('cambiar de zona mientras loadTarifasBV() esta en vuelo tambien se detecta como desactualizado', async () => {
    bootSolarUi();
    let resolveTarifas;
    const tarifasGate = new Promise((res) => { resolveTarifas = res; });
    window.BVSim.loadTarifasBV.mockImplementation(() => tarifasGate);
    window.BVSim.simulateForAllTarifasBV.mockImplementation((args) => ({
      ok: true,
      results: [{
        tarifa: tarifaMinima,
        totals: { pagado: 10, real: 10, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
        rows: [{
          key: args.months[0].key,
          dias: args.months[0].daysWithData,
          importTotalKWh: args.months[0].importTotalKWh,
          pot: 1, consEur: 9, credit1: 0, totalBase: 10, totalPagar: 10,
          bvSaldoPrev: 0, bvSaldoFin: 0
        }]
      }]
    }));

    editGrid(0, 'p1', '100');
    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Cambiar de zona (sin tocar potencia ni tabla) MIENTRAS loadTarifasBV() sigue en vuelo.
    document.getElementById('bv-zona-fiscal').value = 'Canarias';

    resolveTarifas({ ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima] });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(document.getElementById('bv-results').textContent).toContain('Has cambiado datos mientras se calculaba');
    expect(document.getElementById('bv-results').textContent).not.toContain('Ranking completo');
  });

  it('editar la potencia INMEDIATAMENTE tras pulsar Calcular (antes del setTimeout(100) interno) tambien se detecta', async () => {
    bootSolarUi();
    window.BVSim.loadTarifasBV.mockImplementation(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima]
    }));
    window.BVSim.simulateForAllTarifasBV.mockImplementation((args) => ({
      ok: true,
      results: [{
        tarifa: tarifaMinima,
        totals: { pagado: 10, real: 10, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
        rows: [{
          key: args.months[0].key,
          dias: args.months[0].daysWithData,
          importTotalKWh: args.months[0].importTotalKWh,
          pot: 1, consEur: 9, credit1: 0, totalBase: 10, totalPagar: 10,
          bvSaldoPrev: 0, bvSaldoFin: 0
        }]
      }]
    }));

    editGrid(0, 'p1', '100');
    document.getElementById('bv-p1').value = '3,45';

    document.getElementById('bv-simulate').click();
    // Editar en el mismo tick, antes de que transcurra el setTimeout(100) interno: con la
    // captura movida antes de ese wait, esto ya no puede colarse sin marcar de "cambiado".
    document.getElementById('bv-p1').value = '9,99';
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(document.getElementById('bv-results').textContent).toContain('Has cambiado datos mientras se calculaba');
  });

  it('la rama "no quedan tarifas compatibles" tambien respeta el aviso de desactualizado', async () => {
    bootSolarUi();
    const tarifaLimitada = { ...tarifaMinima, maxConsumoAnual: 50 };
    let resolveTarifas;
    const tarifasGate = new Promise((res) => { resolveTarifas = res; });
    window.BVSim.loadTarifasBV.mockImplementation(() => tarifasGate);
    window.BVSim.simulateForAllTarifasBV.mockImplementation(() => ({ ok: true, results: [] }));

    // Consumo capturado (100 kWh) SUPERA el limite de tarifaLimitada (50 kWh/año): sin el
    // aviso, esto es justo lo que dispara la rama "no quedan tarifas compatibles".
    editGrid(0, 'p1', '100');
    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Editar la tabla MIENTRAS loadTarifasBV() sigue en vuelo.
    editGrid(0, 'p1', '10');

    resolveTarifas({ ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaLimitada] });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(document.getElementById('bv-results').textContent).toContain('Has cambiado datos mientras se calculaba');
    expect(document.getElementById('bv-results').textContent).not.toContain('No quedan tarifas solares compatibles');
  });

  // 14/08/2026, tercera revision de ChatGPT: mesInicioValCapturado ya entraba en el snapshot,
  // pero la comprobacion original se hacia DESPUES de updateMesInicioSelector(baseMonths), que
  // puede reescribir mesInicioInput.value por su cuenta (limpiar seleccion si el mes deja de
  // existir) y enmascarar un cambio real del usuario. El fix mueve isCalcResultStale() a ANTES
  // de esa llamada; este test conduce el desplegable real (no mesInicioInput directamente: es
  // una variable de closure sin acceso desde fuera) para probarlo de punta a punta.
  it('cambiar "Mes de inicio" mientras loadTarifasBV() esta en vuelo tambien se detecta como desactualizado', async () => {
    bootSolarUi();
    const year = new Date().getFullYear();
    const keyEnero = `${year}-01`;
    const keyFebrero = `${year}-02`;
    window.BVSim.simulateForAllTarifasBV.mockImplementation((args) => ({
      ok: true,
      results: [{
        tarifa: tarifaMinima,
        totals: { pagado: 10, real: 10, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
        rows: args.months.map((m) => ({
          key: m.key, dias: m.daysWithData, importTotalKWh: m.importTotalKWh,
          pot: 1, consEur: 9, credit1: 0, totalBase: 10, totalPagar: 10,
          bvSaldoPrev: 0, bvSaldoFin: 0
        }))
      }]
    }));

    // Dos meses rellenados de verdad en el grid: buildSimulationMonths() (helper real, no
    // mockeado) solo produce 2+ meses -y por tanto habilita "Mes de inicio"- con datos reales.
    editGrid(0, 'p1', '100');
    editGrid(1, 'p1', '100');

    // Primer calculo: se deja completar normalmente. Es lo que habilita y puebla el
    // desplegable "Mes de inicio" (solo tiene opciones reales con 2+ meses).
    window.BVSim.loadTarifasBV.mockImplementationOnce(async () => ({
      ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima]
    }));
    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const mesInicioBtn = document.getElementById('bv-mes-inicio-btn');
    expect(mesInicioBtn.disabled).toBe(false);
    const pickMesInicio = (key) => {
      const li = Array.from(document.querySelectorAll('#bv-mes-inicio-list .bv-cs-item'))
        .find((el) => el.dataset.value === key);
      expect(li).toBeTruthy();
      li.click();
    };
    pickMesInicio(keyEnero);

    // Segundo calculo: loadTarifasBV() se queda en vuelo.
    let resolveTarifas;
    const tarifasGate = new Promise((res) => { resolveTarifas = res; });
    window.BVSim.loadTarifasBV.mockImplementation(() => tarifasGate);
    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // El usuario cambia "Mes de inicio" (sin tocar potencia, tabla ni zona) MIENTRAS
    // loadTarifasBV() sigue esperando.
    pickMesInicio(keyFebrero);

    resolveTarifas({ ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima] });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(document.getElementById('bv-results').textContent).toContain('Has cambiado datos mientras se calculaba');
    expect(document.getElementById('bv-results').textContent).not.toContain('Ranking completo');
  });

  // 14/08/2026, tercera revision de ChatGPT: la curva horaria indexada (hourlyTraceState) no
  // formaba parte del snapshot en absoluto. "Quitar archivo" (clearHourlyTraceState) es la
  // via mas limpia para probarlo aislado: no toca potencia, tabla, zona ni Mi tarifa, asi que
  // si el aviso aparece solo puede deberse al contador hourlyTraceState.rev.
  it('quitar el archivo importado mientras loadTarifasBV() esta en vuelo (bump de hourlyTraceState.rev) tambien se detecta como desactualizado', async () => {
    bootSolarUi();
    let resolveTarifas;
    const tarifasGate = new Promise((res) => { resolveTarifas = res; });
    window.BVSim.loadTarifasBV.mockImplementation(() => tarifasGate);
    window.BVSim.simulateForAllTarifasBV.mockImplementation((args) => ({
      ok: true,
      results: [{
        tarifa: tarifaMinima,
        totals: { pagado: 10, real: 10, bvFinal: 0, credit1Total: 0, credit2Total: 0 },
        rows: [{
          key: args.months[0].key,
          dias: args.months[0].daysWithData,
          importTotalKWh: args.months[0].importTotalKWh,
          pot: 1, consEur: 9, credit1: 0, totalBase: 10, totalPagar: 10,
          bvSaldoPrev: 0, bvSaldoFin: 0
        }]
      }]
    }));

    editGrid(0, 'p1', '100');
    document.getElementById('bv-simulate').click();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Sin fichero importado siquiera, el boton llama a clearHourlyTraceState() igualmente
    // (bumpea hourlyTraceState.rev sin tocar ningun otro campo del snapshot).
    document.getElementById('remove-file').click();

    resolveTarifas({ ok: true, updatedAt: '2026-08-13T00:00:00Z', tarifasBV: [tarifaMinima] });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(document.getElementById('bv-results').textContent).toContain('Has cambiado datos mientras se calculaba');
    expect(document.getElementById('bv-results').textContent).not.toContain('Ranking completo');
  });
});
