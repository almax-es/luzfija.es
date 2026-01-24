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

// Mockeamos config global
global.window.LF_CONFIG = {
  pvpc: {
    urlIndex: '/data/pvpc/index.json',
    urlMonthPattern: '/data/pvpc/{geoId}/{year}-{month}.json'
  },
  // Mocks necesarios para calculos fiscales
  calcularBonoSocial: vi.fn().mockReturnValue(0.50), // Valor fijo simulado
  calcularAlquilerContador: vi.fn().mockReturnValue(0.81), // Valor fijo simulado
  getTerritorio: vi.fn().mockReturnValue({ ie: 0.051127, iva: 0.21 }) // Mock basico de territorio
};

// Cargar dependencias necesarias
const loadScript = (filePath) => {
  const code = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
  const fn = new Function('window', 'location', 'localStorage', code);
  fn(global.window, global.window.location, global.window.localStorage);
};

// Activar debug para ver errores internos
global.window.__LF_DEBUG = true;

// Cargar lf-utils primero (pvpc.js usa window.LF)
loadScript('../js/lf-utils.js');
// Cargar pvpc.js
loadScript('../js/pvpc.js');

describe('PVPC Engine (js/pvpc.js)', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.window.localStorage.getItem.mockReturnValue(null);
    vi.spyOn(console, 'log'); // Espiar logs
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

});
