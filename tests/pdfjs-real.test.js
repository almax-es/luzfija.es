/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/**
 * El resto de la suite MOCKEA PDF.js: eso valida la logica de `js/factura.js`
 * pero no demuestra nada sobre el binario vendorizado. Sin este fichero, se
 * podria actualizar `vendor/pdfjs/*` a una build rota y la suite seguiria en
 * verde, porque nadie llega a ejecutar la libreria real.
 *
 * Aqui se carga el `pdf.min.mjs` REAL del repo y se ejercita el mismo camino que
 * usa `js/factura.js`: getDocument -> getPage -> getViewport -> getTextContent
 * -> cleanup -> loadingTask.destroy().
 *
 * LIMITE CONOCIDO: se usa la build de navegador (la que se sirve), no la build
 * `legacy`, asi que en Node faltan dos APIs que cualquier navegador moderno si
 * tiene. Se instalan los shims MINIMOS necesarios y se documentan abajo. No se
 * cubre el renderizado a canvas: exigiria la dependencia nativa `canvas`, y se
 * ha preferido no anadirla. El render real se verifica manualmente en navegador.
 */

const repoRoot = path.resolve(__dirname, '..');
const CORE = path.join(repoRoot, 'vendor', 'pdfjs', 'pdf.min.mjs');
const WORKER = path.join(repoRoot, 'vendor', 'pdfjs', 'pdf.worker.min.mjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'factura-sintetica.pdf');

// Version que debe tener el par core+worker. PDF.js exige que ambos coincidan
// EXACTAMENTE; una mezcla de versiones falla en runtime de forma confusa.
const EXPECTED_VERSION = '6.2.108';

/**
 * Shims de APIs que los navegadores modernos SI tienen y le faltan a Node.
 * Deliberadamente minimos: si esta lista crece, conviene replantear el enfoque
 * en vez de seguir apilando parches.
 *
 * Son TRES, y la referencia es **Node 22, el que usa el CI** (`.github/workflows/
 * tests.yml`), no el Node local del desarrollador:
 * - `DOMMatrix`: existe en navegadores; PDF.js lo referencia al evaluar el modulo.
 * - `Uint8Array.prototype.toHex` / `.toBase64` y sus estaticos: propuesta reciente,
 *   ya en Chrome/Edge/Safari/Firefox actuales, todavia no en Node 24.
 * - `Promise.try`: lo usan tanto el core como el worker de PDF.js 6.2.108. Llego
 *   en **Node 23**, asi que existe en local con Node 24 pero NO en el CI con
 *   Node 22. Sin este shim la suite pasa en local y falla en remoto por timeout
 *   con `TypeError: Promise.try is not a function`, que fue exactamente lo que
 *   tumbo el despliegue del 03/08/2026.
 *
 * Al actualizar PDF.js o subir de version alguna API, comprobar la suite con la
 * MISMA version de Node que el CI antes de dar el cambio por bueno.
 */
function installBrowserShims() {
  const g = globalThis;
  if (typeof Promise.try !== 'function') {
    Promise.try = function (fn, ...args) {
      // `new Promise(resolve => resolve(...))` propaga como rechazo lo que `fn`
      // lance de forma sincrona, que es la semantica de la propuesta.
      return new Promise((resolve) => resolve(fn(...args)));
    };
  }
  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = class DOMMatrix {
      constructor(init) {
        const m = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
        [this.a, this.b, this.c, this.d, this.e, this.f] = m;
      }
    };
  }
  const U = Uint8Array;
  if (typeof U.prototype.toHex !== 'function') {
    U.prototype.toHex = function () { return Buffer.from(this).toString('hex'); };
  }
  if (typeof U.fromHex !== 'function') {
    U.fromHex = (s) => new U(Buffer.from(String(s), 'hex'));
  }
  if (typeof U.prototype.toBase64 !== 'function') {
    U.prototype.toBase64 = function () { return Buffer.from(this).toString('base64'); };
  }
  if (typeof U.fromBase64 !== 'function') {
    U.fromBase64 = (s) => new U(Buffer.from(String(s), 'base64'));
  }
}

let pdfjsLib;

beforeAll(async () => {
  installBrowserShims();
  pdfjsLib = await import(pathToFileURL(CORE).href);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(WORKER).href;
});

// Se lee el marcador explicito que emite la build (`pdfjsVersion = 6.2.108`, sin
// comillas en el minificado) y no "el primer numero con pinta de version": hoy
// solo hay uno por fichero, pero cualquier cadena futura con ese formato -una
// dependencia embebida, un identificador- haria que el test validase otra cosa
// creyendo que valida la version.
function readVersionFrom(file) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/pdfjsVersion\s*=\s*["']?(\d+\.\d+\.\d+)["']?/);
  return match ? match[1] : null;
}

describe('PDF.js vendorizado: version del par core+worker', () => {
  it('el core declara la versión esperada', () => {
    expect(pdfjsLib.version).toBe(EXPECTED_VERSION);
  });

  it('el fichero del core contiene la versión esperada', () => {
    expect(readVersionFrom(CORE)).toBe(EXPECTED_VERSION);
  });

  // PDF.js aborta si core y worker no son exactamente la misma version. Este
  // test existe porque el fallo real seria en produccion y con un mensaje poco
  // evidente, y porque es facil actualizar un fichero y olvidar el otro.
  it('el worker declara exactamente la misma versión que el core', () => {
    expect(readVersionFrom(WORKER)).toBe(EXPECTED_VERSION);
  });
});

describe('PDF.js vendorizado: carga y extracción reales', () => {
  it('la fixture sintética existe y es un PDF', () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
    expect(fs.readFileSync(FIXTURE).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('abre el documento, extrae el texto y libera recursos por el mismo camino que factura.js', async () => {
    const data = new Uint8Array(fs.readFileSync(FIXTURE));
    const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
    const pdf = await loadingTask.promise;

    expect(pdf.numPages).toBe(1);

    const page = await pdf.getPage(1);

    // getViewport es parte del camino de renderizado y no necesita canvas:
    // valida que la geometria de pagina se resuelve (A4 en puntos).
    const viewport = page.getViewport({ scale: 1 });
    expect(Math.round(viewport.width)).toBe(595);
    expect(Math.round(viewport.height)).toBe(842);

    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => item.str).join(' ');

    expect(text).toContain('FACTURA DE PRUEBA - DOCUMENTO SINTETICO');
    expect(text).toContain('Periodo de facturacion: 01/01/2026 - 31/01/2026');
    expect(text).toContain('CUPS: ES0000000000000000XX');
    expect(text).toContain('Potencia contratada P1: 4,600 kW');
    expect(text).toContain('Consumo total: 250 kWh');
    expect(text).toContain('Importe total: 62,50 EUR');

    // Secuencia de liberacion EXACTA de js/factura.js: cleanup por pagina dentro
    // del bucle, luego cleanup del documento y por ultimo destroy del loadingTask
    // (ver el bloque `finally` de __LF_extractPdfText).
    await page.cleanup();

    expect(typeof pdf.cleanup).toBe('function');
    await pdf.cleanup();

    // 6.x elimino PDFDocumentProxy.destroy(): la liberacion va por loadingTask.
    // `js/factura.js` ya migro a este patron; si una futura version lo cambiara,
    // este test lo detecta antes de que rompa la extraccion en produccion.
    expect(typeof loadingTask.destroy).toBe('function');
    await expect(loadingTask.destroy()).resolves.toBeUndefined();
  }, 30000);

  it('expone la superficie de API que usa factura.js', async () => {
    expect(typeof pdfjsLib.getDocument).toBe('function');
    expect(pdfjsLib.GlobalWorkerOptions).toBeTruthy();

    const data = new Uint8Array(fs.readFileSync(FIXTURE));
    const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    for (const method of ['getViewport', 'getTextContent', 'render', 'cleanup']) {
      expect(typeof page[method], `page.${method} deberia existir`).toBe('function');
    }
    expect(typeof pdf.cleanup, 'pdf.cleanup deberia existir').toBe('function');

    await page.cleanup();
    await pdf.cleanup();
    await loadingTask.destroy();
  }, 30000);
});
