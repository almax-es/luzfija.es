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

function goatScriptAppended() {
  const scripts = document.head.querySelectorAll('script[src]');
  for (const s of scripts) {
    if ((s.getAttribute('src') || '').includes('goatcounter/count.js')) return true;
  }
  return false;
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

describe('GoatCounter eager page view on DOMContentLoaded', () => {
  it('inyecta count.js al disparar DOMContentLoaded', () => {
    bootstrapTracking();
    fireDOMContentLoaded();
    expect(goatScriptAppended()).toBe(true);
  });

  it('no inyecta count.js si el usuario tiene opt-out', () => {
    localStorage.setItem('goatcounter_optout', 'true');
    bootstrapTracking();
    fireDOMContentLoaded();
    expect(goatScriptAppended()).toBe(false);
  });

  it('no duplica count.js si ya estaba cargado', () => {
    bootstrapTracking();
    fireDOMContentLoaded();
    fireDOMContentLoaded();
    const scripts = Array.from(document.head.querySelectorAll('script[src]'))
      .filter(s => (s.getAttribute('src') || '').includes('goatcounter/count.js'));
    expect(scripts.length).toBe(1);
  });
});
