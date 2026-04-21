import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const GuideSearch = require('../js/guides-search.js');

let payload;
let preparedGuides;

beforeAll(() => {
  const indexPath = path.join(__dirname, '..', 'data', 'guides-search-index.json');
  payload = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  preparedGuides = GuideSearch.prepareGuidesIndex(payload.guides);
});

describe('guides search index', () => {
  it('normalizes accents and punctuation', () => {
    expect(GuideSearch.normalizeText('Compañía, período y batería virtual')).toBe('compania periodo y bateria virtual');
  });

  it('includes all public guide documents in the generated index', () => {
    expect(payload.totalGuides).toBe(23);
    expect(payload.guides.some((guide) => guide.path === '/guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html')).toBe(true);
  });

  it('finds guides by FAQ terms that are not visible in the card summary', () => {
    const results = GuideSearch.searchGuides(preparedGuides, 'propietario');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.path).toBe('/guias/mudanza-y-alquiler-cambio-de-titular-alta-baja-y-cosas-que-nadie-te-dice.html');
    expect(results[0].primaryMatch.label).toBe('FAQ');
  });

  it('matches common morphological variants such as reclamacion vs reclamar', () => {
    const results = GuideSearch.searchGuides(preparedGuides, 'reclamacion');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.path).toBe('/guias/como-reclamar-a-comercializadora-distribuidora.html');
  });
});
