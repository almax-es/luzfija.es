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
await import('../js/bv/bv-ui-helpers.js');

describe('Productos monetarios decimales exactos', () => {
  const money = window.LF_CONFIG.roundMoneyProducts;
  const dividedMoney = window.LF_CONFIG.roundMoneyProductsDividedBy;

  it('redondea fronteras HALF_AWAY_FROM_ZERO sin producto binario previo', () => {
    expect(money([[85, 0.095]])).toBe(8.08);
    expect(money([[50, 0.1299]])).toBe(6.5);
    expect(money([[125, 0.01908]])).toBe(2.39);
    expect(money([[-85, 0.095]])).toBe(-8.08);
    expect(money([[0.005]])).toBe(0.01);
    expect(money([[-0.005]])).toBe(-0.01);
    expect(money([[0]])).toBe(0);
    expect(Object.is(money([[-0, 0.095]]), -0)).toBe(false);
  });

  it('conserva cadenas, seis decimales, consumos decimales y notación científica', () => {
    expect(money([['85', '0.095']])).toBe(8.08);
    expect(money([['8.5e1', '9.5e-2']])).toBe(8.08);
    expect(money([[10.25, 0.225589], [20.75, 0.141011]])).toBe(5.24);
    expect(money([['.5', '1.'], ['.5', '1e0']])).toBe(1);
  });

  it('mantiene la exactitud al prorratear productos por un divisor entero', () => {
    expect(dividedMoney([[5, 3.113, 365]], 365)).toBe(15.57);
    expect(dividedMoney([[-5, 3.113, 365]], 365)).toBe(-15.57);
    expect(dividedMoney([['5', '3.113', '365']], '365')).toBe(15.57);
    expect(dividedMoney([], 365)).toBe(0);

    for (const divisor of [0, -1, 1.5, '', null, Infinity]) {
      expect(Number.isNaN(dividedMoney([[1]], divisor))).toBe(true);
    }
  });

  it('rechaza entradas inválidas en vez de convertirlas silenciosamente en dinero', () => {
    for (const bad of [NaN, Infinity, -Infinity, '', ' ', null, undefined, true, false, '1,23', {}, []]) {
      expect(Number.isNaN(money([[bad]]))).toBe(true);
    }
    expect(Number.isNaN(money([['1e1001']]))).toBe(true);
    expect(Number.isNaN(money([[Number.MAX_SAFE_INTEGER + 1]]))).toBe(true);
    expect(Number.isNaN(money(Array.from({ length: 2001 }, () => [1])))).toBe(true);
    expect(Number.isNaN(money([[...Array(17).fill(1)]]))).toBe(true);
    expect(money([])).toBe(0);
  });

  it('reproduce Spock en home, desglose y simulador mensual con oráculos literales', async () => {
    const tarifas = JSON.parse(readFileSync('tarifas.json', 'utf8')).tarifas;
    const tarifa = tarifas.find((item) => item.nombre === 'Spock Tarifa Luz 24 Horas');
    expect(tarifa).toBeTruthy();

    let payload;
    window.LF.cachedTarifas = [tarifa];
    window.LF.state.useAnnualConsumptionEstimate = false;
    window.LF.renderAll = vi.fn((value) => { payload = value; });
    window.LF.yieldControl = vi.fn().mockResolvedValue(undefined);
    window.LF.ssaa._setDatasetForTests({ latest_value: 0, values: {} });

    const values = {
      p1: 4, p2: 4, dias: 30,
      cPunta: 85, cLlano: 0, cValle: 0,
      zonaFiscal: 'Península', viviendaCanarias: false,
      solarOn: false, exTotal: 0, bvSaldo: 0,
      bonoSocialOn: false, bonoSocialTipo: 'vulnerable', bonoSocialLimite: 1587,
      fechaYmd: '2026-09-30'
    };

    await window.LF.calculateLocal(values);
    const home = payload.resultados[0];

    const desglose = window.__LF_DesgloseFactura.calcularDesglose({
      potenciaP1: 4, potenciaP2: 4, dias: 30,
      precioP1: tarifa.p1, precioP2: tarifa.p2,
      consumoPunta: 85, consumoLlano: 0, consumoValle: 0,
      precioPunta: tarifa.cPunta, precioLlano: tarifa.cLlano, precioValle: tarifa.cValle,
      zonaFiscal: 'Península', esViviendaCanarias: false,
      solarOn: false, fechaYmd: '2026-09-30'
    });

    const bv = window.BVSim.calcMonthForTarifa({
      month: {
        key: '2026-09', daysWithData: 30, daysInMonth: 30,
        importByPeriod: { P1: 85, P2: 0, P3: 0 },
        importTotalKWh: 85, exportTotalKWh: 0
      },
      tarifa,
      potenciaP1: 4,
      potenciaP2: 4,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península',
      esVivienda: true
    });

    expect(home.consumoBaseNum).toBe(8.08);
    expect(home.totalNum).toBe(42.29);
    expect(desglose.consBase).toBe(8.08);
    expect(desglose.totalRanking).toBe(42.29);
    expect(bv.consBaseEur).toBe(8.08);
    expect(bv.totalPagar).toBe(42.29);
  });

  it('aplica el mismo contrato a SSAA y compensación fija', async () => {
    const ssaaDataset = {
      latest_complete_month: '2026-07',
      latest_value: 0.01908,
      values: { '2026-07': 0.01908 }
    };
    window.LF.ssaa._setDatasetForTests(ssaaDataset);
    const ssaa = window.LF.ssaa.calcCharge({ incluyeServiciosAjuste: false }, 125, ssaaDataset, '2026-07');
    expect(ssaa.eur).toBe(2.39);

    let payload;
    window.LF.cachedTarifas = [{
      nombre: 'Frontera compensación',
      p1: 0, p2: 0,
      cPunta: 0.1, cLlano: 0.1, cValle: 0.1,
      incluyeServiciosAjuste: true,
      tipo: '1P', esPVPC: false,
      fv: { exc: 0.06, tipo: 'SIMPLE', tope: 'ENERGIA', bv: false, precioBV: 0 }
    }];
    window.LF.renderAll = vi.fn((value) => { payload = value; });
    window.LF.yieldControl = vi.fn().mockResolvedValue(undefined);
    await window.LF.calculateLocal({
      p1: 0, p2: 0, dias: 30,
      cPunta: 100, cLlano: 0, cValle: 0,
      zonaFiscal: 'Península', viviendaCanarias: false,
      solarOn: true, exTotal: 34.25, bvSaldo: 0,
      bonoSocialOn: false, bonoSocialTipo: 'vulnerable', bonoSocialLimite: 1587,
      fechaYmd: '2026-09-30'
    });
    expect(payload.resultados[0].fvCredit1).toBe(2.06);
  });

  it('redondea exactamente el mínimo del IEE sin tocar el impuesto indirecto', () => {
    expect(window.LF_CONFIG.calcularIEERedondeado(0, 4015, '2026-09-30')).toBe(4.02);
    const fiscal = window.LF_CONFIG.calcularImpuestoIndirecto({
      zona: 'Península', baseEnergia: 21.5, potenciaContratada: 4
    });
    expect(fiscal.iva).toBe(4.52);
  });

  it('mantiene el ranking solar por totals.pagado y el desempate por bvFinal', () => {
    const source = readFileSync('js/bv/bv-ui.js', 'utf8');
    expect(source).toContain('compareRankedResultsByPaid');
    const compare = window.BVSim.manualUi.compareRankedResultsByPaid;
    const results = [
      { id: 'mas-cara', totals: { pagado: 10.01, bvFinal: 100 } },
      { id: 'empate-menor-bv', totals: { pagado: 10, bvFinal: 1 } },
      { id: 'empate-mayor-bv', totals: { pagado: 10, bvFinal: 2 } }
    ];
    expect(results.sort(compare).map((item) => item.id)).toEqual([
      'empate-mayor-bv',
      'empate-menor-bv',
      'mas-cara'
    ]);
  });
});
