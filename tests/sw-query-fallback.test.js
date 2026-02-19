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
});
