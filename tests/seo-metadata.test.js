/**
 * SEO metadata guardrails
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';

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
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'logs', 'scripts', 'vendor'].includes(entry.name)) continue;
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function loadPages() {
  const htmlFiles = walkHtmlFiles(REPO_ROOT);
  return htmlFiles.map((filePath) => {
    const relPath = path.relative(REPO_ROOT, filePath);
    const html = fs.readFileSync(filePath, 'utf8');

    const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const description = (html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) || [])[1] ||
                     (html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i) || [])[1] || '';

    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    let robots = '';
    let canonical = '';

    for (const tag of metaTags) {
      const attrs = parseAttributes(tag);
      const name = String(attrs.name || '').toLowerCase();
      const rel = String(attrs.rel || '').toLowerCase();
      const property = String(attrs.property || '').toLowerCase();

      if (name === 'robots') robots = String(attrs.content || '').toLowerCase();
      if (rel === 'canonical' || property === 'og:url') canonical = String(attrs.href || attrs.content || '').trim();
    }

    // Try finding <link rel="canonical">
    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
      const attrs = parseAttributes(tag);
      if (String(attrs.rel || '').toLowerCase() === 'canonical') {
        canonical = String(attrs.href || '').trim();
        break;
      }
    }

    return {
      relPath,
      html,
      title,
      description,
      robots,
      canonical,
      indexable: !robots.includes('noindex')
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

const pages = loadPages();

describe('SEO metadata guardrails', () => {
  it('keeps indexable snippets complete and bounded', () => {
    for (const page of pages) {
      if (!page.indexable) continue;

      expect(page.title.length).toBeGreaterThan(10);
      expect(page.title.length).toBeLessThan(100);
      expect(page.description.length).toBeGreaterThan(50);
      expect(page.description.length).toBeLessThan(300);
    }
  });

  it('uses valid canonical URLs on the main domain', () => {
    for (const page of pages) {
      if (!page.indexable) continue;

      const expectedUrl = pageUrlFromRelPath(page.relPath);
      expect(normalizeSiteUrl(page.canonical)).toBe(normalizeSiteUrl(expectedUrl));
    }
  });

  it('avoids duplicate title/description among indexable pages', () => {
    const titles = new Set();
    const descriptions = new Set();

    for (const page of pages) {
      if (!page.indexable) continue;

      if (titles.has(page.title)) {
        throw new Error(`Duplicate title found: "${page.title}" in ${page.relPath}`);
      }
      if (descriptions.has(page.description)) {
        throw new Error(`Duplicate description found: "${page.description}" in ${page.relPath}`);
      }

      titles.add(page.title);
      descriptions.add(page.description);
    }
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

  it('keeps structured data dateModified aligned with the current file revision', () => {
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
      }
    }

    expect(errors).toEqual([]);
  }, 15000);

  it('keeps sitemap lastmod aligned with current file revisions', () => {
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
  }, 15000);
});
