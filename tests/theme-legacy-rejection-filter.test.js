import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const themeCode = fs.readFileSync(path.resolve(__dirname, '../js/theme.js'), 'utf8');

function bootstrapTheme() {
  const fn = new Function(themeCode);
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
  document.documentElement.className = '';
  localStorage.clear();

  delete window.__LF_LEGACY_CURRENTYEAR_FILTER;
  delete window.__ALMAX_THEME_KEY;
  delete window.__ALMAX_THEME_SAVED;
  delete window.currentYear;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Theme legacy rejection filter', () => {
  it('bloquea ruido legacy de currentYear antes de listeners posteriores', () => {
    bootstrapTheme();

    const tailListener = vi.fn();
    window.addEventListener('unhandledrejection', tailListener);

    const evt = dispatchUnhandledRejection('Promise reject: currentYear is not defined event');

    expect(tailListener).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(true);
  });

  it('no bloquea rechazos de promesa no relacionados', () => {
    bootstrapTheme();

    const tailListener = vi.fn();
    window.addEventListener('unhandledrejection', tailListener);

    const evt = dispatchUnhandledRejection('Promise reject: something else failed');

    expect(tailListener).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(false);
  });
});
