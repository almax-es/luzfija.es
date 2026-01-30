window.BVSim = window.BVSim || {};

document.addEventListener('DOMContentLoaded', () => {
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

  try {
    if (window.LF?.isDebugMode?.()) console.log('BVSim: Initializing UI...');
  } catch {}

  const uploadCsvBtn = document.getElementById('upload-csv-btn');
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

  const manualGrid = document.getElementById('bv-manual-grid');

  // --- MANUAL ENTRY INITIALIZATION ---
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Función para validar y limitar valores
  function validateAndClampKwh(value, max = 10000) {
    const num = parseInput(value);
    if (num < 0) return 0;
    if (num > max) return max;
    if (!isFinite(num)) return 0;
    return num;
  }

  // Función para formatear número al estilo español (decimales con coma)
  // Para usar en inputs donde el usuario debe ver formato español
  function formatNumberES(num) {
    if (num === null || num === undefined || num === '') return '';
    const n = Number(num);
    if (!isFinite(n)) return '';
    if (n === 0) return '';
    // Usar toLocaleString con 2 decimales máximo, quitando ceros trailing
    return n.toLocaleString('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      useGrouping: false // Sin separador de miles en inputs
    });
  }

  // Función para guardar datos manuales en localStorage
  function saveManualData() {
    if (!manualGrid) return;
    const data = {};
    for (let i = 0; i < 12; i++) {
      const p1In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
      const p2In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
      const p3In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
      const vIn = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

      if (p1In && p2In && p3In && vIn) {
        data[i] = {
          p1: p1In.value,
          p2: p2In.value,
          p3: p3In.value,
          vert: vIn.value
        };
      }
    }
    try {
      localStorage.setItem('bv_manual_data_v2', JSON.stringify(data));
      localStorage.setItem('bv_manual_data_timestamp', new Date().toISOString());
      updateDataStatus();
    } catch(e) { console.warn(e); }
  }

  // Función para cargar datos manuales desde localStorage
  function loadManualData() {
    if (!manualGrid) return false;
    try {
      // Intentar cargar v2 (detallado)
      let saved = localStorage.getItem('bv_manual_data_v2');
      let data = saved ? JSON.parse(saved) : null;

      // Migración simple de v1 (agregado) a v2 (detallado) si no existe v2
      if (!data) {
        const oldSaved = localStorage.getItem('bv_manual_data');
        if (oldSaved) {
          const oldData = JSON.parse(oldSaved);
          data = {};
          for (let k in oldData) {
            const c = parseInput(oldData[k].cons);
            // Estimación simple para migración: 20/25/55
            // Guardar como strings formateados en español
            data[k] = {
              p1: formatNumberES(Math.round(c * 0.20)),
              p2: formatNumberES(Math.round(c * 0.25)),
              p3: formatNumberES(Math.round(c * 0.55)),
              vert: formatNumberES(parseInput(oldData[k].vert))
            };
          }
        }
      }

      if (!data) return false;

      let hasData = false;
      for (let i = 0; i < 12; i++) {
        const p1In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
        const p2In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
        const p3In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
        const vIn = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

        if (data[i]) {
          // Solo cargar valores si son > 0, dejar vacío si son 0
          // Formatear con comas (estilo español) para mostrar en inputs
          const p1 = parseInput(data[i].p1);
          const p2 = parseInput(data[i].p2);
          const p3 = parseInput(data[i].p3);
          const vert = parseInput(data[i].vert);

          if (p1In) p1In.value = formatNumberES(p1);
          if (p2In) p2In.value = formatNumberES(p2);
          if (p3In) p3In.value = formatNumberES(p3);
          if (vIn) vIn.value = formatNumberES(vert);

          if (p1 > 0 || p2 > 0 || p3 > 0 || vert > 0) {
            hasData = true;
          }
        }
      }

      if (hasData) {
        updateDataStatus();
        showToast('✓ Datos guardados cargados correctamente', 'ok');
      }

      return hasData;
    } catch(e) {
      console.warn('Error cargando datos:', e);
      return false;
    }
  }

  // Función para actualizar el mensaje de estado de datos guardados
  function updateDataStatus() {
    const statusEl = document.getElementById('bv-data-status');
    if (!statusEl) return;

    try {
      const timestamp = localStorage.getItem('bv_manual_data_timestamp');
      if (timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMinutes = Math.floor((now - date) / 60000);

        let timeText = '';
        if (diffMinutes < 1) {
          timeText = 'hace un momento';
        } else if (diffMinutes < 60) {
          timeText = `hace ${diffMinutes} min`;
        } else if (diffMinutes < 1440) {
          const hours = Math.floor(diffMinutes / 60);
          timeText = `hace ${hours} hora${hours > 1 ? 's' : ''}`;
        } else {
          const days = Math.floor(diffMinutes / 1440);
          timeText = `hace ${days} día${days > 1 ? 's' : ''}`;
        }

        statusEl.textContent = `Última modificación: ${timeText}`;
        statusEl.style.color = 'var(--muted2)';
      } else {
        statusEl.textContent = '';
      }
    } catch(e) {
      console.warn('Error actualizando status:', e);
    }
  }

  // Función para exportar datos a JSON (100% local, descarga directa)
  function exportManualData() {
    try {
      const saved = localStorage.getItem('bv_manual_data_v2');
      if (!saved) {
        showToast('No hay datos para exportar', 'err');
        return;
      }

      const data = JSON.parse(saved);
      const exportData = {
        version: 2,
        timestamp: new Date().toISOString(),
        data: data,
        app: 'LuzFija - Comparador Tarifas Solares'
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `luzfija-datos-solares-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('✓ Datos exportados correctamente', 'ok');
    } catch(e) {
      console.error('Error exportando datos:', e);
      showToast('Error al exportar datos', 'err');
    }
  }

  // Función para importar datos desde JSON (100% local, lectura de archivo)
  function importManualData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importData = JSON.parse(event.target.result);

          // Validación básica
          if (!importData.data || typeof importData.data !== 'object') {
            throw new Error('Formato de archivo inválido');
          }

          // Guardar en localStorage
          localStorage.setItem('bv_manual_data_v2', JSON.stringify(importData.data));
          localStorage.setItem('bv_manual_data_timestamp', new Date().toISOString());

          // Recargar datos en la interfaz
          loadManualData();
          updateManualTotals();

          showToast('✓ Datos importados correctamente', 'ok');
        } catch(err) {
          console.error('Error importando datos:', err);
          showToast('Error: archivo inválido o corrupto', 'err');
        }
      };

      reader.onerror = () => {
        showToast('Error al leer el archivo', 'err');
      };

      reader.readAsText(file);
    };

    input.click();
  }

  // Indicador de guardado
  const saveIndicator = document.getElementById('bv-save-indicator');
  function showSaveIndicator(type = 'saving') {
    if (!saveIndicator) return;
    saveIndicator.className = 'bv-save-indicator';
    if (type === 'saving') {
      saveIndicator.textContent = '✏️ Editando...';
      saveIndicator.classList.add('saving');
    } else if (type === 'saved') {
      saveIndicator.textContent = '✓ Guardado';
      saveIndicator.classList.add('saved');
      setTimeout(() => {
        saveIndicator.classList.remove('saved');
      }, 2000);
    }
  }

  // Actualizar totales informativos (detallados + resumen)
  function updateManualTotals() {
    // Elementos de la fila de totales detallados
    const totalsRow = document.getElementById('bv-manual-totals-row');
    const totalP1Span = document.getElementById('bv-total-p1');
    const totalP2Span = document.getElementById('bv-total-p2');
    const totalP3Span = document.getElementById('bv-total-p3');
    const totalVertSpan = document.getElementById('bv-total-vert');

    // Elementos del resumen general
    const totalsSummary = document.getElementById('bv-manual-totals-summary');
    const totalConsumoSpan = document.getElementById('bv-total-consumo');
    const totalExcedentesSpan = document.getElementById('bv-total-excedentes');

    if (!manualGrid) return;

    let totalP1 = 0;
    let totalP2 = 0;
    let totalP3 = 0;
    let totalVert = 0;
    let hasAnyData = false;

    // Sumar todos los meses
    for (let i = 0; i < 12; i++) {
      const p1In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
      const p2In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
      const p3In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
      const vIn = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

      if (p1In && p2In && p3In && vIn) {
        const p1 = validateAndClampKwh(p1In.value);
        const p2 = validateAndClampKwh(p2In.value);
        const p3 = validateAndClampKwh(p3In.value);
        const vert = validateAndClampKwh(vIn.value);

        totalP1 += p1;
        totalP2 += p2;
        totalP3 += p3;
        totalVert += vert;

        if (p1 > 0 || p2 > 0 || p3 > 0 || vert > 0) {
          hasAnyData = true;
        }
      }
    }

    // Actualizar fila de totales detallados
    if (hasAnyData && totalsRow && totalP1Span && totalP2Span && totalP3Span && totalVertSpan) {
      totalP1Span.textContent = Math.round(totalP1).toLocaleString('es-ES');
      totalP2Span.textContent = Math.round(totalP2).toLocaleString('es-ES');
      totalP3Span.textContent = Math.round(totalP3).toLocaleString('es-ES');
      totalVertSpan.textContent = Math.round(totalVert).toLocaleString('es-ES');
      totalsRow.style.display = 'grid';
    } else if (totalsRow) {
      totalsRow.style.display = 'none';
    }

    // Actualizar resumen general
    const totalConsumo = totalP1 + totalP2 + totalP3;
    if (hasAnyData && totalsSummary && totalConsumoSpan && totalExcedentesSpan) {
      totalConsumoSpan.textContent = Math.round(totalConsumo).toLocaleString('es-ES');
      totalExcedentesSpan.textContent = Math.round(totalVert).toLocaleString('es-ES');
      totalsSummary.style.display = 'block';
    } else if (totalsSummary) {
      totalsSummary.style.display = 'none';
    }
  }

  if (manualGrid) {
    manualGrid.innerHTML = monthNames.map((m, i) => `
      <div class="bv-manual-row">
        <span class="bv-manual-row-label">${m}</span>
        <div class="bv-manual-row-cells">
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Punta</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="p1" value="" inputmode="decimal" placeholder="Ej: 50" title="Consumo en punta (10-14h, 18-22h laborables)">
          </div>
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Llano</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="p2" value="" inputmode="decimal" placeholder="Ej: 70" title="Consumo en llano (8-10h, 14-18h, 22-24h laborables)">
          </div>
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Valle</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="p3" value="" inputmode="decimal" placeholder="Ej: 150" title="Consumo en valle (0-8h + fines de semana y festivos)">
          </div>
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Vertido</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="vert" value="" inputmode="decimal" placeholder="Ej: 200" title="Excedentes vertidos a la red">
          </div>
        </div>
      </div>
    `).join('');

    // NO cargar datos automáticamente - solo al hacer clic en "Entrada manual"

    // Debounce para guardar automáticamente
    let saveTimer = null;
    manualGrid.addEventListener('input', (e) => {
      if (e.target.classList.contains('manual-input')) {
        const rawValue = e.target.value.trim();

        // Validar que el string raw sea numérico antes de parsear
        // Permite: números, comas, puntos, espacios
        const isNumericString = rawValue === '' || /^[\d.,\s]+$/.test(rawValue);

        if (!isNumericString) {
          // Texto no numérico detectado
          e.target.classList.add('error');
          e.target.classList.remove('valid');
        } else {
          // Es numérico, validar el valor parseado
          const val = parseInput(rawValue);
          if (val < 0 || !isFinite(val) || val > 10000) {
            e.target.classList.add('error');
            e.target.classList.remove('valid');
          } else if (val > 0) {
            e.target.classList.remove('error');
            e.target.classList.add('valid');
          } else {
            // valor 0 o vacío: neutral
            e.target.classList.remove('error', 'valid');
          }
        }

        // Actualizar totales en tiempo real
        updateManualTotals();

        showSaveIndicator('saving');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveManualData();
          showSaveIndicator('saved');
        }, 800);
      }
    });
  }

  // Botones de control: Exportar, Importar, Reset
  const exportBtn = document.getElementById('bv-export-manual');
  const importBtn = document.getElementById('bv-import-manual');
  const resetBtn = document.getElementById('bv-reset-manual');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportManualData();
    });
  }

  if (importBtn) {
    importBtn.addEventListener('click', () => {
      importManualData();
    });
  }

  if (resetBtn && manualGrid) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('¿Borrar todos los valores guardados? Esta acción no se puede deshacer.')) return;

      for (let i = 0; i < 12; i++) {
        const p1In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
        const p2In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
        const p3In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
        const vIn = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

        if (p1In) { p1In.value = ''; p1In.classList.remove('error', 'valid'); }
        if (p2In) { p2In.value = ''; p2In.classList.remove('error', 'valid'); }
        if (p3In) { p3In.value = ''; p3In.classList.remove('error', 'valid'); }
        if (vIn) { vIn.value = ''; vIn.classList.remove('error', 'valid'); }
      }

      localStorage.removeItem('bv_manual_data_v2');
      localStorage.removeItem('bv_manual_data');
      localStorage.removeItem('bv_manual_data_timestamp');
      updateManualTotals();
      updateDataStatus();
      showToast('✓ Todos los datos han sido borrados', 'ok');
    });
  }

  // Cargar datos manuales guardados al inicio (la tabla siempre está visible)
  if (manualGrid) {
    loadManualData();
    updateManualTotals();
    updateDataStatus();
  }

  // --- UI INITIALIZATION ---
  const btnTheme = document.getElementById('btnTheme');
  const btnMenu = document.getElementById('btnMenu');
  const menuPanel = document.getElementById('menuPanel');

  function updateThemeUI() {
    if (!btnTheme) return;
    // Usar icono universal día/noche para evitar confusión con el botón de tarifas solares
    btnTheme.textContent = '🌓';

    // Actualizar title y aria-label para indicar la acción que se realizará
    const isLight = document.documentElement.classList.contains('light-mode');
    const actionText = isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
    btnTheme.setAttribute('title', actionText);
    btnTheme.setAttribute('aria-label', actionText);
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

  // Función para guardar tarifa personalizada en localStorage
  function saveCustomTarifa() {
    try {
      const data = {
        punta: document.getElementById('mtPunta').value,
        llano: document.getElementById('mtLlano').value,
        valle: document.getElementById('mtValle').value,
        p1: document.getElementById('mtP1').value,
        p2: document.getElementById('mtP2').value,
        exc: document.getElementById('mtExc').value,
        bv: document.getElementById('mtBV')?.checked ?? false,
        savedAt: new Date().getTime()
      };
      localStorage.setItem('bv_custom_tarifa', JSON.stringify(data));
      updateCustomTarifaIndicator(data);
    } catch(e) {
      console.warn('No se pudo guardar tarifa personalizada:', e);
    }
  }

  // Función para actualizar el indicador visual
  function updateCustomTarifaIndicator(data) {
    try {
      const indicator = document.getElementById('bv-custom-tarifa-indicator');
      const clearBtn = document.getElementById('bv-clear-custom-tarifa');
      if (!indicator || !clearBtn) return;

      // Mostrar indicador solo si hay datos guardados
      if (data && data.savedAt) {
        const date = new Date(data.savedAt);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const mins = String(date.getMinutes()).padStart(2, '0');
        indicator.textContent = `💾 ${day}/${month} ${hours}:${mins}`;
        indicator.style.display = 'inline-block';
        clearBtn.style.display = 'block';
      } else {
        indicator.style.display = 'none';
        clearBtn.style.display = 'none';
      }
    } catch(e) {
      console.warn('Error actualizando indicador:', e);
    }
  }

  // Función para limpiar tarifa personalizada
  function clearCustomTarifa() {
    if (!confirm('¿Estás seguro de que quieres eliminar los datos guardados de tu tarifa?')) {
      return;
    }

    try {
      localStorage.removeItem('bv_custom_tarifa');
      document.getElementById('mtPunta').value = '';
      document.getElementById('mtLlano').value = '';
      document.getElementById('mtValle').value = '';
      document.getElementById('mtP1').value = '';
      document.getElementById('mtP2').value = '';
      document.getElementById('mtExc').value = '';
      const mtBVEl = document.getElementById('mtBV');
      if (mtBVEl) mtBVEl.checked = false;

      // Actualizar indicador
      updateCustomTarifaIndicator(null);

      // Mostrar confirmación
      const clearBtn = document.getElementById('bv-clear-custom-tarifa');
      if (clearBtn) {
        const originalText = clearBtn.innerHTML;
        clearBtn.innerHTML = '✓ Datos eliminados';
        clearBtn.disabled = true;
        setTimeout(() => {
          clearBtn.innerHTML = originalText;
          clearBtn.disabled = false;
        }, 2000);
      }
    } catch(e) {
      console.warn('Error limpiando tarifa personalizada:', e);
      alert('Error al limpiar los datos.');
    }
  }

  // Función para cargar tarifa personalizada desde localStorage
  function loadCustomTarifa() {
    try {
      const saved = localStorage.getItem('bv_custom_tarifa');
      if (!saved) {
        updateCustomTarifaIndicator(null);
        return false;
      }
      const data = JSON.parse(saved);
      document.getElementById('mtPunta').value = data.punta || '';
      document.getElementById('mtLlano').value = data.llano || '';
      document.getElementById('mtValle').value = data.valle || '';
      document.getElementById('mtP1').value = data.p1 || '';
      document.getElementById('mtP2').value = data.p2 || '';
      document.getElementById('mtExc').value = data.exc || '';
      const mtBVEl = document.getElementById('mtBV');
      if (mtBVEl) mtBVEl.checked = data.bv ?? false;
      updateCustomTarifaIndicator(data);
      return true;
    } catch(e) {
      console.warn('Error cargando tarifa personalizada:', e);
      updateCustomTarifaIndicator(null);
      return false;
    }
  }

  // Cargar tarifa personalizada al inicio
  loadCustomTarifa();

  // Conectar botón de limpiar datos
  const clearBtn = document.getElementById('bv-clear-custom-tarifa');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearCustomTarifa);
  }

  // Guardar automáticamente los cambios en tarifa personalizada
  ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      let saveTimer = null;
      el.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCustomTarifa, 800);
      });
    }
  });

  // Guardar checkbox de BV al cambiar (sin debounce, es instantáneo)
  const mtBVEl = document.getElementById('mtBV');
  if (mtBVEl) {
    mtBVEl.addEventListener('change', saveCustomTarifa);
  }

  function getCustomTarifa() {
    const punta = parseInput(document.getElementById('mtPunta')?.value || '');
    const llano = parseInput(document.getElementById('mtLlano')?.value || '');
    const valle = parseInput(document.getElementById('mtValle')?.value || '');
    const p1 = parseInput(document.getElementById('mtP1')?.value || '');
    const p2 = parseInput(document.getElementById('mtP2')?.value || '');
    const exc = parseInput(document.getElementById('mtExc')?.value || '');

    // Validación estricta: necesita al menos UN precio de energía Y UN precio de potencia
    const hasEnergy = punta > 0 || llano > 0 || valle > 0;
    const hasPower = p1 > 0 || p2 > 0;

    if (!hasEnergy || !hasPower) return null;

    // Detección correcta de tipo de tarifa basada en valores rellenados
    const energyPrices = [punta, llano, valle].filter(v => v > 0);
    const tipo = energyPrices.length === 1 ? '1P' : '3P';

    // Leer checkbox de batería virtual (no autodetectar)
    const hasBV = document.getElementById('mtBV')?.checked ?? false;

    return {
      nombre: 'Mi tarifa ⭐',
      tipo: tipo,
      cPunta: punta || llano || valle,
      cLlano: llano || punta || valle,
      cValle: valle || llano || punta,
      p1: p1 || p2,
      p2: p2 || p1,
      web: '', // Vacío para que no se renderice el botón de información
      esPersonalizada: true,
      fv: {
        exc: exc,
        tipo: exc > 0 ? (hasBV ? 'SIMPLE + BV' : 'SIMPLE') : 'NO COMPENSA',
        tope: 'ENERGIA',
        bv: hasBV,
        reglaBV: hasBV ? 'BV MES ANTERIOR' : 'NO APLICA'
      },
      requiereFV: false
    };
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

  // Función para poblar el grid manual desde el CSV importado
  /**
   * @param {Object} importResult - Resultado de importación con records
   * @param {string} zona - Zona CNMC ('peninsula'|'ceutaMelilla'). Default: 'peninsula'
   */
  function populateManualGridFromCSV(importResult, zona = 'peninsula') {
    if (!manualGrid || !importResult || !importResult.records) return;

    // 1. Agrupar por meses (usamos la lógica existente de simulación)
    // Pasamos potencias 0 porque solo queremos los consumos agregados
    // Pasamos zona para clasificar periodos correctamente (CNMC)
    const simResult = window.BVSim.simulateMonthly(importResult, 0, 0, zona);
    if (!simResult || !simResult.months) return;

    // 2. Resetear grid primero
    const inputs = manualGrid.querySelectorAll('input.manual-input');
    inputs.forEach(input => {
      input.value = '';
      input.classList.remove('error', 'valid');
    });

    // 3. Mapear datos. Si hay múltiples años para el mismo mes, nos quedamos con el más reciente.
    // Estructura de month.key: "YYYY-MM"
    const monthDataMap = new Map(); // Map<monthIndex 0-11, monthData>
    const yearsFound = new Set();

    simResult.months.forEach(m => {
      const [yearStr, monthStr] = m.key.split('-');
      const monthIndex = parseInt(monthStr, 10) - 1; // 0-11
      const year = parseInt(yearStr, 10);
      yearsFound.add(year);

      // Si ya tenemos datos para este mes, solo sobrescribimos si el año es mayor
      const existing = monthDataMap.get(monthIndex);
      if (!existing || existing.year < year) {
        monthDataMap.set(monthIndex, {
          year: year,
          p1: m.importByPeriod.P1,
          p2: m.importByPeriod.P2,
          p3: m.importByPeriod.P3,
          vert: m.exportTotalKWh
        });
      }
    });

    // 4. Escribir en el DOM
    let filledCount = 0;
    monthDataMap.forEach((data, monthIndex) => {
      const p1In = manualGrid.querySelector(`input[data-month="${monthIndex}"][data-type="p1"]`);
      const p2In = manualGrid.querySelector(`input[data-month="${monthIndex}"][data-type="p2"]`);
      const p3In = manualGrid.querySelector(`input[data-month="${monthIndex}"][data-type="p3"]`);
      const vIn = manualGrid.querySelector(`input[data-month="${monthIndex}"][data-type="vert"]`);

      // Formatear con comas (estilo español) para mostrar en inputs
      const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
      if (p1In) p1In.value = formatNumberES(r2(data.p1));
      if (p2In) p2In.value = formatNumberES(r2(data.p2));
      if (p3In) p3In.value = formatNumberES(r2(data.p3));
      if (vIn) vIn.value = formatNumberES(r2(data.vert));
      
      // Marcar visualmente como válidos
      [p1In, p2In, p3In, vIn].forEach(el => {
        if (el && el.value !== '') el.classList.add('valid');
      });

      filledCount++;
    });

    // 5. Actualizar totales y guardar
    if (filledCount > 0) {
      updateManualTotals();
      saveManualData();

      // Mensaje informativo sobre múltiples años
      let message = `✓ Datos importados: ${filledCount} meses procesados`;
      if (yearsFound.size > 1) {
        const years = Array.from(yearsFound).sort((a, b) => b - a);
        message += ` (años ${years.join(', ')} - se usa el más reciente por mes)`;
      }
      showToast(message, 'ok');

      // Mostrar botón/enlace para ir a manual con animación
      const editBtn = document.getElementById('btn-edit-manual-shortcut');
      if (editBtn) {
        editBtn.style.display = 'inline-flex';
        // Pequeño pulse para llamar la atención
        editBtn.style.animation = 'none';
        setTimeout(() => {
          editBtn.style.animation = 'slideInScale 0.35s ease-out, btnPulse 1.5s ease-in-out 0.5s';
        }, 10);
      }
    }
  }

  if (!fileInput || !simulateButton) return;

  async function handleFile(file) {
    if (!file) return;
    window.BVSim.file = file;
    window.BVSim._cachedImportResult = null; // Limpiar cache anterior
    if (fileNameDisplay) fileNameDisplay.textContent = file.name;
    if (fileSelectedMsg) fileSelectedMsg.style.display = 'flex';

    // Procesar automáticamente para rellenar el grid manual
    try {
      // Obtener zona seleccionada ANTES de importar para clasificar periodos correctamente
      const zonaVal = zonaFiscalInput ? zonaFiscalInput.value : 'Península';
      const result = await window.BVSim.importFile(file, zonaVal);
      if (result && result.ok) {
        // Cachear el resultado
        window.BVSim._cachedImportResult = result;
        // Nota: Ya no necesitamos mapear porque getPeriodoHorarioCSV normaliza internamente
        populateManualGridFromCSV(result, zonaVal);

        if (Array.isArray(result.warnings) && result.warnings.length) {
          showToast(`⚠️ ${result.warnings.join('\n')}`, 'ok');
        }

        // Scroll suave a la tabla para que vea los datos auto-rellenados
        setTimeout(() => {
          const manualZone = document.getElementById('bv-manual-zone');
          if (manualZone) {
            manualZone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 300);
      } else if (result && result.error) {
        console.info('Info: No se pudo pre-procesar CSV:', result.error);
        showToast(result.error, 'err');
      }
    } catch (e) {
      console.warn('Error procesando CSV:', e);
      showToast('Error al procesar el archivo CSV', 'err');
    }
  }

  // Botón de subir CSV
  if (uploadCsvBtn) {
    uploadCsvBtn.addEventListener('click', () => fileInput.click());
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
    const p1Val = p1Input.value === '' ? 0 : parseInput(p1Input.value);
    const p2Val = p2Input.value === '' ? 0 : parseInput(p2Input.value);
    const saldoVal = saldoInput.value === '' ? 0 : parseInput(saldoInput.value);
    const zonaFiscalVal = zonaFiscalInput ? zonaFiscalInput.value : 'Península';
    const esViviendaCanarias = viviendaCanariasInput ? viviendaCanariasInput.checked : true;

    if (p1Val <= 0) { showToast('Te falta poner la potencia contratada (P1).', 'err'); return; }
    
    if (resultsContainer) { resultsContainer.classList.remove('show'); resultsContainer.style.display = 'none'; }
    if (statusContainer) { statusContainer.style.display = 'block'; statusEl.innerHTML = '<span class="spinner"></span> Calculando...'; }

    const btnText = simulateButton.querySelector('.bv-btn-text');
    const btnSpinner = simulateButton.querySelector('.spinner');
    simulateButton.disabled = true;
    if (btnText) btnText.textContent = 'Calculando...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    await new Promise(r => setTimeout(r, 100));

    try {
      // Siempre usar datos de la tabla manual (auto-rellenada o manual)
      const manualMonths = [];
      const currentYear = new Date().getFullYear();

      for (let i = 0; i < 12; i++) {
        const p1Input = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
        const p2Input = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
        const p3Input = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
        const vInput = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

        // Validación robusta de inputs
        const p1 = validateAndClampKwh(p1Input ? p1Input.value : 0);
        const p2 = validateAndClampKwh(p2Input ? p2Input.value : 0);
        const p3 = validateAndClampKwh(p3Input ? p3Input.value : 0);
        const totalCons = p1 + p2 + p3;

        let vertKwh = validateAndClampKwh(vInput ? vInput.value : 0);

        // Solo incluir el mes si tiene al menos algún dato > 0
        const tieneAlgunDato = p1 > 0 || p2 > 0 || p3 > 0 || vertKwh > 0;
        if (!tieneAlgunDato) continue; // Saltar este mes

        // Sanity check básico
        if (vertKwh > 10000) vertKwh = 10000;

        const key = `${currentYear}-${String(i + 1).padStart(2, '0')}`;

        // Calcular días reales del mes (28/29/30/31)
        const realDays = new Date(currentYear, i + 1, 0).getDate();

        manualMonths.push({
          key,
          daysWithData: realDays,
          importTotalKWh: totalCons,
          exportTotalKWh: vertKwh,
          importByPeriod: {
            P1: p1,
            P2: p2,
            P3: p3
          }
        });
      }

      // Validar que haya al menos 1 mes con datos
      if (manualMonths.length === 0) {
        throw new Error('Introduce datos para al menos un mes. Rellena los valores de consumo (P1/P2/P3) y/o vertido, o sube un archivo CSV.');
      }

      const monthlyResult = { ok: true, months: manualMonths };
      const tarifasResult = await window.BVSim.loadTarifasBV();
      if (!tarifasResult || !tarifasResult.ok || !Array.isArray(tarifasResult.tarifasBV)) {
        throw new Error(tarifasResult?.error || 'No se pudieron cargar las tarifas (tarifas.json).');
      }

      const customTarifa = getCustomTarifa();
      if (customTarifa) {
        tarifasResult.tarifasBV.push(customTarifa);
        if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Calculando (incluida tu tarifa actual)...';
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

      // Ranking: ordenar por "pagas" (coste total anual con BV aplicada).
      // Nota: si el usuario introduce un saldo BV inicial > 0, el ranking reflejará ese saldo.
      const rankedResults = [...allResults.results].sort((a, b) => {
        const diffPagado = (a.totals.pagado || 0) - (b.totals.pagado || 0);
        if (Math.abs(diffPagado) < 0.01) {
          const bvA = (a.totals.bvFinal || 0);
          const bvB = (b.totals.bvFinal || 0);
          return bvB - bvA;
        }
        return diffPagado;
      });

      const winner = rankedResults[0];

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
        const tipPot = `⚡ P1: ${fKw(p1Val)} × ${row.dias} d × ${priceFmt.format(t.p1)} = ${fEur(potP1)}
⚡ P2: ${fKw(p2Val)} × ${row.dias} d × ${priceFmt.format(t.p2)} = ${fEur(potP2)}
💰 Total: ${fEur(row.pot)}`;

        // Cálculos Energía (Bruta)
        const kwhP1 = Number(m.importByPeriod?.P1) || 0;
        const kwhP2 = Number(m.importByPeriod?.P2) || 0;
        const kwhP3 = Number(m.importByPeriod?.P3) || 0;
        const eP1 = r2(kwhP1 * t.cPunta);
        const eP2 = r2(kwhP2 * t.cLlano);
        const eP3 = r2(kwhP3 * t.cValle);
        const tipEneBruta = `🔴 Punta: ${fKwh(kwhP1)} × ${priceFmt.format(t.cPunta)} = ${fEur(eP1)}
🟡 Llano: ${fKwh(kwhP2)} × ${priceFmt.format(t.cLlano)} = ${fEur(eP2)}
🟢 Valle: ${fKwh(kwhP3)} × ${priceFmt.format(t.cValle)} = ${fEur(eP3)}
💰 Total: ${fEur(eBruta)}`;

        // Cálculos Excedentes
        const exKwh = Number(row.exKwh) || Number(m.exportTotalKWh) || 0;
        const totalGen = r2(exKwh * (row.precioExc || 0));
        const tipExcedentes = `💰 Gen: ${fKwh(exKwh)} × ${fPrice(row.precioExc)} = ${fEur(totalGen)}
✅ Comp: ${fEur(excMes)} (máx: ${fEur(eBruta)})
${hasBV ? `💚 BV: ${fEur(sobranteHucha)}` : `❌ Pdto: ${fEur(sobranteHucha)}`}`;

        const tipEneNeta = `${fEur(eBruta)} − ${fEur(excMes)} (comp.) = ${fEur(eNeta)}`;
        const taxLabel = String(row.impuestoIndirectoTipo || 'IVA').toUpperCase();
        const tipImp = `💵 Bono: ${fEur(row.costeBonoSocial)}
📊 IEE: ${fEur(row.impuestoElec)}
🔢 Alq: ${fEur(row.alquilerContador)}
💶 ${taxLabel}: ${fEur(row.ivaCuota)}`;
        const tipSub = `⚡ Pot: ${fEur(row.pot)}
🔌 E.Neta: ${fEur(eNeta)}
💵 Bono: ${fEur(row.costeBonoSocial)}
📊 IEE: ${fEur(row.impuestoElec)}
🔢 Alq: ${fEur(row.alquilerContador)}
💶 ${taxLabel}: ${fEur(row.ivaCuota)}
━━━━━━━━━━━━
💰 Subtotal: ${fEur(subtotal)}`;

        const tipHucha = hasBV
          ? `🏦 BV: ${fEur(row.bvSaldoPrev)} disponible, ${fEur(usoHucha)} usado`
          : '❌ Sin Batería Virtual';

        const tipPagar = hasBV
          ? `💳 ${fEur(subtotal)} − ${fEur(usoHucha)} (BV) = ${fEur(row.totalPagar)}`
          : `💳 Factura: ${fEur(row.totalPagar)} (sin BV)`;

        const tipSaldo = hasBV
          ? `🏦 ${fEur(row.bvSaldoPrev)} − ${fEur(usoHucha)} + ${fEur(sobranteHucha)} = ${fEur(row.bvSaldoFin)}
💡 Disponible mes siguiente`
          : '❌ Sin saldo BV';

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
              <td data-label="Uso BV" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.hucha)}"><span class="bv-cell-value">${huchaCell}</span></td>
              <td data-label="Saldo BV" class="bv-tooltip-trigger" data-tip="${escapeAttr(v.tips.saldo)}" style="${saldoStyle}"><span class="bv-cell-value">${saldoCell}</span></td>
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
                ${item('E. Bruta', fEur(v.eBruta), v.tips.eBruta)}
                ${item('Compensación', (v.excMes > 0 ? `-${fEur(v.excMes)}` : fEur(0)), v.tips.exc, (v.excMes > 0 ? 'bv-val-good' : ''))}
                ${item('E. Neta', fEur(v.eNeta), v.tips.eNeta)}
                ${item('Impuestos', fEur(v.imp), v.tips.imp, (v.imp > 0 ? 'bv-val-warn' : ''))}
                ${item('Subtotal', fEur(v.subtotal), v.tips.subtotal)}
                ${item('A Pagar', fEur(v.pagar), v.tips.pagar, 'bv-val-pay')}
                ${hasBV ? item('Uso BV', huchaCell, v.tips.hucha) : ''}
                ${hasBV ? item('Saldo BV', saldoCell, v.tips.saldo, 'bv-val-bv') : ''}
              </div>
            </section>
          `;
        }).join('');
      };

      const buildTable = (resultItem) => {
        const hasBV = Boolean(resultItem?.tarifa?.fv?.bv);
        const head = hasBV
          ? `<th style="text-align:left" title="Mes del año">Mes</th><th title="Término de potencia">Potencia</th><th title="Energía bruta consumida (sin compensar)">E. Bruta</th><th title="Excedentes compensados este mes">Compensación</th><th title="Energía neta facturada">E. Neta</th><th title="Impuestos (IEE + IVA/IGIC/IPSI)">Impuestos</th><th title="Subtotal antes de aplicar BV">Subtotal</th><th title="Importe a pagar este mes">A Pagar</th><th title="Saldo BV usado este mes">Uso BV</th><th title="Saldo BV acumulado al final">Saldo BV</th>`
          : `<th style="text-align:left" title="Mes del año">Mes</th><th title="Término de potencia">Potencia</th><th title="Energía bruta consumida (sin compensar)">E. Bruta</th><th title="Excedentes compensados este mes">Compensación</th><th title="Energía neta facturada">E. Neta</th><th title="Impuestos (IEE + IVA/IGIC/IPSI)">Impuestos</th><th title="Subtotal de la factura">Subtotal</th><th title="Importe a pagar este mes">A Pagar</th>`;

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
              ${winnerUrl ? `<a href="${winnerUrl}" target="_blank" rel="noopener noreferrer" class="btn bv-link-tarifa" style="width:100%; justify-content:center; font-size:14px; padding:10px 14px;">🔗 Información de la tarifa</a>` : ''}
            </div>
          </div>
          <div class="bv-kpis-stack">
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Coste total anual</span>
              <span class="bv-kpi-value">${fEur(winner.totals.pagado)}</span>
              <span class="bv-kpi-sub">Suma de todas tus facturas mensuales</span>
            </div>
            ${winnerHasBV ? `
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Ahorro con BV</span>
              <span class="bv-kpi-value">${fEur((winner.totals.credit1Total || 0) + (winner.totals.credit2Total || 0))}</span>
              <span class="bv-kpi-sub">Compensación + uso de saldo BV</span>
            </div>
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

        return `
          <div class="bv-alt-card-compact">
            <div class="bv-alt-header">
              <div class="bv-alt-title-row">
                <span class="bv-alt-rank">#${i+2}</span>
                <h3 class="bv-alt-name">${altName}</h3>
                ${pill}
              </div>
              <div class="bv-alt-price-box">
                <div class="bv-alt-price">${fEur(r.totals.pagado)}</div>
                <div class="bv-alt-price-label">Coste total anual</div>
                ${hasBV ? `<div class="bv-alt-bv-saldo">${fEur(r.totals.bvFinal)} Saldo BV final</div>` : ''}
              </div>
            </div>

            ${hasBV ? '' : '<div class="bv-note bv-note-compact">Sin BV: el excedente no compensado se pierde.</div>'}

            <div class="bv-alt-actions">
              ${altUrl ? `<a href="${altUrl}" target="_blank" rel="noopener noreferrer" class="bv-alt-btn bv-alt-btn-info">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                Información
              </a>` : ''}
              <button type="button" class="bv-alt-btn bv-alt-btn-toggle" onclick="this.closest('.bv-alt-card-compact').querySelector('details').toggleAttribute('open'); this.classList.toggle('active');">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                Ver desglose
              </button>
            </div>

            <details class="bv-alt-details">
              <summary style="display:none;"></summary>
              ${buildTable(r).replace('margin-top:16px','margin-top:16px')}
            </details>
          </div>
        `;
      }).join('');

      const totalTarifas = rankedResults.length;
      const rankingNote = `
        <div style="background: var(--card2); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <div style="font-size: 0.95rem; color: var(--muted); line-height: 1.6;">
            <strong>¿Cómo se calcula el ranking?</strong><br>
            Las tarifas están ordenadas por el <strong>coste total anual</strong>: la suma de todas tus facturas mensuales durante el año.
            ${saldoVal > 0 ? `<br><br><strong>Nota:</strong> has indicado un saldo BV inicial de ${fEur(saldoVal)} y se descuenta en el cálculo.` : ''}
          </div>
        </div>
      `;
      resultsEl.innerHTML = `<h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>${rankingNote}${winnerHTML}<h3 style="text-align:center; margin-bottom: 24px; margin-top: 40px; color:var(--text);">Ranking completo (${totalTarifas} tarifas)</h3>${alternativesHTML}`;
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
      if (btnText) btnText.textContent = 'Comparar Tarifas y Ver Ahorro →';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  });
});
