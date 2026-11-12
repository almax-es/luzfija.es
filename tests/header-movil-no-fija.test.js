import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Guias, `como-funciona-luzfija.html` y `comparar-pvpc-tarifa-fija.html` tienen una cabecera
 * sticky con migas y botones. En movil se parte en varias lineas y, fija, ocupaba 142-253 px
 * de una pantalla de 640 (22-40 %) durante toda la lectura (medido el 12/11/2026). En pantallas
 * estrechas o bajas (movil apaisado) pasa a `position:static`. Toda pagina con esa cabecera
 * debe llevar la regla justo detras; la mascara SEO de `scripts/seo-date-logic.mjs` depende de
 * que la linea sea exactamente esta.
 */

const ROOT = path.resolve(__dirname, '..');
const RULE = '@media (max-width:640px),(max-height:500px){.header{position:static}}';

function htmlFiles() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html')) out.push(f);
  for (const f of fs.readdirSync(path.join(ROOT, 'guias'))) if (f.endsWith('.html')) out.push(path.join('guias', f));
  return out;
}

describe('La cabecera sticky de guias y paginas editoriales no es fija en movil', () => {
  const conSticky = htmlFiles().filter((f) => /^\.header\{position:sticky/m.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

  it('hay paginas con esa cabecera (el test no esta vacio)', () => {
    expect(conSticky.length).toBeGreaterThanOrEqual(20);
  });

  it.each(conSticky)('%s lleva la regla justo detras de .header', (f) => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    const m = html.match(/^\.header\{position:sticky[^\n]*\n([^\n]*)/m);
    expect(m[1]).toBe(RULE);
    // Ninguna regla posterior vuelve a fijarla.
    const despues = html.slice(html.indexOf(RULE) + RULE.length, html.indexOf('</style>', html.indexOf(RULE)));
    expect(despues).not.toMatch(/\.header\{[^}]*position:\s*(sticky|fixed)/);
  });
});
