import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// 1. Setup del entorno JSDOM simulado
document.body.innerHTML = '<div></div>';

// 2. Mockear dependencias globales
window.lfDbg = () => {}; // Mock debug function
window.LF = window.LF || {};
window.LF_CONFIG = {
  bonoSocial: { eurosAnuales: 10 },
  iee: { porcentaje: 5.11269632, minimoEurosKwh: 0.0005 }, // 5.11% aprox
  alquilerContador: { eurosMes: 0.81 },
  getTerritorio: (zona) => {
    if (zona === 'Canarias') {
      return { impuestos: { energiaOtros: 0.03, contador: 0.07 } }; // IGIC 3% y 7%
    }
    if (zona === 'CeutaMelilla') {
      return { impuestos: { energia: 0.01, contador: 0.04 } }; // IPSI 1% y 4%
    }
    return { impuestos: { energia: 0.21 } }; // IVA 21%
  }
};

// Cargar el script a testear
import '../js/desglose-factura.js';

describe('Desglose de Factura (desglose-factura.js)', () => {

  const Desglose = window.__LF_DesgloseFactura;

  // Función helper para formatear números como lo hace el código (round2)
  const round2 = (n) => Math.round(n * 100) / 100;

  it('Debe calcular correctamente un desglose BÁSICO (Península)', () => {
    const datos = {
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: 0.1, precioP2: 0.1, // 4*30*0.1 = 12€ c/u -> 24€ Potencia
      consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
      precioPunta: 0.1, precioLlano: 0.1, precioValle: 0.1, // 100*0.1 = 10€ Energía
      zonaFiscal: 'Península',
      solarOn: false
    };

    const res = Desglose.calcularDesglose(datos);

    // Potencia: 12 + 12 = 24
    expect(res.pot).toBe(24.00);
    
    // Consumo: 10
    expect(res.cons).toBe(10.00);
    
    // Impuesto Eléctrico (IEE): 5.11269632% de (24+10 + tasaAcceso)
    // Tasa acceso (bono social): 10€/año -> 10/365 * 30 = 0.8219...
    // Base IEE: 24 + 10 + 0.82... = 34.82...
    // IEE: 34.82 * 0.0511... = ~1.78
    expect(res.impuestoElec).toBeGreaterThan(1.70);
    expect(res.impuestoElec).toBeLessThan(1.90);

    // Alquiler: 0.81 * 12 / 365 * 30 = 0.7989... -> 0.80
    expect(res.alquilerContador).toBeCloseTo(0.80, 2);

    // IVA 21% sobre todo
    const baseIVA = res.pot + res.cons + res.tarifaAcceso + res.impuestoElec + res.alquilerContador;
    const ivaEsperado = round2(baseIVA * 0.21);
    expect(res.iva).toBe(ivaEsperado);

    // Total final
    expect(res.totalFinal).toBe(round2(baseIVA + ivaEsperado));
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

    const tarifaDiv = document.querySelector('.desglose-tarifa');
    const body = document.querySelector('.desglose-body');
    
    expect(tarifaDiv.innerHTML).toContain('Test Tarifa');
    expect(body.innerHTML).toContain('TOTAL FACTURA');
  });

});