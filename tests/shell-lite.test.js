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
    <div id="menuRoot">
      <button id="btnMenu" aria-haspopup="menu" aria-expanded="false"></button>
      <div id="menuPanel" role="menu" aria-hidden="true">
        <a id="menuFirst" role="menuitem" href="#first">Primero</a>
        <button id="menuLast" role="menuitem">Último</button>
      </div>
    </div>
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
  const timers = [];
  const runTimers = () => {
    while (timers.length) timers.shift()();
  };
  win.setTimeout = (cb) => {
    timers.push(cb);
    return timers.length;
  };
  win.eval(shellCode);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  runTimers();
  return { dom, win, cacheKeys, runTimers };
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

  it('permite recorrer el role=menu con teclado y devuelve el foco al cerrar con Escape', () => {
    const { dom, win, runTimers } = makePage();
    const btn = win.document.getElementById('btnMenu');
    const panel = win.document.getElementById('menuPanel');
    const first = win.document.getElementById('menuFirst');
    const last = win.document.getElementById('menuLast');

    btn.focus();
    btn.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panel.classList.contains('show')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(win.document.activeElement).toBe(first);
    runTimers();
    expect(panel.classList.contains('show')).toBe(true);

    panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(win.document.activeElement).toBe(last);
    panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(win.document.activeElement).toBe(first);
    panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(win.document.activeElement).toBe(last);

    panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.classList.contains('show')).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(win.document.activeElement).toBe(btn);

    dom.window.close();
  });
});
