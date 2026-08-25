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
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'logs' || entry.name.startsWith('.codex-')) continue;
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

const GOATCOUNTER_ORIGIN = 'https://luzfija.goatcounter.com';

function cspDirectives(html) {
  const meta = html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  if (!meta) return new Map();
  const content = meta[0].match(/\bcontent=(["'])(.*?)\1/i);
  if (!content) return new Map();
  const directives = new Map();
  for (const rawDirective of content[2].split(';')) {
    const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    directives.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return directives;
}

function sourceAllowsGoatCounter(source) {
  const value = String(source || '').toLowerCase();
  if (value === '*' || value === 'https:') return true;
  if (value === GOATCOUNTER_ORIGIN) return true;
  if (value === 'https://*.goatcounter.com') return true;
  return false;
}

function directiveAllowsGoatCounter(directives, name) {
  const sources = directives.get(name) || directives.get('default-src') || [];
  return sources.some(sourceAllowsGoatCounter);
}

function loadsTracking(html) {
  return /src=["'][^"']*\/?js\/tracking\.js\?v=/.test(html);
}

describe('tracking HTML coverage', () => {
  it('carga tracking.js en todas las páginas HTML públicas reales', () => {
    const missing = collectHtml(root)
      .filter((rel) => !EXCLUDED_PUBLIC_HTML.has(rel))
      .filter((rel) => !/src=["'][^"']*\/?js\/tracking\.js\?v=/.test(read(rel)));

    expect(missing).toEqual([]);
  });

  it('aplica default-src solo cuando falta la directiva específica', () => {
    const inherited = cspDirectives(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self' https://luzfija.goatcounter.com;">`
    );
    expect(directiveAllowsGoatCounter(inherited, 'img-src')).toBe(true);
    expect(directiveAllowsGoatCounter(inherited, 'connect-src')).toBe(true);

    const overridden = cspDirectives(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self' https://luzfija.goatcounter.com; img-src 'self';">`
    );
    expect(directiveAllowsGoatCounter(overridden, 'img-src')).toBe(false);
    expect(directiveAllowsGoatCounter(overridden, 'connect-src')).toBe(true);
  });

  it('toda página que carga tracking permite GoatCounter en img-src y connect-src, incluida la herencia de default-src', () => {
    const contradictions = collectHtml(root).flatMap((rel) => {
      const html = read(rel);
      if (!loadsTracking(html)) return [];
      const directives = cspDirectives(html);
      const missing = ['img-src', 'connect-src'].filter(
        (directive) => !directiveAllowsGoatCounter(directives, directive)
      );
      return missing.length ? [{ page: rel, missing }] : [];
    });

    expect(contradictions).toEqual([]);
  });
});
