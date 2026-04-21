import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';
const GUIDE_LIST_REL = 'guias.html';
const GUIDES_DIR_REL = 'guias';
const OUTPUT_REL = 'data/guides-search-index.json';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function canonicalPath(href) {
  try {
    return new URL(String(href || ''), BASE_URL).pathname;
  } catch {
    return null;
  }
}

function slugToWords(relPath) {
  return path.basename(relPath, '.html').replace(/-/g, ' ').trim();
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function textContent(node) {
  return normalizeWhitespace(node?.textContent || '');
}

function splitKeywords(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function truncateAtWordBoundary(value, maxLength) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 120 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

function collectGuideCardMetadata(repoRoot) {
  const dom = new JSDOM(readUtf8(path.join(repoRoot, GUIDE_LIST_REL)));
  const doc = dom.window.document;
  const metadata = new Map();

  doc.querySelectorAll('.guide-card[href]').forEach((card) => {
    const pathname = canonicalPath(card.getAttribute('href'));
    if (!pathname) return;

    metadata.set(pathname, {
      cardTitle: textContent(card.querySelector('h3')),
      cardDescription: textContent(card.querySelector('p')),
      categories: String(card.dataset.categories || '')
        .split(/\s+/)
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean),
      level: textContent(card.querySelector('.guide-tag')),
      icon: textContent(card.querySelector('.guide-icon'))
    });
  });

  return metadata;
}

function extractArticleMetadata(doc) {
  const ldJsonBlocks = [...doc.querySelectorAll('script[type="application/ld+json"]')]
    .map((node) => {
      try {
        return JSON.parse(node.textContent || '');
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const articleBlock = ldJsonBlocks.find((item) => item['@type'] === 'Article');
  return {
    datePublished: normalizeWhitespace(articleBlock?.datePublished || ''),
    dateModified: normalizeWhitespace(articleBlock?.dateModified || '')
  };
}

function extractGuideEntry(repoRoot, relPath, cardMetadata) {
  const fullPath = path.join(repoRoot, relPath);
  const dom = new JSDOM(readUtf8(fullPath));
  const doc = dom.window.document;
  const pathname = `/${relPath.split(path.sep).join('/')}`;
  const cardMeta = cardMetadata.get(pathname) || {};

  const title =
    textContent(doc.querySelector('h1')) ||
    normalizeWhitespace(doc.title).replace(/\s*\|\s*LuzFija(?:\.es)?$/i, '');
  const metaDescription = normalizeWhitespace(
    doc.querySelector('meta[name="description"]')?.getAttribute('content') || ''
  );
  const intro = textContent(doc.querySelector('.article-intro'));
  const headings = [...doc.querySelectorAll('.article-content h2, .article-content h3')]
    .map((node) => textContent(node))
    .filter(Boolean);
  const faq = [...doc.querySelectorAll('.faq-item summary')]
    .map((node) => textContent(node))
    .filter(Boolean);
  const contentBlocks = [...doc.querySelectorAll('.article-content p, .article-content li')]
    .map((node) => textContent(node))
    .filter(Boolean);
  const content = truncateAtWordBoundary(contentBlocks.join(' '), 6000);
  const metadata = extractArticleMetadata(doc);

  const aliases = new Set([
    ...splitKeywords(doc.querySelector('meta[name="keywords"]')?.getAttribute('content') || ''),
    ...(cardMeta.categories || []),
    cardMeta.level || '',
    cardMeta.cardTitle || '',
    slugToWords(relPath)
  ]);

  return {
    path: pathname,
    title,
    description: cardMeta.cardDescription || metaDescription || intro,
    metaDescription,
    intro,
    cardDescription: cardMeta.cardDescription || '',
    categories: cardMeta.categories || [],
    level: cardMeta.level || '',
    icon: cardMeta.icon || '',
    slug: slugToWords(relPath),
    headings,
    faq,
    aliases: [...aliases].filter(Boolean),
    content,
    datePublished: metadata.datePublished,
    dateModified: metadata.dateModified
  };
}

export function buildGuidesSearchIndex(repoRoot = REPO_ROOT) {
  const guidesDir = path.join(repoRoot, GUIDES_DIR_REL);
  const cardMetadata = collectGuideCardMetadata(repoRoot);
  const guideFiles = fs.readdirSync(guidesDir)
    .filter((name) => name.endsWith('.html') && name !== 'index.html')
    .sort();

  const guides = guideFiles.map((name) => extractGuideEntry(repoRoot, path.join(GUIDES_DIR_REL, name), cardMetadata));

  return {
    generatedAtUtc: new Date().toISOString(),
    totalGuides: guides.length,
    guides
  };
}

export function syncGuidesSearchIndex(repoRoot = REPO_ROOT) {
  const payload = buildGuidesSearchIndex(repoRoot);
  const outputPath = path.join(repoRoot, OUTPUT_REL);
  const next = JSON.stringify(payload);
  const current = fs.existsSync(outputPath) ? readUtf8(outputPath) : '';

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (current !== next) {
    fs.writeFileSync(outputPath, next, 'utf8');
  }

  return payload;
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectExecution) {
  syncGuidesSearchIndex();
}
