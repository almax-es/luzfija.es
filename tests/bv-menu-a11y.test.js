/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const loadBvUi = new Function('window', uiCode);

function bootMenu() {
  document.body.innerHTML = `
    <div id="menuRoot">
      <button id="btnMenu" aria-haspopup="menu" aria-expanded="false"></button>
      <div id="menuPanel" role="menu" aria-hidden="true">
        <a id="menuFirst" role="menuitem" href="#first">Primero</a>
        <button id="menuLast" role="menuitem">Último</button>
      </div>
    </div>`;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));
  window.BVSim = {};
  window.LF = {
    parseNum: (val) => (val === null || val === undefined ? 0 : parseFloat(String(val).replace(',', '.')))
  };
  window.BVSim.loadTarifasBV = vi.fn();
  window.BVSim.simulateForAllTarifasBV = vi.fn();
  window.BVSim.simulateMonthly = vi.fn();

  loadBvUi(window);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  expect(document.getElementById('btnMenu').dataset.bvBound).toBe('1');
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('bv-ui: accesibilidad del role=menu', () => {
  it('abre y recorre el menu con flechas y devuelve el foco con Escape', () => {
    bootMenu();

    const btn = document.getElementById('btnMenu');
    const panel = document.getElementById('menuPanel');
    const first = document.getElementById('menuFirst');
    const last = document.getElementById('menuLast');

    btn.focus();
    btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panel.classList.contains('show')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(first);

    panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(last);
    panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(first);
    panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(last);

    panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.classList.contains('show')).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });
});
