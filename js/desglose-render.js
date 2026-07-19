/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */


/** Renderizado y formateo del desglose de factura. */
(function() {
  'use strict';

  const round2 = (window.LF_CONFIG && typeof window.LF_CONFIG.round2 === 'function')
    ? window.LF_CONFIG.round2
    : (n) => Math.round(Number(n) * 100) / 100;
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


  const Desglose = window.__LF_DesgloseFactura = window.__LF_DesgloseFactura || {};
  Object.assign(Desglose, {
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
      const reqEl = this.modal.querySelector('.desglose-requisitos');
      if (reqEl) {
        if (datos.requisitos) {
          reqEl.textContent = datos.requisitos;
          reqEl.style.display = '';
        } else {
          reqEl.style.display = 'none';
        }
      }

      let html = '';
      const potenciaContratada = Math.max(safeNum(datos.potenciaP1), safeNum(datos.potenciaP2));
      const pvpcCoverage = d.isPVPC
        && datos.pvpcCoverage
        && ['exact', 'hybrid', 'average'].includes(datos.pvpcCoverage.mode)
        ? datos.pvpcCoverage
        : null;
      const impuestoInfo = (window.LF_CONFIG && typeof window.LF_CONFIG.getImpuestoInfo === 'function')
        ? window.LF_CONFIG.getImpuestoInfo(datos.zonaFiscal || 'Península', d.usoFiscal || 'otros', {
            fechaYmd: d.fechaYmd || datos.fechaYmd || datos.fechaFin || datos.fechaInicio,
            potenciaContratada
          })
        : null;
      const ieeInfo = (window.LF_CONFIG && typeof window.LF_CONFIG.desglosarIEE === 'function')
        ? window.LF_CONFIG.desglosarIEE(d.sumaBase, d.consumoTotalKwh || 0, d.fechaYmd || datos.fechaYmd || datos.fechaFin || datos.fechaInicio)
        : null;
      const ieeDetalle = ieeInfo
        ? (ieeInfo.aplicaMinimo
          ? `${this.fmtNum(ieeInfo.minimoEurosKwh, 3)} €/kWh × ${this.fmtNum(ieeInfo.consumoKwh)} kWh`
          : `${this.fmtNum(ieeInfo.porcentaje, 2)}% de ${this.fmt(d.sumaBase)}`)
        : `${this.fmtNum(window.LF_CONFIG.iee.porcentaje, 2)}% de ${this.fmt(d.sumaBase)}`;

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
      const _pvpcPot = window.LF_CONFIG?.peajesPotenciaPVPC ?? {};
      const diasCalc = safeNum(datos.dias);
      const rawPotP1 = d.isPVPC
        ? (safeNum(datos.potenciaP1) * (_pvpcPot.p1 ?? 0.075901) * diasCalc)
        : (safeNum(datos.potenciaP1) * diasCalc * safeNum(datos.precioP1));
      const rawPotP2 = d.isPVPC
        ? (safeNum(datos.potenciaP2) * (_pvpcPot.p2 ?? 0.001987) * diasCalc)
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
      const ssaaImporte = round2(safeNum(d.ssaa));
      const consumoBaseTarget = Number.isFinite(Number(d.consBase)) ? Number(d.consBase) : round2(safeNum(d.cons) - ssaaImporte);
      const [consP1Disp, consP2Disp, consP3Disp] = reconcileToTarget(consumoBaseTarget, [rawConsP1, rawConsP2, rawConsP3]);
      const consumoMostradoTarget = round2(safeNum(d.credit1 > 0 ? d.cons : d.consAdj));
      const pvpcHorario = pvpcCoverage && (pvpcCoverage.mode === 'exact' || pvpcCoverage.mode === 'hybrid');
      const ajusteHorario = pvpcHorario
        ? round2(consumoMostradoTarget - ssaaImporte - consP1Disp - consP2Disp - consP3Disp)
        : 0;
      const showAjusteHorario = Math.abs(ajusteHorario) > 0.05;

      // Calcular precio medio por kWh (antes de impuestos y compensación de excedentes)
      const consumoTotalKwh = safeNum(datos.consumoPunta) + safeNum(datos.consumoLlano) + safeNum(datos.consumoValle);
      const importeConsumoTotal = consP1Disp + consP2Disp + consP3Disp + ssaaImporte;
      // En PVPC exacto/híbrido, d.cons ya contiene el término variable horario completo
      // (incluidos sus componentes regulados). Las líneas P1/P2/P3 son solo referencias.
      const precioMedioPorKwh = consumoTotalKwh > 0
        ? (pvpcCoverage && (pvpcCoverage.mode === 'exact' || pvpcCoverage.mode === 'hybrid')
            ? safeNum(d.cons) / consumoTotalKwh
            : importeConsumoTotal / consumoTotalKwh)
        : 0;

      const pvpcCoverageHtml = (() => {
        if (!pvpcCoverage) return '';
        const hoursWithPrice = Math.max(0, safeNum(pvpcCoverage.hoursWithPrice));
        const hoursWithoutPrice = Math.max(0, safeNum(pvpcCoverage.hoursWithoutPrice));
        const totalHours = hoursWithPrice + hoursWithoutPrice;
        const missingKwhShareRaw = Number(pvpcCoverage.missingKwhShare);
        const missingKwhShare = Number.isFinite(missingKwhShareRaw)
          ? Math.min(1, Math.max(0, missingKwhShareRaw))
          : 0;
        const missingKwhPct = this.fmtNum(missingKwhShare * 100, 1);
        const referenceCopy = '<br><span class="desglose-ayuda-detalle">Los precios e importes P1/P2/P3 son referencias agregadas; la línea de ajuste recoge la diferencia con el cruce horario real del CSV.</span>';

        if (pvpcCoverage.mode === 'exact') {
          return `<div class="desglose-ayuda desglose-ayuda--pvpc-coverage">✅ <strong>Cobertura PVPC completa:</strong> se ha aplicado el precio horario del periodo a las ${this.fmtNum(hoursWithPrice, 0)} horas con consumo.${referenceCopy}</div>`;
        }
        if (pvpcCoverage.mode === 'hybrid') {
          return `<div class="desglose-ayuda desglose-ayuda--pvpc-coverage-warning">⚠️ <strong>Cobertura PVPC parcial:</strong> se ha aplicado el precio horario a ${this.fmtNum(hoursWithPrice, 0)} de ${this.fmtNum(totalHours, 0)} horas con consumo. Las ${this.fmtNum(hoursWithoutPrice, 0)} horas restantes (${missingKwhPct}% de la energía) se han estimado con la media P1/P2/P3 de su periodo.${referenceCopy}</div>`;
        }
        if (!pvpcCoverage.hasMissingPrices) {
          return '<div class="desglose-ayuda desglose-ayuda--pvpc-coverage">ℹ️ <strong>Cálculo PVPC por medias:</strong> el término de consumo se ha valorado con las medias P1/P2/P3 disponibles.</div>';
        }

        const fallbackReason = pvpcCoverage.fallbackReason
          ? ` ${escapeHtml(pvpcCoverage.fallbackReason)}`
          : '';
        return `<div class="desglose-ayuda desglose-ayuda--pvpc-coverage-warning">⚠️ <strong>Cobertura PVPC insuficiente:</strong> ${this.fmtNum(hoursWithoutPrice, 0)} de ${this.fmtNum(totalHours, 0)} horas con consumo no tenían precio disponible (${missingKwhPct}% de la energía). Todo el consumo se ha valorado con medias P1/P2/P3.${fallbackReason}</div>`;
      })();

      // ===== RESUMEN CLARO (Factura "perfecta") =====
      const solarOn = Boolean(datos.solarOn);
      const tipoComp = String(datos.tipoCompensacion || '');
      const exKwh = clampNonNeg(Number(datos.excedentes || 0));
      const precioComp = Number(datos.precioCompensacion || 0);
      const compensa = (solarOn && exKwh > 0 && precioComp > 0 && tipoComp !== 'NO COMPENSA');
      const creditoPotencial = compensa ? round2(exKwh * precioComp) : 0;
      // kWh de excedentes realmente usados vs sobrantes (más intuitivo que solo €)
      const kwhExUsados = (solarOn && precioComp > 0 && d.credit1 > 0) ? clampNonNeg(d.credit1 / precioComp) : 0;
      const kwhExBv = (solarOn && precioComp > 0 && d.excedenteSobranteEur > 0) ? clampNonNeg(d.excedenteSobranteEur / precioComp) : 0;
      const kwhExSobrantes = (solarOn && precioComp > 0 && exKwh > 0) ? clampNonNeg(exKwh - kwhExUsados) : 0;
      // Detectar compensación parcial (solo término de energía, sin peajes ni cargos)
      const esCompParcial = String(datos.topeCompensacion || '') === 'ENERGIA_PARCIAL';
      // Etiquetas de texto para la explicación de compensación
      const topeLabel = esCompParcial ? 'energía pura (sin peajes ni cargos)' : 'consumo de luz';
      const pagoMes = (typeof d.totalFinal === 'number') ? d.totalFinal : d.totalBase;
      const bvActiva = Boolean(datos.tieneBV) && String(datos.tipoCompensacion || '').includes('BV');

      // Buscar la tarifa para ver si es indexada
      const tarifaData = window.LF_CONFIG?.tarifas?.find(t => t.nombre === datos.nombreTarifa);
      const esIndexada = Boolean(datos.precioCompensacionIndexada) || tarifaData?.fv?.exc === -1;
      const esIndiceBase = esIndexada && datos.precioCompensacionSource === 'hourly-index-base';
      // Mostrar precio con menos decimales para mayor claridad (2 en lugar de 6)
      const precioLabel = esIndexada
        ? `${this.fmtNum(datos.precioCompensacion, 2)} €/kWh <span style="color:${esIndiceBase ? '#22c55e' : '#f59e0b'}">(${esIndiceBase ? 'índice base' : 'est.'})</span>`
        : `${this.fmtNum(datos.precioCompensacion, 2)} €/kWh`;

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
          ${d.costeBV > 0 ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Cuota BV</div>
            <div class="desglose-resumen-value">${this.fmt(d.costeBV)}</div>
          </div>` : ''}
          ${bvActiva && typeof d.bvSaldoFin === 'number' ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Saldo BV próximo mes</div>
            <div class="desglose-resumen-value">${this.fmt(d.bvSaldoFin)}</div>
          </div>` : ''}
          ${(d.credit1 > 0) ? `<div class="desglose-resumen-item">
            <div class="desglose-resumen-label">Compensación aplicada</div>
            <div class="desglose-resumen-value">${this.fmt(d.credit1)}</div>
            <div class="desglose-resumen-sub">${esCompParcial && d.baseCompensable > 0 ? `💡 <strong>Tope:</strong> Solo se puede compensar hasta ${this.fmt(d.baseCompensable)} (energía pura). De los ${this.fmt(d.cons)} de consumo, ${this.fmt(d.peajesTotal)} son peajes y cargos que no se pueden compensar.` : `💡 <strong>Tope legal:</strong> Solo se puede compensar hasta el coste del ${topeLabel} del mes.`}</div>
            ${(solarOn && precioComp > 0 && exKwh > 0) ? `<div class="desglose-resumen-sub">✅ Compensados: <strong>${this.fmtNum(kwhExUsados)}</strong> kWh${bvActiva && kwhExBv > 0 ? ` · 🔋 A batería virtual: <strong>${this.fmtNum(kwhExBv)}</strong> kWh` : (!bvActiva && kwhExSobrantes > 0 ? ` · ❌ Se pierden: <strong>${this.fmtNum(kwhExSobrantes)}</strong> kWh` : '')}</div>` : ''}
          </div>` : ''}
        </div>
        ${(d.credit1 > 0 && creditoPotencial > d.credit1) ? `<div class="desglose-resumen-note">
          ✅ Has generado <strong>${this.fmt(creditoPotencial)}</strong> en excedentes. Se compensan <strong>${this.fmt(d.credit1)}</strong> este mes (tope: ${topeLabel}). ${bvActiva && d.excedenteSobranteEur > 0 ? `Los <strong>${this.fmt(d.excedenteSobranteEur)}</strong> restantes se guardan en tu Batería Virtual para próximas facturas.` : (!bvActiva ? 'El resto no se puede compensar este mes.' : '')}
        </div>` : ''}
        ${esIndexada && solarOn ? `<div class="desglose-resumen-note desglose-resumen-note--nufri">
          ${esIndiceBase
            ? `ℹ️ <strong>Cálculo según índice base:</strong> el precio mostrado (${this.fmtNum(datos.precioCompensacion, 4)} €/kWh) sale de la curva horaria disponible. Es exacto solo si la fórmula comercial coincide con ese índice; si hay ajustes o costes de gestión, puede variar.`
            : `⚠️ <strong>Referencia orientativa:</strong> Esta tarifa paga excedentes a precio <strong>indexado</strong>. Sin curva horaria de vertido, el valor mostrado (${this.fmtNum(datos.precioCompensacion, 4)} €/kWh) no es un cálculo real; el importe depende de las horas exactas de vertido y de la fórmula comercial.`
          }
        </div>` : ''}
        ${esCompParcial && compensa ? (() => {
          const cpCons = d.cons || 0;
          const cpPeajes = d.peajesTotal || 0;
          const cpBase = d.baseCompensable || 0;
          const cpPct = cpCons > 0 ? Math.round(cpBase / cpCons * 100) : 0;
          const pc = window.LF_CONFIG?.peajesCargosEnergia || {};
          const cpP1 = round2(safeNum(datos.consumoPunta) * (pc.P1 || 0));
          const cpP2 = round2(safeNum(datos.consumoLlano) * (pc.P2 || 0));
          const cpP3 = round2(safeNum(datos.consumoValle) * (pc.P3 || 0));
          let cpMsg = `❗ <strong>Compensación parcial:</strong> Tu consumo cuesta ${this.fmt(cpCons)}, pero ${this.fmt(cpPeajes)} son peajes y cargos regulados. Esta tarifa solo compensa hasta ${this.fmt(cpBase)} (energía pura, ${cpPct}% del total).`;
          cpMsg += `<br><span style="opacity:0.8; font-size:0.92em;">Peajes: P1 ${this.fmtNum(datos.consumoPunta)} kWh × ${this.fmtPrecio(pc.P1)} = ${this.fmt(cpP1)} + P2 ${this.fmtNum(datos.consumoLlano)} kWh × ${this.fmtPrecio(pc.P2)} = ${this.fmt(cpP2)} + P3 ${this.fmtNum(datos.consumoValle)} kWh × ${this.fmtPrecio(pc.P3)} = ${this.fmt(cpP3)}</span>`;
          if (creditoPotencial > cpBase) {
            const cpPerdido = round2(creditoPotencial - cpBase);
            if (bvActiva) {
              cpMsg += `<br>Tus excedentes (${this.fmt(creditoPotencial)}) superan este límite. Los ${this.fmt(d.excedenteSobranteEur || cpPerdido)} no usados este mes pasan a tu Batería Virtual.`;
            } else {
              cpMsg += `<br>Tus excedentes (${this.fmt(creditoPotencial)}) superan este límite, perdiéndose ${this.fmt(cpPerdido)}.`;
            }
          } else {
            cpMsg += `<br>Tus excedentes (${this.fmt(creditoPotencial)}) caben dentro de este límite. Otras tarifas compensan contra el coste completo.`;
          }
          return `<div class="desglose-resumen-note desglose-resumen-note--te">${cpMsg}</div>`;
        })() : ''}
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
            <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × ${this.fmtNum(datos.precioP1, 6)} €/kW·día × ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(potP1Disp)}</span>
          </div>
          <div class="desglose-linea desglose-linea-sub">
            <span class="desglose-concepto">→ P2 (Valle)</span>
            <span class="desglose-detalle">${this.fmtNum(datos.potenciaP2)} kW × ${this.fmtNum(datos.precioP2, 6)} €/kW·día × ${datos.dias} días</span>
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
        ${showAjusteHorario ? `<div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Ajuste cálculo horario</span>
          <span class="desglose-detalle">Diferencia del cruce hora a hora frente a las medias P1/P2/P3</span>
          <span class="desglose-importe">${this.fmt(ajusteHorario)}</span>
        </div>` : ''}
        ${ssaaImporte > 0 ? `<div class="desglose-linea desglose-linea-sub">
          <span class="desglose-concepto">→ Servicios de ajuste</span>
          <span class="desglose-detalle">${this.fmtNum(consumoTotalKwh)} kWh × ${this.fmtPrecio(d.ssaaRate)} €/kWh${d.ssaaMonth ? ` (${escapeHtml(d.ssaaMonth)})` : ''}</span>
          <span class="desglose-importe">${this.fmt(ssaaImporte)}</span>
        </div>` : ''}
        ${pvpcCoverageHtml}
        ${d.credit1 > 0 ? `<div class="desglose-linea desglose-linea--hl-green">
          <span class="desglose-concepto">☀️ Compensación excedentes</span>
          <span class="desglose-detalle desglose-detalle--exced">  <span class="exced-item">Generados: <span class="nowrap">${this.fmtNum(datos.excedentes)} kWh</span>   <span class="nowrap">× ${precioLabel} = ${this.fmt(creditoPotencial)}</span></span>  <span class="exced-sep">·</span>  <span class="exced-item">✅ Compensados hoy: <span class="nowrap">${this.fmtNum(kwhExUsados)} kWh</span>   <span class="nowrap">(${this.fmt(d.credit1)})</span></span>  ${bvActiva && d.excedenteSobranteEur > 0 ? `<span class="exced-sep">·</span>  <span class="exced-item">🔋 A batería virtual: <span class="nowrap">${this.fmtNum(kwhExBv)} kWh</span>   <span class="nowrap">(${this.fmt(d.excedenteSobranteEur)})</span></span>` : (!bvActiva && kwhExSobrantes > 0 ? `<span class="exced-sep">·</span>  <span class="exced-item">❌ Se pierden (sin batería virtual): <span class="nowrap">${this.fmtNum(kwhExSobrantes)} kWh</span>   <span class="nowrap">(${this.fmt(d.excedenteSobranteEur)})</span></span>` : '')}</span>
          <span class="desglose-importe desglose-importe--pos">-${this.fmt(d.credit1)}</span>
        </div>
        <div class="desglose-linea">
          <span class="desglose-concepto"><strong>Consumo a pagar</strong></span>
          <span class="desglose-detalle"></span>
          <span class="desglose-importe"><strong>${this.fmt(d.consAdj)}</strong></span>
        </div>` : ''}
      </div>`;

      const otrosConceptosHeader = (d.isCanarias || d.isCeutaMelilla)
        ? (d.tarifaAdj + d.impuestoElec + (d.costeBV || 0) + (d.isPVPC && d.margen > 0 ? d.margen : 0) - (d.isPVPC ? d.bonoSocialDescuentoEur : 0))
        : (d.tarifaAdj + d.impuestoElec + d.alquilerContador + (d.costeBV || 0) + (d.isPVPC && d.margen > 0 ? d.margen : 0) - (d.isPVPC ? d.bonoSocialDescuentoEur : 0));

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
      const hayCosteBV = (d.costeBV || 0) > 0;
      if (hayCosteBV) otrosParts.push(d.costeBV);

      const otrosPartsDisp = reconcileToTarget(otrosTarget, otrosParts);
      let _oi = 0;
      const otrosFinDisp = otrosPartsDisp[_oi++] ?? 0;
      const otrosCompDisp = hayCompEnBonoSocial ? (otrosPartsDisp[_oi++] ?? 0) : null; // negativo
      const otrosMargenDisp = hayMargen ? (otrosPartsDisp[_oi++] ?? 0) : null;
      const otrosDescDisp = hayDescuentoBono ? (otrosPartsDisp[_oi++] ?? 0) : null; // negativo
      const otrosIeeDisp = otrosPartsDisp[_oi++] ?? 0;
      const otrosAlqDisp = hayAlquilerAqui ? (otrosPartsDisp[_oi++] ?? 0) : null;
      const otrosCosteBVDisp = hayCosteBV ? (otrosPartsDisp[_oi++] ?? 0) : null; // eslint-disable-line no-useless-assignment -- contador secuencial: mantener ++ por si se añaden más partes

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
          <span class="desglose-detalle">${this.fmtNum(datos.potenciaP1)} kW × ${this.fmtNum(datos.pvpcMargenUnitario, 6)} €/kW·día × ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(otrosMargenDisp || 0)}</span>
        </div>` : ''}
        ${bonoSocialLineaHtml}
        <div class="desglose-linea">
          <span class="desglose-concepto">Impuesto eléctrico</span>
          <span class="desglose-detalle">${ieeDetalle}</span>
          <span class="desglose-importe">${this.fmt(otrosIeeDisp)}</span>
        </div>
        ${hayAlquilerAqui ? `<div class="desglose-linea">
          <span class="desglose-concepto">Alquiler de contador (${this.fmtNum(window.LF_CONFIG.alquilerContador.eurosMes, 2)} €/mes)</span>
          <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(otrosAlqDisp || 0)}</span>
        </div>` : ''}
        ${hayCosteBV ? `<div class="desglose-linea">
          <span class="desglose-concepto">Cuota batería virtual (${this.fmtNum(d.precioBVMensual, 2)} €/mes)</span>
          <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
          <span class="desglose-importe">${this.fmt(otrosCosteBVDisp || 0)}</span>
        </div>` : ''}
      </div>`;

      if (d.isCanarias) {
        // ═══════════════════════════════════════════════════════════════
        // CANARIAS: IGIC
        // ═══════════════════════════════════════════════════════════════
        const igicEnergiaBase = (d.usoFiscal === 'vivienda') ? 0 : d.igicBase;
        const igicServicios = round2(d.impuestoServicios || 0);
        const igicTarget = round2(igicEnergiaBase + d.alquilerContador + d.igicContador + igicServicios);
        const [igicEnergiaDisp, igicAlqDisp, igicContDisp, igicServDisp] = reconcileToTarget(igicTarget, [igicEnergiaBase, d.alquilerContador, d.igicContador, igicServicios]);
        const igicEnergiaLabel = impuestoInfo?.energiaLabel || 'IGIC energía';
        const igicEnergiaPct = impuestoInfo?.energiaPctText || '3%';
        const igicContadorLabel = impuestoInfo?.contadorLabel || 'IGIC contador';
        const igicContadorPct = impuestoInfo?.contadorPctText || '7%';
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IMPUESTOS Y ALQUILER (IGIC)</h3><span class="desglose-importe-header">${this.fmt(igicTarget)}</span></div>
          ${d.usoFiscal === 'vivienda' ? `<div class="desglose-linea">
            <span class="desglose-concepto">${igicEnergiaLabel}</span>
            <span class="desglose-detalle">Exento (vivienda ≤10kW)</span>
            <span class="desglose-importe">0,00 €</span>
          </div>` : `<div class="desglose-linea">
            <span class="desglose-concepto">${igicEnergiaLabel} (${igicEnergiaPct})</span>
            <span class="desglose-detalle">${igicEnergiaPct} de ${this.fmt(d.baseEnergia + d.impuestoElec)}</span>
            <span class="desglose-importe">${this.fmt(igicEnergiaDisp)}</span>
          </div>`}
          <div class="desglose-linea">
            <span class="desglose-concepto">Alquiler de contador (${this.fmtNum(window.LF_CONFIG.alquilerContador.eurosMes, 2)} €/mes)</span>
            <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(igicAlqDisp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">${igicContadorLabel} (${igicContadorPct})</span>
            <span class="desglose-detalle">${igicContadorPct} de ${this.fmt(d.alquilerContador)}</span>
            <span class="desglose-importe">${this.fmt(igicContDisp)}</span>
          </div>
          ${d.costeBV > 0 ? `<div class="desglose-linea">
            <span class="desglose-concepto">IGIC servicios (${igicContadorPct})</span>
            <span class="desglose-detalle">${igicContadorPct} de ${this.fmt(d.costeBV)}</span>
            <span class="desglose-importe">${this.fmt(igicServDisp)}</span>
          </div>` : ''}
        </div>`;
      } else if (d.isCeutaMelilla) {
        // ═══════════════════════════════════════════════════════════════
        // CEUTA Y MELILLA: IPSI (Ley 8/1991)
        // ═══════════════════════════════════════════════════════════════
        const ipsiServicios = round2(d.impuestoServicios || 0);
        const ipsiTarget = round2(d.ipsiEnergia + d.alquilerContador + d.ipsiContador + ipsiServicios);
        const [ipsiEnergiaDisp, ipsiAlqDisp, ipsiContDisp, ipsiServDisp] = reconcileToTarget(ipsiTarget, [d.ipsiEnergia, d.alquilerContador, d.ipsiContador, ipsiServicios]);
        const ipsiEnergiaLabel = impuestoInfo?.energiaLabel || 'IPSI energía';
        const ipsiEnergiaPct = impuestoInfo?.energiaPctText || '1%';
        const ipsiContadorLabel = impuestoInfo?.contadorLabel || 'IPSI contador';
        const ipsiContadorPct = impuestoInfo?.contadorPctText || '4%';
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IMPUESTOS Y ALQUILER (IPSI)</h3><span class="desglose-importe-header">${this.fmt(ipsiTarget)}</span></div>
          <div class="desglose-linea">
            <span class="desglose-concepto">${ipsiEnergiaLabel} (${ipsiEnergiaPct})</span>
            <span class="desglose-detalle">${ipsiEnergiaPct} de ${this.fmt(d.baseIPSI)} (Ley 8/1991)</span>
            <span class="desglose-importe">${this.fmt(ipsiEnergiaDisp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">Alquiler de contador (${this.fmtNum(window.LF_CONFIG.alquilerContador.eurosMes, 2)} €/mes)</span>
            <span class="desglose-detalle">Prorrateado a ${datos.dias} días</span>
            <span class="desglose-importe">${this.fmt(ipsiAlqDisp)}</span>
          </div>
          <div class="desglose-linea">
            <span class="desglose-concepto">${ipsiContadorLabel} (${ipsiContadorPct})</span>
            <span class="desglose-detalle">${ipsiContadorPct} de ${this.fmt(d.alquilerContador)}</span>
            <span class="desglose-importe">${this.fmt(ipsiContDisp)}</span>
          </div>
          ${d.costeBV > 0 ? `<div class="desglose-linea">
            <span class="desglose-concepto">IPSI servicios (${ipsiContadorPct})</span>
            <span class="desglose-detalle">${ipsiContadorPct} de ${this.fmt(d.costeBV)}</span>
            <span class="desglose-importe">${this.fmt(ipsiServDisp)}</span>
          </div>` : ''}
        </div>`;
      } else {
        // ═══════════════════════════════════════════════════════════════
        // PENÍNSULA Y BALEARES: IVA
        // ═══════════════════════════════════════════════════════════════
        const ivaLabel = impuestoInfo?.energiaLabel || 'IVA';
        const ivaPct = impuestoInfo?.energiaPctText
          || (window.LF_CONFIG && typeof window.LF_CONFIG.getImpuestoInfo === 'function'
            ? window.LF_CONFIG.getImpuestoInfo(datos.zonaFiscal || 'Península', d.usoFiscal || 'iva_general', {
                fechaYmd: d.fechaYmd || datos.fechaFin || datos.fechaInicio,
                potenciaContratada
              })?.energiaPctText
            : null)
          || '0%';
        html += `<div class="desglose-seccion">
          <div class="desglose-seccion-header"><h3>💰 IVA</h3><span class="desglose-importe-header">${this.fmt(d.iva)}</span></div>
          <div class="desglose-linea">
            <span class="desglose-concepto">${ivaLabel} (${ivaPct})</span>
            <span class="desglose-detalle">${ivaPct} de ${this.fmt(d.ivaBase)}</span>
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
      // innerHTML seguro: los datos dinámicos pasan por escapeHtml() o formateadores numéricos locales.
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
  });

})();
