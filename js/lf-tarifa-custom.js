/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: Tarifa Personalizada =====

(function() {
  'use strict';

  const { $, parseNum, toast, esNumericoValido, showError } = window.LF;

  // ===== UPDATE FORM =====
  function updateMiTarifaForm() {
    const tieneSolar = $('solarOn')?.checked || false;
    const container = $('miTarifaPrecios');
    if (!container) return;

    container.innerHTML = `
      <div class="info-box">
        <div style="display: flex; align-items: start; gap: 10px;">
          <span style="font-size: 18px; flex-shrink: 0;">💡</span>
          <div>
            <strong style="display: block; margin-bottom: 4px;">Busca estos precios en tu factura</strong>
            <div style="color: var(--muted2); font-size: 11px; line-height: 1.5;">
              Normalmente aparecen en la sección de "Detalle del importe" o "Términos de facturación"
            </div>
          </div>
        </div>
      </div>
      
      <div class="mt-seccion-header">
        <span class="mt-seccion-icon">📊</span>
        <h4 class="mt-seccion-title">Término de potencia</h4>
        <span class="mt-seccion-subtitle">Precio por kW contratado/día</span>
      </div>
      
      <div class="form" style="gap:10px;">
        <div class="group">
          <label for="mtP1">Potencia P1 (€/kW·día)</label>
          <input id="mtP1" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0891">
        </div>
        <div class="group">
          <label for="mtP2">Potencia P2 (€/kW·día)</label>
          <input id="mtP2" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0445">
        </div>
      </div>

      <div class="mt-seccion-header" style="margin-top: 20px;">
        <span class="mt-seccion-icon">⚡</span>
        <h4 class="mt-seccion-title">Término de energía</h4>
        <span class="mt-seccion-subtitle">Precio por kWh consumido</span>
      </div>
      
      <div class="form" style="gap:10px;">
        <div class="group">
          <label for="mtPunta">Punta (€/kWh)</label>
          <input id="mtPunta" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,1543">
        </div>
        <div class="group">
          <label for="mtLlano">Llano (€/kWh)</label>
          <input id="mtLlano" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,1234">
        </div>
        <div class="group">
          <label for="mtValle">Valle (€/kWh)</label>
          <input id="mtValle" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0899">
        </div>
      </div>
    `;

    if (tieneSolar) {
      container.innerHTML += `
        <div class="mt-seccion-header" style="margin-top: 20px;">
          <span class="mt-seccion-icon">☀️</span>
          <h4 class="mt-seccion-title">Compensación de excedentes</h4>
          <span class="mt-seccion-subtitle">Precio que te pagan por verter a la red</span>
        </div>
        <div class="group">
          <label for="mtPrecioExc">Precio compensación (€/kWh)</label>
          <input id="mtPrecioExc" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0743">
        </div>
        <div class="fv-toggle" style="margin-top: 10px;">
          <label for="mtBV" class="fv-check">
            <input id="mtBV" type="checkbox" style="width: auto; cursor: pointer;">
            <span>🔋 Tengo batería virtual</span>
          </label>
        </div>
      `;
    }

    // Agregar botón de limpiar datos
    container.innerHTML += `
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button type="button" id="lf-clear-custom-tarifa" class="btn btn-secondary" style="flex: 1; display: none;">
          🗑️ Limpiar datos guardados
        </button>
      </div>
    `;

    // Normalizar formato decimal al salir del campo (punto → coma)
    const { formatValueForDisplay } = window.LF;
    const camposMiTarifa = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtPrecioExc'];
    camposMiTarifa.forEach(id => {
      const campo = $(id);
      if (campo) {
        campo.addEventListener('blur', () => {
          if (campo.value) {
            campo.value = formatValueForDisplay(campo.value);
          }
        });
      }
    });

    // Conectar listeners de guardado automático y cargar datos guardados
    setTimeout(() => {
      window.LF.attachSaveListeners();
      window.LF.loadCustomTarifaMain();
    }, 50);
  }

  // ===== VALIDACIÓN VISUAL (compartida con sobre-la-marcha y calculate) =====
  const MT_CAMPOS = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtPrecioExc'];
  const MT_DESC_ERROR_ID = 'errorText';

  function clearMiTarifaErrorStyles() {
    MT_CAMPOS.forEach((id) => {
      const c = $(id);
      if (!c) return;
      c.classList.remove('error');
      c.removeAttribute('aria-invalid');
      const desc = (c.getAttribute('aria-describedby') || '').split(/\s+/).filter((t) => t && t !== MT_DESC_ERROR_ID);
      if (desc.length) c.setAttribute('aria-describedby', desc.join(' '));
      else c.removeAttribute('aria-describedby');
    });
  }

  function markMiTarifaInvalid(input) {
    if (!input) return;
    input.classList.add('error');
    input.setAttribute('aria-invalid', 'true');
    const desc = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!desc.includes(MT_DESC_ERROR_ID)) desc.push(MT_DESC_ERROR_ID);
    input.setAttribute('aria-describedby', desc.join(' '));
  }

  // Valida el formulario "Mi tarifa" cuando el checkbox está marcado.
  // Marca los campos inválidos con los mismos estilos que lf-inputs.js.
  // - silent: true  → solo marca visualmente (sobre-la-marcha / guard de calculate)
  // - silent: false → también hace toast con el mensaje (agregarMiTarifa directo)
  // - marcarVacios: false → la sobre-la-marcha NO pinta campos vacíos (solo errores
  //   de formato/valor); el guard de calculate/agregarMiTarifa usa true (por defecto)
  //   para que el intento de calcular sí marque los vacíos.
  // Devuelve true si todo es válido (o el checkbox está desmarcado), false si no.
  // El resultado booleano NO depende de marcarVacios: con campos vacíos y checkbox
  // marcado siempre devuelve false (el cálculo no se completa), solo cambia el
  // marcado visual durante la escritura.
  function validateMiTarifa({ silent = true, marcarVacios = true } = {}) {
    clearMiTarifaErrorStyles();
    if (!$('compararMiTarifa')?.checked) return true;

    const tieneSolar = $('solarOn')?.checked || false;
    const puntaVal = $('mtPunta')?.value?.trim() || '';
    const llanoVal = $('mtLlano')?.value?.trim() || '';
    const valleVal = $('mtValle')?.value?.trim() || '';
    const p1Val = $('mtP1')?.value?.trim() || '';
    const p2Val = $('mtP2')?.value?.trim() || '';

    // Estado por campo: si tiene contenido, validamos formato/valor.
    // Si está vacío, cuenta como inválido para el booleano, pero solo se
    // pinta cuando marcarVacios === true (sobre-la-marcha = false).
    let message = '';
    let hasEmpty = false;
    let hasInvalid = false;

    // 1. Campos vacíos → cuentan para el booleano, marca condicional.
    if (!puntaVal) { hasEmpty = true; if (marcarVacios) markMiTarifaInvalid($('mtPunta')); }
    if (!llanoVal) { hasEmpty = true; if (marcarVacios) markMiTarifaInvalid($('mtLlano')); }
    if (!valleVal) { hasEmpty = true; if (marcarVacios) markMiTarifaInvalid($('mtValle')); }
    if (!p1Val) { hasEmpty = true; if (marcarVacios) markMiTarifaInvalid($('mtP1')); }
    if (!p2Val) { hasEmpty = true; if (marcarVacios) markMiTarifaInvalid($('mtP2')); }
    if (hasEmpty) message = message || 'Completa todos los campos de tu tarifa';

    // 2. Números válidos: solo sobre campos no vacíos (los vacíos ya tratados).
    if (puntaVal && !esNumericoValido(puntaVal, 6)) { markMiTarifaInvalid($('mtPunta')); hasInvalid = true; message = message || 'Los precios de energía deben ser números válidos'; }
    if (llanoVal && !esNumericoValido(llanoVal, 6)) { markMiTarifaInvalid($('mtLlano')); hasInvalid = true; message = message || 'Los precios de energía deben ser números válidos'; }
    if (valleVal && !esNumericoValido(valleVal, 6)) { markMiTarifaInvalid($('mtValle')); hasInvalid = true; message = message || 'Los precios de energía deben ser números válidos'; }
    if (p1Val && !esNumericoValido(p1Val, 6)) { markMiTarifaInvalid($('mtP1')); hasInvalid = true; message = message || 'Los precios de potencia deben ser números válidos'; }
    if (p2Val && !esNumericoValido(p2Val, 6)) { markMiTarifaInvalid($('mtP2')); hasInvalid = true; message = message || 'Los precios de potencia deben ser números válidos'; }

    // 3. Negativos / absurdos / potencias cero: solo sobre campos con contenido
    //    y formato numérico válido (parseNum no es fiable si esNumericoValido falló).
    if (!hasInvalid) {
      const punta = parseNum(puntaVal);
      const llano = parseNum(llanoVal);
      const valle = parseNum(valleVal);
      const p1 = parseNum(p1Val);
      const p2 = parseNum(p2Val);

      // Solo aplica a campos no vacíos para no emitir "negativo" sobre 0 vacío.
      if (puntaVal && punta < 0) { markMiTarifaInvalid($('mtPunta')); message = message || 'Los precios no pueden ser negativos'; }
      if (llanoVal && llano < 0) { markMiTarifaInvalid($('mtLlano')); message = message || 'Los precios no pueden ser negativos'; }
      if (valleVal && valle < 0) { markMiTarifaInvalid($('mtValle')); message = message || 'Los precios no pueden ser negativos'; }
      if (p1Val && p1 < 0) { markMiTarifaInvalid($('mtP1')); message = message || 'Los precios no pueden ser negativos'; }
      if (p2Val && p2 < 0) { markMiTarifaInvalid($('mtP2')); message = message || 'Los precios no pueden ser negativos'; }

      if (p1Val && p1 === 0) { markMiTarifaInvalid($('mtP1')); message = message || 'Las potencias P1 y P2 deben ser mayores que 0'; }
      if (p2Val && p2 === 0) { markMiTarifaInvalid($('mtP2')); message = message || 'Las potencias P1 y P2 deben ser mayores que 0'; }

      if (puntaVal && punta > 1) { markMiTarifaInvalid($('mtPunta')); message = message || 'Los precios de energía parecen muy altos (máximo: 1 €/kWh)'; }
      if (llanoVal && llano > 1) { markMiTarifaInvalid($('mtLlano')); message = message || 'Los precios de energía parecen muy altos (máximo: 1 €/kWh)'; }
      if (valleVal && valle > 1) { markMiTarifaInvalid($('mtValle')); message = message || 'Los precios de energía parecen muy altos (máximo: 1 €/kWh)'; }
      if (p1Val && p1 > 1) { markMiTarifaInvalid($('mtP1')); message = message || 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día)'; }
      if (p2Val && p2 > 1) { markMiTarifaInvalid($('mtP2')); message = message || 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día)'; }
    }

    // 4. Precio de compensación (solo si hay solar y el campo tiene contenido)
    if (tieneSolar) {
      const precioExcVal = $('mtPrecioExc')?.value?.trim() || '';
      if (precioExcVal) {
        if (!esNumericoValido(precioExcVal, 6)) {
          markMiTarifaInvalid($('mtPrecioExc'));
          message = message || 'El precio de compensación debe ser un número válido';
        } else {
          const precioExc = parseNum(precioExcVal);
          if (precioExc < 0) {
            markMiTarifaInvalid($('mtPrecioExc'));
            message = message || 'El precio de compensación no puede ser negativo';
          } else if (precioExc > 0.5) {
            markMiTarifaInvalid($('mtPrecioExc'));
            message = message || 'El precio de compensación parece muy alto (máximo habitual: 0,5 €/kWh)';
          }
        }
      }
    }

    const invalid = hasEmpty || Boolean(message);
    if (invalid && !silent && message) toast(message);
    if (invalid && message && marcarVacios && typeof showError === 'function') showError(message);
    return !invalid;
  }

  // ===== AGREGAR MI TARIFA =====
  function agregarMiTarifa() {
    if (!$('compararMiTarifa')?.checked) return null;

    // Reutiliza la validación compartida (con toast para feedback puntual).
    if (!validateMiTarifa({ silent: false })) return null;

    const puntaVal = $('mtPunta')?.value?.trim() || '';
    const llanoVal = $('mtLlano')?.value?.trim() || '';
    const valleVal = $('mtValle')?.value?.trim() || '';
    const p1Val = $('mtP1')?.value?.trim() || '';
    const p2Val = $('mtP2')?.value?.trim() || '';

    const punta = parseNum(puntaVal);
    const llano = parseNum(llanoVal);
    const valle = parseNum(valleVal);
    const p1 = parseNum(p1Val);
    const p2 = parseNum(p2Val);

    const es1P = (punta === llano && llano === valle);

    let precioExc = 0;
    let tieneBV = false;
    if ($('solarOn')?.checked) {
      const precioExcVal = $('mtPrecioExc')?.value?.trim() || '';
      if (precioExcVal) {
        precioExc = parseNum(precioExcVal);
      }
      tieneBV = $('mtBV')?.checked || false;
    }

    const tarifa = {
      nombre: 'Mi tarifa ⭐',
      tipo: es1P ? '1P' : '3P',
      cPunta: punta,
      cLlano: llano,
      cValle: valle,
      p1: p1,
      p2: p2,
      web: '#',
      esPersonalizada: true,
      fv: {
        exc: precioExc,
        tipo: tieneBV ? 'SIMPLE + BV' : (precioExc > 0 ? 'SIMPLE' : 'NO COMPENSA'),
        tope: 'ENERGIA',
        bv: tieneBV,
        reglaBV: tieneBV ? 'BV MES ANTERIOR' : 'NO APLICA'
      },
      requiereFV: false
    };

    return tarifa;
  }

  // ===== GUARDAR Y CARGAR TARIFA PERSONALIZADA =====
  function saveCustomTarifaMain() {
    try {
      const data = {
        punta: $('mtPunta')?.value || '',
        llano: $('mtLlano')?.value || '',
        valle: $('mtValle')?.value || '',
        p1: $('mtP1')?.value || '',
        p2: $('mtP2')?.value || '',
        exc: $('mtPrecioExc')?.value || '',
        bv: $('mtBV')?.checked || false,
        savedAt: new Date().getTime()
      };
      localStorage.setItem('lf_custom_tarifa', JSON.stringify(data));
      updateCustomTarifaIndicatorMain(data);
    } catch(e) {
      console.warn('No se pudo guardar tarifa personalizada:', e);
    }
  }

  function updateCustomTarifaIndicatorMain(data) {
    try {
      const indicator = document.getElementById('lf-custom-tarifa-indicator');
      const clearBtn = document.getElementById('lf-clear-custom-tarifa');
      if (!indicator || !clearBtn) return;

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

  function loadCustomTarifaMain() {
    try {
      const saved = localStorage.getItem('lf_custom_tarifa');
      if (!saved) {
        updateCustomTarifaIndicatorMain(null);
        return false;
      }
      const data = JSON.parse(saved);
      const mtPuntaEl = $('mtPunta');
      const mtLlanoEl = $('mtLlano');
      const mtValleEl = $('mtValle');
      const mtP1El = $('mtP1');
      const mtP2El = $('mtP2');
      const mtPrecioExcEl = $('mtPrecioExc');

      if (mtPuntaEl) mtPuntaEl.value = data.punta || '';
      if (mtLlanoEl) mtLlanoEl.value = data.llano || '';
      if (mtValleEl) mtValleEl.value = data.valle || '';
      if (mtP1El) mtP1El.value = data.p1 || '';
      if (mtP2El) mtP2El.value = data.p2 || '';
      if (mtPrecioExcEl) mtPrecioExcEl.value = data.exc || '';
      const mtBvEl = $('mtBV');
      // Migración: datos guardados antes del checkbox BV no tienen campo `bv`;
      // entonces BV se infería de exc > 0 — preservar ese comportamiento.
      if (mtBvEl) {
        mtBvEl.checked = (data.bv != null) ? Boolean(data.bv) : parseNum(data.exc || '') > 0;
      }

      updateCustomTarifaIndicatorMain(data);
      return true;
    } catch(e) {
      console.warn('Error cargando tarifa personalizada:', e);
      updateCustomTarifaIndicatorMain(null);
      return false;
    }
  }

  function clearCustomTarifaMain() {
    if (!confirm('¿Estás seguro de que quieres eliminar los datos guardados de tu tarifa?')) {
      return;
    }

    try {
      localStorage.removeItem('lf_custom_tarifa');
      const mtPuntaEl = $('mtPunta');
      const mtLlanoEl = $('mtLlano');
      const mtValleEl = $('mtValle');
      const mtP1El = $('mtP1');
      const mtP2El = $('mtP2');
      const mtPrecioExcEl = $('mtPrecioExc');

      if (mtPuntaEl) mtPuntaEl.value = '';
      if (mtLlanoEl) mtLlanoEl.value = '';
      if (mtValleEl) mtValleEl.value = '';
      if (mtP1El) mtP1El.value = '';
      if (mtP2El) mtP2El.value = '';
      if (mtPrecioExcEl) mtPrecioExcEl.value = '';
      const mtBvEl = $('mtBV');
      if (mtBvEl) mtBvEl.checked = false;

      updateCustomTarifaIndicatorMain(null);

      const clearBtn = document.getElementById('lf-clear-custom-tarifa');
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
      toast('Error al limpiar los datos.', 'err');
    }
  }

  // Guardar al cambiar cualquier campo
  function attachSaveListeners() {
    const camposMiTarifa = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtPrecioExc'];
    camposMiTarifa.forEach(id => {
      const campo = $(id);
      if (campo && !campo.hasAttribute('data-save-attached')) {
        let saveTimer = null;
        campo.addEventListener('input', () => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveCustomTarifaMain, 800);
          // Validación sobre la marcha + recalculo pendiente (igual que lf-app.js).
          // marcarVacios: false → no pinta campos vacíos mientras escribes; solo
          // marca errores de formato/valor. El guard de calculate/agregarMiTarifa
          // sí marca los vacíos (marcarVacios por defecto true).
          validateMiTarifa({ silent: true, marcarVacios: false });
          if (typeof window.scheduleCalculateDebounced === 'function') {
            window.scheduleCalculateDebounced();
          }
        });
        campo.setAttribute('data-save-attached', 'true');
      }
    });

    // BV checkbox (cambio vs input)
    const mtBvEl = $('mtBV');
    if (mtBvEl && !mtBvEl.hasAttribute('data-save-attached')) {
      mtBvEl.addEventListener('change', () => {
        saveCustomTarifaMain();
        if (typeof window.scheduleCalculateDebounced === 'function') {
          window.scheduleCalculateDebounced();
        }
      });
      mtBvEl.setAttribute('data-save-attached', 'true');
    }

    // Conectar botón de limpiar
    const clearBtn = document.getElementById('lf-clear-custom-tarifa');
    if (clearBtn && !clearBtn.hasAttribute('data-clear-attached')) {
      clearBtn.addEventListener('click', clearCustomTarifaMain);
      clearBtn.setAttribute('data-clear-attached', 'true');
    }
  }

  // Cargar al iniciar
  setTimeout(loadCustomTarifaMain, 100);

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    updateMiTarifaForm,
    agregarMiTarifa,
    validateMiTarifa,
    clearMiTarifaErrorStyles,
    saveCustomTarifaMain,
    loadCustomTarifaMain,
    clearCustomTarifaMain,
    attachSaveListeners
  });

  window.updateMiTarifaForm = updateMiTarifaForm;
  window.agregarMiTarifa = agregarMiTarifa;

  // Hook para volver a conectar listeners después de que el formulario se renderice
  const originalUpdateMiTarifaForm = window.LF.updateMiTarifaForm;
  window.LF.updateMiTarifaForm = function() {
    originalUpdateMiTarifaForm();
    // Recargar datos guardados y conectar listeners
    setTimeout(() => {
      loadCustomTarifaMain();
      attachSaveListeners();
    }, 50);
  };

})();
