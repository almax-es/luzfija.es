// ===== TRACKING CON GOATCOUNTER (sin cookies, sin tracking personal) =====
// Este archivo registra eventos importantes para entender cómo usan la web los usuarios

(function() {
  'use strict';

  const COUNTER_ENDPOINT = 'https://luzfija.goatcounter.com/count';
  const COUNTER_SRC = 'https://gc.zgo.at/count.js';
  const pendingEvents = [];
  let loadRequested = false;

  function ensureCounterLoaded() {
    if (typeof window.goatcounter !== 'undefined' && typeof window.goatcounter.count === 'function') {
      return Promise.resolve(true);
    }

    if (window.__LF_goatcounterPromise) {
      return window.__LF_goatcounterPromise;
    }

    window.__LF_goatcounterPromise = new Promise((resolve) => {
      try {
        const existing = document.querySelector('script[data-goatcounter]');
        if (existing) {
          const onReady = () => resolve(true);
          const onFail = () => resolve(false);
          existing.addEventListener('load', onReady, { once: true });
          existing.addEventListener('error', onFail, { once: true });
          if (typeof window.goatcounter === 'undefined') {
            setTimeout(() => resolve(typeof window.goatcounter !== 'undefined'), 4000);
          }
          return;
        }

        const script = document.createElement('script');
        script.src = COUNTER_SRC;
        script.async = true;
        script.setAttribute('data-goatcounter', COUNTER_ENDPOINT);
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      } catch (e) {
        resolve(false);
      }
    });

    return window.__LF_goatcounterPromise;
  }

  function flushQueue() {
    if (typeof window.goatcounter === 'undefined' || typeof window.goatcounter.count !== 'function') {
      return;
    }

    while (pendingEvents.length) {
      const { eventName, metadata } = pendingEvents.shift();
      try {
        window.goatcounter.count({
          path: eventName,
          title: metadata?.title || eventName,
          event: true,
        });
      } catch (e) {
        // Silencioso
      }
    }
  }

  // Función auxiliar para enviar eventos a GoatCounter
  function trackEvent(eventName, metadata) {
    pendingEvents.push({ eventName, metadata });

    if (!loadRequested) {
      loadRequested = true;
      ensureCounterLoaded().then(() => {
        flushQueue();
      });
    } else {
      flushQueue();
    }
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

    // 4. Trackear clicks en botón de subir factura
    const btnSubirFactura = document.getElementById('btnSubirFactura');
    if (btnSubirFactura) {
      btnSubirFactura.addEventListener('click', function() {
        trackEvent('factura-modal-abierto', { title: 'Usuario abrió modal de factura' });
      });
    }

    // 5. Trackear cuando se aplica una factura parseada
    const btnAplicarFactura = document.getElementById('btnAplicarFactura');
    if (btnAplicarFactura) {
      btnAplicarFactura.addEventListener('click', function() {
        trackEvent('factura-aplicada', { title: 'Usuario aplicó datos de factura' });
      });
    }

    // 6. Trackear cambio de tema (dark/light)
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
    // Lo haremos con delegación de eventos porque la tabla se genera dinámicamente
    const tbody = document.getElementById('tbody');
    if (tbody) {
      tbody.addEventListener('click', function(e) {
        const link = e.target.closest('a.web');
        if (link) {
          const tarifaRow = link.closest('tr');
          const tarifaNombre = tarifaRow?.querySelector('.tarifa-nombre')?.textContent || 'Desconocida';
          trackEvent('tarifa-click-contratar', { 
            title: 'Click en contratar: ' + tarifaNombre 
          });
        }
      });
    }

    // 8. Trackear navegación a la página de guías
    const guiasLinks = document.querySelectorAll('a[href*="guias"]');
    guiasLinks.forEach(function(link) {
      link.addEventListener('click', function() {
        trackEvent('navegacion-guias', { title: 'Usuario fue a Guías' });
      });
    });

  });

  // ===== TRACKING DE ERRORES (opcional) =====
  // Trackear errores de validación para detectar puntos de fricción
  window.addEventListener('error', function(e) {
    // Solo trackear errores relacionados con la app, no errores de third-party scripts
    if (e.filename && e.filename.includes('luzfija.es')) {
      trackEvent('error-javascript', { 
        title: 'Error JS: ' + (e.message || 'desconocido').substring(0, 50) 
      });
    }
  }, true);

})();
