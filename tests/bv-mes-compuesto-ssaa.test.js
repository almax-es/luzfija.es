import { describe, it, expect } from 'vitest';

// Motor mensual real + configuracion fiscal + helper de SSAA: este test entra por
// calcMonthForTarifa, no por el helper aislado, porque el fallo que cubre solo se ve cuando la
// fila compuesta llega al calculo economico completo.
import '../js/lf-config.js';
import '../js/lf-csv-utils.js';
import '../js/lf-ssaa.js';
import '../js/bv/bv-sim-monthly.js';

// Un historico de 365 dias que empieza a mitad de mes deja un mes cosido con tramos de dos años.
// Los SSAA son un dataset mensual historico: si el mes compuesto pide la tasa con una sola clave,
// los dias del otro año pagan una tasa que no es la suya. En el caso real que lo destapo, ademas,
// la clave del tramo reciente NO estaba publicada y caia al valor de reserva, descartando la tasa
// publicada del tramo que aporta DOS TERCIOS del consumo.
describe('BVSim - SSAA de un mes compuesto por dos tramos', () => {
  const dataset = {
    latest_complete_month: '2026-08',
    latest_value: 0.01883,
    values: { '2025-09': 0.01755, '2026-08': 0.01883 }
  };

  const tarifaConSsaa = {
    nombre: 'Dummy con SSAA repercutidos',
    tipo: '1P',
    p1: 0.1,
    p2: 0.1,
    cPunta: 0.1,
    cLlano: 0.1,
    cValle: 0.1,
    incluyeServiciosAjuste: false,
    fv: { exc: 0, bv: false }
  };

  const mesCompuesto = (over = {}) => Object.assign({
    key: '2026-09',
    daysWithData: 30,
    daysInMonth: 30,
    importByPeriod: { P1: 60, P2: 60, P3: 60 },
    importTotalKWh: 180,
    exportTotalKWh: 0,
    segments: [
      { key: '2025-09', from: 11, to: 30, days: 20, kwh: 120 },
      { key: '2026-09', from: 1, to: 10, days: 10, kwh: 60 }
    ]
  }, over);

  const calc = (month, tarifa = tarifaConSsaa) => window.BVSim.calcMonthForTarifa({
    month,
    tarifa,
    potenciaP1: 4.6,
    potenciaP2: 4.6,
    bvSaldoPrev: 0,
    zonaFiscal: 'Península',
    ssaaDataset: dataset
  });

  it('cobra cada tramo a la tasa de su propio mes', () => {
    const res = calc(mesCompuesto());

    // 120 x 0,01755 + 60 x 0,01883 = 2,1060 + 1,1298 = 3,2358
    expect(res.ssaaEur).toBeCloseTo(3.24, 2);
    expect(res.ssaaApplied).toBe(true);
    expect(res.ssaaMonth).toBe('2025-09 + 2026-08');
  });

  it('no cobra los 30 dias a la tasa de la clave de la fila', () => {
    // Regresion: con month.key ('2026-09', no publicado -> reserva 2026-08) todo el mes pagaria
    // 180 x 0,01883 = 3,39 EUR, sobrecobrando a los 20 dias que si tienen tasa publicada.
    const res = calc(mesCompuesto());

    expect(res.ssaaEur).not.toBeCloseTo(3.39, 2);
    expect(res.ssaaEur).toBeLessThan(3.39);
  });

  it('el coste de energia del mes incluye el SSAA por tramos, no solo el desglose', () => {
    const conTramos = calc(mesCompuesto());
    const sinTramos = calc(mesCompuesto({ segments: undefined }));

    // La diferencia tiene que llegar al importe, no quedarse en un campo informativo.
    expect(sinTramos.ssaaEur).toBeGreaterThan(conTramos.ssaaEur);
    expect(sinTramos.consEur - conTramos.consEur).toBeCloseTo(sinTramos.ssaaEur - conTramos.ssaaEur, 2);
    expect(sinTramos.totalPagar).toBeGreaterThan(conTramos.totalPagar);
  });

  it('kWh x tasa devuelta cuadra con el importe cobrado', () => {
    // El desglose pinta "consumo x tasa = importe" y no puede contradecir al importe.
    const res = calc(mesCompuesto());

    expect(180 * res.ssaaRate).toBeCloseTo(res.ssaaEur, 2);
  });

  it('un mes de un solo tramo sigue usando su propia clave', () => {
    const res = calc(mesCompuesto({ key: '2025-09', segments: undefined }));

    expect(res.ssaaMonth).toBe('2025-09');
    expect(res.ssaaEur).toBeCloseTo(180 * 0.01755, 2);
  });

  it('marca el mes como no valorable si a un tramo le falta la tasa', () => {
    const res = window.BVSim.calcMonthForTarifa({
      month: mesCompuesto(),
      tarifa: tarifaConSsaa,
      potenciaP1: 4.6,
      potenciaP2: 4.6,
      bvSaldoPrev: 0,
      zonaFiscal: 'Península',
      ssaaDataset: { latest_complete_month: null, latest_value: null, values: { '2025-09': 0.01755 } }
    });

    expect(res.dataUnavailable).toBe(true);
    expect(Number.isNaN(res.ssaaEur)).toBe(true);
  });

  it('una tarifa que ya incluye los servicios de ajuste no paga nada por los tramos', () => {
    const res = calc(mesCompuesto(), Object.assign({}, tarifaConSsaa, { incluyeServiciosAjuste: true }));

    expect(res.ssaaEur).toBe(0);
    expect(res.ssaaApplied).toBe(false);
  });
});
