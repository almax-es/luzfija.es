import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

document.body.innerHTML = '<div></div>';
window.lfDbg = () => {};
window.LF = window.LF || {};

await import('../js/lf-utils.js');
await import('../js/lf-ssaa.js');
await import('../js/lf-state.js');
await import('../js/lf-config.js');
await import('../js/lf-inputs.js');
await import('../js/lf-csv-utils.js');
await import('../js/lf-calc.js');
await import('../js/desglose-calculo.js');
await import('../js/bv/bv-sim-monthly.js');

describe('Redondeo exacto de bases fiscales monetarias', () => {
  it('alinea home, simulador BV y desglose en la frontera IGIC de CHC VE 3P', async () => {
    const tarifas = JSON.parse(readFileSync('tarifas.json', 'utf8')).tarifas;
    const tarifa = tarifas.find((item) => item.nombre === 'CHC VE 3P');
    let payload;
    window.LF.cachedTarifas = [tarifa];
    window.LF.ssaa._setDatasetForTests({
      latest_complete_month: '2026-07',
      latest_value: 0.01908,
      values: { '2026-07': 0.01908 }
    });
    window.LF.state.useAnnualConsumptionEstimate = false;
    window.LF.renderAll = vi.fn((value) => { payload = value; });
    window.LF.yieldControl = vi.fn().mockResolvedValue(undefined);

    const values = {
      p1: 0,
      p2: 6.37,
      dias: 30,
      cPunta: 208.37,
      cLlano: 122.73,
      cValle: 95.27,
      zonaFiscal: 'Canarias',
      viviendaCanarias: false,
      solarOn: true,
      exTotal: 4.99,
      bvSaldo: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587,
      fechaYmd: '2026-09-30'
    };
    await window.LF.calculateLocal(values);
    const home = payload.resultados[0];

    const bv = window.BVSim.calcMonthForTarifa({
      month: {
        key: '2026-09',
        daysWithData: 30,
        daysInMonth: 30,
        importByPeriod: { P1: 208.37, P2: 122.73, P3: 95.27 },
        importTotalKWh: 426.37,
        exportTotalKWh: 4.99
      },
      tarifa,
      potenciaP1: 0,
      potenciaP2: 6.37,
      bvSaldoPrev: 0,
      zonaFiscal: 'Canarias',
      esVivienda: false
    });

    const desglose = window.__LF_DesgloseFactura.calcularDesglose({
      potenciaP1: 0,
      potenciaP2: 6.37,
      dias: 30,
      precioP1: tarifa.p1,
      precioP2: tarifa.p2,
      consumoPunta: 208.37,
      consumoLlano: 122.73,
      consumoValle: 95.27,
      precioPunta: tarifa.cPunta,
      precioLlano: tarifa.cLlano,
      precioValle: tarifa.cValle,
      excedentes: 4.99,
      precioCompensacion: tarifa.fv.exc,
      tipoCompensacion: tarifa.fv.tipo,
      topeCompensacion: tarifa.fv.tope,
      bateriaVirtual: 0,
      tieneBV: false,
      precioBV: 0,
      incluyeServiciosAjuste: true,
      zonaFiscal: 'Canarias',
      esViviendaCanarias: false,
      solarOn: true,
      fechaYmd: '2026-09-30'
    });

    expect(home.totalNum).toBe(106.44);
    expect(bv.totalPagar).toBe(106.44);
    expect(desglose.totalRanking).toBe(106.44);
    expect(desglose.igicBase).toBe(3.08);
  });

  it('redondea hacia arriba los medios céntimos exactos de IVA, IGIC e IPSI', () => {
    const peninsula = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Península',
      baseEnergia: 21.5,
      potenciaContratada: 4
    });
    const canarias = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Canarias',
      usoFiscal: 'otros',
      baseEnergia: 68.5,
      potenciaContratada: 4,
      viviendaCanarias: false
    });
    const ceutaMelilla = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'CeutaMelilla',
      baseEnergia: 401.5,
      potenciaContratada: 4
    });

    expect(peninsula.iva).toBe(4.52);
    expect(canarias.impuestoEnergia).toBe(2.06);
    expect(ceutaMelilla.impuestoEnergia).toBe(4.02);
  });
});
