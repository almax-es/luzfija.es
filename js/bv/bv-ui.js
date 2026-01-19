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
  
  const simulateButton = document.getElementById('bv-simulate');
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
        potenciaP1: p1Val, potenciaP2: p2Val, bvSaldoInicial: saldoVal
      });

      if (!allResults.ok) throw new Error('Error en la simulación masiva.');

      const rankedResults = [...allResults.results].sort((a, b) => {
        const diffReal = a.totals.real - b.totals.real;
        if (Math.abs(diffReal) < 0.01) return b.totals.bvFinal - a.totals.bvFinal;
        return diffReal;
      });

      // --- HELPER RENDER TABLA DETALLE ---
      const buildDetailedRows = (rows) => rows.map((row) => {
        const impuestosYOtros = row.impuestoElec + row.ivaCuota + row.costeBonoSocial + row.alquilerContador;
        return `
          <tr>
            <td style="text-align:left; color:#fff; font-weight:600; font-size:12px">${row.key}</td>
            <td style="font-size:11px; color:var(--muted)">${fEur(row.pot)}</td>
            <td style="font-size:11px; color:var(--muted)">
                <div style="text-decoration:line-through; opacity:0.5; font-size:9px">${fEur(row.consEur)}</div>
                <div style="color:#10b981">-${fEur(row.credit1)}</div>
                <div style="font-weight:700">${fEur(row.consEur - row.credit1)}</div>
            </td>
            <td style="font-size:11px; color:#ef4444">${fEur(impuestosYOtros)}</td>
            <td style="font-weight:700; background:rgba(255,255,255,0.05)">${fEur(row.totalBase + row.ivaCuota)}</td>
            <td class="bv-val-pos" style="font-size:11px">
                <div style="color:var(--muted); font-size:9px">Tenías: ${fEur(row.bvSaldoPrev)}</div>
                <div>-${fEur(row.credit2)}</div>
            </td>
            <td class="bv-val-highlight" style="font-size:12px; font-weight:800">${fEur(row.totalPagar)}</td>
            <td style="font-size:11px; color:#fbbf24; font-weight:700">
                <div>+${fEur(row.excedenteSobranteEur)}</div>
                <div style="border-top:1px solid rgba(251,191,36,0.3)">${fEur(row.bvSaldoFin)}</div>
            </td>
          </tr>
        `;
      }).join('');

      // --- RENDER GANADORA ---
      const winner = rankedResults[0];
      const winnerName = winner.tarifa.nombre;
      const winnerCompany = winner.tarifa.comercializadora || '';
      const winnerCost = fEur(winner.totals.pagado);
      const winnerHucha = fEur(winner.totals.bvFinal);
      const winnerWeb = winner.tarifa.web;

      const winnerRowsHtml = buildDetailedRows(winner.rows);

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
            <div class="bv-table-container" style="border:none; border-radius:8px; margin-top:8px; background:rgba(0,0,0,0.2);">
              <table class="bv-table" style="font-size:10px;">
                <thead>
                  <tr>
                    <th style="text-align:left">Mes</th>
                    <th>Potencia</th>
                    <th>Energía (Neto)</th>
                    <th>Impuestos</th>
                    <th>Subtotal</th>
                    <th>Uso Hucha</th>
                    <th>A Pagar</th>
                    <th>Saldo Hucha</th>
                  </tr>
                </thead>
                <tbody>
                  ${buildDetailedRows(r.rows)}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      `).join('');

      // --- RENDER FINAL ---
      const totalImp = monthlyResult.months.reduce((a, b) => a + b.importTotalKWh, 0);
      const totalExp = monthlyResult.months.reduce((a, b) => a + b.exportTotalKWh, 0);

      resultsEl.innerHTML = `
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 2rem; border-radius: 16px; color: white; text-align: center; margin-bottom: 2rem; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4);">
          <div style="font-size: 1.2rem; margin-bottom: 0.5rem; opacity: 0.9;">🌟 La mejor opción para ti es</div>
          <div style="font-size: 3rem; font-weight: 800; line-height: 1.1; margin-bottom: 0.5rem;">${winnerName}</div>
          ${winnerCompany ? `<div style="font-size: 1.2rem; opacity: 0.9; margin-bottom: 1.5rem;">de ${winnerCompany}</div>` : ''}
          
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: rgba(0,0,0,0.2); padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem;">
             <div>
               <div style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 4px;">Pagarías al año</div>
               <div style="font-size: 2.5rem; font-weight: 800;">${winnerCost}</div>
             </div>
             <div style="border-left: 1px solid rgba(255,255,255,0.3);">
               <div style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 4px;">Dinero que te sobra</div>
               <div style="font-size: 2.5rem; font-weight: 800; color: #fbbf24;">${winnerHucha}</div>
             </div>
          </div>

          ${winnerWeb ? `<a href="${winnerWeb}" target="_blank" style="background: white; color: #059669; text-decoration: none; padding: 12px 32px; border-radius: 99px; font-weight: 800; font-size: 1.1rem; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">Ver esta tarifa &rarr;</a>` : ''}
          
          <details style="margin-top: 20px; text-align: left;">
            <summary style="font-size: 0.8rem; cursor: pointer; opacity: 0.9; text-align: center;">Ver cuentas detalladas del ganador</summary>
            <div class="bv-table-container" style="border:none; border-radius:8px; margin-top:10px; background:rgba(0,0,0,0.2);">
              <table class="bv-table" style="font-size:10px; color: white;">
                <thead>
                  <tr>
                    <th style="text-align:left; color: white;">Mes</th>
                    <th style="color: white;">Potencia</th>
                    <th style="color: white;">Energía (Neto)</th>
                    <th style="color: white;">Impuestos</th>
                    <th style="color: white;">Subtotal</th>
                    <th style="color: white;">Uso Hucha</th>
                    <th style="color: white;">A Pagar</th>
                    <th style="color: white;">Saldo Hucha</th>
                  </tr>
                </thead>
                <tbody>
                  ${winnerRowsHtml}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div class="card u-mb-24" style="background:rgba(255,255,255,0.03);">
          <h3 class="u-mb-16">📊 Resumen de tu consumo</h3>
          <p>Hemos analizado tu archivo. En total gastas <strong>${fKwh(totalImp)} kWh</strong> de luz de la calle, y tus placas producen <strong>${fKwh(totalExp)} kWh</strong> que te sobran para vender.</p>
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