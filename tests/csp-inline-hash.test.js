import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FILE_PROCESSING_PAGES = [
  'index.html',
  'comparador-tarifas-solares.html',
  'estadisticas/index.html'
];

// Directorios que contienen paginas publicas del sitio. Lista blanca deliberada.
//
// El repo contiene HTML que NO son paginas servidas: fixtures de tests, dashboards
// locales del validador de tarifas en `.codex-*/`, artefactos de depuracion. Recorrer
// el arbol entero con lista negra obligaba a ampliarla cada vez que aparecia uno nuevo
// y, peor, hacia que estos guardrails dependieran de ficheros gitignorados: fallaban en
// local y pasaban en CI, donde esos directorios no existen.
//
// Si algun dia se publica una seccion nueva, basta con anadirla aqui; el test
// "la lista blanca cubre todo lo que se publica" avisa si se olvida.
const PUBLIC_PAGE_DIRS = ['.', 'guias', 'estadisticas'];

function walkHtmlFiles(root) {
  const out = [];
  for (const dir of PUBLIC_PAGE_DIRS) {
    const abs = path.resolve(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.html')) out.push(path.join(abs, entry.name));
    }
  }
  return out.sort();
}

function getCspContent(html) {
  const match = html.match(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=["']([^"]*)["'][^>]*>/i
  );
  return match ? match[1] : '';
}

function getScriptSrcDirective(csp) {
  return getDirective(csp, 'script-src');
}

function getDirective(csp, name) {
  return csp
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.toLowerCase().startsWith(`${name} `)) || '';
}

function extractInlineScriptBodies(html) {
  const matches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  return matches
    .filter((m) => !/\bsrc\s*=/.test(m[1]))
    .map((m) => m[2]);
}

function sha256Base64(content) {
  const normalized = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('base64');
}

describe('CSP inline script hashes', () => {
  // Centinela de la lista blanca: si se publica una seccion nueva y no se anade a
  // PUBLIC_PAGE_DIRS, sus paginas quedarian fuera de TODOS los guardrails de CSP sin
  // que nada avisara. El sitemap es la fuente de verdad de lo que se sirve.
  it('la lista blanca de directorios cubre todo lo que se publica en el sitemap', () => {
    const root = path.resolve(__dirname, '..');
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    const covered = new Set(
      walkHtmlFiles(root).map((f) => path.relative(root, f).replace(/\\/g, '/'))
    );

    const uncovered = [...sitemap.matchAll(/<loc>https:\/\/luzfija\.es\/([^<]*)<\/loc>/g)]
      .map((m) => m[1])
      .filter((p) => !p.endsWith('.txt'))
      .map((p) => (p === '' ? 'index.html' : p.endsWith('/') ? `${p}index.html` : p))
      .filter((p) => !covered.has(p));

    expect(uncovered, `paginas publicadas fuera de PUBLIC_PAGE_DIRS: ${uncovered.join(', ')}`)
      .toEqual([]);
  });

  it('limits wasm evaluation to the home PDF and OCR surface', () => {
    const root = path.resolve(__dirname, '..');
    const pagesWithWasmEval = walkHtmlFiles(root)
      .filter((file) => getScriptSrcDirective(getCspContent(fs.readFileSync(file, 'utf8')))
        .includes("'wasm-unsafe-eval'"))
      .map((file) => path.relative(root, file).replace(/\\/g, '/'));

    expect(pagesWithWasmEval).toEqual(['index.html']);
  });

  it('does not allow unrestricted HTTPS image sources', () => {
    const root = path.resolve(__dirname, '..');
    const violations = [];

    for (const file of walkHtmlFiles(root)) {
      const csp = getCspContent(fs.readFileSync(file, 'utf8'));
      const imgSrc = getDirective(csp, 'img-src');
      const relativePath = path.relative(root, file).replace(/\\/g, '/');

      if (!imgSrc) {
        violations.push(`${relativePath}: missing img-src`);
      } else if (imgSrc.split(/\s+/).includes('https:')) {
        violations.push(`${relativePath}: img-src allows unrestricted https:`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps file-processing pages on strict hashed script-src policies', () => {
    const root = path.resolve(__dirname, '..');
    const violations = [];

    for (const relativePath of FILE_PROCESSING_PAGES) {
      const html = fs.readFileSync(path.join(root, relativePath), 'utf8');
      const csp = getCspContent(html);
      const scriptSrc = getScriptSrcDirective(csp);

      if (!csp) violations.push(`${relativePath}: missing CSP`);
      if (!scriptSrc) violations.push(`${relativePath}: missing script-src`);
      if (scriptSrc.includes("'unsafe-inline'")) {
        violations.push(`${relativePath}: script-src allows unsafe-inline`);
      }
      if (!/'sha256-[^']+'/.test(scriptSrc)) {
        violations.push(`${relativePath}: script-src has no sha256 hash`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('strict script-src pages keep CSP hashes aligned with inline scripts', () => {
    const root = path.resolve(__dirname, '..');
    const htmlFiles = walkHtmlFiles(root);
    const mismatches = [];

    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, 'utf8');
      const csp = getCspContent(html);
      if (!csp) continue;

      const scriptSrc = getScriptSrcDirective(csp);
      if (!scriptSrc || scriptSrc.includes("'unsafe-inline'")) continue;

      const cspHashes = [...scriptSrc.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
      const actualHashes = extractInlineScriptBodies(html).map(sha256Base64);

      const missing = actualHashes.filter((h) => !cspHashes.includes(h));
      const extra = cspHashes.filter((h) => !actualHashes.includes(h));

      if (missing.length || extra.length || cspHashes.length !== actualHashes.length) {
        mismatches.push({
          file: path.relative(root, file).replace(/\\/g, '/'),
          missing: missing.map((h) => `sha256-${h}`),
          extra: extra.map((h) => `sha256-${h}`)
        });
      }
    }

    expect(mismatches, JSON.stringify(mismatches, null, 2)).toEqual([]);
  });
});
