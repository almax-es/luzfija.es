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

  it('Escenario 1: Península (<10kW) usa el IVA general del régimen actual', () => {
    const inputs = {
      dias: 30,
      zonaFiscal: 'Península',
      p1: 4.6,
      bonoSocialOn: false,
      fechaYmd: '2026-03-20'
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.meta.usoFiscal).toBe('iva_general');
    expect(res.meta.impuestoEnergia).toBeGreaterThan(0); // Debe haber IVA
    expect(res.meta.totalFactura).toBeGreaterThan(0);
  });

  it('Escenario 1b: Península (<10kW) mantiene IVA 21% aunque cambie la fecha', () => {
    const inputs = {
      dias: 30,
      p1: 4.6,
      zonaFiscal: 'Península',
      bonoSocialOn: false,
      fechaYmd: '2026-03-21'
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.meta.usoFiscal).toBe('iva_general');
    expect(res.meta.impuestoEnergia).toBeGreaterThan(0);
    expect(res.meta.iva).toBeCloseTo(res.meta.impuestoEnergia, 2);
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

  it('Escenario 5: Bono Social Vulnerable (Descuento 42,5%)', () => {
    const inputs = {
      dias: 30,
      bonoSocialOn: true,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: '9999', // Límite alto para aplicar a todo
      cPunta: 100, cLlano: 100, cValle: 100 // 300kWh
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    expect(res.descuentoEur).toBeGreaterThan(0);
    // Verificar que el % aplicado es aprox 42,5% (vulnerable, RDL 7/2026 vigente durante 2026)
    // Base descontable aprox: Fijo + Variable + Financiación = 10 + 50 + 1 = 61
    // Descuento esperado: 61 * 0.425 = ~25.93
    expect(res.descuentoEur).toBeCloseTo(25.93, 1);
  });

  it('Escenario 6: Bono Social Severo (Descuento 57,5%)', () => {
    const inputs = {
      dias: 30,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      bonoSocialLimite: '9999',
      cPunta: 100, cLlano: 100, cValle: 100
    };

    const res = calcPvpcBonoSocial(metaBase, inputs, global.window.LF_CONFIG);

    // Debe ser mayor que el vulnerable
    // Base 61 * 0.575 = ~35.08 (severo, RDL 7/2026 vigente durante 2026)
    expect(res.descuentoEur).toBeGreaterThan(30);
    expect(res.descuentoEur).toBeCloseTo(35.08, 1);
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
    // Aprox: (Fijo + (Variable * 0.1)) * 42,5%
    // (11 + 5) * 0.425 = 6.8
    // Si fuera total sería ~25.93
    expect(res.descuentoEur).toBeLessThan(15);
  });

});

// Casos reproducidos contra el simulador oficial de la CNMC (comparador.cnmc.gob.es/facturaluz,
// version 2.1.3, consultado el 08/10/2026): 3,5 kW, 29/12/2025-29/01/2026 (31 dias), Peninsula.
// Los importes de entrada (termino fijo, variable y financiacion) son los que devuelve la CNMC
// para ese periodo; los esperados, los de su factura. Hasta el 08/10/2026 la documentacion citaba
// para este caso una fraccion bonificable del 43,48 % que la CNMC no aplica: con el limite de
// 1.587 kWh/ano aplica el 60,99 %, igual que este motor.
describe('Paridad con el simulador oficial CNMC (PVPC, bono social)', () => {
  const { calcPvpcBonoSocial } = global.window.LF;
  const base = { dias: 31, zonaFiscal: 'Península', p1: 3.5, p2: 3.5, fechaYmd: '2026-01-29' };

  it('221 kWh con bono social vulnerable y limite 1.587 kWh: descuento, IEE y total al centimo', () => {
    const meta = { terminoFijo: 9.36, costeMargenPot: 0, terminoVariable: 33.72, bonoSocial: 0.58, equipoMedida: 0.83 };
    const res = calcPvpcBonoSocial(meta, {
      ...base,
      cPunta: 64, cLlano: 54, cValle: 103,
      bonoSocialOn: true, bonoSocialTipo: 'vulnerable', bonoSocialLimite: '1587'
    }, global.window.LF_CONFIG);

    // CNMC: "42,5% de (9,36 € + 0,58 € + 60,99 % de 33,72 €) = -12,96 €"
    expect(res.ratioBonificable).toBeCloseTo(0.6099, 4);
    expect(res.descuentoEur).toBe(12.96);
    // CNMC: "5,11% x (9,36 € + 33,72 € + 0,58 € - 12,96 €) = 1,57 €" (descuento ANTES del IEE)
    expect(res.meta.baseEnergia).toBe(30.70);
    expect(res.meta.impuestoElectrico).toBe(1.57);
    expect(res.meta.totalFactura).toBe(40.05);
  });

  it('mismo caso con vulnerable severo: 57,5% sobre la misma base', () => {
    const meta = { terminoFijo: 9.36, costeMargenPot: 0, terminoVariable: 33.72, bonoSocial: 0.58, equipoMedida: 0.83 };
    const res = calcPvpcBonoSocial(meta, {
      ...base,
      cPunta: 64, cLlano: 54, cValle: 103,
      bonoSocialOn: true, bonoSocialTipo: 'severo', bonoSocialLimite: '1587'
    }, global.window.LF_CONFIG);

    // CNMC: "57,5% de (9,36 € + 0,58 € + 60,99 % de 33,72 €) = -17,54 €", IEE 1,34 €, total 34,23 €
    expect(res.descuentoEur).toBe(17.54);
    expect(res.meta.impuestoElectrico).toBe(1.34);
    expect(res.meta.totalFactura).toBe(34.23);
  });

  it('septiembre de 2026 con la financiacion vigente de LF_CONFIG (9,011295 EUR/ano)', () => {
    // 31/08-30/09/2026, 4,6 kW, 90/80/150 kWh, vulnerable, 1.587 kWh. La financiacion NO se
    // pasa: la calcula LF_CONFIG, y la CNMC da 0,74 € para 30 dias con el mismo valor anual.
    const meta = { terminoFijo: 11.92, costeMargenPot: 0, terminoVariable: 59.81, equipoMedida: 0.80 };
    const res = calcPvpcBonoSocial(meta, {
      dias: 30, zonaFiscal: 'Península', p1: 4.6, p2: 4.6, fechaYmd: '2026-09-30',
      cPunta: 90, cLlano: 80, cValle: 150,
      bonoSocialOn: true, bonoSocialTipo: 'vulnerable', bonoSocialLimite: '1587'
    }, global.window.LF_CONFIG);

    // CNMC: "42,5% de (11,92 € + 0,74 € + 40,76 % de 59,81 €) = -15,74 €", IEE 2,90 €, total 73,12 €
    expect(res.meta.bonoSocial).toBe(0.74);
    expect(res.descuentoEur).toBe(15.74);
    expect(res.meta.impuestoElectrico).toBe(2.90);
    expect(res.meta.totalFactura).toBe(73.12);
  });

  it('0 kWh sin bono social: el IEE sigue existiendo sobre la potencia', () => {
    const meta = { terminoFijo: 9.36, costeMargenPot: 0, terminoVariable: 0, bonoSocial: 0.58, equipoMedida: 0.83 };
    const res = calcPvpcBonoSocial(meta, { ...base, bonoSocialOn: false }, global.window.LF_CONFIG);

    expect(res.meta.impuestoElectrico).toBe(0.51);
    expect(res.meta.totalFactura).toBe(13.65);
  });
});
