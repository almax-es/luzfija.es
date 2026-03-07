// Compat shim for stale HTML/SW clients that still request index-extra-loader.js.
// Current pages load index-extra.js directly; this file exists only to keep
// legacy clients from emitting the old "Compat: index-extra omitido" noise.
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

  function hasIndexExtraScript() {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute('src') || scripts[i].src || '';
        if (!src) continue;

        try {
          if (new URL(src, location.href).pathname === '/js/index-extra.js') return true;
        } catch (_) {}

        if (String(src).indexOf('js/index-extra.js') !== -1) return true;
      }
    } catch (_) {}
    return false;
  }

  try {
    if (window.__LF_indexExtraLoading || window.__LF_indexExtraLoaded || hasIndexExtraScript()) return;
    window.__LF_indexExtraLoading = true;

    var buildId = getBuildId();
    var s = document.createElement('script');
    s.src = 'js/index-extra.js' + (buildId ? ('?v=' + encodeURIComponent(buildId)) : '');
    s.async = false;
    s.defer = true;
    s.onload = function () {
      window.__LF_indexExtraLoaded = true;
      window.__LF_indexExtraLoading = false;
    };
    s.onerror = function () {
      window.__LF_indexExtraLoading = false;
    };
    document.head.appendChild(s);
  } catch (_) {
    try { window.__LF_indexExtraLoading = false; } catch (_) {}
  }
})();
