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

describe('Sistema de Tarifas (sin caché)', () => {
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

  it('Debe descargar tarifas y actualizar el estado (sin caché)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockTarifas
    });

    const success = await global.window.LF.fetchTarifas(false);
    
    expect(success).toBe(true);
    expect(global.window.LF.baseTarifasCache).toEqual(mockTarifas.tarifas);
    // Siempre debe llevar ?v=timestamp y cache: no-store
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/tarifas\.json\?v=\d+/),
      expect.objectContaining({ cache: 'no-store' })
    );
    // No debe guardar nada en localStorage
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it('Debe añadir parámetro anti-caché (?v=) siempre', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => mockTarifas });
    
    await fetchTarifas(false);

    // La URL debe contener explícitamente ?v=
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/tarifas\.json\?v=\d+/), 
      expect.anything()
    );
  });

  it('Debe formatear la fecha incluyendo hora y minutos', () => {
    // Simulamos un elemento DOM
    const elMock = { textContent: '', title: '' };
    global.window.LF.el.tarifasUpdated = elMock;

    const meta = { updatedAt: "2026-01-29T10:30:00.000Z" }; // UTC
    
    global.window.LF.renderTarifasUpdated(meta);

    // En horario de invierno (Enero), Madrid es UTC+1 -> 11:30
    // Verificamos que contenga la fecha y la hora (formato aproximado por locales)
    expect(elMock.textContent).toContain('Actualizado el');
    expect(elMock.textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/); // DD/MM/YYYY
    expect(elMock.textContent).toMatch(/\d{2}:\d{2}/); // HH:mm
    
    // Opcional: Verificar hora exacta (11:30 en Madrid para esa fecha UTC)
    // Nota: Esto depende de que Node tenga bien las timezones, si falla lo relajamos.
    expect(elMock.textContent).toContain('11:30'); 
  });

  it('Debe fallar si la red no está disponible (sin caché)', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const success = await fetchTarifas();

    expect(success).toBe(false);
    expect(toast).toHaveBeenCalledWith('Error cargando tarifas desde el servidor.', 'err');
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
  });

  it('Debe manejar fallo total (Sin red)', async () => {
    fetchMock.mockRejectedValue(new Error('Fail'));

    const success = await fetchTarifas();

    // Sin red -> Falla
    expect(success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

});
