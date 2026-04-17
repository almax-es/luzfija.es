/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

const gitDateCache = new Map();
const dirtyPathCache = new Map();

function isDirtyPath(relPath) {
  if (dirtyPathCache.has(relPath)) return dirtyPathCache.get(relPath);

  let dirty = false;
  try {
    dirty = String(
      execFileSync('git', ['status', '--porcelain', '--', relPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    ).trim().length > 0;
  } catch {
    dirty = false;
  }

  dirtyPathCache.set(relPath, dirty);
  return dirty;
}

function getTodayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getGitLastModifiedDate(relPath) {
  if (gitDateCache.has(relPath)) return gitDateCache.get(relPath);

  let value = '';
  try {
    value = String(
      execFileSync('git', ['log', '-1', '--format=%cs', '--', relPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    ).trim();
  } catch {
    value = '';
  }

  gitDateCache.set(relPath, value);
  return value;
}

function getExpectedDate(relPath) {
  return isDirtyPath(relPath) ? getTodayDate() : getGitLastModifiedDate(relPath);
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

  it('keeps structured data dateModified aligned with the current file revision', { timeout: 20000 }, () => {
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

      const expected = getExpectedDate(page.relPath);
      const actual = String(lastmodMatch?.[1] || '').trim();

      if (!expected) {
        errors.push(`${page.relPath}: missing git history for sitemap lastmod check`);
        continue;
      }

      if (actual !== expected) {
        errors.push(`${page.relPath}: sitemap lastmod ${actual} does not match git ${expected}`);
      }
    }

    expect(errors).toEqual([]);
  });
});
