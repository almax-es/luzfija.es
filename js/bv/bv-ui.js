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
  const currencyFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  const numberFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const fEur = (v) => currencyFmt.format(Number(v) || 0);
  const fNum = (v) => numberFmt.format(Number(v) || 0);
  const fPct = (v) => pctFmt.format((Number(v) || 0) / 100);

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
    console.log('Click en simular');
    const file = window.BVSim.file;
    const p1Val = p1Input.value === '' ? 0 : parseInput(p1Input.value);
    const p2Val = p2Input.value === '' ? 0 : parseInput(p2Input.value);
    const saldoVal = saldoInput.value === '' ? 0 : parseInput(saldoInput.value);

    console.log('Valores:', { file, p1Val, p2Val, saldoVal });

    // Reset visual
    if (p1Input) p1Input.classList.remove('error');
    if (p2Input) p2Input.classList.remove('error');
    if (saldoInput) saldoInput.classList.remove('error');
    
    if (resultsContainer) {
      resultsContainer.classList.remove('show');
      resultsContainer.style.display = 'none';
    }
    if (statusContainer) {
      statusContainer.style.display = 'block';
      statusEl.innerHTML = '<span class="spinner"></span> Iniciando simulación...';
    }

    if (!file) {
      alert('Por favor, selecciona un archivo CSV o XLSX primero.');
      return;
    }

    if (p1Val <= 0) {
      alert('La potencia P1 debe ser mayor que 0.');
      return;
    }
    
    simulateButton.disabled = true;
    if (btnText) btnText.textContent = 'Procesando...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    await new Promise(r => setTimeout(r, 100));

    try {
      if (typeof window.BVSim.importFile !== 'function') throw new Error('Módulo de importación no cargado');

      const result = await window.BVSim.importFile(file);
      window.BVSim.importResult = result;
      console.log('Resultado Import:', result);

      if (!result || !result.ok) throw new Error(result?.error || 'Error al procesar el archivo');

      const monthlyResult = window.BVSim.simulateMonthly(result, p1Val, p2Val);
      console.log('Resultado Mensual:', monthlyResult);

      if (!monthlyResult || !monthlyResult.ok) throw new Error('Error en la simulación mensual');

      // --- RENDER RESULTADOS ---
      console.log('Renderizando tabla mensual...');
      
      // 1. Tabla Análisis Mensual
      const rowsHtml = monthlyResult.months.map((month) => {
        const isWarning = month.coveragePct < 95 || month.spanDays !== month.daysWithData;
        
        // Formatear fechas legibles
        const [y, m] = month.key.split('-');
        const dateObj = new Date(y, m - 1);
        const mesNombre = dateObj.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const mesCorto = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);

        const warningHtml = isWarning
          ? `<span class="badge" style="background:rgba(245,158,11,.2); color:#F59E0B; border:1px solid #F59E0B; font-size:10px" title="Faltan datos en este mes">⚠️ ${month.daysWithData}/${month.daysInMonth} días</span>`
          : '<span class="badge b1" style="transform:none; box-shadow:none; padding:2px 6px; font-size:10px">Completo</span>';
        
        return `
          <tr>
            <td style="text-align:left; min-width:180px; z-index:10; position:sticky; left:0; background:#0B1020; border-right:1px solid rgba(255,255,255,0.1)">
              <div style="font-weight:800; color:#fff; font-size:14px; margin-bottom:4px; white-space:nowrap">${mesCorto}</div>
              <div style="font-size:10px; color:var(--muted); font-family:var(--mono); white-space:nowrap">${month.start} → ${month.end}</div>
            </td>
            <td style="font-weight:700; color:#fff">${fNum(month.importTotalKWh)}</td>
            <td class="bv-val-pos">${fNum(month.exportTotalKWh)}</td>
            <td class="bv-val-neutral" style="font-size:12px">${fNum(month.importByPeriod.P1)}</td>
            <td class="bv-val-neutral" style="font-size:12px">${fNum(month.importByPeriod.P2)}</td>
            <td class="bv-val-neutral" style="font-size:12px">${fNum(month.importByPeriod.P3)}</td>
            <td style="text-align:center">${warningHtml}</td>
          </tr>
        `;
      }).join('');

      resultsEl.innerHTML = `
        <div class="u-mt-8">
          <h3 class="u-mb-8">1. Tu Perfil de Consumo</h3>
          <div class="bv-table-container">
            <table class="bv-table">
              <thead>
                <tr>
                  <th style="text-align:left">Periodo</th>
                  <th>Consumo (kWh)</th>
                  <th>Excedente (kWh)</th>
                  <th>P1</th>
                  <th>P2</th>
                  <th>P3</th>
                  <th style="text-align:center">Calidad Datos</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="7" class="empty">Sin datos mensuales.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // 2. Ranking Tarifas BV
      if (typeof window.BVSim.loadTarifasBV === 'function') {
        const tarifasResult = await window.BVSim.loadTarifasBV();
        console.log('Tarifas cargadas:', tarifasResult);

        if (tarifasResult.ok && tarifasResult.tarifasBV.length > 0) {
          console.log(`Simulando ${tarifasResult.tarifasBV.length} tarifas...`);
          const allResults = window.BVSim.simulateForAllTarifasBV({
            months: monthlyResult.months,
            tarifasBV: tarifasResult.tarifasBV,
            potenciaP1: p1Val, potenciaP2: p2Val, bvSaldoInicial: saldoVal
          });

          if (allResults.ok) {
            console.log('Simulación masiva completada:', allResults.results.length);
            const rankedResults = [...allResults.results].sort((a, b) => {
              const diffReal = a.totals.real - b.totals.real;
              return diffReal !== 0 ? diffReal : b.totals.bvFinal - a.totals.bvFinal;
            });

            const buildMonthlyRows = (rows) => rows.map((row) => `
              <tr>
                <td style="text-align:left; color:#fff; font-weight:700">${row.key}</td>
                <td style="font-size:12px; color:var(--muted)">${row.dias}d</td>
                <td class="bv-val-neutral">${fNum(row.exKwh)}</td>
                <td class="bv-val-pos">+${fEur(row.credit1)}</td>
                <td class="bv-val-pos" style="font-weight:900">+${fEur(row.excedenteSobranteEur)}</td>
                <td style="color:#aaa">${fEur(row.bvSaldoPrev)}</td>
                <td class="bv-val-pos">-${fEur(row.credit2)}</td>
                <td class="bv-val-highlight" style="background:rgba(255,255,255,0.1); border-radius:4px">${fEur(row.bvSaldoFin)}</td>
                <td class="bv-val-eur">${fEur(row.totalPagar)}</td>
                <td class="bv-val-highlight">${fEur(row.totalReal)}</td>
              </tr>
            `).join('');

            const rankingRowsHtml = rankedResults.map((result, index) => {
              const isBest = index === 0;
              const rowClass = isBest ? 'best' : '';
              const badge = isBest ? '<div class="bv-badge-rank bv-badge-best">🏆</div>' : `<div class="bv-badge-rank">${index+1}</div>`;
              
              const companyName = result.tarifa.comercializadora || '';
              const companyHtml = companyName 
                ? `<div style="font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase">${companyName}</div>`
                : '';

              return `
              <tr class="bv-ranking-row ${rowClass}">
                <td style="text-align:center">${badge}</td>
                <td style="text-align:left">
                  <div style="font-weight:900; font-size:16px; color:#fff; margin-bottom:2px">${result.tarifa.nombre}</div>
                  ${companyHtml}
                </td>
                <td class="bv-val-eur" style="font-size:16px">${fEur(result.totals.pagado)}</td>
                <td class="bv-val-highlight" style="font-size:16px">${fEur(result.totals.real)}</td>
                <td class="bv-val-pos" style="font-size:15px">${fEur(result.totals.bvFinal)}</td>
                <td class="bv-val-neutral" style="font-size:13px">${fEur(result.totals.credit1Total)}</td>
                <td class="bv-val-neutral" style="font-size:13px">${fEur(result.totals.credit2Total)}</td>
              </tr>
              <tr class="bv-details-row">
                <td colspan="7">
                  <details class="bv-details-container">
                    <summary class="bv-details-summary">
                      Ver desglose mensual de la hucha 
                      <span style="font-weight:400; color:var(--muted); margin-left:auto; font-size:11px">(Clic para desplegar)</span>
                    </summary>
                    <div class="bv-table-container" style="border:none; border-radius:0; margin-top:0; box-shadow:none; background:transparent">
                      <table class="bv-table">
                        <thead>
                          <tr>
                            <th style="text-align:left">Mes</th>
                            <th>Días</th>
                            <th>Export kWh</th>
                            <th>€ Comp.</th>
                            <th>€ A Hucha</th>
                            <th>Hucha Ini</th>
                            <th>Uso Hucha</th>
                            <th>Hucha Fin</th>
                            <th>A Pagar</th>
                            <th>Coste Real</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${buildMonthlyRows(result.rows)}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </td>
              </tr>
            `;
            }).join('');

            resultsEl.insertAdjacentHTML('beforeend', `
              <div class="u-mt-16">
                <h3 class="u-mb-8">2. Ranking de Tarifas (Batería Virtual)</h3>
                <div class="bv-table-container">
                  <table class="bv-table">
                    <thead>
                      <tr>
                        <th style="text-align:center; width:50px">Pos</th>
                        <th style="text-align:left">Tarifa</th>
                        <th>Total Pagado</th>
                        <th>Coste Real (Anual)</th>
                        <th>Saldo Hucha Final</th>
                        <th>Compensado</th>
                        <th>Usado de Hucha</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rankingRowsHtml}
                    </tbody>
                  </table>
                </div>
              </div>
            `);
          }
        }
      }

      console.log('Mostrando contenedor de resultados...');
      resultsContainer.style.display = 'block';
      setTimeout(() => {
        resultsContainer.classList.add('show');
      }, 10);
      statusContainer.style.display = 'none';
      
    } catch (e) {
      console.error('Error en simulación:', e);
      if (statusEl) statusEl.innerHTML = `<span class="badge err">ERROR</span> ${e.message}`;
      if (statusContainer) statusContainer.style.display = 'block';
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Simular Escenario Anual';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
})();
