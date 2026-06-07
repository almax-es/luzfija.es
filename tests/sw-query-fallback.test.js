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

  it('serves assistant reference files network-first to avoid stale LLM metadata', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

    expect(sw).toContain('ASSISTANT_REFERENCE_PATHS');
    expect(sw).toContain('new URL("llms.txt", SCOPE).pathname');
    expect(sw).toContain('new URL("llms-full.txt", SCOPE).pathname');
    expect(sw).toMatch(/url\.pathname\s*===\s*GUIDES_SEARCH_INDEX_PATH\s*\|\|\s*ASSISTANT_REFERENCE_PATHS\.has\(url\.pathname\)/);
    expect(sw).toMatch(/fetch\(req,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  });
});
