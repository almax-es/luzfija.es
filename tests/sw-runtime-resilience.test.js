import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const swCode = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');
const activeCacheVersion = swCode.match(/CACHE_VERSION\s*=\s*"([^"]+)"/)?.[1];

function loadWorker({ fetchImpl, cache, cacheKeys = [] }) {
  const handlers = {};
  let skipWaitingCalls = 0;
  const deletedCaches = [];
  const scopedRequest = function ScopedRequest(input, init) {
    return new Request(new URL(input, 'https://luzfija.es/'), init);
  };
  const context = {
    self: {
      registration: { scope: 'https://luzfija.es/' },
      location: { origin: 'https://luzfija.es' },
      addEventListener(type, fn) { handlers[type] = fn; },
      clients: { matchAll: async () => [], claim: async () => {} },
      skipWaiting: async () => { skipWaitingCalls += 1; }
    },
    caches: {
      open: async () => cache,
      keys: async () => cacheKeys,
      delete: async (key) => { deletedCaches.push(key); return true; }
    },
    fetch: fetchImpl,
    Request: scopedRequest,
    Response,
    URL,
    Set,
    Promise,
    setTimeout(fn) { fn(); return 1; },
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(context);
  vm.runInContext(swCode, context);
  return {
    handlers,
    get skipWaitingCalls() { return skipWaitingCalls; },
    deletedCaches
  };
}

async function dispatchFetch(handler, request) {
  let responsePromise;
  handler({ request, respondWith(value) { responsePromise = value; } });
  return responsePromise;
}

describe('Service Worker runtime resilience', () => {
  it('hace bypass total de Cache Storage para la sonda diagnóstica', async () => {
    let cacheTouched = false;
    const fetched = [];
    const cache = {
      add: async () => { cacheTouched = true; },
      put: async () => { cacheTouched = true; },
      match: async () => { cacheTouched = true; return new Response('cached'); },
      delete: async () => { cacheTouched = true; return true; }
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async (request, init) => {
        fetched.push({ request, init });
        return new Response('network-only', { status: 200 });
      }
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/js/lf-utils.js?v=build&__lfprobe=1',
      mode: 'cors',
      destination: ''
    });

    expect(await response.text()).toBe('network-only');
    expect(fetched).toHaveLength(1);
    expect(fetched[0].init).toEqual({ cache: 'no-store' });
    expect(cacheTouched).toBe(false);
  });

  it('recupera tracking.js desde el build activo pero mantiene count.js network-only', async () => {
    const cached = new Response('cached-current-build', { status: 200 });
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => cached.clone()
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('origin unavailable', { status: 503 })
    });

    const requestFor = (asset) => ({
      method: 'GET',
      url: `https://luzfija.es/${asset}?v=${activeCacheVersion}`,
      mode: 'no-cors',
      destination: 'script'
    });
    const tracking = await dispatchFetch(worker.handlers.fetch, requestFor('js/tracking.js'));
    const sender = await dispatchFetch(worker.handlers.fetch, requestFor('vendor/goatcounter/count.js'));

    expect(tracking.status).toBe(200);
    expect(await tracking.text()).toBe('cached-current-build');
    expect(sender.type).toBe('error');
  });

  it('rechaza el fallback ejecutable si la pagina pide un build distinto al SW activo', async () => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('stale-executable', { status: 200 })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('origin unavailable', { status: 503 })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/js/factura-parsers.js?v=20991231-235959',
      mode: 'no-cors',
      destination: 'script'
    });

    expect(response.type).toBe('error');
  });

  it.each(['js/error-bootstrap.js', 'js/lf-sw-update.js'])(
    'mantiene %s como via de recuperacion incluso bajo mezcla de build',
    async (asset) => {
      const cache = {
        add: async () => {},
        put: async () => {},
        match: async (_request, options) => options?.ignoreSearch
          ? new Response('cached-recovery-script', { status: 200 })
          : undefined
      };
      const worker = loadWorker({
        cache,
        fetchImpl: async () => { throw new Error('offline'); }
      });

      const response = await dispatchFetch(worker.handlers.fetch, {
        method: 'GET',
        url: `https://luzfija.es/${asset}?v=20991231-235959`,
        mode: 'no-cors',
        destination: 'script'
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('cached-recovery-script');
    }
  );

  it.each([
    ['vendor/pdfjs/pdf.min.mjs', 'script'],
    ['vendor/pdfjs/pdf.worker.min.mjs', 'worker']
  ])('recupera %s versionado del mismo build desde la cache runtime en offline', async (asset, destination) => {
    const cached = new Response('cached-pdfjs-runtime', { status: 200 });
    const matches = [];
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async (request, options) => {
        matches.push({ request, options });
        return options?.ignoreSearch ? cached.clone() : undefined;
      }
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => { throw new Error('offline'); }
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: `https://luzfija.es/${asset}?v=${activeCacheVersion}`,
      mode: 'cors',
      destination
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('cached-pdfjs-runtime');
    expect(matches.some(({ options }) => options?.ignoreSearch === true)).toBe(true);
  });

  it.each([408, 429, 500, 503])('sirve HTML cacheado ante HTTP %s', async (status) => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('cached-page', { status: 200 })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('transient-origin-error', { status })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/guias.html',
      mode: 'navigate',
      destination: 'document'
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('cached-page');
  });

  it('conserva un 404 real aunque exista una copia antigua en cache', async () => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('stale-page', { status: 200 })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('not-found', { status: 404 })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/retirada.html',
      mode: 'navigate',
      destination: 'document'
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('not-found');
  });


  it.each([408, 429, 500, 503])('sirve dataset cacheado ante HTTP %s transitorio', async (status) => {
    const puts = [];
    const cache = {
      add: async () => {},
      put: async (...args) => { puts.push(args); },
      match: async () => new Response('{"cached":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('origin transient', { status })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/pvpc/8741/2026-08.json',
      mode: 'cors',
      destination: ''
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cached: true });
    expect(puts).toHaveLength(0);
  });

  it('conserva el 503 del origen si no existe una copia sana del dataset', async () => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => undefined
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('origin transient', { status: 503 })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/pvpc/8741/2026-08.json',
      mode: 'cors',
      destination: ''
    });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('origin transient');
  });

  it('usa dataset cacheado cuando fetch lanza una excepción de red', async () => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('{"offline":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/ssaa/index.json',
      mode: 'cors',
      destination: ''
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ offline: true });
  });

  it('actualiza el censo CNMC desde red y sustituye su copia cacheada sin cambiar de build', async () => {
    const puts = [];
    const fetched = [];
    const cache = {
      add: async () => {},
      put: async (...args) => { puts.push(args); },
      match: async () => new Response('{"_meta":{"count":782}}', { status: 200 })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async (request, init) => {
        fetched.push({ request, init });
        return new Response('{"_meta":{"count":936}}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/cnmc-commercializers.json',
      mode: 'cors',
      destination: ''
    });

    expect(await response.json()).toEqual({ _meta: { count: 936 } });
    expect(fetched[0].init).toEqual({ cache: 'no-store' });
    expect(puts).toHaveLength(1);
  });

  it('mantiene disponible offline el último censo CNMC sano', async () => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('{"_meta":{"count":936}}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => { throw new TypeError('offline'); }
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/cnmc-commercializers.json',
      mode: 'cors',
      destination: ''
    });

    expect(await response.json()).toEqual({ _meta: { count: 936 } });
  });

  it.each([404, 410])('no resucita dataset cacheado ante HTTP %s definitivo', async (status) => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('{"stale":true}', { status: 200 })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('gone', { status })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/ssaa/index.json',
      mode: 'cors',
      destination: ''
    });

    expect(response.status).toBe(status);
    expect(await response.text()).toBe('gone');
  });

  it('sirve el indice de guias cacheado ante un 503 del origen', async () => {
    const cache = {
      add: async () => {},
      put: async () => {},
      match: async () => new Response('{"items":["cache"]}', { status: 200 })
    };
    const worker = loadWorker({
      cache,
      fetchImpl: async () => new Response('origin transient', { status: 503 })
    });

    const response = await dispatchFetch(worker.handlers.fetch, {
      method: 'GET',
      url: 'https://luzfija.es/data/guides-search-index.json',
      mode: 'cors',
      destination: ''
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: ['cache'] });
  });

  it('reintenta un asset core transitorio antes de abortar la instalación', async () => {
    const attempts = new Map();
    const requestCacheModes = [];
    const cache = {
      async add(request) {
        const assetPath = new URL(request.url || String(request)).pathname;
        requestCacheModes.push(request.cache);
        const next = (attempts.get(assetPath) || 0) + 1;
        attempts.set(assetPath, next);
        if (assetPath === '/index.html' && next < 3) throw new Error('transient');
      },
      put: async () => {},
      match: async () => null
    };
    const worker = loadWorker({ cache, fetchImpl: async () => new Response('ok') });
    let installPromise;
    worker.handlers.install({ waitUntil(value) { installPromise = value; } });

    await expect(installPromise).resolves.toBeUndefined();
    expect(attempts.get('/index.html')).toBe(3);
    expect(requestCacheModes.length).toBeGreaterThan(0);
    expect(requestCacheModes.every((mode) => mode === 'reload')).toBe(true);
    expect(worker.skipWaitingCalls).toBe(1);
  });

  it('no activa un build con el núcleo de una ruta precacheado a medias', async () => {
    const cache = {
      async add(request) {
        if (new URL(request.url || String(request)).pathname.endsWith('/js/bv/bv-sim-monthly.js')) {
          throw new Error('persistent');
        }
      },
      put: async () => {},
      match: async () => null
    };
    const worker = loadWorker({ cache, fetchImpl: async () => new Response('ok') });
    let installPromise;
    worker.handlers.install({ waitUntil(value) { installPromise = value; } });

    await expect(installPromise).rejects.toThrow(/solar/);
    expect(worker.skipWaitingCalls).toBe(0);
  });
});

describe('Service Worker: navegacion offline a rutas de directorio', () => {
  // Cache simulada con las claves que el precache guarda de verdad: los
  // index.html, nunca las rutas de directorio.
  function makeCache(entries) {
    return {
      add: async () => {},
      put: async () => {},
      async match(request, options) {
        const raw = typeof request === 'string' ? request : request.url;
        const pathname = new URL(raw, 'https://luzfija.es/').pathname;
        if (Object.prototype.hasOwnProperty.call(entries, pathname)) {
          return new Response(entries[pathname], { status: 200 });
        }
        if (options && options.ignoreSearch) {
          const bare = pathname.split('?')[0];
          if (Object.prototype.hasOwnProperty.call(entries, bare)) {
            return new Response(entries[bare], { status: 200 });
          }
        }
        return undefined;
      }
    };
  }
  const PRECACHE = {
    '/estadisticas/index.html': 'observatorio',
    '/guias/index.html': 'indice-guias',
    '/index.html': 'home'
  };
  const navigate = (url) => ({ method: 'GET', url, mode: 'navigate', destination: 'document' });
  const offline = async () => { throw new TypeError('Failed to fetch'); };

  it('sirve el observatorio, no la home, al navegar offline a /estadisticas/', async () => {
    const worker = loadWorker({ cache: makeCache(PRECACHE), fetchImpl: offline });
    const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/estadisticas/'));
    expect(await res.text()).toBe('observatorio');
  });

  it('sirve el indice de guias, no la home, al navegar offline a /guias/', async () => {
    const worker = loadWorker({ cache: makeCache(PRECACHE), fetchImpl: offline });
    const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/guias/'));
    expect(await res.text()).toBe('indice-guias');
  });

  it('conserva el fallback a la home cuando la ruta no tiene copia propia', async () => {
    const worker = loadWorker({ cache: makeCache(PRECACHE), fetchImpl: offline });
    const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/inexistente/'));
    expect(await res.text()).toBe('home');
  });

  it('da prioridad a la coincidencia exacta de una pagina ya visitada', async () => {
    const cache = makeCache({ ...PRECACHE, '/estadisticas/': 'runtime-visitada' });
    const worker = loadWorker({ cache, fetchImpl: offline });
    const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/estadisticas/'));
    expect(await res.text()).toBe('runtime-visitada');
  });

  it('normaliza tambien la ruta de directorio ante 408/429/5xx', async () => {
    for (const status of [408, 429, 500, 503]) {
      const worker = loadWorker({
        cache: makeCache(PRECACHE),
        fetchImpl: async () => new Response('transient', { status })
      });
      const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/estadisticas/'));
      expect(await res.text()).toBe('observatorio');
    }
  });

  it('no enmascara un 404/410 real de una ruta de directorio', async () => {
    for (const status of [404, 410]) {
      const worker = loadWorker({
        cache: makeCache(PRECACHE),
        fetchImpl: async () => new Response('retirada', { status })
      });
      const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/estadisticas/'));
      expect(res.status).toBe(status);
      expect(await res.text()).toBe('retirada');
    }
  });

  it('no altera la navegacion a una URL de fichero (sin barra final)', async () => {
    const worker = loadWorker({ cache: makeCache(PRECACHE), fetchImpl: offline });
    const res = await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/estadisticas/index.html'));
    expect(await res.text()).toBe('observatorio');
  });

  it('resuelve el index respecto a la ruta pedida, no al dominio raiz', async () => {
    const asked = [];
    const cache = {
      add: async () => {},
      put: async () => {},
      async match(request) {
        const raw = typeof request === 'string' ? request : request.url;
        asked.push(new URL(raw, 'https://luzfija.es/').pathname);
        return undefined;
      }
    };
    const worker = loadWorker({ cache, fetchImpl: offline });
    await dispatchFetch(worker.handlers.fetch, navigate('https://luzfija.es/guias/'));
    expect(asked).toContain('/guias/index.html');
  });
});
