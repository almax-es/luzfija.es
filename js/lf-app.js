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

  // Verificar que LF está disponible
  if (!window.LF) {
    console.error('[LuzFija] Error: módulos no cargados. Verifica el orden de scripts.');
    return;
  }

  const {
    // State
    $, el, state, initElements, LS_KEY, DEFAULTS,
    // Utils
    parseNum, escapeHtml, formatMoney, formatValueForDisplay, 
    clampNonNeg, round2, asBool, copyText, createRipple,
    // UI
    toast, setStatus, markPending, showError, clearErrorStyles,
    applyThemeClass, updateThemeIcon, toggleTheme, hideResultsToInitialState,
    // Tooltips
    initTooltips, bindTooltipElement,
    // Cache
    fetchTarifas,
    // Inputs
    getInputValues, signatureFromValues, validateInputs, 
    loadInputs, saveInputs, resetInputs, resetToFirstLoadState,
    updateKwhHint, updateZonaFiscalUI, updateSolarUI,
    // Calc
    calculateLocal,
    // Render
    renderTable, renderAll, updateSortIcons,
    // CSV
    initCSVImporter,
    // Tarifa custom
    updateMiTarifaForm, agregarMiTarifa
  } = window.LF;

  // ===== DEBOUNCE CALCULATION =====
  function scheduleCalculateDebounced() {
    clearTimeout(state.debounce);
    state.debounce = setTimeout(() => {
      const valid = validateInputs();
      if (valid) markPending();
      else {
        setStatus('Corrige los datos para calcular', 'err');
        if (window.LF.cancelRender) window.LF.cancelRender();
      }
    }, 200);
  }

  // ===== RUN CALCULATION =====
  function runCalculation(forceRefresh = false) {
    if (window.__LF_CALC_INFLIGHT) return;
    calculate(true, forceRefresh);
  }

  // ===== AUTO-REFRESH TARIFAS (agresivo) =====
  const AUTO_REFRESH_MS = 2 * 60 * 1000; // 2 min
  const AUTO_REFRESH_THROTTLE_MS = 15 * 1000; // evitar doble disparo (focus+visible)
  let __lf_lastTarifasUpdatedAt = null;
  let __lf_lastTarifasCheck = 0;

  async function refreshTarifasAndMaybeRecalc(reason) {
    const now = Date.now();
    if (now - __lf_lastTarifasCheck < AUTO_REFRESH_THROTTLE_MS) return;
    __lf_lastTarifasCheck = now;

    const prev = __lf_lastTarifasUpdatedAt || window.LF.__LF_tarifasMeta?.updatedAt || null;
    const ok = await fetchTarifas(true, { silent: true });
    if (!ok) return;

    const curr = window.LF.__LF_tarifasMeta?.updatedAt || null;

    // Inicializar referencia sin notificar en la primera carga
    if (!__lf_lastTarifasUpdatedAt) {
      __lf_lastTarifasUpdatedAt = curr || prev;
      return;
    }

    if (curr && prev && curr !== prev) {
      __lf_lastTarifasUpdatedAt = curr;
      toast('Tarifas actualizadas. Recalculando…', 'ok');
      if ((state.rows && state.rows.length > 0) || state.lastSignature) {
        runCalculation(true);
      }
    }
  }

  async function calculate(isUserAction, forceRefresh = false) {
    if (!validateInputs()) {
      setStatus('Corrige los datos para calcular', 'err');
      return;
    }
    
    const values = getInputValues();
    const signature = signatureFromValues(values);

    if (!forceRefresh && !isUserAction && state.lastSignature === signature) {
      setStatus('Listo para calcular', 'idle');
      return;
    }
    
    if (window.__LF_CALC_INFLIGHT) return;
    window.__LF_CALC_INFLIGHT = true;
    
    try {
      saveInputs();
      setStatus('Calculando...', 'loading');

      const loaded = await fetchTarifas(forceRefresh);
      if (!loaded) return;

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
      state.pending = false;
      
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
    // Inicializar referencias DOM
    initElements();
    
    // Ahora que el DOM está listo, obtener referencias actualizadas
    const currentEl = window.LF.el;
    
    initTooltips();
    applyThemeClass(document.documentElement.classList.contains('light-mode') ? 'light' : 'dark');
    updateThemeIcon();
    loadInputs();
    updateSolarUI();

    validateInputs();
    markPending('Introduce tus datos y pulsa Calcular para ver el ranking.');

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
        renderTable();
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
        renderTable();
        updateSortIcons();
      });
    });

    // Calculate button
    currentEl.btnCalc.addEventListener('click', (e) => {
      createRipple(currentEl.btnCalc, e);
      // Limpiar Sun Club al calcular manualmente (no viene de CSV)
      if (window.LF) {
        window.LF.sunClubEnabled = false;
        window.LF.consumosHorarios = null;
      }
      runCalculation(false);
    });

    // Enter en cualquier input → Calcular
    Object.values(currentEl.inputs).forEach(input => {
      if (!input) return;
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Limpiar Sun Club al calcular manualmente (no viene de CSV)
          if (window.LF) {
            window.LF.sunClubEnabled = false;
            window.LF.consumosHorarios = null;
          }
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

    // Reset button
    currentEl.btnReset.addEventListener('click', (e) => {
      createRipple(currentEl.btnReset, e);
      toggleMenu(false);
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      try { sessionStorage.removeItem(LS_KEY); } catch (e) {}
      window.location.href = window.location.pathname + '?reset=1';
    });

    // Share button
    currentEl.btnShare.addEventListener('click', async (e) => {
      createRipple(currentEl.btnShare, e);
      toggleMenu(false);

      const d = saveInputs();
      const qp = new URLSearchParams(d).toString();
      const url = `${window.location.origin}${window.location.pathname}?${qp}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Mi configuración - LuzFija.es',
            text: 'Compara tarifas de luz con mi configuración',
            url: url
          });
          toast('Configuración compartida');
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            lfDbg('[WARN] Error al compartir:', err);
          }
        }
      }

      await copyText(url);
      toast('Enlace copiado al portapapeles');
    });

    // Refresh tarifas
    currentEl.btnRefreshTarifas?.addEventListener('click', async (e) => {
      createRipple(currentEl.btnRefreshTarifas, e);
      toggleMenu(false);

      try {
        await fetchTarifas(true, { silent: true });

        if (state.rows && state.rows.length > 0) {
          setTimeout(() => {
            currentEl.btnCalc?.click();
          }, 500);
        }
      } catch (error) {
        toast('Error al refrescar tarifas', 'err');
        lfDbg('[ERROR] Error refrescando tarifas:', error);
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

        try { localStorage.clear(); lfDbg('[CACHE] localStorage limpiado'); } catch (e) {}
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
    });

    $('solarOn')?.addEventListener('change', () => {
      if ($('compararMiTarifa')?.checked) updateMiTarifaForm();
    });

    // Al entrar, descargar siempre tarifas desde red (sin caché)
    fetchTarifas(true, { silent: true })
      .then((ok) => {
        if (ok) {
          __lf_lastTarifasUpdatedAt = window.LF.__LF_tarifasMeta?.updatedAt || null;
        }
      })
      .catch(() => {});

    // Auto-refresh agresivo: al volver al foco/visibilidad y cada 2 minutos
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshTarifasAndMaybeRecalc('visible');
      }
    });
    window.addEventListener('focus', () => refreshTarifasAndMaybeRecalc('focus'));
    window.addEventListener('online', () => refreshTarifasAndMaybeRecalc('online'));

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshTarifasAndMaybeRecalc('interval');
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
  if ('serviceWorker' in navigator) {
    // Guardamos si ya había controlador al inicio para distinguir primera instalación de actualización
    const hadController = !!navigator.serviceWorker.controller;
    const SW_UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 min
    const SW_UPDATE_THROTTLE_MS = 15 * 1000; // evitar doble disparo (focus+visible)
    let __lf_sw_reg = null;
    let __lf_last_sw_check = 0;

    async function requestSwUpdate(reason) {
      const now = Date.now();
      if (now - __lf_last_sw_check < SW_UPDATE_THROTTLE_MS) return;
      __lf_last_sw_check = now;
      try {
        if (!__lf_sw_reg) {
          __lf_sw_reg = await navigator.serviceWorker.getRegistration();
        }
        if (__lf_sw_reg) await __lf_sw_reg.update();
      } catch (_) {
        // silencioso
      }
    }

    window.addEventListener('load', function() {
      navigator.serviceWorker
        .register('sw.js')
        .then(function(registration) {
          __lf_sw_reg = registration;
          lfDbg('[SW] Registered successfully');

          // Detectar cuando hay una actualización disponible
          if (registration.waiting) {
            lfDbg('[SW] Update waiting already, auto-updating...');
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          registration.addEventListener('updatefound', function() {
            const newWorker = registration.installing;
            lfDbg('[SW] New update found, installing...');

            newWorker.addEventListener('statechange', function() {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                lfDbg('[SW] New update installed, auto-updating...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
          
          // Forzar comprobación inmediata tras registrar
          requestSwUpdate('load');
        })
        .catch(function(err) {
          lfDbg('[ERROR] SW registration failed', err);
        });
    });

    // Auto-check de updates del SW (agresivo)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestSwUpdate('visible');
    });
    window.addEventListener('focus', () => requestSwUpdate('focus'));
    window.addEventListener('online', () => requestSwUpdate('online'));
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      requestSwUpdate('interval');
    }, SW_UPDATE_INTERVAL_MS);

    // Listener para cuando el nuevo SW toma control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (refreshing) return;
      
      // Si no había controlador previo, es la primera instalación (clients.claim).
      // No recargamos porque la página ya está fresca y cargada de red.
      if (!hadController) {
        lfDbg('[SW] First installation active. No reload needed.');
        return;
      }

      lfDbg('[SW] New controller activated, reloading page...');
      refreshing = true;
      window.location.reload();
    });
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
          __lf_deferredInstallPrompt.userChoice.then(function(choiceResult) {
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
      var installHint = '';
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
