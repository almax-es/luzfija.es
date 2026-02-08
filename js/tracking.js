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

  // ===== TRACKING DE ERRORES (opcional) =====
  window.addEventListener('error', function(e) {
    try{
      const filename = e && e.filename ? String(e.filename) : '';
      if (filename.includes('luzfija.es')) {
        trackEvent('error-javascript', {
          title: 'Error JS: ' + String(e.message || 'desconocido').substring(0, 50)
        });
      }
    }catch(_){}
  }, true);

  // Capturar errores de Promises no manejadas (crítico para PVPC/PDF)
  window.addEventListener('unhandledrejection', function(e) {
    try {
      const reason = e && e.reason ? e.reason : 'unknown';
      let msg = 'Promise reject: ';
      
      if (reason instanceof Error) {
        msg += String(reason.message || reason.name || 'Error');
      } else {
        msg += String(reason);
      }
      
      // Añadir ruta para ayudar a localizar la página
      try {
        const path = (location && location.pathname) ? location.pathname : '';
        if (path) msg += ` @${path}`;
      } catch (_) {}

      // Truncar a 100 caracteres para no saturar tracking
      msg = msg.substring(0, 100);
      
      trackEvent('error-promise', { title: msg });
      
      if (DEBUG) {
        dbg('Unhandled Promise rejection:', reason);
      }
    } catch(_) {}
  });

})();
