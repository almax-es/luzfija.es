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

  // Decimales admitidos en los precios que teclea el usuario en "Mi tarifa".
  // Las facturas reales llegan a 7-8 decimales (ej: 0,1118785 €/kWh), así que
  // el límite solo filtra tecleos absurdos; el control real de rango son los
  // máximos de 1 €/unidad (energía y potencia) y 0,5 €/kWh (compensación).
  // Duplicado a propósito en js/bv/bv-ui.js (MAX_DECIMALES_PRECIO) para que el
  // simulador solar valide igual: son IIFEs sin import compartido.
  const MAX_DECIMALES_PRECIO = 8;

  // ===== UPDATE FORM =====
  function updateMiTarifaForm() {
    const tieneSolar = $('solarOn')?.checked || false;
    const container = $('miTarifaPrecios');
    if (!container) return;

    // Flush sincronico ANTES de destruir los inputs actuales: un guardado con debounce
    // (800 ms) pendiente sobrevive a la reconstruccion via innerHTML y, al disparar despues,
    // leeria el DOM NUEVO (ya recargado desde localStorage 50 ms mas abajo) en vez del valor
    // recien tecleado que lo origino, perdiendolo en silencio. Si aun no hay inputs montados
    // (primera carga), no hay nada que volcar.
    if (container.querySelector('input')) {
      saveCustomTarifaMain();
    }

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

      <details class="mt-avanzado" style="margin-top: 16px;">
        <summary style="cursor: pointer; font-size: 11px; color: var(--muted2);">⚙️ Opciones avanzadas</summary>
        <div class="group" style="margin-top: 10px;">
          <label class="fv-check">
            <input id="mtSinSSAA" type="checkbox" style="width: auto; cursor: pointer;">
            <span>Mi tarifa cobra los servicios de ajuste aparte (no incluidos en el precio)</span>
          </label>
        </div>
      </details>
    `;

    if (tieneSolar) {
      container.innerHTML += `
        <div class="mt-seccion-header" style="margin-top: 20px;">
          <span class="mt-seccion-icon">☀️</span>
          <h4 class="mt-seccion-title">Compensación de excedentes</h4>
          <span class="mt-seccion-subtitle">Precio que te pagan por verter a la red</span>
        </div>
        <div class="group">
          <label class="fv-check">
            <input id="mtCompensacionIndexada" type="checkbox" style="width: auto; cursor: pointer;">
            <span>La compensación es a precio indexado (no un precio fijo)</span>
          </label>
        </div>
        <div class="group" id="mtPrecioExcWrap">
          <label for="mtPrecioExc">Precio compensación (€/kWh)</label>
          <input id="mtPrecioExc" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0743">
        </div>
        <div class="group" style="margin-top: 8px;">
          <label class="fv-check">
            <input id="mtTopeParcial" type="checkbox" style="width: auto; cursor: pointer;">
            <span>El límite de compensación es solo energía (sin peajes ni cargos)</span>
          </label>
        </div>
        <div class="fv-toggle" style="margin-top: 10px;">
          <label for="mtBV" class="fv-check">
            <input id="mtBV" type="checkbox" style="width: auto; cursor: pointer;">
            <span>🔋 Tengo batería virtual</span>
          </label>
        </div>
        <div class="group" style="margin-top: 8px;">
          <label for="mtPrecioBV">Cuota batería virtual (€/mes; escribe 0 si es gratuita)</label>
          <input id="mtPrecioBV" class="input" type="text" inputmode="decimal" placeholder="Ej: 2,99">
        </div>
        <p id="mtBVSinCompensacionAviso" style="display:none; margin: 8px 0 0; font-size: 12px; line-height: 1.45; color: var(--muted2);">
          ⚠️ La batería virtual no se aplicará mientras la compensación sea 0 €/kWh: sin excedentes remunerados no se genera nuevo saldo para la hucha. Indica un precio de compensación o marca la compensación indexada.
        </p>
        <span id="mtBVSinCompensacionLive" class="sr-only" role="status"></span>
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
    const camposMiTarifa = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtPrecioExc', 'mtPrecioBV'];
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
  const MT_CAMPOS = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtPrecioExc', 'mtPrecioBV'];
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
    if (puntaVal && !esNumericoValido(puntaVal, MAX_DECIMALES_PRECIO)) { markMiTarifaInvalid($('mtPunta')); hasInvalid = true; message = message || 'Los precios de energía deben ser números válidos'; }
    if (llanoVal && !esNumericoValido(llanoVal, MAX_DECIMALES_PRECIO)) { markMiTarifaInvalid($('mtLlano')); hasInvalid = true; message = message || 'Los precios de energía deben ser números válidos'; }
    if (valleVal && !esNumericoValido(valleVal, MAX_DECIMALES_PRECIO)) { markMiTarifaInvalid($('mtValle')); hasInvalid = true; message = message || 'Los precios de energía deben ser números válidos'; }
    if (p1Val && !esNumericoValido(p1Val, MAX_DECIMALES_PRECIO)) { markMiTarifaInvalid($('mtP1')); hasInvalid = true; message = message || 'Los precios de potencia deben ser números válidos'; }
    if (p2Val && !esNumericoValido(p2Val, MAX_DECIMALES_PRECIO)) { markMiTarifaInvalid($('mtP2')); hasInvalid = true; message = message || 'Los precios de potencia deben ser números válidos'; }

    // 3. Negativos / absurdos y P1 a cero: solo sobre campos con contenido
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

      // El contrato del dataset permite p2=0, pero p1 mantiene mínimo positivo.
      if (p1Val && p1 === 0) { markMiTarifaInvalid($('mtP1')); message = message || 'El precio de potencia P1 debe ser mayor que 0'; }

      if (puntaVal && punta > 1) { markMiTarifaInvalid($('mtPunta')); message = message || 'Los precios de energía parecen muy altos (máximo: 1 €/kWh)'; }
      if (llanoVal && llano > 1) { markMiTarifaInvalid($('mtLlano')); message = message || 'Los precios de energía parecen muy altos (máximo: 1 €/kWh)'; }
      if (valleVal && valle > 1) { markMiTarifaInvalid($('mtValle')); message = message || 'Los precios de energía parecen muy altos (máximo: 1 €/kWh)'; }
      if (p1Val && p1 > 1) { markMiTarifaInvalid($('mtP1')); message = message || 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día)'; }
      if (p2Val && p2 > 1) { markMiTarifaInvalid($('mtP2')); message = message || 'Los precios de potencia parecen muy altos (máximo: 1 €/kW·día)'; }
    }

    // 4. Precio de compensación (solo si hay solar, el campo tiene contenido, y la
    // compensacion NO es indexada: con indexada, el precio fijo queda oculto y se ignora
    // en el calculo, asi que un valor invalido ahi no debe bloquear Calcular).
    const compensacionIndexada = $('mtCompensacionIndexada')?.checked || false;
    if (tieneSolar && !compensacionIndexada) {
      const precioExcVal = $('mtPrecioExc')?.value?.trim() || '';
      if (precioExcVal) {
        if (!esNumericoValido(precioExcVal, MAX_DECIMALES_PRECIO)) {
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

    // 5. Cuota de batería virtual: obligatoria (puede ser 0) si BV esta marcada — dejarla en
    // blanco con BV activa significaria "BV gratuita" en silencio, cuando puede no serlo.
    // Independiente de si la compensacion es fija o indexada: BV no tiene relacion con eso.
    if (tieneSolar && $('mtBV')?.checked) {
      const precioBVVal = $('mtPrecioBV')?.value?.trim() || '';
      if (!precioBVVal) {
        markMiTarifaInvalid($('mtPrecioBV'));
        message = message || 'Indica la cuota mensual de la batería virtual (escribe 0 si es gratuita)';
      } else if (!esNumericoValido(precioBVVal, MAX_DECIMALES_PRECIO)) {
        markMiTarifaInvalid($('mtPrecioBV'));
        message = message || 'La cuota de batería virtual debe ser un número válido';
      } else if (parseNum(precioBVVal) < 0) {
        markMiTarifaInvalid($('mtPrecioBV'));
        message = message || 'La cuota de batería virtual no puede ser negativa';
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
    let precioBV = 0;
    let compensacionIndexada = false;
    let topeParcial = false;
    if ($('solarOn')?.checked) {
      const precioExcVal = $('mtPrecioExc')?.value?.trim() || '';
      if (precioExcVal) {
        precioExc = parseNum(precioExcVal);
      }
      tieneBV = $('mtBV')?.checked || false;
      if (tieneBV) {
        const precioBVVal = $('mtPrecioBV')?.value?.trim() || '';
        if (precioBVVal) precioBV = parseNum(precioBVVal);
      }
      compensacionIndexada = $('mtCompensacionIndexada')?.checked || false;
      topeParcial = $('mtTopeParcial')?.checked || false;
    }
    // Sin campos solares montados no hay checkbox de SSAA que leer aparte: por defecto
    // "incluidos" (comportamiento historico), igual que el resto de opciones avanzadas.
    const incluyeServiciosAjuste = !($('mtSinSSAA')?.checked || false);
    const excFinal = compensacionIndexada ? -1 : precioExc;
    const compensa = excFinal > 0 || excFinal === -1;

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
      incluyeServiciosAjuste: incluyeServiciosAjuste,
      fv: {
        exc: excFinal,
        tipo: compensa ? (tieneBV ? 'SIMPLE + BV' : 'SIMPLE') : 'NO COMPENSA',
        tope: topeParcial ? 'ENERGIA_PARCIAL' : 'ENERGIA',
        // INVARIANTE: fv.bv significa "BV aplicable", no "el checkbox estaba marcado".
        // Sin compensacion no hay excedente remunerado que alimente la hucha, asi que
        // marcar BV no puede activarla. Si se emitiera bv:true con tipo 'NO COMPENSA',
        // lf-calc.js y desglose-calculo.js la desactivarian por tipo mientras
        // bv-sim-monthly.js la activaria solo por fv.bv, dando importes distintos para
        // la misma opcion del usuario. Mantener la condicion en los tres productores.
        bv: tieneBV && compensa,
        reglaBV: (tieneBV && compensa) ? 'BV MES ANTERIOR' : 'NO APLICA',
        precioBV: precioBV
      },
      requiereFV: false
    };

    return tarifa;
  }

  function formatImportedTarifaPrice(value) {
    return Number(value).toFixed(MAX_DECIMALES_PRECIO)
      .replace(/0+$/, '')
      .replace(/\.$/, '')
      .replace('.', ',');
  }

  function applyCustomTarifaPrices(prices) {
    const values = {
      mtPunta: prices?.punta,
      mtLlano: prices?.llano,
      mtValle: prices?.valle,
      mtP1: prices?.p1,
      mtP2: prices?.p2
    };
    if (!Object.values(values).every(value => typeof value === 'number' && Number.isFinite(value))) return false;
    if (values.mtPunta < 0 || values.mtPunta > 1
      || values.mtLlano < 0 || values.mtLlano > 1
      || values.mtValle < 0 || values.mtValle > 1
      || values.mtP1 <= 0 || values.mtP1 > 1
      || values.mtP2 < 0 || values.mtP2 > 1) return false;

    const checkbox = $('compararMiTarifa');
    if (!checkbox) return false;
    checkbox.checked = true;
    const form = $('miTarifaForm');
    if (form) form.style.display = 'block';
    if (!['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2'].every(id => $(id))) {
      updateMiTarifaForm();
    }

    const importedInputs = Object.fromEntries(
      Object.keys(values).map(id => [id, $(id)])
    );
    if (!Object.values(importedInputs).every(Boolean)) return false;

    // El usuario ha pedido sustituir su tarifa anterior. Borrar primero evita
    // mezclar compensación, BV o SSAA persistidos de otra comercializadora.
    try { localStorage.removeItem('lf_custom_tarifa'); } catch (_) {}
    for (const [id, value] of Object.entries(values)) {
      importedInputs[id].value = formatImportedTarifaPrice(value);
    }
    ['mtPrecioExc', 'mtPrecioBV'].forEach(id => { const input = $(id); if (input) input.value = ''; });
    ['mtSinSSAA', 'mtCompensacionIndexada', 'mtTopeParcial', 'mtBV'].forEach(id => {
      const input = $(id);
      if (input) input.checked = false;
    });
    updateMtPrecioExcWrapVisibility();
    clearMiTarifaErrorStyles();
    if (!validateMiTarifa({ silent: true })) return false;
    saveCustomTarifaMain();
    attachSaveListeners();
    return true;
  }

  // ===== GUARDAR Y CARGAR TARIFA PERSONALIZADA =====
  // Compatibilidad con el esquema anterior al checkbox BV: en esos registros el campo `bv`
  // no existia y la BV se inferia de una compensacion fija positiva. IMPORTANTE: solo se
  // infiere cuando el campo esta realmente ausente; un `bv:false` explicito es una decision
  // del usuario y debe sobrevivir aunque `exc` sea positivo.
  function resolvePersistedCustomTarifaBv(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (data.bv !== undefined && data.bv !== null) {
      return typeof window.LF?.asBool === 'function'
        ? window.LF.asBool(data.bv, false)
        : Boolean(data.bv);
    }
    return parseNum(data.exc || '') > 0;
  }

  let customTarifaStorageErrorNotified = false;

  function saveCustomTarifaMain() {
    try {
      // La presencia REAL del campo en el DOM decide si hay valores solares que leer, no el
      // checkbox de solar: en el flush previo a reconstruir el formulario (ver
      // updateMiTarifaForm) el checkbox ya puede reflejar el nuevo estado mientras el DOM
      // todavia tiene los inputs del estado anterior, y son esos los que hay que guardar.
      const solarFieldsPresent = Boolean($('mtPrecioExc'));
      let exc = '', bv = false, precioBV = '', compensacionIndexada = false, topeParcial = false;
      if (solarFieldsPresent) {
        exc = $('mtPrecioExc')?.value || '';
        bv = $('mtBV')?.checked || false;
        precioBV = $('mtPrecioBV')?.value || '';
        compensacionIndexada = $('mtCompensacionIndexada')?.checked || false;
        topeParcial = $('mtTopeParcial')?.checked || false;
      } else {
        // Sin campos solares montados no hay nada que leer del DOM: preservar lo que ya
        // hubiera guardado en vez de tratar "elemento inexistente" como "vaciar" (perderia
        // compensacion/BV reales solo por haber editado un precio con solar desactivado).
        try {
          const previous = JSON.parse(localStorage.getItem('lf_custom_tarifa') || 'null');
          if (previous) {
            exc = previous.exc || '';
            bv = resolvePersistedCustomTarifaBv(previous);
            precioBV = previous.precioBV || '';
            compensacionIndexada = previous.compensacionIndexada || false;
            topeParcial = previous.topeParcial || false;
          }
        } catch(_) {}
      }
      // mtSinSSAA no es especifico de solar: se lee siempre que exista en el DOM.
      const sinSSAA = $('mtSinSSAA')?.checked || false;
      const data = {
        punta: $('mtPunta')?.value || '',
        llano: $('mtLlano')?.value || '',
        valle: $('mtValle')?.value || '',
        p1: $('mtP1')?.value || '',
        p2: $('mtP2')?.value || '',
        exc,
        bv,
        precioBV,
        sinSSAA,
        compensacionIndexada,
        topeParcial,
        savedAt: new Date().getTime()
      };
      localStorage.setItem('lf_custom_tarifa', JSON.stringify(data));
      customTarifaStorageErrorNotified = false;
      updateCustomTarifaIndicatorMain(data);
    } catch(e) {
      console.warn('No se pudo guardar tarifa personalizada:', e);
      if (!customTarifaStorageErrorNotified && typeof toast === 'function') {
        customTarifaStorageErrorNotified = true;
        toast('No pude guardar "Mi tarifa" en este navegador. Los cambios siguen en pantalla, pero podrían perderse al recargar.', 'err');
      }
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
      const mtPrecioBVEl = $('mtPrecioBV');

      if (mtPuntaEl) mtPuntaEl.value = data.punta || '';
      if (mtLlanoEl) mtLlanoEl.value = data.llano || '';
      if (mtValleEl) mtValleEl.value = data.valle || '';
      if (mtP1El) mtP1El.value = data.p1 || '';
      if (mtP2El) mtP2El.value = data.p2 || '';
      if (mtPrecioExcEl) mtPrecioExcEl.value = data.exc || '';
      if (mtPrecioBVEl) mtPrecioBVEl.value = data.precioBV || '';
      const mtBvEl = $('mtBV');
      // Migración: los registros anteriores al checkbox BV no tenían `bv`; usar el mismo
      // resolver que el guardado evita que editar con solar desactivado materialice un false
      // y destruya en silencio esa semántica legacy.
      if (mtBvEl) mtBvEl.checked = resolvePersistedCustomTarifaBv(data);
      const mtSinSSAAEl = $('mtSinSSAA');
      if (mtSinSSAAEl) mtSinSSAAEl.checked = Boolean(data.sinSSAA);
      const mtCompensacionIndexadaEl = $('mtCompensacionIndexada');
      if (mtCompensacionIndexadaEl) mtCompensacionIndexadaEl.checked = Boolean(data.compensacionIndexada);
      const mtTopeParcialEl = $('mtTopeParcial');
      if (mtTopeParcialEl) mtTopeParcialEl.checked = Boolean(data.topeParcial);
      updateMtPrecioExcWrapVisibility();

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
      const mtPrecioBVEl = $('mtPrecioBV');

      if (mtPuntaEl) mtPuntaEl.value = '';
      if (mtLlanoEl) mtLlanoEl.value = '';
      if (mtValleEl) mtValleEl.value = '';
      if (mtP1El) mtP1El.value = '';
      if (mtP2El) mtP2El.value = '';
      if (mtPrecioExcEl) mtPrecioExcEl.value = '';
      if (mtPrecioBVEl) mtPrecioBVEl.value = '';
      const mtBvEl = $('mtBV');
      if (mtBvEl) mtBvEl.checked = false;
      const mtSinSSAAEl = $('mtSinSSAA');
      if (mtSinSSAAEl) mtSinSSAAEl.checked = false;
      const mtCompensacionIndexadaEl = $('mtCompensacionIndexada');
      if (mtCompensacionIndexadaEl) mtCompensacionIndexadaEl.checked = false;
      const mtTopeParcialEl = $('mtTopeParcial');
      if (mtTopeParcialEl) mtTopeParcialEl.checked = false;
      updateMtPrecioExcWrapVisibility();

      updateCustomTarifaIndicatorMain(null);

      // Los .value/.checked de arriba son mutaciones programaticas: no disparan los listeners
      // input/change de attachSaveListeners, que son los que normalmente marcan state.pending.
      // Sin esto, el ranking anterior (con su fila "Mi tarifa") seguia figurando como vigente
      // pese a que los datos que lo generaron acaban de borrarse. No recalcula: solo invalida.
      if (typeof window.scheduleCalculateDebounced === 'function') {
        window.scheduleCalculateDebounced();
      }

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
    const camposMiTarifa = ['mtPunta', 'mtLlano', 'mtValle', 'mtP1', 'mtP2', 'mtPrecioExc', 'mtPrecioBV'];
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
          updateMtBVSinCompensacionAviso();
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
        updateMtBVSinCompensacionAviso();
        if (typeof window.scheduleCalculateDebounced === 'function') {
          window.scheduleCalculateDebounced();
        }
      });
      mtBvEl.setAttribute('data-save-attached', 'true');
    }

    // Checkboxes de opciones avanzadas (cambio vs input, igual que mtBV)
    ['mtSinSSAA', 'mtTopeParcial'].forEach((id) => {
      const campo = $(id);
      if (campo && !campo.hasAttribute('data-save-attached')) {
        campo.addEventListener('change', () => {
          saveCustomTarifaMain();
          if (typeof window.scheduleCalculateDebounced === 'function') {
            window.scheduleCalculateDebounced();
          }
        });
        campo.setAttribute('data-save-attached', 'true');
      }
    });
    const mtCompensacionIndexadaEl = $('mtCompensacionIndexada');
    if (mtCompensacionIndexadaEl && !mtCompensacionIndexadaEl.hasAttribute('data-save-attached')) {
      mtCompensacionIndexadaEl.addEventListener('change', () => {
        updateMtPrecioExcWrapVisibility();
        // Al marcar indexada, el precio fijo queda oculto y deja de validarse: quitar
        // tambien la marca visual de error para no dejar un campo en rojo invisible que ya
        // no bloquea nada (mismo criterio que mtPrecioBV al desactivar BV).
        if (mtCompensacionIndexadaEl.checked) {
          $('mtPrecioExc')?.classList.remove('error');
        }
        saveCustomTarifaMain();
        if (typeof window.scheduleCalculateDebounced === 'function') {
          window.scheduleCalculateDebounced();
        }
      });
      mtCompensacionIndexadaEl.setAttribute('data-save-attached', 'true');
    }
    updateMtPrecioExcWrapVisibility();

    // Conectar botón de limpiar
    const clearBtn = document.getElementById('lf-clear-custom-tarifa');
    if (clearBtn && !clearBtn.hasAttribute('data-clear-attached')) {
      clearBtn.addEventListener('click', clearCustomTarifaMain);
      clearBtn.setAttribute('data-clear-attached', 'true');
    }
  }

  // El precio fijo de compensacion se ignora si la compensacion es indexada: ocultarlo evita
  // que el usuario rellene un numero que nunca se usa en el calculo.
  function updateMtPrecioExcWrapVisibility() {
    const wrap = $('mtPrecioExcWrap');
    if (!wrap) return;
    wrap.style.display = $('mtCompensacionIndexada')?.checked ? 'none' : '';
    updateMtBVSinCompensacionAviso();
  }

  // Aviso NO bloqueante: sin compensacion no hay excedente remunerado que alimente la hucha, asi
  // que fv.bv se normaliza a false y la BV no se aplica (ver ARQUITECTURA-CALCULOS.md). Sin este
  // texto, marcar la casilla no produciria ningun efecto ni ninguna explicacion. Deliberadamente
  // NO marca el campo en rojo, NO invalida el formulario y NO desmarca la casilla: el estado es
  // legitimo y calculable, solo que la BV queda inactiva.
  const MT_BV_SIN_COMPENSACION_MSG = 'La batería virtual no se aplicará mientras la compensación sea 0 €/kWh: sin excedentes remunerados no se genera nuevo saldo para la hucha. Indica un precio de compensación o marca la compensación indexada.';

  function updateMtBVSinCompensacionAviso() {
    const aviso = $('mtBVSinCompensacionAviso');
    if (!aviso) return;
    const bvOn = $('mtBV')?.checked || false;
    const indexada = $('mtCompensacionIndexada')?.checked || false;
    const excVal = ($('mtPrecioExc')?.value || '').trim();
    const excNum = excVal ? parseNum(excVal) : 0;
    const inactiva = bvOn && !indexada && !(excNum > 0);
    aviso.style.display = inactiva ? '' : 'none';

    // El <p> visible NO puede ser la live region: display:none lo saca del arbol de
    // accesibilidad, y volver a mostrarlo no es un cambio DENTRO de una region ya presente,
    // que es lo que los lectores de pantalla anuncian de forma fiable. La region vive aparte,
    // siempre en el DOM, y lo que cambia es su contenido. Solo se escribe en las transiciones
    // para no re-anunciar mientras el usuario teclea 0 -> 0, -> 0,0.
    const live = $('mtBVSinCompensacionLive');
    if (!live) return;
    const anunciado = live.textContent !== '';
    if (inactiva && !anunciado) live.textContent = MT_BV_SIN_COMPENSACION_MSG;
    else if (!inactiva && anunciado) live.textContent = '';
  }

  // Cargar al iniciar
  setTimeout(loadCustomTarifaMain, 100);

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    updateMiTarifaForm,
    agregarMiTarifa,
    applyCustomTarifaPrices,
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
