import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

/**
 * @vitest-environment jsdom
 */

const updateCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-sw-update.js'), 'utf8');

describe('SW deferred reload timing', () => {
  let serviceWorker;
  let swHandlers;
  let reloadPage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T08:00:00Z'));
    sessionStorage.clear();
    document.body.innerHTML = '';
    delete window.__LF_PENDING_INIT_RECOVERY;
    delete window.__LF_BUILD_ID;
    delete window.__LF_trackDetail;
    delete window.__LF_INIT_AUTO_RELOAD_PENDING;
    swHandlers = {};
    reloadPage = vi.fn();

    class FakeMessageChannel {
      constructor() {
        this.port1 = {};
        this.port2 = { owner: this };
      }
    }

    const controller = {
      postMessage(_message, ports) {
        const channel = ports[0].owner;
        queueMicrotask(() => channel.port1.onmessage({ data: { version: '20260722-080441' } }));
      }
    };
    serviceWorker = {
      controller,
      addEventListener(type, fn) { swHandlers[type] = fn; },
      getRegistration: vi.fn(async () => null),
      register: vi.fn(async () => ({ addEventListener() {}, update: vi.fn() }))
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete'
    });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    });
    window.MessageChannel = FakeMessageChannel;
    globalThis.MessageChannel = FakeMessageChannel;
    window.LF = {};
    new Function(updateCode)();
    const initSwUpdate = window.LF.initSwUpdate;
    window.LF.initSwUpdate = (opts) => initSwUpdate({ ...opts, reloadPage });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.LF;
    delete window.__LF_PENDING_INIT_RECOVERY;
    delete window.__LF_BUILD_ID;
    delete window.__LF_trackDetail;
    delete window.__LF_INIT_AUTO_RELOAD_PENDING;
  });

  it('reintenta al acabar la supresión inicial sin esperar al intervalo de 15 minutos', async () => {
    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    swHandlers.controllerchange();

    expect(sessionStorage.getItem('__LF_SW_RELOADED_VERSION__:/')).toBeNull();
    await vi.advanceTimersByTimeAsync(10_100);

    expect(sessionStorage.getItem('__LF_SW_RELOADED_VERSION__:/')).toBe('20260722-080441');
  });

  it('desplaza el reintento hasta 30 segundos después de la última interacción', async () => {
    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    swHandlers.controllerchange();
    window.dispatchEvent(new Event('pointerdown'));

    await vi.advanceTimersByTimeAsync(29_900);
    expect(sessionStorage.getItem('__LF_SW_RELOADED_VERSION__:/')).toBeNull();

    await vi.advanceTimersByTimeAsync(200);
    expect(sessionStorage.getItem('__LF_SW_RELOADED_VERSION__:/')).toBe('20260722-080441');
  });

  it('fuerza update, detecta el build obsoleto y ofrece una recarga explícita', async () => {
    const active = serviceWorker.controller;
    const update = vi.fn(async () => {});
    const registration = { active, waiting: null, addEventListener() {}, update };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    window.__LF_BUILD_ID = '20260703-152347';
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'home',
      dependency: 'factura-parsers',
      build: '20260703-152347'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(update).toHaveBeenCalled();
    const banner = document.getElementById('lf-init-recovery');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('versión anterior');
    expect(banner.querySelector('button')?.textContent).toBe('Recargar ahora');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['client-recovery', 'home', 'factura-parsers', '20260703-152347', '20260722-080441', 'stale'],
      expect.any(Object)
    );
  });

  it('programa una sola recarga automática para un script esencial fallido al arrancar', async () => {
    const active = serviceWorker.controller;
    const registration = { active, waiting: null, addEventListener() {}, update: vi.fn(async () => {}) };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-utils-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(true);
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'error-context',
      ['client-recovery-auto', 'lf-utils-js', '20260722-080441', '20260722-080441'],
      expect.any(Object)
    );
    await vi.advanceTimersByTimeAsync(750);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('no repite la recarga automática si el mismo arranque vuelve a fallar', async () => {
    const active = serviceWorker.controller;
    const registration = { active, waiting: null, addEventListener() {}, update: vi.fn(async () => {}) };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    sessionStorage.setItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/', '1');
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-utils-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBeUndefined();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(window.__LF_trackDetail).not.toHaveBeenCalledWith(
      'error-context',
      expect.arrayContaining(['client-recovery-auto']),
      expect.any(Object)
    );
    expect(document.getElementById('lf-init-recovery')).toBeTruthy();
  });

  it('nunca recarga automáticamente un script dinámico fallido en runtime', async () => {
    const active = serviceWorker.controller;
    const registration = { active, waiting: null, addEventListener() {}, update: vi.fn(async () => {}) };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'xlsx-full-min-js',
      build: '20260722-080441',
      phase: 'runtime'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBeNull();
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBeUndefined();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(document.getElementById('lf-init-recovery')).toBeTruthy();
  });

  it('mantiene la recarga manual si el usuario ya ha interactuado', async () => {
    const active = serviceWorker.controller;
    const registration = { active, waiting: null, addEventListener() {}, update: vi.fn(async () => {}) };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-state-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBeNull();
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(false);
    const banner = document.getElementById('lf-init-recovery');
    expect(banner).toBeTruthy();

    banner.querySelector('button').click();
    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('cancela definitivamente el intento automático si hay interacción durante la espera', async () => {
    const active = serviceWorker.controller;
    const registration = { active, waiting: null, addEventListener() {}, update: vi.fn(async () => {}) };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-state-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(true);

    window.dispatchEvent(new Event('pointerdown'));
    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBeNull();
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(false);

    await vi.advanceTimersByTimeAsync(31_000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('aplaza la recuperación automática mientras la pestaña está oculta', async () => {
    const active = serviceWorker.controller;
    const registration = { active, waiting: null, addEventListener() {}, update: vi.fn(async () => {}) };
    serviceWorker.getRegistration.mockResolvedValue(registration);
    serviceWorker.register.mockResolvedValue(registration);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-cache-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBeNull();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(200);

    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(true);
  });

  it('limpia el guard anti-bucle al completar después un arranque sano', () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://luzfija.es/',
      runScripts: 'outside-only'
    });
    const isolatedWindow = dom.window;
    Object.defineProperty(isolatedWindow.document, 'readyState', {
      configurable: true,
      value: 'interactive'
    });
    isolatedWindow.eval(updateCode);
    isolatedWindow.sessionStorage.setItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/', '1');

    isolatedWindow.LF.initSwUpdate({ swUrl: '/sw.js' });
    expect(isolatedWindow.sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    isolatedWindow.dispatchEvent(new isolatedWindow.Event('load'));

    expect(isolatedWindow.sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBeNull();
    dom.window.close();
  });

  it('no limpia el guard antes de que terminen los scripts iniciales posteriores al coordinador', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://luzfija.es/',
      runScripts: 'outside-only'
    });
    const isolatedWindow = dom.window;
    Object.defineProperty(isolatedWindow.document, 'readyState', {
      configurable: true,
      value: 'interactive'
    });
    isolatedWindow.eval(updateCode);
    isolatedWindow.sessionStorage.setItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/', '1');

    isolatedWindow.LF.initSwUpdate({ swUrl: '/sw.js', reloadPage });
    isolatedWindow.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'index-extra-js',
      build: '20260722-080441',
      phase: 'initial'
    }];
    isolatedWindow.dispatchEvent(new isolatedWindow.Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(isolatedWindow.sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(isolatedWindow.__LF_INIT_AUTO_RELOAD_PENDING).toBeUndefined();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(isolatedWindow.document.getElementById('lf-init-recovery')).toBeTruthy();
    dom.window.close();
  });

  it('recupera la carga inicial aunque falle el registro del service worker', async () => {
    serviceWorker.register.mockRejectedValue(new Error('registro no disponible'));
    serviceWorker.getRegistration.mockResolvedValue(null);
    window.__LF_trackDetail = vi.fn();
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-inputs-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('lf-init-recovery')).toBeTruthy();
    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(true);
  });

  it('acota una API de service worker bloqueada y continúa con la recuperación', async () => {
    serviceWorker.register.mockReturnValue(new Promise(() => {}));
    serviceWorker.getRegistration.mockReturnValue(new Promise(() => {}));
    window.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-cache-js',
      build: '20260722-080441',
      phase: 'initial'
    }];

    window.LF.initSwUpdate({ swUrl: '/sw.js' });
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1_500);
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('lf-init-recovery')).toBeTruthy();
    expect(sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(window.__LF_INIT_AUTO_RELOAD_PENDING).toBe(true);
  });

  it('mantiene la recuperación aun cuando el navegador no ofrece service worker', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://luzfija.es/',
      runScripts: 'outside-only'
    });
    const isolatedWindow = dom.window;
    Object.defineProperty(isolatedWindow.document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
    Object.defineProperty(isolatedWindow.navigator, 'onLine', {
      configurable: true,
      value: true
    });
    isolatedWindow.setTimeout = vi.fn();
    isolatedWindow.setInterval = vi.fn();
    isolatedWindow.__LF_trackDetail = vi.fn();
    isolatedWindow.__LF_PENDING_INIT_RECOVERY = [{
      app: 'resource',
      dependency: 'lf-render-js',
      build: '20260722-080441',
      phase: 'initial'
    }];
    isolatedWindow.eval(updateCode);

    isolatedWindow.LF.initSwUpdate({ swUrl: '/sw.js' });
    isolatedWindow.dispatchEvent(new isolatedWindow.Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(isolatedWindow.document.getElementById('lf-init-recovery')).toBeTruthy();
    expect(isolatedWindow.sessionStorage.getItem('__LF_INIT_RECOVERY_AUTO_RELOAD__:/')).toBe('1');
    expect(isolatedWindow.__LF_INIT_AUTO_RELOAD_PENDING).toBe(true);
    expect(isolatedWindow.setTimeout).toHaveBeenCalled();
    dom.window.close();
  });
});
