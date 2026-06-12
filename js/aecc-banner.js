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
    copied: 'aecc-banner-copiado',
    closed: 'aecc-banner-cerrado',
    copyFailed: 'aecc-banner-copia-fallida'
  };

  var pageOrigin = '';
  var banner = null;
  var copyButton = null;
  var statusEl = null;
  var showTimer = 0;
  var shownThisSession = false;
  var retryCount = 0;
  var requestedAt = 0;
  var copiedThisSession = false;
  var copyHideTimer = 0;

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

  function hasVisibleResults(detail) {
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

  // Apartar el banner cuando el usuario vuelve al formulario (el boton Calcular
  // entra en pantalla) y re-mostrarlo al bajar de nuevo a los resultados.
  // No cuenta como cierre ni re-emite el evento "mostrado".
  var formObserver = null;

  function startFormWatch() {
    if (typeof IntersectionObserver !== 'function' || formObserver) return;
    var formSentinel = document.getElementById('btnCalc');
    if (!formSentinel) return;

    formObserver = new IntersectionObserver(function (entries) {
      if (isDismissedRecently()) {
        stopFormWatch();
        return;
      }
      var entry = entries[0];
      if (entry && entry.isIntersecting) {
        hideBanner();
      } else {
        revealBanner();
      }
    });
    formObserver.observe(formSentinel);
  }

  function stopFormWatch() {
    if (formObserver) {
      try { formObserver.disconnect(); } catch (_) {}
      formObserver = null;
    }
  }

  function dismissBanner() {
    safeSet(DISMISSED_KEY, String(Date.now()));
    stopFormWatch();
    hideBanner();
    if (!copiedThisSession) track(EVENTS.closed);
  }

  function setCopyFeedback(ok) {
    if (!copyButton || !statusEl) return;
    if (ok) {
      copyButton.textContent = 'Copiado';
      statusEl.textContent = 'Código Bizum copiado.';
      setTimeout(function () {
        if (copyButton) copyButton.textContent = 'Copiar código';
      }, 1800);
      return;
    }

    statusEl.textContent = 'No se pudo copiar. Selecciona el código 11244.';
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    textarea.remove();
    return ok;
  }

  async function copyDonationCode() {
    var copied = false;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(DONATION_CODE);
        copied = true;
      }
    } catch (_) {
      copied = false;
    }

    if (!copied) copied = fallbackCopy(DONATION_CODE);

    setCopyFeedback(copied);
    if (copied) {
      if (!copiedThisSession) {
        copiedThisSession = true;
        safeSet(DISMISSED_KEY, String(Date.now()));
        track(EVENTS.copied);
      }
      if (copyHideTimer) clearTimeout(copyHideTimer);
      copyHideTimer = setTimeout(function () {
        stopFormWatch();
        hideBanner();
      }, 2200);
    } else {
      track(EVENTS.copyFailed);
    }
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
        '<span class="aecc-banner__code" title="Código de donación Bizum">11244</span>',
        '<button class="aecc-banner__cta" type="button">Copiar código</button>',
      '</div>',
      '<p class="aecc-banner__steps">En tu app bancaria: Bizum → Donar a ONG</p>',
      '<span class="aecc-banner__status" role="status" aria-live="polite" aria-atomic="true"></span>'
    ].join('');

    document.body.appendChild(node);
    return node;
  }

  function bindBanner() {
    banner = buildBanner();
    copyButton = banner.querySelector('.aecc-banner__cta');
    statusEl = banner.querySelector('.aecc-banner__status');

    var closeButton = banner.querySelector('.aecc-banner__close');
    if (copyButton) copyButton.addEventListener('click', copyDonationCode);
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
