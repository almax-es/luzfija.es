window.BVSim = window.BVSim || {};

(function () {
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

  // --- UI INITIALIZATION (FORCED & ROBUST) ---
  const btnTheme = document.getElementById('btnTheme');
  const btnMenu = document.getElementById('btnMenu');
  const menuPanel = document.getElementById('menuPanel');

  function updateThemeUI() {
    const isLight = document.documentElement.classList.contains('light-mode');
    if (btnTheme) btnTheme.textContent = isLight ? '☀️' : '🌙';
  }

  if (btnTheme) {
    // Clonar para limpiar listeners de lf-ui.js
    const newBtn = btnTheme.cloneNode(true);
    btnTheme.parentNode.replaceChild(newBtn, btnTheme);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isLight = document.documentElement.classList.toggle('light-mode');
      localStorage.setItem('almax_theme', isLight ? 'light' : 'dark');
      updateThemeUI();
    });
    updateThemeUI();
  }

  if (btnMenu && menuPanel) {
    const newBtn = btnMenu.cloneNode(true);
    btnMenu.parentNode.replaceChild(newBtn, btnMenu);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isShow = menuPanel.classList.toggle('show');
      newBtn.setAttribute('aria-expanded', isShow);
    });
  }

  // Delegación global para cerrar menú y limpiar caché
  document.addEventListener('click', (e) => {
    // Limpiar Caché
    const clearBtn = e.target.closest('#btnClearCache');
    if (clearBtn) {
      localStorage.clear();
      location.reload();
      return;
    }

    // Cerrar menú al hacer click fuera
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

  // Formateadores ES
  const currencyFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const numberFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); 

  const fEur = (v) => currencyFmt.format(Number(v) || 0);
  const fKwh = (v) => numberFmt.format(Number(v) || 0);

  function parseInput(val) {
    if (val === undefined || val === null || val === '') return 0;
    const normalized = String(val).replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  }

  if (!fileInput || !simulateButton) return;

  // --- DRAG & DROP LOGIC ---
  function handleFile(file) {
    if (!file) return;
    window.BVSim.file = file;
    if (fileNameDisplay) fileNameDisplay.textContent = file.name;
    if (fileSelectedMsg) fileSelectedMsg.style.display = 'flex';
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
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

  // --- SIMULATION LOGIC ---
  simulateButton.addEventListener('click', async () => {
    const file = window.BVSim.file;
    const p1Val = p1Input.value === '' ? 0 : parseInput(p1Input.value);
    const p2Val = p2Input.value === '' ? 0 : parseInput(p2Input.value);
    const saldoVal = saldoInput.value === '' ? 0 : parseInput(saldoInput.value);
    const zonaFiscalVal = zonaFiscalInput ? zonaFiscalInput.value : 'Península';
    const esViviendaCanarias = viviendaCanariasInput ? viviendaCanariasInput.checked : true;

    if (!file) { alert('Tienes que subir el archivo CSV primero.'); return; }
    if (p1Val <= 0) { alert('Te falta poner la potencia contratada.'); return; }
    
    if (resultsContainer) {
      resultsContainer.classList.remove('show');
      resultsContainer.style.display = 'none';
    }
    if (statusContainer) {
      statusContainer.style.display = 'block';
      statusEl.innerHTML = '<span class="spinner"></span> Leyendo tu fichero...';
    }

    const btnText = simulateButton.querySelector('.bv-btn-text');
    const btnSpinner = simulateButton.querySelector('.spinner');
    simulateButton.disabled = true;
    if (btnText) btnText.textContent = 'Calculando...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    await new Promise(r => setTimeout(r, 100));

    try {
      const result = await window.BVSim.importFile(file);
      if (!result || !result.ok) throw new Error(result?.error || 'No se pudo leer el archivo.');

      const monthlyResult = window.BVSim.simulateMonthly(result, p1Val, p2Val);
      const tarifasResult = await window.BVSim.loadTarifasBV();
      
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

      const buildDetailedRows = (rows, isIndexada) => rows.map((row) => {
        const imp = row.impuestoElec + row.ivaCuota + row.costeBonoSocial + row.alquilerContador;
        return `
          <tr>
            <td class="bv-col-mes" style="font-weight:700; color:#fff">${row.key}</td>
            <td class="bv-col-pot" style="text-align:center">${fEur(row.pot)}</td>
            <td class="bv-col-ene">
                <div class="bv-cell-op">
                  <span class="bv-op-base">${fEur(row.consEur)}</span>
                  <span class="bv-op-disc">-${fEur(row.credit1)}</span>
                  <span class="bv-op-total">${fEur(row.consEur - row.credit1)}</span>
                </div>
            </td>
            <td class="bv-col-imp" style="color:#ef4444; font-size:12px">${fEur(imp)}</td>
            <td class="bv-col-sub" style="font-weight:700; background:rgba(255,255,255,0.03)">${fEur(row.totalBase + row.ivaCuota)}</td>
            <td class="bv-col-hucha">
                <div class="bv-cell-op">
                  <span class="bv-val-hucha-prev">Tenías: ${fEur(row.bvSaldoPrev)}</span>
                  <span class="bv-val-hucha-use">-${fEur(row.credit2)}</span>
                </div>
            </td>
            <td class="bv-col-pagar bv-cell-main" style="color:#10b981">${fEur(row.totalPagar)}</td>
            <td class="bv-col-saldo" style="color:#fbbf24; font-weight:700">
                <div class="bv-cell-op">
                  <span>+${fEur(row.excedenteSobranteEur)}${isIndexada ? '*' : ''}</span>
                  <span class="bv-op-total" style="color:#fbbf24; border-color:rgba(251,191,36,0.3)">${fEur(row.bvSaldoFin)}</span>
                </div>
            </td>
          </tr>
        `;
      }).join('');

      const winner = rankedResults[0];
      const isWinnerIndexada = winner.tarifa.tipo === 'INDEXADA';
      const totalImp = monthlyResult.months.reduce((a, b) => a + b.importTotalKWh, 0);
      const totalAuto = result.records.reduce((a, b) => a + (Number(b.autoconsumo) || 0), 0);
      const diasTotales = monthlyResult.months.reduce((a, b) => a + b.spanDays, 0);
      const costeSinPlacas = (totalImp + totalAuto) * 0.15 + (p1Val * 0.08 * diasTotales);
      const ahorroPct = Math.round(((costeSinPlacas - winner.totals.pagado) / costeSinPlacas) * 100);

      resultsEl.innerHTML = `
        <div class="heroKpis" style="margin-bottom: 2rem;">
          <div class="heroCard best" style="width:100%; max-width:none">
            <div class="k">Mejor opción para ti</div>
            <div class="v" style="font-size:clamp(1.5rem, 5vw, 2.5rem)">${winner.tarifa.nombre}</div>
            <div class="s">de ${winner.tarifa.comercializadora || ''}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
           <div class="heroCard" style="text-align:center">
             <div class="k">Pagarías en este periodo</div>
             <div class="v" style="color:var(--primary-light)">${fEur(winner.totals.pagado)}</div>
             <div class="s">Total con impuestos</div>
           </div>
           <div class="heroCard" style="text-align:center">
             <div class="k">Dinero que te sobra</div>
             <div class="v" style="color:#fbbf24">${fEur(winner.totals.bvFinal)}</div>
             <div class="s">En tu hucha virtual</div>
           </div>
        </div>

        ${ahorroPct > 0 ? `<div style="margin-bottom: 2rem; text-align:center;"><span class="pill" style="background:rgba(16,185,129,0.1); color:#10b981; border:1px solid rgba(16,185,129,0.2); font-weight:700; padding:8px 24px; font-size:1.1rem">📉 Estás ahorrando un ${ahorroPct}% en tu factura</span></div>` : ''}

        <div style="text-align:center; margin-bottom: 2.5rem;">
          ${winner.tarifa.web ? `<a href="${winner.tarifa.web}" target="_blank" class="btn primary" style="padding: 14px 40px; font-size: 1.2rem; border-radius: 99px;">Ver esta tarifa &rarr;</a>` : ''}
        </div>

        <details style="margin-top: 20px;">
          <summary style="font-size: 0.8rem; cursor: pointer; text-align: center; color: var(--muted);">Ver cuentas detalladas del ganador</summary>
          ${isWinnerIndexada ? '<div style="font-size:10px; color:#fbbf24; text-align:center; margin:8px 0;">* Excedentes estimados a 0,06 €/kWh (indexada)</div>' : ''}
          <div class="bv-table-container">
            <table class="bv-table">
              <thead>
                <tr>
                  <th class="bv-col-mes">Mes</th><th class="bv-col-pot">Potencia</th><th class="bv-col-ene">Energía (Neto)</th>
                  <th class="bv-col-imp">Impuestos</th><th class="bv-col-sub">Subtotal</th><th class="bv-col-hucha">Uso Hucha</th>
                  <th class="bv-col-pagar">A Pagar</th><th class="bv-col-saldo">Saldo Hucha</th>
                </tr>
              </thead>
              <tbody>${buildDetailedRows(winner.rows, isWinnerIndexada)}</tbody>
            </table>
          </div>
          <div style="text-align:center; margin-top:12px;"><button class="btn" id="bv-download-csv" style="font-size:0.8rem;">📥 Descargar resumen CSV</button></div>
        </details>

        <div class="card u-mb-24" style="background:rgba(255,255,255,0.03); margin-top:2rem;">
          <h3 class="u-mb-16">Otras opciones buenas</h3>
          ${rankedResults.slice(1, 6).map((r, i) => `
            <div style="padding: 12px 0; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
              <div><strong>${i+2}. ${r.tarifa.nombre}</strong><br><small style="color:var(--muted)">${r.tarifa.comercializadora || ''}</small></div>
              <div style="text-align:right"><strong>${fEur(r.totals.pagado)}</strong>${r.totals.bvFinal > 1 ? `<br><small style="color:#10b981">Sobran ${fEur(r.totals.bvFinal)}</small>` : ''}</div>
            </div>
          `).join('')}
        </div>
      `;

      resultsContainer.style.display = 'block';
      setTimeout(() => resultsContainer.classList.add('show'), 10);
      statusContainer.style.display = 'none';
      const dlBtn = document.getElementById('bv-download-csv');
      if (dlBtn) dlBtn.addEventListener('click', () => window.BVSim.downloadCSV(winner));
      
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">⚠️ Error: ${e.message}</span>`;
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Calcular Ahorro 🚀';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
})();
