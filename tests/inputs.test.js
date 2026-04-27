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
    <input id="bonoSocialVulnerable" name="bonoSocialTipo" type="radio" value="vulnerable" checked>
    <input id="bonoSocialSevero" name="bonoSocialTipo" type="radio" value="severo">
    <input id="bonoSocialLimite1587" name="bonoSocialLimite" type="radio" value="1587" checked>
    <input id="bonoSocialLimite4761" name="bonoSocialLimite" type="radio" value="4761">
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
window.LF.DEFAULTS = {
  p1: '3.45',
  p2: '3.45',
  dias: '30',
  cPunta: '100',
  cLlano: '100',
  cValle: '100',
  zonaFiscal: 'Península',
  viviendaCanarias: true,
  solarOn: false,
  exTotal: '0',
  bvSaldo: '0',
  bonoSocialOn: false,
  bonoSocialTipo: 'vulnerable',
  bonoSocialLimite: '1587'
};
window.LF.SERVER_PARAMS = {};
window.LF.LS_KEY = 'almax_comparador_v6_inputs';
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
window.LF.clamp01to365Days = (n) => {
  const d = Math.trunc(n);
  if (!Number.isFinite(d) || d === 0) return 30;
  return Math.min(370, Math.max(1, d));
};
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
    inputs.bonoSocialOn.checked = false;
    document.getElementById('bonoSocialVulnerable').checked = true;
    document.getElementById('bonoSocialLimite1587').checked = true;
    Object.keys(window.LF.SERVER_PARAMS).forEach((key) => delete window.LF.SERVER_PARAMS[key]);
    localStorage.clear();
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

  it('Lee, guarda y comparte tipo y límite del bono social seleccionados en radio buttons', () => {
    window.LF.el.inputs.bonoSocialOn.checked = true;
    document.getElementById('bonoSocialSevero').checked = true;
    document.getElementById('bonoSocialLimite4761').checked = true;

    const vals = window.LF.getInputValues();
    const saved = window.LF.saveInputs();
    const persisted = JSON.parse(localStorage.getItem(window.LF.LS_KEY));
    const qp = new URLSearchParams(saved).toString();

    expect(vals.bonoSocialTipo).toBe('severo');
    expect(vals.bonoSocialLimite).toBe(4761);
    expect(saved.bonoSocialTipo).toBe('severo');
    expect(saved.bonoSocialLimite).toBe('4761');
    expect(persisted.bonoSocialTipo).toBe('severo');
    expect(persisted.bonoSocialLimite).toBe('4761');
    expect(qp).toContain('bonoSocialTipo=severo');
    expect(qp).toContain('bonoSocialLimite=4761');
  });

  it('Restaura tipo y límite del bono social desde localStorage', () => {
    localStorage.setItem(window.LF.LS_KEY, JSON.stringify({
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      bonoSocialLimite: '4761'
    }));

    window.LF.loadInputs();

    expect(document.querySelector('input[name="bonoSocialTipo"]:checked')?.value).toBe('severo');
    expect(document.querySelector('input[name="bonoSocialLimite"]:checked')?.value).toBe('4761');
    expect(window.LF.getInputValues().bonoSocialTipo).toBe('severo');
    expect(window.LF.getInputValues().bonoSocialLimite).toBe(4761);
  });

  it('Restaura tipo y límite del bono social desde parámetros compartidos', () => {
    Object.assign(window.LF.SERVER_PARAMS, {
      bonoSocialOn: 'true',
      bonoSocialTipo: 'severo',
      bonoSocialLimite: '4761'
    });

    window.LF.loadInputs();

    expect(document.querySelector('input[name="bonoSocialTipo"]:checked')?.value).toBe('severo');
    expect(document.querySelector('input[name="bonoSocialLimite"]:checked')?.value).toBe('4761');
    expect(window.LF.getInputValues().bonoSocialTipo).toBe('severo');
    expect(window.LF.getInputValues().bonoSocialLimite).toBe(4761);
  });

  it('Debe detectar zona fiscal y contexto', () => {
    window.LF.el.inputs.zonaFiscal.value = "Canarias";
    window.LF.el.inputs.viviendaCanarias.checked = true;
    window.LF.el.inputs.p1.value = "5"; // < 10kW

    const ctx = window.LF.__LF_getFiscalContext();
    expect(ctx.esCanarias).toBe(true);
    expect(ctx.esViviendaTipoCero).toBe(true);
  });

  it('Normaliza la referencia de consumos importados desde CSV', () => {
    const ref = window.LF.buildCsvConsumosRef({
      dias: '30,4',
      cPunta: '10,126',
      cLlano: '20,124',
      cValle: '30,125'
    });

    expect(ref).toEqual({
      dias: 30,
      cPunta: 10.13,
      cLlano: 20.12,
      cValle: 30.13
    });
  });

  it('Detecta si el formulario sigue coincidiendo con la referencia CSV activa', () => {
    const ref = { dias: 30, cPunta: 100, cLlano: 20, cValle: 5 };

    expect(window.LF.csvConsumosRefMatches({
      dias: 30,
      cPunta: 100,
      cLlano: 20,
      cValle: 5
    }, ref)).toBe(true);

    expect(window.LF.csvConsumosRefMatches({
      dias: 31,
      cPunta: 100,
      cLlano: 20,
      cValle: 5
    }, ref)).toBe(false);

    expect(window.LF.csvConsumosRefMatches({
      dias: 30,
      cPunta: 100,
      cLlano: 21,
      cValle: 5
    }, ref)).toBe(false);
  });

  it('Invalida juntos los tres campos del modo CSV', () => {
    window.LF.consumosHorarios = [{ fecha: new Date(), hora: 1, kwh: 1 }];
    window.LF.csvConsumosRef = { dias: 30, cPunta: 10, cLlano: 20, cValle: 30 };
    window.LF.pvpcPeriodoCSV = true;
    window.LF.sunClubEnabled = true;

    window.LF.clearCsvImportState();

    expect(window.LF.consumosHorarios).toBeNull();
    expect(window.LF.csvConsumosRef).toBeNull();
    expect(window.LF.pvpcPeriodoCSV).toBe(false);
    expect(window.LF.sunClubEnabled).toBe(true);
  });

});
