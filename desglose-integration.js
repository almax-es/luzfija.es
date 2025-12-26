/**
 * INTEGRACIÓN DEL DESGLOSE DE FACTURA
 */

(function() {
  'use strict';

  let tarifasCache = null;

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
        
        const tdNombre = tr.cells[1];
        if (!tdNombre) return;
        
        const nombreCompleto = tdNombre.textContent || '';
        const nombre = nombreCompleto.split('\n')[0].replace(/[⚠️☀️🔋🔗ⓘ]/g, '').trim();
        
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

  window.mostrarDesglose = async function(nombreTarifa) {
    console.log('=== DESGLOSE ===');
    console.log('Tarifa:', nombreTarifa);
    
    // Detectar PVPC (no se puede desglosar)
    if (nombreTarifa && nombreTarifa.toLowerCase().includes('pvpc')) {
      alert('⚠️ El desglose no está disponible para PVPC');
      return;
    }
    
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
      viviendaCanarias: document.getElementById('viviendaCanarias')?.checked || false,
      solarOn: document.getElementById('solarOn')?.checked || false
    };

    const tarifas = await cargarTarifas();
    if (!tarifas || tarifas.length === 0) {
      alert('Error: No se pudieron cargar las tarifas');
      return;
    }

    // PASO 1: Buscar coincidencia EXACTA
    let tarifa = tarifas.find(t => (t.nombre || t.id) === nombreTarifa);
    
    // PASO 2: Si no encuentra, buscar parcial priorizando nombres MÁS LARGOS
    // (para que "Imagina Energía 3P" tenga prioridad sobre "Imagina Energía")
    if (!tarifa) {
      const candidatos = tarifas.filter(t => {
        const n = t.nombre || t.id;
        return n.includes(nombreTarifa) || nombreTarifa.includes(n);
      });
      
      // Ordenar por longitud de nombre (más largo primero)
      candidatos.sort((a, b) => {
        const nameA = a.nombre || a.id || '';
        const nameB = b.nombre || b.id || '';
        return nameB.length - nameA.length;
      });
      
      tarifa = candidatos[0];
    }

    if (!tarifa) {
      console.error('❌ No se encontró tarifa:', nombreTarifa);
      alert('Error: No se pudo cargar la información de la tarifa');
      return;
    }

    console.log('✅ Tarifa encontrada:', tarifa);

    // Determinar tipo de compensación y tope
    let tipoCompensacion = 'NO COMPENSA';
    let topeCompensacion = 'ENERGIA';
    let tieneBV = false;
    let reglaBV = 'NO APLICA';
    let precioCompensacion = 0;

    if (tarifa.fv) {
      tipoCompensacion = tarifa.fv.tipo || 'NO COMPENSA';
      topeCompensacion = tarifa.fv.tope || 'ENERGIA';
      tieneBV = tarifa.fv.bv || false;
      reglaBV = tarifa.fv.reglaBV || 'NO APLICA';
      
      // Precio compensación
      if (tarifa.fv.exc === 'INDEXADA') {
        precioCompensacion = 0; // No se puede calcular
      } else if (typeof tarifa.fv.exc === 'number') {
        precioCompensacion = tarifa.fv.exc;
      }
    }

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
      precioCompensacion: inputs.solarOn ? precioCompensacion : 0,
      tipoCompensacion: tipoCompensacion,
      topeCompensacion: topeCompensacion,
      
      bateriaVirtual: tieneBV ? inputs.bvSaldo : 0,
      tieneBV: tieneBV,
      reglaBV: reglaBV,
      
      zonaFiscal: inputs.zonaFiscal,
      esViviendaCanarias: inputs.viviendaCanarias,
      solarOn: inputs.solarOn
    };

    console.log('Datos:', datos);

    if (window.__LF_DesgloseFactura) {
      window.__LF_DesgloseFactura.abrir(datos);
    } else {
      console.error('Sistema de desglose no disponible');
    }
  };

})();
