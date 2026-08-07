import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function relativeLuminance(hex) {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    .map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('regresiones de accesibilidad detectadas en la auditoría', () => {
  it('los fondos de CTA con texto blanco superan WCAG AA', () => {
    expect(contrastRatio('#FFFFFF', '#7C3AED')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF', '#6D28D9')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF', '#15803D')).toBeGreaterThanOrEqual(4.5);
  });

  it('todas las guías usan el morado accesible en el CTA compartido', () => {
    const guideFiles = fs.readdirSync(path.join(ROOT, 'guias'))
      .filter((file) => file.endsWith('.html') && file !== 'index.html');

    expect(guideFiles.length).toBeGreaterThan(0);
    guideFiles.forEach((file) => {
      const html = read(path.join('guias', file));
      expect(html, file).toMatch(/\.action-btn\{[^}]*background:#7C3AED;color:white/);
      expect(html, file).toMatch(/\.action-btn:hover\{background:#6D28D9;/);
      expect(html, file).not.toMatch(/\.action-btn\{[^}]*background:var\(--accent\);color:white/);
    });
  });

  it('los CTA editoriales aislados y el CTA verde conservan contraste accesible', () => {
    expect(read('404.html')).toMatch(/\.back-button\{[^}]*background:#7C3AED;color:white/);
    expect(read('como-funciona-luzfija.html')).toMatch(/\.btn-primary\{background:#7C3AED;color:white/);

    const guideIndex = read('guias.html');
    expect(guideIndex).toMatch(/\.category-btn\.active\s*\{[^}]*background:\s*#7C3AED;/);
    expect(guideIndex).toMatch(/\.cta-button\s*\{[^}]*background:\s*#7C3AED;/);

    const bonoSocial = read('guias/bono-social-electrico-quien-puede-pedirlo-y-como.html');
    expect(bonoSocial).toMatch(/href="https:\/\/civio\.es\/bono-social\/"[^>]*background:#15803D;/);
  });

  it('el selector mensual reserva ARIA al botón y usa una clase para el estado visual', () => {
    const ui = read('js/bv/bv-ui.js');
    const css = read('bv-sim.css');

    expect(ui).not.toMatch(/wrapperEl\.setAttribute\('aria-(?:disabled|expanded)'/);
    expect(ui).toContain("wrapperEl.classList.add('is-open')");
    expect(ui).toContain("wrapperEl.classList.remove('is-open')");
    expect(css).toContain('.bv-cs.is-open .bv-cs-chevron');
    expect(css).toContain('.bv-cs.is-open .bv-cs-list');
    expect(css).not.toContain('.bv-cs[aria-expanded="true"]');
  });

  it('las guías permiten que la columna editorial encoja en viewports estrechos', () => {
    const guideFiles = fs.readdirSync(path.join(ROOT, 'guias'))
      .filter((file) => file.endsWith('.html') && file !== 'index.html');

    guideFiles.forEach((file) => {
      const html = read(path.join('guias', file));
      expect(html, file).toContain(
        '@media (max-width:1200px){.container{grid-template-columns:minmax(0,1fr)}' +
        '.article{min-width:0}'
      );
    });
  });

  it('las tablas editoriales anchas se desplazan dentro de una región accesible', () => {
    const tableGuides = [
      'guias/diferencia-entre-comercializadora-y-distribuidora.html',
      'guias/tarifas-indexadas-pool-cuota-cuando-interesan-y-cuando-no.html'
    ];

    tableGuides.forEach((file) => {
      const html = read(file);
      expect(html, file).toContain('.table-scroll{');
      expect(html, file).toMatch(
        /<div class="table-scroll" role="region" aria-label="[^"]+" tabindex="0">\s*<table class="tabla-comparativa">/
      );
      expect(html, file).toMatch(/<\/table>\s*<\/div>/);
    });
  });

  it('la landing PVPC apila y envuelve su navegación en móvil', () => {
    const html = read('comparar-pvpc-tarifa-fija.html');

    expect(html).toContain(
      '.header-container{padding:0 16px;flex-direction:column;justify-content:center;gap:12px}'
    );
    expect(html).toContain(
      '.nav-buttons{width:100%;justify-content:center;flex-wrap:wrap;gap:8px}'
    );
  });
});
