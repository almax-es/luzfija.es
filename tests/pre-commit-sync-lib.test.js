/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  getBlockingManagedFiles,
  getFilesToRestage,
  getSyncOutputs,
  needsSync
} from '../scripts/pre-commit-sync-lib.mjs';

describe('pre-commit sync guardrails', () => {
  it('requires sync when a tracked HTML deletion is staged', () => {
    expect(needsSync(['guias/nueva-guia.html'])).toBe(true);
  });

  it('requires sync when a managed output is staged directly', () => {
    expect(needsSync(['sitemap.xml'])).toBe(true);
  });

  it('blocks partially staged managed files', () => {
    const result = getBlockingManagedFiles({
      stagedFiles: ['guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'],
      unstagedFiles: ['guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'],
      untrackedFiles: []
    });

    expect(result.partiallyStagedManaged).toEqual([
      'guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'
    ]);
    expect(result.hasBlocking).toBe(true);
  });

  it('blocks dirty derived outputs before re-sync', () => {
    const result = getBlockingManagedFiles({
      stagedFiles: ['guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'],
      unstagedFiles: ['sitemap.xml', 'data/guides-search-index.json'],
      untrackedFiles: []
    });

    expect(result.dirtyButUnstagedManaged).toEqual([
      'sitemap.xml',
      'data/guides-search-index.json'
    ]);
    expect(result.hasBlocking).toBe(true);
  });

  it('restages generated outputs and staged HTML pages', () => {
    expect(getFilesToRestage(['guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'])).toEqual([
      'sitemap.xml',
      'data/guides-search-index.json',
      'README.md',
      'CAPACIDADES-WEB.md',
      'JSON-SCHEMA.md',
      'llms.txt',
      'llms-full.txt',
      'guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'
    ]);
  });

  it('keeps literal sync-seo-docs outputs declared as managed outputs', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/sync-seo-docs.mjs'), 'utf8');
    const literalUpdateTargets = [...script.matchAll(/updateFile\('([^']+)'/g)]
      .map((match) => match[1])
      .filter((relPath) => !relPath.endsWith('.html'));

    expect(getSyncOutputs()).toEqual(expect.arrayContaining(literalUpdateTargets));
  });
});
