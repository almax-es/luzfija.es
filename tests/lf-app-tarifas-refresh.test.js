/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Revision de ChatGPT, 20/11/2026: el auto-refresco de tarifas comparaba contra una referencia
// propia (`__lf_lastTarifasUpdatedAt`) que solo fijaban el arranque y el propio refresco.
// (1) Descarga inicial fallida + Calcular que trae v1 + refresco que trae v2: el refresco lo tomaba
//     por "primera carga", guardaba v2 y salia sin avisar ni recalcular (ranking de v1 sin aviso).
// (2) Calcular que trae v2 por su cuenta: el refresco siguiente comparaba v1 con v2 y avisaba y
//     recalculaba con el mismo catalogo.
// Ahora la referencia es la version cargada justo antes de cada descarga del refresco.
// Se recorre el arranque real (DOMContentLoaded) y el listener real de `online`.

const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');

// Cada test monta un lf-app nuevo: sus listeners de window/document se retiran al terminar para que
// el arranque y el `online` de un test no vuelvan a ejecutar los de los anteriores.
const registrados = [];
function registrarListeners() {
  for (const objetivo of [window, document]) {
    const original = objetivo.addEventListener;
    vi.spyOn(objetivo, 'addEventListener').mockImplementation(function (tipo, fn, opciones) {
      registrados.push([objetivo, tipo, fn, opciones]);
      return original.call(this, tipo, fn, opciones);
    });
  }
}

function boot({ fetchTarifas }) {
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
    markPending: vi.fn(() => { state.pending = true; state.generation += 1; }),
    applyThemeClass: vi.fn(),
    updateThemeIcon: vi.fn(),
    toggleTheme: vi.fn(),
    initTooltips: vi.fn(),
    fetchTarifas,
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
    __LF_tarifasMeta: null
  };
  registrarListeners();
  new Function('window', code)(window);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return state;
}

async function refrescar() {
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => {});
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const [objetivo, tipo, fn, opciones] of registrados.splice(0)) {
    objetivo.removeEventListener(tipo, fn, opciones);
  }
  document.body.innerHTML = '';
  delete window.LF;
  delete window.calculate;
  delete window.runCalculation;
  delete window.__LF_CALC_INFLIGHT;
});

describe('auto-refresco de tarifas: referencia de version', () => {
  it('descarga inicial fallida, Calcular trae v1 y el refresco trae v2: avisa', async () => {
    let siguiente = null; // null = falla
    const fetchTarifas = vi.fn(async () => {
      if (!siguiente) return false;
      window.LF.__LF_tarifasMeta = { updatedAt: siguiente };
      return true;
    });
    const state = boot({ fetchTarifas });
    await vi.waitFor(() => expect(fetchTarifas).toHaveBeenCalledTimes(1)); // arranque, falla

    // Calcular descarga v1 y pinta resultados.
    siguiente = 'v1';
    await window.calculate(true, false);
    expect(window.LF.__LF_tarifasMeta.updatedAt).toBe('v1');
    state.pending = true; // el usuario edita sin calcular: el aviso no debe recalcular solo

    siguiente = 'v2';
    await refrescar();
    expect(fetchTarifas).toHaveBeenLastCalledWith(true, expect.objectContaining({ diagnosticReason: 'online' }));
    expect(window.LF.toast).toHaveBeenCalledWith('Tarifas actualizadas. Pulsa "Calcular" para aplicarlas.', 'ok');
  });

  it('Calcular ya trajo v2: el refresco siguiente no avisa ni recalcula', async () => {
    let siguiente = 'v1';
    const fetchTarifas = vi.fn(async () => {
      window.LF.__LF_tarifasMeta = { updatedAt: siguiente };
      return true;
    });
    boot({ fetchTarifas });
    await vi.waitFor(() => expect(window.LF.__LF_tarifasMeta?.updatedAt).toBe('v1')); // arranque

    siguiente = 'v2';
    await window.calculate(true, false);
    const calculos = window.LF.calculateLocal.mock.calls.length;

    await refrescar();
    expect(fetchTarifas).toHaveBeenLastCalledWith(true, expect.objectContaining({ diagnosticReason: 'online' }));
    expect(window.LF.toast).not.toHaveBeenCalledWith(expect.stringContaining('Tarifas actualizadas'), 'ok');
    expect(window.LF.calculateLocal.mock.calls.length).toBe(calculos);
  });

  it('sin version previa (nada cargado aun) el primer refresco no avisa', async () => {
    let siguiente = null;
    const fetchTarifas = vi.fn(async () => {
      if (!siguiente) return false;
      window.LF.__LF_tarifasMeta = { updatedAt: siguiente };
      return true;
    });
    boot({ fetchTarifas });
    await vi.waitFor(() => expect(fetchTarifas).toHaveBeenCalledTimes(1));

    siguiente = 'v1';
    await refrescar();
    expect(window.LF.__LF_tarifasMeta.updatedAt).toBe('v1');
    expect(window.LF.toast).not.toHaveBeenCalledWith(expect.stringContaining('Tarifas actualizadas'), 'ok');
  });
});
