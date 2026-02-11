// ===== TRACKING CON GOATCOUNTER (sin cookies, sin tracking personal) =====
// Este archivo registra eventos importantes para entender cómo usan la web los usuarios.
// Importante: el tracking nunca debe romper la web si falla el contador.

(function() {
  'use strict';

  // Guard global defensivo redundante (el principal está en config.js)
  // Se mantiene por si tracking.js se ejecuta en un contexto donde config.js no está cargado
  try {
    if (typeof window.currentYear !== 'number') {
      window.currentYear = new Date().getFullYear();
    }
  } catch (_) {}

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
  const GOAT_SCRIPT_SRC = '/vendor/goatcounter/count.js'; // Autoalojado (antes: https://gc.zgo.at/count.js)

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

  // Cola de eventos mientras GoatCounter termina de cargar
  const queue = [];
  let loadingPromise = null;

  function getGoatEndpointFromPage(){
    const existing = document.querySelector('script[data-goatcounter]');
    const val = existing && existing.getAttribute('data-goatcounter');
    return val || DEFAULT_GOAT_ENDPOINT;
  }

  function isGoatReady(){
    return (typeof window.goatcounter !== 'undefined' && typeof window.goatcounter.count === 'function');
  }

  function ensureGoatCounterLoaded(){
    if (isGoatReady()) return Promise.resolve(true);
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise((resolve) => {
      try{
        // Si ya existe el script, esperar a que esté listo
        const existingScript = document.querySelector('script[src="' + GOAT_SCRIPT_SRC + '"]');
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

  function trackEvent(eventName, metadata) {
    // 🔒 MODO PRIVACIDAD: Si está activo, no enviar NADA
    if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) {
      dbg('Privacy mode activo, evento bloqueado:', eventName);
      return;
    }

    // Evitar ruido legado del loader antiguo de index-extra (clients con caché vieja).
    const rawTitle = (metadata && metadata.title) ? String(metadata.title) : '';
    if (eventName === 'error-javascript' &&
        rawTitle &&
        rawTitle.indexOf('Compat: index-extra omitido') !== -1) {
      dbg('Ruido legado filtrado:', rawTitle);
      return;
    }
    
    const payload = {
      path: eventName,
      title: (metadata && metadata.title) ? metadata.title : eventName,
      event: true,
    };

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

  // Exponer función global para que app.js pueda usarla
  window.__LF_track = trackEvent;

  function safeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
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

    // 1. Trackear clicks en "Calcular"
    const btnCalc = document.getElementById('btnCalc');
    if (btnCalc) {
      btnCalc.addEventListener('click', function() {
        trackEvent('calculo-realizado', { title: 'Usuario calculó tarifas' });
      });
    }

    // 2. Trackear exportación de CSV
    const btnExport = document.getElementById('btnExport');
    if (btnExport) {
      btnExport.addEventListener('click', function() {
        trackEvent('csv-exportado', { title: 'Usuario descargó CSV' });
      });
    }

    // 3. Trackear compartir configuración
    const btnShare = document.getElementById('btnShare');
    if (btnShare) {
      btnShare.addEventListener('click', function() {
        trackEvent('url-compartida', { title: 'Usuario compartió URL' });
      });
    }

    // NOTA: Los botones del modal de factura NO se trackean por privacidad
    // El modal activa __LF_PRIVACY_MODE automáticamente al abrirse

    // 4. Trackear cambio de tema (dark/light)
    const btnTheme = document.getElementById('btnTheme');
    if (btnTheme) {
      btnTheme.addEventListener('click', function() {
        const isLight = document.documentElement.classList.contains('light-mode');
        trackEvent('tema-cambiado', {
          title: isLight ? 'Cambió a tema claro' : 'Cambió a tema oscuro'
        });
      });
    }

    // 7. Trackear clicks en enlaces de contratación (tabla de resultados)
    const tbody = document.getElementById('tbody');
    if (tbody) {
      tbody.addEventListener('click', function(e) {
        const link = e.target && e.target.closest ? e.target.closest('a.web') : null;
        if (link) {
          const tarifaRow = link.closest('tr');
          const tarifaNombre = tarifaRow && tarifaRow.querySelector ? (tarifaRow.querySelector('.tarifa-nombre')?.textContent || 'Desconocida') : 'Desconocida';
          trackEvent('tarifa-click-contratar', {
            title: 'Click en contratar: ' + tarifaNombre
          });
        }
      });
    }

    // 8. Trackear navegación a la página de guías
    //    Delegación de eventos para evitar recorrer y enlazar todos los links en el DOM (más ligero en móvil)
    document.addEventListener('click', function(e) {
      const a = e && e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      // Sólo enlaces internos / relativos que contengan "guias"
      if (href && href.indexOf('guias') !== -1) {
        trackEvent('navegacion-guias', { title: 'Usuario fue a Guías' });
      }
    }, { capture: true });

  });

  // ===== TRACKING DE ERRORES (mejorado con info detallada) =====
  window.addEventListener('error', function(e) {
    try{
      const filename = e && e.filename ? String(e.filename) : '';
      const message = safeText(e && e.message ? e.message : 'desconocido');
      const sourceFromFile = shortSource(filename);
      const scriptSource = getScriptSourceFromErrorEvent(e);
      const source = scriptSource || sourceFromFile || '(inline)';
      const line = (e && typeof e.lineno === 'number') ? e.lineno : 0;
      const col = (e && typeof e.colno === 'number') ? e.colno : 0;
      const route = safeText(location && location.pathname ? location.pathname : '');
      const browser = getBrowserInfo();

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
    'currentYear no está definid'
  ];

  function isPromiseStaleNoise(msg) {
    for (var i = 0; i < STALE_CACHE_NOISE.length; i++) {
      if (msg.indexOf(STALE_CACHE_NOISE[i]) !== -1) return true;
    }
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
        msg = String(reason.message || reason.name || 'Error');
        stackSource = extractSourceFromStack(reason.stack || '');
      } else {
        msg = String(reason);
      }

      // Filtrar ruido de cache viejo (código ya corregido, solo llega desde SW antiguo)
      if (isPromiseStaleNoise(msg)) {
        if (DEBUG) dbg('Promise rejection ignorada (stale cache):', msg);
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
