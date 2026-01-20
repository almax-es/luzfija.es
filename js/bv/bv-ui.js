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
  const resetButton = document.getElementById('bv-reset');

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      p1Input.value = '3,45';
      p2Input.value = '3,45';
      saldoInput.value = '0,00';
      zonaFiscalInput.value = 'Península';
      viviendaCanariasWrapper.style.display = 'none';
      window.BVSim.file = null;
      fileInput.value = '';
      if (fileSelectedMsg) fileSelectedMsg.style.display = 'none';
      if (resultsContainer) {
        resultsContainer.classList.remove('show');
        resultsContainer.style.display = 'none';
      }
      if (statusContainer) statusContainer.style.display = 'none';
    });
  }

  // --- UI INITIALIZATION ---
  const btnTheme = document.getElementById('btnTheme');
  const btnMenu = document.getElementById('btnMenu');
  const menuPanel = document.getElementById('menuPanel');

  if (btnTheme) {
    // Sincronizar icono inicial
    const currentTheme = document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    btnTheme.textContent = currentTheme === 'dark' ? '🌙' : '☀️';

    btnTheme.addEventListener('click', (e) => {
      e.preventDefault();
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const newTheme = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      btnTheme.textContent = newTheme === 'dark' ? '🌙' : '☀️';
    });
  }

  if (btnMenu && menuPanel) {
    btnMenu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isShow = menuPanel.classList.toggle('show');
      btnMenu.setAttribute('aria-expanded', isShow);
    });

    // Cerrar al hacer click fuera
    document.addEventListener('click', (e) => {
      if (!menuPanel.contains(e.target) && e.target !== btnMenu) {
        menuPanel.classList.remove('show');
        btnMenu.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (zonaFiscalInput) {
    zonaFiscalInput.addEventListener('change', () => {
      if (viviendaCanariasWrapper) {
        viviendaCanariasWrapper.style.display = zonaFiscalInput.value === 'Canarias' ? 'block' : 'none';
      }
    });
  }
  const btnText = simulateButton ? simulateButton.querySelector('.bv-btn-text') : null;
  const btnSpinner = simulateButton ? simulateButton.querySelector('.spinner') : null;
  
  const resultsContainer = document.getElementById('bv-results-container');
  const resultsEl = document.getElementById('bv-results');
  const statusContainer = document.getElementById('bv-status-container');
  const statusEl = document.getElementById('bv-status');

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

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
      }
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

    if (p1Input) p1Input.classList.remove('error');
    if (resultsContainer) {
      resultsContainer.classList.remove('show');
      resultsContainer.style.display = 'none';
    }
    if (statusContainer) {
      statusContainer.style.display = 'block';
      statusEl.innerHTML = '<span class="spinner"></span> Leyendo tu fichero...';
    }

    if (!file) {
      alert('Tienes que subir el archivo CSV primero.');
      return;
    }

    if (p1Val <= 0) {
      alert('Te falta poner la potencia contratada.');
      return;
    }
    
    simulateButton.disabled = true;
    if (btnText) btnText.textContent = 'Calculando lo mejor para ti...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    await new Promise(r => setTimeout(r, 100));

    try {
      if (typeof window.BVSim.importFile !== 'function') throw new Error('Error interno (import)');

      const result = await window.BVSim.importFile(file);
      
      if (!result || !result.ok) throw new Error(result?.error || 'No hemos podido leer el archivo.');

      const monthlyResult = window.BVSim.simulateMonthly(result, p1Val, p2Val);
      
      if (!monthlyResult || !monthlyResult.ok) throw new Error('Error al calcular los meses.');

      // --- PROCESAMIENTO TARIFAS ---
      const tarifasResult = await window.BVSim.loadTarifasBV();
      if (!tarifasResult.ok || !tarifasResult.tarifasBV.length) throw new Error('No se han podido cargar las tarifas.');

      const allResults = window.BVSim.simulateForAllTarifasBV({
        months: monthlyResult.months,
        tarifasBV: tarifasResult.tarifasBV,
        potenciaP1: p1Val, potenciaP2: p2Val, bvSaldoInicial: saldoVal,
        zonaFiscal: zonaFiscalVal,
        esVivienda: esViviendaCanarias
      });

      if (!allResults.ok) throw new Error('Error en la simulación masiva.');

      const rankedResults = [...allResults.results].sort((a, b) => {
        const diffReal = a.totals.real - b.totals.real;
        if (Math.abs(diffReal) < 0.01) return b.totals.bvFinal - a.totals.bvFinal;
        return diffReal;
      });

      // --- HELPER RENDER TABLA DETALLE ---
      const buildDetailedRows = (rows, isIndexada) => rows.map((row) => {
        const impuestosYOtros = row.impuestoElec + row.ivaCuota + row.costeBonoSocial + row.alquilerContador;
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
            <td class="bv-col-imp" style="color:#ef4444; font-size:12px">${fEur(impuestosYOtros)}</td>
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

      // --- RENDER GANADORA ---
      const winner = rankedResults[0];
      const isWinnerIndexada = winner.tarifa.tipo === 'INDEXADA';
      const winnerName = winner.tarifa.nombre;
      const winnerCompany = winner.tarifa.comercializadora || '';
      const winnerCost = fEur(winner.totals.pagado);
      const winnerHucha = fEur(winner.totals.bvFinal);
      const winnerWeb = winner.tarifa.web;

      const winnerRowsHtml = buildDetailedRows(winner.rows, isWinnerIndexada);

      // --- RENDER OTRAS OPCIONES ---
      const othersHtml = rankedResults.slice(1, 10).map((r, i) => `
        <div style="padding: 16px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
            <div style="display:flex; gap:12px; align-items:center;">
              <div style="background:#333; color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:0.9rem">${i+2}</div>
              <div>
                <div style="font-weight:600; font-size:1rem">${r.tarifa.nombre}</div>
                <div style="font-size:0.85rem; color:var(--muted)">${r.tarifa.comercializadora || ''}</div>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:bold; font-size:1.1rem">${fEur(r.totals.pagado)}</div>
              ${r.totals.bvFinal > 1 ? `<div style="font-size:0.8rem; color:#10b981">Te sobran ${fEur(r.totals.bvFinal)}</div>` : ''}
            </div>
          </div>
          <details style="margin-top: 8px;">
            <summary style="font-size: 0.75rem; color: var(--primary-light); cursor: pointer; opacity: 0.8;">Ver cuentas detalladas del mes</summary>
            ${r.tarifa.tipo === 'INDEXADA' ? '<div style="font-size:9px; color:#fbbf24; text-align:center; margin-bottom:4px;">* Excedentes estimados a 0,06 €/kWh (indexada)</div>' : ''}
            <div class="bv-table-container" style="border:none; border-radius:8px; margin-top:8px; background:rgba(0,0,0,0.2);">
              <table class="bv-table" style="font-size:10px;">
                <thead>
                  <tr>
                    <th class="bv-col-mes" style="text-align:left">Mes</th>
                    <th class="bv-col-pot">Potencia</th>
                    <th class="bv-col-ene">Energía (Neto)</th>
                    <th class="bv-col-imp">Impuestos</th>
                    <th class="bv-col-sub">Subtotal</th>
                    <th class="bv-col-hucha">Uso Hucha</th>
                    <th class="bv-col-pagar">A Pagar</th>
                    <th class="bv-col-saldo">Saldo Hucha</th>
                  </tr>
                </thead>
                <tbody>
                  ${buildDetailedRows(r.rows, r.tarifa.tipo === 'INDEXADA')}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      `).join('');

      // --- RENDER FINAL ---
      const totalImp = monthlyResult.months.reduce((a, b) => a + b.importTotalKWh, 0);
      const totalExp = monthlyResult.months.reduce((a, b) => a + b.exportTotalKWh, 0);
      const totalAuto = result.records.reduce((a, b) => a + (Number(b.autoconsumo) || 0), 0);
      const hasAuto = totalAuto > 0;
      
      // Estimación coste sin placas (muy simplificada: precio medio 0.15€ + potencia)
      const diasTotales = monthlyResult.months.reduce((a, b) => a + b.spanDays, 0);
      const costeSinPlacas = (totalImp + totalAuto) * 0.15 + (p1Val * 0.08 * diasTotales);
      const ahorroTotal = costeSinPlacas - winner.totals.pagado;
      const ahorroPct = Math.round((ahorroTotal / costeSinPlacas) * 100);

      resultsEl.innerHTML = `
        <div class="heroKpis" style="margin-bottom: 2rem;">
          <div class="heroCard best" style="width:100%; max-width:none">
            <div class="k">Mejor opción para ti</div>
            <div class="v" style="font-size:clamp(1.5rem, 5vw, 2.5rem)">${winnerName}</div>
            <div class="s">de ${winnerCompany}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
           <div class="heroCard" style="text-align:center">
             <div class="k">Pagarías en este periodo</div>
             <div class="v" style="color:var(--primary-light)">${winnerCost}</div>
             <div class="s">Total con impuestos</div>
           </div>
           <div class="heroCard" style="text-align:center">
             <div class="k">Dinero que te sobra</div>
             <div class="v" style="color:#fbbf24">${winnerHucha}</div>
             <div class="s">En tu hucha virtual</div>
           </div>
        </div>

        ${ahorroPct > 0 ? `<div style="margin-bottom: 2rem; text-align:center;"><span class="pill" style="background:rgba(16,185,129,0.1); color:#10b981; border:1px solid rgba(16,185,129,0.2); font-weight:700; padding:8px 24px; font-size:1.1rem">📉 Estás ahorrando un ${ahorroPct}% en tu factura</span></div>` : ''}

        <div style="text-align:center; margin-bottom: 2.5rem;">
          ${winnerWeb ? `<a href="${winnerWeb}" target="_blank" class="btn primary" style="padding: 14px 40px; font-size: 1.2rem; border-radius: 99px;">Ver esta tarifa &rarr;</a>` : ''}
        </div>
          <details style="margin-top: 20px; text-align: left;">
            <summary style="font-size: 0.8rem; cursor: pointer; opacity: 0.9; text-align: center;">Ver cuentas detalladas del ganador</summary>
            ${isWinnerIndexada ? '<div style="font-size:10px; color:#fbbf24; text-align:center; margin-bottom:8px;">* Al ser tarifa indexada, los excedentes se han estimado a 0,06 €/kWh</div>' : ''}
            <div class="bv-table-container" style="border:none; border-radius:8px; margin-top:10px; background:rgba(0,0,0,0.2);">
              <table class="bv-table" style="font-size:10px; color: white;">
                <thead>
                  <tr>
                    <th class="bv-col-mes" style="text-align:left; color: white;">Mes</th>
                    <th class="bv-col-pot" style="color: white;">Potencia</th>
                    <th class="bv-col-ene" style="color: white;">Energía (Neto)</th>
                    <th class="bv-col-imp" style="color: white;">Impuestos</th>
                    <th class="bv-col-sub" style="color: white;">Subtotal</th>
                    <th class="bv-col-hucha" style="color: white;">Uso Hucha</th>
                    <th class="bv-col-pagar" style="color: white;">A Pagar</th>
                    <th class="bv-col-saldo" style="color: white;">Saldo Hucha</th>
                  </tr>
                </thead>
                <tbody>
                  ${winnerRowsHtml}
                </tbody>
              </table>
            </div>
            <div style="text-align:center; margin-top:12px;">
              <button class="btn" id="bv-download-csv" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); font-size:0.8rem; padding:6px 16px;">📥 Descargar resumen CSV</button>
            </div>
          </details>
        </div>

        <div class="card u-mb-24" style="background:rgba(255,255,255,0.03);">
          <h3 class="u-mb-16">📊 Resumen de tu energía</h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
            <div style="background:rgba(0,0,0,0.2); padding:1rem; border-radius:12px; text-align:center;">
              <div style="font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Comprado (Red)</div>
              <div style="font-size:1.5rem; font-weight:700;">${fKwh(totalImp)} <small>kWh</small></div>
            </div>
            <div style="background:rgba(0,0,0,0.2); padding:1rem; border-radius:12px; text-align:center;">
              <div style="font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Vendido (Sobrante)</div>
              <div style="font-size:1.5rem; font-weight:700; color:#fbbf24;">${fKwh(totalExp)} <small>kWh</small></div>
            </div>
            ${hasAuto ? `
            <div style="background:rgba(0,0,0,0.2); padding:1rem; border-radius:12px; text-align:center;">
              <div style="font-size:0.8rem; color:var(--muted); margin-bottom:4px;">Autoconsumido</div>
              <div style="font-size:1.5rem; font-weight:700; color:#10b981;">${fKwh(totalAuto)} <small>kWh</small></div>
            </div>
            ` : ''}
          </div>
          
          ${hasAuto ? `
          <div style="margin-top:1rem;">
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:6px;">
              <span>Independencia Energética</span>
              <span style="font-weight:700;">${Math.round((totalAuto / (totalImp + totalAuto)) * 100)}%</span>
            </div>
            <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:99px; overflow:hidden;">
              <div style="width:${Math.round((totalAuto / (totalImp + totalAuto)) * 100)}%; height:100%; background:#10b981;"></div>
            </div>
          </div>
          ` : ''}
          
          <p style="font-size:0.85rem; color:var(--muted); margin-top:1rem;">
            ${monthlyResult.months.length < 12 ? `⚠️ Nota: Esta simulación solo cubre <strong>${monthlyResult.months.length} meses</strong>. Los totales no representan un año completo.` : 'Simulación basada en un año completo de datos.'}
          </p>
        </div>

        <div class="card u-mb-24">
          <h3 class="u-mb-16">Otras opciones buenas</h3>
          ${othersHtml}
        </div>

        <div class="card" style="background: rgba(0,0,0,0.2); border: 1px dashed rgba(255,255,255,0.1);">
          <h4 class="u-mb-16" style="color: var(--primary-light); display: flex; align-items: center; gap: 8px;">
             <span>🛠️</span> Ficha Técnica de la Simulación
          </h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; font-size: 0.85rem; color: var(--muted);">
             <div>
               <strong style="color: #fff; display: block; margin-bottom: 4px;">Algoritmo de Cálculo</strong>
               Simulación horaria real. Agrupación por periodos P1, P2, P3 según calendario oficial 2026.
             </div>
             <div>
               <strong style="color: #fff; display: block; margin-bottom: 4px;">Impuestos Aplicados</strong>
               IVA: 21% (Ley 37/1992). IEE: 5,11% (mín. 0,5€/MWh).
             </div>
             <div>
               <strong style="color: #fff; display: block; margin-bottom: 4px;">Costes Regulados</strong>
               Bono Social: 6,97€/año. Alquiler: 0,81€/mes.
             </div>
             <div>
               <strong style="color: #fff; display: block; margin-bottom: 4px;">Lógica Batería Virtual</strong>
               1. Compensación (hasta límite energía). 2. Sobrante a hucha (€). 3. Hucha descuenta del total.
             </div>
          </div>
        </div>
      `;

      resultsContainer.style.display = 'block';
      setTimeout(() => resultsContainer.classList.add('show'), 10);
      statusContainer.style.display = 'none';

      // Listener para descarga
      const dlBtn = document.getElementById('bv-download-csv');
      if (dlBtn) dlBtn.addEventListener('click', () => window.BVSim.downloadCSV(winner));
      
    } catch (e) {
      console.error('Error:', e);
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">⚠️ Error: ${e.message}</span>`;
      if (statusContainer) statusContainer.style.display = 'block';
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Calcular Ahorro 🚀';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
})();