// ===== LuzFija: Utilidades base =====
// Funciones puras sin dependencias externas

(function() {
  'use strict';

  // ===== DEBUG MODE (CENTRALIZADO) =====
  // IMPORTANTE: Este es el único lugar donde se debe definir la lógica de debug.
  // Otros módulos deben usar window.LF.isDebugMode() o window.__LF_DEBUG
  // en lugar de duplicar la lógica de detección.
  
  let __DEBUG_CACHED = null;
  
  function isDebugMode() {
    if (__DEBUG_CACHED !== null) return __DEBUG_CACHED;
    
    try {
      const params = new URLSearchParams(location.search);
      const debug = params.get('debug') === '1' || 
                    localStorage.getItem('lf_debug') === '1' ||
                    window.__LF_DEBUG === true;
      __DEBUG_CACHED = Boolean(debug);
    } catch (e) {
      __DEBUG_CACHED = false;
    }
    
    return __DEBUG_CACHED;
  }
  
  // Establecer flag global para compatibilidad con código existente
  window.__LF_DEBUG = isDebugMode();

  // Helper: log solo si debug está activo
  function lfDbg(...args) {
    if (isDebugMode() && typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(...args);
    }
  }

  // ===== PARSEO DE NÚMEROS =====
  function parseNum(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

    // Quita espacios (incluye NBSP) y símbolos habituales
    let s = String(val).trim().replace(/[\s\u00A0]/g, '');
    if (!s) return 0;

    // Dejar solo dígitos y separadores comunes
    s = s.replace(/[^0-9,\.\-]/g, '');
    if (!s) return 0;

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    if (hasComma && hasDot) {
      // Si hay coma y punto, asumimos que el ÚLTIMO separador es el decimal
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
      // Solo coma: suele ser decimal (12,34) salvo patrón de miles (1,234,567)
      // Heurística: si empieza por 0, (p.ej. "0,123"), es decimal (muy común en precios/kWh)
      if (/^-?0,\d+$/.test(s)) {
        s = s.replace(',', '.');
      } else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
        s = s.replace(/,/g, '');
      } else {
        const i = s.lastIndexOf(',');
        s = s.slice(0, i).replace(/,/g, '') + '.' + s.slice(i + 1);
      }
    } else if (hasDot) {
      // Solo punto: si es miles (1.234 / 12.345.678) quitar puntos
      // Heurística: si empieza por 0. (p.ej. "0.123"), es decimal (muy común en precios/kWh)
      if (/^-?0\.\d+$/.test(s)) {
        // dejar tal cual
      } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
        s = s.replace(/\./g, '');
      } else {
        // decimal con punto: dejar solo el último
        const i = s.lastIndexOf('.');
        s = s.slice(0, i).replace(/\./g, '') + '.' + s.slice(i + 1);
      }
    }

    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  // ===== ESCAPE HTML =====
  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ===== FORMATEO =====
  function formatMoney(n) {
    return n.toFixed(2).replace('.', ',') + ' €';
  }

  function formatValueForDisplay(val) {
    if (val == null || val === '') return val;
    const str = String(val);
    if (str.includes(',')) return str;
    if (str.includes('.')) return str.replace('.', ',');
    return str;
  }

  // ===== CLAMPING =====
  function clamp01to365Days(raw) {
    const d = Math.trunc(raw);
    if (!Number.isFinite(d) || d === 0) return 30;
    return Math.min(370, Math.max(1, d));
  }

  function clampNonNeg(n) {
    return Math.max(0, Number(n) || 0);
  }

  // ===== REDONDEO =====
  /* Redondeo a 2 decimales (como Excel ROUND(...,2)) */
  function round2(x) {
    return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  }

  // ===== BOOLEANOS =====
  function asBool(val, fallback = false) {
    if (val === undefined || val === null) return fallback;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    return fallback;
  }

  // ===== CLIPBOARD =====
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
    return true;
  }

  // ===== RIPPLE EFFECT =====
  // Captura coordenadas sync pero difiere DOM mutations a rAF (INP)
  function createRipple(b, e) {
    const cx = e.clientX, cy = e.clientY;
    requestAnimationFrame(() => {
      const rect = b.getBoundingClientRect();
      const s = Math.max(rect.width, rect.height);
      const x = cx - rect.left - s / 2;
      const y = cy - rect.top - s / 2;
      b.style.position = 'relative';
      b.style.overflow = 'hidden';

      const colors = [
        'rgba(139, 92, 246, 0.4)',
        'rgba(236, 72, 153, 0.3)',
        'rgba(245, 158, 11, 0.2)'
      ];
      const delays = [0, 100, 200];

      colors.forEach((color, i) => {
        setTimeout(() => {
          const r = document.createElement('span');
          r.setAttribute('aria-hidden', 'true');
          r.style.cssText = `position:absolute;width:${s}px;height:${s}px;border-radius:50%;background:${color};left:${x}px;top:${y}px;pointer-events:none;animation:rippleExpand 0.8s ease-out;`;
          b.appendChild(r);
          setTimeout(() => r.remove(), 800);
        }, delays[i]);
      });
    });
  }

  // ===== SUCCESS PARTICLES =====
  function createSuccessParticles(element) {
    const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#22C55E'];
    const particleCount = 12;

    for (let i = 0; i < particleCount; i++) {
      setTimeout(() => {
        const particle = document.createElement('div');
        particle.className = 'success-particle';
        particle.setAttribute('aria-hidden', 'true');
        particle.style.cssText = `
          left: 50%;
          top: 50%;
          background: ${colors[i % colors.length]};
          --tx: ${(Math.random() - 0.5) * 200}px;
          animation-delay: ${i * 0.05}s;
        `;
        element.style.position = 'relative';
        element.appendChild(particle);
        setTimeout(() => particle.remove(), 1100);
      }, i * 50);
    }
  }

  // ===== COUNTER ANIMATION =====
  function animateCounter(element, finalText) {
    const match = finalText.match(/[\d,.]+/);
    if (!match) {
      element.textContent = finalText;
      return;
    }

    const numStr = match[0].replace(',', '.');
    const finalNum = parseFloat(numStr);
    if (isNaN(finalNum)) {
      element.textContent = finalText;
      return;
    }

    const duration = 800;
    const steps = 30;
    const stepDuration = duration / steps;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentNum = finalNum * easeProgress;

      const formatted = currentNum.toFixed(2).replace('.', ',');
      element.textContent = finalText.replace(match[0], formatted);

      if (currentStep >= steps) {
        clearInterval(interval);
        element.textContent = finalText;
      }
    }, stepDuration);
  }

  // ===== PVPC: BONO SOCIAL (descuento) =====
  // Implementa la misma lógica que el simulador de la CNMC:
  // Descuento = % * (Término fijo + Financiación bono social + %kWh bonificable del término variable)
  // y recalcula impuestos sobre la base ya bonificada.
  function calcPvpcBonoSocial(metaPvpc, inputs, cfg) {
    const meta = metaPvpc || {};
    const i = inputs || {};
    const C = cfg || window.LF_CONFIG || {};

    const dias = Number(i.dias || 0);
    const p1 = Number(i.p1 || 0);
    const p2 = Number(i.p2 || 0);
    const potenciaMax = Math.max(p1, p2);

    const cPunta = Number(i.cPunta || 0);
    const cLlano = Number(i.cLlano || 0);
    const cValle = Number(i.cValle || 0);
    const consumoKwh = cPunta + cLlano + cValle;

    // Fallbacks regulados (si por cualquier razón falta meta)
    const PEAJES_POT_DIA_P1 = 0.075901;
    const PEAJES_POT_DIA_P2 = 0.001987;
    const MARGEN_KW_DIA = 0.008529; // 3,113 €/kW·año / 365

    const terminoFijoPeajes = Number.isFinite(Number(meta.terminoFijo))
      ? Number(meta.terminoFijo)
      : round2((p1 * dias * PEAJES_POT_DIA_P1) + (p2 * dias * PEAJES_POT_DIA_P2));

    const costeMargenPot = Number.isFinite(Number(meta.costeMargenPot))
      ? Number(meta.costeMargenPot)
      : round2(potenciaMax * dias * MARGEN_KW_DIA);

    const terminoVariable = Number.isFinite(Number(meta.terminoVariable)) ? Number(meta.terminoVariable) : 0;

    const financiacionBono = Number.isFinite(Number(meta.bonoSocial))
      ? Number(meta.bonoSocial)
      : (C.calcularBonoSocial ? Number(C.calcularBonoSocial(dias)) : 0);

    const terminoFijoTotal = terminoFijoPeajes + costeMargenPot;

    // Parámetros bono social (UI): tipo (% descuento) + límite anual (kWh)
    const bonoSocialOn = !!i.bonoSocialOn;
    const tipo = String(i.bonoSocialTipo || 'vulnerable');
    const porcentaje = (tipo === 'severo') ? 0.575 : 0.425;
    const limiteAnual = Number(i.bonoSocialLimite || 0);
    const limitePeriodo = limiteAnual > 0 ? (limiteAnual / 365) * dias : 0;
    // En el comparador no estimamos arrastres de kWh bonificables entre facturas (la CNMC tampoco lo permite en su simulador).
    const kwhBonificable = Math.max(0, Math.min(consumoKwh, limitePeriodo));
    const ratioBonificable = consumoKwh > 0 ? (kwhBonificable / consumoKwh) : 0;

    const baseVariableBonif = terminoVariable * ratioBonificable;
    const baseDescuento = terminoFijoTotal + financiacionBono + baseVariableBonif;
    const descuentoEur = (bonoSocialOn && baseDescuento > 0) ? round2(baseDescuento * porcentaje) : 0;

    // ⚠️ CRÍTICO (PUNTO DE CONFUSIÓN PARA IAs):
    // El IEE se calcula DESPUÉS de restar el descuento del Bono Social.
    // Orden correcto:
    //   1. Calcular descuento BS
    //   2. Restar descuento de la base
    //   3. LUEGO calcular IEE sobre base reducida
    //
    // Validación CNMC (221 kWh + BS):
    //   Base CON descuento: 44,16€
    //   IEE (5,11% × 44,16€): 2,26€ ✅
    //
    // Si hicieras al revés:
    //   Base SIN descuento: 56,97€
    //   IEE (5,11% × 56,97€): 2,91€ ❌ INCORRECTO
    //
    // Ref: RD 897/2017, validado contra CNMC v2.1.2
    const baseEnergia = round2(terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur);

    const impuestoElectrico = (C.calcularIEE && Number.isFinite(consumoKwh))
      ? round2(C.calcularIEE(baseEnergia, consumoKwh))
      : 0;

    const equipoMedida = Number.isFinite(Number(meta.equipoMedida))
      ? Number(meta.equipoMedida)
      : (C.calcularAlquilerContador ? round2(C.calcularAlquilerContador(dias)) : 0);

    const zonaFiscal = String(i.zonaFiscal || 'Península');
    const territorio = (C.getTerritorio ? C.getTerritorio(zonaFiscal) : (C.territorios ? C.territorios.peninsula : null)) || {};

    // Impuesto por territorio
    let usoFiscal = 'otros';
    let impuestoEnergia = 0;
    let impuestoContador = 0;
    let iva = 0;
    let ivaBase = 0;
    let baseIPSI = 0;

    if ((territorio.nombre || '') === 'Canarias') {
      const vivienda = !!i.viviendaCanarias && potenciaMax <= (territorio.limiteViviendaKw || 10);
      usoFiscal = vivienda ? 'vivienda' : 'otros';
      if (!vivienda) {
        impuestoEnergia = round2((baseEnergia + impuestoElectrico) * (territorio.impuestos?.energiaOtros || 0));
      }
      impuestoContador = round2(equipoMedida * (territorio.impuestos?.contador || 0));
    } else if ((territorio.nombre || '') === 'Ceuta y Melilla') {
      usoFiscal = 'ipsi';
      baseIPSI = round2(baseEnergia + impuestoElectrico + equipoMedida);
      impuestoEnergia = round2((baseEnergia + impuestoElectrico) * (territorio.impuestos?.energia || 0));
      impuestoContador = round2(equipoMedida * (territorio.impuestos?.contador || 0));
    } else {
      // Península y Baleares (IVA)
      usoFiscal = 'iva';
      ivaBase = round2(baseEnergia + impuestoElectrico + equipoMedida);
      iva = round2(ivaBase * (territorio.impuestos?.energia || 0));
      impuestoEnergia = iva;
      impuestoContador = 0;
    }

    const impuestosTotal = round2((financiacionBono || 0) + (impuestoElectrico || 0) + (equipoMedida || 0) + (impuestoEnergia || 0) + (impuestoContador || 0));
    const totalFactura = round2(baseEnergia + impuestoElectrico + equipoMedida + impuestoEnergia + impuestoContador);

    // Otros conceptos (para cuadrar con columnas Potencia + Energía + Impuestos)
    const otrosConceptos = round2(totalFactura - terminoFijoPeajes - terminoVariable);

    const metaAdj = Object.assign({}, meta, {
      // mantenemos término fijo SIN margen (semántica UI), margen aparte
      terminoFijo: round2(terminoFijoPeajes),
      costeMargenPot: round2(costeMargenPot),
      terminoVariable: round2(terminoVariable),
      bonoSocial: round2(financiacionBono),
      bonoSocialDescuentoEur: descuentoEur,
      bonoSocialProximoMes: 0,

      // fiscalidad recalculada
      baseEnergia: baseEnergia,
      impuestoElectrico: round2(impuestoElectrico),
      equipoMedida: round2(equipoMedida),
      impuestoEnergia: round2(impuestoEnergia),
      impuestoContador: round2(impuestoContador),
      iva: round2(iva),
      ivaBase: round2(ivaBase),
      baseIPSI: round2(baseIPSI),
      impuestosTotal: impuestosTotal,
      totalFactura: totalFactura,
      usoFiscal: usoFiscal,

      // ayuda a la UI (ranking)
      otrosConceptos: otrosConceptos,

      // detalle del descuento para el desglose
      bonoSocialCalc: {
        on: bonoSocialOn,
        tipo,
        porcentaje,
        dias,
        consumoKwh,
        limiteAnual,
        kwhBonificable: round2(kwhBonificable),
        ratioBonificable,
        terminoFijoTotal: round2(terminoFijoTotal),
        baseVariableBonif: round2(baseVariableBonif),
        baseDescuento: round2(baseDescuento)
      }
    });

    return {
      meta: metaAdj,
      descuentoEur,
      otrosConceptos,
      kwhBonificable,
      ratioBonificable
    };
  }

  // ===== DEBUG: INP (solo cuando debug=1) =====
  function initInpDebugObserver() {
    if (!isDebugMode()) return;
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
    if (typeof window.addEventListener !== 'function') return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    if (window.__LF_INP_DEBUG_ACTIVE) return;
    window.__LF_INP_DEBUG_ACTIVE = true;

    let worst = { duration: 0, entry: null };

    const describeTarget = (target) => {
      if (!target) return '';
      const tag = target.tagName ? target.tagName.toLowerCase() : '';
      const id = target.id ? `#${target.id}` : '';
      const cls = target.className && typeof target.className === 'string'
        ? `.${target.className.trim().split(/\s+/)[0]}`
        : '';
      return `${tag}${id || cls}`.trim();
    };

    const IGNORE_NAMES = new Set([
      'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointermove',
      'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove',
      'scroll', 'wheel', 'touchmove'
    ]);

    const isInteraction = (entry) => {
      const name = String(entry?.name || '');
      if (IGNORE_NAMES.has(name)) return false;
      if (entry?.interactionId && entry.interactionId > 0) return true;
      // Fallback for older browsers: accept common interaction events only.
      return name === 'click' || name === 'pointerdown' || name === 'pointerup' || name === 'keydown' || name === 'touchstart';
    };

    const updateWorst = (entry) => {
      const dur = Number(entry?.duration || 0);
      if (dur <= worst.duration) return;
      worst = { duration: dur, entry };
    };

    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!isInteraction(entry)) continue;
          updateWorst(entry);
        }
      });
      po.observe({ type: 'event', durationThreshold: 40, buffered: true });
    } catch (_) {
      // Safari/Chromium antiguos podrían lanzar aquí
    }

    let logged = false;
    const logWorst = () => {
      if (logged || !worst.entry) return;
      logged = true;
      const e = worst.entry;
      const name = e.name || 'interaction';
      const target = describeTarget(e.target);
      const duration = Math.round(worst.duration);
      console.log(`[INP][debug] peor interacción: ${duration} ms (${name}${target ? ' en ' + target : ''})`);
    };

    window.addEventListener('pagehide', logWorst, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') logWorst();
    });
  }

  // ===== EXPORTAR AL GLOBAL =====
  window.lfDbg = lfDbg;
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    isDebugMode,
    parseNum,
    escapeHtml,
    formatMoney,
    formatValueForDisplay,
    clamp01to365Days,
    clampNonNeg,
    round2,
    asBool,
    copyText,
    createRipple,
    createSuccessParticles,
    animateCounter,
    calcPvpcBonoSocial,
    yieldControl: () => {
      if (typeof window.scheduler !== 'undefined' && window.scheduler.yield) {
        return window.scheduler.yield();
      }
      return new Promise(resolve => setTimeout(resolve, 0));
    }
  });

  // Inicializar observador INP en modo debug.
  initInpDebugObserver();

})();
