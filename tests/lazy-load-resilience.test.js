import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const csvImportCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
const facturaCode = fs.readdirSync(path.resolve(__dirname, '../js'))
  .filter((file) => /^factura.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js', file), 'utf8'))
  .join('\n');
const csvUtilsCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
const bvImportCode = fs.readFileSync(path.resolve(__dirname, '../js/bv/bv-import.js'), 'utf8');

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

function loadBvImportWithMockDocument(mockDocument) {
  // bv-import.js destructura funciones reales de window.LF.csvUtils al cargar
  // (parseDateFlexible, etc.), así que necesita lf-csv-utils.js real, no un stub vacío.
  const win = { LF: {} };
  global.document = mockDocument;
  new Function('window', csvUtilsCode)(win);
  new Function('window', bvImportCode)(win);
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

  it('BV (bv-import.js): si falla la carga lazy de XLSX, el estado se resetea y una segunda importación reintenta con éxito', async () => {
    const { doc, appendedScripts } = buildMockDocument();
    const win = loadBvImportWithMockDocument(doc);

    const file = new File(['dummy'], 'consumo.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // 1er intento: falla la carga del script XLSX
    const firstImport = win.BVSim.importFile(file);
    await new Promise((r) => setTimeout(r, 20));
    expect(appendedScripts).toHaveLength(1);
    appendedScripts[0].onerror();

    const firstResult = await firstImport;
    expect(firstResult.ok).toBe(false);
    expect(firstResult.error).toMatch(/Error al cargar librería XLSX/);

    // 2º intento: debe crear un script NUEVO (no reutilizar la promesa rota de ensureXLSX)
    const secondImport = win.BVSim.importFile(file);
    await new Promise((r) => setTimeout(r, 20));
    expect(appendedScripts).toHaveLength(2);
    expect(doc.head.appendChild).toHaveBeenCalledTimes(2);

    // Esta vez la carga tiene éxito: el reintento debe completar el parseo con normalidad.
    const header = ['FECHA', ...Array.from({ length: 24 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`)];
    const dataRow = ['27/10/2024', ...Array.from({ length: 24 }, () => '1')];
    global.XLSX = {
      read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
      utils: { sheet_to_json: vi.fn(() => [header, dataRow]) }
    };
    appendedScripts[1].onload();

    const secondResult = await secondImport;
    expect(secondResult.ok).toBe(true);
    expect(secondResult.records).toHaveLength(24);
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
