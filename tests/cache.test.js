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

// 5. Cargar lf-utils.js primero: aporta window.LF.esTarifaUtilizable real (misma
// dependencia que usa lf-cache.js en produccion), evitando una copia en el test que
// pudiera desincronizarse de la implementacion.
const utilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-utils.js'), 'utf8');
new Function('window', utilsCode)(global.window);

// 6. Cargar script lf-cache.js manualmente
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

  // Fixture con la forma MINIMA que fetchTarifas exige (nombre, tipo y los cinco
  // precios finitos). Antes eran { nombre, p1 } sueltos: dejaron de servir cuando
  // la descarga pasó a rechazar datasets estructuralmente inutilizables.
  const tarifa1P = {
    nombre: 'Tarifa A',
    tipo: '1P',
    p1: 0.1,
    p2: 0.02,
    cPunta: 0.12,
    cLlano: 0.12,
    cValle: 0.12
  };
  const tarifa3P = {
    nombre: 'Tarifa B',
    tipo: '3P',
    p1: 0.2,
    p2: 0.03,
    cPunta: 0.15,
    cLlano: 0.11,
    cValle: 0.08
  };
  const mockTarifas = {
    tarifas: [tarifa1P, tarifa3P],
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

  it('registra el bloqueo si calcular reutiliza una precarga que termina fallando', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('Network error'));

    const startup = fetchTarifas(false, { silent: true, diagnosticReason: 'startup' });
    const calculate = fetchTarifas(false, { silent: true, diagnosticReason: 'calculate' });
    await vi.advanceTimersByTimeAsync(600);

    expect(await startup).toBe(false);
    expect(await calculate).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['tarifas-impacto', 'startup', 'sin-datos-iniciales', 'desconocido'],
      expect.any(Object)
    );
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['tarifas-impacto', 'calculate', 'bloqueado-sin-datos', 'desconocido'],
      expect.any(Object)
    );
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
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['fetch-terminal', 'tarifas', 'failed', 'direct', 'a1', 'desconocido'],
      expect.any(Object)
    );
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
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['tarifas-impacto', 'startup', 'sin-datos-iniciales', 'desconocido'],
      expect.any(Object)
    );
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('clasifica como timeout un AbortError durante la descarga del cuerpo JSON', async () => {
    vi.useFakeTimers();
    global.window.LF.baseTarifasCache = [{ nombre: 'Tarifa válida de sesión' }];
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
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['tarifas-impacto', 'calculate', 'fallback-sesion', 'desconocido'],
      expect.any(Object)
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
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['fetch-terminal', 'tarifas', 'failed', 'startup', 'a1', 'desconocido'],
      expect.any(Object)
    );
    expect(global.window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['tarifas-impacto', 'startup', 'sin-datos-iniciales', 'desconocido'],
      expect.any(Object)
    );
  });

  // Un HTTP 200 con `tarifas` no vacío pero inutilizable (artefacto corrupto, deploy a
  // medias, edición manual del JSON saltándose el generador) no puede pisar la copia sana
  // de la sesión. La validación no replica rangos comerciales: exige nombre, tipo 1P/3P y
  // cinco precios finitos y no negativos, que es el mínimo para no publicar importes
  // aritméticamente imposibles. Un 0 sigue siendo válido (p2 puede valer 0 por contrato).
  describe('validación estructural del dataset descargado', () => {
    const conservaCacheSana = async (payload) => {
      const cacheSana = [{ ...tarifa1P, nombre: 'Tarifa sana de sesión' }];
      global.window.LF.baseTarifasCache = cacheSana;
      fetchMock.mockResolvedValue({ ok: true, json: async () => payload });

      const success = await fetchTarifas(false, { silent: true, diagnosticReason: 'startup' });

      expect(success).toBe(false);
      expect(global.window.LF.baseTarifasCache).toBe(cacheSana);
      expect(global.window.__LF_reportNetworkFailure).toHaveBeenCalledWith(
        expect.any(String),
        0,
        'json-invalid',
        expect.objectContaining({ attempt: 1, errorKind: 'json-invalid' })
      );
      // Un dataset inválido es determinista: no debe reintentarse.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    };

    it('rechaza tarifas vacías ({}) y conserva la caché sana', async () => {
      await conservaCacheSana({ tarifas: [{}], updatedAt: '2026-01-01T00:00:00Z' });
    });

    it('rechaza una tarifa sin nombre', async () => {
      const sinNombre = { ...tarifa1P };
      delete sinNombre.nombre;
      await conservaCacheSana({ tarifas: [sinNombre] });
    });

    it('rechaza un nombre vacío o solo con espacios', async () => {
      await conservaCacheSana({ tarifas: [{ ...tarifa1P, nombre: '   ' }] });
    });

    it('rechaza un tipo fuera de 1P/3P', async () => {
      await conservaCacheSana({ tarifas: [{ ...tarifa1P, tipo: '2P' }] });
    });

    // Cobertura cruzada en dos ejes. Eje 1: los CINCO campos numéricos, uno a uno. Sin
    // esto, quitar p2, cPunta o cLlano de TARIFA_CAMPOS_NUMERICOS dejaba la suite entera
    // en verde (comprobado por mutación: con ['p1','cValle'] pasaban los 1187 casos).
    it.each(['p1', 'p2', 'cPunta', 'cLlano', 'cValle'])('rechaza %s no numérico', async (campo) => {
      await conservaCacheSana({ tarifas: [{ ...tarifa1P, [campo]: null }] });
    });

    it.each(['p1', 'p2', 'cPunta', 'cLlano', 'cValle'])('rechaza %s ausente', async (campo) => {
      const sinCampo = { ...tarifa3P };
      delete sinCampo[campo];
      await conservaCacheSana({ tarifas: [sinCampo] });
    });

    // Eje 2: los tipos de valor inválido, sobre un campo representativo. La cruz de los dos
    // ejes cubre el validador sin necesitar las 25 combinaciones.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['cadena numérica', '0.1'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['booleano', true],
      ['objeto', {}]
    ])('rechaza p1 no finito (%s)', async (_label, valor) => {
      await conservaCacheSana({ tarifas: [{ ...tarifa1P, p1: valor }] });
    });

    it.each(['p1', 'p2', 'cPunta', 'cLlano', 'cValle'])(
      'rechaza %s negativo aunque sea finito',
      async (campo) => {
        await conservaCacheSana({
          tarifas: [{ ...tarifa1P, [campo]: -0.01 }],
          updatedAt: '2026-01-02T00:00:00Z'
        });
      }
    );

    it('rechaza el dataset entero si una sola tarifa es inválida', async () => {
      await conservaCacheSana({ tarifas: [tarifa1P, tarifa3P, { nombre: 'Rota', tipo: '1P' }] });
    });

    it('rechaza una entrada que no es objeto', async () => {
      await conservaCacheSana({ tarifas: [tarifa1P, 'no soy una tarifa'] });
    });

    // `response.json()` puede resolver a cualquier valor JSON valido, no solo a un objeto:
    // null, un escalar o un array raiz son sintacticamente correctos. Desreferenciar
    // data.tarifas sobre null lanzaba un TypeError que escapaba de la semantica acordada
    // (sin clasificar como json-invalid, sin reportar a la telemetria de red y con
    // reintento inutil, porque un error sin __lfRetryable se considera reintentable).
    it.each([
      ['null', null],
      ['un escalar de texto', 'texto'],
      ['un escalar numerico', 123],
      ['un array raiz', []],
      ['un objeto sin tarifas', { updatedAt: '2026-01-01T00:00:00Z' }],
      ['tarifas con un tipo que no es array', { tarifas: { nombre: 'x' } }]
    ])('rechaza un root JSON que no es el objeto esperado (%s)', async (_label, payload) => {
      await conservaCacheSana(payload);
    });

    it('rechaza nombres comerciales duplicados y conserva la caché sana', async () => {
      const cacheSana = [tarifa1P, tarifa3P];
      const duplicadaBarata = {
        ...tarifa1P,
        p1: 0.01,
        p2: 0.01,
        cPunta: 0.01,
        cLlano: 0.01,
        cValle: 0.01
      };
      global.window.LF.baseTarifasCache = cacheSana;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ tarifas: [tarifa1P, duplicadaBarata, tarifa3P], updatedAt: '2026-01-02T00:00:00Z' })
      });

      expect(await fetchTarifas(false, { silent: true })).toBe(false);
      expect(global.window.LF.baseTarifasCache).toBe(cacheSana);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rechaza un subconjunto que pretende ser la misma versión y conserva la caché sana', async () => {
      const version = '2026-01-02T00:00:00Z';
      const cacheSana = [tarifa1P, tarifa3P];
      global.window.LF.baseTarifasCache = cacheSana;
      global.window.LF.__LF_tarifasMeta = { updatedAt: version };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ tarifas: [tarifa3P], updatedAt: version })
      });

      expect(await fetchTarifas(false, { silent: true })).toBe(false);
      expect(global.window.LF.baseTarifasCache).toBe(cacheSana);
      expect(global.window.LF.__LF_tarifasMeta).toEqual({ updatedAt: version });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rechaza la misma versión si conserva nombres pero cambia un precio positivo', async () => {
      const version = '2026-01-02T00:00:00Z';
      const cacheSana = [tarifa1P, tarifa3P];
      global.window.LF.baseTarifasCache = cacheSana;
      global.window.LF.__LF_tarifasMeta = { updatedAt: version };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tarifas: [{ ...tarifa1P, cPunta: 0.01 }, tarifa3P],
          updatedAt: version
        })
      });

      expect(await fetchTarifas(false, { silent: true })).toBe(false);
      expect(global.window.LF.baseTarifasCache).toBe(cacheSana);
      expect(global.window.LF.__LF_tarifasMeta).toEqual({ updatedAt: version });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('acepta la misma versión si el contenido relevante es equivalente aunque filas y propiedades lleguen reordenadas', async () => {
      const version = '2026-01-02T00:00:00Z';
      global.window.LF.baseTarifasCache = [tarifa1P, tarifa3P];
      global.window.LF.__LF_tarifasMeta = { updatedAt: version };
      const tarifa1PReordenada = {
        cValle: tarifa1P.cValle, cLlano: tarifa1P.cLlano, cPunta: tarifa1P.cPunta,
        p2: tarifa1P.p2, p1: tarifa1P.p1, tipo: tarifa1P.tipo, nombre: tarifa1P.nombre
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ tarifas: [tarifa3P, tarifa1PReordenada], updatedAt: version })
      });

      expect(await fetchTarifas(false, { silent: true })).toBe(true);
      expect(global.window.LF.baseTarifasCache).toEqual([tarifa3P, tarifa1PReordenada]);
    });

    it('acepta un catálogo menor cuando pertenece a una versión nueva', async () => {
      global.window.LF.baseTarifasCache = [tarifa1P, tarifa3P];
      global.window.LF.__LF_tarifasMeta = { updatedAt: '2026-01-01T00:00:00Z' };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ tarifas: [tarifa3P], updatedAt: '2026-01-02T00:00:00Z' })
      });

      expect(await fetchTarifas(false, { silent: true })).toBe(true);
      expect(global.window.LF.baseTarifasCache).toEqual([tarifa3P]);
      expect(global.window.LF.__LF_tarifasMeta).toEqual({ updatedAt: '2026-01-02T00:00:00Z' });
    });

    it('acepta un dataset realista 1P + 3P', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => mockTarifas });

      expect(await fetchTarifas(false, { silent: true })).toBe(true);
      expect(global.window.LF.baseTarifasCache).toEqual([tarifa1P, tarifa3P]);
    });

    it('acepta p2 = 0, que el contrato permite', async () => {
      const p2Cero = { ...tarifa1P, p2: 0 };
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tarifas: [p2Cero] }) });

      expect(await fetchTarifas(false, { silent: true })).toBe(true);
      expect(global.window.LF.baseTarifasCache).toEqual([p2Cero]);
    });

    it('acepta modalidades FV/BV con sus campos adicionales intactos', async () => {
      // Forma real del dataset (Imagina Base Sin Horas 4000): fv anidado con precioBV 0,
      // requiereFV, maxConsumoAnual, requisitos, promo e incluyeServiciosAjuste. El
      // validador no mira ninguno de ellos y deben llegar sin tocar a baseTarifasCache.
      const conFv = {
        ...tarifa1P,
        nombre: 'Tarifa Solar BV',
        web: 'https://example.com/solar',
        incluyeServiciosAjuste: true,
        requiereFV: true,
        maxConsumoAnual: 4000,
        minConsumoAnualExclusivo: 0,
        requisitos: 'Consumo ≤ 4.000 kWh/año.',
        promo: '50 € de descuento en 5 facturas.',
        fv: { exc: 0.03, tipo: 'SIMPLE + BV', tope: 'ENERGIA', bv: true, reglaBV: 'BV MES ANTERIOR', precioBV: 0 }
      };
      const indexada = { ...tarifa3P, nombre: 'Indexada 3P', fv: { exc: -1, tipo: 'SIMPLE', tope: '—', bv: false } };
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tarifas: [conFv, indexada] }) });

      expect(await fetchTarifas(false, { silent: true })).toBe(true);
      expect(global.window.LF.baseTarifasCache).toEqual([conFv, indexada]);
    });
  });

});
