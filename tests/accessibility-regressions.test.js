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

  it('las opciones de compartir pueden envolver su explicación en móvil', () => {
    const css = read('styles.css');
    const bvCss = read('bv-sim.css');

    expect(css).toMatch(/\.share-config-option\s*\{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/);
    expect(css).toMatch(/\.share-config-option\s*>\s*span\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1;/);
    expect(css).toMatch(/\.share-config-option small\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(bvCss).toMatch(/\.bv-share-option\s*\{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/);
    expect(bvCss).toMatch(/\.bv-share-option\s*>\s*span\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1;/);
    expect(bvCss).toMatch(/\.bv-share-option small\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
  });

  it('los modales quedan por encima de controles flotantes', () => {
    const proCss = read('pro.css');

    expect(proCss).toMatch(/\.modal-overlay, \.desglose-overlay\s*\{\s*z-index:\s*10010;/);
    expect(proCss).toMatch(/\.modal-content, \.desglose-modal\s*\{\s*z-index:\s*10011;/);
  });

  it('las acciones de compartir conservan botones completos en móvil', () => {
    const css = read('styles.css');
    const bvCss = read('bv-sim.css');

    expect(css).toMatch(/\.share-config-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"cancel share";/);
    expect(css).toMatch(/\.share-config-actions \.btn\s*\{[^}]*width:\s*100%;[^}]*white-space:\s*nowrap;/);
    expect(css).toMatch(/@media \(max-width: 520px\)\s*\{\s*\.share-config-actions\s*\{[^}]*grid-template-areas:\s*"share" "cancel";/);
    expect(bvCss).toMatch(/\.bv-share-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"cancel share";/);
    expect(bvCss).toMatch(/\.bv-share-actions \.btn\s*\{[^}]*width:\s*100%;[^}]*white-space:\s*nowrap;/);
    expect(bvCss).toMatch(/@media \(max-width: 520px\)\s*\{[\s\S]*?\.bv-share-actions\s*\{[^}]*grid-template-areas:\s*"share" "cancel";/);
  });

  it('el diálogo de compartir de la home usa la misma jerarquía textual que el solar', () => {
    const css = read('styles.css');

    expect(css).toMatch(/\.share-config-modal \.modal-content\s*\{[^}]*padding:\s*24px;[^}]*border-radius:\s*24px;[^}]*background:\s*linear-gradient\(145deg, #0f172a, #1e293b\);/);
    expect(css).toMatch(/\.share-config-modal \.modal-content \.head h2\s*\{[^}]*margin:\s*0 0 10px;[^}]*color:\s*var\(--accent\);[^}]*font-size:\s*1\.3rem;/);
    expect(css).toMatch(/#shareConfigDescription\s*\{\s*margin:\s*0 0 16px;\s*line-height:\s*1\.5;/);
    expect(css).toMatch(/html\.light-mode \.share-config-modal \.modal-content\s*\{[^}]*background:\s*linear-gradient\(145deg, #ffffff, #f8fafc\);/);
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

  it('Compartir devuelve el foco al disparador visible en Home y Solar', () => {
    const home = read('js/lf-app.js');
    const solar = read('js/bv/bv-ui.js');

    expect(home).toContain('function openShareDialog(returnFocusEl = document.activeElement)');
    expect(home).toContain('shareLastFocusedEl = returnFocusEl;');
    expect(home).toMatch(/currentEl\.btnShare\.addEventListener\('click',[\s\S]*?toggleMenu\(false\);\s*openShareDialog\(currentEl\.btnMenu\);/);
    expect(home).toMatch(/shareResultsButton\?\.addEventListener\('click',[\s\S]*?openShareDialog\(shareResultsButton\);/);

    expect(solar).toContain('function openShareDialog(returnFocusEl = document.activeElement)');
    expect(solar).toContain('shareLastFocusedEl = returnFocusEl;');
    expect(solar).toMatch(/shareConfigButton\?\.addEventListener\('click',[\s\S]*?openShareDialog\(btnMenu\);/);
    expect(solar).toContain("shareResultsButton?.addEventListener('click', () => openShareDialog(shareResultsButton));");
  });

  it('el selector diaria/mensual es un grupo de botones con aria-pressed, no tabs sin panel', () => {
    const html = read('estadisticas/index.html');
    const ui = read('js/pvpc-stats-ui.js');

    expect(html).toMatch(/class="segmented" role="group" aria-label="Modo del gráfico"/);
    expect(html).toMatch(/id="trendModeMonthly"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/id="trendModeDaily"[^>]*aria-pressed="true"/);
    expect(html).not.toMatch(/trendMode(?:Monthly|Daily)[^>]*role="tab"/);
    expect(ui).toContain("elOn.setAttribute('aria-pressed', 'true')");
    expect(ui).toContain("elOff.setAttribute('aria-pressed', 'false')");
    expect(ui).not.toContain("setAttribute('aria-selected'");
  });

  it('el Observatorio expone carga/resultado/error y estado CSV mediante regiones status', () => {
    const html = read('estadisticas/index.html');
    const ui = read('js/pvpc-stats-ui.js');

    expect(html).toMatch(/id="trendMeta" role="status" aria-atomic="true"/);
    expect(html).toMatch(/id="csvExcedentesNote" role="status" aria-atomic="true"/);
    expect(ui).toContain("setCsvNote('Procesando archivo…')");
    expect(ui).toContain("'Archivo procesado correctamente.'");
    expect(ui).toMatch(/setCsvNote\(`Error: \$\{err\?\.message \|\| 'No se pudo procesar el archivo\.'\}`\)/);
    expect(ui).toContain('renderCsvStats(null, { announceEmpty: false })');
  });

  it('todo texto editorial morado usa una variante de contraste por tema', () => {
    const guideFiles = fs.readdirSync(path.join(ROOT, 'guias'))
      .filter((file) => file.endsWith('.html') && file !== 'index.html');

    // #2C2856 aproxima el peor fondo implicado: accent al 20 % sobre la superficie oscura.
    expect(contrastRatio('#A78BFA', '#2C2856')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#6D28D9', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    guideFiles.forEach((file) => {
      const html = read(path.join('guias', file));
      expect(html, file).toContain('--accent:#8B5CF6;--accent-text:#A78BFA;');
      expect(html, file).toContain('--accent:#6D28D9;--accent-text:#6D28D9; /* mejor contraste en modo claro */');
      expect(html, file).toContain('color:var(--accent-text)');
      expect(html, file).not.toMatch(/(?:^|[;{])color:\s*var\(--accent\)/m);
      expect(html, file).toMatch(/border-color\s*:\s*var\(--accent\)/);
      expect(html, file).not.toMatch(/border(?:-(?:left|bottom))?-color\s*:\s*var\(--accent-text\)/);
      expect(html, file).not.toContain('html:not(.light-mode) .article-content a{color:#A78BFA}');
    });
  });

  it('el placeholder del buscador usa el color muted adaptado al tema', () => {
    const guideIndex = read('guias.html');
    expect(guideIndex).toMatch(/\.search-box input::placeholder\s*\{\s*color:\s*var\(--muted\);\s*\}/);
    expect(guideIndex).not.toContain('color: rgba(247,247,251,.4);');
  });

  it('las tarjetas de guías tienen un foco explícito, también con colores forzados', () => {
    const guideIndex = read('guias.html');
    expect(guideIndex).toMatch(/\.guide-card:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--accent\)[\s\S]*?outline-offset:\s*3px/);
    expect(guideIndex).toMatch(/@media \(forced-colors: active\)\s*\{[\s\S]*?\.guide-card:focus-visible\s*\{[\s\S]*?outline-color:\s*Highlight/);
  });

  it('el selector del Observatorio conserva un estado visual con colores forzados', () => {
    const statsCss = read('estadisticas/estadisticas.css');
    expect(statsCss).toMatch(/@media \(forced-colors: active\)\s*\{[\s\S]*?\.segmented__btn\s*\{[\s\S]*?border:\s*1px solid ButtonText/);
    expect(statsCss).toMatch(/\.segmented__btn(?:\.is-active|\[aria-pressed="true"\])[\s\S]*?background:\s*Highlight[\s\S]*?color:\s*HighlightText/);
  });

});
