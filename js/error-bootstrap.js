/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Buffer mínimo para errores first-party que ocurran antes de que tracking.js
// termine de cargarse. No envía nada, no persiste nada y no guarda mensajes ni
// datos del usuario: tracking.js consume estas entradas y aplica opt-out/saneo.
// También actúa como watchdog de último recurso para los coordinadores de las
// tres aplicaciones. Un módulo no puede mostrar su propio guard si el fichero
// entero no llegó a ejecutarse; este bootstrap, cargado primero en <head>, sí
// puede dejar los controles en un estado visible y accionable.
(function () {
  'use strict';

  if (window.__LF_EARLY_ERROR_BOOTSTRAP === true) return;
  window.__LF_EARLY_ERROR_BOOTSTRAP = true;

  const MAX_EARLY_ERRORS = 12;
  const queue = window.__LF_EARLY_ERRORS = Array.isArray(window.__LF_EARLY_ERRORS)
    ? window.__LF_EARLY_ERRORS
    : [];
  const failedScripts = new Set();

  function hasFailedScript(suffix) {
    for (const source of failedScripts) {
      if (source === suffix || source.endsWith(suffix)) return true;
    }
    return false;
  }

  function disableControl(id, title) {
    const control = document.getElementById(id);
    if (!control) return;
    control.disabled = true;
    control.setAttribute('aria-disabled', 'true');
    if (title) control.title = title;
  }

  function showFallbackToast(message) {
    const box = document.getElementById('toast');
    const text = document.getElementById('toastText');
    const dot = document.getElementById('toastDot');
    if (!box || !text) return;
    text.textContent = message;
    if (dot) {
      dot.classList.remove('ok');
      dot.classList.add('err');
    }
    box.classList.add('show');
  }

  function trackFallback(detail, title) {
    try {
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail('init-incompleto', detail, { title });
      }
    } catch (_) {}
  }

  function bindUnavailableClick(control, message, detail, title) {
    if (!control || control.dataset.lfBootstrapUnavailableBound === '1') return;
    control.dataset.lfBootstrapUnavailableBound = '1';
    control.addEventListener('click', function () {
      showFallbackToast(message);
      trackFallback(detail, title);
    });
  }

  function applyHomeCoordinatorFallback() {
    const message = 'La calculadora no terminó de cargarse. Recarga la página.';
    disableControl('btnCalc', message);
    disableControl('btnSubirFactura', message);
    const status = document.getElementById('statusText');
    if (status) status.textContent = message;
    showFallbackToast(message);
  }

  function applyFacturaFallback() {
    const button = document.getElementById('btnSubirFactura');
    const message = 'La lectura de facturas no terminó de cargarse. Recarga la página para volver a intentarlo.';
    bindUnavailableClick(
      button,
      message,
      ['home', 'factura-module'],
      'Botón de factura sin factura.js disponible'
    );
  }

  function applyDesgloseIntegrationFallback() {
    const tbody = document.getElementById('tbody');
    if (!tbody || tbody.dataset.lfBootstrapDesgloseBound === '1') return;
    tbody.dataset.lfBootstrapDesgloseBound = '1';
    const message = 'El desglose no terminó de cargarse. Recarga la página para intentarlo de nuevo.';

    function unavailableCell(target) {
      if (!(target instanceof Element)) return null;
      if (target.closest('a, button, input, select, textarea, .tooltip, .tooltip-icon')) return null;
      return target.closest('td.total-cell, td.tarifa-cell');
    }

    tbody.addEventListener('click', function (event) {
      if (!unavailableCell(event.target)) return;
      showFallbackToast(message);
      trackFallback(
        ['home', 'desglose-integration'],
        'Desglose solicitado sin desglose-integration disponible'
      );
    });
    tbody.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!unavailableCell(event.target)) return;
      event.preventDefault();
      showFallbackToast(message);
      trackFallback(
        ['home', 'desglose-integration'],
        'Desglose solicitado sin desglose-integration disponible'
      );
    });
  }

  function applySolarCoordinatorFallback() {
    const message = 'La página no terminó de cargarse. Recárgala para usar el simulador.';
    for (const id of ['bv-simulate', 'upload-csv-btn', 'bv-file']) {
      disableControl(id, message);
    }
    const statusContainer = document.getElementById('bv-status-container');
    const status = document.getElementById('bv-status');
    if (statusContainer) statusContainer.style.display = 'block';
    if (status) status.textContent = message;
    showFallbackToast(message);
  }

  function applyStatsCoordinatorFallback() {
    const message = 'La página no terminó de cargarse. Recárgala para abrir el observatorio.';
    for (const id of ['kpiLastSub', 'trendMeta', 'hourlyMeta', 'hourlyCallout']) {
      const node = document.getElementById(id);
      if (node) node.textContent = message;
    }
    for (const id of ['kpiAvg7Sub', 'kpiAvg30Sub', 'kpiAvg12mSub', 'kpiYoYSub']) {
      const node = document.getElementById(id);
      if (node) node.textContent = 'No disponible';
    }
    for (const id of [
      'typeSelector', 'geoSelector', 'yearSelector', 'monthSelector',
      'csvExcedentesBtn', 'csvExcedentesInput', 'trendModeMonthly', 'trendModeDaily'
    ]) {
      disableControl(id, message);
    }
  }

  function applyFailedScriptFallbacks() {
    if (hasFailedScript('/js/lf-app.js')) applyHomeCoordinatorFallback();
    else {
      if (hasFailedScript('/js/factura.js')) applyFacturaFallback();
      if (hasFailedScript('/js/desglose-integration.js')) applyDesgloseIntegrationFallback();
    }
    if (hasFailedScript('/js/bv/bv-ui.js')) applySolarCoordinatorFallback();
    if (hasFailedScript('/js/pvpc-stats-ui.js')) applyStatsCoordinatorFallback();
  }

  function sameOriginSource(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
      const url = new URL(raw, location.href);
      return url.origin === location.origin ? url.pathname : '';
    } catch (_) {
      return '';
    }
  }

  function push(entry) {
    if (window.__LF_TRACKING_ERROR_READY === true) return;
    if (queue.length >= MAX_EARLY_ERRORS) queue.shift();
    queue.push(entry);
  }

  window.addEventListener('error', function (event) {
    try {
      const target = event && event.target;
      const isScript = target && target !== window && target !== document &&
        String(target.tagName || '').toUpperCase() === 'SCRIPT';
      const source = isScript
        ? sameOriginSource((target.getAttribute && target.getAttribute('src')) || target.src || '')
        : sameOriginSource(event && event.filename);
      if (!source) return;

      if (isScript) {
        failedScripts.add(source);
        // Los scripts estáticos suelen fallar antes de DOMContentLoaded, pero
        // este mismo watchdog también cubre una carga tardía/dinámica.
        if (document.readyState !== 'loading') applyFailedScriptFallbacks();
      }

      push({
        kind: isScript ? 'script-load' : 'javascript',
        source,
        line: Number(event && event.lineno) > 0 ? Math.floor(Number(event.lineno)) : 0,
        col: Number(event && event.colno) > 0 ? Math.floor(Number(event.colno)) : 0
      });
    } catch (_) {}
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFailedScriptFallbacks);
  } else {
    applyFailedScriptFallbacks();
  }
})();
