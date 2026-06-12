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
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.__LF_track;
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
