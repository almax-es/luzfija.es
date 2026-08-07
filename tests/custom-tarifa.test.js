import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// 0. Cargar utilidades base (esNumericoValido y dependencias compartidas)
import '../js/lf-utils.js';

// Referencia al parseNum REAL de lf-utils.js, capturada antes de que el mock de
// abajo lo sustituya. El mock (parseFloat sobre replace(',', '.')) es mucho mas
// simple que el parser real y no sirve para afirmar nada sobre precision: para
// eso se usa esta referencia. Ver el describe del final.
const parseNumReal = window.LF.parseNum;

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
  <input id="mtBV" type="checkbox">
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
    document.getElementById('mtBV').checked = true;
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

// Regresion del issue #14: "Mi tarifa" rechazaba precios con mas de 6 decimales
// (esNumericoValido se invocaba con maxDecimales = 6). Las facturas reales traen
// 7 decimales de forma habitual (0,1118785 EUR/kWh), asi que el limite se subio
// a 8 (MAX_DECIMALES_PRECIO en js/lf-tarifa-custom.js).
//
// Estos casos ejercitan el flujo real de "Mi tarifa" (validateMiTarifa /
// agregarMiTarifa), no el helper aislado.
describe('Mi tarifa: precision decimal de los precios (issue #14)', () => {
  const $ = (id) => document.getElementById(id);

  function setMiTarifa({
    punta = '0,10',
    llano = '0,10',
    valle = '0,10',
    p1 = '0,10',
    p2 = '0,05',
    exc = ''
  } = {}) {
    $('mtPunta').value = punta;
    $('mtLlano').value = llano;
    $('mtValle').value = valle;
    $('mtP1').value = p1;
    $('mtP2').value = p2;
    $('mtPrecioExc').value = exc;
  }

  beforeEach(() => {
    // Los tests anteriores dejan estado en el DOM (solar activo, BV marcado...).
    $('compararMiTarifa').checked = true;
    $('solarOn').checked = false;
    $('mtBV').checked = false;
    setMiTarifa();
    window.LF.toast.mockClear();
  });

  it('acepta precios de energia con 7 decimales y coma (valores reales de factura)', () => {
    setMiTarifa({ punta: '0,1118785', llano: '0,0379625', valle: '0,1112950' });

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(window.LF.validateMiTarifa({ silent: true })).toBe(true);
    expect($('mtPunta').classList.contains('error')).toBe(false);
    expect($('mtLlano').classList.contains('error')).toBe(false);
    expect($('mtValle').classList.contains('error')).toBe(false);
  });

  it('acepta 8 decimales con coma en energia y potencia sin perder precision', () => {
    setMiTarifa({
      punta: '0,12345678',
      llano: '0,11111111',
      valle: '0,09876543',
      p1: '0,12345678',
      p2: '0,08765432'
    });

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    // Comparado contra el parser REAL: si el valor se truncara o redondeara en
    // el camino, este assert caeria (el mock no interviene en el valor esperado).
    expect(tarifa.cPunta).toBe(parseNumReal('0,12345678'));
    expect(tarifa.p1).toBe(parseNumReal('0,12345678'));
    expect(tarifa.p2).toBe(parseNumReal('0,08765432'));
    expect($('mtPunta').classList.contains('error')).toBe(false);
    expect($('mtP1').classList.contains('error')).toBe(false);
  });

  it('rechaza 9 decimales con coma en un precio de energia', () => {
    setMiTarifa({ punta: '0,123456789' });

    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith('Los precios de energía deben ser números válidos');
    expect($('mtPunta').classList.contains('error')).toBe(true);
    expect($('mtPunta').getAttribute('aria-invalid')).toBe('true');
  });

  it('rechaza 9 decimales con coma en un precio de potencia', () => {
    setMiTarifa({ p1: '0,123456789' });

    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('precios de potencia'));
    expect($('mtP1').classList.contains('error')).toBe(true);
  });

  it('acepta 8 decimales en la compensacion de excedentes y rechaza 9', () => {
    $('solarOn').checked = true;

    setMiTarifa({ exc: '0,07432198' });
    const tarifa = window.LF.agregarMiTarifa();
    expect(tarifa).not.toBeNull();
    expect(tarifa.fv.exc).toBe(parseNumReal('0,07432198'));
    expect($('mtPrecioExc').classList.contains('error')).toBe(false);

    setMiTarifa({ exc: '0,074321987' });
    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('precio de compensación'));
    expect($('mtPrecioExc').classList.contains('error')).toBe(true);
  });

  it('mantiene los topes monetarios: 8 decimales no permiten superar 1 EUR/kWh', () => {
    setMiTarifa({ punta: '1,00000001' });

    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('muy altos'));
  });
});

// El parser real de lf-utils.js, separado del flujo anterior porque el suite de
// arriba mockea window.LF.parseNum. Aqui se comprueba que 8 decimales llegan al
// calculo con su valor intacto.
describe('parseNum real: precision de los precios de "Mi tarifa"', () => {
  it('no es el mock del suite anterior', () => {
    expect(parseNumReal).not.toBe(window.LF.parseNum);
  });

  it('conserva el valor de precios con 7 y 8 decimales', () => {
    expect(parseNumReal('0,1118785')).toBe(0.1118785);
    expect(parseNumReal('0,0379625')).toBe(0.0379625);
    expect(parseNumReal('0,12345678')).toBe(0.12345678);
    expect(parseNumReal('0,07432198')).toBe(0.07432198);
  });
});
