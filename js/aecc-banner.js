/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Banner de donacion directa a AECC por Bizum.
// No carga recursos externos y no guarda informacion personal.
(function () {
  'use strict';

  var DONATION_CODE = '11244';
  var DISMISSED_KEY = 'lf_aecc_banner_dismissed_at';
  var COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  var SHOW_DELAY_MS = 2800;
  var RETRY_DELAY_MS = 900;
  var MAX_RETRIES = 8;
  var REQUEST_WINDOW_MS = 2 * 60 * 1000;
  var EVENTS = {
    shown: 'aecc-banner-mostrado',
    closed: 'aecc-banner-cerrado'
  };

  var pageOrigin = '';
  var banner = null;
  var showTimer = 0;
  var shownThisSession = false;
  var retryCount = 0;
  var requestedAt = 0;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function detectPageOrigin() {
    if (document.getElementById('btnCalc')) return 'home';
    return '';
  }

  // Solo escritorio: en moviles/tablets el banner tapa los resultados.
  function isDesktopViewport() {
    try {
      if (typeof window.matchMedia !== 'function') return false;
      return window.matchMedia('(min-width: 1024px)').matches;
    } catch (_) {
      return false;
    }
  }

  function isDismissedRecently() {
    var raw = safeGet(DISMISSED_KEY);
    var ts = raw ? Number(raw) : 0;
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return Date.now() - ts < COOLDOWN_MS;
  }

  function track(eventName) {
    try {
      if (typeof window.__LF_track === 'function') {
        window.__LF_track(eventName, { title: 'origen:' + pageOrigin });
      }
    } catch (_) {}
  }

  function hasVisibleResults() {
    var tbody = document.getElementById('tbody');
    var section = document.getElementById('seccionResultados');
    var sectionVisible = !section || section.classList.contains('visible');
    return Boolean(sectionVisible && tbody && tbody.querySelector('tr'));
  }

  function isBlockingUiVisible() {
    var modal = document.querySelector('.modal-overlay:not(.is-hidden)[aria-hidden="false"]');
    if (modal) return true;

    var scrollButton = document.getElementById('scrollToResults');
    if (!scrollButton) return false;
    try {
      var styles = window.getComputedStyle(scrollButton);
      return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
    } catch (_) {
      return scrollButton.style.display && scrollButton.style.display !== 'none';
    }
  }

  function canShowNow(detail) {
    if (!banner || shownThisSession || isDismissedRecently()) return false;
    if (!isDesktopViewport()) return false;
    if (Date.now() - requestedAt > REQUEST_WINDOW_MS) return false;
    if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) return false;
    if (!hasVisibleResults(detail)) return false;
    if (shouldKeepBannerHidden()) return false;
    return !isBlockingUiVisible();
  }

  function scheduleShow(detail) {
    if (shownThisSession || isDismissedRecently()) return;
    if (showTimer) clearTimeout(showTimer);

    showTimer = setTimeout(function tryShow() {
      showTimer = 0;
      if (canShowNow(detail)) {
        showBanner();
        return;
      }

      if (!shownThisSession && !isDismissedRecently() && retryCount < MAX_RETRIES) {
        retryCount += 1;
        showTimer = setTimeout(tryShow, RETRY_DELAY_MS);
      }
    }, SHOW_DELAY_MS);
  }

  function revealBanner() {
    if (!banner) return;
    banner.classList.add('aecc-banner--visible');
    banner.setAttribute('aria-hidden', 'false');
    banner.removeAttribute('inert');
  }

  function showBanner() {
    if (!banner || shownThisSession) return;
    shownThisSession = true;
    revealBanner();
    track(EVENTS.shown);
    startFormWatch();
  }

  function hideBanner() {
    if (!banner) return;
    banner.classList.remove('aecc-banner--visible');
    banner.setAttribute('aria-hidden', 'true');
    banner.setAttribute('inert', '');
  }

  // Apartar el banner cuando el usuario no esta mirando los resultados:
  // se esconde si el formulario (boton Calcular) esta en pantalla, si algun
  // campo numerico cae bajo la zona del banner, O si los resultados no lo
  // estan (p. ej. arriba del todo, en el encabezado).
  // No cuenta como cierre ni re-emite el evento "mostrado".
  var formObserver = null;
  var formInView = false;
  var resultsInView = true;
  var visibilityWatchBound = false;
  var visibilityWatchTicking = false;

  function getViewportSize() {
    var doc = document.documentElement || {};
    return {
      width: window.innerWidth || doc.clientWidth || 0,
      height: window.innerHeight || doc.clientHeight || 0
    };
  }

  function rectIntersects(a, b) {
    return Boolean(a && b &&
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top);
  }

  function getBannerFootprint() {
    var viewport = getViewportSize();
    if (!viewport.width || !viewport.height) return null;

    var width = 372;
    var height = 260;
    try {
      if (banner) {
        var styles = window.getComputedStyle(banner);
        var parsedWidth = parseFloat(styles.width);
        var parsedHeight = parseFloat(styles.height);
        if (Number.isFinite(parsedWidth) && parsedWidth > 0) width = parsedWidth;
        if (Number.isFinite(parsedHeight) && parsedHeight > 0) height = parsedHeight;
      }
    } catch (_) {}

    width = Math.min(width, Math.max(0, viewport.width - 24));
    return {
      left: 20,
      right: 20 + width,
      top: Math.max(0, viewport.height - 24 - height),
      bottom: viewport.height
    };
  }

  function isProtectedInputInBannerZone() {
    var footprint = getBannerFootprint();
    if (!footprint) return false;

    // miTarifaForm es el panel completo de "Mi tarifa": oculto mide 0x0 y se salta solo
    var ids = ['p1', 'p2', 'dias', 'cPunta', 'cLlano', 'cValle', 'exTotal', 'bvSaldo', 'miTarifaForm'];
    for (var i = 0; i < ids.length; i++) {
      var input = document.getElementById(ids[i]);
      if (!input || typeof input.getBoundingClientRect !== 'function') continue;
      var rect = input.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (rectIntersects(rect, footprint)) return true;
    }
    return false;
  }

  function shouldKeepBannerHidden() {
    return Boolean(formInView || !resultsInView || isProtectedInputInBannerZone());
  }

  function updateBannerVisibility() {
    if (!banner || !shownThisSession || isDismissedRecently()) return;
    if (shouldKeepBannerHidden()) {
      hideBanner();
    } else {
      revealBanner();
    }
  }

  function requestBannerVisibilityUpdate() {
    if (visibilityWatchTicking) return;
    visibilityWatchTicking = true;
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
    raf(function () {
      visibilityWatchTicking = false;
      updateBannerVisibility();
    });
  }

  function bindVisibilityWatch() {
    if (visibilityWatchBound) return;
    visibilityWatchBound = true;
    window.addEventListener('scroll', requestBannerVisibilityUpdate, { passive: true });
    window.addEventListener('resize', requestBannerVisibilityUpdate);
    // Paneles que se despliegan sin scroll (p. ej. "Mi tarifa"): reevaluar al vuelo
    document.addEventListener('change', requestBannerVisibilityUpdate, true);
  }

  function unbindVisibilityWatch() {
    if (!visibilityWatchBound) return;
    visibilityWatchBound = false;
    window.removeEventListener('scroll', requestBannerVisibilityUpdate);
    window.removeEventListener('resize', requestBannerVisibilityUpdate);
    document.removeEventListener('change', requestBannerVisibilityUpdate, true);
  }

  function startFormWatch() {
    bindVisibilityWatch();
    if (typeof IntersectionObserver !== 'function' || formObserver) {
      updateBannerVisibility();
      return;
    }
    var formSentinel = document.getElementById('btnCalc');
    var resultsSentinel = document.getElementById('seccionResultados') || document.getElementById('tbody');
    if (!formSentinel) {
      updateBannerVisibility();
      return;
    }

    formObserver = new IntersectionObserver(function (entries) {
      if (isDismissedRecently()) {
        stopFormWatch();
        return;
      }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.target === formSentinel) formInView = entry.isIntersecting;
        else if (entry.target === resultsSentinel) resultsInView = entry.isIntersecting;
      }
      updateBannerVisibility();
    });
    formObserver.observe(formSentinel);
    if (resultsSentinel) formObserver.observe(resultsSentinel);
    updateBannerVisibility();
  }

  function stopFormWatch() {
    unbindVisibilityWatch();
    if (formObserver) {
      try { formObserver.disconnect(); } catch (_) {}
      formObserver = null;
    }
  }

  function dismissBanner() {
    safeSet(DISMISSED_KEY, String(Date.now()));
    stopFormWatch();
    hideBanner();
    track(EVENTS.closed);
  }

  function buildBanner() {
    var existing = document.getElementById('aecc-banner');
    if (existing) return existing;

    var node = document.createElement('aside');
    node.id = 'aecc-banner';
    node.setAttribute('role', 'complementary');
    node.setAttribute('aria-label', 'Donación directa a la AECC');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('inert', '');
    node.innerHTML = [
      '<button class="aecc-banner__close" type="button" aria-label="Cerrar banner de donación">✕</button>',
      '<span class="aecc-banner__logo-chip"><img class="aecc-banner__logo" src="/img/aecc-logo.svg" alt="AECC — Asociación Española Contra el Cáncer" width="140" height="44"></span>',
      '<p class="aecc-banner__title">¿Te ha sido útil LuzFija?</p>',
      '<p class="aecc-banner__desc">Dona contra el cáncer por Bizum, directamente a la AECC. LuzFija.es no recibe dinero, comisión ni datos de la donación.</p>',
      '<div class="aecc-banner__action">',
        '<span class="aecc-banner__code" title="Código de donación Bizum">' + DONATION_CODE + '</span>',
      '</div>',
      '<p class="aecc-banner__steps">En tu app bancaria: Bizum → Donar a ONG → escribe este código</p>'
    ].join('');

    document.body.appendChild(node);
    return node;
  }

  function bindBanner() {
    banner = buildBanner();
    var closeButton = banner.querySelector('.aecc-banner__close');
    if (closeButton) closeButton.addEventListener('click', dismissBanner);
  }

  function onResultsReady(event) {
    var detail = event && event.detail ? event.detail : {};
    if (detail.origin !== pageOrigin) return;
    if (Date.now() - requestedAt > REQUEST_WINDOW_MS) return;
    retryCount = 0;
    scheduleShow(detail);
  }

  function onResultsRequested(event) {
    var detail = event && event.detail ? event.detail : {};
    if (detail.origin !== pageOrigin) return;
    requestedAt = Date.now();
  }

  function init() {
    pageOrigin = detectPageOrigin();
    if (!pageOrigin) return;
    if (isDismissedRecently()) return;
    if (!isDesktopViewport()) return;

    bindBanner();
    document.addEventListener('lf:results-requested', onResultsRequested);
    document.addEventListener('lf:results-ready', onResultsReady);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
