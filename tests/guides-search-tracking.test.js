/**
 * @vitest-environment jsdom
 */

// Analitica del buscador de guias, auditada el 23/09/2026. La busqueda se pinta con un debounce
// de 80 ms y cada busqueda pintada mandaba su evento `guias-busqueda`: escribir "reclamacion" a
// 200 ms por tecla producia 11 eventos en vez de uno, casi todos en los buckets de prefijos a
// medio escribir (1-3 / 4-8 caracteres con 10-plus resultados). El evento sale ahora una sola vez,
// cuando la consulta se asienta o cuando el usuario actua sobre ella.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const GuideSearch = require('../js/guides-search.js');
const indiceReal = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../data/guides-search-index.json'), 'utf8'
));

function renderGuidesDom() {
  document.body.innerHTML = `
    <input id="searchInput" />
    <div id="searchStatus" hidden></div>
    <div class="featured"></div>
    <div id="guidesGrid">
      <a class="guide-card" href="/guias/como-reclamar-a-comercializadora-distribuidora.html" data-categories="tramites">
        <h3>Cómo reclamar</h3>
        <p>Reclamaciones a comercializadora y distribuidora</p>
      </a>
    </div>
    <div id="searchResults" hidden></div>
    <div id="noResults"></div>
    <button class="category-btn" data-category="todas"></button>
    <button class="category-btn" data-category="tramites"></button>
  `;
}

async function teclear(input, texto, msPorTecla) {
  for (let i = 1; i <= texto.length; i += 1) {
    input.value = texto.slice(0, i);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(msPorTecla);
  }
}

describe('Buscador de guías: un evento de analítica por búsqueda', () => {
  let eventos;
  let input;

  beforeEach(async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/guias.html');
    renderGuidesDom();
    eventos = [];
    window.__LF_trackDetail = (nombre, detalle) => {
      eventos.push([nombre, ...[].concat(detalle)].join('/'));
    };
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => indiceReal }));
    GuideSearch.init({ document, indexUrl: '/data/guides-search-index.json' });
    input = document.getElementById('searchInput');
    await vi.advanceTimersByTimeAsync(2000); // precarga del indice en reposo
  });

  afterEach(() => {
    // Cada init() deja su listener de pagehide en window: se drena aqui el pendiente de este test
    // para que no aparezca en el recuento del siguiente.
    window.dispatchEvent(new Event('pagehide'));
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.__LF_trackDetail;
    delete global.fetch;
  });

  it('teclear a ritmo normal manda un único evento con los buckets de la consulta final', async () => {
    await teclear(input, 'reclamacion', 200);
    // Los prefijos intermedios SI se pintan (la UI no pierde reactividad)...
    expect(document.getElementById('searchStatus').textContent).toContain('"reclamacion"');
    // ...pero todavia no han contado.
    expect(eventos).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatch(/^guias-busqueda\/index\/[^/]+\/9-16$/);
  });

  it('pulsar un resultado antes de asentarse envía la búsqueda al momento y solo una vez', async () => {
    await teclear(input, 'bono', 200);
    const resultado = document.querySelector('#searchResults a[href]');
    expect(resultado).toBeTruthy();
    resultado.addEventListener('click', (event) => event.preventDefault());
    resultado.click();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatch(/\/4-8$/);

    await vi.advanceTimersByTimeAsync(3000);
    expect(eventos).toHaveLength(1);
  });

  it('borrar la consulta antes de asentarse no cuenta ninguna búsqueda', async () => {
    await teclear(input, 'bono', 200);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(eventos).toEqual([]);
  });

  it('elegir una categoría cuenta la búsqueda que estaba a la vista', async () => {
    await teclear(input, 'bono', 200);
    document.querySelector('.category-btn[data-category="tramites"]').click();
    expect(eventos.filter((e) => e.startsWith('guias-busqueda/'))).toHaveLength(1);
    expect(eventos).toContain('guias-categoria/tramites');

    await vi.advanceTimersByTimeAsync(3000);
    expect(eventos.filter((e) => e.startsWith('guias-busqueda/'))).toHaveLength(1);
  });

  it('abandonar la página antes de asentarse no pierde la búsqueda', async () => {
    await teclear(input, 'bono', 200);
    window.dispatchEvent(new Event('pagehide'));
    expect(eventos).toHaveLength(1);
  });
});

// Relevancia, auditada el mismo dia con el indice real. El prefijo inverso aceptaba tokens de una
// o dos letras ("aerotermia" casaba con "a", "alquiler" con "al", "estafa" con la stopword "esta"),
// asi que esas consultas devolvian las 25 guias; y el bonus de frase de una sola palabra primaba el
// literal exacto, de modo que "facturas" ponia primero la guia de aerotermia.
describe('Buscador de guías: relevancia con el índice real', () => {
  const guias = GuideSearch.prepareGuidesIndex(indiceReal.guides);
  const texto = (resultado) => GuideSearch.normalizeText(JSON.stringify(resultado.entry));

  it.each(['aerotermia', 'alquiler', 'estafa', 'autoconsumo', 'mudanza'])(
    '"%s" solo devuelve guías que contienen la palabra',
    (consulta) => {
      const resultados = GuideSearch.searchGuides(guias, consulta);
      expect(resultados.length).toBeGreaterThan(0);
      expect(resultados.length).toBeLessThan(indiceReal.guides.length);
      const raiz = consulta.slice(0, 6);
      for (const resultado of resultados) expect(texto(resultado)).toContain(raiz);
    }
  );

  it('el plural encuentra y ordena como el singular', () => {
    const titulos = GuideSearch.searchGuides(guias, 'facturas').slice(0, 3)
      .map((r) => GuideSearch.normalizeText(r.entry.title));
    for (const titulo of titulos) expect(titulo).toContain('factura');
    expect(GuideSearch.searchGuides(guias, 'reclamaciones')[0].entry.path)
      .toBe('/guias/como-reclamar-a-comercializadora-distribuidora.html');
  });

  it('una palabra de tres letras no es forma corta de una consulta más larga', () => {
    const [sintetica] = GuideSearch.prepareGuidesIndex([{
      path: '/guias/x.html', title: 'Guía', content: 'la cuota fija del bic'
    }]);
    expect(GuideSearch.scoreGuideEntry(sintetica, 'bicis')).toBeNull();
    expect(GuideSearch.scoreGuideEntry(sintetica, 'cuotas')).not.toBeNull();
  });
});

// Texto "Coincide en contenido", auditado el 23/09/2026: recortaba el cuerpo de la guia desde el
// principio y en 219 de 240 tarjetas el fragmento no contenia la palabra buscada.
describe('Buscador de guías: el fragmento de contenido muestra la palabra buscada', () => {
  const guias = GuideSearch.prepareGuidesIndex(indiceReal.guides);
  const GENERICO = 'Coincide en el contenido de la guía';

  it.each(['maximetro', 'nocturno', 'datadis', 'icp', 'contador', 'precio', 'horas valle', 'facturas'])(
    '"%s": cada fragmento de contenido contiene la palabra o no enseña fragmento',
    (consulta) => {
      const terminos = GuideSearch.tokenizeQuery(consulta);
      const deContenido = GuideSearch.searchGuides(guias, consulta)
        .filter((r) => r.primaryMatch.label === 'contenido');
      expect(deContenido.length).toBeGreaterThan(0);
      for (const resultado of deContenido) {
        const texto = GuideSearch.formatMatch(resultado.primaryMatch, terminos);
        if (texto === GENERICO) continue;
        const visible = GuideSearch.normalizeText(texto);
        expect(terminos.some((t) => visible.includes(t))).toBe(true);
        expect(texto.length).toBeLessThanOrEqual(150);
      }
    }
  );

  it('sin aparición literal (solo por raíz) no enseña un fragmento sin relación', () => {
    const match = { label: 'contenido', snippet: 'Texto que habla de otra cosa distinta', score: 1 };
    expect(GuideSearch.formatMatch(match, ['reclamaciones'])).toBe(GENERICO);
  });

  it('la tarjeta pintada lleva el fragmento con la palabra, tildes incluidas', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState({}, '', '/guias.html');
      renderGuidesDom();
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => indiceReal }));
      GuideSearch.init({ document, indexUrl: '/data/guides-search-index.json' });
      const input = document.getElementById('searchInput');
      input.value = 'maximetro';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(200);
      const textos = [...document.querySelectorAll('#searchResults .search-match')].map((n) => n.textContent);
      expect(textos.some((t) => t.includes('maxímetro'))).toBe(true);
    } finally {
      window.dispatchEvent(new Event('pagehide'));
      vi.useRealTimers();
      document.body.innerHTML = '';
      delete global.fetch;
    }
  });
});
