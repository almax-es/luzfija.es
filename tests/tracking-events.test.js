import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const trackingCode = fs.readFileSync(path.resolve(__dirname, '../js/tracking.js'), 'utf8');

function bootstrapTracking() {
  const fn = new Function(trackingCode);
  fn();
}

function fireDOMContentLoaded() {
  window.dispatchEvent(new Event('DOMContentLoaded'));
}

function click(node) {
  node.addEventListener('click', (event) => event.preventDefault(), { once: true });
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  window.goatcounter = { count: vi.fn() };
  delete window.__LF_track;
  delete window.__LF_trackDetail;
  delete window.__LF_trackingUtils;
  delete window.__LF_PRIVACY_MODE;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tracking event taxonomy', () => {
  it('expone eventos con segmentos normalizados y cuenta clicks repetidos', () => {
    bootstrapTracking();

    window.__LF_trackDetail('tarifa-click-contratar', ['home', 'Energya VM'], {
      title: 'Click en contratar: Energya VM'
    });

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'tarifa-click-contratar/home/energya-vm',
        title: 'Click en contratar: Energya VM',
        event: true,
        no_session: true
      })
    );
  });

  it('sanea el title de todo evento: CUPS, email, URL y números largos enmascarados', () => {
    bootstrapTracking();

    window.__LF_trackDetail('csv-import-error', ['home', 'csv', 'otro'], {
      title: 'Error ES0021000000000000AB contacto hola@luzfija.es en https://ejemplo.com/x?a=1 tel 612345678'
    });

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'csv-import-error/home/csv/otro',
        title: 'Error [cups] contacto [email] en [url] tel [num]',
        event: true,
        no_session: true
      })
    );
  });

  it('desglosa los clicks de contratación por origen y tarifa', () => {
    document.body.innerHTML = `
      <table><tbody id="tbody">
        <tr data-tarifa-nombre="Energya VM">
          <td><span class="tarifa-nombre">Energya VM</span></td>
          <td><a class="web" href="https://example.com">Ver oferta</a></td>
        </tr>
      </tbody></table>
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    click(document.querySelector('a.web'));

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'tarifa-click-contratar/home/energya-vm',
        title: expect.stringContaining('Energya VM'),
        event: true
      })
    );
  });

  it('desglosa clicks a guías por guía destino', () => {
    document.body.innerHTML = `
      <a id="guide" href="/guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html">Cómo leer factura</a>
      <a id="index" href="/guias.html">Guías</a>
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    click(document.getElementById('guide'));
    click(document.getElementById('index'));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('guia-click/como-leer-tu-factura-de-la-luz-paso-a-paso');
    expect(paths).toContain('navegacion-guias/indice');
  });

  it('usa los eventos internos de resultados para home y solar', () => {
    bootstrapTracking();
    fireDOMContentLoaded();

    document.dispatchEvent(new CustomEvent('lf:results-requested', {
      detail: { origin: 'solar' }
    }));
    document.dispatchEvent(new CustomEvent('lf:results-ready', {
      detail: { origin: 'solar', rows: 12 }
    }));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('calculo-realizado/solar');
    expect(paths).toContain('calculo-resultados/solar');
  });

  it('desglosa opciones relevantes del comparador sin enviar valores de consumo', () => {
    document.body.innerHTML = `
      <input id="solarOn" type="checkbox">
      <input id="bonoSocialOn" type="checkbox">
      <input id="compararMiTarifa" type="checkbox">
      <select id="zonaFiscal"><option value="Canarias" selected>Canarias</option></select>
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    document.getElementById('solarOn').checked = true;
    document.getElementById('solarOn').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('bonoSocialOn').checked = true;
    document.getElementById('bonoSocialOn').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('compararMiTarifa').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('zonaFiscal').dispatchEvent(new Event('change', { bubbles: true }));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('comparador-opcion/solar/activado');
    expect(paths).toContain('comparador-opcion/bono-social/activado');
    expect(paths).toContain('comparador-opcion/mi-tarifa/activado');
    expect(paths).toContain('comparador-zona-fiscal/canarias');
  });

  it('reduce el límite del bono social a una categoría cerrada sin enviar kWh', () => {
    document.body.innerHTML = `
      <input id="bonoSocialLimite1587" name="bonoSocialLimite" type="radio" value="1587">
      <input id="bonoSocialLimite2222" name="bonoSocialLimite" type="radio" value="2222">
      <input id="bonoSocialLimite2698" name="bonoSocialLimite" type="radio" value="2698">
      <input id="bonoSocialLimite4761" name="bonoSocialLimite" type="radio" value="4761">
      <input id="bonoSocialLimiteInesperado" name="bonoSocialLimite" type="radio" value="9999">
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    document.querySelectorAll('[name="bonoSocialLimite"]').forEach((input) => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const payloads = window.goatcounter.count.mock.calls.map((call) => call[0]);
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'comparador-bono-social-limite/nivel-1' }),
      expect.objectContaining({ path: 'comparador-bono-social-limite/nivel-2' }),
      expect.objectContaining({ path: 'comparador-bono-social-limite/nivel-3' }),
      expect.objectContaining({
        path: 'comparador-bono-social-limite/nivel-4',
        title: 'Bono social límite: nivel-4'
      }),
      expect.objectContaining({
        path: 'comparador-bono-social-limite/desconocido',
        title: 'Bono social límite: desconocido'
      })
    ]));
    expect(payloads.some((payload) => /1587|2222|2698|4761|9999/.test(`${payload.path} ${payload.title}`))).toBe(false);
  });

  it('trackea el mes inicial solar sin enviar el año del periodo importado', () => {
    document.body.innerHTML = `
      <ul id="bv-mes-inicio-list">
        <li class="bv-cs-item" data-value="2025-01">Enero</li>
        <li class="bv-cs-item" data-value="2026-12">Diciembre</li>
        <li class="bv-cs-item" data-value="">Orden de la tabla (por defecto)</li>
        <li class="bv-cs-item" data-value="valor-inesperado">Otro</li>
      </ul>
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    click(document.querySelector('[data-value="2025-01"]'));
    click(document.querySelector('[data-value="2026-12"]'));
    click(document.querySelector('[data-value=""]'));
    click(document.querySelector('[data-value="valor-inesperado"]'));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('simulador-solar-mes-inicio/1');
    expect(paths).toContain('simulador-solar-mes-inicio/12');
    expect(paths).toContain('simulador-solar-mes-inicio/orden-tabla');
    expect(paths).toContain('simulador-solar-mes-inicio/desconocido');
    expect(paths.some((path) => String(path).includes('2025-01'))).toBe(false);
  });

  it('trackea desgloses por tarifa y evita el modal privado de factura', () => {
    document.body.innerHTML = `
      <table><tbody id="tbody">
        <tr data-tarifa-nombre="Energya VM">
          <td class="tarifa-cell">Energya VM</td>
          <td class="total-cell">42 €</td>
        </tr>
      </tbody></table>
      <a id="email" href="mailto:hola@luzfija.es">Email</a>
      <div id="modalFactura">
        <a id="private-email" href="mailto:hola@luzfija.es">Email factura</a>
      </div>
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    click(document.querySelector('.total-cell'));
    click(document.getElementById('email'));
    const countBeforePrivateModal = window.goatcounter.count.mock.calls.length;
    click(document.getElementById('private-email'));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('desglose-abierto/home/energya-vm');
    expect(paths).toContain('enlace-externo/home/email');
    expect(window.goatcounter.count.mock.calls.length).toBe(countBeforePrivateModal);
  });

  it('trackea compartir guía sin confundir enlaces hash con clicks a guía', () => {
    window.history.replaceState({}, '', '/guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html');
    document.body.innerHTML = `
      <a id="toc" href="#faq">FAQ</a>
      <a id="share" href="#" class="share-btn" onclick="return false">WhatsApp</a>
    `;

    bootstrapTracking();
    fireDOMContentLoaded();
    click(document.getElementById('toc'));
    click(document.getElementById('share'));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('guia-compartida/como-leer-tu-factura-de-la-luz-paso-a-paso/whatsapp');
    expect(paths.some((path) => String(path).startsWith('guia-click/'))).toBe(false);
  });
});
