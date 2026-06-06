import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// 1. Setup del entorno JSDOM simulado
document.body.innerHTML = '<div></div>';

// 2. Mockear dependencias globales
window.lfDbg = () => {}; // Mock debug function
window.LF = window.LF || {};
import '../js/lf-config.js';

// Cargar el script a testear
import '../js/desglose-factura.js';

describe('Desglose de Factura (desglose-factura.js)', () => {

  const Desglose = window.__LF_DesgloseFactura;

  // Función helper para formatear números como lo hace el código (round2)
  const round2 = (n) => Math.round(n * 100) / 100;

  it('Debe calcular correctamente un desglose BÁSICO (Península) con el régimen actual', () => {
    const datos = {
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: 0.1, precioP2: 0.1, // 4*30*0.1 = 12€ c/u -> 24€ Potencia
      consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
      precioPunta: 0.1, precioLlano: 0.1, precioValle: 0.1, // 100*0.1 = 10€ Energía
      zonaFiscal: 'Península',
      fechaFin: '20/03/2026',
      solarOn: false
    };

    const res = Desglose.calcularDesglose(datos);

    // Potencia: 12 + 12 = 24
    expect(res.pot).toBe(24.00);
    
    // Consumo: 10
    expect(res.cons).toBe(10.00);
    
    const ieeEsperado = round2(window.LF_CONFIG.calcularIEE(res.pot + res.cons + res.tarifaAcceso, 100, '2026-03-20'));
    expect(res.impuestoElec).toBeCloseTo(ieeEsperado, 2);

    // Alquiler: 0.81 * 12 / 365 * 30 = 0.7989... -> 0.80
    expect(res.alquilerContador).toBeCloseTo(0.80, 2);

    const baseIVA = res.pot + res.cons + res.tarifaAcceso + res.impuestoElec + res.alquilerContador;
    const ivaRate = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 4,
      fechaYmd: '2026-03-20'
    }).energiaRate;
    const ivaEsperado = round2(baseIVA * ivaRate);
    expect(res.iva).toBe(ivaEsperado);

    // Total final
    expect(res.totalFinal).toBe(round2(baseIVA + ivaEsperado));
  });

  it('Muestra SSAA como sublínea de consumo y lo incluye en bases fiscales', () => {
    Desglose.init();

    const datos = {
      nombreTarifa: 'Sin SSAA',
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: 0.1, precioP2: 0.1,
      consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
      precioPunta: 0.1, precioLlano: 0.1, precioValle: 0.1,
      incluyeServiciosAjuste: false,
      ssaaNum: 2,
      ssaaRate: 0.02,
      ssaaMonth: '2026-04',
      zonaFiscal: 'Península',
      fechaFin: '20/03/2026',
      solarOn: false
    };

    const res = Desglose.calcularDesglose(datos);
    Desglose.renderizar(res, datos);

    expect(res.consBase).toBe(10);
    expect(res.ssaa).toBe(2);
    expect(res.cons).toBe(12);
    expect(res.sumaBase).toBeCloseTo(res.pot + res.cons + res.tarifaAcceso, 2);
    expect(Desglose.modal.querySelector('.desglose-body').textContent).toContain('Servicios de ajuste');
  });

  it('Debe mantener IVA 21% e IEE general aunque cambie la fecha del periodo en Península <10kW', () => {
    const datos = {
      potenciaP1: 4.6, potenciaP2: 4.6, dias: 30,
      precioP1: 0.1, precioP2: 0.1,
      consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
      precioPunta: 0.1, precioLlano: 0.1, precioValle: 0.1,
      zonaFiscal: 'Península',
      fechaFin: '21/03/2026',
      solarOn: false
    };

    const res = Desglose.calcularDesglose(datos);
    const ieeEsperado = round2(window.LF_CONFIG.calcularIEE(res.pot + res.cons + res.tarifaAcceso, 100, '2026-03-21'));
    const ivaRate = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 4.6,
      fechaYmd: '2026-03-21'
    }).energiaRate;
    const baseIVA = res.pot + res.cons + res.tarifaAcceso + res.impuestoElec + res.alquilerContador;

    expect(res.impuestoElec).toBeCloseTo(ieeEsperado, 2);
    expect(ivaRate).toBe(0.21);
    expect(res.iva).toBe(round2(baseIVA * ivaRate));
  });

  it('Debe manejar CANARIAS (IGIC)', () => {
    // Caso "Otros" (no vivienda con <10kW) para ver IGIC 3%
    const datos = {
      potenciaP1: 15, potenciaP2: 15, dias: 30, // >10kW -> Uso "otros"
      precioP1: 0.1, precioP2: 0.1,
      consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
      precioPunta: 0.1,
      zonaFiscal: 'Canarias',
      esViviendaCanarias: false
    };

    const res = Desglose.calcularDesglose(datos);

    expect(res.isCanarias).toBe(true);
    expect(res.iva).toBeUndefined();
    
    // IGIC Base: 3% de (Energia + IEE)
    expect(res.igicBase).toBeGreaterThan(0);
    
    // IGIC Contador: 7%
    expect(res.igicContador).toBeGreaterThan(0);
  });

  it('Debe manejar compensación de EXCEDENTES (Simple)', () => {
    const datos = {
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: 0.1, precioP2: 0.1,
      consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
      precioPunta: 0.2, // 20€ consumo
      excedentes: 50,
      precioCompensacion: 0.1, // 5€ compensación
      tipoCompensacion: 'SIMPLE',
      solarOn: true
    };

    const res = Desglose.calcularDesglose(datos);

    expect(res.cons).toBe(20.00);
    expect(res.credit1).toBe(5.00); // 50 * 0.1
    expect(res.consAdj).toBe(15.00); // 20 - 5
    expect(res.excedenteSobranteEur).toBe(0);
  });

  it('Debe aplicar BATERÍA VIRTUAL (BV)', () => {
    const datos = {
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: 0.1, precioP2: 0.1,
      consumoPunta: 100, // 20€
      precioPunta: 0.2,
      excedentes: 0,
      tipoCompensacion: 'SIMPLE + BV',
      bateriaVirtual: 50, // Tenemos 50€ guardados
      tieneBV: true,
      solarOn: true,
      zonaFiscal: 'Península'
    };

    const res = Desglose.calcularDesglose(datos);

    // Factura total base antes de BV (aprox 50-60€)
    expect(res.totalBase).toBeGreaterThan(50);

    // El crédito aplicado es el menor entre (totalBase) y (saldoBV)
    const expectedCredit = Math.min(res.totalBase, 50);
    
    // Ajustar por posibles redondeos (±0.01)
    expect(res.credit2).toBeCloseTo(expectedCredit, 2); 
    
    expect(res.totalFinal).toBeCloseTo(res.totalBase - expectedCredit, 2);
    
    // Saldo final: saldoPrev - usado
    // 50 - 50 = 0
    expect(res.bvSaldoFin).toBeCloseTo(0, 2);
  });

  it('Debe explicar compensación parcial con BV acumulando el sobrante no usado', () => {
    Desglose.init();

    const datos = {
      nombreTarifa: 'Esluz 3P',
      potenciaP1: 4.5,
      potenciaP2: 5,
      dias: 30,
      precioP1: 0.080533,
      precioP2: 0.007407,
      consumoPunta: 52.48,
      consumoLlano: 50.24,
      consumoValle: 193.29,
      precioPunta: 0.187021,
      precioLlano: 0.135066,
      precioValle: 0.085298,
      excedentes: 364.30,
      precioCompensacion: 0.08,
      tipoCompensacion: 'SIMPLE + BV',
      topeCompensacion: 'ENERGIA_PARCIAL',
      bateriaVirtual: 0,
      tieneBV: true,
      solarOn: true,
      zonaFiscal: 'Península',
      fechaFin: '06/05/2026'
    };

    const desglose = Desglose.calcularDesglose(datos);
    Desglose.renderizar(desglose, datos);

    const bodyText = Desglose.modal.querySelector('.desglose-body').textContent;
    expect(desglose.credit1).toBeCloseTo(25.86, 2);
    expect(desglose.excedenteNoCompensableEur).toBeCloseTo(3.28, 2);
    expect(desglose.excedenteSobranteEur).toBeCloseTo(3.28, 2);
    expect(desglose.bvSaldoFin).toBeCloseTo(3.28, 2);
    expect(desglose.totalRanking).toBeCloseTo(desglose.totalBase - 3.28, 2);
    expect(bodyText).toContain('pasan a tu Batería Virtual');
    expect(bodyText).toContain('A batería virtual');
  });

  it('Debe renderizar (smoke test)', () => {
    // Verificar que la función renderizar no explota
    Desglose.init(); // Crea el DOM
    
    const datos = {
      nombreTarifa: "Test Tarifa",
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: 0.1, precioP2: 0.1,
      consumoPunta: 100,
      precioPunta: 0.1,
      zonaFiscal: 'Península'
    };
    
    const desglose = Desglose.calcularDesglose(datos);
    Desglose.renderizar(desglose, datos);

    const tarifaDiv = Desglose.modal.querySelector('.desglose-tarifa');
    const body = Desglose.modal.querySelector('.desglose-body');
    
    expect(tarifaDiv.innerHTML).toContain('Test Tarifa');
    expect(body.innerHTML).toContain('TOTAL FACTURA');
  });

  it('Muestra índice base en lugar de estimado para excedentes indexados con trazabilidad horaria', () => {
    Desglose.init();

    const datos = {
      nombreTarifa: 'Indexada Solar',
      potenciaP1: 4,
      potenciaP2: 4,
      dias: 30,
      precioP1: 0.1,
      precioP2: 0.1,
      consumoPunta: 100,
      precioPunta: 0.2,
      excedentes: 50,
      precioCompensacion: 0.078,
      precioCompensacionIndexada: true,
      precioCompensacionSource: 'hourly-index-base',
      tipoCompensacion: 'SIMPLE',
      topeCompensacion: 'ENERGIA',
      solarOn: true,
      zonaFiscal: 'Península',
      fechaFin: '20/03/2026'
    };

    const desglose = Desglose.calcularDesglose(datos);
    Desglose.renderizar(desglose, datos);

    const bodyText = Desglose.modal.querySelector('.desglose-body').textContent;
    expect(bodyText).toContain('índice base');
    expect(bodyText).toContain('Cálculo según índice base');
    expect(bodyText).not.toContain('(est.)');
  });

});
