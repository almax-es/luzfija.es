/**
 * SISTEMA DE DESGLOSE DE FACTURA
 * Replica la lógica exacta de app.js
 */

(function() {
  'use strict';

  // Sistema de debug (activar con ?debug=1)
  const DEBUG = window.location.search.includes('debug=1') || window.__LF_DEBUG;
  const lfDbg = (...args) => {
    if (!DEBUG) return;
    try {
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log('[DESGLOSE-FACTURA]', ...args);
      }
    } catch (_) {}
  };

  const round2 = (n) => Math.round(n * 100) / 100;
  const clampNonNeg = (n) => Math.max(0, n);

  window.__LF_DesgloseFactura = {
    overlay: null,
    modal: null,
    _openSeq: 0,

    init() {
      this.overlay = document.createElement('div');
      this.overlay.className = 'desglose-overlay';
      
      this.modal = document.createElement('div');
      this.modal.className = 'desglose-modal';
      this.modal.innerHTML = `
        <div class="desglose-header">
          <h2>📋 Desglose de la factura</h2>
          <button class="desglose-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="desglose-content">
          <div class="desglose-info">
            <div class="desglose-tarifa"></div>
            <div class="desglose-periodo"></div>
          </div>
          <div class="desglose-body"></div>
        </div>
      `;

      document.body.appendChild(this.overlay);
      document.body.appendChild(this.modal);

      this.overlay.addEventListener('click', () => this.cerrar());
      this.modal.querySelector('.desglose-close').addEventListener('click', () => this.cerrar());
      
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.modal.classList.contains('active')) this.cerrar();
      });

      lfDbg('Sistema de desglose de factura inicializado');
    },

    abrir(datos) {
      // Init diferido (mejora INP): no creamos el modal hasta que el usuario lo abre
      if (!this.modal || !this.overlay) this.init();

      // Token para evitar renders tardíos si el usuario cierra rápido o abre otro desglose
      const mySeq = ++this._openSeq;

      // Mostrar el modal al instante (primera pintura rápida)
      this.overlay.classList.add('active');
      this.modal.classList.add('active');
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      const body = this.modal.querySelector('.desglose-body');
      if (body) {
        body.innerHTML = `<div style="padding:14px; color: var(--muted); font-weight:700;">Calculando desglose…</div>`;
      }

      // Dejar que el navegador pinte y luego hacer el trabajo pesado
      setTimeout(() => {
        // Si se cerró o se abrió otro desglose, abortar
        if (mySeq !== this._openSeq) return;
        if (!this.modal || !this.modal.classList.contains('active')) return;
        const desglose = this.calcularDesglose(datos);
        this.renderizar(desglose, datos);
      }, 0);
    },

    cerrar() {
      // Invalida cualquier render diferido pendiente
      this._openSeq++;
      this.overlay.classList.remove('active');
      this.modal.classList.remove('active');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    },

    calcularDesglose(datos) {
      const {
        potenciaP1 = 0, potenciaP2 = 0, dias = 30,
        precioP1 = 0, precioP2 = 0,
        consumoPunta = 0, consumoLlano = 0, consumoValle = 0,
        precioPunta = 0, precioLlano = 0, precioValle = 0,
        excedentes = 0, precioCompensacion = 0,
        tipoCompensacion = 'SIMPLE', topeCompensacion = 'ENERGIA',
        bateriaVirtual = 0, reglaBV = 'BV MES ANTERIOR', tieneBV = false,
        zonaFiscal = 'Península', esViviendaCanarias = true, solarOn = false
      } = datos;

      const isCanarias = zonaFiscal === 'Canarias';
      const potenciaContratada = Math.max(potenciaP1, potenciaP2);

      const pot = round2((potenciaP1 * dias * precioP1) + (potenciaP2 * dias * precioP2));
      const cons = round2((consumoPunta * precioPunta) + (consumoLlano * precioLlano) + (consumoValle * precioValle));
      const tarifaAcceso = round2(6.979247 / 365 * dias);

      let consAdj = cons;
      let tarifaAdj = tarifaAcceso;
      let credit1 = 0;
      let excedenteSobranteEur = 0;

      if (solarOn && excedentes > 0 && precioCompensacion > 0 && tipoCompensacion !== 'NO COMPENSA') {
        const exKwh = clampNonNeg(excedentes);
        const creditoPotencial = round2(exKwh * precioCompensacion);
        
        // Compensación simplificada: siempre sobre término de energía (RD 244/2019 Art. 14)
        const baseCompensable = cons;

        credit1 = Math.min(creditoPotencial, baseCompensable);
        consAdj = round2(Math.max(0, cons - credit1));

        excedenteSobranteEur = Math.max(0, creditoPotencial - credit1);
      }

      const sumaBase = pot + consAdj + tarifaAdj;
      const impuestoElec = round2(Math.max((5.11269632 / 100) * sumaBase, (consumoPunta + consumoLlano + consumoValle) * 0.001));
      const margen = isCanarias ? 0 : round2(dias * 0.026667);

      let resultado = {};

      if (isCanarias) {
        const baseEnergia = sumaBase;
        const alquilerContador = dias * (0.81 / 30);
        const usoFiscal = esViviendaCanarias && potenciaContratada > 0 && potenciaContratada <= 10 ? 'vivienda' : 'otros';
        const igicBase = usoFiscal === 'vivienda' ? 0 : (baseEnergia + impuestoElec) * 0.03;
        const igicContador = alquilerContador * 0.07;
        const impuestosNum = impuestoElec + igicBase + igicContador;
        let totalBase = baseEnergia + impuestoElec + igicBase + igicContador + alquilerContador;

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV') {
          // Batería Virtual: solo "BV MES ANTERIOR" (disponible = saldo del mes anterior)
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = solarOn && tieneBV ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur,
          sumaBase, impuestoElec, margen, baseEnergia, alquilerContador, igicBase, igicContador,
          impuestosNum, totalBase, credit2, bvSaldoFin, totalFinal, totalRanking,
          isCanarias: true, usoFiscal };

      } else {
        const baseEnergia = sumaBase + margen;
        const ivaBase = pot + consAdj + tarifaAdj + impuestoElec + margen;
        const iva = round2(ivaBase * 0.21);
        let totalBase = round2(ivaBase + iva);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV') {
          // Batería Virtual: solo "BV MES ANTERIOR" (disponible = saldo del mes anterior)
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = solarOn && tieneBV ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;
        const impuestosNum = round2(tarifaAdj + impuestoElec + margen + iva);

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur,
          sumaBase, impuestoElec, margen, baseEnergia, ivaBase, iva, impuestosNum,
          totalBase, credit2, bvSaldoFin, totalFinal, totalRanking, isCanarias: false };
      }

      return resultado;
    },

    renderizar(d, datos) {
      // Generar fechas por defecto del mes actual si no se proporcionan
      const hoy = new Date();
      const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      const formatFecha = (fecha) => {
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const año = fecha.getFullYear();
        return `${dia}/${mes}/${año}`;
      };
      const fechaInicioDefault = formatFecha(primerDia);
      const fechaFinDefault = formatFecha(ultimoDia);
      const diasDefault = ultimoDia.getDate();
      
      this.modal.querySelector('.desglose-tarifa').innerHTML = `<strong>${datos.nombreTarifa || 'Tarifa'}</strong>`;
      this.modal.querySelector('.desglose-periodo').innerHTML = `${datos.fechaInicio || fechaInicioDefault} - ${datos.fechaFin || fechaFinDefault} (${datos.dias || diasDefault} días)`;

      let html = '';

      // ===== RESUMEN CLARO (Factura "perfecta") =====
      const solarOn = Boolean(datos.solarOn);
      const tipoComp = String(datos.tipoCompensacion || '');
      const exKwh = clampNonNeg(Number(datos.excedentes || 0));
      const precioComp = Number(datos.precioCompensacion || 0);
      const compensa = (solarOn && exKwh > 0 && precioComp > 0 && tipoComp !== 'NO COMPENSA');
      const creditoPotencial = compensa ? round2(exKwh * precioComp) : 0;
      // kWh de excedentes realmente usados vs sobrantes (más intuitivo que solo €)
      const kwhExUsados = (solarOn && precioComp > 0 && d.credit1 > 0) ? clampNonNeg(d.credit1 / precioComp) : 0;
      const kwhExSobrantes = (solarOn && precioComp > 0 && exKwh > 0) ? clampNonNeg(exKwh - kwhExUsados) : 0;
      const tope = String(datos.topeCompensacion || 'ENERGIA');
      // Etiquetas de texto para la explicación de compensación
      const topeLabel = 'consumo de luz';
      const topeNoNeg = 'no puede dejar el consumo en negativo';
      const pagoMes = (typeof d.totalFinal === 'number') ? d.totalFinal : d.totalBase;
      const bvActiva = Boolean(datos.tieneBV) && String(datos.tipoCompensacion || '').includes('BV');
      
      // Detectar si es Nufri (precio indexado, usamos estimación)
      const esNufri = (datos.nombreTarifa || '').includes('Nufri');
      // Mostrar precio con menos decimales para mayor claridad (2 en lugar de 6)
      const precioLabel = esNufri ? `${this.fmtNum(datos.precioCompensacion, 2)}/kWh <span style="color:#f59e0b">(est.)</span>` : `${this.fmtNum(datos.precioCompensacion, 2)}/kWh`;

      html += `<div class="desglose-resumen">
        <div class="desglose-resumen-grid">
          <div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Total factura</div>
            <div class="desglose-resumen-value">${this.fmt(d.totalBase)}</div>
          </div>
          <div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Pagas este mes</div>
            <div class="desglose-resumen-value">${this.fmt(pagoMes)}</div>
          </div>
          ${d.credit2 > 0 ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">BV aplicada</div>
            <div class="desglose-resumen-value">${this.fmt(d.credit2)}</div>
          </div>` : ''}
          ${bvActiva && typeof d.bvSaldoFin === 'number' ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Saldo BV próximo mes</div>
            <div class="desglose-resumen-value">${this.fmt(d.bvSaldoFin)}</div>
          </div>` : ''}
          ${(creditoPotencial > 0) ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Excedentes del periodo</div>
            <div class="desglose-resumen-value">${this.fmt(creditoPotencial)}</div>
          </div>` : ''}
          ${(d.credit1 > 0) ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Compensación aplicada</div>
            <div class="desglose-resumen-value">${this.fmt(d.credit1)}</div>
            <div class="desglose-resumen-sub">💡 <strong>Tope legal:</strong> Solo se puede compensar hasta el coste del ${topeLabel} del mes.</div>
            ${(solarOn && precioComp > 0 && exKwh > 0) ? `<div class="desglose-resumen-sub">✅ Compensados: <strong>${this.fmtNum(kwhExUsados)}</strong> kWh · 🔋 A batería virtual: <strong>${this.fmtNum(kwhExSobrantes)}</strong> kWh</div>` : ''}
          </div>` : ''}
          ${(d.excedenteSobranteEur > 0) ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Sobrante de excedentes</div>
            <div class="desglose-resumen-value">${this.fmt(d.excedenteSobranteEur)}</div>
          </div>` : ''}
        </div>
        ${(d.credit1 > 0 && creditoPotencial > d.credit1) ? `<div class="desglose-resumen-note">
          ✅ Has generado <strong>${this.fmt(creditoPotencial)}</strong> en excedentes. Se compensan <strong>${this.fmt(d.credit1)}</strong> este mes (tope legal: ${topeLabel}). ${bvActiva ? `Los <strong>${this.fmt(d.excedenteSobranteEur)}</strong> restantes se guardan en tu Batería Virtual para próximas facturas.` : 'El resto no se puede compensar este mes.'}
        </div>` : ''}
        ${esNufri && compensa ? `<div class="desglose-resumen-note" style="background:#fffbeb;border-left:3px solid #f59e0b">
          ⚠️ <strong>Precio estimado:</strong> Nufri paga excedentes a precio <strong>indexado</strong> (pool OMIE horario). El valor mostrado (${this.fmtNum(datos.precioCompensacion, 4)} €/kWh) es una <strong>estimación promedio</strong>. El precio real variará según el mercado eléctrico.
        </div>` : ''}
      </div>`;


      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>⚡ POTENCIA</h3><span class="desglose-importe-header">${this.fmt(d.pot)}</span></div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Potencia punta (P1)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × ${datos.dias} días × ${this.fmtNum(datos.precioP1, 4)}/kW día</span>
          <span class="desglose-importe">${this.fmt(datos.potenciaP1 * datos.dias * datos.precioP1)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Potencia valle (P2)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.potenciaP2)} kW × ${datos.dias} días × ${this.fmtNum(datos.precioP2, 4)}/kW día</span>
          <span class="desglose-importe">${this.fmt(datos.potenciaP2 * datos.dias * datos.precioP2)}</span>
        </div>
      </div>`;

      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>💡 CONSUMO</h3><span class="desglose-importe-header">${(d.credit1 > 0 ? (this.fmt(d.cons) + " → " + this.fmt(d.consAdj)) : this.fmt(d.cons))}</span></div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Consumo total</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoPunta + datos.consumoLlano + datos.consumoValle)} kWh</span>
          <span class="desglose-importe">${this.fmt(d.cons)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Punta (P1)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoPunta)} kWh × ${this.fmtNum(datos.precioPunta, 4)}/kWh</span>
          <span class="desglose-importe">${this.fmt(datos.consumoPunta * datos.precioPunta)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Llano (P2)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoLlano)} kWh × ${this.fmtNum(datos.precioLlano, 4)}/kWh</span>
          <span class="desglose-importe">${this.fmt(datos.consumoLlano * datos.precioLlano)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Valle (P3)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoValle)} kWh × ${this.fmtNum(datos.precioValle, 4)}/kWh</span>
          <span class="desglose-importe">${this.fmt(datos.consumoValle * datos.precioValle)}</span>
        </div>
        ${d.credit1 > 0 ? `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">☀️ Compensación excedentes</span>
          <span class="desglose-detalle">${this.fmtNum(datos.excedentes)} kWh × ${precioLabel} = ${this.fmt(creditoPotencial)}<br>Compensados: ${this.fmtNum(kwhExUsados)} kWh (${this.fmt(d.credit1)}) | A batería virtual: ${this.fmtNum(kwhExSobrantes)} kWh (${this.fmt(d.excedenteSobranteEur)})</span>
          <span class="desglose-importe desglose-importe--pos">-${this.fmt(d.credit1)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>Consumo tras compensación</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe"><strong>${this.fmt(d.consAdj)}</strong></span>
        </div>` : ''}
      </div>`;

      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>📝 OTROS CONCEPTOS</h3><span class="desglose-importe-header">${this.fmt(d.tarifaAdj + d.impuestoElec + d.margen)}</span></div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Financiación Bono Social</span>
          <span class="desglose-detalle">${this.fmtNum(6.979247/365, 4)}/día × ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(d.tarifaAcceso)}</span>
        </div>
        ${d.tarifaAdj !== d.tarifaAcceso && d.credit1 > 0 ? `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">☀️ Compensación en Bono Social</span>
          <span class="desglose-detalle">Resto de compensación</span>
          <span class="desglose-importe desglose-importe--pos">-${this.fmt(d.tarifaAcceso - d.tarifaAdj)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>Bono Social tras compensación</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe"><strong>${this.fmt(d.tarifaAdj)}</strong></span>
        </div>` : ''}
        <div class="desglose-linea">
          <span class="desglose-concepto">Impuesto eléctrico</span>
          <span class="desglose-detalle">5,11% de ${this.fmt(d.sumaBase)}</span>
          <span class="desglose-importe">${this.fmt(d.impuestoElec)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Alquiler equipos medida</span>
          <span class="desglose-detalle">${d.isCanarias ? `${this.fmtNum(0.81 / 30, 4)}/día × ${datos.dias} días` : `${this.fmtNum(0.026667, 4)}/día × ${datos.dias} días`}</span>
          <span class="desglose-importe">${this.fmt(d.isCanarias ? d.alquilerContador : d.margen)}</span>
        </div>
      </div>`;

      if (d.isCanarias) {
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IMPUESTOS</h3><span class="desglose-importe-header">${this.fmt(d.igicBase + d.igicContador)}</span></div>
          ${d.usoFiscal === 'vivienda' ? `<div class="desglose-linea">
            <span class="desglose-concepto">IGIC energía</span>
            <span class="desglose-detalle">Exento (vivienda ≤10kW)</span>
            <span class="desglose-importe">0,00 €</span>
          </div>` : `<div class="desglose-linea">
            <span class="desglose-concepto">IGIC energía (3%)</span>
            <span class="desglose-detalle">3% de ${this.fmt(d.baseEnergia + d.impuestoElec)}</span>
            <span class="desglose-importe">${this.fmt(d.igicBase)}</span>
          </div>`}
          <div class="desglose-linea">
            <span class="desglose-concepto">IGIC contador (7%)</span>
            <span class="desglose-detalle">7% de ${this.fmt(d.alquilerContador)}</span>
            <span class="desglose-importe">${this.fmt(d.igicContador)}</span>
          </div>
        </div>`;
      } else {
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IVA</h3><span class="desglose-importe-header">${this.fmt(d.iva)}</span></div>
          <div class="desglose-linea">
            <span class="desglose-concepto">IVA (21%)</span>
            <span class="desglose-detalle">21% de ${this.fmt(d.ivaBase)}</span>
            <span class="desglose-importe">${this.fmt(d.iva)}</span>
          </div>
        </div>`;
      }

      if (d.excedenteSobranteEur > 0 || d.credit2 > 0) {
        html += `<div class="desglose-seccion desglose-seccion--bv">
          <div class="desglose-seccion-header desglose-seccion-header--bv"><h3>${(datos.tieneBV ? "🔋 BATERÍA VIRTUAL" : "☀️ EXCEDENTES NO COMPENSADOS")}</h3><span class="desglose-importe-header">${this.fmt(datos.tieneBV ? (d.bvSaldoFin || 0) : (d.excedenteSobranteEur || 0))}</span></div>
          ${datos.bateriaVirtual > 0 ? `<div class="desglose-linea">
            <span class="desglose-concepto">Saldo mes anterior</span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe">${this.fmt(datos.bateriaVirtual)}</span>
          </div>` : ''}
          ${d.credit2 > 0 ? `<div class="desglose-linea">
            <span class="desglose-concepto">BV utilizada este mes</span>
            <span class="desglose-detalle">Aplicado a factura</span>
            <span class="desglose-importe desglose-importe--neg">-${this.fmt(d.credit2)}</span>
          </div>` : ''}
          ${d.credit2 > 0 ? `<div class="desglose-ayuda desglose-ayuda--bv">✅ <strong>Ventaja Batería Virtual:</strong> Descuenta de TODA la factura (potencia, impuestos y alquiler incluidos), no solo del consumo.</div>` : ''}
          ${d.excedenteSobranteEur > 0 ? `<div class="desglose-linea">
            <span class="desglose-concepto">${datos.tieneBV ? "Excedentes acumulados" : "Sobrante de excedentes"}</span>
            <span class="desglose-detalle">${datos.tieneBV ? "No compensados este mes" : "No se compensa este mes"}</span>
            <span class="desglose-importe desglose-importe--pos">+${this.fmt(d.excedenteSobranteEur)}</span>
          </div>` : ''}
          ${datos.tieneBV ? `<div class="desglose-linea">
            <span class="desglose-concepto"><strong>Saldo BV próximo mes</strong></span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe"><strong>${this.fmt(d.bvSaldoFin || 0)}</strong></span>
          </div>` : ''}
        </div>`;
      }

                  html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>💳 TOTALES</h3></div>
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>TOTAL FACTURA</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe desglose-importe-final">${this.fmt(d.totalBase)}</span>
        </div>
        ${d.credit2 > 0 ? `<div class="desglose-linea desglose-linea--hl-blue">
          <span class="desglose-concepto">🔋 Batería Virtual aplicada</span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe desglose-importe--blue">-${this.fmt(d.credit2)}</span>
        </div>` : ''}
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>PAGAS ESTE MES</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe desglose-importe-final ${d.totalFinal === 0 ? 'desglose-importe--pos' : ''}">${this.fmt(d.totalFinal)}</span>
        </div>
        ${datos.tieneBV && d.excedenteSobranteEur > 0 ? `<div class="desglose-linea desglose-linea--top-accent">
          <span class="desglose-concepto"><strong>🏆 Coste neto (para comparar tarifas)</strong></span>
          <span class="desglose-detalle">Este es el coste real de <strong>${datos.nombreTarifa || 'esta tarifa'}</strong> este mes, sin contar tu saldo BV del pasado. Úsalo para comparar con otras tarifas de forma justa.<br><span class="desglose-detalle-sub">Cálculo: ${this.fmt(d.totalBase)} (factura) − ${this.fmt(d.excedenteSobranteEur)} (excedentes hoy) = ${this.fmt(d.totalRanking)}</span></span>
          <span class="desglose-importe desglose-importe-final desglose-importe--accent">${this.fmt(d.totalRanking)}</span>
        </div>` : ''}
      </div>`;
this.modal.querySelector('.desglose-body').innerHTML = html;
    },

    fmt(n, decimales = 2) {
      if (typeof n !== 'number') return '0,00 €';
      return n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + ' €';
    },

    fmtNum(n, decimales = 2) {
      if (typeof n !== 'number') return '0,00';
      return n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    }
  };

  // Init diferido: se crea el modal solo al abrir un desglose.

})();
