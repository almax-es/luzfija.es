import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  __LF_trackDetail: vi.fn(),
  __LF_reportNetworkFailure: vi.fn(),
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

  afterEach(() => {
    vi.useRealTimers();
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
      expect.objectContaining({ cache: 'no-store', __lfDiagnosticReason: 'direct' })
    );
    // No debe guardar nada en localStorage
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(global.window.__LF_trackDetail).not.toHaveBeenCalled();
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

  it('Propaga el motivo cerrado de la petición para el diagnóstico de red', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => mockTarifas });

    await fetchTarifas(false, { silent: true, diagnosticReason: 'startup' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/tarifas\.json\?v=\d+/),
      expect.objectContaining({ __lfDiagnosticReason: 'startup' })
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
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('Network error'));

    const pending = fetchTarifas();
    await vi.advanceTimersByTimeAsync(600);
    const success = await pending;

    expect(success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith('Error cargando tarifas desde el servidor.', 'err');
    expect(global.window.__LF_trackDetail).toHaveBeenCalledTimes(1);
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['fetch-terminal', 'tarifas', 'failed', 'direct', 'a2', 'desconocido'],
      expect.any(Object)
    );
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('reintenta una vez, identifica ambos intentos y recupera un rechazo transitorio', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce({ ok: true, json: async () => mockTarifas });

    const pending = fetchTarifas(false, { silent: true, diagnosticReason: 'calculate' });
    await vi.advanceTimersByTimeAsync(600);
    const success = await pending;

    expect(success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      __lfDiagnosticReason: 'calculate',
      __lfDiagnosticAttempt: 1,
      __lfDiagnosticTrackAbort: 'timeout'
    }));
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      __lfDiagnosticReason: 'calculate',
      __lfDiagnosticAttempt: 2,
      __lfDiagnosticTrackAbort: 'timeout'
    }));
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'network-recovered',
      expect.arrayContaining(['tarifas', 'calculate', 'a2']),
      expect.any(Object)
    );
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['fetch-terminal', 'tarifas', 'recovered', 'calculate', 'a2', 'desconocido'],
      expect.any(Object)
    );
    expect(global.window.__LF_trackDetail).toHaveBeenCalledTimes(2);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('no conserva resultados terminales para un refresco silencioso fallido', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('Network error'));

    const pending = fetchTarifas(false, { silent: true, diagnosticReason: 'online' });
    await vi.advanceTimersByTimeAsync(600);

    expect(await pending).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(global.window.__LF_trackDetail).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('no reintenta un HTTP 404 definitivo', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    expect(await fetchTarifas()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(global.window.__LF_reportNetworkFailure).toHaveBeenCalledWith(
      expect.stringMatching(/tarifas\.json\?v=/),
      404,
      'http-error',
      expect.objectContaining({ reason: 'direct', attempt: 1, errorKind: 'http' })
    );
    expect(global.window.__LF_trackDetail).not.toHaveBeenCalled();
  });

  it('reporta JSON inválido con intento cerrado y limpia el timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad'); } });

    const pending = fetchTarifas(false, { silent: true, diagnosticReason: 'startup' });
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toBe(false);

    expect(global.window.__LF_reportNetworkFailure).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/tarifas\.json\?v=/),
      0,
      'json-parse',
      expect.objectContaining({ reason: 'startup', attempt: 1, errorKind: 'json-parse' })
    );
    expect(global.window.__LF_reportNetworkFailure).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      0,
      'json-parse',
      expect.objectContaining({ attempt: 2 })
    );
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['fetch-terminal', 'tarifas', 'failed', 'startup', 'a2', 'desconocido'],
      expect.any(Object)
    );
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('clasifica como timeout un AbortError durante la descarga del cuerpo JSON', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted while reading body', 'AbortError'));
        });
      })
    }));

    const pending = fetchTarifas(false, { silent: true, diagnosticReason: 'calculate' });
    await vi.advanceTimersByTimeAsync(30_600);
    expect(await pending).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(global.window.__LF_reportNetworkFailure).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      0,
      'timeout',
      expect.objectContaining({ attempt: 1, errorKind: 'timeout' })
    );
    expect(global.window.__LF_reportNetworkFailure).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      0,
      'timeout',
      expect.objectContaining({ attempt: 2, errorKind: 'timeout' })
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no reintenta un JSON válido pero sin tarifas', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tarifas: [] }) });

    expect(await fetchTarifas(false, { silent: true, diagnosticReason: 'startup' })).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(global.window.__LF_reportNetworkFailure).toHaveBeenCalledWith(
      expect.any(String),
      0,
      'json-invalid',
      expect.objectContaining({ attempt: 1, errorKind: 'json-invalid' })
    );
    expect(global.window.__LF_trackDetail).not.toHaveBeenCalled();
  });

});
