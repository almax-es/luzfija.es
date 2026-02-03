// ===== LuzFija: Inputs - validación, load/save =====

(function() {
  'use strict';

  const { 
    el, state, DEFAULTS, SERVER_PARAMS, LS_KEY,
    parseNum, clampNonNeg, clamp01to365Days, round2, asBool, formatValueForDisplay,
    showError, clearErrorStyles, applyButtonState, markPending, toast
  } = window.LF;

  // ===== CONTEXTO FISCAL =====
  function __LF_getFiscalContext(values) {
    const v = values || getInputValues();
    const zonaRaw = (v?.zonaFiscal || '').toLowerCase();
    const zona = zonaRaw === 'canarias' ? 'canarias' 
               : zonaRaw === 'ceutamelilla' ? 'ceutamelilla' 
               : 'península';
    const p1Num = clampNonNeg(parseNum(v?.p1));
    const p2Num = clampNonNeg(parseNum(v?.p2));
    const potenciaContratada = Math.max(p1Num || 0, p2Num || 0);
    const esCanarias = (zona === 'canarias');
    const esCeutaMelilla = (zona === 'ceutamelilla');
    const viviendaMarcada = Boolean(v?.viviendaCanarias);
    // Solo Canarias tiene distinción vivienda/otros para IGIC 0%
    const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
    const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';

    return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal, esCanarias, esCeutaMelilla };
  }

  // ===== GET INPUT VALUES =====
  function getInputValues() {
    const p1 = clampNonNeg(parseNum(el.inputs.p1.value));
    const p2 = clampNonNeg(parseNum(el.inputs.p2.value));
    const dias = clamp01to365Days(parseNum(el.inputs.dias.value));
    const cPunta = clampNonNeg(parseNum(el.inputs.cPunta.value));
    const cLlano = clampNonNeg(parseNum(el.inputs.cLlano.value));
    const cValle = clampNonNeg(parseNum(el.inputs.cValle.value));
    const zonaRaw = el.inputs.zonaFiscal?.value || 'Península';
    const zonaFiscal = zonaRaw === 'Canarias' ? 'Canarias'
                     : zonaRaw === 'CeutaMelilla' ? 'CeutaMelilla'
                     : 'Península';
    const viviendaCanarias = Boolean(el.inputs.viviendaCanarias?.checked);
    const solarOn = Boolean(el.inputs.solarOn?.checked);
    const exTotal = clampNonNeg(parseNum(el.inputs.exTotal?.value));
    const bvSaldo = clampNonNeg(parseNum(el.inputs.bvSaldo?.value));
    const bonoSocialOn = Boolean(el.inputs.bonoSocialOn?.checked);
    const bonoSocialTipo = document.querySelector('input[name="bonoSocialTipo"]:checked')?.value || 'vulnerable';
    const bonoSocialLimite = clampNonNeg(parseNum(document.querySelector('input[name="bonoSocialLimite"]:checked')?.value || '1587'));
    return { p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias, solarOn, exTotal, bvSaldo, bonoSocialOn, bonoSocialTipo, bonoSocialLimite };
  }

  // ===== SIGNATURE =====
  function signatureFromValues(v) {
    return [v.p1, v.p2, v.dias, v.cPunta, v.cLlano, v.cValle, v.zonaFiscal,
            v.viviendaCanarias ? '1' : '0', v.solarOn ? '1' : '0', v.exTotal, v.bvSaldo,
            v.bonoSocialOn ? '1' : '0', v.bonoSocialTipo, v.bonoSocialLimite].join('|');
  }

  // ===== MIGRACIÓN EXCEDENTES =====
  function migrateExcedentes(data) {
    if (!data || typeof data !== 'object') return data;
    const hasExTotal = data.exTotal !== undefined && data.exTotal !== null && data.exTotal !== '';
    const exP = data.exPunta, exL = data.exLlano, exV = data.exValle;
    if (!hasExTotal && (exP !== undefined || exL !== undefined || exV !== undefined)) {
      const sum = round2(clampNonNeg(parseNum(exP)) + clampNonNeg(parseNum(exL)) + clampNonNeg(parseNum(exV)));
      data.exTotal = String(sum);
    }
    return data;
  }

  // ===== UPDATE UI HELPERS =====
  function updateZonaFiscalUI() {
    const zonaRaw = el.inputs.zonaFiscal?.value || 'Península';
    const isCanarias = zonaRaw === 'Canarias';
    // El checkbox de vivienda solo aplica a Canarias (IGIC 0% vivienda ≤10kW)
    // En Ceuta/Melilla el IPSI es igual para todos (1%)
    if (el.viviendaGroup) {
      el.viviendaGroup.style.display = isCanarias ? 'flex' : 'none';
    }
  }

  function updateKwhHint() {
    const v = getInputValues();
    const t = v.cPunta + v.cLlano + v.cValle;
    const ex = v.exTotal;
    const tStr = t.toFixed(2).replace('.', ',');
    const exStr = ex.toFixed(2).replace('.', ',');
    if (v.solarOn) {
      el.kwhHint.innerHTML = `
        <div class="kwh-split">
          <div class="kwh-pill">
            <span class="kwh-label">Red</span>
            <span class="kwh-value">${tStr}</span>
            <span class="kwh-unit">kWh</span>
          </div>
          <div class="kwh-pill">
            <span class="kwh-label">Exced.</span>
            <span class="kwh-value">${exStr}</span>
            <span class="kwh-unit">kWh</span>
          </div>
        </div>`;
    } else {
      el.kwhHint.textContent = `${tStr} kWh`;
    }
  }

  function updateSolarUI() {
    const box = document.getElementById('solarFields');
    if (!box) return;
    const on = Boolean(el.inputs.solarOn?.checked);
    box.style.display = on ? '' : 'none';

    // Inicializar modal solar info cuando se muestra por primera vez
    if (on && !window.__solarInfoInitialized) {
      window.__solarInfoInitialized = true;
      initSolarInfoModal();
    }
  }

  function updateBonoSocialUI() {
    const box = document.getElementById('bonoSocialFields');
    if (!box) return;
    const on = Boolean(el.inputs.bonoSocialOn?.checked);
    box.style.display = on ? '' : 'none';
  }

  function initSolarInfoModal() {
    const modalSolarInfo = window.LF.$('modalSolarInfo');
    const btnSolarInfo = window.LF.$('btnSolarInfo');
    const btnCerrarSolarInfo = window.LF.$('btnCerrarSolarInfo');
    const btnCerrarSolarX = window.LF.$('btnCerrarSolarX');

    // Accesibilidad: restaurar foco + focus trap dentro del modal
    let __solarPrevFocusEl = null;
    let __solarFocusTrapCleanup = null;

    const __solarFocusableSelector = [
      'a[href]:not([tabindex="-1"])',
      'button:not([disabled]):not([tabindex="-1"])',
      'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
      'select:not([disabled]):not([tabindex="-1"])',
      'textarea:not([disabled]):not([tabindex="-1"])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    function __solarIsVisible(node){
      if (!node) return false;
      if (node.hasAttribute('disabled')) return false;
      if (node.getAttribute('aria-hidden') === 'true') return false;
      return !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
    }

    function __solarFocusables(){
      if (!modalSolarInfo) return [];
      return Array.from(modalSolarInfo.querySelectorAll(__solarFocusableSelector))
        .filter(__solarIsVisible);
    }

    function __solarFocusTrapAttach(){
      if (!modalSolarInfo) return;
      if (__solarFocusTrapCleanup) return;

      const onKeyDown = (e) => {
        if (!modalSolarInfo.classList.contains('show')) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          __solarClose();
          return;
        }

        if (e.key !== 'Tab') return;
        const els = __solarFocusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];

        // Si el foco está fuera del modal, lo metemos dentro
        if (!modalSolarInfo.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }

        if (e.shiftKey && document.activeElement === first){
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last){
          e.preventDefault();
          first.focus();
        }
      };

      modalSolarInfo.addEventListener('keydown', onKeyDown);
      __solarFocusTrapCleanup = () => {
        modalSolarInfo.removeEventListener('keydown', onKeyDown);
        __solarFocusTrapCleanup = null;
      };
    }

    function __solarFocusTrapDetach(){
      if (typeof __solarFocusTrapCleanup === 'function') __solarFocusTrapCleanup();
      __solarFocusTrapCleanup = null;
    }

    let __solarLocked = false;
    let __solarScrollY = 0;
    
    function __solarLock() {
      if (document.documentElement.style.overflow === 'hidden') return;
      __solarScrollY = window.scrollY || 0;
      document.documentElement.style.overflow = 'hidden';
      __solarLocked = true;
    }
    
    function __solarUnlock() {
      if (!__solarLocked) return;
      document.documentElement.style.overflow = '';
      window.scrollTo(0, __solarScrollY);
      __solarLocked = false;
    }

    function __solarClose(){
      if (!modalSolarInfo) return;
      modalSolarInfo.classList.remove('show');
      modalSolarInfo.setAttribute('aria-hidden', 'true');
      setTimeout(() => { modalSolarInfo.style.display = 'none'; }, 200);
      __solarUnlock();

      __solarFocusTrapDetach();
      const prev = __solarPrevFocusEl;
      if (prev && prev.focus) prev.focus();
      __solarPrevFocusEl = null;
    }

    if (btnSolarInfo && modalSolarInfo && btnCerrarSolarInfo) {
      btnSolarInfo.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        __solarPrevFocusEl = document.activeElement;

        modalSolarInfo.style.display = 'flex';
        modalSolarInfo.classList.add('show');
        modalSolarInfo.setAttribute('aria-hidden', 'false');
        __solarLock();

        __solarFocusTrapAttach();

        // Llevar foco dentro del modal (por defecto al botón de cerrar)
        const target = btnCerrarSolarX || btnCerrarSolarInfo || __solarFocusables()[0] || modalSolarInfo;
        setTimeout(() => { target?.focus?.(); }, 0);
      });

      btnCerrarSolarX?.addEventListener('click', __solarClose);

      btnCerrarSolarInfo.addEventListener('click', __solarClose);

      modalSolarInfo.addEventListener('click', (e) => {
        if (e.target === modalSolarInfo) {
          __solarClose();
        }
      });
    }
  }

  // ===== LOAD INPUTS =====
  function loadInputs() {
    const urlParams = new URLSearchParams(window.location.search);
    const isReset = urlParams.get('reset') === '1';

    if (isReset) {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      try { sessionStorage.removeItem(LS_KEY); } catch (e) {}
      window.history.replaceState({}, '', window.location.pathname);
      
      for (const k in DEFAULTS) {
        if (!el.inputs[k]) continue;
        if (el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(DEFAULTS[k], DEFAULTS[k]);
        else el.inputs[k].value = formatValueForDisplay(DEFAULTS[k]);
      }
      updateKwhHint();
      updateZonaFiscalUI();
      updateSolarUI();
      updateBonoSocialUI();
      return;
    }

    if (Object.keys(SERVER_PARAMS).length > 0) {
      const d = migrateExcedentes(Object.assign({}, DEFAULTS, SERVER_PARAMS));
      for (const k in DEFAULTS) {
        if (!el.inputs[k]) continue;
        if (el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(d[k], DEFAULTS[k]);
        else el.inputs[k].value = formatValueForDisplay(d[k]);
      }
      updateKwhHint();
      updateZonaFiscalUI();
      updateSolarUI();
      updateBonoSocialUI();
      return;
    }

    let savedData = {};
    try {
      const r = localStorage.getItem(LS_KEY);
      if (r) savedData = JSON.parse(r);
    } catch (e) {}
    
    savedData = migrateExcedentes(savedData);
    const finalData = migrateExcedentes({ ...DEFAULTS, ...savedData });
    
    for (const k in DEFAULTS) {
      if (!el.inputs[k]) continue;
      if (el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(finalData[k], DEFAULTS[k]);
      else el.inputs[k].value = formatValueForDisplay(finalData[k]);
    }

    updateKwhHint();
    updateZonaFiscalUI();
    updateSolarUI();
    updateBonoSocialUI();

    // Attach event listeners for toggles after inputs are loaded
    attachInputEventListeners();
  }

  // ===== ATTACH EVENT LISTENERS =====
  function attachInputEventListeners() {
    if (el.inputs.bonoSocialOn) {
      el.inputs.bonoSocialOn.addEventListener('change', () => {
        updateBonoSocialUI();
        saveInputs();
      });
    }
  }

  // ===== SAVE INPUTS =====
  function saveInputs() {
    const d = {};
    for (const k in DEFAULTS) {
      if (!el.inputs[k]) continue;
      d[k] = el.inputs[k].type === 'checkbox' ? Boolean(el.inputs[k].checked) : el.inputs[k].value;
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(d));
    } catch (e) {
      if (window.LF && typeof window.LF.toast === 'function') {
        window.LF.toast('No pude guardar tu configuración (espacio lleno o localStorage deshabilitado)', 'err');
      }
    }
    return d;
  }

  // ===== RESET INPUTS =====
  function resetInputs() {
    for (const k in DEFAULTS) {
      if (!el.inputs[k]) continue;
      if (el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(DEFAULTS[k], false);
      else el.inputs[k].value = formatValueForDisplay(DEFAULTS[k]);
    }
    saveInputs();
    updateKwhHint();
    updateZonaFiscalUI();
    updateSolarUI();
    updateBonoSocialUI();
    clearErrorStyles();
    validateInputs();
    markPending('Valores restablecidos. Pulsa Calcular para actualizar.');
    toast('Restablecido');
  }

  // ===== RESET TO FIRST LOAD =====
  function resetToFirstLoadState() {
    const form = document.querySelector('form');
    if (form) form.reset();
    else resetInputs();

    clearErrorStyles();
    showError('');
    updateKwhHint();
    updateZonaFiscalUI();
    updateSolarUI();
    updateBonoSocialUI();
    validateInputs();
    saveInputs();

    window.LF.hideResultsToInitialState();

    if (window.LF.initialStatusText) el.statusText.textContent = window.LF.initialStatusText;
    if (window.LF.initialStatusClass) el.statusPill.className = window.LF.initialStatusClass;

    applyButtonState(false);

    if (el.btnCalc) {
      el.btnCalc.classList.remove('calculating');
      void el.btnCalc.offsetWidth;
      el.btnCalc.style.setProperty('--progress-width', '0%');
    }

    state.pending = true;
    state.filter = 'all';
    
    document.querySelectorAll('.fbtn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-filter') === 'all');
    });
    
    state.sort = { key: 'totalNum', dir: 'asc' };
    if (typeof window.LF.updateSortIcons === 'function') window.LF.updateSortIcons();

    if (el.emptyBox) el.emptyBox.classList.remove('show');
    if (el.tbody) el.tbody.replaceChildren();
  }

  // ===== VALIDACIÓN =====
  function validateInputs() {
    clearErrorStyles();
    let message = '';
    const markInvalid = (input) => {
      if (!input) return;
      input.classList.add('error');
      input.setAttribute('aria-invalid', 'true');
      // Enlazar el mensaje de error para lectores de pantalla
      const errorDescId = 'errorText';
      const desc = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (!desc.includes(errorDescId)) {
        desc.push(errorDescId);
        input.setAttribute('aria-describedby', desc.join(' '));
      }
    };

    function esNumericoValido(str, maxDecimales = 2) {
      if (!str || !str.trim()) return false;
      const s = str.trim();
      
      if (/^[.,]|[.,]$/.test(s)) return false;
      if (s.length > 20) return false;
      
      if (/\s/.test(s)) {
        const partes = s.split(/[,.]/).filter(p => p.length > 0);
        if (partes.length === 0) return false;
        
        for (let i = 0; i < partes.length; i++) {
          const parte = partes[i];
          if (i === partes.length - 1 && /\s/.test(parte)) return false;
          if (i < partes.length - 1 && /\s/.test(parte)) {
            if (!/^\d{1,3}(\s\d{3})*$/.test(parte)) return false;
          }
        }
      }
      
      const numComas = (s.match(/,/g) || []).length;
      const numPuntos = (s.match(/\./g) || []).length;
      
      if (numComas > 1) return false;
      
      if (numComas === 1 && numPuntos > 0) {
        const partsComa = s.split(',');
        if (partsComa.length !== 2) return false;
        const antesDecimal = partsComa[0];
        const despuesDecimal = partsComa[1];
        if (despuesDecimal.includes('.') || despuesDecimal.includes(' ')) return false;
        if (despuesDecimal.length > maxDecimales) return false;
        const sinEspacios = antesDecimal.replace(/\s/g, '');
        if (!/^\d{1,3}(\.\d{3})*$/.test(sinEspacios) && !/^\d+$/.test(sinEspacios)) return false;
      } else if (numComas === 1) {
        const partsComa = s.split(',');
        if (partsComa.length === 2 && partsComa[1].length > maxDecimales) return false;
      }
      
      if (!/^[\d.,\s]+$/.test(s)) return false;
      
      const limpio = s.replace(/[\s.]/g, '').replace(',', '.');
      const num = parseFloat(limpio);
      if (!Number.isFinite(num)) return false;
      
      return true;
    }

    // Potencias P1 y P2
    const p1Raw = String(el.inputs.p1.value || '').trim();
    const p1Num = parseNum(el.inputs.p1.value);
    const p2Raw = String(el.inputs.p2.value || '').trim();
    const p2Num = parseNum(el.inputs.p2.value);

    if (!p1Raw) {
      message = 'Introduce la potencia P1 (punta).';
      markInvalid(el.inputs.p1);
    } else if (!esNumericoValido(p1Raw, 2)) {
      message = 'La potencia P1 debe ser un número válido.';
      markInvalid(el.inputs.p1);
    } else if (!Number.isFinite(p1Num) || p1Num <= 0) {
      message = 'La potencia P1 debe ser mayor que 0 kW.';
      markInvalid(el.inputs.p1);
    } else if (p1Num > 15) {
      message = 'La potencia P1 parece muy alta (máximo habitual: 15 kW).';
      markInvalid(el.inputs.p1);
    }

    if (!message && !p2Raw) {
      message = 'Introduce la potencia P2 (valle).';
      markInvalid(el.inputs.p2);
    } else if (!message && !esNumericoValido(p2Raw, 2)) {
      message = 'La potencia P2 debe ser un número válido.';
      markInvalid(el.inputs.p2);
    } else if (!message && (!Number.isFinite(p2Num) || p2Num <= 0)) {
      message = 'La potencia P2 debe ser mayor que 0 kW.';
      markInvalid(el.inputs.p2);
    } else if (!message && p2Num > 15) {
      message = 'La potencia P2 parece muy alta (máximo habitual: 15 kW).';
      markInvalid(el.inputs.p2);
    }

    // Días
    if (!message) {
      const diasRaw = String(el.inputs.dias.value || '').trim();
      const diasNum = parseNum(el.inputs.dias.value);
      if (!diasRaw) {
        message = 'Introduce los días de facturación (1-370).';
        markInvalid(el.inputs.dias);
      } else if (!esNumericoValido(diasRaw, 0)) {
        message = 'Los días deben ser un número válido (sin letras ni símbolos).';
        markInvalid(el.inputs.dias);
      } else if (!Number.isFinite(diasNum) || diasNum <= 0) {
        message = 'Los días deben ser mayores que 0.';
        markInvalid(el.inputs.dias);
      } else if (diasNum > 370) {
        message = 'Los días no pueden superar 370.';
        markInvalid(el.inputs.dias);
      } else if (diasNum % 1 !== 0) {
        message = 'Los días deben ser un número entero (sin decimales).';
        markInvalid(el.inputs.dias);
      }
    }

    // Consumos
    if (!message) {
      const cPuntaRaw = String(el.inputs.cPunta.value || '').trim();
      const cPuntaNum = parseNum(el.inputs.cPunta.value);
      const cLlanoRaw = String(el.inputs.cLlano.value || '').trim();
      const cLlanoNum = parseNum(el.inputs.cLlano.value);
      const cValleRaw = String(el.inputs.cValle.value || '').trim();
      const cValleNum = parseNum(el.inputs.cValle.value);

      if (!cPuntaRaw) {
        message = 'Introduce el consumo en punta.';
        markInvalid(el.inputs.cPunta);
      } else if (!esNumericoValido(cPuntaRaw, 2)) {
        message = 'El consumo en punta debe ser un número válido.';
        markInvalid(el.inputs.cPunta);
      } else if (!Number.isFinite(cPuntaNum) || cPuntaNum < 0) {
        message = 'El consumo en punta no puede ser negativo.';
        markInvalid(el.inputs.cPunta);
      }

      if (!message && !cLlanoRaw) {
        message = 'Introduce el consumo en llano.';
        markInvalid(el.inputs.cLlano);
      } else if (!message && !esNumericoValido(cLlanoRaw, 2)) {
        message = 'El consumo en llano debe ser un número válido.';
        markInvalid(el.inputs.cLlano);
      } else if (!message && (!Number.isFinite(cLlanoNum) || cLlanoNum < 0)) {
        message = 'El consumo en llano no puede ser negativo.';
        markInvalid(el.inputs.cLlano);
      }

      if (!message && !cValleRaw) {
        message = 'Introduce el consumo en valle.';
        markInvalid(el.inputs.cValle);
      } else if (!message && !esNumericoValido(cValleRaw, 2)) {
        message = 'El consumo en valle debe ser un número válido.';
        markInvalid(el.inputs.cValle);
      } else if (!message && (!Number.isFinite(cValleNum) || cValleNum < 0)) {
        message = 'El consumo en valle no puede ser negativo.';
        markInvalid(el.inputs.cValle);
      }

      if (!message && cPuntaNum === 0 && cLlanoNum === 0 && cValleNum === 0) {
        message = 'Debe haber consumo en al menos uno de los periodos.';
        markInvalid(el.inputs.cPunta);
        markInvalid(el.inputs.cLlano);
        markInvalid(el.inputs.cValle);
      }
    }

    // Solar
    if (!message && el.inputs.solarOn?.checked) {
      const exTotalRaw = String(el.inputs.exTotal.value || '').trim();
      const exTotalNum = parseNum(el.inputs.exTotal.value);
      const bvSaldoRaw = String(el.inputs.bvSaldo.value || '').trim();
      const bvSaldoNum = parseNum(el.inputs.bvSaldo.value);

      if (!exTotalRaw) {
        message = 'Introduce los excedentes del periodo (o 0 si no tienes).';
        markInvalid(el.inputs.exTotal);
      } else if (!esNumericoValido(exTotalRaw, 2)) {
        message = 'Los excedentes deben ser un número válido.';
        markInvalid(el.inputs.exTotal);
      } else if (!Number.isFinite(exTotalNum) || exTotalNum < 0) {
        message = 'Los excedentes no pueden ser negativos.';
        markInvalid(el.inputs.exTotal);
      }

      if (!message && !bvSaldoRaw) {
        message = 'Introduce el saldo de batería virtual (o 0 si no tienes).';
        markInvalid(el.inputs.bvSaldo);
      } else if (!message && !esNumericoValido(bvSaldoRaw, 2)) {
        message = 'El saldo de batería virtual debe ser un número válido.';
        markInvalid(el.inputs.bvSaldo);
      } else if (!message && !Number.isFinite(bvSaldoNum)) {
        message = 'El saldo de batería virtual debe ser un número válido.';
        markInvalid(el.inputs.bvSaldo);
      } else if (!message && bvSaldoNum < 0) {
        message = 'El saldo de batería virtual no puede ser negativo.';
        markInvalid(el.inputs.bvSaldo);
      }
    }

    state.hasValidationError = Boolean(message);
    if (message) showError(message);
    else showError('');
    applyButtonState(false);
    return !state.hasValidationError;
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    __LF_getFiscalContext,
    getInputValues,
    signatureFromValues,
    migrateExcedentes,
    updateZonaFiscalUI,
    updateKwhHint,
    updateSolarUI,
    updateBonoSocialUI,
    loadInputs,
    saveInputs,
    resetInputs,
    resetToFirstLoadState,
    validateInputs
  });

  // Compatibilidad
  window.__LF_getFiscalContext = __LF_getFiscalContext;
  window.getInputValues = getInputValues;
  window.updateKwhHint = updateKwhHint;
  window.validateInputs = validateInputs;
  window.saveInputs = saveInputs;
  window.loadInputs = loadInputs;
  window.updateBonoSocialUI = updateBonoSocialUI;
  window.attachInputEventListeners = attachInputEventListeners;

})();
