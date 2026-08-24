/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

/**
 * lf-config.js - Configuración centralizada de valores regulados
 * 
 * Este archivo contiene todos los valores que pueden cambiar por legislación.
 * Referencias revisadas: 19/08/2026
 * 
 * Referencias legales:
 * - Bono social: RD 897/2017 + RDL 7/2026 (financiación: 9,011295 EUR/CUPS/año vigente desde 01/07/2026)
 * - IEE: Ley 38/1992 Art. 99 + RDL 7/2026 + RDL 18/2026 (mecanismo de salvaguarda: agosto depende del IPC
 *   anual de Electricidad de junio, septiembre del de julio; el de julio (subclase 04.5.10) fue del 8,4%
 *   — ninguno de los dos meses supera el umbral de >15% que activaría la reducción)
 * - IVA: Ley 37/1992 + RDL 7/2026, RDL 10/2026 y RDL 18/2026 (agosto y septiembre al 21%, mismo mecanismo
 *   y meses de referencia que el IEE: junio determina agosto, julio determina septiembre — el de julio
 *   fue del 8,4% anual, por debajo del umbral que activaría la reducción)
 * - IGIC: Ley 4/2012 Art. 52 (0% vivienda ≤10kW, 3% otros, 7% contador)
 * - IPSI: Ley 8/1991 Art. 18 (1% electricidad, 4% servicios)
 * - Alquiler contador: Orden ITC/3860/2007 (0,81 €/mes)
 */

(function(global) {
  'use strict';

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // Productos monetarios primarios: conserva los operandos decimales antes de
  // multiplicarlos. Así una frontera como 85 × 0.095 = 8.075 no depende de la
  // aproximación binaria previa de IEEE-754. La regla de empate es simétrica:
  // HALF_AWAY_FROM_ZERO (+0.005 -> +0.01; -0.005 -> -0.01).
  const POW10_CACHE = [1n];
  const pow10BigInt = (exp) => {
    if (!Number.isSafeInteger(exp) || exp < 0 || exp > 1000) return null;
    while (POW10_CACHE.length <= exp) {
      POW10_CACHE.push(POW10_CACHE[POW10_CACHE.length - 1] * 10n);
    }
    return POW10_CACHE[exp];
  };

  const parseDecimalOperand = (value) => {
    let raw;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
      raw = String(value);
    } else if (typeof value === 'string') {
      raw = value.trim();
      if (!raw) return null;
    } else {
      return null;
    }

    const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
    if (!m) return null;

    const exponent = m[5] ? Number(m[5]) : 0;
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;

    const integerPart = m[2] || '';
    const fractionPart = m[3] !== undefined ? m[3] : (m[4] || '');
    let digits = `${integerPart || '0'}${fractionPart}`.replace(/^0+(?=\d)/, '');
    if (!digits) digits = '0';

    let integer;
    try {
      integer = BigInt(digits);
    } catch (e) {
      return null;
    }
    if (m[1] === '-') integer = -integer;

    let scale = fractionPart.length - exponent;
    if (scale < 0) {
      const mul = pow10BigInt(-scale);
      if (mul === null) return null;
      integer *= mul;
      scale = 0;
    }
    if (scale > 1000) return null;

    // Quitar ceros decimales finales reduce escalas sin perder información.
    while (scale > 0 && integer !== 0n && integer % 10n === 0n) {
      integer /= 10n;
      scale -= 1;
    }
    if (integer === 0n) scale = 0;
    return { integer, scale };
  };

  const roundMoneyProductRatio = (products, divisorValue) => {
    if (!Array.isArray(products) || products.length > 2000) return Number.NaN;
    const parsedDivisor = parseDecimalOperand(divisorValue);
    if (!parsedDivisor || parsedDivisor.scale !== 0 || parsedDivisor.integer <= 0n) return Number.NaN;
    if (products.length === 0) return 0;

    const terms = [];
    let commonScale = 0;
    for (const factors of products) {
      if (!Array.isArray(factors) || factors.length === 0 || factors.length > 16) return Number.NaN;
      let integer = 1n;
      let scale = 0;
      for (const factor of factors) {
        const parsed = parseDecimalOperand(factor);
        if (!parsed) return Number.NaN;
        integer *= parsed.integer;
        scale += parsed.scale;
        if (scale > 1000) return Number.NaN;
      }
      terms.push({ integer, scale });
      if (scale > commonScale) commonScale = scale;
    }

    let total = 0n;
    for (const term of terms) {
      const mul = pow10BigInt(commonScale - term.scale);
      if (mul === null) return Number.NaN;
      total += term.integer * mul;
    }

    let numerator;
    let divisor;
    if (commonScale <= 2) {
      const mul = pow10BigInt(2 - commonScale);
      if (mul === null) return Number.NaN;
      numerator = total * mul;
      divisor = parsedDivisor.integer;
    } else {
      const scaleDivisor = pow10BigInt(commonScale - 2);
      if (scaleDivisor === null) return Number.NaN;
      numerator = total;
      divisor = parsedDivisor.integer * scaleDivisor;
    }

    const negative = numerator < 0n;
    const magnitude = negative ? -numerator : numerator;
    let quotient = magnitude / divisor;
    const remainder = magnitude % divisor;
    if (remainder * 2n >= divisor) quotient += 1n;
    const cents = negative ? -quotient : quotient;

    const maxSafeCents = BigInt(Number.MAX_SAFE_INTEGER);
    if (cents > maxSafeCents || cents < -maxSafeCents) return Number.NaN;
    if (cents === 0n) return 0;
    return Number(cents) / 100;
  };

  const roundMoneyProducts = (products) => roundMoneyProductRatio(products, 1);
  const roundMoneyProductsDividedBy = (products, divisor) => roundMoneyProductRatio(products, divisor);

  // Los tipos indirectos se aplican sobre importes monetarios ya expresados a
  // céntimo. Operar desde esos céntimos evita que una frontera decimal exacta
  // (p. ej. 142,50 € × 3% = 4,275 €) caiga por debajo debido a IEEE-754.
  const roundMoneyRate = (base, rate) => {
    const baseCents = Math.round(round2(base) * 100);
    const rateBasisPoints = Math.round(Number(rate) * 10000);
    const scaled = baseCents * rateBasisPoints;
    return Math.floor((scaled * 2 + 10000) / 20000) / 100;
  };

  const LF_CONFIG = {
    // ═══════════════════════════════════════════════════════════════════
    // VERSIÓN Y METADATOS
    // ═══════════════════════════════════════════════════════════════════
    version: '2026.08',
    ultimaActualizacion: '2026-08-19',

    // ═══════════════════════════════════════════════════════════════════
    // CONSTANTES DE VALIDACIÓN COMPARTIDAS
    // ═══════════════════════════════════════════════════════════════════
    // Ámbito del comparador: peaje 2.0TD (≤15 kW en todos los periodos).
    POTENCIA_MAX_KW: 15,
    INDEXED_SURPLUS_REFERENCE_PRICE: 0.02,

    // ═══════════════════════════════════════════════════════════════════
    // UTILIDADES MATEMÁTICAS CANÓNICAS
    // ═══════════════════════════════════════════════════════════════════
    round2,
    roundMoneyProducts,
    roundMoneyProductsDividedBy,

    // ═══════════════════════════════════════════════════════════════════
    // BONO SOCIAL (descuento + financiación)
    // Descuentos 2026: RDL 7/2026 | Financiación: 9,011295 EUR/CUPS/año (vigente desde 01/07/2026)
    // ═══════════════════════════════════════════════════════════════════
    bonoSocial: {
      eurosAnuales: 9.011295,  // €/año
      descuentos2026: {
        vulnerable: 0.425,
        severo: 0.575,
        referencia: 'RDL 7/2026'
      },
      descripcion: 'Financiación bono social 2026'
    },

    // ═══════════════════════════════════════════════════════════════════
    // IMPUESTO ESPECIAL ELECTRICIDAD (IEE)
    // Ley 38/1992 Art. 99
    // ═══════════════════════════════════════════════════════════════════
    iee: {
      porcentaje: 5.11269632,       // %
      minimoEurosKwh: 0.001,        // €/kWh (mínimo legal)
      descripcion: 'Impuesto especial electricidad'
    },

    // ═══════════════════════════════════════════════════════════════════
    // ALQUILER CONTADOR
    // Orden ITC/3860/2007
    // ═══════════════════════════════════════════════════════════════════
    alquilerContador: {
      eurosMes: 0.81,              // €/mes (monofásico ≤15kW)
      descripcion: 'Alquiler equipo de medida'
    },

    // ═══════════════════════════════════════════════════════════════════
    // PEAJES Y CARGOS DE ENERGÍA — Tarifa 2.0TD (€/kWh por periodo)
    // Peajes: Resolución CNMC 18/12/2025 (BOE-A-2025-26348), Circular 3/2020
    // Cargos: Orden TED/1524/2025 (BOE-A-2025-26705)
    // Vigentes desde 1 de enero de 2026
    // ═══════════════════════════════════════════════════════════════════
    peajesCargosEnergia: {
      // Peajes transporte+distribución + Cargos del sistema (sumados)
      P1: 0.097553,   // Punta:  peaje 0.033261 + cargo 0.064292
      P2: 0.029267,   // Llano:  peaje 0.016409 + cargo 0.012858
      P3: 0.003292,   // Valle:  peaje 0.000077 + cargo 0.003215
      descripcion: 'Peajes + cargos energía 2.0TD 2026'
    },

    // ═══════════════════════════════════════════════════════════════════
    // PEAJES + CARGOS DE POTENCIA PVPC — Tarifa 2.0TD
    // La regulación publica estos componentes en €/kW·año. En 2026 se
    // prorratean por días/365 sin redondear antes a un literal diario.
    // P1: peaje 23,324952 + cargo 4,379461 = 27,704413 €/kW·año.
    // P2: peaje 0,443770 + cargo 0,281653 = 0,725423 €/kW·año.
    // CCF: 3,113 €/kW·año (ETU/1948/2016; continuidad TED/1484/2021).
    // Los campos diarios se mantienen por compatibilidad, derivados a precisión
    // completa. `diasAnio` pertenece a la configuración 2026; no es una regla
    // universal para años bisiestos.
    // ═══════════════════════════════════════════════════════════════════
    peajesPotenciaPVPC: {
      diasAnio: 365,
      anualP1: 27.704413,
      anualP2: 0.725423,
      anualMargen: 3.113,
      p1: 27.704413 / 365,
      p2: 0.725423 / 365,
      margen: 3.113 / 365,
      descripcion: 'Peajes + cargos de potencia PVPC 2.0TD 2026'
    },

    // ═══════════════════════════════════════════════════════════════════
    // IMPUESTOS POR TERRITORIO
    // ═══════════════════════════════════════════════════════════════════
    territorios: {
      // Península y Baleares - IVA
      peninsula: {
        nombre: 'Península y Baleares',
        codigoPostalAPI: '50010',
        impuestos: {
          tipo: 'IVA',
          energia: 0.21,           // 21%
          contador: 0.21,          // incluido en el 21%
          // No hay distinción vivienda/otros
        },
        requiereCheckboxVivienda: false
      },

      // Canarias - IGIC
      canarias: {
        nombre: 'Canarias',
        codigoPostalAPI: '35001',
        impuestos: {
          tipo: 'IGIC',
          energiaVivienda: 0,      // 0% vivienda ≤10kW (Ley 4/2012 Art. 52)
          energiaOtros: 0.03,      // 3% resto
          contador: 0.07,          // 7% tipo general
        },
        requiereCheckboxVivienda: true,
        limiteViviendaKw: 10       // ≤10kW para tipo cero
      },

      // Ceuta y Melilla - IPSI
      ceutamelilla: {
        nombre: 'Ceuta y Melilla',
        codigoPostalAPI: '51001',
        impuestos: {
          tipo: 'IPSI',
          energia: 0.01,           // 1% consumo eléctrico (Ley 8/1991 Art. 18)
          contador: 0.04,          // 4% servicios (alquiler)
        },
        requiereCheckboxVivienda: false
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // PVPC - Composición mercado (RD 446/2023)
    // ═══════════════════════════════════════════════════════════════════
    pvpc: {
      pesoFuturos2024: 0.25,      // 25%
      pesoFuturos2025: 0.40,      // 40%
      pesoFuturos2026: 0.55,      // 55%
      pesoDiario2026: 0.45,       // 45%
    },

    // ═══════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════
    
    /**
     * Obtiene la configuración de un territorio por su clave
     * @param {string} zona - 'peninsula', 'canarias', 'ceutamelilla' o valores del select
     * @returns {Object} Configuración del territorio
     */
    normalizeZonaKey: function(zona) {
      return (zona || '').toLowerCase()
        .replace('península', 'peninsula')
        .replace('ceuta y melilla', 'ceutamelilla');
    },

    getTerritorio: function(zona) {
      const key = this.normalizeZonaKey(zona);
      return this.territorios[key] || this.territorios.peninsula;
    },

    formatDateYmdInMadrid: function(date) {
      const d = (date instanceof Date && Number.isFinite(date.getTime())) ? date : new Date();
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Madrid',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(d);
        const map = Object.create(null);
        parts.forEach(part => {
          if (part && part.type) map[part.type] = part.value;
        });
        if (map.year && map.month && map.day) {
          return `${map.year}-${map.month}-${map.day}`;
        }
      } catch (e) {}

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    getTodayYmd: function() {
      return this.formatDateYmdInMadrid(new Date());
    },

    resolveFiscalDateYmd: function(fechaLike) {
      if (fechaLike instanceof Date && Number.isFinite(fechaLike.getTime())) {
        return this.formatDateYmdInMadrid(fechaLike);
      }

      const raw = String(fechaLike || '').trim();
      if (!raw) return this.getTodayYmd();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

      const esMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
      if (esMatch) {
        return `${esMatch[3]}-${esMatch[2]}-${esMatch[1]}`;
      }

      const parsed = new Date(raw);
      if (Number.isFinite(parsed.getTime())) {
        return this.formatDateYmdInMadrid(parsed);
      }

      return this.getTodayYmd();
    },

    getIEEInfo: function(fechaYmd) {
      const fecha = this.resolveFiscalDateYmd(fechaYmd);

      return {
        fechaYmd: fecha,
        porcentaje: this.iee.porcentaje,
        minimoEurosKwh: this.iee.minimoEurosKwh,
        reducidoTemporalmente: false
      };
    },

    desglosarIEE: function(base, consumoKwh, fechaYmd) {
      const info = this.getIEEInfo(fechaYmd);
      const baseNum = Number.isFinite(Number(base)) ? Number(base) : 0;
      const consumoNum = Number.isFinite(Number(consumoKwh)) ? Number(consumoKwh) : 0;
      const porPorcentaje = (info.porcentaje / 100) * baseNum;
      const porMinimo = consumoNum * info.minimoEurosKwh;

      return {
        ...info,
        base: baseNum,
        consumoKwh: consumoNum,
        porPorcentaje,
        porMinimo,
        importe: Math.max(porPorcentaje, porMinimo),
        aplicaMinimo: porMinimo > porPorcentaje,
        minimoEurosMwh: info.minimoEurosKwh * 1000
      };
    },

    // Punto de extension fiscal. Los llamantes pasan { potenciaContratada,
    // bonoSocialOn, bonoSocialTipo, fechaYmd } por si una futura norma
    // reintroduce IVA condicionado en Peninsula/Baleares (como el RDL 7/2026).
    // Hoy siempre tributa al tipo general.
    getPeninsulaUsoFiscal: function() {
      return 'iva_general';
    },

    getFiscalContext: function({
      zona,
      potenciaContratada = 0,
      viviendaCanarias = false,
      bonoSocialOn = false,
      bonoSocialTipo = '',
      fechaYmd
    } = {}) {
      const territorio = this.getTerritorio(zona);
      const tipo = String(territorio?.impuestos?.tipo || 'IVA').toUpperCase();
      const potenciaNum = Number.isFinite(Number(potenciaContratada)) ? Number(potenciaContratada) : 0;
      const fecha = this.resolveFiscalDateYmd(fechaYmd);
      const viviendaMarcada = Boolean(viviendaCanarias);

      let usoFiscal;
      if (tipo === 'IGIC') {
        const limiteKw = Number(territorio.limiteViviendaKw) || 10;
        usoFiscal = viviendaMarcada && potenciaNum > 0 && potenciaNum <= limiteKw ? 'vivienda' : 'otros';
      } else if (tipo === 'IPSI') {
        usoFiscal = 'ipsi';
      } else {
        usoFiscal = this.getPeninsulaUsoFiscal({
          potenciaContratada: potenciaNum,
          bonoSocialOn,
          bonoSocialTipo,
          fechaYmd: fecha
        });
      }

      return {
        zona: this.normalizeZonaKey(zona),
        territorio,
        fechaYmd: fecha,
        potenciaContratada: potenciaNum,
        viviendaMarcada,
        usoFiscal,
        esViviendaTipoCero: usoFiscal === 'vivienda',
        esCanarias: tipo === 'IGIC',
        esCeutaMelilla: tipo === 'IPSI'
      };
    },

    /**
     * Formatea un tipo fraccional (0.21) como porcentaje legible ("21%")
     * para evitar hardcodes de etiquetas en la UI.
     * @param {number} rate - Tipo en fracción (ej. 0.21)
     * @param {number} maxDecimals - Decimales máximos
     * @returns {string} Porcentaje formateado
     */
    formatRatePercent: function(rate, maxDecimals = 2) {
      const pct = Number(rate) * 100;
      if (!Number.isFinite(pct)) return '0%';
      const fixed = pct.toFixed(Math.max(0, maxDecimals));
      const trimmed = fixed
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1')
        .replace('.', ',');
      return `${trimmed}%`;
    },

    /**
     * Obtiene la info fiscal visible del impuesto indirecto aplicable
     * para una zona y uso fiscal concretos.
     * @param {string} zona - Zona fiscal
     * @param {string} usoFiscal - Opcional. 'vivienda', 'otros' o 'ipsi'. Si se omite, se deriva del contexto fiscal.
     * @returns {Object} Tipo, etiquetas y tipos aplicables
     */
    getImpuestoInfo: function(zona, usoFiscal, extra = {}) {
      const territorio = this.getTerritorio(zona);
      const impuestos = territorio.impuestos || {};
      const tipo = String(impuestos.tipo || 'IVA').toUpperCase();
      const contexto = this.getFiscalContext({
        zona,
        potenciaContratada: extra.potenciaContratada,
        viviendaCanarias: extra.viviendaCanarias,
        bonoSocialOn: extra.bonoSocialOn,
        bonoSocialTipo: extra.bonoSocialTipo,
        fechaYmd: extra.fechaYmd
      });
      const usoFiscalInformado = usoFiscal !== undefined && usoFiscal !== null && String(usoFiscal).trim() !== '';
      const fallbackPorTipo = tipo === 'IVA' ? 'iva_general' : (tipo === 'IPSI' ? 'ipsi' : 'otros');
      const usoFiscalResuelto = tipo === 'IVA'
        ? (contexto?.usoFiscal || fallbackPorTipo)
        : (usoFiscalInformado ? usoFiscal : (contexto?.usoFiscal || fallbackPorTipo));
      const esVivienda = usoFiscalResuelto === 'vivienda';

      const energiaRateRaw = tipo === 'IGIC'
        ? (esVivienda ? impuestos.energiaVivienda : impuestos.energiaOtros)
        : impuestos.energia;
      const contadorRateRaw = tipo === 'IVA'
        ? energiaRateRaw
        : ((impuestos.contador != null) ? impuestos.contador : energiaRateRaw);

      const energiaRate = Number.isFinite(Number(energiaRateRaw)) ? Number(energiaRateRaw) : 0;
      const contadorRate = Number.isFinite(Number(contadorRateRaw)) ? Number(contadorRateRaw) : 0;

      return {
        territorio,
        tipo,
        fechaYmd: contexto?.fechaYmd || this.resolveFiscalDateYmd(extra.fechaYmd),
        usoFiscal: esVivienda ? 'vivienda' : usoFiscalResuelto,
        energiaRate,
        contadorRate,
        energiaLabel: tipo === 'IVA' ? 'IVA' : `${tipo} energía`,
        contadorLabel: tipo === 'IVA' ? 'IVA' : `${tipo} contador`,
        energiaPctText: this.formatRatePercent(energiaRate),
        contadorPctText: this.formatRatePercent(contadorRate)
      };
    },

    /**
     * Calcula el impuesto indirecto completo desde una sola fuente central.
     * La base energética debe incluir potencia + energía + financiación/otros
     * previos al impuesto eléctrico.
     * @param {Object} params - Bases de cálculo
     * @returns {Object} Detalle fiscal reutilizable por todos los módulos
     */
    calcularImpuestoIndirecto: function(params = {}) {
      const {
        zona,
        baseEnergia = 0,
        impuestoElectrico = 0,
        baseContador = 0,
        baseServicios = 0,
        potenciaContratada = 0,
        viviendaCanarias = false,
        bonoSocialOn = false,
        bonoSocialTipo = '',
        fechaYmd
      } = params;
      const info = this.getImpuestoInfo(zona, params.usoFiscal, {
        potenciaContratada,
        viviendaCanarias,
        bonoSocialOn,
        bonoSocialTipo,
        fechaYmd
      });
      const baseEnergiaNum = Number.isFinite(Number(baseEnergia)) ? Number(baseEnergia) : 0;
      const impuestoElectricoNum = Number.isFinite(Number(impuestoElectrico)) ? Number(impuestoElectrico) : 0;
      const baseContadorNum = Number.isFinite(Number(baseContador)) ? Number(baseContador) : 0;
      const baseServiciosNum = Number.isFinite(Number(baseServicios)) ? Number(baseServicios) : 0;

      let ivaBase = 0;
      let baseIPSI = 0;
      let impuestoEnergia;
      let impuestoContador = 0;
      let impuestoServicios = 0;
      let iva = 0;

      if (info.tipo === 'IGIC') {
        impuestoEnergia = info.usoFiscal === 'vivienda'
          ? 0
          : roundMoneyRate(baseEnergiaNum + impuestoElectricoNum, info.energiaRate);
        impuestoContador = roundMoneyRate(baseContadorNum, info.contadorRate);
        impuestoServicios = roundMoneyRate(baseServiciosNum, info.contadorRate);
      } else if (info.tipo === 'IPSI') {
        baseIPSI = round2(baseEnergiaNum + impuestoElectricoNum);
        impuestoEnergia = roundMoneyRate(baseIPSI, info.energiaRate);
        impuestoContador = roundMoneyRate(baseContadorNum, info.contadorRate);
        impuestoServicios = roundMoneyRate(baseServiciosNum, info.contadorRate);
      } else {
        ivaBase = round2(baseEnergiaNum + impuestoElectricoNum + baseContadorNum + baseServiciosNum);
        iva = roundMoneyRate(ivaBase, info.energiaRate);
        impuestoEnergia = iva;
      }

      return {
        ...info,
        baseEnergia: round2(baseEnergiaNum),
        baseContador: round2(baseContadorNum),
        baseServicios: round2(baseServiciosNum),
        baseEnergiaMasIEE: round2(baseEnergiaNum + impuestoElectricoNum),
        ivaBase: round2(ivaBase),
        baseIPSI: round2(baseIPSI),
        impuestoEnergia: round2(impuestoEnergia),
        impuestoContador: round2(impuestoContador),
        impuestoServicios: round2(impuestoServicios),
        iva: round2(iva),
        impuestoTotal: round2(impuestoEnergia + impuestoContador + impuestoServicios)
      };
    },

    /**
     * Obtiene el código postal para la API de la CNMC
     * @param {string} zona - Zona fiscal
     * @returns {string} Código postal
     */
    getCodigoPostalAPI: function(zona) {
      return this.getTerritorio(zona).codigoPostalAPI;
    },

    /**
     * Calcula el bono social para un periodo
     * @param {number} dias - Días del periodo
     * @returns {number} Importe del bono social
     */
    calcularBonoSocial: function(dias) {
      return this.bonoSocial.eurosAnuales / 365 * dias;
    },

    /**
     * Obtiene el porcentaje vigente del bono social eléctrico.
     * A 12/04/2026 rige el descuento excepcional del RDL 7/2026 para todo 2026.
     * @param {string} tipo - 'vulnerable' o 'severo'
     * @returns {number} Tipo de descuento en formato decimal
     */
    getBonoSocialDiscountRate: function(tipo = 'vulnerable') {
      const key = String(tipo || 'vulnerable').toLowerCase() === 'severo' ? 'severo' : 'vulnerable';
      const rate = Number(this.bonoSocial?.descuentos2026?.[key]);
      if (!Number.isFinite(rate)) {
        throw new Error(`[LF_CONFIG] Falta el descuento regulado del bono social para "${key}"`);
      }
      return rate;
    },

    /**
     * Calcula el alquiler del contador para un periodo
     * @param {number} dias - Días del periodo
     * @returns {number} Importe del alquiler
     */
    calcularAlquilerContador: function(dias) {
      return dias * this.alquilerContador.eurosMes * 12 / 365;
    },

    /**
     * Calcula el IEE
     * @param {number} base - Base imponible (potencia + energía + bono social)
     * @param {number} consumoKwh - Consumo total en kWh
     * @returns {number} Importe del IEE
     */
    calcularIEERedondeado: function(base, consumoKwh, fechaYmd) {
      const detalle = this.desglosarIEE(base, consumoKwh, fechaYmd);
      if (detalle.aplicaMinimo) {
        const exacto = roundMoneyProducts([[detalle.consumoKwh, detalle.minimoEurosKwh]]);
        return Number.isFinite(exacto) ? exacto : round2(detalle.porMinimo);
      }
      return round2(detalle.porPorcentaje);
    },

    calcularIEE: function(base, consumoKwh, fechaYmd) {
      return this.desglosarIEE(base, consumoKwh, fechaYmd).importe;
    }
  };

  // Exportar
  global.LF_CONFIG = LF_CONFIG;

  // Freeze para evitar modificaciones accidentales
  Object.freeze(LF_CONFIG.bonoSocial.descuentos2026);
  Object.freeze(LF_CONFIG.bonoSocial);
  Object.freeze(LF_CONFIG.iee);
  Object.freeze(LF_CONFIG.alquilerContador);
  Object.freeze(LF_CONFIG.pvpc);
  Object.freeze(LF_CONFIG.peajesCargosEnergia);
  Object.freeze(LF_CONFIG.peajesPotenciaPVPC);
  Object.keys(LF_CONFIG.territorios).forEach(k => {
    Object.freeze(LF_CONFIG.territorios[k].impuestos);
    Object.freeze(LF_CONFIG.territorios[k]);
  });
  Object.freeze(LF_CONFIG.territorios);

})(typeof window !== 'undefined' ? window : this);
