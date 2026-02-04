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

    // Usar parser global de la app si está disponible
    if (window.LF && typeof window.LF.parseNum === 'function') {
      return window.LF.parseNum(v);
    }

    // Parser de respaldo robusto
    let s = String(v).trim().replace(/[\s\u00A0]/g, '');
    if (!s) return 0;

    s = s.replace(/[^0-9,\.\-]/g, '');
    if (!s) return 0;

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    if (hasComma && hasDot) {
      const lastComma = s.lastIndexOf(',');
      const lastDot = s.lastIndexOf('.');
      const decimalSep = lastComma > lastDot ? ',' : '.';
      const thousandSep = decimalSep === ',' ? '.' : ',';

      s = s.split(thousandSep).join('');
      const i = s.lastIndexOf(decimalSep);
      if (i !== -1) {
        s = s.slice(0, i).replace(new RegExp('\\' + decimalSep, 'g'), '') + '.' + s.slice(i + 1);
      }
    } else if (hasComma) {
      if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
      else {
        const i = s.lastIndexOf(',');
        s = s.slice(0, i).replace(/,/g, '') + '.' + s.slice(i + 1);
      }
    } else if (hasDot) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else {
        const i = s.lastIndexOf('.');
        s = s.slice(0, i).replace(/\./g, '') + '.' + s.slice(i + 1);
      }
    }

    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : 0;
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
        toast('Completa todos los campos de "Mi tarifa" para ver el desglose', 'err');
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
        toast('No se pudieron cargar las tarifas', 'err');
        return;
      }

      // CASO ESPECIAL: PVPC
      if (nombreTarifa && nombreTarifa.toLowerCase().includes('pvpc')) {
        lfDbg('✅ Detectada tarifa PVPC');
        
        // Obtener metaPvpc de window (calculado por pvpc.js)
        if (!window.pvpcLastMeta) {
          toast('No hay datos de PVPC calculados. Pulsa "⚡ Calcular" primero.', 'err');
          return;
        }
        
        // Construir tarifa PVPC con los datos calculados
        tarifa = {
          nombre: 'PVPC (Regulada) ⚡',
          tipo: '3P',
          esPVPC: true,
          metaPvpc: {
            terminoFijo: 0,  // Se calcula en pvpc.js
            terminoVariable: 0,  // Se calcula en pvpc.js
            bonoSocial: 0,
            impuestoElectrico: 0,
            equipoMedida: 0,
            iva: 0,
            totalFactura: 0
          }
        };
        
        // Intentar obtener metaPvpc de la tarifa guardada en resultados
        const resultadosContainer = document.querySelector('#tbody');
        if (resultadosContainer) {
          const filas = resultadosContainer.querySelectorAll('tr');
          for (const fila of filas) {
            if (fila.dataset && fila.dataset.tarifaNombre && fila.dataset.tarifaNombre.toLowerCase().includes('pvpc')) {
              // Buscar datos almacenados en el elemento TR
              if (fila.dataset.metaPvpc) {
                try {
                  tarifa.metaPvpc = JSON.parse(fila.dataset.metaPvpc);
                  lfDbg('✅ metaPvpc obtenido del DOM:', tarifa.metaPvpc);
                } catch(e) {
                  lfDbg('⚠️ Error parseando metaPvpc del DOM');
                }
              }
              break;
            }
          }
        }
      } else {
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
    }

    if (!tarifa) {
      lfDbg('[ERROR] ❌ No se encontró tarifa:', nombreTarifa);
      toast('No se pudo cargar la información de la tarifa', 'err');
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
      
      // Precio compensación (solo valores numéricos válidos)
      if (typeof tarifa.fv.exc === 'number') {
        precioCompensacion = tarifa.fv.exc;
      } else {
        precioCompensacion = 0;
      }
    }

    // ✅ Calcular fechas reales basadas en los días
    const fechas = calcularFechasPeriodo(inputs.dias);

    // Para PVPC, obtener precios medios de window.pvpcLastMeta
    let precioPunta = tarifa.cPunta || 0;
    let precioLlano = tarifa.cLlano || 0;
    let precioValle = tarifa.cValle || 0;
    let precioP1 = tarifa.p1 || 0;
    let precioP2 = tarifa.p2 || 0;
    
    if (tarifa.esPVPC) {
      // Precios de energía (€/kWh)
      if (window.pvpcLastMeta) {
        precioPunta = window.pvpcLastMeta.precioPunta || 0;
        precioLlano = window.pvpcLastMeta.precioLlano || 0;
        precioValle = window.pvpcLastMeta.precioValle || 0;
        lfDbg('✅ Precios energía PVPC:', { precioPunta, precioLlano, precioValle });
      }
      
      // Precios de potencia (€/kW·día) - valores regulados PVPC
      precioP1 = 0.075901;  // Peaje P1 punta
      precioP2 = 0.001987;  // Peaje P2 valle
      lfDbg('✅ Precios potencia PVPC:', { precioP1, precioP2 });
    }

    const datos = {
      nombreTarifa: tarifa.nombre || tarifa.id || 'Tarifa',
      fechaInicio: fechas.inicio,  // ✅ Fecha calculada
      fechaFin: fechas.fin,        // ✅ Fecha calculada
      dias: inputs.dias,

      potenciaP1: inputs.p1,
      potenciaP2: inputs.p2,
      precioP1: precioP1,
      precioP2: precioP2,

      consumoPunta: inputs.cPunta,
      consumoLlano: inputs.cLlano,
      consumoValle: inputs.cValle,
      precioPunta: precioPunta,
      precioLlano: precioLlano,
      precioValle: precioValle,

      excedentes: inputs.solarOn ? inputs.exTotal : 0,
      precioCompensacion: inputs.solarOn ? precioCompensacion : 0,
      tipoCompensacion: tipoCompensacion,
      topeCompensacion: topeCompensacion,

      bateriaVirtual: tieneBV ? inputs.bvSaldo : 0,
      tieneBV: tieneBV,
      reglaBV: reglaBV,

      zonaFiscal: inputs.zonaFiscal,
      esViviendaCanarias: inputs.viviendaCanarias,
      solarOn: inputs.solarOn,

      // PVPC: incluir datos ya calculados
      esPVPC: tarifa.esPVPC || false,
      metaPvpc: tarifa.metaPvpc || null,

      // PVPC: margen de comercialización (para cálculo en desglose)
      pvpcMargenUnitario: 0.008529  // €/kW·día (regulado)
    };

    lfDbg('Datos para desglose:', datos);

    if (window.__LF_DesgloseFactura) {
      window.__LF_DesgloseFactura.abrir(datos);
    } else {
      lfDbg('[ERROR] Sistema de desglose no disponible');
    }
  };

})();
