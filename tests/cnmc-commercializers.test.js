import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const registry = JSON.parse(fs.readFileSync('data/cnmc-commercializers.json', 'utf8'));

describe('Censo local de comercializadoras CNMC', () => {
  it('mantiene un censo amplio, saneado y sin datos de clientes', () => {
    const entries = Object.entries(registry.commercializers || {});
    expect(registry._meta?.schema).toBe(1);
    expect(registry._meta?.source).toBe('https://sede.cnmc.gob.es/listado/censo/2');
    expect(entries.length).toBeGreaterThan(500);

    for (const [code, entry] of entries) {
      expect(code).toMatch(/^R2-\d{3}$/);
      expect(entry.name).toEqual(expect.any(String));
      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(['name'])
      );
      expect(Object.keys(entry).every(key => ['name', 'phone', 'website'].includes(key))).toBe(true);
      if (entry.website) expect(entry.website).toMatch(/^https?:\/\//);
    }
  });

  it('resuelve el código R2 declarado en las facturas Bonpreu reales', () => {
    expect(registry.commercializers['R2-796']).toMatchObject({
      name: 'BON PREU, SAU',
      phone: '900 500 005'
    });
  });
});
