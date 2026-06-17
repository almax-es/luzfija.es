import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const aeccBannerCode = fs.readFileSync(path.resolve(__dirname, '../js/aecc-banner.js'), 'utf8');

function loadAeccBanner() {
  const fn = new Function(aeccBannerCode);
  fn();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  window.__LF_track = vi.fn();
  // jsdom no hace layout: simulamos viewport de escritorio por defecto
  window.matchMedia = vi.fn(() => ({ matches: true }));
  window.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.__LF_track;
  delete window.IntersectionObserver;
});

describe('AECC donation banner', () => {
  it('no se inicializa si hay cooldown activo', () => {
    localStorage.setItem('lf_aecc_banner_dismissed_at', String(Date.now()));
    document.body.innerHTML = '<button id="btnCalc"></button>';

    loadAeccBanner();

    expect(document.getElementById('aecc-banner')).toBeNull();
  });

  it('no se inicializa en viewports moviles/tablet (solo escritorio)', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    document.body.innerHTML = '<button id="btnCalc"></button>';

    loadAeccBanner();

    expect(document.getElementById('aecc-banner')).toBeNull();
  });

  it('no se inicializa en el comparador solar', () => {
    document.body.innerHTML = `
      <button id="bv-simulate"></button>
      <div id="bv-results-container" style="display:block">
        <div id="bv-results"><article>Resultado</article></div>
      </div>
    `;

    loadAeccBanner();

    expect(document.getElementById('aecc-banner')).toBeNull();
  });

  it('no se muestra con resultados listos si no hubo solicitud previa de calculo', () => {
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-ready', {
      detail: { origin: 'home', rows: 1 }
    }));
    vi.advanceTimersByTime(4200);

    expect(document.getElementById('aecc-banner').classList.contains('aecc-banner--visible')).toBe(false);
  });

  it('se muestra tras resultados reales en home y guarda cooldown al cerrar', () => {
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', {
      detail: { origin: 'home' }
    }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', {
      detail: { origin: 'home', rows: 1 }
    }));
    vi.advanceTimersByTime(2800);

    const banner = document.getElementById('aecc-banner');
    expect(banner).toBeTruthy();
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
    expect(banner.hasAttribute('inert')).toBe(false);
    expect(window.__LF_track).toHaveBeenCalledWith('aecc-banner-mostrado', { title: 'origen:home' });

    banner.querySelector('.aecc-banner__close').click();

    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toMatch(/^\d+$/);
    expect(window.__LF_track).toHaveBeenCalledWith('aecc-banner-cerrado', { title: 'origen:home' });
  });

  it('se aparta cuando el formulario entra en pantalla y reaparece al salir', () => {
    let observerCallback = null;
    const observeFn = vi.fn();
    const disconnectFn = vi.fn();
    window.IntersectionObserver = function (cb) {
      observerCallback = cb;
      this.observe = observeFn;
      this.disconnect = disconnectFn;
    };

    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(2800);

    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
    expect(observeFn).toHaveBeenCalledTimes(2);

    const btnCalc = document.getElementById('btnCalc');
    const seccion = document.getElementById('seccionResultados');

    // El usuario sube al formulario: el boton Calcular entra en viewport
    observerCallback([
      { target: btnCalc, isIntersecting: true },
      { target: seccion, isIntersecting: false }
    ]);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    // No cuenta como cierre: sin cooldown ni evento "cerrado"
    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toBeNull();
    expect(window.__LF_track).not.toHaveBeenCalledWith('aecc-banner-cerrado', { title: 'origen:home' });

    // Sigue subiendo hasta arriba del todo: ni formulario ni resultados a la vista
    observerCallback([{ target: btnCalc, isIntersecting: false }]);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);

    // Vuelve a bajar a los resultados
    observerCallback([
      { target: btnCalc, isIntersecting: false },
      { target: seccion, isIntersecting: true }
    ]);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
    // El evento "mostrado" solo se emitio una vez
    const shownCalls = window.__LF_track.mock.calls.filter((c) => c[0] === 'aecc-banner-mostrado');
    expect(shownCalls.length).toBe(1);
  });

  it('se aparta si un campo numerico queda bajo la zona del banner aunque el boton calcular no este visible', () => {
    const observeFn = vi.fn();
    window.IntersectionObserver = function () {
      this.observe = observeFn;
      this.disconnect = vi.fn();
    };

    let inputRect = { left: 40, right: 220, top: 80, bottom: 124, width: 180, height: 44 };
    document.body.innerHTML = `
      <input id="p1">
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('p1').getBoundingClientRect = () => inputRect;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(2800);

    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);

    inputRect = { left: 40, right: 220, top: 560, bottom: 604, width: 180, height: 44 };
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(0);

    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toBeNull();

    inputRect = { left: 40, right: 220, top: 80, bottom: 124, width: 180, height: 44 };
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(0);

    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
  });

  it('copia el codigo Bizum en home, guarda cooldown y no cuenta el cierre como rechazo', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });

    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', {
      detail: { origin: 'home' }
    }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', {
      detail: { origin: 'home', rows: 1 }
    }));
    vi.advanceTimersByTime(2800);

    document.querySelector('.aecc-banner__cta').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('11244');
    expect(document.querySelector('.aecc-banner__status').textContent).toContain('copiado');
    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toMatch(/^\d+$/);
    expect(window.__LF_track).toHaveBeenCalledWith('aecc-banner-copiado', { title: 'origen:home' });

    document.querySelector('.aecc-banner__close').click();
    expect(window.__LF_track).not.toHaveBeenCalledWith('aecc-banner-cerrado', { title: 'origen:home' });

    vi.advanceTimersByTime(2200);
    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    expect(banner.hasAttribute('inert')).toBe(true);
  });
});
