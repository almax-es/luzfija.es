/**
 * INTEGRACIÓN DEL DESGLOSE DE FACTURA
 * 
 * CORRECCIONES APLICADAS:
 * - Fechas calculadas dinámicamente (no hardcodeadas)
 * - Parser numérico robusto (soporta formatos: 1.234,56 / 1234.56 / 1234,56)
 */

(function() {
  'use strict';

  // Sistema de debug (activar con ?debug=1)
  const DEBUG = window.location.search.includes('debug=1') || window.__LF_DEBUG;
  const lfDbg = (...args) => DEBUG && console.log('[DESGLOSE]', ...args);

  let tarifasCache = null;

  // ✅ Parser robusto para números (compatible con app.js)
  function parseNum(v) {
    if (v == null || v === '') return 0;
    
    // Usar parser global si está disponible
    if (typeof window.__LF_asNumber === 'function') {
      return window.__LF_asNumber(v);
    }
    
    // Parser de respaldo robusto
    const str = String(v).trim();
    
    // Detectar formato: si tiene punto seguido de 3 dígitos y luego coma, es formato europeo
    // Ejemplo: 1.234,56 -> el punto es separador de miles
    if (/\d\.\d{3},\d/.test(str)) {
      // Formato europeo: 1.234,56
      return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
    }
    
    // Detectar formato: si tiene coma seguida de 3 dígitos y luego punto, es formato US
    // Ejemplo: 1,234.56 -> la coma es separador de miles
    if (/\d,\d{3}\.?\d/.test(str)) {
      // Formato US: 1,234.56
      return parseFloat(str.replace(/,/g, '')) || 0;
    }
    
    // Caso simple: solo coma como decimal (sin miles)
    // Ejemplo: 3,45
    if (/^\d+,\d+$/.test(str)) {
      return parseFloat(str.replace(',', '.')) || 0;
    }
    
    // Caso por defecto
    return parseFloat(str.replace(',', '.')) || 0;
  }

  // ✅ Calcular fechas reales basadas en los días de facturación
  function calcularFechasPeriodo(dias) {
    const hoy = new Date();
    
    // Fecha fin = ayer (como hace PVPC)
    const fechaFin = new Date(hoy);
    fechaFin.setDate(fechaFin.getDate() - 1);
    
    // Fecha inicio = fechaFin - dias + 1
    const fechaInicio = new Date(fechaFin);
    fechaInicio.setDate(fechaInicio.getDate() - dias + 1);
    
    const formatear = (d) => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };
    
    return {
      inicio: formatear(fechaInicio),
      fin: formatear(fechaFin)
    };
  }

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
    lfDbg('Integración desglose inicializada');
    
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
    lfDbg('=== DESGLOSE ===');
    lfDbg('Tarifa:', nombreTarifa);
    
    // Detectar PVPC (no se puede desglosar)
    if (nombreTarifa && nombreTarifa.toLowerCase().includes('pvpc')) {
      alert('⚠️ El desglose no está disponible para PVPC');
      return;
    }
    
    // ✅ Usar parser robusto en lugar de parseFloat simple
    const inputs = {
      p1: parseNum(document.getElementById('p1')?.value),
      p2: parseNum(document.getElementById('p2')?.value),
      dias: parseNum(document.getElementById('dias')?.value) || 30,
      cPunta: parseNum(document.getElementById('cPunta')?.value),
      cLlano: parseNum(document.getElementById('cLlano')?.value),
      cValle: parseNum(document.getElementById('cValle')?.value),
      exTotal: parseNum(document.getElementById('exTotal')?.value),
      bvSaldo: parseNum(document.getElementById('bvSaldo')?.value),
      zonaFiscal: document.getElementById('zonaFiscal')?.value || 'Península',
      viviendaCanarias: document.getElementById('viviendaCanarias')?.checked || false,
      solarOn: document.getElementById('solarOn')?.checked || false
    };

    lfDbg('Inputs parseados:', inputs);

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

    lfDbg('✅ Tarifa encontrada:', tarifa);

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

    // ✅ Calcular fechas reales basadas en los días
    const fechas = calcularFechasPeriodo(inputs.dias);

    const datos = {
      nombreTarifa: tarifa.nombre || tarifa.id || 'Tarifa',
      fechaInicio: fechas.inicio,  // ✅ Fecha calculada
      fechaFin: fechas.fin,        // ✅ Fecha calculada
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

    lfDbg('Datos para desglose:', datos);

    if (window.__LF_DesgloseFactura) {
      window.__LF_DesgloseFactura.abrir(datos);
    } else {
      console.error('Sistema de desglose no disponible');
    }
  };

})();
