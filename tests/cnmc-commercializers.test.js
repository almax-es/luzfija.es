import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertCensusSane,
  parseCnmcCommercializers,
  syncCnmcCommercializers
} from '../scripts/sync-cnmc-commercializers.mjs';

const registry = JSON.parse(fs.readFileSync('data/cnmc-commercializers.json', 'utf8'));

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
});
