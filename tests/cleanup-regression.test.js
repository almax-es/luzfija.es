import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Cleanup regressions', () => {
  it('pvpc.js no contiene normalizeProxyBase muerto', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/pvpc.js'), 'utf8');
    expect(code).not.toMatch(/\bfunction\s+normalizeProxyBase\s*\(/);
  });

  it('lf-app.js no contiene el stub showUpdateNotification', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');
    expect(code).not.toMatch(/\bfunction\s+showUpdateNotification\s*\(/);
  });

  it('lf-app.js no fuerza reload dentro de controllerchange del service worker', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');
    const controllerChangeBlock = code.match(/serviceWorker\.addEventListener\('controllerchange'[\s\S]{0,700}?\}\);/);
    expect(controllerChangeBlock?.[0] || '').not.toMatch(/\breload\s*\(/);
  });

  it('shell-lite.js no fuerza reload dentro de controllerchange del service worker', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/shell-lite.js'), 'utf8');
    const controllerChangeBlock = code.match(/serviceWorker\.addEventListener\('controllerchange'[\s\S]{0,400}?\}\);/);
    expect(controllerChangeBlock?.[0] || '').not.toMatch(/\breload\s*\(/);
  });

  it('lf-state.js no mantiene referencia obsoleta a btnExport', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-state.js'), 'utf8');
    expect(code).not.toMatch(/\bbtnExport\b/);
  });

  it('estadisticas/index.html no usa wasm-unsafe-eval en CSP', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../estadisticas/index.html'), 'utf8');
    expect(html).not.toContain("'wasm-unsafe-eval'");
  });
});
