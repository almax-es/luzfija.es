(function () {
  'use strict';

  function getBuildId() {
    try {
      if (typeof window.__LF_BUILD_ID === 'string' && window.__LF_BUILD_ID.trim()) {
        return window.__LF_BUILD_ID.trim();
      }
      var cs = document.currentScript && document.currentScript.src ? String(document.currentScript.src) : '';
      if (cs) {
        var u = new URL(cs, location.href);
        var v = u.searchParams.get('v');
        if (v) return v;
      }
    } catch (_) {}
    return '';
  }

  var buildId = getBuildId();

  function supportsIndexExtraSyntax() {
    try {
      // Verifica sintaxis usada en index-extra.js:
      // optional chaining + optional indexing + nullish coalescing.
      // Si falla aquí, evitamos cargar el script para no romper la página.
      // eslint-disable-next-line no-new-func
      new Function('const x={a:{b:[1]}};return (x?.a?.b?.[0] ?? 0)===1;');
      return true;
    } catch (_) {
      return false;
    }
  }

  function trackCompatNotice(title) {
    try {
      if (typeof window.__LF_track === 'function') {
        window.__LF_track('error-javascript', { title: title });
      }
    } catch (_) {}
  }

  if (!supportsIndexExtraSyntax()) {
    trackCompatNotice('Compat: index-extra omitido (sin soporte ES2020)');
    return;
  }

  try {
    if (window.__LF_indexExtraLoading || window.__LF_indexExtraLoaded) return;
    window.__LF_indexExtraLoading = true;

    var s = document.createElement('script');
    s.src = 'js/index-extra.js' + (buildId ? ('?v=' + encodeURIComponent(buildId)) : '');
    s.async = true;
    s.defer = true;
    s.onload = function () {
      window.__LF_indexExtraLoaded = true;
      window.__LF_indexExtraLoading = false;
    };
    s.onerror = function () {
      window.__LF_indexExtraLoading = false;
      trackCompatNotice('Error cargando index-extra.js');
    };
    document.head.appendChild(s);
  } catch (_) {
    window.__LF_indexExtraLoading = false;
    trackCompatNotice('Error inicializando loader de index-extra');
  }
})();
