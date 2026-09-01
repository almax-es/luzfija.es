import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(__dirname, '..');
const facturaCode = fs.readFileSync(path.join(repoRoot, 'js/factura.js'), 'utf8');
const bootstrapCode = fs.readFileSync(path.join(repoRoot, 'js/pdfjs-worker-bootstrap.mjs'), 'utf8');

function extractFunction(name) {
  const asyncStart = facturaCode.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : facturaCode.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontro ${name}`);
  const parametersEnd = facturaCode.indexOf(')', start);
  const brace = facturaCode.indexOf('{', parametersEnd);
  let depth = 0;
  for (let i = brace; i < facturaCode.length; i++) {
    if (facturaCode[i] === '{') depth++;
    if (facturaCode[i] === '}' && --depth === 0) return facturaCode.slice(start, i + 1);
  }
  throw new Error(`No se encontro el cierre de ${name}`);
}

const shimSource = extractFunction('__LF_installMapGetOrInsertComputedShim');
const promiseShimSource = extractFunction('__LF_installPromiseWithResolversShim');
const readPageTextContentSource = extractFunction('__LF_readPageTextContent');
const processingWatchdogSource = extractFunction('__LF_startProcessingWatchdog');
const workerRetrySource = extractFunction('__LF_preparePdfWorkerRetry');
const workerSrcSource = extractFunction('__LF_pdfWorkerSrc');

function probe(body) {
  return vm.runInNewContext(`${shimSource}\n${body}`, Object.create(null));
}

describe('compatibilidad de PDF.js', () => {
  it('instala Promise.withResolvers sin sustituir una implementacion existente', async () => {
    const result = await vm.runInNewContext(`(async () => {
      ${promiseShimSource}
      delete Promise.withResolvers;
      __LF_installPromiseWithResolversShim();
      const descriptor = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');
      const installed = descriptor.value;
      const capability = Promise.withResolvers();
      capability.resolve(42);
      const resolved = await capability.promise;
      __LF_installPromiseWithResolversShim();
      return {
        resolved,
        same: installed === Promise.withResolvers,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        configurable: descriptor.configurable,
        resolveType: typeof capability.resolve,
        rejectType: typeof capability.reject
      };
    })()`, Object.create(null));

    expect(result).toEqual({
      resolved: 42,
      same: true,
      enumerable: false,
      writable: true,
      configurable: true,
      resolveType: 'function',
      rejectType: 'function'
    });
  });

  it('consume el stream de texto con getReader sin depender del async iterator de Safari', async () => {
    const result = await vm.runInNewContext(`(async () => {
      ${readPageTextContentSource}
      let fallbackCalls = 0;
      let released = false;
      const chunks = [
        { lang: 'es', styles: { f1: { fontFamily: 'Arial' } }, items: [{ str: 'uno' }] },
        { lang: null, styles: { f2: { fontFamily: 'Serif' } }, items: [{ str: 'dos' }] }
      ];
      const page = {
        getTextContent() { fallbackCalls++; throw new Error('Safari no debe pasar por getTextContent'); },
        streamTextContent() {
          let index = 0;
          return {
            getReader() {
              return {
                async read() {
                  if (index >= chunks.length) return { done: true, value: undefined };
                  return { done: false, value: chunks[index++] };
                },
                releaseLock() { released = true; }
              };
            }
          };
        }
      };
      const text = await __LF_readPageTextContent(page);
      return {
        fallbackCalls,
        released,
        lang: text.lang,
        itemText: text.items.map(item => item.str).join(','),
        styleKeys: Object.keys(text.styles).sort().join(',')
      };
    })()`, Object.create(null));

    expect(result).toEqual({
      fallbackCalls: 0,
      released: true,
      lang: 'es',
      itemText: 'uno,dos',
      styleKeys: 'f1,f2'
    });
  });

  it('libera el reader aunque falle una lectura del stream', async () => {
    const result = await vm.runInNewContext(`(async () => {
      ${readPageTextContentSource}
      let released = false;
      const page = {
        streamTextContent() {
          return {
            getReader() {
              return {
                async read() { throw new Error('fallo sintetico'); },
                releaseLock() { released = true; }
              };
            }
          };
        }
      };
      let message = '';
      try { await __LF_readPageTextContent(page); } catch (error) { message = error.message; }
      return { released, message };
    })()`, Object.create(null));

    expect(result).toEqual({ released: true, message: 'fallo sintetico' });
  });

  it('instala Map#getOrInsertComputed sin sustituir una implementacion existente', () => {
    const result = probe(`(() => {
      delete Map.prototype.getOrInsertComputed;
      __LF_installMapGetOrInsertComputedShim();
      const descriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'getOrInsertComputed');
      const installed = descriptor.value;
      __LF_installMapGetOrInsertComputedShim();
      return {
        same: installed === Map.prototype.getOrInsertComputed,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        configurable: descriptor.configurable
      };
    })()`);
    expect(result).toEqual({ same: true, enumerable: false, writable: true, configurable: true });
  });

  it('respeta claves presentes, NaN, -0, excepciones y mutacion desde callback', () => {
    const result = probe(`(() => {
      delete Map.prototype.getOrInsertComputed;
      __LF_installMapGetOrInsertComputedShim();
      const present = new Map([['x', undefined]]); let presentCalls = 0;
      present.getOrInsertComputed('x', () => { presentCalls++; });
      const keys = new Map(); let minusZero = null; let calls = 0;
      keys.getOrInsertComputed(-0, key => { minusZero = Object.is(key, -0); calls++; return 'zero'; });
      keys.getOrInsertComputed(+0, () => { calls++; return 'otro'; });
      keys.getOrInsertComputed(NaN, () => { calls++; return 'nan'; });
      keys.getOrInsertComputed(Number('x'), () => { calls++; return 'otro'; });
      const mutated = new Map();
      const returned = mutated.getOrInsertComputed('k', () => { mutated.set('k', 'intermedio'); return 'final'; });
      const thrown = new Map(); let propagated = false;
      try { thrown.getOrInsertComputed('e', () => { throw new RangeError('boom'); }); } catch (error) { propagated = error instanceof RangeError; }
      return { presentCalls, minusZero, calls, size: keys.size, returned, stored: mutated.get('k'), propagated, insertedAfterThrow: thrown.has('e') };
    })()`);
    expect(result).toEqual({
      presentCalls: 0,
      minusZero: false,
      calls: 2,
      size: 2,
      returned: 'final',
      stored: 'final',
      propagated: true,
      insertedAfterThrow: false
    });
  });

  it('conserva el fallback fake-worker y la query de build en el bootstrap', () => {
    const installPromise = bootstrapCode.indexOf('installPromiseWithResolversShim();');
    const installMap = bootstrapCode.indexOf('installMapGetOrInsertComputedShim();');
    const vendorImport = bootstrapCode.indexOf('await import(vendorWorkerUrl.href)');
    const namedExport = bootstrapCode.indexOf('export const WorkerMessageHandler');
    expect(installPromise).toBeGreaterThan(0);
    expect(installMap).toBeGreaterThan(installPromise);
    expect(vendorImport).toBeGreaterThan(installMap);
    expect(namedExport).toBeGreaterThan(vendorImport);
    expect(bootstrapCode).toContain('vendorWorkerUrl.search = bootstrapUrl.search;');
    expect(bootstrapCode).toContain("vendorWorkerUrl.hash = '';");
  });

  it('reintenta el import del core con fragmentos sin propagarlo al worker', () => {
    expect(facturaCode).toMatch(/function __LF_ensurePdfRuntimeCompatibility\(\)\{\s*__LF_installPromiseWithResolversShim\(\);\s*__LF_installMapGetOrInsertComputedShim\(\);/);
    expect(facturaCode).toContain('const importUrl = new URL(baseSrc, document.baseURI);');
    expect(facturaCode).toContain('importUrl.hash = `lf-pdfjs-retry-${__LF_pdfjsImportFailures}`;');
    expect(facturaCode).toMatch(/catch \(error\) \{\s*__LF_pdfjsImportFailures\+\+;/);
    expect(facturaCode).toContain('__LF_versionedUrl("js/pdfjs-worker-bootstrap.mjs")');
  });

  it('prepara el reintento del worker sin mutar internals de PDF.js y conserva ?v=', () => {
    const result = vm.runInNewContext(`
      let __LF_pdfjsImportFailures = 0;
      let __LF_pdfWorkerRetryGeneration = 0;
      function __LF_versionedUrl(path) { return 'https://luzfija.es/' + path + '?v=20260831-132123'; }
      const originalPdfWorker = { sentinel: true };
      const lib = { PDFWorker: originalPdfWorker, GlobalWorkerOptions: { workerSrc: 'initial' } };
      const window = { pdfjsLib: lib };
      const document = { baseURI: 'https://luzfija.es/' };
      ${workerSrcSource}
      ${workerRetrySource}
      const changed = __LF_preparePdfWorkerRetry({ message: 'Setting up fake worker failed: synthetic failure' });
      const url = new URL(__LF_pdfWorkerSrc());
      ({
        changed,
        discardedNamespace: window.pdfjsLib === null,
        pdfImportFailures: __LF_pdfjsImportFailures,
        retryGeneration: __LF_pdfWorkerRetryGeneration,
        pdfWorkerUnchanged: lib.PDFWorker === originalPdfWorker && lib.PDFWorker.sentinel === true,
        search: url.search,
        hash: url.hash,
        pathname: url.pathname
      });
    `, { URL });

    expect(result).toEqual({
      changed: true,
      discardedNamespace: true,
      pdfImportFailures: 1,
      retryGeneration: 1,
      pdfWorkerUnchanged: true,
      search: '?v=20260831-132123',
      hash: '#lf-pdf-worker-retry-1',
      pathname: '/js/pdfjs-worker-bootstrap.mjs'
    });
  });
});

describe('cancelacion y aviso OCR', () => {
  it('el watchdog invalida y libera la UI solo si la operacion sigue activa', () => {
    const result = vm.runInNewContext(`(() => {
      let active = 7;
      let invalidations = 0;
      let callbacks = 0;
      const window = { __LF_FACTURA_BUSY: true };
      const __LF_isCurrentOperation = id => active === id;
      const __LF_invalidateOperation = () => { invalidations++; active = 0; };
      const setTimeout = callback => { callback(); return 123; };
      ${processingWatchdogSource}
      const timer = __LF_startProcessingWatchdog(7, () => { callbacks++; }, 1);
      return { timer, invalidations, callbacks, busy: window.__LF_FACTURA_BUSY };
    })()`, Object.create(null));

    expect(result).toEqual({ timer: 123, invalidations: 1, callbacks: 1, busy: false });
  });

  it('el watchdog no altera una operacion que ya no es la activa', () => {
    const result = vm.runInNewContext(`(() => {
      let invalidations = 0;
      let callbacks = 0;
      const window = { __LF_FACTURA_BUSY: true };
      const __LF_isCurrentOperation = () => false;
      const __LF_invalidateOperation = () => { invalidations++; };
      const setTimeout = callback => { callback(); return 456; };
      ${processingWatchdogSource}
      const timer = __LF_startProcessingWatchdog(7, () => { callbacks++; }, 1);
      return { timer, invalidations, callbacks, busy: window.__LF_FACTURA_BUSY };
    })()`, Object.create(null));

    expect(result).toEqual({ timer: 456, invalidations: 0, callbacks: 0, busy: true });
  });

  it('registra loadingTask, renderTask y worker Tesseract como recursos abortables', () => {
    expect(facturaCode).toContain('__LF_registerOperationAborter(operationId, destroyLoadingTask)');
    expect(facturaCode).toContain('renderTask.cancel?.()');
    expect(facturaCode).toContain('__LF_registerOperationAborter(operationId, terminateTessWorker)');
    expect(facturaCode).toContain('workerBlobURL: false');
    expect(facturaCode).toContain('await tessWorker.terminate()');
  });

  it('retira por igualdad solo la invitacion a OCR ya obsoleta', () => {
    expect(facturaCode).toContain('part && part !== obsoleteHtml');
    expect(facturaCode).toContain('__LF_showContextualWarnings(datos);');
    expect(facturaCode).toContain('__LF_restoreWarningHtml(avisosPreviosConservados);');
  });
});
