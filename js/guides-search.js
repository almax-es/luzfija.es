(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LFGuideSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const DEFAULT_INDEX_URL = '/data/guides-search-index.json';
  const STOP_WORDS = new Set([
    'a', 'al', 'algo', 'como', 'con', 'cual', 'cuales', 'cuanto', 'cuantos', 'de',
    'del', 'donde', 'el', 'en', 'es', 'esta', 'este', 'esto', 'hay', 'la', 'las',
    'lo', 'los', 'mas', 'mi', 'mis', 'o', 'para', 'por', 'que', 'se', 'si', 'sin',
    'su', 'sus', 'te', 'tu', 'tus', 'un', 'una', 'uno', 'unos', 'unas', 'y'
  ]);

  const STEM_SUFFIXES = [
    'aciones', 'uciones', 'imiento', 'imientos', 'amiento', 'amientos', 'adoras',
    'adores', 'adora', 'ador', 'ancias', 'ancia', 'logias', 'logia', 'mente',
    'ciones', 'cion', 'siones', 'sion', 'ismos', 'ismo', 'istas', 'ista',
    'idades', 'idad', 'anzas', 'anza', 'adoras', 'adores', 'adora', 'ador',
    'ados', 'adas', 'idos', 'idas', 'ando', 'iendo', 'ante', 'able', 'ible',
    'icos', 'icas', 'ico', 'ica', 'ivos', 'ivas', 'ivo', 'iva', 'oras', 'ores',
    'ora', 'or', 'es', 's', 'ar', 'er', 'ir'
  ];

  const FIELD_RULES = [
    { key: 'title', label: 'título', token: 52, prefix: 38, contains: 32, stem: 24, phrase: 90 },
    { key: 'description', label: 'resumen', token: 28, prefix: 20, contains: 16, stem: 12, phrase: 38 },
    { key: 'cardDescription', label: 'resumen', token: 24, prefix: 18, contains: 14, stem: 10, phrase: 28 },
    { key: 'aliases', label: 'alias', token: 30, prefix: 22, contains: 18, stem: 14, phrase: 34 },
    { key: 'categories', label: 'categoría', token: 26, prefix: 20, contains: 16, stem: 12, phrase: 26 },
    { key: 'level', label: 'nivel', token: 20, prefix: 14, contains: 10, stem: 8, phrase: 18 },
    { key: 'slug', label: 'URL', token: 18, prefix: 14, contains: 12, stem: 10, phrase: 18 },
    { key: 'headings', label: 'sección', token: 26, prefix: 20, contains: 16, stem: 12, phrase: 34, list: true },
    { key: 'faq', label: 'FAQ', token: 24, prefix: 18, contains: 14, stem: 10, phrase: 30, list: true },
    { key: 'content', label: 'contenido', token: 10, prefix: 8, contains: 6, stem: 5, phrase: 14 }
  ];

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    const text = String(value == null ? '' : value).toLowerCase();
    let normalized = text;
    try {
      normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {}
    return normalized.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function unique(items) {
    return [...new Set(items.filter(Boolean))];
  }

  function stemToken(token) {
    let stem = String(token || '');
    for (const suffix of STEM_SUFFIXES) {
      if (stem.length > suffix.length + 3 && stem.endsWith(suffix)) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }
    return stem;
  }

  function tokenizeQuery(query) {
    const allTokens = normalizeText(query).split(' ').filter(Boolean);
    const filtered = allTokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
    return filtered.length ? unique(filtered) : unique(allTokens);
  }

  function buildTextValue(rawValue) {
    const raw = normalizeWhitespace(rawValue);
    const normalized = normalizeText(raw);
    const tokens = unique(normalized.split(' ').filter(Boolean));
    const stems = unique(tokens.map(stemToken));
    return { raw, normalized, tokens, stems };
  }

  function buildListValue(items) {
    return (items || [])
      .map((item) => buildTextValue(item))
      .filter((value) => value.normalized);
  }

  function canonicalPath(href, baseUrl) {
    try {
      const base = baseUrl || root.location?.origin || 'https://luzfija.es';
      return new URL(String(href || ''), base).pathname;
    } catch {
      return null;
    }
  }

  function prepareGuideEntry(entry) {
    const prepared = {
      ...entry,
      path: canonicalPath(entry.path || '') || entry.path,
      _fields: {
        title: buildTextValue(entry.title),
        description: buildTextValue(entry.description),
        cardDescription: buildTextValue(entry.cardDescription),
        aliases: buildTextValue((entry.aliases || []).join(' ')),
        categories: buildTextValue((entry.categories || []).join(' ')),
        level: buildTextValue(entry.level),
        slug: buildTextValue(entry.slug),
        content: buildTextValue(entry.content),
        headings: buildListValue(entry.headings),
        faq: buildListValue(entry.faq)
      }
    };

    prepared._aggregate = buildTextValue([
      entry.title,
      entry.description,
      entry.cardDescription,
      (entry.aliases || []).join(' '),
      (entry.categories || []).join(' '),
      entry.level,
      entry.slug,
      (entry.headings || []).join(' '),
      (entry.faq || []).join(' '),
      entry.content
    ].join(' '));

    return prepared;
  }

  function prepareGuidesIndex(guides) {
    return (guides || []).map((entry) => prepareGuideEntry(entry));
  }

  function matchScalarField(fieldValue, term, stem, rule) {
    if (!fieldValue || !fieldValue.normalized) return null;

    if (fieldValue.tokens.includes(term)) {
      return { score: rule.token + Math.min(term.length, 8), snippet: fieldValue.raw };
    }

    if (fieldValue.tokens.some((token) => token.startsWith(term) || (term.length >= 5 && term.startsWith(token)))) {
      return { score: rule.prefix + Math.min(term.length, 6), snippet: fieldValue.raw };
    }

    if (fieldValue.normalized.includes(term)) {
      return { score: rule.contains + Math.min(term.length, 4), snippet: fieldValue.raw };
    }

    if (fieldValue.stems.includes(stem)) {
      return { score: rule.stem + Math.min(stem.length, 4), snippet: fieldValue.raw };
    }

    return null;
  }

  function matchListField(listValues, term, stem, rule) {
    let bestMatch = null;
    for (const value of listValues || []) {
      const match = matchScalarField(value, term, stem, rule);
      if (!match) continue;
      if (!bestMatch || match.score > bestMatch.score) {
        bestMatch = match;
      }
    }
    return bestMatch;
  }

  function scoreGuideEntry(preparedEntry, query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;

    const queryTokens = tokenizeQuery(normalizedQuery);
    if (!queryTokens.length) return null;

    const queryStems = queryTokens.map(stemToken);
    let score = 0;
    const reasons = [];
    let primaryMatch = null;

    for (let index = 0; index < queryTokens.length; index += 1) {
      const term = queryTokens[index];
      const stem = queryStems[index];
      let bestTermMatch = null;

      for (const rule of FIELD_RULES) {
        const fieldValue = preparedEntry._fields[rule.key];
        const match = rule.list
          ? matchListField(fieldValue, term, stem, rule)
          : matchScalarField(fieldValue, term, stem, rule);

        if (!match) continue;

        const candidate = {
          score: match.score,
          label: rule.label,
          snippet: match.snippet
        };

        if (!bestTermMatch || candidate.score > bestTermMatch.score) {
          bestTermMatch = candidate;
        }
      }

      if (!bestTermMatch) return null;

      score += bestTermMatch.score;
      if (!primaryMatch || bestTermMatch.score > primaryMatch.score) {
        primaryMatch = bestTermMatch;
      }

      const reasonKey = `${bestTermMatch.label}:${bestTermMatch.snippet}`;
      if (!reasons.some((item) => item.key === reasonKey)) {
        reasons.push({
          key: reasonKey,
          label: bestTermMatch.label,
          snippet: bestTermMatch.snippet
        });
      }
    }

    for (const rule of FIELD_RULES) {
      const fieldValue = preparedEntry._fields[rule.key];
      if (!fieldValue) continue;

      if (rule.list) {
        const phraseMatch = (fieldValue || []).find((value) => value.normalized.includes(normalizedQuery));
        if (phraseMatch) {
          score += rule.phrase;
          if (!primaryMatch || rule.phrase > primaryMatch.score) {
            primaryMatch = {
              score: rule.phrase,
              label: rule.label,
              snippet: phraseMatch.raw
            };
          }
        }
        continue;
      }

      if (fieldValue.normalized.includes(normalizedQuery)) {
        score += rule.phrase;
        if (!primaryMatch || rule.phrase > primaryMatch.score) {
          primaryMatch = {
            score: rule.phrase,
            label: rule.label,
            snippet: fieldValue.raw
          };
        }
      }
    }

    return {
      entry: preparedEntry,
      score,
      primaryMatch,
      reasons: reasons.slice(0, 3)
    };
  }

  function searchGuides(preparedGuides, query) {
    const results = (preparedGuides || [])
      .map((entry) => scoreGuideEntry(entry, query))
      .filter(Boolean);

    return results.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.entry.title || '').localeCompare(String(right.entry.title || ''), 'es');
    });
  }

  function formatMatch(match) {
    if (!match) return 'Coincide en el contenido de la guía';

    if (match.label === 'título') {
      return 'Coincide en el título';
    }
    if (match.label === 'resumen') {
      return 'Coincide en el resumen';
    }
    if (match.label === 'categoría') {
      return `Coincide en la categoría: ${match.snippet}`;
    }
    if (match.label === 'nivel') {
      return `Coincide en el nivel: ${match.snippet}`;
    }
    if (match.label === 'URL') {
      return `Coincide en la URL: ${match.snippet}`;
    }

    const clipped = normalizeWhitespace(match.snippet || '');
    if (!clipped) return `Coincide en ${match.label}`;
    const snippet = clipped.length > 120 ? `${clipped.slice(0, 117).trim()}…` : clipped;
    return `Coincide en ${match.label}: ${snippet}`;
  }

  function buildFallbackCard(documentRef, entry) {
    const card = documentRef.createElement('a');
    card.className = 'guide-card search-result-card';
    card.href = entry.path || '#';

    const header = documentRef.createElement('div');
    header.className = 'guide-header';

    const icon = documentRef.createElement('span');
    icon.className = 'guide-icon';
    icon.textContent = entry.icon || '📚';

    const body = documentRef.createElement('div');
    body.style.flex = '1';

    if (entry.level) {
      const meta = documentRef.createElement('div');
      meta.className = 'guide-meta';
      const tag = documentRef.createElement('span');
      tag.className = 'guide-tag';
      tag.textContent = entry.level;
      meta.appendChild(tag);
      body.appendChild(meta);
    }

    const title = documentRef.createElement('h3');
    title.textContent = entry.title || 'Guía';
    body.appendChild(title);

    header.appendChild(icon);
    header.appendChild(body);
    card.appendChild(header);

    const description = documentRef.createElement('p');
    description.textContent = entry.cardDescription || entry.description || '';
    card.appendChild(description);

    const arrow = documentRef.createElement('span');
    arrow.className = 'guide-arrow';
    arrow.textContent = '→';
    card.appendChild(arrow);

    return card;
  }

  function renderSearchResults(config, results, rawQuery) {
    const {
      documentRef,
      resultsContainer,
      statusElement,
      noResults,
      templateMap
    } = config;

    resultsContainer.innerHTML = '';

    if (!results.length) {
      if (statusElement) {
        statusElement.hidden = false;
        statusElement.textContent = `0 resultados para "${normalizeWhitespace(rawQuery)}"`;
        statusElement.dataset.state = 'empty';
      }
      noResults.classList.add('show');
      return;
    }

    if (statusElement) {
      statusElement.hidden = false;
      statusElement.textContent = `${results.length} resultado${results.length === 1 ? '' : 's'} para "${normalizeWhitespace(rawQuery)}"`;
      statusElement.dataset.state = 'ready';
    }

    noResults.classList.remove('show');

    for (const result of results) {
      const template = templateMap.get(result.entry.path);
      const card = template ? template.cloneNode(true) : buildFallbackCard(documentRef, result.entry);
      card.classList.add('search-result-card');

      card.querySelectorAll('.search-match').forEach((node) => node.remove());

      const match = documentRef.createElement('div');
      match.className = 'search-match';
      match.textContent = formatMatch(result.primaryMatch);

      const paragraph = card.querySelector('p');
      if (paragraph) {
        paragraph.after(match);
      } else {
        card.appendChild(match);
      }

      resultsContainer.appendChild(card);
    }
  }

  function updateUrlQuery(query) {
    if (!root.history || !root.location) return;
    try {
      const url = new URL(root.location.href);
      const value = normalizeWhitespace(query);
      if (value) url.searchParams.set('q', value);
      else url.searchParams.delete('q');
      root.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function init(options) {
    const documentRef = options?.document || root.document;
    if (!documentRef) return;

    const searchInput = options?.searchInput || documentRef.getElementById('searchInput');
    const guidesGrid = options?.guidesGrid || documentRef.getElementById('guidesGrid');
    const featuredBlock = options?.featuredBlock || documentRef.querySelector('.featured');
    const noResults = options?.noResults || documentRef.getElementById('noResults');
    const resultsContainer = options?.resultsContainer || documentRef.getElementById('searchResults');
    const statusElement = options?.statusElement || documentRef.getElementById('searchStatus');
    const categoryButtons = options?.categoryButtons || [...documentRef.querySelectorAll('.category-btn')];
    if (!searchInput || !guidesGrid || !noResults || !resultsContainer) return;

    const allCards = [...documentRef.querySelectorAll('.guide-card[href]')];
    const gridCards = [...guidesGrid.querySelectorAll('.guide-card[href]')];
    const templateMap = new Map();
    for (const card of allCards) {
      const pathname = canonicalPath(card.getAttribute('href'));
      if (pathname) templateMap.set(pathname, card.cloneNode(true));
    }

    const config = {
      documentRef,
      searchInput,
      guidesGrid,
      featuredBlock,
      noResults,
      resultsContainer,
      statusElement,
      categoryButtons,
      allCards,
      gridCards,
      templateMap
    };

    let preparedGuides = null;
    let indexPromise = null;

    function setActiveCategory(category) {
      categoryButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.category === category);
      });
    }

    function restoreFeaturedCards() {
      if (!featuredBlock) return;
      featuredBlock.querySelectorAll('.guide-card').forEach((card) => {
        card.style.display = 'flex';
      });
    }

    function applyCategory(category) {
      setActiveCategory(category);
      updateUrlQuery('');
      searchInput.value = '';

      if (statusElement) {
        statusElement.hidden = true;
        statusElement.textContent = '';
        statusElement.dataset.state = '';
      }

      resultsContainer.hidden = true;
      resultsContainer.innerHTML = '';
      guidesGrid.hidden = false;
      if (featuredBlock) featuredBlock.hidden = false;
      restoreFeaturedCards();

      let visibleCount = 0;
      gridCards.forEach((card) => {
        const matches = category === 'todas'
          ? true
          : String(card.dataset.categories || '')
              .split(/\s+/)
              .filter(Boolean)
              .includes(category);

        card.style.display = matches ? 'flex' : 'none';
        if (matches) visibleCount += 1;
      });

      noResults.classList.toggle('show', category !== 'todas' && visibleCount === 0);
    }

    async function ensureIndex() {
      if (preparedGuides) return preparedGuides;
      if (!indexPromise) {
        indexPromise = root.fetch(options?.indexUrl || DEFAULT_INDEX_URL, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Index request failed with ${response.status}`);
            }
            return response.json();
          })
          .then((payload) => {
            preparedGuides = prepareGuidesIndex(payload?.guides || []);
            return preparedGuides;
          });
      }
      return indexPromise;
    }

    function fallbackSearch(term) {
      const normalizedTerm = normalizeText(term);
      if (!normalizedTerm) {
        applyCategory('todas');
        return;
      }

      setActiveCategory('todas');
      if (featuredBlock) featuredBlock.hidden = false;
      guidesGrid.hidden = false;
      resultsContainer.hidden = true;
      resultsContainer.innerHTML = '';

      let visibleCount = 0;
      for (const card of allCards) {
        const title = normalizeText(card.querySelector('h3')?.textContent || '');
        const description = normalizeText(card.querySelector('p')?.textContent || '');
        const matches = title.includes(normalizedTerm) || description.includes(normalizedTerm);
        card.style.display = matches ? 'flex' : 'none';
        if (matches) visibleCount += 1;
      }

      if (featuredBlock) {
        const anyFeaturedVisible = [...featuredBlock.querySelectorAll('.guide-card')]
          .some((card) => card.style.display !== 'none');
        featuredBlock.hidden = !anyFeaturedVisible;
      }

      if (statusElement) {
        statusElement.hidden = false;
        statusElement.dataset.state = 'fallback';
        statusElement.textContent = visibleCount
          ? `${visibleCount} resultado${visibleCount === 1 ? '' : 's'} para "${normalizeWhitespace(term)}" (modo básico)`
          : `0 resultados para "${normalizeWhitespace(term)}"`;
      }

      noResults.classList.toggle('show', visibleCount === 0);
      updateUrlQuery(term);
    }

    async function applySearch(term) {
      const rawQuery = normalizeWhitespace(term);
      const normalizedQuery = normalizeText(rawQuery);

      setActiveCategory('todas');

      if (!normalizedQuery) {
        applyCategory('todas');
        return;
      }

      if (statusElement) {
        statusElement.hidden = false;
        statusElement.dataset.state = 'loading';
        statusElement.textContent = 'Buscando en títulos, FAQs y contenido…';
      }

      noResults.classList.remove('show');
      if (featuredBlock) featuredBlock.hidden = true;
      guidesGrid.hidden = true;
      resultsContainer.hidden = false;
      updateUrlQuery(rawQuery);

      try {
        const guides = await ensureIndex();
        const results = searchGuides(guides, rawQuery);
        renderSearchResults(config, results, rawQuery);
      } catch (_) {
        fallbackSearch(rawQuery);
      }
    }

    let searchTimer = null;
    searchInput.addEventListener('input', (event) => {
      root.clearTimeout(searchTimer);
      const term = event.target.value;
      searchTimer = root.setTimeout(() => {
        applySearch(term);
      }, 80);
    });

    categoryButtons.forEach((button) => {
      button.addEventListener('click', () => {
        applyCategory(button.dataset.category || 'todas');
      });
    });

    const initialQuery = new URLSearchParams(root.location?.search || '').get('q');
    if (initialQuery) {
      searchInput.value = initialQuery;
      applySearch(initialQuery);
    } else {
      applyCategory('todas');
    }

    const warmIndex = () => {
      ensureIndex().catch(() => {});
    };
    if (typeof root.requestIdleCallback === 'function') {
      root.requestIdleCallback(warmIndex, { timeout: 1500 });
    } else {
      root.setTimeout(warmIndex, 300);
    }
  }

  return {
    canonicalPath,
    formatMatch,
    init,
    normalizeText,
    prepareGuidesIndex,
    scoreGuideEntry,
    searchGuides,
    stemToken,
    tokenizeQuery
  };
});
