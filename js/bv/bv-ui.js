window.BVSim = window.BVSim || {};

document.addEventListener('DOMContentLoaded', () => {
  console.log('BVSim: Initializing UI...');

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

  const btnTheme = document.getElementById('btnTheme');
  const btnMenu = document.getElementById('btnMenu');
  const menuPanel = document.getElementById('menuPanel');

  function updateThemeUI() {
    const isLight = document.documentElement.classList.contains('light-mode');
    if (btnTheme) btnTheme.textContent = isLight ? '☀️' : '🌙';
  }

  if (btnTheme) {
    const newBtn = btnTheme.cloneNode(true);
    if (btnTheme.parentNode) {
      btnTheme.parentNode.replaceChild(newBtn, btnTheme);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isLight = document.documentElement.classList.toggle('light-mode');
        localStorage.setItem('almax_theme', isLight ? 'light' : 'dark');
        updateThemeUI();
      });
    }
    updateThemeUI();
  }

  if (btnMenu && menuPanel) {
    const newBtn = btnMenu.cloneNode(true);
    if (btnMenu.parentNode) {
      btnMenu.parentNode.replaceChild(newBtn, btnMenu);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isShow = menuPanel.classList.toggle('show');
        newBtn.setAttribute('aria-expanded', isShow);
      });
    }
  }

  document.addEventListener('click', (e) => {
    const clearBtn = e.target.closest('#btnClearCache');
    if (clearBtn) {
      localStorage.clear();
      location.reload();
      return;
    }
    if (menuPanel && menuPanel.classList.contains('show')) {
      if (!menuPanel.contains(e.target)) {
        menuPanel.classList.remove('show');
        const mBtn = document.getElementById('btnMenu');
        if (mBtn) mBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

  if (zonaFiscalInput) {
    zonaFiscalInput.addEventListener('change', () => {
      if (viviendaCanariasWrapper) {
        viviendaCanariasWrapper.style.display = zonaFiscalInput.value === 'Canarias' ? 'block' : 'none';
      }
    });
  }

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
    const normalized = String(val).replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  }

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

    if (!file) { alert('Tienes que subir el archivo CSV primero.'); return; }
    if (p1Val <= 0) { alert('Te falta poner la potencia contratada.'); return; }
    
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
      const isWinnerIndexada = winner.tarifa.tipo === 'INDEXADA';
      
      const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

      const buildRows = (resultItem) => {
        const isInd = resultItem.tarifa.tipo === 'INDEXADA';
        const tarifaObj = resultItem.tarifa;

        return resultItem.rows.map((row) => {
          const m = monthMap.get(row.key) || {};
          
          const imp = r2((row.impuestoElec||0) + (row.ivaCuota||0) + (row.costeBonoSocial||0) + (row.alquilerContador||0));
          const energiaBruta = r2(row.consEur || 0);
          const descuentoExc = r2(row.credit1 || 0);
          const energiaNeta = r2(energiaBruta - descuentoExc);
          const subtotal = r2(row.totalBase || 0);
          const usoHucha = r2(row.credit2 || 0);
          const restoHucha = Math.max(0, (row.bvSaldoPrev || 0) - usoHucha);
          const excedenteHucha = r2(row.excedenteSobranteEur || 0);

          const potP1 = r2(p1Val * row.dias * tarifaObj.p1);
          const potP2 = r2(p2Val * row.dias * tarifaObj.p2);
          const tipPot = `P1: ${fKw(p1Val)} kW × ${row.dias}d × ${fPrice(tarifaObj.p1)} € = ${fEur(potP1)}
` + 
                         `P2: ${fKw(p2Val)} kW × ${row.dias}d × ${fPrice(tarifaObj.p2)} € = ${fEur(potP2)}
` + 
                         `TOTAL = ${fEur(row.pot)}`;

          const kwhP1 = Number(m.importByPeriod?.P1) || 0;
          const kwhP2 = Number(m.importByPeriod?.P2) || 0;
          const kwhP3 = Number(m.importByPeriod?.P3) || 0;
          const cP1 = Number(tarifaObj.cPunta) || 0;
          const cP2 = Number(tarifaObj.cLlano) || 0;
          const cP3 = Number(tarifaObj.cValle) || 0;
          const costP1 = r2(kwhP1 * cP1);
          const costP2 = r2(kwhP2 * cP2);
          const costP3 = r2(kwhP3 * cP3);

          const tipEneBruta = `P1: ${fKwh(kwhP1)} kWh × ${fPrice(cP1)} € = ${fEur(costP1)}
` + 
                              `P2: ${fKwh(kwhP2)} kWh × ${fPrice(cP2)} € = ${fEur(costP2)}
` + 
                              `P3: ${fKwh(kwhP3)} kWh × ${fPrice(cP3)} € = ${fEur(costP3)}
` + 
                              `TOTAL = ${fEur(energiaBruta)}`;

          const exKwh = Number(row.exKwh) || Number(m.exportTotalKWh) || 0;
          const precioExc = Number(row.precioExc) || 0;
          const totalGen = r2(exKwh * precioExc);
          const tipExcedentes = `Generado: ${fKwh(exKwh)} kWh × ${fPrice(precioExc)} € = ${fEur(totalGen)}

` + 
                                `Desglose:
- Compensado en factura: ${fEur(descuentoExc)}
- A Batería Virtual: ${fEur(excedenteHucha)}`;

          const tipEneNeta = `Energía Bruta (${fEur(energiaBruta)}) - Compensación (${fEur(descuentoExc)}) = ${fEur(energiaNeta)}`;
          const tipImp = `IEE: ${fEur(row.impuestoElec)}
IVA: ${fEur(row.ivaCuota)}
Bono/Alquiler: ${fEur((row.costeBonoSocial||0) + (row.alquilerContador||0))}`;
          const tipSub = `Potencia + Energía Neta + Impuestos = ${fEur(subtotal)}`;
          const tipHucha = `Saldo previo: ${fEur(row.bvSaldoPrev)}
Usado: -${fEur(usoHucha)}`;
          const tipPagar = `Subtotal (${fEur(subtotal)}) - Hucha (${fEur(usoHucha)}) = ${fEur(row.totalPagar)}`;
          const tipSaldo = `Sobra Hucha (${fEur(restoHucha)}) + Nuevo Excedente (${fEur(excedenteHucha)}) = ${fEur(row.bvSaldoFin)}`;

          return `
            <tr>
              <td>${row.key}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipPot}">${fEur(row.pot)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipEneBruta}">${fEur(energiaBruta)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipExcedentes}" style="color:var(--accent2);">${descuentoExc > 0 ? `-${fEur(descuentoExc)}` : fEur(0)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipEneNeta}" style="font-weight:700;">${fEur(energiaNeta)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipImp}" style="color:var(--danger);">${fEur(imp)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipSub}" style="background:rgba(255,255,255,0.02); font-weight:700;">${fEur(subtotal)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipHucha}">-${fEur(usoHucha)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipPagar}" style="color:var(--accent2); font-weight:800;">${fEur(row.totalPagar)}</td>
              <td class="bv-tooltip-trigger" data-tip="${tipSaldo}" style="color:#fbbf24; font-weight:700;">${fEur(row.bvSaldoFin)}</td>
            </tr>
          `;
        }).join('');
      };

      const winnerRows = buildRows(winner);
      const winnerHTML = `
        <div class="bv-results-grid" style="margin-bottom: 40px;">
          <div class="bv-winner-card-compact">
            <div class="bv-winner-badge">🏆 Mejor Opción</div>
            <div class="bv-winner-name">${winner.tarifa.nombre}</div>
            <div class="bv-winner-company">de ${winner.tarifa.comercializadora || 'Compañía Desconocida'}</div>
            <div style="margin-top:auto; padding-top:1.5rem; width:100%">
              ${winner.tarifa.web ? `<a href="${winner.tarifa.web}" target="_blank" class="btn primary" style="width:100%; justify-content:center;">Ver esta tarifa &rarr;</a>` : ''}
            </div>
          </div>

          <div class="bv-kpis-stack">
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Pagarías en total</span>
              <span class="bv-kpi-value">${fEur(winner.totals.pagado)}</span>
              <span class="bv-kpi-sub">Impuestos incluidos</span>
            </div>
            <div class="bv-kpi-card highlight">
              <span class="bv-kpi-label">Te sobra (Hucha)</span>
              <span class="bv-kpi-value surplus">${fEur(winner.totals.bvFinal)}</span>
              <span class="bv-kpi-sub">Acumulado anual</span>
            </div>
          </div>
        </div>

        <details style="margin-bottom: 48px;">
          <summary style="font-size: 1.1rem; font-weight: 700; cursor: pointer; text-align: center; color: var(--text); padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card2); transition: all 0.2s;">Ver desglose detallado del ganador ▾</summary>
          <div class="bv-table-container" style="margin-top:16px;">
            <table class="bv-table">
              <thead>
                <tr>
                  <th style="text-align:left">Mes</th>
                  <th>Potencia</th>
                  <th>Energía Bruta</th>
                  <th>Excedentes</th>
                  <th>Energía Neta</th>
                  <th>Impuestos</th>
                  <th>Subtotal</th>
                  <th>Uso Hucha</th>
                  <th>A Pagar</th>
                  <th>Saldo Hucha</th>
                </tr>
              </thead>
              <tbody>${winnerRows}</tbody>
            </table>
          </div>
        </details>
      `;

      const alternativesHTML = rankedResults.slice(1, 6).map((r, i) => {
        const rows = buildRows(r);
        return `
          <div class="bv-alt-card-detailed" style="margin-bottom: 24px; background:var(--card); border:1px solid var(--border); padding:24px; border-radius:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:16px;">
              <div>
                <div class="bv-alt-rank" style="font-size:1.5rem; opacity:0.5; font-weight:900;">#${i+2}</div>
                <h3 style="margin:0; font-size:1.3rem;">${r.tarifa.nombre}</h3>
                <small style="color:var(--muted)">${r.tarifa.comercializadora}</small>
              </div>
              <div style="text-align:right;">
                <div style="font-size:1.5rem; font-weight:900;">${fEur(r.totals.pagado)}</div>
                ${r.totals.bvFinal > 1 ? `<div style="color:#fbbf24; font-weight:700;">Sobran ${fEur(r.totals.bvFinal)}</div>` : ''}
              </div>
            </div>
            
            <details>
              <summary style="cursor: pointer; color: var(--accent); font-weight:600; font-size:0.9rem;">Ver desglose ▾</summary>
              <div class="bv-table-container" style="margin-top:12px;">
                <table class="bv-table">
                  <thead>
                    <tr>
                      <th style="text-align:left">Mes</th>
                      <th>Potencia</th>
                      <th>E. Bruta</th>
                      <th>Exced.</th>
                      <th>E. Neta</th>
                      <th>Impuestos</th>
                      <th>Subtotal</th>
                      <th>Hucha</th>
                      <th>Pagar</th>
                      <th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </details>
          </div>
        `;
      }).join('');

      resultsEl.innerHTML = `
        <h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>
        ${winnerHTML}
        <h3 style="text-align:center; margin-bottom: 24px; margin-top: 40px;">Otras Alternativas</h3>
        ${alternativesHTML}
      `;

      resultsContainer.style.display = 'block';
      setTimeout(() => resultsContainer.classList.add('show'), 10);
      statusContainer.style.display = 'none';
      
      const oldTooltip = document.querySelector('.bv-floating-tooltip');
      if (oldTooltip) oldTooltip.remove();

      const tooltipEl = document.createElement('div');
      tooltipEl.className = 'bv-floating-tooltip';
      document.body.appendChild(tooltipEl);

      const showTooltip = (e, text) => {
        if (!text) return;
        tooltipEl.textContent = text;
        tooltipEl.style.display = 'block';
        
        const rect = e.target.getBoundingClientRect();
        const ttWidth = tooltipEl.offsetWidth;
        const ttHeight = tooltipEl.offsetHeight;
        
        let top = rect.top - ttHeight - 10;
        let left = rect.left + (rect.width / 2) - (ttWidth / 2);
        
        if (top < 10) top = rect.bottom + 10; 
        if (left < 10) left = 10;
        if (left + ttWidth > window.innerWidth - 10) left = window.innerWidth - ttWidth - 10;

        tooltipEl.style.top = `${top + window.scrollY}px`;
        tooltipEl.style.left = `${left + window.scrollX}px`;
      };

      const hideTooltip = () => { tooltipEl.style.display = 'none'; };

      resultsEl.querySelectorAll('.bv-tooltip-trigger').forEach(el => {
        const tip = el.getAttribute('data-tip');
        el.addEventListener('mouseenter', (e) => showTooltip(e, tip));
        el.addEventListener('mouseleave', hideTooltip);
        el.addEventListener('click', (e) => { e.stopPropagation(); showTooltip(e, tip); });
      });
      document.addEventListener('click', hideTooltip);
      
    } catch (e) {
      console.error('BVSim Error:', e);
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">⚠️ Error: ${e.message}</span>`;
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Calcular Ahorro 🚀';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
});