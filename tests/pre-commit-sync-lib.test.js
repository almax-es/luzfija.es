/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  getBlockingManagedFiles,
  getFilesToRestage,
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
      unstagedFiles: ['sitemap.xml'],
      untrackedFiles: []
    });

    expect(result.dirtyButUnstagedManaged).toEqual(['sitemap.xml']);
    expect(result.hasBlocking).toBe(true);
  });

  it('restages generated outputs and staged HTML pages', () => {
    expect(getFilesToRestage(['guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'])).toEqual([
      'sitemap.xml',
      'feed.xml',
      'README.md',
      'CAPACIDADES-WEB.md',
      'JSON-SCHEMA.md',
      'guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html'
    ]);
  });
});
