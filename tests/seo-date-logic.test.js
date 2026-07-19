/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  getSelfStampedDate,
  isSignificantlyDirty,
  maskVolatileSeoChanges,
  resolvePageDate,
  resolveSitemapLastmod
} from '../scripts/seo-date-logic.mjs';

describe('SEO date policy', () => {
  it('treats deploy-only changes as non-significant', () => {
    const committed = [
      '<script src="/js/app.js?v=20260718-101010"></script>',
      "'sha256-abcDEF012+/='",
      '{"dateModified":"2026-07-18T12:00:00+02:00"}',
      '<span class="updated-badge">Act. 18 jul 2026</span>',
      '<p><em>Última actualización: 18 de julio de 2026</em></p>'
    ].join('\n');
    const current = [
      '<script src="/js/app.js?v=20260719-090000"></script>',
      "'sha256-newHash456+/='",
      '{"dateModified":"2026-07-19T12:00:00+02:00"}',
      '<span class="updated-badge">Act. 19 jul 2026</span>',
      '<p><em>Última actualización: 19 de julio de 2026</em></p>'
    ].join('\n');

    expect(maskVolatileSeoChanges(current)).toBe(maskVolatileSeoChanges(committed));
    expect(isSignificantlyDirty({ status: ' M index.html', currentContent: current, committedContent: committed })).toBe(false);
    expect(isSignificantlyDirty({
      status: ' M index.html',
      currentContent: `${current}\n<main>Contenido nuevo</main>`,
      committedContent: committed
    })).toBe(true);
  });

  it('preserves the self-stamped date across pre-commit and CI git fallbacks', () => {
    const content = '<script type="application/ld+json">{"dateModified":"2026-07-18T12:00:00+02:00"}</script>';

    expect(resolvePageDate({
      dirty: false,
      content,
      today: '2026-07-19',
      gitLastModifiedDate: '2026-07-18'
    })).toBe('2026-07-18');
    expect(resolvePageDate({
      dirty: false,
      content,
      today: '2026-07-19',
      gitLastModifiedDate: '2026-07-19'
    })).toBe('2026-07-18');
  });

  it('preserves an existing sitemap lastmod for clean pages without a date field', () => {
    const input = {
      dirty: false,
      content: '<!doctype html><title>Home</title>',
      existingLastmod: '2026-07-18',
      today: '2026-07-19'
    };

    expect(resolveSitemapLastmod({ ...input, gitLastModifiedDate: '2026-07-18' })).toBe('2026-07-18');
    expect(resolveSitemapLastmod({ ...input, gitLastModifiedDate: '2026-07-19' })).toBe('2026-07-18');
  });

  it('uses today only for a real content change', () => {
    expect(resolveSitemapLastmod({
      dirty: true,
      content: '<!doctype html><title>Changed</title>',
      existingLastmod: '2026-07-18',
      today: '2026-07-19',
      gitLastModifiedDate: '2026-07-18'
    })).toBe('2026-07-19');
  });

  it('self-heals a malformed durable stamp instead of falling back to git history', () => {
    const input = {
      dirty: false,
      content: '<span class="updated-badge">Act. fecha rota</span>',
      today: '2026-07-19',
      gitLastModifiedDate: '2026-07-18'
    };

    expect(resolvePageDate(input)).toBe('2026-07-19');
    expect(resolveSitemapLastmod({ ...input, existingLastmod: '2026-07-18' })).toBe('2026-07-19');
  });

  it('reads all supported durable date stamps', () => {
    expect(getSelfStampedDate('<span class="updated-badge">Act. 8 jul 2026</span>')).toBe('2026-07-08');
    expect(getSelfStampedDate('<p><em>Última actualización: 18 de julio de 2026</em></p>')).toBe('2026-07-18');
    expect(getSelfStampedDate('{"dateModified":"2026-02-31"}')).toBeNull();
  });
});
