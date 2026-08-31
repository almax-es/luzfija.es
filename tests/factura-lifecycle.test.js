import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(__dirname, '..');
const facturaCode = fs.readFileSync(path.join(repoRoot, 'js/factura.js'), 'utf8');
const bootstrapCode = fs.readFileSync(path.join(repoRoot, 'js/pdfjs-worker-bootstrap.mjs'), 'utf8');

function extractFunction(name) {
  const start = facturaCode.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontro ${name}`);
  const brace = facturaCode.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < facturaCode.length; i++) {
    if (facturaCode[i] === '{') depth++;
    if (facturaCode[i] === '}' && --depth === 0) return facturaCode.slice(start, i + 1);
  }
  throw new Error(`No se encontro el cierre de ${name}`);
}

const shimSource = extractFunction('__LF_installMapGetOrInsertComputedShim');

function probe(body) {
  return vm.runInNewContext(`${shimSource}\n${body}`, Object.create(null));
}

describe('compatibilidad de PDF.js', () => {
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
    const install = bootstrapCode.indexOf('installMapGetOrInsertComputedShim();');
    const vendorImport = bootstrapCode.indexOf('await import(vendorWorkerUrl.href)');
    const namedExport = bootstrapCode.indexOf('export const WorkerMessageHandler');
    expect(install).toBeGreaterThan(0);
    expect(vendorImport).toBeGreaterThan(install);
    expect(namedExport).toBeGreaterThan(vendorImport);
    expect(bootstrapCode).toContain('vendorWorkerUrl.search = bootstrapUrl.search;');
    expect(bootstrapCode).toContain("vendorWorkerUrl.hash = '';");
  });

  it('reintenta el import del core con fragmentos sin propagarlo al worker', () => {
    expect(facturaCode).toContain('const importUrl = new URL(baseSrc, document.baseURI);');
    expect(facturaCode).toContain('importUrl.hash = `lf-pdfjs-retry-${__LF_pdfjsImportFailures}`;');
    expect(facturaCode).toMatch(/catch \(error\) \{\s*__LF_pdfjsImportFailures\+\+;/);
    expect(facturaCode).toContain('__LF_versionedUrl("js/pdfjs-worker-bootstrap.mjs")');
  });
});

describe('cancelacion y aviso OCR', () => {
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
