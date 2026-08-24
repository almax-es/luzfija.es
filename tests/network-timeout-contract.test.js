import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../js/lf-csv-utils.js';

const repoRoot = path.resolve(__dirname, '..');

describe('fetchWithTimeout compartido', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborta una petición que supera el deadline y conserva las opciones del caller', async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    global.fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));

    try {
      const pending = window.LF.csvUtils.fetchWithTimeout('/slow.json', { cache: 'no-store' }, 25);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(25);
      await rejected;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toBe('/slow.json');
      expect(global.fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
      expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });


  it('fetchJsonWithTimeout mantiene el deadline hasta consumir un body 200 que queda abierto', async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted body');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    }));

    try {
      const pending = window.LF.csvUtils.fetchJsonWithTimeout('/headers-only.json', { cache: 'no-store' }, 25);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(25);
      await rejected;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it.each([
    ['js/lf-surplus-prices.js', 1],
    ['js/lf-ssaa.js', 1],
    ['js/pvpc-stats-engine.js', 2],
    ['js/pvpc-stats-csv.js', 1],
    ['js/pvpc.js', 2]
  ])('%s enruta sus JSON estáticos por el helper cuyo deadline cubre también el body', (relativePath, expectedCalls) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const helperCalls = source.match(/window\.LF\.csvUtils\.fetchJsonWithTimeout\s*\(/g) || [];
    const directFetchCalls = source.match(/(^|[^.\w])fetch\s*\(/gm) || [];

    expect(helperCalls).toHaveLength(expectedCalls);
    expect(directFetchCalls, `Queda un fetch directo sin deadline de body en ${relativePath}`).toHaveLength(0);
  });

  it('index-extra cubre fetch + json con deadline local sin alterar las opciones historicas de fetch', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'js/index-extra.js'), 'utf8');
    expect(source).toContain('function __pvpcFetchJsonWithDeadline');
    expect(source).toMatch(/Promise\.race\(\[request, timeout\]\)/);
    expect(source).toMatch(/__pvpcFetchJsonWithDeadline\(url, \{ cache: 'no-cache' \}\)/);
    expect(source).toMatch(/fetch\(url, options\)/);
  });

});
