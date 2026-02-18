/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { JSDOM } from 'jsdom';

const REPO_ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'logs']);

function walkHtmlFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walkHtmlFiles(path.join(dirPath, entry.name)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.join(dirPath, entry.name));
    }
  }

  return files;
}

function sha256Base64(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('base64');
}

describe('CSP inline hash guardrails', () => {
  it('keeps inline script hashes aligned when unsafe-inline is not present', () => {
    const htmlFiles = walkHtmlFiles(REPO_ROOT);
    const errors = [];

    for (const filePath of htmlFiles) {
      const html = fs.readFileSync(filePath, 'utf8');
      const dom = new JSDOM(html);
      const doc = dom.window.document;

      const cspMeta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
      if (!cspMeta) continue;

      const csp = String(cspMeta.getAttribute('content') || '');
      const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/i);
      if (!scriptSrcMatch) continue;

      const scriptSrc = scriptSrcMatch[1];
      if (scriptSrc.includes("'unsafe-inline'")) continue;

      const cspHashes = [...scriptSrc.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
      const inlineScripts = [...doc.querySelectorAll('script:not([src])')];
      if (!inlineScripts.length) continue;

      inlineScripts.forEach((scriptEl, idx) => {
        const hash = sha256Base64(scriptEl.textContent || '');
        if (!cspHashes.includes(hash)) {
          const relPath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
          const type = scriptEl.getAttribute('type') || 'text/javascript';
          errors.push(`${relPath}: script inline #${idx + 1} (${type}) missing sha256-${hash}`);
        }
      });
    }

    expect(errors).toEqual([]);
  });
});
