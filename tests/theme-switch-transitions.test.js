import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 *
 * Cambio de tema sin transiciones (INP, 12/11/2026). Con la tabla de resultados
 * pintada, las transiciones de color/fondo convertian el clic en el boton de tema
 * en tres recalculos de estilo de toda la pagina (1,1-2,1 s con CPU 4x en movil
 * emulado; 0,28-0,33 s sin ellas). toggleTheme() pone `lf-theme-switching` en
 * <html> mientras aplica el tema y la retira tras dos frames, con un temporizador
 * de respaldo y un token frente a pulsaciones rapidas.
 */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const uiCode = read('js/lf-ui.js');
const proCss = read('pro.css');

let frames = [];

function setup(initialLight = false) {
  document.documentElement.className = initialLight ? 'light-mode' : '';
  document.body.className = initialLight ? 'light-mode' : '';
  document.body.innerHTML = `
    <button id="btnTheme"></button>
    <div id="toast" class="toast"><span id="toastDot"></span><span id="toastText"></span></div>`;
  window.LF = {
    el: {
      btnTheme: document.getElementById('btnTheme'),
      toast: document.getElementById('toast'),
      toastText: document.getElementById('toastText'),
      toastDot: document.getElementById('toastDot')
    },
    state: {},
    THEME_KEY: 'almax_theme'
  };
  window.__ALMAX_THEME_SAVED = initialLight ? 'light' : 'dark';
  new Function('window', uiCode)(window);
}

function runFrame() {
  const pending = frames;
  frames = [];
  pending.forEach((cb) => cb(0));
}

const root = () => document.documentElement;
const switching = () => root().classList.contains('lf-theme-switching');
const toastText = () => document.getElementById('toastText').textContent;
const toastShown = () => document.getElementById('toast').classList.contains('show');

describe('toggleTheme: cambio de tema sin transiciones', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    window.requestAnimationFrame = vi.fn((cb) => { frames.push(cb); return frames.length; });
    try { localStorage.clear(); } catch (_) {}
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.requestAnimationFrame;
  });

  it('anula las transiciones en el mismo tick del clic y las libera tras dos frames', () => {
    setup(false);
    window.LF.toggleTheme();

    expect(root().classList.contains('light-mode')).toBe(true);
    expect(document.body.classList.contains('light-mode')).toBe(true);
    expect(localStorage.getItem('almax_theme')).toBe('light');
    expect(switching()).toBe(true);
    expect(toastShown()).toBe(false);

    runFrame();
    expect(switching()).toBe(true);

    runFrame();
    expect(switching()).toBe(false);
    expect(toastShown()).toBe(true);
    expect(toastText()).toBe('Modo claro');
  });

  it('sin frames (pestana en segundo plano) el temporizador de respaldo retira la clase', () => {
    setup(true);
    window.LF.toggleTheme();
    expect(switching()).toBe(true);

    vi.advanceTimersByTime(499);
    expect(switching()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(switching()).toBe(false);
    expect(root().classList.contains('light-mode')).toBe(false);
    expect(toastText()).toBe('Modo oscuro');
  });

  it('sin requestAnimationFrame no lanza y libera con el temporizador', () => {
    setup(false);
    delete window.requestAnimationFrame;
    expect(() => window.LF.toggleTheme()).not.toThrow();
    vi.advanceTimersByTime(500);
    expect(switching()).toBe(false);
  });

  it('con dos clics rapidos, la retirada del primero no quita la clase del segundo', () => {
    setup(false);
    window.LF.toggleTheme();
    runFrame();
    window.LF.toggleTheme();
    expect(root().classList.contains('light-mode')).toBe(false);

    // Segundo frame del primer clic: su retirada ya no es la vigente.
    runFrame();
    expect(switching()).toBe(true);
    expect(toastShown()).toBe(false);

    // Segundo frame del segundo clic.
    runFrame();
    expect(switching()).toBe(false);
    expect(toastText()).toBe('Modo oscuro');

    // Los temporizadores de respaldo tampoco reponen ni quitan nada despues.
    vi.advanceTimersByTime(1000);
    expect(switching()).toBe(false);
    expect(root().classList.contains('light-mode')).toBe(false);
  });

  it('pro.css anula las transiciones del raiz, sus descendientes y pseudoelementos', () => {
    const rule = proCss.match(/((?:html\.lf-theme-switching[^,{]*,\s*)+html\.lf-theme-switching[^,{]*)\{([^}]*)\}/);
    expect(rule, 'falta la regla html.lf-theme-switching en pro.css').toBeTruthy();
    const selectors = rule[1].split(',').map((s) => s.trim());
    expect(selectors).toEqual(expect.arrayContaining([
      'html.lf-theme-switching',
      'html.lf-theme-switching::before',
      'html.lf-theme-switching::after',
      'html.lf-theme-switching *',
      'html.lf-theme-switching *::before',
      'html.lf-theme-switching *::after'
    ]));
    expect(rule[2].replace(/\s+/g, '')).toContain('transition:none!important');
  });
});
