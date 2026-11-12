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

  it('treats accessibility-only markup as non-editorial, but not new visible text', () => {
    const committed = [
      '<div class="topbar">',
      '<nav class="breadcrumbs"><a href="/">Inicio</a></nav>',
      '<h3 class="u-h3-strong-10">Sobre el Comparador</h3>',
      '<table><tr><th></th><th>PVPC</th></tr></table>'
    ].join('\n');
    const a11yOnly = committed
      .replace('<div class="topbar">', '<div class="topbar" role="banner">')
      .replace('<nav class="breadcrumbs">', '<nav class="breadcrumbs" aria-label="Ruta de navegación">')
      .replace('<h3 class="u-h3-strong-10">Sobre el Comparador</h3>', '<h2 class="u-h3-strong-10">Sobre el Comparador</h2>');
    expect(isSignificantlyDirty({ status: ' M guias/x.html', currentContent: a11yOnly, committedContent: committed })).toBe(false);

    // Un rotulo visible nuevo SI es un cambio de contenido y debe sellar fecha.
    const visibleText = a11yOnly.replace('<th></th>', '<th>Aspecto</th>');
    expect(isSignificantlyDirty({ status: ' M guias/x.html', currentContent: visibleText, committedContent: committed })).toBe(true);
    // Y cambiar el texto de un encabezado tambien, aunque cambie su nivel.
    const newHeading = a11yOnly.replace('Sobre el Comparador</h2>', 'Sobre LuzFija</h2>');
    expect(isSignificantlyDirty({ status: ' M guias/x.html', currentContent: newHeading, committedContent: committed })).toBe(true);
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

  it('treats the anti-framing loader as infrastructure, but not other new scripts', () => {
    const committed = [
      '<meta charset="utf-8"/>',
      '<meta name="color-scheme" content="dark light"/>',
      '<script>',
      '    (function(){ /* tema */ })();',
      '</script>',
      '<p>Texto de la guia que lee el usuario.</p>'
    ].join('\n');
    // Alta del 18/10/2026: una linea con el guard justo antes del primer script.
    const withGuard = committed.replace(
      '<script>\n',
      '<script src="/js/frame-guard.js?v=20261016-092957"></script>\n<script>\n'
    );
    expect(isSignificantlyDirty({
      status: ' M guias/x.html', currentContent: withGuard, committedContent: committed
    })).toBe(false);
    // Con sangria, como en las aplicaciones, tampoco.
    const indented = `  ${committed.replace('<script>\n', '<script src="/js/frame-guard.js?v=20261016-092957"></script>\n  <script>\n')}`;
    expect(maskVolatileSeoChanges(indented)).toBe(maskVolatileSeoChanges(`  ${committed.replace('<script>\n', '  <script>\n')}`));

    // Un texto visible nuevo junto al guard SI sella fecha.
    expect(isSignificantlyDirty({
      status: ' M guias/x.html',
      currentContent: withGuard.replace('Texto de la guia', 'Texto reescrito de la guia'),
      committedContent: committed
    })).toBe(true);
    // Y la excepcion es solo para el guard: otro script nuevo sigue contando.
    expect(isSignificantlyDirty({
      status: ' M guias/x.html',
      currentContent: committed.replace('<script>\n', '<script src="/js/otro.js?v=20261016-092957"></script>\n<script>\n'),
      committedContent: committed
    })).toBe(true);
  });

  it('treats preload hints as infrastructure, but not new stylesheets', () => {
    const committed = [
      '<meta charset="utf-8"/>',
      '  <link rel="preload" href="/fonts/outfit-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>',
      '  <link rel="stylesheet" href="/styles.css?v=20261108-190217">',
      '<p>Texto de la guia que lee el usuario.</p>'
    ].join('\n');
    // Alta del 12/11/2026: bloque de preloads y la fuente movida de sitio.
    const withPreloads = [
      '<meta charset="utf-8"/>',
      '  <link rel="preload" href="/styles.css?v=20261112-100000" as="style">',
      '  <link rel="preload" href="/fonts/outfit-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>',
      '  <link rel="stylesheet" href="/styles.css?v=20261112-100000">',
      '<p>Texto de la guia que lee el usuario.</p>'
    ].join('\n');
    expect(isSignificantlyDirty({
      status: ' M index.html', currentContent: withPreloads, committedContent: committed
    })).toBe(false);

    // Una hoja de estilo nueva sigue contando.
    expect(isSignificantlyDirty({
      status: ' M index.html',
      currentContent: withPreloads.replace('<p>', '  <link rel="stylesheet" href="/nueva.css?v=20261112-100000">\n<p>'),
      committedContent: committed
    })).toBe(true);
    // Y un texto visible nuevo tambien.
    expect(isSignificantlyDirty({
      status: ' M index.html',
      currentContent: withPreloads.replace('Texto de la guia', 'Texto reescrito de la guia'),
      committedContent: committed
    })).toBe(true);
  });

  it('treats page CSS (<style> blocks and style attributes) as presentation, not content', () => {
    const committed = [
      '<style>',
      '.header{position:sticky;top:0;padding:16px 0;z-index:100}',
      '.card{color:red}',
      '</style>',
      '<p style="color:#8b5cf6">Texto de la guia.</p>'
    ].join('\n');
    const dirty = (current) => isSignificantlyDirty({ status: ' M guias/x.html', currentContent: current, committedContent: committed });
    // Cabecera no fija en movil, colores, una regla nueva: presentacion.
    expect(dirty(committed.replace('z-index:100}\n', 'z-index:100}\n@media (max-width:640px),(max-height:500px){.header{position:static}}\n'))).toBe(false);
    expect(dirty(committed.replace('.card{color:red}', '.card{color:blue}'))).toBe(false);
    expect(dirty(committed.replace('color:#8b5cf6', 'color:var(--accent-text)'))).toBe(false);
    expect(dirty(committed.replace(/\n/g, '\r\n'))).toBe(false);
    // El texto, un enlace o un elemento nuevo siguen contando.
    expect(dirty(committed.replace('Texto de la guia.', 'Texto nuevo de la guia.'))).toBe(true);
    expect(dirty(committed + '\n<p>Parrafo nuevo</p>')).toBe(true);
    expect(dirty(committed.replace('<p style', '<p class="nota" style'))).toBe(true);
  });

  it('only masks <style> blocks written at line start: a "<style>" string inside a script cannot swallow content', () => {
    const committed = '<script>var css = "<style>";</script>\n<p>Texto original</p>\n<script>var fin = "</style>";</script>';
    const current = committed.replace('Texto original', 'Texto reescrito');
    expect(isSignificantlyDirty({ status: ' M guias/x.html', currentContent: current, committedContent: committed })).toBe(true);
  });

  it('does not re-date the privacy policy for a CSS-only fix', () => {
    const committed = '<style>\n.accordion-item .accordion-content{padding:0 24px 24px;color:var(--muted)}\n</style>\n<p>Texto legal.</p>';
    const withRule = committed.replace('var(--muted)}\n', 'var(--muted)}\n.accordion-item .accordion-content{overflow-wrap:anywhere}\n');
    const dirty = (current) => isSignificantlyDirty({ status: ' M privacidad.html', currentContent: current, committedContent: committed });
    expect(dirty(withRule)).toBe(false);
    expect(dirty(withRule.replace('Texto legal.', 'Texto legal nuevo.'))).toBe(true);
  });

  it('does not ignore HTML comments: a regex cannot tell them from text in style, textarea, title or attributes', () => {
    // Revision de ChatGPT del 12/11/2026: una mascara de comentarios por regex ocultaba cambios
    // reales. Se retiro; el fallo aceptado es el inofensivo (tocar un comentario fecha la pagina).
    const dirty = (antes, despues) => isSignificantlyDirty({
      status: ' M guias/x.html', currentContent: despues, committedContent: antes
    });
    // Un comentario nuevo fecha la pagina (conservador, a proposito).
    expect(dirty('<p>A</p>', '<p>A</p>\n<!-- una nota -->')).toBe(true);
    // CSS dentro de CDO/CDC: desde el 12/11/2026 el CSS de pagina es presentacion y no fecha (ver
    // el test de bloques <style>); aqui importa que el comentario no oculte el texto de al lado.
    expect(dirty('<style>\n<!--\n.card{color:red}\n-->\n</style>\n<p>A</p>', '<style>\n<!--\n.card{color:blue}\n-->\n</style>\n<p>B</p>')).toBe(true);
    // Texto visible de un textarea y del titulo.
    expect(dirty('<textarea><!-- Pon tu consumo --></textarea>', '<textarea><!-- Pon tu consumo anual --></textarea>')).toBe(true);
    expect(dirty('<title><!-- Guia --> Factura</title>', '<title><!-- Guia --> Factura nueva</title>')).toBe(true);
    // Valor de un atributo.
    expect(dirty('<button title="<!-- Ayuda -->">?</button>', '<button title="<!-- Ayuda ampliada -->">?</button>')).toBe(true);
    // "<!--" dentro de un script y comentario condicional.
    expect(dirty('<script>var m = "<!--";</script>\n<p>Texto original</p>\n<!-- c -->', '<script>var m = "<!--";</script>\n<p>Texto reescrito</p>\n<!-- c -->')).toBe(true);
    expect(dirty('<!--[if IE]><p>Aviso viejo</p><![endif]-->', '<!--[if IE]><p>Aviso nuevo</p><![endif]-->')).toBe(true);
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
