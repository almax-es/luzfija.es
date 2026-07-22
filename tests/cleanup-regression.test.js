import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function snippetFromControllerChange(code, span = 700) {
  const idx = code.indexOf("serviceWorker.addEventListener('controllerchange'");
  if (idx === -1) return '';
  return code.slice(idx, idx + span);
}

describe('Cleanup regressions', () => {
  it('pvpc.js no contiene normalizeProxyBase muerto', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/pvpc.js'), 'utf8');
    expect(code).not.toMatch(/\bfunction\s+normalizeProxyBase\s*\(/);
  });

  it('lf-app.js no contiene el stub showUpdateNotification', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');
    expect(code).not.toMatch(/\bfunction\s+showUpdateNotification\s*\(/);
  });

  it('lf-sw-update.js no fuerza reload incondicional dentro de controllerchange del service worker', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-sw-update.js'), 'utf8');
    // controllerchange solo marca stale y delega; la recarga vive en
    // tryReloadOnStale, con guards (interaccion/fresh/hidden + version del SW).
    const block = snippetFromControllerChange(code, 900);
    expect(block).toContain('tryReloadOnStale');
    expect(block).not.toMatch(/window\.location\.reload/);
    const reloadIdx = code.indexOf('async function tryReloadOnStale');
    expect(reloadIdx).toBeGreaterThan(-1);
    const reloadBlock = code.slice(reloadIdx, reloadIdx + 1400);
    expect(reloadBlock).toContain('shouldReloadOnSwActivate');
    expect(reloadBlock).toContain('markReloadedVersion');
    expect(reloadBlock).toMatch(/\breload\s*\(/);
  });

  it('lf-state.js no mantiene referencia obsoleta a btnExport', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-state.js'), 'utf8');
    expect(code).not.toMatch(/\bbtnExport\b/);
  });

  it('estadisticas/index.html no usa wasm-unsafe-eval en CSP', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../estadisticas/index.html'), 'utf8');
    expect(html).not.toContain("'wasm-unsafe-eval'");
  });

  it('los consumidores de lfDbg tienen un no-op local si lf-utils no cargó', () => {
    for (const rel of ['../js/lf-app.js', '../js/lf-csv-import.js']) {
      const code = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
      expect(code).toMatch(/const lfDbg = typeof window\.lfDbg === 'function'/);
    }
  });
});
