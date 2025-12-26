/**
 * INTEGRACIÓN DEL DESGLOSE DE FACTURA
 * Este archivo se carga después de app.js y añade la funcionalidad de desglose
 */

(function() {
  'use strict';

  let tarifasCache = null;

  // Cargar tarifas.json
  async function cargarTarifas() {
    if (tarifasCache) return tarifasCache;
    
    try {
      const response = await fetch('tarifas.json');
      const data = await response.json();
      tarifasCache = data.tarifas || [];
      return tarifasCache;
    } catch (error) {
      console.error('Error cargando tarifas:', error);
      return [];
    }
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('✅ Integración desglose inicializada');
    
    const tbody = document.querySelector('#tbody');
    if (!tbody) return;

    const observer = new MutationObserver(() => {
      const rows = tbody.querySelectorAll('tr');
      rows.forEach((tr, idx) => {
        if (tr.dataset.desgloseReady) return;

        const tdTotal = tr.cells[5];
        if (!tdTotal) return;
        
        // Extraer nombre de la tarifa desde la celda
        const tdNombre = tr.cells[1];
        if (!tdNombre) return;
        
        const nombreCompleto = tdNombre.textContent || '';
        const nombre = nombreCompleto
          .split('\n')[0]
          .replace(/[⚠️☀️🔋🔗ⓘ]/g, '')
          .trim();
        
        tdTotal.style.cursor = 'pointer';
        tdTotal.title = '💡 Clic para ver desglose completo';
        
        tdTotal.onclick = function(e) {
          e.stopPropagation();
          mostrarDesglose(nombre);
        };

        tr.dataset.desgloseReady = 'true';
      });
    });

    observer.observe(tbody, { childList: true, subtree: true });
  }

  /**
   * Muestra el desglose de una tarifa
   */
  window.mostrarDesglose = async function(nombreTarifa) {
    console.log('=== DESGLOSE DEBUG ===');
    console.log('Nombre tarifa:', nombreTarifa);
    
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

    // Cargar tarifas
    const tarifas = await cargarTarifas();
    if (!tarifas || tarifas.length === 0) {
      alert('Error: No se pudieron cargar las tarifas');
      return;
    }

    // Buscar tarifa por nombre
    let tarifa = tarifas.find(t => (t.nombre || t.id) === nombreTarifa);
    
    if (!tarifa) {
      // Buscar por nombre parcial
      tarifa = tarifas.find(t => {
        const n = t.nombre || t.id;
        return n.includes(nombreTarifa) || nombreTarifa.includes(n);
      });
    }

    if (!tarifa) {
      console.error('❌ No se encontró tarifa:', nombreTarifa);
      console.log('Tarifas disponibles:', tarifas.map(t => t.nombre || t.id));
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
      
      alquilerContador: 0.80,
      bonoSocial: 0.38,
      zonaFiscal: inputs.zonaFiscal
    };

    console.log('Datos para desglose:', datos);

    if (window.__LF_DesgloseFactura) {
      window.__LF_DesgloseFactura.abrir(datos);
    } else {
      console.error('Sistema de desglose no disponible');
    }
  };

})();
