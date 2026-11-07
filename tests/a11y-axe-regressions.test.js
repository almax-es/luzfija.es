// Regresiones de la pasada axe-core del 24/09/2026 (132 escaneos: 33 paginas x movil/escritorio x
// tema claro/oscuro, Chrome real). Salieron 5 reglas, todas corregidas hasta dejar el escaneo en
// cero. Estas comprobaciones estaticas evitan que vuelvan, por ejemplo al crear una guia copiando
// una antigua. No sustituyen al escaneo: si se anade una pagina o componente nuevo, repetirlo.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const guias = fs.readdirSync(path.join(root, 'guias'))
  .filter((f) => f.endsWith('.html') && f !== 'index.html')
  .map((f) => `guias/${f}`);
const htmlPublico = [
  ...fs.readdirSync(root).filter((f) => f.endsWith('.html')),
  'estadisticas/index.html',
  ...guias
];

describe('accesibilidad: regresiones de la pasada axe (24/09/2026)', () => {
  it('encuentra las 25 guías (el test no pasa en vacío)', () => {
    expect(guias.length).toBeGreaterThanOrEqual(25);
  });

  // landmark-unique: dos <nav> sin nombre se anuncian igual en un lector de pantalla.
  it.each(guias)('%s nombra sus dos <nav>', (guia) => {
    const html = read(guia);
    expect(html).toContain('<nav class="breadcrumbs" aria-label="Ruta de navegación">');
    expect(html).toContain('<nav class="guide-nav" aria-label="Navegación entre guías">');
    expect(html).not.toMatch(/<nav(?![^>]*aria-label)[^>]*>/);
  });

  // empty-table-header: una celda de cabecera vacía no dice nada al lector de pantalla.
  it('ninguna página tiene celdas de cabecera vacías', () => {
    const conVacias = htmlPublico.filter((f) => /<th(\s[^>]*)?>\s*<\/th>/.test(read(f)));
    expect(conVacias).toEqual([]);
  });

  // region: la cabecera (logo, H1, accesos) quedaba fuera de cualquier landmark.
  it.each(['index.html', 'comparador-tarifas-solares.html', 'estadisticas/index.html'])(
    '%s marca su cabecera como banner',
    (pagina) => {
      expect(read(pagina)).toContain('<div class="topbar" role="banner">');
    }
  );

  // heading-order: en el simulador los h2 del contenido estan ocultos al cargar y el pie saltaba
  // de h1 a h3. Los titulos de columna del pie son h2 (mismo aspecto: la clase fija el estilo).
  it.each(['index.html', 'comparador-tarifas-solares.html'])('%s usa h2 en los títulos del pie', (pagina) => {
    const html = read(pagina);
    expect(html).not.toContain('<h3 class="u-h3-strong-10">');
    expect(html.match(/<h2 class="u-h3-strong-10">/g) || []).toHaveLength(4);
  });

  // target-size (WCAG 2.2 AA 2.5.8): los enlaces sueltos del pie median 17 px de alto. La home ya
  // llevaba padding-block:4px (25 px); el simulador solar no lo tenia.
  it.each(['index.html', 'comparador-tarifas-solares.html'])(
    '%s da al menos 24 px de alto a los enlaces sueltos del pie',
    (pagina) => {
      const enlaces = [...read(pagina).matchAll(/<a href="\/(?:guias|como-funciona-luzfija)\.html" style="([^"]*)"/g)];
      expect(enlaces.length).toBeGreaterThan(0);
      for (const [, estilo] of enlaces) expect(estilo).toContain('padding-block:4px');
    }
  );
});
