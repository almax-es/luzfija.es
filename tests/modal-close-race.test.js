/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const inputsCode = read('js/lf-inputs.js');

function installMotionPreference(getReduce) {
  window.matchMedia = vi.fn((query) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? getReduce() : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn()
  }));
}

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.body.scrollTop = 0;
  document.body.innerHTML = '';
  delete window.__solarInfoInitialized;
});

describe('cierre y reapertura de modales de la home', () => {
  it('PVPC limpia semantica al instante y un timer viejo no cierra una reapertura', async () => {
    vi.useFakeTimers();
    let reduceMotion = false;
    installMotionPreference(() => reduceMotion);
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (cb) => { cb(0); return 1; };
    window.fetch = vi.fn(() => new Promise(() => {}));
    window.LF = { el: { inputs: {} } };
    localStorage.clear();

    document.body.innerHTML = `
      <button id="btnPVPCInfo">Abrir PVPC</button>
      <div id="modalPVPCInfo" aria-hidden="true" style="display:none">
        <div class="modal-content"><div id="modalPVPCHoursList"></div></div>
        <button id="btnCerrarPVPCX">Cerrar X</button>
        <button id="btnCerrarPVPCInfo">Cerrar</button>
      </div>`;

    vi.resetModules();
    await import('../js/lf-csv-utils.js');
    await import('../js/index-extra.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const open = document.getElementById('btnPVPCInfo');
    const modal = document.getElementById('modalPVPCInfo');
    const close = document.getElementById('btnCerrarPVPCInfo');
    document.body.scrollTop = 240;
    open.focus();
    open.click();

    expect(modal.classList.contains('show')).toBe(true);
    expect(modal.getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement).toBe(document.getElementById('btnCerrarPVPCX'));
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');

    close.click();
    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.scrollTop).toBe(240);
    expect(document.activeElement).toBe(open);

    // Reabrir antes de los 300 ms debe invalidar el display:none del cierre.
    open.click();
    expect(modal.classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(modal.style.display).toBe('flex');
    expect(modal.getAttribute('aria-hidden')).toBe('false');

    // En reduced-motion desaparece visualmente sin conservar 300 ms de cola.
    reduceMotion = true;
    close.click();
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(document.documentElement.style.overflow).toBe('');
    vi.runOnlyPendingTimers();
    expect(modal.style.display).toBe('none');

    // Cerrar antes del frame de apertura tampoco puede revivir el modal.
    reduceMotion = false;
    const pendingFrames = [];
    window.requestAnimationFrame = (cb) => { pendingFrames.push(cb); return pendingFrames.length; };
    open.click();
    open.click(); // doble clic: no debe programar otra apertura
    expect(pendingFrames).toHaveLength(1);
    close.click();
    pendingFrames.forEach((cb) => cb(0));
    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('Solar cancela el cierre visual pendiente al reabrirse', () => {
    vi.useFakeTimers();
    let reduceMotion = false;
    installMotionPreference(() => reduceMotion);
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (cb) => { cb(0); return 1; };

    document.body.innerHTML = `
      <input id="solarOn" type="checkbox">
      <div id="solarFields"></div>
      <button id="btnSolarInfo">Abrir solar</button>
      <div id="modalSolarInfo" aria-hidden="true" style="display:none">
        <button id="btnCerrarSolarX">Cerrar X</button>
        <button id="btnCerrarSolarInfo">Cerrar</button>
      </div>`;

    const solarOn = document.getElementById('solarOn');
    const noop = () => {};
    window.LF = {
      $: (id) => document.getElementById(id),
      el: { inputs: { solarOn } },
      state: {}, DEFAULTS: {}, SERVER_PARAMS: {}, LS_KEY: 'test-inputs',
      parseNum: Number, clampNonNeg: (n) => n, clamp01to365Days: (n) => n,
      round2: (n) => n, asBool: Boolean, formatValueForDisplay: String,
      showError: noop, clearErrorStyles: noop, applyButtonState: noop,
      esNumericoValido: () => true
    };
    new Function('window', inputsCode)(window);
    solarOn.checked = true;
    window.LF.updateSolarUI();

    const open = document.getElementById('btnSolarInfo');
    const modal = document.getElementById('modalSolarInfo');
    const close = document.getElementById('btnCerrarSolarInfo');
    document.body.scrollTop = 180;
    open.focus();
    open.click();
    expect(modal.classList.contains('show')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(modal.getAttribute('aria-hidden')).toBe('false');

    close.click();
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.scrollTop).toBe(180);
    expect(document.activeElement).toBe(open);

    open.click();
    vi.advanceTimersByTime(200);
    expect(modal.classList.contains('show')).toBe(true);
    expect(modal.style.display).toBe('flex');
    expect(modal.getAttribute('aria-hidden')).toBe('false');

    reduceMotion = true;
    close.click();
    vi.runOnlyPendingTimers();
    expect(modal.style.display).toBe('none');
    expect(modal.getAttribute('aria-hidden')).toBe('true');

    // Una apertura diferida que se cierra antes del frame queda invalidada.
    reduceMotion = false;
    const pendingFrames = [];
    window.requestAnimationFrame = (cb) => { pendingFrames.push(cb); return pendingFrames.length; };
    open.click();
    open.click();
    expect(pendingFrames).toHaveLength(1);
    close.click();
    pendingFrames.forEach((cb) => cb(0));
    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(document.documentElement.style.overflow).toBe('');
  });
});
