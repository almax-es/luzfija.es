import { describe, it, expect, beforeAll, vi } from 'vitest';

// 1. Setup JSDOM
document.body.innerHTML = `
  <input id="compararMiTarifa" type="checkbox">
  <input id="solarOn" type="checkbox">
  <div id="miTarifaPrecios"></div>
  <input id="mtPunta" value="">
  <input id="mtLlano" value="">
  <input id="mtValle" value="">
  <input id="mtP1" value="">
  <input id="mtP2" value="">
  <input id="mtPrecioExc" value="">
`;

// 2. Mocks
beforeAll(async () => {
  window.LF = window.LF || {};
  window.LF.parseNum = (val) => {
    if (!val) return 0;
    return parseFloat(String(val).replace(',', '.'));
  };
  window.LF.toast = vi.fn();
  window.LF.$ = (id) => document.getElementById(id);

  // 3. Import code AFTER mocks are set
  await import('../js/lf-tarifa-custom.js');
});

describe('Tarifa Personalizada (lf-tarifa-custom.js)', () => {

  it('agregarMiTarifa: Debe retornar null si el checkbox no está marcado', () => {
    document.getElementById('compararMiTarifa').checked = false;
    expect(window.LF.agregarMiTarifa()).toBeNull();
  });

  it('agregarMiTarifa: Debe crear una tarifa 3P válida', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = "0,15";
    document.getElementById('mtLlano').value = "0,12";
    document.getElementById('mtValle').value = "0,08";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,05";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(tarifa.nombre).toBe('Mi tarifa ⭐');
    expect(tarifa.tipo).toBe('3P');
    expect(tarifa.cPunta).toBe(0.15);
    expect(tarifa.p1).toBe(0.10);
  });

  it('agregarMiTarifa: Debe detectar automáticamente una tarifa 1P', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = "0,12";
    document.getElementById('mtLlano').value = "0,12";
    document.getElementById('mtValle').value = "0,12";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();
    expect(tarifa.tipo).toBe('1P');
  });

  it('agregarMiTarifa: Debe incluir configuración solar y BV si procede', () => {
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "0,07";
    // Rellenar básicos
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();
    
    expect(tarifa.fv.exc).toBe(0.07);
    expect(tarifa.fv.bv).toBe(true); // Activa BV automáticamente si hay precio exc
    expect(tarifa.fv.tipo).toBe('SIMPLE + BV');
  });

  it('agregarMiTarifa: Debe fallar y mostrar toast si faltan campos', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = ""; // Vació
    
    const tarifa = window.LF.agregarMiTarifa();
    
    expect(tarifa).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('Completa todos los campos'));
  });

  it('agregarMiTarifa: Debe rechazar precios negativos o absurdos', () => {
    document.getElementById('mtPunta').value = "-0,15";
    expect(window.LF.agregarMiTarifa()).toBeNull();

    document.getElementById('mtPunta').value = "5,00"; // > 1€/kWh
    expect(window.LF.agregarMiTarifa()).toBeNull();
  });

});
