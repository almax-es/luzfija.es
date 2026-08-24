/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GuideSearch = require('../js/guides-search.js');

function renderGuidesDom() {
  document.body.innerHTML = `
    <input id="searchInput" />
    <div id="searchStatus" hidden></div>
    <div class="featured"></div>
    <div id="guidesGrid">
      <a class="guide-card" href="/guias/ejemplo.html" data-categories="ahorro">
        <h3>Guía de ejemplo</h3>
        <p>Contenido visible básico</p>
      </a>
    </div>
    <div id="searchResults" hidden></div>
    <div id="noResults"></div>
    <button class="category-btn" data-category="todas"></button>
  `;
}

async function dispatchDebouncedSearch(input, status, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(81);

  // El callback del debounce dispara applySearch(), pero no devuelve su Promise.
  // Esperamos la condición observable (dejar 'loading') en vez de asumir un número
  // concreto de microtareas; así el test no depende de la velocidad de la máquina.
  for (let i = 0; i < 20 && status.dataset.state === 'loading'; i += 1) {
    await Promise.resolve();
  }
}

describe('Guides search runtime resilience', () => {
  beforeEach(() => {
    // Cada búsqueda actualiza ?q= mediante history.replaceState(). Sin resetear
    // la URL, el siguiente init() interpreta la query del test anterior como
    // búsqueda inicial y consume un fetch antes del intento que el test controla.
    window.history.replaceState({}, '', '/guias.html');
    renderGuidesDom();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    delete global.fetch;
  });

  it('reintenta el índice tras un 503 en vez de conservar una Promise rechazada', async () => {
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({
          guides: [{
            path: '/guias/ejemplo.html',
            title: 'Guía de ejemplo',
            description: 'Contenido visible básico',
            content: 'batería virtual y autoconsumo',
            headings: [],
            faq: [],
            aliases: [],
            categories: ['ahorro'],
            level: 'básico',
            slug: 'ejemplo'
          }]
        })
      };
    });

    GuideSearch.init({ document, indexUrl: '/data/guides-search-index.json' });
    const input = document.getElementById('searchInput');
    const status = document.getElementById('searchStatus');

    await dispatchDebouncedSearch(input, status, 'bateria');
    expect(status.dataset.state).toBe('fallback');
    expect(attempts).toBe(1);

    await dispatchDebouncedSearch(input, status, 'autoconsumo');

    expect(attempts).toBe(2);
    expect(status.dataset.state).toBe('ready');
    expect(document.querySelectorAll('#searchResults .search-result-card')).toHaveLength(1);
  });
  it('abandona un 200 cuyo body no termina y cae a búsqueda básica en vez de quedar cargando', async () => {
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

    GuideSearch.init({
      document,
      indexUrl: '/data/guides-search-index.json',
      indexTimeoutMs: 25
    });
    const input = document.getElementById('searchInput');
    const status = document.getElementById('searchStatus');

    input.value = 'ejemplo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(81);
    expect(status.dataset.state).toBe('loading');

    await vi.advanceTimersByTimeAsync(25);
    for (let i = 0; i < 20 && status.dataset.state === 'loading'; i += 1) await Promise.resolve();

    expect(status.dataset.state).toBe('fallback');
    expect(status.textContent).toContain('modo básico');
  });

  it('reintenta un índice HTTP 200 malformado en vez de fijar el fallback hasta recargar', async () => {
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { ok: true, json: async () => ({ guides: [] }) };
      return {
        ok: true,
        json: async () => ({
          guides: [{
            path: '/guias/ejemplo.html',
            title: 'Guía de ejemplo',
            description: 'Contenido visible básico',
            content: 'batería virtual y autoconsumo',
            headings: [],
            faq: [],
            aliases: [],
            categories: ['ahorro'],
            level: 'básico',
            slug: 'ejemplo'
          }]
        })
      };
    });

    GuideSearch.init({ document, indexUrl: '/data/guides-search-index.json' });
    const input = document.getElementById('searchInput');
    const status = document.getElementById('searchStatus');

    await dispatchDebouncedSearch(input, status, 'bateria');
    expect(status.dataset.state).toBe('fallback');

    await dispatchDebouncedSearch(input, status, 'autoconsumo');

    expect(attempts).toBe(2);
    expect(status.dataset.state).toBe('ready');
    expect(document.querySelectorAll('#searchResults .search-result-card')).toHaveLength(1);
  });

});
