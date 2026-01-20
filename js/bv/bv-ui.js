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

  // --- UI INITIALIZATION --- 
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

  // Formateadores (ES): en tooltips y tablas los decimales deben usar coma
  const currencyFmt = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  const kwhFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kwFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const priceFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 6 });

  const fEur = (v) => currencyFmt.format(Number(v) || 0);
  const fKwh = (v) => kwhFmt.format(Number(v) || 0);
  const fKw = (v) => kwFmt.format(Number(v) || 0);
  const fPrice = (v) => priceFmt.format(Number(v) || 0);

  function parseInput(val) {
    if (val === undefined || val === null || val === '') return 0;
    const normalized = String(val).replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  }

  if (!fileInput || !simulateButton) {
    console.error('BVSim: Critical elements missing (fileInput or simulateButton)');
    return;
  }

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
    dropZone.addEventListener('click', () => {
      fileInput.click();
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
    console.log('BVSim: Simulation started...');
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

      // Mapa de consumos por mes (para desglose por periodos en tooltips)
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
      const totalImp = monthlyResult.months.reduce((a, b) => a + b.importTotalKWh, 0);
      const totalAuto = result.records.reduce((a, b) => a + (Number(b.autoconsumo) || 0), 0);
      const diasTotales = monthlyResult.months.reduce((a, b) => a + b.spanDays, 0);
      const costeSinPlacas = (totalImp + totalAuto) * 0.15 + (p1Val * 0.08 * diasTotales);
      const ahorroPct = Math.round(((costeSinPlacas - winner.totals.pagado) / costeSinPlacas) * 100);

      const r2 = (window.BVSim && typeof window.BVSim.round2 === 'function')
        ? window.BVSim.round2
        : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

      const buildDetailedRows = (rows, isIndexada) => rows.map((row) => {
        const m = monthMap.get(row.key) || {};

        const imp = r2((Number(row.impuestoElec) || 0) + (Number(row.ivaCuota) || 0) + (Number(row.costeBonoSocial) || 0) + (Number(row.alquilerContador) || 0));
        const energiaBruta = r2(Number(row.consEur) || 0);
        const descuentoExc = r2(Number(row.credit1) || 0);
        const energiaNeta = r2(energiaBruta - descuentoExc);
        const subtotal = r2(Number(row.totalBase) || 0);
        const restoHucha = Math.max(0, (Number(row.bvSaldoPrev) || 0) - (Number(row.credit2) || 0));

        // Detalle de potencia
        const potP1 = r2((Number(p1Val) || 0) * (Number(row.dias) || 0) * (Number(winner.tarifa.p1) || 0));
        const potP2 = r2((Number(p2Val) || 0) * (Number(row.dias) || 0) * (Number(winner.tarifa.p2) || 0));

        // Detalle de energía por periodos (kWh x €/kWh)
        const kwhP1 = Number(m?.importByPeriod?.P1) || 0;
        const kwhP2 = Number(m?.importByPeriod?.P2) || 0;
        const kwhP3 = Number(m?.importByPeriod?.P3) || 0;
        const cP1 = Number(winner.tarifa.cPunta) || 0;
        const cP2 = Number(winner.tarifa.cLlano) || 0;
        const cP3 = Number(winner.tarifa.cValle) || 0;
        const eP1 = r2(kwhP1 * cP1);
        const eP2 = r2(kwhP2 * cP2);
        const eP3 = r2(kwhP3 * cP3);

        // Excedentes
        const exKwh = Number(m?.exportTotalKWh) || Number(row.exKwh) || 0;
        const precioExc = Number(row.precioExc) || 0;
        const creditoPotencial = r2(exKwh * precioExc);

        // Tooltip strings (fórmulas)
        const tipPot = [
          `P1: ${fKw(p1Val)} kW × ${row.dias} días × ${fPrice(winner.tarifa.p1)} €/kW·día = ${fEur(potP1)}`,
          `P2: ${fKw(p2Val)} kW × ${row.dias} días × ${fPrice(winner.tarifa.p2)} €/kW·día = ${fEur(potP2)}`,
          `Total Potencia = ${fEur(row.pot)}`
        ].join('\n');

        const tipEneBruta = [
          `Punta: ${fKwh(kwhP1)} kWh × ${fPrice(cP1)} €/kWh = ${fEur(eP1)}`,
          `Llano: ${fKwh(kwhP2)} kWh × ${fPrice(cP2)} €/kWh = ${fEur(eP2)}`,
          `Valle: ${fKwh(kwhP3)} kWh × ${fPrice(cP3)} €/kWh = ${fEur(eP3)}`,
          `Total Energía Bruta = ${fEur(energiaBruta)}`
        ].join('\n');

        const tipExcedentes = [
          `Excedentes: ${fKwh(exKwh)} kWh × ${fPrice(precioExc)} €/kWh = ${fEur(creditoPotencial)}`,
          `Descuento aplicado (límite coste energía): min(${fEur(creditoPotencial)}, ${fEur(energiaBruta)}) = ${fEur(descuentoExc)}`,
          `Sobrante para hucha = ${fEur(row.excedenteSobranteEur)}`
        ].join('\n');

        const tipEneNeta = `Energía Neta = Energía Bruta (${fEur(energiaBruta)}) - Descuento Excedentes (${fEur(descuentoExc)}) = ${fEur(energiaNeta)}`;

        const tipImp = `IEE: ${fEur(row.impuestoElec)}\nIVA/IGIC/IPSI: ${fEur(row.ivaCuota)}\nAlquiler/Bono Social: ${fEur((Number(row.costeBonoSocial) || 0) + (Number(row.alquilerContador) || 0))}`;
        const tipSub = `Suma de:\nPotencia (${fEur(row.pot)})\n+ Energía Neta (${fEur(energiaNeta)})\n+ Impuestos/Cargos (${fEur(imp)})`;
        const tipHucha = `Saldo disponible: ${fEur(row.bvSaldoPrev)}\nUsado para esta factura: -${fEur(row.credit2)}`;
        const tipPagar = `Importe factura (${fEur(subtotal)}) - Uso Hucha (${fEur(row.credit2)})`;
        const tipSaldo = `Restante (${fEur(restoHucha)}) + Nuevo Excedente (${fEur(row.excedenteSobranteEur)})`;

        return `
          <tr>
            <td style="text-align:left; font-weight:700; color:var(--text);">${row.key}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipPot}" tabindex="0">${fEur(row.pot)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipEneBruta}" tabindex="0">${fEur(energiaBruta)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipExcedentes}" tabindex="0" style="color:var(--muted); font-weight:600;">${descuentoExc > 0 ? `-${fEur(descuentoExc)}` : fEur(0)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipEneNeta}" tabindex="0" style="font-weight:600;">${fEur(energiaNeta)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipImp}" tabindex="0" style="color:var(--danger); font-weight:600;">${fEur(imp)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipSub}" tabindex="0" style="font-weight:700; background:rgba(255,255,255,0.03);">${fEur(subtotal)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipHucha}" tabindex="0">
                <span class="bv-val-hucha-use">-${fEur(row.credit2)}</span>
            </td>
            <td class="bv-tooltip-trigger" data-tip="${tipPagar}" tabindex="0" style="color:var(--accent2); font-weight:700;">${fEur(row.totalPagar)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipSaldo}" tabindex="0" style="color:#fbbf24; font-weight:700;">${fEur(row.bvSaldoFin)}</td>
          </tr>
        `;
      }).join('');

      resultsEl.innerHTML = `
        <h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>

        <div class="bv-results-grid">
          <div class="bv-winner-card-compact">
            <div class="bv-winner-badge">🏆 Opción Ganadora</div>
            <div class="bv-winner-name">${winner.tarifa.nombre}</div>
            <div class="bv-winner-company">de ${winner.tarifa.comercializadora || 'Compañía Desconocida'}</div>
            
            <div style="margin-top:auto; padding-top:1.5rem; width:100%">
              ${winner.tarifa.web ? `<a href="${winner.tarifa.web}" target="_blank" class="btn primary" style="width:100%; justify-content:center;">Ver esta tarifa &rarr;</a>` : ''}
            </div>
          </div>

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

        <details style="margin-top: 32px; margin-bottom: 48px;">
          <summary style="font-size: 1.1rem; font-weight: 700; cursor: pointer; text-align: center; color: var(--text); padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card2); transition: all 0.2s;">Ver desglose detallado mensual ▾</summary>
          ${isWinnerIndexada ? '<div style="font-size:11px; color:#fbbf24; text-align:center; margin:12px 0;">* Excedentes estimados a 0,06 €/kWh (indexada)</div>' : ''}
          <div class="bv-table-container">
	            <table class="bv-table">
	              <colgroup>
	                <col class="bv-col-month">
	                <col class="bv-col-pot">
	                <col class="bv-col-energy-gross">
	                <col class="bv-col-excedentes">
	                <col class="bv-col-energy-net">
	                <col class="bv-col-tax">
	                <col class="bv-col-subtotal">
	                <col class="bv-col-use">
	                <col class="bv-col-pay">
	                <col class="bv-col-balance">
	              </colgroup>
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
              <tbody>${buildDetailedRows(winner.rows, isWinnerIndexada)}</tbody>
            </table>
          </div>
        </details>

        <div class="u-mb-24">
          <h3 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 1.5rem; text-align: center; color:var(--text);">Otras alternativas top</h3>
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
      
      // --- SISTEMA DE TOOLTIPS FLOTANTES (Anti-Recorte) ---
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

	        // El tooltip es position:fixed, por tanto se posiciona en coordenadas de viewport
	        tooltipEl.style.top = `${top}px`;
	        tooltipEl.style.left = `${left}px`;
      };

      const hideTooltip = () => {
        tooltipEl.style.display = 'none';
      };

      const triggers = resultsEl.querySelectorAll('.bv-tooltip-trigger');
      console.log(`BVSim: Attaching floating tooltips to ${triggers.length} elements.`);
      
      triggers.forEach(el => {
        const tip = el.getAttribute('data-tip');
        el.addEventListener('mouseenter', (e) => showTooltip(e, tip));
        el.addEventListener('mouseleave', hideTooltip);
        el.addEventListener('focus', (e) => showTooltip(e, tip));
        el.addEventListener('blur', hideTooltip);
      });
      
    } catch (e) {
      console.error('BVSim Error:', e);
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">⚠️ Error: ${e.message}</span>`;
    } finally {
      simulateButton.disabled = false;
      if (btnText) btnText.textContent = 'Calcular Ahorro 🚀';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
});