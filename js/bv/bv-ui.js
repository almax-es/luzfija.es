window.BVSim = window.BVSim || {};

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (window.LF?.isDebugMode?.()) console.log('BVSim: Initializing UI...');
  } catch {}

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('bv-file');
  const fileNameDisplay = document.getElementById('file-name');
  const fileSelectedMsg = document.getElementById('file-selected-msg');
  const removeFileBtn = document.getElementById('remove-file');
  
  const p1Input = document.getElementById('bv-p1');
  const p2Input = document.getElementById('bv-p2');
  const saldoInput = document.getElementById('bv-saldo-inicial');
  const zonaFiscalInput = document.getElementById('bv-zona-fiscal');
  const viviendaCanariasWrapper = document.getElementById('bv-vivienda-canarias-wrapper');
  const viviendaCanariasInput = document.getElementById('bv-vivienda-canarias');
  
  const simulateButton = document.getElementById('bv-simulate');
  const resultsContainer = document.getElementById('bv-results-container');
  const resultsEl = document.getElementById('bv-results');
  const statusContainer = document.getElementById('bv-status-container');
  const statusEl = document.getElementById('bv-status');

  // Toast (ya existe en el HTML)
  const toastEl = document.getElementById('toast');
  const toastTextEl = document.getElementById('toastText');
  const toastDotEl = document.getElementById('toastDot');
  let toastTimer = null;

  function showToast(message, type = 'info') {
    if (!toastEl || !toastTextEl) return;
    toastTextEl.textContent = String(message || '');
    if (toastDotEl) {
      toastDotEl.classList.remove('ok', 'err');
      if (type === 'ok') toastDotEl.classList.add('ok');
      if (type === 'err') toastDotEl.classList.add('err');
    }
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 4200);
  }

  // --- UI INITIALIZATION ---
  const btnTheme = document.getElementById('btnTheme');
  const btnMenu = document.getElementById('btnMenu');
  const menuPanel = document.getElementById('menuPanel');

  function updateThemeUI() {
    const isLight = document.documentElement.classList.contains('light-mode');
    if (btnTheme) btnTheme.textContent = isLight ? '🌙' : '☀️';
  }

  if (btnTheme && !btnTheme.dataset.bvBound) {
    btnTheme.dataset.bvBound = '1';
    btnTheme.addEventListener('click', (e) => {
      e.preventDefault();
      const isLight = document.documentElement.classList.toggle('light-mode');
      try { localStorage.setItem('almax_theme', isLight ? 'light' : 'dark'); } catch {}
      updateThemeUI();
    });
    updateThemeUI();
  }

  if (btnMenu && menuPanel && !btnMenu.dataset.bvBound) {
    btnMenu.dataset.bvBound = '1';
    btnMenu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isShow = menuPanel.classList.toggle('show');
      btnMenu.setAttribute('aria-expanded', String(isShow));
    });
  }

  document.addEventListener('click', (e) => {
    const clearBtn = e.target.closest('#btnClearCache');
    if (clearBtn) {
      try { localStorage.clear(); } catch {}
      location.reload();
      return;
    }
    if (menuPanel && menuPanel.classList.contains('show')) {
      if (!menuPanel.contains(e.target)) {
        menuPanel.classList.remove('show');
        if (btnMenu) btnMenu.setAttribute('aria-expanded', 'false');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuPanel?.classList.contains('show')) {
      menuPanel.classList.remove('show');
      if (btnMenu) btnMenu.setAttribute('aria-expanded', 'false');
    }
  });

  if (zonaFiscalInput) {
    zonaFiscalInput.addEventListener('change', () => {
      if (viviendaCanariasWrapper) {
        viviendaCanariasWrapper.style.display = zonaFiscalInput.value === 'Canarias' ? 'block' : 'none';
      }
    });
  }

  // Formateadores ES
  const currencyFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kwFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kwhFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const priceFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 6 });

  const fEur = (v) => currencyFmt.format(Number(v) || 0);
  const fKw = (v) => kwFmt.format(Number(v) || 0);
  const fKwh = (v) => kwhFmt.format(Number(v) || 0);
  const fPrice = (v) => priceFmt.format(Number(v) || 0);

  function parseInput(val) {
    if (val === undefined || val === null || val === '') return 0;
    if (window.LF?.parseNum) return window.LF.parseNum(val);
    const normalized = String(val).trim().replace(',', '.');
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  const escapeHtml = (window.LF?.escapeHtml) ? window.LF.escapeHtml : (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const escapeAttr = (v) => escapeHtml(v).replace(/\n/g, '&#10;');

  function sanitizeUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(String(url), document.baseURI);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
      // Permite rutas relativas same-origin
      if (u.origin === location.origin) return u.toString();
    } catch {}
    return '';
  }

  // --- SISTEMA DE TOOLTIPS FLOTANTES ---
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'bv-floating-tooltip';
  document.body.appendChild(tooltipEl);

  const updateTooltipPosition = (target) => {
    const tip = target.getAttribute('data-tip');
    if (!tip) return;
    
    tooltipEl.textContent = tip;
    tooltipEl.style.display = 'block';
    
    const rect = target.getBoundingClientRect();
    const ttWidth = tooltipEl.offsetWidth;
    const ttHeight = tooltipEl.offsetHeight;
    
    let top = rect.top - ttHeight - 10;
    let left = rect.left + (rect.width / 2) - (ttWidth / 2);
    
    if (top < 10) top = rect.bottom + 10; 
    if (left < 10) left = 10;
    if (left + ttWidth > window.innerWidth - 10) left = window.innerWidth - ttWidth - 10;

    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
  };

  document.addEventListener('mouseover', (e) => {
    const trigger = e.target.closest('.bv-tooltip-trigger');
    if (trigger) updateTooltipPosition(trigger);
  });

  document.addEventListener('mouseout', (e) => {
    const trigger = e.target.closest('.bv-tooltip-trigger');
    if (trigger) tooltipEl.style.display = 'none';
  });

  window.addEventListener('scroll', () => { tooltipEl.style.display = 'none'; }, { passive: true });

  if (!fileInput || !simulateButton) return;

  function handleFile(file) {
    if (!file) return;
    window.BVSim.file = file;
    if (fileNameDisplay) fileNameDisplay.textContent = file.name;
    if (fileSelectedMsg) fileSelectedMsg.style.display = 'flex';
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFile(e.target.files[0]);
      setTimeout(() => { fileInput.value = ''; }, 100);
    }
  });

  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.BVSim.file = null;
      fileInput.value = '';
      if (fileSelectedMsg) fileSelectedMsg.style.display = 'none';
      if (resultsContainer) resultsContainer.style.display = 'none';
      if (statusContainer) statusContainer.style.display = 'none';
    });
  }

  simulateButton.addEventListener('click', async () => {
    const file = window.BVSim.file;
    const p1Val = p1Input.value === '' ? 0 : parseInput(p1Input.value);
    const p2Val = p2Input.value === '' ? 0 : parseInput(p2Input.value);
    const saldoVal = saldoInput.value === '' ? 0 : parseInput(saldoInput.value);
    const zonaFiscalVal = zonaFiscalInput ? zonaFiscalInput.value : 'Península';
    const esViviendaCanarias = viviendaCanariasInput ? viviendaCanariasInput.checked : true;

    if (!file) { showToast('Tienes que subir el archivo CSV primero.', 'err'); return; }
    if (p1Val <= 0) { showToast('Te falta poner la potencia contratada (P1).', 'err'); return; }
    
    if (resultsContainer) { resultsContainer.classList.remove('show'); resultsContainer.style.display = 'none'; }
    if (statusContainer) { statusContainer.style.display = 'block'; statusEl.innerHTML = '<span class="spinner"></span> Leyendo archivo...'; }

    const btnText = simulateButton.querySelector('.bv-btn-text');
    const btnSpinner = simulateButton.querySelector('.spinner');
    simulateButton.disabled = true;
    if (btnText) btnText.textContent = 'Calculando...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    await new Promise(r => setTimeout(r, 100));

    try {
      const result = await window.BVSim.importFile(file);
      if (!result || !result.ok) throw new Error(result?.error || 'Error al leer archivo.');

      const monthlyResult = window.BVSim.simulateMonthly(result, p1Val, p2Val);
      const tarifasResult = await window.BVSim.loadTarifasBV();
      const monthMap = new Map((monthlyResult.months || []).map((m) => [m.key, m]));
      
      const allResults = window.BVSim.simulateForAllTarifasBV({
        months: monthlyResult.months,
        tarifasBV: tarifasResult.tarifasBV,
        potenciaP1: p1Val, potenciaP2: p2Val, bvSaldoInicial: saldoVal,
        zonaFiscal: zonaFiscalVal,
        esVivienda: esViviendaCanarias
      });

      const rankedResults = [...allResults.results].sort((a, b) => {
        const diffReal = a.totals.real - b.totals.real;
        if (Math.abs(diffReal) < 0.01) return b.totals.bvFinal - a.totals.bvFinal;
        return diffReal;
      });

      const winner = rankedResults[0];
      const ahorroPct = rankedResults.length > 1 ? Math.round(((rankedResults[rankedResults.length-1].totals.pagado - winner.totals.pagado) / rankedResults[rankedResults.length-1].totals.pagado) * 100) : 0;

      const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

      // --- FUNCIÓN ÚNICA PARA FILAS (buildRows) ---
      const buildRows = (resultItem) => {
        const t = resultItem.tarifa;
        const hasBV = Boolean(t?.fv?.bv);
        return resultItem.rows.map((row) => {
          const m = monthMap.get(row.key) || {};
          const imp = r2((row.impuestoElec||0) + (row.ivaCuota||0) + (row.costeBonoSocial||0) + (row.alquilerContador||0));
          const eBruta = r2(row.consEur || 0);
          const excMes = r2(row.credit1 || 0);
          const eNeta = r2(eBruta - excMes);
          const subtotal = r2(row.totalBase || 0);
          const usoHucha = r2(row.credit2 || 0);
          const sobranteHucha = r2(row.excedenteSobranteEur || 0);
          const restoHucha = r2(Math.max(0, (row.bvSaldoPrev || 0) - usoHucha));

          // Cálculos Potencia
          const potP1 = r2(p1Val * row.dias * t.p1);
          const potP2 = r2(p2Val * row.dias * t.p2);
          const tipPot = `P1: ${fKw(p1Val)} kW × ${row.dias}d × ${fPrice(t.p1)} € = ${fEur(potP1)}
P2: ${fKw(p2Val)} kW × ${row.dias}d × ${fPrice(t.p2)} € = ${fEur(potP2)}
TOTAL = ${fEur(row.pot)}`;

          // Cálculos Energía (Bruta)
          const kwhP1 = Number(m.importByPeriod?.P1) || 0;
          const kwhP2 = Number(m.importByPeriod?.P2) || 0;
          const kwhP3 = Number(m.importByPeriod?.P3) || 0;
          const eP1 = r2(kwhP1 * t.cPunta);
          const eP2 = r2(kwhP2 * t.cLlano);
          const eP3 = r2(kwhP3 * t.cValle);
          const tipEneBruta = `P1: ${fKwh(kwhP1)} kWh × ${fPrice(t.cPunta)} € = ${fEur(eP1)}
P2: ${fKwh(kwhP2)} kWh × ${fPrice(t.cLlano)} € = ${fEur(eP2)}
P3: ${fKwh(kwhP3)} kWh × ${fPrice(t.cValle)} € = ${fEur(eP3)}
TOTAL = ${fEur(eBruta)}`;

          // Cálculos Excedentes
          const exKwh = Number(row.exKwh) || Number(m.exportTotalKWh) || 0;
          const totalGen = r2(exKwh * (row.precioExc || 0));
          const tipExcedentes = `Generado: ${fKwh(exKwh)} kWh × ${fPrice(row.precioExc)} € = ${fEur(totalGen)}

Compensación (este mes):
- Límite: energía bruta del mes
- Compensado en factura: ${fEur(excMes)}

Excedente sobrante:
${hasBV ? `- Se acumula en Batería Virtual: ${fEur(sobranteHucha)}` : `- NO se acumula (se pierde): ${fEur(sobranteHucha)}`}`;

          const tipEneNeta = `Energía Bruta (${fEur(eBruta)}) - Compensación (${fEur(excMes)}) = ${fEur(eNeta)}`;
          const tipImp = `Impuesto eléctrico (IEE): ${fEur(row.impuestoElec)}
IVA/IGIC/IPSI: ${fEur(row.ivaCuota)}
Bono social: ${fEur(row.costeBonoSocial)}
Alquiler contador: ${fEur(row.alquilerContador)}`;

          const tipSub = `Potencia: ${fEur(row.pot)}
Energía neta (bruta - compensación): ${fEur(eNeta)}
Bono social: ${fEur(row.costeBonoSocial)}
Impuesto eléctrico (IEE): ${fEur(row.impuestoElec)}
Alquiler contador: ${fEur(row.alquilerContador)}
IVA/IGIC/IPSI: ${fEur(row.ivaCuota)}
TOTAL = ${fEur(subtotal)}`;

          const tipHucha = hasBV
            ? `Saldo BV previo: ${fEur(row.bvSaldoPrev)}
Usado este mes: -${fEur(usoHucha)}`
            : 'No aplica: esta tarifa no tiene Batería Virtual.';

          const tipPagar = hasBV
            ? `Factura (${fEur(subtotal)}) - BV usada (${fEur(usoHucha)}) = ${fEur(row.totalPagar)}`
            : `Factura total (sin BV) = ${fEur(row.totalPagar)}`;

          const tipSaldo = hasBV
            ? `Saldo restante: ${fEur(restoHucha)}
Nuevo excedente acumulado: ${fEur(sobranteHucha)}
SALDO BV FIN = ${fEur(row.bvSaldoFin)}`
            : 'No aplica: esta tarifa no acumula saldo.';

          const huchaCell = usoHucha > 0 ? `-${fEur(usoHucha)}` : fEur(0);

          return `
            <tr>
              <td>${row.key}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipPot)}">${fEur(row.pot)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipEneBruta)}">${fEur(eBruta)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipExcedentes)}" style="color:var(--accent2);">${excMes > 0 ? `-${fEur(excMes)}` : fEur(0)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipEneNeta)}" style="font-weight:700;">${fEur(eNeta)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipImp)}" style="color:var(--danger);">${fEur(imp)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipSub)}" style="background:rgba(255,255,255,0.02); font-weight:700;">${fEur(subtotal)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipHucha)}">${huchaCell}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipPagar)}" style="color:var(--accent2); font-weight:800;">${fEur(row.totalPagar)}</td>
              <td class="bv-tooltip-trigger" data-tip="${escapeAttr(tipSaldo)}" style="color:#fbbf24; font-weight:700;">${fEur(row.bvSaldoFin)}</td>
            </tr>
          `;
        }).join('');
      };

      // HTML del Ganador
      const winnerName = escapeHtml(winner.tarifa?.nombre || '');
      const winnerUrl = sanitizeUrl(winner.tarifa?.web);
      const winnerHasBV = Boolean(winner.tarifa?.fv?.bv);
      const pillWinner = winnerHasBV
        ? '<span class="bv-pill bv-pill--bv" title="Esta tarifa acumula el excedente sobrante (en €) para meses futuros.">Con batería virtual</span>'
        : '<span class="bv-pill bv-pill--no-bv" title="Esta tarifa NO acumula excedente sobrante: lo no compensado se pierde cada mes.">Sin batería virtual</span>';

      const winnerHTML = `
        <div class="bv-results-grid" style="margin-bottom: 40px;">
          <div class="bv-winner-card-compact">
            <div class="bv-winner-badge">🏆 Mejor Opción</div>
            <h2 class="bv-winner-name">${winnerName}</h2>
            <div style="margin-top: 8px;">${pillWinner}</div>
            <div style="margin-top:auto; padding-top:1.5rem; width:100%">
              ${winnerUrl ? `<a href="${winnerUrl}" target="_blank" rel="noopener noreferrer" class="btn primary" style="width:100%; justify-content:center;">Ver esta tarifa &rarr;</a>` : ''}
            </div>
          </div>
          <div class="bv-kpis-stack">
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Pagas en total</span>
              <span class="bv-kpi-value">${fEur(winner.totals.pagado)}</span>
              <span class="bv-kpi-sub">Con saldo previo aplicado</span>
            </div>
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Coste real (ranking)</span>
              <span class="bv-kpi-value">${fEur(winner.totals.real)}</span>
              <span class="bv-kpi-sub">Sin saldo previo</span>
            </div>
            <div class="bv-kpi-card ${winnerHasBV ? 'highlight' : ''}">
              <span class="bv-kpi-label">Saldo BV final</span>
              <span class="bv-kpi-value ${winnerHasBV ? 'surplus' : ''}">${winnerHasBV ? fEur(winner.totals.bvFinal) : '—'}</span>
              <span class="bv-kpi-sub">${winnerHasBV ? 'Acumulado (si no lo gastas)' : 'No aplica'}</span>
            </div>
          </div>
        </div>
        <details style="margin-bottom: 48px;">
          <summary style="font-size: 1.1rem; font-weight: 700; cursor: pointer; text-align: center; color: var(--text); padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card2); transition: all 0.2s;">Ver desglose detallado del ganador ▾</summary>
          <div class="bv-table-container" style="margin-top:16px;">
            <table class="bv-table">
              <thead>
                <tr>
                  <th style="text-align:left">Mes</th><th>Potencia</th><th>E. Bruta</th><th>Exced.</th><th>E. Neta</th><th>Impuestos</th><th>Subtotal</th><th>Hucha</th><th>Pagar</th><th>Saldo</th>
                </tr>
              </thead>
              <tbody>${buildRows(winner)}</tbody>
            </table>
          </div>
        </details>
      `;

      // HTML de Alternativas
      const alternativesHTML = rankedResults.slice(1).map((r, i) => {
        const altName = escapeHtml(r.tarifa?.nombre || '');
        const hasBV = Boolean(r.tarifa?.fv?.bv);
        const pill = hasBV
          ? '<span class="bv-pill bv-pill--bv" title="Acumula excedente sobrante para meses futuros.">Con BV</span>'
          : '<span class="bv-pill bv-pill--no-bv" title="No acumula excedente sobrante; lo no compensado se pierde.">Sin BV</span>';
        return `
          <div class="bv-alt-card-detailed" style="margin-bottom: 24px; background:var(--card); border:1px solid var(--border); padding:24px; border-radius:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:16px;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;"><span class="bv-alt-rank" style="font-size:1.5rem; opacity:0.5; font-weight:900;">#${i+2}</span><h3 style="margin:0; font-size:1.3rem;">${altName}</h3>${pill}</div>
              <div style="text-align:right;">
                <div style="font-size:1.5rem; font-weight:900;">${fEur(r.totals.real)}</div>
                <div style="opacity:0.75; font-size:0.9rem;">Pagas: ${fEur(r.totals.pagado)}</div>
                ${hasBV && r.totals.bvFinal > 0.01 ? `<div style="color:#fbbf24; font-weight:700;">Saldo: ${fEur(r.totals.bvFinal)}</div>` : ''}
              </div>
            </div>
            ${hasBV ? '' : '<div class="bv-note">Nota: sin BV, el excedente que no compense este mes se pierde.</div>'}
            <details>
              <summary style="cursor: pointer; color: var(--accent); font-weight:600; font-size:0.9rem;">Ver desglose ▾</summary>
              <div class="bv-table-container" style="margin-top:12px;">
                <table class="bv-table">
                  <thead>
                    <tr>
                      <th style="text-align:left">Mes</th><th>Potencia</th><th>E. Bruta</th><th>Exced.</th><th>E. Neta</th><th>Impuestos</th><th>Subtotal</th><th>Hucha</th><th>Pagar</th><th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>${buildRows(r)}</tbody>
                </table>
              </div>
            </details>
          </div>
        `;
      }).join('');

      const totalTarifas = rankedResults.length;
      resultsEl.innerHTML = `<h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>${winnerHTML}<h3 style="text-align:center; margin-bottom: 24px; margin-top: 40px; color:var(--text);">Ranking completo (${totalTarifas} tarifas)</h3>${alternativesHTML}`;
      resultsContainer.style.display = 'block';
      setTimeout(() => resultsContainer.classList.add('show'), 10);
      statusContainer.style.display = 'none';
      showToast('Cálculo completado.', 'ok');
      
    } catch (e) {
      console.error('BVSim Error:', e);
      const msg = e?.message ? String(e.message) : 'Error inesperado.';
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">⚠️ Error: ${escapeHtml(msg)}</span>`;
      showToast(msg, 'err');
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Calcular Ahorro Real →';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
});