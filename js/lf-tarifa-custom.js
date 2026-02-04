// ===== LuzFija: Tarifa Personalizada =====

(function() {
  'use strict';

  const { $, parseNum, toast } = window.LF;

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

  // ===== AGREGAR MI TARIFA =====
  function agregarMiTarifa() {
    if (!$('compararMiTarifa')?.checked) return null;

    const tieneSolar = $('solarOn')?.checked || false;

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

    const puntaVal = $('mtPunta')?.value?.trim() || '';
    const llanoVal = $('mtLlano')?.value?.trim() || '';
    const valleVal = $('mtValle')?.value?.trim() || '';
    const p1Val = $('mtP1')?.value?.trim() || '';
    const p2Val = $('mtP2')?.value?.trim() || '';

    if (!puntaVal || !llanoVal || !valleVal || !p1Val || !p2Val) {
      toast('Completa todos los campos de tu tarifa');
      return null;
    }

    if (!esNumericoValido(puntaVal, 6) || !esNumericoValido(llanoVal, 6) || !esNumericoValido(valleVal, 6)) {
      toast('Los precios de energía deben ser números válidos');
      return null;
    }

    if (!esNumericoValido(p1Val, 6) || !esNumericoValido(p2Val, 6)) {
      toast('Los precios de potencia deben ser números válidos');
      return null;
    }

    const punta = parseNum(puntaVal);
    const llano = parseNum(llanoVal);
    const valle = parseNum(valleVal);
    const p1 = parseNum(p1Val);
    const p2 = parseNum(p2Val);

    if (punta < 0 || llano < 0 || valle < 0 || p1 < 0 || p2 < 0) {
      toast('Los precios no pueden ser negativos');
      return null;
    }

    if (p1 === 0 || p2 === 0) {
      toast('Las potencias P1 y P2 deben ser mayores que 0');
      return null;
    }

    if (punta > 1 || llano > 1 || valle > 1) {
      toast('Los precios de energía parecen muy altos (máximo: 1 €/kWh)');
      return null;
    }

    if (p1 > 1 || p2 > 1) {
      toast('Los precios de potencia parecen muy altos (máximo: 1 €/kW·día)');
      return null;
    }

    const es1P = (punta === llano && llano === valle);

    let precioExc = 0;
    if (tieneSolar) {
      const precioExcVal = $('mtPrecioExc')?.value?.trim() || '';
      if (precioExcVal) {
        if (!esNumericoValido(precioExcVal, 6)) {
          toast('El precio de compensación debe ser un número válido');
          return null;
        }
        precioExc = parseNum(precioExcVal);
        if (precioExc < 0) {
          toast('El precio de compensación no puede ser negativo');
          return null;
        }
        if (precioExc > 0.5) {
          toast('El precio de compensación parece muy alto (máximo habitual: 0,5 €/kWh)');
          return null;
        }
      }
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
        tipo: precioExc > 0 ? 'SIMPLE + BV' : 'NO COMPENSA',
        tope: 'ENERGIA',
        bv: precioExc > 0,
        reglaBV: precioExc > 0 ? 'BV MES ANTERIOR' : 'NO APLICA'
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
        });
        campo.setAttribute('data-save-attached', 'true');
      }
    });

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
