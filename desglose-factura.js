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
      const desglose = this.calcularDesglose(datos);
      this.renderizar(desglose, datos);
      
      requestAnimationFrame(() => {
        this.overlay.classList.add('active');
        this.modal.classList.add('active');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      });
    },

    cerrar() {
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
      const tarifaAcceso = round2(4.650987 / 365 * dias);

      let consAdj = cons;
      let tarifaAdj = tarifaAcceso;
      let credit1 = 0;
      let excedenteSobranteEur = 0;

      if (solarOn && excedentes > 0 && precioCompensacion > 0 && tipoCompensacion !== 'NO COMPENSA') {
        const exKwh = clampNonNeg(excedentes);
        const creditoPotencial = round2(exKwh * precioCompensacion);
        
        let baseCompensable = cons;
        if (topeCompensacion === 'ENERGIA + PEAJES + CARGOS') baseCompensable = cons + tarifaAcceso;

        credit1 = Math.min(creditoPotencial, baseCompensable);
        consAdj = round2(Math.max(0, cons - credit1));

        if (topeCompensacion === 'ENERGIA + PEAJES + CARGOS') {
          const restante = Math.max(0, credit1 - cons);
          tarifaAdj = round2(Math.max(0, tarifaAcceso - restante));
        }

        excedenteSobranteEur = Math.max(0, creditoPotencial - credit1);
      }

      const sumaBase = pot + consAdj + tarifaAdj;
      const impuestoElec = round2(Math.max((5.11269632 / 100) * sumaBase, (consumoPunta + consumoLlano + consumoValle) * 0.001));
      const margen = round2(dias * 0.026667);

      let resultado = {};

      if (isCanarias) {
        const baseEnergia = sumaBase + margen;
        const alquilerContador = dias * (0.81 / 30);
        const usoFiscal = esViviendaCanarias && potenciaContratada > 0 && potenciaContratada <= 10 ? 'vivienda' : 'otros';
        const igicBase = usoFiscal === 'vivienda' ? 0 : (baseEnergia + impuestoElec) * 0.03;
        const igicContador = alquilerContador * 0.07;
        const impuestosNum = impuestoElec + igicBase + igicContador;
        let totalBase = baseEnergia + impuestoElec + igicBase + igicContador + alquilerContador;

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV') {
          let disponible = bateriaVirtual;
          let excedenteParaBv = excedenteSobranteEur;
          if (reglaBV === 'MES ACTUAL + BV') disponible = bateriaVirtual + excedenteParaBv;

          credit2 = Math.min(clampNonNeg(disponible), totalBase);

          if (reglaBV === 'BV MES ANTERIOR') bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          else if (reglaBV === 'MES ACTUAL + BV') bvSaldoFin = round2(Math.max(0, (excedenteSobranteEur + bateriaVirtual) - credit2));

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
          let disponible = bateriaVirtual;
          let excedenteParaBv = excedenteSobranteEur;
          if (reglaBV === 'MES ACTUAL + BV') disponible = bateriaVirtual + excedenteParaBv;

          credit2 = Math.min(clampNonNeg(disponible), totalBase);

          if (reglaBV === 'BV MES ANTERIOR') bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          else if (reglaBV === 'MES ACTUAL + BV') bvSaldoFin = round2(Math.max(0, (excedenteSobranteEur + bateriaVirtual) - credit2));

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
      this.modal.querySelector('.desglose-tarifa').innerHTML = `<strong>${datos.nombreTarifa || 'Tarifa'}</strong>`;
      this.modal.querySelector('.desglose-periodo').innerHTML = `${datos.fechaInicio || '01/12/2025'} - ${datos.fechaFin || '31/12/2025'} (${datos.dias || 30} días)`;

      let html = '';

      // ===== RESUMEN CLARO (Factura "perfecta") =====
      const solarOn = Boolean(datos.solarOn);
      const exKwh = clampNonNeg(Number(datos.excedentes || 0));
      const precioComp = Number(datos.precioCompensacion || 0);
      const creditoPotencial = (solarOn && exKwh > 0 && precioComp > 0) ? round2(exKwh * precioComp) : 0;
      // kWh de excedentes realmente usados vs sobrantes (más intuitivo que solo €)
      const kwhExUsados = (solarOn && precioComp > 0 && d.credit1 > 0) ? clampNonNeg(d.credit1 / precioComp) : 0;
      const kwhExSobrantes = (solarOn && precioComp > 0 && exKwh > 0) ? clampNonNeg(exKwh - kwhExUsados) : 0;
      const tope = String(datos.topeCompensacion || 'ENERGIA');
      const topeLabel = (tope === 'ENERGIA + PEAJES + CARGOS') ? 'Energía + peajes + cargos' : 'Energía';
      const pagoMes = (typeof d.totalFinal === 'number') ? d.totalFinal : d.totalBase;
      const bvActiva = Boolean(datos.tieneBV) && String(datos.tipoCompensacion || '').includes('BV');

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
            <div class="desglose-resumen-label">Compensación aplicada (tope: ${topeLabel})</div>
            <div class="desglose-resumen-value">${this.fmt(d.credit1)}</div>
            <div class="desglose-resumen-sub">Regla: la compensación se aplica como máximo hasta <strong>${topeLabel}</strong> (no puede dejar ese término en negativo).</div>
            ${(solarOn && precioComp > 0 && exKwh > 0) ? `<div class="desglose-resumen-sub">Excedentes: usados <strong>${this.fmtNum(kwhExUsados)}</strong> kWh · sobrantes <strong>${this.fmtNum(kwhExSobrantes)}</strong> kWh</div>` : ''}
          </div>` : ''}
          ${(d.excedenteSobranteEur > 0) ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Sobrante de excedentes</div>
            <div class="desglose-resumen-value">${this.fmt(d.excedenteSobranteEur)}</div>
          </div>` : ''}
        </div>
        ${(d.credit1 > 0 && creditoPotencial > d.credit1) ? `<div class="desglose-resumen-note">
          Has generado <strong>${this.fmt(creditoPotencial)}</strong> en excedentes, pero solo se han aplicado <strong>${this.fmt(d.credit1)}</strong> este mes porque la compensación está limitada al tope (<strong>${topeLabel}</strong>). El sobrante ${bvActiva ? 'se acumula en la Batería Virtual' : 'no se compensa este mes'}.
        </div>` : ''}
      </div>`;


      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>⚡ POTENCIA</h3><span class="desglose-importe-header">${this.fmt(d.pot)}</span></div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Potencia punta (P1)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × ${datos.dias} días × ${this.fmtNum(datos.precioP1, 6)}/kW día</span>
          <span class="desglose-importe">${this.fmt(datos.potenciaP1 * datos.dias * datos.precioP1)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Potencia valle (P2)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.potenciaP2)} kW × ${datos.dias} días × ${this.fmtNum(datos.precioP2, 6)}/kW día</span>
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
          <span class="desglose-detalle">${this.fmtNum(datos.consumoPunta)} kWh × ${this.fmtNum(datos.precioPunta, 6)}/kWh</span>
          <span class="desglose-importe">${this.fmt(datos.consumoPunta * datos.precioPunta)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Llano (P2)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoLlano)} kWh × ${this.fmtNum(datos.precioLlano, 6)}/kWh</span>
          <span class="desglose-importe">${this.fmt(datos.consumoLlano * datos.precioLlano)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Valle (P3)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoValle)} kWh × ${this.fmtNum(datos.precioValle, 6)}/kWh</span>
          <span class="desglose-importe">${this.fmt(datos.consumoValle * datos.precioValle)}</span>
        </div>
        ${d.credit1 > 0 ? `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">☀️ Compensación excedentes</span>
          <span class="desglose-detalle">${this.fmtNum(datos.excedentes)} kWh × ${this.fmtNum(datos.precioCompensacion, 6)}/kWh = ${this.fmt(creditoPotencial)} · Usados: ${this.fmtNum(kwhExUsados)} kWh (${this.fmt(d.credit1)}) · Sobrante: ${this.fmtNum(kwhExSobrantes)} kWh (${this.fmt(d.excedenteSobranteEur)}) · Tope: ${topeLabel}</span>
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
          <span class="desglose-detalle">${this.fmtNum(4.650987/365, 6)}/día × ${datos.dias} días</span>
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
          <span class="desglose-detalle">${this.fmtNum(0.026667, 6)}/día × ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(d.margen)}</span>
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
          ${d.credit2 > 0 ? `<div class="desglose-ayuda desglose-ayuda--bv">La Batería Virtual se aplica al <strong>total final</strong> de la factura (potencia, alquiler e impuestos incluidos).</div>` : ''}
          ${d.excedenteSobranteEur > 0 ? `<div class="desglose-linea">
            <span class="desglose-concepto">${datos.tieneBV ? "Excedentes acumulados" : "Sobrante de excedentes"}</span>
            <span class="desglose-detalle">${datos.tieneBV ? "No compensados este mes" : "No se compensa este mes"}</span>
            <span class="desglose-importe desglose-importe--pos">+${this.fmt(d.excedenteSobranteEur)}</span>
          </div>` : ''}
          <div class="desglose-linea">
            <span class="desglose-concepto"><strong>Saldo BV próximo mes</strong></span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe"><strong>${this.fmt(datos.tieneBV ? (d.bvSaldoFin || 0) : (d.excedenteSobranteEur || 0))}</strong></span>
          </div>
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
          <span class="desglose-importe desglose-importe-final ${d.totalFinal <= 0.00001 ? 'desglose-importe--pos' : ''}">${this.fmt(d.totalFinal)}</span>
        </div>
        ${datos.tieneBV && d.excedenteSobranteEur > 0 ? `<div class="desglose-linea desglose-linea--top-accent">
          <span class="desglose-concepto"><strong>Coste neto del periodo</strong></span>
          <span class="desglose-detalle">Comparativa: ignora el saldo BV anterior</span>
          <span class="desglose-importe desglose-importe-final desglose-importe--accent">${this.fmt(d.totalRanking)}</span>
        </div>` : ''}
      </div>`;      </div>`;

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.__LF_DesgloseFactura.init());
  } else {
    window.__LF_DesgloseFactura.init();
  }

})();
