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
  delete window.BVSim;
  delete window.LF;
  delete window.PVPC_STATS;
  delete window.Chart;
  delete window.__LF_PvpcStatsCsv;
  delete window.__LF_trackDetail;
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

describe('bv-ui con motor mensual incompleto', () => {
  const loadBvUiSolo = new Function('window', readJs('bv', 'bv-ui.js'));

  it('deshabilita el cálculo y reporta la dependencia sin continuar a medias', () => {
    document.body.innerHTML = `
      <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
      <button id="bv-simulate" type="button">Comparar</button>
    `;
    const noOp = vi.fn();
    window.BVSim = {
      manualUi: {
        buildSimulationMonths: noOp,
        createHourlyTraceControls: noOp,
        normalizeMonthMeta: noOp,
        pickLatestMonthData: noOp,
        resolveCosteNeto: noOp,
        resolveSaldoConfig: noOp,
        rotateMonthsByStart: noOp
      }
      // Faltan loadTarifasBV/simulateMonthly/simulateForAllTarifasBV.
    };
    window.LF = { parseNum: vi.fn() };
    window.__LF_trackDetail = vi.fn();

    loadBvUiSolo(window);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(listenerErrors).toEqual([]);
    expect(document.getElementById('toastText').textContent).toContain('no terminó de cargarse');
    expect(document.getElementById('bv-simulate').disabled).toBe(true);
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['solar', 'simulation-core'],
      expect.objectContaining({ title: expect.stringContaining('dependencias incompletas') })
    );
  });
});

describe('observatorio con dependencias parciales', () => {
  const loadStatsUi = new Function('window', readJs('pvpc-stats-ui.js'));

  function statsDom() {
    document.body.innerHTML = `
      <span id="kpiLastSub"></span>
      <span id="trendMeta"></span>
      <span id="hourlyMeta"></span>
      <span id="hourlyCallout"></span>
    `;
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });
    window.__LF_trackDetail = vi.fn();
  }

  it('no lanza si falta pvpc-stats-csv y deja un aviso visible', () => {
    statsDom();
    delete window.__LF_PvpcStatsCsv;
    window.PVPC_STATS = {};
    window.Chart = vi.fn();

    expect(() => loadStatsUi(window)).not.toThrow();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(listenerErrors).toEqual([]);
    expect(document.getElementById('kpiLastSub').textContent).toContain('no terminó de cargarse');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['estadisticas', 'stats-csv'],
      expect.any(Object)
    );
  });

  it('no intenta renderizar gráficos si Chart.js no llegó a cargar', () => {
    statsDom();
    window.__LF_PvpcStatsCsv = {
      computeCsvCompensation: vi.fn(),
      parseCsvOrXlsx: vi.fn()
    };
    window.PVPC_STATS = {};
    delete window.Chart;

    expect(() => loadStatsUi(window)).not.toThrow();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(listenerErrors).toEqual([]);
    expect(document.getElementById('kpiLastSub').textContent).toContain('gráficos no terminaron');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['estadisticas', 'chartjs'],
      expect.any(Object)
    );
  });
});

describe('comparador principal con módulos parciales', () => {
  const loadLfApp = new Function('window', readJs('lf-app.js'));

  it('también deja un aviso accionable si falta por completo el namespace LF', () => {
    document.body.innerHTML = `
      <span id="statusText">Rellena tus datos y calcula</span>
      <button id="btnCalc" type="button">Calcular</button>
    `;
    delete window.LF;
    window.__LF_trackDetail = vi.fn();

    expect(() => loadLfApp(window)).not.toThrow();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(listenerErrors).toEqual([]);
    expect(document.getElementById('btnCalc').disabled).toBe(true);
    expect(document.getElementById('statusText').textContent).toContain('no terminó de cargarse');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['home', 'app-core'],
      expect.any(Object)
    );
  });

  it('deshabilita calcular y deja un estado visible sin generar errores en cascada', () => {
    document.body.innerHTML = `
      <span id="statusText">Rellena tus datos y calcula</span>
      <button id="btnCalc" type="button">Calcular</button>
    `;
    window.LF = { toast: vi.fn() };
    window.__LF_trackDetail = vi.fn();

    expect(() => loadLfApp(window)).not.toThrow();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(listenerErrors).toEqual([]);
    expect(document.getElementById('btnCalc').disabled).toBe(true);
    expect(document.getElementById('statusText').textContent).toContain('no terminó de cargarse');
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('no terminó de cargarse'), 'err');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['home', 'app-core'],
      expect.any(Object)
    );
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
