/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== TRACKING CON GOATCOUNTER (sin cookies, sin tracking personal) =====
// Este archivo registra eventos importantes para entender cómo usan la web los usuarios.
// Importante: el tracking nunca debe romper la web si falla el contador.

// Guard global defensivo redundante (el principal está en config.js).
// Debe vivir en el scope global para crear también el binding desnudo `currentYear`
// si tracking.js llega a ejecutarse desde HTML legacy sin config.js previo.
try {
  if (typeof window.currentYear !== 'number') {
    window.currentYear = new Date().getFullYear();
  }
  var currentYear = window.currentYear;
  window.currentYear = currentYear;
} catch (_) {}

(function() {
  'use strict';

  // ===== COMPROBACIÓN OPT-OUT (PRIORIDAD MÁXIMA) =====
  // Si el usuario ha desactivado GoatCounter, salir inmediatamente
  const OPT_OUT_KEY = 'goatcounter_optout';
  try {
    if (localStorage.getItem(OPT_OUT_KEY) === 'true') {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[TRACK] GoatCounter desactivado por el usuario (opt-out activo)');
      }
      return; // Salir sin cargar nada
    }
  } catch(e) {
    // Si localStorage no está disponible (navegación privada extrema), continuar normalmente
  }

  const DEFAULT_GOAT_ENDPOINT = 'https://luzfija.goatcounter.com/count';

  const DEBUG = (function(){
    try{
      const p = new URLSearchParams(location.search);
      return p.get('debug') === '1' || localStorage.getItem('lf_debug') === '1' || window.__LF_DEBUG === true;
    }catch(e){ return window.__LF_DEBUG === true; }
  })();

  function dbg(...args){
    if (DEBUG && typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log('[TRACK]', ...args);
    }
  }

  function getTrackingBuildId() {
    try {
      if (typeof window.__LF_BUILD_ID === 'string' && window.__LF_BUILD_ID.trim()) {
        return window.__LF_BUILD_ID.trim();
      }

      const cs = document.currentScript && document.currentScript.src ? String(document.currentScript.src) : '';
      if (cs) {
        const u = new URL(cs, location.href);
        const v = u.searchParams.get('v');
        if (v) return v;
      }
    } catch (_) {}
    return 'unknown';
  }

  const TRACK_BUILD_ID = getTrackingBuildId();
  const GOAT_SCRIPT_PATH = '/vendor/goatcounter/count.js';
  const GOAT_SCRIPT_SRC = GOAT_SCRIPT_PATH + '?v=' + encodeURIComponent(TRACK_BUILD_ID); // Autoalojado (antes: https://gc.zgo.at/count.js)

  // Cola de eventos mientras GoatCounter termina de cargar
  const queue = [];
  let loadingPromise = null;

  function getGoatEndpointFromPage(){
    const existing = document.querySelector('script[data-goatcounter]');
    const val = existing && existing.getAttribute('data-goatcounter');
    return val || DEFAULT_GOAT_ENDPOINT;
  }

  function toAbsolutePath(urlLike) {
    const raw = String(urlLike || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, location.href).pathname || '';
    } catch (_) {
      return '';
    }
  }

  function findExistingGoatScript() {
    const scripts = document.querySelectorAll('script[src]');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute('src') || scripts[i].src || '';
      if (toAbsolutePath(src) === GOAT_SCRIPT_PATH) return scripts[i];
    }
    return null;
  }

  function isGoatReady(){
    return (typeof window.goatcounter !== 'undefined' && typeof window.goatcounter.count === 'function');
  }

  function configureGoatCounterDefaults() {
    window.goatcounter = window.goatcounter || {};
    if (typeof window.goatcounter.path === 'undefined') {
      window.goatcounter.path = canonicalPageviewPath();
    }
    if (typeof window.goatcounter.title === 'undefined') {
      window.goatcounter.title = safeText(document.title || currentPageKey());
    }
    if (typeof window.goatcounter.referrer === 'undefined') {
      window.goatcounter.referrer = canonicalReferrer();
    }
  }

  function ensureGoatCounterLoaded(){
    configureGoatCounterDefaults();
    if (isGoatReady()) return Promise.resolve(true);
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise((resolve) => {
      try{
        // Si ya existe el script, esperar a que esté listo
        const existingScript = findExistingGoatScript();
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(true), { once: true });
          existingScript.addEventListener('error', () => resolve(false), { once: true });
          // fallback por si load no dispara
          setTimeout(() => resolve(isGoatReady()), 2500);
          return;
        }

        const s = document.createElement('script');
        s.src = GOAT_SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        s.setAttribute('data-goatcounter', getGoatEndpointFromPage());

        s.addEventListener('load', () => resolve(true), { once: true });
        s.addEventListener('error', () => resolve(false), { once: true });

        document.head.appendChild(s);

        // fallback: no bloquear si el script tarda o está bloqueado
        setTimeout(() => resolve(isGoatReady()), 3000);
      }catch(e){
        resolve(false);
      }
    });

    return loadingPromise;
  }

  function flushQueue(){
    if (!isGoatReady()) return;
    while(queue.length){
      const evt = queue.shift();
      try{
        window.goatcounter.count(evt);
      }catch(e){
        // ignorar
      }
    }
  }

  function sendPayload(payload) {
    // Si GoatCounter ya está, enviar al momento
    if (isGoatReady()) {
      try { window.goatcounter.count(payload); } catch (e) {}
      return;
    }

    // Si no está listo, encolar y lanzar carga
    queue.push(payload);
    ensureGoatCounterLoaded().then((ok) => {
      if (ok) flushQueue();
      else queue.length = 0; // si está bloqueado, vaciar y no molestar más
    });
  }

  function getLegacyNoiseKind(msgLike) {
    if (isLegacyIndexExtraCompatNoise(msgLike)) return 'index-extra-compat';
    if (isPromiseStaleNoise(msgLike)) return 'currentyear-stale';
    return '';
  }

  function buildLegacyNoiseTitle(kind, originalEventName, originTag) {
    const route = safeText(location && location.pathname ? location.pathname : '/') || '/';
    const parts = [
      'tipo:' + (kind || 'legacy'),
      'origen:' + (originTag || 'tracking'),
      'evento:' + (originalEventName || 'desconocido'),
      'b:' + TRACK_BUILD_ID
    ];
    parts.push('@' + route);
    return parts.join(' | ').substring(0, 150);
  }

  function trackEvent(eventName, metadata) {
    // 🔒 MODO PRIVACIDAD: Si está activo, no enviar NADA
    if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) {
      dbg('Privacy mode activo, evento bloqueado:', eventName);
      return;
    }

    // Evitar ruido legado del loader antiguo de index-extra (clients con caché vieja).
    const rawTitle = (metadata && metadata.title) ? String(metadata.title) : '';
    const legacyKind = getLegacyNoiseKind(rawTitle);
    if (legacyKind) {
      dbg('Ruido legacy reclasificado:', rawTitle);
    }

    const finalEventName = legacyKind ? 'error-legacy-filtrado' : eventName;
    const finalTitle = legacyKind
      ? buildLegacyNoiseTitle(legacyKind, eventName, 'trackEvent')
      : ((metadata && metadata.title) ? metadata.title : eventName);

    const payload = {
      path: finalEventName,
      title: finalTitle,
      event: true,
    };
    if (!metadata || metadata.noSession !== false) payload.no_session = true;

    sendPayload(payload);
  }

  function trackDetailedEvent(baseName, detail, metadata) {
    const path = buildEventPath(baseName, detail);
    trackEvent(path, metadata || {});
  }

  // Exponer función global para que app.js pueda usarla
  window.__LF_track = trackEvent;
  window.__LF_trackDetail = trackDetailedEvent;
  window.__LF_trackingUtils = {
    buildEventPath,
    eventSegment
  };

  function safeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function eventSegment(value, fallback) {
    const fb = fallback || 'sin-detalle';
    let text = safeText(value);
    if (!text) return fb;

    try {
      text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {}

    text = text
      .toLowerCase()
      .replace(/&/g, ' y ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 90)
      .replace(/-+$/g, '');

    return text || fb;
  }

  function buildEventPath(base, detail) {
    const cleanBase = eventSegment(base, 'evento');
    if (detail === null || detail === undefined || detail === '') return cleanBase;

    const parts = Array.isArray(detail) ? detail : [detail];
    const cleanParts = parts.map((part) => eventSegment(part, '')).filter(Boolean);
    return [cleanBase].concat(cleanParts).join('/').substring(0, 180);
  }

  function canonicalPathFromHref(href) {
    const raw = safeText(href);
    if (!raw) return '';
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin) return '';
      let p = u.pathname || '/';
      if (p.length > 1 && p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p || '/';
    } catch (_) {
      return '';
    }
  }

  function normalizePathOnly(pathLike) {
    let p = safeText(pathLike) || '/';
    if (p.length > 1 && p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
    if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '/');
    return p || '/';
  }

  function canonicalPageviewPath() {
    try {
      const c = document.querySelector('link[rel="canonical"][href]');
      if (c && c.href) {
        const u = new URL(c.href, location.href);
        if (u.origin === location.origin) return normalizePathOnly(u.pathname || '/');
      }
    } catch (_) {}
    return normalizePathOnly(location && location.pathname ? location.pathname : '/');
  }

  function canonicalReferrer() {
    const raw = safeText(document && document.referrer ? document.referrer : '');
    if (!raw) return '';
    try {
      const u = new URL(raw, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      if (u.origin === location.origin) {
        return u.origin + normalizePathOnly(u.pathname || '/');
      }
      return (u.origin && u.origin !== 'null') ? u.origin : '';
    } catch (_) {
      return '';
    }
  }

  function guideSlugFromPath(pathLike) {
    const p = safeText(pathLike);
    const m = p.match(/\/guias\/([^/?#]+)\.html$/i);
    return m ? m[1] : '';
  }

  function currentPageKey() {
    const p = safeText(location && location.pathname ? location.pathname : '/') || '/';
    if (p === '/comparador-tarifas-solares.html') return 'solar';
    if (p === '/estadisticas/' || p === '/estadisticas/index.html') return 'estadisticas';
    if (p === '/guias.html') return 'guias';
    if (/^\/guias\//.test(p)) return 'guia';
    if (p === '/' || p === '/index.html') return 'home';
    if (p === '/calcular-factura-luz.html') return 'calcular-factura';
    if (p === '/comparar-pvpc-tarifa-fija.html') return 'pvpc-vs-fija';
    if (p === '/como-funciona-luzfija.html') return 'como-funciona';
    if (p === '/privacidad.html') return 'privacidad';
    if (p === '/aviso-legal.html') return 'aviso-legal';
    if (p === '/404.html') return '404';
    return eventSegment(p.replace(/^\//, '').replace(/\.html$/, ''), 'pagina');
  }

  function titleFromElement(el) {
    if (!el) return '';
    const aria = el.getAttribute && el.getAttribute('aria-label');
    const title = el.getAttribute && el.getAttribute('title');
    return safeText(aria || title || el.textContent || '');
  }

  function boolState(value) {
    return value ? 'activado' : 'desactivado';
  }

  function tarifaNameFromContext(el) {
    const row = el && el.closest ? el.closest('tr') : null;
    const card = el && el.closest ? el.closest('.bv-winner-card-compact, .bv-alt-card-compact') : null;
    return safeText(
      (row && row.dataset && row.dataset.tarifaNombre) ||
      (row && row.querySelector && row.querySelector('.tarifa-nombre')?.textContent) ||
      (card && card.querySelector && (card.querySelector('.bv-winner-name, .bv-alt-name')?.textContent)) ||
      ''
    );
  }

  function externalTargetFromHref(href) {
    const raw = safeText(href);
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.startsWith('mailto:')) return 'email';
    if (lower.startsWith('tel:')) return 'telefono';
    try {
      const u = new URL(raw, location.href);
      if (u.origin === location.origin) return '';
      return eventSegment(u.hostname.replace(/^www\./, ''), 'externo');
    } catch (_) {
      return '';
    }
  }

  function sanitizeErrorMessageForTracking(value) {
    return safeText(value)
      .replace(/\bES[0-9A-Z]{16,24}\b/gi, '[cups]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
      .replace(/https?:\/\/[^\s]+/gi, '[url]')
      .replace(/\b\d{8,}\b/g, '[num]');
  }

  function normalizeForMatch(value) {
    const text = safeText(value).toLowerCase();
    if (!text) return '';
    try {
      return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {
      return text;
    }
  }

  function shortSource(urlLike) {
    const raw = safeText(urlLike);
    if (!raw) return '';
    try {
      const u = new URL(raw, location.origin);
      if (u.origin === location.origin) return u.pathname || '';
      return u.hostname || raw;
    } catch (_) {
      return raw;
    }
  }

  const ERROR_DEDUP_KEY = 'lf_js_error_dedupe_v1';
  const ERROR_DEDUP_MAX = 30;

  function isSameOriginUrl(urlLike) {
    const raw = safeText(urlLike);
    if (!raw) return false;
    try {
      const u = new URL(raw, location.origin);
      return u.origin === location.origin;
    } catch (_) {
      return raw.startsWith('/') ||
             raw.includes(location.hostname) ||
             raw.includes('luzfija.es');
    }
  }

  function getScriptSourceFromErrorEvent(evt) {
    try {
      const t = evt && evt.target;
      if (!t || t === window || t === document) return '';
      const tag = safeText(t.tagName).toUpperCase();
      if (tag !== 'SCRIPT') return '';

      const rawSrc = safeText((t.getAttribute && t.getAttribute('src')) || t.src || '');
      if (!rawSrc || !isSameOriginUrl(rawSrc)) return '';
      return shortSource(rawSrc);
    } catch (_) {
      return '';
    }
  }

  function shouldTrackError(filename, source, scriptSource, route, line, col) {
    // Error de carga de <script src="..."> de nuestro origen.
    if (scriptSource) return true;

    // Error en archivo JS servido por nosotros.
    if (filename && isSameOriginUrl(filename)) return true;

    // Evitar ruido: sin filename + sin source fiable suele venir de extensiones/terceros.
    if (!filename) return false;

    // Inline del propio documento con posición válida.
    const hasPos = (line > 0 || col > 0);
    if (!hasPos) return false;
    if (!source || source === '(inline)') return false;
    if (source === route) return true;
    if (route === '/' && (source === '/' || source === location.pathname)) return true;
    return false;
  }

  function isDuplicateError(message, source, line, col, route) {
    try {
      const fingerprint = [
        safeText(message).substring(0, 90),
        safeText(source),
        String(line || 0),
        String(col || 0),
        safeText(route)
      ].join('|');

      const raw = sessionStorage.getItem(ERROR_DEDUP_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const seenMap = (parsed && typeof parsed === 'object') ? parsed : {};

      if (Object.prototype.hasOwnProperty.call(seenMap, fingerprint)) {
        return true;
      }

      seenMap[fingerprint] = Date.now();
      const entries = Object.entries(seenMap)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, ERROR_DEDUP_MAX);
      const nextMap = {};
      entries.forEach((pair) => { nextMap[pair[0]] = pair[1]; });
      sessionStorage.setItem(ERROR_DEDUP_KEY, JSON.stringify(nextMap));
    } catch (_) {}
    return false;
  }

  // Detectar navegador de forma simple y segura
  function getBrowserInfo() {
    try {
      const ua = navigator.userAgent || '';
      // Detectar navegador y versión aproximada
      if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edge') === -1 && ua.indexOf('Edg') === -1) {
        const match = ua.match(/Chrome\/(\d+)/);
        return match ? 'Chrome/' + match[1] : 'Chrome';
      }
      if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) {
        const match = ua.match(/Version\/(\d+)/);
        return match ? 'Safari/' + match[1] : 'Safari';
      }
      if (ua.indexOf('Firefox') > -1) {
        const match = ua.match(/Firefox\/(\d+)/);
        return match ? 'Firefox/' + match[1] : 'Firefox';
      }
      if (ua.indexOf('Edg') > -1) {
        const match = ua.match(/Edg\/(\d+)/);
        return match ? 'Edge/' + match[1] : 'Edge';
      }
      return 'Other';
    } catch (_) {
      return 'Unknown';
    }
  }

  function extractSourceFromStack(stackLike) {
    const stack = safeText(stackLike);
    if (!stack) return '';
    try {
      // Chrome/Edge/Safari: at fn (url:line:col) / at url:line:col
      // Firefox: fn@url:line:col
      const m = stack.match(/((?:https?:\/\/|\/)[^\s)@]+):(\d+):(\d+)/);
      if (!m) return '';
      const src = shortSource(m[1]);
      if (!src) return '';
      return src + ':' + m[2] + ':' + m[3];
    } catch (_) {
      return '';
    }
  }

  // ===== EVENTOS AUTOMÁTICOS (no requieren modificar app.js) =====
  window.addEventListener('DOMContentLoaded', function() {

    // Cargar GoatCounter en cuanto el DOM está listo para registrar el page view de todos los visitantes.
    // count.js envía el page view automáticamente al cargarse (no_onload no está activo).
    ensureGoatCounterLoaded();

    // 1. Cálculos solicitados y completados. El mismo evento interno lo emiten
    //    home y simulador solar, así evitamos duplicar selectores de botones.
    document.addEventListener('lf:results-requested', function(e) {
      const origin = eventSegment((e && e.detail && e.detail.origin) || currentPageKey(), 'pagina');
      trackDetailedEvent('calculo-realizado', origin, {
        title: 'Cálculo solicitado: ' + origin
      });
    });

    document.addEventListener('lf:results-ready', function(e) {
      const detail = (e && e.detail) || {};
      const origin = eventSegment(detail.origin || currentPageKey(), 'pagina');
      const rows = Number(detail.rows) || 0;
      trackDetailedEvent('calculo-resultados', origin, {
        title: 'Resultados listos: ' + origin + (rows ? ' | filas:' + rows : '')
      });
    });

    // 2. Trackear exportación de CSV legacy si el botón existe
    const btnExport = document.getElementById('btnExport');
    if (btnExport) {
      btnExport.addEventListener('click', function() {
        trackDetailedEvent('csv-exportado', currentPageKey(), { title: 'Usuario descargó CSV' });
      });
    }

    // 3. Trackear compartir configuración
    const btnShare = document.getElementById('btnShare');
    if (btnShare) {
      btnShare.addEventListener('click', function() {
        trackDetailedEvent('url-compartida', currentPageKey(), { title: 'Usuario compartió URL' });
      });
    }

    // NOTA: Los botones del modal de factura NO se trackean por privacidad
    // El modal activa __LF_PRIVACY_MODE automáticamente al abrirse

    // 4. Trackear cambio de tema (dark/light)
    const btnTheme = document.getElementById('btnTheme');
    if (btnTheme) {
      btnTheme.addEventListener('click', function() {
        setTimeout(function() {
          const mode = document.documentElement.classList.contains('light-mode') ? 'claro' : 'oscuro';
          trackDetailedEvent('tema-cambiado', mode, {
            title: 'Cambió a tema ' + mode
          });
        }, 0);
      });
    }

    // 5. Eventos de navegación y clicks en elementos dinámicos.
    document.addEventListener('click', function(e) {
      const target = e && e.target;
      if (!target || !target.closest) return;
      if (target.closest('#modalFactura')) return;

      const tarifaLink = target.closest('a[data-lf-track-tarifa], #tbody a.web, a.bv-link-tarifa, a.bv-alt-btn-info');
      if (tarifaLink) {
        const tarifaNombre = safeText(
          tarifaLink.getAttribute('data-lf-track-tarifa') ||
          tarifaNameFromContext(tarifaLink) ||
          'Desconocida'
        );
        const context = eventSegment(tarifaLink.getAttribute('data-lf-track-context') || currentPageKey(), 'pagina');
        trackDetailedEvent('tarifa-click-contratar', [context, tarifaNombre], {
          title: 'Click en contratar: ' + tarifaNombre + ' | origen:' + context
        });
        return;
      }

      const homeDesgloseCell = target.closest('#tbody td.total-cell, #tbody td.tarifa-cell');
      if (homeDesgloseCell && homeDesgloseCell.getAttribute('aria-disabled') !== 'true') {
        if (!target.closest('a, button, input, select, textarea, .tooltip, .tooltip-icon')) {
          const tarifaNombre = tarifaNameFromContext(homeDesgloseCell) || 'Desconocida';
          trackDetailedEvent('desglose-abierto', ['home', tarifaNombre], {
            title: 'Desglose abierto: ' + tarifaNombre + ' | origen:home'
          });
          return;
        }
      }

      const solarDetailButton = target.closest('.bv-alt-btn-toggle');
      if (solarDetailButton) {
        const tarifaNombre = tarifaNameFromContext(solarDetailButton) || 'Desconocida';
        trackDetailedEvent('desglose-abierto', ['solar', tarifaNombre], {
          title: 'Desglose abierto: ' + tarifaNombre + ' | origen:solar'
        });
        return;
      }

      const solarWinnerSummary = target.closest('.bv-results-grid summary');
      if (solarWinnerSummary) {
        const tarifaNombre = tarifaNameFromContext(solarWinnerSummary) || 'ganador';
        trackDetailedEvent('desglose-abierto', ['solar', tarifaNombre], {
          title: 'Desglose abierto: ' + tarifaNombre + ' | origen:solar'
        });
        return;
      }

      const solarTooltip = target.closest('#tbody .fv-icon, #tbody .consumo-limits-icon, #tbody .requisitos-icon, #tbody .te-warn-icon');
      if (solarTooltip) {
        const tarifaNombre = tarifaNameFromContext(solarTooltip) || 'Desconocida';
        const kind = solarTooltip.classList.contains('fv-icon') ? 'solar-bv' :
          (solarTooltip.classList.contains('consumo-limits-icon') ? 'limites' :
          (solarTooltip.classList.contains('requisitos-icon') ? 'requisitos' : 'compensacion-parcial'));
        trackDetailedEvent('detalle-tarifa-abierto', ['home', kind, tarifaNombre], {
          title: 'Detalle tarifa: ' + kind + ' | ' + tarifaNombre
        });
        return;
      }

      const csvButton = target.closest('#btnSubirCSV, #upload-csv-btn, #csvExcedentesBtn');
      if (csvButton) {
        const id = csvButton.id || '';
        const origin = id === 'upload-csv-btn' ? 'solar' : (id === 'csvExcedentesBtn' ? 'estadisticas' : 'home');
        trackDetailedEvent('csv-import-iniciado', origin, {
          title: 'Importación CSV/XLSX iniciada: ' + origin
        });
        return;
      }

      const systemButton = target.closest('#btnRefreshTarifas, #btnClearCache, #btnReset, #scrollToResults, [data-install-pwa]');
      if (systemButton) {
        const actionMap = {
          btnRefreshTarifas: 'refrescar-tarifas',
          btnClearCache: 'limpiar-cache',
          btnReset: 'restablecer-formulario',
          scrollToResults: 'ir-a-resultados'
        };
        const action = systemButton.hasAttribute('data-install-pwa')
          ? 'instalar-pwa'
          : (actionMap[systemButton.id] || systemButton.id || 'accion');
        trackDetailedEvent('accion-interfaz', [currentPageKey(), action], {
          title: 'Acción interfaz: ' + action + ' | origen:' + currentPageKey()
        });
        return;
      }

      const homeInfoButton = target.closest('#btnSolarInfo');
      if (homeInfoButton) {
        trackDetailedEvent('modal-info-abierto', ['home', 'solar'], {
          title: 'Modal informativo abierto: solar | origen:home'
        });
        return;
      }

      const solarBackupButton = target.closest('#bv-export-manual, #bv-import-manual, #bv-reset-manual, #remove-file, #bv-clear-custom-tarifa');
      if (solarBackupButton) {
        const actionMap = {
          'bv-export-manual': 'exportar-datos',
          'bv-import-manual': 'importar-datos',
          'bv-reset-manual': 'borrar-datos',
          'remove-file': 'quitar-archivo',
          'bv-clear-custom-tarifa': 'borrar-mi-tarifa'
        };
        const action = actionMap[solarBackupButton.id] || solarBackupButton.id || 'accion';
        trackDetailedEvent('accion-solar', action, {
          title: 'Acción solar: ' + action
        });
        return;
      }

      const mesInicioItem = target.closest('#bv-mes-inicio-list .bv-cs-item');
      if (mesInicioItem) {
        trackDetailedEvent('simulador-solar-mes-inicio', mesInicioItem.dataset.value || 'orden-tabla', {
          title: 'Mes inicio solar: ' + (mesInicioItem.textContent || mesInicioItem.dataset.value || 'orden-tabla')
        });
        return;
      }

      const compareYear = target.closest('#compareYears .chip');
      if (compareYear) {
        const text = titleFromElement(compareYear) || 'year';
        trackDetailedEvent('observatorio-comparativa-year', text, {
          title: 'Observatorio comparativa año: ' + text
        });
        return;
      }

      const filterButton = target.closest('.fbtn[data-filter]');
      if (filterButton) {
        const filter = filterButton.getAttribute('data-filter') || 'all';
        trackDetailedEvent('filtro-tarifas', filter, {
          title: 'Filtro tarifas: ' + filter
        });
        return;
      }

      const sortButton = target.closest('thead .sort-button');
      if (sortButton) {
        const th = sortButton.closest('th[data-sort]');
        const sortKey = th ? th.getAttribute('data-sort') : '';
        if (sortKey) {
          trackDetailedEvent('orden-tarifas', sortKey, {
            title: 'Ordenación tarifas: ' + sortKey
          });
          return;
        }
      }

      const pvpcButton = target.closest('#btnPVPCInfo');
      if (pvpcButton) {
        const typeSelector = document.getElementById('pvpcTypeSelector');
        const type = typeSelector ? (typeSelector.value || 'pvpc') : 'pvpc';
        trackDetailedEvent('pvpc-modal-abierto', type, {
          title: 'Modal horario abierto: ' + type
        });
        return;
      }

      const trendButton = target.closest('#trendModeMonthly, #trendModeDaily');
      if (trendButton) {
        const mode = trendButton.id === 'trendModeDaily' ? 'daily' : 'monthly';
        trackDetailedEvent('observatorio-tendencia', mode, {
          title: 'Observatorio tendencia: ' + mode
        });
        return;
      }

      const a = e && e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref.charAt(0) === '#') {
        if (a.classList && a.classList.contains('share-btn')) {
          const onclick = safeText(a.getAttribute('onclick') || '');
          const match = onclick.match(/share\(['"]([^'"]+)['"]\)/);
          const platform = match ? match[1] : (titleFromElement(a) || 'desconocido');
          const currentGuide = guideSlugFromPath(location && location.pathname ? location.pathname : '');
          if (currentGuide) {
            trackDetailedEvent('guia-compartida', [currentGuide, platform], {
              title: 'Guía compartida: ' + currentGuide + ' | canal:' + platform
            });
          }
        }
        return;
      }

      const path = canonicalPathFromHref(rawHref);
      if (!path) {
        const externalTarget = externalTargetFromHref(rawHref);
        if (externalTarget) {
          trackDetailedEvent('enlace-externo', [currentPageKey(), externalTarget], {
            title: 'Enlace externo: ' + externalTarget + ' | origen:' + currentPageKey()
          });
        }
        return;
      }

      const guideSlug = guideSlugFromPath(path);
      if (guideSlug) {
        trackDetailedEvent('guia-click', guideSlug, {
          title: 'Click guía: ' + (titleFromElement(a) || guideSlug) + ' | origen:' + currentPageKey()
        });
        return;
      }

      if (path === '/guias.html' || path === '/guias/') {
        trackDetailedEvent('navegacion-guias', 'indice', {
          title: 'Usuario fue a Guías | origen:' + currentPageKey()
        });
        return;
      }

      if (path === '/llms.txt' || path === '/llms-full.txt') {
        trackDetailedEvent('navegacion-recurso', path === '/llms-full.txt' ? 'llms-full' : 'llms', {
          title: 'Navegación recurso: ' + path + ' | origen:' + currentPageKey()
        });
        return;
      }

      const toolMap = {
        '/': 'comparador',
        '/estadisticas/': 'observatorio',
        '/comparador-tarifas-solares.html': 'solar',
        '/calcular-factura-luz.html': 'calcular-factura',
        '/comparar-pvpc-tarifa-fija.html': 'pvpc-vs-fija',
        '/como-funciona-luzfija.html': 'como-funciona',
        '/privacidad.html': 'privacidad',
        '/aviso-legal.html': 'aviso-legal'
      };
      const toolKey = toolMap[path];
      if (toolKey) {
        trackDetailedEvent('navegacion-herramienta', toolKey, {
          title: 'Navegación herramienta: ' + toolKey + ' | origen:' + currentPageKey()
        });
      }
    }, { capture: true });

    document.addEventListener('change', function(e) {
      const target = e && e.target;
      if (!target || !target.id) return;
      if (target.closest && target.closest('#modalFactura')) return;

      if (target.id === 'pvpcTypeSelector') {
        trackDetailedEvent('pvpc-modal-tipo', target.value || 'pvpc', {
          title: 'Modal horario cambió a: ' + (target.value || 'pvpc')
        });
      } else if (target.id === 'typeSelector') {
        trackDetailedEvent('observatorio-tipo', target.value || 'pvpc', {
          title: 'Observatorio tipo: ' + (target.value || 'pvpc')
        });
      } else if (target.id === 'geoSelector') {
        trackDetailedEvent('observatorio-zona', target.value || '8741', {
          title: 'Observatorio zona: ' + (target.value || '8741')
        });
      } else if (target.id === 'monthSelector') {
        trackDetailedEvent('observatorio-mes', target.value || 'all', {
          title: 'Observatorio mes: ' + (target.value || 'all')
        });
      } else if (target.id === 'yearSelector') {
        trackDetailedEvent('observatorio-year', target.value || 'desconocido', {
          title: 'Observatorio año: ' + (target.value || 'desconocido')
        });
      } else if (target.id === 'zonaFiscal') {
        trackDetailedEvent('comparador-zona-fiscal', target.value || 'peninsula', {
          title: 'Zona fiscal comparador: ' + (target.value || 'peninsula')
        });
      } else if (target.id === 'viviendaCanarias') {
        trackDetailedEvent('comparador-vivienda-canarias', boolState(target.checked), {
          title: 'Vivienda Canarias: ' + boolState(target.checked)
        });
      } else if (target.id === 'solarOn') {
        trackDetailedEvent('comparador-opcion', ['solar', boolState(target.checked)], {
          title: 'Opción solar: ' + boolState(target.checked)
        });
      } else if (target.id === 'bonoSocialOn') {
        trackDetailedEvent('comparador-opcion', ['bono-social', boolState(target.checked)], {
          title: 'Opción bono social: ' + boolState(target.checked)
        });
      } else if (target.name === 'bonoSocialTipo') {
        trackDetailedEvent('comparador-bono-social-tipo', target.value || 'vulnerable', {
          title: 'Bono social tipo: ' + (target.value || 'vulnerable')
        });
      } else if (target.name === 'bonoSocialLimite') {
        trackDetailedEvent('comparador-bono-social-limite', target.value || 'desconocido', {
          title: 'Bono social límite: ' + (target.value || 'desconocido')
        });
      } else if (target.id === 'compararMiTarifa') {
        trackDetailedEvent('comparador-opcion', ['mi-tarifa', boolState(target.checked)], {
          title: 'Opción mi tarifa: ' + boolState(target.checked)
        });
      } else if (target.id === 'csvAplicarExcedentes') {
        trackDetailedEvent('csv-opcion', ['home', 'excedentes', boolState(target.checked)], {
          title: 'CSV opción excedentes: ' + boolState(target.checked)
        });
      } else if (target.id === 'csvPvpcPeriodo') {
        trackDetailedEvent('csv-opcion', ['home', 'pvpc-periodo', boolState(target.checked)], {
          title: 'CSV opción PVPC periodo: ' + boolState(target.checked)
        });
      } else if (target.id === 'bv-zona-fiscal') {
        trackDetailedEvent('simulador-solar-zona-fiscal', target.value || 'peninsula', {
          title: 'Zona fiscal solar: ' + (target.value || 'peninsula')
        });
      } else if (target.id === 'bv-vivienda-canarias') {
        trackDetailedEvent('simulador-solar-vivienda-canarias', boolState(target.checked), {
          title: 'Vivienda Canarias solar: ' + boolState(target.checked)
        });
      } else if (target.id === 'mtBV') {
        trackDetailedEvent('simulador-solar-mi-tarifa-bv', boolState(target.checked), {
          title: 'Mi tarifa solar BV: ' + boolState(target.checked)
        });
      }
    }, { capture: true });

  });

  // ===== TRACKING DE ERRORES (mejorado con info detallada) =====
  window.addEventListener('error', function(e) {
    try{
      const filename = e && e.filename ? String(e.filename) : '';
      const message = sanitizeErrorMessageForTracking(e && e.message ? e.message : 'desconocido');
      const sourceFromFile = shortSource(filename);
      const scriptSource = getScriptSourceFromErrorEvent(e);
      const source = scriptSource || sourceFromFile || '(inline)';
      const line = (e && typeof e.lineno === 'number') ? e.lineno : 0;
      const col = (e && typeof e.colno === 'number') ? e.colno : 0;
      const route = safeText(location && location.pathname ? location.pathname : '');
      const browser = getBrowserInfo();

      if (isLegacyIndexExtraCompatNoise(message) || isPromiseStaleNoise(message)) {
        dbg('Error JS legacy filtrado:', message);
        trackEvent('error-legacy-filtrado', {
          title: buildLegacyNoiseTitle(getLegacyNoiseKind(message), 'error-javascript', 'window.error')
        });
        return;
      }

      if (!shouldTrackError(filename, source, scriptSource, route, line, col)) {
        dbg('Error ignorado (origen no fiable):', message, filename || '(sin filename)');
        return;
      }

      if (isDuplicateError(message, source, line, col, route)) {
        return;
      }

      const parts = [
        message.substring(0, 48),
        source + ':' + line + (col ? ':' + col : ''),
        'b:' + TRACK_BUILD_ID
      ];
      if (route && route !== '/') parts.push('@' + route);
      parts.push(browser);

      trackEvent('error-javascript', {
        title: parts.join(' | ').substring(0, 150)
      });
    }catch(_){}
  }, true);

  // Ruido conocido de cache viejo (ya corregido en el código actual).
  // Usuarios con SW/cache antiguo siguen ejecutando versiones viejas de JS
  // donde estas variables se usaban como globales desnudos.
  var STALE_CACHE_NOISE = [
    'currentYear is not defined',
    'currentYear no está definid',
    'currentYear no esta definid'
  ];

  function isLegacyIndexExtraCompatNoise(msg) {
    var normalized = normalizeForMatch(msg);
    if (!normalized || normalized.indexOf('index-extra') === -1) return false;
    if (normalized.indexOf('compat') === -1) return false;
    if (normalized.indexOf('omitid') !== -1) return true;
    if (normalized.indexOf('es2020') !== -1) return true;
    return false;
  }

  function isPromiseStaleNoise(msg) {
    var normalized = normalizeForMatch(msg);
    if (!normalized || normalized.indexOf('currentyear') === -1) return false;

    for (var i = 0; i < STALE_CACHE_NOISE.length; i++) {
      if (normalized.indexOf(normalizeForMatch(STALE_CACHE_NOISE[i])) !== -1) return true;
    }
    // Variante antigua: "Promise reject: currentYear is not defined event"
    if (normalized.indexOf('promise reject') !== -1 && normalized.indexOf('not defined') !== -1) return true;
    if (normalized.indexOf('promise') !== -1 && normalized.indexOf('undefined') !== -1) return true;
    return false;
  }

  // Capturar errores de Promises no manejadas (crítico para PVPC/PDF)
  window.addEventListener('unhandledrejection', function(e) {
    try {
      const reason = e && e.reason ? e.reason : 'unknown';
      const route = safeText(location && location.pathname ? location.pathname : '');
      const browser = getBrowserInfo();

      let msg = '';
      let stackSource = '';
      if (reason instanceof Error) {
        msg = sanitizeErrorMessageForTracking(reason.message || reason.name || 'Error');
        stackSource = extractSourceFromStack(reason.stack || '');
      } else if (reason && typeof reason === 'object') {
        if (typeof reason.message === 'string' && reason.message) {
          msg = sanitizeErrorMessageForTracking(reason.message);
        } else {
          try {
            msg = sanitizeErrorMessageForTracking(JSON.stringify(reason));
          } catch (_) {
            msg = sanitizeErrorMessageForTracking(reason);
          }
        }
        if (typeof reason.stack === 'string' && reason.stack) {
          stackSource = extractSourceFromStack(reason.stack);
        }
      } else {
        msg = sanitizeErrorMessageForTracking(reason);
      }

      // Filtrar ruido de cache viejo (código ya corregido, solo llega desde SW antiguo)
      if (isLegacyIndexExtraCompatNoise(msg) || isPromiseStaleNoise(msg)) {
        if (DEBUG) dbg('Promise rejection ignorada (stale cache):', msg);
        trackEvent('error-legacy-filtrado', {
          title: buildLegacyNoiseTitle(getLegacyNoiseKind(msg), 'error-promise', 'unhandledrejection')
        });
        return;
      }

      const parts = [
        'Promise: ' + msg.substring(0, 48),
        'b:' + TRACK_BUILD_ID
      ];
      if (stackSource) parts.push(stackSource);
      if (route && route !== '/') parts.push('@' + route);
      parts.push(browser);

      trackEvent('error-promise', {
        title: parts.join(' | ').substring(0, 150)
      });

      if (DEBUG) {
        dbg('Unhandled Promise rejection:', reason);
      }
    } catch(_) {}
  });

})();
