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

  document.addEventListener('click', async (e) => {
    const clearBtn = e.target.closest('#btnClearCache');
    if (clearBtn) {
      if (!confirm('¿Limpiar toda la caché y reiniciar?')) return;
      
      try {
        localStorage.clear();
        sessionStorage.clear();
        
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(key => caches.delete(key)));
        }
      } catch (err) {
        console.error('Error clearing cache:', err);
      } finally {
        window.location.reload(true);
      }
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

  // En móvil/táctil, el "hover" no existe: mostramos el detalle en un modal (bottom-sheet).
  const tipModalEl = document.createElement('div');
  tipModalEl.className = 'bv-tip-modal';
  tipModalEl.innerHTML = `
    <div class="bv-tip-card" role="dialog" aria-modal="true" aria-label="Detalle del cálculo">
      <button type="button" class="bv-tip-close" aria-label="Cerrar">✕</button>
      <div class="bv-tip-title">Detalle</div>
      <pre class="bv-tip-content"></pre>
    </div>
  `;
  document.body.appendChild(tipModalEl);
  const tipContentEl = tipModalEl.querySelector('.bv-tip-content');
  const tipCloseBtn = tipModalEl.querySelector('.bv-tip-close');

  // Accesibilidad: guardar/restaurar foco al abrir/cerrar el modal
  let lastFocusedEl = null;

  const openTipModal = (text) => {
    lastFocusedEl = document.activeElement;
    if (tipContentEl) tipContentEl.textContent = String(text || '');
    tipModalEl.classList.add('show');
    document.body.classList.add('bv-modal-open');

    // Mover foco al botón de cierre para usuarios de teclado/lectores
    if (tipCloseBtn) setTimeout(() => tipCloseBtn.focus(), 0);
  };
  const closeTipModal = () => {
    tipModalEl.classList.remove('show');
    document.body.classList.remove('bv-modal-open');

    // Restaurar foco al elemento que abrió el modal
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      try { lastFocusedEl.focus(); } catch {}
    }
    lastFocusedEl = null;
  };

  if (tipCloseBtn && !tipCloseBtn.dataset.bvBound) {
    tipCloseBtn.dataset.bvBound = '1';
    tipCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeTipModal(); });
  }
  tipModalEl.addEventListener('click', (e) => {
    if (e.target === tipModalEl) closeTipModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tipModalEl.classList.contains('show')) closeTipModal();
    // Trampa de foco mínima (solo hay un botón): mantener el foco dentro del modal
    if (e.key === 'Tab' && tipModalEl.classList.contains('show')) {
      e.preventDefault();
      if (tipCloseBtn) tipCloseBtn.focus();
    }
  });

  const canHover = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  const isCoarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

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

  // Desktop: hover.
  if (canHover) {
    document.addEventListener('mouseover', (e) => {
      const trigger = e.target.closest('.bv-tooltip-trigger');
      if (trigger) updateTooltipPosition(trigger);
    });

    document.addEventListener('mouseout', (e) => {
      const trigger = e.target.closest('.bv-tooltip-trigger');
      if (trigger) tooltipEl.style.display = 'none';
    });
  }

  // Móvil/táctil: tap => modal.
  document.addEventListener('click', (e) => {
    if (canHover && !isCoarse) return;
    const trigger = e.target.closest('.bv-tooltip-trigger');
    if (!trigger) return;
    const tip = trigger.getAttribute('data-tip');
    if (!tip) return;
    e.preventDefault();
    e.stopPropagation();
    openTipModal(tip);
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
      if (!tarifasResult || !tarifasResult.ok || !Array.isArray(tarifasResult.tarifasBV)) {
        throw new Error(tarifasResult?.error || 'No se pudieron cargar las tarifas (tarifas.json).');
      }
      const monthMap = new Map((monthlyResult.months || []).map((m) => [m.key, m]));
      
      const allResults = window.BVSim.simulateForAllTarifasBV({
        months: monthlyResult.months,
        tarifasBV: tarifasResult.tarifasBV,
        potenciaP1: p1Val, potenciaP2: p2Val, bvSaldoInicial: saldoVal,
        zonaFiscal: zonaFiscalVal,
        esVivienda: esViviendaCanarias
      });

      if (!allResults || !allResults.ok || !Array.isArray(allResults.results) || allResults.results.length === 0) {
        throw new Error(allResults?.error || 'No se pudo calcular el ranking.');
      }

      // Ranking: ordenar por lo que realmente pagas (y, en empate, por saldo BV final).
      const rankedResults = [...allResults.results].sort((a, b) => {
        const diffPay = (a.totals.pagado || 0) - (b.totals.pagado || 0);
        if (Math.abs(diffPay) < 0.01) return (b.totals.bvFinal || 0) - (a.totals.bvFinal || 0);
        return diffPay;
      });

      const winner = rankedResults[0];
      const ahorroPct = rankedResults.length > 1 ? Math.round(((rankedResults[rankedResults.length-1].totals.pagado - winner.totals.pagado) / rankedResults[rankedResults.length-1].totals.pagado) * 100) : 0;

      const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

      // --- HELPERS DE CÁLCULO POR MES (una sola fuente de verdad) ---
      const computeRowView = (row, resultItem) => {
        const t = resultItem.tarifa;
        const hasBV = Boolean(t?.fv?.bv);
        const m = monthMap.get(row.key) || {};

        const imp = r2((row.impuestoElec || 0) + (row.ivaCuota || 0) + (row.costeBonoSocial || 0) + (row.alquilerContador || 0));
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
        const tipPot = `⚡ P1: ${fKw(p1Val)} kW × ${row.dias} días × ${fPrice(t.p1)} €/día = ${fEur(potP1)}
⚡ P2: ${fKw(p2Val)} kW × ${row.dias} días × ${fPrice(t.p2)} €/día = ${fEur(potP2)}
━━━━━━━━━━━━━━━
💰 TOTAL: ${fEur(row.pot)}`;

        // Cálculos Energía (Bruta)
        const kwhP1 = Number(m.importByPeriod?.P1) || 0;
        const kwhP2 = Number(m.importByPeriod?.P2) || 0;
        const kwhP3 = Number(m.importByPeriod?.P3) || 0;
        const eP1 = r2(kwhP1 * t.cPunta);
        const eP2 = r2(kwhP2 * t.cLlano);
        const eP3 = r2(kwhP3 * t.cValle);
        const tipEneBruta = `🔴 Punta: ${fKwh(kwhP1)} kWh × ${fPrice(t.cPunta)} €/kWh = ${fEur(eP1)}
🟡 Llano: ${fKwh(kwhP2)} kWh × ${fPrice(t.cLlano)} €/kWh = ${fEur(eP2)}
🟢 Valle: ${fKwh(kwhP3)} kWh × ${fPrice(t.cValle)} €/kWh = ${fEur(eP3)}
━━━━━━━━━━━━━━━
💰 TOTAL: ${fEur(eBruta)}`;

        // Cálculos Excedentes
        const exKwh = Number(row.exKwh) || Number(m.exportTotalKWh) || 0;
        const totalGen = r2(exKwh * (row.precioExc || 0));
        const tipExcedentes = `💰 Valor generado: ${fKwh(exKwh)} kWh × ${fPrice(row.precioExc)} €/kWh = ${fEur(totalGen)}

✅ Compensado en este mes: ${fEur(excMes)}
   (Límite: energía bruta ${fEur(eBruta)})

${hasBV ? `💚 Sobrante → Batería Virtual: ${fEur(sobranteHucha)}` : `❌ Sobrante perdido: ${fEur(sobranteHucha)}`}`;

        const tipEneNeta = `Energía Bruta: ${fEur(eBruta)}
- Compensación solar: ${fEur(excMes)}
━━━━━━━━━━━━━━━
= Energía Neta: ${fEur(eNeta)}`;
        const tipImp = `📊 Impuestos y cargos:

• Impuesto eléctrico (IEE): ${fEur(row.impuestoElec)}
• IVA/IGIC/IPSI: ${fEur(row.ivaCuota)}
• Bono social: ${fEur(row.costeBonoSocial)}
• Alquiler contador: ${fEur(row.alquilerContador)}`;
        const tipSub = `📋 Desglose del subtotal:

⚡ Potencia: ${fEur(row.pot)}
🔌 Energía neta: ${fEur(eNeta)}
📊 IEE: ${fEur(row.impuestoElec)}
💶 IVA/IGIC/IPSI: ${fEur(row.ivaCuota)}
💵 Bono social: ${fEur(row.costeBonoSocial)}
🔢 Alquiler: ${fEur(row.alquilerContador)}
━━━━━━━━━━━━━━━
💰 TOTAL: ${fEur(subtotal)}`;

        const tipHucha = hasBV
          ? `🏦 Batería Virtual (uso este mes):

💰 Saldo disponible: ${fEur(row.bvSaldoPrev)}
📉 Usado para reducir factura: ${fEur(usoHucha)}`
          : '❌ Esta tarifa NO tiene Batería Virtual';

        const tipPagar = hasBV
          ? `💳 Lo que pagas este mes:

Subtotal: ${fEur(subtotal)}
- BV aplicada: ${fEur(usoHucha)}
━━━━━━━━━━━━━━━
= A pagar: ${fEur(row.totalPagar)}`
          : `💳 Factura total: ${fEur(row.totalPagar)}

(Sin Batería Virtual)`;

        const tipSaldo = hasBV
          ? `🏦 Saldo BV al final del mes:

Saldo anterior: ${fEur(row.bvSaldoPrev)}
- Usado: ${fEur(usoHucha)}
+ Nuevo excedente: ${fEur(sobranteHucha)}
━━━━━━━━━━━━━━━
= Saldo final: ${fEur(row.bvSaldoFin)}

💡 Este saldo se usa el mes siguiente`
          : '❌ Esta tarifa NO acumula saldo';

        return {
          key: row.key,
          hasBV,
          pot: row.pot,
          eBruta,
          excMes,
          eNeta,
          imp,
          subtotal,
          pagar: row.totalPagar,
          usoHucha,
          bvSaldoFin: row.bvSaldoFin,
          tips: {
            pot: tipPot,
            eBruta: tipEneBruta,
            exc: tipExcedentes,
            eNeta: tipEneNeta,
            imp: tipImp,
            subtotal: tipSub,
            pagar: tipPagar,
            hucha: tipHucha,
            saldo: tipSaldo,
          }
        };
      };

      // --- DESKTOP: filas en tabla (clásico) ---
      const buildRows = (resultItem) => {
        return resultItem.rows.map((row) => {
          const v = computeRowView(row, resultItem);
          const hasBV = v.hasBV;
          const huchaCell = hasBV ? (v.usoHucha > 0 ? `-${fEur(v.usoHucha)}` : fEur(0)) : '';
          const saldoCell = hasBV ? fEur(v.bvSaldoFin) : '';
          const saldoStyle = hasBV ? 'color:#fbbf24; font-weight:700;' : '';

          const extraCells = hasBV ? `
              <td data-label="Uso Hucha" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.hucha)}"><span class="bv-cell-value">${huchaCell}</span></td>
              <td data-label="Saldo Fin" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.saldo)}" style="${saldoStyle}"><span class="bv-cell-value">${saldoCell}</span></td>
          ` : '';

          return `
            <tr>
              <td data-label="Mes"><span class="bv-cell-value">${v.key}</span></td>
              <td data-label="Potencia" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.pot)}"><span class="bv-cell-value">${fEur(v.pot)}</span></td>
              <td data-label="E. Bruta" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.eBruta)}"><span class="bv-cell-value">${fEur(v.eBruta)}</span></td>
              <td data-label="Compensación" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.exc)}" style="color:var(--accent2);"><span class="bv-cell-value">${v.excMes > 0 ? `-${fEur(v.excMes)}` : fEur(0)}</span></td>
              <td data-label="E. Neta" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.eNeta)}" style="font-weight:700;"><span class="bv-cell-value">${fEur(v.eNeta)}</span></td>
              <td data-label="Impuestos" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.imp)}" style="color:var(--danger);"><span class="bv-cell-value">${fEur(v.imp)}</span></td>
              <td data-label="Subtotal" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.subtotal)}" style="background:rgba(255,255,255,0.02); font-weight:700;"><span class="bv-cell-value">${fEur(v.subtotal)}</span></td>
              <td data-label="Pagar" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.pagar)}" style="color:var(--accent2); font-weight:800;"><span class="bv-cell-value">${fEur(v.pagar)}</span></td>
              ${extraCells}
            </tr>
          `;
        }).join('');
      };

      // --- MÓVIL: tarjetas (sin tablas / sin pseudo-elementos) ---
      const buildMobileCards = (resultItem) => {
        return resultItem.rows.map((row) => {
          const v = computeRowView(row, resultItem);
          const hasBV = v.hasBV;
          const huchaCell = hasBV ? (v.usoHucha > 0 ? `-${fEur(v.usoHucha)}` : fEur(0)) : null;
          const saldoCell = hasBV ? fEur(v.bvSaldoFin) : null;

          const item = (label, valueHtml, tip, extraClass = '') => {
            const value = tip
              ? `<button type="button" class="bv-month-value bv-tooltip-trigger ${extraClass}" data-tip="${escapeAttr(tip)}">${valueHtml}</button>`
              : `<span class="bv-month-value ${extraClass}">${valueHtml}</span>`;
            return `<div class="bv-month-item"><div class="bv-month-label">${label}</div>${value}</div>`;
          };

          return `
            <section class="bv-month-card">
              <header class="bv-month-head">${escapeHtml(v.key)}</header>
              <div class="bv-month-body">
                ${item('Potencia', fEur(v.pot), v.tips.pot)}
                ${item('Energía bruta', fEur(v.eBruta), v.tips.eBruta)}
                ${item('Compensación', (v.excMes > 0 ? `-${fEur(v.excMes)}` : fEur(0)), v.tips.exc, (v.excMes > 0 ? 'bv-val-good' : ''))}
                ${item('Energía neta', fEur(v.eNeta), v.tips.eNeta)}
                ${item('Impuestos', fEur(v.imp), v.tips.imp, (v.imp > 0 ? 'bv-val-warn' : ''))}
                ${item('Subtotal', fEur(v.subtotal), v.tips.subtotal)}
                ${item('Pagar', fEur(v.pagar), v.tips.pagar, 'bv-val-pay')}
                ${hasBV ? item('Uso hucha', huchaCell, v.tips.hucha) : ''}
                ${hasBV ? item('Saldo BV fin', saldoCell, v.tips.saldo, 'bv-val-bv') : ''}
              </div>
            </section>
          `;
        }).join('');
      };

      const buildTable = (resultItem) => {
        const hasBV = Boolean(resultItem?.tarifa?.fv?.bv);
        const head = hasBV
          ? `<th style="text-align:left" title="Mes">Mes</th><th title="Término de potencia">Potencia</th><th title="Energía bruta consumida">Energ.</th><th title="Excedentes compensados">Comp.</th><th title="Energía neta (bruta - compensación)">E.Neta</th><th title="Impuestos y cargos">Imptos.</th><th title="Subtotal factura">Subtot.</th><th title="Lo que pagas este mes">Pagar</th><th title="Batería Virtual usada">BV Uso</th><th title="Saldo BV final">BV Fin</th>`
          : `<th style="text-align:left" title="Mes">Mes</th><th title="Término de potencia">Potencia</th><th title="Energía bruta consumida">Energ.</th><th title="Excedentes compensados">Comp.</th><th title="Energía neta (bruta - compensación)">E.Neta</th><th title="Impuestos y cargos">Imptos.</th><th title="Subtotal factura">Subtot.</th><th title="Lo que pagas este mes">Pagar</th>`;

        // Ojo: buildRows ya omite celdas BV si no aplica.
        // En BV, para mantener el orden visual, las columnas "Hucha" y "Saldo" se colocan al final.
        // (En móvil se verán como filas etiquetadas igualmente.)
        return `
          <div class="bv-breakdown" style="margin-top:16px;">
            <div class="bv-breakdown-desktop">
              <div class="bv-table-container">
                <table class="bv-table">
                  <thead><tr>${head}</tr></thead>
                  <tbody>${buildRows(resultItem)}</tbody>
                </table>
              </div>
            </div>
            <div class="bv-breakdown-mobile">
              ${buildMobileCards(resultItem)}
            </div>
          </div>
        `;
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
            ${winnerHasBV ? `
            <div class="bv-kpi-card highlight">
              <span class="bv-kpi-label">Saldo BV final</span>
              <span class="bv-kpi-value surplus">${fEur(winner.totals.bvFinal)}</span>
              <span class="bv-kpi-sub">Acumulado (si no lo gastas)</span>
            </div>
            ` : ''}
          </div>
        </div>
        <details style="margin-bottom: 48px;">
          <summary style="font-size: 1.1rem; font-weight: 700; cursor: pointer; text-align: center; color: var(--text); padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card2); transition: all 0.2s;">Ver desglose detallado del ganador</summary>
          ${buildTable(winner)}
        </details>
      `;

      // HTML de Alternativas
      const alternativesHTML = rankedResults.slice(1).map((r, i) => {
        const altName = escapeHtml(r.tarifa?.nombre || '');
        const altUrl = sanitizeUrl(r.tarifa?.web);
        const hasBV = Boolean(r.tarifa?.fv?.bv);
        const pill = hasBV
          ? '<span class="bv-pill bv-pill--bv" title="Acumula excedente sobrante para meses futuros.">Con BV</span>'
          : '<span class="bv-pill bv-pill--no-bv" title="No acumula excedente sobrante; lo no compensado se pierde.">Sin BV</span>';

        // MOSTRAR PAGADO COMO PRINCIPAL
        return `
          <div class="bv-alt-card-detailed" style="margin-bottom: 24px; background:var(--card); border:1px solid var(--border); padding:24px; border-radius:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:16px;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;"><span class="bv-alt-rank" style="font-size:1.5rem; opacity:0.5; font-weight:900;">#${i+2}</span><h3 style="margin:0; font-size:1.3rem;">${altName}</h3>${pill}</div>
              <div style="text-align:right;">
                <div style="font-size:1.5rem; font-weight:900;">${fEur(r.totals.pagado)}</div>
                <div style="opacity:0.75; font-size:0.85rem; margin-bottom: 4px;">Pagado total</div>
                ${hasBV ? `<div style="color:#fbbf24; font-weight:700; font-size:1.1rem;">Saldo BV final: ${fEur(r.totals.bvFinal)}</div>` : ''}
              </div>
            </div>
            ${hasBV ? '' : '<div class="bv-note">Nota: sin BV, el excedente que no compense este mes se pierde.</div>'}
            ${altUrl ? `<div style="margin: 16px 0;"><a href="${altUrl}" target="_blank" rel="noopener noreferrer" class="btn primary" style="width:100%; justify-content:center;">Ver esta tarifa &rarr;</a></div>` : ''}
            <details>
              <summary style="cursor: pointer; color: var(--accent); font-weight:600; font-size:0.9rem;">Ver desglose</summary>
              ${buildTable(r).replace('margin-top:16px','margin-top:12px')}
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