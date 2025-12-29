// ===== TRACKING CON GOATCOUNTER (sin cookies, sin tracking personal) =====
// Este archivo registra eventos importantes para entender cómo usan la web los usuarios

(function() {
  'use strict';

  // Función auxiliar para enviar eventos a GoatCounter
  function trackEvent(eventName, metadata) {
    if (typeof window.goatcounter === 'undefined' || typeof window.goatcounter.count !== 'function') {
      // GoatCounter aún no ha cargado, ignorar silenciosamente
      return;
    }

    try {
      window.goatcounter.count({
        path: eventName,
        title: metadata?.title || eventName,
        event: true,
      });
    } catch (e) {
      // No romper la app si hay algún error de tracking
      console.debug('Error tracking:', e);
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
