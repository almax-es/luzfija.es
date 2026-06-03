import { describe, it, expect } from 'vitest';

// Cargamos el script. Al no ser un módulo ESM con export, Vitest/JSDOM lo ejecuta
// y el IIFE colgará LF_CONFIG del objeto global window.
import '../js/lf-config.js';

describe('LF_CONFIG - Lógica Fiscal', () => {
  
  it('Debe cargar correctamente en el objeto window', () => {
    expect(window.LF_CONFIG).toBeDefined();
    expect(window.LF_CONFIG.version).toMatch(/^\d{4}\.\d{2}$/);
  });

  it('Cálculo IEE: aplica el tipo general configurado si supera el mínimo', () => {
    const base = 100;
    const consumo = 0;
    const result = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-20');
    const expected = (window.LF_CONFIG.iee.porcentaje / 100) * base;
    expect(result).toBeCloseTo(expected, 4);
  });

  it('Cálculo IEE: ignora la fecha del periodo y mantiene el régimen actual', () => {
    const base = 100;
    const consumo = 0;
    const before = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-20');
    const after = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-21');
    expect(before).toBeCloseTo(5.11269632, 4);
    expect(after).toBeCloseTo(5.11269632, 4);
  });

  it('Cálculo IEE: mantiene el mínimo de 0,001€/kWh si es mayor que el porcentaje', () => {
    const base = 1; // Base muy pequeña
    const consumo = 100; // Consumo alto
    const result = window.LF_CONFIG.calcularIEE(base, consumo, '2026-03-21');
    const expected = Math.max(
      (window.LF_CONFIG.iee.porcentaje / 100) * base,
      consumo * window.LF_CONFIG.iee.minimoEurosKwh
    );
    expect(result).toBe(expected);
  });

  it('Península: aplica IVA 21% si la reducción temporal está desactivada', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 4.6,
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_general');
    expect(info.energiaRate).toBe(0.21);
    expect(info.contadorRate).toBe(0.21);
  });

  it('Península: aplica IVA 21% con 10 kW exactos aunque no haya bono social severo', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 10,
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_general');
    expect(info.energiaRate).toBe(0.21);
  });

  it('Península: aplica IVA 21% con 10 kW exactos aunque haya bono social vulnerable severo', () => {
    const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
      potenciaContratada: 10,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      fechaYmd: '2026-03-21'
    });
    expect(info.usoFiscal).toBe('iva_general');
    expect(info.energiaRate).toBe(0.21);
  });

  it('Península: aplica IVA 21% con 10 kW exactos aunque el bono social sea vulnerable no severo', () => {
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

  it('Canarias: aplica IGIC de servicios a cuotas no energéticas como la batería virtual', () => {
    const tax = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Canarias',
      usoFiscal: 'vivienda',
      baseEnergia: 100,
      impuestoElectrico: 5,
      baseContador: 1,
      baseServicios: 2,
      potenciaContratada: 4,
      viviendaCanarias: true
    });

    expect(tax.impuestoEnergia).toBe(0);
    expect(tax.impuestoContador).toBe(0.07);
    expect(tax.impuestoServicios).toBe(0.14);
    expect(tax.impuestoTotal).toBe(0.21);
  });

  it('Península: incluye las cuotas de servicios en la base de IVA', () => {
    const tax = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Península',
      baseEnergia: 100,
      impuestoElectrico: 5,
      baseContador: 1,
      baseServicios: 2,
      potenciaContratada: 4
    });

    expect(tax.ivaBase).toBe(108);
    expect(tax.iva).toBe(22.68);
  });

  it('Bono Social: Debe prorratear correctamente por días', () => {
    // 6.979247 anual
    const dias = 365;
    const result = window.LF_CONFIG.calcularBonoSocial(dias);
    expect(result).toBeCloseTo(6.979247, 6);
  });

  it('Guardrail: no mantiene configurada la rama temporal RDL 7/2026 retirada', () => {
    expect(window.LF_CONFIG.medidasTemporales).toBeUndefined();
  });

  describe('Régimen base vigente', () => {
    it('IEE: usa el tipo vigente 5,11269632%', () => {
      const info = window.LF_CONFIG.getIEEInfo('2026-07-15');
      expect(info.porcentaje).toBe(5.11269632);
      expect(info.reducidoTemporalmente).toBe(false);
    });

    it('IEE: el cálculo aplica la tasa base sobre la base imponible', () => {
      const base = 100;
      const consumo = 0;
      const result = window.LF_CONFIG.calcularIEE(base, consumo, '2026-07-15');
      expect(result).toBeCloseTo(base * 0.0511269632, 4);
    });

    it('IVA Península: no aplica el reducido al pasar por la ruta normal de uso fiscal', () => {
      // Pasamos 'otros' (no 'iva_general') para forzar la
      // resolución por contexto y demostrar que, aunque la potencia sea
      // elegible (≤10 kW), sin la medida activa no aplica el reducido.
      const info = window.LF_CONFIG.getImpuestoInfo('Península', 'otros', {
        potenciaContratada: 4.6,
        fechaYmd: '2026-07-15'
      });
      expect(info.usoFiscal).toBe('iva_general');
      expect(info.energiaRate).toBe(0.21);
      expect(info.contadorRate).toBe(0.21);
    });
  });
});
