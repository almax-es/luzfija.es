/**
 * @vitest-environment jsdom
 */

// Pagina 404 (24/09/2026). Toda visita a una URL inexistente contaba como `/404.html` y no habia
// forma de saber que enlaces rotos llegaban. `js/not-found.js` sugiere la pagina real mas
// parecida y envia `pagina-404/<seccion>/<pagina>` con esa pagina EXISTENTE, nunca lo tecleado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const NotFound = require('../js/not-found.js');
const root = path.resolve(__dirname, '..');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const candidatas = NotFound.candidatesFromSitemap(sitemap);

const detalle = (ruta) => NotFound.eventDetailFor(ruta, NotFound.findClosestPage(ruta, candidatas)).join('/');

describe('404: candidatas desde el sitemap', () => {
  it('toma solo las páginas HTML del sitemap, sin duplicados', () => {
    const locsHtml = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => new URL(m[1]).pathname)
      .filter((p) => /(\/|\.html)$/.test(p));
    expect(candidatas.map((c) => c.path)).toEqual(locsHtml);
    expect(candidatas.some((c) => c.path.endsWith('.txt'))).toBe(false);
  });
});

describe('404: la página real más parecida', () => {
  it.each([
    ['/guias/cups-que-es-y-donde-encontralo.html', 'guias/cups-que-es-y-donde-encontrarlo'],
    ['/cups-que-es-y-donde-encontrarlo.html', 'guias/cups-que-es-y-donde-encontrarlo'],
    ['/Guias/CUPS-que-es-y-donde-encontrarlo.html', 'guias/cups-que-es-y-donde-encontrarlo'],
    ['/cups', 'guias/cups-que-es-y-donde-encontrarlo'],
    ['/bono-social', 'guias/bono-social-electrico-quien-puede-pedirlo-y-como'],
    ['/guias/como-leer-la-factura-de-la-luz', 'guias/como-leer-tu-factura-de-la-luz-paso-a-paso'],
    ['/guia-coche-electrico', 'guias/coche-electrico-que-tarifa-elegir-y-como-cargar-barato'],
    ['/estadistica', 'raiz/estadisticas'],
    ['/inicio', 'raiz/home'],
    ['/404.html', 'directa']
  ])('%s -> %s', (ruta, esperado) => {
    expect(detalle(ruta)).toBe(esperado);
  });

  // Ante la duda, nada: una sugerencia arbitraria es peor que ninguna.
  it.each(['/tarifas', '/pvpc', '/factura', '/comparador', '/wp-admin', '/xmlrpc.php', '/blog', '/a'])(
    '%s es ambigua o ajena y no sugiere nada',
    (ruta) => {
      expect(detalle(ruta)).toBe('desconocida');
    }
  );

  it('lo tecleado nunca viaja: el detalle es una página del sitemap o una palabra fija', () => {
    const permitidos = new Set(['desconocida', 'directa', 'sin-sitemap',
      ...candidatas.map((c) => `${c.section}/${c.slug}`)]);
    const rutas = [
      '/juan-perez-garcia-12345678Z', '/guias/maria@example.com', '/ES0021000000000000AA',
      '/guias/mi-dni-12345678z-factura', '/cups-ES0031405555555555JN0F', '/tel-600123456',
      '/%E2%9C%93-raro', '/../../etc/passwd', '/guias/cups-que-es?x=1'
    ];
    for (const ruta of rutas) expect(permitidos.has(detalle(ruta))).toBe(true);
  });
});

describe('404: sugerencia y evento en la página', () => {
  afterEach(() => {
    delete global.fetch;
    delete window.__LF_trackDetail;
    document.body.innerHTML = '';
  });

  function montar(respuestas) {
    document.body.innerHTML = '<div id="notFoundSuggestion" hidden></div>';
    const eventos = [];
    window.__LF_trackDetail = (nombre, det) => eventos.push([nombre, ...det].join('/'));
    global.fetch = vi.fn(async (url) => {
      const r = respuestas[url];
      if (r instanceof Error) throw r;
      return r ? { ok: true, text: async () => r } : { ok: false, status: 404, text: async () => '' };
    });
    return eventos;
  }

  it('pinta el enlace con el título real de la página y envía un evento', async () => {
    const eventos = montar({
      '/sitemap.xml': sitemap,
      '/guias/cups-que-es-y-donde-encontrarlo.html': '<title>CUPS: qué es y dónde encontrarlo | LuzFija.es</title>'
    });
    await NotFound.init({ document, pathname: '/cups' });
    const caja = document.getElementById('notFoundSuggestion');
    expect(caja.hidden).toBe(false);
    const enlace = caja.querySelector('a');
    expect(enlace.getAttribute('href')).toBe('/guias/cups-que-es-y-donde-encontrarlo.html');
    expect(enlace.textContent).toBe('CUPS: qué es y dónde encontrarlo');
    expect(eventos).toEqual(['pagina-404/guias/cups-que-es-y-donde-encontrarlo']);
  });

  it('si no puede leer el título usa el nombre de la página y sigue sugiriendo', async () => {
    montar({ '/sitemap.xml': sitemap });
    await NotFound.init({ document, pathname: '/cups' });
    expect(document.querySelector('#notFoundSuggestion a').textContent).toBe('Cups que es y donde encontrarlo');
  });

  it('sin coincidencia no muestra nada y cuenta la 404 como desconocida', async () => {
    const eventos = montar({ '/sitemap.xml': sitemap });
    await NotFound.init({ document, pathname: '/wp-admin' });
    expect(document.getElementById('notFoundSuggestion').hidden).toBe(true);
    expect(eventos).toEqual(['pagina-404/desconocida']);
  });

  it('si falla el sitemap no sugiere nada y lo distingue en el evento', async () => {
    const eventos = montar({ '/sitemap.xml': new Error('offline') });
    await NotFound.init({ document, pathname: '/cups' });
    expect(document.getElementById('notFoundSuggestion').hidden).toBe(true);
    expect(eventos).toEqual(['pagina-404/sin-sitemap']);
  });
});

describe('404: integración', () => {
  const html = fs.readFileSync(path.join(root, '404.html'), 'utf8');

  it('404.html tiene el hueco de la sugerencia y carga el módulo después de tracking.js', () => {
    expect(html).toMatch(/id="notFoundSuggestion"[^>]*aria-live="polite"[^>]*hidden/);
    const tracking = html.indexOf('/js/tracking.js');
    const modulo = html.search(/<script src="\/js\/not-found\.js\?v=[^"]+" defer><\/script>/);
    expect(tracking).toBeGreaterThan(0);
    expect(modulo).toBeGreaterThan(tracking);
  });

  it('el service worker precachea el módulo para la 404 sin conexión', () => {
    expect(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')).toContain('"js/not-found.js"');
  });
});

// El "Sabias que..." de la 404 llevaba un mito (la habitacion 404 del CERN, desmentido por el
// propio CERN), un PVPC que "se actualiza cada hora" (se publica la vispera) y cifras sin fuente
// ("hasta un 50 %", "hasta un 70 %", "mas de 350 comercializadoras"). 24/09/2026: sustituidos por
// datos que las guias ya verifican.
describe('404: el "Sabías que..." solo afirma datos verificables', () => {
  const html = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  const bloque = html.slice(html.indexOf('const facts = ['), html.indexOf('];', html.indexOf('const facts = [')));

  it('no repite el mito del CERN ni cifras de ahorro sin fuente', () => {
    expect(bloque).not.toMatch(/CERN/i);
    expect(bloque).not.toMatch(/hasta un \d+ ?%/i);
    expect(bloque).not.toMatch(/cada hora/i);
    expect(bloque).not.toMatch(/más de \d+ comercializadoras/i);
  });

  it('muestra un dato real aunque no se ejecute JavaScript', () => {
    expect(html).not.toContain('>Cargar...<');
    expect(html).toMatch(/id="funFact">[^<]{20,}</);
  });
});

