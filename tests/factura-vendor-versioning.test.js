import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const facturaCode = fs.readdirSync(path.resolve(__dirname, '../js'))
  .filter((file) => /^factura.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js', file), 'utf8'))
  .join('\n');

describe('Factura vendor asset versioning', () => {
  it('versiona PDF.js y jsQR usando el build del script actual', () => {
    expect(facturaCode).toContain('searchParams.get(\'v\')');
    expect(facturaCode).toContain('__LF_versionedUrl("vendor/pdfjs/pdf.min.mjs")');
    expect(facturaCode).toContain('__LF_versionedUrl("vendor/pdfjs/pdf.worker.min.mjs")');
    expect(facturaCode).toContain("__LF_versionedUrl('vendor/jsqr/jsQR.js')");
  });

  it('mantiene Tesseract sin query params en rutas y directorios internos', () => {
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract/tesseract.esm.min.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract/tesseract.min.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract/worker.min.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tesseract-core/tesseract-core.wasm.js')");
    expect(facturaCode).toContain("__LF_assetUrl('vendor/tessdata/')");
    expect(facturaCode).not.toContain("__LF_versionedUrl('vendor/tessdata/')");
  });
});
