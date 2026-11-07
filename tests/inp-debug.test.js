import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @vitest-environment jsdom
 */

const inpDebugCode = fs.readFileSync(path.resolve(__dirname, '../js/inp-debug.js'), 'utf8');

function bootstrapInpDebug() {
  new Function(inpDebugCode)();
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  delete window.__LF_DEBUG;
  delete window.__LF_INP_DEBUG_ACTIVE;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('INP debug instrumentation', () => {
  it('permanece inactivo fuera del modo de depuración', () => {
    const observe = vi.fn();
    vi.stubGlobal('PerformanceObserver', class { observe = observe; });

    bootstrapInpDebug();

    expect(window.__LF_INP_DEBUG_ACTIVE).toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
  });

  it('mide la peor interacción relevante cuando se activa con ?debug=1', () => {
    let callback;
    const observe = vi.fn();
    vi.stubGlobal('PerformanceObserver', class {
      constructor(next) {
        callback = next;
      }

      observe(options) {
        observe(options);
      }
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    window.history.replaceState({}, '', '/?debug=1');

    bootstrapInpDebug();

    expect(window.__LF_DEBUG).toBe(true);
    expect(window.__LF_INP_DEBUG_ACTIVE).toBe(true);
    expect(observe).toHaveBeenCalledWith({ type: 'event', durationThreshold: 40, buffered: true });

    callback({
      getEntries: () => [
        { name: 'pointermove', duration: 300, interactionId: 1 },
        { name: 'click', duration: 120, interactionId: 2, target: Object.assign(document.createElement('button'), { id: 'calcular' }) },
        { name: 'keydown', duration: 90, interactionId: 3 }
      ]
    });
    window.dispatchEvent(new Event('pagehide'));

    expect(log).toHaveBeenCalledWith('[INP][debug] peor interacción: 120 ms (click en button#calcular)');
  });

  it('se activa mediante la preferencia local lf_debug=1', () => {
    const observe = vi.fn();
    vi.stubGlobal('PerformanceObserver', class { observe = observe; });
    localStorage.setItem('lf_debug', '1');

    bootstrapInpDebug();

    expect(window.__LF_DEBUG).toBe(true);
    expect(window.__LF_INP_DEBUG_ACTIVE).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it('no duplica la instrumentación si el script se carga dos veces', () => {
    const observe = vi.fn();
    vi.stubGlobal('PerformanceObserver', class { observe = observe; });
    window.history.replaceState({}, '', '/?debug=1');

    bootstrapInpDebug();
    bootstrapInpDebug();

    expect(window.__LF_INP_DEBUG_ACTIVE).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
  });
});
