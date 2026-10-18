import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * @vitest-environment jsdom
 *
 * js/frame-guard.js: LuzFija.es no funciona dentro de un iframe de otra web.
 * Estos tests fijan la logica (ventana simulada) y el contrato de carga del HTML.
 * El comportamiento real del navegador (window.stop, navegacion del iframe,
 * sandbox, clic en la ventana superior) se valido el 18/10/2026 en Chrome,
 * WebKit y Firefox con dos origenes; ver ARRANQUE-CARGA.md, seccion 4.7.
 */

const root = path.resolve(__dirname, '..');
const guardCode = fs.readFileSync(path.join(root, 'js/frame-guard.js'), 'utf8');
const NOTICE = 'pagina-incrustada.html';
const noticeHtml = fs.readFileSync(path.join(root, NOTICE), 'utf8');
const ORIGIN = 'https://luzfija.es';

function makeDocument(html = '<!doctype html><html><head></head><body></body></html>') {
  return new JSDOM(html, { url: `${ORIGIN}/`, virtualConsole: new VirtualConsole() }).window.document;
}

// jsdom deja el documento en 'loading' hasta el siguiente ciclo; para probar la rama de
// documento ya parseado hay que esperar a DOMContentLoaded.
async function loadedDocument(html) {
  const doc = makeDocument(html);
  if (doc.readyState === 'loading') {
    await new Promise((resolve) => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  return doc;
}

/**
 * Ventana simulada. `ancestors` imita location.ancestorOrigins (Chromium/WebKit);
 * sin `ancestors`, el guard cae a leer top.location (Firefox), que lanza
 * SecurityError si `topOrigin` es de otro origen.
 */
function makeWindow({ url = `${ORIGIN}/`, framed = false, ancestors, topOrigin = ORIGIN, topNavigationThrows = false, storage = {} } = {}) {
  const parsed = new URL(url);
  const topNavigations = [];
  const win = {
    location: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      ancestorOrigins: ancestors,
      replace: vi.fn()
    },
    stop: vi.fn(),
    localStorage: { getItem: (key) => (key in storage ? storage[key] : null) }
  };
  win.self = win;
  if (!framed) {
    win.top = win;
  } else {
    const topLocation = {
      get origin() {
        if (topOrigin !== parsed.origin) throw new Error('SecurityError: cross-origin');
        return topOrigin;
      },
      set href(value) {
        if (topNavigationThrows) throw new Error('SecurityError: sandboxed');
        topNavigations.push(value);
      }
    };
    win.top = { location: topLocation };
  }
  return { win, topNavigations };
}

function runGuard(win, doc = makeDocument()) {
  new Function('window', 'document', guardCode)(win, doc);
  return doc;
}

describe('frame-guard: deteccion de iframe ajeno', () => {
  it('abierta normalmente no hace nada', () => {
    const { win } = makeWindow();
    runGuard(win);
    expect(win.stop).not.toHaveBeenCalled();
    expect(win.location.replace).not.toHaveBeenCalled();
    expect(win.__LF_FRAME_BLOCKED).toBeUndefined();
    expect(win.__LF_FRAME_GUARD).toBe(true);
  });

  it('dentro de un iframe del mismo origen la app sigue funcionando', () => {
    const { win } = makeWindow({ framed: true, ancestors: [ORIGIN] });
    runGuard(win);
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it('dentro de una web ajena detiene la carga y lleva el iframe al aviso con la ruta original', () => {
    const { win } = makeWindow({
      url: `${ORIGIN}/guias/cups-que-es.html?x=1#faq`,
      framed: true,
      ancestors: ['https://asesoria.example']
    });
    runGuard(win);
    expect(win.__LF_FRAME_BLOCKED).toBe(true);
    expect(win.stop).toHaveBeenCalledTimes(1);
    expect(win.location.replace).toHaveBeenCalledWith(
      `/${NOTICE}?desde=${encodeURIComponent('/guias/cups-que-es.html?x=1#faq')}`
    );
    // Primero se para la carga: ningun script posterior llega a ejecutarse.
    expect(win.stop.mock.invocationCallOrder[0])
      .toBeLessThan(win.location.replace.mock.invocationCallOrder[0]);
  });

  it('bloquea un iframe propio metido a su vez en una web ajena', () => {
    const { win } = makeWindow({ framed: true, ancestors: [ORIGIN, 'https://ajena.example'] });
    runGuard(win);
    expect(win.location.replace).toHaveBeenCalledTimes(1);
  });

  it('sin ancestorOrigins (Firefox) bloquea si leer la ventana superior lanza SecurityError', () => {
    const { win } = makeWindow({ framed: true, topOrigin: 'https://ajena.example' });
    runGuard(win);
    expect(win.location.replace).toHaveBeenCalledTimes(1);
  });

  it('sin ancestorOrigins (Firefox) permite el iframe del mismo origen', () => {
    const { win } = makeWindow({ framed: true, topOrigin: ORIGIN });
    runGuard(win);
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it('es idempotente: una segunda evaluacion no repite nada', () => {
    const { win } = makeWindow({ framed: true, ancestors: ['https://ajena.example'] });
    runGuard(win);
    runGuard(win);
    expect(win.stop).toHaveBeenCalledTimes(1);
    expect(win.location.replace).toHaveBeenCalledTimes(1);
  });
});

describe('frame-guard: pagina de aviso', () => {
  const noticeUrl = (desde) => `${ORIGIN}/${NOTICE}` + (desde === null ? '' : `?desde=${encodeURIComponent(desde)}`);

  it.each([
    ['/guias.html?a=1#b', `${ORIGIN}/guias.html?a=1#b`],
    ['//evil.example/x', `${ORIGIN}/`],
    ['/\\evil.example', `${ORIGIN}/`],
    ['/\t/evil.example', `${ORIGIN}/`],
    ['https://evil.example/', `${ORIGIN}/`],
    ['javascript:alert(1)', `${ORIGIN}/`],
    [`/${NOTICE}?desde=/`, `${ORIGIN}/`],
    [null, `${ORIGIN}/`]
  ])('abierta fuera de un iframe ajeno con desde=%s va a %s (nunca a otro origen)', (desde, expected) => {
    const { win } = makeWindow({ url: noticeUrl(desde) });
    runGuard(win, makeDocument(noticeHtml));
    expect(win.location.replace).toHaveBeenCalledWith(expected);
    expect(win.stop).not.toHaveBeenCalled();
  });

  it('dentro de una web ajena se queda y prepara el enlace a la pagina original', async () => {
    const { win, topNavigations } = makeWindow({
      url: noticeUrl('/estadisticas/'),
      framed: true,
      ancestors: ['https://ajena.example']
    });
    const doc = runGuard(win, await loadedDocument(noticeHtml));
    expect(win.location.replace).not.toHaveBeenCalled();

    const link = doc.getElementById('abrir-luzfija');
    expect(link.href).toBe(`${ORIGIN}/estadisticas/`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');

    // Iframe normal: el clic navega la ventana superior y anula la pestana nueva.
    const notPrevented = link.dispatchEvent(new doc.defaultView.MouseEvent('click', { cancelable: true }));
    expect(notPrevented).toBe(false);
    expect(topNavigations).toEqual([`${ORIGIN}/estadisticas/`]);
  });

  it('si el sandbox impide navegar la ventana superior, el clic sigue y abre pestana nueva', async () => {
    const { win } = makeWindow({
      url: noticeUrl('/'),
      framed: true,
      ancestors: ['https://ajena.example'],
      topNavigationThrows: true
    });
    const doc = runGuard(win, await loadedDocument(noticeHtml));
    const link = doc.getElementById('abrir-luzfija');
    // Se intercepta la accion por defecto en burbuja para que jsdom no intente navegar.
    let defaultPreventedByGuard = null;
    doc.addEventListener('click', (event) => {
      defaultPreventedByGuard = event.defaultPrevented;
      event.preventDefault();
    });
    link.dispatchEvent(new doc.defaultView.MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(defaultPreventedByGuard).toBe(false);
    expect(link.target).toBe('_blank');
  });

  it('respeta el tema claro guardado sin esperar a DOMContentLoaded', () => {
    const { win } = makeWindow({
      url: noticeUrl('/'),
      framed: true,
      ancestors: ['https://ajena.example'],
      storage: { almax_theme: 'light' }
    });
    const doc = runGuard(win, makeDocument(noticeHtml));
    expect(doc.documentElement.classList.contains('light-mode')).toBe(true);
  });

  it('si el documento aun se esta parseando, prepara el enlace en DOMContentLoaded', () => {
    const { win } = makeWindow({ url: noticeUrl('/guias.html'), framed: true, ancestors: ['https://ajena.example'] });
    const doc = makeDocument(noticeHtml);
    Object.defineProperty(doc, 'readyState', { configurable: true, value: 'loading' });
    runGuard(win, doc);
    const link = doc.getElementById('abrir-luzfija');
    expect(link.getAttribute('href')).toBe('/');
    doc.dispatchEvent(new doc.defaultView.Event('DOMContentLoaded'));
    expect(link.href).toBe(`${ORIGIN}/guias.html`);
  });

  it('funciona sin JS: noindex, enlace al inicio en la ventana superior y sin app ni analitica', () => {
    expect(noticeHtml).toMatch(/<meta name="robots" content="noindex,follow"\/>/);
    const doc = makeDocument(noticeHtml);
    const link = doc.getElementById('abrir-luzfija');
    expect(link.getAttribute('href')).toBe('/');
    expect(link.getAttribute('target')).toBe('_top');
    const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src').split('?')[0]);
    expect(scripts).toEqual(['/js/frame-guard.js']);
    // En un iframe con sandbox el origen es opaco: unas fuentes propias fallarian por CORS.
    expect(doc.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
  });
});

function collectHtml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'logs'].includes(entry.name) || entry.name.startsWith('.codex-')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(path.relative(root, abs).replace(/\\/g, '/'));
  }
  return out.sort();
}

function scriptTags(html) {
  return [...html.matchAll(/<script\b([^>]*)>/gi)]
    .filter((match) => !/type=["']application\/ld\+json["']/i.test(match[1]))
    .map((match) => ({
      index: match.index,
      src: (match[1].match(/\bsrc=["']([^"']+)["']/i) || [])[1] || null,
      attrs: match[1]
    }));
}

describe('frame-guard: contrato de carga en el HTML', () => {
  const pages = collectHtml(root);
  const isScriptlessRedirect = (html) => /script-src 'none'/.test(html);

  it('las unicas paginas sin el guard son redirecciones sin scripts', () => {
    for (const rel of pages) {
      const html = fs.readFileSync(path.join(root, rel), 'utf8');
      if (html.includes('/js/frame-guard.js')) continue;
      expect(isScriptlessRedirect(html), `${rel}: falta js/frame-guard.js`).toBe(true);
      expect(html, `${rel}: sin guard debe ser una redireccion`).toMatch(/http-equiv="refresh"/);
      expect(scriptTags(html), `${rel}: una pagina sin guard no puede ejecutar scripts`).toEqual([]);
    }
  });

  it.each(pages.filter((rel) => !isScriptlessRedirect(fs.readFileSync(path.join(root, rel), 'utf8'))))(
    '%s carga frame-guard una vez, sincrono, en el <head>, antes del CSS y de cualquier otro script salvo error-bootstrap',
    (rel) => {
      const html = fs.readFileSync(path.join(root, rel), 'utf8');
      const scripts = scriptTags(html);
      const guards = scripts.filter((s) => s.src && s.src.split('?')[0] === '/js/frame-guard.js');
      expect(guards, `${rel}: frame-guard.js debe aparecer exactamente una vez`).toHaveLength(1);
      const guard = guards[0];

      expect(/\b(defer|async)\b/i.test(guard.attrs), `${rel}: frame-guard.js no puede llevar defer/async`).toBe(false);
      expect(guard.index).toBeLessThan(html.search(/<\/head>/i));

      const firstStylesheet = html.search(/<link\b[^>]*rel=["']stylesheet["']/i);
      if (firstStylesheet >= 0) {
        expect(guard.index, `${rel}: frame-guard.js debe ir antes de la primera hoja de estilo`).toBeLessThan(firstStylesheet);
      }

      const position = scripts.indexOf(guard);
      const bootstrapPosition = scripts.findIndex((s) => s.src && s.src.split('?')[0] === '/js/error-bootstrap.js');
      if (bootstrapPosition >= 0) {
        // Aplicaciones: error-bootstrap.js sigue siendo el primer script externo para ver
        // tambien un fallo de carga del guard; el guard va justo detras.
        expect(position, `${rel}: frame-guard.js debe ir justo despues de error-bootstrap.js`).toBe(bootstrapPosition + 1);
      } else {
        expect(position, `${rel}: frame-guard.js debe ser el primer <script> de la pagina`).toBe(0);
      }
    }
  );

  it('el service worker precachea como nucleo el guard y la pagina de aviso', () => {
    // Sin red y sin el aviso en cache, la navegacion caeria a index.html servido en la ruta
    // del aviso; ahi el guard no para la carga y la app arrancaria en el iframe ajeno.
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const core = sw.match(/const CORE_ASSETS = \[([\s\S]*?)\n\];/)[1];
    const assets = sw.match(/const ASSETS = \[([\s\S]*?)\n\];/)[1];
    expect(core).toContain('"js/frame-guard.js"');
    expect(core).toContain(`"${NOTICE}"`);
    expect(assets).toContain(`"${NOTICE}"`);
  });
});
