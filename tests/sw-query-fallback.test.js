import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function walkHtmlFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtmlFiles(fullPath));
    else if (entry.isFile() && fullPath.endsWith('.html')) out.push(fullPath);
  }
  return out;
}

describe('Service Worker query fallback', () => {
  it('uses ignoreSearch on cache.match(req) when versioned assets are present', () => {
    const root = path.resolve(__dirname, '..');
    const htmlFiles = walkHtmlFiles(root);
    const hasVersionedAssets = htmlFiles.some((file) => {
      const html = fs.readFileSync(file, 'utf8');
      return /(?:href|src)\s*=\s*["'][^"']+\?[^"']*\bv=/.test(html);
    });

    if (!hasVersionedAssets) {
      expect(true).toBe(true);
      return;
    }

    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const reqCalls = [...sw.matchAll(/cache\.match\(req(?:,\s*\{[^}]*\})?\)/g)];

    const missingIgnoreSearch = reqCalls
      .filter((m) => !/ignoreSearch\s*:\s*true/.test(m[0]))
      .map((m) => ({
        line: sw.slice(0, m.index).split(/\r?\n/).length,
        call: m[0]
      }));

    expect(missingIgnoreSearch, JSON.stringify(missingIgnoreSearch, null, 2)).toEqual([]);
  });

  it('precaches the SSAA helper loaded by the main calculators', () => {
    const root = path.resolve(__dirname, '..');
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const solarHtml = fs.readFileSync(path.join(root, 'comparador-tarifas-solares.html'), 'utf8');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

    expect(indexHtml).toContain('js/lf-ssaa.js');
    expect(solarHtml).toContain('js/lf-ssaa.js');
    expect(sw).toContain('"js/lf-ssaa.js"');
  });

  it('instala como core las cadenas de factura y desglose cargadas siempre por la home', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const coreBlock = sw.match(/const CORE_ASSETS = \[([\s\S]*?)\n\];/);

    expect(coreBlock).not.toBeNull();
    for (const asset of [
      'js/factura-parsers.js',
      'js/factura.js',
      'js/desglose-calculo.js',
      'js/desglose-render.js',
      'js/desglose-factura.js',
      'js/desglose-integration.js'
    ]) {
      expect(coreBlock[1]).toContain(`"${asset}"`);
    }
  });

  it('usa la cache del build ante respuestas HTTP fallidas de scripts', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const scriptBranch = sw.match(/if \(req\.destination === "script"[\s\S]*?\n  }\n\n  \/\/ Tarifas:/);

    expect(scriptBranch).not.toBeNull();
    expect(scriptBranch[0]).toMatch(/if \(!fresh\.ok\) throw new Error/);
    expect(scriptBranch[0]).toMatch(/cache\.match\(new Request\(url\.pathname\)\)/);
  });

  it('serves assistant reference files network-first to avoid stale LLM metadata', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

    expect(sw).toContain('ASSISTANT_REFERENCE_PATHS');
    expect(sw).toContain('new URL("llms.txt", SCOPE).pathname');
    expect(sw).toContain('new URL("llms-full.txt", SCOPE).pathname');
    expect(sw).toMatch(/url\.pathname\s*===\s*GUIDES_SEARCH_INDEX_PATH\s*\|\|\s*ASSISTANT_REFERENCE_PATHS\.has\(url\.pathname\)/);
    expect(sw).toMatch(/fetch\(req,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  });

  it('exposes CACHE_VERSION via GET_VERSION for the per-version reload guard', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

    expect(sw).toContain('GET_VERSION');
    expect(sw).toMatch(/event\.ports\s*&&\s*event\.ports\[0\]/);
    expect(sw).toMatch(/postMessage\(\{ version: CACHE_VERSION \}\)/);
  });

  it('migrates only solar tabs that still have the known buggy June cache', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

    expect(sw).toContain('LEGACY_SOLAR_CLOSEST_CACHE');
    expect(sw).toContain('luzfija-static-20260620-051941');
    expect(sw).toMatch(/cacheKeys\.includes\(LEGACY_SOLAR_CLOSEST_CACHE\)/);
    expect(sw).toMatch(/new URL\("comparador-tarifas-solares\.html", SCOPE\)\.pathname/);
    expect(sw).toMatch(/client\.navigate\(client\.url\)/);
    expect(sw).toMatch(/await reloadLegacySolarClients\(keys\)/);
  });
});
