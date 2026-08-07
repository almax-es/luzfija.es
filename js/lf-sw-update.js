/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: Service Worker update (agresivo, compartido) =====
// Lógica única de registro + auto-update + guard de recarga del SW.
// Consumidores: lf-app.js (home, swUrl 'sw.js' + lfDbg) y shell-lite.js
// (solar/estadísticas, swUrl '/sw.js', sin logging). Este fichero debe
// cargarse ANTES que ellos en el HTML (todos con defer, el orden se respeta).

(function () {
  'use strict';

  window.LF = window.LF || {};

  // opts.swUrl: URL del service worker a registrar ('sw.js' o '/sw.js').
  // opts.dbg:   logger opcional (lfDbg en la home); por defecto no-op.
  window.LF.initSwUpdate = function initSwUpdate(opts) {
    if (!('serviceWorker' in navigator)) return;

    const swUrl = (opts && opts.swUrl) || '/sw.js';
    const dbg = (opts && typeof opts.dbg === 'function') ? opts.dbg : function () {};

    // Guardamos si ya había controlador al inicio para distinguir primera instalación de actualización
    const hadController = !!navigator.serviceWorker.controller;
    const SW_UPDATE_INTERVAL_MS = 15 * 60 * 1000; // 15 min
    const SW_UPDATE_THROTTLE_MS = 15 * 1000; // evitar doble disparo (focus+visible)
    // Ventana tras la carga en la que NO auto-recargamos: la página acaba de venir
    // de red con assets del deploy vigente, y recargar aquí provocaría la "doble
    // carga" visible al entrar. Pasada la ventana, la recarga vuelve a permitirse.
    const SW_RELOAD_SUPPRESS_MS = 10 * 1000;
    // No recargar mientras el usuario está activo (formularios, scroll…). Es una
    // ventana deslizante, no un bloqueo permanente: al quedar inactivo, la recarga
    // pendiente se re-evalúa en visible/focus/interval.
    const SW_INTERACTION_IDLE_MS = 30 * 1000;
    const SW_VERSION_TIMEOUT_MS = 1000;
    let swReg = null;
    let lastSwCheck = 0;
    let lastInteractionAt = 0;
    // La página queda "stale" cuando un SW nuevo toma control y la recarga se
    // difiere (usuario activo, pestaña oculta, recién cargada). Se re-evalúa después.
    let pageIsStale = false;
    let reloadCheckInFlight = false;
    let staleReloadTimer = null;
    let initRecoveryChain = Promise.resolve();
    const handledInitRecoveries = new Set();
    const swLoadSuppressUntil = Date.now() + SW_RELOAD_SUPPRESS_MS;
    // Guard anti-bucle por VERSIÓN real del SW activo (CACHE_VERSION, via
    // GET_VERSION): recargamos como mucho una vez por versión y pestaña. La clave
    // antigua se calculaba con un build global que antes no estaba garantizado y
    // podía bloquear todas las recargas tras la primera; se limpia al arrancar.
    const SW_RELOADED_VERSION_KEY = '__LF_SW_RELOADED_VERSION__:' + location.pathname;
    const SW_LEGACY_RELOAD_KEY = '__LF_SW_RELOAD__:' + (window.__LF_BUILD_ID || 'unknown') + ':' + location.pathname;
    const swInteractionEvents = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'input', 'submit'];

    try {
      sessionStorage.removeItem(SW_LEGACY_RELOAD_KEY);
    } catch (_) {}

    function noteInteraction() {
      lastInteractionAt = Date.now();
      if (pageIsStale) scheduleStaleReload('interaction');
    }

    function interactedRecently() {
      return lastInteractionAt > 0 && (Date.now() - lastInteractionAt) < SW_INTERACTION_IDLE_MS;
    }

    function shouldReloadOnSwActivate() {
      if (interactedRecently()) return false;
      if (Date.now() < swLoadSuppressUntil) return false;
      if (document.visibilityState === 'hidden') return false;
      return true;
    }

    function clearStaleReloadTimer() {
      if (!staleReloadTimer) return;
      clearTimeout(staleReloadTimer);
      staleReloadTimer = null;
    }

    function scheduleStaleReload(reason, minimumDelay) {
      if (!pageIsStale || document.visibilityState === 'hidden') return;
      const now = Date.now();
      const suppressDelay = Math.max(0, swLoadSuppressUntil - now);
      const interactionDelay = lastInteractionAt > 0
        ? Math.max(0, SW_INTERACTION_IDLE_MS - (now - lastInteractionAt))
        : 0;
      const delay = Math.max(50, Number(minimumDelay) || 0, suppressDelay, interactionDelay) + 25;

      clearStaleReloadTimer();
      staleReloadTimer = setTimeout(function () {
        staleReloadTimer = null;
        tryReloadOnStale('deferred-' + reason);
      }, delay);
    }

    function getLastReloadedVersion() {
      try {
        return sessionStorage.getItem(SW_RELOADED_VERSION_KEY);
      } catch (_) {
        return null;
      }
    }

    function markReloadedVersion(version) {
      try {
        sessionStorage.setItem(SW_RELOADED_VERSION_KEY, version);
      } catch (_) {}
    }

    function recoveryBuild(value) {
      const raw = typeof value === 'string' ? value.trim() : '';
      return /^\d{8}-\d{6}$/.test(raw) ? raw : 'desconocido';
    }

    function recoverySegment(value, fallback) {
      const raw = String(value || fallback || '').toLowerCase();
      return raw.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 24) || fallback;
    }

    function showInitRecovery(entry, swVersion) {
      let banner = document.getElementById('lf-init-recovery');
      if (!banner) {
        banner = document.createElement('section');
        banner.id = 'lf-init-recovery';
        banner.className = 'lf-init-recovery';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'assertive');

        const text = document.createElement('span');
        text.className = 'lf-init-recovery__text';
        banner.appendChild(text);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lf-init-recovery__button';
        button.textContent = 'Recargar ahora';
        button.addEventListener('click', function () {
          const waiting = swReg && swReg.waiting;
          if (waiting) {
            try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
          }
          window.location.reload();
        });
        banner.appendChild(button);
        (document.body || document.documentElement).appendChild(banner);
      }

      const pageBuild = recoveryBuild(entry && entry.build ? entry.build : window.__LF_BUILD_ID);
      const currentSwBuild = recoveryBuild(swVersion);
      const stale = pageBuild !== 'desconocido' && currentSwBuild !== 'desconocido' && pageBuild !== currentSwBuild;
      const text = banner.querySelector('.lf-init-recovery__text');
      if (text) {
        text.textContent = stale
          ? 'Esta pestaña usa una versión anterior y no ha cargado todos sus componentes.'
          : 'La página no ha cargado todos sus componentes.';
      }
      banner.hidden = false;
      return stale ? 'stale' : 'reload';
    }

    async function recoverIncompleteInit(entry) {
      if (!entry) return;
      if (!swReg) swReg = await navigator.serviceWorker.getRegistration();
      if (swReg) {
        try { await swReg.update(); } catch (_) {}
      }
      const worker = (swReg && (swReg.waiting || swReg.active)) || navigator.serviceWorker.controller;
      const swVersion = await getSwVersion(worker);
      const recoveryKind = showInitRecovery(entry, swVersion);
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail('error-context', [
          'client-recovery',
          recoverySegment(entry.app, 'pagina'),
          recoverySegment(entry.dependency, 'dependencia'),
          recoveryBuild(entry.build),
          recoveryBuild(swVersion),
          recoveryKind
        ], { title: 'Recuperación ofrecida tras carga incompleta' });
      }
    }

    function enqueueInitRecovery(entry) {
      if (!entry) return;
      const key = [entry.app, entry.dependency, entry.build].join('/');
      if (handledInitRecoveries.has(key)) return;
      handledInitRecoveries.add(key);
      initRecoveryChain = initRecoveryChain
        .then(function () { return recoverIncompleteInit(entry); })
        .catch(function () { showInitRecovery(entry, null); });
    }

    function processPendingInitRecoveries() {
      const pending = Array.isArray(window.__LF_PENDING_INIT_RECOVERY)
        ? window.__LF_PENDING_INIT_RECOVERY.splice(0)
        : [];
      pending.forEach(enqueueInitRecovery);
    }

    window.addEventListener('lf:init-incomplete', function (event) {
      enqueueInitRecovery(event && event.detail);
    });

    // Pregunta al SW activo su CACHE_VERSION (handler GET_VERSION en sw.js).
    // Resuelve null si no hay controlador, falla el canal o expira el timeout.
    function getSwVersion(controller) {
      return new Promise(function (resolve) {
        if (!controller) {
          resolve(null);
          return;
        }
        let settled = false;
        function settle(value) {
          if (settled) return;
          settled = true;
          resolve(value);
        }
        const channel = new MessageChannel();
        channel.port1.onmessage = function (event) {
          const version = event.data && typeof event.data.version === 'string'
            ? event.data.version
            : null;
          settle(version);
        };
        channel.port1.onmessageerror = function () {
          settle(null);
        };
        try {
          controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        } catch (_) {
          settle(null);
          return;
        }
        setTimeout(function () {
          settle(null);
        }, SW_VERSION_TIMEOUT_MS);
      });
    }

    // Única vía de recarga: se llama al activarse un SW nuevo y se re-evalúa en
    // visible/focus/interval si quedó diferida. Anti-bucle: como mucho una recarga
    // por versión de SW y pestaña (sessionStorage sobrevive al reload).
    async function tryReloadOnStale(reason) {
      if (!pageIsStale || reloadCheckInFlight) return;
      if (!shouldReloadOnSwActivate()) {
        dbg('[SW] Stale page, reload deferred on ' + reason + ' (interaction/fresh/hidden). Will re-evaluate.');
        scheduleStaleReload(reason);
        return;
      }
      reloadCheckInFlight = true;
      try {
        const version = await getSwVersion(navigator.serviceWorker.controller);
        if (!version) {
          dbg('[SW] Stale page but SW version unreadable on ' + reason + '. Will retry later.');
          scheduleStaleReload('version-unreadable', SW_VERSION_TIMEOUT_MS);
          return;
        }
        if (getLastReloadedVersion() === version) {
          pageIsStale = false;
          clearStaleReloadTimer();
          dbg('[SW] Already reloaded once for version ' + version + '. Skipping.');
          return;
        }
        if (!shouldReloadOnSwActivate()) {
          scheduleStaleReload('eligibility-changed');
          return;
        }
        clearStaleReloadTimer();
        markReloadedVersion(version);
        dbg('[SW] New SW version ' + version + ' active. Reloading to flush stale assets (' + reason + ').');
        window.location.reload();
      } finally {
        reloadCheckInFlight = false;
      }
    }

    for (let i = 0; i < swInteractionEvents.length; i++) {
      window.addEventListener(swInteractionEvents[i], noteInteraction, true);
    }

    async function requestSwUpdate(_reason) {
      const now = Date.now();
      if (now - lastSwCheck < SW_UPDATE_THROTTLE_MS) return;
      lastSwCheck = now;
      try {
        if (!swReg) {
          swReg = await navigator.serviceWorker.getRegistration();
        }
        if (swReg) await swReg.update();
      } catch (_) {
        // silencioso
      }
    }

    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register(swUrl, { updateViaCache: 'none' })
        .then(function (registration) {
          swReg = registration;
          dbg('[SW] Registered successfully');

          // Detectar cuando hay una actualización disponible
          if (registration.waiting) {
            dbg('[SW] Update waiting already, auto-updating...');
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          registration.addEventListener('updatefound', function () {
            // Si skipWaiting() corre durante el install del propio SW, el worker
            // puede haber pasado ya de installing a waiting cuando llegamos aquí.
            const newWorker = registration.installing || registration.waiting;
            if (!newWorker) return;
            dbg('[SW] New update found, installing...');

            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              dbg('[SW] New update already installed, auto-updating...');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
              return;
            }

            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                dbg('[SW] New update installed, auto-updating...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });

          // Forzar comprobación inmediata tras registrar
          requestSwUpdate('load');
          processPendingInitRecoveries();
        })
        .catch(function (err) {
          dbg('[ERROR] SW registration failed', err);
        });
    });

    // Un guard de dependencia puede haberse disparado después de que load ya
    // ocurriera pero antes de instalar este coordinador.
    if (document.readyState === 'complete') processPendingInitRecoveries();

    // Auto-check de updates del SW — diferido para no bloquear INP
    const ric = window.requestIdleCallback
      ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 150);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') ric(() => {
        requestSwUpdate('visible');
        tryReloadOnStale('visible');
      });
    });
    window.addEventListener('focus', () => ric(() => {
      requestSwUpdate('focus');
      tryReloadOnStale('focus');
    }));
    window.addEventListener('online', () => {
      requestSwUpdate('online');
      tryReloadOnStale('online');
    });
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      ric(() => {
        requestSwUpdate('interval');
        tryReloadOnStale('interval');
      });
    }, SW_UPDATE_INTERVAL_MS);

    // Listener para cuando el nuevo SW toma control. Cada deploy nuevo marca la
    // página como stale y delega en tryReloadOnStale: si la recarga no procede
    // ahora (usuario activo, oculta, recién cargada), quedará pendiente y se
    // re-evaluará — nunca se bloquea de forma permanente.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // Si no había controlador previo, es la primera instalación (clients.claim).
      // No recargamos porque la página ya está fresca y cargada de red.
      if (!hadController) {
        dbg('[SW] First installation active. No reload needed.');
        return;
      }

      pageIsStale = true;
      tryReloadOnStale('controllerchange');
    });
  };
})();
