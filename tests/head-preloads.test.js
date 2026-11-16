import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Preloads explicitos del <head> de las tres aplicaciones (12/11/2026).
 *
 * Con un <meta http-equiv="Content-Security-Policy">, Chromium desactiva el
 * descubrimiento especulativo (html_preload_scanner.cc: "Don't preload anything if
 * a CSP meta tag is found", tras la feature experimental
 * AllowPreloadingWithCSPMetaTag). Sin preloads, los scripts sincronos del head y
 * las hojas de estilo se pedian en serie: CSS desde 1380 ms con 300 ms por recurso
 * frente a 367 ms con esta disposicion. Ver ARRANQUE-CARGA.md 4.8.
 *
 * Contrato que fija este test:
 * - ningun preload va antes del meta CSP;
 * - antes del <script> de frame-guard solo puede precargarse frame-guard (en un
 *   iframe ajeno se descarga igualmente; el resto no debe pedirse alli);
 * - cada preload de script/style tiene despues una etiqueta consumidora con el
 *   MISMO href (incluido ?v=), y no lleva crossorigin (si no, doble descarga);
 * - todo script sincrono y toda hoja de estilo del head posteriores a frame-guard
 *   tienen su preload (si no, vuelven a descubrirse en serie).
 */

const root = path.resolve(__dirname, '..');
const APP_PAGES = ['index.html', 'estadisticas/index.html', 'comparador-tarifas-solares.html'];

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function parseHead(rel) {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  const headEnd = html.search(/<\/head>/i);
  const head = html.slice(0, headEnd);
  const csp = head.search(/<meta\s+http-equiv=["']Content-Security-Policy["']/i);
  const tags = [...head.matchAll(/<(link|script)\b([^>]*)>/gi)].map((m) => ({
    index: m.index,
    kind: m[1].toLowerCase(),
    raw: m[0]
  }));
  const preloads = tags.filter((t) => t.kind === 'link' && /^preload$/i.test(attr(t.raw, 'rel') || ''));
  const scripts = tags.filter((t) => t.kind === 'script' && attr(t.raw, 'src'));
  const stylesheets = tags.filter((t) => t.kind === 'link' && /^stylesheet$/i.test(attr(t.raw, 'rel') || ''));
  const guard = scripts.find((s) => attr(s.raw, 'src').split('?')[0] === '/js/frame-guard.js');
  return { csp, preloads, scripts, stylesheets, guard };
}

describe('Preloads explicitos del <head> (meta CSP sin descubrimiento especulativo)', () => {
  it.each(APP_PAGES)('%s: ningun preload antes del meta CSP', (rel) => {
    const { csp, preloads } = parseHead(rel);
    expect(csp).toBeGreaterThanOrEqual(0);
    for (const p of preloads) {
      expect(p.index, `${rel}: ${p.raw} va antes del meta CSP`).toBeGreaterThan(csp);
    }
  });

  it.each(APP_PAGES)('%s: antes de frame-guard solo se precarga frame-guard', (rel) => {
    const { preloads, guard } = parseHead(rel);
    expect(guard, `${rel}: falta frame-guard en el head`).toBeTruthy();
    const before = preloads.filter((p) => p.index < guard.index);
    for (const p of before) {
      expect(attr(p.raw, 'href'), `${rel}: ${p.raw} se descargaria dentro de un iframe ajeno`)
        .toBe(attr(guard.raw, 'src'));
    }
  });

  it.each(APP_PAGES)('%s: cada preload de script/style tiene consumidor posterior con el mismo href', (rel) => {
    const { preloads, scripts, stylesheets } = parseHead(rel);
    const relevant = preloads.filter((p) => /^(script|style)$/i.test(attr(p.raw, 'as') || ''));
    expect(relevant.length).toBeGreaterThan(0);
    for (const p of relevant) {
      const href = attr(p.raw, 'href');
      const as = attr(p.raw, 'as').toLowerCase();
      expect(/\bcrossorigin\b/i.test(p.raw), `${rel}: ${href} no debe llevar crossorigin`).toBe(false);
      const consumers = as === 'script'
        ? scripts.filter((s) => attr(s.raw, 'src') === href)
        : stylesheets.filter((s) => attr(s.raw, 'href') === href);
      expect(consumers.length, `${rel}: preload sin consumidor con el mismo href: ${href}`).toBeGreaterThan(0);
      expect(consumers[0].index, `${rel}: el consumidor de ${href} debe ir despues del preload`).toBeGreaterThan(p.index);
      for (const c of consumers) {
        expect(/\bcrossorigin\b/i.test(c.raw), `${rel}: el consumidor de ${href} lleva crossorigin`).toBe(false);
      }
    }
  });

  it.each(APP_PAGES)('%s: los scripts sincronos y las hojas del head tras frame-guard estan precargados', (rel) => {
    const { preloads, scripts, stylesheets, guard } = parseHead(rel);
    const preloaded = new Set(preloads.map((p) => attr(p.raw, 'href')));
    const syncAfterGuard = scripts.filter((s) => s.index > guard.index && !/\b(defer|async)\b/i.test(s.raw));
    for (const s of syncAfterGuard) {
      expect(preloaded.has(attr(s.raw, 'src')), `${rel}: falta preload de ${attr(s.raw, 'src')}`).toBe(true);
    }
    for (const s of stylesheets) {
      expect(preloaded.has(attr(s.raw, 'href')), `${rel}: falta preload de ${attr(s.raw, 'href')}`).toBe(true);
    }
  });

  it.each(APP_PAGES)('%s: los preloads de fuentes llevan crossorigin y no estan duplicados', (rel) => {
    const { preloads } = parseHead(rel);
    const hrefs = preloads.map((p) => attr(p.raw, 'href'));
    expect(new Set(hrefs).size, `${rel}: preload duplicado`).toBe(hrefs.length);
    for (const p of preloads.filter((x) => /^font$/i.test(attr(x.raw, 'as') || ''))) {
      expect(/\bcrossorigin\b/i.test(p.raw), `${rel}: la fuente ${attr(p.raw, 'href')} necesita crossorigin`).toBe(true);
    }
  });
});
