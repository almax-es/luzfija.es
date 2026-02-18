/**
 * @vitest-environment node
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');

function walkHtmlFiles(dirPath) {
  const out = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'logs') continue;
      out.push(...walkHtmlFiles(path.join(dirPath, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.join(dirPath, entry.name));
    }
  }

  return out;
}

describe('Service worker cache fallback for versioned assets', () => {
  it('has ignoreSearch fallback when HTML references assets with query params', () => {
    const swPath = path.join(REPO_ROOT, 'sw.js');
    const swContent = fs.readFileSync(swPath, 'utf8');

    const htmlFiles = walkHtmlFiles(REPO_ROOT);
    const queryRefs = [];
    const queryRe = /(?:src|href)\s*=\s*["'][^"']+\?v=[^"']*["']/gi;

    for (const filePath of htmlFiles) {
      const html = fs.readFileSync(filePath, 'utf8');
      const matches = html.match(queryRe);
      if (matches?.length) {
        queryRefs.push(...matches);
      }
    }

    expect(queryRefs.length).toBeGreaterThan(0);
    expect(swContent).toContain('cache.match(req, { ignoreSearch: true })');

    const scriptStyleBranch = /req\.destination === "script"\s*\|\|\s*req\.destination === "style"\s*\|\|\s*req\.destination === "worker"[\s\S]*?cache\.match\(req,\s*\{\s*ignoreSearch:\s*true\s*\}\)/;
    expect(scriptStyleBranch.test(swContent)).toBe(true);
  });
});
