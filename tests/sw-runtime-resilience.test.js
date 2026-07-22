import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const swCode = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');

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
      url: `https://luzfija.es/${asset}?v=20260722-080441`,
      mode: 'no-cors',
      destination: 'script'
    });
    const tracking = await dispatchFetch(worker.handlers.fetch, requestFor('js/tracking.js'));
    const sender = await dispatchFetch(worker.handlers.fetch, requestFor('vendor/goatcounter/count.js'));

    expect(tracking.status).toBe(200);
    expect(await tracking.text()).toBe('cached-current-build');
    expect(sender.type).toBe('error');
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
