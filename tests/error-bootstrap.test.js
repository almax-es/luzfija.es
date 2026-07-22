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
    expect(window.__LF_EARLY_ERRORS).toHaveLength(0);
    expect(window.__LF_TRACKING_ERROR_READY).toBe(true);
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
