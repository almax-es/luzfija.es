/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Pagina 404: sugiere la pagina real mas parecida a la URL pedida y mide los enlaces rotos.
//
// GitHub Pages sirve 404.html en la URL que se pidio, pero su canonical es /404.html, asi que el
// pageview solo dice "hubo una 404". Este modulo anhade el evento `pagina-404/<seccion>/<pagina>`
// con la pagina EXISTENTE mas parecida, o `pagina-404/desconocida`. Lo tecleado por el usuario
// nunca viaja: solo nombres de paginas que ya estan en el sitemap (ANALITICA-GOATCOUNTER.md).
// Las candidatas salen de /sitemap.xml, que ya se regenera al publicar una guia: no hay lista que
// mantener a mano.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LFNotFound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const SITEMAP_URL = '/sitemap.xml';
  const FETCH_TIMEOUT_MS = 5000;
  const STOP_WORDS = new Set([
    'a', 'al', 'como', 'con', 'cual', 'de', 'del', 'el', 'en', 'es', 'la', 'las', 'lo', 'los',
    'mi', 'o', 'para', 'por', 'que', 'se', 'si', 'sin', 'su', 'tu', 'tus', 'un', 'una', 'y',
    'html', 'htm', 'php', 'index', 'www', 'guia', 'guias'
  ]);

  function normalizeSlugText(value) {
    let text = String(value == null ? '' : value);
    try {
      text = decodeURIComponent(text);
    } catch (_) {}
    try {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (_) {}
    return text.toLowerCase();
  }

  // Ultimo segmento util de una ruta, sin extension: '/Guias/CUPS-que-es.html/' -> 'cups-que-es'.
  function slugOfPath(pathname) {
    const segments = normalizeSlugText(pathname)
      .split('/')
      .map((segment) => segment.replace(/\.(html?|php|aspx?)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
      .filter((segment) => segment && segment !== 'index');
    return segments.length ? segments[segments.length - 1] : '';
  }

  function tokensOf(slug) {
    return [...new Set(String(slug || '').split('-').filter((t) => t.length > 1 && !STOP_WORDS.has(t)))];
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  // Candidatas: paginas HTML del sitemap. Seccion 'guias' o 'raiz' y un id estable por pagina.
  function candidatesFromSitemap(xmlText) {
    const candidates = [];
    const seen = new Set();
    for (const match of String(xmlText || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      let pathname;
      try {
        pathname = new URL(match[1]).pathname;
      } catch (_) {
        continue;
      }
      if (!/(\/|\.html)$/.test(pathname) || seen.has(pathname)) continue;
      seen.add(pathname);
      const inGuides = pathname.startsWith('/guias/');
      const slug = slugOfPath(pathname);
      candidates.push({
        path: pathname,
        section: inGuides ? 'guias' : 'raiz',
        slug: slug || 'home',
        // La home no lleva palabras en la URL; sin estas, "/comparador" apuntaba al simulador
        // solar por ser la unica pagina con "comparador" en su ruta.
        tokens: slug ? tokensOf(slug) : ['comparador', 'tarifas', 'luz', 'inicio', 'home']
      });
    }
    return candidates;
  }

  // Puntua cada candidata frente a la ruta pedida y devuelve la mejor, o null si ninguna se
  // parece lo bastante. Ante la duda, null: una sugerencia equivocada es peor que ninguna.
  function findClosestPage(requestedPath, candidates) {
    const slug = slugOfPath(requestedPath);
    if (!slug || slug === '404') return null;
    const tokens = tokensOf(slug);
    let best = null;
    const containing = [];

    for (const candidate of candidates || []) {
      let score = 0;
      if (candidate.slug === slug) {
        score = 1;
      } else {
        const distance = levenshtein(slug, candidate.slug);
        const tolerance = Math.max(2, Math.floor(candidate.slug.length * 0.2));
        if (distance <= tolerance) score = 0.9 - distance / 100;

        if (tokens.length && candidate.tokens.length) {
          const shared = tokens.filter((t) => candidate.tokens.includes(t)).length;
          const union = new Set([...tokens, ...candidate.tokens]).size;
          const jaccard = shared / union;
          if (jaccard >= 0.5) score = Math.max(score, 0.5 + jaccard * 0.3);
          if (shared === tokens.length && tokens.some((t) => t.length >= 4)) containing.push(candidate);
        }
      }
      if (score > 0 && (!best || score > best.score)) best = { candidate, score };
    }
    if (best) return best.candidate;
    // Una ruta corta con palabras propias ("/cups", "/bono-social") contenida entera en UNA sola
    // pagina tambien es una sugerencia util. Si la contienen varias ("/tarifas", "/pvpc"), elegir
    // una seria arbitrario: mejor no sugerir nada.
    return containing.length === 1 ? containing[0] : null;
  }

  function eventDetailFor(requestedPath, match) {
    if (slugOfPath(requestedPath) === '404') return ['directa'];
    return match ? [match.section, match.slug] : ['desconocida'];
  }

  async function fetchText(url) {
    if (typeof root.fetch !== 'function') throw new Error('fetch unavailable');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const response = await root.fetch(url, controller ? { signal: controller.signal } : {});
      if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : '?'));
      return await response.text();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function titleFromHtml(html) {
    const match = /<title>([^<]+)<\/title>/i.exec(String(html || ''));
    if (!match) return '';
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const title = match[1]
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&([a-z]+);/gi, (whole, name) => entities[name.toLowerCase()] ?? whole);
    return title.split(/\s+\|\s+/)[0].trim();
  }

  function humanizeSlug(slug) {
    const text = String(slug || '').replace(/-/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'la página de inicio';
  }

  function renderSuggestion(documentRef, container, match, label) {
    if (!container) return;
    const paragraph = documentRef.createElement('p');
    paragraph.className = 'suggestion';
    paragraph.append('¿Buscabas ');
    const link = documentRef.createElement('a');
    link.href = match.path;
    link.textContent = label;
    paragraph.append(link, '?');
    container.replaceChildren(paragraph);
    container.hidden = false;
  }

  function track(detail) {
    try {
      if (typeof root.__LF_trackDetail === 'function') {
        root.__LF_trackDetail('pagina-404', detail, { title: 'Página 404: ' + detail.join('/') });
      }
    } catch (_) {}
  }

  async function init(options) {
    const documentRef = options?.document || root.document;
    const requestedPath = options?.pathname ?? root.location?.pathname ?? '/';
    const container = options?.container || documentRef?.getElementById('notFoundSuggestion');

    let candidates;
    try {
      candidates = candidatesFromSitemap(await fetchText(options?.sitemapUrl || SITEMAP_URL));
    } catch (_) {
      track(slugOfPath(requestedPath) === '404' ? ['directa'] : ['sin-sitemap']);
      return null;
    }

    const match = findClosestPage(requestedPath, candidates);
    track(eventDetailFor(requestedPath, match));
    if (!match || !documentRef) return match;

    let label = '';
    try {
      label = titleFromHtml(await fetchText(match.path));
    } catch (_) {}
    renderSuggestion(documentRef, container, match, label || humanizeSlug(match.slug === 'home' ? '' : match.slug));
    return match;
  }

  if (root.document && !(typeof module === 'object' && module.exports)) {
    init().catch(() => {});
  }

  return {
    candidatesFromSitemap,
    eventDetailFor,
    findClosestPage,
    init,
    slugOfPath,
    titleFromHtml
  };
});
