import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const EXCLUDED_PUBLIC_HTML = new Set([
  'guias/index.html'
]);

function collectHtml(dir, base = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'logs') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtml(abs, base, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.relative(base, abs).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('tracking HTML coverage', () => {
  it('carga tracking.js en todas las páginas HTML públicas reales', () => {
    const missing = collectHtml(root)
      .filter((rel) => !EXCLUDED_PUBLIC_HTML.has(rel))
      .filter((rel) => !/src=["'][^"']*\/?js\/tracking\.js\?v=/.test(read(rel)));

    expect(missing).toEqual([]);
  });

  it('permite conectar con GoatCounter en toda página que carga tracking', () => {
    const blocked = collectHtml(root)
      .filter((rel) => !EXCLUDED_PUBLIC_HTML.has(rel))
      .filter((rel) => /tracking\.js\?v=/.test(read(rel)))
      .filter((rel) => !/connect-src[^"]*https:\/\/luzfija\.goatcounter\.com/.test(read(rel)));

    expect(blocked).toEqual([]);
  });
});
