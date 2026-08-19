import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

/**
 * @vitest-environment jsdom
 */

const bootstrapCode = fs.readFileSync(path.resolve(__dirname, '../js/error-bootstrap.js'), 'utf8');
const trackingCode = fs.readFileSync(path.resolve(__dirname, '../js/tracking.js'), 'utf8');

function isolatedPage(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, {
    url: 'https://luzfija.es/',
    runScripts: 'outside-only'
  });
  dom.window.eval(bootstrapCode);
  return dom.window;
}

function failScript(isolatedWindow, src) {
  const script = isolatedWindow.document.createElement('script');
  script.src = src;
  isolatedWindow.document.head.appendChild(script);
  script.dispatchEvent(new isolatedWindow.Event('error'));
}

function finishDom(isolatedWindow) {
  isolatedWindow.document.dispatchEvent(new isolatedWindow.Event('DOMContentLoaded'));
}

describe('Early first-party error bootstrap', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.__LF_EARLY_ERROR_BOOTSTRAP;
    delete window.__LF_EARLY_ERRORS;
    delete window.__LF_TRACKING_ERROR_READY;
    delete window.__LF_track;
    delete window.__LF_PENDING_INIT_RECOVERY;
    delete window.__LF_requestInitRecovery;
    window.goatcounter = { count: vi.fn() };
  });

  it('entrega a tracking los fallos ocurridos antes de que tracking.js cargue', () => {
    new Function(bootstrapCode)();

    const script = document.createElement('script');
    script.src = '/js/theme.js?v=build';
    document.head.appendChild(script);
    script.dispatchEvent(new Event('error'));
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'mensaje que el buffer no debe conservar',
      filename: '/js/config.js',
      lineno: 17,
      colno: 4
    }));

    expect(window.__LF_EARLY_ERRORS).toHaveLength(2);
    expect(JSON.stringify(window.__LF_EARLY_ERRORS)).not.toContain('mensaje que');

    new Function(trackingCode)();

    const payloads = window.goatcounter.count.mock.calls.map((call) => call[0]);
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'error-script-load/theme/0/desconocido' }),
      expect.objectContaining({ path: 'error-javascript/config/17/desconocido' })
    ]));
    const earlyThemeTitle = payloads
      .find((payload) => payload.path === 'error-script-load/theme/0/desconocido').title;
    expect(earlyThemeTitle).toContain('origen:home');
    expect(earlyThemeTitle).toContain('online:si');
    expect(earlyThemeTitle).toContain('sw:no');
    expect(window.__LF_EARLY_ERRORS).toHaveLength(0);
    expect(window.__LF_TRACKING_ERROR_READY).toBe(true);
  });

  it('deja una recuperación funcional pendiente aunque tracking.js todavía no exista', () => {
    const isolatedWindow = isolatedPage('');

    failScript(isolatedWindow, '/js/factura-parsers.js?v=20260802-180538');

    expect(isolatedWindow.__LF_PENDING_INIT_RECOVERY).toEqual([{
      app: 'resource',
      dependency: 'factura-parsers-js',
      build: 'desconocido',
      phase: 'initial'
    }]);
    expect(typeof isolatedWindow.__LF_requestInitRecovery).toBe('function');
  });

  it('registra el fallo de count.js sin solicitar una recarga de la aplicación', () => {
    const isolatedWindow = isolatedPage('');

    failScript(isolatedWindow, '/vendor/goatcounter/count.js?v=20260809-090539');

    expect(isolatedWindow.__LF_PENDING_INIT_RECOVERY).toBeUndefined();
    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([{
      kind: 'script-load',
      source: '/vendor/goatcounter/count.js',
      line: 0,
      col: 0
    }]);
  });

  it('no recarga la aplicación si falla tracking.js, que es observabilidad opcional', () => {
    const isolatedWindow = isolatedPage('');

    failScript(isolatedWindow, '/js/tracking.js?v=20260811-080249');

    expect(isolatedWindow.__LF_PENDING_INIT_RECOVERY).toBeUndefined();
    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([{
      kind: 'script-load',
      source: '/js/tracking.js',
      line: 0,
      col: 0
    }]);
  });

  it('no confunde un vendor lazy con un módulo esencial aunque el documento siga cargando', () => {
    const isolatedWindow = isolatedPage('');

    failScript(isolatedWindow, '/vendor/xlsx/xlsx.full.min.js?v=20260811-080249');

    expect(isolatedWindow.__LF_PENDING_INIT_RECOVERY).toBeUndefined();
  });

  it('incluye el core OCR entre los vendors lazy con recuperación propia', () => {
    const isolatedWindow = isolatedPage('');

    failScript(isolatedWindow, '/vendor/tesseract-core/tesseract-core.wasm.js?v=20260811-080249');

    expect(isolatedWindow.__LF_PENDING_INIT_RECOVERY).toBeUndefined();
  });

  it('deja el reintento de un script dinámico en manos de su cargador', () => {
    const isolatedWindow = isolatedPage('');
    Object.defineProperty(isolatedWindow.document, 'readyState', {
      configurable: true,
      value: 'complete'
    });

    failScript(isolatedWindow, '/vendor/xlsx/xlsx.full.min.js?v=20260811-080249');

    expect(isolatedWindow.__LF_PENDING_INIT_RECOVERY).toBeUndefined();
    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([{
      kind: 'script-load',
      source: '/vendor/xlsx/xlsx.full.min.js',
      line: 0,
      col: 0
    }]);
  });

  it('descarta una inyección temprana atribuida a la línea 1 del documento', () => {
    const isolatedWindow = isolatedPage('');

    isolatedWindow.dispatchEvent(new isolatedWindow.ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token 'else'",
      filename: 'https://luzfija.es/',
      lineno: 1,
      colno: 219
    }));

    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([]);
  });

  it('tracking vuelve a filtrar una cola antigua con una posición imposible', () => {
    const isolatedWindow = isolatedPage('');
    isolatedWindow.__LF_EARLY_ERRORS.push({
      kind: 'javascript',
      source: '/',
      line: 1,
      col: 219
    });
    isolatedWindow.goatcounter = { count: vi.fn() };

    isolatedWindow.eval(trackingCode);

    expect(isolatedWindow.goatcounter.count).not.toHaveBeenCalled();
    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([]);
  });

  it('conserva errores tempranos reales de un fichero minificado en línea 1', () => {
    const isolatedWindow = isolatedPage('');

    isolatedWindow.dispatchEvent(new isolatedWindow.ErrorEvent('error', {
      message: 'Uncaught TypeError: prueba',
      filename: 'https://luzfija.es/js/app.min.js',
      lineno: 1,
      colno: 219
    }));

    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([
      expect.objectContaining({
        kind: 'javascript',
        source: '/js/app.min.js',
        line: 1,
        col: 219
      })
    ]);
  });

  it('conserva fallos tempranos de estilos con la misma forma mínima y sin URL completa', () => {
    const isolatedWindow = isolatedPage('');
    const link = isolatedWindow.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://luzfija.es/styles.css?v=build';
    isolatedWindow.document.head.appendChild(link);

    link.dispatchEvent(new isolatedWindow.Event('error'));

    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([{
      kind: 'style-load',
      source: '/styles.css',
      line: 0,
      col: 0
    }]);
  });

  it('descarta recursos blob aunque su origen aparente coincidir', () => {
    const isolatedWindow = isolatedPage('');
    const script = isolatedWindow.document.createElement('script');
    script.src = 'blob:https://luzfija.es/11111111-2222-3333-4444-555555555555';
    isolatedWindow.document.head.appendChild(script);

    script.dispatchEvent(new isolatedWindow.Event('error'));

    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([]);
  });

  it('recupera el tema guardado antes del CSS si theme.js no se descarga', () => {
    const isolatedWindow = isolatedPage('');
    isolatedWindow.localStorage.setItem('almax_theme', 'light');

    failScript(isolatedWindow, '/js/theme.js?v=build');

    expect(isolatedWindow.document.documentElement.classList.contains('light-mode')).toBe(true);
    expect(isolatedWindow.__ALMAX_THEME_SAVED).toBe('light');
    expect(isolatedWindow.__ALMAX_THEME_KEY).toBe('almax_theme');
    expect(isolatedWindow.__LF_EARLY_ERRORS).toEqual([
      expect.objectContaining({
        kind: 'script-load',
        source: '/js/theme.js',
        line: 0,
        col: 0
      })
    ]);
  });

  it('mantiene el tema oscuro por defecto al recuperar theme.js sin preferencia', () => {
    const isolatedWindow = isolatedPage('');
    isolatedWindow.document.documentElement.classList.add('light-mode');

    failScript(isolatedWindow, '/js/theme.js?v=build');

    expect(isolatedWindow.document.documentElement.classList.contains('light-mode')).toBe(false);
    expect(isolatedWindow.__ALMAX_THEME_SAVED).toBeNull();
    expect(isolatedWindow.__ALMAX_THEME_KEY).toBe('almax_theme');
  });

  it('deja la home segura si lf-app completo no llega a ejecutarse', () => {
    const isolatedWindow = isolatedPage(`
      <div id="toast"><span id="toastDot"></span><span id="toastText"></span></div>
      <span id="statusText">Lista</span>
      <button id="btnCalc">Calcular</button>
      <button id="btnSubirFactura">Subir factura</button>
    `);

    failScript(isolatedWindow, '/js/lf-app.js?v=build');
    finishDom(isolatedWindow);

    expect(isolatedWindow.document.getElementById('btnCalc').disabled).toBe(true);
    expect(isolatedWindow.document.getElementById('btnSubirFactura').disabled).toBe(true);
    expect(isolatedWindow.document.getElementById('statusText').textContent).toContain('no terminó');
    expect(isolatedWindow.document.getElementById('toast').classList.contains('show')).toBe(true);
  });

  it('convierte el botón de factura en un aviso si falta factura.js', () => {
    const isolatedWindow = isolatedPage(`
      <div id="toast"><span id="toastDot"></span><span id="toastText"></span></div>
      <button id="btnSubirFactura">Subir factura</button>
    `);
    isolatedWindow.__LF_trackDetail = vi.fn();

    failScript(isolatedWindow, '/js/factura.js?v=build');
    finishDom(isolatedWindow);
    isolatedWindow.document.getElementById('btnSubirFactura').click();

    expect(isolatedWindow.document.getElementById('toastText').textContent).toContain('no terminó');
    expect(isolatedWindow.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['home', 'factura-module'],
      expect.any(Object)
    );
  });

  it('intercepta las filas dinámicas si falta desglose-integration.js', () => {
    const isolatedWindow = isolatedPage(`
      <div id="toast"><span id="toastDot"></span><span id="toastText"></span></div>
      <table><tbody id="tbody"></tbody></table>
    `);

    failScript(isolatedWindow, '/js/desglose-integration.js?v=build');
    finishDom(isolatedWindow);
    isolatedWindow.document.getElementById('tbody').innerHTML = `
      <tr><td class="total-cell" tabindex="0">53,99 €</td></tr>
    `;
    isolatedWindow.document.querySelector('.total-cell').click();

    expect(isolatedWindow.document.getElementById('toastText').textContent).toContain('desglose no terminó');
  });

  it('deshabilita el simulador si falta bv-ui.js', () => {
    const isolatedWindow = isolatedPage(`
      <div id="toast"><span id="toastDot"></span><span id="toastText"></span></div>
      <div id="bv-status-container" style="display:none"><span id="bv-status"></span></div>
      <button id="bv-simulate">Comparar</button>
      <button id="upload-csv-btn">Subir</button>
      <input id="bv-file" type="file">
    `);

    failScript(isolatedWindow, '/js/bv/bv-ui.js?v=build');
    finishDom(isolatedWindow);

    for (const id of ['bv-simulate', 'upload-csv-btn', 'bv-file']) {
      expect(isolatedWindow.document.getElementById(id).disabled).toBe(true);
    }
    expect(isolatedWindow.document.getElementById('bv-status').textContent).toContain('no terminó');
  });

  it('retira todos los Cargando y bloquea controles si falta pvpc-stats-ui.js', () => {
    const isolatedWindow = isolatedPage(`
      <span id="kpiLastSub">Cargando…</span>
      <span id="kpiAvg7Sub">Cargando…</span>
      <span id="kpiAvg30Sub">Cargando…</span>
      <span id="kpiAvg12mSub">Cargando…</span>
      <span id="kpiYoYSub">A mismas fechas</span>
      <span id="trendMeta">Cargando…</span>
      <span id="hourlyMeta">Cargando…</span>
      <span id="hourlyCallout">Consejo: Cargando…</span>
      <select id="typeSelector"><option>PVPC</option></select>
      <button id="csvExcedentesBtn">Subir</button>
    `);

    failScript(isolatedWindow, '/js/pvpc-stats-ui.js?v=build');
    finishDom(isolatedWindow);

    expect(isolatedWindow.document.body.textContent).not.toContain('Cargando');
    expect(isolatedWindow.document.getElementById('kpiYoYSub').textContent).toBe('No disponible');
    expect(isolatedWindow.document.getElementById('typeSelector').disabled).toBe(true);
    expect(isolatedWindow.document.getElementById('csvExcedentesBtn').disabled).toBe(true);
  });
});
