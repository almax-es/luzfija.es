import { describe, it, expect } from 'vitest';

// Tests de propiedades matematicas del motor de desglose con entradas adversarias:
// invariantes que deben cumplirse para CUALQUIER entrada valida (finitud, no-negatividad,
// monotonia, tope de compensacion y reconstruccion fiscal independiente por zona).
document.body.innerHTML = '<div></div>';
window.lfDbg = () => {};
window.LF = window.LF || {};
import '../js/lf-config.js';
import '../js/desglose-calculo.js';
import '../js/desglose-render.js';
import '../js/desglose-factura.js';

const D = window.__LF_DesgloseFactura;

function base(over = {}) {
  return {
    nombreTarifa: 'X',
    potenciaP1: 4, potenciaP2: 4, dias: 30,
    precioP1: 0.1, precioP2: 0.1,
    consumoPunta: 100, consumoLlano: 50, consumoValle: 50,
    precioPunta: 0.15, precioLlano: 0.12, precioValle: 0.08,
    zonaFiscal: 'Península',
    fechaFin: '20/06/2026',
    solarOn: false,
    ...over
  };
}

describe('Propiedades matematicas del desglose (adversario)', () => {
  const zonas = ['Península', 'Canarias', 'CeutaMelilla'];
  const diasGrid = [1, 28, 30, 31, 365];
  const consGrid = [0, 1, 500, 10000, 1000000];

  it('total siempre finito y no negativo con entradas validas extremas', () => {
    for (const zonaFiscal of zonas) {
      for (const dias of diasGrid) {
        for (const c of consGrid) {
          const r = D.calcularDesglose(base({ zonaFiscal, dias, consumoPunta: c, consumoLlano: 0, consumoValle: 0 }));
          expect(Number.isFinite(r.totalFinal), `${zonaFiscal} dias=${dias} c=${c} total=${r.totalFinal}`).toBe(true);
          expect(r.totalFinal, `${zonaFiscal} dias=${dias} c=${c}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('monotonia: mas consumo nunca abarata la factura', () => {
    for (const zonaFiscal of zonas) {
      let prev = -Infinity;
      for (const c of consGrid) {
        const r = D.calcularDesglose(base({ zonaFiscal, consumoPunta: c }));
        expect(r.totalFinal, `${zonaFiscal} c=${c}: ${r.totalFinal} < ${prev}`).toBeGreaterThanOrEqual(prev - 0.011);
        prev = r.totalFinal;
      }
    }
  });

  it('la compensacion de excedentes nunca deja el termino de energia negativo', () => {
    // excedentes muy superiores al consumo (caso real: verano solar)
    for (const ex of [100, 500, 5000, 100000]) {
      const r = D.calcularDesglose(base({
        solarOn: true,
        excedentes: ex,
        precioCompensacion: 0.10,
        tipoCompensacion: 'SIMPLE',
        topeCompensacion: 'ENERGIA',
        consumoPunta: 50, consumoLlano: 0, consumoValle: 0
      }));
      expect(r.cons, `ex=${ex} cons=${r.cons}`).toBeGreaterThanOrEqual(-0.005);
      expect(Number.isFinite(r.totalFinal)).toBe(true);
      expect(r.totalFinal).toBeGreaterThanOrEqual(0);
    }
  });

  it('coherencia interna: el IVA/IGIC/IPSI aplicado coincide con el tipo vigente de la zona', () => {
    for (const zonaFiscal of zonas) {
      const r = D.calcularDesglose(base({ zonaFiscal }));
      const info = window.LF_CONFIG.getImpuestoInfo(zonaFiscal, 'otros', { potenciaContratada: 4, fechaYmd: '2026-06-20' });
      // reconstruccion independiente de la base del impuesto indirecto
      if (zonaFiscal === 'Península') {
        const baseIVA = r.pot + r.cons + r.tarifaAcceso + r.impuestoElec + r.alquilerContador;
        const esperado = Math.round(baseIVA * info.energiaRate * 100) / 100;
        expect(Math.abs(r.iva - esperado), `${zonaFiscal}: iva=${r.iva} esperado=${esperado}`).toBeLessThanOrEqual(0.011);
        expect(Number.isFinite(r.iva)).toBe(true);
        expect(r.iva).toBeGreaterThanOrEqual(0);
      } else if (zonaFiscal === 'Canarias') {
        // vivienda <=10kW: IGIC energia 0%
        const rViv = D.calcularDesglose(base({ zonaFiscal, esViviendaCanarias: true }));
        expect(rViv.igicBase, 'Canarias vivienda: IGIC energia debe ser 0').toBe(0);
        // otros usos: IGIC energia 3% sobre base energia+IEE
        const rOtros = D.calcularDesglose(base({ zonaFiscal, esViviendaCanarias: false }));
        const infoOtros = window.LF_CONFIG.getImpuestoInfo('Canarias', 'otros', { potenciaContratada: 4, fechaYmd: '2026-06-20' });
        const baseIgic = rOtros.pot + rOtros.cons + rOtros.tarifaAcceso + rOtros.impuestoElec;
        const esperadoIgic = Math.round(baseIgic * infoOtros.energiaRate * 100) / 100;
        expect(Math.abs(rOtros.igicBase - esperadoIgic), `Canarias otros: igic=${rOtros.igicBase} esperado=${esperadoIgic}`).toBeLessThanOrEqual(0.011);
        expect(Number.isFinite(rOtros.igicContador)).toBe(true);
        expect(rOtros.igicBase).toBeGreaterThan(0);
      } else {
        // CeutaMelilla: IPSI 1% energia sobre base+IEE, 4% contador
        const baseIpsi = r.pot + r.cons + r.tarifaAcceso + r.impuestoElec;
        const esperadoIpsi = Math.round(baseIpsi * info.energiaRate * 100) / 100;
        expect(Math.abs(r.ipsiEnergia - esperadoIpsi), `CeutaMelilla: ipsi=${r.ipsiEnergia} esperado=${esperadoIpsi}`).toBeLessThanOrEqual(0.011);
        expect(Number.isFinite(r.ipsiContador)).toBe(true);
        expect(r.ipsiEnergia).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('dias extremos con BV y bono social simultaneos no rompen el calculo', () => {
    for (const dias of [1, 365]) {
      const r = D.calcularDesglose(base({
        dias,
        solarOn: true,
        excedentes: 200,
        precioCompensacion: 0.08,
        tipoCompensacion: 'SIMPLE + BV',
        topeCompensacion: 'ENERGIA',
        bateriaVirtual: 50,
        tieneBV: true,
        esPVPC: false
      }));
      expect(Number.isFinite(r.totalFinal), `dias=${dias}`).toBe(true);
      expect(r.totalFinal).toBeGreaterThanOrEqual(0);
    }
  });

  it('strings numericos y undefined en campos opcionales no producen NaN', () => {
    const r = D.calcularDesglose(base({
      consumoPunta: '100', consumoLlano: undefined, consumoValle: null,
      ssaaNum: 'abc', ssaaRate: undefined,
      excedentes: undefined
    }));
    expect(Number.isFinite(r.totalFinal), `total=${r.totalFinal}`).toBe(true);
  });
});
