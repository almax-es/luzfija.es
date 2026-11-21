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

  it('una nueva solicitud invalida el show pendiente de los resultados anteriores', () => {
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa anterior</td></tr></tbody></table>
    `;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(1000);

    // Empieza un segundo cálculo antes de que venzan los 2,8 s del primero. Las
    // filas anteriores siguen físicamente en el DOM hasta que el nuevo resultado
    // se publique, así que un timer huérfano podría confundirlas con datos vigentes.
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    vi.advanceTimersByTime(5000);

    expect(document.getElementById('aecc-banner').classList.contains('aecc-banner--visible')).toBe(false);
  });

  // Revision de ChatGPT, 20/11/2026: un ranking de datos que el usuario ya cambio no es un resultado util.
  it('no se programa con un results-ready de resultados no vigentes', () => {
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1, vigente: false } }));
    vi.advanceTimersByTime(5000);

    expect(document.getElementById('aecc-banner').classList.contains('aecc-banner--visible')).toBe(false);
    expect(window.__LF_track).not.toHaveBeenCalledWith('aecc-banner-mostrado', expect.anything());
  });

  // Revision de ChatGPT, 20/11/2026: el evento llega vigente pero el usuario edita en los 2,8 s de espera.
  it('no aparece si, mientras espera, hay cambios pendientes', () => {
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    window.LF = { state: { pending: false } };
    try {
      loadAeccBanner();
      document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
      document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1, vigente: true } }));
      window.LF.state.pending = true; // edicion durante la espera
      vi.advanceTimersByTime(20000);
      expect(document.getElementById('aecc-banner').classList.contains('aecc-banner--visible')).toBe(false);
    } finally {
      delete window.LF;
    }
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

  // 21/11/2026: con el ranking apilado (hasta 1.360 px o ventana encogida) el banner tapaba
  // 4-5 filas. Se aparta si su zona, con 24 px de margen, toca la tarjeta de resultados.
  it('se aparta si la tarjeta del ranking entra en su zona y vuelve en dos columnas', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    // 1.440 px: dos columnas reales (por encima de 1.360 px)
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

    // Dos columnas: la tarjeta empieza a la derecha del formulario de 440 px
    let seccionRect = { left: 545, right: 1420, top: 0, bottom: 800, width: 875, height: 800 };
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () => seccionRect;

    loadAeccBanner();
    const banner = document.getElementById('aecc-banner');
    banner.style.width = '372px';
    banner.style.height = '280px';
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(2800);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);

    // Ventana encogida a 1.280 px: la tarjeta pasa a ocupar todo el ancho bajo el formulario
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    seccionRect = { left: 59, right: 1221, top: 0, bottom: 800, width: 1162, height: 800 };
    document.body.dispatchEvent(new Event('scroll')); // el scroll de BODY no burbujea a window
    vi.advanceTimersByTime(0);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toBeNull();

    // Dentro del margen de 24 px tambien se aparta: 20 + 372 + 24 = 416
    seccionRect = { left: 410, right: 1260, top: 0, bottom: 800, width: 850, height: 800 };
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(0);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);

    seccionRect = { left: 420, right: 1260, top: 0, bottom: 800, width: 840, height: 800 };
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(0);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
  });

  it('no llega a mostrarse si, al tocar mostrarlo, el ranking ya ocupa su zona', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () =>
      ({ left: 59, right: 1221, top: 0, bottom: 800, width: 1162, height: 800 });

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(30000);

    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    expect(window.__LF_track).not.toHaveBeenCalledWith('aecc-banner-mostrado', expect.anything());
  });

  // Revision de ChatGPT (21/11/2026): los 8 reintentos se agotaban en ~10 s y, si despues el usuario
  // llegaba a un sitio libre dentro de la ventana del calculo, el banner ya no aparecia.
  it('sigue reintentando mientras dure la ventana del calculo y aparece al quedar libre', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    let seccionRect = { left: 59, right: 1221, top: 0, bottom: 800, width: 1162, height: 800 };
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () => seccionRect;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(20000); // mas que 2,8 s + 8 x 0,9 s
    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);

    // El usuario baja hasta el final del ranking: la tarjeta queda por encima de la zona del banner
    seccionRect = { left: 59, right: 1221, top: -900, bottom: 300, width: 1162, height: 1200 };
    vi.advanceTimersByTime(900);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
    // (Sin contar llamadas: cada test recarga el script y los oyentes de los anteriores siguen en document.)
    expect(window.__LF_track).toHaveBeenCalledWith('aecc-banner-mostrado', { title: 'origen:home' });
  });

  it('tampoco tapa las preguntas plegables ni el pie al llegar al final de la pagina', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const fuera = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    let footerRect = { left: 60, right: 1860, top: 1400, bottom: 1900, width: 1800, height: 500 };
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <section class="seoFold" id="info"></section>
      <footer class="footer-container"></footer>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    // Dos columnas: el ranking a la derecha del formulario
    document.getElementById('seccionResultados').getBoundingClientRect = () =>
      ({ left: 545, right: 1860, top: 0, bottom: 1000, width: 1315, height: 1000 });
    document.getElementById('info').getBoundingClientRect = () => fuera;
    document.querySelector('footer').getBoundingClientRect = () => footerRect;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(2800);
    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);

    // Final de la pagina: el pie sube hasta la zona del banner
    footerRect = { left: 60, right: 1860, top: 600, bottom: 1100, width: 1800, height: 500 };
    document.body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(0);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toBeNull();
  });

  // Revision de ChatGPT (21/11/2026): con cambios pendientes, una reevaluacion (scroll o un
  // results-ready no vigente) podia volver a mostrarlo sobre un ranking que ya no es el del usuario.
  it('no reaparece con cambios pendientes aunque su zona quede libre', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const libre = { left: 545, right: 1420, top: 0, bottom: 800, width: 875, height: 800 };
    let seccionRect = libre;
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () => seccionRect;
    window.LF = { state: { pending: false } };
    try {
      loadAeccBanner();
      document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
      document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
      vi.advanceTimersByTime(2800);
      const banner = document.getElementById('aecc-banner');
      expect(banner.classList.contains('aecc-banner--visible')).toBe(true);

      // Se aparta por geometria y el usuario cambia datos
      seccionRect = { left: 59, right: 1381, top: 0, bottom: 800, width: 1322, height: 800 };
      document.body.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(0);
      expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
      window.LF.state.pending = true;

      // La zona queda libre: ni el scroll ni un results-ready no vigente lo vuelven a mostrar
      seccionRect = libre;
      document.body.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(0);
      document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1, vigente: false } }));
      vi.advanceTimersByTime(0);
      expect(banner.classList.contains('aecc-banner--visible')).toBe(false);

      // Con un ranking vigente de nuevo, vuelve
      window.LF.state.pending = false;
      document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
      vi.advanceTimersByTime(0);
      expect(banner.classList.contains('aecc-banner--visible')).toBe(true);
    } finally {
      delete window.LF;
    }
  });

  // Revision de ChatGPT de 897c05c: `pending` se marca al teclear, pero el banner solo escuchaba
  // `change` (al perder el foco) y seguia visible mientras se editaba.
  it('se aparta en cuanto se teclea en un campo, sin esperar a perder el foco', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    document.body.innerHTML = `
      <input id="p2">
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () =>
      ({ left: 545, right: 1420, top: 0, bottom: 800, width: 875, height: 800 });
    window.LF = { state: { pending: false } };
    try {
      loadAeccBanner();
      document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
      document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
      vi.advanceTimersByTime(2800);
      const banner = document.getElementById('aecc-banner');
      expect(banner.classList.contains('aecc-banner--visible')).toBe(true);

      // Como lf-app.js: la tecla marca pending en el acto; no hay change ni scroll.
      window.LF.state.pending = true;
      document.getElementById('p2').dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(0);
      expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
      expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toBeNull();
    } finally {
      delete window.LF;
    }
  });

  it('pasada la ventana del calculo deja de reintentar', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    let seccionRect = { left: 59, right: 1221, top: 0, bottom: 800, width: 1162, height: 800 };
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () => seccionRect;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(3 * 60 * 1000);
    seccionRect = { left: 59, right: 1221, top: -900, bottom: 300, width: 1162, height: 1200 };
    vi.advanceTimersByTime(10000);
    expect(document.getElementById('aecc-banner').classList.contains('aecc-banner--visible')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reevalua su zona cuando llega un ranking nuevo sin scroll ni resize', () => {
    window.IntersectionObserver = function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    };
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    // Visible: la tarjeta termina por encima de la zona del banner
    let seccionRect = { left: 59, right: 1381, top: -900, bottom: 300, width: 1322, height: 1200 };
    document.body.innerHTML = `
      <button id="btnCalc"></button>
      <section id="seccionResultados" class="visible"></section>
      <table><tbody id="tbody"><tr><td>Tarifa</td></tr></tbody></table>
    `;
    document.getElementById('seccionResultados').getBoundingClientRect = () => seccionRect;

    loadAeccBanner();
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(2800);
    const banner = document.getElementById('aecc-banner');
    expect(banner.classList.contains('aecc-banner--visible')).toBe(true);

    // Un ranking nuevo alarga la tarjeta hasta la zona del banner, sin scroll ni resize
    seccionRect = { left: 59, right: 1381, top: -900, bottom: 800, width: 1322, height: 1700 };
    document.dispatchEvent(new CustomEvent('lf:results-requested', { detail: { origin: 'home' } }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', { detail: { origin: 'home', rows: 1 } }));
    vi.advanceTimersByTime(0);
    expect(banner.classList.contains('aecc-banner--visible')).toBe(false);
    expect(localStorage.getItem('lf_aecc_banner_dismissed_at')).toBeNull();
  });

});
