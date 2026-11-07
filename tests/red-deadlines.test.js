/**
 * @vitest-environment jsdom
 *
 * 26/08/2026. Tres rutas de red se quedaban sin deadline: un `fetch()` que NUNCA resuelve
 * no rechaza, asi que ningun `.catch()` lo ve y el flujo que lo espera queda colgado sin
 * error, sin toast y sin forma de reintentar. No es teorico: el censo CNMC se espera con
 * `await` antes de seguir procesando la factura, y el simulador espera `loadTarifasBV()`
 * antes de calcular.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const leer = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('Deadlines de red: guard estructural', () => {
  // Si alguien vuelve a poner un fetch() pelado en estos loaders, el fallo reaparece sin
  // que ningun test funcional tenga por que enterarse: el cuelgue solo se manifiesta con
  // una red que ni responde ni corta. Este guard es la red de seguridad barata.
  const loaders = [
    ['js/bv/bv-sim-monthly.js', 'loadTarifasBV'],
    ['js/desglose-integration.js', 'fallback de tarifas']
  ];

  it.each(loaders)('%s carga tarifas.json a traves de fetchJsonWithTimeout', (rel) => {
    const src = leer('../' + rel);
    expect(src).toContain('csvUtils?.fetchJsonWithTimeout');
    // Ni un solo fetch( directo fuera del helper.
    const directos = src.split('\n').filter((l) => /(^|[^.\w])fetch\s*\(/.test(l) && !l.includes('fetchJsonWithTimeout'));
    expect(directos).toEqual([]);
  });

  it('el censo CNMC usa window.fetch con AbortController propio, no el helper de CSV', () => {
    // Deliberado: cargar el censo no justifica acoplar factura.js al modulo de CSV, y
    // window.fetch es ademas el punto que interceptan los tests de integracion.
    const src = leer('../js/factura.js');
    expect(src).toContain('CNMC_REGISTRY_TIMEOUT_MS');
    expect(src).toContain('new AbortController()');
    expect(src).not.toContain('csvUtils?.fetchJsonWithTimeout');
  });
});

describe('Deadlines de red: simulador solar', () => {
  beforeEach(() => {
    global.window.BVSim = undefined;
    delete global.window.LF;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function bootSim({ fetchJson } = {}) {
    window.LF = {
      JSON_URL: 'tarifas.json',
      esTarifaUtilizable: () => true,
      csvUtils: fetchJson ? { fetchJsonWithTimeout: fetchJson } : {}
    };
    new Function('window', leer('../js/bv/bv-sim-monthly.js'))(window);
  }

  it('un timeout se traduce a un mensaje en espanyol, no al AbortError nativo', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    bootSim({ fetchJson: vi.fn(async () => { throw abort; }) });

    const r = await window.BVSim.loadTarifasBV();

    expect(r.ok).toBe(false);
    expect(r.error).toContain('ha tardado demasiado');
    // El mensaje nativo esta en ingles y no le dice nada a quien lo lee.
    expect(r.error).not.toContain('aborted');
  });

  it('sin el helper disponible no descarga a pelo: falla cerrado', async () => {
    // Fail-closed igual que con esTarifaUtilizable: preferimos no cargar a cargar sin
    // deadline y arriesgar el spinner eterno.
    bootSim({ fetchJson: null });
    const r = await window.BVSim.loadTarifasBV();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/dependencia de red/i);
  });
});

describe('Deadlines de red: censo CNMC (factura)', () => {
  const CODIGO = 'R2-796';
  let fetchMock;

  // Replica lo que hace un fetch REAL con un signal: si nadie lo aborta se queda
  // pendiente para siempre; si lo abortan, rechaza con AbortError. Un mock que ignorase
  // el signal no distinguiria "hay deadline" de "no lo hay".
  const abortable = (fn) => vi.fn((url, opts) => new Promise((resolve, reject) => {
    opts?.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    });
    fn(resolve, reject, opts);
  }));

  function bootFactura() {
    document.body.innerHTML = '<div id="modalFactura"></div>';
    // factura.js hace early-return si falta __LF_FacturaParsers, y se re-ejecuta en cada
    // test (en vez de importarse una vez) para que __LF_cnmcRegistryPromise arranque
    // limpia: la cache de esa promesa es justo lo que se esta probando.
    delete window.__LF_facturaParserLoaded;
    delete window.__LF_facturaQrHelpers;
    window.__LF_BUILD_ID = 'test';
    new Function('window', 'document', leer('../js/factura-parsers.js'))(window, document);
    new Function('window', 'document', leer('../js/factura.js'))(window, document);
    const helpers = window.__LF_facturaQrHelpers;
    if (!helpers?.resolveCnmcCommercializer) throw new Error('factura.js no se inicializo en el test');
    return helpers.resolveCnmcCommercializer;
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('una peticion que no responde NUNCA se corta a los 5 s y la factura sigue sin comercializadora', async () => {
    fetchMock = abortable(() => {});           // jamas resuelve por si sola
    window.fetch = fetchMock;
    const resolver = bootFactura();

    const pendiente = resolver(CODIGO);
    await vi.advanceTimersByTimeAsync(5000);

    // Sin deadline esto no resolveria nunca y el extractor quedaria colgado.
    await expect(pendiente).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });

  it('el deadline cubre tambien un response.json() atascado, no solo las cabeceras', async () => {
    // `fetch` resuelve en cuanto llegan las cabeceras: si el temporizador se limpiara ahi,
    // un cuerpo que no termina de bajar reproduciria el mismo cuelgue.
    window.fetch = vi.fn((url, opts) => Promise.resolve({
      ok: true,
      json: () => new Promise((_, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })
    }));
    const resolver = bootFactura();

    const pendiente = resolver(CODIGO);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pendiente).resolves.toBeNull();
  });

  it('sin AbortController renuncia al nombre en vez de lanzar un fetch sin deadline', async () => {
    // En un navegador sin AbortController no hay forma de poner deadline. El nombre de la
    // comercializadora es opcional; el cuelgue del extractor no lo es.
    const original = globalThis.AbortController;
    delete globalThis.AbortController;
    try {
      window.fetch = vi.fn();
      const resolver = bootFactura();
      await expect(resolver(CODIGO)).resolves.toBeNull();
      expect(window.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.AbortController = original;
    }
  });

  it('tras un timeout la cache se purga y la siguiente factura reintenta', async () => {
    // Si la promesa fallida se quedara cacheada, el resto de la sesion se quedaria sin
    // censo aunque la red ya funcionase.
    let intento = 0;
    window.fetch = vi.fn((url, opts) => {
      intento += 1;
      if (intento === 1) {
        return new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ commercializers: { [CODIGO]: { name: 'BON PREU, SAU' } } })
      });
    });
    const resolver = bootFactura();

    const primera = resolver(CODIGO);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(primera).resolves.toBeNull();

    const segunda = await resolver(CODIGO);
    expect(window.fetch).toHaveBeenCalledTimes(2);
    expect(segunda?.name).toBe('BON PREU, SAU');
  });
});

// El timeout del fallback de red del desglose se prueba de forma funcional en
// tests/desglose-integration-ux.test.js, entrando por window.mostrarDesglose(): no hace
// falta exponer su loader. Aqui solo queda el guard estructural.
