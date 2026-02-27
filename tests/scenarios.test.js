import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Simulamos el entorno global
global.window = {
  LF: {
    round2: (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
    // Debug mock
    lfDbg: vi.fn()
  },
  LF_CONFIG: null // Se cargará abajo
};

// Cargamos los scripts necesarios para la lógica de negocio
const configCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-config.js'), 'utf8');
const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-utils.js'), 'utf8');

// Ejecutamos los scripts en el contexto global
new Function('window', 'global', configCode)(global.window, global.window);
// utils necesita que LF_CONFIG ya exista en window (que lo hace por la línea anterior)
new Function('window', utilsCode)(global.window);

describe('Escenarios de Negocio (Integración Fiscal y Bono Social)', () => {
  const { calcPvpcBonoSocial } = global.window.LF;

  // Mock básico de metadatos PVPC
  const metaBase = {
    terminoFijo: 10.00,
    terminoVariable: 50.00,
    bonoSocial: 1.00, // Financiación fija
    equipoMedida: 0.81
  };

  it('Escenario 1: Península (IVA Normal)', () => {
    const inputs = {
      dias: 30,
      zonaFiscal: 'Península',
      bonoSocialOn: false
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);
    
    // Península: IVA se aplica sobre (Energía + Potencia + IEE + Alquiler)
    // Esperamos usoFiscal: 'iva'
    expect(res.meta.usoFiscal).toBe('iva');
    expect(res.meta.impuestoEnergia).toBeGreaterThan(0); // Debe haber IVA
    expect(res.meta.totalFactura).toBeGreaterThan(61.81); // Base aprox
  });

  it('Escenario 2: Canarias Vivienda (<10kW) -> IGIC 0% en energía', () => {
    const inputs = {
      dias: 30,
      p1: 4.6, // < 10kW
      zonaFiscal: 'Canarias',
      viviendaCanarias: true,
      bonoSocialOn: false
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.meta.usoFiscal).toBe('vivienda');
    // En Canarias vivienda <10kW, el impuesto sobre la energía es 0
    expect(res.meta.impuestoEnergia).toBe(0);
    // Pero SÍ se paga impuesto sobre el contador
    expect(res.meta.impuestoContador).toBeGreaterThan(0);
  });

  it('Escenario 3: Canarias Alta Potencia (>10kW) -> IGIC 3%', () => {
    const inputs = {
      dias: 30,
      p1: 15.0, // > 10kW
      zonaFiscal: 'Canarias',
      viviendaCanarias: true, // Aunque marque vivienda, la potencia manda
      bonoSocialOn: false
    };

    // Recalculamos metaBase con p1 alto para ser realistas (aunque calcPvpcBonoSocial usa inputs.p1 para lógica)
    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.meta.usoFiscal).toBe('otros'); // Ya no es 'vivienda' fiscalmente para el tipo 0
    // Ahora SÍ debe haber impuesto sobre energía (3% o lo que marque config)
    expect(res.meta.impuestoEnergia).toBeGreaterThan(0);
  });

  it('Escenario 4: Ceuta y Melilla (IPSI)', () => {
    const inputs = {
      dias: 30,
      zonaFiscal: 'CeutaMelilla',
      bonoSocialOn: false
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.meta.usoFiscal).toBe('ipsi');
    expect(res.meta.baseIPSI).toBeGreaterThan(0);
  });

  it('Escenario 5: Bono Social Vulnerable (Descuento 42.5%)', () => {
    const inputs = {
      dias: 30,
      bonoSocialOn: true,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: '9999', // Límite alto para aplicar a todo
      cPunta: 100, cLlano: 100, cValle: 100 // 300kWh
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.descuentoEur).toBeGreaterThan(0);
    // Verificar que el % aplicado es aprox 35% (vulnerable, RD 897/2017 vigente desde 26/02/2026)
    // Base descontable aprox: Fijo + Variable + Financiación = 10 + 50 + 1 = 61
    // Descuento esperado: 61 * 0.35 = ~21.35
    expect(res.descuentoEur).toBeCloseTo(21.35, 0);
  });

  it('Escenario 6: Bono Social Severo (Descuento 57.5%)', () => {
    const inputs = {
      dias: 30,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      bonoSocialLimite: '9999',
      cPunta: 100, cLlano: 100, cValle: 100
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    // Debe ser mayor que el vulnerable
    // Base 61 * 0.50 = ~30.50 (severo, RD 897/2017 vigente desde 26/02/2026)
    expect(res.descuentoEur).toBeGreaterThan(25);
    expect(res.descuentoEur).toBeCloseTo(30.50, 0);
  });

  it('Escenario 7: Límite Energía Bono Social', () => {
    // Caso donde consumes MÁS de lo que cubre el bono
    // Límite anual muy bajo: 365 kWh -> 1 kWh al día -> 30 kWh al mes
    // Consumo real: 300 kWh
    const inputs = {
      dias: 30,
      bonoSocialOn: true,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: '365', // Muy bajo
      cPunta: 100, cLlano: 100, cValle: 100 // Total 300
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    // Solo se debe bonificar 30kWh de los 300kWh (10%)
    expect(res.ratioBonificable).toBeCloseTo(0.1, 1);
    
    // El descuento será mucho menor que si cubriera todo
    // Aprox: (Fijo + (Variable * 0.1)) * 35%
    // (11 + 5) * 0.35 = 5.6
    // Si fuera total sería ~21.35
    expect(res.descuentoEur).toBeLessThan(15);
  });

});
