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

  it('treats robots directives and Article image metadata as non-editorial', () => {
    const base = [
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
      '<h1>Estafas y llamadas comerciales</h1>',
      '<p>Texto de la guia que lee el usuario.</p>'
    ].join('\n');
    const committed = [
      base,
      '<script type="application/ld+json">{"@type":"Article","image":{"@type":"ImageObject","url":"https://luzfija.es/og.png","width":1200,"height":630}}</script>'
    ].join('\n');

    // 1. Anadir meta robots, por si solo, no es un cambio editorial.
    const robotsOnly = [
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
      '<meta name="robots" content="index,follow,max-image-preview:large"/>',
      '<h1>Estafas y llamadas comerciales</h1>',
      '<p>Texto de la guia que lee el usuario.</p>',
      '<script type="application/ld+json">{"@type":"Article","image":{"@type":"ImageObject","url":"https://luzfija.es/og.png","width":1200,"height":630}}</script>'
    ].join('\n');
    expect(isSignificantlyDirty({
      status: ' M guias/x.html', currentContent: robotsOnly, committedContent: committed
    })).toBe(false);

    // 2. Corregir la imagen del Article, por si solo, tampoco lo es.
    const imageOnly = [
      base,
      '<script type="application/ld+json">{"@type":"Article","image":{"@type":"ImageObject","url":"https://luzfija.es/img/hero.png","width":658,"height":753}}</script>'
    ].join('\n');
    expect(isSignificantlyDirty({
      status: ' M guias/x.html', currentContent: imageOnly, committedContent: committed
    })).toBe(false);

    // 3. Ambos a la vez siguen sin sellar fecha nueva.
    const both = robotsOnly.replace(
      '"url":"https://luzfija.es/og.png","width":1200,"height":630',
      '"url":"https://luzfija.es/img/hero.png","width":658,"height":753'
    );
    expect(isSignificantlyDirty({
      status: ' M guias/x.html', currentContent: both, committedContent: committed
    })).toBe(false);

    // 4. Cambiar el texto visible SI actualiza la fecha.
    expect(isSignificantlyDirty({
      status: ' M guias/x.html',
      currentContent: both.replace('Texto de la guia que lee el usuario.', 'Texto reescrito con datos nuevos.'),
      committedContent: committed
    })).toBe(true);

    // 5. Cambiar la imagen de verdad tambien: og:image y el <img> visible no
    //    estan enmascarados, asi que el fichero sigue contando como sucio.
    const realImageSwap = [
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
      '<meta property="og:image" content="https://luzfija.es/img/otra.png"/>',
      '<h1>Estafas y llamadas comerciales</h1>',
      '<p>Texto de la guia que lee el usuario.</p>',
      '<script type="application/ld+json">{"@type":"Article","image":{"@type":"ImageObject","url":"https://luzfija.es/img/otra.png","width":900,"height":600}}</script>'
    ].join('\n');
    expect(isSignificantlyDirty({
      status: ' M guias/x.html', currentContent: realImageSwap, committedContent: committed
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
