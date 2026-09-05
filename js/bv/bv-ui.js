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
    'getConsumptionCoverageDays',
    'hasFullAnnualConsumptionCoverage',
    'normalizeMonthMeta',
    'pickLatestMonthData',
    'compareRankedResultsByPaid',
    'resolveCosteNeto',
    'resolveMonthStartKey',
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
  const shareConfigButton = document.getElementById('btnShare');
  const shareDialog = document.getElementById('bv-share-dialog');
  const shareMonthlyInput = document.getElementById('bv-share-include-monthly');
  const sharePrivateInput = document.getElementById('bv-share-include-private');
  const shareScopeEl = document.getElementById('bv-share-scope');
  const shareCancelButton = document.getElementById('bv-share-cancel');
  const shareConfirmButton = document.getElementById('bv-share-confirm');
  const shareResultsButton = document.getElementById('bv-share-results');
  const shareResultsWrap = document.getElementById('bv-share-results-wrap');
  const sharedScenarioNotice = document.getElementById('bv-shared-scenario-notice');
  const sharedScenarioText = document.getElementById('bv-shared-scenario-text');
  const saveSharedScenarioButton = document.getElementById('bv-save-shared-scenario');
  let sharedScenarioConfig = null;
  let sharedTarifasUpdatedAt = null;
  // true mientras se esta viendo un escenario recibido por `?bv=` que el usuario aun no ha
  // adoptado. Bloquea el autosave; solo el boton "Guardar escenario" hace la transicion.
  let isSharedPreview = false;
  let shareLastFocusedEl = null;
  const MANUAL_STORAGE_KEYS = Object.freeze([
    'bv_manual_data_v2',
    'bv_custom_tarifa',
    'bv_manual_data_timestamp'
  ]);

  function shareScopeSegment(options) {
    if (options.includeMonthly && options.includePrivate) return 'completo';
    if (options.includeMonthly) return 'consumo';
    if (options.includePrivate) return 'privado';
    return 'minimo';
  }

  function trackShareEvent(eventName, options) {
    const detail = ['solar'];
    if (options) detail.push(shareScopeSegment(options));
    trackBvEvent(eventName, detail, eventName === 'url-compartida'
      ? 'Enlace compartido: simulador solar'
      : 'Diálogo de compartir abierto: simulador solar');
  }

  // Validación en vivo para campos normales (bv-p1, bv-p2, bv-saldo-inicial)
  [p1Input, p2Input, saldoInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener('input', function () {
      validateInputFormat(input, 2);
      invalidateVisibleSimulationResults();
      saveManualData();
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
      wrapperEl.classList.add('is-open');
      btnEl.setAttribute('aria-expanded', 'true');
      const target = listEl.querySelector('[aria-selected="true"]') || listEl.querySelector('.bv-cs-item');
      if (target) target.focus();
    }

    function close() {
      wrapperEl.classList.remove('is-open');
      btnEl.setAttribute('aria-expanded', 'false');
    }

    function pick(val) {
      _value = String(val ?? '');
      const selected = _items.find((i) => i.value === _value);
      setValueElText(selected);
      listEl.querySelectorAll('.bv-cs-item').forEach((li) => {
        li.setAttribute('aria-selected', String(li.dataset.value === _value));
      });
      invalidateVisibleSimulationResults();
      saveManualData();
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
      btnEl.getAttribute('aria-expanded') === 'true' ? close() : open();
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
  let useAnnualConsumptionEstimate = false;
  let annualConsumptionEstimateBasis = null;
  let focusAnnualConsumptionEstimateToggle = false;

  const manualGrid = document.getElementById('bv-manual-grid');
  const manualMonthMetaByIndex = window.BVSim._manualMonthMeta = {};
  const manualGridImportState = window.BVSim._manualGridImportState = {
    result: null,
    zonaFiscal: null,
    dirty: false
  };
  const hourlyTraceState = window.BVSim._hourlyTraceState = {
    records: null,
    zonaFiscal: null,
    dirty: false,
    reason: '',
    stats: null,
    // Se incrementa en clear/setFromImport/invalidate/retargetZone (bv-ui-helpers.js): un
    // calculo en curso puede comparar esto contra lo que capturo al empezar para detectar
    // que la traza horaria cambio mientras esperaba, sin serializar miles de registros.
    rev: 0
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
  const retargetHourlyTraceZone = hourlyTraceControls.retargetZone;
  const canUseHourlyTrace = hourlyTraceControls.canUse;
  const buildIndexedFallbackMsg = hourlyTraceControls.buildIndexedFallbackMsg;
  const clearGridImportState = window.BVSim.manualUi.clearGridImportState;

  // Varios trabajos asincronos pueden sobrevivir al contexto que los origino si no se invalidan:
  // - importFile() puede seguir parseando un CSV/XLSX mientras el usuario selecciona otro;
  // - FileReader puede seguir leyendo un respaldo JSON tras otra importacion o un reset;
  // - el autosave de la tabla manual espera 800 ms tras el ultimo input.
  // Todos se controlan en la frontera que PUBLICA/reemplaza estado, no en los consumidores.
  let fileImportGeneration = 0;
  let backupImportGeneration = 0;
  let manualSaveTimer = null;
  let resultRenderGeneration = 0;

  function invalidatePendingFileImport() {
    fileImportGeneration += 1;
  }

  function invalidatePendingBackupImport() {
    backupImportGeneration += 1;
  }

  function cancelManualAutosave() {
    if (manualSaveTimer !== null) {
      clearTimeout(manualSaveTimer);
      manualSaveTimer = null;
    }
  }

  function clearActiveFileSelection() {
    invalidatePendingFileImport();
    window.BVSim.file = null;
    window.BVSim._cachedImportResult = null;
    if (fileInput) fileInput.value = '';
    if (fileNameDisplay) fileNameDisplay.textContent = '';
    if (fileSelectedMsg) fileSelectedMsg.style.display = 'none';
  }

  function clearManualGridInputs() {
    if (!manualGrid) return;
    manualGrid.querySelectorAll('input.manual-input').forEach((input) => {
      input.value = '';
      input.classList.remove('error', 'valid');
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
  }

  function clearRenderedSimulationOutput() {
    // Cancela tambien el commit visual diferido (10 ms) del ultimo ranking: si un reset/edit
    // ocurre en esa ventana, el timeout viejo no puede volver a marcar el contenedor como visible
    // ni anunciar `lf:results-ready` para un resultado que ya fue invalidado.
    resultRenderGeneration += 1;
    if (resultsContainer) {
      resultsContainer.classList.remove('show');
      resultsContainer.style.display = 'none';
    }
    if (shareResultsWrap) shareResultsWrap.hidden = true;
    if (statusContainer) statusContainer.style.display = 'none';
    if (statusEl) statusEl.innerHTML = '';
  }

  function invalidateVisibleSimulationResults() {
    // El contenedor empieza sin `display` inline y el CSS lo mantiene oculto. Solo `block`
    // significa que esta instancia ha publicado algo; no mostrar un aviso de "resultado viejo"
    // por el primer cambio del formulario antes de haber calculado nunca.
    if (!resultsContainer || resultsContainer.style.display !== 'block') return;
    clearRenderedSimulationOutput();
    if (statusContainer && statusEl) {
      statusContainer.style.display = 'block';
      statusEl.textContent = 'Has cambiado datos del escenario. Pulsa Calcular de nuevo para actualizar la comparación.';
    }
  }

  function clearSaveIndicator() {
    if (!saveIndicator) return;
    saveIndicator.className = 'bv-save-indicator';
    saveIndicator.textContent = '';
  }

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

  // Función para validar y limitar valores. USO: solo para totales visuales en vivo
  // (updateManualTotals) — la ruta economica (readManualEntriesFromGrid) NUNCA debe clampar en
  // silencio un valor invalido, debe bloquear el calculo (ver validateManualGridInput).
  function validateAndClampKwh(value, max = 10000) {
    const num = parseInput(value);
    if (num < 0) return 0;
    if (num > max) return max;
    if (!isFinite(num)) return 0;
    return num;
  }

  // Validacion estricta para un input de la cuadricula manual: rechaza formato ambiguo
  // ("1,2,3", "1.2.3" — mas de un separador decimal) ademas de negativos/fuera de rango.
  // Se usa TANTO en el listener 'input' (feedback visual en vivo) COMO otra vez justo antes de
  // calcular (readManualEntriesFromGrid/manualGridHasInvalidInputs), porque un respaldo/URL
  // compartida puede rellenar el .value sin disparar el evento 'input'.
  // Nucleo puro (sin DOM) de la validacion de la cuadricula manual: valida un string crudo
  // cualquiera, venga o no de un <input> en pantalla. Se reutiliza tanto para el listener en
  // vivo (validateManualGridInput) como para revalidar datos que llegan de fuera (backup
  // importado, escenario compartido) ANTES de escribirlos en el formulario — de lo contrario
  // un "1,2,3" invalido en Calcular podia exportarse/compartirse tal cual y, al restaurarlo,
  // parseInput+formatNumberES lo "curaba" en silencio a "12,3" (valido, pero un numero
  // distinto que el usuario nunca confirmo).
  function parseManualGridRaw(rawValue) {
    rawValue = String(rawValue == null ? '' : rawValue).trim();
    if (rawValue === '') return { valid: true, value: 0, raw: '' };

    const commaCount = (rawValue.match(/,/g) || []).length;
    const dotCount = (rawValue.match(/\./g) || []).length;
    const hasKnownFormat = (typeof window.LF === 'object' && window.LF !== null &&
                            typeof window.LF.esNumericoValido === 'function')
      ? window.LF.esNumericoValido(rawValue)
      : /^[\d.,\s]+$/.test(rawValue);
    // Como maximo UN separador decimal de cada tipo: "1.234,56"/"1234.56"/"1234,56" son
    // formatos legitimos con como mucho un punto Y una coma; "1,2,3" o "1.2.3" no lo son.
    const isUnambiguousFormat = hasKnownFormat && commaCount <= 1 && dotCount <= 1;

    let valid = isUnambiguousFormat;
    let value = 0;
    if (valid) {
      value = parseInput(rawValue);
      valid = Number.isFinite(value) && value >= 0 && value <= 10000;
    }
    return { valid, value, raw: rawValue };
  }

  function validateManualGridInput(input) {
    const result = parseManualGridRaw(input && input.value);
    if (input) {
      input.classList.toggle('error', !result.valid);
      input.classList.toggle('valid', result.valid && result.value > 0);
      if (result.valid) {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      } else {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'bv-manual-invalid-message');
      }
    }
    return result;
  }

  // Analogo a manualGridHasInvalidInputs() pero sobre datos que aun NO estan en el DOM: un
  // objeto {mes: {p1,p2,p3,vert}} tal como lo serializan collectManualGridData()/backup/enlace
  // compartido. true si algun valor crudo no pasa la misma validacion que exige Calcular.
  function manualGridDataHasInvalidValues(data) {
    if (!data || typeof data !== 'object') return false;
    return Object.keys(data).some((key) => {
      const month = data[key];
      if (!month || typeof month !== 'object') return false;
      return ['p1', 'p2', 'p3', 'vert'].some((field) => !parseManualGridRaw(month[field]).valid);
    });
  }

  // Revalida TODOS los inputs de la cuadricula manual justo antes de calcular (no solo confia
  // en la clase .error, que puede no reflejar un valor cargado desde un respaldo/URL compartida
  // sin pasar por el listener 'input'). Devuelve true si hay algun input invalido.
  function manualGridHasInvalidInputs() {
    if (!manualGrid) return false;
    const inputs = manualGrid.querySelectorAll('input.manual-input');
    let hasInvalid = false;
    inputs.forEach((input) => {
      const { valid } = validateManualGridInput(input);
      if (!valid) hasInvalid = true;
    });
    return hasInvalid;
  }

  // Decimales admitidos en los precios de "Mi tarifa" del simulador solar.
  // Duplicado a propósito desde js/lf-tarifa-custom.js (misma constante) para
  // que home y solar acepten los mismos valores de factura (7-8 decimales).
  const MAX_DECIMALES_PRECIO = 8;
  const mtMaxValues = { mtPunta: 1, mtLlano: 1, mtValle: 1, mtP1: 1, mtP2: 1, mtExc: 0.5 };
  // El contrato del dataset permite P2=0 pero P1 mantiene minimo positivo (ver
  // validateMiTarifa en js/lf-tarifa-custom.js). Solo aplica a un campo con contenido:
  // P1 vacio sigue heredando el fallback de P2 en getCustomTarifa().
  const mtMinExclusive = { mtP1: 0 };

  // Validación de formato numérico para campos de entrada (no cuadrícula manual)
  // Marca con clase .error si el formato no es numérico válido, el valor es negativo
  // o supera maxValue (si se proporciona).
  // NO usa clase .valid porque el CSS solo soporta .input.error (styles.css:726)
  function validateInputFormat(input, maxDecimals, maxValue, minExclusive) {
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
    // Minimo EXCLUSIVO opcional: P1 no admite 0 (contrato del dataset, igual que la home).
    // Tiene que vivir aqui y no solo en el manejador de Calcular: la validacion en vivo se
    // reejecuta despues (restauracion, listener de input) y borraba la marca roja a los ~110 ms,
    // dejando el aviso sin campo senhalado. Medido con MutationObserver el 05/09/2026.
    const isAboveMin = minExclusive === undefined || parsed > minExclusive;
    const isValid = isValidFormat && Number.isFinite(parsed) && parsed >= 0 && isInRange && isAboveMin;
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

      // "Mes aportado" = al menos un campo tiene contenido no vacio, INCLUIDO un "0" explicito.
      // Antes se usaba p1>0||p2>0||p3>0||vert>0, que trataba un mes con los 4 campos a cero
      // exactamente igual que un mes nunca rellenado — pero un mes a cero sigue teniendo
      // costes fijos (potencia, contador, cuota BV) y no debe desaparecer de la simulacion.
      // Valores ya validados por validateManualGridInput (ruta economica: parsea, no clampa;
      // un input invalido se bloquea en el manejador de Calcular, no se corrige en silencio).
      const raws = [p1In, p2In, p3In, vIn].map((inp) => String(inp ? inp.value : '').trim());
      if (raws.every((v) => v === '')) continue;

      entries[i] = {
        p1: parseInput(raws[0]),
        p2: parseInput(raws[1]),
        p3: parseInput(raws[2]),
        vert: parseInput(raws[3])
      };
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

  function updateMesInicioSelector(months, requestedKey = null) {
    if (!mesInicioInput) return;

    // requestedKey === null significa "conserva lo que ya hay puesto" (repintado normal del
    // selector). Al restaurar un escenario se pasa la clave persistida explicitamente, porque
    // asignarla despues al <select> no crea la <option> y el valor efectivo quedaba vacio.
    const currentVal = requestedKey === null ? mesInicioInput.value : String(requestedKey || '');
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
    const resolvedVal = window.BVSim.manualUi.resolveMonthStartKey(availableMonths, currentVal);
    if (canChoose && resolvedVal) {
      mesInicioInput.value = resolvedVal;
    } else {
      mesInicioInput.value = '';
    }

    mesInicioInput.disabled = !canChoose;
    mesInicioInput.title = canChoose
      ? 'Elige el primer mes de la simulación para modelar la batería virtual desde ese punto.'
      : 'Introduce datos en al menos dos meses para cambiar el mes de inicio.';
  }

  function updateMesInicioSelectorFromGrid(requestedKey = null) {
    const months = window.BVSim.manualUi.buildSimulationMonths(readManualEntriesFromGrid(), {
      currentYear: new Date().getFullYear(),
      monthMetaByIndex: manualMonthMetaByIndex
    });
    updateMesInicioSelector(months, requestedKey);
  }

  // Función para formatear número al estilo español (decimales con coma)
  // Para usar en inputs donde el usuario debe ver formato español.
  // preserveZero:true evita que un 0 legitimo (dato realmente aportado, ya sea restaurado de
  // localStorage/URL compartida o procedente de un mes real de CSV) se muestre como campo
  // vacio — antes esta funcion no distinguia "cero real" de "sin dato", perdiendo la distincion
  // en cuanto se recargaba la pagina o se reimportaba un escenario guardado.
  function formatNumberES(num, { preserveZero = false } = {}) {
    if (num === null || num === undefined || num === '') return '';
    const n = Number(num);
    if (!isFinite(n)) return '';
    if (n === 0 && !preserveZero) return '';
    if (n === 0 && preserveZero) return '0';
    // Usar toLocaleString con 2 decimales máximo, quitando ceros trailing
    return n.toLocaleString('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      useGrouping: false // Sin separador de miles en inputs
    });
  }

  function hasCustomTarifaData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    return ['punta', 'llano', 'valle', 'p1', 'p2', 'exc']
      .some((key) => String(data[key] ?? '').trim() !== '') || data.bv === true;
  }

  // Snapshot puro del escenario visible. No consulta ni modifica localStorage: exportar una
  // previsualizacion tiene que respaldar lo que el usuario VE, no sus datos locales anteriores.
  function buildManualScenarioPayload() {
    if (!manualGrid) return null;
    const payload = Object.assign({}, collectManualGridData(), {
      config: getScenarioConfig()
    });
    if (manualGridImportState.zonaFiscal) payload.zonaOrigen = manualGridImportState.zonaFiscal;
    return payload;
  }

  function snapshotManualStorage() {
    return MANUAL_STORAGE_KEYS.map((key) => {
      const value = localStorage.getItem(key);
      return { key, existed: value !== null, value };
    });
  }

  function rollbackManualStorage(previous) {
    const errors = [];
    previous.forEach(({ key, existed, value }) => {
      try {
        if (existed) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch (error) {
        errors.push({ key, error });
      }
    });
    if (errors.length) {
      console.warn('No se pudo restaurar por completo el escenario anterior:', errors);
    }
  }

  // localStorage no ofrece transacciones. Se aproximan guardando las tres claves relacionadas
  // con un unico timestamp y restaurando su existencia/valor anterior si falla cualquier paso.
  function persistManualScenario(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    let previous;
    try {
      previous = snapshotManualStorage();
      const savedAt = new Date().toISOString();
      localStorage.setItem('bv_manual_data_v2', JSON.stringify(payload));

      const customTarifa = payload.config?.customTarifa;
      if (hasCustomTarifaData(customTarifa)) {
        localStorage.setItem('bv_custom_tarifa', JSON.stringify(Object.assign({}, customTarifa, { savedAt })));
      } else {
        localStorage.removeItem('bv_custom_tarifa');
      }

      localStorage.setItem('bv_manual_data_timestamp', savedAt);
      return true;
    } catch (error) {
      console.warn('No se pudo guardar el escenario manual:', error);
      if (previous) rollbackManualStorage(previous);
      return false;
    }
  }

  function leaveSharedPreview() {
    const url = new URL(window.location.href);
    url.searchParams.delete('bv');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    isSharedPreview = false;
    sharedTarifasUpdatedAt = null;
    if (sharedScenarioNotice) sharedScenarioNotice.hidden = true;
  }

  // Función para guardar datos manuales en localStorage
  function saveManualData() {
    if (!manualGrid) return false;
    // Un escenario abierto desde `?bv=` es una PREVISUALIZACION: puede editarse en pantalla,
    // pero no toca `bv_manual_data_v2` hasta que el usuario pulse "Guardar escenario". Sin
    // esta guarda, cualquier listener de input llamaba a saveManualData y el escenario ajeno
    // sustituia los datos locales en cuanto se tocaba un campo, contradiciendo al aviso que
    // sigue en pantalla diciendo que no los ha sustituido.
    if (isSharedPreview) return false;
    const saved = persistManualScenario(buildManualScenarioPayload());
    if (saved) updateDataStatus();
    return saved;
  }

  function collectManualGridData() {
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
    return data;
  }

  function getScenarioConfig() {
    return {
      p1: p1Input?.value || '',
      p2: p2Input?.value || '',
      saldoInicial: saldoInput?.value || '',
      zonaFiscal: zonaFiscalInput?.value || 'Península',
      viviendaCanarias: Boolean(viviendaCanariasInput?.checked),
      mesInicio: mesInicioInput?.value || '',
      customTarifa: readCustomTarifaData()
    };
  }

  function applyScenarioConfig(config) {
    if (!config || typeof config !== 'object') return;
    if (p1Input && typeof config.p1 === 'string') {
      p1Input.value = config.p1;
      validateInputFormat(p1Input, 2);
    }
    if (p2Input && typeof config.p2 === 'string') {
      p2Input.value = config.p2;
      validateInputFormat(p2Input, 2);
    }
    if (saldoInput && typeof config.saldoInicial === 'string') {
      saldoInput.value = config.saldoInicial;
      validateInputFormat(saldoInput, 2);
    }
    const zona = typeof config.zonaFiscal === 'string' ? config.zonaFiscal : '';
    if (zonaFiscalInput && Array.from(zonaFiscalInput.options).some((option) => option.value === zona)) {
      zonaFiscalInput.value = zona;
    }
    if (viviendaCanariasInput && typeof config.viviendaCanarias === 'boolean') {
      viviendaCanariasInput.checked = config.viviendaCanarias;
    }
    if (viviendaCanariasWrapper) {
      viviendaCanariasWrapper.style.display = zonaFiscalInput?.value === 'Canarias' ? 'block' : 'none';
    }
    updatePeriodHelpText();
    if (mesInicioInput && typeof config.mesInicio === 'string') mesInicioInput.value = config.mesInicio;
    if (config.customTarifa && typeof config.customTarifa === 'object') {
      applyCustomTarifaData(config.customTarifa);
    }
  }

  function getPeriodHelpText() {
    const isCeutaMelilla = zonaFiscalInput?.value === 'CeutaMelilla';
    return {
      p1: isCeutaMelilla ? '11h-15h y 19h-23h laborables' : '10h-14h y 18h-22h laborables',
      p2: isCeutaMelilla ? '8h-11h, 15h-19h y 23h-24h laborables' : '8h-10h, 14h-18h y 22h-24h laborables',
      p3: '0h-8h laborables; sábados, domingos y festivos nacionales aplicables: todo el día'
    };
  }

  function updatePeriodHelpText() {
    const help = getPeriodHelpText();
    const labels = { p1: 'punta', p2: 'llano', p3: 'valle' };
    document.querySelectorAll('[data-bv-period-help]').forEach((element) => {
      const period = element.dataset.bvPeriodHelp;
      if (help[period]) element.title = `Consumo en periodo ${labels[period]} (${help[period]})`;
    });
    document.querySelectorAll('[data-bv-period-schedule]').forEach((element) => {
      const period = element.dataset.bvPeriodSchedule;
      if (help[period]) element.textContent = help[period];
    });
    manualGrid?.querySelectorAll('input[data-type="p1"], input[data-type="p2"], input[data-type="p3"]').forEach((input) => {
      const period = input.dataset.type;
      input.title = `Consumo en ${labels[period]} (${help[period]})`;
    });
  }

  function normalizeImportedScenarioPayload(importData) {
    if (!importData || typeof importData !== 'object' || Array.isArray(importData)) {
      throw new Error('Formato de archivo inválido');
    }
    if (importData.version !== undefined && ![1, 2].includes(Number(importData.version))) {
      throw new Error('Versión de respaldo no soportada');
    }
    const source = importData.data;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Formato de archivo inválido');
    }

    const payload = {};
    const asText = (value) => value === null || value === undefined ? '' : String(value);
    for (let i = 0; i < 12; i++) {
      const month = source[i];
      if (!month || typeof month !== 'object' || Array.isArray(month)) continue;
      payload[i] = {
        p1: asText(month.p1),
        p2: asText(month.p2),
        p3: asText(month.p3),
        vert: asText(month.vert)
      };
      const meta = window.BVSim.manualUi.normalizeMonthMeta(month.meta);
      if (meta) payload[i].meta = meta;
    }

    // Los primeros respaldos `version: 2` solo incluian la tabla mensual. Completar desde
    // el estado visible conserva su comportamiento historico: importar uno de esos ficheros
    // no debe borrar potencia, zona ni Mi tarifa por confundir "ausente" con "vacio".
    const normalizedConfig = getScenarioConfig();
    if (source.config && typeof source.config === 'object' && !Array.isArray(source.config)) {
      const config = source.config;
      ['p1', 'p2', 'saldoInicial', 'zonaFiscal', 'mesInicio'].forEach((key) => {
        if (typeof config[key] === 'string' || typeof config[key] === 'number') {
          normalizedConfig[key] = String(config[key]);
        }
      });
      if (typeof config.viviendaCanarias === 'boolean') {
        normalizedConfig.viviendaCanarias = config.viviendaCanarias;
      }
      if (config.customTarifa && typeof config.customTarifa === 'object' && !Array.isArray(config.customTarifa)) {
        const customTarifa = normalizePersistedCustomTarifa(config.customTarifa);
        normalizedConfig.customTarifa = {
          punta: asText(customTarifa.punta),
          llano: asText(customTarifa.llano),
          valle: asText(customTarifa.valle),
          p1: asText(customTarifa.p1),
          p2: asText(customTarifa.p2),
          exc: asText(customTarifa.exc),
          bv: customTarifa.bv,
          precioBV: asText(customTarifa.precioBV),
          sinSSAA: Boolean(customTarifa.sinSSAA),
          compensacionIndexada: Boolean(customTarifa.compensacionIndexada),
          topeParcial: Boolean(customTarifa.topeParcial)
        };
      }
    }
    payload.config = normalizedConfig;
    if (typeof source.zonaOrigen === 'string') payload.zonaOrigen = source.zonaOrigen.trim();
    return payload;
  }

  function getSharedScenario() {
    try {
      const encoded = new URLSearchParams(window.location.search).get('bv');
      if (!encoded) return null;
      const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
      if (!payload || ![1, 2].includes(payload.version) || !payload.data || typeof payload.data !== 'object') return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  // Función para cargar datos manuales desde localStorage
  function loadManualData({ payload: suppliedPayload = null, notify = true } = {}) {
    if (!manualGrid) return false;
    // Restaurar/importar un escenario reemplaza el contexto visible completo. Un CSV/respaldo
    // que siga parseandose o un autosave pendiente del grid anterior no puede publicar despues.
    cancelManualAutosave();
    invalidatePendingBackupImport();
    clearActiveFileSelection();
    let localStorageAttempted = false;
    try {
      const shared = suppliedPayload ? null : getSharedScenario();
      isSharedPreview = Boolean(shared);

      let data = suppliedPayload || (shared ? shared.data : null);
      if (!data && !shared && !suppliedPayload) {
        localStorageAttempted = true;
        const saved = localStorage.getItem('bv_manual_data_v2');
        // La existencia de la clave se decide por null, no por truthiness: una cadena vacia
        // sigue siendo un registro presente pero corrupto y debe pasar por el manejo de error,
        // no confundirse con "nunca hubo v2" ni permitir fallback al legacy.
        if (saved !== null) {
          try {
            data = JSON.parse(saved);
          } catch (parseError) {
            console.warn('Datos v2 guardados corruptos; no se usa el legacy para evitar resucitar estado antiguo:', parseError);
            if (notify) {
              showToast('No pude interpretar el escenario guardado. Lo he dejado intacto y no he cargado una copia antigua para evitar sustituir tus datos.', 'err');
            }
            return false;
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            console.warn('Datos v2 guardados con tipo no soportado; no se usa el legacy.');
            if (notify) {
              showToast('El escenario guardado tiene un formato no compatible. Lo he dejado intacto y no he cargado una copia antigua.', 'err');
            }
            return false;
          }
        }

        // Migración simple de v1 (agregado) a v2 (detallado) SOLO si la clave v2 no existe.
        // Si v2 existe pero esta corrupta, no caer a v1: hacerlo podria resucitar un escenario
        // anterior que el usuario ya habia sustituido.
        if (!data && saved === null) {
          const oldSaved = localStorage.getItem('bv_manual_data');
          if (oldSaved) {
            let oldData;
            try {
              oldData = JSON.parse(oldSaved);
            } catch (parseError) {
              console.warn('Datos legacy guardados corruptos:', parseError);
              if (notify) showToast('No pude interpretar los datos guardados de una versión anterior. Se han dejado intactos.', 'err');
              return false;
            }
            if (!oldData || typeof oldData !== 'object' || Array.isArray(oldData)) {
              console.warn('Datos legacy guardados con tipo no soportado.');
              if (notify) showToast('Los datos guardados de una versión anterior tienen un formato no compatible. Se han dejado intactos.', 'err');
              return false;
            }
            data = {};
            for (const k in oldData) {
              const month = oldData[k];
              if (!month || typeof month !== 'object' || Array.isArray(month)) continue;
              const c = parseInput(month.cons);
              // Estimación simple para migración: 20/25/55
              // Guardar como strings formateados en español
              data[k] = {
                p1: formatNumberES(Math.round(c * 0.20)),
                p2: formatNumberES(Math.round(c * 0.25)),
                p3: formatNumberES(Math.round(c * 0.55)),
                vert: formatNumberES(parseInput(month.vert))
              };
            }
          }
        }
      }

      if (!data) return false;

      // Cargar/restaurar sustituye el escenario visible: cualquier ranking anterior deja de
      // corresponder a lo que se va a pintar, aunque el payload sea valido.
      invalidateVisibleSimulationResults();
      sharedScenarioConfig = shared?.config || data.config || null;
      sharedTarifasUpdatedAt = typeof shared?.tarifasUpdatedAt === 'string' ? shared.tarifasUpdatedAt : null;
      applyScenarioConfig(sharedScenarioConfig);

      // El payload entrante SUSTITUYE al escenario visible. Si es disperso (por ejemplo un
      // respaldo antiguo con solo enero), dejar sin tocar los meses ausentes mezclaria datos
      // del escenario anterior y un autosave posterior los reintroduciria en el nuevo respaldo.
      clearManualGridInputs();
      clearManualMonthMeta();
      let hasData = false;
      for (let i = 0; i < 12; i++) {
        const p1In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p1"]`);
        const p2In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p2"]`);
        const p3In = manualGrid.querySelector(`input[data-month="${i}"][data-type="p3"]`);
        const vIn = manualGrid.querySelector(`input[data-month="${i}"][data-type="vert"]`);

        if (data[i]) {
          // collectManualGridData() guarda el .value CRUDO de cada input (incluida la cadena
          // vacia), asi que la distincion "vacio" vs "0 explicito" ya viaja intacta en el JSON
          // guardado — solo hay que preservarla tambien al reescribir en el input, en vez de
          // colapsar ambos casos a "" como hacia antes formatNumberES(0).
          const p1Raw = String(data[i].p1 ?? '').trim();
          const p2Raw = String(data[i].p2 ?? '').trim();
          const p3Raw = String(data[i].p3 ?? '').trim();
          const vertRaw = String(data[i].vert ?? '').trim();

          // Si el raw no pasa la MISMA validacion que exige Calcular, no se reescribe con
          // parseInput+formatNumberES: eso "curaria" en silencio un valor invalido (p.ej.
          // "1,2,3") en otro numero valido y distinto ("12,3") que el usuario nunca confirmo.
          // Se deja el texto tal cual llego, marcado en rojo, para que el usuario lo vea y lo
          // corrija (o Calcular lo bloquee) en vez de calcular con un dato inventado.
          const writeField = (input, raw) => {
            if (!input) return;
            const check = parseManualGridRaw(raw);
            input.value = check.valid ? formatNumberES(check.value, { preserveZero: raw !== '' }) : raw;
            validateManualGridInput(input);
          };
          writeField(p1In, p1Raw);
          writeField(p2In, p2Raw);
          writeField(p3In, p3Raw);
          writeField(vIn, vertRaw);
          setManualMonthMeta(i, data[i].meta);

          // Un mes con los 4 campos explicitamente a 0 tambien cuenta como "con datos":
          // igual que buildSimulationMonths() (Fix 3), lo que marca un mes como provisto
          // es que exista entrada, no que algun valor sea positivo.
          if (p1Raw !== '' || p2Raw !== '' || p3Raw !== '' || vertRaw !== '') {
            hasData = true;
          }
        }
      }

      updateMesInicioSelectorFromGrid(sharedScenarioConfig?.mesInicio ?? '');

      if (shared) {
        showSharedScenarioNotice();
        if (notify) showToast('✓ Escenario compartido cargado correctamente', 'ok');
      } else if (hasData && notify) {
        updateDataStatus();
        showToast('✓ Datos guardados cargados correctamente', 'ok');
      }

      clearHourlyTraceState();
      clearGridImportState(manualGridImportState);
      // `result` no se restaura: el fichero no se persiste, asi que tras recargar ya no se
      // puede rehacer el reparto solo. La zona SI, y es lo que permite bloquear el calculo
      // en vez de dejar pasar en silencio una tabla repartida con otro horario.
      const zonaOrigen = typeof data.zonaOrigen === 'string' ? data.zonaOrigen.trim() : '';
      if (hasData && zonaOrigen) manualGridImportState.zonaFiscal = zonaOrigen;
      return hasData;
    } catch(e) {
      console.warn('Error cargando datos:', e);
      if (notify && localStorageAttempted) {
        showToast('No pude acceder al almacenamiento local de este navegador. Puedes seguir usando el simulador, pero los datos guardados no se restaurarán en esta sesión.', 'err');
      }
      return false;
    }
  }

  function showSharedScenarioNotice(currentUpdatedAt) {
    if (!sharedScenarioNotice || !sharedScenarioText) return;
    const sharedDate = sharedTarifasUpdatedAt ? sharedTarifasUpdatedAt.slice(0, 10) : '';
    const currentDate = typeof currentUpdatedAt === 'string' ? currentUpdatedAt.slice(0, 10) : '';
    const versionNote = sharedDate && currentDate && sharedDate !== currentDate
      ? ` Se compartió con tarifas del ${sharedDate}; ahora se calculan con las del ${currentDate}.`
      : sharedDate ? ` Compartido con tarifas del ${sharedDate}.` : '';
    sharedScenarioText.textContent = `Estás viendo un escenario compartido. No ha sustituido tus datos guardados.${versionNote}`;
    sharedScenarioNotice.hidden = false;
  }

  // Función para actualizar el mensaje de estado de datos guardados
  function updateDataStatus() {
    const statusEl = document.getElementById('bv-data-status');
    if (!statusEl) return;

    try {
      const timestamp = localStorage.getItem('bv_manual_data_timestamp');
      if (timestamp) {
        const rawTimestamp = String(timestamp).trim();
        const numericTimestamp = /^\d+$/.test(rawTimestamp) ? Number(rawTimestamp) : NaN;
        const date = Number.isFinite(numericTimestamp) ? new Date(numericTimestamp) : new Date(rawTimestamp);
        if (!Number.isFinite(date.getTime())) {
          statusEl.textContent = '';
          return;
        }

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
      // Misma validacion que exige el boton Calcular: exportar un "1,2,3" invalido no debe
      // producir un backup que, al restaurarlo, lo "cure" en silencio a otro numero valido
      // (ver parseManualGridRaw). Se revalida el DOM entero, no solo la clase .error, por si
      // el valor llego sin pasar por el listener de 'input' (backup/URL previos).
      if (manualGridHasInvalidInputs()) {
        showToast('Corrige los valores inválidos de la tabla mensual antes de exportar.', 'err');
        return;
      }
      // Exportar es deliberadamente independiente de la persistencia: tambien desde una
      // previsualizacion debe descargar el estado visible sin adoptar ni tocar datos locales.
      const payload = buildManualScenarioPayload();
      if (!payload) {
        showToast('No hay datos para exportar', 'err');
        return;
      }

      const exportData = {
        version: 2,
        timestamp: new Date().toISOString(),
        data: payload,
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

      // Igual que CSV/XLSX, leer un respaldo es asincrono. Un segundo respaldo o un reset
      // posterior deben invalidar este FileReader antes de que pueda persistir/publicar estado.
      // La seleccion YA expresa una intencion mas nueva que cualquier CSV que siga parseandose;
      // invalidarlo ahora evita que el CSV viejo haga un commit transitorio mientras se lee el JSON.
      // Ese CSV nunca llego a publicarse: vaciar tambien el input permite re-seleccionarlo si el
      // backup falla, sin tocar `window.BVSim.file`/cache de un fichero anterior ya publicado.
      invalidatePendingFileImport();
      if (fileInput) fileInput.value = '';
      const importGeneration = ++backupImportGeneration;
      const reader = new FileReader();
      reader.onload = (event) => {
        if (importGeneration !== backupImportGeneration) return;
        try {
          const importData = JSON.parse(event.target.result);
          const payload = normalizeImportedScenarioPayload(importData);
          // Rechazar ANTES de persistir: normalizeImportedScenarioPayload() no valida el
          // formato de los numeros, y persistManualScenario() sobrescribiria el escenario
          // anterior con datos que Calcular nunca habria aceptado (ver parseManualGridRaw).
          if (manualGridDataHasInvalidValues(payload)) {
            showToast('El respaldo tiene valores invalidos en la tabla mensual. Tus datos anteriores siguen intactos.', 'err');
            return;
          }
          if (!persistManualScenario(payload)) {
            showToast('No se pudo guardar el respaldo importado. Tus datos anteriores siguen intactos.', 'err');
            return;
          }

          // Solo una persistencia completa abandona el enlace compartido. Se aplica el payload
          // ya normalizado directamente, sin volver a leer una URL `?bv=` ni datos antiguos.
          leaveSharedPreview();
          loadManualData({ payload, notify: false });
          loadCustomTarifa({ applyValues: false });
          clearHourlyTraceState();
          updateManualTotals();
          updateMesInicioSelectorFromGrid();
          updateDataStatus();

          showToast('✓ Datos importados correctamente', 'ok');
        } catch(err) {
          console.error('Error importando datos:', err);
          showToast('Error: archivo inválido o corrupto', 'err');
        }
      };

      reader.onerror = () => {
        if (importGeneration !== backupImportGeneration) return;
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
      if (isSharedPreview) {
        saveIndicator.textContent = 'Vista previa sin guardar';
        saveIndicator.classList.add('saving');
        return;
      }
      saveIndicator.textContent = '✓ Guardado';
      saveIndicator.classList.add('saved');
      setTimeout(() => {
        saveIndicator.classList.remove('saved');
      }, 2000);
    } else if (type === 'error') {
      saveIndicator.textContent = '⚠️ No guardado';
      saveIndicator.classList.add('save-error');
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

        // Un "0" explicito tambien significa que el mes fue aportado. La ruta economica
        // (readManualEntriesFromGrid) conserva ese mes porque siguen existiendo costes fijos;
        // el resumen visual debe aplicar la misma semantica y no confundir 0/0/0/0 con vacio.
        const rawValues = [p1In, p2In, p3In, vIn].map((input) =>
          String(input.value == null ? '' : input.value).trim()
        );
        if (rawValues.some((raw) => raw !== '' && parseManualGridRaw(raw).valid)) {
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
            <input class="input manual-input" type="text" data-month="${i}" data-type="p1" value="" inputmode="decimal" placeholder="Ej: 50" aria-label="${m}: consumo en punta (kWh)" title="Consumo en punta (10-14h, 18-22h laborables)">
          </div>
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Llano</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="p2" value="" inputmode="decimal" placeholder="Ej: 70" aria-label="${m}: consumo en llano (kWh)" title="Consumo en llano (8-10h, 14-18h, 22-24h laborables)">
          </div>
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Valle</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="p3" value="" inputmode="decimal" placeholder="Ej: 150" aria-label="${m}: consumo en valle (kWh)" title="Consumo en valle (0-8h + fines de semana y festivos)">
          </div>
          <div class="bv-manual-cell">
            <span class="bv-manual-cell-label">Vertido</span>
            <input class="input manual-input" type="text" data-month="${i}" data-type="vert" value="" inputmode="decimal" placeholder="Ej: 200" aria-label="${m}: excedentes vertidos a la red (kWh)" title="Excedentes vertidos a la red">
          </div>
        </div>
      </div>
    `).join('');
    updatePeriodHelpText();

    // NO cargar datos automáticamente - solo al hacer clic en "Entrada manual"

    // Debounce para guardar automáticamente. El timer vive a nivel de modulo para que un
    // reset/restauracion pueda cancelarlo antes de sustituir el contexto que lo origino.
    manualGrid.addEventListener('input', (e) => {
      if (e.target.classList.contains('manual-input')) {
        manualGridImportState.dirty = true;
        invalidateHourlyTrace('manual-edit');
        invalidateVisibleSimulationResults();

        validateManualGridInput(e.target);

        // Actualizar totales en tiempo real
        updateManualTotals();
        updateMesInicioSelectorFromGrid();

        showSaveIndicator('saving');
        cancelManualAutosave();
        manualSaveTimer = setTimeout(() => {
          manualSaveTimer = null;
          const saved = saveManualData();
          showSaveIndicator(saved || isSharedPreview ? 'saved' : 'error');
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
      const resetQuestion = isSharedPreview
        ? '¿Borrar los valores de esta vista previa? Tu escenario guardado no se modificará.'
        : '¿Borrar todos los valores guardados? Esta acción no se puede deshacer.';
      if (!confirm(resetQuestion)) return;

      // El reset sustituye todo el contexto de entrada visible: invalida trabajo asincrono del
      // contexto anterior ANTES de vaciarlo, para que nada pueda volver a publicarse despues.
      cancelManualAutosave();
      invalidatePendingBackupImport();
      clearActiveFileSelection();
      clearManualGridInputs();

      // Una URL ?bv= es una previsualizacion. Borrar lo que se VE no puede borrar el escenario
      // local oculto que el propio aviso promete no haber sustituido. Fuera de preview se
      // conserva exactamente el borrado persistente historico.
      if (!isSharedPreview) {
        localStorage.removeItem('bv_manual_data_v2');
        localStorage.removeItem('bv_manual_data');
        localStorage.removeItem('bv_manual_data_timestamp');
      }
      clearManualMonthMeta();
      clearHourlyTraceState();
      clearGridImportState(manualGridImportState);
      clearRenderedSimulationOutput();
      updateManualTotals();
      updateMesInicioSelectorFromGrid();
      if (isSharedPreview) {
        const dataStatus = document.getElementById('bv-data-status');
        if (dataStatus) dataStatus.textContent = '';
        showSaveIndicator('saved');
        showToast('✓ Datos de la vista previa borrados. Tu escenario guardado sigue intacto.', 'ok');
      } else {
        updateDataStatus();
        clearSaveIndicator();
        showToast('✓ Todos los datos han sido borrados', 'ok');
      }
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

  const getMenuItems = () => menuPanel
    ? Array.from(menuPanel.querySelectorAll('[role="menuitem"]'))
    : [];

  const focusMenuItem = (which = 'first') => {
    const items = getMenuItems();
    if (!items.length) return;
    const target = which === 'last' ? items[items.length - 1] : items[0];
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  };

  const moveMenuFocus = (dir) => {
    const items = getMenuItems();
    if (!items.length) return;
    let index = items.indexOf(document.activeElement);
    if (index < 0) index = 0;
    index = (index + dir + items.length) % items.length;
    try { items[index].focus({ preventScroll: true }); } catch { items[index].focus(); }
  };

  const setMenuOpen = (open, options = {}) => {
    if (!btnMenu || !menuPanel) return false;
    const isOpen = Boolean(open);
    menuPanel.classList.toggle('show', isOpen);
    btnMenu.setAttribute('aria-expanded', String(isOpen));
    menuPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (isOpen) {
      if (options.focus === 'first') focusMenuItem('first');
      if (options.focus === 'last') focusMenuItem('last');
    } else if (options.returnFocus) {
      try { btnMenu.focus({ preventScroll: true }); } catch { btnMenu.focus(); }
    }
    return isOpen;
  };

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
      const isShow = setMenuOpen(!menuPanel.classList.contains('show'));
      if (isShow && e.detail === 0) focusMenuItem('first');
    });
    btnMenu.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(true, { focus: e.key === 'ArrowUp' ? 'last' : 'first' });
      } else if (e.key === 'Escape' && menuPanel.classList.contains('show')) {
        e.preventDefault();
        setMenuOpen(false, { returnFocus: true });
      }
    });
    menuPanel.addEventListener('keydown', (e) => {
      if (!menuPanel.classList.contains('show')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMenuFocus(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveMenuFocus(-1); }
      else if (e.key === 'Home') { e.preventDefault(); focusMenuItem('first'); }
      else if (e.key === 'End') { e.preventDefault(); focusMenuItem('last'); }
      else if (e.key === 'Escape') { e.preventDefault(); setMenuOpen(false, { returnFocus: true }); }
      else if (e.key === 'Tab') { setMenuOpen(false); }
    });
    const menuRoot = document.getElementById('menuRoot');
    menuRoot?.addEventListener('focusout', () => {
      if (!menuPanel.classList.contains('show')) return;
      setTimeout(() => {
        if (!menuRoot.contains(document.activeElement)) setMenuOpen(false);
      }, 0);
    });
  }

  document.addEventListener('click', async (e) => {
    const clearBtn = (e.target instanceof Element) ? e.target.closest('#btnClearCache') : null;
    if (clearBtn) {
      if (!confirm('¿Limpiar toda la caché y reiniciar?')) return;

      try {
        // "Limpiar cache" NO es un reset total: solo debe borrar cache tecnica
        // (pvpc_cache_v3:*), nunca configuracion ni datos guardados por el usuario
        // (Mi tarifa, escenario mensual, tema). Para eso ya existen botones separados
        // ("Limpiar datos guardados", "Borrar") que si avisan de perdida de datos.
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('pvpc_cache_v3:')) keysToRemove.push(key);
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
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
        setMenuOpen(false);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuPanel?.classList.contains('show')) {
      const shouldReturnFocus = Boolean(menuPanel.contains(document.activeElement));
      setMenuOpen(false, { returnFocus: shouldReturnFocus });
    }
  });

  if (zonaFiscalInput) {
    zonaFiscalInput.addEventListener('change', () => {
      invalidateVisibleSimulationResults();
      updatePeriodHelpText();
      if (viviendaCanariasWrapper) {
        viviendaCanariasWrapper.style.display = zonaFiscalInput.value === 'Canarias' ? 'block' : 'none';
      }
      const normalizeZona = window.LF?.csvUtils?.normalizeZonaFiscal;
      const changesSchedule = window.BVSim.manualUi.changesSchedulingZone(
        manualGridImportState.zonaFiscal, zonaFiscalInput.value, normalizeZona
      );
      if (changesSchedule && !manualGridImportState.dirty && manualGridImportState.result) {
        // La zona de procedencia la anota populateManualGridFromCSV, que es quien sabe si el
        // reparto llego a escribirse: hacerlo aqui la daria por buena aunque el repoblado
        // hubiera abortado sin tocar la tabla.
        populateManualGridFromCSV(manualGridImportState.result, zonaFiscalInput.value, false);
        showToast('✓ Reparto P1/P2/P3 recalculado para la nueva zona.', 'ok');
      }
      // La traza horaria se procesa en CUALQUIER cambio de zona, no solo cuando cambia el
      // reparto P1/P2/P3. Son dos ejes independientes: Peninsula<->Canarias comparte horario
      // de periodos pero NO reloj, asi que si quedaba dentro del bloque anterior la traza no
      // se re-apuntaba nunca en ese eje y `canUseHourlyTrace` la descartaba por desajuste de
      // zona, cayendo a precio de referencia aunque la curva no tuviera ningun cambio de hora.
      // El helper decide solo: re-apunta si comparten reloj o no hay dia DST, e invalida con
      // 'zone-hour-shift' si lo hay. Sin curva o con la traza ya editada a mano no hace nada.
      // Se resuelve antes de terminar el handler para que el siguiente calculo vea el estado correcto.
      retargetHourlyTraceZone(zonaFiscalInput.value);
      saveManualData();
    });
  }

  viviendaCanariasInput?.addEventListener('change', () => {
    invalidateVisibleSimulationResults();
    saveManualData();
  });

  // Formateadores ES
  const currencyFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kwFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kwhFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const priceFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 6 });

  const fEur = (v) => currencyFmt.format(Number(v) || 0);
  const fKw = (v) => kwFmt.format(Number(v) || 0);
  const fKwh = (v) => kwhFmt.format(Number(v) || 0);
  const fWholeKwh = (v) => Math.round(Number(v) || 0).toLocaleString('es-ES') + ' kWh';
  const fPrice = (v) => priceFmt.format(Number(v) || 0);

  function buildConsumoLimitsMessage(info) {
    const excluded = Array.isArray(info?.excluidas) ? info.excluidas : [];
    const excludedReal = Array.isArray(info?.excluidasReales)
      ? info.excluidasReales
      : excluded.filter((item) => item?.origen !== 'estimacion');
    const excludedEstimated = Array.isArray(info?.excluidasEstimadas) ? info.excluidasEstimadas : [];
    const hasUsefulEstimate = Boolean(
      info?.estimateAvailable
      && Number.isFinite(info?.estimatedAnnualKwh)
      && excludedEstimated.length
    );
    if (!excludedReal.length && !hasUsefulEstimate) return '';

    const realMessage = excludedReal.length
      ? `<p><strong>⚠️ ${excludedReal.length} ${excludedReal.length === 1 ? 'tarifa incompatible excluida' : 'tarifas incompatibles excluidas'} del ranking.</strong> Tus datos ya registran ${fWholeKwh(info.consumoKwh)} y no cumplen ${excludedReal.length === 1 ? 'su requisito' : 'sus requisitos'} de consumo.</p>`
      : '';
    const estimateAction = info?.estimateApplied ? 'false' : 'true';
    const shortPeriodWarning = Number(info?.coveredDays) < 28
      ? ' Con menos de 28 días, puede variar todavía más.'
      : '';
    const estimateMessage = hasUsefulEstimate
      ? `<div class="consumo-estimate-choice"><p><strong>${info.estimateApplied ? 'Estimación anual aplicada' : 'Estimación anual orientativa'}: ${fWholeKwh(info.estimatedAnnualKwh)}/año.</strong> Se basa en ${fWholeKwh(info.consumoKwh)} registrados durante ${Math.round(info.coveredDays)} ${Math.round(info.coveredDays) === 1 ? 'día' : 'días'}.</p><p class="consumo-estimate-help">Es una aproximación: en autoconsumo, la época del año puede cambiar mucho el resultado.${shortPeriodWarning} ${info.estimateApplied ? `${excludedEstimated.length} ${excludedEstimated.length === 1 ? 'tarifa se ha excluido' : 'tarifas se han excluido'} por esta estimación.` : `Si la activas, ${excludedEstimated.length} ${excludedEstimated.length === 1 ? 'tarifa dejará' : 'tarifas dejarán'} de mostrarse por sus límites anuales.`}</p><button type="button" class="consumo-estimate-toggle" data-consumo-estimate-toggle="${estimateAction}">${info.estimateApplied ? 'Volver a mostrar esas tarifas' : 'Aplicar límites con esta estimación'}</button></div>`
      : '';
    const listed = [...excludedReal, ...excludedEstimated];
    const items = listed.map((item) => {
      const name = escapeHtml(item?.tarifa?.nombre || 'Tarifa sin nombre');
      const reason = `admite como máximo ${fWholeKwh(item.limiteKwh)} al año`;
      const source = item?.origen === 'estimacion' ? ' Según la estimación anual.' : '';
      return `<li>${name}: ${reason}.${source}</li>`;
    }).join('');
    const detailsLabel = info?.estimateApplied
      ? 'Ver tarifas excluidas y por qué'
      : (excludedReal.length ? 'Ver tarifas excluidas o afectadas' : 'Ver qué tarifas cambiarían');
    return `<div class="consumo-limits-notice" role="note" aria-label="Límites y estimación anual de consumo">${realMessage}${estimateMessage}<details><summary>${detailsLabel}</summary><ul>${items}</ul></details></div>`;
  }

  function focusConsumoEstimateToggle() {
    if (!focusAnnualConsumptionEstimateToggle) return;
    focusAnnualConsumptionEstimateToggle = false;
    const toggle = resultsEl?.querySelector('[data-consumo-estimate-toggle]');
    requestAnimationFrame(() => toggle?.focus({ preventScroll: true }));
  }

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
  function readCustomTarifaData() {
    return {
      punta: document.getElementById('mtPunta')?.value || '',
      llano: document.getElementById('mtLlano')?.value || '',
      valle: document.getElementById('mtValle')?.value || '',
      p1: document.getElementById('mtP1')?.value || '',
      p2: document.getElementById('mtP2')?.value || '',
      exc: document.getElementById('mtExc')?.value || '',
      bv: Boolean(document.getElementById('mtBV')?.checked),
      precioBV: document.getElementById('mtPrecioBV')?.value || '',
      sinSSAA: Boolean(document.getElementById('mtSinSSAA')?.checked),
      compensacionIndexada: Boolean(document.getElementById('mtCompensacionIndexada')?.checked),
      topeParcial: Boolean(document.getElementById('mtTopeParcial')?.checked)
    };
  }

  // Frontera de compatibilidad para "Mi tarifa" persistida. Antes de existir el checkbox
  // BV, los registros no incluian `bv` y una compensacion fija positiva implicaba BV. La
  // ausencia se migra; un false explicito nunca se sobreescribe. Se acepta ademas el booleano
  // serializado como string para no convertir "false" en true por truthiness.
  function normalizePersistedCustomTarifa(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const normalized = { ...data };
    if (normalized.bv === undefined || normalized.bv === null) {
      normalized.bv = parseInput(normalized.exc) > 0;
    } else if (typeof normalized.bv !== 'boolean') {
      normalized.bv = typeof window.LF?.asBool === 'function'
        ? window.LF.asBool(normalized.bv, false)
        : Boolean(normalized.bv);
    }
    return normalized;
  }

  function applyCustomTarifaData(data) {
    data = normalizePersistedCustomTarifa(data);
    if (!data) return false;
    const fieldIds = {
      punta: 'mtPunta', llano: 'mtLlano', valle: 'mtValle',
      p1: 'mtP1', p2: 'mtP2', exc: 'mtExc', precioBV: 'mtPrecioBV'
    };
    Object.entries(fieldIds).forEach(([key, id]) => {
      const input = document.getElementById(id);
      if (input && typeof data[key] === 'string') {
        input.value = data[key];
        // Una restauracion/importacion es una sustitucion programatica del valor. Sin volver a
        // sincronizar la clase, un .error del escenario anterior quedaba pegado a un valor nuevo.
        validateInputFormat(input, MAX_DECIMALES_PRECIO, mtMaxValues[id], mtMinExclusive[id]);
      }
    });
    const mtBVEl = document.getElementById('mtBV');
    if (mtBVEl) mtBVEl.checked = data.bv;
    const mtSinSSAAEl = document.getElementById('mtSinSSAA');
    if (mtSinSSAAEl && typeof data.sinSSAA === 'boolean') mtSinSSAAEl.checked = data.sinSSAA;
    const mtCompensacionIndexadaEl = document.getElementById('mtCompensacionIndexada');
    if (mtCompensacionIndexadaEl && typeof data.compensacionIndexada === 'boolean') {
      mtCompensacionIndexadaEl.checked = data.compensacionIndexada;
    }
    const mtTopeParcialEl = document.getElementById('mtTopeParcial');
    if (mtTopeParcialEl && typeof data.topeParcial === 'boolean') mtTopeParcialEl.checked = data.topeParcial;
    // Los dos campos dejan de bloquear cuando su opcion los hace inactivos; la restauracion debe
    // aplicar el mismo criterio visual que los listeners de cambio manual.
    if (mtCompensacionIndexadaEl?.checked) document.getElementById('mtExc')?.classList.remove('error');
    if (!mtBVEl?.checked) document.getElementById('mtPrecioBV')?.classList.remove('error');
    updateMtExcWrapVisibility();
    updateCustomTarifaIndicator(data);
    return true;
  }

  // El precio fijo de compensacion no tiene sentido (y se ignora) si el usuario ha marcado
  // que su compensacion es indexada: ocultarlo evita que rellene un numero que nunca se usa.
  function updateMtExcWrapVisibility() {
    const wrap = document.getElementById('mtExcWrap');
    if (!wrap) return;
    const indexada = Boolean(document.getElementById('mtCompensacionIndexada')?.checked);
    wrap.style.display = indexada ? 'none' : '';
    updateMtBVSinCompensacionAviso();
  }

  // Aviso NO bloqueante, gemelo del de js/lf-tarifa-custom.js: sin compensacion no hay excedente
  // remunerado que alimente la hucha, asi que fv.bv se normaliza a false y la BV no se aplica.
  // Sin este texto, marcar la casilla no produciria efecto ni explicacion. NO marca el campo en
  // rojo, NO invalida el formulario y NO desmarca la casilla: el estado es legitimo y calculable.
  const MT_BV_SIN_COMPENSACION_MSG = 'La batería virtual no se aplicará mientras la compensación sea 0 €/kWh: sin excedentes remunerados no se genera nuevo saldo para la hucha. Indica un precio de compensación o marca la compensación indexada.';

  function updateMtBVSinCompensacionAviso() {
    const aviso = document.getElementById('mtBVSinCompensacionAviso');
    if (!aviso) return;
    const bvOn = Boolean(document.getElementById('mtBV')?.checked);
    const indexada = Boolean(document.getElementById('mtCompensacionIndexada')?.checked);
    const excRaw = String(document.getElementById('mtExc')?.value || '').trim();
    const excNum = excRaw ? parseInput(excRaw) : 0;
    const inactiva = bvOn && !indexada && !(excNum > 0);
    aviso.style.display = inactiva ? '' : 'none';

    // El <p> visible NO puede ser la live region: display:none lo saca del arbol de
    // accesibilidad. La region vive aparte, siempre presente, y lo que cambia es su contenido.
    // Solo se escribe en las transiciones para no re-anunciar mientras se teclea.
    const live = document.getElementById('mtBVSinCompensacionLive');
    if (!live) return;
    const anunciado = live.textContent !== '';
    if (inactiva && !anunciado) live.textContent = MT_BV_SIN_COMPENSACION_MSG;
    else if (!inactiva && anunciado) live.textContent = '';
  }

  function saveCustomTarifa() {
    // "Mi tarifa" mantiene una clave legacy propia ademas de viajar dentro del escenario.
    // La previsualizacion compartida debe proteger las dos persistencias, no solo
    // `bv_manual_data_v2`, hasta que el usuario adopte expresamente el escenario.
    if (isSharedPreview) return;
    if (saveManualData()) loadCustomTarifa();
  }

  // Función para actualizar el indicador visual
  function updateCustomTarifaIndicator(data) {
    try {
      const indicator = document.getElementById('bv-custom-tarifa-indicator');
      const clearBtn = document.getElementById('bv-clear-custom-tarifa');
      if (!indicator || !clearBtn) return;

      // `customTarifa` viaja embebida en bv_manual_data_v2 sin savedAt a proposito. En una
      // recarga local eso no significa "no hay tarifa guardada": el timestamp hermano es
      // bv_manual_data_timestamp. No ligar la existencia del boton Borrar a una metadata que
      // el escenario deliberadamente no contiene. En previsualizacion compartida, en cambio,
      // no hay nada local que borrar y el boton debe seguir oculto.
      const hasStoredData = !isSharedPreview && hasCustomTarifaData(data);
      clearBtn.style.display = hasStoredData ? 'block' : 'none';

      let savedAt = data?.savedAt || null;
      if (!savedAt && hasStoredData) {
        try { savedAt = localStorage.getItem('bv_manual_data_timestamp'); } catch (_) {}
      }
      const date = savedAt ? new Date(savedAt) : null;
      if (date && Number.isFinite(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const mins = String(date.getMinutes()).padStart(2, '0');
        indicator.textContent = `💾 ${day}/${month} ${hours}:${mins}`;
        indicator.style.display = 'inline-block';
      } else {
        indicator.textContent = '';
        indicator.style.display = 'none';
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
      document.getElementById('mtPunta').value = '';
      document.getElementById('mtLlano').value = '';
      document.getElementById('mtValle').value = '';
      document.getElementById('mtP1').value = '';
      document.getElementById('mtP2').value = '';
      document.getElementById('mtExc').value = '';
      const mtPrecioBVEl = document.getElementById('mtPrecioBV');
      if (mtPrecioBVEl) mtPrecioBVEl.value = '';
      const mtBVEl = document.getElementById('mtBV');
      if (mtBVEl) mtBVEl.checked = false;
      const mtSinSSAAEl = document.getElementById('mtSinSSAA');
      if (mtSinSSAAEl) mtSinSSAAEl.checked = false;
      const mtCompensacionIndexadaEl = document.getElementById('mtCompensacionIndexada');
      if (mtCompensacionIndexadaEl) mtCompensacionIndexadaEl.checked = false;
      const mtTopeParcialEl = document.getElementById('mtTopeParcial');
      if (mtTopeParcialEl) mtTopeParcialEl.checked = false;
      updateMtExcWrapVisibility();

      if (!saveManualData()) {
        loadCustomTarifa();
        showToast('No se pudieron borrar los datos guardados.', 'err');
        return;
      }
      ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc', 'mtPrecioBV'].forEach((id) => {
        document.getElementById(id)?.classList.remove('error');
      });
      invalidateVisibleSimulationResults();
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
  function loadCustomTarifa({ applyValues = true } = {}) {
    try {
      const saved = localStorage.getItem('bv_custom_tarifa');
      if (!saved) {
        updateCustomTarifaIndicator(null);
        return false;
      }
      const data = JSON.parse(saved);
      if (applyValues) return applyCustomTarifaData(data);
      updateCustomTarifaIndicator(data);
      return true;
    } catch(e) {
      console.warn('Error cargando tarifa personalizada:', e);
      updateCustomTarifaIndicator(null);
      return false;
    }
  }

  // Cargar tarifa personalizada al inicio
  if (sharedScenarioConfig?.customTarifa) {
    applyCustomTarifaData(sharedScenarioConfig.customTarifa);
  } else if (isSharedPreview) {
    // Previsualizacion de un enlace compartido que EXCLUYE "Mi tarifa y saldo BV" (checkbox
    // opt-in sin marcar por quien comparte): usar la tarifa personalizada LOCAL del receptor
    // aqui haria que el mismo enlace diera un ranking distinto segun el navegador que lo abra.
    // No se toca bv_custom_tarifa en localStorage, solo se deja el formulario vacio.
    applyCustomTarifaData({ punta: '', llano: '', valle: '', p1: '', p2: '', exc: '', bv: false, precioBV: '' });
  } else {
    loadCustomTarifa();
  }

  // Conectar botón de limpiar datos
  const clearBtn = document.getElementById('bv-clear-custom-tarifa');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearCustomTarifa);
  }

  // Guardar automáticamente los cambios en tarifa personalizada
  // Precios de energía (mtPunta/mtLlano/mtValle): máx 1 €/kWh
  // Precios de potencia (mtP1/mtP2): máx 1 €/kW·día
  // Precio de compensación (mtExc): máx 0,5 €/kWh
  // mtPrecioBV NO tiene tope duro: no hay una regla de dominio real que justifique inventar un
  // máximo (las cuotas reales del dataset van de 1,65 a 4,00€/mes, pero eso no fija un límite).
  ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtExc', 'mtPrecioBV'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) {
      let saveTimer = null;
      el.addEventListener('input', function () {
        validateInputFormat(el, MAX_DECIMALES_PRECIO, mtMaxValues[id], mtMinExclusive[id]);
        if (id === 'mtExc') updateMtBVSinCompensacionAviso();
        invalidateVisibleSimulationResults();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCustomTarifa, 800);
      });
    }
  });

  // Guardar checkbox de BV al cambiar (sin debounce, es instantáneo)
  const mtBVEl = document.getElementById('mtBV');
  if (mtBVEl) {
    mtBVEl.addEventListener('change', function () {
      // Al desactivar BV, mtPrecioBV deja de validarse en el boton Calcular (ver
      // miTarifaIds): quitar tambien la marca visual de error para no dejar un campo en rojo
      // que ya no bloquea nada y que el usuario no tiene por que corregir si no reactiva BV.
      if (!mtBVEl.checked) {
        document.getElementById('mtPrecioBV')?.classList.remove('error');
      }
      updateMtBVSinCompensacionAviso();
      invalidateVisibleSimulationResults();
      saveCustomTarifa();
    });
  }

  // Guardar checkboxes de opciones avanzadas al cambiar (sin debounce, instantaneo, igual
  // que mtBV). mtCompensacionIndexada ademas oculta/muestra el precio fijo, que se ignora
  // mientras este marcada.
  ['mtSinSSAA', 'mtTopeParcial'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', function () {
      invalidateVisibleSimulationResults();
      saveCustomTarifa();
    });
  });
  const mtCompensacionIndexadaEl = document.getElementById('mtCompensacionIndexada');
  if (mtCompensacionIndexadaEl) {
    mtCompensacionIndexadaEl.addEventListener('change', function () {
      updateMtExcWrapVisibility();
      // Al marcar indexada, mtExc queda oculto y deja de validarse en Calcular: quitar
      // tambien la marca visual de error para no dejar un campo en rojo invisible que ya
      // no bloquea nada (mismo criterio que mtPrecioBV al desactivar BV).
      if (mtCompensacionIndexadaEl.checked) {
        document.getElementById('mtExc')?.classList.remove('error');
      }
      invalidateVisibleSimulationResults();
      saveCustomTarifa();
    });
  }
  updateMtExcWrapVisibility();

  function encodeSharedScenario(payload) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  function getShareOptions() {
    return {
      includeMonthly: Boolean(shareMonthlyInput?.checked),
      includePrivate: Boolean(sharePrivateInput?.checked)
    };
  }

  function getSharedConfig(options) {
    const config = getScenarioConfig();
    if (!options.includePrivate) {
      config.saldoInicial = '';
      config.customTarifa = null;
    }
    return config;
  }

  function getShareDisclosure(options) {
    const included = ['ajustes generales del simulador'];
    if (options.includeMonthly) included.push('consumos y excedentes mensuales');
    if (options.includePrivate) included.push('Mi tarifa y saldo BV');
    const traceNote = options.includeMonthly
      ? ' No incluye el CSV ni su detalle horario; las indexadas usarán la referencia orientativa.'
      : '';
    return `Incluye ${included.join(', ')}.${traceNote}`;
  }

  function updateShareScope() {
    if (!shareScopeEl) return;
    const options = getShareOptions();
    shareScopeEl.textContent = getShareDisclosure(options);
  }

  function closeShareDialog({ returnFocus = true } = {}) {
    if (!shareDialog || shareDialog.hidden) return;
    shareDialog.hidden = true;
    shareDialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('bv-share-open');
    if (returnFocus && shareLastFocusedEl && typeof shareLastFocusedEl.focus === 'function') {
      try { shareLastFocusedEl.focus(); } catch {}
    }
    shareLastFocusedEl = null;
  }

  function openShareDialog(returnFocusEl = document.activeElement) {
    trackShareEvent('compartir-abierto');
    if (!shareDialog) {
      shareScenario({ includeMonthly: false, includePrivate: false });
      return;
    }
    shareLastFocusedEl = returnFocusEl;
    if (shareMonthlyInput) shareMonthlyInput.checked = false;
    if (sharePrivateInput) sharePrivateInput.checked = false;
    updateShareScope();
    shareDialog.hidden = false;
    shareDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('bv-share-open');
    setTimeout(() => shareCancelButton?.focus(), 0);
  }

  function getShareFocusableElements() {
    if (!shareDialog) return [];
    return Array.from(shareDialog.querySelectorAll('input:not([disabled]), button:not([disabled])'));
  }

  async function shareScenario(options) {
    // Misma razon que en exportManualData(): compartir un "1,2,3" invalido produciria un
    // enlace que, al abrirlo, "cura" en silencio el valor a otro numero distinto (ver
    // parseManualGridRaw). Solo aplica cuando se comparten los mensuales; los ajustes
    // generales no llevan la tabla.
    if (options.includeMonthly && manualGridHasInvalidInputs()) {
      showToast('Corrige los valores inválidos de la tabla mensual antes de compartir.', 'err');
      return false;
    }

    // Snapshot del escenario en el instante en que el usuario confirma Compartir.
    // loadTarifasBV() puede esperar red; capturar DESPUES permitiria que una edicion hecha
    // durante esa espera entrase en el enlace sin haber pasado la validacion anterior.
    const sharedData = options.includeMonthly ? collectManualGridData() : {};
    if (options.includeMonthly && manualGridImportState.zonaFiscal) {
      sharedData.zonaOrigen = manualGridImportState.zonaFiscal;
    }
    const sharedConfig = getSharedConfig(options);
    const disclosure = getShareDisclosure(options);

    // Si se comparte antes del primer cálculo, obtenemos el sello del listado sin
    // bloquear el enlace si no hay red. Así el receptor puede saber con qué tarifas
    // se preparó el escenario cuando el dato esté disponible.
    if (!window.BVSim?.tarifasUpdatedAt && typeof window.BVSim?.loadTarifasBV === 'function') {
      try { await window.BVSim.loadTarifasBV(); } catch {}
    }
    const payload = {
      version: 2,
      data: sharedData,
      config: sharedConfig,
      tarifasUpdatedAt: window.BVSim?.tarifasUpdatedAt || null
    };
    const url = `${window.location.origin}${window.location.pathname}?bv=${encodeURIComponent(encodeSharedScenario(payload))}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Mi escenario solar - LuzFija.es',
          text: disclosure,
          url
        });
        trackShareEvent('url-compartida', options);
        showToast('Escenario compartido', 'ok');
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
        console.warn('Error al compartir escenario:', err);
      }
    }

    const copied = await window.LF.copyText(url);
    if (!copied) {
      showToast('No se pudo copiar el enlace. Inténtalo de nuevo.', 'err');
      return false;
    }
    trackShareEvent('url-compartida', options);
    showToast(`Enlace copiado. ${disclosure}`, 'ok');
    return true;
  }

  shareConfigButton?.addEventListener('click', async () => {
    menuPanel?.classList.remove('show');
    if (btnMenu) btnMenu.setAttribute('aria-expanded', 'false');
    if (menuPanel) menuPanel.setAttribute('aria-hidden', 'true');
    openShareDialog(btnMenu);
  });
  shareResultsButton?.addEventListener('click', () => openShareDialog(shareResultsButton));
  document.addEventListener('lf:results-ready', (e) => {
    if (e?.detail?.origin === 'solar' && shareResultsWrap) shareResultsWrap.hidden = false;
  });

  shareMonthlyInput?.addEventListener('change', updateShareScope);
  sharePrivateInput?.addEventListener('change', updateShareScope);
  shareCancelButton?.addEventListener('click', () => closeShareDialog());
  shareConfirmButton?.addEventListener('click', async () => {
    const options = getShareOptions();
    closeShareDialog({ returnFocus: false });
    await shareScenario(options);
  });
  shareDialog?.addEventListener('click', (e) => {
    if (e.target === shareDialog) closeShareDialog();
  });
  saveSharedScenarioButton?.addEventListener('click', () => {
    if (manualGridHasInvalidInputs()) {
      showToast('Corrige los valores inválidos de la tabla mensual antes de guardar.', 'err');
      return;
    }
    const payload = buildManualScenarioPayload();
    if (!persistManualScenario(payload)) {
      showToast('No se pudo guardar el escenario. Tus datos anteriores siguen intactos.', 'err');
      return;
    }
    // Persistencia, URL y UI son fases separadas: solo una transaccion completa permite
    // abandonar la previsualizacion y retirar exclusivamente `bv` de la URL actual.
    leaveSharedPreview();
    applyScenarioConfig(payload.config);
    loadCustomTarifa({ applyValues: false });
    updateDataStatus();
    showToast('Escenario compartido guardado como tu configuración.', 'ok');
  });
  document.addEventListener('keydown', (e) => {
    if (!shareDialog || shareDialog.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeShareDialog();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getShareFocusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!shareDialog.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function getCustomTarifa() {
    // Valores crudos ANTES de parsear: distinguen "campo vacio" (aplicar fallback a otro
    // periodo/potencia) de "el usuario escribio 0" (mantener 0). parseInput('') tambien da 0,
    // asi que sin mirar el raw un P2=0 explicito era indistinguible de un P2 vacio.
    const puntaRaw = String(document.getElementById('mtPunta')?.value ?? '').trim();
    const llanoRaw = String(document.getElementById('mtLlano')?.value ?? '').trim();
    const valleRaw = String(document.getElementById('mtValle')?.value ?? '').trim();
    const p1Raw = String(document.getElementById('mtP1')?.value ?? '').trim();
    const p2Raw = String(document.getElementById('mtP2')?.value ?? '').trim();

    const punta = parseInput(puntaRaw);
    const llano = parseInput(llanoRaw);
    const valle = parseInput(valleRaw);
    const p1 = parseInput(p1Raw);
    const p2 = parseInput(p2Raw);
    const exc = parseInput(document.getElementById('mtExc')?.value || '');

    const energy = [
      { raw: puntaRaw, value: punta },
      { raw: llanoRaw, value: llano },
      { raw: valleRaw, value: valle }
    ];
    const filledEnergy = energy.filter(x => x.raw !== '');
    const power = [
      { raw: p1Raw, value: p1 },
      { raw: p2Raw, value: p2 }
    ];
    const filledPower = power.filter(x => x.raw !== '');

    // Validación estricta: necesita al menos UN precio de energía Y UN precio de potencia
    // rellenados con un valor positivo (un campo relleno a 0 no basta para activar el calculo).
    const hasEnergy = filledEnergy.some(x => x.value > 0);
    const hasPower = filledPower.some(x => x.value > 0);

    if (!hasEnergy || !hasPower) return null;

    // Tipo de tarifa segun CUANTOS campos se rellenaron (no cuantos son > 0): un P1=0,12 con
    // Llano=0 explicito son DOS campos proporcionados, y por tanto 3P, no una 1P replicada.
    const tipo = filledEnergy.length === 1 ? '1P' : '3P';
    // Si solo se relleno un precio de energia (1P), se replica a los tres periodos; si hay mas
    // de uno relleno, cada periodo vacio hereda el primer precio relleno como referencia.
    const energyFallback = filledEnergy[0].value;
    const powerFallback = filledPower[0].value;

    // Leer checkbox de batería virtual (no autodetectar)
    const hasBV = document.getElementById('mtBV')?.checked ?? false;
    // Cuota mensual de BV: solo se lee/aplica si hay BV activa. Sin BV, precioBV es 0 igual
    // que hacen las tarifas del dataset con Bateria Virtual="NO" (Precio BV siempre 0).
    const precioBV = hasBV ? parseInput(document.getElementById('mtPrecioBV')?.value || '') : 0;

    // Opciones avanzadas (14/08/2026): sin ellas, "Mi tarifa" no podia reproducir 17 de las
    // 118 tarifas activas que usan al menos una de estas tres condiciones economicas. Ver
    // lf-ssaa.js (mustApply), desglose-calculo.js/bv-sim-monthly.js (ENERGIA_PARCIAL) y el
    // centinela fv.exc=-1 (compensacion indexada) ya soportados por el motor para tarifas del
    // dataset.
    const incluyeServiciosAjuste = !(document.getElementById('mtSinSSAA')?.checked ?? false);
    const compensacionIndexada = document.getElementById('mtCompensacionIndexada')?.checked ?? false;
    const topeParcial = document.getElementById('mtTopeParcial')?.checked ?? false;
    const excFinal = compensacionIndexada ? -1 : exc;
    const compensa = excFinal > 0 || excFinal === -1;

    return {
      nombre: 'Mi tarifa ⭐',
      tipo: tipo,
      cPunta: puntaRaw !== '' ? punta : energyFallback,
      cLlano: llanoRaw !== '' ? llano : energyFallback,
      cValle: valleRaw !== '' ? valle : energyFallback,
      p1: p1Raw !== '' ? p1 : powerFallback,
      p2: p2Raw !== '' ? p2 : powerFallback,
      web: '', // Vacío para que no se renderice el botón de información
      esPersonalizada: true,
      incluyeServiciosAjuste: incluyeServiciosAjuste,
      fv: {
        exc: excFinal,
        tipo: compensa ? (hasBV ? 'SIMPLE + BV' : 'SIMPLE') : 'NO COMPENSA',
        tope: topeParcial ? 'ENERGIA_PARCIAL' : 'ENERGIA',
        // INVARIANTE: fv.bv significa "BV aplicable", no "el checkbox estaba marcado".
        // Ver la nota extensa en js/lf-tarifa-custom.js: sin compensacion, emitir bv:true
        // divergiria entre bv-sim-monthly.js (activa por fv.bv) y home/desglose (exigen
        // ademas tipo 'SIMPLE + BV'). Mantener la condicion en los tres productores.
        bv: hasBV && compensa,
        reglaBV: (hasBV && compensa) ? 'BV MES ANTERIOR' : 'NO APLICA',
        precioBV: precioBV
      },
      requiereFV: false
    };
  }
  // Expuesto solo para tests (mismo patron que window.BVSim._manualMonthMeta etc.): permite
  // comprobar el objeto que construye getCustomTarifa() sin tener que disparar el flujo
  // completo de "Calcular".
  window.BVSim._getCustomTarifa = getCustomTarifa;

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
  function populateManualGridFromCSV(importResult, zona = 'peninsula', trackImport = true) {
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
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
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

      // Formatear con comas (estilo español) para mostrar en inputs. preserveZero:true porque
      // este mes SI tiene datos CSV reales (esta en monthDataMap) — un 0 aqui es un mes real
      // con cero consumo/vertido en ese periodo, no "sin dato".
      const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
      if (p1In) p1In.value = formatNumberES(r2(data.p1), { preserveZero: true });
      if (p2In) p2In.value = formatNumberES(r2(data.p2), { preserveZero: true });
      if (p3In) p3In.value = formatNumberES(r2(data.p3), { preserveZero: true });
      if (vIn) vIn.value = formatNumberES(r2(data.vert), { preserveZero: true });
      setManualMonthMeta(monthIndex, data.meta);

      // Marcar visualmente como válidos
      [p1In, p2In, p3In, vIn].forEach(el => {
        if (el && el.value !== '') el.classList.add('valid');
      });

      filledCount++;
    });

    // 5. Actualizar totales y guardar
    if (filledCount > 0) {
      // La procedencia se anota ANTES de guardar: saveManualData persiste la zona de origen
      // del reparto, asi que hacerlo despues dejaria en localStorage la zona anterior y la
      // proteccion tras recargar no serviria de nada. Vale para las dos rutas: la zona se
      // actualiza tambien cuando esto es un recalculo (trackImport=false), porque el reparto
      // que acaba de escribirse en la tabla es ya el de la zona nueva.
      manualGridImportState.zonaFiscal = zona;
      if (trackImport) {
        manualGridImportState.result = importResult;
        manualGridImportState.dirty = false;
      }

      updateManualTotals();
      updateMesInicioSelectorFromGrid();
      saveManualData();

      // trackImport=false es un REPARTO del mismo fichero ya importado (recalculo por cambio
      // de zona), no una importacion nueva: se omite el aviso de "Datos importados", que
      // anunciaria algo que no ha ocurrido.
      if (!trackImport) return;

      // Mensaje informativo sobre múltiples años
      let message = `✓ Datos importados: ${filledCount} meses procesados`;
      if (yearsFound.size > 1) {
        const years = Array.from(yearsFound).sort((a, b) => b - a);
        message += ` (años ${years.join(', ')} - se usa el más reciente por mes)`;
      }
      showToast(message, 'ok');
    }
  }

  if (!fileInput || !simulateButton) return;

  resultsEl?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const toggle = event.target.closest('[data-consumo-estimate-toggle]');
    if (!toggle || !resultsEl.contains(toggle)) return;
    useAnnualConsumptionEstimate = toggle.dataset.consumoEstimateToggle === 'true';
    annualConsumptionEstimateBasis = null;
    focusAnnualConsumptionEstimateToggle = true;
    simulateButton.click();
  });

  // Bloqueo por reparto de otra zona. Se pinta en el area de estado (persistente hasta el
  // siguiente calculo) y no como toast, porque el usuario tiene que poder leerlo y decidir.
  // Las dos salidas que menciona el texto son reales: reimportar o volver a la zona de
  // origen. La tercera, "lo he ajustado yo a mano", no puede verificarla el programa, asi
  // que va detras de un boton explicito mas un confirm(), el mismo patron que el borrado
  // total de datos.
  // El valor interno de la zona ('CeutaMelilla', 'Península') no es lo que el usuario lee en
  // el selector ('Ceuta y Melilla', 'Península y Baleares'). En textos visibles se usa la
  // etiqueta del propio <option>, que es la unica fuente de verdad si algun dia cambia.
  function zonaLabel(zonaValue) {
    const raw = String(zonaValue || '');
    if (!raw || !zonaFiscalInput) return raw;
    const opcion = Array.from(zonaFiscalInput.options || []).find((o) => o.value === raw);
    const texto = opcion ? String(opcion.textContent || '').trim() : '';
    return texto || raw;
  }

  function renderZoneMismatchBlock(message, zonaFiscalVal) {
    if (resultsContainer) { resultsContainer.classList.remove('show'); resultsContainer.style.display = 'none'; }
    if (statusContainer) statusContainer.style.display = 'block';
    if (!statusEl) {
      showToast(message, 'err');
      return;
    }

    const etiquetaZona = zonaLabel(zonaFiscalVal);
    statusEl.innerHTML = `<span style="color:var(--danger)">⚠️ ${escapeHtml(message)}</span>`
      + `<br><button type="button" id="bv-zona-confirm" class="btn btn-secondary" style="margin-top:10px">`
      + `He ajustado la tabla a mano para ${escapeHtml(etiquetaZona)}</button>`;
    showToast(message, 'err');

    const confirmBtn = document.getElementById('bv-zona-confirm');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('click', () => {
      const aviso = `¿Confirmas que los valores P1/P2/P3 de la tabla corresponden al horario de ${etiquetaZona}?\n\n`
        + 'Si no es así, el cálculo saldrá mal sin avisar. En caso de duda, vuelve a importar el archivo.';
      if (!window.confirm(aviso)) return;

      // Se guarda el VALOR interno, no la etiqueta: es lo que compara changesSchedulingZone y
      // lo que se persiste. La etiqueta solo existe para los textos.
      window.BVSim.manualUi.acceptManualZoneAdjustment(manualGridImportState, zonaFiscalVal);
      // Persistir de inmediato: si no, una recarga volveria a bloquear pese a la confirmacion.
      saveManualData();
      statusEl.innerHTML = '';
      if (statusContainer) statusContainer.style.display = 'none';
      showToast('✓ Reparto aceptado para ' + etiquetaZona + '. Ya puedes calcular.', 'ok');
    });
  }

  async function handleFile(file) {
    if (!file) return;
    // Elegir un CSV/XLSX nuevo sustituye tambien cualquier lectura de respaldo JSON que siguiera
    // pendiente: ambos productores compiten por el mismo grid y la accion mas reciente debe ganar.
    invalidatePendingBackupImport();
    // La seleccion aun NO es estado publicado: el fichero actual sigue siendo el anterior hasta
    // que este parseo termine bien. El contador impide que una importacion vieja haga commit
    // despues de otra seleccion, un reset, quitar archivo o restaurar un respaldo.
    const importGeneration = ++fileImportGeneration;

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
      if (importGeneration !== fileImportGeneration) return;
      if (result && result.ok) {
        // Commit atomico de la importacion vigente: hasta aqui el fichero anterior seguia siendo
        // el activo. Un parseo fallido no cambia nombre, cache, grid ni traza.
        cancelManualAutosave();
        invalidateVisibleSimulationResults();
        window.BVSim.file = file;
        window.BVSim._cachedImportResult = result;
        if (fileNameDisplay) fileNameDisplay.textContent = file.name;
        if (fileSelectedMsg) fileSelectedMsg.style.display = 'flex';
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
          if (importGeneration !== fileImportGeneration) return;
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
        // La seleccion fallida nunca se publico. Vaciar el input real permite volver a elegir el
        // mismo fichero (los navegadores no garantizan `change` si el valor sigue siendo identico)
        // sin tocar el fichero/cache anterior que continua siendo el contexto activo.
        if (fileInput) fileInput.value = '';
        showToast(result.error, 'err');
      }
    } catch (e) {
      if (importGeneration !== fileImportGeneration) return;
      if (fileInput) fileInput.value = '';
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
      clearActiveFileSelection();
      clearHourlyTraceState();
      // NO se limpia manualGridImportState: quitar el fichero retira la seleccion, pero el
      // grid conserva sus P1/P2/P3 y su localStorage. La procedencia de esos datos sigue
      // siendo valida y es lo unico que detecta un cambio de zona posterior. Si se limpiase
      // aqui, el grid quedaria con el reparto de la zona antigua sin recalculo ni bloqueo.
      // Los resets que SI deben limpiarla son los que sustituyen o vacian el grid.
      clearRenderedSimulationOutput();
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
    } else if (p1Val < 0) {
      p1Error = 'La potencia P1 no puede ser negativa.';
      p1Input.classList.add('error');
    } else if (p1Val > (window.LF_CONFIG?.POTENCIA_MAX_KW || 15)) {
      p1Error = `La potencia P1 debe ser ≤ ${window.LF_CONFIG?.POTENCIA_MAX_KW || 15} kW.`;
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
    } else if (p2Val > (window.LF_CONFIG?.POTENCIA_MAX_KW || 15)) {
      p2Error = `La potencia P2 debe ser ≤ ${window.LF_CONFIG?.POTENCIA_MAX_KW || 15} kW.`;
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

    // Validar Mi tarifa (si hay contenido, debe tener formato válido, estar
    // completa según el modelo flexible del simulador y quedar dentro de rango).
    const miTarifaBVActiva = Boolean(document.getElementById('mtBV')?.checked);
    const miTarifaIndexada = Boolean(document.getElementById('mtCompensacionIndexada')?.checked);
    // mtPrecioBV no participa en la economia si BV esta desmarcada (getCustomTarifa() pone
    // precioBV a 0 en ese caso), y mtExc queda oculto e ignorado (fv.exc se fuerza a -1) si
    // la compensacion es indexada: en ninguno de los dos casos debe su contenido invalido
    // bloquear el calculo de algo que nunca se va a aplicar.
    const miTarifaIds = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2']
      .concat(miTarifaIndexada ? [] : ['mtExc'])
      .concat(miTarifaBVActiva ? ['mtPrecioBV'] : []);
    const miTarifaHasContent = miTarifaIds.some(function (id) {
      return String(document.getElementById(id)?.value || '').trim() !== '';
    });

    let miTarifaError = null;
    if (miTarifaHasContent) {
      const mtFormatMessages = {
        mtPunta: 'Los precios de energía deben ser números válidos.',
        mtLlano: 'Los precios de energía deben ser números válidos.',
        mtValle: 'Los precios de energía deben ser números válidos.',
        mtP1: 'Los precios de potencia deben ser números válidos.',
        mtP2: 'Los precios de potencia deben ser números válidos.',
        mtExc: 'El precio de compensación debe ser un número válido.',
        mtPrecioBV: 'La cuota de batería virtual debe ser un número válido.'
      };
      const mtNegativeMessages = {
        mtPunta: 'Los precios de energía no pueden ser negativos.',
        mtLlano: 'Los precios de energía no pueden ser negativos.',
        mtValle: 'Los precios de energía no pueden ser negativos.',
        mtP1: 'Los precios de potencia no pueden ser negativos.',
        mtP2: 'Los precios de potencia no pueden ser negativos.',
        mtExc: 'El precio de compensación no puede ser negativo.',
        mtPrecioBV: 'La cuota de batería virtual no puede ser negativa.'
      };
      const mtRangeMessages = {
        mtPunta: 'Los precios de energía parecen muy altos (máximo: 1 €/kWh).',
        mtLlano: 'Los precios de energía parecen muy altos (máximo: 1 €/kWh).',
        mtValle: 'Los precios de energía parecen muy altos (máximo: 1 €/kWh).',
        mtP1: 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día).',
        mtP2: 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día).',
        mtExc: 'El precio de compensación parece muy alto (máximo habitual: 0,5 €/kWh).'
      };

      // La validación en vivo marca el campo, pero el botón debe volver a
      // comprobarlo y convertir cualquier error en un bloqueo del cálculo.
      // Los campos vacíos siguen siendo opcionales en este simulador.
      miTarifaIds.forEach(function (id) {
        const el = document.getElementById(id);
        const raw = String(el?.value || '').trim();
        const valid = validateInputFormat(el, MAX_DECIMALES_PRECIO, mtMaxValues[id], mtMinExclusive[id]);
        if (!raw) return;
        if (valid || miTarifaError) return;

        const val = parseInput(raw);
        if (Number.isFinite(val) && val < 0) {
          miTarifaError = mtNegativeMessages[id];
        } else if (Number.isFinite(val) && val > mtMaxValues[id]) {
          miTarifaError = mtRangeMessages[id];
        } else if (Number.isFinite(val) && mtMinExclusive[id] !== undefined && val <= mtMinExclusive[id]) {
          miTarifaError = 'El precio de potencia P1 debe ser mayor que 0.';
        } else {
          miTarifaError = mtFormatMessages[id];
        }
      });

      // Con BV activa, la cuota es obligatoria (puede ser 0): dejarla vacia significaria "BV
      // gratuita" en silencio, que puede no serlo. Se comprueba aparte porque el resto de
      // campos de esta lista son opcionales incluso con contenido en otros sitios del formulario.
      if (!miTarifaError && miTarifaBVActiva) {
        const precioBVRaw = String(document.getElementById('mtPrecioBV')?.value || '').trim();
        if (!precioBVRaw) {
          miTarifaError = 'Indica la cuota mensual de la batería virtual (escribe 0 si es gratuita).';
          const precioBVEl = document.getElementById('mtPrecioBV');
          if (precioBVEl) precioBVEl.classList.add('error');
        }
      }

      const customTarifa = miTarifaError ? null : getCustomTarifa();
      if (!miTarifaError && !customTarifa) {
        miTarifaError = "Los datos de 'Mi tarifa actual' están incompletos. Introduce al menos un precio de energía (Punta, Llano o Valle) y uno de potencia (P1 o P2) para incluirla en la comparación.";
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

    // El reparto de la tabla puede ser de otra zona horaria. Se comprueba ANTES de arrancar
    // el calculo (y no dentro del try) porque el aviso lleva su propia via de escape y no
    // puede renderizarse como un error generico mas.
    const zoneMismatchError = window.BVSim.manualUi.getManualGridZoneMismatchError(
      manualGridImportState, zonaFiscalVal, window.LF?.csvUtils?.normalizeZonaFiscal, zonaLabel
    );
    if (zoneMismatchError) {
      renderZoneMismatchBlock(zoneMismatchError, zonaFiscalVal);
      return;
    }

    // Revalida TODOS los inputs de la cuadricula manual justo antes de calcular, sin fiarse de
    // la clase .error (un respaldo/URL compartida puede rellenar el .value sin disparar el
    // evento 'input'). Antes, un valor invalido en pantalla no bloqueaba: se clampaba en
    // silencio (-50->0, 20000->10000) dentro de readManualEntriesFromGrid().
    if (manualGridHasInvalidInputs()) {
      showToast('Corrige los valores inválidos de la tabla mensual antes de calcular.', 'err');
      return;
    }

    dispatchResultsRequested();

    clearRenderedSimulationOutput();
    if (statusContainer) { statusContainer.style.display = 'block'; statusEl.innerHTML = '<span class="spinner"></span> Calculando...'; }

    const btnText = simulateButton.querySelector('.bv-btn-text');
    const btnSpinner = simulateButton.querySelector('.spinner');
    simulateButton.disabled = true;
    if (btnText) btnText.textContent = 'Calculando...';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';

    try {
      // TODO el estado sincronico se captura AQUI, en un unico bloque, ANTES del primer
      // await (ni siquiera el setTimeout(100) de mas abajo, que solo deja pintar el
      // spinner). El formulario sigue siendo editable durante loadTarifasBV() (fetch de
      // red sin duracion acotada) y el resto de awaits (SSAA, traza horaria indexada): sin
      // esta captura unica, potencia/tabla/"Mi tarifa"/zona podian venir de instantes
      // distintos dentro del mismo calculo si el usuario editaba mientras tanto.
      const currentYear = new Date().getFullYear();
      const manualEntries = readManualEntriesFromGrid();

      // Validar que haya al menos 1 mes con datos
      const manualMonths = window.BVSim.manualUi.buildSimulationMonths(manualEntries, {
        currentYear,
        monthMetaByIndex: manualMonthMetaByIndex
      });
      const monthlyResult = { ok: true, months: manualMonths };
      const customTarifa = getCustomTarifa();
      // mesInicioVal capturado AQUI (no tras loadTarifasBV, como antes): updateMesInicioSelector()
      // se sigue llamando mas abajo para refrescar las opciones visibles, pero la ROTACION
      // usa este valor congelado, no el que quede en el DOM despues de esa actualizacion.
      const mesInicioValCapturado = mesInicioInput && !mesInicioInput.disabled ? (mesInicioInput.value || '') : '';
      // Snapshot para detectar, justo despues del ultimo await, si el usuario edito algo
      // mientras se calculaba: si difiere, el resultado sigue siendo internamente coherente
      // (todo viene del mismo instante) pero ya no coincide con lo que el formulario muestra
      // ahora, y no debe presentarse como vigente.
      // mesInicio SI se incluye (a diferencia de una version anterior de este fix): la
      // comprobacion se hace mas abajo justo ANTES de updateMesInicioSelector(), que es quien
      // puede reasignarlo programaticamente — comparando antes de esa mutacion, un cambio real
      // del usuario se detecta sin el falso positivo de esa reasignacion.
      const hourlyTraceRevAtCapture = hourlyTraceState.rev || 0;
      const calcSnapshotSignature = JSON.stringify({
        p1Raw, p2Raw, saldoRaw, zonaFiscalVal, esViviendaCanarias, manualEntries, customTarifa,
        mesInicioValCapturado
      });
      const isCalcResultStale = () => (hourlyTraceState.rev || 0) !== hourlyTraceRevAtCapture || JSON.stringify({
        p1Raw: String(p1Input?.value || '').trim(),
        p2Raw: String(p2Input?.value || '').trim(),
        saldoRaw: String(saldoInput?.value || '').trim(),
        zonaFiscalVal: zonaFiscalInput ? zonaFiscalInput.value : 'Península',
        esViviendaCanarias: viviendaCanariasInput ? viviendaCanariasInput.checked : true,
        manualEntries: readManualEntriesFromGrid(),
        customTarifa: getCustomTarifa(),
        mesInicioValCapturado: mesInicioInput && !mesInicioInput.disabled ? (mesInicioInput.value || '') : ''
      }) !== calcSnapshotSignature;
      // Aviso persistente (no solo un toast que desaparece) para cuando el resultado ya no
      // corresponde al formulario: NO se publica el ranking calculado con datos viejos.
      const renderStaleWarning = () => {
        resultsEl.innerHTML = `<h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2><p class="empty-results">Has cambiado datos mientras se calculaba, así que este resultado ya no corresponde a lo que ves en el formulario. Pulsa <strong>Calcular</strong> de nuevo para actualizarlo.</p>`;
        resultsContainer.style.display = 'block';
        resultsContainer.classList.add('show');
        if (statusContainer) statusContainer.style.display = 'none';
        showToast('Has cambiado datos mientras se calculaba. Pulsa Calcular de nuevo para ver el resultado actualizado.', 'err');
      };

      await new Promise(r => setTimeout(r, 100));

      // Validar que haya al menos 1 mes con datos. Se comprueba AQUI (no antes del wait de
      // arriba) para conservar el mismo comportamiento observable de siempre: el error no
      // aparece en el mismo tick que el click, sino tras dejar pintar el spinner. No afecta
      // a la captura del snapshot, que ya quedo fija arriba.
      if (manualMonths.length === 0) {
        throw new Error('Introduce datos para al menos un mes. Rellena los valores de consumo (P1/P2/P3) y/o vertido, o sube un archivo CSV.');
      }

      // Mismo requisito que ya existe para CSV (validateCsvSpanFromRecords,
      // requireExactly12Months): un hueco mensual interno arrastraria el saldo de la bateria
      // virtual de un mes a otro sin haber simulado el mes que falta de por medio. Reutiliza
      // monthsAreConsecutive() en vez de duplicar la logica.
      if (manualMonths.length > 1) {
        const monthKeysSorted = manualMonths.map((m) => m.key).sort();
        const continuidad = window.LF?.csvUtils?.monthsAreConsecutive
          ? window.LF.csvUtils.monthsAreConsecutive(monthKeysSorted)
          : { ok: true };
        if (!continuidad.ok) {
          throw new Error(
            `Hay un hueco en la tabla mensual: falta al menos un mes completo entre ` +
            `${continuidad.gapAfter} y ${continuidad.gapBefore}. Rellena ese mes (aunque sea a ` +
            `cero) o elimina los meses posteriores al hueco antes de calcular.`
          );
        }
      }

      const tarifasResult = await window.BVSim.loadTarifasBV();
      if (!tarifasResult || !tarifasResult.ok || !Array.isArray(tarifasResult.tarifasBV)) {
        throw new Error(tarifasResult?.error || 'No se pudieron cargar las tarifas (tarifas.json).');
      }
      if (!sharedScenarioNotice?.hidden) showSharedScenarioNotice(tarifasResult.updatedAt);

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
        // computeHourlyCompensation es async. Si la traza se quito/cambio durante el await, el
        // resultado local aun sirve para terminar este calculo (que sera descartado por el guard
        // de stale), pero NO puede resucitar `stats` dentro del estado de la traza nueva/vacia.
        if ((hourlyTraceState.rev || 0) === hourlyTraceRevAtCapture) {
          hourlyTraceState.stats = stats;
        }
        monthlyResult.months = window.LF.surplusPrices.applyMonthlyIndexedValues(monthlyResult.months, stats);
        indexedTraceMode = monthlyResult.months.some((month) => month.indexedSurplusSource === 'hourly-index-base')
          ? 'hourly-index-base'
          : 'reference';
      }

      const baseMonths = monthlyResult.months || [];
      // Comprobacion UNICA, justo aqui: es el punto exacto tras el ultimo await posible
      // (computeHourlyCompensation) y ANTES de la primera mutacion interna
      // (updateMesInicioSelector, que puede reasignar mesInicioInput.value por su cuenta).
      // No hace falta repetirla en cada punto de commit mas abajo: entre aqui y alli ya no
      // hay ningun await, asi que el DOM no puede cambiar por medio.
      const staleAtThisPoint = isCalcResultStale();
      // Se sigue llamando para refrescar las opciones visibles del selector, pero la
      // rotacion usa mesInicioValCapturado (congelado antes del primer await), no lo que
      // quede en el DOM tras esta actualizacion.
      updateMesInicioSelector(baseMonths);
      const mesInicioVal = mesInicioValCapturado;
      const mesInicioActivo = Boolean(mesInicioVal && baseMonths.some((month) => month.key === mesInicioVal));
      const mesInicioLabel = mesInicioActivo ? formatMonthKeyLabel(mesInicioVal) : '';
      const simulationMonths = window.BVSim.manualUi.rotateMonthsByStart(baseMonths, mesInicioVal);
      const monthMap = new Map(baseMonths.map((m) => [m.key, m]));
      const simulatedMonths = simulationMonths;
      const completeMonths = simulatedMonths.filter((month) => {
        const daysInMonth = Number(month.daysInMonth) || (() => {
          const m = /^(\d{4})-(\d{2})$/.exec(String(month.key || ''));
          return m ? new Date(Number(m[1]), Number(m[2]), 0).getDate() : 31;
        })();
        return (Number(month.daysWithData) || 0) >= Math.ceil(daysInMonth * 0.8);
      }).length;
      // Conserva el 80 % para la etiqueta histórica del coste, pero exige
      // cobertura anual real antes de excluir por un mínimo contractual.
      const isAnnualPresentationScope = simulatedMonths.length >= 12 && completeMonths >= 12;
      const isAnnualConsumptionScope = window.BVSim.manualUi.hasFullAnnualConsumptionCoverage(simulatedMonths);
      const consumptionCoverageDays = window.BVSim.manualUi.getConsumptionCoverageDays(simulatedMonths);
      const consumoRegistradoKwh = simulatedMonths.reduce((total, month) => {
        const direct = Number(month.importTotalKWh);
        const byPeriod = (Number(month.importByPeriod?.P1) || 0)
          + (Number(month.importByPeriod?.P2) || 0)
          + (Number(month.importByPeriod?.P3) || 0);
        return total + (Number.isFinite(direct) ? Math.max(0, direct) : byPeriod);
      }, 0);
      const estimateBasis = `${consumptionCoverageDays}|${consumoRegistradoKwh}`;
      if (useAnnualConsumptionEstimate) {
        if (annualConsumptionEstimateBasis === null) {
          annualConsumptionEstimateBasis = estimateBasis;
        } else if (annualConsumptionEstimateBasis !== estimateBasis) {
          useAnnualConsumptionEstimate = false;
          annualConsumptionEstimateBasis = null;
        }
      }
      const limitesConsumo = typeof window.LF.assessConsumoAnualLimits === 'function'
        ? window.LF.assessConsumoAnualLimits(tarifasResult.tarifasBV, {
          consumoKwh: consumoRegistradoKwh,
          annualScope: isAnnualConsumptionScope,
          coveredDays: consumptionCoverageDays,
          useAnnualEstimate: useAnnualConsumptionEstimate
        })
        : { consumoKwh: consumoRegistradoKwh, annualScope: isAnnualConsumptionScope, compatibles: tarifasResult.tarifasBV, excluidas: [] };
      if (!limitesConsumo.estimateAvailable) {
        useAnnualConsumptionEstimate = false;
        annualConsumptionEstimateBasis = null;
      }
      tarifasResult.tarifasBV = limitesConsumo.compatibles;
      if (tarifasResult.tarifasBV.length === 0) {
        // Antes de publicar CUALQUIER resultado (incluido este "no quedan tarifas", que
        // depende del consumo capturado y podria ya no reflejar la tabla actual): si el
        // usuario cambio algo mientras tanto, avisar en vez de mostrar una exclusion basada
        // en datos viejos. Se reusa la comprobacion cacheada (ver staleAtThisPoint mas
        // arriba): entre aqui y alli no hay ningun await, asi que sigue siendo valida.
        if (staleAtThisPoint) { renderStaleWarning(); return; }
        const limitsScope = limitesConsumo.estimateApplied ? 'registrados o estimados' : 'registrados';
        resultsEl.innerHTML = `<h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>${buildConsumoLimitsMessage(limitesConsumo)}<p class="empty-results">No quedan tarifas solares compatibles con los requisitos de consumo ${limitsScope}.</p>`;
        resultsContainer.style.display = 'block';
        resultsContainer.classList.add('show');
        statusContainer.style.display = 'none';
        focusConsumoEstimateToggle();
        showToast(`No quedan tarifas solares compatibles con los requisitos de consumo ${limitsScope}.`, 'err');
        return;
      }

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
      const { rankable: rankableResults, invalid: invalidResults } = window.BVSim.manualUi.partitionRankableResults(allResults.results);
      if (rankableResults.length === 0) {
        throw new Error('No hay resultados con totales válidos para ordenar el ranking.');
      }
      const rankedResults = rankableResults.sort(window.BVSim.manualUi.compareRankedResultsByPaid);

      const winner = rankedResults[0];

      const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
      const rMoney = (products) => {
        const helper = window.LF_CONFIG && window.LF_CONFIG.roundMoneyProducts;
        return typeof helper === 'function'
          ? helper(products)
          : r2((products || []).reduce((sum, factors) => sum + factors.reduce((prod, factor) => prod * Number(factor), 1), 0));
      };
      const totalCostLabel = isAnnualPresentationScope ? 'Coste total anual' : 'Coste periodo simulado';
      const totalCostSub = isAnnualPresentationScope
        ? (mesInicioActivo ? `Suma de 12 meses desde ${mesInicioLabel}` : 'Suma de todas tus facturas mensuales')
        : `Suma de ${simulatedMonths.length} mes${simulatedMonths.length === 1 ? '' : 'es'} simulado${simulatedMonths.length === 1 ? '' : 's'}`;
      const totalCostNote = isAnnualPresentationScope
        ? (mesInicioActivo ? `durante 12 meses desde ${mesInicioLabel}` : 'durante el año')
        : `durante el periodo introducido (${simulatedMonths.length} mes${simulatedMonths.length === 1 ? '' : 'es'}). No se presenta como ranking anual porque no hay 12 meses razonablemente completos`;
      const scopeAdjective = isAnnualPresentationScope ? 'anual' : 'del periodo';
      trackBvEvent('simulador-solar-resultados', [
        isAnnualPresentationScope ? 'anual' : 'parcial',
        customTarifa ? 'con-mi-tarifa' : 'sin-mi-tarifa',
        indexedTraceMode === 'hourly-index-base' ? 'indexado-horario' : 'indexado-referencia'
      ], 'Resultados simulador solar: ' + (isAnnualPresentationScope ? 'anual' : 'parcial'));

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
        const potP1 = rMoney([[p1Val, row.dias, t.p1]]);
        const potP2 = rMoney([[p2Val, row.dias, t.p2]]);
        const tipPot = `⚡ P1: ${fKw(p1Val)} × ${row.dias} d × ${priceFmt.format(t.p1)} = ${fEur(potP1)}
⚡ P2: ${fKw(p2Val)} × ${row.dias} d × ${priceFmt.format(t.p2)} = ${fEur(potP2)}
💰 Total: ${fEur(row.pot)}`;

        // Cálculos Energía (Bruta)
        const kwhP1 = Number(m.importByPeriod?.P1) || 0;
        const kwhP2 = Number(m.importByPeriod?.P2) || 0;
        const kwhP3 = Number(m.importByPeriod?.P3) || 0;
        const eP1 = rMoney([[kwhP1, t.cPunta]]);
        const eP2 = rMoney([[kwhP2, t.cLlano]]);
        const eP3 = rMoney([[kwhP3, t.cValle]]);
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
        const totalGen = Number.isFinite(Number(row.creditoPotencial))
          ? r2(Number(row.creditoPotencial))
          : rMoney([[exKwh, row.precioExc || 0]]);
        const usesHourlyIndex = row.precioExcSource === 'hourly-index-base';
        const esCP = t?.fv?.tope === 'ENERGIA_PARCIAL';
        const maxComp = (esCP && row.baseCompensable != null)
          ? r2(row.baseCompensable) : eBruta;
        let tipMaxDetalle = '';
        if (esCP && row.peajesTotal > 0) {
          const pc = (window.LF_CONFIG && window.LF_CONFIG.peajesCargosEnergia) || {};
          const pP1 = rMoney([[kwhP1, pc.P1 || 0]]);
          const pP2 = rMoney([[kwhP2, pc.P2 || 0]]);
          const pP3 = rMoney([[kwhP3, pc.P3 || 0]]);
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

      // Helper: Oferta disponible (campo promo). Se informa, nunca se aplica al calculo:
      // el ranking solar sigue ordenando por coste real sin promociones.
      const getPromoAviso = (tarifa) => {
        const promo = tarifa?.promo;
        if (!promo) return '';
        return `<div style="
          margin-top: 8px;
          padding: 8px 12px;
          background: rgba(34,197,94,0.10);
          border-left: 3px solid #15803D;
          border-radius: 6px;
          font-size: 0.8125rem;
          line-height: 1.4;
          color: var(--text);
          font-weight: 600;
        ">🎁 Oferta: ${escapeHtml(promo)} No incluida en este cálculo.</div>`;
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
      const winnerPromoNote = getPromoAviso(winner.tarifa);

      // Delta frente a "Mi tarifa ⭐" (si el usuario la ha rellenado)
      const customResult = rankedResults.find((r) => r.tarifa?.esPersonalizada);
      const customRank = customResult ? rankedResults.indexOf(customResult) + 1 : 0;
      const winnerIsCustom = Boolean(winner.tarifa?.esPersonalizada);
      let customDeltaKpi = '';
      if (customResult && !winnerIsCustom) {
        const deltaVsCustom = r2(customResult.totals.pagado - winner.totals.pagado);
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
            ${winnerPromoNote}
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
        const altPromoNote = getPromoAviso(r.tarifa);
        const deltaVsWinner = r2(r.totals.pagado - winner.totals.pagado);
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
            ${altPromoNote}
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
              <button type="button" class="bv-alt-btn bv-alt-btn-toggle" aria-expanded="false">
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
      const totalTarifasLabel = `${totalTarifas} ${totalTarifas === 1 ? 'tarifa' : 'tarifas'}`;
      const invalidTariffDetails = invalidResults.map((result) => ({
        name: escapeHtml(result?.tarifa?.nombre || 'Tarifa sin nombre'),
        reason: escapeHtml(result?.dataUnavailableReason || 'tiene totales no válidos')
      }));
      const invalidRankingMsg = invalidTariffDetails.length > 0
        ? `<br><br><strong>⚠️ ${invalidTariffDetails.length === 1 ? 'Tarifa excluida' : 'Tarifas excluidas'}:</strong> ${invalidTariffDetails.map((item) => `${item.name}: ${item.reason}`).join(' · ')}. No se muestra ningún importe para evitar resultados engañosos.`
        : '';
      const consumoLimitsMsg = buildConsumoLimitsMessage(limitesConsumo);
      const indexedFallbackMsg = buildIndexedFallbackMsg(hasIndexedTariffs, indexedTraceMode, zonaFiscalVal);
      const mesInicioNote = mesInicioActivo
        ? `<br><br><strong>Mes de inicio:</strong> simulación desde ${escapeHtml(mesInicioLabel)}. La hucha se arrastra en el orden mostrado en los desgloses.`
        : '';
      let saldoInicialNote = '';
      if (saldoAplicado) {
        saldoInicialNote = `<br><br><strong>Saldo BV inicial:</strong> los ${fEur(saldoVal)} indicados se aplican solo a <strong>Mi tarifa ⭐</strong>. Las demás tarifas empiezan con la hucha a 0 €: el saldo acumulado no se transfiere al cambiar de comercializadora.`;
      } else if (saldoSinDestino) {
        // No decir "marca Tiene batería virtual": desde la normalización de fv.bv (20/08/2026)
        // la casilla puede estar YA marcada y aun así no haber BV aplicable, porque falta la
        // compensación. Pedir lo que el usuario ya ha hecho induce a error.
        saldoInicialNote = `<br><br><strong>⚠️ Saldo BV inicial no aplicado:</strong> has indicado ${fEur(saldoVal)}, pero no hay ninguna tarifa actual con batería virtual aplicable a la que asignarlo. Rellena "Comparar con mi tarifa actual" y configura ahí su batería virtual junto con la compensación de excedentes, si esa hucha es de tu contrato de ahora.`;
      }
      const rankingNote = `
        <div style="background: var(--card2); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <div style="font-size: 0.95rem; color: var(--muted); line-height: 1.6;">
            <strong>¿Cómo se calcula el ranking?</strong><br>
            Las tarifas están ordenadas por el <strong>${totalCostLabel.toLowerCase()}</strong>: la suma de tus facturas mensuales ${totalCostNote}.
            ${hasIndexedTariffs && indexedTraceMode === 'hourly-index-base' ? '<br><br><strong>Indexadas:</strong> se han calculado con tu CSV horario según el índice base disponible.' : ''}
            ${indexedFallbackMsg ? '<br><br><strong>Indexadas:</strong> ' + indexedFallbackMsg : ''}
            ${invalidRankingMsg}
            <br><br><strong>Batería virtual:</strong> el simulador modela una BV amplia: el excedente sobrante se acumula en euros y se aplica a facturas posteriores, sin caducidad. Las condiciones reales (caducidad del saldo, qué parte de la factura cubre) varían según cada comercializadora.
            ${mesInicioNote}
            ${saldoInicialNote}
          </div>
        </div>
      `;
      // Ultima comprobacion antes de publicar el resultado: se reusa staleAtThisPoint (ver
      // mas arriba, justo tras el ultimo await posible) en vez de volver a llamar a
      // isCalcResultStale() aqui — entre aquel punto y este no hay ningun await, asi que el
      // resultado de la comprobacion sigue siendo valido y no hace falta repetirla.
      if (staleAtThisPoint) { renderStaleWarning(); return; }

      resultsEl.innerHTML = `<h2 style="text-align:center; font-size:1.8rem; font-weight:900; margin-bottom:2rem; color:var(--text);">Resultados de la Simulación</h2>${consumoLimitsMsg}${rankingNote}${winnerHTML}<h3 style="text-align:center; margin-bottom: 24px; margin-top: 40px; color:var(--text);">Ranking completo (${totalTarifasLabel})</h3>${alternativesHTML}`;
      focusConsumoEstimateToggle();
      resultsEl.querySelectorAll('.bv-alt-btn-toggle').forEach((button) => {
        button.addEventListener('click', () => {
          const card = button.closest('.bv-alt-card-compact');
          const details = card?.querySelector('details');
          if (!details) return;
          details.toggleAttribute('open');
          button.classList.toggle('active');
          button.setAttribute('aria-expanded', String(details.open));
        });
      });
      const renderGeneration = ++resultRenderGeneration;
      resultsContainer.style.display = 'block';
      setTimeout(() => {
        if (renderGeneration !== resultRenderGeneration) return;
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
