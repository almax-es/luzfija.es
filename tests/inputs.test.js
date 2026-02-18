import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// 1. Setup JSDOM
document.body.innerHTML = `
  <form>
    <input id="p1" value="">
    <input id="p2" value="">
    <input id="dias" value="">
    <input id="cPunta" value="">
    <input id="cLlano" value="">
    <input id="cValle" value="">
    <select id="zonaFiscal">
      <option value="Península">Península</option>
      <option value="Canarias">Canarias</option>
      <option value="CeutaMelilla">CeutaMelilla</option>
    </select>
    <div id="viviendaGroup"></div>
    <input id="viviendaCanarias" type="checkbox">
    <div id="kwhHint"></div>
    <div id="solarFields"></div>
    <input id="solarOn" type="checkbox">
    <input id="exTotal" value="">
    <input id="bvSaldo" value="">
    <div id="bonoSocialFields"></div>
    <input id="bonoSocialOn" type="checkbox">
    <button id="btnCalc"></button>
    <div id="statusPill"></div>
    <div id="statusText"></div>
    <div id="emptyBox"></div>
    <tbody id="tbody"></tbody>
    <div id="toolbar"></div>
    <div id="heroKpis"></div>
    <div id="kpiBest"></div>
    <div id="kpiPrice"></div>
  </form>
`;

// 2. Mockear dependencias
window.LF = window.LF || {};
window.LF.DEFAULTS = { p1: '3.45', dias: '30' };
window.LF.el = {
  inputs: {
    p1: document.getElementById('p1'),
    p2: document.getElementById('p2'),
    dias: document.getElementById('dias'),
    cPunta: document.getElementById('cPunta'),
    cLlano: document.getElementById('cLlano'),
    cValle: document.getElementById('cValle'),
    solarOn: document.getElementById('solarOn'),
    exTotal: document.getElementById('exTotal'),
    bvSaldo: document.getElementById('bvSaldo'),
    bonoSocialOn: document.getElementById('bonoSocialOn'),
    zonaFiscal: document.getElementById('zonaFiscal'),
    viviendaCanarias: document.getElementById('viviendaCanarias')
  },
  btnCalc: document.getElementById('btnCalc'),
  statusPill: document.getElementById('statusPill'),
  statusText: document.getElementById('statusText'),
  emptyBox: document.getElementById('emptyBox'),
  tbody: document.getElementById('tbody'),
  toolbar: document.getElementById('toolbar'),
  heroKpis: document.getElementById('heroKpis'),
  kpiBest: document.getElementById('kpiBest'),
  kpiPrice: document.getElementById('kpiPrice'),
  kwhHint: document.getElementById('kwhHint'),
  viviendaGroup: document.getElementById('viviendaGroup')
};

window.LF.state = { pending: false };

// Mocks robustos
window.LF.parseNum = (s) => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  return parseFloat(String(s).replace(',', '.'));
};
window.LF.clampNonNeg = (n) => Math.max(0, n);
window.LF.clamp01to365Days = (n) => Math.max(1, Math.min(365, n));
window.LF.round2 = (n) => Math.round(n * 100) / 100;
window.LF.asBool = (v) => Boolean(v);
window.LF.formatValueForDisplay = (v) => String(v).replace('.', ',');
window.LF.showError = (msg) => {}; // Mock
window.LF.clearErrorStyles = () => {
  Object.values(window.LF.el.inputs).forEach(el => el?.classList?.remove('error'));
};
window.LF.applyButtonState = () => {};
window.LF.markPending = () => {};
window.LF.toast = () => {};
window.LF.hideResultsToInitialState = () => {};

describe('Inputs y Validación (lf-inputs.js)', () => {

  beforeAll(async () => {
    await import('../js/lf-inputs.js');
  });

  beforeEach(() => {
    // Reset values
    const inputs = window.LF.el.inputs;
    inputs.p1.value = "3,45";
    inputs.p2.value = "3,45";
    inputs.dias.value = "30";
    inputs.cPunta.value = "100";
    inputs.cLlano.value = "0";
    inputs.cValle.value = "0";
    inputs.solarOn.checked = false;
    inputs.exTotal.value = "0";
    inputs.bvSaldo.value = "0";
    window.LF.clearErrorStyles();
  });

  it('Debe validar inputs correctos', () => {
    const isValid = window.LF.validateInputs();
    expect(isValid).toBe(true);
  });

  it('Debe fallar si Potencia es negativa o inválida', () => {
    window.LF.el.inputs.p1.value = "-1";
    expect(window.LF.validateInputs()).toBe(false);
    expect(window.LF.el.inputs.p1.classList.contains('error')).toBe(true);

    window.LF.el.inputs.p1.value = "texto";
    expect(window.LF.validateInputs()).toBe(false);
  });

  it('Debe fallar si Días es 0 o >370', () => {
    window.LF.el.inputs.dias.value = "0";
    expect(window.LF.validateInputs()).toBe(false);

    window.LF.el.inputs.dias.value = "371";
    expect(window.LF.validateInputs()).toBe(false);
  });

  it('Debe fallar si NO hay consumo (todo 0)', () => {
    window.LF.el.inputs.cPunta.value = "0";
    window.LF.el.inputs.cLlano.value = "0";
    window.LF.el.inputs.cValle.value = "0";
    expect(window.LF.validateInputs()).toBe(false);
  });

  it('Debe validar excedentes solo si Solar está activo', () => {
    // Solar OFF, excedentes mal puestos -> No importa, debe pasar (o ignorarse)
    window.LF.el.inputs.exTotal.value = "-100";
    expect(window.LF.validateInputs()).toBe(true);

    // Solar ON, excedentes mal puestos -> Falla
    window.LF.el.inputs.solarOn.checked = true;
    expect(window.LF.validateInputs()).toBe(false);
    
    // Corregir
    window.LF.el.inputs.exTotal.value = "50";
    window.LF.el.inputs.bvSaldo.value = "0";
    expect(window.LF.validateInputs()).toBe(true);
  });

  it('Debe parsear correctamente valores con coma', () => {
    window.LF.el.inputs.p1.value = "3,45";
    const vals = window.LF.getInputValues();
    expect(vals.p1).toBe(3.45);
  });

  it('Debe detectar zona fiscal y contexto', () => {
    window.LF.el.inputs.zonaFiscal.value = "Canarias";
    window.LF.el.inputs.viviendaCanarias.checked = true;
    window.LF.el.inputs.p1.value = "5"; // < 10kW

    const ctx = window.LF.__LF_getFiscalContext();
    expect(ctx.esCanarias).toBe(true);
    expect(ctx.esViviendaTipoCero).toBe(true);
  });

});