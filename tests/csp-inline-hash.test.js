import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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

function getCspContent(html) {
  const match = html.match(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=["']([^"]*)["'][^>]*>/i
  );
  return match ? match[1] : '';
}

function getScriptSrcDirective(csp) {
  return csp
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.toLowerCase().startsWith('script-src ')) || '';
}

function extractInlineScriptBodies(html) {
  const matches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  return matches
    .filter((m) => !/\bsrc\s*=/.test(m[1]))
    .map((m) => m[2]);
}

function sha256Base64(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('base64');
}

describe('CSP inline script hashes', () => {
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
