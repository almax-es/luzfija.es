/**
 * lf-config.js - Configuración centralizada de valores regulados
 * 
 * Este archivo contiene todos los valores que pueden cambiar por legislación.
 * Actualizado: Enero 2026
 * 
 * Referencias legales:
 * - Bono social: Orden TED/1524/2025 (BOE-A-2025-26705)
 * - IEE: Ley 38/1992 Art. 64 (5,11269632%)
 * - IVA: Ley 37/1992 (21% desde enero 2025)
 * - IGIC: Ley 4/2012 Art. 52 (0% vivienda ≤10kW, 3% otros, 7% contador)
 * - IPSI: Ley 8/1991 Art. 18 (1% electricidad, 4% servicios)
 * - Alquiler contador: Orden ITC/3860/2007 (0,81 €/mes)
 */

(function(global) {
  'use strict';

  const LF_CONFIG = {
    // ═══════════════════════════════════════════════════════════════════
    // VERSIÓN Y METADATOS
    // ═══════════════════════════════════════════════════════════════════
    version: '2026.01',
    ultimaActualizacion: '2026-01-10',

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
    getTerritorio: function(zona) {
      const key = (zona || '').toLowerCase()
        .replace('península', 'peninsula')
        .replace('ceuta y melilla', 'ceutamelilla');
      return this.territorios[key] || this.territorios.peninsula;
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
    calcularIEE: function(base, consumoKwh) {
      const porPorcentaje = (this.iee.porcentaje / 100) * base;
      const porMinimo = consumoKwh * this.iee.minimoEurosKwh;
      return Math.max(porPorcentaje, porMinimo);
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
