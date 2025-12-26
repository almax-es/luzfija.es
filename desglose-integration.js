/**
 * INTEGRACIÓN DEL DESGLOSE DE FACTURA
 * Este archivo se carga después de app.js y añade la funcionalidad de desglose
 */

(function() {
  'use strict';

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('✅ Integración desglose inicializada');
    
    // Interceptar la función renderTable original para añadir botones
    const originalRenderTable = window.renderTable;
    if (!originalRenderTable) {
      console.warn('No se encontró renderTable');
      return;
    }

    // No sobreescribimos renderTable, usamos MutationObserver para añadir botones después
    const tbody = document.querySelector('#tbody');
    if (!tbody) return;

    const observer = new MutationObserver(() => {
      const rows = tbody.querySelectorAll('tr');
      rows.forEach((tr, idx) => {
        // Si ya está configurado, skip
        if (tr.dataset.desgloseReady) return;

        // Obtener la celda del total (6ta columna, índice 5)
        const tdTotal = tr.cells[5];
        if (!tdTotal) return;

        // Extraer datos de la fila
        const nombre = tr.cells[1]?.textContent?.trim().replace(/[⚠️☀️🔋🔗ⓘ]/g, '').trim() || '';
        
        // Hacer toda la celda clickable
        tdTotal.style.cursor = 'pointer';
        tdTotal.title = '💡 Clic para ver desglose completo';
        
        tdTotal.onclick = function(e) {
          e.stopPropagation();
          mostrarDesglose(idx, nombre);
        };

        tr.dataset.desgloseReady = 'true';
      });
    });

    observer.observe(tbody, { childList: true, subtree: true });
  }

  /**
   * Muestra el desglose de una tarifa
   */
  window.mostrarDesglose = function(rowIndex, nombreTarifa) {
    // Obtener los inputs actuales
    const inputs = {
      p1: parseFloat(document.getElementById('p1')?.value.replace(',', '.')) || 0,
      p2: parseFloat(document.getElementById('p2')?.value.replace(',', '.')) || 0,
      dias: parseFloat(document.getElementById('dias')?.value) || 30,
      cPunta: parseFloat(document.getElementById('cPunta')?.value.replace(',', '.')) || 0,
      cLlano: parseFloat(document.getElementById('cLlano')?.value.replace(',', '.')) || 0,
      cValle: parseFloat(document.getElementById('cValle')?.value.replace(',', '.')) || 0,
      exTotal: parseFloat(document.getElementById('exTotal')?.value.replace(',', '.')) || 0,
      bvSaldo: parseFloat(document.getElementById('bvSaldo')?.value.replace(',', '.')) || 0,
      zonaFiscal: document.getElementById('zonaFiscal')?.value || 'Península',
      solarOn: document.getElementById('solarOn')?.checked || false
    };

    // Intentar obtener la tarifa del state.rows
    let tarifa = null;
    if (window.state && window.state.rows && window.state.rows[rowIndex]) {
      const row = window.state.rows[rowIndex];
      
      // Buscar la tarifa en cachedTarifas por nombre
      if (window.cachedTarifas) {
        tarifa = window.cachedTarifas.find(t => 
          (t.nombre || t.id) === nombreTarifa
        );
      }
    }

    // Si no encontramos tarifa, usar valores por defecto
    if (!tarifa) {
      console.warn('No se encontró tarifa, usando valores por defecto');
      tarifa = {
        nombre: nombreTarifa,
        p1: 0.054794,
        p2: 0.054794,
        e1: 0.15,
        e2: 0.12,
        e3: 0.09,
        compensacion: 0.08
      };
    }

    const datos = {
      nombreTarifa: tarifa.nombre || tarifa.id || nombreTarifa,
      fechaInicio: '01/12/2025',
      fechaFin: '31/12/2025',
      dias: inputs.dias,
      
      potenciaP1: inputs.p1,
      potenciaP2: inputs.p2,
      precioP1: tarifa.p1 || tarifa.potenciaP1 || 0,
      precioP2: tarifa.p2 || tarifa.potenciaP2 || 0,
      
      consumoPunta: inputs.cPunta,
      consumoLlano: inputs.cLlano,
      consumoValle: inputs.cValle,
      precioPunta: tarifa.e1 || tarifa.energiaPunta || 0,
      precioLlano: tarifa.e2 || tarifa.energiaLlano || 0,
      precioValle: tarifa.e3 || tarifa.energiaValle || 0,
      
      excedentes: inputs.solarOn ? inputs.exTotal : 0,
      precioCompensacion: inputs.solarOn ? (tarifa.compensacion || 0) : 0,
      
      bateriaVirtual: tarifa.bateriaVirtual ? inputs.bvSaldo : 0,
      
      alquilerContador: 0.81,
      zonaFiscal: inputs.zonaFiscal
    };

    // Abrir el modal
    if (window.__LF_DesgloseFactura) {
      window.__LF_DesgloseFactura.abrir(datos);
    } else {
      console.error('Sistema de desglose no disponible');
    }
  };

})();
