import { describe, it, expect, beforeAll } from 'vitest';

// Cargamos el script. Al no ser un módulo ESM con export, Vitest/JSDOM lo ejecuta
// y el IIFE colgará LF_CONFIG del objeto global window.
import '../js/lf-config.js';

describe('LF_CONFIG - Lógica Fiscal', () => {
  
  it('Debe cargar correctamente en el objeto window', () => {
    expect(window.LF_CONFIG).toBeDefined();
    expect(window.LF_CONFIG.version).toMatch(/^\d{4}\.\d{2}$/);
  });

  it('Cálculo IEE: aplica el 0,5% configurado si supera el mínimo', () => {
    const base = 100;
    const consumo = 0;
    const result = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-20');
    const expected = (window.LF_CONFIG.medidasTemporales.rdl72026.ieePorcentajeReducido / 100) * base;
    expect(result).toBeCloseTo(expected, 4);
  });

  it('Cálculo IEE: ignora la fecha del periodo y mantiene el régimen actual', () => {
    const base = 100;
    const consumo = 0;
    const before = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-20');
    const after = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-21');
    expect(before).toBeCloseTo(0.5, 4);
    expect(after).toBeCloseTo(0.5, 4);
  });

  it('Cálculo IEE: mantiene el mínimo de 0,001€/kWh si es mayor que el porcentaje', () => {
    const base = 1; // Base muy pequeña
    const consumo = 100; // Consumo alto
    const result = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-21');
    const expected = Math.max(
      (0.5 / 100) * base,
      consumo * window.LF_CONFIG.iee.minimoEurosKwh
    );
    expect(result).toBe(expected);
  });

  it('Península: aplica IVA 10% si la potencia es inferior a 10 kW', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 4.6,
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_reducido');
    expect(info.energiaRate).toBe(0.10);
    expect(info.contadorRate).toBe(0.10);
  });

  it('Península: mantiene IVA 21% con 10 kW exactos si no hay bono social severo', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 10,
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_general');
    expect(info.energiaRate).toBe(0.21);
  });

  it('Península: aplica IVA 10% con 10 kW exactos si hay bono social vulnerable severo', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 10,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_reducido');
    expect(info.energiaRate).toBe(0.10);
  });

  it('Península: no aplica IVA 10% con 10 kW exactos si el bono social es vulnerable no severo', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 10,
      bonoSocialOn: true,
      bonoSocialTipo: 'vulnerable',
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_general');
    expect(info.energiaRate).toBe(0.21);
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
