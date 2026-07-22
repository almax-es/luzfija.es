/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Buffer mínimo para errores first-party que ocurran antes de que tracking.js
// termine de cargarse. No envía nada, no persiste nada y no guarda mensajes ni
// datos del usuario: tracking.js consume estas entradas y aplica opt-out/saneo.
(function () {
  'use strict';

  if (window.__LF_EARLY_ERROR_BOOTSTRAP === true) return;
  window.__LF_EARLY_ERROR_BOOTSTRAP = true;

  const MAX_EARLY_ERRORS = 12;
  const queue = window.__LF_EARLY_ERRORS = Array.isArray(window.__LF_EARLY_ERRORS)
    ? window.__LF_EARLY_ERRORS
    : [];

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

      push({
        kind: isScript ? 'script-load' : 'javascript',
        source,
        line: Number(event && event.lineno) > 0 ? Math.floor(Number(event.lineno)) : 0,
        col: Number(event && event.colno) > 0 ? Math.floor(Number(event.colno)) : 0
      });
    } catch (_) {}
  }, true);
})();
