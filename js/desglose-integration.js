/**
 * INTEGRACIÓN DEL DESGLOSE DE FACTURA
 * 
 * CORRECCIONES APLICADAS:
 * - Fechas calculadas dinámicamente (no hardcodeadas)
 * - Parser numérico robusto (soporta formatos: 1.234,56 / 1234.56 / 1234,56)
 * - MEJORA: Icono 💡 visible para indicar que el precio es clickeable
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
    
    // Detectar formato europeo: punto seguido de exactamente 3 dígitos y luego coma
    // Ejemplo: 1.234,56 -> el punto es separador de miles
    if (/\d\.\d{3},\d/.test(str)) {
      // Formato europeo: 1.234,56
      return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
    }
    
    // Detectar formato US: coma seguida de exactamente 3 dígitos y luego punto
    // IMPORTANTE: Solo si el punto aparece DESPUÉS de los 3 dígitos
    // Válido: "1,234.56" - Inválido: "0,123456" (esto es decimal europeo con muchos decimales)
    if (/\d,\d{3}\.\d/.test(str)) {
      // Formato US: 1,234.56
      return parseFloat(str.replace(/,/g, '')) || 0;
    }
    
    // Caso simple: solo coma como decimal (sin miles)
    // Ejemplo: 3,45 o 0,121212
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
      lfDbg('[ERROR] Error cargando tarifas:', error);
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

    // ✅ Event delegation (sin MutationObserver): evita trabajo extra en cada re-render de tabla (mejora INP)
    tbody.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;

      // Ignorar clics en enlaces/controles dentro de la celda
      if (t.closest('a, button, input, select, textarea, .tooltip, .tooltip-icon')) return;

      const td = t.closest('td');
      if (!td) return;
      if (!td.classList.contains('total-cell') && !td.classList.contains('tarifa-cell')) return;

      const tr = td.closest('tr');
      const nombreTarifa = tr?.dataset?.tarifaNombre || '';
      if (!nombreTarifa) return;

      // PVPC no se puede desglosar (evita alertas por coincidencia parcial)
      const esPvpc = tr?.dataset?.esPvpc === '1' || nombreTarifa.toLowerCase().includes('pvpc');
      if (esPvpc) {
        alert('⚠️ El desglose no está disponible para PVPC');
        return;
      }

      ev.stopPropagation();

      // Feedback visual
      td.classList.add('desglose-tap');
      window.setTimeout(() => td.classList.remove('desglose-tap'), 180);

      // Vibración (móvil) si está disponible
      if (navigator.vibrate) navigator.vibrate(td.classList.contains('total-cell') ? 35 : 20);

      mostrarDesglose(nombreTarifa);
    });

    // Accesibilidad teclado (Enter/Espacio)
    tbody.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const t = ev.target;
      if (!t || !t.closest) return;

      // No interferir con tooltips/links/controles (accesibilidad)
      if (t.closest('a, button, input, select, textarea, .tooltip, .tooltip-icon')) return;

      const td = t.closest('td');
      if (!td) return;
      if (!td.classList.contains('total-cell') && !td.classList.contains('tarifa-cell')) return;

      ev.preventDefault();
      td.click();
    });
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

    let tarifa = null;
    
    // ✅ CASO ESPECIAL: Mi Tarifa personalizada
    if (nombreTarifa === 'Mi tarifa ⭐') {
      lfDbg('✅ Detectada tarifa personalizada');
      
      // Leer valores RAW primero (antes de parsear)
      const mtPuntaVal = document.getElementById('mtPunta')?.value?.trim() || '';
      const mtLlanoVal = document.getElementById('mtLlano')?.value?.trim() || '';
      const mtValleVal = document.getElementById('mtValle')?.value?.trim() || '';
      const mtP1Val = document.getElementById('mtP1')?.value?.trim() || '';
      const mtP2Val = document.getElementById('mtP2')?.value?.trim() || '';
      const mtPrecioExcVal = document.getElementById('mtPrecioExc')?.value?.trim() || '';
      
      // Validar que los campos NO estén vacíos
      if (!mtPuntaVal || !mtLlanoVal || !mtValleVal || !mtP1Val || !mtP2Val) {
        alert('⚠️ Completa todos los campos de "Mi tarifa" para ver el desglose');
        return;
      }
      
      // Ahora sí parsear (ya sabemos que tienen valor)
      const mtPunta = parseNum(mtPuntaVal);
      const mtLlano = parseNum(mtLlanoVal);
      const mtValle = parseNum(mtValleVal);
      const mtP1 = parseNum(mtP1Val);
      const mtP2 = parseNum(mtP2Val);
      const mtPrecioExc = inputs.solarOn && mtPrecioExcVal ? parseNum(mtPrecioExcVal) : 0;
      
      // Construir tarifa personalizada
      const es1P = (mtPunta === mtLlano && mtLlano === mtValle);
      tarifa = {
        nombre: 'Mi tarifa ⭐',
        tipo: es1P ? '1P' : '3P',
        cPunta: mtPunta,
        cLlano: mtLlano,
        cValle: mtValle,
        p1: mtP1,
        p2: mtP2,
        fv: {
          exc: mtPrecioExc,
          tipo: mtPrecioExc > 0 ? 'SIMPLE + BV' : 'NO COMPENSA',
          tope: 'ENERGIA',
          bv: mtPrecioExc > 0,
          reglaBV: mtPrecioExc > 0 ? 'BV MES ANTERIOR' : 'NO APLICA'
        }
      };
    } else {
      // Cargar tarifas normales desde JSON
      const tarifas = await cargarTarifas();
      if (!tarifas || tarifas.length === 0) {
        alert('Error: No se pudieron cargar las tarifas');
        return;
      }

      // PASO 1: Buscar coincidencia EXACTA
      tarifa = tarifas.find(t => (t.nombre || t.id) === nombreTarifa);
      
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
    }

    if (!tarifa) {
      lfDbg('[ERROR] ❌ No se encontró tarifa:', nombreTarifa);
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
      lfDbg('[ERROR] Sistema de desglose no disponible');
    }
  };

})();
