import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// 1. Mocks de UI
const setStatus = vi.fn();
const toast = vi.fn();
const markPending = vi.fn();

// 2. Mock de localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => store[key] = String(val)),
  removeItem: vi.fn((key) => delete store[key]),
  clear: vi.fn(() => Object.keys(store).forEach(k => delete store[k]))
};

// 3. Mock de fetch
const fetchMock = vi.fn();

// 4. Setup del entorno global simulado
global.window = {
  LF: {
    JSON_URL: 'tarifas.json',
    TARIFAS_CACHE_KEY: 'lf_tarifas_cache',
    TARIFAS_CACHE_TTL: 3600000,
    el: {
      tarifasUpdated: { textContent: '' } 
    },
    __LF_tarifasMeta: {},
    baseTarifasCache: [], // Estado interno
    state: {},
    setStatus, toast, markPending,
    // Placeholders
    fetchTarifas: null
  },
  location: { search: '' },
  localStorage: localStorageMock,
  // Mock de lfDbg (global)
  lfDbg: vi.fn()
};
global.fetch = fetchMock;
global.localStorage = localStorageMock;
// Inyectar lfDbg tambien en el scope de la funcion por si acaso
global.lfDbg = global.window.lfDbg;

// 5. Cargar script lf-cache.js manualmente
const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-cache.js'), 'utf8');
const fn = new Function('window', 'setStatus', 'toast', 'markPending', 'localStorage', 'lfDbg', code);
fn(global.window, setStatus, toast, markPending, localStorageMock, global.lfDbg);

describe('Sistema de Caché (lf-cache.js)', () => {
  const { fetchTarifas } = global.window.LF;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(store).forEach(k => delete store[k]);
    // Resetear cache en memoria
    global.window.LF.baseTarifasCache = [];
    global.window.LF.__LF_tarifasMeta = {};
  });

  const mockTarifas = {
    tarifas: [
      { nombre: "Tarifa A", p1: 0.1 },
      { nombre: "Tarifa B", p1: 0.2 }
    ],
    updatedAt: "2025-01-01T12:00:00Z"
  };

  it('Debe descargar tarifas y guardarlas en caché (Happy Path)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockTarifas
    });

    const success = await global.window.LF.fetchTarifas(false);
    
    expect(success).toBe(true);
    expect(global.window.LF.baseTarifasCache).toEqual(mockTarifas.tarifas);
    // Ahora la URL puede llevar ?v=timestamp, así que usamos stringContaining
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('tarifas.json'), expect.anything());
    // Verificamos que se guarda "Tarifa A" que es lo que hay en el mock
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'lf_tarifas_cache',
      expect.stringContaining('"nombre":"Tarifa A"')
    );
  });

  it('Debe usar caché si la red falla (Offline Mode)', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const cacheData = {
      timestamp: Date.now(),
      data: mockTarifas.tarifas,
      meta: { updatedAt: "2025-01-01T12:00:00Z" }
    };
    localStorageMock.getItem.mockReturnValue(JSON.stringify(cacheData));

    const success = await fetchTarifas();

    expect(success).toBe(true);
    expect(global.window.LF.baseTarifasCache).toEqual(mockTarifas.tarifas);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Sin conexión'), 'err');
  });

  it('Debe manejar fallo total (Sin red y sin caché)', async () => {
    fetchMock.mockRejectedValue(new Error('Fail'));
    localStorageMock.getItem.mockReturnValue(null); // Sin cache

    const success = await fetchTarifas();

    // Sin red y sin cache -> Falla (devuelve undefined o false segun impl)
    expect(success).not.toBe(true); 
    // Verifica que intentó fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
