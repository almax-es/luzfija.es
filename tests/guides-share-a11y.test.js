/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const GUIDE_DIR = path.join(ROOT, 'guias');
const SHARE_START = '/* Compartir (global para onclick) */';

function affectedGuides() {
  return fs.readdirSync(GUIDE_DIR)
    .filter((file) => file.endsWith('.html'))
    .filter((file) => fs.readFileSync(path.join(GUIDE_DIR, file), 'utf8').includes('function fallbackCopy(text, done)'))
    .sort();
}

function shareSnippet(file) {
  const html = fs.readFileSync(path.join(GUIDE_DIR, file), 'utf8');
  const start = html.indexOf(SHARE_START);
  const end = html.indexOf('</script>', start);
  return html.slice(start, end);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete document.execCommand;
});

describe('guías: accesibilidad del fallback Copiar', () => {
  it('las 25 guías comparten exactamente el mismo patrón corregido', () => {
    const files = affectedGuides();
    expect(files).toHaveLength(25);
    const reference = shareSnippet(files[0]);

    files.forEach((file) => {
      const snippet = shareSnippet(file);
      expect(snippet, file).toBe(reference);
      expect(snippet, file).toContain("const returnFocus = document.activeElement;");
      expect(snippet, file).toContain("returnFocus.focus()");
      expect(snippet, file).toContain("n.setAttribute('role','status')");
      expect(snippet, file).toContain("n.setAttribute('aria-atomic','true')");
      expect(snippet, file).toMatch(/document\.body\.appendChild\(n\);\s*n\.textContent = '¡Link copiado! 📋';/);
    });
  });

  it('el fallback representativo restaura foco y crea una confirmación status', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<a id="copy" href="#">Copiar</a>';
    document.execCommand = vi.fn(() => true);
    const file = 'autoconsumo-y-placas-solares-lo-basico.html';
    const share = new Function(`${shareSnippet(file)}\nreturn share;`)();
    const trigger = document.getElementById('copy');
    trigger.focus();

    share('copy');

    expect(document.activeElement).toBe(trigger);
    const notice = Array.from(document.querySelectorAll('[role="status"]'))
      .find((el) => el.textContent === '¡Link copiado! 📋');
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('aria-atomic')).toBe('true');
  });
});
