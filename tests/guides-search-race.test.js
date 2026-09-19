/**
 * @vitest-environment jsdom
 */

// Carrera entre la busqueda y el filtro de categoria, reportada en auditoria el 12/09/2026.
// `applySearch()` sigue adelante despues de `await ensureIndex()` sin comprobar si su busqueda
// sigue siendo la vigente: si el usuario pulsa una categoria mientras el indice viaja, al llegar
// pisa el estado que dejo la categoria, deja tarjetas de resultados en un contenedor oculto y
// anuncia un recuento que no corresponde a lo que se ve.
//
// Va en un fichero propio a proposito: el de resiliencia usa temporizadores simulados en su
// beforeEach, y aqui hace falta tiempo real para poder soltar la respuesta del indice a mitad.
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
      <a class="guide-card" href="/guias/otra.html" data-categories="solar">
        <h3>Otra guía</h3>
        <p>Placas y excedentes</p>
      </a>
    </div>
    <div id="searchResults" hidden></div>
    <div id="noResults"></div>
    <button class="category-btn" data-category="todas"></button>
    <button class="category-btn" data-category="solar"></button>
  `;
}

const indicePayload = {
  guides: [{
    path: '/guias/ejemplo.html',
    title: 'Guía de ejemplo',
    description: 'Contenido visible básico',
    content: 'batería virtual y autoconsumo',
    headings: [], faq: [], aliases: [],
    categories: ['ahorro'], level: 'básico', slug: 'ejemplo'
  }]
};

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Buscador de guías: carrera entre búsqueda y categoría', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/guias.html');
    renderGuidesDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete global.fetch;
  });

  it('una búsqueda en vuelo no pisa la categoría elegida después', async () => {
    let soltarIndice;
    global.fetch = vi.fn(() => new Promise((resolve) => {
      soltarIndice = () => resolve({ ok: true, json: async () => indicePayload });
    }));

    GuideSearch.init({ document, indexUrl: '/data/guides-search-index.json' });
    const input = document.getElementById('searchInput');

    input.value = 'bateria';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(120);                       // deja pasar el debounce de 80 ms

    // El usuario se cansa de esperar y filtra por categoría.
    document.querySelector('.category-btn[data-category="solar"]').click();

    // Ahora llega el índice que pidió la búsqueda abandonada.
    soltarIndice();
    await tick(30);

    const resultados = document.getElementById('searchResults');
    const estado = document.getElementById('searchStatus');
    // Manda la última acción del usuario, no la respuesta que llegó tarde.
    expect(document.getElementById('guidesGrid').hidden).toBe(false);
    expect(resultados.hidden).toBe(true);
    expect(resultados.querySelectorAll('.search-result-card')).toHaveLength(0);
    expect(estado.textContent || '').not.toMatch(/resultados? para/i);
  });

  it('la búsqueda sí manda cuando nadie la interrumpe', async () => {
    // Control positivo: sin este caso, cancelar SIEMPRE dejaria el test anterior en verde.
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => indicePayload }));

    GuideSearch.init({ document, indexUrl: '/data/guides-search-index.json' });
    const input = document.getElementById('searchInput');

    input.value = 'bateria';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(150);

    const resultados = document.getElementById('searchResults');
    expect(resultados.hidden).toBe(false);
    expect(resultados.querySelectorAll('.search-result-card').length).toBeGreaterThan(0);
  });
});
