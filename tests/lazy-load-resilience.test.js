import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const csvImportCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
const facturaCode = fs.readFileSync(path.resolve(__dirname, '../js/factura.js'), 'utf8');

const originalDocument = global.document;

function buildMockDocument() {
  const appendedScripts = [];
  const doc = {
    baseURI: 'http://localhost/',
    createElement: vi.fn(() => ({})),
    head: {
      appendChild: vi.fn((script) => {
        appendedScripts.push(script);
      })
    }
  };

  return { doc, appendedScripts };
}

function loadCsvImporterWithMockDocument(mockDocument) {
  const win = { LF: { csvUtils: {} } };
  const lfDbg = vi.fn();
  const FileReader = class {};

  global.document = mockDocument;
  const runner = new Function('window', 'lfDbg', 'FileReader', csvImportCode);
  runner(win, lfDbg, FileReader);

  return win;
}

afterEach(() => {
  global.document = originalDocument;
  delete global.XLSX;
});

describe('Lazy load resilience', () => {
  it('ensureXLSX deduplica llamadas concurrentes y carga solo una vez', async () => {
    const { doc, appendedScripts } = buildMockDocument();
    const win = loadCsvImporterWithMockDocument(doc);

    const p1 = win.LF.ensureXLSX();
    const p2 = win.LF.ensureXLSX();

    expect(doc.head.appendChild).toHaveBeenCalledTimes(1);

    appendedScripts[0].onload();
    await expect(Promise.all([p1, p2])).resolves.toEqual([undefined, undefined]);
  });

  it('ensureXLSX limpia estado tras error y permite reintento', async () => {
    const { doc, appendedScripts } = buildMockDocument();
    const win = loadCsvImporterWithMockDocument(doc);

    const firstTry = win.LF.ensureXLSX();
    appendedScripts[0].onerror();
    await expect(firstTry).rejects.toThrow(/Error al cargar librería XLSX/);

    const secondTry = win.LF.ensureXLSX();
    expect(doc.head.appendChild).toHaveBeenCalledTimes(2);
    expect(secondTry).not.toBe(firstTry);

    appendedScripts[1].onload();
    await expect(secondTry).resolves.toBeUndefined();
  });

  it('ensureXLSX no intenta cargar script si XLSX ya existe', async () => {
    const { doc } = buildMockDocument();
    const win = loadCsvImporterWithMockDocument(doc);
    global.XLSX = {};

    await expect(win.LF.ensureXLSX()).resolves.toBeUndefined();
    expect(doc.head.appendChild).not.toHaveBeenCalled();
  });

  it('factura.js mantiene limpieza defensiva de __LF_pdfjsLoading en ambos awaits', () => {
    const resetMatches = facturaCode.match(/finally\s*\{\s*__LF_pdfjsLoading\s*=\s*null;\s*\}/g) || [];
    expect(resetMatches.length).toBeGreaterThanOrEqual(2);

    // Rama de "llamada concurrente"
    expect(facturaCode).toMatch(/if\s*\(__LF_pdfjsLoading\)\s*\{\s*try\s*\{\s*await __LF_pdfjsLoading;\s*\}\s*finally\s*\{\s*__LF_pdfjsLoading = null;\s*\}/s);

    // Rama de "primera carga"
    expect(facturaCode).toMatch(/__LF_pdfjsLoading\s*=\s*\(async\(\)=>\{[\s\S]*?\}\)\(\);\s*try\s*\{\s*await __LF_pdfjsLoading;\s*\}\s*finally\s*\{\s*__LF_pdfjsLoading = null;\s*\}/s);
  });
});
