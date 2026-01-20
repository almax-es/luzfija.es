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

      const buildDetailedRows = (rows, isIndexada) => rows.map((row) => {
        const imp = (row.impuestoElec || 0) + (row.ivaCuota || 0) + (row.costeBonoSocial || 0) + (row.alquilerContador || 0);
        const energiaBruta = row.consEur || 0;
        const descuentoExc = row.credit1 || 0;
        const energiaNeta = energiaBruta - descuentoExc;
        const subtotal = row.totalBase || 0;
        const restoHucha = Math.max(0, (row.bvSaldoPrev || 0) - (row.credit2 || 0));

        // Formulas detalladas para los tooltips
        const tipPot = `P1: ${fKw(p1Val)} kW x ${row.dias} días x ${fPrice(winner.tarifa.p1)} €/kW\nP2: ${fKw(p2Val)} kW x ${row.dias} días x ${fPrice(winner.tarifa.p2)} €/kW\nTOTAL = ${fEur(row.pot)}`;
        const tipEne = `Energía Bruta: ${fEur(energiaBruta)}
- Excedentes Mes: ${fEur(row.credit1)}
NETO = ${fEur(energiaNeta)}`;
        const tipImp = `IEE: ${fEur(row.impuestoElec)}
IVA: ${fEur(row.ivaCuota)}
Bono/Alquiler: ${fEur(row.costeBonoSocial + row.alquilerContador)}`;
        const tipSub = `Potencia (${fEur(row.pot)}) + Energía (${fEur(energiaNeta)}) + Impuestos (${fEur(imp)}) = ${fEur(subtotal)}`;
        const tipHucha = `Saldo Hucha previo: ${fEur(row.bvSaldoPrev)}
Usado ahora: -${fEur(row.credit2)}`;
        const tipPagar = `Subtotal (${fEur(subtotal)}) - Uso Hucha (${fEur(row.credit2)}) = ${fEur(row.totalPagar)}`;
        const tipSaldo = `Sobra Hucha (${fEur(restoHucha)}) + Excedentes no usados (${fEur(row.excedenteSobranteEur)}) = ${fEur(row.bvSaldoFin)}`;

        return `
          <tr>
            <td>${row.key}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipPot}">${fEur(row.pot)}</td>
            <td class="bv-tooltip-trigger" data-tip="Energía consumida sin descontar excedentes">${fEur(energiaBruta)}</td>
            <td class="bv-tooltip-trigger" data-tip="Excedentes aplicados a esta factura" style="color:var(--accent2);">${descuentoExc > 0 ? `-${fEur(descuentoExc)}` : fEur(0)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipEne}" style="font-weight:700;">${fEur(energiaNeta)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipImp}" style="color:var(--danger);">${fEur(imp)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipSub}" style="background:rgba(255,255,255,0.02); font-weight:700;">${fEur(subtotal)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipHucha}">-${fEur(row.credit2)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipPagar}" style="color:var(--accent2); font-weight:800;">${fEur(row.totalPagar)}</td>
            <td class="bv-tooltip-trigger" data-tip="${tipSaldo}" style="color:#fbbf24; font-weight:700;">${fEur(row.bvSaldoFin)}</td>
          </tr>
        `;
      }).join('');

      // Función para generar la tarjeta de cada resultado
      const renderResultCard = (r, i) => {
        const isWinner = i === 0;
        const isIndexada = r.tarifa.tipo === 'INDEXADA';
        const badgeHTML = isWinner 
          ? `<div class="bv-winner-badge">🏆 Mejor Opción</div>` 
          : `<div class="bv-alt-rank">#${i+1}</div>`;
        
        const cardClass = isWinner ? 'bv-winner-card-compact' : 'bv-alt-card-detailed';
        const rowsHtml = buildDetailedRows(r.rows, isIndexada);

        return `
          <div class="${cardClass}" style="margin-bottom: 32px; ${isWinner ? '' : 'background:var(--card); border:1px solid var(--border); padding:24px; border-radius:16px;'} ">
            ${badgeHTML}
            <h3 class="bv-winner-name" style="${isWinner ? '' : 'font-size:1.5rem;'} ">${r.tarifa.nombre}</h3>
            <div class="bv-winner-company">de ${r.tarifa.comercializadora || 'Compañía Desconocida'}</div>
            
            <div class="bv-kpis-stack" style="margin-top:16px; margin-bottom:24px; ${isWinner ? '' : 'flex-direction:row; flex-wrap:wrap;'} ">
               <div class="bv-kpi-card" style="flex:1; min-width:200px;">
                  <span class="bv-kpi-label">Pagarías</span>
                  <span class="bv-kpi-value">${fEur(r.totals.pagado)}</span>
               </div>
               <div class="bv-kpi-card highlight" style="flex:1; min-width:200px;">
                  <span class="bv-kpi-label">Te Sobra</span>
                  <span class="bv-kpi-value surplus">${fEur(r.totals.bvFinal)}</span>
               </div>
            </div>

            ${isWinner && ahorroPct > 0 ? `<div style="margin-bottom:24px; text-align:center;"><span class="bv-savings-banner">📉 Ahorras un ${ahorroPct}% extra</span></div>` : ''}

            <div style="text-align:center; margin-bottom:24px;">
               ${r.tarifa.web ? `<a href="${r.tarifa.web}" target="_blank" class="btn primary" style="padding:10px 30px;">Ver tarifa &rarr;</a>` : ''}
            </div>

            <details>
              <summary style="font-size: 0.95rem; cursor: pointer; text-align: center; color: var(--muted); padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: rgba(0,0,0,0.1); transition: all 0.2s;">Ver desglose mensual detallado ▾</summary>
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
                  <tbody>${rowsHtml}</tbody>
                </table>
              </div>
            </details>
          </div>
        `;
      };

      resultsEl.innerHTML = `
        <h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>
        <div class="bv-results-list">
          ${rankedResults.map((r, i) => renderResultCard(r, i)).join('')}
        </div>
      `;

      resultsContainer.style.display = 'block';
      setTimeout(() => resultsContainer.classList.add('show'), 10);
      statusContainer.style.display = 'none';
      
      // --- SISTEMA DE TOOLTIPS FLOTANTES MEJORADO (DELEGACIÓN DE EVENTOS) ---
      const oldTooltip = document.querySelector('.bv-floating-tooltip');
      if (oldTooltip) oldTooltip.remove();

      const tooltipEl = document.createElement('div');
      tooltipEl.className = 'bv-floating-tooltip';
      document.body.appendChild(tooltipEl);

      // Nota: el tooltip es `position: fixed` (ver CSS). Por tanto, `getBoundingClientRect()` ya
      // devuelve coordenadas en el viewport. Si sumamos scroll (scrollX/scrollY) lo mandamos fuera
      // de pantalla cuando hay scroll, y "desaparece".
      const updateTooltipPosition = (e) => {
        const target = e.target.closest('.bv-tooltip-trigger');
        if (!target) return;

        const rect = target.getBoundingClientRect();

        // Asegura que tenemos medidas reales (por si se llama antes de pintar)
        const ttWidth = tooltipEl.offsetWidth || 280;
        const ttHeight = tooltipEl.offsetHeight || 80;

        let top = rect.top - ttHeight - 10;
        let left = rect.left + (rect.width / 2) - (ttWidth / 2);

        // Ajustes de bordes dentro del viewport
        if (top < 10) top = rect.bottom + 10;
        if (left < 10) left = 10;
        if (left + ttWidth > window.innerWidth - 10) left = window.innerWidth - ttWidth - 10;

        tooltipEl.style.top = `${top}px`;
        tooltipEl.style.left = `${left}px`;
      };

      // Usamos mouseover (que sí burbujea) en lugar de mouseenter
      resultsEl.addEventListener('mouseover', (e) => {
        const target = e.target.closest('.bv-tooltip-trigger');
        if (target) {
          const tip = target.getAttribute('data-tip');
          if (tip) {
            tooltipEl.textContent = tip;
            tooltipEl.style.display = 'block';
            updateTooltipPosition(e); // Posición inicial
          }
        }
      });

      // Reposicionar mientras el ratón se mueve (evita que parezca "bug" en celdas anchas)
      resultsEl.addEventListener('mousemove', (e) => {
        if (tooltipEl.style.display === 'block') updateTooltipPosition(e);
      });

      resultsEl.addEventListener('mouseout', (e) => {
        const target = e.target.closest('.bv-tooltip-trigger');
        if (target) {
          tooltipEl.style.display = 'none';
        }
      });
      
      // Ocultar al hacer scroll para evitar que se quede "volando" desalineado
      window.addEventListener('scroll', () => {
        if (tooltipEl.style.display === 'block') tooltipEl.style.display = 'none';
      }, { passive: true });

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
