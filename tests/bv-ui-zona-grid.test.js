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
    <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
    <div id="bv-results-container"></div>
    <div id="bv-results"></div>
    <div id="bv-status-container"></div>
    <div id="bv-status"></div>
    <div id="bv-manual-grid"></div>
    <div id="bv-data-status"></div>
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

beforeEach(() => {
  documentHandlers = [];
  windowHandlers = [];
  documentAddEventListenerSpy = null;
  windowAddEventListenerSpy = null;
  setTimeoutSpy = null;
  pendingTimers = [];
  toastMessages = [];
  localStorage.clear();
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
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.BVSim = {};
  localStorage.clear();
});

describe('Simulador solar - procedencia del grid frente al selector de zona', () => {
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
