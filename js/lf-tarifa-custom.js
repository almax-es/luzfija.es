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

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    updateMiTarifaForm,
    agregarMiTarifa
  });

  window.updateMiTarifaForm = updateMiTarifaForm;
  window.agregarMiTarifa = agregarMiTarifa;

})();
