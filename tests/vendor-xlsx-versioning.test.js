/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * SheetJS se cargaba con URL estable, sin el ?v= del build, mientras PDF.js y
 * jsQR si lo arrastraban. Con URL estable, el dia que se actualice el vendor un
 * cliente puede seguir ejecutando la copia anterior (HTTP cache) y el SW no
 * puede distinguir a que build pertenece lo que sirve.
 *
 * Este test comprueba el COMPORTAMIENTO: ejecuta cada modulo y mira el <script>
 * que realmente inyecta en el head. Un grep del literal no valdria: pasaria
 * igual si alguien deja el helper definido pero vuelve a asignar script.src a
 * mano en la ruta de carga.
 */

const ROOT = path.resolve(__dirname, '..');
const BUILD_ID = '20260903-091036';

function readModule(rel) {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
}

// Sustituto de document que expone un currentScript controlado. El resto se
// delega al document real de jsdom para que head/createElement/baseURI sean los
// de verdad y podamos observar el script inyectado.
function documentWith(currentScriptSrc) {
  return new Proxy(document, {
    get(target, prop) {
      if (prop === 'currentScript') {
        return currentScriptSrc ? { src: currentScriptSrc } : null;
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function runModule(rel, { currentScriptSrc = '' } = {}) {
  const fn = new Function('window', 'document', 'lfDbg', readModule(rel));
  fn(window, documentWith(currentScriptSrc), () => {});
}

function loadCsvUtils() {
  const fn = new Function('window', readModule('js/lf-csv-utils.js'));
  fn(window);
}

// El <script> del vendor que el modulo acaba de inyectar en el head.
function injectedXlsxSrc() {
  const scripts = Array.from(document.head.querySelectorAll('script[src]'));
  const match = scripts.reverse().find((s) => s.src.includes('xlsx.full.min.js'));
  return match ? match.src : null;
}

function resetDom() {
  document.head.querySelectorAll('script[src]').forEach((s) => s.remove());
  delete window.__LF_BUILD_ID;
  delete window.__LF_pvpcStatsCsvLoaded;
  delete window.__LF_PvpcStatsCsv;
  delete window.BVSim;
  window.LF = { toast: () => {}, formatMoney: () => {}, round2: (n) => Math.round(n * 100) / 100 };
  window.lfDbg = () => {};
  loadCsvUtils();
}

describe('Versionado del vendor SheetJS', () => {
  beforeEach(() => {
    resetDom();
  });

  it('lf-csv-import.js carga xlsx con el ?v= del build', async () => {
    window.__LF_BUILD_ID = BUILD_ID;
    runModule('js/lf-csv-import.js');

    // No se espera la promesa: jsdom no descarga scripts externos, asi que nunca
    // resuelve. El cuerpo hasta el appendChild es sincrono, que es lo observado.
    window.LF.ensureXLSX().catch(() => {});

    const src = injectedXlsxSrc();
    expect(src).toBeTruthy();
    expect(new URL(src).pathname).toBe('/vendor/xlsx/xlsx.full.min.js');
    expect(new URL(src).searchParams.get('v')).toBe(BUILD_ID);
  });

  it('pvpc-stats-csv.js carga xlsx con el ?v= del build', async () => {
    window.__LF_BUILD_ID = BUILD_ID;
    runModule('js/pvpc-stats-csv.js');

    window.__LF_PvpcStatsCsv.ensureXLSX().catch(() => {});

    const src = injectedXlsxSrc();
    expect(src).toBeTruthy();
    expect(new URL(src, location.href).pathname).toBe('/vendor/xlsx/xlsx.full.min.js');
    expect(new URL(src, location.href).searchParams.get('v')).toBe(BUILD_ID);
  });

  it('bv-import.js carga xlsx con el ?v= del build', async () => {
    window.__LF_BUILD_ID = BUILD_ID;
    runModule('js/bv/bv-import.js');

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'consumos.xlsx');
    window.BVSim.importFile(file).catch(() => {});
    // importFile lee el fichero con FileReader antes de pedir el vendor.
    await new Promise((resolve) => setTimeout(resolve, 30));

    const src = injectedXlsxSrc();
    expect(src).toBeTruthy();
    expect(new URL(src).pathname).toBe('/vendor/xlsx/xlsx.full.min.js');
    expect(new URL(src).searchParams.get('v')).toBe(BUILD_ID);
  });

  it('cae al ?v= del propio script cuando tracking.js aun no ha publicado el build', async () => {
    // Sin window.__LF_BUILD_ID: la segunda rama de la cascada lee el ?v= del
    // <script> que esta evaluando el modulo. Se resuelve en la carga, no dentro
    // de ensureXLSX(), donde document.currentScript ya seria null.
    runModule('js/lf-csv-import.js', {
      currentScriptSrc: 'https://luzfija.es/js/lf-csv-import.js?v=' + BUILD_ID
    });

    window.LF.ensureXLSX().catch(() => {});

    expect(new URL(injectedXlsxSrc()).searchParams.get('v')).toBe(BUILD_ID);
  });

  it('sin build identificable carga el vendor sin query en vez de romper', async () => {
    runModule('js/lf-csv-import.js');

    window.LF.ensureXLSX().catch(() => {});

    const src = injectedXlsxSrc();
    expect(src).toBeTruthy();
    expect(new URL(src).search).toBe('');
  });
});
