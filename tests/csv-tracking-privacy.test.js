import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guardrail de privacidad: los eventos csv-import-* nunca deben llevar datos
// derivados del archivo del usuario. La extensión debe pasar por la allowlist
// safeFileExtensionForTracking (un nombre sin punto haría que split('.').pop()
// devolviera el nombre entero como segmento del path) y el error debe viajar
// como código normalizado de csvErrorCodeForTracking, nunca como mensaje.

const bvUiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');

const pvpcStatsUiCode = fs.readdirSync(path.resolve(__dirname, '../js'))
  .filter((file) => /^pvpc-stats-(?:csv|ui)\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js', file), 'utf8'))
  .join('\n');

const EMITTERS = [
  { file: 'js/lf-csv-import.js', trackFn: 'trackCsvEvent' },
  { file: 'js/bv/bv-ui*.js', trackFn: 'trackBvEvent', src: bvUiCode },
  { file: 'js/pvpc-stats-ui.js', trackFn: 'trackStatsEvent', src: pvpcStatsUiCode }
];

describe('Privacidad en eventos csv-import-* (guardrail estático)', () => {
  for (const entry of EMITTERS) {
    const { file, trackFn } = entry;
    const src = entry.src || fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

    it(`${file}: usa la allowlist de extensión para tracking`, () => {
      expect(src).toContain('safeFileExtensionForTracking');
    });

    it(`${file}: ninguna llamada csv-import-* deriva datos crudos en línea`, () => {
      const trackCalls = src.split('\n').filter(
        (line) => line.includes(`${trackFn}('csv-import`)
      );
      expect(trackCalls.length).toBeGreaterThan(0);
      for (const line of trackCalls) {
        // Extensión cruda del nombre de archivo
        expect(line).not.toMatch(/split\('\.'\)/);
        // Mensaje de error truncado (patrón antiguo pre-fix)
        expect(line).not.toMatch(/substring\(/);
        expect(line).not.toMatch(/msgError/);
      }
    });
  }
});

// Integración runtime: dispara el handler REAL del importador de la home
// (initCSVImporter) con archivos hostiles y verifica el payload que llega
// al sink de tracking.

function waitForMockCall(mock, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (mock.mock.calls.length > 0) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout esperando llamada de tracking'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe('Privacidad en eventos csv-import-* (integración runtime, home)', () => {
  beforeAll(async () => {
    // Imports dinámicos para poder stubear toast (vive en lf-ui.js, no cargado
    // aquí) ANTES de que lf-csv-import.js lo destructure en su carga.
    await import('../js/lf-utils.js');
    window.LF = window.LF || {};
    window.LF.toast = vi.fn();
    await import('../js/lf-csv-utils.js');
    await import('../js/lf-csv-import.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '<div class="actions-center"></div>';
    window.__LF_trackDetail = vi.fn();
    const previo = document.getElementById('csvConsumoInput');
    if (previo) previo.remove();
  });

  async function importarArchivo(file) {
    window.initCSVImporter();
    const input = document.getElementById('csvConsumoInput');
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForMockCall(window.__LF_trackDetail);
  }

  it('un archivo sin punto en el nombre emite "desconocido", nunca el nombre', async () => {
    await importarArchivo(new File(['x'], 'ES0021000000000000AB', { type: 'text/plain' }));

    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'csv-import-error',
      ['home', 'desconocido', 'formato-no-soportado'],
      { title: 'Error al procesar CSV/XLSX en home' }
    );

    const todoElPayload = JSON.stringify(window.__LF_trackDetail.mock.calls);
    expect(todoElPayload).not.toContain('ES0021000000000000AB');
  });

  it('un CSV ilegible emite código de error, nunca el mensaje ni el contenido', async () => {
    const contenido = 'ES9999000000000000XY;Juan Pérez;C/ Falsa 123';
    await importarArchivo(new File([contenido], 'datos.csv', { type: 'text/csv' }));

    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'csv-import-error',
      ['home', 'csv', 'cabecera'],
      { title: 'Error al procesar CSV/XLSX en home' }
    );

    const todoElPayload = JSON.stringify(window.__LF_trackDetail.mock.calls);
    expect(todoElPayload).not.toContain('ES9999000000000000XY');
    expect(todoElPayload).not.toContain('Juan');
  });
});
