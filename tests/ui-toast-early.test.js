import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const stateCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-state.js'), 'utf8');
const uiCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-ui.js'), 'utf8');
const loadState = new Function('window', stateCode);
const loadUi = new Function('window', uiCode);

function bootWithoutInitElements() {
  window.LF = {};
  loadState(window);
  loadUi(window);
}

describe('toast antes de initElements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    delete window.LF;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.LF;
  });

  it('resuelve el DOM de forma perezosa y muestra el aviso', () => {
    document.body.innerHTML = `
      <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
    `;
    bootWithoutInitElements();

    expect(() => window.LF.toast('x', 'err')).not.toThrow();
    expect(document.getElementById('toastText').textContent).toBe('x');
    expect(document.getElementById('toast').classList.contains('show')).toBe(true);
  });

  it('no depende del punto decorativo', () => {
    document.body.innerHTML = '<div id="toast"><span id="toastText"></span></div>';
    bootWithoutInitElements();

    expect(() => window.LF.toast('x', 'err')).not.toThrow();
    expect(document.getElementById('toastText').textContent).toBe('x');
  });

  it('retorna en silencio si el contenedor no existe', () => {
    document.body.innerHTML = '<span id="toastText"></span>';
    bootWithoutInitElements();

    expect(() => window.LF.toast('x', 'err')).not.toThrow();
    expect(document.getElementById('toastText').textContent).toBe('');
  });
});
