/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

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
    s = s.replace(/[^0-9,.-]/g, '');
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
      } else if (/^-?\d{1,3}(,\d{3}){2,}$/.test(s)) {
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
    if (n === null || n === undefined || n === '') return '—';
    const value = Number(n);
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(2).replace('.', ',') + ' €';
  }

  function formatValueForDisplay(val) {
    if (val == null || val === '') return val;
    const str = String(val);
    if (str.includes(',')) return str;

    const trimmed = str.trim();
    if (!trimmed.includes('.')) return str;

    // parseNum interpreta 1.234 / 12.345 / 1.234.567 como miles, pero
    // 0.123 como decimal. El formateo visual no puede cambiar esa semántica:
    // solo convertimos el punto cuando es inequívocamente decimal.
    const strictDotThousands = /^\d{1,3}(?:\.\d{3})+$/.test(trimmed)
      && !/^0\.\d+$/.test(trimmed);
    if (strictDotThousands) return str;

    const dotCount = (trimmed.match(/\./g) || []).length;
    if (dotCount === 1) return str.replace('.', ',');

    // Un valor con varios puntos que no cumple el patrón de miles se deja
    // intacto para que esNumericoValido lo rechace; no intentamos "arreglarlo".
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

  // Los límites son anuales. Los kWh ya registrados siempre pueden demostrar
  // que se ha superado un máximo; en periodos parciales, una proyección solo se
  // aplica si el usuario la activa expresamente.
  function assessConsumoAnualLimits(tarifas, {
    consumoKwh = 0,
    annualScope = false,
    coveredDays = 0,
    useAnnualEstimate = false
  } = {}) {
    const consumo = clampNonNeg(consumoKwh);
    const dias = clampNonNeg(coveredDays);
    const estimacionDisponible = !annualScope && dias > 0 && dias < 365;
    const consumoAnualEstimadoKwh = estimacionDisponible
      ? consumo * 365 / dias
      : null;
    const aplicarEstimacion = Boolean(useAnnualEstimate && estimacionDisponible);
    const compatibles = [];
    const excluidas = [];
    const excluidasReales = [];
    const excluidasEstimadas = [];

    (Array.isArray(tarifas) ? tarifas : []).forEach((tarifa) => {
      const maximo = Number(tarifa?.maxConsumoAnual);
      let exclusionReal = null;
      let exclusionEstimada = null;

      if (Number.isFinite(maximo) && maximo > 0 && consumo > maximo) {
        exclusionReal = { tarifa, tipo: 'maximo', limiteKwh: maximo, origen: 'registrado' };
      } else if (estimacionDisponible && Number.isFinite(maximo) && maximo > 0 && consumoAnualEstimadoKwh > maximo) {
        exclusionEstimada = { tarifa, tipo: 'maximo', limiteKwh: maximo, origen: 'estimacion' };
      }

      if (exclusionReal) {
        excluidasReales.push(exclusionReal);
        excluidas.push(exclusionReal);
      } else {
        if (exclusionEstimada) excluidasEstimadas.push(exclusionEstimada);
        if (exclusionEstimada && aplicarEstimacion) excluidas.push(exclusionEstimada);
        else compatibles.push(tarifa);
      }
    });

    return {
      consumoKwh: consumo,
      annualScope: Boolean(annualScope),
      coveredDays: dias,
      estimatedAnnualKwh: consumoAnualEstimadoKwh,
      estimateAvailable: estimacionDisponible,
      estimateApplied: aplicarEstimacion,
      compatibles,
      excluidas,
      excluidasReales,
      excluidasEstimadas
    };
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
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
    return copied;
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
    // Cancelar animación previa sobre el mismo elemento si existe
    if (element.__animateInterval) {
      clearInterval(element.__animateInterval);
      delete element.__animateInterval;
    }

    // Un contador anima un NUMERO, y ese numero tiene que ser el principio del texto
    // ("79,12 EUR", "4356 kWh/ano"). Una etiqueta que solo CONTIENE digitos no es un
    // contador: `/[\d,.]+/` capturaba el primer numero que encontrase, asi que
    // animateCounter(el, 'Visalia Fija 24h') pintaba "Visalia Fija 2,32h" durante 800 ms
    // -- un nombre de tarifa que no existe. Afecta a 79 de las 122 tarifas del catalogo,
    // que llevan digitos en el nombre ("Plenitude +5kW" -> "Plenitude +1,35kW").
    const match = /^\s*(\d[\d.]*(?:,\d+)?)/.exec(finalText);
    // Con `prefers-reduced-motion` el usuario ha pedido que no se anime. El CSS no puede
    // frenar esto porque no es una animacion CSS: son 30 escrituras de textContent.
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!match || reduceMotion) {
      element.textContent = finalText;
      return;
    }

    const rawNum = match[1];
    // Formato es-ES: el punto separa MILLARES y la coma es el decimal. Un
    // `replace(',', '.')` a secas convierte "1.234,56" en 1,234. DEFENSA, no un fallo
    // observado: formatMoney() no pone separador de millares hoy ("1080,24 EUR"), asi
    // que ese texto no llega aqui. Si algun dia lo pusiera, el sintoma seria mudo.
    const finalNum = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(finalNum)) {
      element.textContent = finalText;
      return;
    }
    const decimales = rawNum.includes(',') ? rawNum.split(',')[1].length : 0;

    const duration = 800;
    const steps = 30;
    const stepDuration = duration / steps;
    let currentStep = 0;

    // Guardar el ID del intervalo en el propio elemento para poder cancelarlo si se reanima
    element.__animateInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentNum = finalNum * easeProgress;

      const formatted = currentNum.toLocaleString('es-ES', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
      });
      element.textContent = finalText.replace(rawNum, formatted);

      if (currentStep >= steps) {
        clearInterval(element.__animateInterval);
        delete element.__animateInterval;
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
    const _pvpcPot = window.LF_CONFIG?.peajesPotenciaPVPC ?? {};
    const PEAJES_POT_DIA_P1 = _pvpcPot.p1     ?? 0.075901;
    const PEAJES_POT_DIA_P2 = _pvpcPot.p2     ?? 0.001987;
    const MARGEN_KW_DIA     = _pvpcPot.margen ?? 0.008529;

    const terminoFijoPeajes = Number.isFinite(Number(meta.terminoFijo))
      ? Number(meta.terminoFijo)
      : round2((p1 * dias * PEAJES_POT_DIA_P1) + (p2 * dias * PEAJES_POT_DIA_P2));

    const costeMargenPot = Number.isFinite(Number(meta.costeMargenPot))
      ? Number(meta.costeMargenPot)
      : round2(p1 * dias * MARGEN_KW_DIA);

    const terminoVariable = Number.isFinite(Number(meta.terminoVariable)) ? Number(meta.terminoVariable) : 0;

    const financiacionBono = Number.isFinite(Number(meta.bonoSocial))
      ? Number(meta.bonoSocial)
      : (C.calcularBonoSocial ? Number(C.calcularBonoSocial(dias)) : 0);

    const terminoFijoTotal = terminoFijoPeajes + costeMargenPot;

    // Parámetros bono social (UI): tipo (% descuento) + límite anual (kWh)
    const bonoSocialOn = !!i.bonoSocialOn;
    const tipo = String(i.bonoSocialTipo || 'vulnerable');
    if (typeof C.getBonoSocialDiscountRate !== 'function') {
      throw new Error('[PVPC] LF_CONFIG.getBonoSocialDiscountRate no está disponible');
    }
    const porcentaje = Number(C.getBonoSocialDiscountRate(tipo));
    if (!Number.isFinite(porcentaje)) {
      throw new Error(`[PVPC] Descuento del bono social inválido para "${tipo}"`);
    }
    const limiteAnual = Number(i.bonoSocialLimite || 0);
    const limitePeriodo = limiteAnual > 0 ? (limiteAnual / 365) * dias : 0;
    // En el comparador no estimamos arrastres de kWh bonificables entre facturas porque no disponemos del saldo histórico del usuario.
    const kwhBonificable = Math.max(0, Math.min(consumoKwh, limitePeriodo));
    const ratioBonificable = consumoKwh > 0 ? (kwhBonificable / consumoKwh) : 0;

    const baseVariableBonif = terminoVariable * ratioBonificable;
    const baseDescuento = terminoFijoTotal + financiacionBono + baseVariableBonif;
    const descuentoEur = (bonoSocialOn && baseDescuento > 0)
      ? (typeof C.roundMoneyProducts === 'function'
          ? C.roundMoneyProducts([[terminoFijoTotal, porcentaje], [financiacionBono, porcentaje], [baseVariableBonif, porcentaje]])
          : round2(baseDescuento * porcentaje))
      : 0;

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

    const fiscalContext = (typeof C.getFiscalContext === 'function')
      ? C.getFiscalContext({
          zona: i.zonaFiscal,
          potenciaContratada: potenciaMax,
          viviendaCanarias: i.viviendaCanarias,
          bonoSocialOn,
          bonoSocialTipo: tipo,
          fechaYmd: i.fechaYmd
        })
      : null;

    const impuestoElectrico = (C.calcularIEE && Number.isFinite(consumoKwh))
      ? (typeof C.calcularIEERedondeado === 'function'
          ? C.calcularIEERedondeado(baseEnergia, consumoKwh, fiscalContext?.fechaYmd || i.fechaYmd)
          : round2(C.calcularIEE(baseEnergia, consumoKwh, fiscalContext?.fechaYmd || i.fechaYmd)))
      : 0;

    const equipoMedida = Number.isFinite(Number(meta.equipoMedida))
      ? Number(meta.equipoMedida)
      : (C.calcularAlquilerContador ? round2(C.calcularAlquilerContador(dias)) : 0);

    const zonaFiscal = String(i.zonaFiscal || 'Península');
    const territorio = (C.getTerritorio ? C.getTerritorio(zonaFiscal) : (C.territorios ? C.territorios.peninsula : null)) || {};

    // Impuesto por territorio
    let usoFiscal;
    let impuestoEnergia = 0;
    let impuestoContador;
    let iva = 0;
    let ivaBase = 0;
    let baseIPSI = 0;

    const esCanarias = (territorio.nombre || '') === 'Canarias';
    const esCeutaMelilla = (territorio.nombre || '') === 'Ceuta y Melilla';

    if (typeof C.calcularImpuestoIndirecto === 'function') {
      usoFiscal = fiscalContext?.usoFiscal
        || (esCanarias
          ? ((!!i.viviendaCanarias && potenciaMax <= (territorio.limiteViviendaKw || 10)) ? 'vivienda' : 'otros')
          : (esCeutaMelilla ? 'ipsi' : 'iva_general'));

      const taxCalc = C.calcularImpuestoIndirecto({
        zona: zonaFiscal,
        usoFiscal,
        baseEnergia,
        impuestoElectrico,
        baseContador: equipoMedida,
        potenciaContratada: potenciaMax,
        viviendaCanarias: i.viviendaCanarias,
        bonoSocialOn,
        bonoSocialTipo: tipo,
        fechaYmd: fiscalContext?.fechaYmd || i.fechaYmd
      });

      impuestoEnergia = round2(taxCalc.impuestoEnergia);
      impuestoContador = round2(taxCalc.impuestoContador);
      iva = round2(taxCalc.iva);
      ivaBase = round2(taxCalc.ivaBase);
      baseIPSI = round2(taxCalc.baseIPSI);
      usoFiscal = taxCalc.usoFiscal || usoFiscal;
    } else if (esCanarias) {
      const vivienda = !!i.viviendaCanarias && potenciaMax <= (territorio.limiteViviendaKw || 10);
      usoFiscal = vivienda ? 'vivienda' : 'otros';
      if (!vivienda) {
        impuestoEnergia = round2((baseEnergia + impuestoElectrico) * (territorio.impuestos?.energiaOtros || 0));
      }
      impuestoContador = round2(equipoMedida * (territorio.impuestos?.contador || 0));
    } else if (esCeutaMelilla) {
      usoFiscal = 'ipsi';
      baseIPSI = round2(baseEnergia + impuestoElectrico + equipoMedida);
      impuestoEnergia = round2((baseEnergia + impuestoElectrico) * (territorio.impuestos?.energia || 0));
      impuestoContador = round2(equipoMedida * (territorio.impuestos?.contador || 0));
    } else {
      // Península y Baleares (IVA)
      usoFiscal = 'iva_general';
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
      fechaYmd: fiscalContext?.fechaYmd || i.fechaYmd || null,

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

  // ===== VALIDACIÓN NUMÉRICA (compartida por inputs y tarifa personalizada) =====
  // Valida strings numéricos con formato europeo (coma decimal, puntos/espacios
  // como separadores de miles). maxDecimales limita la parte fraccionaria.
  function esNumericoValido(str, maxDecimales = 2) {
    if (str == null) return false;
    const s = String(str).trim();
    if (!s || s.length > 20) return false;
    if (/^[.,]|[.,]$/.test(s)) return false;
    if (!/^[\d.,\s\u00A0]+$/.test(s)) return false;

    const maxRaw = Number(maxDecimales);
    const maxFrac = Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : 2;
    const intPlain = /^\d+$/;
    const intSpaced = /^\d{1,3}(?:[\s\u00A0]\d{3})+$/;
    const intDotThousands = /^\d{1,3}(?:\.\d{3})+$/;
    const validIntegerWithoutDots = (value) => intPlain.test(value) || intSpaced.test(value);

    const numComas = (s.match(/,/g) || []).length;
    const numPuntos = (s.match(/\./g) || []).length;
    if (numComas > 1) return false;

    if (numComas === 1) {
      // Formato europeo: la coma es decimal. A su izquierda admitimos entero
      // simple, miles con espacios o miles con puntos; a su derecha, solo cifras.
      const [integerPart, fraction] = s.split(',');
      if (!integerPart || !fraction || !/^\d+$/.test(fraction)) return false;
      if (fraction.length > maxFrac) return false;
      return validIntegerWithoutDots(integerPart) || intDotThousands.test(integerPart);
    }

    // Enteros sin decimal, incluidos miles con espacios.
    if (validIntegerWithoutDots(s)) return true;

    // parseNum trata los grupos estrictos con punto como miles. La excepción
    // deliberada es 0.xxx, que representa precios decimales habituales.
    if (intDotThousands.test(s) && !/^0\.\d+$/.test(s)) return true;

    // Decimal con punto: exactamente un punto, agrupación válida a la izquierda
    // y el mismo límite de precisión que para la coma decimal.
    if (numPuntos !== 1) return false;
    const [integerPart, fraction] = s.split('.');
    if (!integerPart || !fraction || !/^\d+$/.test(fraction)) return false;
    if (fraction.length > maxFrac) return false;
    return validIntegerWithoutDots(integerPart);
  }

  // ===== URL SAFE (canónica, compartida por home y simulador solar) =====
  // Acepta solo http/https o rutas relativas explícitas (/, ./, ../).
  // Bloquea esquemas peligrosos (javascript:, data:, etc.) y URLs inválidas.
  // Consumidores: lf-render.js (safeUrl) y bv/bv-ui.js (sanitizeUrl).
  function safeUrl(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '';

    // En URLs "special" (http/https), WHATWG normaliza barras invertidas como
    // barras y elimina ciertos controles. Si se aceptan antes de parsear,
    // /\\evil.com o /<TAB>/evil.com pueden acabar siendo cross-origin.
    // eslint-disable-next-line no-control-regex -- deteccion deliberada de controles ASCII (ver comentario de arriba)
    if (/[\u0000-\u001F\u007F\\]/.test(s)) return '';

    // Permitir rutas relativas explícitas
    if (/^(\/(?!\/)|\.\.?\/)/.test(s)) return s;

    try {
      const u = new URL(s);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (_) {
      // URL inválida → bloquear
    }
    return '';
  }

  // ===== MODAL SCROLL LOCK =====
  // La home usa BODY como scroller efectivo (ver AGENTS.md). Centralizamos el
  // bloqueo para que los modales no mezclen window/documentElement con BODY y
  // para preservar estilos/posicion cuando dos modales se solapan.
  function createModalScrollLock() {
    const activeTokens = new Set();
    let savedState = null;

    function bodyScrollTop() {
      const body = document.body;
      return body && Number.isFinite(Number(body.scrollTop)) ? Number(body.scrollTop) : 0;
    }

    function lock(owner = 'modal') {
      const token = Symbol(String(owner || 'modal'));
      if (activeTokens.size === 0) {
        const body = document.body;
        const html = document.documentElement;
        savedState = {
          bodyOverflow: body?.style?.overflow ?? '',
          htmlOverflow: html?.style?.overflow ?? '',
          scrollTop: bodyScrollTop()
        };
        if (body?.style) body.style.overflow = 'hidden';
        if (html?.style) html.style.overflow = 'hidden';
      }
      activeTokens.add(token);
      return token;
    }

    function unlock(token) {
      if (!activeTokens.has(token)) return false;
      activeTokens.delete(token);
      if (activeTokens.size !== 0) return true;

      const state = savedState;
      savedState = null;
      const body = document.body;
      const html = document.documentElement;
      if (body?.style) body.style.overflow = state?.bodyOverflow ?? '';
      if (html?.style) html.style.overflow = state?.htmlOverflow ?? '';
      if (body && state && Number.isFinite(state.scrollTop)) body.scrollTop = state.scrollTop;
      return true;
    }

    return Object.freeze({ lock, unlock });
  }

  const modalScrollLock = createModalScrollLock();

  // Estructura MINIMA que cualquier consumidor de tarifas.json necesita para calcular una
  // fila. No replica el contrato del generador local (Excel), que ya valida las reglas
  // comerciales antes de publicar: aqui solo se comprueban tipos y finitud, para que un
  // artefacto corrupto o un deploy a medias no pueda pisar una copia sana con datos
  // inutilizables. Compartida entre home/comparador (lf-cache.js) y el simulador solar
  // (bv-sim-monthly.js) para que ambos apliquen el mismo criterio de "todo o nada".
  // Ojo: un 0 es un precio VALIDO (p2 puede valer 0 por contrato, ver JSON-SCHEMA.md),
  // asi que se exige finitud, nunca un minimo.
  const TARIFA_CAMPOS_NUMERICOS = ['p1', 'p2', 'cPunta', 'cLlano', 'cValle'];

  function esTarifaUtilizable(tarifa) {
    if (!tarifa || typeof tarifa !== 'object' || Array.isArray(tarifa)) return false;
    if (typeof tarifa.nombre !== 'string' || !tarifa.nombre.trim()) return false;
    if (tarifa.tipo !== '1P' && tarifa.tipo !== '3P') return false;
    return TARIFA_CAMPOS_NUMERICOS.every((campo) => (
      typeof tarifa[campo] === 'number' && Number.isFinite(tarifa[campo])
    ));
  }

  // ===== EXPORTAR AL GLOBAL =====
  window.lfDbg = lfDbg;
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    isDebugMode,
    parseNum,
    escapeHtml,
    safeUrl,
    modalScrollLock,
    formatMoney,
    formatValueForDisplay,
    clamp01to365Days,
    clampNonNeg,
    assessConsumoAnualLimits,
    round2,
    asBool,
    copyText,
    createSuccessParticles,
    animateCounter,
    calcPvpcBonoSocial,
    esNumericoValido,
    esTarifaUtilizable,
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
