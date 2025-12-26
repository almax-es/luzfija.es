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
        
        // Hacer toda la celda clickable
        tdTotal.style.cursor = 'pointer';
        tdTotal.title = '💡 Clic para ver desglose completo';
        
        tdTotal.onclick = function(e) {
          e.stopPropagation();
          // Usar el índice de la fila directamente
          mostrarDesglose(idx, null);
        };

        tr.dataset.desgloseReady = 'true';
      });
    });

    observer.observe(tbody, { childList: true, subtree: true });
  }

  /**
   * Muestra el desglose de una tarifa
   */
  window.mostrarDesglose = function(rowIndex, _unused) {
    console.log('=== DESGLOSE DEBUG ===');
    console.log('Row index:', rowIndex);
    
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

    // Obtener la tarifa por índice desde state.rows
    let tarifa = null;
    
    if (window.state && window.state.rows && window.state.rows[rowIndex]) {
      const row = window.state.rows[rowIndex];
      const nombreTarifa = row.nombre;
      console.log('Buscando tarifa:', nombreTarifa);
      
      // Buscar en cachedTarifas
      if (window.cachedTarifas) {
        tarifa = window.cachedTarifas.find(t => (t.nombre || t.id) === nombreTarifa);
        
        if (!tarifa) {
          // Intentar por índice directo
          tarifa = window.cachedTarifas[rowIndex];
        }
      }
    }

    if (!tarifa) {
      console.error('❌ No se encontró tarifa en índice:', rowIndex);
      console.log('state.rows:', window.state?.rows);
      console.log('cachedTarifas:', window.cachedTarifas);
      alert('Error: No se pudo cargar la información de la tarifa');
      return;
    }

    console.log('✅ Tarifa encontrada:', tarifa);

    const datos = {
      nombreTarifa: tarifa.nombre || tarifa.id || 'Tarifa',
      fechaInicio: '01/12/2025',
      fechaFin: '31/12/2025',
      dias: inputs.dias,
      
      potenciaP1: inputs.p1,
      potenciaP2: inputs.p2,
      precioP1: tarifa.p1 || 0,
      precioP2: tarifa.p2 || 0,
      
      consumoPunta: inputs.cPunta,
      consumoLlano: inputs.cLlano,
      consumoValle: inputs.cValle,
      precioPunta: tarifa.cPunta || 0,
      precioLlano: tarifa.cLlano || 0,
      precioValle: tarifa.cValle || 0,
      
      excedentes: inputs.solarOn ? inputs.exTotal : 0,
      precioCompensacion: inputs.solarOn ? ((tarifa.fv && tarifa.fv.exc && typeof tarifa.fv.exc === 'number') ? tarifa.fv.exc : 0) : 0,
      
      bateriaVirtual: (tarifa.fv && tarifa.fv.bv) ? inputs.bvSaldo : 0,
      
      alquilerContador: 0.81,
      zonaFiscal: inputs.zonaFiscal
    };

    console.log('Datos para desglose:', datos);

    // Abrir el modal
    if (window.__LF_DesgloseFactura) {
      window.__LF_DesgloseFactura.abrir(datos);
    } else {
      console.error('Sistema de desglose no disponible');
    }
  };

})();
