import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// 1. Setup del entorno JSDOM simulado
document.body.innerHTML = `
  <input id="p1" value="0"> <input id="p2" value="0">
  <input id="dias" value="30">
  <input id="cPunta" value="0"> <input id="cLlano" value="0"> <input id="cValle" value="0">
  <select id="zonaFiscal"><option value="Península">Península</option></select>
  <input id="viviendaCanarias" type="checkbox">
  <input id="solarOn" type="checkbox">
  <input id="exTotal" value="0"> <input id="bvSaldo" value="0">
  <input id="bonoSocialOn" type="checkbox">
  <div id="statusPill"></div> <div id="statusText"></div>
  <div id="heroKpis"></div> <div id="kpiBest"></div> <div id="kpiPrice"></div>
  <div id="statsBar"></div> <div id="statMin"></div> <div id="statAvg"></div> <div id="statMax"></div>
  <div id="toolbar"></div> <div id="chartTop"></div> <div id="chartTopBody"></div>
  <table id="table"><thead></thead><tbody id="tbody"></tbody></table>
  <div id="emptyBox"></div> <div id="pvpcInfo"></div>
  <input id="bonoSocialVulnerable" type="radio" checked>
  <input id="bonoSocialLimite1587" type="radio" checked>
`;

// 2. Mockear dependencias globales antes de cargar los scripts
window.LF = window.LF || {};
window.LF_CONFIG = window.LF_CONFIG || {};

// Cargar scripts en orden (simulando index.html)
import '../js/lf-utils.js'; // Necesario para parseNum, round2
import '../js/lf-state.js'; // Estado global
import '../js/lf-config.js'; // Config fiscal
import '../js/lf-inputs.js'; // Lectura de inputs
import '../js/lf-render.js'; // Renderizado (lo mockearemos parcialmente)
import '../js/lf-calc.js';   // EL MOTOR A TESTEAR

describe('Motor de Cálculo (lf-calc.js)', () => {

  beforeAll(() => {
    // Inicializar referencias DOM (crucial para que getInputValues funcione)
    window.LF.initElements();

    // Mockear funciones de UI para que no fallen al intentar pintar cosas complejas
    window.LF.renderAll = vi.fn((data) => {
      // Guardamos el resultado en el estado para poder inspeccionarlo en el test
      window.LF.state.rows = data.resultados;
    });
    
    // Mockear renderTable para evitar chunking asíncrono en tests
    window.LF.renderTable = vi.fn().mockResolvedValue(true);
    window.LF.renderSunClubCard = vi.fn();
    window.LF.renderPvpcInfo = vi.fn();
    window.LF.renderTopChart = vi.fn();
  });

  beforeEach(() => {
    // Resetear estado
    window.LF.cachedTarifas = [];
    document.getElementById('solarOn').checked = false;
    document.getElementById('exTotal').value = "0";
  });

  it('Debe calcular correctamente una factura básica (Potencia + Energía + Impuestos)', async () => {
    // --- ESCENARIO ---
    // Tarifa simple: 0.10 €/kWh energía, 0.10 €/kW·día potencia
    // Consumo: 100 kWh
    // Potencia: 4 kW (P1 y P2)
    // Días: 30
    // Zona: Península (régimen fiscal vigente configurado)
    
    const tarifaTest = {
      nombre: "Tarifa Test",
      p1: 0.10, p2: 0.10,
      cPunta: 0.10, cLlano: 0.10, cValle: 0.10,
      tipo: "1P",
      esPVPC: false
    };
    window.LF.cachedTarifas = [tarifaTest];

    // Ejecutar cálculo con el régimen fiscal actual
    await window.LF.calculateLocal({
      p1: 4,
      p2: 4,
      dias: 30,
      cPunta: 100,
      cLlano: 0,
      cValle: 0,
      zonaFiscal: 'Península',
      viviendaCanarias: false,
      solarOn: false,
      exTotal: 0,
      bvSaldo: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587,
      fechaYmd: '2026-03-20'
    });

    // Verificaciones
    const resultado = window.LF.state.rows[0];
    
    // 1. Coste Potencia: (4kW * 0.10 * 30) + (4kW * 0.10 * 30) = 12 + 12 = 24 €
    expect(resultado.potenciaNum).toBeCloseTo(24.00, 2);

    // 2. Coste Energía: 100 kWh * 0.10 = 10 €
    expect(resultado.consumoNum).toBeCloseTo(10.00, 2);

    const tarifaAcceso = window.LF_CONFIG.calcularBonoSocial(30);
    const sumaBase = 24 + 10 + tarifaAcceso;
    const iee = window.LF_CONFIG.calcularIEE(sumaBase, 100, '2026-03-20');
    const alquiler = window.LF_CONFIG.calcularAlquilerContador(30);
    const taxCalc = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Península',
      usoFiscal: 'otros',
      baseEnergia: sumaBase,
      impuestoElectrico: iee,
      baseContador: alquiler,
      potenciaContratada: 4,
      fechaYmd: '2026-03-20'
    });
    const totalEsperado = window.LF.round2(sumaBase + iee + alquiler + taxCalc.impuestoEnergia + taxCalc.impuestoContador);

    expect(Math.abs(resultado.totalNum - totalEsperado)).toBeLessThanOrEqual(0.02);
  });

  it('Mantiene el régimen general actual aunque cambie la fecha del periodo en Península <10kW', async () => {
    const tarifaTest = {
      nombre: "Tarifa BOE",
      p1: 0.10, p2: 0.10,
      cPunta: 0.10, cLlano: 0.10, cValle: 0.10,
      tipo: "1P",
      esPVPC: false
    };
    window.LF.cachedTarifas = [tarifaTest];

    await window.LF.calculateLocal({
      p1: 4,
      p2: 4,
      dias: 30,
      cPunta: 100,
      cLlano: 0,
      cValle: 0,
      zonaFiscal: 'Península',
      viviendaCanarias: false,
      solarOn: false,
      exTotal: 0,
      bvSaldo: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587,
      fechaYmd: '2026-03-21'
    });

    const resultado = window.LF.state.rows[0];
    const tarifaAcceso = window.LF_CONFIG.calcularBonoSocial(30);
    const sumaBase = 24 + 10 + tarifaAcceso;
    const iee = window.LF_CONFIG.calcularIEE(sumaBase, 100, '2026-03-21');
    const alquiler = window.LF_CONFIG.calcularAlquilerContador(30);
    const taxCalc = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Península',
      usoFiscal: 'otros',
      baseEnergia: sumaBase,
      impuestoElectrico: iee,
      baseContador: alquiler,
      potenciaContratada: 4,
      fechaYmd: '2026-03-21'
    });
    const totalEsperado = window.LF.round2(sumaBase + iee + alquiler + taxCalc.impuestoEnergia + taxCalc.impuestoContador);

    expect(taxCalc.energiaRate).toBe(0.21);
    expect(Math.abs(resultado.totalNum - totalEsperado)).toBeLessThanOrEqual(0.02);
  });

  it('Aplica IVA general en tarifas libres con 10 kW exactos tras desactivar la reducción', async () => {
    const tarifaLibre = {
      nombre: "Libre exacta 10kW",
      p1: 0.10, p2: 0.10,
      cPunta: 0.10, cLlano: 0.10, cValle: 0.10,
      tipo: "1P",
      esPVPC: false
    };
    window.LF.cachedTarifas = [tarifaLibre];

    await window.LF.calculateLocal({
      p1: 10,
      p2: 10,
      dias: 30,
      cPunta: 100,
      cLlano: 0,
      cValle: 0,
      zonaFiscal: 'Península',
      viviendaCanarias: false,
      solarOn: false,
      exTotal: 0,
      bvSaldo: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587,
      fechaYmd: '2026-03-21'
    });

    const resultado = window.LF.state.rows[0];
    const tarifaAcceso = window.LF_CONFIG.calcularBonoSocial(30);
    const sumaBase = 60 + 10 + tarifaAcceso;
    const iee = window.LF_CONFIG.calcularIEE(sumaBase, 100, '2026-03-21');
    const alquiler = window.LF_CONFIG.calcularAlquilerContador(30);
    const taxCalc = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Península',
      usoFiscal: 'otros',
      baseEnergia: sumaBase,
      impuestoElectrico: iee,
      baseContador: alquiler,
      potenciaContratada: 10,
      fechaYmd: '2026-03-21'
    });
    const totalEsperado = window.LF.round2(sumaBase + iee + alquiler + taxCalc.impuestoEnergia + taxCalc.impuestoContador);

    expect(taxCalc.energiaRate).toBe(0.21);
    expect(Math.abs(resultado.totalNum - totalEsperado)).toBeLessThanOrEqual(0.02);
  });

  it('Debe aplicar compensación de excedentes solares', async () => {
    // --- ESCENARIO SOLAR ---
    // Misma tarifa, añade excedentes a 0.05 €/kWh
    // Excedentes: 50 kWh -> 2.50 € de descuento
    
    const tarifaSolar = {
      nombre: "Tarifa Solar",
      p1: 0.10, p2: 0.10,
      cPunta: 0.10, cLlano: 0.10, cValle: 0.10,
      fv: { exc: 0.05, tipo: "SIMPLE", bv: false }, // Excedentes a 0.05
      esPVPC: false
    };
    window.LF.cachedTarifas = [tarifaSolar];

    // Inputs
    document.getElementById('p1').value = "4";
    document.getElementById('p2').value = "4";
    document.getElementById('dias').value = "30";
    document.getElementById('cPunta').value = "100"; 
    
    // Activar solar
    document.getElementById('solarOn').checked = true;
    document.getElementById('exTotal').value = "50"; // 50 kWh excedentes

    await window.LF.calculateLocal();

    const resultado = window.LF.state.rows[0];

    // Consumo original: 10 €
    // Descuento esperado: 50 * 0.05 = 2.50 €
    // Consumo final (consumoNum) debería ser 7.50 €
    expect(resultado.consumoNum).toBeCloseTo(7.50, 2);
    
    // Verificar que se marca como aplicada
    expect(resultado.fvApplied).toBe(true);
  });

  it('Debe ordenar correctamente (Barato primero)', async () => {
    const tarifaCara = { nombre: "Cara", p1:1, p2:1, cPunta:1, cLlano:1, cValle:1, tipo:"1P" }; // Muy cara
    const tarifaBarata = { nombre: "Barata", p1:0.01, p2:0.01, cPunta:0.01, cLlano:0.01, cValle:0.01, tipo:"1P" }; // Muy barata

    window.LF.cachedTarifas = [tarifaCara, tarifaBarata]; // Orden inverso

    // Inputs básicos
    document.getElementById('p1').value = "1";
    document.getElementById('dias').value = "1";
    document.getElementById('cPunta').value = "1";

    await window.LF.calculateLocal();

    const filas = window.LF.state.rows;
    
    // La primera debe ser la barata
    expect(filas[0].nombre).toBe("Barata");
    expect(filas[1].nombre).toBe("Cara");
    
    // La barata debe tener esMejor = true
    expect(filas[0].esMejor).toBe(true);
  });

  it('Debe dejar PVPC fuera del ranking comparable cuando el modo solar está activo', async () => {
    const tarifaSolar = {
      nombre: 'Solar Compensa',
      p1: 0.10, p2: 0.10,
      cPunta: 0.10, cLlano: 0.10, cValle: 0.10,
      tipo: '1P',
      esPVPC: false,
      fv: { exc: 0.05, tipo: 'SIMPLE', bv: false }
    };
    const tarifaPVPC = {
      nombre: 'PVPC',
      tipo: '1P',
      esPVPC: true,
      metaPvpc: {
        terminoFijo: 8,
        terminoVariable: 12,
        bonoSocial: 0.5,
        impuestoElectrico: 0.1,
        equipoMedida: 0.2,
        iva: 1.5,
        totalFactura: 22.3
      }
    };
    window.LF.cachedTarifas = [tarifaPVPC, tarifaSolar];

    await window.LF.calculateLocal({
      p1: 4,
      p2: 4,
      dias: 30,
      cPunta: 100,
      cLlano: 0,
      cValle: 0,
      zonaFiscal: 'Península',
      viviendaCanarias: false,
      solarOn: true,
      exTotal: 50,
      bvSaldo: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587,
      fechaYmd: '2026-03-20'
    });

    const filas = window.LF.state.rows;
    const pvpc = filas.find((row) => row.nombre === 'PVPC');
    const mejor = filas[0];

    expect(mejor.nombre).toBe('Solar Compensa');
    expect(mejor.esMejor).toBe(true);

    expect(pvpc).toBeTruthy();
    expect(pvpc.solarNoCalculable).toBe(true);
    expect(pvpc.total).toBe('—');
    expect(pvpc.totalNum).toBe(Number.POSITIVE_INFINITY);
    expect(pvpc.esMejor).toBe(false);
  });

  it('Aplica bono social en PVPC desde calculateLocal()', async () => {
    window.LF.cachedTarifas = [{
      nombre: 'PVPC',
      tipo: 'PVPC',
      esPVPC: true,
      metaPvpc: {
        terminoFijo: 10,
        costeMargenPot: 0,
        terminoVariable: 20,
        bonoSocial: 1,
        equipoMedida: 0.8
      }
    }];

    await window.LF.calculateLocal({
      p1: 4,
      p2: 4,
      dias: 30,
      cPunta: 100,
      cLlano: 100,
      cValle: 100,
      zonaFiscal: 'Península',
      viviendaCanarias: false,
      solarOn: false,
      exTotal: 0,
      bvSaldo: 0,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      bonoSocialLimite: 9999,
      fechaYmd: '2026-03-21'
    });

    const resultado = window.LF.state.rows[0];
    const expectedRate = window.LF_CONFIG.getBonoSocialDiscountRate('severo');
    const expectedDiscount = window.LF.round2((10 + 0 + 1 + 20) * expectedRate);

    expect(resultado.bonoSocialDescuentoEur).toBe(expectedDiscount);
    expect(resultado.metaPvpc.bonoSocialDescuentoEur).toBe(expectedDiscount);
    expect(resultado.metaPvpc.bonoSocialCalc.on).toBe(true);
    expect(resultado.metaPvpc.bonoSocialCalc.tipo).toBe('severo');
    expect(resultado.metaPvpc.bonoSocialCalc.kwhBonificable).toBe(300);
    expect(resultado.totalNum).toBeLessThan(10 + 20 + 1 + 0.8);
  });

  describe('Casos Extremos (Edge Cases)', () => {
    
    it('Debe manejar Consumo Cero correctamente', async () => {
      window.LF.cachedTarifas = [{ nombre: "Cero", p1:0.1, p2:0.1, cPunta:0.1, cLlano:0.1, cValle:0.1, tipo:"1P" }];
      document.getElementById('cPunta').value = "0";
      document.getElementById('cLlano').value = "0";
      document.getElementById('cValle').value = "0";
      document.getElementById('dias').value = "30";
      document.getElementById('p1').value = "3.45";

      await window.LF.calculateLocal();
      const res = window.LF.state.rows[0];
      
      expect(res.consumoNum).toBe(0);
      expect(res.totalNum).toBeGreaterThan(0); // Paga solo potencia
    });

    it('Debe manejar Excedentes > Consumo (Tope 0€ energía)', async () => {
      // Tarifa sin BV: la compensacion no puede superar el coste de la energia
      window.LF.cachedTarifas = [{ 
        nombre: "Solar Tope", 
        p1:0.1, p2:0.1, cPunta:0.1, cLlano:0.1, cValle:0.1, 
        fv: { exc: 0.1, tipo: "SIMPLE", bv: false } 
      }];
      document.getElementById('cPunta').value = "10"; // 10 kWh * 0.1 = 1€ energía
      document.getElementById('solarOn').checked = true;
      document.getElementById('exTotal').value = "100"; // 100 kWh * 0.1 = 10€ compensación

      await window.LF.calculateLocal();
      const res = window.LF.state.rows[0];
      
      // La energia debe quedarse en 0 (no -9€)
      expect(res.consumoNum).toBe(0);
      expect(res.totalNum).toBeGreaterThan(0); // Sigue pagando potencia
    });

    it('SIMPLE + BV acumula excedente sobrante normal cuando supera el consumo', async () => {
      window.LF.cachedTarifas = [{
        nombre: "Solar BV Sobrante",
        p1: 0.1,
        p2: 0.1,
        cPunta: 0.1,
        cLlano: 0.1,
        cValle: 0.1,
        tipo: "1P",
        fv: { exc: 0.1, tipo: "SIMPLE + BV", bv: true }
      }];

      await window.LF.calculateLocal({
        p1: 2,
        p2: 2,
        dias: 30,
        cPunta: 10,
        cLlano: 0,
        cValle: 0,
        zonaFiscal: 'Península',
        viviendaCanarias: false,
        solarOn: true,
        exTotal: 100,
        bvSaldo: 0,
        bonoSocialOn: false,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 1587,
        fechaYmd: '2026-05-06'
      });

      const res = window.LF.state.rows[0];

      expect(res.fvCredit1).toBeCloseTo(1.00, 2);
      expect(res.fvExcedenteSobrante).toBeCloseTo(9.00, 2);
      expect(res.fvBvSaldoFin).toBeCloseTo(9.00, 2);
      expect(res.totalNum).toBeCloseTo(res.fvTotalFinal - 9.00, 2);
    });

    it('SIMPLE + BV suma precioBV prorrateado por días y permite cubrirlo con saldo', async () => {
      window.LF.cachedTarifas = [{
        nombre: "Solar BV Pago",
        p1: 0.1,
        p2: 0.1,
        cPunta: 0.1,
        cLlano: 0.1,
        cValle: 0.1,
        tipo: "1P",
        fv: { exc: 0.05, tipo: "SIMPLE + BV", bv: true, precioBV: 2 }
      }];

      await window.LF.calculateLocal({
        p1: 2,
        p2: 2,
        dias: 30,
        cPunta: 100,
        cLlano: 0,
        cValle: 0,
        zonaFiscal: 'Península',
        viviendaCanarias: false,
        solarOn: true,
        exTotal: 0,
        bvSaldo: 100,
        bonoSocialOn: false,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 1587,
        fechaYmd: '2026-05-06'
      });

      const res = window.LF.state.rows[0];
      const cuotaProrrateada = 2 * 30 * 12 / 365;

      expect(res.fvPrecioBV).toBe(2);
      expect(res.fvCosteBV).toBeCloseTo(cuotaProrrateada, 2);
      expect(res.fvCredit2).toBeGreaterThan(res.fvCosteBV);
      expect(res.fvTotalFinal).toBe(0);
      expect(res.fvBvSaldoFin).toBeLessThan(100);
    });

    it('ENERGIA_PARCIAL con BV acumula el sobrante no usado en el comparador principal', async () => {
      window.LF.cachedTarifas = [{
        nombre: "Solar Parcial BV",
        p1: 0.080533,
        p2: 0.007407,
        cPunta: 0.187021,
        cLlano: 0.135066,
        cValle: 0.085298,
        tipo: "3P",
        fv: { exc: 0.08, tipo: "SIMPLE + BV", tope: "ENERGIA_PARCIAL", bv: true }
      }];

      await window.LF.calculateLocal({
        p1: 4.5,
        p2: 5,
        dias: 30,
        cPunta: 52.48,
        cLlano: 50.24,
        cValle: 193.29,
        zonaFiscal: 'Península',
        viviendaCanarias: false,
        solarOn: true,
        exTotal: 364.30,
        bvSaldo: 0,
        bonoSocialOn: false,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 1587,
        fechaYmd: '2026-05-06'
      });

      const res = window.LF.state.rows[0];

      expect(res.fvCredit1).toBeCloseTo(25.86, 2);
      expect(res.fvExcedenteNoCompensable).toBeCloseTo(3.28, 2);
      expect(res.fvExcedenteSobrante).toBeCloseTo(3.28, 2);
      expect(res.fvBvSaldoFin).toBeCloseTo(3.28, 2);
      expect(res.totalNum).toBeCloseTo(res.fvTotalFinal - 3.28, 2);
    });

    it('ENERGIA_PARCIAL con BV acumula todo el sobrante no usado aunque supere peajes/cargos', async () => {
      window.LF.cachedTarifas = [{
        nombre: "Solar Parcial BV Mucho Excedente",
        p1: 0.080533,
        p2: 0.007407,
        cPunta: 0.187021,
        cLlano: 0.135066,
        cValle: 0.085298,
        tipo: "3P",
        fv: { exc: 0.08, tipo: "SIMPLE + BV", tope: "ENERGIA_PARCIAL", bv: true }
      }];

      await window.LF.calculateLocal({
        p1: 4.5,
        p2: 5,
        dias: 30,
        cPunta: 52.48,
        cLlano: 50.24,
        cValle: 193.29,
        zonaFiscal: 'Península',
        viviendaCanarias: false,
        solarOn: true,
        exTotal: 500,
        bvSaldo: 0,
        bonoSocialOn: false,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 1587,
        fechaYmd: '2026-05-06'
      });

      const res = window.LF.state.rows[0];

      expect(res.fvCredit1).toBeCloseTo(25.86, 2);
      expect(res.fvExcedenteNoCompensable).toBeCloseTo(7.23, 2);
      expect(res.fvExcedenteSobrante).toBeCloseTo(14.14, 2);
      expect(res.fvBvSaldoFin).toBeCloseTo(14.14, 2);
      expect(res.totalNum).toBeCloseTo(res.fvTotalFinal - 14.14, 2);
    });

    it('Sun Club usa el IEE vigente de la fecha del periodo', () => {
      const originalIEE = window.LF_CONFIG.calcularIEE;
      window.LF.consumosHorarios = [{ hora: 13, kwh: 100 }];
      window.LF_CONFIG.calcularIEE = vi.fn((base, consumoKwh, fechaYmd) => {
        return fechaYmd === '2026-03-21' ? 20 : originalIEE.call(window.LF_CONFIG, base, consumoKwh, fechaYmd);
      });

      try {
        const values = {
          p1: 4,
          p2: 4,
          dias: 30,
          zonaFiscal: 'Península',
          viviendaCanarias: false,
          fechaYmd: '2026-03-21'
        };
        const fiscal = window.LF.__LF_getFiscalContext(values);
        const res = window.LF.calcularSunClub(values);

        const potencia = window.LF.round2((4 * 30 * window.LF_TARIFAS_ESPECIALES.sunClub.precios.p1) + (4 * 30 * window.LF_TARIFAS_ESPECIALES.sunClub.precios.p2));
        const consumo = 100 * window.LF_TARIFAS_ESPECIALES.sunClub.precios.energia;
        const tarifaAcceso = window.LF.round2(window.LF_CONFIG.calcularBonoSocial(30));
        const sumaBase = potencia + consumo + tarifaAcceso;
        const alquiler = window.LF.round2(window.LF_CONFIG.calcularAlquilerContador(30));
        const taxCalc = window.LF_CONFIG.calcularImpuestoIndirecto({
          zona: 'Península',
          usoFiscal: fiscal.usoFiscal,
          baseEnergia: sumaBase,
          impuestoElectrico: 20,
          baseContador: alquiler,
          potenciaContratada: fiscal.potenciaContratada,
          viviendaCanarias: false,
          fechaYmd: '2026-03-21'
        });
        const totalEsperado = window.LF.round2(sumaBase + 20 + alquiler + taxCalc.impuestoEnergia + taxCalc.impuestoContador);

        expect(window.LF_CONFIG.calcularIEE).toHaveBeenCalledWith(sumaBase, 100, '2026-03-21');
        expect(res.aPagar).toBeCloseTo(totalEsperado, 2);
      } finally {
        window.LF_CONFIG.calcularIEE = originalIEE;
        window.LF.consumosHorarios = null;
      }
    });

    it('Debe manejar Días = 0 usando valor por defecto (30 días)', async () => {
      window.LF.cachedTarifas = [{ nombre: "Zero Days", p1:0.1, p2:0.1, cPunta:0.1, cLlano:0.1, cValle:0.1, tipo:"1P" }];
      document.getElementById('dias').value = "0";
      document.getElementById('cPunta').value = "100";

      await window.LF.calculateLocal();
      const res = window.LF.state.rows[0];
      
      expect(Number.isFinite(res.totalNum)).toBe(true);
      // El sistema usa 30 dias por defecto si pones 0
      expect(res.potenciaNum).toBeGreaterThan(0);
    });

    it('Debe manejar Potencias = 0 kW', async () => {
      window.LF.cachedTarifas = [{ nombre: "Zero Power", p1:0.1, p2:0.1, cPunta:0.1, cLlano:0.1, cValle:0.1 }];
      document.getElementById('p1').value = "0";
      document.getElementById('p2').value = "0";
      document.getElementById('cPunta').value = "100";

      await window.LF.calculateLocal();
      const res = window.LF.state.rows[0];
      
      expect(res.potenciaNum).toBe(0);
      expect(res.totalNum).toBeGreaterThan(0); // Paga energia
    });

  });

});
