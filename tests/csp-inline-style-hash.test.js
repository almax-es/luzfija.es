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

describe('CSP inline style guardrails', () => {
  it('keeps style hashes aligned when unsafe-inline is not present in style-src', () => {
    const htmlFiles = walkHtmlFiles(REPO_ROOT);
    const errors = [];

    for (const filePath of htmlFiles) {
      const html = fs.readFileSync(filePath, 'utf8');
      const dom = new JSDOM(html);
      const doc = dom.window.document;

      const cspMeta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
      if (!cspMeta) continue;

      const csp = String(cspMeta.getAttribute('content') || '');
      const styleSrcMatch = csp.match(/style-src\s+([^;]+)/i);
      if (!styleSrcMatch) continue;

      const styleSrc = styleSrcMatch[1];
      if (styleSrc.includes("'unsafe-inline'")) continue;

      const relPath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
      const cspHashes = [...styleSrc.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
      const inlineStyles = [...doc.querySelectorAll('style')];
      const styleAttrs = [...doc.querySelectorAll('[style]')];

      if (styleAttrs.length > 0) {
        errors.push(`${relPath}: contiene ${styleAttrs.length} atributo(s) style inline`);
      }

      inlineStyles.forEach((styleEl, idx) => {
        const hash = sha256Base64(styleEl.textContent || '');
        if (!cspHashes.includes(hash)) {
          errors.push(`${relPath}: bloque <style> #${idx + 1} missing sha256-${hash}`);
        }
      });
    }

    expect(errors).toEqual([]);
  });
});
