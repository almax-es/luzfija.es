// Sistema de tema claro/oscuro (carga antes del render para evitar flash)
(function(){
  const key = 'almax_theme';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
    window.__ALMAX_THEME_SAVED = saved;
  } catch(e) {
    // localStorage no disponible (modo privado, etc.)
  }
  window.__ALMAX_THEME_KEY = key;

  // Guard global defensivo redundante (el principal está en config.js)
  // Se mantiene por si theme.js se ejecuta antes que config.js en algún contexto
  try {
    if (typeof window.currentYear !== 'number') {
      window.currentYear = new Date().getFullYear();
    }
  } catch (_) {}

  function normalizeErrorText(value) {
    const text = (value === null || value === undefined) ? '' : String(value);
    const lower = text.toLowerCase();
    try {
      return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {
      return lower;
    }
  }

  function extractErrorMessage(reason) {
    if (!reason) return '';
    if (reason instanceof Error) return String(reason.message || reason.name || '');
    if (typeof reason === 'object' && typeof reason.message === 'string') {
      return reason.message;
    }
    return String(reason);
  }

  function shouldSilenceLegacyCurrentYearError(reason) {
    const msg = normalizeErrorText(extractErrorMessage(reason));
    if (!msg || msg.indexOf('currentyear') === -1) return false;
    if (msg.indexOf('not defined') !== -1) return true;
    if (msg.indexOf('no esta definid') !== -1) return true;
    return false;
  }

  // Bloquea ruido de clientes con JS viejo antes de que lo capture tracking.js legado.
  if (window.__LF_LEGACY_CURRENTYEAR_FILTER !== true) {
    window.__LF_LEGACY_CURRENTYEAR_FILTER = true;
    window.addEventListener('unhandledrejection', function(e) {
      try {
        if (!shouldSilenceLegacyCurrentYearError(e && e.reason)) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      } catch (_) {}
    }, true);
  }

  // Cargar INP debug solo en modo debug (sin ensuciar producción)
  try {
    const params = new URLSearchParams(location.search);
    const debug = params.get('debug') === '1' ||
      localStorage.getItem('lf_debug') === '1' ||
      window.__LF_DEBUG === true;
    if (debug) {
      window.__LF_DEBUG = true;
      const loadDebug = () => {
        if (window.__LF_INP_DEBUG_ACTIVE) return;
        if (document.querySelector('script[data-lf-inp-debug]')) return;
        const s = document.createElement('script');
        s.src = '/js/inp-debug.js';
        s.defer = true;
        s.dataset.lfInpDebug = '1';
        document.head.appendChild(s);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDebug, { once: true });
      } else {
        loadDebug();
      }
    }
  } catch (_) {}
})();
