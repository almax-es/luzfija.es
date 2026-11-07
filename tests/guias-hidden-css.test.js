/**
 * @vitest-environment node
 *
 * 29/09/2026. `guias.html` es una pagina autonoma: no carga `styles.css`, que es donde vive la
 * regla global `[hidden]{display:none !important}`. Su propio `.guides-grid{display:grid}` ganaba al
 * atributo `hidden` (la hoja del autor pesa mas que la del navegador), asi que `guides-search.js`
 * hacia `guidesGrid.hidden = true` sin efecto: con 5 resultados las 22 guias seguian renderizadas
 * debajo, y con 0 resultados el aviso "No encontramos nada" salia despues de toda la lista.
 * Medido en Chrome real (`guidesGrid`: hidden=true, display=grid, 1.924 px de alto).
 *
 * jsdom no aplica CSS, asi que los tests de comportamiento del buscador no podian verlo: se fija la
 * regla en la propia hoja de la pagina.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const inlineCss = (html) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const HIDDEN_RULE = /(^|[}\s])\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/;

describe('guias.html: el atributo hidden oculta de verdad', () => {
  const html = read('guias.html');

  it('la pagina no carga styles.css, asi que necesita su propia regla [hidden]', () => {
    // Si algun dia carga styles.css, la regla local sobra pero no estorba; este test avisa
    // para revisar esta premisa en vez de dejarla caducar en silencio.
    expect(html).not.toMatch(/href="[^"]*styles\.css/);
    expect(inlineCss(html)).toMatch(HIDDEN_RULE);
  });

  it('el buscador oculta contenedores con hidden que la pagina declara con display:grid', () => {
    const css = inlineCss(html);
    expect(css).toMatch(/\.guides-grid\s*\{[^}]*display\s*:\s*grid/);
    expect(html).toMatch(/id="searchResults"[^>]*\shidden/);
    // guides-search.js oculta la rejilla al buscar: depende de esa regla.
    expect(read('js/guides-search.js')).toMatch(/guidesGrid\.hidden\s*=\s*true/);
  });

  it('la regla va DESPUES de .guides-grid o lleva !important (la especificidad no basta)', () => {
    const css = inlineCss(html);
    expect(css).toMatch(HIDDEN_RULE);
    // `!important` es lo que garantiza el orden; no se acepta una version sin el.
    expect(/\[hidden\]\s*\{[^}]*display\s*:\s*none(?!\s*!important)/.test(css)).toBe(false);
  });
});
