import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

/**
 * @vitest-environment jsdom
 */

const shellCode = fs.readFileSync(path.resolve(__dirname, '../js/shell-lite.js'), 'utf8');

function makePage({ bvOwnsShell = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="btnTheme"></button>
    <button id="btnMenu"></button>
    <div id="menuPanel"></div>
    <button id="btnClearCache"></button>
  </body>`, {
    url: 'https://luzfija.es/estadisticas/',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  win.LF = { initSwUpdate: vi.fn() };
  if (bvOwnsShell) {
    win.document.getElementById('btnTheme').dataset.bvBound = '1';
    win.document.getElementById('btnMenu').dataset.bvBound = '1';
  }
  const cacheKeys = vi.fn(() => new Promise(() => {}));
  Object.defineProperty(win, 'caches', {
    configurable: true,
    value: { keys: cacheKeys, delete: vi.fn() }
  });
  win.setTimeout = (cb) => {
    cb();
    return 1;
  };
  win.eval(shellCode);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  return { dom, win, cacheKeys };
}

describe('Shell lite ownership', () => {
  it('no registra un segundo Limpiar caché cuando bv-ui ya posee los controles del shell', () => {
    const { dom, win, cacheKeys } = makePage({ bvOwnsShell: true });

    win.document.getElementById('btnClearCache').click();

    expect(cacheKeys).not.toHaveBeenCalled();
    dom.window.close();
  });

  it('mantiene Limpiar caché operativo en páginas donde shell-lite es el propietario', () => {
    const { dom, win, cacheKeys } = makePage();

    win.document.getElementById('btnClearCache').click();

    expect(cacheKeys).toHaveBeenCalledTimes(1);
    dom.window.close();
  });
});
