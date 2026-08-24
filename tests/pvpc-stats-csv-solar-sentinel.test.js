import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

/**
 * Integracion del consumidor real: `parseCsvOrXlsx` del observatorio (js/pvpc-stats-csv.js).
 *
 * Los tests de csv-hardening cubren el parser comun. Este cubre al llamante, que es donde
 * estaba el fallo: la rama XLSX usa politica 'warn' para que su parser alternativo tenga su
 * oportunidad. El parser comun clasifica por indice que columnas puede consumir el fallback;
 * una cabecera solar no resoluble como "Inyección a red (kWh)" debe bloquearse.
 */

function mockXLSX(data) {
  global.XLSX = {
    read: vi.fn(() => ({ SheetNames: ['Hoja1'], Sheets: { Hoja1: {} } })),
    utils: { sheet_to_json: vi.fn(() => data) }
  };
}

function fakeXlsxFile(name = 'excedentes.xlsx') {
  return {
    name,
    size: 1024,
    arrayBuffer: async () => new ArrayBuffer(8)
  };
}

const FILAS = [
  ['01/04/2026', '1', '0,5', '0,2'],
  ['01/04/2026', '2', '0,6', '0,3']
];

describe('Observatorio: centinela solar en la ruta XLSX', () => {
  let parseCsvOrXlsx;

  beforeAll(async () => {
    await import('../js/pvpc-stats-csv.js');
    parseCsvOrXlsx = window.LF.pvpcStatsCsvHelpers.parseCsvOrXlsx;
  });

  afterEach(() => { delete global.XLSX; });

  it('acepta la columna que SI resuelve el parser alternativo', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Energía exportada total (kWh)'], ...FILAS]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    const excedentes = res.records.map(r => r.excedente);
    expect(excedentes).toEqual([0.2, 0.3]);
  });

  it.each([
    'Inyección a red (kWh)',
    'Energía entregada a la red (kWh)',
    'Energía generada (kWh)'
  ])('FALLA con "%s": el fallback no la cubre y no puede salir con excedentes a cero', async (nombre) => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', nombre], ...FILAS]);
    await expect(parseCsvOrXlsx(fakeXlsxFile())).rejects.toThrow(/parece representar energía solar/i);
  });

  it('el fallo se clasifica como columna-solar en analitica', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Inyección a red (kWh)'], ...FILAS]);
    let lanzado = null;
    try { await parseCsvOrXlsx(fakeXlsxFile()); } catch (e) { lanzado = e; }
    expect(lanzado).not.toBeNull();
    expect(window.LF.csvUtils.csvErrorCodeForTracking(lanzado.message)).toBe('columna-solar');
  });

  it('no molesta cuando los excedentes se reconocen por alias normal', async () => {
    mockXLSX([['CUPS', 'Fecha', 'Hora', 'AE_kWh', 'AS_kWh'], ['ES1', '01/04/2026', '1', '0,5', '0,2']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.length).toBeGreaterThan(0);
  });

  it('un archivo de solo consumo sin rastro solar no se bloquea', async () => {
    mockXLSX([['CUPS', 'Fecha', 'Hora', 'Consumo_kWh'],
      ['ES1', '01/04/2026', '1', '0,5'], ['ES1', '01/04/2026', '2', '0,6']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.length).toBe(2);
  });

  it('propaga la zona de Canarias al normalizar el CCH-CONS de marzo', async () => {
    mockXLSX([
      ['Fecha', 'Hora', 'AE_kWh', 'AS_kWh'],
      ...Array.from({ length: 23 }, (_, index) => [
        '29/03/2026',
        String(index + 1),
        '0',
        '1'
      ])
    ]);

    const res = await parseCsvOrXlsx(fakeXlsxFile(), 'Canarias');

    expect(res.records.map(record => record.hora)).toEqual([
      1,
      ...Array.from({ length: 22 }, (_, index) => index + 3)
    ]);
  });
});

describe('Observatorio: divergencia entre el fallback y el centinela', () => {
  let parseCsvOrXlsx;

  beforeAll(async () => {
    await import('../js/pvpc-stats-csv.js');
    parseCsvOrXlsx = window.LF.pvpcStatsCsvHelpers.parseCsvOrXlsx;
  });

  afterEach(() => { delete global.XLSX; });

  it('NO toma "Export when" por excedentes: el fallback ya no puede elegir una columna que el centinela descarta', async () => {
    // includes('export') casaba con 'export_when' aunque el centinela lo descarta por no
    // tener contexto energetico. El fallback devolvia 7 y 8 como excedentes.
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Export when'],
      ['01/04/2026', '1', '0,5', '7'],
      ['01/04/2026', '2', '0,6', '8']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.every(r => !r.excedente)).toBe(true);
    expect((res.warnings || []).some(w => /parser alternativo/i.test(w))).toBe(false);
  });

  it('NO toma un precio de exportación en inglés por energía excedentaria', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Export price (€/kWh)'],
      ['01/04/2026', '1', '0,5', '0,06'],
      ['01/04/2026', '2', '0,6', '0,06']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.every(r => !r.excedente)).toBe(true);
    expect((res.warnings || []).some(w => /parser alternativo/i.test(w))).toBe(false);
  });

  it('FALLA si el fallback resuelve una columna pero queda otra columna solar pendiente', async () => {
    // 'Energia exportada total' a cero la resuelve el fallback; 'Inyeccion a red' trae los
    // valores reales y nadie la consume. Devolver los ceros seria el fallo silencioso.
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Energía exportada total (kWh)', 'Inyección a red (kWh)'],
      ['01/04/2026', '1', '0,5', '0', '0,2'],
      ['01/04/2026', '2', '0,6', '0', '0,3']]);
    await expect(parseCsvOrXlsx(fakeXlsxFile())).rejects.toThrow(/parece representar energía solar/i);
  });

  it('el fallo por columna pendiente nombra solo la que ha quedado sin consumir', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Energía exportada total (kWh)', 'Inyección a red (kWh)'],
      ['01/04/2026', '1', '0,5', '0', '0,2'],
      ['01/04/2026', '2', '0,6', '0', '0,3']]);
    let lanzado = null;
    try { await parseCsvOrXlsx(fakeXlsxFile()); } catch (e) { lanzado = e; }
    // Solo la primera linea: el sufijo "Cabeceras normalizadas detectadas" que anade
    // buildHeaderError lista TODAS las columnas a proposito, para ayudar al usuario.
    const primeraLinea = String(lanzado.message).split(/\r?\n/)[0];
    expect(primeraLinea).toMatch(/inyeccion_a_red_kwh/);
    expect(primeraLinea).not.toMatch(/exportada_total/);
  });

  it('acepta cuando el fallback resuelve la UNICA columna solar del archivo', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Energía exportada total (kWh)'],
      ['01/04/2026', '1', '0,5', '0,2'],
      ['01/04/2026', '2', '0,6', '0,3']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.map(r => r.excedente)).toEqual([0.2, 0.3]);
  });

  it('acepta exportada a cero cuando es la unica columna solar (ceros legitimos)', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Energía exportada total (kWh)'],
      ['01/04/2026', '1', '0,5', '0'],
      ['01/04/2026', '2', '0,6', '0']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.map(r => r.excedente)).toEqual([0, 0]);
  });

  it('conserva el soporte del fallback para "Exportación total" sin unidad', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'Exportación total'],
      ['01/04/2026', '1', '0,5', '0,2'],
      ['01/04/2026', '2', '0,6', '0,3']]);
    const res = await parseCsvOrXlsx(fakeXlsxFile());
    expect(res.records.map(r => r.excedente)).toEqual([0.2, 0.3]);
    expect(res.warnings).toContain('Importación XLSX: aplicado parser alternativo para excedentes.');
    expect(res.warnings).toContain('Formato horario ambiguo: no hay señal suficiente para distinguir 0-23 de 1-24. Se conserva 1-24 (CNMC).');
  });

  it('FALLA con AS_kWh a cero si queda una Inyección a red sin consumir', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'AS_kWh', 'Inyección a red (kWh)'],
      ['01/04/2026', '1', '0,5', '0', '0,2'],
      ['01/04/2026', '2', '0,6', '0', '0,3']]);
    await expect(parseCsvOrXlsx(fakeXlsxFile())).rejects.toThrow(/inyeccion_a_red_kwh/i);
  });

  it('FALLA antes del retorno temprano con AS_kWh positivo y otra columna solar pendiente', async () => {
    mockXLSX([['Fecha', 'Hora', 'Consumo (kWh)', 'AS_kWh', 'Inyección a red (kWh)'],
      ['01/04/2026', '1', '0', '0,1', '0,2'],
      ['01/04/2026', '2', '0', '0,1', '0,3']]);
    await expect(parseCsvOrXlsx(fakeXlsxFile())).rejects.toThrow(/inyeccion_a_red_kwh/i);
  });
});

// Auditoría temática de importaciones 24/08/2026: el alias XLSX de excedentes del
// Observatorio debe conservar su semántica, pero usar la normalización horaria/unidades
// y el rechazo de duplicados del parser canónico.
describe('Observatorio: fallback XLSX pasa por el parser horario canónico', () => {
  let parseCsvOrXlsx;

  beforeAll(async () => {
    await import('../js/pvpc-stats-csv.js');
    parseCsvOrXlsx = window.LF.pvpcStatsCsvHelpers.parseCsvOrXlsx;
  });

  afterEach(() => { delete global.XLSX; });

  it('normaliza 0-23 a hora CNMC 1-24 sin netear el excedente bruto contra Consumo', async () => {
    mockXLSX([
      ['Fecha', 'Hora', 'Consumo_kWh', 'Energía exportada total (kWh)'],
      ['02/01/2026', '0', '0,5', '1,5'],
      ['02/01/2026', '1', '0,6', '2,5'],
      ['02/01/2026', '4', '0,7', '3,5']
    ]);

    const res = await parseCsvOrXlsx(fakeXlsxFile(), 'Península');

    expect(res.records.map(r => r.hora)).toEqual([1, 2, 5]);
    expect(res.records.map(r => r.excedente)).toEqual([1.5, 2.5, 3.5]);
    expect(res.records.map(r => r.kwh)).toEqual([0, 0, 0]);
    expect(res.warnings).toContain('Ajustado formato de hora (0-23 → 1-24).');
  });

  it('convierte Wh a kWh también en el alias solar adicional', async () => {
    mockXLSX([
      ['Fecha', 'Hora', 'Consumo_kWh', 'Energía exportada total (Wh)'],
      ['02/01/2026', '1', '0,5', '1500'],
      ['02/01/2026', '2', '0,6', '2500']
    ]);

    const res = await parseCsvOrXlsx(fakeXlsxFile(), 'Península');

    expect(res.records.map(r => r.excedente)).toEqual([1.5, 2.5]);
    expect(res.warnings.some(w => /Wh detectados/.test(w))).toBe(true);
  });

  it('rechaza duplicados después de resolver la hora del alias adicional', async () => {
    mockXLSX([
      ['Fecha', 'Hora', 'Consumo_kWh', 'Energía exportada total (kWh)'],
      ['02/01/2026', '0', '0', '1'],
      ['02/01/2026', '0', '0', '2']
    ]);

    await expect(parseCsvOrXlsx(fakeXlsxFile(), 'Península')).rejects.toThrow(/filas duplicadas/i);
  });
});
