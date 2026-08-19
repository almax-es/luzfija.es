/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: App Coordinator =====
// Este archivo coordina la inicialización de todos los módulos
// Los módulos deben cargarse ANTES de este archivo en el siguiente orden:
// 1. js/lf-utils.js
// 2. js/lf-state.js
// 3. js/lf-ui.js
// 4. js/lf-tooltips.js
// 5. js/lf-cache.js
// 6. js/lf-inputs.js
// 7. js/lf-calc.js
// 8. js/lf-render.js
// 9. js/lf-csv-import.js
// 10. js/lf-tarifa-custom.js
// 11. pvpc.js (existente)
// 12. app.js (este archivo)

(function() {
  'use strict';

  function showIncompleteApp() {
    const button = document.getElementById('btnCalc');
    const status = document.getElementById('statusText');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.title = 'La calculadora no terminó de cargarse; recarga la página.';
    }
    if (status) status.textContent = 'La calculadora no terminó de cargarse. Recarga la página.';

    // La telemetria va ANTES del aviso visual: es el escenario en que la UI esta
    // rota, asi que el diagnostico no puede depender de que la UI tenga exito.
    try {
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail('init-incompleto', ['home', 'app-core'], {
          title: 'Comparador principal con dependencias incompletas'
        });
      }
    } catch (_) {}

    try {
      if (window.LF && typeof window.LF.toast === 'function') {
        window.LF.toast('La calculadora no terminó de cargarse. Recarga la página para intentarlo de nuevo.', 'err');
      }
    } catch (_) {}
  }

  // Verificar que LF está disponible
  if (!window.LF) {
    console.error('[LuzFija] Error: módulos no cargados. Verifica el orden de scripts.');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showIncompleteApp);
    } else {
      showIncompleteApp();
    }
    return;
  }

  // lf-utils.js publica el logger global. Mantener un no-op local evita que un
  // fallo de carga parcial convierta un simple mensaje de diagnóstico en un
  // ReferenceError adicional que oculte la causa original.
  const lfDbg = typeof window.lfDbg === 'function' ? window.lfDbg : function () {};

  const {
    // State
    $, el, state, initElements,
    // Utils
    formatValueForDisplay,
    copyText, createRipple,
    // UI
    toast, setStatus, markPending,
    applyThemeClass, updateThemeIcon, toggleTheme,
    // Tooltips
    initTooltips,
    // Cache
    fetchTarifas,
    // Inputs
    getInputValues, signatureFromValues, validateInputs, 
    loadInputs, saveInputs,
    updateKwhHint, updateZonaFiscalUI, updateSolarUI,
    // Calc
    calculateLocal,
    // Render
    renderTable, updateSortIcons,
    // CSV
    initCSVImporter,
    // Tarifa custom
    updateMiTarifaForm, agregarMiTarifa,
    validateMiTarifa
  } = window.LF;

  const requiredAppFunctions = {
    $, initElements, formatValueForDisplay, copyText, createRipple,
    toast, setStatus, markPending, applyThemeClass, updateThemeIcon, toggleTheme,
    initTooltips, fetchTarifas, getInputValues, signatureFromValues, validateInputs,
    loadInputs, saveInputs, updateKwhHint, updateZonaFiscalUI, updateSolarUI,
    calculateLocal, renderTable, updateSortIcons, initCSVImporter,
    updateMiTarifaForm, agregarMiTarifa, validateMiTarifa
  };
  const appDependenciesReady = state && typeof state === 'object' && el && typeof el === 'object' &&
    Object.values(requiredAppFunctions).every((fn) => typeof fn === 'function');

  // ===== DEBOUNCE CALCULATION =====
  function scheduleCalculateDebounced() {
    // Invalidar INMEDIATAMENTE (sincronico, en el momento de la edicion): generation debe
    // reflejar el instante real del cambio, no cuando venza este debounce (200ms despues).
    // Si no fuera asi, un calculate() que arranca DENTRO de esos 200ms capturaria
    // startGeneration ANTES del bump y, cuando el debounce vence mientras el calculo sigue
    // en curso (con el propio cambio ya incluido en lo que se esta calculando), marcaria
    // "pendiente" un resultado que en realidad SI refleja ese cambio. El texto visual
    // ("Cambios pendientes"/"Corrige los datos") se sigue difiriendo 200ms para no parpadear
    // en cada tecla, pero el estado interno no puede esperar a eso.
    state.pending = true;
    state.generation = (state.generation || 0) + 1;

    clearTimeout(state.debounce);
    state.debounce = setTimeout(() => {
      const valid = validateInputs();
      if (!valid) {
        setStatus('Corrige los datos para calcular', 'err');
        if (window.LF.cancelRender) window.LF.cancelRender();
        return;
      }
      // Si "Comparar mi tarifa" está marcado y sus campos son inválidos,
      // el cálculo tampoco puede completarse con éxito.
      // marcarVacios: false → la sobre-la-marcha y el debounce NO pintan campos
      // vacíos (solo errores de formato/valor). El guard de calculate() (al
      // pulsar Calcular) es el único que usa marcarVacios: true (default) para
      // marcar también los vacíos.
      if (typeof validateMiTarifa === 'function' && !validateMiTarifa({ silent: true, marcarVacios: false })) {
        setStatus('Corrige los datos para calcular', 'err');
        if (window.LF.cancelRender) window.LF.cancelRender();
        return;
      }
      // El estado (pending + generation) ya se marco arriba, sincronico: aqui solo falta
      // el texto visual. No usar markPending() para no incrementar generation otra vez.
      setStatus('Cambios pendientes. Pulsa Calcular para actualizar.', 'idle');
    }, 200);
  }

  // ===== RUN CALCULATION =====
  function runCalculation(forceRefresh = false) {
    if (window.__LF_CALC_INFLIGHT) return;
    calculate(true, forceRefresh);
  }

  function dispatchResultsRequested() {
    try {
      document.dispatchEvent(new CustomEvent('lf:results-requested', {
        detail: { origin: 'home' }
      }));
    } catch (_) {}
  }

  // ===== AUTO-REFRESH TARIFAS (agresivo) =====
  const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 min
  const AUTO_REFRESH_THROTTLE_MS = 15 * 1000; // evitar doble disparo (focus+visible)
  let __lf_lastTarifasUpdatedAt = null;
  let __lf_lastTarifasCheck = 0;

  async function refreshTarifasAndMaybeRecalc(_reason) {
    // Un refresco silencioso no debe consumir red ni generar diagnóstico si la
    // pestaña está en segundo plano. Se retomará al volver a visible.
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - __lf_lastTarifasCheck < AUTO_REFRESH_THROTTLE_MS) return;
    __lf_lastTarifasCheck = now;

    const prev = __lf_lastTarifasUpdatedAt || window.LF.__LF_tarifasMeta?.updatedAt || null;
    const ok = await fetchTarifas(true, { silent: true, diagnosticReason: _reason });
    if (!ok) return;

    const curr = window.LF.__LF_tarifasMeta?.updatedAt || null;

    // Inicializar referencia sin notificar en la primera carga
    if (!__lf_lastTarifasUpdatedAt) {
      __lf_lastTarifasUpdatedAt = curr || prev;
      return;
    }

    if (curr && prev && curr !== prev) {
      __lf_lastTarifasUpdatedAt = curr;
      // Con cambios sin confirmar (state.pending), auto-recalcular aplicaria en silencio
      // una edicion que el usuario todavia no ha pedido calcular, rompiendo el contrato de
      // "Cambios pendientes. Pulsa Calcular". Las tarifas ya se han refrescado (fetchTarifas
      // de arriba), asi que cuando el usuario pulse Calcular usara igualmente el dataset
      // nuevo, sin perder el aviso.
      if (state.pending) {
        toast('Tarifas actualizadas. Pulsa "Calcular" para aplicarlas.', 'ok');
        return;
      }
      toast('Tarifas actualizadas. Recalculando…', 'ok');
      if ((state.rows && state.rows.length > 0) || state.lastSignature) {
        // Diferir recálculo a idle para no bloquear INP
        const _ricCalc = window.requestIdleCallback
          ? (cb) => requestIdleCallback(cb, { timeout: 3000 })
          : (cb) => setTimeout(cb, 200);
        let _recalcRetries = 0;
        const tryRecalc = () => {
          // Revalidar en CADA intento, no solo antes de programar el idle: el usuario
          // puede editar el formulario mientras este recalculo diferido sigue esperando su
          // turno (idle callback, o reintentos por __LF_CALC_INFLIGHT), y no volver a
          // comprobar aqui aplicaria esa edicion sin que el usuario pulsara Calcular.
          if (state.pending) {
            toast('Tarifas actualizadas. Pulsa "Calcular" para aplicarlas.', 'ok');
            return;
          }
          if (window.__LF_CALC_INFLIGHT) {
            if (++_recalcRetries < 10) {
              setTimeout(tryRecalc, 500);
            } else {
              toast('No se pudo recalcular automáticamente. Pulsa "Calcular" para actualizar.', 'err');
            }
            return;
          }
          runCalculation(true);
        };
        _ricCalc(tryRecalc);
      }
    }
  }

  function clearCsvCurveState() {
    if (typeof window.LF?.clearCsvImportState === 'function') {
      window.LF.clearCsvImportState();
    } else if (window.LF) {
      window.LF.consumosHorarios = null;
      window.LF.csvConsumosRef = null;
      window.LF.pvpcPeriodoCSV = false;
    }
  }

  function reconcileCsvCurveZone(values) {
    const records = window.LF?.consumosHorarios;
    if (!Array.isArray(records) || records.length === 0) return values;

    const assessment = window.LF?.assessCsvConsumosRef?.(values, window.LF.csvConsumosRef);
    if (!assessment) {
      clearCsvCurveState();
      return values;
    }
    if (assessment.matches) return values;

    // La edicion manual de dias o consumos conserva el contrato historico: invalida
    // silenciosamente la curva, porque el usuario ya sabe que ha cambiado los agregados.
    if (!assessment.aggregateMatches) {
      clearCsvCurveState();
      return values;
    }

    let nextValues = values;
    let periodsReclassified = false;
    if (!assessment.periodProfileMatches) {
      const reclassified = window.LF?.reclasificarConsumosHorarios?.(records, values.zonaFiscal);
      if (!reclassified?.ok) {
        clearCsvCurveState();
        toast('No se pudo adaptar el reparto P1/P2/P3 del CSV a la nueva zona. Reimporta el archivo.', 'err');
        return values;
      }
      window.LF.consumosHorarios = reclassified.records;
      if (el.inputs.cPunta) el.inputs.cPunta.value = reclassified.punta;
      if (el.inputs.cLlano) el.inputs.cLlano.value = reclassified.llano;
      if (el.inputs.cValle) el.inputs.cValle.value = reclassified.valle;
      updateKwhHint();
      nextValues = getInputValues();
      periodsReclassified = true;
    }

    const crossesClockProfile = !assessment.clockProfileMatches;
    const hasDstTransition = window.LF?.csvUtils?.hasDstTransitionRecords;
    const dstUnsafe = crossesClockProfile
      && (typeof hasDstTransition !== 'function' || hasDstTransition(records));
    if (dstUnsafe) {
      clearCsvCurveState();
      toast('El CSV contiene un cambio de hora que se numera de forma distinta en Canarias. Se mantienen los consumos por periodo, pero debes reimportarlo para volver a usar los precios horarios exactos.', 'err');
      return nextValues;
    }

    // La curva sigue siendo exacta: misma escala horaria, o cambio de reloj sin un dia DST.
    // Actualizar la referencia evita descartarla y mantiene activo el cruce horario de pvpc.js.
    window.LF.csvConsumosRef = window.LF.buildCsvConsumosRef(nextValues);
    if (periodsReclassified) {
      toast('Reparto P1/P2/P3 del CSV recalculado para la nueva zona.', 'ok');
    }
    return nextValues;
  }

  async function calculate(isUserAction, forceRefresh = false) {
    if (!validateInputs()) {
      setStatus('Corrige los datos para calcular', 'err');
      return;
    }
    if (typeof validateMiTarifa === 'function' && !validateMiTarifa({ silent: true })) {
      setStatus('Corrige los datos para calcular', 'err');
      return;
    }
    
    // Cancelar cualquier debounce pendiente: los cambios que lo programaron ya estan
    // incluidos en el snapshot que se captura a continuacion, asi que no debe quedar vivo
    // para pisar el status ("Calculando...") con "Cambios pendientes" mientras este mismo
    // calculo sigue en curso.
    clearTimeout(state.debounce);
    state.debounce = null;

    let values = getInputValues();
    const hasCsvCurve = Array.isArray(window.LF?.consumosHorarios) && window.LF.consumosHorarios.length > 0;
    if (hasCsvCurve) values = reconcileCsvCurveZone(values);
    const signature = signatureFromValues(values);
    // signatureFromValues() solo cubre los inputs "normales" (p1/p2/dias/consumos/zona/...):
    // no incluye "Mi tarifa" ni la identidad de la curva CSV, asi que compararla sola no
    // detecta una edicion de esos campos durante la espera. state.generation si los cubre,
    // porque se incrementa en markPending() y TODOS los caminos que invalidan el calculo
    // (inputs normales, "Mi tarifa" via scheduleCalculateDebounced en lf-tarifa-custom.js,
    // los inputs que acompañan a una nueva curva CSV) pasan por ahi.
    const startGeneration = state.generation || 0;

    if (window.__LF_CALC_INFLIGHT) return;
    window.__LF_CALC_INFLIGHT = true;
    
    try {
      saveInputs();
      setStatus('Calculando...', 'loading');

      const loaded = await fetchTarifas(forceRefresh, {
        silent: true,
        diagnosticReason: 'calculate'
      });
      if (!loaded) {
        const hasSessionTarifas = Array.isArray(window.LF.baseTarifasCache) &&
          window.LF.baseTarifasCache.length > 0;
        if (!hasSessionTarifas) {
          setStatus('Error conexión', 'err');
          toast('Error cargando tarifas desde el servidor.', 'err');
          return;
        }
        toast('Sin conexión con el servidor. Calculando con la última descarga de esta sesión.', 'err');
      }

      // PVPC (viene de pvpc.js)
      const pvpc = typeof crearTarifaPVPC === 'function' ? await crearTarifaPVPC(values) : null;
      const base = Array.isArray(window.LF.baseTarifasCache) ? window.LF.baseTarifasCache.slice() : [];

      // Añadir tarifa personalizada si está marcada
      const miTarifa = agregarMiTarifa();
      if (miTarifa) {
        base.unshift(miTarifa);
      }

      window.LF.cachedTarifas = pvpc ? [...base, pvpc] : base;
      if (!pvpc) window.pvpcLastMeta = null;

      // Yield al navegador antes de calcular
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => setTimeout(resolve, 0));
      
      await calculateLocal(values);
      state.lastSignature = signature;
      // Entre capturar `values` y llegar aqui ha habido varios `await` (red, PVPC, render
      // por chunks): si el usuario edito el formulario durante ese hueco, el resultado que
      // acaba de pintar renderAll() corresponde a los valores ANTERIORES, no a lo que el
      // formulario muestra ahora. Limpiar `pending` aqui borraria en silencio el aviso
      // "Cambios pendientes" que el propio edit ya habia activado, dejando en pantalla un
      // "Resultados actualizados" que no es cierto para el estado actual del formulario.
      if ((state.generation || 0) === startGeneration) {
        state.pending = false;
      } else {
        // markPending() ya se llamo cuando cambio (state.pending ya es true): se vuelve a
        // llamar para refrescar el texto de estado, que renderAll() acaba de pisar con
        // "Resultados actualizados".
        markPending();
      }
      
    } catch (err) {
      lfDbg('[ERROR]', err);
      setStatus('No se ha podido calcular. Inténtalo de nuevo.', 'err');
    } finally {
      window.__LF_CALC_INFLIGHT = false;
    }
  }

  // ===== MENU =====
  function getMenuItems() {
    if (!el.menuPanel) return [];
    return Array.from(el.menuPanel.querySelectorAll('[role="menuitem"]'));
  }

  function focusMenuItem(which) {
    const items = getMenuItems();
    if (!items.length) return;
    const idx = (which === 'last') ? (items.length - 1) : 0;
    try { items[idx].focus({ preventScroll: true }); } catch (e) { items[idx].focus(); }
  }

  function moveMenuFocus(dir) {
    const items = getMenuItems();
    if (!items.length) return;
    const active = document.activeElement;
    let i = items.indexOf(active);
    if (i < 0) i = 0;
    i = (i + dir + items.length) % items.length;
    try { items[i].focus({ preventScroll: true }); } catch (e) { items[i].focus(); }
  }

  function toggleMenu(force, opts) {
    const options = opts || {};
    const willOpen = (typeof force === 'boolean') ? force : !el.menuPanel.classList.contains('show');
    el.menuPanel.classList.toggle('show', willOpen);
    el.btnMenu.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    el.menuPanel.setAttribute('aria-hidden', willOpen ? 'false' : 'true');

    if (willOpen) {
      if (options.focus === 'first') focusMenuItem('first');
      if (options.focus === 'last') focusMenuItem('last');
    } else {
      if (options.returnFocus) {
        try { el.btnMenu.focus({ preventScroll: true }); } catch (e) { el.btnMenu.focus(); }
      }
    }
    return willOpen;
  }

  // ===== DOM READY =====
  document.addEventListener('DOMContentLoaded', async () => {
    if (!appDependenciesReady) {
      showIncompleteApp();
      return;
    }
    // Inicializar referencias DOM
    initElements();
    
    // Ahora que el DOM está listo, obtener referencias actualizadas
    const currentEl = window.LF.el;
    
    initTooltips();
    if (typeof window.LF.initMiTarifaChip === 'function') window.LF.initMiTarifaChip();
    applyThemeClass(document.documentElement.classList.contains('light-mode') ? 'light' : 'dark');
    updateThemeIcon();
    loadInputs();
    updateSolarUI();

    validateInputs();
    markPending('Introduce los datos de tu factura');

    // Event listeners para inputs
    Object.values(currentEl.inputs).forEach(i => {
      if (!i) return;
      i.addEventListener('input', () => {
        updateKwhHint();
        scheduleCalculateDebounced();
      });

      // Normalizar formato decimal al salir del campo
      if (['p1', 'p2', 'cPunta', 'cLlano', 'cValle', 'exTotal', 'bvSaldo'].includes(i.id)) {
        i.addEventListener('blur', () => {
          if (i.value) {
            i.value = formatValueForDisplay(i.value);
          }
        });
      }
    });

    if (currentEl.inputs.zonaFiscal) {
      currentEl.inputs.zonaFiscal.addEventListener('change', () => {
        updateZonaFiscalUI();
        scheduleCalculateDebounced();
      });
    }
    
    if (currentEl.inputs.viviendaCanarias) {
      currentEl.inputs.viviendaCanarias.addEventListener('change', () => {
        scheduleCalculateDebounced();
      });
    }
    
    if (currentEl.inputs.solarOn) {
      currentEl.inputs.solarOn.addEventListener('change', () => {
        updateSolarUI();
        scheduleCalculateDebounced();
      });
    }

    document.querySelectorAll('input[name="bonoSocialTipo"], input[name="bonoSocialLimite"]').forEach(input => {
      input.addEventListener('change', () => {
        saveInputs();
        scheduleCalculateDebounced();
      });
    });

    // Theme button
    if (currentEl.btnTheme) {
      currentEl.btnTheme.addEventListener('click', (e) => {
        createRipple(currentEl.btnTheme, e);
        toggleTheme();
      });
    }

    // Filter buttons
    document.querySelectorAll('.fbtn').forEach(b => {
      // Estado inicial accesible
      b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');

      b.addEventListener('click', (e) => {
        createRipple(b, e);
        document.querySelectorAll('.fbtn').forEach(x => {
          x.classList.remove('active');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
        state.filter = b.getAttribute('data-filter');
        // Defer render to next task — lets browser paint button state first (INP)
        setTimeout(() => renderTable(), 0);
      });
    });

    // Sort buttons
    document.querySelectorAll('thead .sort-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const th = btn.closest('th');
        const k = th?.getAttribute('data-sort');
        if (!k) return;
        if (state.sort.key === k) state.sort.dir = (state.sort.dir === 'asc') ? 'desc' : 'asc';
        else { state.sort.key = k; state.sort.dir = 'asc'; }
        updateSortIcons(); // Show sort direction immediately (lightweight)
        // Defer heavy table re-render to next task (INP)
        setTimeout(() => renderTable(), 0);
      });
    });

    // Calculate button
    currentEl.btnCalc.addEventListener('click', (e) => {
      createRipple(currentEl.btnCalc, e);
      dispatchResultsRequested();
      // Si el cálculo viene de un CSV ya aplicado, hay que preservar la curva horaria.
      runCalculation(false);
    });

    document.addEventListener('lf:annual-consumption-estimate-change', (event) => {
      state.useAnnualConsumptionEstimate = Boolean(event?.detail?.enabled);
      state.annualConsumptionEstimateBasis = null;
      state.focusAnnualConsumptionEstimateToggle = true;
      // 15/08/2026, residual detectado por ChatGPT (novena ronda, 4a revision): este toggle
      // muta state directamente (no un input con su propio listener), asi que sin este bump
      // explicito state.generation no se enteraba del cambio. Si ya habia un calculo en vuelo,
      // el nuevo runCalculation() de abajo se descarta por __LF_CALC_INFLIGHT, y el calculo
      // viejo terminaba sin detectar que el filtrado por limite anual acababa de cambiar.
      markPending();
      dispatchResultsRequested();
      runCalculation(false);
    });

    // Enter en cualquier input → Calcular
    Object.values(currentEl.inputs).forEach(input => {
      if (!input) return;
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          dispatchResultsRequested();
          createRipple(currentEl.btnCalc, {
            clientX: currentEl.btnCalc.offsetLeft + currentEl.btnCalc.offsetWidth / 2,
            clientY: currentEl.btnCalc.offsetTop + currentEl.btnCalc.offsetHeight / 2
          });
          runCalculation(true);
        }
      });
    });

    // Menu
    currentEl.btnMenu.addEventListener('click', (e) => {
      createRipple(currentEl.btnMenu, e);
      e.stopPropagation();
      const opened = toggleMenu();
      if (opened && e.detail === 0) {
        focusMenuItem('first');
      }
    });

    currentEl.btnMenu.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const wantLast = (e.key === 'ArrowUp');
        toggleMenu(true, { focus: wantLast ? 'last' : 'first' });
      } else if (e.key === 'Escape') {
        if (currentEl.menuPanel.classList.contains('show')) {
          e.preventDefault();
          toggleMenu(false, { returnFocus: true });
        }
      }
    });

    currentEl.menuPanel.addEventListener('keydown', (e) => {
      if (!currentEl.menuPanel.classList.contains('show')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMenuFocus(+1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveMenuFocus(-1); }
      else if (e.key === 'Home') { e.preventDefault(); focusMenuItem('first'); }
      else if (e.key === 'End') { e.preventDefault(); focusMenuItem('last'); }
      else if (e.key === 'Escape') { e.preventDefault(); toggleMenu(false, { returnFocus: true }); }
      else if (e.key === 'Tab') { toggleMenu(false); }
    });

    // Cerrar menú si foco sale del contenedor
    if (currentEl.menuRoot) {
      currentEl.menuRoot.addEventListener('focusout', () => {
        if (!currentEl.menuPanel.classList.contains('show')) return;
        setTimeout(() => {
          if (!currentEl.menuRoot.contains(document.activeElement)) {
            toggleMenu(false);
          }
        }, 0);
      });
    }

    currentEl.menuPanel.addEventListener('click', (e) => e.stopPropagation());
    currentEl.menuPanel.addEventListener('click', (e) => {
      const item = e.target && e.target.closest ? e.target.closest('[role="menuitem"]') : null;
      if (item) toggleMenu(false);
    });
    
    document.addEventListener('click', () => toggleMenu(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && currentEl.menuPanel.classList.contains('show')) {
        const shouldReturnFocus = currentEl.menuRoot && currentEl.menuRoot.contains(document.activeElement);
        toggleMenu(false, { returnFocus: shouldReturnFocus });
      }
    });

    const shareDialog = $('shareConfigDialog');
    const shareConsumptionInput = $('shareIncludeConsumption');
    const sharePrivateInput = $('shareIncludePrivate');
    const shareScope = $('shareConfigScope');
    const shareCancel = $('shareConfigCancel');
    const shareConfirm = $('shareConfigConfirm');
    const shareResultsButton = $('shareResults');
    const shareResultsWrap = $('shareResultsWrap');
    let shareLastFocusedEl = null;

    function shareScopeSegment(options) {
      if (options.includeConsumption && options.includePrivate) return 'completo';
      if (options.includeConsumption) return 'consumo';
      if (options.includePrivate) return 'privado';
      return 'minimo';
    }

    function trackShareEvent(eventName, options) {
      try {
        if (typeof window.__LF_trackDetail !== 'function') return;
        const detail = ['home'];
        if (options) detail.push(shareScopeSegment(options));
        window.__LF_trackDetail(eventName, detail, {
          title: eventName === 'url-compartida'
            ? 'Enlace compartido: home'
            : 'Diálogo de compartir abierto: home'
        });
      } catch (_) {}
    }

    function getShareOptions() {
      return {
        includeConsumption: Boolean(shareConsumptionInput?.checked),
        includePrivate: Boolean(sharePrivateInput?.checked)
      };
    }

    function getShareDisclosure(options) {
      const included = ['ajustes generales del comparador'];
      if (options.includeConsumption) included.push('consumo, excedentes y días');
      if (options.includePrivate) included.push('saldo BV y bono social');
      return `Incluye ${included.join(', ')}.`;
    }

    function updateShareScope() {
      if (shareScope) shareScope.textContent = getShareDisclosure(getShareOptions());
    }

    function closeShareDialog({ returnFocus = true } = {}) {
      if (!shareDialog || shareDialog.hidden) return;
      shareDialog.hidden = true;
      shareDialog.classList.remove('show');
      shareDialog.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lf-share-open');
      if (returnFocus && shareLastFocusedEl && typeof shareLastFocusedEl.focus === 'function') {
        try { shareLastFocusedEl.focus(); } catch {}
      }
      shareLastFocusedEl = null;
    }

    async function shareConfiguration(options) {
      const all = saveInputs();
      const data = {
        p1: all.p1,
        p2: all.p2,
        zonaFiscal: all.zonaFiscal,
        viviendaCanarias: all.viviendaCanarias,
        solarOn: all.solarOn
      };
      if (options.includeConsumption) {
        Object.assign(data, {
          dias: all.dias,
          cPunta: all.cPunta,
          cLlano: all.cLlano,
          cValle: all.cValle,
          exTotal: all.exTotal
        });
      }
      if (options.includePrivate) {
        Object.assign(data, {
          bvSaldo: all.bvSaldo,
          bonoSocialOn: all.bonoSocialOn,
          bonoSocialTipo: all.bonoSocialTipo,
          bonoSocialLimite: all.bonoSocialLimite
        });
      }
      const url = `${window.location.origin}${window.location.pathname}?${new URLSearchParams(data)}`;
      const disclosure = getShareDisclosure(options);

      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Mi configuración - LuzFija.es',
            text: disclosure,
            url
          });
          trackShareEvent('url-compartida', options);
          toast('Configuración compartida');
          return true;
        } catch (err) {
          if (err?.name === 'AbortError') return false;
          lfDbg('[WARN] Error al compartir:', err);
        }
      }

      const copied = await copyText(url);
      if (!copied) {
        toast('No se pudo copiar el enlace. Inténtalo de nuevo.', 'err');
        return false;
      }
      trackShareEvent('url-compartida', options);
      toast(`Enlace copiado. ${disclosure}`);
      return true;
    }

    function openShareDialog() {
      trackShareEvent('compartir-abierto');
      if (!shareDialog) {
        shareConfiguration({ includeConsumption: false, includePrivate: false });
        return;
      }
      shareLastFocusedEl = document.activeElement;
      if (shareConsumptionInput) shareConsumptionInput.checked = false;
      if (sharePrivateInput) sharePrivateInput.checked = false;
      updateShareScope();
      shareDialog.hidden = false;
      shareDialog.classList.add('show');
      shareDialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('lf-share-open');
      setTimeout(() => shareCancel?.focus(), 0);
    }

    currentEl.btnShare.addEventListener('click', (e) => {
      createRipple(currentEl.btnShare, e);
      toggleMenu(false);
      openShareDialog();
    });
    shareResultsButton?.addEventListener('click', (e) => {
      createRipple(shareResultsButton, e);
      openShareDialog();
    });
    document.addEventListener('lf:results-ready', (e) => {
      if (e?.detail?.origin === 'home' && shareResultsWrap) shareResultsWrap.hidden = false;
    });
    shareConsumptionInput?.addEventListener('change', updateShareScope);
    sharePrivateInput?.addEventListener('change', updateShareScope);
    shareCancel?.addEventListener('click', () => closeShareDialog());
    shareConfirm?.addEventListener('click', async () => {
      const options = getShareOptions();
      closeShareDialog({ returnFocus: false });
      await shareConfiguration(options);
    });
    shareDialog?.addEventListener('click', (e) => {
      if (e.target === shareDialog) closeShareDialog();
    });
    document.addEventListener('keydown', (e) => {
      if (!shareDialog || shareDialog.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeShareDialog();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(shareDialog.querySelectorAll('input:not([disabled]), button:not([disabled])'));
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

    // Clear cache
    currentEl.btnClearCache?.addEventListener('click', async (e) => {
      createRipple(currentEl.btnClearCache, e);
      toggleMenu(false);

      if (!confirm('¿Limpiar toda la caché? Esto forzará la recarga de todos los recursos.')) {
        return;
      }

      try {
        toast('Limpiando caché...', 'info');

        try {
          // "Limpiar cache" NO es un reset total: solo debe borrar cache tecnica
          // (pvpc_cache_v3:*), nunca configuracion ni datos guardados por el usuario
          // (Mi tarifa, escenario solar, tema, inputs de la home). Para eso ya existen
          // botones separados ("Limpiar datos guardados", "Borrar") que si avisan de
          // perdida de datos.
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('pvpc_cache_v3:')) keysToRemove.push(key);
          }
          keysToRemove.forEach((key) => localStorage.removeItem(key));
          lfDbg('[CACHE] localStorage: cache PVPC limpiada (' + keysToRemove.length + ' claves)');
        } catch (e) {}
        try { sessionStorage.clear(); lfDbg('[CACHE] sessionStorage limpiado'); } catch (e) {}

        if ('serviceWorker' in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
              await registration.unregister();
              lfDbg('[CACHE] Service Worker desregistrado');
            }

            if ('caches' in window) {
              const cacheNames = await caches.keys();
              await Promise.all(cacheNames.map(name => caches.delete(name)));
              lfDbg('[CACHE] Cachés del SW limpiadas:', cacheNames.length);
            }
          } catch (e) {
            lfDbg('[WARN] Error limpiando Service Worker:', e);
          }
        }

        toast('✅ Caché limpiada. Recargando...', 'info');
        setTimeout(() => { window.location.reload(true); }, 1000);
      } catch (error) {
        toast('Error al limpiar caché', 'err');
        lfDbg('[ERROR] Error limpiando caché:', error);
      }
    });

    // Factura parser (si existe)
    if (typeof window.__LF_bindFacturaParser === 'function') {
      window.__LF_bindFacturaParser();
    }

    // CSV Importer
    try {
      initCSVImporter();
    } catch (e) {
      lfDbg('[ERROR] Error inicializando CSV importer:', e);
    }

    // Scroll to results
    $('scrollToResults')?.addEventListener('click', () => {
      $('heroKpis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Tarifa personalizada
    $('compararMiTarifa')?.addEventListener('change', (e) => {
      const form = $('miTarifaForm');
      if (!form) return;
      form.style.display = e.target.checked ? 'block' : 'none';
      if (e.target.checked) updateMiTarifaForm();
      // Al marcar/desmarcar, limpiar/validar errores de "Mi tarifa" y recalcular
      // el estado del botón. marcarVacios: false evita el flash rojo de campos
      // vacíos al abrir el formulario; el guard de calculate() sí los marcará.
      if (typeof validateMiTarifa === 'function') validateMiTarifa({ silent: true, marcarVacios: false });
      scheduleCalculateDebounced();
    });

    $('solarOn')?.addEventListener('change', () => {
      if ($('compararMiTarifa')?.checked) updateMiTarifaForm();
    });

    // Al entrar, descargar siempre tarifas desde red (sin caché)
    fetchTarifas(true, { silent: true, diagnosticReason: 'startup' })
      .then((ok) => {
        if (ok) {
          __lf_lastTarifasUpdatedAt = window.LF.__LF_tarifasMeta?.updatedAt || null;
        }
      })
      .catch(() => {});

    // Auto-refresh: al volver al foco/visibilidad y cada 15 minutos
    // Diferido con requestIdleCallback para no bloquear INP
    const _ric = window.requestIdleCallback
      ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 150);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        _ric(() => refreshTarifasAndMaybeRecalc('visible'));
      }
    });
    window.addEventListener('focus', () => _ric(() => refreshTarifasAndMaybeRecalc('focus')));
    window.addEventListener('online', () => refreshTarifasAndMaybeRecalc('online'));

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if ((!state.rows || state.rows.length === 0) && !state.lastSignature) return;
      _ric(() => refreshTarifasAndMaybeRecalc('interval'));
    }, AUTO_REFRESH_MS);
  });

  // ===== LIMPIEZA DE SW PROBLEMÁTICOS =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        if (!registration.active || registration.active.scriptURL.includes('Unknown')) {
          registration.unregister();
        }
      });
    }).catch(() => {});
  }

  // ===== PWA SERVICE WORKER =====
  // Registro + auto-update + guard de recarga: lógica compartida con
  // shell-lite.js, extraída a js/lf-sw-update.js (cargado antes en index.html).
  if (window.LF && typeof window.LF.initSwUpdate === 'function') {
    window.LF.initSwUpdate({ swUrl: 'sw.js', dbg: lfDbg });
  }

  // ===== PWA INSTALL =====
  let __lf_deferredInstallPrompt = null;
  let __lf_installButton = null;

  document.addEventListener('DOMContentLoaded', function() {
    __lf_installButton = document.querySelector('[data-install-pwa]');
    if (!__lf_installButton) return;

    __lf_installButton.style.display = 'none';

    __lf_installButton.addEventListener('click', function() {
      if (__lf_deferredInstallPrompt) {
        try {
          __lf_deferredInstallPrompt.prompt();
          __lf_deferredInstallPrompt.userChoice.then(function(_choiceResult) {
            __lf_deferredInstallPrompt = null;
            __lf_installButton.style.display = 'none';
          }).catch(function(err) {
            lfDbg('[WARN] Error en userChoice:', err);
          });
        } catch (e) {
          lfDbg('[WARN] No se ha podido lanzar el prompt de instalación nativo:', e);
        }
        return;
      }

      var ua = navigator.userAgent || '';
      var installHint;
      if (/Android/i.test(ua)) {
        installHint = 'Para instalar LuzFija, abre el menú del navegador (⋮) y pulsa "Instalar app".';
      } else if (/iPhone|iPad|iPod/i.test(ua)) {
        installHint = 'Para instalar LuzFija, pulsa el botón de compartir y luego "Añadir a pantalla de inicio".';
      } else {
        installHint = 'Puedes instalar esta web como app usando la opción "Instalar" de tu navegador.';
      }
      if (typeof toast === 'function') toast(installHint, 'ok');
      else alert(installHint);
    });

    if (__lf_deferredInstallPrompt) {
      __lf_installButton.style.display = 'inline-flex';
    }
  });

  window.addEventListener('beforeinstallprompt', function(event) {
    __lf_deferredInstallPrompt = event;
    if (__lf_installButton) {
      __lf_installButton.style.display = 'inline-flex';
    }
  });

  // ===== EXPORT GLOBAL FUNCTIONS =====
  // Para compatibilidad con otros scripts (factura.js, desglose, etc.)
  window.runCalculation = runCalculation;
  window.calculate = calculate;
  window.scheduleCalculateDebounced = scheduleCalculateDebounced;
  window.toggleMenu = toggleMenu;

})();
