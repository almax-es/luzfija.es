import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const loaderCode = fs.readFileSync(path.resolve(__dirname, '../js/index-extra-loader.js'), 'utf8');

function bootstrapLoader() {
  const fn = new Function(loaderCode);
  fn();
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  delete window.__LF_BUILD_ID;
  delete window.__LF_indexExtraLoading;
  delete window.__LF_indexExtraLoaded;
  window.__LF_track = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Legacy index-extra loader shim', () => {
  it('inyecta index-extra con el build actual sin emitir tracking legacy', () => {
    window.__LF_BUILD_ID = 'shim-build';

    bootstrapLoader();

    const script = document.querySelector('script[src]');
    expect(script).not.toBeNull();
    expect(script.getAttribute('src')).toBe('js/index-extra.js?v=shim-build');
    expect(window.__LF_track).not.toHaveBeenCalled();

    script.dispatchEvent(new Event('error'));
    expect(window.__LF_track).not.toHaveBeenCalled();
    expect(window.__LF_indexExtraLoading).toBe(false);
  });

  it('no duplica la carga si index-extra ya existe en el DOM', () => {
    const existing = document.createElement('script');
    existing.src = 'js/index-extra.js?v=already-there';
    document.head.appendChild(existing);

    bootstrapLoader();

    expect(document.querySelectorAll('script[src]').length).toBe(1);
    expect(document.querySelector('script[src]').getAttribute('src')).toBe('js/index-extra.js?v=already-there');
  });

  it('marca index-extra como cargado cuando el script completa', () => {
    bootstrapLoader();

    const script = document.querySelector('script[src]');
    expect(window.__LF_indexExtraLoading).toBe(true);

    script.dispatchEvent(new Event('load'));

    expect(window.__LF_indexExtraLoaded).toBe(true);
    expect(window.__LF_indexExtraLoading).toBe(false);
  });
});
