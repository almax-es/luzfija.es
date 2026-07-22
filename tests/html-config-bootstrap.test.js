import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PAGES = [
  '404.html',
  'aviso-legal.html',
  'calcular-factura-luz.html',
  'comparador-tarifas-solares.html',
  'comparar-pvpc-tarifa-fija.html',
  'estadisticas/index.html',
  'guias.html',
  'index.html',
  'privacidad.html'
];

const TRACKED_PAGES = [
  'index.html',
  'calcular-factura-luz.html',
  'estadisticas/index.html'
];

const APP_PAGES = [
  'index.html',
  'comparador-tarifas-solares.html',
  'estadisticas/index.html'
];

describe('HTML bootstrap order', () => {
  it('carga config.js antes de theme.js en las entradas principales', () => {
    for (const page of PAGES) {
      const html = fs.readFileSync(path.resolve(__dirname, '..', page), 'utf8');
      const configPos = html.indexOf('/js/config.js?v=');
      const themePos = html.indexOf('/js/theme.js?v=');

      expect(configPos, page + ' should include config.js').toBeGreaterThanOrEqual(0);
      expect(themePos, page + ' should include theme.js').toBeGreaterThanOrEqual(0);
      expect(configPos, page + ' should load config.js before theme.js').toBeLessThan(themePos);
    }
  });

  it('inyecta el guard inline de currentYear antes de config.js en las paginas con tracking', () => {
    for (const page of TRACKED_PAGES) {
      const html = fs.readFileSync(path.resolve(__dirname, '..', page), 'utf8');
      const inlinePos = html.indexOf('__LF_INLINE_LEGACY_CURRENTYEAR_FILTER');
      const configPos = html.indexOf('/js/config.js?v=');

      expect(inlinePos, page + ' should include inline legacy currentYear guard').toBeGreaterThanOrEqual(0);
      expect(configPos, page + ' should include config.js').toBeGreaterThanOrEqual(0);
      expect(inlinePos, page + ' should place inline guard before config.js').toBeLessThan(configPos);
    }
  });

  it('instala el buffer de errores first-party antes de config.js en las aplicaciones', () => {
    for (const page of APP_PAGES) {
      const html = fs.readFileSync(path.resolve(__dirname, '..', page), 'utf8');
      const bufferPos = html.indexOf('/js/error-bootstrap.js?v=');
      const configPos = html.indexOf('/js/config.js?v=');

      expect(bufferPos, page + ' should include error-bootstrap.js').toBeGreaterThanOrEqual(0);
      expect(bufferPos, page + ' should load error-bootstrap.js before config.js').toBeLessThan(configPos);
    }
  });
});
