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
  const bootstrapBuild = (() => {
    try {
      const source = document.currentScript && document.currentScript.src;
      const value = source ? new URL(source, location.href).searchParams.get('v') : '';
      return /^\d{8}-\d{6}$/.test(value || '') ? value : 'desconocido';
    } catch (_) {
      return 'desconocido';
    }
  })();

  function recoverySegment(value, fallback, maxLength) {
    return String(value || fallback || '').toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, maxLength) || fallback;
  }

  function requestInitRecovery(detail, buildLike, phaseLike) {
    const parts = Array.isArray(detail) ? detail : [detail];
    const build = /^\d{8}-\d{6}$/.test(String(buildLike || '')) ? String(buildLike) : bootstrapBuild;
    const entry = {
      app: recoverySegment(parts[0], 'pagina', 16),
      dependency: recoverySegment(parts[parts.length - 1], 'dependencia', 24),
      build,
      phase: phaseLike === 'initial' ? 'initial' : 'runtime'
    };
    const pending = Array.isArray(window.__LF_PENDING_INIT_RECOVERY)
      ? window.__LF_PENDING_INIT_RECOVERY
      : [];
    const duplicate = pending.some((item) => item &&
      item.app === entry.app && item.dependency === entry.dependency &&
      item.build === entry.build && item.phase === entry.phase);
    if (!duplicate) pending.push(entry);
    window.__LF_PENDING_INIT_RECOVERY = pending.slice(-8);
    try {
      window.dispatchEvent(new CustomEvent('lf:init-incomplete', { detail: entry }));
    } catch (_) {}
  }

  window.__LF_requestInitRecovery = requestInitRecovery;

  function isOptionalOrSelfRecoveringScript(source) {
    // Observabilidad y UI no esencial no justifican recargar toda la aplicación.
    // index-extra.js y aecc-banner.js son complementos de UI: su fallo se registra,
    // pero la calculadora sigue plenamente operativa y no debe entrar en
    // recuperación de arranque ni consumir el único auto-reload de la pestaña.
    if (source === '/js/tracking.js' ||
        source === '/js/index-extra.js' ||
        source === '/vendor/goatcounter/count.js' ||
        source === '/js/aecc-banner.js') return true;
    return source.startsWith('/vendor/pdfjs/') ||
      source.startsWith('/vendor/xlsx/') ||
      source.startsWith('/vendor/tesseract/') ||
      source.startsWith('/vendor/tesseract-core/') ||
      source.startsWith('/vendor/jsqr/');
  }

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

  function applyThemeFallback() {
    const key = 'almax_theme';
    let saved = null;
    try {
      saved = localStorage.getItem(key);
    } catch (_) {}
    document.documentElement.classList.toggle('light-mode', saved === 'light');
    window.__ALMAX_THEME_SAVED = saved;
    window.__ALMAX_THEME_KEY = key;
  }

  function trackFallback(detail, title) {
    requestInitRecovery(detail);
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
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
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
      const tag = target && target !== window && target !== document
        ? String(target.tagName || '').toUpperCase()
        : '';
      const isScript = tag === 'SCRIPT';
      let resourceKind = isScript ? 'script' : '';
      let resourceSource = '';
      if (isScript || tag === 'IMG' || tag === 'SOURCE' || tag === 'VIDEO' || tag === 'AUDIO') {
        if (!resourceKind) resourceKind = tag === 'IMG' ? 'image' : 'media';
        resourceSource = sameOriginSource(
          (target.getAttribute && target.getAttribute('src')) || target.currentSrc || target.src || ''
        );
      } else if (tag === 'LINK') {
        const rel = String((target.getAttribute && target.getAttribute('rel')) || target.rel || '').toLowerCase();
        if (rel === 'stylesheet') resourceKind = 'style';
        else if (rel === 'preload' || rel === 'modulepreload') resourceKind = 'preload';
        resourceSource = sameOriginSource(
          (target.getAttribute && target.getAttribute('href')) || target.href || ''
        );
      }
      const isResource = !!(resourceKind && resourceSource);
      const source = isResource ? resourceSource : sameOriginSource(event && event.filename);
      if (!source) return;

      const line = Number(event && event.lineno) > 0
        ? Math.floor(Number(event.lineno))
        : 0;
      const col = Number(event && event.colno) > 0
        ? Math.floor(Number(event.colno))
        : 0;
      // GitHub Pages conserva el DOCTYPE en la linea 1. Un error de codigo
      // atribuido a esa linea del documento procede de una inyeccion del
      // cliente, no de un script first-party. Los scripts externos minificados
      // si pueden fallar legitimamente en su propia linea 1 y no se filtran.
      if (!isResource && source === location.pathname && line <= 1) return;

      if (isScript) {
        failedScripts.add(source);
        // Tracking/GoatCounter son observabilidad opcional: su fallo nunca debe
        // recargar la aplicación. Los vendors lazy (PDF, XLSX, OCR, QR) y los
        // scripts dinámicos posteriores conservan su diagnóstico, pero su propio
        // cargador decide el reintento sin recargar toda la app.
        const recoveryPhase = document.readyState === 'complete' ? 'runtime' : 'initial';
        if (!isOptionalOrSelfRecoveringScript(source) && recoveryPhase === 'initial') {
          requestInitRecovery(
            ['resource', source.split('/').pop() || 'script'],
            null,
            recoveryPhase
          );
        }
        // theme.js corre antes del CSS. Si su descarga falla, aplicar aquí la
        // parte visual mínima mientras el parser sigue bloqueado conserva el
        // tema guardado y evita que el fallo transitorio afecte al primer pintado.
        if (source === '/js/theme.js' || source.endsWith('/js/theme.js')) {
          applyThemeFallback();
        }
        // Los scripts estáticos suelen fallar antes de DOMContentLoaded, pero
        // este mismo watchdog también cubre una carga tardía/dinámica.
        if (document.readyState !== 'loading') applyFailedScriptFallbacks();
      }

      push({
        kind: isResource ? resourceKind + '-load' : 'javascript',
        source,
        line,
        col
      });
    } catch (_) {}
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFailedScriptFallbacks);
  } else {
    applyFailedScriptFallbacks();
  }
})();
