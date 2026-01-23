import { describe, it, expect, beforeAll } from 'vitest';

// 1. Setup del entorno JSDOM simulado
document.body.innerHTML = '<div id="test"></div>';

// 2. Mockear dependencias globales
window.LF = window.LF || {};
window.LF_CONFIG = window.LF_CONFIG || {};
window.BVSim = window.BVSim || {};

// Mockear configuración fiscal básica si no se carga lf-config.js
if (!window.LF_CONFIG.bonoSocial) {
  window.LF_CONFIG.bonoSocial = { eurosAnuales: 10 }; // Valor fijo para tests
}
if (!window.LF_CONFIG.alquilerContador) {
  window.LF_CONFIG.alquilerContador = { eurosMes: 0.81 };
}

// Cargar el módulo bajo test
import '../js/bv/bv-sim-monthly.js';

describe('Simulador Solar Mensual (bv-sim-monthly.js)', () => {

  // Datos de prueba: 3 registros en enero, 2 en febrero
  const mockRecords = [
    // Enero: 10 kWh consumo, 5 kWh excedente
    { fecha: new Date('2025-01-01T10:00:00'), kwh: 5, excedente: 2, periodo: 'P1' },
    { fecha: new Date('2025-01-01T11:00:00'), kwh: 5, excedente: 3, periodo: 'P1' },
    // Febrero: 20 kWh consumo, 0 kWh excedente
    { fecha: new Date('2025-02-01T10:00:00'), kwh: 20, excedente: 0, periodo: 'P1' },
  ];

  it('bucketizeByMonth: Debe agrupar registros correctamente por mes', () => {
    const buckets = window.BVSim.bucketizeByMonth(mockRecords);

    expect(buckets).toHaveLength(2); // Enero y Febrero

    // Validar Enero
    const jan = buckets.find(b => b.key === '2025-01');
    expect(jan).toBeDefined();
    expect(jan.importTotalKWh).toBe(10); // 5 + 5
    expect(jan.exportTotalKWh).toBe(5);  // 2 + 3
    expect(jan.daysWithData).toBe(1);    // Solo hay datos del día 1

    // Validar Febrero
    const feb = buckets.find(b => b.key === '2025-02');
    expect(feb).toBeDefined();
    expect(feb.importTotalKWh).toBe(20);
    expect(feb.exportTotalKWh).toBe(0);
  });

  it('simulateForTarifaDemo: Debe calcular factura básica SIN batería virtual', () => {
    // Tarifa simple: energía 0.10, excedentes 0.05
    const tarifaSimple = {
      nombre: "Simple",
      p1: 0.1, p2: 0.1,
      cPunta: 0.1, cLlano: 0.1, cValle: 0.1,
      fv: { exc: 0.05, bv: false } // SIN BV
    };

    // Mes de prueba: 100 kWh consumo, 20 kWh excedente
    // Coste Energía: 100 * 0.10 = 10€
    // Compensación: 20 * 0.05 = 1€
    // Total Energía Neta: 9€
    const mockMonth = {
      key: '2025-01',
      daysWithData: 30,
      importByPeriod: { P1: 100, P2: 0, P3: 0 },
      importTotalKWh: 100,
      exportTotalKWh: 20
    };

    const res = window.BVSim.calcMonthForTarifa({
      month: mockMonth,
      tarifa: tarifaSimple,
      potenciaP1: 1, potenciaP2: 1, // Potencias bajas para simplificar
      bvSaldoPrev: 0,
      zonaFiscal: 'Península'
    });

    // Validar cálculos
    expect(res.consEur).toBeCloseTo(10.00, 2); // 10€ bruto
    expect(res.credit1).toBeCloseTo(1.00, 2);  // 1€ compensado
    expect(res.excedenteSobranteEur).toBe(0);  // No sobra nada
    expect(res.bvSaldoFin).toBe(0);            // No acumula (sin BV)
  });

  it('simulateForTarifaDemo: Debe acumular saldo en Batería Virtual (BV)', () => {
    // Tarifa con BV: energía 0.10, excedentes 0.10 (muy altos para que sobre)
    const tarifaBV = {
      nombre: "Con BV",
      p1: 0.1, p2: 0.1,
      cPunta: 0.1, cLlano: 0.1, cValle: 0.1,
      fv: { exc: 0.10, bv: true } // CON BV
    };

    // Mes con MUCHO sol: 10 kWh consumo (1€), 100 kWh excedente (10€)
    // Energía: 1€
    // Compensación posible: 10€
    // Compensación aplicada: 1€ (límite 0€ factura energía)
    // Sobrante: 9€ -> A la hucha
    const mockMonth = {
      key: '2025-06',
      daysWithData: 30,
      importByPeriod: { P1: 10, P2: 0, P3: 0 },
      importTotalKWh: 10,
      exportTotalKWh: 100
    };

    const res = window.BVSim.calcMonthForTarifa({
      month: mockMonth,
      tarifa: tarifaBV,
      potenciaP1: 1, potenciaP2: 1,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península'
    });

    expect(res.consEur).toBeCloseTo(1.00, 2);
    expect(res.credit1).toBeCloseTo(1.00, 2); // Compensa hasta llegar a 0 energía
    expect(res.excedenteSobranteEur).toBeCloseTo(9.00, 2); // Sobran 9€
    expect(res.bvSaldoFin).toBeGreaterThan(8); // Debe haber acumulado saldo (restará impuestos si aplica)
  });

  it('simulateForTarifaDemo: Debe usar saldo BV del mes anterior', () => {
    // Tarifa con BV
    const tarifaBV = {
      nombre: "Con BV",
      p1: 0.1, p2: 0.1,
      cPunta: 0.1, cLlano: 0.1, cValle: 0.1,
      fv: { exc: 0.05, bv: true }
    };

    // Mes de invierno: 100 kWh consumo (10€), 0 excedente
    // Pero venimos con 50€ en la hucha
    const mockMonth = {
      key: '2025-12',
      daysWithData: 30,
      importByPeriod: { P1: 100, P2: 0, P3: 0 },
      importTotalKWh: 100,
      exportTotalKWh: 0
    };

    const res = window.BVSim.calcMonthForTarifa({
      month: mockMonth,
      tarifa: tarifaBV,
      potenciaP1: 1, potenciaP2: 1,
      bvSaldoPrev: 50.00, // Saldo previo
      zonaFiscal: 'Península'
    });

    // La factura base será: Potencia + Energía + Impuestos (aprox 15-20€)
    expect(res.totalBase).toBeGreaterThan(10);
    
    // Como tenemos 50€ de saldo, debemos pagar 0€
    expect(res.totalPagar).toBe(0);
    
    // Y nos debe sobrar saldo (50 - factura)
    expect(res.bvSaldoFin).toBeLessThan(50);
    expect(res.bvSaldoFin).toBeGreaterThan(20);
  });

});
