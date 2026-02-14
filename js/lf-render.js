// ===== LuzFija: Renderizado =====
// Tabla, chart, KPIs, filtros, ordenación
// OPTIMIZADO PARA INP: Renderizado chunked de tabla (v2026-01-09)

(function() {
  'use strict';

  const {
    el, state, $,
    escapeHtml, formatMoney,
    setStatus, animateCounter, createSuccessParticles,
    initTooltips, bindTooltipElement
  } = window.LF;

  // ===== BADGES =====
  function rowTipoBadge(t) {
    const s = String(t || '').trim();
    if (s === '1P') return `<span class="badge b1">1P</span>`;
    if (s === '3P') return `<span class="badge b3">3P</span>`;
    return `<span class="badge">${escapeHtml(s || '—')}</span>`;
  }

  function formatVsWithBar(v, vn) {
    const s = String(v ?? '').trim();
    if (!s || s === '—' || s === '0' || s === '0,00' || s === '0 €' || s === '0,00 €') {
      return '<span class="vs-text zero">—</span>';
    }
    const pos = s.startsWith('+');
    const c = pos ? 'pos' : 'neg';
    return `<span class="vs-text ${c}">${escapeHtml(s)}</span>`;
  }

  // ===== URL SAFE =====
  // Acepta solo http/https o rutas relativas (/, ./, ../). Bloquea esquemas peligrosos.
  function safeUrl(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '';

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

  // ===== FILTROS Y ORDENACIÓN =====
  function applyFilters(r) {
    const f = state.filter;
    return r.filter(x => (f === 'all' || String(x.tipo || '') === f));
  }

  function applySort(r) {
    const { key, dir } = state.sort;
    const asc = dir === 'asc';
    const c = r.slice();
    
    c.sort((a, b) => {
      const va = a[key], vb = b[key];
      
      if (key === 'nombre') {
        const sa = String(va || '').toLowerCase(), sb = String(vb || '').toLowerCase();
        if (sa > sb) return asc ? 1 : -1;
        if (sa < sb) return asc ? -1 : 1;
        return 0;
      }
      
      const na = Number(va) || 0, nb = Number(vb) || 0;
      if (na > nb) return asc ? 1 : -1;
      if (na < nb) return asc ? -1 : 1;

      // Desempate
      if (key === 'totalNum') {
        const paA = Number(a.fvTotalFinal) || Number(a.totalNum) || 0;
        const paB = Number(b.fvTotalFinal) || Number(b.totalNum) || 0;
        if (paA !== paB) return asc ? (paA - paB) : (paB - paA);
      }

      return 0;
    });
    
    return c;
  }

  function updateSortIcons() {
    ['nombre', 'potenciaNum', 'consumoNum', 'impuestosNum', 'totalNum', 'vsMejorNum'].forEach(k => {
      const i = $('si_' + k);
      const th = document.querySelector(`th[data-sort="${k}"]`);
      if (!i || !th) return;
      
      if (state.sort.key !== k) {
        i.textContent = '';
        th.setAttribute('aria-sort', 'none');
        return;
      }
      
      i.textContent = state.sort.dir === 'asc' ? '▲' : '▼';
      th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    });
  }

  // ===== RENDER TABLE OPTIMIZADO (CHUNKED + SEGURO) =====
  let __lf_tableRenderTimer = null;
  let __lf_renderInProgress = false;
  let __lf_currentRenderToken = 0;

  async function renderTable() {
    const f = applyFilters(state.rows);
    // Filtrar PVPC no computable (potencia > 10 kW)
    const fFiltered = f.filter(r => !r.pvpcNotComputable);
    const s = applySort(fFiltered);

    if (s.length === 0) {
      el.tbody.replaceChildren();
      el.table.classList.remove('show');
      el.emptyBox.classList.add('show');
      return;
    }

    clearTimeout(__lf_tableRenderTimer);
    
    // SEGURIDAD: Cancelar render anterior si existe
    if (__lf_renderInProgress) {
      __lf_currentRenderToken++;
      __lf_renderInProgress = false;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    const myToken = ++__lf_currentRenderToken;
    __lf_renderInProgress = true;

    // OPTIMIZACIÓN INP: Renderizar en chunks de 10 filas
    const CHUNK_SIZE = 10;
    
    el.emptyBox.classList.remove('show');
    el.table.classList.add('show');

    // --- PRE-CÁLCULO VALIDACIÓN NUFRI ---
    // Obtenemos valores del DOM para calcular si se cumplen requisitos
    const domP1 = document.getElementById('p1');
    const valP1 = domP1 ? window.LF.parseNum(domP1.value) : 0;
    const domP2 = document.getElementById('p2');
    const valP2 = domP2 ? window.LF.parseNum(domP2.value) : 0;
    const domDias = document.getElementById('dias');
    const valDias = domDias ? window.LF.parseNum(domDias.value) : 30;
    const domC1 = document.getElementById('cPunta');
    const domC2 = document.getElementById('cLlano');
    const domC3 = document.getElementById('cValle');
    const valC1 = domC1 ? window.LF.parseNum(domC1.value) : 0;
    const valC2 = domC2 ? window.LF.parseNum(domC2.value) : 0;
    const valC3 = domC3 ? window.LF.parseNum(domC3.value) : 0;
    const valConsumoTotal = valC1 + valC2 + valC3;
    
    // Proyección anual
    const diasCalc = valDias > 0 ? valDias : 30;
    const consumoAnualEst = (valConsumoTotal / diasCalc) * 365;
    const potRef = Math.max(valP1, valP2);
    // Límite Ratio: 0.75 MWh/kW = 750 kWh/kW
    const limiteRatio = potRef * 750;
    const limiteAbs = 8000;
    // Flag global para Nufri en este render
    const nufriExcede = (consumoAnualEst > limiteRatio || consumoAnualEst > limiteAbs);

    // Limpiar tbody existente
    el.tbody.replaceChildren();

    // Renderizar en chunks con yields
    for (let chunkStart = 0; chunkStart < s.length; chunkStart += CHUNK_SIZE) {
      // Verificar si este render fue cancelado
      if (myToken !== __lf_currentRenderToken || !__lf_renderInProgress) {
        return;
      }

      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, s.length);
      const frag = document.createDocumentFragment();
      
      for (let idx = chunkStart; idx < chunkEnd; idx++) {
        const r = s[idx];
        const tr = document.createElement('tr');
        if (r.esMejor) tr.classList.add('best');
        if (r.esPersonalizada) tr.classList.add('custom-tariff-highlight');

        const nombreBase = r.nombre || '';
        tr.dataset.tarifaNombre = nombreBase;
        tr.dataset.esPvpc = r.esPVPC ? '1' : '0';
        
        // --- AVISO COMPENSACIÓN PARCIAL (tope ENERGIA_PARCIAL) ---
        let compParcialIcon = '';
        if (r.fvTope === 'ENERGIA_PARCIAL') {
          const bc = Number(r.fvBaseCompensable) || 0;
          const pt = Number(r.fvPeajesTotal) || 0;
          const consBruto = Math.round((Number(r.consumoNum) + Number(r.fvCredit1 || 0)) * 100) / 100;
          const pctPura = consBruto > 0 ? Math.round(bc / consBruto * 100) : 0;

          let cpTip = `❗ COMPENSACIÓN PARCIAL\n\n`;
          if (bc > 0 && pt > 0) {
            cpTip += `Tu consumo cuesta ${consBruto.toFixed(2)} €.\n`;
            cpTip += `De eso, ${pt.toFixed(2)} € son peajes y cargos regulados.\n\n`;
            cpTip += `Solo se puede compensar sobre ${bc.toFixed(2)} € de energía pura (${pctPura}% del total).\n\n`;
          } else {
            cpTip += `Esta tarifa solo compensa sobre el coste de la energía sin peajes ni cargos.\n\n`;
          }
          cpTip += `El cálculo mostrado ya refleja esta limitación.`;
          compParcialIcon = `<span class="tooltip te-warn-icon" data-tip="${escapeHtml(cpTip)}" role="button" tabindex="0" aria-label="Aviso compensación parcial" style="margin-left:4px; color:var(--danger); cursor:help; font-size:1.1em;">❗</span>`;
        }

        // --- VALIDACIÓN NUFRI IN-LINE (ICONO) ---
        let nufriWarnIcon = '';
        if (nufriExcede && nombreBase.toLowerCase().includes('nufri')) {
          const tipText = `⚠️ REQUISITOS NUFRI (Límites superados)\n\nTu consumo estimado (~${Math.round(consumoAnualEst).toLocaleString('es-ES')} kWh/año) supera los límites teóricos para esta tarifa:\n\n• Máximo por potencia: ${Math.round(limiteRatio).toLocaleString('es-ES')} kWh\n• Máximo absoluto: 8.000 kWh\n\nNo obstante, se aconseja intentar la contratación si te interesa. Será la propia compañía quien confirme la validez final durante el proceso.`;
          nufriWarnIcon = `<span class="tooltip nufri-icon" data-tip="${escapeHtml(tipText)}" role="button" tabindex="0" aria-label="Advertencia requisitos Nufri" style="margin-left:4px; color:var(--danger); cursor:help; font-size:1.1em;">⚠️</span>`;
        }

        // Guardar metaPvpc para desglose si es PVPC
        if (r.esPVPC && r.metaPvpc) {
          tr.dataset.metaPvpc = JSON.stringify(r.metaPvpc);
        }

        const safeWebUrl = safeUrl(r.webUrl);
        const w = safeWebUrl && safeWebUrl !== '#'
          ? `<a class="web" href="${escapeHtml(safeWebUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir web" aria-label="Abrir oferta de ${escapeHtml(nombreBase)}">` +
            `<span class="web-icon" aria-hidden="true">🔗</span>` +
            `<span class="web-text">Ver oferta</span>` +
            `</a>`
          : r.esPersonalizada ? '' : '';

        const nombreWarn = r.pvpcNotComputable
          ? `<span class="pvpc-warn" title="PVPC no disponible para esta configuración">⚠</span>`
          : (r.pvpcWarning ? ' ⚠' : '');

        const requisitosTooltip = r.requisitos
          ? `<span class="tooltip requisitos-icon" data-tip="${escapeHtml(r.requisitos)}" role="button" tabindex="0" aria-label="Requisitos de contratación" style="margin-left:4px; color:var(--warn); cursor:help;">i</span>`
          : '';

        // FV Icon
        let fvIcon = '';
        let solarDetails = '';
        const precioExc = Number(r.fvPriceUsed || 0);
        const exKwh = Number(r.fvExKwh || 0);
        const credit1 = Number(r.fvCredit1 || 0);
        const credit2 = Number(r.fvCredit2 || 0);
        const bvSaldoFin = r.fvBvSaldoFin;
        const excSobrante = Number(r.fvExcedenteSobrante || 0);

        const isBV = r.fvTipo && r.fvTipo.includes('BV');
        const totalFinal = Number(r.fvTotalFinal) || Number(r.totalNum) || 0;
        const totalRanking = Number(r.totalNum) || 0;
        const bvPagasFmt = formatMoney(totalFinal);
        const bvRankingFmt = formatMoney(totalRanking);

        if (r.fvApplied && credit1 > 0) {
          const parts = [];
          
          if (isBV && (credit2 > 0 || bvSaldoFin !== null)) {
            parts.push(`💰 Pagas este mes: ${bvPagasFmt} (usando BV acumulada)`);
            parts.push(`🏆 Ranking (coste real): ${bvRankingFmt} (sin BV del pasado)`);
            
            if (bvSaldoFin !== null && bvSaldoFin !== undefined) {
              parts.push(`🔋 Saldo BV final: ${Number(bvSaldoFin).toFixed(2)} € (disponible para el próximo mes)`);
            }
            
            parts.push(`---`);
          }
          
          parts.push(`☀️ Excedentes vertidos: ${exKwh.toFixed(2)} kWh`);
          parts.push(`💰 Precio compensación: ${precioExc.toFixed(3)} €/kWh`);
          parts.push(`✅ Compensado este mes: ${credit1.toFixed(2)} € (descontado de tu consumo de energía)`);
          if (credit2 > 0) parts.push(`🔋 BV usada: ${credit2.toFixed(2)} € (ahorros de meses anteriores aplicados ahora)`);
          
          const tip = parts.join('\n');
          fvIcon = `<span class="tooltip fv-icon fv-ranking" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Detalle FV y Ranking">☀️</span>`;
          solarDetails = `<div class="solar-details">☀️ ${escapeHtml(parts.join(' • '))}</div>`;
        } else if (bvSaldoFin !== null && bvSaldoFin !== undefined && r.fvTipo && r.fvTipo.includes('BV')) {
          const parts = [];
          if (credit2 > 0) parts.push(`🔋 BV usada: ${credit2.toFixed(2)} € (ahorros de meses anteriores aplicados ahora)`);
          parts.push(`🔋 Saldo BV final: ${Number(bvSaldoFin).toFixed(2)} € (disponible para el próximo mes)`);
          const tip = parts.join('\n');
          fvIcon = `<span class="tooltip fv-icon" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Detalle BV">🔋</span>`;
          solarDetails = `<div class="solar-details">🔋 ${escapeHtml(parts.join(' • '))}</div>`;
        }

        const icons = `<span class="tarifa-icons">${fvIcon || ""}${compParcialIcon || ""}${requisitosTooltip || ""}${nombreWarn || ""}${nufriWarnIcon || ""}</span>`;

        const badgeRow = `<div class="tarifa-badges" aria-hidden="true">` +
          `<span class="badge rank">#${idx + 1}</span>` +
          `${rowTipoBadge(r.tipo)}` +
          `</div>`;

        const nombreDisplay =
          `${badgeRow}` +
          `<div class="tarifa-title">` +
          `<span class="tarifa-nombre">${escapeHtml(nombreBase)}</span>` +
          `${icons}` +
          `</div>` +
          `${solarDetails || ""}`;

        tr.innerHTML =
          `<td>${idx + 1}</td>` +
          `<td class="tarifa-cell" title="${escapeHtml(nombreBase)}" role="button" tabindex="0" aria-label="Ver desglose de ${escapeHtml(nombreBase)}">${nombreDisplay}</td>` +
          `<td>${escapeHtml(r.potencia)}</td>` +
          `<td>${escapeHtml(r.consumo)}</td>` +
          `<td>${escapeHtml(r.impuestos)}</td>` +
          `<td class="total-cell" role="button" tabindex="0" title="${isBV ? `Clic para ver desglose completo • Pagas: ${escapeHtml(bvPagasFmt)} • Ranking: ${escapeHtml(bvRankingFmt)}` : `Clic para ver desglose completo de la factura`}"><span class="total-pill"><strong class="total-price js-total-amount"${isBV ? ` data-pagas="${escapeHtml(bvPagasFmt)}" data-ranking="${escapeHtml(bvRankingFmt)}"` : ""}>${escapeHtml(r.total)}</strong><span class="desglose-icon" aria-hidden="true">💡</span></span></td>` +
          `<td>${formatVsWithBar(r.vsMejor, r.vsMejorNum)}</td>` +
          `<td style="text-align:center">${rowTipoBadge(r.tipo)}</td>` +
          `<td style="text-align:center">${w}</td>`;

        frag.appendChild(tr);
      }

      el.tbody.appendChild(frag);

      // Yield al navegador después de cada chunk (excepto el último)
      if (chunkEnd < s.length) {
        await window.LF.yieldControl();
      }
    }

    // Verificar una última vez antes de finalizar
    if (myToken !== __lf_currentRenderToken) {
      return;
    }

    __lf_renderInProgress = false;

    // Diferir binding de tooltips al siguiente frame (INP: no bloquear tras render)
    requestAnimationFrame(() => {
      if (myToken !== __lf_currentRenderToken) return;
      el.tbody.querySelectorAll('.te-warn-icon').forEach(t => bindTooltipElement(t));
      el.tbody.querySelectorAll('.requisitos-icon').forEach(t => bindTooltipElement(t));
      el.tbody.querySelectorAll('.fv-icon').forEach(t => bindTooltipElement(t));
      el.tbody.querySelectorAll('.nufri-icon').forEach(t => bindTooltipElement(t));
      updateSortIcons();
    });
  }

  // ===== RENDER TOP CHART =====
  function renderTopChart() {
    const c = document.getElementById('chartTop');
    const body = document.getElementById('chartTopBody');
    if (!c || !body) return;

    const rows = (state.rows || []).filter(r => !r.pvpcNotComputable && r.total !== '—');
    if (!rows.length) {
      c.classList.remove('show');
      body.innerHTML = '';
      return;
    }

    const sorted = rows.slice().sort((a, b) => a.totalNum - b.totalNum).slice(0, 5);
    const max = sorted[sorted.length - 1].totalNum || 1;

    const frag = document.createDocumentFragment();
    sorted.forEach((r, idx) => {
      const row = document.createElement('div');
      row.className = 'chartTop-row';
      if (idx === 0) row.classList.add('best');

      const pct = Math.max(5, Math.round((r.totalNum / max) * 100));

      row.innerHTML = `
        <div class="chartTop-name" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre)}</div>
        <div class="chartTop-barTrack"><div class="chartTop-barFill" data-width="${pct}%"></div></div>
        <div class="chartTop-value">${escapeHtml(r.total || '')}</div>
      `;
      frag.appendChild(row);
    });

    body.replaceChildren(frag);
    c.style.display = '';
    c.classList.add('show');

    requestAnimationFrame(() => {
      body.querySelectorAll('.chartTop-barFill').forEach(bar => {
        const w = bar.getAttribute('data-width') || '0%';
        bar.style.width = w;
      });
    });
  }

  // ===== RENDER PVPC INFO =====
  function renderPvpcInfo() {
    const div = el.pvpcInfo;
    if (!div) return;

    const warningEl = document.getElementById('pvpc-warning-canarias-potencia');
    if (warningEl) {
      warningEl.style.display = window.pvpcPotenciaExcedida ? 'block' : 'none';
    }

    if (!window.pvpcLastMeta) {
      div.style.display = 'none';
      div.textContent = '';
      return;
    }

    const fmt = (n) => {
      if (!Number.isFinite(n)) return '—';
      let s = n.toFixed(6);
      s = s.replace(/0+$/, '').replace(/\.$/, '');
      s = s.replace('.', ',');
      return `${s} €/kWh`;
    };

    const rango = window.pvpcLastMeta.rangoFechas ? `Periodo oficial: ${window.pvpcLastMeta.rangoFechas.inicio} - ${window.pvpcLastMeta.rangoFechas.fin}` : '';
    const fecha = window.pvpcLastMeta.fechaConsulta ? new Date(window.pvpcLastMeta.fechaConsulta) : null;

    const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    const fechaTxt = fecha ? fecha.toLocaleString('es-ES', dateOptions) : '-';

    div.style.display = 'block';
    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:900; color:var(--text); font-size:13px;">
          PVPC (tarifa regulada)
	          <span class="tooltip"
	                data-tip="Fuente: REE/ESIOS (indicador PVPC 1001). Proyecto independiente (no afiliado). El PVPC mostrado es una estimación orientativa basada en tus datos y en medias horarias por periodo; puede diferir de la CNMC por perfiles de consumo y redondeos."
                role="button"
                tabindex="0"
                aria-label="Información sobre PVPC">
            i
          </span>
        </div>
        <div style="font-size:11px; color:var(--muted2);">${escapeHtml(fechaTxt)}</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-top:8px;">
        <div style="display:flex; flex-direction:column; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); padding:6px 10px; border-radius:8px;">
          <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(239,68,68,1); font-weight:800;">Punta (P1)</span>
          <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(window.pvpcLastMeta.precioPunta)}</span>
        </div>
        <div style="display:flex; flex-direction:column; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); padding:6px 10px; border-radius:8px;">
          <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(245,158,11,1); font-weight:800;">Llano (P2)</span>
          <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(window.pvpcLastMeta.precioLlano)}</span>
        </div>
        <div style="display:flex; flex-direction:column; background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.3); padding:6px 10px; border-radius:8px;">
          <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(34,197,94,1); font-weight:800;">Valle (P3)</span>
          <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(window.pvpcLastMeta.precioValle)}</span>
        </div>
      </div>
      ${rango ? `<div style="margin-top:8px; font-size:11px; color:var(--muted2); text-align:right;">${escapeHtml(rango)}</div>` : ''}
    `;
    
    initTooltips();
  }

  // ===== RENDER SUN CLUB CARD =====
  function renderSunClubCard() {
    // Limpiar tarjeta anterior si existe
    const oldCard = document.querySelector('.sun-club-card');
    if (oldCard) oldCard.remove();

    const result = window.LF?.sunClubResult;
    if (!result) return;

    const card = document.createElement('div');
    card.className = 'sun-club-card';

    // Caso especial: tarifa no disponible en territorio
    if (result.unavailable) {
      card.innerHTML = `
        <h3>⚡ Octopus Sun Club (cálculo especial)</h3>
        <div class="sun-club-badge">📊 Calculado con tu CSV real</div>

        <div class="sun-club-unavailable">
          ${escapeHtml(result.message || 'Sun Club no disponible en tu territorio')}
        </div>

        ${result.web ? `
          <a href="${escapeHtml(result.web)}" target="_blank" rel="noopener" class="sun-club-link">
            🔗 Más información sobre Sun Club
          </a>
        ` : ''}
      `;

      const seccionResultados = document.getElementById('seccionResultados');
      if (seccionResultados) seccionResultados.appendChild(card);
      return;
    }

    card.innerHTML = `
      <h3>⚡ Octopus Sun Club (cálculo especial)</h3>
      <div class="sun-club-badge">📊 Calculado con tu CSV real</div>

      <div class="sun-club-info">
        <div class="sun-club-row">
          <span>💶 A pagar este mes:</span>
          <strong>${formatMoney(result.aPagar)}</strong>
        </div>
        <div class="sun-club-row">
          <span>💰 Crédito mes siguiente:</span>
          <strong>${formatMoney(result.credito)}</strong>
        </div>
        <div class="sun-club-detail">
          45% descuento sobre ${result.kwhSolares.toFixed(1)} kWh consumidos 12-18h
          (${result.pctSolares.toFixed(1)}% de tu consumo total de ${result.kwhTotal.toFixed(1)} kWh)
        </div>
        <div class="sun-club-note">
          ⚠️ Sun Club no es compatible con compensación de excedentes (Solar Wallet).
        </div>
        <div class="sun-club-breakdown">
          <div class="sun-club-breakdown-title">Desglose del mes:</div>
          <div class="sun-club-breakdown-row">
            <span>Potencia:</span>
            <span>${formatMoney(result.potencia)}</span>
          </div>
          <div class="sun-club-breakdown-row">
            <span>Consumo energía:</span>
            <span>${formatMoney(result.consumo)}</span>
          </div>
          <div class="sun-club-breakdown-row">
            <span>Impuestos:</span>
            <span>${formatMoney(result.impuestos)}</span>
          </div>
        </div>
        <a href="${escapeHtml(result.web)}" target="_blank" rel="noopener" class="sun-club-link">
          🔗 Más información sobre Sun Club
        </a>
      </div>
    `;

    // Insertar después de la sección de resultados
    const seccionResultados = document.getElementById('seccionResultados');
    if (seccionResultados) {
      seccionResultados.appendChild(card);
    }
  }

  // ===== RENDER ALL =====
  function renderAll(d) {
    if (!d || !d.success) {
      setStatus('Error de cálculo', 'err');
      window.LF.toast('Error al calcular', 'err');
      return;
    }
    
    state.pending = false;
    setStatus('Resultados actualizados', 'ok');

    const r = d.resumen || {};
    if (r.mejor) animateCounter(el.kpiBest, r.mejor);
    if (r.precio) animateCounter(el.kpiPrice, r.precio);

    const seoFold = document.getElementById('info');
    if (seoFold) seoFold.classList.add('show');
    el.heroKpis.classList.add('show');
    createSuccessParticles(el.heroKpis);

    // Mostrar sección de resultados
    const seccionResultados = document.getElementById('seccionResultados');
    const esPrimeraVez = seccionResultados && !seccionResultados.classList.contains('visible');
    if (seccionResultados && esPrimeraVez) {
      seccionResultados.classList.add('visible');

      const gridContainer = document.querySelector('.grid');
      if (gridContainer) {
        gridContainer.classList.add('has-results');
      }

      setTimeout(() => {
        seccionResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }

    const s = d.stats;
    if (s) {
      el.statMin.textContent = s.precioMin;
      el.statAvg.textContent = s.precioMedio;
      el.statMax.textContent = s.precioMax;
      el.statsBar.classList.add('show');
    }

    state.rows = Array.isArray(d.resultados) ? d.resultados : [];
    el.toolbar.classList.add('show');

    renderTopChart();
    renderPvpcInfo();
    
    // Esperar a que la tabla termine de renderizarse antes de Sun Club
    renderTable().then(() => {
      renderSunClubCard();
    });

    if (window.innerWidth < 1100) {
      const sb = $('scrollToResults');
      sb.style.display = 'block';
      setTimeout(() => sb.style.display = 'none', 5000);
    }
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    rowTipoBadge,
    formatVsWithBar,
    applyFilters,
    applySort,
    updateSortIcons,
    renderTable,
    renderTopChart,
    renderPvpcInfo,
    renderSunClubCard,
    renderAll,
    cancelRender: () => {
      __lf_renderInProgress = false;
    }
  });

  window.renderTable = renderTable;
  window.renderAll = renderAll;
  window.updateSortIcons = updateSortIcons;

})();
