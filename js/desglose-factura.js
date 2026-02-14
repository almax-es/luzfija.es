/**
 * SISTEMA DE DESGLOSE DE FACTURA
 * Replica la lógica exacta de app.js
 */

(function() {
  'use strict';


  const round2 = (n) => Math.round(n * 100) / 100;
  const clampNonNeg = (n) => Math.max(0, n);
  // Normaliza valores numéricos que llegan como string/undefined para evitar NaN y errores de runtime.
  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  const escapeHtml = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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
      // ✅ Si es PVPC, usar datos ya calculados
      if (datos.esPVPC && datos.metaPvpc) {
        const meta = datos.metaPvpc;

        const isCanarias = datos.zonaFiscal === 'Canarias';
        const isCeutaMelilla = datos.zonaFiscal === 'CeutaMelilla';

        const pot = safeNum(meta.terminoFijo, 'potencia'); // Peajes+cargos potencia (sin margen)
        const cons = safeNum(meta.terminoVariable, 'consumo');
        const tarifaAcceso = safeNum(meta.bonoSocial, 'tarifaAcceso'); // Financiación bono social
        const margen = safeNum(meta.costeMargenPot, 'margen');

        // Descuento bono social (si procede) ya debe venir aplicado dentro de la meta PVPC (se recalcula en el ranking)
        const bonoSocialDescuentoEur = safeNum(meta.bonoSocialDescuentoEur, 'bonoSocialDescuentoEur');
        const bonoSocialCalc = meta.bonoSocialCalc || null;

        // Base imponible para el Impuesto Eléctrico (ya incluye cualquier descuento del bono social)
        const baseEnergia = Number.isFinite(Number(meta.baseEnergia))
          ? Number(meta.baseEnergia)
          : round2((pot + margen + cons + tarifaAcceso) - bonoSocialDescuentoEur);

        const alquilerContador = Number.isFinite(Number(meta.equipoMedida))
          ? Number(meta.equipoMedida)
          : safeNum(meta.baseContador, 'baseContador');

        const impuestoElec = Number.isFinite(Number(meta.impuestoElectrico))
          ? Number(meta.impuestoElectrico)
          : 0;

        const impuestoEnergia = Number.isFinite(Number(meta.impuestoEnergia))
          ? Number(meta.impuestoEnergia)
          : 0;

        const impuestoContador = Number.isFinite(Number(meta.impuestoContador))
          ? Number(meta.impuestoContador)
          : 0;

        const iva = Number.isFinite(Number(meta.iva)) ? Number(meta.iva) : 0;
        const ivaBase = Number.isFinite(Number(meta.ivaBase)) ? Number(meta.ivaBase) : 0;
        const baseIPSI = Number.isFinite(Number(meta.baseIPSI)) ? Number(meta.baseIPSI) : 0;
        const usoFiscal = meta.usoFiscal || 'otros';

        const totalFactura = Number.isFinite(Number(meta.totalFactura))
          ? Number(meta.totalFactura)
          : round2(baseEnergia + impuestoElec + alquilerContador + impuestoEnergia + impuestoContador);

        // PVPC: no hay FV (solar no calculable aquí)
        const impuestosTotal = Number.isFinite(Number(meta.impuestosTotal))
          ? Number(meta.impuestosTotal)
          : round2(tarifaAcceso + impuestoElec + alquilerContador + impuestoEnergia + impuestoContador);

        return {
          pot: pot,
          margen: margen,
          cons: cons,
          consAdj: cons,
          tarifaAcceso: tarifaAcceso,
          tarifaAdj: tarifaAcceso,
          credit1: 0,
          excedenteSobranteEur: 0,
          sumaBase: baseEnergia,
          impuestoElec: round2(impuestoElec),
          alquilerContador: round2(alquilerContador),
          iva: round2(iva),
          ivaBase: round2(ivaBase),
          baseIPSI: round2(baseIPSI),
          baseEnergia: round2(baseEnergia),
          igicBase: round2(impuestoEnergia),
          igicContador: round2(impuestoContador),
          ipsiEnergia: round2(impuestoEnergia),
          ipsiContador: round2(impuestoContador),
          totalBase: round2(totalFactura),
          totalFinal: round2(totalFactura),
          totalRanking: round2(totalFactura),
          impuestosNum: round2(impuestosTotal),
          isCanarias: isCanarias,
          isCeutaMelilla: isCeutaMelilla,
          isPVPC: true,
          usoFiscal: usoFiscal,
          bonoSocialDescuentoEur: round2(bonoSocialDescuentoEur),
          bonoSocialProximoMes: safeNum(meta.bonoSocialProximoMes, 'bonoSocialProximoMes'),
          bonoSocialCalc: bonoSocialCalc
        };
      }

      // ✅ Para tarifas normales, calcular como antes
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

      // Configuración centralizada
      const CFG = window.LF_CONFIG;
      const isCanarias = zonaFiscal === 'Canarias';
      const isCeutaMelilla = zonaFiscal === 'CeutaMelilla';
      const potenciaContratada = Math.max(potenciaP1, potenciaP2);

      // Obtener configuración del territorio
      const terr = CFG.getTerritorio(zonaFiscal);
      const impuestosTerr = terr.impuestos;

      const pot = round2((potenciaP1 * dias * precioP1) + (potenciaP2 * dias * precioP2));
      const cons = round2((consumoPunta * precioPunta) + (consumoLlano * precioLlano) + (consumoValle * precioValle));
      const tarifaAcceso = round2(CFG.bonoSocial.eurosAnuales / 365 * dias);

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
      const consumoTotalKwh = consumoPunta + consumoLlano + consumoValle;
      const impuestoElec = round2(Math.max((CFG.iee.porcentaje / 100) * sumaBase, consumoTotalKwh * CFG.iee.minimoEurosKwh));
      const alquilerContador = round2(dias * CFG.alquilerContador.eurosMes * 12 / 365);

      let resultado = {};

      if (isCanarias) {
        // ═══════════════════════════════════════════════════════════════
        // CANARIAS: IGIC (0% vivienda ≤10kW, 3% otros, 7% contador)
        // ═══════════════════════════════════════════════════════════════
        const baseEnergia = sumaBase;
        const usoFiscal = esViviendaCanarias && potenciaContratada > 0 && potenciaContratada <= 10 ? 'vivienda' : 'otros';
        const igicBase = usoFiscal === 'vivienda' ? 0 : round2((baseEnergia + impuestoElec) * impuestosTerr.energiaOtros);
        const igicContador = round2(alquilerContador * impuestosTerr.contador);
        const impuestosNum = impuestoElec + igicBase + igicContador;
        let totalBase = round2(baseEnergia + impuestoElec + igicBase + alquilerContador + igicContador);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV') {
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = solarOn && tieneBV ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur,
          sumaBase, impuestoElec, baseEnergia, alquilerContador, igicBase, igicContador,
          impuestosNum, totalBase, credit2, bvSaldoFin, totalFinal, totalRanking,
          isCanarias: true, isCeutaMelilla: false, usoFiscal };

      } else if (isCeutaMelilla) {
        // ═══════════════════════════════════════════════════════════════
        // CEUTA Y MELILLA: IPSI (1% energía, 4% contador)
        // Ley 8/1991 Art. 18
        // ═══════════════════════════════════════════════════════════════
        const baseEnergia = sumaBase;
        const baseIPSI = sumaBase + impuestoElec;
        const ipsiEnergia = round2(baseIPSI * impuestosTerr.energia);
        const ipsiContador = round2(alquilerContador * impuestosTerr.contador);
        const impuestosNum = impuestoElec + ipsiEnergia + ipsiContador;
        let totalBase = round2(sumaBase + impuestoElec + ipsiEnergia + alquilerContador + ipsiContador);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV') {
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = solarOn && tieneBV ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur,
          sumaBase, impuestoElec, baseEnergia, alquilerContador, baseIPSI, ipsiEnergia, ipsiContador,
          impuestosNum, totalBase, credit2, bvSaldoFin, totalFinal, totalRanking,
          isCanarias: false, isCeutaMelilla: true };

      } else {
        // ═══════════════════════════════════════════════════════════════
        // PENÍNSULA Y BALEARES: IVA 21%
        // ═══════════════════════════════════════════════════════════════
        const baseEnergia = sumaBase + impuestoElec + alquilerContador;
        const ivaBase = pot + consAdj + tarifaAdj + impuestoElec + alquilerContador;
        const iva = round2(ivaBase * impuestosTerr.energia);
        let totalBase = round2(ivaBase + iva);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV') {
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = solarOn && tieneBV ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;
        const impuestosNum = round2(tarifaAdj + impuestoElec + alquilerContador + iva);

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur,
          sumaBase, impuestoElec, alquilerContador, baseEnergia, ivaBase, iva, impuestosNum,
          totalBase, credit2, bvSaldoFin, totalFinal, totalRanking, isCanarias: false, isCeutaMelilla: false };
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
      
      this.modal.querySelector('.desglose-tarifa').innerHTML = `<strong>${escapeHtml(datos.nombreTarifa || 'Tarifa')}</strong>`;
      this.modal.querySelector('.desglose-periodo').innerHTML = `${escapeHtml(datos.fechaInicio || fechaInicioDefault)} - ${escapeHtml(datos.fechaFin || fechaFinDefault)} (${datos.dias || diasDefault} días)`;

      let html = '';

      // Cuando una sección tiene sublíneas (P1/P2 o Punta/Llano/Valle), si redondeamos cada
      // sublínea a 2 decimales puede aparecer un descuadre típico (±0,01€) con el total.
      // Blindamos el desglose reconciliando el último concepto para que las sublíneas SIEMPRE
      // sumen exactamente el total mostrado.
      const reconcileToTarget = (target, parts) => {
        const tgt = round2(safeNum(target));
        const rounded = parts.map((x) => round2(safeNum(x)));
        const sumRounded = round2(rounded.reduce((a, b) => a + b, 0));
        const delta = round2(tgt - sumRounded);
        // Solo corregimos desajustes típicos de redondeo (±0,01/0,02). Si hay una desviación grande,
        // preferimos no "inventar" importes y dejar el desglose tal cual.
        if (delta !== 0 && rounded.length && Math.abs(delta) <= 0.05) {
          rounded[rounded.length - 1] = round2(rounded[rounded.length - 1] + delta);
        }
        return rounded;
      };

      // =====================
      // BLINDAJE REDONDEOS
      // =====================
      // POTENCIA (todas las tarifas): P1 + P2 = total POTENCIA
      const diasCalc = safeNum(datos.dias);
      const rawPotP1 = d.isPVPC
        ? (safeNum(datos.potenciaP1) * 0.075901 * diasCalc)
        : (safeNum(datos.potenciaP1) * diasCalc * safeNum(datos.precioP1));
      const rawPotP2 = d.isPVPC
        ? (safeNum(datos.potenciaP2) * 0.001987 * diasCalc)
        : (safeNum(datos.potenciaP2) * diasCalc * safeNum(datos.precioP2));
      const [potP1Disp, potP2Disp] = reconcileToTarget(d.pot, [rawPotP1, rawPotP2]);

      // Si P1 y P2 son idénticas (potencia y precio), mostramos un ajuste explícito
      // para evitar que una línea aparezca con 0,01€ menos.
      const potEqual =
        Math.abs(safeNum(datos.potenciaP1) - safeNum(datos.potenciaP2)) < 1e-9 &&
        Math.abs(safeNum(datos.precioP1) - safeNum(datos.precioP2)) < 1e-9;
      const potRoundedRaw = [round2(rawPotP1), round2(rawPotP2)];
      const potSumRounded = round2(potRoundedRaw[0] + potRoundedRaw[1]);
      const potDelta = round2(round2(safeNum(d.pot)) - potSumRounded);
      const showPotRounding = potEqual && potDelta !== 0 && Math.abs(potDelta) <= 0.05;

      // CONSUMO (todas las tarifas): Punta + Llano + Valle = total CONSUMO (antes de compensación)
      const rawConsP1 = safeNum(datos.consumoPunta) * safeNum(datos.precioPunta);
      const rawConsP2 = safeNum(datos.consumoLlano) * safeNum(datos.precioLlano);
      const rawConsP3 = safeNum(datos.consumoValle) * safeNum(datos.precioValle);
      const [consP1Disp, consP2Disp, consP3Disp] = reconcileToTarget(d.cons, [rawConsP1, rawConsP2, rawConsP3]);

      // Calcular precio medio por kWh (antes de impuestos y compensación de excedentes)
      const consumoTotalKwh = safeNum(datos.consumoPunta) + safeNum(datos.consumoLlano) + safeNum(datos.consumoValle);
      const importeConsumoTotal = consP1Disp + consP2Disp + consP3Disp;
      const precioMedioPorKwh = consumoTotalKwh > 0 ? importeConsumoTotal / consumoTotalKwh : 0;

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
      // Detectar si es TotalEnergies (compensación parcial)
      const esTE = (datos.nombreTarifa || '').startsWith('TE ');
      // Mostrar precio con menos decimales para mayor claridad (2 en lugar de 6)
      const precioLabel = esNufri ? `${this.fmtNum(datos.precioCompensacion, 2)} €/kWh <span style="color:#f59e0b">(est.)</span>` : `${this.fmtNum(datos.precioCompensacion, 2)} €/kWh`;

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
          ${(d.credit1 > 0) ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Compensación aplicada</div>
            <div class="desglose-resumen-value">${this.fmt(d.credit1)}</div>
            <div class="desglose-resumen-sub">💡 <strong>Tope legal:</strong> Solo se puede compensar hasta el coste del ${topeLabel} del mes.</div>
            ${(solarOn && precioComp > 0 && exKwh > 0) ? `<div class="desglose-resumen-sub">✅ Compensados: <strong>${this.fmtNum(kwhExUsados)}</strong> kWh${bvActiva ? ` · 🔋 A batería virtual: <strong>${this.fmtNum(kwhExSobrantes)}</strong> kWh` : (kwhExSobrantes > 0 ? ` · ❌ Se pierden: <strong>${this.fmtNum(kwhExSobrantes)}</strong> kWh` : '')}</div>` : ''}
          </div>` : ''}
        </div>
        ${(d.credit1 > 0 && creditoPotencial > d.credit1) ? `<div class="desglose-resumen-note">
          ✅ Has generado <strong>${this.fmt(creditoPotencial)}</strong> en excedentes. Se compensan <strong>${this.fmt(d.credit1)}</strong> este mes (tope legal: ${topeLabel}). ${bvActiva ? `Los <strong>${this.fmt(d.excedenteSobranteEur)}</strong> restantes se guardan en tu Batería Virtual para próximas facturas.` : 'El resto no se puede compensar este mes.'}
        </div>` : ''}
        ${esNufri && compensa ? `<div class="desglose-resumen-note desglose-resumen-note--nufri">
          ⚠️ <strong>Precio estimado:</strong> Nufri paga excedentes a precio <strong>indexado</strong> (pool OMIE horario). El valor mostrado (${this.fmtNum(datos.precioCompensacion, 4)} €/kWh) es una <strong>estimación promedio</strong>. El precio real variará según el mercado eléctrico.
        </div>` : ''}
        ${esTE && compensa ? `<div class="desglose-resumen-note desglose-resumen-note--te">
          ❗ <strong>Compensación parcial:</strong> TotalEnergies solo compensa sobre el coste de la energía sin peajes ni cargos. Estos conceptos (~40% del coste por kWh) no se descuentan, por lo que el ahorro real es inferior al que sugiere el precio de 0,07 €/kWh.
        </div>` : ''}
      </div>`;


      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>⚡ POTENCIA</h3><span class="desglose-importe-header">${this.fmt(d.pot)}</span></div>
        ${d.isPVPC ? `
          <div class="desglose-linea">
            <span class="desglose-concepto">Peajes de acceso a las redes de transporte y distribución</span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe">${this.fmt(d.pot)}</span>
          </div>
          <div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">→ P1 (Punta)</span>
            <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × 0,075901 €/kW·día × ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(potP1Disp)}</span>
          </div>
          <div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">→ P2 (Valle)</span>
            <span class="desglose-detalle">${this.fmtNum(datos.potenciaP2)} kW × 0,001987 €/kW·día × ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(potP2Disp)}</span>
          </div>
        ` : `
          <div class="desglose-linea">
            <span class="desglose-concepto">Potencia punta (P1)</span>
            <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × ${datos.dias} días × ${this.fmtNum(datos.precioP1, 4)} €/kW·día</span>
            <span class="desglose-importe">${this.fmt(showPotRounding ? potRoundedRaw[0] : potP1Disp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Potencia valle (P2)</span>
            <span class="desglose-detalle">${this.fmtNum(datos.potenciaP2)} kW × ${datos.dias} días × ${this.fmtNum(datos.precioP2, 4)} €/kW·día</span>
            <span class="desglose-importe">${this.fmt(showPotRounding ? potRoundedRaw[1] : potP2Disp)}</span>
          </div>
          ${showPotRounding ? `<div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">Ajuste redondeo</span>
            <span class="desglose-detalle"></span>
            <span class="desglose-importe">${this.fmt(potDelta)}</span>
          </div>` : ''}
        `}
      </div>`;

      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>💡 CONSUMO</h3><span class="desglose-importe-header">${((d.credit1 > 0 || d.consAdj < d.cons) ? (this.fmt(d.cons) + " → " + this.fmt(d.consAdj)) : this.fmt(d.cons))}</span></div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Consumo total${d.credit1 > 0 ? ' (antes de compensación)' : ''}</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoPunta + datos.consumoLlano + datos.consumoValle)} kWh</span>
          <span class="desglose-importe">${this.fmt(d.credit1 > 0 ? d.cons : d.consAdj)}</span>
        </div>
        ${consumoTotalKwh > 0 ? `<div class="desglose-linea desglose-linea-sub desglose-linea-precio-medio">
          <span class="desglose-concepto">⚡ Precio medio</span>
          <span class="desglose-detalle">Coste medio por kWh</span>
          <span class="desglose-importe">${this.fmtPrecio(precioMedioPorKwh)} €/kWh</span>
        </div>` : ''}
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Punta (P1)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoPunta)} kWh × ${this.fmtPrecio(datos.precioPunta)} €/kWh</span>
          <span class="desglose-importe">${this.fmt(consP1Disp)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Llano (P2)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoLlano)} kWh × ${this.fmtPrecio(datos.precioLlano)} €/kWh</span>
          <span class="desglose-importe">${this.fmt(consP2Disp)}</span>
        </div>
        <div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Valle (P3)</span>
          <span class="desglose-detalle">${this.fmtNum(datos.consumoValle)} kWh × ${this.fmtPrecio(datos.precioValle)} €/kWh</span>
          <span class="desglose-importe">${this.fmt(consP3Disp)}</span>
        </div>
        ${d.credit1 > 0 ? `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">☀️ Compensación excedentes</span>
          <span class="desglose-detalle desglose-detalle--exced">  <span class="exced-item">Generados: <span class="nowrap">${this.fmtNum(datos.excedentes)} kWh</span>   <span class="nowrap">× ${precioLabel} = ${this.fmt(creditoPotencial)}</span></span>  <span class="exced-sep">·</span>  <span class="exced-item">✅ Compensados hoy: <span class="nowrap">${this.fmtNum(kwhExUsados)} kWh</span>   <span class="nowrap">(${this.fmt(d.credit1)})</span></span>  ${bvActiva ? `<span class="exced-sep">·</span>  <span class="exced-item">🔋 A batería virtual: <span class="nowrap">${this.fmtNum(kwhExSobrantes)} kWh</span>   <span class="nowrap">(${this.fmt(d.excedenteSobranteEur)})</span></span>` : (kwhExSobrantes > 0 ? `<span class="exced-sep">·</span>  <span class="exced-item">❌ Se pierden (sin batería virtual): <span class="nowrap">${this.fmtNum(kwhExSobrantes)} kWh</span>   <span class="nowrap">(${this.fmt(d.excedenteSobranteEur)})</span></span>` : '')}</span>
          <span class="desglose-importe desglose-importe--pos">-${this.fmt(d.credit1)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>Consumo a pagar</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe"><strong>${this.fmt(d.consAdj)}</strong></span>
        </div>` : ''}
      </div>`;

      const otrosConceptosHeader = (d.isCanarias || d.isCeutaMelilla)
        ? (d.tarifaAdj + d.impuestoElec + (d.isPVPC && d.margen > 0 ? d.margen : 0) - (d.isPVPC ? d.bonoSocialDescuentoEur : 0))
        : (d.tarifaAdj + d.impuestoElec + d.alquilerContador + (d.isPVPC && d.margen > 0 ? d.margen : 0) - (d.isPVPC ? d.bonoSocialDescuentoEur : 0));

      // OTROS CONCEPTOS (todas las tarifas): blindaje de redondeos para que la suma de líneas
      // (excluyendo subtotales informativos) coincida exactamente con el total mostrado.
      const otrosTarget = round2(safeNum(otrosConceptosHeader));
      const otrosParts = [];
      // Financiación (si hay compensación específica en bono social, se mostrará línea adicional negativa).
      otrosParts.push(d.tarifaAcceso);
      const hayCompEnBonoSocial = (d.tarifaAdj !== d.tarifaAcceso && d.credit1 > 0);
      if (hayCompEnBonoSocial) otrosParts.push(-(d.tarifaAcceso - d.tarifaAdj));
      const hayMargen = (d.isPVPC && d.margen > 0);
      if (hayMargen) otrosParts.push(d.margen);
      const hayDescuentoBono = (d.isPVPC && d.bonoSocialDescuentoEur > 0);
      if (hayDescuentoBono) otrosParts.push(-d.bonoSocialDescuentoEur);
      otrosParts.push(d.impuestoElec);
      const hayAlquilerAqui = !(d.isCanarias || d.isCeutaMelilla);
      if (hayAlquilerAqui) otrosParts.push(d.alquilerContador);

      const otrosPartsDisp = reconcileToTarget(otrosTarget, otrosParts);
      let _oi = 0;
      const otrosFinDisp = otrosPartsDisp[_oi++] ?? 0;
      const otrosCompDisp = hayCompEnBonoSocial ? (otrosPartsDisp[_oi++] ?? 0) : null; // negativo
      const otrosMargenDisp = hayMargen ? (otrosPartsDisp[_oi++] ?? 0) : null;
      const otrosDescDisp = hayDescuentoBono ? (otrosPartsDisp[_oi++] ?? 0) : null; // negativo
      const otrosIeeDisp = otrosPartsDisp[_oi++] ?? 0;
      const otrosAlqDisp = hayAlquilerAqui ? (otrosPartsDisp[_oi++] ?? 0) : null;

      // PVPC + Bono Social: mostrar el descuento donde corresponde (entre margen e IEE), con la fórmula estilo CNMC.
      let bonoSocialLineaHtml = '';
      if (d.isPVPC && d.bonoSocialDescuentoEur > 0) {
        const bc = d.bonoSocialCalc || {};
        const pctTxt = this.fmtNum((Number(bc.porcentaje || 0) * 100), 1);
        const ratioTxt = this.fmtNum((Number(bc.ratioBonificable || 0) * 100), 2);
        const terminoFijoTotal = Number.isFinite(Number(bc.terminoFijoTotal)) ? Number(bc.terminoFijoTotal) : round2(d.pot + d.margen);
        const financiacion = d.tarifaAcceso;
        const terminoVariable = d.cons;
        const detalle = `Descuento: ${pctTxt}% de (Término fijo ${this.fmt(terminoFijoTotal)} + Financiación ${this.fmt(financiacion)} + ${ratioTxt}% de Término variable ${this.fmt(terminoVariable)})`;
        const kwhBonif = Number.isFinite(Number(bc.kwhBonificable)) ? Number(bc.kwhBonificable) : null;
        const kwhTot = Number.isFinite(Number(bc.consumoKwh)) ? Number(bc.consumoKwh) : null;
        const limiteAnual = Number.isFinite(Number(bc.limiteAnual)) ? Number(bc.limiteAnual) : null;
        const sub = (kwhBonif != null && kwhTot != null)
          ? `<span class="desglose-detalle-sub">Energía con derecho: <strong>${this.fmtNum(kwhBonif, 2)}</strong> kWh de <strong>${this.fmtNum(kwhTot, 2)}</strong> kWh (${ratioTxt}%)${(limiteAnual != null && limiteAnual > 0) ? ` · Límite anual: ${this.fmtNum(limiteAnual, 0)} kWh` : ''}</span>`
          : '';

        // Importe mostrado: usamos el valor reconciliado (si existiera un ajuste mínimo por redondeo).
        const descAbs = Math.abs(otrosDescDisp ?? (-d.bonoSocialDescuentoEur));

        bonoSocialLineaHtml = `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">🛡️ Descuento Bono Social</span>
          <span class="desglose-detalle">${detalle}${sub}</span>
          <span class="desglose-importe desglose-importe--pos">-${this.fmt(descAbs)}</span>
        </div>`;
      }

      html += `<div class="desglose-seccion">
        <div class="desglose-seccion-header"><h3>📝 OTROS CONCEPTOS</h3><span class="desglose-importe-header">${this.fmt(otrosTarget)}</span></div>
        <div class="desglose-linea">
          <span class="desglose-concepto">Financiación Bono Social</span>
          <span class="desglose-detalle">${this.fmtNum(window.LF_CONFIG.bonoSocial.eurosAnuales/365, 4)}/día × ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(otrosFinDisp)}</span>
        </div>
        ${hayCompEnBonoSocial ? `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">☀️ Compensación en Bono Social</span>
          <span class="desglose-detalle">Resto de compensación</span>
          <span class="desglose-importe desglose-importe--pos">-${this.fmt(Math.abs(otrosCompDisp || 0))}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>Bono Social tras compensación</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe"><strong>${this.fmt(round2(otrosFinDisp + (otrosCompDisp || 0)))}</strong></span>
        </div>` : ''}
        ${hayMargen ? `<div class="desglose-linea">
          <span class="desglose-concepto">Margen de comercialización</span>
          <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × 0,008529 €/kW·día × ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(otrosMargenDisp || 0)}</span>
        </div>` : ''}
        ${bonoSocialLineaHtml}
        <div class="desglose-linea">
          <span class="desglose-concepto">Impuesto eléctrico</span>
          <span class="desglose-detalle">${this.fmtNum(window.LF_CONFIG.iee.porcentaje, 2)}% de ${this.fmt(d.sumaBase)}</span>
          <span class="desglose-importe">${this.fmt(otrosIeeDisp)}</span>
        </div>
        ${hayAlquilerAqui ? `<div class="desglose-linea">
          <span class="desglose-concepto">Alquiler de contador (${this.fmtNum(window.LF_CONFIG.alquilerContador.eurosMes, 2)} €/mes)</span>
          <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(otrosAlqDisp || 0)}</span>
        </div>` : ''}
      </div>`;

      if (d.isCanarias) {
        // ═══════════════════════════════════════════════════════════════
        // CANARIAS: IGIC
        // ═══════════════════════════════════════════════════════════════
        const igicEnergiaBase = (d.usoFiscal === 'vivienda') ? 0 : d.igicBase;
        const igicTarget = round2(igicEnergiaBase + d.alquilerContador + d.igicContador);
        const [igicEnergiaDisp, igicAlqDisp, igicContDisp] = reconcileToTarget(igicTarget, [igicEnergiaBase, d.alquilerContador, d.igicContador]);
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IMPUESTOS Y ALQUILER (IGIC)</h3><span class="desglose-importe-header">${this.fmt(igicTarget)}</span></div>
          ${d.usoFiscal === 'vivienda' ? `<div class="desglose-linea">
            <span class="desglose-concepto">IGIC energía</span>
            <span class="desglose-detalle">Exento (vivienda ≤10kW)</span>
            <span class="desglose-importe">0,00 €</span>
          </div>` : `<div class="desglose-linea">
            <span class="desglose-concepto">IGIC energía (3%)</span>
            <span class="desglose-detalle">3% de ${this.fmt(d.baseEnergia + d.impuestoElec)}</span>
            <span class="desglose-importe">${this.fmt(igicEnergiaDisp)}</span>
          </div>`}
          <div class="desglose-linea">
            <span class="desglose-concepto">Alquiler de contador (${this.fmtNum(window.LF_CONFIG.alquilerContador.eurosMes, 2)} €/mes)</span>
            <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(igicAlqDisp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">IGIC contador (7%)</span>
            <span class="desglose-detalle">7% de ${this.fmt(d.alquilerContador)}</span>
            <span class="desglose-importe">${this.fmt(igicContDisp)}</span>
          </div>
        </div>`;
      } else if (d.isCeutaMelilla) {
        // ═══════════════════════════════════════════════════════════════
        // CEUTA Y MELILLA: IPSI (Ley 8/1991)
        // ═══════════════════════════════════════════════════════════════
        const ipsiTarget = round2(d.ipsiEnergia + d.alquilerContador + d.ipsiContador);
        const [ipsiEnergiaDisp, ipsiAlqDisp, ipsiContDisp] = reconcileToTarget(ipsiTarget, [d.ipsiEnergia, d.alquilerContador, d.ipsiContador]);
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IMPUESTOS Y ALQUILER (IPSI)</h3><span class="desglose-importe-header">${this.fmt(ipsiTarget)}</span></div>
          <div class="desglose-linea">
            <span class="desglose-concepto">IPSI energía (1%)</span>
            <span class="desglose-detalle">1% de ${this.fmt(d.baseIPSI)} (Ley 8/1991)</span>
            <span class="desglose-importe">${this.fmt(ipsiEnergiaDisp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Alquiler de contador (${this.fmtNum(window.LF_CONFIG.alquilerContador.eurosMes, 2)} €/mes)</span>
            <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(ipsiAlqDisp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">IPSI contador (4%)</span>
            <span class="desglose-detalle">4% de ${this.fmt(d.alquilerContador)}</span>
            <span class="desglose-importe">${this.fmt(ipsiContDisp)}</span>
          </div>
        </div>`;
      } else {
        // ═══════════════════════════════════════════════════════════════
        // PENÍNSULA Y BALEARES: IVA
        // ═══════════════════════════════════════════════════════════════
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
        html += `<div class="desglose-seccion ${bvActiva ? 'desglose-seccion--bv' : 'desglose-seccion--exc-lost'}">
          <div class="desglose-seccion-header ${bvActiva ? 'desglose-seccion-header--bv' : 'desglose-seccion-header--exc-lost'}"><h3>${(bvActiva ? "🔋 BATERÍA VIRTUAL" : "☀️ EXCEDENTES NO COMPENSADOS")}</h3><span class="desglose-importe-header">${this.fmt(bvActiva ? (d.bvSaldoFin || 0) : (d.excedenteSobranteEur || 0))}</span></div>
          ${bvActiva && datos.bateriaVirtual > 0 ? `<div class="desglose-linea">
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
            <span class="desglose-concepto">${bvActiva ? "Excedentes acumulados" : "Sobrante de excedentes"}</span>
            <span class="desglose-detalle">${bvActiva ? "No compensados este mes" : "No se compensa este mes"}</span>
            <span class="desglose-importe desglose-importe--pos">+${this.fmt(d.excedenteSobranteEur)}</span>
          </div>` : ''}
          ${!bvActiva && d.excedenteSobranteEur > 0 ? `<div class="desglose-ayuda desglose-ayuda--exc-lost">⚠️ Esta tarifa <strong>no tiene batería virtual</strong>. Los excedentes que superan el tope legal de compensación se pierden cada mes.</div>` : ''}
          ${bvActiva ? `<div class="desglose-linea">
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
        ${bvActiva && d.excedenteSobranteEur > 0 ? `<div class="desglose-linea desglose-linea--top-accent">
          <span class="desglose-concepto"><strong>🏆 Coste neto (para comparar tarifas)</strong></span>
          <span class="desglose-detalle">Este es el coste real de <strong>${escapeHtml(datos.nombreTarifa || 'esta tarifa')}</strong> este mes, sin contar tu saldo BV del pasado. Úsalo para comparar con otras tarifas de forma justa.<br><span class="desglose-detalle-sub">Cálculo: ${this.fmt(d.totalBase)} (factura) − ${this.fmt(d.excedenteSobranteEur)} (excedentes hoy) = ${this.fmt(d.totalRanking)}</span></span>
          <span class="desglose-importe desglose-importe-final desglose-importe--accent">${this.fmt(d.totalRanking)}</span>
        </div>` : ''}
      </div>`;
this.modal.querySelector('.desglose-body').innerHTML = html;
    },

    fmt(n, decimales = 2) {
      if (typeof n !== 'number') return '0,00\u00A0€';
      return n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + '\u00A0€';
    },

    fmtNum(n, decimales = 2) {
      if (typeof n !== 'number') return '0,00';
      return n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    },

    // Formatear precio eliminando ceros innecesarios (ej: 0,182000 → 0,182)
    fmtPrecio(n, maxDecimales = 6) {
      if (typeof n !== 'number') return '0';
      // Convertir a string con máximo de decimales
      let str = n.toFixed(maxDecimales);
      // Eliminar ceros finales
      str = str.replace(/\.?0+$/, '');
      // Reemplazar punto por coma (formato español)
      str = str.replace('.', ',');
      return str;
    }
  };

  // Init diferido: se crea el modal solo al abrir un desglose.

})();
