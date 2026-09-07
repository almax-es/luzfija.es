import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const aliases = ['simulador-bateria-virtual.html', 'simulador/index.html'];
const destination = '/comparador-tarifas-solares.html';

describe('rutas historicas del simulador solar', () => {
  for (const relative of aliases) {
    it(`${relative} redirige sin generar un pageview duplicado`, () => {
      const html = fs.readFileSync(path.join(root, relative), 'utf8');
      expect(html).toMatch(/name="robots" content="noindex, follow"/i);
      expect(html).toContain(`content="0; url=${destination}"`);
      expect(html).toContain(`href="https://luzfija.es${destination}"`);
      expect(html).toContain(`href="${destination}"`);
      expect(html).not.toContain('js/tracking.js');
    });
  }
});
