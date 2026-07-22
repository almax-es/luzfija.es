import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const updateCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-sw-update.js'), 'utf8');

describe('SW deferred reload timing', () => {
  let serviceWorker;
  let swHandlers;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T08:00:00Z'));
    sessionStorage.clear();
    swHandlers = {};

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
    window.MessageChannel = FakeMessageChannel;
    globalThis.MessageChannel = FakeMessageChannel;
    window.LF = {};
    new Function(updateCode)();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.LF;
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
});
