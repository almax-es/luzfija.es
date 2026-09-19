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
      // No conservar tampoco diagnósticos pendientes cuando el usuario opta
      // por salir de la analítica. El outbox solo contiene rutas saneadas, pero
      // el opt-out debe seguir siendo absoluto también para datos locales.
      try { localStorage.removeItem('lf_error_outbox_v1'); } catch (_) {}
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
  // Identidad compartida del HTML/JS cargado. Otros módulos (por ejemplo, la
  // recuperación de clientes obsoletos) no deben volver a inferirla de forma
  // distinta.
  window.__LF_BUILD_ID = TRACK_BUILD_ID;
  const GOAT_SCRIPT_PATH = '/vendor/goatcounter/count.js';
  const GOAT_SCRIPT_SRC = GOAT_SCRIPT_PATH + '?v=' + encodeURIComponent(TRACK_BUILD_ID); // Autoalojado (antes: https://gc.zgo.at/count.js)

  // Cola de eventos mientras GoatCounter termina de cargar
  const queue = [];
  let loadingPromise = null;
  let retryTimer = null;
  let loadAttempts = 0;
  const GOAT_MAX_LOAD_ATTEMPTS = 3;
  const GOAT_RETRY_DELAYS_MS = [5000, 20000];
  // El outbox puede hidratar 64 diagnósticos. La cola deja otras 64 plazas para
  // eventos de la carga actual y, si aun así se llena, protege primero los
  // diagnósticos persistentes.
  const GOAT_QUEUE_MAX = 128;
  // Declarado aqui arriba y no junto a buildEventPath a proposito:
  // hydrateDiagnosticOutbox() se ejecuta durante la inicializacion del modulo y
  // ya construye rutas, asi que un `const` mas abajo lo dejaba en zona muerta
  // temporal (ReferenceError solo en el arranque con outbox pendiente).
  const EVENT_PATH_MAX_LENGTH = 180;
  const ERROR_OUTBOX_KEY = 'lf_error_outbox_v1';
  const ERROR_OUTBOX_MAX = 64;
  const ERROR_OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const BACKGROUND_FETCH_REASONS = new Set(['focus', 'visible', 'online', 'interval']);
  let pageLifecycleState = 'active';
  const handledErrorEvents = window.__LF_TRACKING_HANDLED_ERROR_EVENTS instanceof WeakSet
    ? window.__LF_TRACKING_HANDLED_ERROR_EVENTS
    : new WeakSet();
  const handledPromiseEvents = window.__LF_TRACKING_HANDLED_PROMISE_EVENTS instanceof WeakSet
    ? window.__LF_TRACKING_HANDLED_PROMISE_EVENTS
    : new WeakSet();
  const handledCspEvents = window.__LF_TRACKING_HANDLED_CSP_EVENTS instanceof WeakSet
    ? window.__LF_TRACKING_HANDLED_CSP_EVENTS
    : new WeakSet();
  window.__LF_TRACKING_HANDLED_ERROR_EVENTS = handledErrorEvents;
  window.__LF_TRACKING_HANDLED_PROMISE_EVENTS = handledPromiseEvents;
  window.__LF_TRACKING_HANDLED_CSP_EVENTS = handledCspEvents;

  // Se captura antes de que una navegacion pueda provocar el rechazo de un
  // fetch. visibilityState por si solo no distingue una pestaña en segundo
  // plano de una pagina que ya se esta destruyendo.
  window.addEventListener('pagehide', () => { pageLifecycleState = 'pagehide'; }, true);
  window.addEventListener('beforeunload', () => { pageLifecycleState = 'unloading'; }, true);
  window.addEventListener('pageshow', () => { pageLifecycleState = 'active'; }, true);
  document.addEventListener('freeze', () => { pageLifecycleState = 'frozen'; }, true);
  document.addEventListener('resume', () => { pageLifecycleState = 'active'; }, true);

  function isAnalyticsOptedOut() {
    try {
      return localStorage.getItem(OPT_OUT_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  function isPersistentDiagnosticPath(pathLike) {
    const path = safeText(pathLike);
    return /^(?:error-(?:javascript|promise|script-load|resource-load|network|csp|context)|init-incompleto)(?:\/|$)/.test(path);
  }

  function readDiagnosticOutbox() {
    try {
      const raw = localStorage.getItem(ERROR_OUTBOX_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - ERROR_OUTBOX_TTL_MS;
      return parsed
        .filter((entry) => entry && isPersistentDiagnosticPath(entry.path) && Number(entry.at) >= cutoff)
        .slice(-ERROR_OUTBOX_MAX);
    } catch (_) {
      return [];
    }
  }

  function writeDiagnosticOutbox(entries) {
    try {
      const safeEntries = Array.isArray(entries) ? entries.slice(-ERROR_OUTBOX_MAX) : [];
      if (!safeEntries.length) {
        localStorage.removeItem(ERROR_OUTBOX_KEY);
        return;
      }
      localStorage.setItem(ERROR_OUTBOX_KEY, JSON.stringify(safeEntries));
    } catch (_) {}
  }

  function rememberDiagnosticPayload(payload) {
    if (!payload || !isPersistentDiagnosticPath(payload.path)) return null;
    const path = safeText(payload.path)
      .split('/')
      .map((part) => eventSegment(part, ''))
      .filter(Boolean)
      .join('/')
      .substring(0, 180);
    if (!isPersistentDiagnosticPath(path)) return null;
    const entries = readDiagnosticOutbox();
    const newestAt = entries.reduce((max, entry) => Math.max(max, Number(entry.at) || 0), 0);
    const entry = { path, at: Math.max(Date.now(), newestAt + 1) };
    entries.push(entry);
    writeDiagnosticOutbox(entries);
    return entry;
  }

  function forgetDiagnosticPayload(pathLike, atLike) {
    const path = safeText(pathLike);
    if (!path) return;
    const at = Number(atLike);
    let removed = false;
    writeDiagnosticOutbox(readDiagnosticOutbox().filter((entry) => {
      if (removed || entry.path !== path) return true;
      if (isFinite(at) && Number(entry.at) !== at) return true;
      removed = true;
      return false;
    }));
  }

  // GoatCounter sella hora y referrer CUANDO RECIBE, no cuando ocurrio el error.
  // Un diagnostico reenviado desde el outbox puede ser de hace dias y aparecer con
  // la hora y el referrer de la carga que lo reenvia. Sin marca en el path, un
  // pico reenviado tras recuperar conectividad se lee como si acabara de pasar y
  // se atribuye a la sesion equivocada. El marcador va al final para que
  // isPersistentDiagnosticPath siga reconociendo la familia.
  const DEFERRED_PATH_MARKER = 'diferido';

  // Concatenacion directa, NO buildEventPath: su eventSegment() aplana las barras
  // (`[^a-z0-9]+` -> `-`) y convertiria la ruta multi-segmento en un unico segmento.
  // La ruta guardada ya viene saneada segmento a segmento por rememberDiagnosticPayload.
  function deferredDiagnosticPath(pathLike) {
    const path = safeText(pathLike);
    const suffix = '/' + DEFERRED_PATH_MARKER;
    if (!path || path.endsWith(suffix)) return path;
    // Si hay que recortar, se recorta la ruta y nunca el marcador: sin el, un
    // diagnostico reenviado seria indistinguible de uno en tiempo real.
    return path.substring(0, EVENT_PATH_MAX_LENGTH - suffix.length).replace(/\/+$/, '') + suffix;
  }

  // Reescribe in situ el path de un diagnostico que va a quedarse esperando red.
  // Solo afecta a las familias de diagnostico: un evento de producto no se usa
  // para atribuir incidencias y no debe ensuciar su taxonomia. El sufijo conserva
  // el prefijo de familia, asi que isPersistentDiagnosticPath lo sigue aceptando.
  function markQueuedDiagnosticAsDeferred(payload) {
    if (!payload || !isPersistentDiagnosticPath(payload.path)) return;
    const marked = deferredDiagnosticPath(payload.path);
    if (marked === payload.path) return;
    payload.path = marked;
    payload.title = ('Diagnóstico diferido | ' + marked).substring(0, 150);
  }

  function hydrateDiagnosticOutbox() {
    const entries = readDiagnosticOutbox();
    entries.forEach((entry) => {
      const deliveredPath = deferredDiagnosticPath(entry.path);
      queue.push({
        path: deliveredPath,
        title: ('Diagnóstico diferido | ' + deliveredPath).substring(0, 150),
        event: true,
        no_session: true,
        // El outbox se sigue indexando por la ruta ORIGINAL sin marcar: es la
        // clave con la que forgetDiagnosticPayload lo elimina al confirmarse.
        __lfOutboxPath: entry.path,
        __lfOutboxAt: entry.at
      });
    });
  }

  function deliverToGoatCounter(evt) {
    const outboxPath = evt && evt.__lfOutboxPath;
    const outboxAt = evt && evt.__lfOutboxAt;
    const payload = Object.assign({}, evt);
    delete payload.__lfOutboxPath;
    delete payload.__lfOutboxAt;
    if (outboxPath) {
      // Para diagnósticos se fuerza el fallback de imagen: su `load`/`error`
      // permite confirmar el resultado, mientras que sendBeacon solo confirma
      // que el navegador aceptó encolar bytes, no que GoatCounter los recibiera.
      payload.force_image = true;
      payload.on_sent = () => forgetDiagnosticPayload(outboxPath, outboxAt);
      payload.on_error = () => {};
    }
    const accepted = window.goatcounter.count(payload);
    // count.js devuelve false cuando tuvo que recurrir a una imagen y aún no
    // conoce el resultado. En ese caso on_sent/on_error resolverán el outbox.
    // `undefined` se considera aceptado para conservar compatibilidad con mocks
    // y clientes que aún ejecuten un sender anterior.
    if (outboxPath && accepted !== false && navigator.onLine !== false) {
      forgetDiagnosticPayload(outboxPath, outboxAt);
    }
  }

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
    if (loadAttempts >= GOAT_MAX_LOAD_ATTEMPTS) return Promise.resolve(false);

    loadAttempts += 1;
    const attemptPromise = new Promise((resolve) => {
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

    loadingPromise = attemptPromise.then((ok) => {
      if (ok) {
        loadAttempts = 0;
        return true;
      }

      // Un <script> fallido permanece en el DOM y findExistingGoatScript() lo
      // reutilizaría eternamente. Retirarlo y liberar la promesa permite que un
      // fallo transitorio se recupere sin exigir una recarga de página.
      const failedScript = findExistingGoatScript();
      if (failedScript && failedScript.parentNode) failedScript.parentNode.removeChild(failedScript);
      loadingPromise = null;
      return false;
    });

    return loadingPromise;
  }

  function flushQueue(){
    if (isAnalyticsOptedOut()) {
      queue.length = 0;
      writeDiagnosticOutbox([]);
      return;
    }
    if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) return;
    if (!isGoatReady()) return;
    while(queue.length){
      const evt = queue.shift();
      try{
        deliverToGoatCounter(evt);
      }catch(e){
        // ignorar
      }
    }
  }

  function scheduleGoatRetry() {
    if (retryTimer || isGoatReady()) return;
    if (loadAttempts >= GOAT_MAX_LOAD_ATTEMPTS) {
      queue.length = 0;
      return;
    }

    const delayIndex = Math.max(0, loadAttempts - 1);
    const delay = GOAT_RETRY_DELAYS_MS[Math.min(delayIndex, GOAT_RETRY_DELAYS_MS.length - 1)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      ensureGoatCounterLoaded().then((ok) => {
        if (ok) flushQueue();
        else scheduleGoatRetry();
      });
    }, delay);
  }

  function makeGoatQueueRoom() {
    if (queue.length < GOAT_QUEUE_MAX) return;
    const ordinaryIndex = queue.findIndex((entry) => !isPersistentDiagnosticPath(entry && entry.path));
    queue.splice(ordinaryIndex >= 0 ? ordinaryIndex : 0, 1);
  }

  function sendPayload(payload) {
    const persistentDiagnostic = isPersistentDiagnosticPath(payload && payload.path);
    if (persistentDiagnostic) {
      const outboxEntry = rememberDiagnosticPayload(payload);
      if (outboxEntry) {
        payload.__lfOutboxPath = outboxEntry.path;
        payload.__lfOutboxAt = outboxEntry.at;
      }
    }

    // Aunque count.js estuviera cargado desde una navegación anterior, sin red
    // sendBeacon/img no pueden confirmar la entrega. Conservar el diagnóstico y
    // esperar al evento `online` evita perderlo al cerrar o recargar la pestaña.
    if (navigator.onLine === false) {
      // Se marca ya aqui, no solo al hidratar desde localStorage: este
      // diagnostico se entregara cuando vuelva la red, asi que GoatCounter le
      // pondra la hora de ese momento y no la del fallo. Sin esta rama, un fallo
      // offline reenviado en la MISMA pestaña salia sin marcar.
      markQueuedDiagnosticAsDeferred(payload);
      makeGoatQueueRoom();
      queue.push(payload);
      return;
    }

    // Si GoatCounter ya está, enviar al momento
    if (isGoatReady()) {
      try {
        if (queue.length) flushQueue();
        deliverToGoatCounter(payload);
      } catch (e) {}
      return;
    }

    // Si no está listo, encolar y lanzar carga
    makeGoatQueueRoom();
    queue.push(payload);
    // Respetar el backoff ya programado: eventos nuevos se quedan en la cola,
    // pero no abren cargas paralelas ni adelantan el siguiente intento.
    if (retryTimer) return;
    ensureGoatCounterLoaded().then((ok) => {
      if (ok) flushQueue();
      else scheduleGoatRetry();
    });
  }

  hydrateDiagnosticOutbox();

  window.addEventListener('online', function () {
    // Este evento solo se dispara si ANTES hubo un corte, asi que todo lo que
    // siga en cola pudo quedar retenido por el. Cubre el caso de una pestaña que
    // encola online (esperando a count.js) y pierde la red justo despues.
    queue.forEach(markQueuedDiagnosticAsDeferred);
    if (isGoatReady()) {
      flushQueue();
      return;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    // Un cambio explícito a online abre una nueva oportunidad aunque los tres
    // intentos anteriores se agotaran mientras el dispositivo estaba sin red.
    loadAttempts = 0;
    ensureGoatCounterLoaded().then((ok) => {
      if (ok) flushQueue();
      else scheduleGoatRetry();
    });
  });

  function getLegacyNoiseKind(msgLike) {
    if (isLegacyIndexExtraCompatNoise(msgLike)) return 'index-extra-compat';
    if (isPromiseStaleNoise(msgLike)) return 'currentyear-stale';
    return '';
  }

  // El tipo de ruido legado y el build deben viajar en el PATH, no solo en el
  // title: GoatCounter unicamente sustituye el title de una ruta cuando el nuevo
  // se repite mas de 10 veces, asi que `index-extra-compat` y `currentyear-stale`
  // quedaban sumados en una sola fila e indistinguibles entre builds.
  function legacyNoiseEventPath(kind) {
    return buildEventPath('error-legacy-filtrado', [
      boundedEventSegment(kind, 'legacy', 32),
      errorBuildSegment(TRACK_BUILD_ID)
    ]);
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
    if (isAnalyticsOptedOut()) {
      queue.length = 0;
      writeDiagnosticOutbox([]);
      return;
    }
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

    const finalEventName = legacyKind ? legacyNoiseEventPath(legacyKind) : eventName;
    const finalTitle = legacyKind
      ? buildLegacyNoiseTitle(legacyKind, eventName, 'trackEvent')
      : ((metadata && metadata.title) ? metadata.title : eventName);

    const payload = {
      path: finalEventName,
      // Defensa en profundidad: ningún title sale con CUPS/email/URL/números largos
      title: sanitizeErrorMessageForTracking(finalTitle),
      event: true,
    };
    if (!metadata || metadata.noSession !== false) payload.no_session = true;

    sendPayload(payload);
  }

  // Familias de diagnostico que deben poder atribuirse a un build concreto.
  // Los errores ya lo llevan via buildErrorEventPath; `init-incompleto` se sella
  // aqui, en el unico punto por el que pasan todos sus emisores, para que ningun
  // emisor nuevo pueda olvidarlo. Sin esto, GoatCounter suma en una sola fila las
  // degradaciones de builds distintos y solo quedaria atribuirlas correlacionando
  // por hora, que es aproximado (ver ANALITICA-GOATCOUNTER.md).
  // Alcance deliberado: NO se aplica a `csv-import-error/*`, donde el eje
  // relevante es el fichero del usuario, no la version del codigo.
  const BUILD_STAMPED_EVENT_BASES = new Set(['init-incompleto']);

  function rememberInitRecovery(detail) {
    if (typeof window.__LF_requestInitRecovery === 'function') {
      window.__LF_requestInitRecovery(detail, TRACK_BUILD_ID);
      return;
    }
    const parts = Array.isArray(detail) ? detail : [detail];
    const entry = {
      app: boundedEventSegment(parts[0], 'pagina', 16),
      dependency: boundedEventSegment(parts[parts.length - 1], 'dependencia', 24),
      build: errorBuildSegment(TRACK_BUILD_ID),
      phase: 'runtime'
    };
    const pending = Array.isArray(window.__LF_PENDING_INIT_RECOVERY)
      ? window.__LF_PENDING_INIT_RECOVERY
      : [];
    const alreadyPending = pending.some((item) => item &&
      item.app === entry.app && item.dependency === entry.dependency &&
      item.build === entry.build && item.phase === entry.phase);
    if (!alreadyPending) pending.push(entry);
    window.__LF_PENDING_INIT_RECOVERY = pending.slice(-8);
    try {
      window.dispatchEvent(new CustomEvent('lf:init-incomplete', { detail: entry }));
    } catch (_) {}
  }

  function trackDetailedEvent(baseName, detail, metadata) {
    // Se compara la base YA NORMALIZADA: un emisor que escriba 'Init-Incompleto'
    // debe recibir el sello igual que uno que escriba el slug exacto.
    const normalizedBase = eventSegment(baseName, 'evento');
    const path = BUILD_STAMPED_EVENT_BASES.has(normalizedBase)
      ? buildStampedEventPath(baseName, detail, TRACK_BUILD_ID)
      : buildEventPath(baseName, detail);
    trackEvent(path, metadata || {});
    if (normalizedBase === 'init-incompleto') {
      const detailParts = Array.isArray(detail) ? detail : [detail];
      rememberInitRecovery(detailParts);
      emitErrorContext(
        'init',
        detailParts[detailParts.length - 1] || 'dependencia',
        0,
        0,
        'init-incompleto',
        [document.readyState === 'loading' ? 'loading' : 'ready']
      );
    }
  }

  // Exponer función global para que app.js pueda usarla
  window.__LF_track = trackEvent;
  window.__LF_trackDetail = trackDetailedEvent;
  window.__LF_trackingUtils = {
    buildEventPath,
    eventSegment,
    buildErrorEventPath
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
    return [cleanBase].concat(cleanParts).join('/').substring(0, EVENT_PATH_MAX_LENGTH);
  }

  function buildStampedEventPath(base, detail, buildLike) {
    const build = errorBuildSegment(buildLike);
    const suffix = '/' + build;
    // Limitar primero el prefijo reserva siempre el espacio del sello. Si se
    // truncase el path completo al final, un detalle largo podria borrar justo
    // el build y volver a mezclar versiones en GoatCounter.
    const maxPrefixLength = EVENT_PATH_MAX_LENGTH - suffix.length;
    const prefix = buildEventPath(base, detail)
      .substring(0, maxPrefixLength)
      .replace(/\/+$/, '');
    return prefix + suffix;
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

  function bonoSocialLimitSegment(value) {
    const levels = {
      '1587': 'nivel-1',
      '2222': 'nivel-2',
      '2698': 'nivel-3',
      '4761': 'nivel-4'
    };
    return levels[safeText(value)] || 'desconocido';
  }

  function solarStartMonthSegment(value) {
    const raw = safeText(value);
    if (!raw || raw === 'orden-tabla') return 'orden-tabla';
    const match = /^(?:\d{4}-)?(0?[1-9]|1[0-2])$/.exec(raw);
    return match ? String(Number(match[1])) : 'desconocido';
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

  // ===== PATH DE ERRORES =====
  // GoatCounter agrupa por `path`, y solo sustituye el `title` de una ruta cuando
  // el titulo nuevo se repite mas de 10 veces (ver path.go, updateTitle). Por eso
  // el detalle que permite distinguir un fallo NO puede vivir solo en el titulo:
  // un error nuevo quedaria escondido bajo el contador de otro antiguo.
  // Al path van tres datos acotados y no personales: fichero, linea y build.
  // NUNCA van al path: mensaje libre, URL completa, stack, query, CUPS, email ni
  // ningun dato del usuario. El mensaje saneado sigue viajando en el `title`.
  function errorFileSegment(sourceLike) {
    const raw = safeText(sourceLike);
    if (!raw) return 'desconocido';
    // Solo el basename: descarta query/hash, directorios y extension.
    let base = raw.split(/[?#]/)[0];
    const slash = base.lastIndexOf('/');
    if (slash !== -1) base = base.slice(slash + 1);
    base = base.replace(/\.[a-z0-9]+$/i, '');
    // Defensa en profundidad: un basename no deberia contener nunca datos
    // personales, pero se redacta igual antes de convertirlo en segmento
    // (eventSegment solo pasa a minusculas, no redacta) y se acota la longitud.
    base = sanitizeErrorMessageForTracking(base).substring(0, 40);
    return eventSegment(base, 'desconocido');
  }

  function errorLineSegment(lineLike) {
    const n = Number(lineLike);
    if (!isFinite(n) || n <= 0) return '0';
    return String(Math.floor(n));
  }

  function errorColumnSegment(colLike) {
    const n = Number(colLike);
    if (!isFinite(n) || n <= 0) return 'c0';
    return 'c' + String(Math.floor(n));
  }

  function errorBuildSegment(buildLike) {
    const raw = safeText(buildLike);
    return /^\d{8}-\d{6}$/.test(raw) ? raw : 'desconocido';
  }

  function buildErrorEventPath(base, sourceLike, lineLike) {
    return buildEventPath(base, [
      errorFileSegment(sourceLike),
      errorLineSegment(lineLike),
      errorBuildSegment(TRACK_BUILD_ID)
    ]);
  }

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

  function sameOriginHttpSource(value) {
    const raw = safeText(value);
    if (!raw) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return '';
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.pathname || '';
    } catch (_) {
      return '';
    }
  }

  const EXTENSION_PROTOCOL_RE = /^(?:chrome|moz|safari|safari-web|ms-browser)-extension:$/;

  // Hosts propios o de infraestructura conocida. Se reportan por categoria
  // cerrada en vez de por dominio para que el path no dependa de subdominios.
  const CSP_KNOWN_HOST_CATEGORIES = [
    [/(?:^|\.)gstatic\.com$/, 'gstatic'],
    [/(?:^|\.)googleapis\.com$/, 'googleapis'],
    [/(?:^|\.)google\.com$/, 'google'],
    [/(?:^|\.)goatcounter\.com$/, 'goatcounter'],
    [/(?:^|\.)github(?:usercontent)?\.(?:com|io)$/, 'github'],
    [/(?:^|\.)cloudflare\.com$/, 'cloudflare'],
    [/(?:^|\.)jsdelivr\.net$/, 'jsdelivr'],
    [/(?:^|\.)unpkg\.com$/, 'unpkg']
  ];

  // Dominio del recurso bloqueado, saneado para diagnostico.
  // Se descarta usuario, contrasena, puerto, ruta, query y fragmento (URL.hostname
  // ya lo hace) y ADEMAS se recorta a los dos ultimos labels, porque un subdominio
  // puede transportar un identificador (p. ej. cliente-123.example.com).
  // Perdida aceptada a proposito: con eTLD de dos niveles (co.uk, com.au) el
  // resultado queda poco informativo. Se prefiere eso a embarcar una Public
  // Suffix List de ~230 KB en un sitio sin bundler para un dato de diagnostico.
  function cspBlockedHostSegment(hostnameLike) {
    const host = safeText(hostnameLike).toLowerCase().replace(/\.$/, '');
    if (!host) return 'sin-host';
    if (host === 'localhost') return 'localhost';
    // IPv6 llega entre corchetes desde URL.hostname; IPv4 como cuatro grupos.
    if (host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return 'ip';
    for (let i = 0; i < CSP_KNOWN_HOST_CATEGORIES.length; i++) {
      if (CSP_KNOWN_HOST_CATEGORIES[i][0].test(host)) return CSP_KNOWN_HOST_CATEGORIES[i][1];
    }
    const labels = host.split('.').filter(Boolean);
    if (labels.length < 2) return 'host-invalido';
    return boundedEventSegment(labels.slice(-2).join('.'), 'host-invalido', 40);
  }

  // EJE 1 (objetivo): que recurso se bloqueo. Responde "es un recurso nuestro,
  // de una extension, o de un dominio externo -y cual-".
  function isAnalyticsEndpointCspViolation(event) {
    // Una violacion cuyo recurso bloqueado es el propio endpoint analitico no
    // puede notificarse a traves de ese mismo endpoint: sendBeacon y el fallback
    // de imagen pueden generar nuevas violaciones y autorrealimentar el handler.
    // El criterio es el recurso, no la directiva (connect-src/img-src/default-src).
    const rawBlocked = safeText(event && event.blockedURI);
    if (!rawBlocked) return false;
    try {
      const blocked = new URL(rawBlocked, location.href);
      const endpoint = new URL(getGoatEndpointFromPage(), location.href);
      return blocked.origin === endpoint.origin;
    } catch (_) {
      return false;
    }
  }

  function cspTargetDiagnostic(event) {
    const raw = safeText(event && event.blockedURI);
    if (!raw) return ['sin-uri', 'sin-host'];
    const keyword = raw.toLowerCase().replace(/:$/, '');
    const cspBlockedKeywords = new Set([
      'inline', 'eval', 'wasm-eval', 'data', 'blob', 'filesystem',
      'trusted-types-policy', 'trusted-types-sink'
    ]);
    if (cspBlockedKeywords.has(keyword)) return [keyword, 'sin-host'];
    try {
      const url = new URL(raw, location.href);
      if (EXTENSION_PROTOCOL_RE.test(url.protocol)) return ['extension', 'sin-host'];
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.origin === location.origin) return ['same-origin', 'propio'];
        return ['cross-origin', cspBlockedHostSegment(url.hostname)];
      }
      return ['other-protocol', 'sin-host'];
    } catch (_) {
      return ['uri-invalido', 'sin-host'];
    }
  }

  // EJE 2 (iniciador): quien pidio el recurso. Deliberadamente separado del
  // objetivo: un CSS PROPIO puede pedir por error una fuente EXTERNA. Colapsar
  // ambos ejes en un unico veredicto "propio/ajeno" archivaria ese caso como
  // ruido ajeno, que es justo el bug que hay que ver.
  // Senal de triaje, no prueba: una extension puede provocar violaciones cuyo
  // sourceFile apunte al documento, y en font-src el navegador suele no rellenarlo.
  function cspSourceDiagnostic(event) {
    const raw = safeText(event && event.sourceFile);
    const line = errorLineSegment(event && event.lineNumber);
    if (!raw) return ['sin-source', 'sin-source', '0'];
    try {
      const url = new URL(raw, location.href);
      if (EXTENSION_PROTOCOL_RE.test(url.protocol)) {
        return ['extension', 'extension', '0'];
      }
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.origin === location.origin) {
          return ['same-origin', errorFileSegment(url.pathname), line];
        }
        return ['cross-origin', 'externo', '0'];
      }
      return ['other-protocol', 'otro-protocolo', '0'];
    } catch (_) {
      return ['source-invalido', 'source-invalido', '0'];
    }
  }

  function getResourceFromErrorEvent(evt) {
    try {
      const t = evt && evt.target;
      if (!t || t === window || t === document) return '';
      const tag = safeText(t.tagName).toUpperCase();
      let kind = '';
      let rawSource = '';
      if (tag === 'SCRIPT') {
        kind = 'script';
        rawSource = safeText((t.getAttribute && t.getAttribute('src')) || t.src || '');
      } else if (tag === 'LINK') {
        const rel = safeText((t.getAttribute && t.getAttribute('rel')) || t.rel || '').toLowerCase();
        if (rel === 'stylesheet') kind = 'style';
        else if (rel === 'preload' || rel === 'modulepreload') kind = 'preload';
        rawSource = safeText((t.getAttribute && t.getAttribute('href')) || t.href || '');
      } else if (tag === 'IMG') {
        kind = 'image';
        rawSource = safeText((t.getAttribute && t.getAttribute('src')) || t.currentSrc || t.src || '');
      } else if (tag === 'SOURCE' || tag === 'VIDEO' || tag === 'AUDIO') {
        kind = 'media';
        rawSource = safeText((t.getAttribute && t.getAttribute('src')) || t.currentSrc || t.src || '');
      }
      if (!kind) return null;
      const source = sameOriginHttpSource(rawSource);
      return source ? { kind, source, rawSource } : null;
    } catch (_) {
      return null;
    }
  }

  function closedErrorKind(errorLike, messageLike) {
    const msg = normalizeForMatch(messageLike);
    const rawName = errorLike && typeof errorLike === 'object' && typeof errorLike.name === 'string'
      ? normalizeForMatch(errorLike.name)
      : '';
    if (/not a function|no es una funcion/.test(msg)) return 'not-a-function';
    if (/cannot read (properties|property)|undefined is not an object|null is not an object/.test(msg)) return 'property-access';
    if (/is not defined|no esta definid/.test(msg) || rawName === 'referenceerror') return 'reference';
    if (/failed to fetch|networkerror|network error|load failed|network request failed/.test(msg)) return 'network';
    if (/quotaexceeded|quota exceeded|cuota excedida/.test(msg) || rawName === 'quotaexceedederror') return 'quota';
    if (/aborterror|aborted|abortad/.test(msg) || rawName === 'aborterror') return 'abort';
    if (/securityerror|content security policy|refused to/.test(msg) || rawName === 'securityerror') return 'security';
    if (/json|unexpected token.*position|unterminated.*json/.test(msg) && (rawName === 'syntaxerror' || /parse/.test(msg))) return 'json-parse';
    if (rawName === 'syntaxerror' || /syntaxerror|unexpected token/.test(msg)) return 'syntax';
    if (rawName === 'rangeerror') return 'range';
    if (rawName === 'typeerror') return 'type';
    return 'generic';
  }

  function browserErrorSegment() {
    return eventSegment(getBrowserInfo(), 'unknown');
  }

  function boundedEventSegment(value, fallback, maxLength) {
    return eventSegment(value, fallback).substring(0, maxLength).replace(/-+$/, '') || fallback;
  }

  // ===== RECURRENCIA: distinguir "una pestaña ruidosa" de "un fallo extendido" =====
  // GoatCounter cuenta por path: 11 apariciones y 11 visitantes distintos producen
  // el mismo numero. Meter un id de correlacion en el path lo arreglaria a costa de
  // dejar cada path con count=1, destruyendo la agrupacion que hace util el panel.
  // En su lugar el evento primario conserva TODAS sus apariciones en un unico path
  // y se emiten eventos companeros al cruzar umbrales. Lectura resultante:
  //   11 pestañas con 1 fallo  -> 11 primarios, ningun ge2
  //   1 pestaña con 11 fallos  -> 11 primarios + un ge2 + un ge4 + un ge10
  // El contador vive en sessionStorage (muere con la pestaña, no se transmite y no
  // es un identificador): solo un entero por firma tecnica ya saneada.
  const RECURRENCE_KEY_PREFIX = 'lf_err_rec_';
  const RECURRENCE_THRESHOLDS = [2, 4, 10];
  const RECURRENCE_MAX_KEYS = 24;

  // Devuelve SEGMENTOS sueltos, no una ruta ya unida: buildEventPath sanea cada
  // parte por separado y aplanaria las barras de una cadena pre-unida.
  function recurrenceSignatureParts(family, classification) {
    return [
      boundedEventSegment(family, 'otro', 16),
      boundedEventSegment(classification, 'sin-clase', 48),
      errorBuildSegment(TRACK_BUILD_ID)
    ];
  }

  function bumpRecurrenceCount(signature) {
    try {
      if (!window.sessionStorage) return 0;
      const key = RECURRENCE_KEY_PREFIX + signature;
      const next = (parseInt(sessionStorage.getItem(key), 10) || 0) + 1;
      if (next === 1) {
        // Tope de claves: una pagina patologica no debe llenar sessionStorage.
        let owned = 0;
        for (let i = 0; i < sessionStorage.length; i++) {
          const existing = sessionStorage.key(i);
          if (existing && existing.indexOf(RECURRENCE_KEY_PREFIX) === 0) owned++;
        }
        if (owned >= RECURRENCE_MAX_KEYS) return 0;
      }
      sessionStorage.setItem(key, String(next));
      return next;
    } catch (_) {
      return 0;
    }
  }

  function trackErrorRecurrence(family, classification) {
    const parts = recurrenceSignatureParts(family, classification);
    const count = bumpRecurrenceCount(parts.join('|'));
    if (!count) return;
    // Solo al CRUZAR el umbral, no en cada aparicion posterior.
    if (RECURRENCE_THRESHOLDS.indexOf(count) === -1) return;
    const path = buildEventPath('error-recurrencia', parts.concat(['ge' + count]));
    trackEvent(path, { title: ('Recurrencia en la misma pestaña | ' + path).substring(0, 150) });
  }

  // ===== DESCARTES: contar el ruido filtrado en vez de tirarlo en silencio =====
  // shouldTrackError() sigue descartando exactamente lo mismo que antes; esto solo
  // deja constancia de QUE se descarto y por que, para poder afirmar con datos
  // "este ruido no es nuestro" en vez de suponerlo.
  // Tope determinista, no muestreo aleatorio: una sola extension puede lanzar
  // cientos de excepciones por carga. Con 1 evento por motivo y carga, el contador
  // se lee como "cargas afectadas por este ruido", que es la magnitud util.
  const DISCARD_REASONS_MAX_PER_LOAD = 4;
  const discardReasonsSeen = new Set();

  function trackDiscardedError(reason) {
    const motivo = boundedEventSegment(reason, 'otro', 24);
    if (discardReasonsSeen.has(motivo)) return;
    if (discardReasonsSeen.size >= DISCARD_REASONS_MAX_PER_LOAD) return;
    discardReasonsSeen.add(motivo);
    const path = buildEventPath('error-descartado', [motivo, errorBuildSegment(TRACK_BUILD_ID)]);
    trackEvent(path, { title: ('Error descartado por filtro | ' + path).substring(0, 150) });
  }

  // Precedencia FIJA y probada: los motivos se solapan (un error sin filename
  // tampoco tiene posicion fiable). Se devuelve el primero que aplique, en este
  // orden, para que el mismo caso caiga siempre en el mismo cubo.
  function discardReasonFor(filename, source, route, line, col) {
    const isDocumentSource = source === route ||
      (route === '/' && (source === '/' || source === location.pathname));
    if (isDocumentSource && line <= 1) return 'linea-imposible';
    if (!filename) return 'sin-filename';
    if (!(line > 0 || col > 0)) return 'sin-posicion';
    if (!source || source === '(inline)') return 'inline-sin-origen';
    return 'origen-no-fiable';
  }

  function compactBrowserErrorSegment() {
    const browser = browserErrorSegment();
    const match = browser.match(/^(chrome|firefox|safari|edge)-(\d+)$/);
    if (!match) return browser === 'other' ? 'o' : 'u';
    const prefix = { chrome: 'c', firefox: 'f', safari: 's', edge: 'e' }[match[1]] || 'u';
    return prefix + match[2].substring(0, 3);
  }

  function compactResourceKind(kindLike) {
    const kind = eventSegment(kindLike, 'resource');
    return {
      script: 'js',
      style: 'css',
      preload: 'pre',
      image: 'img',
      media: 'med'
    }[kind] || 'res';
  }

  function compactCacheState(stateLike) {
    const state = safeText(stateLike);
    return {
      'cache-activa-hit': 'ca',
      'cache-otra-hit': 'co',
      'cache-miss': 'cm',
      'cache-error': 'ce',
      'cache-no-api': 'cn',
      'cache-no-source': 'cs',
      'cache-sin-lf': 'cl'
    }[state] || 'cu';
  }

  function compactPerformanceState(stateLike) {
    const state = safeText(stateLike);
    const match = state.match(/^perf-(sw|cache|network)(?:-(\d{1,3}))?$/);
    if (match) {
      const prefix = { sw: 's', cache: 'c', network: 'n' }[match[1]];
      return prefix + (match[2] || '0');
    }
    return {
      'perf-no-api': 'pa',
      'perf-none': 'pn',
      'perf-error': 'pe'
    }[state] || 'pu';
  }

  function compactProbeState(stateLike) {
    const state = safeText(stateLike);
    const match = state.match(/^probe-(\d{1,3})-(js|css|html|json|other)$/);
    if (match) {
      const suffix = { js: 'j', css: 'c', html: 'h', json: 'd', other: 'o' }[match[2]];
      return 'p' + match[1] + suffix;
    }
    return {
      'probe-no-fetch': 'pf',
      'probe-no-source': 'ps',
      'probe-timeout': 'pt',
      'probe-network-error': 'pn'
    }[state] || 'pu';
  }

  function buildResourceErrorContextPath(resource, lineLike, colLike, phaseLike, diagnostic) {
    const details = diagnostic || {};
    // Este esquema usa códigos cerrados y cotas por segmento para que todas las
    // dimensiones quepan completas en los 180 caracteres de GoatCounter. No se
    // usa substring sobre el path final: o están todas las dimensiones o el test
    // de contrato falla.
    const segments = [
      compactResourceKind(resource && resource.kind) + 'l',
      boundedEventSegment(errorFileSegment(resource && resource.source), 'desconocido', 20),
      boundedEventSegment(errorLineSegment(lineLike), '0', 7),
      errorBuildSegment(TRACK_BUILD_ID),
      boundedEventSegment(errorColumnSegment(colLike), 'c0', 8),
      boundedEventSegment(currentPageKey(), 'pagina', 12),
      phaseLike === 'early' ? 'e' : 'r',
      compactBrowserErrorSegment(),
      details.online === 'offline' ? 'off' : 'on',
      details.swControlled === 'sw-si' ? 'sw1' : 'sw0',
      boundedEventSegment(details.swVersion, 'sw-u', 15),
      compactCacheState(details.cacheState),
      boundedEventSegment(details.cacheVersion, 'cv-u', 15),
      compactPerformanceState(details.performanceState),
      compactProbeState(details.probeState)
    ];
    const path = ['error-context'].concat(segments).join('/');
    if (path.length > EVENT_PATH_MAX_LENGTH) {
      // Defensa de futuro: no emitir un contexto parcial si alguien amplía un
      // código sin actualizar el contrato. El primario ya se emitió y queda en
      // outbox; este fallo de desarrollo se hace visible durante tests/debug.
      dbg('Contexto de recurso excede el límite:', path.length, path);
      return buildEventPath('error-context', ['resource-schema-overflow', errorBuildSegment(TRACK_BUILD_ID)]);
    }
    return path;
  }

  function emitResourceErrorContext(resource, lineLike, colLike, phaseLike, diagnostic) {
    const path = buildResourceErrorContextPath(resource, lineLike, colLike, phaseLike, diagnostic);
    trackEvent(path, { title: ('Contexto recurso cerrado | ' + path).substring(0, 150) });
  }

  function buildErrorContextPath(kind, sourceLike, lineLike, colLike, errorKind, extra) {
    const detail = [
      kind,
      errorFileSegment(sourceLike),
      errorLineSegment(lineLike),
      errorBuildSegment(TRACK_BUILD_ID),
      errorColumnSegment(colLike),
      currentPageKey(),
      errorKind || 'generic',
      browserErrorSegment()
    ];
    if (Array.isArray(extra)) detail.push(...extra);
    return buildEventPath('error-context', detail);
  }

  function emitErrorContext(kind, sourceLike, lineLike, colLike, errorKind, extra) {
    const path = buildErrorContextPath(kind, sourceLike, lineLike, colLike, errorKind, extra);
    trackEvent(path, {
      title: ('Contexto cerrado | ' + path).substring(0, 150)
    });
  }

  function resourcePerformanceState(rawSource) {
    try {
      if (!performance || typeof performance.getEntriesByName !== 'function') return 'perf-no-api';
      const absolute = new URL(rawSource, location.href).href;
      const entries = performance.getEntriesByName(absolute);
      if (!entries || !entries.length) return 'perf-none';
      const entry = entries[entries.length - 1];
      const status = Number(entry.responseStatus);
      const via = Number(entry.workerStart) > 0
        ? 'sw'
        : (Number(entry.transferSize) === 0 ? 'cache' : 'network');
      return 'perf-' + via + (status > 0 ? '-' + String(Math.floor(status)) : '');
    } catch (_) {
      return 'perf-error';
    }
  }

  function getControllerVersionForDiagnostic() {
    return new Promise((resolve) => {
      try {
        const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!controller) {
          resolve('sin-sw');
          return;
        }
        if (typeof MessageChannel !== 'function') {
          resolve('sw-desconocido');
          return;
        }
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          const version = event && event.data && event.data.version;
          finish(errorBuildSegment(version) === 'desconocido' ? 'sw-legacy' : String(version));
        };
        channel.port1.onmessageerror = () => finish('sw-error');
        controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        setTimeout(() => finish('sw-timeout'), 700);
      } catch (_) {
        resolve('sw-error');
      }
    });
  }

  async function getResourceCacheDiagnostic(sourceLike, swVersion) {
    try {
      if (!window.caches || typeof window.caches.keys !== 'function') return ['cache-no-api', 'cache-desconocida'];
      const pathname = sameOriginHttpSource(sourceLike);
      if (!pathname) return ['cache-no-source', 'cache-desconocida'];
      const keys = (await window.caches.keys()).filter((key) => /^luzfija-static-\d{8}-\d{6}$/.test(key));
      if (!keys.length) return ['cache-sin-lf', 'cache-desconocida'];
      const expectedKey = /^\d{8}-\d{6}$/.test(swVersion) ? 'luzfija-static-' + swVersion : '';
      const ordered = expectedKey
        ? [expectedKey].concat(keys.filter((key) => key !== expectedKey))
        : keys;
      for (const key of ordered) {
        if (!keys.includes(key)) continue;
        const cache = await window.caches.open(key);
        const match = await cache.match(new Request(new URL(pathname, location.origin).href));
        if (!match) continue;
        const version = key.replace(/^luzfija-static-/, '');
        return [key === expectedKey ? 'cache-activa-hit' : 'cache-otra-hit', version];
      }
      return ['cache-miss', 'cache-desconocida'];
    } catch (_) {
      return ['cache-error', 'cache-desconocida'];
    }
  }

  async function probeFailedResource(rawSource) {
    if (typeof fetch !== 'function') return 'probe-no-fetch';
    let timer = null;
    try {
      const url = new URL(rawSource, location.href);
      if (url.origin !== location.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return 'probe-no-source';
      // El SW reconoce esta marca y hace un fetch de red puro, sin leer ni
      // escribir Cache Storage. Sin este bypass la sonda mediría el fallback
      // del propio SW y podría contaminar el diagnóstico que intenta explicar.
      url.searchParams.set('__lfprobe', '1');
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) timer = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(url.href, {
        cache: 'reload',
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined,
        __lfDiagnosticProbe: true
      });
      const contentType = safeText(response.headers && response.headers.get('content-type')).toLowerCase();
      const type = /javascript|ecmascript/.test(contentType)
        ? 'js'
        : (/text\/css/.test(contentType)
            ? 'css'
            : (/text\/html/.test(contentType) ? 'html' : (/[/+]json\b/.test(contentType) ? 'json' : 'other')));
      return 'probe-' + String(response.status || 0) + '-' + type;
    } catch (error) {
      return error && error.name === 'AbortError' ? 'probe-timeout' : 'probe-network-error';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function scheduleResourceErrorContext(resource, line, col, phase) {
    if (!resource || !resource.source) return;
    if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) return;
    const online = navigator.onLine === false ? 'offline' : 'online';
    const swControlled = navigator.serviceWorker && navigator.serviceWorker.controller ? 'sw-si' : 'sw-no';
    const perf = resourcePerformanceState(resource.rawSource || resource.source);
    getControllerVersionForDiagnostic().then(async (swVersion) => {
      // Capturar el estado antes de la sonda es parte del contrato: incluso con
      // bypass de SW evita que una regresión futura convierta un miss en hit.
      const cache = await getResourceCacheDiagnostic(resource.source, swVersion);
      if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) return;
      const probeState = await probeFailedResource(resource.rawSource || resource.source);
      emitResourceErrorContext(resource, line, col, phase, {
        online,
        swControlled,
        swVersion,
        cacheState: cache[0],
        cacheVersion: cache[1],
        performanceState: perf,
        probeState
      });
    }).catch(() => {
      emitResourceErrorContext(resource, line, col, phase, {
        online,
        swControlled,
        swVersion: 'diag-error',
        cacheState: 'cache-error',
        cacheVersion: 'cache-desconocida',
        performanceState: perf,
        probeState: 'probe-network-error'
      });
    });
  }

  function shouldTrackError(filename, source, scriptSource, route, line, col) {
    // Error de carga de <script src="..."> de nuestro origen.
    if (scriptSource) return true;

    const isDocumentSource = source === route ||
      (route === '/' && (source === '/' || source === location.pathname));
    if (isDocumentSource) {
      // GitHub Pages sirve los HTML del repo sin compactarlos: la linea 1 es
      // siempre el DOCTYPE y ningun script ejecutable propio puede originarse
      // ahi. Extensiones, webviews y automatizaciones pueden inyectar codigo y
      // atribuir su SyntaxError a la URL del documento (p. ej. /:1:219). Sin
      // este guard ese ruido parece first-party aunque el JS real siga sano.
      if (line <= 1) return false;
      return true;
    }

    // Error en archivo JS servido por nosotros. Esta comprobacion debe ir
    // despues de la del documento: la propia pagina tambien es same-origin.
    if (filename && isSameOriginUrl(filename)) return true;

    // Evitar ruido: sin filename + sin source fiable suele venir de extensiones/terceros.
    if (!filename) return false;

    // Inline sin URL del documento o sin posición válida: origen no fiable.
    const hasPos = (line > 0 || col > 0);
    if (!hasPos) return false;
    if (!source || source === '(inline)') return false;
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

  function extractSourcePartsFromStack(stackLike) {
    const stack = safeText(stackLike);
    if (!stack) return null;
    try {
      // Chrome/Edge/Safari: at fn (url:line:col) / at url:line:col
      // Firefox: fn@url:line:col
      const m = stack.match(/((?:https?:\/\/|\/)[^\s)@]+):(\d+):(\d+)/);
      if (!m) return null;
      const src = shortSource(m[1]);
      if (!src) return null;
      return { source: src, line: m[2], col: m[3] };
    } catch (_) {
      return null;
    }
  }

  function formatStackSource(parts) {
    return parts ? parts.source + ':' + parts.line + ':' + parts.col : '';
  }

  // Clasificacion EXPLICITA del origen de un stack antes de intentar extraer
  // URLs http(s). Sin esto, un frame `chrome-extension://id/inject.js:1:1` solo
  // se filtraba porque la regex de extractRawUrlFromStack capturaba `//id/...`
  // como URL protocol-relative que luego resolvia a otro origen: funcionaba por
  // accidente y cualquier retoque de la regex podia colar ruido de extensiones
  // como si fuera codigo propio.
  function stackOriginKind(stackLike) {
    const stack = safeText(stackLike);
    if (!stack) return 'sin-stack';
    if (/\b(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i.test(stack)) return 'extension';
    const rawUrl = extractRawUrlFromStack(stack);
    if (!rawUrl) return 'sin-stack';
    return isSameOriginUrl(rawUrl) ? 'same-origin' : 'cross-origin';
  }

  // URL cruda (sin linea:col) del primer frame del stack, o '' si no hay.
  // Sirve para decidir si una Promise rejection viene de un script de tercero
  // (extension, content-blocker) y no de nuestro propio codigo.
  function extractRawUrlFromStack(stackLike) {
    const stack = safeText(stackLike);
    if (!stack) return '';
    try {
      const m = stack.match(/((?:https?:\/\/|\/)[^\s)@]+):(\d+):(\d+)/);
      return m ? m[1] : '';
    } catch (_) {
      return '';
    }
  }

  // Las promesas rechazadas sin stack no tienen fichero/línea. No usar el
  // mensaje libre en el path: podría contener datos del usuario y generaría
  // cardinalidad ilimitada. Estas firmas cerradas separan las familias útiles
  // sin exponer texto, URL, nombres de archivo ni valores introducidos.
  function stacklessPromiseKind(reason, messageLike) {
    const msg = normalizeForMatch(messageLike);
    const rawName = reason && typeof reason === 'object' && typeof reason.name === 'string'
      ? normalizeForMatch(reason.name)
      : '';

    if (/dynamic import|importing a module|module script|failed to fetch dynamically imported/.test(msg)) return 'dynamic-import';
    if (/failed to fetch|networkerror|network error|load failed|network request failed/.test(msg)) return 'network';
    if (/aborterror|aborted|abortad/.test(msg) || rawName === 'aborterror') return 'abort';
    if (/quotaexceeded|quota exceeded|cuota excedida/.test(msg) || rawName === 'quotaexceedederror') return 'quota';
    if (/json|unexpected token.*position|unterminated.*json/.test(msg) && (rawName === 'syntaxerror' || /parse/.test(msg))) return 'json-parse';
    if (/not a function|no es una funcion/.test(msg)) return 'not-a-function';
    if (/cannot read (properties|property)|undefined is not an object|null is not an object/.test(msg)) return 'property-access';
    if (/is not defined|no esta definid/.test(msg) || rawName === 'referenceerror') return 'reference';
    if (rawName === 'typeerror') return 'type-error';
    if (rawName === 'syntaxerror') return 'syntax-error';
    if (rawName === 'rangeerror') return 'range-error';
    if (reason instanceof Error) return 'error';
    if (reason && typeof reason === 'object') return 'object';
    if (typeof reason === 'string') return 'string';
    if (reason === null || reason === undefined) return 'desconocido';
    return 'primitive';
  }

  function networkResourceKind(pathname) {
    const path = safeText(pathname).toLowerCase();
    if (/\/data\/pvpc\//.test(path)) return 'pvpc-data';
    if (/\/data\/surplus\//.test(path)) return 'surplus-data';
    if (/\/data\/ssaa\//.test(path)) return 'ssaa-data';
    if (/tarifas\.json$/.test(path)) return 'tarifas';
    if (/\.json$/.test(path)) return 'json';
    if (/\.csv$/.test(path)) return 'csv';
    if (/\.html?$/.test(path) || path.endsWith('/')) return 'html';
    if (/\.js$/.test(path)) return 'script';
    if (/\.css$/.test(path)) return 'style';
    return 'other';
  }

  function fetchDiagnosticReason(value) {
    const reason = eventSegment(value, 'direct');
    return new Set(['startup', 'calculate', 'focus', 'visible', 'online', 'interval', 'direct']).has(reason)
      ? reason
      : 'direct';
  }

  function fetchDiagnosticAttempt(value) {
    if (value === 'a1' || value === 'a2') return value;
    const attempt = Number(value);
    return attempt === 1 || attempt === 2 ? 'a' + attempt : 'a0';
  }

  function currentVisibilityDiagnostic() {
    const state = safeText(document && document.visibilityState).toLowerCase();
    return new Set(['visible', 'hidden', 'prerender']).has(state) ? state : 'unknown';
  }

  function buildFetchErrorContextPath(source, statusSegment, diagnostic) {
    const details = diagnostic || {};
    const segments = [
      'fetch',
      boundedEventSegment(networkResourceKind(source), 'other', 16),
      boundedEventSegment(errorFileSegment(source), 'desconocido', 20),
      boundedEventSegment(statusSegment, 'error', 12),
      errorBuildSegment(TRACK_BUILD_ID),
      boundedEventSegment(currentPageKey(), 'pagina', 12),
      fetchDiagnosticReason(details.reason),
      fetchDiagnosticAttempt(details.attempt),
      boundedEventSegment(details.visibility, 'unknown', 9),
      boundedEventSegment(details.lifecycle, 'active', 10),
      boundedEventSegment(details.errorKind, 'generic', 18),
      details.online === 'offline' ? 'off' : 'on',
      details.swControlled === 'sw-si' ? 'sw1' : 'sw0',
      boundedEventSegment(details.swVersion, 'sw-u', 15),
      compactPerformanceState(details.performanceState),
      compactProbeState(details.probeState),
      compactBrowserErrorSegment()
    ];
    const path = ['error-context'].concat(segments).join('/');
    if (path.length > EVENT_PATH_MAX_LENGTH) {
      dbg('Contexto fetch excede el límite:', path.length, path);
      return buildEventPath('error-context', ['fetch-schema-overflow', errorBuildSegment(TRACK_BUILD_ID)]);
    }
    return path;
  }

  function emitFetchFailureContext(source, statusSegment, diagnostic) {
    const path = buildFetchErrorContextPath(source, statusSegment, diagnostic);
    trackEvent(path, { title: ('Contexto fetch cerrado | ' + path).substring(0, 150) });
  }

  function scheduleFetchFailureContext(rawUrl, source, statusSegment, captured) {
    if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) return;
    const initial = captured || {};
    Promise.all([
      getControllerVersionForDiagnostic(),
      probeFailedResource(rawUrl || source)
    ]).then((result) => {
      emitFetchFailureContext(source, statusSegment, Object.assign({}, initial, {
        swVersion: result[0],
        probeState: result[1]
      }));
    }).catch(() => {
      emitFetchFailureContext(source, statusSegment, Object.assign({}, initial, {
        swVersion: 'diag-error',
        probeState: 'probe-network-error'
      }));
    });
  }

  function buildNetworkErrorPath(source, statusSegment, diagnostic) {
    const details = diagnostic || {};
    const segments = [
      boundedEventSegment(networkResourceKind(source), 'other', 16),
      boundedEventSegment(errorFileSegment(source), 'desconocido', 20),
      boundedEventSegment(statusSegment, 'error', 12),
      boundedEventSegment(currentPageKey(), 'pagina', 12),
      errorBuildSegment(TRACK_BUILD_ID),
      fetchDiagnosticReason(details.reason),
      fetchDiagnosticAttempt(details.attempt),
      boundedEventSegment(details.visibility, 'unknown', 9),
      boundedEventSegment(details.lifecycle, 'active', 10),
      boundedEventSegment(details.errorKind, 'generic', 18),
      details.online === 'offline' ? 'offline' : 'online',
      details.swControlled === 'sw-si' ? 'sw-si' : 'sw-no',
      boundedEventSegment(browserErrorSegment(), 'other', 12)
    ];
    const path = ['error-network'].concat(segments).join('/');
    if (path.length > EVENT_PATH_MAX_LENGTH) {
      dbg('Diagnóstico de red excede el límite:', path.length, path);
      return buildEventPath('error-network', ['network-schema-overflow', errorBuildSegment(TRACK_BUILD_ID)]);
    }
    return path;
  }

  function reportFetchFailure(url, statusLike, failureKind, metadata) {
    try {
      if (window.__LF_PRIVACY_MODE === true || window.__LF_FACTURA_BUSY === true) return;
      const source = sameOriginHttpSource(url);
      if (!source) return;
      const status = Number(statusLike);
      const statusSegment = status > 0 && status < 600 ? 'http-' + Math.floor(status) : failureKind;
      const info = metadata || {};
      const online = navigator.onLine === false ? 'offline' : 'online';
      const swControlled = navigator.serviceWorker && navigator.serviceWorker.controller ? 'sw-si' : 'sw-no';
      const reason = fetchDiagnosticReason(info.reason);
      const attempt = fetchDiagnosticAttempt(info.attempt);
      const visibility = currentVisibilityDiagnostic();
      const lifecycle = pageLifecycleState;
      const errorKind = info.errorKind || 'generic';

      // Un fetch abortado porque la página se está destruyendo no demuestra una
      // incidencia de disponibilidad. Tampoco los refrescos silenciosos: la
      // home los repite al recuperar foco/visibilidad/conexión, por lo que
      // convertirlos en `error-network` contaminaba la señal con fallos que no
      // interrumpían ninguna acción del usuario.
      if (lifecycle !== 'active' || BACKGROUND_FETCH_REASONS.has(reason)) return;

      const path = buildNetworkErrorPath(source, statusSegment, {
        reason,
        attempt,
        visibility,
        lifecycle,
        errorKind,
        online,
        swControlled
      });
      trackEvent(path, { title: ('Fallo fetch first-party | ' + path).substring(0, 150) });
      scheduleFetchFailureContext(url, source, statusSegment, {
        reason,
        attempt,
        visibility,
        lifecycle,
        errorKind,
        online,
        swControlled,
        performanceState: resourcePerformanceState(url || source)
      });
    } catch (_) {}
  }

  function installFetchDiagnostics() {
    if (typeof window.fetch !== 'function' || window.fetch.__lfDiagnosticWrapped === true) return;
    const nativeFetch = window.fetch;
    const wrappedFetch = function (input, init) {
      const rawUrl = typeof input === 'string' || input instanceof URL
        ? String(input)
        : (input && typeof input.url === 'string' ? input.url : '');
      const isProbe = !!(init && init.__lfDiagnosticProbe === true);
      const reason = fetchDiagnosticReason(init && init.__lfDiagnosticReason);
      const attempt = fetchDiagnosticAttempt(init && init.__lfDiagnosticAttempt);
      const trackAbort = !!(init && init.__lfDiagnosticTrackAbort === 'timeout');
      let nativeInit = init;
      if (init && typeof init === 'object' &&
          (Object.prototype.hasOwnProperty.call(init, '__lfDiagnosticProbe') ||
           Object.prototype.hasOwnProperty.call(init, '__lfDiagnosticReason') ||
           Object.prototype.hasOwnProperty.call(init, '__lfDiagnosticAttempt') ||
           Object.prototype.hasOwnProperty.call(init, '__lfDiagnosticTrackAbort'))) {
        nativeInit = Object.assign({}, init);
        delete nativeInit.__lfDiagnosticProbe;
        delete nativeInit.__lfDiagnosticReason;
        delete nativeInit.__lfDiagnosticAttempt;
        delete nativeInit.__lfDiagnosticTrackAbort;
      }
      let result;
      try {
        result = nativeFetch.call(this, input, nativeInit);
      } catch (error) {
        if (!isProbe && (trackAbort || !error || error.name !== 'AbortError')) {
          reportFetchFailure(rawUrl, 0, trackAbort && error && error.name === 'AbortError' ? 'timeout' : 'throw', {
            reason,
            attempt,
            errorKind: trackAbort && error && error.name === 'AbortError'
              ? 'timeout'
              : closedErrorKind(error, error && error.message)
          });
        }
        throw error;
      }
      if (!result || typeof result.then !== 'function') return result;
      return result.then((response) => {
        if (!isProbe && response && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          reportFetchFailure(rawUrl || response.url, response.status, 'http-error', {
            reason,
            attempt,
            errorKind: 'http'
          });
        }
        return response;
      }, (error) => {
        if (!isProbe && (trackAbort || !error || error.name !== 'AbortError')) {
          reportFetchFailure(rawUrl, 0, trackAbort && error && error.name === 'AbortError' ? 'timeout' : 'rejected', {
            reason,
            attempt,
            errorKind: trackAbort && error && error.name === 'AbortError'
              ? 'timeout'
              : closedErrorKind(error, error && error.message)
          });
        }
        throw error;
      });
    };
    wrappedFetch.__lfDiagnosticWrapped = true;
    wrappedFetch.__lfNativeFetch = nativeFetch;
    window.fetch = wrappedFetch;
  }

  installFetchDiagnostics();
  window.__LF_reportNetworkFailure = reportFetchFailure;

  // ===== EVENTOS AUTOMÁTICOS (no requieren modificar app.js) =====
  window.addEventListener('DOMContentLoaded', function() {

    // Cargar GoatCounter en cuanto el DOM está listo para registrar el page view de todos los visitantes.
    // count.js envía el page view automáticamente al cargarse (no_onload no está activo).
    ensureGoatCounterLoaded().then((ok) => {
      if (ok) flushQueue();
      else scheduleGoatRetry();
    });

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

      const solarTooltip = target.closest('#tbody .fv-icon, #tbody .requisitos-icon, #tbody .te-warn-icon, #tbody .promo-badge');
      if (solarTooltip) {
        const tarifaNombre = tarifaNameFromContext(solarTooltip) || 'Desconocida';
        const kind = solarTooltip.classList.contains('fv-icon') ? 'solar-bv' :
          (solarTooltip.classList.contains('promo-badge') ? 'promocion' :
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

      const systemButton = target.closest('#btnClearCache, #scrollToResults, [data-install-pwa]');
      if (systemButton) {
        const actionMap = {
          btnClearCache: 'limpiar-cache',
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
        const monthSegment = solarStartMonthSegment(mesInicioItem.dataset.value);
        trackDetailedEvent('simulador-solar-mes-inicio', monthSegment, {
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
        const limitSegment = bonoSocialLimitSegment(target.value);
        trackDetailedEvent('comparador-bono-social-limite', limitSegment, {
          title: 'Bono social límite: ' + limitSegment
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
      // Se marca el objeto Event, no su fingerprint: evita duplicados si el
      // listener se reinstala, pero una aparicion real nueva siempre cuenta.
      if (e && typeof e === 'object') {
        if (handledErrorEvents.has(e)) return;
        handledErrorEvents.add(e);
      }
      const filename = e && e.filename ? String(e.filename) : '';
      const message = sanitizeErrorMessageForTracking(e && e.message ? e.message : 'desconocido');
      const errorObject = e && e.error && typeof e.error === 'object' ? e.error : null;
      const errorStack = errorObject && typeof errorObject.stack === 'string' ? errorObject.stack : '';
      const stackParts = extractSourcePartsFromStack(errorStack);
      const rawStackUrl = extractRawUrlFromStack(errorStack);
      const trustedStackSource = rawStackUrl && isSameOriginUrl(rawStackUrl) ? stackParts : null;
      const sourceFromFile = shortSource(filename);
      const resource = getResourceFromErrorEvent(e);
      const scriptSource = resource && resource.kind === 'script' ? resource.source : '';
      const source = (resource && resource.source) || sourceFromFile ||
        (trustedStackSource && trustedStackSource.source) || '(inline)';
      const line = (e && typeof e.lineno === 'number' && e.lineno > 0)
        ? e.lineno
        : (trustedStackSource ? trustedStackSource.line : 0);
      const col = (e && typeof e.colno === 'number' && e.colno > 0)
        ? e.colno
        : (trustedStackSource ? trustedStackSource.col : 0);
      const route = safeText(location && location.pathname ? location.pathname : '');
      const browser = getBrowserInfo();

      if (isLegacyIndexExtraCompatNoise(message) || isPromiseStaleNoise(message)) {
        dbg('Error JS legacy filtrado:', message);
        const legacyKind = getLegacyNoiseKind(message);
        trackEvent(legacyNoiseEventPath(legacyKind), {
          title: buildLegacyNoiseTitle(legacyKind, 'error-javascript', 'window.error')
        });
        return;
      }

      if (!resource && !shouldTrackError(filename || rawStackUrl, source, scriptSource, route, line, col)) {
        dbg('Error ignorado (origen no fiable):', message, filename || '(sin filename)');
        trackDiscardedError(discardReasonFor(filename || rawStackUrl, source, route, line, col));
        return;
      }

      const eventBase = scriptSource
        ? 'error-script-load'
        : (resource ? 'error-resource-load' : 'error-javascript');
      const errorLabel = scriptSource
        ? 'Carga de script fallida'
        : (resource ? 'Carga de recurso fallida: ' + resource.kind : 'Error JS: ' + closedErrorKind(errorObject, message));
      const parts = [
        errorLabel,
        source + ':' + line + (col ? ':' + col : ''),
        'b:' + TRACK_BUILD_ID
      ];
      if (resource) {
        parts.push('online:' + (navigator.onLine === false ? 'no' : 'si'));
        parts.push('sw:' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'si' : 'no'));
      }
      if (route && route !== '/') parts.push('@' + route);
      parts.push(browser);

      const primaryPath = buildErrorEventPath(eventBase, source, line);
      trackEvent(primaryPath, {
        title: parts.join(' | ').substring(0, 150)
      });
      trackErrorRecurrence(eventBase.replace(/^error-/, ''), errorFileSegment(source) + '-' + errorLineSegment(line));

      if (resource) {
        scheduleResourceErrorContext(resource, line, col, 'runtime');
      } else {
        emitErrorContext(
          'javascript',
          source,
          line,
          col,
          closedErrorKind(errorObject, message),
          [document.readyState === 'loading' ? 'loading' : 'ready']
        );
      }
    }catch(_){}
  }, true);

  window.addEventListener('securitypolicyviolation', function (event) {
    try {
      if (event && typeof event === 'object') {
        if (handledCspEvents.has(event)) return;
        handledCspEvents.add(event);
      }
      if (isAnalyticsEndpointCspViolation(event)) return;
      const directive = eventSegment(
        event && (event.effectiveDirective || event.violatedDirective),
        'directiva-desconocida'
      );
      const disposition = eventSegment(event && event.disposition, 'enforce');
      const targetDiagnostic = cspTargetDiagnostic(event);
      const sourceDiagnostic = cspSourceDiagnostic(event);
      const segments = [
        boundedEventSegment(directive, 'directiva', 32),
        boundedEventSegment(targetDiagnostic[0], 'sin-uri', 24),
        boundedEventSegment(targetDiagnostic[1], 'sin-host', 40),
        boundedEventSegment(sourceDiagnostic[0], 'sin-source', 16),
        boundedEventSegment(sourceDiagnostic[1], 'sin-source', 20),
        boundedEventSegment(sourceDiagnostic[2], '0', 7),
        boundedEventSegment(disposition, 'enforce', 10),
        boundedEventSegment(currentPageKey(), 'pagina', 12),
        errorBuildSegment(TRACK_BUILD_ID),
        boundedEventSegment(browserErrorSegment(), 'other', 12)
      ];
      const candidatePath = ['error-csp'].concat(segments).join('/');
      const path = candidatePath.length > EVENT_PATH_MAX_LENGTH
        ? buildEventPath('error-csp', ['csp-schema-overflow', errorBuildSegment(TRACK_BUILD_ID)])
        : candidatePath;
      trackEvent(path, { title: ('Violación CSP | ' + path).substring(0, 150) });
      trackErrorRecurrence('csp', [
        boundedEventSegment(directive, 'directiva', 32),
        boundedEventSegment(targetDiagnostic[0], 'sin-uri', 24),
        boundedEventSegment(targetDiagnostic[1], 'sin-host', 40)
      ].join('-'));
    } catch (_) {}
  });

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

  function isKnownExtensionPromiseNoise(msg) {
    // Safari/WebKit puede entregar rechazos de extensiones sin stack. LuzFija
    // no usa browser.runtime; esta firma procede de mensajeria de extensiones.
    return normalizeForMatch(msg).indexOf('invalid call to runtime.sendmessage') !== -1;
  }

  // Capturar errores de Promises no manejadas (crítico para PVPC/PDF)
  window.addEventListener('unhandledrejection', function(e) {
    try {
      if (e && typeof e === 'object') {
        if (handledPromiseEvents.has(e)) return;
        handledPromiseEvents.add(e);
      }
      // `reason` puede ser deliberadamente falsy (Promise.reject(), null, 0,
      // false o ''). Con `e.reason ? ...` todos acababan convertidos en la
      // cadena "unknown" y clasificados erróneamente como `string`.
      const reason = e && 'reason' in e ? e.reason : undefined;
      const route = safeText(location && location.pathname ? location.pathname : '');
      const browser = getBrowserInfo();

      let msg = '';
      let stackSource = '';
      let stackParts = null;
      let rawStack = '';
      if (reason instanceof Error) {
        msg = sanitizeErrorMessageForTracking(reason.message || reason.name || 'Error');
        rawStack = reason.stack || '';
        stackParts = extractSourcePartsFromStack(rawStack);
        stackSource = formatStackSource(stackParts);
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
          rawStack = reason.stack;
          stackParts = extractSourcePartsFromStack(rawStack);
          stackSource = formatStackSource(stackParts);
        }
      } else {
        msg = sanitizeErrorMessageForTracking(reason);
      }
      if (!msg) msg = 'unknown';

      // Filtrar ruido de cache viejo (código ya corregido, solo llega desde SW antiguo)
      if (isLegacyIndexExtraCompatNoise(msg) || isPromiseStaleNoise(msg)) {
        if (DEBUG) dbg('Promise rejection ignorada (stale cache):', msg);
        const legacyKind = getLegacyNoiseKind(msg);
        trackEvent(legacyNoiseEventPath(legacyKind), {
          title: buildLegacyNoiseTitle(legacyKind, 'error-promise', 'unhandledrejection')
        });
        return;
      }

      if (isKnownExtensionPromiseNoise(msg)) {
        if (DEBUG) dbg('Promise rejection de extension ignorada:', msg);
        trackDiscardedError('extension');
        return;
      }

      // Descartar rechazos originados en scripts de terceros (extensiones,
      // content-blockers). Solo se filtra cuando el stack apunta a una URL de
      // OTRO origen; si no hay stack o es de nuestro dominio se rastrea igual.
      const originKind = stackOriginKind(rawStack);
      if (originKind === 'extension' || originKind === 'cross-origin') {
        if (DEBUG) dbg('Promise rejection de tercero ignorada:', msg, originKind);
        trackDiscardedError(originKind === 'extension' ? 'extension' : 'stack-cross-origin');
        return;
      }

      // promiseCategory: SIEMPRE una clasificacion cerrada (para el title, la "causa").
      // promiseSource: origen/fichero para el path (con stack) o la misma categoria cerrada
      // si no hay stack. No confundir un basename de fichero con una categoria de causa.
      const promiseCategory = stackParts ? closedErrorKind(reason, msg) : stacklessPromiseKind(reason, msg);
      const promiseSource = stackParts ? stackParts.source : promiseCategory;
      const parts = [
        'Promise: ' + promiseCategory,
        'b:' + TRACK_BUILD_ID
      ];
      if (stackSource) parts.push(stackSource);
      if (route && route !== '/') parts.push('@' + route);
      parts.push(browser);

      trackEvent(buildErrorEventPath(
        'error-promise',
        promiseSource,
        stackParts ? stackParts.line : 0
      ), {
        title: parts.join(' | ').substring(0, 150)
      });

      emitErrorContext(
        'promise',
        stackParts ? stackParts.source : stacklessPromiseKind(reason, msg),
        stackParts ? stackParts.line : 0,
        stackParts ? stackParts.col : 0,
        stackParts ? closedErrorKind(reason, msg) : stacklessPromiseKind(reason, msg),
        [document.readyState === 'loading' ? 'loading' : 'ready']
      );

      if (DEBUG) {
        dbg('Unhandled Promise rejection:', reason);
      }
    } catch(_) {}
  });

  // Consumir el buffer mínimo instalado antes de config/theme. Marcar primero
  // el listener como listo evita que el bootstrap vuelva a encolar un error que
  // ya puede procesar el listener normal de tracking.js.
  window.__LF_TRACKING_ERROR_READY = true;
  try {
    const earlyErrors = Array.isArray(window.__LF_EARLY_ERRORS)
      ? window.__LF_EARLY_ERRORS.splice(0)
      : [];
    earlyErrors.forEach((entry) => {
      if (!entry || !entry.source) return;
      const isScriptLoad = entry.kind === 'script-load';
      const isResourceLoad = isScriptLoad || /-load$/.test(safeText(entry.kind));
      const resourceKind = isScriptLoad
        ? 'script'
        : safeText(entry.kind).replace(/-load$/, '');
      const source = shortSource(entry.source) || entry.source;
      const line = Number(entry.line) > 0 ? Number(entry.line) : 0;
      const col = Number(entry.col) > 0 ? Number(entry.col) : 0;
      // Defensa para clientes que mezclen un error-bootstrap antiguo con el
      // tracking nuevo: no confiar ciegamente en lo que ya estuviera en cola.
      if (!isResourceLoad && source === location.pathname && line <= 1) return;
      const label = isScriptLoad
        ? 'Carga temprana de script fallida'
        : (isResourceLoad ? 'Carga temprana de recurso fallida' : 'Error JS temprano');
      const origin = currentPageKey();
      const online = navigator.onLine === false ? 'no' : 'si';
      const swControlled = navigator.serviceWorker && navigator.serviceWorker.controller ? 'si' : 'no';
      const browser = getBrowserInfo();
      trackEvent(buildErrorEventPath(
        isScriptLoad ? 'error-script-load' : (isResourceLoad ? 'error-resource-load' : 'error-javascript'),
        source,
        line
      ), {
        title: [
          label,
          `${source}:${line}${col ? ':' + col : ''}`,
          `origen:${origin}`,
          `online:${online}`,
          `sw:${swControlled}`,
          `b:${TRACK_BUILD_ID}`,
          browser
        ].join(' | ')
      });

      if (isResourceLoad) {
        scheduleResourceErrorContext({ kind: resourceKind, source, rawSource: source }, line, col, 'early');
      } else {
        emitErrorContext('javascript', source, line, col, 'early', ['loading']);
      }
    });
  } catch (_) {}

})();
