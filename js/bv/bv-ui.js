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
        const energiaNeta = row.consEur - row.credit1;
        const subtotal = row.totalBase;
        const restoHucha = Math.max(0, row.bvSaldoPrev - row.credit2);

        // Tooltip strings
        const tipPot = `P1: ${p1Val} kW x ${row.dias} días x ${winner.tarifa.p1} €/kW\nP2: ${p2Val} kW x ${row.dias} días x ${winner.tarifa.p2} €/kW`;
        const tipEne = `Coste Energía: ${fEur(row.consEur)}\n- Descuento Exc.: ${fEur(row.credit1)}`;
        const tipImp = `IEE: ${fEur(row.impuestoElec)}\nIVA: ${fEur(row.ivaCuota)}\nAlquiler/Otros: ${fEur(row.costeBonoSocial + row.alquilerContador)}`;
        const tipSub = `Suma de:\nPotencia (${fEur(row.pot)})\n+ Energía Neta (${fEur(energiaNeta)})\n+ Impuestos/Cargos (${fEur(imp)})`;
        const tipHucha = `Saldo disponible: ${fEur(row.bvSaldoPrev)}\nUsado para esta factura: -${fEur(row.credit2)}`;
        const tipPagar = `Importe factura (${fEur(subtotal)}) - Uso Hucha (${fEur(row.credit2)})`;
        const tipSaldo = `Restante (${fEur(restoHucha)}) + Nuevo Excedente (${fEur(row.excedenteSobranteEur)})`;

        return `
          <tr>
            <td class="bv-col-mes" style="font-weight:700; color:#fff;">${row.key}</td>
            <td class="bv-col-pot tooltip" data-tip="${tipPot}" style="cursor:help;">${fEur(row.pot)}</td>
            <td class="bv-col-ene tooltip" data-tip="${tipEne}" style="cursor:help; font-weight:600;">${fEur(energiaNeta)}</td>
            <td class="bv-col-imp tooltip" data-tip="${tipImp}" style="cursor:help; color:#ef4444; font-weight:600;">${fEur(imp)}</td>
            <td class="bv-col-sub tooltip" data-tip="${tipSub}" style="cursor:help; font-weight:700; background:rgba(255,255,255,0.03);">${fEur(subtotal)}</td>
            <td class="bv-col-hucha tooltip" data-tip="${tipHucha}" style="cursor:help;">
                <span class="bv-val-hucha-use">-${fEur(row.credit2)}</span>
            </td>
            <td class="bv-col-pagar bv-cell-main tooltip" data-tip="${tipPagar}" style="cursor:help; color:#10b981;">${fEur(row.totalPagar)}</td>
            <td class="bv-col-saldo tooltip" data-tip="${tipSaldo}" style="cursor:help; color:#fbbf24; font-weight:700;">${fEur(row.bvSaldoFin)}</td>
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
        <h2 style="text-align:center; font-size:2rem; font-weight:900; margin-bottom:2rem;">Resultados de la Simulación</h2>

        <div class="bv-results-grid">
          <!-- IZQUIERDA: Tarjeta Ganadora -->
          <div class="bv-winner-card-compact">
            <div class="bv-winner-badge">🏆 Opción Ganadora</div>
            <h2 class="bv-winner-name">${winner.tarifa.nombre}</h2>
            <div class="bv-winner-company">de ${winner.tarifa.comercializadora || 'Compañía Desconocida'}</div>
            
            <div style="margin-top:auto; padding-top:1.5rem;">
              ${winner.tarifa.web ? `<a href="${winner.tarifa.web}" target="_blank" class="btn primary" style="width:100%; justify-content:center;">Ver esta tarifa &rarr;</a>` : ''}
            </div>
          </div>

          <!-- DERECHA: KPIs -->
          <div class="bv-kpis-stack">
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Pagarías en este periodo</span>
              <span class="bv-kpi-value">${fEur(winner.totals.pagado)}</span>
              <span class="bv-kpi-sub">Total con impuestos incluidos</span>
            </div>
            
            <div class="bv-kpi-card highlight">
              <span class="bv-kpi-label">Dinero que te sobra</span>
              <span class="bv-kpi-value surplus">${fEur(winner.totals.bvFinal)}</span>
              <span class="bv-kpi-sub">Saldo acumulado en hucha</span>
            </div>
          </div>
        </div>

        ${ahorroPct > 0 ? `<div style="margin: 2rem auto; text-align:center; max-width:600px;"><div class="bv-savings-banner">📉 Estás ahorrando un <strong>${ahorroPct}%</strong> respecto a la media</div></div>` : ''}

        <details style="margin-top: 20px; margin-bottom: 40px;">
          <summary style="font-size: 0.9rem; cursor: pointer; text-align: center; color: var(--muted); padding: 10px; border-radius: 8px; transition: background 0.2s;">Ver desglose detallado mensual ▾</summary>
          ${isWinnerIndexada ? '<div style="font-size:11px; color:#fbbf24; text-align:center; margin:12px 0;">* Excedentes estimados a 0,06 €/kWh (indexada)</div>' : ''}
          <div class="bv-table-container" style="margin-top:1rem;">
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
          <div style="text-align:center; margin-top:16px;"><button class="btn" id="bv-download-csv" style="font-size:0.85rem; padding: 10px 20px;">📥 Descargar resumen CSV</button></div>
        </details>

        <div class="u-mb-24">
          <h3 style="font-size: 1.4rem; font-weight: 900; margin-bottom: 1.5rem; text-align: center;">Otras alternativas top</h3>
          <div class="bv-alternatives-list">
            ${rankedResults.slice(1, 6).map((r, i) => `
              <div class="bv-alt-card">
                <div class="bv-alt-rank">#${i+2}</div>
                <div class="bv-alt-info">
                  <strong>${r.tarifa.nombre}</strong>
                  <small style="color:var(--muted)">${r.tarifa.comercializadora || ''}</small>
                </div>
                <div>
                  <div class="bv-alt-price">${fEur(r.totals.pagado)}</div>
                  ${r.totals.bvFinal > 1 ? `<span class="bv-alt-surplus">Sobran ${fEur(r.totals.bvFinal)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      resultsContainer.style.display = 'block';
      setTimeout(() => resultsContainer.classList.add('show'), 10);
      statusContainer.style.display = 'none';
      const dlBtn = document.getElementById('bv-download-csv');
      if (dlBtn) dlBtn.addEventListener('click', () => window.BVSim.downloadCSV(winner));
      
      // Inicializar tooltips dinámicos
      if (window.LF && window.LF.initTooltips) {
        setTimeout(window.LF.initTooltips, 100);
      }
      
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
