import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Los modulos del sitio se cargan como <script defer> separados y se ensamblan
// sobre globals compartidos (window.BVSim.manualUi, window.__LF_DesgloseFactura).
// Si uno no llega a cargarse (fallo de red puntual, bloqueador), el siguiente se
// ejecuta igual contra un global incompleto. En julio de 2026 la telemetria
// segmentada saco a la luz justo eso: bv-ui.js:199 y desglose-factura.js:124
// reventaban con TypeError opacos y la pagina quedaba rota en silencio.
// Estos tests fijan que ahora degradan con aviso en vez de reventar.

function readJs(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', 'js', ...parts), 'utf8');
}

let listenerErrors;
let onWindowError;

beforeEach(() => {
  document.body.innerHTML = '';
  listenerErrors = [];
  onWindowError = (e) => listenerErrors.push(e.message || String(e.error));
  window.addEventListener('error', onWindowError);
});

afterEach(() => {
  window.removeEventListener('error', onWindowError);
  vi.restoreAllMocks();
});

describe('bv-ui sin bv-ui-helpers cargado', () => {
  // Solo bv-ui.js: simula que bv-ui-helpers.js no llego a ejecutarse.
  const loadBvUiSolo = new Function('window', readJs('bv', 'bv-ui.js'));

  function boot() {
    document.body.innerHTML = `
      <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
    `;
    window.BVSim = {}; // existe, pero sin manualUi
    window.LF = window.LF || {};
    window.__LF_trackDetail = vi.fn();
    loadBvUiSolo(window);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }

  it('no revienta y avisa al usuario en vez de lanzar TypeError', () => {
    boot();

    expect(listenerErrors).toEqual([]);
    expect(document.getElementById('toastText').textContent)
      .toContain('no terminó de cargarse');
    expect(document.getElementById('toast').classList.contains('show')).toBe(true);
  });

  it('reporta el arranque incompleto a analitica', () => {
    boot();

    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['solar', 'manual-ui'],
      expect.objectContaining({ title: expect.stringContaining('bv-ui-helpers') })
    );
  });

  it('no deja el simulador a medio inicializar', () => {
    boot();

    // Si hubiera seguido, habria construido los controles horarios.
    expect(window.BVSim._hourlyTraceControls).toBeUndefined();
  });
});

describe('desglose-factura sin desglose-calculo / desglose-render cargados', () => {
  const loadDesgloseSolo = new Function('window', readJs('desglose-factura.js'));

  function abrirDesglose() {
    window.LF = window.LF || {};
    delete window.__LF_DesgloseFactura;
    loadDesgloseSolo(window);

    const Desglose = window.__LF_DesgloseFactura;
    Desglose.abrir({ total: 50 });
    vi.runAllTimers(); // el render va en un setTimeout(0)
    return Desglose;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no revienta con "calcularDesglose is not a function"', () => {
    abrirDesglose();

    expect(listenerErrors).toEqual([]);
  });

  it('sustituye el "Calculando desglose..." por un aviso accionable', () => {
    const Desglose = abrirDesglose();

    const body = Desglose.modal.querySelector('.desglose-body');
    expect(body.textContent).not.toContain('Calculando desglose');
    expect(body.textContent).toContain('no terminó de descargarse');
    expect(body.querySelector('button')).toBeTruthy();
  });

  it('el aviso no usa handlers inline (compatible con la CSP)', () => {
    const Desglose = abrirDesglose();

    const btn = Desglose.modal.querySelector('.desglose-body button');
    expect(btn.getAttribute('onclick')).toBeNull();
  });

  it('sigue calculando con normalidad si los modulos si estan', () => {
    window.LF = window.LF || {};
    delete window.__LF_DesgloseFactura;
    loadDesgloseSolo(window);

    const Desglose = window.__LF_DesgloseFactura;
    Desglose.calcularDesglose = vi.fn(() => ({ ok: true }));
    Desglose.renderizar = vi.fn();

    Desglose.abrir({ total: 50 });
    vi.runAllTimers();

    expect(Desglose.calcularDesglose).toHaveBeenCalledWith({ total: 50 });
    expect(Desglose.renderizar).toHaveBeenCalledWith({ ok: true }, { total: 50 });
    expect(listenerErrors).toEqual([]);
  });
});

describe('factura sin factura-parsers cargado', () => {
  const loadFacturaSolo = new Function('window', readJs('factura.js'));

  beforeEach(() => {
    document.body.innerHTML = '<button id="btnSubirFactura" type="button">Subir factura</button>';
    delete window.__LF_FacturaParsers;
    delete window.__LF_facturaParserLoaded;
    delete window.__LF_bindFacturaParser;
    delete window.__LF_facturaModuleReady;
    window.LF = { toast: vi.fn() };
    window.__LF_trackDetail = vi.fn();
  });

  it('no lanza y deja un aviso accionable en el boton', () => {
    loadFacturaSolo(window);
    window.__LF_bindFacturaParser();
    document.getElementById('btnSubirFactura').click();

    expect(listenerErrors).toEqual([]);
    expect(window.LF.toast).toHaveBeenCalledWith(
      expect.stringContaining('no terminó de cargarse'),
      'err'
    );
    expect(window.__LF_facturaParserLoaded).not.toBe(true);
  });

  it('reporta la dependencia ausente sin datos de factura', () => {
    loadFacturaSolo(window);

    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['home', 'factura-parsers'],
      expect.objectContaining({ title: expect.stringContaining('factura-parsers') })
    );
  });
});
