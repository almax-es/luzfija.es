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

  it('ignora ruido legado del loader index-extra', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });

  it('ignora ruido legado de index-extra aunque el eventName no sea error-javascript', () => {
    bootstrapTracking();

    window.__LF_track('custom-event', {
      title: 'Compat: index-extra omitido (sin soporte ES2020) event'
    });

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });

  it('ignora ruido stale-cache de promesas con formato legacy', () => {
    bootstrapTracking();

    dispatchUnhandledRejection('Promise reject: currentYear is not defined event');

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });

  it('ignora ruido stale-cache aunque llegue con otro eventName', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Promise reject: currentYear is not defined event'
    });

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });

  it('ignora ruido stale-cache cuando reason es objeto con message', () => {
    bootstrapTracking();

    dispatchUnhandledRejection({ message: 'currentYear is not defined' });

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });
});
