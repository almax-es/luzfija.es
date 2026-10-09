import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCensusSane,
  parseCnmcCommercializers,
  syncCnmcCommercializers
} from '../scripts/sync-cnmc-commercializers.mjs';

const registry = JSON.parse(fs.readFileSync('data/cnmc-commercializers.json', 'utf8'));

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Replica la tabla de la sede con el censo publicado y en el orden en que la sirve
// la CNMC (orden de cadena: R2-1000 va entre R2-100 y R2-101 y la tabla acaba en R2-999).
function registryHtml({ codes = Object.keys(registry.commercializers).sort(), extraRows = '' } = {}) {
  const rows = codes.map(code => {
    const entry = registry.commercializers[code];
    const web = entry.website ? `<a href="${escapeHtml(entry.website)}">${escapeHtml(entry.website)}</a>` : '';
    return `<tr><td>${code}</td><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.phone || '')}</td><td>${web}</td><td></td></tr>`;
  }).join('\n');
  return `<table><thead><tr>
    <th>Nº de orden</th><th>Nombre empresa</th><th>Teléfono Att cliente gratuito</th>
    <th>Página web</th><th>Estado</th>
  </tr></thead><tbody>${rows}${extraRows}</tbody></table>`;
}

function syncFrom(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnmc-sync-'));
  const output = path.join(dir, 'cnmc.json');
  const run = syncCnmcCommercializers({
    fetchImpl: async () => new Response(html, { status: 200 }),
    output
  });
  return { run, output, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('Censo local de comercializadoras CNMC', () => {
  it('mantiene un censo amplio, saneado y sin datos de clientes', () => {
    const entries = Object.entries(registry.commercializers || {});
    expect(registry._meta?.schema).toBe(1);
    expect(registry._meta?.source).toBe('https://sede.cnmc.gob.es/listado/censo/2');
    expect(registry._meta?.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registry._meta?.count).toBe(entries.length);
    expect(registry._meta?.sourceRows).toBeGreaterThanOrEqual(entries.length);
    expect(registry._meta?.duplicateCodes).toEqual(expect.any(Array));
    expect(registry._meta?.invalidWebsiteCodes).toEqual(expect.any(Array));
    expect(registry._meta?.inactiveCodes).toEqual(expect.any(Array));
    expect(entries.length).toBeGreaterThan(900);
    expect(entries.some(([code]) => /^R2-\d{4}$/.test(code))).toBe(true);

    for (const [code, entry] of entries) {
      expect(code).toMatch(/^R2-\d{3,4}$/);
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

  it('incluye comercializadoras con códigos de cuatro cifras', () => {
    expect(registry.commercializers['R2-1000']?.name).toBe('SERVICIOS ENERGETICOS AVANZADOS, S.L.');
  });

  it('localiza columnas por encabezado y prefiere la fila activa en duplicados', () => {
    const html = `
      <table>
        <thead><tr>
          <th>Estado</th><th>Página web</th><th>Nombre empresa</th>
          <th>Teléfono Att cliente gratuito</th><th>Nº de orden</th>
        </tr></thead>
        <tbody>
          <tr><td>Baja</td><td></td><td>Empresa antigua</td><td></td><td>R2-222</td></tr>
          <tr><td></td><td><a href="https://activa.example/">Web</a></td><td>Empresa activa</td><td>900 123 456</td><td>R2-222</td></tr>
          <tr><td></td><td><a href="https://nueva.example/">Web</a></td><td>Empresa nueva</td><td>900 654 321</td><td>R2-1000</td></tr>
        </tbody>
      </table>`;
    const parsed = parseCnmcCommercializers(html);

    expect(parsed.sourceRows).toBe(3);
    expect(parsed.duplicateCodes).toEqual(['R2-222']);
    expect(parsed.invalidWebsiteCodes).toEqual([]);
    expect(parsed.inactiveCodes).toEqual([]);
    expect(parsed.commercializers['R2-222']).toMatchObject({ name: 'Empresa activa' });
    expect(parsed.commercializers['R2-1000']).toMatchObject({
      name: 'Empresa nueva',
      phone: '900 654 321',
      website: 'https://nueva.example/'
    });
  });

  it('aborta si una fila parece R2 pero usa un formato nuevo no contemplado', () => {
    const html = `
      <table><tr>
        <th>Nº de orden</th><th>Nombre empresa</th><th>Teléfono Att cliente gratuito</th>
        <th>Página web</th><th>Estado</th>
      </tr><tr><td>R2-10000</td><td>Formato futuro</td><td>900 123 456</td><td></td><td></td></tr></table>`;
    expect(() => parseCnmcCommercializers(html)).toThrow(/códigos R2 no reconocidos.*R2-10000/);
  });

  it('conserva la comercializadora y omite una web opcional inválida', () => {
    const html = `
      <table><tr>
        <th>Nº de orden</th><th>Nombre empresa</th><th>Teléfono Att cliente gratuito</th>
        <th>Página web</th><th>Estado</th>
      </tr><tr><td>R2-1000</td><td>Empresa válida</td><td>900 123 456</td>
        <td><a href="http://Home Page | Empresa">Home Page | Empresa</a></td><td></td></tr></table>`;
    const parsed = parseCnmcCommercializers(html);
    expect(parsed.commercializers['R2-1000']).toEqual({
      name: 'Empresa válida',
      phone: '900 123 456'
    });
    expect(parsed.invalidWebsiteCodes).toEqual(['R2-1000']);
  });

  it('descarta una web con el esquema escrito dos veces', () => {
    // Errata real del censo (R2-1081 el 03/09/2026): `new URL()` la acepta con
    // protocolo http: y hostname "https", asi que un filtro que solo mire el
    // protocolo la da por buena y publica un enlace que no lleva a ninguna parte.
    const html = `
      <table><tr>
        <th>Nº de orden</th><th>Nombre empresa</th><th>Teléfono Att cliente gratuito</th>
        <th>Página web</th><th>Estado</th>
      </tr><tr><td>R2-1000</td><td>Empresa válida</td><td>900 123 456</td>
        <td><a href="http://https//ejemplo.com/">https//ejemplo.com</a></td><td></td></tr></table>`;
    const parsed = parseCnmcCommercializers(html);
    expect(parsed.commercializers['R2-1000'].website).toBeUndefined();
    expect(parsed.invalidWebsiteCodes).toEqual(['R2-1000']);
  });

  it('no publica ninguna web sin hostname resoluble en el censo versionado', () => {
    // Guardrail sobre el dato real, no sobre una fixture: si una errata de la
    // CNMC vuelve a colarse, el enlace "Web oficial" del extractor de facturas
    // apuntaria a un host inexistente.
    for (const [code, entry] of Object.entries(registry.commercializers || {})) {
      if (!entry.website) continue;
      const { hostname } = new URL(entry.website);
      expect(hostname.includes('.'), `${code} publica un hostname sin punto: ${entry.website}`).toBe(true);
      expect(hostname.split('.').every(Boolean), `${code} publica un hostname con etiqueta vacía: ${entry.website}`).toBe(true);
    }
  });

  it('aborta si desaparece o se duplica un encabezado obligatorio', () => {
    const html = `
      <table><tr><th>Nº de orden</th><th>Nombre empresa</th><th>Página web</th><th>Estado</th></tr>
      <tr><td>R2-1000</td><td>Sin teléfono</td><td></td><td></td></tr></table>`;
    expect(() => parseCnmcCommercializers(html)).toThrow(/Teléfono de atención/);
  });

  it('ejercita directamente el sanity check que bloquea el censo truncado de 782 códigos', () => {
    const parsedRegistry = {
      commercializers: registry.commercializers,
      sourceRows: registry._meta.sourceRows,
      duplicateCodes: registry._meta.duplicateCodes,
      invalidWebsiteCodes: registry._meta.invalidWebsiteCodes,
      inactiveCodes: registry._meta.inactiveCodes
    };
    expect(assertCensusSane(parsedRegistry)).toMatchObject({ count: registry._meta.count });

    const truncatedCommercializers = Object.fromEntries(
      Object.entries(registry.commercializers).filter(([code]) => /^R2-\d{3}$/.test(code))
    );
    expect(Object.keys(truncatedCommercializers)).toHaveLength(782);
    expect(() => assertCensusSane({
      commercializers: truncatedCommercializers,
      sourceRows: 782,
      duplicateCodes: [],
      invalidWebsiteCodes: [],
      inactiveCodes: []
    })).toThrow(/solo contiene 782 comercializadoras/);
  });

  it('bloquea un censo grande que haya perdido casi todos los códigos de cuatro cifras', () => {
    const mostlyThreeDigit = Object.fromEntries([
      ...Array.from({ length: 900 }, (_value, index) => [
        `R2-${String(index).padStart(3, '0')}`,
        { name: `EMPRESA ${index}` }
      ]),
      ['R2-1000', { name: 'ÚNICA EMPRESA DE CUATRO CIFRAS' }]
    ]);

    expect(() => assertCensusSane({
      commercializers: mostlyThreeDigit,
      sourceRows: 901,
      duplicateCodes: [],
      invalidWebsiteCodes: [],
      inactiveCodes: []
    })).toThrow(/solo contiene 1 códigos R2 de cuatro cifras/);
  });

  it('el flujo de sincronización invoca el sanity check antes de escribir', async () => {
    const html = `
      <table><tr>
        <th>Nº de orden</th><th>Nombre empresa</th><th>Teléfono Att cliente gratuito</th>
        <th>Página web</th><th>Estado</th>
      </tr><tr><td>R2-796</td><td>BON PREU, SAU</td><td>900 500 005</td><td></td><td></td></tr></table>`;
    const fetchImpl = async () => new Response(html, {
      status: 200,
      headers: { date: 'Tue, 25 Aug 2026 12:00:00 GMT' }
    });

    await expect(syncCnmcCommercializers({
      fetchImpl,
      output: 'no-debe-escribirse.json'
    })).rejects.toThrow(/solo contiene 1 comercializadoras/);
  });

  it('bloquea un censo cortado por el final aunque conserve mas de 900 entradas', async () => {
    const codes = Object.keys(registry.commercializers).sort();
    expect(codes.at(-1)).toBe('R2-999');

    // Control positivo: la tabla completa se publica.
    const full = syncFrom(registryHtml({ codes }));
    try {
      await expect(full.run).resolves.toBeUndefined();
      const written = JSON.parse(fs.readFileSync(full.output, 'utf8'));
      expect(written._meta.count).toBe(codes.length);
    } finally {
      full.cleanup();
    }

    // Ronda 40: cortar tras R2-964 dejaba mas de 900 entradas, los dos centinelas
    // antiguos y los codigos de cuatro cifras, y se publicaba. Tambien un corte de
    // una sola fila.
    const cutAfter964 = codes.slice(0, codes.indexOf('R2-964') + 1);
    expect(cutAfter964.length).toBeGreaterThan(900);
    for (const truncated of [cutAfter964, codes.slice(0, -1)]) {
      const partial = syncFrom(registryHtml({ codes: truncated }));
      try {
        await expect(partial.run).rejects.toThrow(/centinela R2-999/);
        expect(fs.existsSync(partial.output)).toBe(false);
      } finally {
        partial.cleanup();
      }
    }
  });

  it('aborta si una fila con contenido llega sin código R2 en vez de saltarla en silencio', async () => {
    const withoutCode = registryHtml({
      extraRows: '<tr><td></td><td>EMPRESA SIN CODIGO, S.L.</td><td>900 000 000</td><td></td><td></td></tr>'
    });
    const run = syncFrom(withoutCode);
    try {
      await expect(run.run).rejects.toThrow(/códigos R2 no reconocidos: \(sin código\)/);
      expect(fs.existsSync(run.output)).toBe(false);
    } finally {
      run.cleanup();
    }

    const spacedCode = registryHtml({
      extraRows: '<tr><td>R2 964</td><td>ENERGIAREA EUROPE S.L.</td><td>900 877 511</td><td></td><td></td></tr>'
    });
    expect(() => parseCnmcCommercializers(spacedCode)).toThrow(/códigos R2 no reconocidos: R2 964/);

    // Una fila vacia sigue siendo relleno, no una comercializadora.
    const blankRow = registryHtml({ extraRows: '<tr><td></td><td> </td><td></td><td></td><td></td></tr>' });
    expect(parseCnmcCommercializers(blankRow).sourceRows).toBe(Object.keys(registry.commercializers).length);
  });
});
