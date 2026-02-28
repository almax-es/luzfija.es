import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const configCode = fs.readFileSync(path.resolve(__dirname, '../js/config.js'), 'utf8');

function bootstrapConfig() {
  const fn = new Function(configCode);
  fn();
}

function dispatchUnhandledRejection(reason) {
  const evt = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(evt, 'reason', {
    value: reason,
    configurable: true
  });
  window.dispatchEvent(evt);
  return evt;
}

beforeEach(() => {
  try { delete window.goatcounter; } catch (_) {}
  delete window.currentYear;
  delete window.__LF_LEGACY_CURRENTYEAR_FILTER_CONFIG;
  delete window.__LF_LEGACY_GOAT_GUARD_CONFIG;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Config legacy rejection filter', () => {
  it('define currentYear y bloquea ruido legacy', () => {
    bootstrapConfig();

    const tailListener = vi.fn();
    window.addEventListener('unhandledrejection', tailListener);

    const evt = dispatchUnhandledRejection('Promise reject: currentYear is not defined event');

    expect(typeof window.currentYear).toBe('number');
    expect(tailListener).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(true);
  });

  it('no bloquea rechazos no relacionados', () => {
    bootstrapConfig();

    const tailListener = vi.fn();
    window.addEventListener('unhandledrejection', tailListener);

    const evt = dispatchUnhandledRejection('Promise reject: network failed');

    expect(tailListener).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(false);
  });

  it('reclasifica ruido legacy en goatcounter.count cuando ya existe goatcounter', () => {
    const rawCount = vi.fn();
    window.goatcounter = { count: rawCount };

    bootstrapConfig();

    window.goatcounter.count({
      path: 'error-promise',
      title: 'Promise reject: currentYear is not defined event'
    });
    window.goatcounter.count({
      path: 'error-javascript',
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    expect(rawCount).toHaveBeenCalledTimes(2);
    expect(rawCount).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:currentyear-stale')
      })
    );
    expect(rawCount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:index-extra-compat')
      })
    );
  });

  it('reclasifica variantes legacy con path normalizable', () => {
    const rawCount = vi.fn();
    window.goatcounter = { count: rawCount };

    bootstrapConfig();

    window.goatcounter.count({
      path: '/error-promise/?from=old',
      title: 'currentYear is undefined'
    });

    expect(rawCount).toHaveBeenCalledTimes(1);
    expect(rawCount).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:currentyear-stale')
      })
    );
  });

  it('reclasifica ruido legacy en goatcounter.count cuando goatcounter se asigna después', () => {
    bootstrapConfig();

    const rawCount = vi.fn();
    window.goatcounter = { count: rawCount };
    window.goatcounter.count({
      path: 'error-javascript',
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    expect(rawCount).toHaveBeenCalledTimes(1);
    expect(rawCount).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:index-extra-compat')
      })
    );
  });

  it('permite eventos normales en goatcounter.count', () => {
    const rawCount = vi.fn();
    window.goatcounter = { count: rawCount };

    bootstrapConfig();

    const payload = {
      path: 'calculo-realizado',
      title: 'Usuario calculó tarifas',
      event: true
    };
    window.goatcounter.count(payload);

    expect(rawCount).toHaveBeenCalledTimes(1);
    expect(rawCount).toHaveBeenCalledWith(payload);
  });

  it('no reclasifica payloads con menciones parciales de currentYear', () => {
    const rawCount = vi.fn();
    window.goatcounter = { count: rawCount };

    bootstrapConfig();

    const payload = {
      path: 'error-javascript',
      title: 'currentYear helper inicializado correctamente',
      event: true
    };
    window.goatcounter.count(payload);

    expect(rawCount).toHaveBeenCalledTimes(1);
    expect(rawCount).toHaveBeenCalledWith(payload);
  });
});
