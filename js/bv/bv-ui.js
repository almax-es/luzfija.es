/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

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

  function trackBvEvent(eventName, detail, title) {
    try {
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail(eventName, detail, { title });
      }
    } catch (_) {}
  }

  function markSolarUnavailable(detail, title) {
    const message = 'La página no terminó de cargarse. Recárgala para usar el simulador.';
    showToast(message, 'err');
    trackBvEvent('init-incompleto', detail, title);
    const statusContainer = document.getElementById('bv-status-container');
    const status = document.getElementById('bv-status');
    if (statusContainer) statusContainer.style.display = 'block';
    if (status) status.textContent = message;
    for (const id of ['bv-simulate', 'upload-csv-btn', 'bv-file']) {
      const control = document.getElementById(id);
      if (!control) continue;
      control.disabled = true;
      control.setAttribute('aria-disabled', 'true');
      control.title = 'El simulador no terminó de cargarse; recarga la página.';
    }
  }

  // bv-ui-helpers.js define window.BVSim.manualUi y se carga antes que este
  // fichero. Si no llego a cargarse (fallo de red puntual, bloqueador), abortar
  // con un aviso: sin esta guarda el simulador revienta con un TypeError opaco
  // al construir los controles y la pagina queda rota en silencio.
  if (!window.BVSim || !window.BVSim.manualUi ||
      typeof window.BVSim.manualUi.createHourlyTraceControls !== 'function') {
    markSolarUnavailable(['solar', 'manual-ui'], 'Simulador solar sin bv-ui-helpers');
    return;
  }

  const requiredManualUi = [
    'buildSimulationMonths',
    'createHourlyTraceControls',
    'normalizeMonthMeta',
    'pickLatestMonthData',
    'resolveCosteNeto',
    'resolveSaldoConfig',
    'rotateMonthsByStart'
  ];
  const requiredSimulation = ['loadTarifasBV', 'simulateForAllTarifasBV', 'simulateMonthly'];
  const missingSimulationDependency =
    requiredManualUi.some((name) => typeof window.BVSim.manualUi[name] !== 'function') ||
    requiredSimulation.some((name) => typeof window.BVSim[name] !== 'function') ||
    !window.LF || typeof window.LF.parseNum !== 'function';

  if (missingSimulationDependency) {
    markSolarUnavailable(['solar', 'simulation-core'], 'Simulador solar con dependencias incompletas');
    return;
  }

  if (typeof window.BVSim.importFile !== 'function') {
    const importButton = document.getElementById('upload-csv-btn');
    const importInput = document.getElementById('bv-file');
    if (importButton) {
      importButton.disabled = true;
      importButton.setAttribute('aria-disabled', 'true');
      importButton.title = 'El importador no terminó de cargarse; recarga la página.';
    }
    if (importInput) importInput.disabled = true;
    trackBvEvent('init-incompleto', ['solar', 'importador'], 'Simulador solar sin bv-import');
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

  // Validación en vivo para campos normales (bv-p1, bv-p2, bv-saldo-inicial)
  [p1Input, p2Input, saldoInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener('input', function () {
      validateInputFormat(input, 2);
    });
  });

  const mesInicioInput = (function () {
    const wrapperEl = document.getElementById('bv-mes-inicio');
    const btnEl = document.getElementById('bv-mes-inicio-btn');
    const valueEl = btnEl && btnEl.querySelector('.bv-cs-value');
    const listEl = document.getElementById('bv-mes-inicio-list');
    if (!wrapperEl || !btnEl || !listEl) return null;

    const DEFAULT_LABEL = 'Orden de la tabla (por defecto)';
    let _value = '';
    let _disabled = true;
    let _items = [];
    let _renderPending = false;

    function scheduleRender() {
      if (_renderPending) return;
      _renderPending = true;
      requestAnimationFrame(render);
    }

    function setValueElText(selected) {
      if (!valueEl) return;
      valueEl.textContent = selected ? selected.label : DEFAULT_LABEL;
      valueEl.classList.toggle('bv-cs-value--placeholder', !selected || selected.value === '');
    }

    function render() {
      _renderPending = false;
      const selected = _items.find((i) => i.value === _value);
      setValueElText(selected);

      btnEl.disabled = _disabled;
      wrapperEl.setAttribute('aria-disabled', String(_disabled));
      if (_disabled) close();

      listEl.innerHTML = '';
      _items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'bv-cs-item' + (item.isDefault ? ' bv-cs-item--default' : '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(item.value === _value));
        li.setAttribute('tabindex', '-1');
        li.textContent = item.label;
        li.dataset.value = item.value;
        li.addEventListener('click', () => { pick(item.value); close(); btnEl.focus(); });
        li.addEventListener('keydown', onItemKeydown);
        listEl.appendChild(li);
      });
    }

    function open() {
      if (_disabled) return;
      wrapperEl.setAttribute('aria-expanded', 'true');
      btnEl.setAttribute('aria-expanded', 'true');
      const target = listEl.querySelector('[aria-selected="true"]') || listEl.querySelector('.bv-cs-item');
      if (target) target.focus();
    }

    function close() {
      wrapperEl.setAttribute('aria-expanded', 'false');
      btnEl.setAttribute('aria-expanded', 'false');
    }

    function pick(val) {
      _value = String(val ?? '');
      const selected = _items.find((i) => i.value === _value);
      setValueElText(selected);
      listEl.querySelectorAll('.bv-cs-item').forEach((li) => {
        li.setAttribute('aria-selected', String(li.dataset.value === _value));
      });
    }

    function onItemKeydown(e) {
      const items = Array.from(listEl.querySelectorAll('.bv-cs-item'));
      const idx = items.indexOf(e.currentTarget);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); pick(e.currentTarget.dataset.value); close(); btnEl.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); if (idx < items.length - 1) items[idx + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); if (idx > 0) items[idx - 1].focus(); else btnEl.focus();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        close(); if (e.key === 'Escape') { e.preventDefault(); btnEl.focus(); }
      }
    }

    btnEl.addEventListener('click', () => {
      wrapperEl.getAttribute('aria-expanded') === 'true' ? close() : open();
    });

    btnEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); }
      else if (e.key === 'Escape') close();
    });

    document.addEventListener('pointerdown', (e) => {
      if (!wrapperEl.contains(e.target)) close();
    });

    wrapperEl.addEventListener('focusout', (e) => {
      if (!wrapperEl.contains(e.relatedTarget)) close();
    });

    return {
      get value() { return _value; },
      set value(v) { _value = String(v ?? ''); scheduleRender(); },
      get disabled() { return _disabled; },
      set disabled(v) { _disabled = Boolean(v); scheduleRender(); },
      set title(v) { if (btnEl) btnEl.title = String(v ?? ''); },
      set innerHTML(v) { _items = []; _value = ''; scheduleRender(); },
      appendChild(optEl) {
        _items.push({ value: optEl.value, label: optEl.textContent, isDefault: optEl.value === '' });
        scheduleRender();
      }
    };
  })();
  const zonaFiscalInput = document.getElementById('bv-zona-fiscal');
  const viviendaCanariasWrapper = document.getElementById('bv-vivienda-canarias-wrapper');
  const viviendaCanariasInput = document.getElementById('bv-vivienda-canarias');

  const simulateButton = document.getElementById('bv-simulate');
  const resultsContainer = document.getElementById('bv-results-container');
  const resultsEl = document.getElementById('bv-results');
  const statusContainer = document.getElementById('bv-status-container');
  const statusEl = document.getElementById('bv-status');

  const manualGrid = document.getElementById('bv-manual-grid');
  const manualMonthMetaByIndex = window.BVSim._manualMonthMeta = {};
  const hourlyTraceState = window.BVSim._hourlyTraceState = {
    records: null,
    zonaFiscal: null,
    dirty: false,
    reason: '',
    stats: null
  };
  const escapeHtml = (window.LF?.escapeHtml) ? window.LF.escapeHtml : (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const hourlyTraceControls = window.BVSim._hourlyTraceControls = window.BVSim.manualUi.createHourlyTraceControls(hourlyTraceState, escapeHtml);
  const clearHourlyTraceState = hourlyTraceControls.clear;
  const setHourlyTraceFromImport = hourlyTraceControls.setFromImport;
  const invalidateHourlyTrace = hourlyTraceControls.invalidate;
  const canUseHourlyTrace = hourlyTraceControls.canUse;
  const buildIndexedFallbackMsg = hourlyTraceControls.buildIndexedFallbackMsg;

  function dispatchResultsReady(rowsCount) {
    if (!Number.isFinite(rowsCount) || rowsCount <= 0) return;
    try {
      document.dispatchEvent(new CustomEvent('lf:results-ready', {
        detail: {
          origin: 'solar',
          rows: rowsCount
        }
      }));
    } catch (_) {}
  }

  function dispatchResultsRequested() {
    try {
      document.dispatchEvent(new CustomEvent('lf:results-requested', {
        detail: { origin: 'solar' }
      }));
    } catch (_) {}
  }

  function clearManualMonthMeta() {
    Object.keys(manualMonthMetaByIndex).forEach((key) => {
      delete manualMonthMetaByIndex[key];
    });
  }

  function setManualMonthMeta(monthIndex, meta) {
    const normalized = window.BVSim.manualUi.normalizeMonthMeta(meta);
    if (normalized) {
      manualMonthMetaByIndex[monthIndex] = normalized;
    } else {
      delete manualMonthMetaByIndex[monthIndex];
    }
  }

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

  // Validación de formato numérico para campos de entrada (no cuadrícula manual)
  // Marca con clase .error si el formato no es numérico válido, el valor es negativo
  // o supera maxValue (si se proporciona).
  // NO usa clase .valid porque el CSS solo soporta .input.error (styles.css:726)
  function validateInputFormat(input, maxDecimals, maxValue) {
    maxDecimals = maxDecimals === undefined ? 2 : maxDecimals;
    if (!input) return true;
    const raw = String(input.value || '').trim();
    if (raw === '') {
      input.classList.remove('error');
      return true;
    }
    const isValidFormat = (typeof window.LF === 'object' && window.LF !== null &&
                           typeof window.LF.esNumericoValido === 'function')
      ? window.LF.esNumericoValido(raw, maxDecimals)
      : /^[\d.,\s]+$/.test(raw);
    const parsed = parseInput(raw);
    const isInRange = maxValue === undefined || parsed <= maxValue;
    const isValid = isValidFormat && Number.isFinite(parsed) && parsed >= 0 && isInRange;
    input.classList.toggle('error', !isValid);
    return isValid;
  }

  function readManualEntriesFromGrid() {
    const entries = [];
    if (!manualGrid) return entries;

    for (let i = 0; i < 12; i++) {
      const p1In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
      const p2In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
      const p3In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
      const vIn = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

      const p1 = validateAndClampKwh(p1In ? p1In.value : 0);
      const p2 = validateAndClampKwh(p2In ? p2In.value : 0);
      const p3 = validateAndClampKwh(p3In ? p3In.value : 0);
      const vert = validateAndClampKwh(vIn ? vIn.value : 0);

      if (p1 > 0 || p2 > 0 || p3 > 0 || vert > 0) {
        entries[i] = { p1, p2, p3, vert };
      }
    }

    return entries;
  }

  function formatMonthKeyLabel(key) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!match) return String(key || '');

    const monthIndex = Number(match[2]) - 1;
    const monthName = monthNames[monthIndex] || match[2];
    return monthName;
  }

  function updateMesInicioSelector(months) {
    if (!mesInicioInput) return;

    const currentVal = mesInicioInput.value;
    const availableMonths = (Array.isArray(months) ? months : [])
      .filter((month) => /^\d{4}-\d{2}$/.test(String(month?.key || '')));

    mesInicioInput.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Orden de la tabla (por defecto)';
    mesInicioInput.appendChild(defaultOpt);

    availableMonths.forEach((month) => {
      const opt = document.createElement('option');
      opt.value = month.key;
      opt.textContent = formatMonthKeyLabel(month.key);
      mesInicioInput.appendChild(opt);
    });

    const canChoose = availableMonths.length > 1;
    if (canChoose && currentVal && availableMonths.some((month) => month.key === currentVal)) {
      mesInicioInput.value = currentVal;
    } else {
      mesInicioInput.value = '';
    }

    mesInicioInput.disabled = !canChoose;
    mesInicioInput.title = canChoose
      ? 'Elige el primer mes de la simulación para modelar la batería virtual desde ese punto.'
      : 'Introduce datos en al menos dos meses para cambiar el mes de inicio.';
  }

  function updateMesInicioSelectorFromGrid() {
    const months = window.BVSim.manualUi.buildSimulationMonths(readManualEntriesFromGrid(), {
      currentYear: new Date().getFullYear(),
      monthMetaByIndex: manualMonthMetaByIndex
    });
    updateMesInicioSelector(months);
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
        const meta = window.BVSim.manualUi.normalizeMonthMeta(manualMonthMetaByIndex[i]);
        data[i] = {
          p1: p1In.value,
          p2: p2In.value,
          p3: p3In.value,
          vert: vIn.value
        };
        if (meta) data[i].meta = meta;
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

      clearManualMonthMeta();
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
          setManualMonthMeta(i, data[i].meta);

          if (p1 > 0 || p2 > 0 || p3 > 0 || vert > 0) {
            hasData = true;
          }
        }
      }

      updateMesInicioSelectorFromGrid();

      if (hasData) {
        updateDataStatus();
        showToast('✓ Datos guardados cargados correctamente', 'ok');
      }

      clearHourlyTraceState();
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
          clearHourlyTraceState();
          updateManualTotals();
          updateMesInicioSelectorFromGrid();

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
        invalidateHourlyTrace('manual-edit');
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
        updateMesInicioSelectorFromGrid();

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
      clearManualMonthMeta();
      clearHourlyTraceState();
      updateManualTotals();
      updateMesInicioSelectorFromGrid();
      updateDataStatus();
      showToast('✓ Todos los datos han sido borrados', 'ok');
    });
  }

  // Cargar datos manuales guardados al inicio (la tabla siempre está visible)
  if (manualGrid) {
    loadManualData();
    updateManualTotals();
    updateMesInicioSelectorFromGrid();
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
    btnTheme.setAttribute('aria-pressed', isLight ? 'false' : 'true');
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
    menuPanel.setAttribute('aria-hidden', menuPanel.classList.contains('show') ? 'false' : 'true');
    btnMenu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isShow = menuPanel.classList.toggle('show');
      btnMenu.setAttribute('aria-expanded', String(isShow));
      menuPanel.setAttribute('aria-hidden', isShow ? 'false' : 'true');
    });
  }

  document.addEventListener('click', async (e) => {
    const clearBtn = (e.target instanceof Element) ? e.target.closest('#btnClearCache') : null;
    if (clearBtn) {
      if (!confirm('¿Limpiar toda la caché y reiniciar?')) return;

      try {
        const analyticsOptOut = localStorage.getItem('goatcounter_optout');
        const aeccDismissedAt = localStorage.getItem('lf_aecc_banner_dismissed_at');
        localStorage.clear();
        if (analyticsOptOut === 'true') localStorage.setItem('goatcounter_optout', 'true');
        if (/^\d+$/.test(aeccDismissedAt || '')) {
          localStorage.setItem('lf_aecc_banner_dismissed_at', aeccDismissedAt);
        }
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
        menuPanel.setAttribute('aria-hidden', 'true');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuPanel?.classList.contains('show')) {
      menuPanel.classList.remove('show');
      if (btnMenu) btnMenu.setAttribute('aria-expanded', 'false');
      menuPanel.setAttribute('aria-hidden', 'true');
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
    return window.LF.parseNum(val);
  }

  const escapeAttr = (v) => escapeHtml(v).replace(/\n/g, '&#10;');

  function sanitizeUrl(url) {
    // Unificado con la home: delega en el sanitizador canónico window.LF.safeUrl
    // (js/lf-utils.js, cargado antes que este fichero en comparador-tarifas-solares.html).
    // Acepta http/https o rutas relativas explícitas; bloquea el resto.
    // Si LF no estuviera disponible, mejor omitir el enlace que arriesgar.
    const lf = window.LF;
    return (lf && typeof lf.safeUrl === 'function') ? lf.safeUrl(url) : '';
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
      showToast('Error al limpiar los datos.', 'err');
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
  // Precios de energía (mtPunta/mtLlano/mtValle): máx 1 €/kWh
  // Precios de potencia (mtP1/mtP2): máx 1 €/kW·día
  // Precio de compensación (mtExc): máx 0,5 €/kWh
  const mtMaxValues = { mtPunta: 1, mtLlano: 1, mtValle: 1, mtP1: 1, mtP2: 1, mtExc: 0.5 };
  ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) {
      let saveTimer = null;
      el.addEventListener('input', function () {
        validateInputFormat(el, 6, mtMaxValues[id]);
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
      if (!(e.target instanceof Element)) return;
      const trigger = e.target.closest('.bv-tooltip-trigger');
      if (trigger) updateTooltipPosition(trigger);
    });

    document.addEventListener('mouseout', (e) => {
      if (!(e.target instanceof Element)) return;
      const trigger = e.target.closest('.bv-tooltip-trigger');
      if (trigger) tooltipEl.style.display = 'none';
    });
  }

  // Móvil/táctil: tap => modal.
  document.addEventListener('click', (e) => {
    if (canHover && !isCoarse) return;
    if (!(e.target instanceof Element)) return;
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
    clearManualMonthMeta();

    // 3. Mapear datos. Si hay múltiples años para el mismo mes, nos quedamos con el más reciente.
    // Estructura de month.key: "YYYY-MM"
    const { monthDataMap, yearsFound } = window.BVSim.manualUi.pickLatestMonthData(simResult.months);

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
      setManualMonthMeta(monthIndex, data.meta);

      // Marcar visualmente como válidos
      [p1In, p2In, p3In, vIn].forEach(el => {
        if (el && el.value !== '') el.classList.add('valid');
      });

      filledCount++;
    });

    // 5. Actualizar totales y guardar
    if (filledCount > 0) {
      updateManualTotals();
      updateMesInicioSelectorFromGrid();
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

    // ⚠️ CRÍTICO: ZONA GEOGRAFICA - AISLAMIENTO DEL SIMULADOR BV
    // ===========================================================
    // El simulador BV tiene su PROPIA selector de zona (HTML input),
    // independiente del comparador principal. La zona afecta:
    //   - Clasificación de periodos horarios (P1/P2/P3)
    //   - Horarios diferentes: Península (10-14, 18-22) vs Ceuta/Melilla (+1h)
    //
    // PROCEDIMIENTO:
    // 1. Obtener zona DEL SELECTOR del simulador BV (NO del comparador)
    // 2. Pasar zona a cada llamada: importFile → parseCSVConsumos → getPeriodoHorarioCSV
    // 3. El nombre del parámetro es flexible (CNMC es flexible: "Península", "peninsula", etc.)
    //    pero se normaliza internamente con NFD + toLowerCase
    //
    // NORMATIVA:
    // - CNMC Circular 3/2020: Periodos diferentes por zona
    // - Ceuta/Melilla: UTC+1 desplazado vs Península UTC+0 estándar
    //
    // POR QUÉ NO PASAR ZONA DEL COMPARADOR:
    // El usuario podría estar comparando tarifas de Canarias en el comparador principal,
    // pero queriendo simular BV para Península. Sin aislamiento, saldría mal.
    //
    // EJEMPLO NUMÉRICO (Ceuta/Melilla):
    // ────────────────────────────────────
    // CSV: Hora 11 (CNMC), Fecha 2026-01-30 (viernes, no festivo)
    //
    // ✅ Si zona = 'CeutaMelilla' (desde selector BV):
    //    Hora 11 → P1 (Punta en Ceuta/Melilla: 11-15, 19-23)
    //
    // ❌ Si zona = 'Península' (por error del comparador principal):
    //    Hora 11 → P1 (Punta en Península: 10-14, 18-22) - COINCIDE por suerte
    //    Pero Hora 15 → P2 (llano en Península) vs P1 (punta en Ceuta/Melilla)
    //    Diferencia de precio ≈ 30-40% según tarifa
    //
    // VALIDACIÓN:
    // - bv-import.js pasa zona explícitamente en cada función
    // - bv-sim-monthly.js recalcula periodos si zona = Ceuta/Melilla (línea 119-128)
    // - CALC-FAQS.md documenta por qué Ceuta/Melilla necesitan recálculo
    //
    // ÚLTIMA ACTUALIZACIÓN: 30/01/2026
    // ===========================================================
    // Procesar automáticamente para rellenar el grid manual
    try {
      if (typeof window.BVSim.importFile !== 'function') {
        showToast('El importador no terminó de cargarse. Recarga la página para subir el archivo.', 'err');
        trackBvEvent('init-incompleto', ['solar', 'importador'], 'Simulador solar sin bv-import');
        return;
      }
      // Obtener zona seleccionada ANTES de importar para clasificar periodos correctamente
      const zonaVal = zonaFiscalInput ? zonaFiscalInput.value : 'Península';
      const result = await window.BVSim.importFile(file, zonaVal);
      if (result && result.ok) {
        // Cachear el resultado
        window.BVSim._cachedImportResult = result;
        setHourlyTraceFromImport(result, zonaVal);
        // Nota: Ya no necesitamos mapear porque getPeriodoHorarioCSV normaliza internamente
        populateManualGridFromCSV(result, zonaVal);

        if (Array.isArray(result.warnings) && result.warnings.length) {
          showToast(`⚠️ ${result.warnings.join('\n')}`, 'ok');
        }

        const extension = window.LF?.csvUtils?.safeFileExtensionForTracking?.(file.name) || 'desconocido';
        trackBvEvent('csv-import-completado', [
          'solar',
          extension,
          result?.meta?.hasExcedenteColumn === false ? 'sin-excedentes' : 'con-excedentes'
        ], 'CSV/XLSX importado en simulador solar');

        // Scroll suave a la tabla para que vea los datos auto-rellenados
        setTimeout(() => {
          const manualZone = document.getElementById('bv-manual-zone');
          if (manualZone) {
            manualZone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 300);
      } else if (result && result.error) {
        console.info('Info: No se pudo pre-procesar CSV:', result.error);
        const extension = window.LF?.csvUtils?.safeFileExtensionForTracking?.(file.name) || 'desconocido';
        // Privacidad: a analítica solo viaja un código de error normalizado, nunca
        // el mensaje (puede interpolar contenido del archivo del usuario).
        const errorCode = window.LF?.csvUtils?.csvErrorCodeForTracking?.(result.error) || 'otro';
        trackBvEvent('csv-import-error', ['solar', extension, errorCode], 'Error al procesar CSV/XLSX en solar');
        showToast(result.error, 'err');
      }
    } catch (e) {
      console.warn('Error procesando CSV:', e);
      const extension = window.LF?.csvUtils?.safeFileExtensionForTracking?.(file.name) || 'desconocido';
      const errorCode = window.LF?.csvUtils?.csvErrorCodeForTracking?.(e && e.message) || 'otro';
      trackBvEvent('csv-import-error', ['solar', extension, errorCode], 'Error al procesar CSV/XLSX en solar');
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
      window.BVSim._cachedImportResult = null;
      clearHourlyTraceState();
      fileInput.value = '';
      if (fileSelectedMsg) fileSelectedMsg.style.display = 'none';
      if (resultsContainer) resultsContainer.style.display = 'none';
      if (statusContainer) statusContainer.style.display = 'none';
    });
  }

  simulateButton.addEventListener('click', async () => {
    const p1Raw = String(p1Input?.value || '').trim();
    const p2Raw = String(p2Input?.value || '').trim();
    const saldoRaw = String(saldoInput?.value || '').trim();

    // Validar P1 (igual que lf-inputs.js:447-459)
    let p1Error = null;
    const p1Val = parseInput(p1Raw);
    const p1FormatValid = (typeof window.LF === 'object' && window.LF !== null &&
                           typeof window.LF.esNumericoValido === 'function')
      ? window.LF.esNumericoValido(p1Raw, 2)
      : /^[\d.,\s]+$/.test(p1Raw);

    if (!p1Raw) {
      p1Error = 'Introduce la potencia P1 (punta).';
      p1Input.classList.add('error');
    } else if (!p1FormatValid || !Number.isFinite(p1Val)) {
      p1Error = 'La potencia P1 debe ser un número válido.';
      p1Input.classList.add('error');
    } else if (p1Val <= 0) {
      p1Error = 'La potencia P1 debe ser mayor que 0 kW.';
      p1Input.classList.add('error');
    } else if (p1Val > (window.LF_CONFIG?.POTENCIA_MAX_KW || 20)) {
      p1Error = `La potencia P1 debe ser ≤ ${window.LF_CONFIG?.POTENCIA_MAX_KW || 20} kW.`;
      p1Input.classList.add('error');
    } else {
      p1Input.classList.remove('error');
    }

    // Validar P2 (igual que lf-inputs.js:461-473, sin fallback a P1)
    let p2Error = null;
    const p2Val = parseInput(p2Raw);
    const p2FormatValid = (typeof window.LF === 'object' && window.LF !== null &&
                           typeof window.LF.esNumericoValido === 'function')
      ? window.LF.esNumericoValido(p2Raw, 2)
      : /^[\d.,\s]+$/.test(p2Raw);

    if (!p2Raw) {
      p2Error = 'Introduce la potencia P2 (valle).';
      p2Input.classList.add('error');
    } else if (!p2FormatValid || !Number.isFinite(p2Val)) {
      p2Error = 'La potencia P2 debe ser un número válido.';
      p2Input.classList.add('error');
    } else if (p2Val <= 0) {
      p2Error = 'La potencia P2 debe ser mayor que 0 kW.';
      p2Input.classList.add('error');
    } else if (p2Val > (window.LF_CONFIG?.POTENCIA_MAX_KW || 20)) {
      p2Error = `La potencia P2 debe ser ≤ ${window.LF_CONFIG?.POTENCIA_MAX_KW || 20} kW.`;
      p2Input.classList.add('error');
    } else {
      p2Input.classList.remove('error');
    }

    // Validar Saldo (igual que lf-inputs.js:565-577, sin fallback a 0)
    let saldoError = null;
    const saldoVal = parseInput(saldoRaw);
    const saldoFormatValid = (typeof window.LF === 'object' && window.LF !== null &&
                              typeof window.LF.esNumericoValido === 'function')
      ? window.LF.esNumericoValido(saldoRaw, 2)
      : /^[\d.,\s]+$/.test(saldoRaw);

    if (!saldoRaw) {
      saldoError = 'Introduce el saldo de batería virtual (o 0 si no tienes).';
      saldoInput.classList.add('error');
    } else if (!saldoFormatValid || !Number.isFinite(saldoVal)) {
      saldoError = 'El saldo de batería virtual debe ser un número válido.';
      saldoInput.classList.add('error');
    } else if (saldoVal < 0) {
      saldoError = 'El saldo de batería virtual no puede ser negativo.';
      saldoInput.classList.add('error');
    } else {
      saldoInput.classList.remove('error');
    }

    // Validar Mi tarifa (si hay contenido, debe estar completa y dentro de rango)
    const miTarifaIds = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc'];
    const miTarifaHasContent = miTarifaIds.some(function (id) {
      return String(document.getElementById(id)?.value || '').trim() !== '';
    });

    let miTarifaError = null;
    if (miTarifaHasContent) {
      const customTarifa = getCustomTarifa();
      if (!customTarifa) {
        miTarifaError = "Los datos de 'Mi tarifa actual' están incompletos. Introduce al menos un precio de energía (Punta, Llano o Valle) y uno de potencia (P1 o P2) para incluirla en la comparación.";
        // Validar formato de todos los campos (marca campos con formato inválido)
        miTarifaIds.forEach(function (id) {
          const el = document.getElementById(id);
          if (el) validateInputFormat(el, 6, mtMaxValues[id]);
        });
        // Marcar en rojo los grupos que no tengan ningún campo con contenido
        const energyIds = ['mtPunta', 'mtLlano', 'mtValle'];
        const powerIds = ['mtP1', 'mtP2'];
        const hasEnergyContent = energyIds.some(function (id) {
          return String(document.getElementById(id)?.value || '').trim() !== '';
        });
        const hasPowerContent = powerIds.some(function (id) {
          return String(document.getElementById(id)?.value || '').trim() !== '';
        });
        if (!hasEnergyContent) {
          energyIds.forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('error');
          });
        }
        if (!hasPowerContent) {
          powerIds.forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('error');
          });
        }
      } else {
        const mtRangeMessages = {
          mtPunta: 'Los precios de energía parecen muy altos (máximo: 1 €/kWh).',
          mtLlano: 'Los precios de energía parecen muy altos (máximo: 1 €/kWh).',
          mtValle: 'Los precios de energía parecen muy altos (máximo: 1 €/kWh).',
          mtP1: 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día).',
          mtP2: 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día).',
          mtExc: 'El precio de compensación parece muy alto (máximo habitual: 0,5 €/kWh).'
        };
        miTarifaIds.forEach(function (id) {
          if (miTarifaError) return;
          const raw = String(document.getElementById(id)?.value || '').trim();
          if (raw === '') return;
          const val = parseInput(raw);
          const max = mtMaxValues[id];
          if (Number.isFinite(val) && val > max) {
            miTarifaError = mtRangeMessages[id];
          }
        });
        if (miTarifaError) {
          miTarifaIds.forEach(function (id) {
            const el = document.getElementById(id);
            if (el) validateInputFormat(el, 6, mtMaxValues[id]);
          });
        }
      }
    }

    // Si hay algún error, mostrar toast con el primer error y NO continuar
    const firstError = p1Error || p2Error || saldoError || miTarifaError;
    if (firstError) {
      showToast(firstError, 'err');
      return;
    }

    // Todas las validaciones pasaron, continuar con el cálculo
    const zonaFiscalVal = zonaFiscalInput ? zonaFiscalInput.value : 'Península';
    const esViviendaCanarias = viviendaCanariasInput ? viviendaCanariasInput.checked : true;

    dispatchResultsRequested();

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
      const currentYear = new Date().getFullYear();
      const manualEntries = readManualEntriesFromGrid();

      // Validar que haya al menos 1 mes con datos
      const manualMonths = window.BVSim.manualUi.buildSimulationMonths(manualEntries, {
        currentYear,
        monthMetaByIndex: manualMonthMetaByIndex
      });

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

      const hasIndexedTariffs = tarifasResult.tarifasBV.some((tarifa) => tarifa?.fv?.exc === -1);
      const ssaaDataset = (window.LF?.ssaa && typeof window.LF.ssaa.loadDataset === 'function')
        ? await window.LF.ssaa.loadDataset()
        : null;
      let indexedTraceMode = 'reference';
      if (hasIndexedTariffs && canUseHourlyTrace(zonaFiscalVal) && window.LF?.surplusPrices?.computeHourlyCompensation) {
        if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Calculando excedentes indexados con tu curva horaria...';
        const stats = await window.LF.surplusPrices.computeHourlyCompensation(hourlyTraceState.records, {
          zonaFiscal: zonaFiscalVal
        });
        hourlyTraceState.stats = stats;
        monthlyResult.months = window.LF.surplusPrices.applyMonthlyIndexedValues(monthlyResult.months, stats);
        indexedTraceMode = monthlyResult.months.some((month) => month.indexedSurplusSource === 'hourly-index-base')
          ? 'hourly-index-base'
          : 'reference';
      }

      const baseMonths = monthlyResult.months || [];
      updateMesInicioSelector(baseMonths);
      const mesInicioVal = mesInicioInput && !mesInicioInput.disabled ? (mesInicioInput.value || '') : '';
      const mesInicioActivo = Boolean(mesInicioVal && baseMonths.some((month) => month.key === mesInicioVal));
      const mesInicioLabel = mesInicioActivo ? formatMonthKeyLabel(mesInicioVal) : '';
      const simulationMonths = window.BVSim.manualUi.rotateMonthsByStart(baseMonths, mesInicioVal);
      const monthMap = new Map(baseMonths.map((m) => [m.key, m]));

      // Saldo BV inicial: solo aplica a "Mi tarifa ⭐" con BV (la hucha no se
      // transfiere entre comercializadoras); las candidatas empiezan a 0.
      const saldoConfig = window.BVSim.manualUi.resolveSaldoConfig(customTarifa, saldoVal);
      const saldoAplicado = saldoConfig.aplicado;
      const saldoSinDestino = saldoConfig.sinDestino;

      const allResults = window.BVSim.simulateForAllTarifasBV({
        months: simulationMonths,
        tarifasBV: tarifasResult.tarifasBV,
        potenciaP1: p1Val, potenciaP2: p2Val,
        bvSaldoInicial: saldoConfig.resolver,
        zonaFiscal: zonaFiscalVal,
        esVivienda: esViviendaCanarias,
        ssaaDataset
      });

      if (!allResults || !allResults.ok || !Array.isArray(allResults.results) || allResults.results.length === 0) {
        throw new Error(allResults?.error || 'No se pudo calcular el ranking.');
      }

      // Ranking: ordenar por "pagas" (coste del periodo simulado con BV aplicada).
      // El saldo BV inicial solo afecta a "Mi tarifa ⭐": para esa tarifa el ranking
      // refleja la ventaja real de conservar la hucha al no cambiar de comercializadora.
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
      const simulatedMonths = simulationMonths;
      const completeMonths = simulatedMonths.filter((month) => {
        const daysInMonth = Number(month.daysInMonth) || (() => {
          const m = /^(\d{4})-(\d{2})$/.exec(String(month.key || ''));
          return m ? new Date(Number(m[1]), Number(m[2]), 0).getDate() : 31;
        })();
        const daysWithData = Number(month.daysWithData) || 0;
        return daysWithData >= Math.ceil(daysInMonth * 0.8);
      }).length;
      const isAnnualScope = simulatedMonths.length >= 12 && completeMonths >= 12;
      const totalCostLabel = isAnnualScope ? 'Coste total anual' : 'Coste periodo simulado';
      const totalCostSub = isAnnualScope
        ? (mesInicioActivo ? `Suma de 12 meses desde ${mesInicioLabel}` : 'Suma de todas tus facturas mensuales')
        : `Suma de ${simulatedMonths.length} mes${simulatedMonths.length === 1 ? '' : 'es'} simulado${simulatedMonths.length === 1 ? '' : 's'}`;
      const totalCostNote = isAnnualScope
        ? (mesInicioActivo ? `durante 12 meses desde ${mesInicioLabel}` : 'durante el año')
        : `durante el periodo introducido (${simulatedMonths.length} mes${simulatedMonths.length === 1 ? '' : 'es'}). No se presenta como ranking anual porque no hay 12 meses razonablemente completos`;
      const scopeAdjective = isAnnualScope ? 'anual' : 'del periodo';
      trackBvEvent('simulador-solar-resultados', [
        isAnnualScope ? 'anual' : 'parcial',
        customTarifa ? 'con-mi-tarifa' : 'sin-mi-tarifa',
        indexedTraceMode === 'hourly-index-base' ? 'indexado-horario' : 'indexado-referencia'
      ], 'Resultados simulador solar: ' + (isAnnualScope ? 'anual' : 'parcial'));

      // --- HELPERS DE CÁLCULO POR MES (una sola fuente de verdad) ---
      const computeRowView = (row, resultItem) => {
        const t = resultItem.tarifa;
        const hasBV = Boolean(t?.fv?.bv);
        const m = monthMap.get(row.key) || {};

        const imp = r2((row.impuestoElec || 0) + (row.ivaCuota || 0) + (row.costeBonoSocial || 0) + (row.alquilerContador || 0));
        const ssaaEur = r2(row.ssaaEur || 0);
        const eBruta = r2(row.consEur || 0);
        const excMes = r2(row.credit1 || 0);
        const eNeta = r2(eBruta - excMes);
        const costeBV = r2(row.costeBV || 0);
        const subtotal = r2(row.totalBase || 0);
        const usoHucha = r2(row.credit2 || 0);
        const sobranteHucha = r2(row.excedenteSobranteEur || 0);
        const noCompensableParcial = r2(row.excedenteNoCompensableEur || 0);

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
        const ssaaLine = ssaaEur > 0
          ? `\n⚙️ SSAA: ${fKwh(row.importTotalKWh || (kwhP1 + kwhP2 + kwhP3))} × ${fPrice(row.ssaaRate)} = ${fEur(ssaaEur)}${row.ssaaMonth ? ` (${row.ssaaMonth})` : ''}`
          : '';
        const tipEneBruta = `🔴 Punta: ${fKwh(kwhP1)} × ${priceFmt.format(t.cPunta)} = ${fEur(eP1)}
🟡 Llano: ${fKwh(kwhP2)} × ${priceFmt.format(t.cLlano)} = ${fEur(eP2)}
🟢 Valle: ${fKwh(kwhP3)} × ${priceFmt.format(t.cValle)} = ${fEur(eP3)}
${ssaaLine}
💰 Total: ${fEur(eBruta)}`;

        // Cálculos Excedentes
        const exKwh = Number(row.exKwh) || Number(m.exportTotalKWh) || 0;
        const totalGen = r2(Number(row.creditoPotencial) || (exKwh * (row.precioExc || 0)));
        const usesHourlyIndex = row.precioExcSource === 'hourly-index-base';
        const esCP = t?.fv?.tope === 'ENERGIA_PARCIAL';
        const maxComp = (esCP && row.baseCompensable != null)
          ? r2(row.baseCompensable) : eBruta;
        let tipMaxDetalle = '';
        if (esCP && row.peajesTotal > 0) {
          const pc = (window.LF_CONFIG && window.LF_CONFIG.peajesCargosEnergia) || {};
          const pP1 = r2(kwhP1 * (pc.P1 || 0));
          const pP2 = r2(kwhP2 * (pc.P2 || 0));
          const pP3 = r2(kwhP3 * (pc.P3 || 0));
          tipMaxDetalle = `\n❗ Peajes: P1 ${fEur(pP1)} + P2 ${fEur(pP2)} + P3 ${fEur(pP3)} = ${fEur(row.peajesTotal)}\n   Máx compensable: ${fEur(eBruta)} − ${fEur(row.peajesTotal)} = ${fEur(maxComp)}`;
        }
        const tipGen = usesHourlyIndex
          ? `💰 Índice horario: ${fKwh(exKwh)} → ${fEur(totalGen)} (media ${fPrice(row.precioExc)} €/kWh)`
          : `💰 Gen: ${fKwh(exKwh)} × ${fPrice(row.precioExc)} = ${fEur(totalGen)}`;
        const missingHours = Number(row.indexedMissingHours) || 0;
        const missingKwh = Number(row.indexedMissingKwh) || 0;
        const tipIndexMissing = usesHourlyIndex && missingHours > 0
          ? `\n⚠️ ${missingHours} horas sin precio horario en el histórico${missingKwh > 0 ? ` (${fKwh(missingKwh)} sin valorar)` : ''}.`
          : '';
        const tipExcedentes = `${tipGen}${tipIndexMissing}
✅ Comp: ${fEur(excMes)} (máx: ${fEur(maxComp)})${tipMaxDetalle}
${noCompensableParcial > 0 ? `⚠️ No aplicado por peajes/cargos: ${fEur(noCompensableParcial)}\n` : ''}${hasBV ? `💚 BV: ${fEur(sobranteHucha)}` : `❌ Se pierde: ${fEur(sobranteHucha)}`}`;

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
${costeBV > 0 ? `🔋 Cuota BV: ${fEur(costeBV)}\n` : ''}💶 ${taxLabel}: ${fEur(row.ivaCuota)}
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
          key: formatMonthKeyLabel(row.key),
          hasBV,
          pot: row.pot,
          eBruta,
          excMes,
          eNeta,
          imp,
          costeBV,
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
        const resultHasCosteBV = Boolean(resultItem?.tarifa?.fv?.bv)
          && (resultItem?.rows || []).some((row) => Number(row.costeBV || 0) > 0);
        return resultItem.rows.map((row) => {
          const v = computeRowView(row, resultItem);
          const hasBV = v.hasBV;
          const huchaCell = hasBV ? (v.usoHucha > 0 ? `-${fEur(v.usoHucha)}` : fEur(0)) : '';
          const saldoCell = hasBV ? fEur(v.bvSaldoFin) : '';
          const saldoStyle = hasBV ? 'color:#fbbf24; font-weight:700;' : '';
          const cuotaBVCell = resultHasCosteBV
            ? `<td data-label="Cuota BV" class="bv-tooltip-trigger" data-tip="Coste fijo mensual de la batería virtual, prorrateado si el mes está incompleto."><span class="bv-cell-value">${fEur(v.costeBV)}</span></td>`
            : '';

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
              ${cuotaBVCell}
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
                ${hasBV && v.costeBV > 0 ? item('Cuota BV', fEur(v.costeBV), 'Coste fijo mensual de la batería virtual, prorrateado si el mes está incompleto.') : ''}
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
        const hasCosteBV = hasBV && (resultItem?.rows || []).some((row) => Number(row.costeBV || 0) > 0);
        const head = hasBV
          ? `<th style="text-align:left" title="Mes del año">Mes</th><th title="Término de potencia">Potencia</th><th title="Energía bruta consumida (sin compensar)">E. Bruta</th><th title="Excedentes compensados este mes">Compensación</th><th title="Energía neta facturada">E. Neta</th><th title="Bono social, IEE, contador e IVA/IGIC/IPSI">Impuestos</th>${hasCosteBV ? '<th title="Coste fijo mensual de la batería virtual">Cuota BV</th>' : ''}<th title="Subtotal antes de aplicar BV">Subtotal</th><th title="Importe a pagar este mes">A Pagar</th><th title="Saldo BV usado este mes">Uso BV</th><th title="Saldo BV acumulado al final">Saldo BV</th>`
          : `<th style="text-align:left" title="Mes del año">Mes</th><th title="Término de potencia">Potencia</th><th title="Energía bruta consumida (sin compensar)">E. Bruta</th><th title="Excedentes compensados este mes">Compensación</th><th title="Energía neta facturada">E. Neta</th><th title="Bono social, IEE, contador e IVA/IGIC/IPSI">Impuestos</th><th title="Subtotal de la factura">Subtotal</th><th title="Importe a pagar este mes">A Pagar</th>`;
        const cycleNote = mesInicioActivo
          ? `<div class="bv-cycle-note"><strong>Simulación desde ${escapeHtml(mesInicioLabel)}.</strong> La batería virtual se arrastra en el orden mostrado.</div>`
          : '';

        // Ojo: buildRows ya omite celdas BV si no aplica.
        // En BV, para mantener el orden visual, las columnas "Hucha" y "Saldo" se colocan al final.
        // (En móvil se verán como filas etiquetadas igualmente.)
        return `
          <div class="bv-breakdown" style="margin-top:16px;">
            ${cycleNote}
            <div class="bv-breakdown-desktop">
              <div class="bv-table-container">
                <table class="bv-table ${hasBV ? 'bv-table--bv' : ''} ${hasCosteBV ? 'bv-table--with-coste-bv' : ''}">
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

      // Helper: Aviso condiciones/revisión de precio (campo requisitos)
      const getRequisitosDisclaimer = (tarifa) => {
        const req = tarifa?.requisitos;
        if (!req) return '';
        return `<div style="
          margin-top: 8px;
          padding: 8px 12px;
          background: color-mix(in srgb, var(--warn) 8%, transparent);
          border-left: 2px solid var(--warn);
          border-radius: 6px;
          font-size: 0.8125rem;
          line-height: 1.4;
          color: var(--text);
          opacity: 0.9;
        ">ℹ️ ${escapeHtml(req)}</div>`;
      };

      // Helper: Disclaimer para tarifas con precio indexado (marcadas con -1)
      const getIndexadoDisclaimer = (tarifa, resultItem) => {
        const esIndexada = tarifa?.fv?.exc === -1;
        if (!esIndexada) return '';
        const rows = Array.isArray(resultItem?.rows) ? resultItem.rows : [];
        const usesHourlyIndex = rows.some((row) => row.precioExcSource === 'hourly-index-base');
        const missing = rows.reduce((acc, row) => acc + (Number(row.indexedMissingHours) || 0), 0);
        const text = usesHourlyIndex
          ? `Cálculo horario según índice base: los excedentes importados se valoran hora a hora con el histórico disponible. Es exacto solo si la fórmula comercial coincide con ese índice; si hay ajustes, costes de gestión o fórmula propia, puede variar.${missing > 0 ? ` ${missing} horas no encontraron precio horario.` : ''}`
          : `Referencia orientativa: sin curva horaria trazable, esta tarifa indexada usa ${(window.LF_CONFIG?.INDEXED_SURPLUS_REFERENCE_PRICE ?? 0.02).toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/kWh como referencia. El importe real depende de las horas exactas de vertido y de la fórmula comercial.`;
        return `<div class="bv-nufri-disclaimer" style="
          margin-top: 8px;
          padding: 8px 12px;
          background: color-mix(in srgb, var(--warn) 8%, transparent);
          border-left: 2px solid var(--warn);
          border-radius: 6px;
          font-size: 0.8125rem;
          line-height: 1.4;
          color: var(--text);
          opacity: 0.9;
        ">
          <span style="opacity: 0.7;">ℹ️</span> <strong>Tarifa indexada:</strong> ${escapeHtml(text)}
        </div>`;
      };

      // Helper: Aviso compensación parcial (tope ENERGIA_PARCIAL)
      const getCompParcialDisclaimer = (tarifa, resultItem) => {
        if (!tarifa?.fv || tarifa.fv.tope !== 'ENERGIA_PARCIAL') return '';

        let detalle = '';
        if (resultItem?.rows?.length) {
          let totalCons = 0, totalPeajes = 0, totalBase = 0;
          resultItem.rows.forEach(row => {
            totalCons += row.consEur || 0;
            totalPeajes += row.peajesTotal || 0;
            totalBase += row.baseCompensable || 0;
          });
          totalCons = r2(totalCons); totalPeajes = r2(totalPeajes); totalBase = r2(totalBase);
          if (totalCons > 0 && totalPeajes > 0) {
            const pct = Math.round(totalBase / totalCons * 100);
            detalle = ` En tu caso: de ${fEur(totalCons)} de consumo ${scopeAdjective}, ${fEur(totalPeajes)} son peajes/cargos. Solo el ${pct}% (${fEur(totalBase)}) es compensable.`;
          }
        }

        return `<div class="bv-te-disclaimer" style="
          margin-top: 8px;
          padding: 8px 12px;
          background: color-mix(in srgb, var(--danger) 10%, transparent);
          border-left: 3px solid var(--danger);
          border-radius: 6px;
          font-size: 0.8125rem;
          line-height: 1.4;
          color: var(--text);
        ">
          ❗ <strong>Compensación parcial:</strong> Esta tarifa solo compensa sobre energía pura (sin peajes ni cargos).${detalle} Los resultados ya reflejan esta limitación.
        </div>`;
      };

      // HTML del Ganador
      const winnerName = escapeHtml(winner.tarifa?.nombre || '');
      const winnerUrl = sanitizeUrl(winner.tarifa?.web);
      const winnerHref = winnerUrl ? escapeAttr(winnerUrl) : '';
      const winnerHasBV = Boolean(winner.tarifa?.fv?.bv);
      const winnerNeto = window.BVSim.manualUi.resolveCosteNeto(winner.totals, winnerHasBV);
      const pillWinner = winnerHasBV
        ? '<span class="bv-pill bv-pill--bv" title="Esta tarifa acumula el excedente sobrante (en €) para meses futuros.">Con batería virtual</span>'
        : '<span class="bv-pill bv-pill--no-bv" title="Esta tarifa NO acumula excedente sobrante: lo no compensado se pierde cada mes.">Sin batería virtual</span>';
      const winnerNufriNote = getIndexadoDisclaimer(winner.tarifa, winner);
      const winnerCompParcialNote = getCompParcialDisclaimer(winner.tarifa, winner);
      const winnerReqNote = getRequisitosDisclaimer(winner.tarifa);

      // Delta frente a "Mi tarifa ⭐" (si el usuario la ha rellenado)
      const customResult = rankedResults.find((r) => r.tarifa?.esPersonalizada);
      const customRank = customResult ? rankedResults.indexOf(customResult) + 1 : 0;
      const winnerIsCustom = Boolean(winner.tarifa?.esPersonalizada);
      let customDeltaKpi = '';
      if (customResult && !winnerIsCustom) {
        const deltaVsCustom = r2((customResult.totals.pagado || 0) - (winner.totals.pagado || 0));
        if (deltaVsCustom > 0.005) {
          customDeltaKpi = `
            <div class="bv-kpi-card highlight">
              <span class="bv-kpi-label">Frente a tu tarifa actual</span>
              <span class="bv-kpi-value surplus">−${fEur(deltaVsCustom)}</span>
              <span class="bv-kpi-sub">Mi tarifa ⭐ pagaría ${fEur(customResult.totals.pagado)} (#${customRank} del ranking)${saldoAplicado ? ', ya contando el saldo BV que perderías al cambiar' : ''}</span>
            </div>`;
        } else {
          // Empate en coste: el puesto se ha decidido por el saldo BV final
          customDeltaKpi = `
            <div class="bv-kpi-card highlight">
              <span class="bv-kpi-label">Frente a tu tarifa actual</span>
              <span class="bv-kpi-value">Empate</span>
              <span class="bv-kpi-sub">Mismo coste del periodo que Mi tarifa ⭐ (#${customRank}); el puesto se decide por el saldo BV final</span>
            </div>`;
        }
      }
      const winnerCustomNote = winnerIsCustom
        ? '<div class="bv-note bv-note-compact" style="margin-top:8px;">⭐ Es tu tarifa actual: ninguna de las simuladas mejora su coste del periodo.</div>'
        : '';

      const winnerHTML = `
        <div class="bv-results-grid" style="margin-bottom: 40px;">
          <div class="bv-winner-card-compact">
            <div class="bv-winner-badge">🏆 Mejor Opción</div>
            <h2 class="bv-winner-name">${winnerName}</h2>
            <div style="margin-top: 8px;">${pillWinner}</div>
            ${winnerCustomNote}
            ${winnerReqNote}
            ${winnerNufriNote}
            ${winnerCompParcialNote}
            <div style="margin-top:auto; padding-top:1.5rem; width:100%">
              ${winnerHref ? `<a href="${winnerHref}" target="_blank" rel="noopener nofollow" referrerpolicy="origin" class="btn bv-link-tarifa" data-lf-track-context="solar" data-lf-track-tarifa="${escapeAttr(winner.tarifa?.nombre || '')}" style="width:100%; justify-content:center; font-size:14px; padding:10px 14px;">🔗 Información de la tarifa</a>` : ''}
            </div>
          </div>
          <div class="bv-kpis-stack">
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">${totalCostLabel}</span>
              <span class="bv-kpi-value">${fEur(winner.totals.pagado)}</span>
              <span class="bv-kpi-sub">${totalCostSub}</span>
            </div>
            ${customDeltaKpi}
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Compensación de excedentes</span>
              <span class="bv-kpi-value">${fEur(winner.totals.credit1Total || 0)}</span>
              <span class="bv-kpi-sub">Descontada de tus facturas mes a mes</span>
            </div>
            ${winnerHasBV ? `
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">Uso de hucha BV</span>
              <span class="bv-kpi-value">${fEur(winner.totals.credit2Total || 0)}</span>
              <span class="bv-kpi-sub">Saldo BV gastado en facturas del periodo</span>
            </div>
            <div class="bv-kpi-card highlight">
              <span class="bv-kpi-label">Saldo BV final</span>
              <span class="bv-kpi-value surplus">${fEur(winner.totals.bvFinal)}</span>
              <span class="bv-kpi-sub">Acumulado al final · uso y caducidad según condiciones de la comercializadora</span>
            </div>
            ${winnerNeto.mostrar ? `
            <div class="bv-kpi-card">
              <span class="bv-kpi-label">${winnerNeto.label}</span>
              <span class="bv-kpi-value${winnerNeto.aFavor ? ' surplus' : ''}">${fEur(winnerNeto.importe)}</span>
              <span class="bv-kpi-sub">Pagado menos saldo BV final; cuenta solo si sigues con la comercializadora y lo consumes en facturas futuras</span>
            </div>
            ` : ''}
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
        const altHref = altUrl ? escapeAttr(altUrl) : '';
        const hasBV = Boolean(r.tarifa?.fv?.bv);
        const pill = hasBV
          ? '<span class="bv-pill bv-pill--bv" title="Acumula excedente sobrante para meses futuros.">Con BV</span>'
          : '<span class="bv-pill bv-pill--no-bv" title="No acumula excedente sobrante; lo no compensado se pierde.">Sin BV</span>';
        const altNufriNote = getIndexadoDisclaimer(r.tarifa, r);
        const altCompParcialNote = getCompParcialDisclaimer(r.tarifa, r);
        const altReqNote = getRequisitosDisclaimer(r.tarifa);
        const deltaVsWinner = r2((r.totals.pagado || 0) - (winner.totals.pagado || 0));
        const deltaHTML = deltaVsWinner > 0.005
          ? `<div class="bv-alt-delta" style="font-size:11px; font-weight:700; color:var(--warn); margin-top:2px;">+${fEur(deltaVsWinner)} vs mejor opción</div>`
          : '';
        const altNeto = window.BVSim.manualUi.resolveCosteNeto(r.totals, hasBV);
        const altNetoHTML = altNeto.mostrar
          ? `<div class="bv-alt-neto">${altNeto.label}: ${fEur(altNeto.importe)}</div>`
          : '';

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
                <div class="bv-alt-price-label">${totalCostLabel}</div>
                ${deltaHTML}
                ${hasBV ? `<div class="bv-alt-bv-saldo">${fEur(r.totals.bvFinal)} Saldo BV final</div>` : ''}
                ${altNetoHTML}
              </div>
            </div>

            ${altReqNote}
            ${altNufriNote}
            ${altCompParcialNote}
            ${hasBV ? '' : '<div class="bv-note bv-note-compact">Sin BV: el excedente no compensado se pierde.</div>'}

            <div class="bv-alt-actions">
              ${altHref ? `<a href="${altHref}" target="_blank" rel="noopener nofollow" referrerpolicy="origin" class="bv-alt-btn bv-alt-btn-info" data-lf-track-context="solar" data-lf-track-tarifa="${escapeAttr(r.tarifa?.nombre || '')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                Información
              </a>` : ''}
              <button type="button" class="bv-alt-btn bv-alt-btn-toggle">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                Ver desglose
              </button>
            </div>

            <details class="bv-alt-details">
              <summary style="display:none;"></summary>
              ${buildTable(r)}
            </details>
          </div>
        `;
      }).join('');

      const totalTarifas = rankedResults.length;
      const indexedFallbackMsg = buildIndexedFallbackMsg(hasIndexedTariffs, indexedTraceMode, zonaFiscalVal);
      const mesInicioNote = mesInicioActivo
        ? `<br><br><strong>Mes de inicio:</strong> simulación desde ${escapeHtml(mesInicioLabel)}. La hucha se arrastra en el orden mostrado en los desgloses.`
        : '';
      let saldoInicialNote = '';
      if (saldoAplicado) {
        saldoInicialNote = `<br><br><strong>Saldo BV inicial:</strong> los ${fEur(saldoVal)} indicados se aplican solo a <strong>Mi tarifa ⭐</strong>. Las demás tarifas empiezan con la hucha a 0 €: el saldo acumulado no se transfiere al cambiar de comercializadora.`;
      } else if (saldoSinDestino) {
        saldoInicialNote = `<br><br><strong>⚠️ Saldo BV inicial no aplicado:</strong> has indicado ${fEur(saldoVal)}, pero no hay ninguna tarifa actual con batería virtual a la que aplicarlo. Rellena "Comparar con mi tarifa actual" y marca "Tiene batería virtual" si tu hucha está en tu contrato de ahora.`;
      }
      const rankingNote = `
        <div style="background: var(--card2); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <div style="font-size: 0.95rem; color: var(--muted); line-height: 1.6;">
            <strong>¿Cómo se calcula el ranking?</strong><br>
            Las tarifas están ordenadas por el <strong>${totalCostLabel.toLowerCase()}</strong>: la suma de tus facturas mensuales ${totalCostNote}.
            ${hasIndexedTariffs && indexedTraceMode === 'hourly-index-base' ? '<br><br><strong>Indexadas:</strong> se han calculado con tu CSV horario según el índice base disponible.' : ''}
            ${indexedFallbackMsg ? '<br><br><strong>Indexadas:</strong> ' + indexedFallbackMsg : ''}
            <br><br><strong>Batería virtual:</strong> el simulador modela una BV amplia: el excedente sobrante se acumula en euros y se aplica a facturas posteriores, sin caducidad. Las condiciones reales (caducidad del saldo, qué parte de la factura cubre) varían según cada comercializadora.
            ${mesInicioNote}
            ${saldoInicialNote}
          </div>
        </div>
      `;
      resultsEl.innerHTML = `<h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>${rankingNote}${winnerHTML}<h3 style="text-align:center; margin-bottom: 24px; margin-top: 40px; color:var(--text);">Ranking completo (${totalTarifas} tarifas)</h3>${alternativesHTML}`;
      resultsEl.querySelectorAll('.bv-alt-btn-toggle').forEach((button) => {
        button.addEventListener('click', () => {
          const card = button.closest('.bv-alt-card-compact');
          const details = card?.querySelector('details');
          if (!details) return;
          details.toggleAttribute('open');
          button.classList.toggle('active');
        });
      });
      resultsContainer.style.display = 'block';
      setTimeout(() => {
        resultsContainer.classList.add('show');
        dispatchResultsReady(totalTarifas);
      }, 10);
      statusContainer.style.display = 'none';
      if (saldoSinDestino) {
        showToast('Cálculo completado. El saldo BV inicial no se ha aplicado: no hay tarifa actual con batería virtual.', 'err');
      } else {
        showToast('Cálculo completado.', 'ok');
      }

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
