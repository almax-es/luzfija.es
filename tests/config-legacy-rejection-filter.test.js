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
  delete window.currentYear;
  delete window.__LF_LEGACY_CURRENTYEAR_FILTER_CONFIG;
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
});
