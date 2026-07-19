/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  getTodayMadridYmd,
  isSignificantlyDirty,
  parseSpanishShortDate,
  resolvePageDate,
  resolveSitemapLastmod
} from '../scripts/seo-date-logic.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'logs', 'scripts', 'vendor']);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSiteUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, BASE_URL);
    if (url.origin !== BASE_URL) return null;
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

function pageUrlFromRelPath(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (normalized === 'index.html') return `${BASE_URL}/`;
  if (normalized.endsWith('/index.html')) {
    return `${BASE_URL}/${normalized.slice(0, -'/index.html'.length)}/`;
  }
  return `${BASE_URL}/${normalized}`;
}

function parseAttributes(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const match of tag.matchAll(attrRegex)) {
    const key = String(match[1] || '').toLowerCase();
    const value = String(match[2] ?? match[3] ?? '').trim();
    attrs[key] = value;
  }

  return attrs;
}

function walkHtmlFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walkHtmlFiles(path.join(dirPath, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.join(dirPath, entry.name));
    }
  }

  return files;
}

function extractMeta(html) {
  const byName = new Map();
  const byProperty = new Map();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    const content = attrs.content || '';

    if (attrs.name) byName.set(attrs.name.toLowerCase(), content);
    if (attrs.property) byProperty.set(attrs.property.toLowerCase(), content);
  }

  return { byName, byProperty };
}

function extractCanonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    if (String(attrs.rel || '').toLowerCase() === 'canonical') {
      return String(attrs.href || '').trim();
    }
  }

  return '';
}

function loadPages() {
  const htmlFiles = walkHtmlFiles(REPO_ROOT).sort();
  return htmlFiles.map((filePath) => {
    const relPath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
    const html = fs.readFileSync(filePath, 'utf8');
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = normalizeWhitespace(titleMatch?.[1] || '');
    const { byName, byProperty } = extractMeta(html);
    const description = normalizeWhitespace(byName.get('description') || '');
    const robots = normalizeWhitespace(byName.get('robots') || '').toLowerCase();
    const canonical = extractCanonical(html);

    return {
      relPath,
      html,
      title,
      description,
      robots,
      canonical,
      indexable: !robots.includes('noindex'),
      ogTitle: normalizeWhitespace(byProperty.get('og:title') || ''),
      ogDescription: normalizeWhitespace(byProperty.get('og:description') || ''),
      twitterCard: normalizeWhitespace(byName.get('twitter:card') || '')
    };
  });
}

function extractDateModifiedValues(html) {
  const values = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const script of scripts) {
    for (const match of script.matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)) {
      values.push(String(match[1] || '').trim());
    }
  }

  return values;
}

function extractJsonLdObjects(html) {
  const objects = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const script of scripts) {
    const jsonMatch = script.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonMatch?.[1]) continue;

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        objects.push(...parsed.filter((item) => item && typeof item === 'object'));
      } else if (parsed && typeof parsed === 'object') {
        objects.push(parsed);
      }
    } catch {
      // Invalid JSON-LD is covered elsewhere; skip here to keep this guardrail focused.
    }
  }

  return objects;
}

function extractVisibleGuidePublishedDate(html) {
  const match = html.match(
    /<div class="article-meta">[\s\S]*?<span>Por <strong>[\s\S]*?<\/strong><\/span><span>·<\/span><span>([^<]+)<\/span>/i
  );
  return normalizeWhitespace(match?.[1] || '');
}

function extractVisibleGuideUpdatedDate(html) {
  const match = html.match(/<span class="updated-badge">[^<]*Act\.\s*([^<]+)<\/span>/i);
  return normalizeWhitespace(match?.[1] || '');
}

const dirtyPathCache = new Map();

function runGit(args) {
  try {
    return String(
      execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
    ).trim();
  } catch {
    return '';
  }
}

function isSignificantlyDirtyPath(relPath) {
  if (dirtyPathCache.has(relPath)) return dirtyPathCache.get(relPath);

  let dirty;
  const status = runGit(['status', '--porcelain', '--', relPath]);
  if (!status.length) {
    dirty = false;
  } else {
    const committed = runGit(['show', `HEAD:${relPath.split(path.sep).join('/')}`]);
    const current = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    dirty = isSignificantlyDirty({ status, currentContent: current, committedContent: committed });
  }

  dirtyPathCache.set(relPath, dirty);
  return dirty;
}

function getExpectedDate(relPath) {
  return resolvePageDate({
    dirty: isSignificantlyDirtyPath(relPath),
    content: fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'),
    today: getTodayMadridYmd(),
    gitLastModifiedDate: ''
  });
}

// Para el check de sitemap: cuando la pagina no tiene su propia fecha
// estampada (index.html y estadisticas/index.html no llevan dateModified en
// su JSON-LD), sync-seo-docs.mjs conserva el lastmod YA presente en
// sitemap.xml en vez de derivarlo de `git log` (ese fallback es lo que
// causaba el fallo de dia limite: HEAD apunta al commit anterior en local y
// al commit nuevo en CI, dando fechas distintas). Este check debe reflejar
// exactamente esa logica de produccion (getSitemapLastmod en
// scripts/sync-seo-docs.mjs) en vez de una fuente independiente basada en git.
function getSitemapExpectedDate(relPath, actualLastmod) {
  return resolveSitemapLastmod({
    dirty: isSignificantlyDirtyPath(relPath),
    content: fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'),
    existingLastmod: actualLastmod,
    today: getTodayMadridYmd(),
    gitLastModifiedDate: ''
  });
}

function getMadridOffsetForDate(ymd) {
  const date = new Date(`${ymd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'shortOffset'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const match = String(map.timeZoneName || '').match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/);
  const hours = match ? match[1] : '+00';
  const minutes = match?.[2] || '00';
  const sign = hours.startsWith('-') ? '-' : '+';
  const hourDigits = hours.replace(/^[-+]/, '').padStart(2, '0');
  return `${sign}${hourDigits}:${minutes}`;
}

const pages = loadPages();

describe('SEO metadata guardrails', () => {
  it('preloads the normal and headline font weights used above the fold on the home page', () => {
    const home = pages.find((page) => page.relPath === 'index.html');
    const preloadedFonts = [...String(home?.html || '').matchAll(
      /<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']font["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi
    )].map((match) => match[1]);

    expect(preloadedFonts).toContain('/fonts/outfit-latin-400-normal.woff2');
    expect(preloadedFonts).toContain('/fonts/outfit-latin-900-normal.woff2');
  });

  it('keeps indexable snippets complete and bounded', () => {
    const errors = [];

    for (const page of pages) {
      if (!page.title) errors.push(`${page.relPath}: missing <title>`);
      if (!page.description) errors.push(`${page.relPath}: missing meta description`);
      if (!page.canonical) errors.push(`${page.relPath}: missing canonical`);

      if (!page.indexable) continue;

      if (page.title.length < 30 || page.title.length > 65) {
        errors.push(`${page.relPath}: title length ${page.title.length} outside 30-65`);
      }

      if (page.description.length < 70 || page.description.length > 160) {
        errors.push(`${page.relPath}: description length ${page.description.length} outside 70-160`);
      }

      if (!page.ogTitle) errors.push(`${page.relPath}: missing og:title`);
      if (!page.ogDescription) errors.push(`${page.relPath}: missing og:description`);
      if (!page.twitterCard) errors.push(`${page.relPath}: missing twitter:card`);
    }

    expect(errors).toEqual([]);
  });

  it('uses valid canonical URLs on the main domain', () => {
    const errors = [];

    for (const page of pages) {
      if (!page.canonical) continue;
      if (/[?#]/.test(page.canonical)) {
        errors.push(`${page.relPath}: canonical should not include query/hash`);
        continue;
      }

      const normalized = normalizeSiteUrl(page.canonical);
      if (!normalized) {
        errors.push(`${page.relPath}: canonical is outside ${BASE_URL}`);
        continue;
      }

      if (!page.indexable) continue;

      const expectedUrl = normalizeSiteUrl(pageUrlFromRelPath(page.relPath));
      if (normalized !== expectedUrl) {
        errors.push(`${page.relPath}: canonical ${normalized} does not match expected ${expectedUrl}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('avoids duplicate title/description among indexable pages', () => {
    const errors = [];
    const titleMap = new Map();
    const descriptionMap = new Map();

    for (const page of pages) {
      if (!page.indexable) continue;

      const titleKey = page.title.toLowerCase();
      const descKey = page.description.toLowerCase();

      if (titleKey) {
        const titleList = titleMap.get(titleKey) || [];
        titleList.push(page.relPath);
        titleMap.set(titleKey, titleList);
      }

      if (descKey) {
        const descList = descriptionMap.get(descKey) || [];
        descList.push(page.relPath);
        descriptionMap.set(descKey, descList);
      }
    }

    for (const [title, files] of titleMap.entries()) {
      if (files.length > 1) {
        errors.push(`duplicate title "${title}" in: ${files.join(', ')}`);
      }
    }

    for (const [description, files] of descriptionMap.entries()) {
      if (files.length > 1) {
        errors.push(`duplicate description "${description}" in: ${files.join(', ')}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('keeps sitemap aligned with index/noindex pages', () => {
    const sitemapPath = path.join(REPO_ROOT, 'sitemap.xml');
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const sitemapUrls = new Set(
      [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => normalizeSiteUrl(m[1]))
    );

    const errors = [];
    for (const page of pages) {
      const pageUrl = pageUrlFromRelPath(page.relPath);
      const normalizedPageUrl = normalizeSiteUrl(pageUrl);

      if (!normalizedPageUrl) {
        errors.push(`${page.relPath}: could not normalize page URL ${pageUrl}`);
        continue;
      }

      if (page.indexable && !sitemapUrls.has(normalizedPageUrl)) {
        errors.push(`${page.relPath}: indexable URL missing in sitemap (${pageUrl})`);
      }

      if (!page.indexable && sitemapUrls.has(normalizedPageUrl)) {
        errors.push(`${page.relPath}: noindex URL present in sitemap (${pageUrl})`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('keeps structured data dateModified aligned with the current file revision', { timeout: 60000 }, () => {
    const errors = [];

    for (const page of pages) {
      const values = extractDateModifiedValues(page.html);
      if (!values.length) continue;

      const expected = getExpectedDate(page.relPath);
      if (!expected) {
        errors.push(`${page.relPath}: missing git history for dateModified check`);
        continue;
      }

      for (const value of values) {
        if (!value.startsWith(expected)) {
          errors.push(`${page.relPath}: dateModified ${value} does not match git ${expected}`);
        }

        const offsetMatch = value.match(/([+-]\d{2}:\d{2})$/);
        if (offsetMatch) {
          const expectedOffset = getMadridOffsetForDate(expected);
          if (offsetMatch[1] !== expectedOffset) {
            errors.push(`${page.relPath}: dateModified ${value} has offset ${offsetMatch[1]} but Europe/Madrid is ${expectedOffset}`);
          }
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('keeps guide published dates aligned between visible metadata and structured data', () => {
    const errors = [];

    for (const page of pages) {
      if (!page.relPath.startsWith('guias/') || page.relPath === 'guias/index.html') continue;

      const articleNode = extractJsonLdObjects(page.html).find(
        (node) => normalizeWhitespace(node?.['@type'] || '').toLowerCase() === 'article'
      );
      const datePublished = String(articleNode?.datePublished || '').trim().slice(0, 10);
      const visibleDate = parseSpanishShortDate(extractVisibleGuidePublishedDate(page.html));

      if (!datePublished) {
        errors.push(`${page.relPath}: missing Article.datePublished`);
        continue;
      }

      if (!visibleDate) {
        errors.push(`${page.relPath}: missing or unparsable visible publish date`);
        continue;
      }

      if (datePublished !== visibleDate) {
        errors.push(`${page.relPath}: datePublished ${datePublished} does not match visible ${visibleDate}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('keeps guide update badges aligned with structured data dateModified', () => {
    const errors = [];

    for (const page of pages) {
      if (!page.relPath.startsWith('guias/') || page.relPath === 'guias/index.html') continue;

      const articleNode = extractJsonLdObjects(page.html).find(
        (node) => normalizeWhitespace(node?.['@type'] || '').toLowerCase() === 'article'
      );
      const dateModified = String(articleNode?.dateModified || '').trim().slice(0, 10);
      const visibleDate = parseSpanishShortDate(extractVisibleGuideUpdatedDate(page.html));

      if (!dateModified) {
        errors.push(`${page.relPath}: missing Article.dateModified`);
        continue;
      }

      if (!visibleDate) {
        errors.push(`${page.relPath}: missing or unparsable visible updated date`);
        continue;
      }

      if (dateModified !== visibleDate) {
        errors.push(`${page.relPath}: dateModified ${dateModified} does not match updated badge ${visibleDate}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('keeps sitemap lastmod aligned with current file revisions', { timeout: 20000 }, () => {
    const sitemapPath = path.join(REPO_ROOT, 'sitemap.xml');
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const urlBlocks = [...sitemap.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/gi)];
    const pageByUrl = new Map(
      pages.map((page) => [normalizeSiteUrl(pageUrlFromRelPath(page.relPath)), page])
    );
    const errors = [];

    for (const [, block] of urlBlocks) {
      const locMatch = String(block || '').match(/<loc>([^<]+)<\/loc>/i);
      const lastmodMatch = String(block || '').match(/<lastmod>([^<]+)<\/lastmod>/i);
      const normalizedLoc = normalizeSiteUrl(String(locMatch?.[1] || '').trim());

      if (!normalizedLoc) continue;

      const page = pageByUrl.get(normalizedLoc);
      if (!page || !page.indexable) continue;

      const actual = String(lastmodMatch?.[1] || '').trim();
      const expected = getSitemapExpectedDate(page.relPath, actual);

      if (!expected) {
        errors.push(`${page.relPath}: missing lastmod for sitemap check`);
        continue;
      }

      if (actual !== expected) {
        errors.push(`${page.relPath}: sitemap lastmod ${actual} does not match expected ${expected}`);
      }
    }

    expect(errors).toEqual([]);
  });
});
