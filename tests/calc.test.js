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
    // Zona: Península (IVA 21%, IEE 5.11%)
    
    const tarifaTest = {
      nombre: "Tarifa Test",
      p1: 0.10, p2: 0.10,
      cPunta: 0.10, cLlano: 0.10, cValle: 0.10,
      tipo: "1P",
      esPVPC: false
    };
    window.LF.cachedTarifas = [tarifaTest];

    // Configurar inputs
    document.getElementById('p1').value = "4";
    document.getElementById('p2').value = "4";
    document.getElementById('dias').value = "30";
    document.getElementById('cPunta').value = "100"; // 100 kWh total (punta)
    document.getElementById('cLlano').value = "0";
    document.getElementById('cValle').value = "0";
    document.getElementById('zonaFiscal').value = "Península";

    // Ejecutar cálculo
    await window.LF.calculateLocal();

    // Verificaciones
    const resultado = window.LF.state.rows[0];
    
    // 1. Coste Potencia: (4kW * 0.10 * 30) + (4kW * 0.10 * 30) = 12 + 12 = 24 €
    expect(resultado.potenciaNum).toBeCloseTo(24.00, 2);

    // 2. Coste Energía: 100 kWh * 0.10 = 10 €
    expect(resultado.consumoNum).toBeCloseTo(10.00, 2);

    // 3. IEE: 5.11269632% de (24 + 10) = 1.738...
    // 4. Alquiler Contador: ~0.81€ (aprox, depende de LF_CONFIG)
    // 5. IVA: 21% sobre todo
    
    // Verificamos que el total es coherente (aprox 43-44€)
    expect(resultado.totalNum).toBeGreaterThan(40);
    expect(resultado.totalNum).toBeLessThan(50);
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

});
