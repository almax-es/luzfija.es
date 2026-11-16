import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—'
  };
  return String(value || '').replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (full, key) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x';
      const n = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    return Object.prototype.hasOwnProperty.call(named, key.toLowerCase()) ? named[key.toLowerCase()] : full;
  });
}

function htmlToText(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '')));
}

function extractJsonFaqMap(html) {
  const map = new Map();
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    let parsed;
    try { parsed = JSON.parse(match[1]); } catch { continue; }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const item = queue.shift();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
      if (item['@type'] !== 'FAQPage' || !Array.isArray(item.mainEntity)) continue;
      for (const entity of item.mainEntity) {
        const q = normalizeWhitespace(entity?.name);
        const a = normalizeWhitespace(entity?.acceptedAnswer?.text);
        if (q && a) map.set(q, a);
      }
    }
  }
  return map;
}

function pushPair(out, seen, questionHtml, answerHtml) {
  const q = htmlToText(questionHtml);
  const a = htmlToText(answerHtml);
  const key = `${q}\u0000${a}`;
  if (q && a && !seen.has(key)) {
    seen.add(key);
    out.push({ question: q, answer: a });
  }
}

function extractVisibleFaqPairs(html) {
  const out = [];
  const seen = new Set();

  for (const match of html.matchAll(/<details\b[^>]*class=["'][^"']*\bfaq-item\b[^"']*["'][^>]*>([\s\S]*?)<\/details>/gi)) {
    const block = match[1];
    const summary = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!summary) continue;
    pushPair(out, seen, summary[1], block.replace(summary[0], ''));
  }

  const faqSection = html.match(/<section\b[^>]*id=["']faq["'][^>]*>([\s\S]*?)<\/section>/i);
  if (faqSection) {
    for (const match of faqSection[1].matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi)) {
      const block = match[1];
      const summary = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
      if (!summary) continue;
      pushPair(out, seen, summary[1], block.replace(summary[0], ''));
    }
  }

  const faqList = html.match(/<div\b[^>]*class=["'][^"']*\bfaq-list\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (faqList) {
    for (const match of faqList[1].matchAll(/<article\b[^>]*class=["'][^"']*\bfaq-item\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
      const block = match[1];
      const heading = block.match(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/i);
      if (!heading) continue;
      pushPair(out, seen, heading[1], block.replace(heading[0], ''));
    }
  }

  for (const details of html.matchAll(/<details\b[^>]*class=["'][^"']*\bseoDetails\b[^"']*["'][^>]*>([\s\S]*?)<\/details>/gi)) {
    const block = details[1];
    const summary = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!summary || !/preguntas frecuentes/i.test(htmlToText(summary[1]))) continue;
    const content = block.match(/<div\b[^>]*class=["'][^"']*\bseoContent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || block;
    const headings = [...content.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    for (let i = 0; i < headings.length; i += 1) {
      const start = headings[i].index + headings[i][0].length;
      const end = i + 1 < headings.length ? headings[i + 1].index : content.length;
      pushPair(out, seen, headings[i][1], content.slice(start, end));
    }
  }

  return out;
}

export function auditFaqJsonLdSync(root = DEFAULT_ROOT) {
  const issues = [];
  let visiblePairs = 0;
  const files = [];
  const dirs = ['.', 'guias', 'estadisticas'];
  for (const dir of dirs) {
    const abs = path.resolve(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.html')) files.push(path.join(abs, entry.name));
    }
  }

  for (const file of files.sort()) {
    const html = fs.readFileSync(file, 'utf8');
    const visible = extractVisibleFaqPairs(html);
    if (!visible.length) continue;
    const faqMap = extractJsonFaqMap(html);
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (const pair of visible) {
      visiblePairs += 1;
      if (!faqMap.has(pair.question)) {
        issues.push(`${rel}: FAQ visible ausente en FAQPage: ${pair.question}`);
      } else if (faqMap.get(pair.question) !== pair.answer) {
        issues.push(`${rel}: respuesta distinta entre FAQ visible y FAQPage: ${pair.question}`);
      }
    }
  }

  return { filesChecked: files.length, visiblePairs, issues };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  const result = auditFaqJsonLdSync(root);
  console.log(`FAQ visibles comprobadas: ${result.visiblePairs}; HTML: ${result.filesChecked}; incidencias: ${result.issues.length}`);
  for (const issue of result.issues) console.error(issue);
  if (result.issues.length) process.exitCode = 1;
}
