/**
 * DESGLOSE DE FACTURA - Modal interactivo
 * 
 * Muestra el desglose completo de una factura eléctrica incluyendo:
 * - Potencia (P1/P2)
 * - Consumo (Punta/Llano/Valle)
 * - Compensación de excedentes solares
 * - Batería virtual
 * - Impuestos e IVA
 */

(function() {
  'use strict';

  // Evitar cargar el script múltiples veces
  if (window.__LF_DesgloseFactura) return;

  const DesgloseFactura = {
    modal: null,
    overlay: null,
    isOpen: false,

    /**
     * Inicializa el sistema de desglose
     */
    init() {
      this.createModalStructure();
      this.bindEvents();
      console.log('✅ Sistema de desglose de factura inicializado');
    },

    /**
     * Crea la estructura HTML del modal
     */
    createModalStructure() {
      // Crear overlay
      this.overlay = document.createElement('div');
      this.overlay.className = 'desglose-overlay';
      this.overlay.setAttribute('aria-hidden', 'true');
      
      // Crear modal
      this.modal = document.createElement('div');
      this.modal.className = 'desglose-modal';
      this.modal.setAttribute('role', 'dialog');
      this.modal.setAttribute('aria-modal', 'true');
      this.modal.setAttribute('aria-labelledby', 'desglose-title');
      
      // Contenido del modal
      this.modal.innerHTML = `
        <div class="desglose-header">
          <h2 id="desglose-title">📋 Desglose de la factura</h2>
          <button class="desglose-close" aria-label="Cerrar desglose">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="desglose-content">
          <div class="desglose-info">
            <div class="desglose-tarifa"></div>
            <div class="desglose-periodo"></div>
          </div>
          <div class="desglose-body">
            <!-- Se llenará dinámicamente -->
          </div>
        </div>
      `;

      // Añadir al DOM
      document.body.appendChild(this.overlay);
      document.body.appendChild(this.modal);
    },

    /**
     * Vincula eventos del modal
     */
    bindEvents() {
      // Cerrar con botón X
      const closeBtn = this.modal.querySelector('.desglose-close');
      closeBtn.addEventListener('click', () => this.close());

      // Cerrar con overlay
      this.overlay.addEventListener('click', () => this.close());

      // Cerrar con ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });

      // NO prevenir scroll - permitir scroll con rueda del ratón
    },

    /**
     * Abre el modal con los datos de la factura
     * @param {Object} datos - Datos de la factura a desglosar
     */
    abrir(datos) {
      if (!datos) {
        console.error('No se proporcionaron datos para el desglose');
        return;
      }

      // Calcular el desglose completo
      const desglose = this.calcularDesglose(datos);
      
      // Renderizar el contenido
      this.renderizar(desglose, datos);
      
      // Mostrar modal
      this.overlay.classList.add('active');
      this.modal.classList.add('active');
      this.isOpen = true;
      
      // Prevenir scroll del body
      document.body.style.overflow = 'hidden';
      
      // Focus en el modal
      this.modal.focus();
    },

    /**
     * Cierra el modal
     */
    close() {
      this.overlay.classList.remove('active');
      this.modal.classList.remove('active');
      this.isOpen = false;
      
      // Restaurar scroll del body
      document.body.style.overflow = '';
    },

    /**
     * Calcula todos los conceptos del desglose
     * @param {Object} datos - Datos de entrada
     * @returns {Object} Desglose completo
     */
    calcularDesglose(datos) {
      const {
        potenciaP1 = 0,
        potenciaP2 = 0,
        dias = 30,
        precioP1 = 0,
        precioP2 = 0,
        consumoPunta = 0,
        consumoLlano = 0,
        consumoValle = 0,
        precioPunta = 0,
        precioLlano = 0,
        precioValle = 0,
        excedentes = 0,
        precioCompensacion = 0,
        bateriaVirtual = 0,
        alquilerContador = 0.81, // Valor típico mensual
        impuestoElectrico = 0.0511296, // 5,11296%
        iva = 0.21, // 21% (Península)
        zonaFiscal = 'Península'
      } = datos;

      // === POTENCIA ===
      const potenciaPunta = potenciaP1 * dias * precioP1;
      const potenciaValle = potenciaP2 * dias * precioP2;
      const totalPotencia = potenciaPunta + potenciaValle;

      // === CONSUMO ===
      const energiaPunta = consumoPunta * precioPunta;
      const energiaLlano = consumoLlano * precioLlano;
      const energiaValle = consumoValle * precioValle;
      const totalEnergia = energiaPunta + energiaLlano + energiaValle;
      const totalConsumo = totalEnergia;

      // === COMPENSACIÓN EXCEDENTES SOLARES ===
      const compensacionExcedentes = excedentes * precioCompensacion;

      // === BATERÍA VIRTUAL ===
      // La BV es un saldo a favor que se resta
      const bvUtilizada = Math.min(bateriaVirtual, totalConsumo);

      // === OTROS CONCEPTOS ===
      const alquiler = alquilerContador;
      
      // Base antes de impuestos (sin compensación ni BV)
      const subtotal = totalPotencia + totalConsumo + alquiler;
      
      // Aplicar compensación de excedentes (se resta)
      const despuesCompensacion = subtotal - compensacionExcedentes;
      
      // Impuesto eléctrico (se aplica sobre el subtotal antes de compensación)
      const impElectrico = subtotal * impuestoElectrico;
      
      // Base imponible
      const baseImponible = despuesCompensacion + impElectrico;
      
      // IVA o IGIC según zona
      let tasaImpuesto = iva;
      let nombreImpuesto = 'IVA';
      
      if (zonaFiscal === 'Canarias') {
        tasaImpuesto = 0.07; // IGIC 7%
        nombreImpuesto = 'IGIC';
      } else if (zonaFiscal === 'Ceuta-Melilla') {
        tasaImpuesto = 0.10; // IPSI 10%
        nombreImpuesto = 'IPSI';
      }
      
      const importeImpuesto = baseImponible * tasaImpuesto;
      
      // Total factura antes de BV
      const totalFactura = baseImponible + importeImpuesto;
      
      // Total a pagar (aplicando BV)
      const totalAPagar = totalFactura - bvUtilizada;
      
      // Nueva BV acumulada (excedentes no compensados)
      const excedentesRestantes = Math.max(0, compensacionExcedentes - totalConsumo);

      return {
        potencia: {
          punta: potenciaPunta,
          valle: potenciaValle,
          total: totalPotencia,
          detalles: {
            p1: { kw: potenciaP1, dias, precio: precioP1 },
            p2: { kw: potenciaP2, dias, precio: precioP2 }
          }
        },
        consumo: {
          punta: { kwh: consumoPunta, importe: energiaPunta, precio: precioPunta },
          llano: { kwh: consumoLlano, importe: energiaLlano, precio: precioLlano },
          valle: { kwh: consumoValle, importe: energiaValle, precio: precioValle },
          totalKwh: consumoPunta + consumoLlano + consumoValle,
          totalImporte: totalConsumo
        },
        solar: {
          tieneExcedentes: excedentes > 0,
          excedentes: excedentes,
          compensacion: compensacionExcedentes,
          precio: precioCompensacion
        },
        bateriaVirtual: {
          saldoAnterior: bateriaVirtual,
          utilizada: bvUtilizada,
          excedentesNuevos: excedentesRestantes,
          nuevoSaldo: bateriaVirtual - bvUtilizada + excedentesRestantes
        },
        otrosConceptos: {
          alquilerContador: alquiler,
          impuestoElectrico: impElectrico
        },
        totales: {
          subtotal: subtotal,
          compensacionExcedentes: compensacionExcedentes,
          despuesCompensacion: despuesCompensacion,
          impuestoElectrico: impElectrico,
          baseImponible: baseImponible,
          tasaImpuesto: tasaImpuesto,
          nombreImpuesto: nombreImpuesto,
          importeImpuesto: importeImpuesto,
          totalFactura: totalFactura,
          bvUtilizada: bvUtilizada,
          totalAPagar: totalAPagar
        }
      };
    },

    /**
     * Renderiza el desglose en el modal
     * @param {Object} desglose - Desglose calculado
     * @param {Object} datos - Datos originales
     */
    renderizar(desglose, datos) {
      // Info de tarifa
      const tarifaEl = this.modal.querySelector('.desglose-tarifa');
      tarifaEl.innerHTML = `<strong>${datos.nombreTarifa || 'Tarifa seleccionada'}</strong>`;
      
      const periodoEl = this.modal.querySelector('.desglose-periodo');
      periodoEl.innerHTML = `${datos.fechaInicio || '01/01/2025'} - ${datos.fechaFin || '31/01/2025'} (${datos.dias || 30} días)`;

      // Cuerpo del desglose
      const body = this.modal.querySelector('.desglose-body');
      
      let html = '';

      // === POTENCIA ===
      html += `
        <div class="desglose-seccion">
          <div class="desglose-seccion-header">
            <h3>⚡ POTENCIA</h3>
            <span class="desglose-importe-header">${this.formatEuros(desglose.potencia.total)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Potencia facturada punta (P1)</span>
            <span class="desglose-detalle">${desglose.potencia.detalles.p1.kw.toFixed(2)} kW × ${desglose.potencia.detalles.p1.dias} días × ${this.formatEuros(desglose.potencia.detalles.p1.precio, 6)}/kW día</span>
            <span class="desglose-importe">${this.formatEuros(desglose.potencia.punta)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Potencia facturada valle (P2)</span>
            <span class="desglose-detalle">${desglose.potencia.detalles.p2.kw.toFixed(2)} kW × ${desglose.potencia.detalles.p2.dias} días × ${this.formatEuros(desglose.potencia.detalles.p2.precio, 6)}/kW día</span>
            <span class="desglose-importe">${this.formatEuros(desglose.potencia.valle)}</span>
          </div>
        </div>
      `;

      // === CONSUMO ===
      html += `
        <div class="desglose-seccion">
          <div class="desglose-seccion-header">
            <h3>🔌 CONSUMO</h3>
            <span class="desglose-importe-header">${this.formatEuros(desglose.consumo.totalImporte)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Consumo facturado</span>
            <span class="desglose-detalle">${desglose.consumo.totalKwh.toFixed(2)} kWh</span>
            <span class="desglose-importe">${this.formatEuros(desglose.consumo.totalImporte)}</span>
          </div>
          ${desglose.consumo.punta.kwh > 0 ? `
          <div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">→ Punta (P1)</span>
            <span class="desglose-detalle">${desglose.consumo.punta.kwh.toFixed(2)} kWh × ${this.formatEuros(desglose.consumo.punta.precio, 6)}/kWh</span>
            <span class="desglose-importe">${this.formatEuros(desglose.consumo.punta.importe)}</span>
          </div>
          ` : ''}
          ${desglose.consumo.llano.kwh > 0 ? `
          <div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">→ Llano (P2)</span>
            <span class="desglose-detalle">${desglose.consumo.llano.kwh.toFixed(2)} kWh × ${this.formatEuros(desglose.consumo.llano.precio, 6)}/kWh</span>
            <span class="desglose-importe">${this.formatEuros(desglose.consumo.llano.importe)}</span>
          </div>
          ` : ''}
          ${desglose.consumo.valle.kwh > 0 ? `
          <div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">→ Valle (P3)</span>
            <span class="desglose-detalle">${desglose.consumo.valle.kwh.toFixed(2)} kWh × ${this.formatEuros(desglose.consumo.valle.precio, 6)}/kWh</span>
            <span class="desglose-importe">${this.formatEuros(desglose.consumo.valle.importe)}</span>
          </div>
          ` : ''}
        </div>
      `;

      // === PLACAS SOLARES (si aplica) ===
      if (desglose.solar.tieneExcedentes) {
        html += `
          <div class="desglose-seccion desglose-seccion-solar">
            <div class="desglose-seccion-header">
              <h3>☀️ EXCEDENTES SOLARES</h3>
              <span class="desglose-importe-header desglose-importe-negativo">-${this.formatEuros(desglose.solar.compensacion)}</span>
            </div>
            <div class="desglose-linea">
              <span class="desglose-concepto">Compensación de excedentes</span>
              <span class="desglose-detalle">${desglose.solar.excedentes.toFixed(2)} kWh × ${this.formatEuros(desglose.solar.precio, 6)}/kWh</span>
              <span class="desglose-importe desglose-importe-negativo">-${this.formatEuros(desglose.solar.compensacion)}</span>
            </div>
          </div>
        `;
      }

      // === BATERÍA VIRTUAL (si aplica) ===
      if (desglose.bateriaVirtual.saldoAnterior > 0 || desglose.bateriaVirtual.excedentesNuevos > 0) {
        html += `
          <div class="desglose-seccion desglose-seccion-bv">
            <div class="desglose-seccion-header">
              <h3>🔋 BATERÍA VIRTUAL</h3>
              <span class="desglose-importe-header">${this.formatEuros(desglose.bateriaVirtual.nuevoSaldo)}</span>
            </div>
            <div class="desglose-linea">
              <span class="desglose-concepto">Saldo anterior</span>
              <span class="desglose-detalle"></span>
              <span class="desglose-importe">${this.formatEuros(desglose.bateriaVirtual.saldoAnterior)}</span>
            </div>
            ${desglose.bateriaVirtual.utilizada > 0 ? `
            <div class="desglose-linea">
              <span class="desglose-concepto">Utilizado este mes</span>
              <span class="desglose-detalle"></span>
              <span class="desglose-importe desglose-importe-negativo">-${this.formatEuros(desglose.bateriaVirtual.utilizada)}</span>
            </div>
            ` : ''}
            ${desglose.bateriaVirtual.excedentesNuevos > 0 ? `
            <div class="desglose-linea">
              <span class="desglose-concepto">Excedentes acumulados</span>
              <span class="desglose-detalle"></span>
              <span class="desglose-importe desglose-importe-positivo">+${this.formatEuros(desglose.bateriaVirtual.excedentesNuevos)}</span>
            </div>
            ` : ''}
            <div class="desglose-linea desglose-linea-destacada">
              <span class="desglose-concepto"><strong>Nuevo saldo BV</strong></span>
              <span class="desglose-detalle"></span>
              <span class="desglose-importe"><strong>${this.formatEuros(desglose.bateriaVirtual.nuevoSaldo)}</strong></span>
            </div>
          </div>
        `;
      }

      // === OTROS CONCEPTOS ===
      html += `
        <div class="desglose-seccion">
          <div class="desglose-seccion-header">
            <h3>📝 OTROS CONCEPTOS</h3>
            <span class="desglose-importe-header">${this.formatEuros(desglose.otrosConceptos.alquilerContador + desglose.otrosConceptos.impuestoElectrico)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Alquiler equipos de medida</span>
            <span class="desglose-detalle">${datos.dias || 30} días × ${this.formatEuros(0.81 / 30, 6)}/día</span>
            <span class="desglose-importe">${this.formatEuros(desglose.otrosConceptos.alquilerContador)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Impuesto eléctrico</span>
            <span class="desglose-detalle">5,11% de ${this.formatEuros(desglose.totales.subtotal)}</span>
            <span class="desglose-importe">${this.formatEuros(desglose.otrosConceptos.impuestoElectrico)}</span>
          </div>
        </div>
      `;

      // === TOTALES ===
      html += `
        <div class="desglose-seccion desglose-seccion-total">
          <div class="desglose-linea desglose-linea-total">
            <span class="desglose-concepto">BASE IMPONIBLE</span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe">${this.formatEuros(desglose.totales.baseImponible)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">${desglose.totales.nombreImpuesto}</span>
            <span class="desglose-detalle">${(desglose.totales.tasaImpuesto * 100).toFixed(0)}% de ${this.formatEuros(desglose.totales.baseImponible)}</span>
            <span class="desglose-importe">${this.formatEuros(desglose.totales.importeImpuesto)}</span>
          </div>
          <div class="desglose-linea desglose-linea-destacada desglose-linea-final">
            <span class="desglose-concepto"><strong>TOTAL FACTURA</strong></span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe desglose-importe-final"><strong>${this.formatEuros(desglose.totales.totalAPagar)}</strong></span>
          </div>
        </div>
      `;

      // Info adicional
      html += `
        <div class="desglose-nota">
          ${desglose.solar.tieneExcedentes ? `
            <p>💡 <strong>Excedentes solares:</strong> Los ${desglose.solar.excedentes.toFixed(2)} kWh vertidos se compensan a ${this.formatEuros(desglose.solar.precio, 6)}/kWh, reduciendo tu factura en ${this.formatEuros(desglose.solar.compensacion)}.</p>
          ` : ''}
          ${desglose.bateriaVirtual.saldoAnterior > 0 ? `
            <p>🔋 <strong>Batería Virtual:</strong> Has utilizado ${this.formatEuros(desglose.bateriaVirtual.utilizada)} de tu saldo acumulado. Tu nuevo saldo es de ${this.formatEuros(desglose.bateriaVirtual.nuevoSaldo)}.</p>
          ` : ''}
          <p>ℹ️ Este desglose es una estimación. Los precios exactos pueden variar según tu comercializadora.</p>
        </div>
      `;

      body.innerHTML = html;
    },

    /**
     * Formatea un número como euros
     * @param {number} valor - Valor a formatear
     * @param {number} decimales - Número de decimales
     * @returns {string} Valor formateado
     */
    formatEuros(valor, decimales = 2) {
      if (valor == null || isNaN(valor)) return '0,00 €';
      return valor.toFixed(decimales).replace('.', ',') + ' €';
    }
  };

  // Exportar al scope global
  window.__LF_DesgloseFactura = DesgloseFactura;

  // Auto-inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => DesgloseFactura.init());
  } else {
    DesgloseFactura.init();
  }
})();
