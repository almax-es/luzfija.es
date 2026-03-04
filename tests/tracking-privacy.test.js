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

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();

  delete window.goatcounter;
  delete window.__LF_track;
  delete window.__LF_PRIVACY_MODE;
});

afterEach(() => {
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

  it('bloquea eventos cuando __LF_PRIVACY_MODE está activo', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    bootstrapTracking();

    expect(typeof window.__LF_track).toBe('function');
    window.__LF_PRIVACY_MODE = true;
    window.__LF_track('evento-privado', { title: 'No debería enviarse' });

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
});
