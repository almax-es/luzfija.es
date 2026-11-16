import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Colores de TEXTO con contraste AA (12/11/2026): --accent-text, --ok-text, --warn-text y
 * --danger-text. `color: var(--accent-text)` sin la variable definida no cae al violeta: el texto
 * hereda el color del padre (revision de ChatGPT). Toda pagina que las use debe cargar
 * styles.css, que las define, o definirlas en su propio CSS.
 */

const ROOT = path.resolve(__dirname, '..');
const TOKENS = ['--accent-text', '--ok-text', '--warn-text', '--danger-text'];

function htmlFiles() {
  const out = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  for (const dir of ['guias', 'estadisticas']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.html')) out.push(path.join(dir, f));
  }
  return out;
}

describe('Variables de color de texto', () => {
  it('styles.css las define para los dos temas', () => {
    const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
    for (const t of TOKENS) {
      expect(css).toMatch(new RegExp(':root\\{[^}]*' + t + ':#'));
      expect(css).toMatch(new RegExp('html\\.light-mode\\{[^}]*' + t + ':#'));
    }
  });

  it.each(htmlFiles())('%s define las que usa (o carga styles.css)', (f) => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const usadas = TOKENS.filter((t) => html.includes('var(' + t));
    if (!usadas.length) return;
    if (/<link[^>]+href="\/styles\.css/.test(html)) return;
    for (const t of usadas) {
      expect(html, `${f} usa ${t} sin definirla`).toMatch(new RegExp(':root\\{[^}]*' + t + ':#'));
      expect(html, `${f} usa ${t} sin version clara`).toMatch(new RegExp('html\\.light-mode\\{[^}]*' + t + ':#'));
    }
  });
});
