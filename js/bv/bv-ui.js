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
  const numberFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 }); // Sin decimales o 1 para kWh
  const numberFmtPrecise = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const fEur = (v) => currencyFmt.format(Number(v) || 0);
  const fKwh = (v) => numberFmt.format(Number(v) || 0);
  const fNum = (v) => numberFmtPrecise.format(Number(v) || 0);

  // Diccionario de Ayuda (Tooltips)
  const HELP = {
    import: "Energía que compras de la red (cuando tus placas no producen suficiente).",
    export: "Energía que te sobra de las placas e inyectas a la red.",
    pagado: "Lo que realmente sale de tu bolsillo tras aplicar la batería virtual.",
    real: "Lo que hubieras pagado sin tener saldo acumulado de meses anteriores (indica lo buena que es la tarifa).",
    huchaFin: "Dinero que te sobra al final del año para usar en facturas futuras.",
    comp: "Valor de tus excedentes compensados en la factura del mes (hasta el límite legal).",
    ahorro: "Dinero de tus excedentes que va a la Batería Virtual porque ya has compensado toda la energía."
  };

  function renderTooltip(text) {
    return `<div class="bv-th-content" title="${text}">${text.substring(0, 15)}... <span class="bv-icon-info">?</span></div>`;
  }
  
  function thWithTooltip(label, helpKey) {
    const help = HELP[helpKey] || "";
    return `
      <th title="${help}">
        <div class="bv-th-content">
          ${label}
          <span class="bv-icon-info">?</span>
        </div>
      </th>
    `;
  }

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
      statusEl.innerHTML = '<span class="spinner"></span> Procesando archivo...';
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
    if (btnText) btnText.textContent = 'Calculando...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    await new Promise(r => setTimeout(r, 100));

    try {
      if (typeof window.BVSim.importFile !== 'function') throw new Error('Módulo de importación no cargado');

      const result = await window.BVSim.importFile(file);
      window.BVSim.importResult = result;
      
      if (!result || !result.ok) throw new Error(result?.error || 'Error al procesar el archivo');

      const monthlyResult = window.BVSim.simulateMonthly(result, p1Val, p2Val);
      
      if (!monthlyResult || !monthlyResult.ok) throw new Error('Error en la simulación mensual');

      // --- RENDER RESULTADOS ---
      
      // 1. Tabla Análisis Mensual (Simplificada)
      const rowsHtml = monthlyResult.months.map((month) => {
        const isWarning = month.coveragePct < 95 || month.spanDays !== month.daysWithData;
        
        // Formatear fechas legibles
        const [y, m] = month.key.split('-');
        const dateObj = new Date(y, m - 1);
        const mesNombre = dateObj.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const mesCorto = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);

        const warningHtml = isWarning
          ? `<span title="Faltan datos (${month.daysWithData}/${month.daysInMonth} días)" style="color:#F59E0B; cursor:help">⚠️ Parcial</span>`
          : '<span style="color:var(--muted); opacity:0.5">✓</span>';
        
        return `
          <tr>
            <td style="text-align:left; font-weight:600; color:#fff;">
              ${mesCorto}
            </td>
            <td>${fKwh(month.importTotalKWh)}</td>
            <td class="bv-val-pos">${fKwh(month.exportTotalKWh)}</td>
            <td style="font-size:12px; color:var(--muted)">${fKwh(month.importByPeriod.P1)}</td>
            <td style="font-size:12px; color:var(--muted)">${fKwh(month.importByPeriod.P2)}</td>
            <td style="text-align:center">${warningHtml}</td>
          </tr>
        `;
      }).join('');

      // Calcular totales anuales para el resumen
      const totalImp = monthlyResult.months.reduce((a, b) => a + b.importTotalKWh, 0);
      const totalExp = monthlyResult.months.reduce((a, b) => a + b.exportTotalKWh, 0);

      resultsEl.innerHTML = `
        <div class="u-mt-8">
          <div class="bv-summary-cards">
             <div class="bv-card">
                <div class="bv-card-title">Consumo de Red</div>
                <div class="bv-card-value">${fKwh(totalImp)} <span style="font-size:1rem; font-weight:400">kWh</span></div>
             </div>
             <div class="bv-card">
                <div class="bv-card-title">Excedentes</div>
                <div class="bv-card-value" style="color:#10b981">${fKwh(totalExp)} <span style="font-size:1rem; font-weight:400">kWh</span></div>
             </div>
          </div>

          <h3 class="u-mb-8">1. Tu Perfil de Consumo</h3>
          <p class="u-mb-16" style="color:var(--muted); font-size:0.9rem">
            Estos son los datos que hemos leído de tu fichero. Comprueba que te parecen correctos.
          </p>

          <div class="bv-table-container">
            <table class="bv-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  ${thWithTooltip('Consumo', 'import')}
                  ${thWithTooltip('Excedente', 'export')}
                  <th><span style="font-size:10px; font-weight:400">Punta</span></th>
                  <th><span style="font-size:10px; font-weight:400">Valle</span></th>
                  <th style="text-align:center">Estado</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="6" class="empty">Sin datos mensuales.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // 2. Ranking Tarifas BV
      if (typeof window.BVSim.loadTarifasBV === 'function') {
        const tarifasResult = await window.BVSim.loadTarifasBV();
        
        if (tarifasResult.ok && tarifasResult.tarifasBV.length > 0) {
          const allResults = window.BVSim.simulateForAllTarifasBV({
            months: monthlyResult.months,
            tarifasBV: tarifasResult.tarifasBV,
            potenciaP1: p1Val, potenciaP2: p2Val, bvSaldoInicial: saldoVal
          });

          if (allResults.ok) {
            const rankedResults = [...allResults.results].sort((a, b) => {
              const diffReal = a.totals.real - b.totals.real; // Coste anual real
              // Si el coste es igual (o muy similar), desempata quien deje más hucha
              if (Math.abs(diffReal) < 0.01) {
                  return b.totals.bvFinal - a.totals.bvFinal;
              }
              return diffReal;
            });

            // Función para pintar la tabla detalle de cada tarifa
            const buildMonthlyRows = (rows) => rows.map((row) => {
               // Formateo ligero para la tabla detalle
               return `
              <tr>
                <td style="text-align:left; color:#fff; font-weight:600; font-size:12px">${row.key}</td>
                <td class="bv-val-pos" style="font-size:12px">+${fEur(row.credit1)}</td>
                <td class="bv-val-pos" style="font-size:12px; font-weight:700">+${fEur(row.excedenteSobranteEur)}</td>
                <td class="bv-val-highlight" style="font-size:12px; background:rgba(255,255,255,0.05)">${fEur(row.bvSaldoFin)}</td>
                <td class="bv-val-eur" style="font-weight:700">${fEur(row.totalPagar)}</td>
              </tr>
            `}).join('');

            const rankingRowsHtml = rankedResults.map((result, index) => {
              const isBest = index === 0;
              const rowClass = isBest ? 'bv-row-best' : '';
              const badge = isBest ? '<div class="bv-badge-rank bv-badge-best">🏆</div>' : `<div class="bv-badge-rank">${index+1}</div>`;
              
              const companyName = result.tarifa.comercializadora || '';
              const companyHtml = companyName 
                ? `<div style="font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase; margin-top:2px">${companyName}</div>`
                : '';
              
              const linkHtml = result.tarifa.web 
                ? `<a href="${result.tarifa.web}" target="_blank" rel="noopener" style="font-size:11px; color:var(--primary); text-decoration:none; display:inline-block; margin-top:2px">Ver web →</a>` 
                : '';

              return `
              <tr class="${rowClass}">
                <td style="text-align:center; padding-left:1rem">${badge}</td>
                <td style="text-align:left">
                  <div style="font-weight:800; font-size:1.1rem; color:#fff;">${result.tarifa.nombre}</div>
                  ${companyHtml}
                  ${linkHtml}
                </td>
                <td class="bv-val-eur" style="font-size:1.2rem; font-weight:800">${fEur(result.totals.pagado)}</td>
                <td class="bv-val-neutral" style="font-size:0.9rem">${fEur(result.totals.real)}</td>
                <td class="bv-val-highlight" style="font-size:1rem">${fEur(result.totals.bvFinal)}</td>
              </tr>
              <tr class="bv-details-row ${rowClass}">
                <td colspan="5">
                  <details class="bv-details-container">
                    <summary class="bv-details-summary">
                      <span>Ver detalle mes a mes</span>
                      <span style="font-size:10px; margin-left:8px; opacity:0.7">(${fEur(result.totals.credit2Total)} usados de hucha)</span>
                    </summary>
                    <div class="bv-table-container" style="border:none; border-radius:0; margin:0; box-shadow:none; background:rgba(0,0,0,0.3)">
                      <table class="bv-table">
                        <thead>
                          <tr>
                            <th style="text-align:left">Mes</th>
                            <th>Compensado</th>
                            <th>A Hucha</th>
                            <th>Hucha Fin</th>
                            <th>A Pagar</th>
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
              <div class="u-mt-24">
                <h3 class="u-mb-8">2. Comparativa de Tarifas</h3>
                <p class="u-mb-16" style="color:var(--muted); font-size:0.9rem">
                  Hemos simulado tu año completo con cada tarifa. Aquí tienes las mejores opciones para tu caso.
                </p>
                <div class="bv-table-container">
                  <table class="bv-table">
                    <thead>
                      <tr>
                        <th style="text-align:center; width:60px">#</th>
                        <th style="text-align:left">Tarifa</th>
                        ${thWithTooltip('A Pagar (Año)', 'pagado')}
                        ${thWithTooltip('Coste Sin Hucha', 'real')}
                        ${thWithTooltip('Hucha Sobrante', 'huchaFin')}
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

      resultsContainer.style.display = 'block';
      setTimeout(() => {
        resultsContainer.classList.add('show');
      }, 10);
      statusContainer.style.display = 'none';
      
    } catch (e) {
      console.error('Error en simulación:', e);
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">⚠️ ${e.message}</span>`;
      if (statusContainer) statusContainer.style.display = 'block';
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Simular Escenario Anual';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
})();