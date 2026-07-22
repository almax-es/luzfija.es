import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const trackingCode = fs.readFileSync(path.resolve(__dirname, '../js/tracking.js'), 'utf8');
const lfAppCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');
const bvUiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const goatCounterCode = fs.readFileSync(path.resolve(__dirname, '../vendor/goatcounter/count.js'), 'utf8');

function bootstrapTracking() {
  const fn = new Function(trackingCode);
  fn();
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();

  delete window.goatcounter;
  delete window.__LF_track;
  delete window.__LF_PRIVACY_MODE;
  delete window.__LF_FACTURA_BUSY;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Tracking privacy behavior', () => {
  it('no inicializa tracking cuando existe opt-out', () => {
    localStorage.setItem('goatcounter_optout', 'true');
    const appendSpy = vi.spyOn(document.head, 'appendChild');

    bootstrapTracking();

    expect(window.__LF_track).toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('preserva el opt-out de analítica al limpiar caché local', () => {
    for (const code of [lfAppCode, bvUiCode]) {
      expect(code).toMatch(/getItem\('goatcounter_optout'\)/);
      expect(code).toMatch(/setItem\('goatcounter_optout', 'true'\)/);
      expect(code).toMatch(/getItem\('lf_aecc_banner_dismissed_at'\)/);
      expect(code).toMatch(/setItem\('lf_aecc_banner_dismissed_at'/);
    }
  });

  it('bloquea eventos cuando __LF_PRIVACY_MODE está activo', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    bootstrapTracking();

    expect(typeof window.__LF_track).toBe('function');
    window.__LF_PRIVACY_MODE = true;
    window.__LF_track('evento-privado', { title: 'No debería enviarse' });

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('bloquea eventos cuando la extracción de factura está ocupada', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    bootstrapTracking();

    expect(typeof window.__LF_track).toBe('function');
    window.__LF_FACTURA_BUSY = true;
    window.__LF_track('evento-factura', { title: 'No debería enviarse' });

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('carga GoatCounter bajo demanda y vacía cola al terminar de cargar', async () => {
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    window.__LF_track('evento-cola', { title: 'Evento en cola' });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const injectedScript = appendSpy.mock.calls[0][0];
    expect(injectedScript.tagName).toBe('SCRIPT');
    expect(injectedScript.src).toContain('/vendor/goatcounter/count.js?v=');

    window.goatcounter = { count: vi.fn() };
    injectedScript.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'evento-cola',
        title: 'Evento en cola',
        event: true
      })
    );
  });

  it('reutiliza script existente de GoatCounter aunque no lleve query de versión', async () => {
    const existing = document.createElement('script');
    existing.src = '/vendor/goatcounter/count.js';
    document.head.appendChild(existing);

    const appendSpy = vi.spyOn(document.head, 'appendChild');

    bootstrapTracking();
    window.__LF_track('evento-reutilizado', { title: 'Reutiliza sender existente' });

    expect(appendSpy).not.toHaveBeenCalled();

    window.goatcounter = { count: vi.fn() };
    existing.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'evento-reutilizado',
        title: 'Reutiliza sender existente',
        event: true
      })
    );
  });

  it('retira un sender fallido, reintenta y conserva la cola ante un fallo transitorio', async () => {
    vi.useFakeTimers();
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    window.__LF_track('evento-reintento', { title: 'Debe sobrevivir al primer fallo' });

    const firstScript = appendSpy.mock.calls[0][0];
    firstScript.dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();
    expect(firstScript.isConnected).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    const secondScript = appendSpy.mock.calls[1][0];
    expect(secondScript).toBeTruthy();
    expect(secondScript).not.toBe(firstScript);

    window.goatcounter = { count: vi.fn() };
    secondScript.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'evento-reintento' })
    );
  });

  it('respeta el backoff y no supera tres cargas hasta que vuelva la conexión', async () => {
    vi.useFakeTimers();
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    window.__LF_track('evento-uno');
    appendSpy.mock.calls[0][0].dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();

    window.__LF_track('evento-durante-backoff');
    expect(appendSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    appendSpy.mock.calls[1][0].dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20000);
    appendSpy.mock.calls[2][0].dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();

    window.__LF_track('evento-tras-agotar-intentos');
    await Promise.resolve();
    expect(appendSpy).toHaveBeenCalledTimes(3);
  });

  it('si GoatCounter ya está listo, envía sin inyectar script', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    window.goatcounter = { count: vi.fn() };

    bootstrapTracking();
    window.__LF_track('evento-directo', { title: 'Directo' });

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'evento-directo',
        title: 'Directo',
        event: true
      })
    );
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('el count.js local no envía query completa con configuraciones o búsquedas', () => {
    expect(goatCounterCode).toContain('safe_query()');
    expect(goatCounterCode).not.toContain('q: location.search');
  });
});
