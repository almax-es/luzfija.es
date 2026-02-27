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

function dispatchUnhandledRejection(reason) {
  const evt = new Event('unhandledrejection');
  Object.defineProperty(evt, 'reason', {
    value: reason,
    configurable: true
  });
  window.dispatchEvent(evt);
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();

  window.goatcounter = { count: vi.fn() };
  delete window.__LF_track;
  delete window.__LF_PRIVACY_MODE;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tracking error filtering and dedupe', () => {
  it('ignora errores sin origen fiable (filename vacío)', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '',
      lineno: 0,
      colno: 0
    });
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });

  it('trackea errores de scripts first-party', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '/js/index-extra.js',
      lineno: 101,
      colno: 23
    });
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript',
        event: true
      })
    );
  });

  it('deduplica el mismo error en la misma sesión', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '/js/index-extra.js',
      lineno: 101,
      colno: 23
    });
    window.dispatchEvent(evt);
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
  });

  it('trackea error de carga en <script src> first-party aunque filename venga vacío', () => {
    bootstrapTracking();

    const script = document.createElement('script');
    script.src = '/js/pvpc.js';
    document.head.appendChild(script);
    script.dispatchEvent(new Event('error'));

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript',
        event: true,
        title: expect.stringContaining('/js/pvpc.js:0')
      })
    );
  });

  it('reclasifica ruido legado del loader index-extra', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:index-extra-compat')
      })
    );
  });

  it('reclasifica ruido legacy de index-extra aunque el eventName no sea error-javascript', () => {
    bootstrapTracking();

    window.__LF_track('custom-event', {
      title: 'Compat: index-extra omitido (sin soporte ES2020) event'
    });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:index-extra-compat')
      })
    );
  });

  it('reclasifica ruido stale-cache de promesas con formato legacy', () => {
    bootstrapTracking();

    dispatchUnhandledRejection('Promise reject: currentYear is not defined event');

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((payload) =>
      payload &&
      payload.path === 'error-legacy-filtrado' &&
      payload.event === true &&
      String(payload.title || '').includes('tipo:currentyear-stale')
    )).toBe(true);
  });

  it('reclasifica ruido stale-cache aunque llegue con otro eventName', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Promise reject: currentYear is not defined event'
    });

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((payload) =>
      payload &&
      payload.path === 'error-legacy-filtrado' &&
      payload.event === true &&
      String(payload.title || '').includes('tipo:currentyear-stale')
    )).toBe(true);
  });

  it('reclasifica ruido stale-cache cuando reason es objeto con message', () => {
    bootstrapTracking();

    dispatchUnhandledRejection({ message: 'currentYear is not defined' });

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((payload) =>
      payload &&
      payload.path === 'error-legacy-filtrado' &&
      payload.event === true &&
      String(payload.title || '').includes('tipo:currentyear-stale')
    )).toBe(true);
  });

  it('no reclasifica mensajes parecidos sin firma legacy', () => {
    bootstrapTracking();

    const title = 'currentYear helper inicializado correctamente';
    window.__LF_track('error-javascript', { title });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript',
        event: true,
        title
      })
    );
  });

  it('no duplica evento al reclasificar desde trackEvent directo', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    const legacyCalls = calls.filter((payload) => payload && payload.path === 'error-legacy-filtrado');
    const jsErrorCalls = calls.filter((payload) => payload && payload.path === 'error-javascript');

    expect(legacyCalls.length).toBe(1);
    expect(jsErrorCalls.length).toBe(0);
  });
});
