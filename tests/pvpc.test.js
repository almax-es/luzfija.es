import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Simulamos el entorno del navegador
global.window = {
  location: { hostname: 'localhost', search: '' },
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  },
  LF: {} 
};
global.fetch = vi.fn();

// Cargar dependencias necesarias
const loadScript = (filePath) => {
  const code = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
  const fn = new Function('window', 'location', 'localStorage', code);
  fn(global.window, global.window.location, global.window.localStorage);
};

// Activar debug para ver errores internos
global.window.__LF_DEBUG = true;

// Cargar config real antes que utilidades dependientes
loadScript('../js/lf-config.js');
// Cargar lf-utils primero (pvpc.js usa window.LF)
loadScript('../js/lf-utils.js');
// Cargar el clasificador horario canónico usado por el modo híbrido
loadScript('../js/lf-csv-utils.js');
// Cargar pvpc.js
loadScript('../js/pvpc.js');

describe('PVPC Engine (js/pvpc.js)', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.window.localStorage.getItem.mockReturnValue(null);
    vi.spyOn(console, 'log'); // Espiar logs
    delete global.window.LF.consumosHorarios;
    delete global.window.LF.pvpcPeriodoCSV;
  });

  // Helper para generar datos horarios para un dia
  function generateMockDayPrices(p1, p2, p3) {
    const prices = [];
    // Timestamp base: 7 Enero 2025 00:00 UTC (1736208000)
    // PERO Madrid esta en UTC+1. Para que las horas casen (h=0 -> 00:00 Madrid),
    // el timestamp debe ser 23:00 UTC del dia anterior.
    // 1736208000 - 3600 = 1736204400
    const baseTs = 1736204400; 
    
    // 0-8h: Valle (P3)
    for(let h=0; h<8; h++) prices.push([baseTs + h*3600, p3]);
    // 8-10h: Llano (P2)
    for(let h=8; h<10; h++) prices.push([baseTs + h*3600, p2]);
    // 10-14h: Punta (P1)
    for(let h=10; h<14; h++) prices.push([baseTs + h*3600, p1]);
    // 14-18h: Llano (P2)
    for(let h=14; h<18; h++) prices.push([baseTs + h*3600, p2]);
    // 18-22h: Punta (P1)
    for(let h=18; h<22; h++) prices.push([baseTs + h*3600, p1]);
    // 22-24h: Llano (P2)
    for(let h=22; h<24; h++) prices.push([baseTs + h*3600, p2]);
    return prices;
  }

  function generateDstFallbackDayPrices() {
    const prices = [];
    const baseTs = Date.parse('2024-10-26T22:00:00Z') / 1000; // 00:00 local del 27/10/2024

    for (let i = 0; i < 25; i++) {
      const ts = baseTs + i * 3600;
      let price = 0.10;
      if (i === 2) price = 0.20; // primera 02:00 local
      if (i === 3) price = 0.50; // segunda 02:00 local (hora 25)
      prices.push([ts, price]);
    }

    return prices;
  }

  function generateDstSpringForwardDayPrices() {
    const prices = [];
    const baseTs = Date.parse('2026-03-28T23:00:00Z') / 1000; // 00:00 local del 29/03/2026

    for (let i = 0; i < 23; i++) {
      const ts = baseTs + i * 3600;
      let price = 0.10;
      if (i === 2) price = 0.50; // 03:00 local; la hora 02:00 no existe
      prices.push([ts, price]);
    }

    return prices;
  }

  it('obtenerPVPC_LOCAL debe descargar y calcular precios medios correctamente', async () => {
    const apiP1 = 0.20;
    const apiP2 = 0.10;
    const apiP3 = 0.05;

    // Mock del JSON mensual
    const mockJson = {
      geo_id: 8741,
      // Proveemos datos para varios dias por si la logica interna usa "ayer" o "hoy"
      days: {
        '2025-01-07': generateMockDayPrices(apiP1, apiP2, apiP3), // Ayer
        '2025-01-08': generateMockDayPrices(apiP1, apiP2, apiP3)  // Hoy (mockeado)
      },
      meta: { max_after_conversion: 0.20 }
    };

    global.fetch.mockImplementation((url) => {
      console.log('DEBUG TEST FETCH:', url);
      return Promise.resolve({
        ok: true,
        json: async () => mockJson
      });
    });

    // Inputs del usuario (simulados)
    // El sistema de PVPC usa estos inputs para saber que rango de fechas descargar
    // dias=1, fecha fin = hoy (simulada)
    // PERO obtenerPVPC_LOCAL calcula la fecha internamente basandose en "hoy".
    // Tenemos que mockear Date para que "hoy" sea 2025-01-08
    
    const mockDate = new Date('2025-01-08T12:00:00Z');
    vi.setSystemTime(mockDate);

    const inputs = {
      zonaFiscal: 'Península',
      p1: 3.45, p2: 3.45,
      dias: 1,
      cPunta: 10, cLlano: 10, cValle: 10
    };

    // Ejecutar
    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL(inputs);
    
    console.log('DEBUG RESULT:', JSON.stringify(result, null, 2));

    // Verificaciones
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toBeDefined();
    
    // La logica interna de PVPC calcula medias.
    // Como hemos puesto precios fijos constantes, la media debe ser exacta.
    expect(result.precioPunta).toBeCloseTo(apiP1, 3);
    expect(result.precioLlano).toBeCloseTo(apiP2, 3);
    expect(result.precioValle).toBeCloseTo(apiP3, 3);
    
    vi.useRealTimers();
  });

  it('obtenerPVPC_LOCAL debe manejar errores de red', async () => {
    global.fetch.mockRejectedValue(new Error('Network fail'));
    
    const inputs = { zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1 };
    
    // No debe lanzar excepcion, sino devolver null (y loguear error)
    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL(inputs);

    expect(result).toBeNull();
  });

  it('crearTarifaPVPC aplica el régimen fiscal actual aunque el periodo PVPC cierre ayer', async () => {
    const apiP1 = 0.20;
    const apiP2 = 0.10;
    const apiP3 = 0.05;
    const mockJson = {
      geo_id: 8741,
      days: {
        '2026-03-20': generateMockDayPrices(apiP1, apiP2, apiP3)
      },
      meta: { max_after_conversion: 0.20 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));

    const tarifa = await global.window.LF.pvpc.crearTarifaPVPC({
      zonaFiscal: 'Península',
      p1: 4,
      p2: 4,
      dias: 1,
      cPunta: 10,
      cLlano: 10,
      cValle: 10,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    expect(tarifa).toBeTruthy();
    expect(tarifa.metaPvpc.fechaYmd).toBe('2026-03-21');
    expect(tarifa.metaPvpc.usoFiscal).toBe('iva_general');

    const baseIEE = tarifa.metaPvpc.terminoFijo
      + tarifa.metaPvpc.costeMargenPot
      + tarifa.metaPvpc.terminoVariable
      + tarifa.metaPvpc.bonoSocial;
    const expectedIEE = Math.round(global.window.LF_CONFIG.calcularIEE(baseIEE, 30, '2026-03-21') * 100) / 100;

    expect(tarifa.metaPvpc.impuestoElectrico).toBe(expectedIEE);

    vi.useRealTimers();
  });

  it('crearTarifaPVPC aplica IVA general con 10 kW exactos y separa la caché por bono social', async () => {
    const mockJson = {
      geo_id: 8741,
      days: {
        '2026-03-20': generateMockDayPrices(0.20, 0.10, 0.05)
      },
      meta: { max_after_conversion: 0.20 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));

    const baseInputs = {
      zonaFiscal: 'Península',
      p1: 10,
      p2: 10,
      dias: 1,
      cPunta: 10,
      cLlano: 10,
      cValle: 10
    };

    const severe = await global.window.LF.pvpc.crearTarifaPVPC({
      ...baseInputs,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      bonoSocialLimite: 1587
    });

    const noBonus = await global.window.LF.pvpc.crearTarifaPVPC({
      ...baseInputs,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587
    });

    expect(severe.metaPvpc.usoFiscal).toBe('iva_general');
    expect(noBonus.metaPvpc.usoFiscal).toBe('iva_general');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('obtenerPVPC_LOCAL cruza correctamente la hora 25 del cambio horario en modo CSV exacto', async () => {
    const mockJson = {
      geo_id: 8741,
      timezone: 'Europe/Madrid',
      days: {
        '2024-10-27': generateDstFallbackDayPrices()
      },
      meta: { max_after_conversion: 0.50 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date(2024, 9, 27), hora: 3, kwh: 1 },
      { fecha: new Date(2024, 9, 27), hora: 25, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 2,
      cLlano: 0,
      cValle: 0
    });

    expect(result).toBeTruthy();
    expect(result.terminoVariable).toBeCloseTo(0.70, 3);
    expect(result.pvpcCoverage.mode).toBe('exact');
    expect(result.pvpcCoverage.hoursWithoutPrice).toBe(0);
  });

  it('obtenerPVPC_LOCAL cruza correctamente el cambio horario de marzo con 23 horas', async () => {
    const mockJson = {
      geo_id: 8741,
      timezone: 'Europe/Madrid',
      days: {
        '2026-03-29': generateDstSpringForwardDayPrices()
      },
      meta: { max_after_conversion: 0.50 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    const cnmcHours = [1, 2, ...Array.from({ length: 21 }, (_, i) => i + 4)];
    global.window.LF.consumosHorarios = cnmcHours.map((hora) => ({
      fecha: new Date(2026, 2, 29),
      hora,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 23,
      cLlano: 0,
      cValle: 0
    });

    expect(result).toBeTruthy();
    expect(result.terminoVariable).toBeCloseTo(2.70, 3);
  });

  it('obtenerPVPC_LOCAL no acepta modo CSV exacto si faltan precios horarios', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: {
          '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05)
        }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date('2025-01-07T00:00:00'), hora: 11, kwh: 1 },
      { fecha: new Date('2025-01-08T00:00:00'), hora: 11, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 2,
      cPunta: 2,
      cLlano: 0,
      cValle: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    const variable = result.resultadoPVPC.find(row => row.cabecera === 'Término variable');
    expect(result.terminoVariable).toBeCloseTo(0.40, 3);
    expect(variable.explicacion).not.toContain('cálculo exacto hora a hora');
    expect(variable.explicacion).toContain('1 de 2 horas con consumo');
    expect(variable.explicacion).toContain('supera el umbral máximo del 10%');
    expect(result.pvpcCoverage.mode).toBe('average');
  });

  it('obtenerPVPC_LOCAL documenta como fallback un CSV exacto con hora 0', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: {
          '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05)
        }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date('2025-01-07T00:00:00'), hora: 0, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 0,
      cValle: 1,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    const variable = result.resultadoPVPC.find(row => row.cabecera === 'Término variable');
    expect(result.terminoVariable).toBeCloseTo(0.05, 3);
    expect(variable.explicacion).not.toContain('cálculo exacto hora a hora');
    expect(variable.explicacion).toContain('1 de 1 horas con consumo');
    expect(result.pvpcCoverage.mode).toBe('average');
    expect(result.pvpcCoverage.fallbackReason).toContain('media P1/P2/P3 válida');
  });

  it('obtenerPVPC_LOCAL combina precios exactos y medias con un 10% residual de horas y kWh', async () => {
    const prices = generateMockDayPrices(0.20, 0.10, 0.05);
    prices[0][1] = 0.50;
    prices.splice(1, 1); // Falta la hora CNMC 2 (01:00 local)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 2,
      cValle: 8
    });

    const expectedP3Mean = (0.50 + (6 * 0.05)) / 7;
    const expectedHybridCost = 0.50 + (6 * 0.05) + expectedP3Mean + (2 * 0.10);
    const variable = result.resultadoPVPC.find(row => row.cabecera === 'Término variable');

    expect(result.terminoVariable).toBeCloseTo(expectedHybridCost, 8);
    expect(result.pvpcCoverage).toMatchObject({
      mode: 'hybrid',
      hoursWithPrice: 9,
      hoursWithoutPrice: 1,
      kwhWithPrice: 9,
      kwhWithoutPrice: 1,
      missingHoursShare: 0.1,
      missingKwhShare: 0.1,
      hasMissingPrices: true
    });
    expect(variable.explicacion).toContain('cálculo horario con cobertura parcial');
    expect(variable.explicacion).toContain('9 de 10 horas con consumo');
    expect(variable.explicacion).not.toContain('cálculo exacto hora a hora');
    const expectedIeeBase = result.terminoFijo
      + result.costeMargenPot
      + result.terminoVariable
      + result.bonoSocial;
    const expectedIee = Math.round(global.window.LF_CONFIG.calcularIEE(
      expectedIeeBase,
      10,
      global.window.LF_CONFIG.getTodayYmd()
    ) * 100) / 100;
    expect(result.impuestoElectrico).toBe(expectedIee);
  });

  it('obtenerPVPC_LOCAL rechaza el híbrido si solo el peso de kWh supera el 10%', async () => {
    const prices = generateMockDayPrices(0.20, 0.10, 0.05);
    prices.splice(1, 1);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i + 1,
      kwh: i === 1 ? 2 : 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 2,
      cValle: 9
    });

    expect(result.pvpcCoverage.mode).toBe('average');
    expect(result.pvpcCoverage.missingHoursShare).toBe(0.1);
    expect(result.pvpcCoverage.missingKwhShare).toBeCloseTo(2 / 11, 8);
    expect(result.pvpcCoverage.fallbackReason).toContain('supera el umbral');
  });

  it('obtenerPVPC_LOCAL usa el periodo canónico desplazado de Ceuta/Melilla al estimar un hueco', async () => {
    const prices = generateMockDayPrices(0.30, 0.10, 0.05);
    prices.splice(11, 1); // Hora CNMC 12: P1 en Ceuta/Melilla (inicio 11:00)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8744,
        timezone: 'Europe/Madrid',
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i === 9 ? 12 : i + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'CeutaMelilla',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 1,
      cLlano: 1,
      cValle: 8
    });

    const exactKnownCost = (8 * 0.05) + 0.10;
    expect(result.terminoVariable).toBeCloseTo(exactKnownCost + result.precioPunta, 8);
    expect(result.terminoVariable).not.toBeCloseTo(exactKnownCost + result.precioLlano, 8);
    expect(result.pvpcCoverage.mode).toBe('hybrid');
  });

  it('obtenerPVPC_LOCAL ignora horas sin precio cuando su consumo es cero', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: { '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05) }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date(2025, 0, 7), hora: 11, kwh: 1 },
      { fecha: new Date(2025, 0, 8), hora: 11, kwh: 0 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 2,
      cPunta: 1,
      cLlano: 0,
      cValle: 0
    });

    expect(result.pvpcCoverage).toMatchObject({
      mode: 'exact',
      hoursWithPrice: 1,
      hoursWithoutPrice: 0,
      kwhWithPrice: 1,
      kwhWithoutPrice: 0
    });
  });

  it('obtenerPVPC_LOCAL no usa híbrido residual si falta un mes completo con consumo', async () => {
    const januaryPrices = generateMockDayPrices(0.20, 0.10, 0.05);
    global.fetch.mockImplementation((url) => Promise.resolve(
      String(url).includes('2025-01')
        ? {
            ok: true,
            json: async () => ({
              geo_id: 8741,
              timezone: 'Europe/Madrid',
              days: { '2025-01-31': januaryPrices }
            })
          }
        : { ok: false }
    ));

    global.window.LF.consumosHorarios = [
      ...Array.from({ length: 9 }, (_, i) => ({
        fecha: new Date(2025, 0, 31),
        hora: i + 1,
        kwh: 1
      })),
      { fecha: new Date(2025, 1, 1), hora: 1, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 2,
      cPunta: 0,
      cLlano: 1,
      cValle: 9
    });

    expect(result.pvpcCoverage.mode).toBe('average');
    expect(result.pvpcCoverage.missingMonths).toEqual(['2025-02']);
    expect(result.pvpcCoverage.fallbackReason).toContain('mes completo');
  });

  it('crearTarifaPVPC no persiste resultados con cobertura horaria parcial', async () => {
    const prices = generateMockDayPrices(0.20, 0.10, 0.05);
    prices.splice(1, 1);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const tarifa = await global.window.LF.pvpc.crearTarifaPVPC({
      zonaFiscal: 'Península',
      p1: 6.123,
      p2: 6.123,
      dias: 1,
      cPunta: 0,
      cLlano: 2,
      cValle: 8
    });

    expect(tarifa).toBeTruthy();
    expect(global.window.pvpcLastMeta.pvpcCoverage.mode).toBe('hybrid');
    expect(global.window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('obtenerPVPC_LOCAL cede el hilo durante el cruce CSV exacto largo', async () => {
    const yieldControl = vi.fn(() => Promise.resolve());
    global.window.LF.yieldControl = yieldControl;

    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 20;
      return now;
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        days: {
          '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05)
        }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 512 }, (_, i) => ({
      fecha: new Date('2025-01-07T00:00:00'),
      hora: (i % 24) + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    try {
      const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
        zonaFiscal: 'Península',
        p1: 3.45,
        p2: 3.45,
        dias: 1,
        cPunta: 512,
        cLlano: 0,
        cValle: 0,
        bonoSocialOn: false,
        bonoSocialTipo: 'vulnerable'
      });

      expect(result).toBeTruthy();
      expect(yieldControl).toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

});
