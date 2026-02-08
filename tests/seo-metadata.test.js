/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'logs']);

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

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function normalizeSiteUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, BASE_URL);
    if (url.origin !== BASE_URL) return null;

    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

function pageUrlFromRelPath(relPath) {
  if (relPath === 'index.html') return `${BASE_URL}/`;
  if (relPath.endsWith('/index.html')) {
    const section = relPath.slice(0, -'/index.html'.length);
    return `${BASE_URL}/${section}/`;
  }
  return `${BASE_URL}/${relPath}`;
}

function loadPages() {
  const files = walkHtmlFiles(REPO_ROOT).sort();

  return files.map((filePath) => {
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

const pages = loadPages();

describe('SEO metadata guardrails', () => {
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
      if (!normalized) errors.push(`${page.relPath}: canonical is outside ${BASE_URL}`);
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
    const locMatches = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gi)];
    const sitemapUrls = new Set(
      locMatches
        .map((match) => normalizeSiteUrl(String(match[1] || '').trim()))
        .filter(Boolean)
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
});
