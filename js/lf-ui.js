/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: UI básica =====
// Toast, status, theme, errores

(function() {
  'use strict';

  const { el, state, THEME_KEY } = window.LF;

  // ===== TOAST =====
  // `el` lo puebla initElements() (lf-state.js). toast() puede invocarse antes de
  // ese init desde rutas de arranque degradado (showIncompleteApp en lf-app.js),
  // donde el.toastText todavia es null. Resolver aqui evita que el aviso de "la
  // pagina no cargo bien" muera con un TypeError propio.
  function resolveToastNodes() {
    const box = (el && el.toast) || document.getElementById('toast');
    const text = (el && el.toastText) || document.getElementById('toastText');
    const dot = (el && el.toastDot) || document.getElementById('toastDot');
    return { box, text, dot };
  }

  function toast(msg, mode = 'ok') {
    const { box, text, dot } = resolveToastNodes();
    if (!box || !text) return;

    text.textContent = msg;
    if (dot) {
      dot.classList.remove('ok', 'err');
      dot.classList.add(mode === 'err' ? 'err' : 'ok');
    }
    box.classList.add('show');
    clearTimeout(box._t);
    
    // Duración dinámica: 4s base + 1s por cada 30 caracteres, máx 15s
    const duration = Math.min(15000, 4000 + Math.floor((msg || '').length / 30) * 1000);
    box._t = setTimeout(() => box.classList.remove('show'), duration);
  }

  // ===== STATUS =====
  function applyButtonState(isLoading) {
    const disabled = isLoading || state.hasValidationError;
    el.btnCalc.disabled = disabled;
    if (isLoading) el.btnCalc.classList.add('calculating');
    else el.btnCalc.classList.remove('calculating');
  }

  function setStatus(text, mode = 'idle') {
    el.statusText.textContent = text;
    el.statusPill.classList.remove('loading', 'ok', 'err');
    if (mode === 'loading') el.statusPill.classList.add('loading');
    if (mode === 'ok') el.statusPill.classList.add('ok');
    if (mode === 'err') el.statusPill.classList.add('err');
    
    // Limpiar animación cuando no está cargando
    if (mode !== 'loading' && el.btnCalc) {
      el.btnCalc.classList.remove('calculating');
      el.btnCalc.style.setProperty('--progress-width', '0%');
    }
    
    const l = mode === 'loading';
    applyButtonState(l);
    el.btnText.style.display = l ? 'none' : 'flex';
    el.btnSpinner.style.display = l ? 'flex' : 'none';
  }

  function markPending(message = 'Cambios pendientes. Pulsa Calcular para actualizar.') {
    state.pending = true;
    setStatus(message, 'idle');
  }

  // ===== ERRORES =====
  function showError(msg = '') {
    if (!el.errorBox) return;
    el.errorText.textContent = msg;
    el.errorBox.classList.toggle('show', Boolean(msg));
  }

  function clearErrorStyles() {
    const errorDescId = 'errorText';
    Object.values(el.inputs).forEach(i => {
      if (!i) return;
      i.classList.remove('error');
      i.removeAttribute('aria-invalid');
      // Limpiar aria-describedby del error si estaba presente
      const desc = (i.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      const next = desc.filter(id => id !== errorDescId);
      if (next.length) {
        i.setAttribute('aria-describedby', next.join(' '));
      } else {
        i.removeAttribute('aria-describedby');
      }
    });
  }

  // ===== THEME =====
  function applyThemeClass(theme) {
    const isLight = theme === 'light';
    document.documentElement.classList.toggle('light-mode', isLight);
    if (document.body) document.body.classList.toggle('light-mode', isLight);
  }

  function updateThemeIcon() {
    if (!el.btnTheme) return;
    // Usar icono universal día/noche para evitar confusión con el botón de tarifas solares
    el.btnTheme.textContent = '🌓';

    // Actualizar title y aria-label para indicar la acción que se realizará
    const isLight = document.documentElement.classList.contains('light-mode');
    const actionText = isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
    el.btnTheme.setAttribute('title', actionText);
    el.btnTheme.setAttribute('aria-label', actionText);
    // Estado accesible del toggle (pressed = tema oscuro activo)
    el.btnTheme.setAttribute('aria-pressed', isLight ? 'false' : 'true');
  }

  function toggleTheme() {
    const isLight = document.documentElement.classList.contains('light-mode');
    const next = isLight ? 'dark' : 'light';
    applyThemeClass(next === 'light' ? 'light' : 'dark');
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
    updateThemeIcon();
    toast(next === 'light' ? 'Modo claro' : 'Modo oscuro');
  }

  // Aplicar tema inicial
  const initialTheme = (window.__ALMAX_THEME_SAVED === 'light') ? 'light' : 'dark';
  applyThemeClass(initialTheme);

  // ===== HIDE RESULTS =====
  function hideResultsToInitialState() {
    const fades = document.querySelectorAll('.fade-container');
    if (fades.length) {
      fades.forEach(c => c.classList.remove('show'));
    }
    
    ['heroKpis', 'statsBar', 'chartTop', 'toolbar', 'table', 'emptyBox'].forEach(id => {
      const block = document.getElementById(id);
      if (block) block.classList.remove('show');
    });
    
    if (el.heroKpis) el.heroKpis.classList.remove('show');
    if (el.statsBar) el.statsBar.classList.remove('show');
    if (el.table) el.table.classList.remove('show');
    if (el.toolbar) el.toolbar.classList.remove('show');
    
    if (el.chartTop) {
      el.chartTop.classList.remove('show');
      el.chartTop.style.display = 'none';
    }
    
    const chartBody = document.getElementById('chartTopBody');
    if (chartBody) {
      chartBody.innerHTML = '';
    }
    
    document.querySelectorAll('.chartTop-barFill, .chartTop-barTrack, .chartTop-row').forEach(node => node.remove());
    
    if (el.tbody) el.tbody.replaceChildren();
    if (el.emptyBox) el.emptyBox.classList.remove('show');
    if (el.pvpcInfo) el.pvpcInfo.innerHTML = '';
    
    const seoFold = document.getElementById('info');
    if (seoFold) seoFold.classList.remove('show');
    
    state.rows = [];
    state.lastSignature = null;
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    toast,
    applyButtonState,
    setStatus,
    markPending,
    showError,
    clearErrorStyles,
    applyThemeClass,
    updateThemeIcon,
    toggleTheme,
    hideResultsToInitialState
  });

  // Compatibilidad con código existente
  window.toast = toast;
  window.setStatus = setStatus;
  window.markPending = markPending;
  window.showError = showError;
  window.hideResultsToInitialState = hideResultsToInitialState;

})();
