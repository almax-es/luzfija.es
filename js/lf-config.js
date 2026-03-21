/**
 * lf-config.js - Configuración centralizada de valores regulados
 * 
 * Este archivo contiene todos los valores que pueden cambiar por legislación.
 * Actualizado: Marzo 2026
 * 
 * Referencias legales:
 * - Bono social: Orden TED/1524/2025 (BOE-A-2025-26705)
 * - IEE: Ley 38/1992 Art. 99 + RDL 7/2026 (reducción temporal)
 * - IVA: Ley 37/1992 + RDL 7/2026 (reducción temporal)
 * - IGIC: Ley 4/2012 Art. 52 (0% vivienda ≤10kW, 3% otros, 7% contador)
 * - IPSI: Ley 8/1991 Art. 18 (1% electricidad, 4% servicios)
 * - Alquiler contador: Orden ITC/3860/2007 (0,81 €/mes)
 */

(function(global) {
  'use strict';

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  const LF_CONFIG = {
    // ═══════════════════════════════════════════════════════════════════
    // VERSIÓN Y METADATOS
    // ═══════════════════════════════════════════════════════════════════
    version: '2026.03',
    ultimaActualizacion: '2026-03-21',

    // ═══════════════════════════════════════════════════════════════════
    // BONO SOCIAL (financiación)
    // Orden TED/1524/2025, apartado Décimo d)
    // ═══════════════════════════════════════════════════════════════════
    bonoSocial: {
      eurosAnuales: 6.979247,  // €/año
      descripcion: 'Financiación bono social 2026'
    },

    // ═══════════════════════════════════════════════════════════════════
    // IMPUESTO ESPECIAL ELECTRICIDAD (IEE)
    // Ley 38/1992 Art. 64
    // ═══════════════════════════════════════════════════════════════════
    iee: {
      porcentaje: 5.11269632,       // %
      minimoEurosKwh: 0.001,        // €/kWh (mínimo legal)
      descripcion: 'Impuesto especial electricidad'
    },

    // ═══════════════════════════════════════════════════════════════════
    // MEDIDAS TEMPORALES (RDL 7/2026, BOE 21/03/2026)
    // Entrada operativa en la web: 21/03/2026
    // Nota: junio de 2026 queda condicionado al IPC publicado en mayo.
    // Si esa condición hiciera caer la rebaja en junio, bastará con poner
    // junio2026Habilitado = false.
    // ═══════════════════════════════════════════════════════════════════
    medidasTemporales: {
      rdl72026: {
        entradaVigor: '2026-03-21',
        fin: '2026-06-30',
        junio2026Habilitado: true,
        ieePorcentajeReducido: 0.5,
        ivaPeninsulaReducido: 0.10,
        potenciaMaxIvaReducidoKwExclusiva: 10
      }
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

    isDateBetweenYmd: function(fechaYmd, inicioYmd, finYmd) {
      const fecha = this.resolveFiscalDateYmd(fechaYmd);
      return fecha >= inicioYmd && fecha <= finYmd;
    },

    isRdl72026ElectricidadActiva: function(fechaYmd) {
      const fecha = this.resolveFiscalDateYmd(fechaYmd);
      const medida = this.medidasTemporales.rdl72026;
      if (fecha < medida.entradaVigor || fecha > medida.fin) return false;
      if (!medida.junio2026Habilitado && fecha >= '2026-06-01' && fecha <= '2026-06-30') return false;
      return true;
    },

    getIEEInfo: function(fechaYmd) {
      const fecha = this.resolveFiscalDateYmd(fechaYmd);
      const medidaActiva = this.isRdl72026ElectricidadActiva(fecha);
      const medida = this.medidasTemporales.rdl72026;

      return {
        fechaYmd: fecha,
        porcentaje: medidaActiva ? medida.ieePorcentajeReducido : this.iee.porcentaje,
        minimoEurosKwh: this.iee.minimoEurosKwh,
        reducidoTemporalmente: medidaActiva
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

    getPeninsulaUsoFiscal: function({
      potenciaContratada = 0,
      bonoSocialOn = false,
      bonoSocialTipo = '',
      fechaYmd
    } = {}) {
      const fecha = this.resolveFiscalDateYmd(fechaYmd);
      const medida = this.medidasTemporales.rdl72026;
      const potenciaNum = Number.isFinite(Number(potenciaContratada)) ? Number(potenciaContratada) : 0;
      const potenciaElegible = potenciaNum > 0 && potenciaNum < medida.potenciaMaxIvaReducidoKwExclusiva;

      if (this.isRdl72026ElectricidadActiva(fecha) && potenciaElegible) {
        return 'iva_reducido';
      }
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

      let usoFiscal = 'otros';
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
     * @param {string} usoFiscal - 'vivienda', 'otros' o 'ipsi'
     * @returns {Object} Tipo, etiquetas y tipos aplicables
     */
    getImpuestoInfo: function(zona, usoFiscal = 'otros', extra = {}) {
      const territorio = this.getTerritorio(zona);
      const impuestos = territorio.impuestos || {};
      const tipo = String(impuestos.tipo || 'IVA').toUpperCase();
      const contexto = tipo === 'IVA'
        ? this.getFiscalContext({
            zona,
            potenciaContratada: extra.potenciaContratada,
            viviendaCanarias: extra.viviendaCanarias,
            bonoSocialOn: extra.bonoSocialOn,
            bonoSocialTipo: extra.bonoSocialTipo,
            fechaYmd: extra.fechaYmd
          })
        : null;
      const usoFiscalResuelto = tipo === 'IVA'
        ? ((usoFiscal === 'iva_reducido' || usoFiscal === 'iva_general') ? usoFiscal : (contexto?.usoFiscal || 'iva_general'))
        : usoFiscal;
      const esVivienda = usoFiscalResuelto === 'vivienda';

      const energiaRateRaw = tipo === 'IGIC'
        ? (esVivienda ? impuestos.energiaVivienda : impuestos.energiaOtros)
        : (tipo === 'IVA' && usoFiscalResuelto === 'iva_reducido')
          ? this.medidasTemporales.rdl72026.ivaPeninsulaReducido
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
    calcularImpuestoIndirecto: function({
      zona,
      usoFiscal = 'otros',
      baseEnergia = 0,
      impuestoElectrico = 0,
      baseContador = 0,
      potenciaContratada = 0,
      viviendaCanarias = false,
      bonoSocialOn = false,
      bonoSocialTipo = '',
      fechaYmd
    } = {}) {
      const info = this.getImpuestoInfo(zona, usoFiscal, {
        potenciaContratada,
        viviendaCanarias,
        bonoSocialOn,
        bonoSocialTipo,
        fechaYmd
      });
      const baseEnergiaNum = Number.isFinite(Number(baseEnergia)) ? Number(baseEnergia) : 0;
      const impuestoElectricoNum = Number.isFinite(Number(impuestoElectrico)) ? Number(impuestoElectrico) : 0;
      const baseContadorNum = Number.isFinite(Number(baseContador)) ? Number(baseContador) : 0;

      let ivaBase = 0;
      let baseIPSI = 0;
      let impuestoEnergia = 0;
      let impuestoContador = 0;
      let iva = 0;

      if (info.tipo === 'IGIC') {
        impuestoEnergia = info.usoFiscal === 'vivienda'
          ? 0
          : round2((baseEnergiaNum + impuestoElectricoNum) * info.energiaRate);
        impuestoContador = round2(baseContadorNum * info.contadorRate);
      } else if (info.tipo === 'IPSI') {
        baseIPSI = round2(baseEnergiaNum + impuestoElectricoNum);
        impuestoEnergia = round2(baseIPSI * info.energiaRate);
        impuestoContador = round2(baseContadorNum * info.contadorRate);
      } else {
        ivaBase = round2(baseEnergiaNum + impuestoElectricoNum + baseContadorNum);
        iva = round2(ivaBase * info.energiaRate);
        impuestoEnergia = iva;
      }

      return {
        ...info,
        baseEnergia: round2(baseEnergiaNum),
        baseContador: round2(baseContadorNum),
        baseEnergiaMasIEE: round2(baseEnergiaNum + impuestoElectricoNum),
        ivaBase: round2(ivaBase),
        baseIPSI: round2(baseIPSI),
        impuestoEnergia: round2(impuestoEnergia),
        impuestoContador: round2(impuestoContador),
        iva: round2(iva),
        impuestoTotal: round2(impuestoEnergia + impuestoContador)
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
    calcularIEE: function(base, consumoKwh, fechaYmd) {
      return this.desglosarIEE(base, consumoKwh, fechaYmd).importe;
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // TARIFAS ESPECIALES
  // ═══════════════════════════════════════════════════════════════════
  
  const LF_TARIFAS_ESPECIALES = {
    sunClub: {
      activa: true,
      nombre: "Octopus Sun Club",
      
      // Configuración horaria
      horaInicio: 12,  // 12:00
      horaFin: 18,     // 18:00
      descuentoPct: 45,
      
      // Precios (actualizado: 10/01/2026)
      precios: {
        energia: 0.130,    // €/kWh (mismo precio todo el día)
        p1: 0.097,         // €/kW·día
        p2: 0.027          // €/kW·día
      },
      
      // Metadata
      web: "https://octopusenergy.es/sun-club",
      descripcion: "Descuento 45% en consumo 12-18h aplicado mes siguiente",
      requiereCSV: true,
      compensaExcedentes: false
    }
  };

  // Exportar
  global.LF_CONFIG = LF_CONFIG;
  global.LF_TARIFAS_ESPECIALES = LF_TARIFAS_ESPECIALES;

  // Freeze para evitar modificaciones accidentales
  Object.freeze(LF_CONFIG.bonoSocial);
  Object.freeze(LF_CONFIG.iee);
  Object.freeze(LF_CONFIG.alquilerContador);
  Object.freeze(LF_CONFIG.pvpc);
  Object.freeze(LF_CONFIG.medidasTemporales.rdl72026);
  Object.freeze(LF_CONFIG.medidasTemporales);
  Object.keys(LF_CONFIG.territorios).forEach(k => {
    Object.freeze(LF_CONFIG.territorios[k].impuestos);
    Object.freeze(LF_CONFIG.territorios[k]);
  });
  Object.freeze(LF_CONFIG.territorios);
  
  // Freeze tarifas especiales
  Object.freeze(LF_TARIFAS_ESPECIALES.sunClub.precios);
  Object.freeze(LF_TARIFAS_ESPECIALES.sunClub);
  Object.freeze(LF_TARIFAS_ESPECIALES);

})(typeof window !== 'undefined' ? window : this);
