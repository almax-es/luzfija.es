/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
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
 * usa `js/factura.js`: getDocument -> getPage -> getViewport -> streamTextContent
 * -> cleanup -> loadingTask.destroy().
 *
 * Se sirve la build `legacy`: PDF.js reserva la build moderna para los ultimos
 * navegadores y su matriz upstream actual solo incluye Safari bajo la legacy.
 * LuzFija cubre ademas WebKit anterior con shims y el reader explicitos; eso no
 * equivale a ampliar formalmente la matriz de soporte de PDF.js.
 * No se cubre el renderizado a canvas: exigiria la dependencia nativa `canvas`,
 * y se ha preferido no anadirla. El render real se verifica en navegador.
 */

const repoRoot = path.resolve(__dirname, '..');
const CORE = path.join(repoRoot, 'vendor', 'pdfjs', 'pdf.min.mjs');
const WORKER = path.join(repoRoot, 'vendor', 'pdfjs', 'pdf.worker.min.mjs');
const WORKER_BOOTSTRAP = path.join(repoRoot, 'js', 'pdfjs-worker-bootstrap.mjs');
const FACTURA = path.join(repoRoot, 'js', 'factura.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'factura-sintetica.pdf');

// Version que debe tener el par core+worker. PDF.js exige que ambos coincidan
// EXACTAMENTE; una mezcla de versiones falla en runtime de forma confusa.
const EXPECTED_VERSION = '6.3.289';

function readFunctionSource(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`No se encontro ${name} en ${file}`);
  const parametersEnd = source.indexOf(')', start);
  const brace = source.indexOf('{', parametersEnd);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`No se encontro el cierre de ${name} en ${file}`);
}

const PROMISE_WITH_RESOLVERS_SHIM = readFunctionSource(
  FACTURA,
  '__LF_installPromiseWithResolversShim'
);

/**
 * DOMMatrix existe en navegadores, pero no en Node sin la dependencia nativa
 * opcional de canvas. Es el unico shim que necesita esta prueba de extraccion.
 * Las APIs recientes de JavaScript deben resolverlas los artefactos legacy que
 * se sirven, no el test: abajo hay una regresion aislada que las elimina antes
 * de importar tanto core como worker.
 */
function installBrowserShims() {
  const g = globalThis;
  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = class DOMMatrix {
      constructor(init) {
        const m = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
        [this.a, this.b, this.c, this.d, this.e, this.f] = m;
      }
    };
  }
}

let pdfjsLib;

beforeAll(async () => {
  installBrowserShims();
  pdfjsLib = await import(pathToFileURL(CORE).href);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(WORKER).href;
});

// Se lee el marcador explicito que emite la build (`pdfjsVersion = 6.3.289`, sin
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

describe('PDF.js vendorizado: compatibilidad WebKit no reciente', () => {
  it('core y worker cargan sin APIs nuevas que faltan en iOS 17', () => {
    const probe = String.raw`
      ${PROMISE_WITH_RESOLVERS_SHIM}
      const { readFileSync } = await import('node:fs');

      function removeRecentApis() {
        for (const [owner, key] of [
          [Promise, 'try'],
          [Promise, 'withResolvers'],
          [URL, 'parse'],
          [Map.prototype, 'getOrInsertComputed'],
          [Uint8Array.prototype, 'toHex'],
          [Uint8Array.prototype, 'toBase64'],
          [Uint8Array, 'fromHex'],
          [Uint8Array, 'fromBase64']
        ]) {
          try { delete owner[key]; } catch {}
        }
      }

      globalThis.DOMMatrix = class DOMMatrix {
        constructor(init) {
          const matrix = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
          [this.a, this.b, this.c, this.d, this.e, this.f] = matrix;
        }
      };

      removeRecentApis();
      __LF_installPromiseWithResolversShim();
      const core = await import(process.argv[1]);
      const afterCore = {
        promiseTry: typeof Promise.try,
        promiseWithResolvers: typeof Promise.withResolvers,
        urlParse: typeof URL.parse,
        mapInsert: typeof Map.prototype.getOrInsertComputed,
        toHex: typeof Uint8Array.prototype.toHex
      };

      core.GlobalWorkerOptions.workerSrc = process.argv[3];
      const loadingTask = core.getDocument({
        data: new Uint8Array(readFileSync(process.argv[4])),
        verbosity: 0
      });
      const pdf = await loadingTask.promise;
      const openedPages = pdf.numPages;
      await loadingTask.destroy();

      // El worker vive en otro realm en navegador. Borrar de nuevo evita que
      // esta prueba le regale los polyfills instalados por el core.
      removeRecentApis();
      const worker = await import(process.argv[2]);
      const afterWorker = {
        promiseTry: typeof Promise.try,
        promiseWithResolvers: typeof Promise.withResolvers,
        urlParse: typeof URL.parse,
        mapInsert: typeof Map.prototype.getOrInsertComputed,
        toHex: typeof Uint8Array.prototype.toHex
      };

      process.stdout.write(JSON.stringify({
        version: core.version,
        workerHandler: typeof worker.WorkerMessageHandler,
        openedPages,
        afterCore,
        afterWorker
      }));
    `;

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        probe,
        pathToFileURL(CORE).href,
        `${pathToFileURL(WORKER_BOOTSTRAP).href}?lf-isolated-worker-probe=1`,
        pathToFileURL(WORKER).href,
        FIXTURE
      ],
      { encoding: 'utf8', timeout: 30000 }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: EXPECTED_VERSION,
      workerHandler: 'function',
      openedPages: 1,
      afterCore: {
        promiseTry: 'function',
        promiseWithResolvers: 'function',
        urlParse: 'function',
        mapInsert: 'function',
        toHex: 'function'
      },
      afterWorker: {
        promiseTry: 'function',
        promiseWithResolvers: 'function',
        urlParse: 'function',
        mapInsert: 'function',
        toHex: 'function'
      }
    });
  }, 30000);
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

    const reader = page.streamTextContent().getReader();
    const textItems = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        textItems.push(...(value.items || []));
      }
    } finally {
      reader.releaseLock();
    }
    const text = textItems.map((item) => item.str).join(' ');

    expect(text).toContain('FACTURA DE PRUEBA - DOCUMENTO SINTETICO');
    expect(text).toContain('Periodo de facturacion: 01/01/2026 - 31/01/2026');
    expect(text).toContain('CUPS: ES0000000000000000XX');
    expect(text).toContain('Potencia contratada P1: 4,600 kW');
    expect(text).toContain('Consumo total: 250 kWh');
    expect(text).toContain('Importe total: 62,50 EUR');

    // Secuencia de liberacion EXACTA de js/factura.js: cleanup por pagina dentro
    // del bucle, luego cleanup del documento y por ultimo destroy del loadingTask
    // (ver el bloque `finally` de __LF_extraerTextoPDF).
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

    for (const method of ['getViewport', 'streamTextContent', 'render', 'cleanup']) {
      expect(typeof page[method], `page.${method} deberia existir`).toBe('function');
    }
    expect(typeof pdf.cleanup, 'pdf.cleanup deberia existir').toBe('function');

    await page.cleanup();
    await pdf.cleanup();
    await loadingTask.destroy();
  }, 30000);
});
