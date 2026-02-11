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

  function trackCompatNotice(title) {
    try {
      if (typeof window.__LF_track === 'function') {
        window.__LF_track('error-javascript', { title: title });
      }
    } catch (_) {}
  }

  try {
    if (window.__LF_indexExtraLoading || window.__LF_indexExtraLoaded) return;
    window.__LF_indexExtraLoading = true;

    var s = document.createElement('script');
    s.src = 'js/index-extra.js' + (buildId ? ('?v=' + encodeURIComponent(buildId)) : '');
    s.async = false;
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
