import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Regresiones de la auditoria visual del 12/11/2026 (Chrome y WebKit, 320-1920 px, claro y
 * oscuro). Cada caso se midio en el navegador antes y despues del arreglo; aqui se fija la
 * pieza de CSS/HTML de la que depende.
 */

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('Modal PVPC: la lista de horas cabe en pantallas estrechas', () => {
  it('la rejilla de dos columnas pasa a una cuando no caben (auto-fit, no 1fr 1fr fijo)', () => {
    // Con `1fr 1fr` la columna 12:00-23:00 se salia 38 px del modal a 360 px y quedaba cortada.
    const js = read('js/index-extra.js');
    expect(js).toMatch(/class="pvpc-horas-grid" style="display: grid; grid-template-columns: repeat\(auto-fit, minmax\(160px, 1fr\)\)/);
    expect(js).not.toMatch(/grid-template-columns: 1fr 1fr; gap: 16px;">\s*<div>\$\{col1\}/);
  });
});

describe('Modal de consumos CSV', () => {
  const js = read('js/lf-csv-import.js');
  it('el titulo reserva el hueco de la X y se alinea con ella', () => {
    // Sin esto la X (absoluta, 14 px + 40 px) pisaba el recuadro de avisos.
    expect(js).toMatch(/<h3 id="lfCsvPreviewTitle" style="margin: 14px 0 16px 0; padding-right: 52px; min-height: 40px;/);
  });
  it('la etiqueta "Hora a hora" puede bajar de linea en vez de cortarse', () => {
    expect(js).toMatch(/<label style="display: flex; flex-wrap: wrap;[^"]*">\s*<input type="checkbox" id="csvPvpcPeriodo"/);
    expect(js).toMatch(/white-space: nowrap;">Hora a hora<\/span>/);
  });
});

describe('Aviso de importacion fallida (lf-csv-report)', () => {
  const css = sinComentarios(read('styles.css'));
  it('ocupa el ancho de su contenedor y no el de su contenido mas ancho', () => {
    // En solar (hijo de un flex en columna) medía 248 px dentro de 238 a 320 px y se recortaba.
    const regla = css.match(/\.lf-csv-report\{([^}]*)\}/);
    expect(regla).toBeTruthy();
    expect(regla[1]).toMatch(/width:100%/);
    expect(regla[1]).toMatch(/min-width:0/);
  });
  it('los botones pueden partir su texto en movil', () => {
    expect(css).toMatch(/\.lf-csv-report__actions \.btn\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/);
  });
});

describe('Boton "Comparar Tarifas y Ver Ahorro" del simulador solar en tema claro', () => {
  it('texto blanco sobre el violeta (antes azul marino de `.btn`, 2,5:1)', () => {
    const css = sinComentarios(read('bv-sim.css'));
    const regla = css.match(/html\.light-mode #bv-simulate\s*\{([^}]*)\}/);
    expect(regla).toBeTruthy();
    expect(regla[1]).toMatch(/color:\s*#FFFFFF/i);
  });
});
