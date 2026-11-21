import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// CLS de CARGA del simulador solar y del observatorio en ventanas altas de escritorio (20/11/2026):
//   - Solar 0,065 a 1280x1440: la cabecera encogia ~35 px al llegar Outfit 900 (el titulo cambiaba de lineas)
//     y la tabla mensual, construida por JS tras el primer pintado, crecia ~850 px (se reserva su altura).
//   - Observatorio 0,08 en la mitad de las cargas a 1280x1440: al llegar los datos se ocultaba la seccion de CSV
//     (~250 px) y los KPI crecian 34-52 px porque valor y subtitulo pasaban a dos lineas.

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const themeCode = read('js/theme.js');
const root = document.documentElement;

function ejecutarTheme(url) {
  history.replaceState(null, '', url);
  new Function(themeCode)();
}

afterEach(() => {
  root.classList.remove('lf-pre-excedentes');
  history.replaceState(null, '', '/');
});

describe('simulador solar: fuente del titulo antes del primer pintado', () => {
  it('precarga Outfit 900 solo en escritorio (en movil no salta y costaria FCP)', () => {
    const html = read('comparador-tarifas-solares.html');
    const head = html.slice(0, html.indexOf('</head>'));
    const preload = head.match(/<link rel="preload" href="\/fonts\/outfit-latin-900-normal\.woff2"[^>]*>/);
    expect(preload).not.toBeNull();
    expect(preload[0]).toContain('as="font"');
    expect(preload[0]).toContain('crossorigin');
    expect(preload[0]).toContain('media="(min-width: 769px)"');
    // Antes de la primera hoja de estilos, como la de 400.
    expect(head.indexOf(preload[0])).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
  });
});

describe('simulador solar: altura de la tabla mensual reservada', () => {
  it('reserva las doce filas de tabla a partir de 520 px con la misma altura que sus campos', () => {
    const css = read('bv-sim.css').replace(/\s+/g, ' ');
    const start = css.indexOf('@media (width > 520px)');
    const end = css.indexOf('@media', start + 1);
    expect(start).toBeGreaterThan(-1);
    const layout = css.slice(start, end);
    expect(layout).toContain('#bv-manual-grid { display: grid; grid-template-rows: repeat(12, minmax(calc(var(--bv-manual-input-height) + 17px), auto));');
    expect(layout).toContain('min-height: var(--bv-manual-input-height);');
    expect(css).toMatch(/\.bv-manual-row \{[^}]*padding: 8px 4px; border-bottom: 1px/);
  });

  it('la tabla la sigue construyendo bv-ui.js (no viene en el HTML: costaba LCP en movil)', () => {
    const doc = new DOMParser().parseFromString(read('comparador-tarifas-solares.html'), 'text/html');
    expect(doc.querySelectorAll('#bv-manual-grid .bv-manual-row')).toHaveLength(0);
    expect(read('js/bv/bv-ui.js')).toContain('manualGrid.innerHTML = monthNames.map((m, i) => `');
  });
});

describe('observatorio: seccion de CSV de excedentes desde el primer fotograma', () => {
  it('el HTML la trae oculta (la vista por defecto es PVPC)', () => {
    const doc = new DOMParser().parseFromString(read('estadisticas/index.html'), 'text/html');
    expect(doc.getElementById('csv-excedentes').hasAttribute('hidden')).toBe(true);
  });

  it('theme.js marca <html> solo con ?type=surplus exacto en el observatorio', () => {
    for (const url of ['/estadisticas/?type=surplus', '/estadisticas/index.html?type=surplus&geo=8742']) {
      root.classList.remove('lf-pre-excedentes');
      ejecutarTheme(url);
      expect(root.classList.contains('lf-pre-excedentes')).toBe(true);
    }
    for (const url of ['/estadisticas/', '/estadisticas/?type=pvpc', '/estadisticas/?type=SURPLUS', '/?type=surplus',
      '/comparador-tarifas-solares.html?type=surplus']) {
      root.classList.remove('lf-pre-excedentes');
      ejecutarTheme(url);
      expect(root.classList.contains('lf-pre-excedentes')).toBe(false);
    }
  });

  it('la marca se retira en load aunque pvpc-stats-ui.js no llegue a ejecutarse', () => {
    ejecutarTheme('/estadisticas/?type=surplus');
    window.dispatchEvent(new Event('load'));
    expect(root.classList.contains('lf-pre-excedentes')).toBe(false);
  });

  it('el CSS la muestra con la marca por encima de [hidden]', () => {
    const css = read('estadisticas/estadisticas.css').replace(/\s+/g, ' ');
    expect(css).toContain('html.lf-pre-excedentes #csv-excedentes[hidden] { display: block !important; }');
  });

  it('pvpc-stats-ui.js la decide al arrancar y al empezar cada render, no al llegar los datos', () => {
    document.body.innerHTML = '<section id="csv-excedentes" class="obs-section" hidden></section>';
    window.LF = {};
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    new Function('window', read('js/pvpc-stats-ui.js'))(window);
    const { syncCsvSectionVisibility } = window.__LF_PvpcStatsUiHelpers;
    const seccion = document.getElementById('csv-excedentes');

    root.classList.add('lf-pre-excedentes');
    syncCsvSectionVisibility({ type: 'surplus' });
    expect(seccion.hidden).toBe(false);
    expect(root.classList.contains('lf-pre-excedentes')).toBe(false);
    syncCsvSectionVisibility({ type: 'pvpc' });
    expect(seccion.hidden).toBe(true);

    const src = read('js/pvpc-stats-ui.js');
    // Arranque: justo tras aplicar el estado a los controles (antes de cualquier carga).
    expect(src).toMatch(/applyStateToControls\(state\);\s*(\/\/[^\n]*\n\s*)*syncCsvSectionVisibility\(state\);/);
    // Render: antes del primer await.
    const render = src.slice(src.indexOf('const rerender = debounce(async'));
    expect(render.indexOf('syncCsvSectionVisibility(state)')).toBeGreaterThan(-1);
    expect(render.indexOf('syncCsvSectionVisibility(state)')).toBeLessThan(render.indexOf('await '));
  });
});

describe('observatorio: KPI de tamano independiente del texto que llega', () => {
  it('valor en una linea ajustado al ancho de la tarjeta y subtitulo con dos lineas reservadas', () => {
    const css = read('estadisticas/estadisticas.css').replace(/\s+/g, ' ');
    // Todo dentro de @supports: sin unidades de contenedor, nowrap recortaria el valor (.kpi tiene overflow hidden).
    expect(css).toContain('@supports (font-size: 1cqi) { .kpi { container-type: inline-size; } .kpi__value { white-space: nowrap; font-size: min(2.1rem, 14.5cqi); } }');
    expect(css).toContain('@media (min-width: 901px) { .kpi__sub { min-height: 2.8em; } }');
    expect(css).toContain('.kpi__value { font-size: 1.75rem; } @supports (font-size: 1cqi) { .kpi__value { font-size: min(1.75rem, 14.5cqi); } }');
    // Las cifras son tabulares: es lo que hace que "0,000 €/kWh" mida igual con cualquier precio.
    expect(css).toMatch(/\.kpi__value \{[^}]*font-variant-numeric: tabular-nums;/);
  });
});
