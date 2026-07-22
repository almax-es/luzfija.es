import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const bootstrapCode = fs.readFileSync(path.resolve(__dirname, '../js/error-bootstrap.js'), 'utf8');
const trackingCode = fs.readFileSync(path.resolve(__dirname, '../js/tracking.js'), 'utf8');

describe('Early first-party error bootstrap', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.__LF_EARLY_ERROR_BOOTSTRAP;
    delete window.__LF_EARLY_ERRORS;
    delete window.__LF_TRACKING_ERROR_READY;
    delete window.__LF_track;
    window.goatcounter = { count: vi.fn() };
  });

  it('entrega a tracking los fallos ocurridos antes de que tracking.js cargue', () => {
    new Function(bootstrapCode)();

    const script = document.createElement('script');
    script.src = '/js/theme.js?v=build';
    document.head.appendChild(script);
    script.dispatchEvent(new Event('error'));
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'mensaje que el buffer no debe conservar',
      filename: '/js/config.js',
      lineno: 17,
      colno: 4
    }));

    expect(window.__LF_EARLY_ERRORS).toHaveLength(2);
    expect(JSON.stringify(window.__LF_EARLY_ERRORS)).not.toContain('mensaje que');

    new Function(trackingCode)();

    const payloads = window.goatcounter.count.mock.calls.map((call) => call[0]);
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'error-script-load/theme/0/desconocido' }),
      expect.objectContaining({ path: 'error-javascript/config/17/desconocido' })
    ]));
    expect(window.__LF_EARLY_ERRORS).toHaveLength(0);
    expect(window.__LF_TRACKING_ERROR_READY).toBe(true);
  });
});
