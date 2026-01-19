import { describe, it, expect, beforeAll } from 'vitest';

// Cargamos el script. Al no ser un módulo ESM con export, Vitest/JSDOM lo ejecuta
// y el IIFE colgará LF_CONFIG del objeto global window.
import '../js/lf-config.js';

describe('LF_CONFIG - Lógica Fiscal', () => {
  
  it('Debe cargar correctamente en el objeto window', () => {
    expect(window.LF_CONFIG).toBeDefined();
    expect(window.LF_CONFIG.version).toBe('2026.01');
  });

  it('Cálculo IEE: Debe aplicar el 5.11269632% correctamente', () => {
    const base = 100;
    const consumo = 0;
    const result = window.LF_CONFIG.calcularIEE(base, consumo);
    // 5.11269632
    expect(result).toBeCloseTo(5.1127, 4);
  });

  it('Cálculo IEE: Debe aplicar el mínimo de 0,001€/kWh si es mayor que el porcentaje', () => {
    const base = 1; // Base muy pequeña
    const consumo = 100; // Consumo alto
    // % -> 0.0511
    // Mínimo (100 * 0.001) -> 0.10
    const result = window.LF_CONFIG.calcularIEE(base, consumo);
    expect(result).toBe(0.10);
  });

  it('Canarias: Debe tener IGIC 0% para energía en viviendas', () => {
    const canarias = window.LF_CONFIG.getTerritorio('Canarias');
    expect(canarias.impuestos.energiaVivienda).toBe(0);
    expect(canarias.impuestos.tipo).toBe('IGIC');
  });

  it('Bono Social: Debe prorratear correctamente por días', () => {
    // 6.979247 anual
    const dias = 365;
    const result = window.LF_CONFIG.calcularBonoSocial(dias);
    expect(result).toBeCloseTo(6.979247, 6);
  });
});
