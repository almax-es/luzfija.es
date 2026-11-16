import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const facturaCode = fs.readdirSync(path.resolve(__dirname, '../js'))
  .filter((file) => /^factura.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js', file), 'utf8'))
  .join('\n');
const workerBootstrapCode = fs.readFileSync(
  path.resolve(__dirname, '../js/pdfjs-worker-bootstrap.mjs'),
  'utf8'
);

describe('Factura vendor asset versioning', () => {
  it('versiona PDF.js y jsQR usando el build del script actual', () => {
    expect(facturaCode).toContain('searchParams.get(\'v\')');
    expect(facturaCode).toContain('__LF_versionedUrl("vendor/pdfjs/pdf.min.mjs")');
    expect(facturaCode).toContain('__LF_versionedUrl("js/pdfjs-worker-bootstrap.mjs")');
    expect(workerBootstrapCode).toContain("new URL('../vendor/pdfjs/pdf.worker.min.mjs', bootstrapUrl)");
    expect(workerBootstrapCode).toContain('vendorWorkerUrl.search = bootstrapUrl.search;');
    expect(workerBootstrapCode).toContain("vendorWorkerUrl.hash = '';");
    expect(workerBootstrapCode).toContain('export const WorkerMessageHandler = workerModule.WorkerMessageHandler;');
    expect(facturaCode).toContain("__LF_versionedUrl('vendor/jsqr/jsQR.js')");
  });

  it('mantiene Tesseract sin query params en rutas y directorios internos', () => {
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract/tesseract.esm.min.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract/tesseract.min.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract/worker.min.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract-core/')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tessdata/')");
    expect(facturaCode).not.toContain("__LF_versionedUrl('vendor/tessdata/')");
  });

  it('da a Tesseract un directorio de core con todas las variantes LSTM que puede elegir', () => {
    // Con un fichero concreto en corePath el worker no puede elegir compilacion
    // y carga siempre la basica sin SIMD (y sin la variante -lstm, mas ligera).
    expect(facturaCode).not.toMatch(/corePath:\s*__LF_assetUrl\('vendor\/tesseract-core\/[^']+\.js'\)/);
    // El OEM por defecto (LSTM_ONLY) es el que hace que el worker pida las -lstm;
    // si alguien fija otro OEM, tendria que vendorizar tambien las variantes completas.
    expect(facturaCode).toContain("T.createWorker('spa', undefined, __LF_tessOpts)");

    // Las rutas que construye el worker vendorizado para lstmOnly deben existir todas:
    // si falta una, el OCR falla solo en los navegadores que la elijan.
    const workerCode = fs.readFileSync(path.resolve(__dirname, '../vendor/tesseract/worker.min.js'), 'utf8');
    const lstmVariants = [...new Set(workerCode.match(/\/tesseract-core[a-z-]*-lstm\.wasm\.js/g))];
    expect(lstmVariants.sort()).toEqual([
      '/tesseract-core-lstm.wasm.js',
      '/tesseract-core-relaxedsimd-lstm.wasm.js',
      '/tesseract-core-simd-lstm.wasm.js'
    ]);
    for (const variant of lstmVariants) {
      expect(fs.existsSync(path.resolve(__dirname, '../vendor/tesseract-core' + variant))).toBe(true);
    }
  });
});
