import { describe, it, expect } from 'vitest';
import '../js/lf-config.js';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';
import '../js/bv/bv-sim-monthly.js';

// Ronda 46: bucketizeByMonth sumaba los kWh horarios en coma flotante y redondeaba el resto:
// 0,128 + 0,835 + 0,545 + 0,255 + 0,962 = 2.7249999999999996 -> 2,72, cuando la suma decimal
// exacta es 2,725 -> 2,73. Todas las horas son punta de un miercoles laborable.
describe('bucketizeByMonth redondea la suma exacta de kWh', () => {
  it('consumo, total y excedentes', () => {
    const valores = [0.128, 0.835, 0.545, 0.255, 0.962];
    const horas = [11, 12, 13, 20, 21];
    const registros = valores.map((v, i) => ({ fecha: new Date(2025, 0, 15), hora: horas[i], kwh: v, excedente: v }));
    const [mes] = window.BVSim.bucketizeByMonth(registros, 'Península');
    expect(mes.importByPeriod.P1).toBe(2.73);
    expect(mes.importTotalKWh).toBe(2.73);
    expect(mes.exportTotalKWh).toBe(2.73);
  });

  it('una suma exacta que round2 no sabe redondear (311,525 * 100 = 31152,4999...)', () => {
    const registros = [{ fecha: new Date(2025, 7, 13), hora: 12, kwh: 311.525, excedente: 311.525 }];
    const [mes] = window.BVSim.bucketizeByMonth(registros, 'Península');
    expect(mes.importTotalKWh).toBe(311.53);
    expect(mes.exportTotalKWh).toBe(311.53);
  });
});
