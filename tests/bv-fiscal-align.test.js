import { describe, it, expect } from 'vitest';

// Cargar configuración fiscal real y el motor BV.
import '../js/lf-config.js';
import '../js/lf-csv-utils.js';
import '../js/bv/bv-sim-monthly.js';

describe('BVSim - Fiscalidad alineada con comparador principal', () => {
  const r2 = (n) => window.BVSim.round2(n);

  it('IEE: la base incluye la financiación del bono social (costeBonoSocial)', () => {
    const dias = 30;
    const month = {
      key: '2025-01',
      daysWithData: dias,
      importByPeriod: { P1: 0, P2: 0, P3: 0 },
      importTotalKWh: 0,
      exportTotalKWh: 0
    };

    const tarifa = {
      nombre: 'Dummy',
      tipo: '1P',
      p1: 0.1,
      p2: 0.1,
      cPunta: 0.1,
      cLlano: 0.1,
      cValle: 0.1,
      fv: { exc: 0, bv: false }
    };

    const res = window.BVSim.calcMonthForTarifa({
      month,
      tarifa,
      potenciaP1: 0,
      potenciaP2: 0,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península'
    });

    const bono = r2(window.LF_CONFIG.calcularBonoSocial(dias));
    const expectedIEE = r2(window.LF_CONFIG.calcularIEE(bono, 0, '2025-01-31'));

    expect(res.costeBonoSocial).toBeCloseTo(bono, 6);
    expect(res.impuestoElec).toBeCloseTo(expectedIEE, 2);
    expect(res.impuestoElec).toBeGreaterThanOrEqual(0);
  });

  it('Canarias vivienda: IGIC energia 0%, pero IGIC contador 7% sigue aplicando', () => {
    const dias = 30;
    const month = {
      key: '2025-01',
      daysWithData: dias,
      importByPeriod: { P1: 0, P2: 0, P3: 0 },
      importTotalKWh: 0,
      exportTotalKWh: 0
    };

    const tarifa = {
      nombre: 'Dummy',
      tipo: '1P',
      p1: 0.1,
      p2: 0.1,
      cPunta: 0.1,
      cLlano: 0.1,
      cValle: 0.1,
      fv: { exc: 0, bv: false }
    };

    const res = window.BVSim.calcMonthForTarifa({
      month,
      tarifa,
      potenciaP1: 3,
      potenciaP2: 3,
      bvSaldoPrev: 0,
      zonaFiscal: 'Canarias',
      esVivienda: true
    });

    const alquiler = r2(window.LF_CONFIG.calcularAlquilerContador(dias));
    const expectedIgicContador = r2(alquiler * 0.07);

    // Con consumo=0 y vivienda<=10kW, igicEnergia es 0; solo queda el del contador.
    expect(res.impuestoIndirectoTipo).toBe('IGIC');
    expect(res.ivaCuota).toBeCloseTo(expectedIgicContador, 2);
    expect(res.ivaCuota).toBeGreaterThan(0);
  });

  it('Ceuta/Melilla: IPSI energia 1% y contador 4% (no 1% sobre todo)', () => {
    const dias = 30;
    const month = {
      key: '2025-01',
      daysWithData: dias,
      importByPeriod: { P1: 0, P2: 0, P3: 0 },
      importTotalKWh: 0,
      exportTotalKWh: 0
    };

    const tarifa = {
      nombre: 'Dummy',
      tipo: '1P',
      p1: 0.1,
      p2: 0.1,
      cPunta: 0.1,
      cLlano: 0.1,
      cValle: 0.1,
      fv: { exc: 0, bv: false }
    };

    const res = window.BVSim.calcMonthForTarifa({
      month,
      tarifa,
      potenciaP1: 0,
      potenciaP2: 0,
      bvSaldoPrev: 0,
      zonaFiscal: 'CeutaMelilla',
      esVivienda: true
    });

    const bono = r2(window.LF_CONFIG.calcularBonoSocial(dias));
    const iee = r2(window.LF_CONFIG.calcularIEE(bono, 0, '2025-01-31'));
    const alquiler = r2(window.LF_CONFIG.calcularAlquilerContador(dias));
    const expectedEnergia = r2((bono + iee) * 0.01);
    const expectedContador = r2(alquiler * 0.04);
    const expectedIPSI = r2(expectedEnergia + expectedContador);

    expect(res.impuestoIndirectoTipo).toBe('IPSI');
    expect(res.ivaCuota).toBeCloseTo(expectedIPSI, 2);
  });

  it('Península: la cuota de batería virtual es base neta y soporta IVA', () => {
    const dias = 30;
    const month = {
      key: '2025-01',
      daysWithData: dias,
      daysInMonth: 30,
      importByPeriod: { P1: 0, P2: 0, P3: 0 },
      importTotalKWh: 0,
      exportTotalKWh: 0
    };

    const tarifaSinCuota = {
      nombre: 'Sin cuota',
      tipo: '1P',
      p1: 0,
      p2: 0,
      cPunta: 0,
      cLlano: 0,
      cValle: 0,
      fv: { exc: 0, bv: true, precioBV: 0 }
    };
    const tarifaConCuota = {
      ...tarifaSinCuota,
      nombre: 'Con cuota',
      fv: { exc: 0, bv: true, precioBV: 2 }
    };

    const base = window.BVSim.calcMonthForTarifa({
      month,
      tarifa: tarifaSinCuota,
      potenciaP1: 0,
      potenciaP2: 0,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península'
    });
    const conCuota = window.BVSim.calcMonthForTarifa({
      month,
      tarifa: tarifaConCuota,
      potenciaP1: 0,
      potenciaP2: 0,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península'
    });

    expect(conCuota.costeBV).toBe(2);
    expect(conCuota.totalBase).toBeCloseTo(r2(base.totalBase + 2 + 2 * 0.21), 2);
  });
});

