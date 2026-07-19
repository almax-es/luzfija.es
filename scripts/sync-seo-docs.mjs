import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { syncGuidesSearchIndex } from './build-guides-search-index.mjs';
import {
  getTodayMadridYmd,
  isSignificantlyDirty as isSignificantlyDirtyContent,
  resolvePageDate,
  resolveSitemapLastmod
} from './seo-date-logic.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';
const INCLUDE_REPO_DOCS = process.argv.includes('--include-repo-docs');
const HTML_SKIP_DIRS = new Set(['.git', 'node_modules', 'logs', 'scripts', 'vendor']);
const VITEST_SUMMARY_PATH = path.join(REPO_ROOT, 'logs', 'vitest-summary.json');

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

const TODAY_YMD = getTodayMadridYmd();
const gitDateCache = new Map();
const gitDirtyCache = new Map();

// Cambios "volátiles" que el deploy introduce en TODOS los HTML sin que el
// contenido real cambie: cache-busting ?v= (BumpAssets), hashes sha256 del CSP
// (FixCspHashes), el propio dateModified y las fechas visibles que estampa este
// script. Se enmascaran antes de comparar con la versión commiteada para decidir
// si un archivo cambió DE VERDAD. Sin esto, el bump de ?v= del deploy marcaba
// dirty los ~40 HTML del sitio y se estampaba la fecha de HOY en todos, en cada
// deploy (con varios deploys/día = fechas falsas perpetuas para Google y lectores).
function isSignificantlyDirty(relPath) {
  if (gitDirtyCache.has(relPath)) return gitDirtyCache.get(relPath);
  let dirty;
  const status = runGit(['status', '--porcelain', '--', relPath]);
  if (!status.length) {
    dirty = false; // idéntico a HEAD
  } else {
    const committed = runGit(['show', `HEAD:${relPath.split(path.sep).join('/')}`]);
    dirty = isSignificantlyDirtyContent({
      status,
      currentContent: readUtf8(relPath),
      committedContent: committed
    });
  }
  gitDirtyCache.set(relPath, dirty);
  return dirty;
}

function getGitLastModifiedDate(relPath) {
  if (gitDateCache.has(relPath)) return gitDateCache.get(relPath);
  const value = runGit(['log', '-1', '--format=%cs', '--', relPath]) || TODAY_YMD;
  gitDateCache.set(relPath, value);
  return value;
}

// Fecha ya declarada dentro del propio HTML. Es la fuente de verdad cuando NO hay
// cambio real: el "último commit que tocó el archivo" de git NO sirve como fallback
// para HTML, porque cada deploy commitea el bump de ?v= en todos ellos.
function getExpectedDate(relPath) {
  return resolvePageDate({
    dirty: isSignificantlyDirty(relPath),
    content: readUtf8(relPath),
    today: TODAY_YMD,
    gitLastModifiedDate: getGitLastModifiedDate(relPath)
  });
}

// Fallback autorreferencial para las fechas visibles de SEO (dateModified,
// badge "Act.", texto de privacidad): si el archivo no cambió de forma
// significativa, lee el valor YA presente en el propio archivo en vez de
// derivar de `git log`. `git log -1` de un archivo que solo recibió el bump
// trivial de ?v= devuelve la fecha del commit más reciente que lo tocó, y esa
// fecha cambia según si se consulta ANTES de crear ese commit (el .bat local,
// con HEAD = commit anterior) o DESPUÉS (CI, con HEAD = el commit nuevo ya
// creado) -> fechas distintas entre el commit local y la reejecución de CI, y
// el guard "Verify synchronized repo state" falla en el primer deploy de cada
// día. Ver conversación 18/07/2026.
function getPageDate(relPath) {
  return resolvePageDate({
    dirty: isSignificantlyDirty(relPath),
    content: readUtf8(relPath),
    today: TODAY_YMD,
    gitLastModifiedDate: getGitLastModifiedDate(relPath)
  });
}

function getSitemapLastmod(relPath, existingLastmod) {
  return resolveSitemapLastmod({
    dirty: isSignificantlyDirty(relPath),
    content: readUtf8(relPath),
    existingLastmod,
    today: TODAY_YMD,
    gitLastModifiedDate: getGitLastModifiedDate(relPath)
  });
}

function readUtf8(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

function writeUtf8(relPath, content) {
  fs.writeFileSync(path.join(REPO_ROOT, relPath), content, 'utf8');
}

function updateFile(relPath, transform) {
  const current = readUtf8(relPath);
  const next = transform(current);
  if (next !== current) writeUtf8(relPath, next);
}

function ensureAuxDirs() {
  fs.mkdirSync(path.dirname(VITEST_SUMMARY_PATH), { recursive: true });
}

function walkHtmlFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (HTML_SKIP_DIRS.has(entry.name)) continue;
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function walkFiles(dirPath, predicate) {
  const files = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (HTML_SKIP_DIRS.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath, entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return files;
}

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

function parseExistingSitemapEntries(content) {
  const entries = [];
  const urlBlocks = [...content.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/gi)];

  for (const [, block] of urlBlocks) {
    const locMatch = String(block || '').match(/<loc>([^<]+)<\/loc>/i);
    const lastmodMatch = String(block || '').match(/<lastmod>([^<]+)<\/lastmod>/i);
    const changefreqMatch = String(block || '').match(/<changefreq>([^<]+)<\/changefreq>/i);
    const priorityMatch = String(block || '').match(/<priority>([^<]+)<\/priority>/i);
    const normalizedLoc = normalizeSiteUrl(String(locMatch?.[1] || '').trim());

    if (!normalizedLoc) continue;

    entries.push({
      loc: normalizedLoc,
      lastmod: String(lastmodMatch?.[1] || '').trim(),
      changefreq: String(changefreqMatch?.[1] || '').trim(),
      priority: String(priorityMatch?.[1] || '').trim()
    });
  }

  return entries;
}

function loadPages() {
  const htmlFiles = walkHtmlFiles(REPO_ROOT).sort();

  return htmlFiles.map((filePath) => {
    const relPath = path.relative(REPO_ROOT, filePath);
    const html = fs.readFileSync(filePath, 'utf8');
    const { byName } = extractMeta(html);
    const robots = normalizeWhitespace(byName.get('robots') || '').toLowerCase();
    const normalizedRelPath = relPath.split(path.sep).join('/');
    const pageUrl = pageUrlFromRelPath(relPath);

    return {
      relPath,
      normalizedRelPath,
      url: pageUrl,
      normalizedUrl: normalizeSiteUrl(pageUrl),
      indexable: !robots.includes('noindex')
    };
  });
}

function relPathFromSiteUrl(siteUrl) {
  const url = new URL(siteUrl);
  if (url.origin !== BASE_URL) return null;
  if (url.pathname === '/') return 'index.html';
  if (url.pathname.endsWith('/')) return `${url.pathname.slice(1)}index.html`.replace(/\//g, path.sep);
  return url.pathname.slice(1).replace(/\//g, path.sep);
}

function getMadridOffsetParts(ymd) {
  const date = new Date(`${ymd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'shortOffset'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const offsetMatch = String(map.timeZoneName || '').match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/);
  const offsetHours = offsetMatch ? offsetMatch[1] : '+00';
  const offsetMinutes = offsetMatch?.[2] || '00';
  const offsetSign = offsetHours.startsWith('-') ? '-' : '+';
  const offsetHourDigits = offsetHours.replace(/^[-+]/, '').padStart(2, '0');

  return {
    compact: `${offsetSign}${offsetHourDigits}${offsetMinutes}`,
    iso: `${offsetSign}${offsetHourDigits}:${offsetMinutes}`
  };
}

function replaceDateModified(content, ymd) {
  const expectedOffset = getMadridOffsetParts(ymd).iso;
  return content.replace(
    /("dateModified"\s*:\s*")(\d{4}-\d{2}-\d{2})([^"]*)(")/g,
    (_, prefix, _date, suffix, quote) => {
      const normalizedSuffix = String(suffix || '').replace(/([+-]\d{2}:\d{2})$/, expectedOffset);
      return `${prefix}${ymd}${normalizedSuffix}${quote}`;
    }
  );
}

function formatSpanishShortDate(ymd) {
  const [year, month, day] = String(ymd || '').split('-');
  const months = {
    '01': 'ene',
    '02': 'feb',
    '03': 'mar',
    '04': 'abr',
    '05': 'may',
    '06': 'jun',
    '07': 'jul',
    '08': 'ago',
    '09': 'sep',
    '10': 'oct',
    '11': 'nov',
    '12': 'dic'
  };

  if (!year || !month || !day || !months[month]) return String(ymd || '');
  return `${Number(day)} ${months[month]} ${year}`;
}

function formatSpanishLongDate(ymd) {
  const [year, month, day] = String(ymd || '').split('-');
  const months = {
    '01': 'enero',
    '02': 'febrero',
    '03': 'marzo',
    '04': 'abril',
    '05': 'mayo',
    '06': 'junio',
    '07': 'julio',
    '08': 'agosto',
    '09': 'septiembre',
    '10': 'octubre',
    '11': 'noviembre',
    '12': 'diciembre'
  };

  if (!year || !month || !day || !months[month]) return String(ymd || '');
  return `${Number(day)} de ${months[month]} de ${year}`;
}

function replaceVisibleUpdatedBadge(content, ymd) {
  return content.replace(
    /(<span class="updated-badge">[^<]*Act\.\s*)([^<]+)(<\/span>)/g,
    `$1${formatSpanishShortDate(ymd)}$3`
  );
}

function replaceVisibleUpdatedDate(content, ymd) {
  return content.replace(
    /(Última actualización:\s*)([^<]+)(<\/em><\/p>)/i,
    `$1${formatSpanishLongDate(ymd)}$3`
  );
}

function syncHtmlDateMetadata() {
  for (const filePath of walkHtmlFiles(REPO_ROOT)) {
    const relPath = path.relative(REPO_ROOT, filePath);
    const normalizedRelPath = relPath.split(path.sep).join('/');
    const expectedDate = getPageDate(relPath);

    updateFile(relPath, (content) => {
      let next = replaceDateModified(content, expectedDate);

      if (normalizedRelPath.startsWith('guias/') && normalizedRelPath !== 'guias/index.html') {
        next = replaceVisibleUpdatedBadge(next, expectedDate);
      }

      if (normalizedRelPath === 'privacidad.html') {
        next = replaceVisibleUpdatedDate(next, expectedDate);
      }

      return next;
    });
  }
}

function syncSitemap() {
  updateFile('sitemap.xml', (content) => {
    const currentEntries = parseExistingSitemapEntries(content);
    const currentByUrl = new Map(currentEntries.map((entry) => [entry.loc, entry]));
    const currentOrder = new Map(currentEntries.map((entry, index) => [entry.loc, index]));
    const pages = loadPages()
      .filter((page) => page.indexable && page.normalizedUrl)
      .map((page) => {
        const existing = currentByUrl.get(page.normalizedUrl) || {};
        const relPath = relPathFromSiteUrl(page.url);
        let changefreq = existing.changefreq || 'monthly';
        let priority = existing.priority || '0.7';

        if (!existing.changefreq || !existing.priority) {
          if (page.normalizedRelPath === 'index.html') {
            changefreq = 'daily';
            priority = '1.0';
          } else if (page.normalizedRelPath === 'guias.html') {
            changefreq = 'monthly';
            priority = '0.9';
          } else if (page.normalizedRelPath === 'comparador-tarifas-solares.html') {
            changefreq = 'weekly';
            priority = '0.9';
          } else if (page.normalizedRelPath === 'calcular-factura-luz.html') {
            changefreq = 'monthly';
            priority = '0.9';
          } else if (page.normalizedRelPath === 'comparar-pvpc-tarifa-fija.html') {
            changefreq = 'monthly';
            priority = '0.8';
          } else if (page.normalizedRelPath === 'como-funciona-luzfija.html') {
            changefreq = 'monthly';
            priority = '0.8';
          } else if (page.normalizedRelPath === 'estadisticas/index.html') {
            changefreq = 'weekly';
            priority = '0.8';
          } else if (page.normalizedRelPath.startsWith('guias/')) {
            changefreq = 'monthly';
            priority = '0.7';
          }
        }

        return {
          loc: page.url,
          normalizedLoc: page.normalizedUrl,
          lastmod: getSitemapLastmod(relPath || page.relPath, existing.lastmod),
          changefreq,
          priority,
          normalizedRelPath: page.normalizedRelPath
        };
      });
    const assistantRefs = ['llms.txt', 'llms-full.txt']
      .filter((relPath) => fs.existsSync(path.join(REPO_ROOT, relPath)))
      .map((relPath) => {
        const url = `${BASE_URL}/${relPath}`;
        const normalizedUrl = normalizeSiteUrl(url);
        const existing = currentByUrl.get(normalizedUrl) || {};
        return {
          loc: url,
          normalizedLoc: normalizedUrl,
          lastmod: getSitemapLastmod(relPath, existing.lastmod),
          changefreq: existing.changefreq || 'monthly',
          priority: existing.priority || (relPath === 'llms.txt' ? '0.5' : '0.4'),
          normalizedRelPath: relPath
        };
      });
    const entries = [...pages, ...assistantRefs];

    entries.sort((a, b) => {
      const aExisting = currentOrder.has(a.normalizedLoc);
      const bExisting = currentOrder.has(b.normalizedLoc);

      if (aExisting && bExisting) return currentOrder.get(a.normalizedLoc) - currentOrder.get(b.normalizedLoc);
      if (aExisting) return -1;
      if (bExisting) return 1;

      const aGuide = a.normalizedRelPath.startsWith('guias/');
      const bGuide = b.normalizedRelPath.startsWith('guias/');
      if (aGuide !== bGuide) return aGuide ? 1 : -1;

      return a.loc.localeCompare(b.loc);
    });

    const blocks = entries.map((page) => [
      '  <url>',
      `    <loc>${page.loc}</loc>`,
      `    <lastmod>${page.lastmod}</lastmod>`,
      `    <changefreq>${page.changefreq}</changefreq>`,
      `    <priority>${page.priority}</priority>`,
      '  </url>'
    ].join('\n'));

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '',
      blocks.join('\n\n'),
      '',
      '</urlset>',
      ''
    ].join('\n');
  });
}

function countJsMetrics() {
  const jsFiles = walkFiles(path.join(REPO_ROOT, 'js'), (_fullPath, name) => name.endsWith('.js'));

  let lineCount = 0;
  for (const filePath of jsFiles) {
    lineCount += fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
  }

  return {
    moduleCount: jsFiles.length,
    lineCount
  };
}

function countHtmlMetrics() {
  const rootHtml = fs.readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .length;
  const statsHtml = walkHtmlFiles(path.join(REPO_ROOT, 'estadisticas')).length;
  const guiasHtml = walkHtmlFiles(path.join(REPO_ROOT, 'guias')).length;

  return {
    rootHtml,
    statsHtml,
    guiasHtml,
    totalPublic: rootHtml + statsHtml + guiasHtml
  };
}

function countTestMetrics() {
  const testsDir = path.join(REPO_ROOT, 'tests');
  const files = fs.readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(testsDir, name));

  let caseCount = null;
  if (fs.existsSync(VITEST_SUMMARY_PATH)) {
    try {
      const summary = JSON.parse(fs.readFileSync(VITEST_SUMMARY_PATH, 'utf8'));
      if (summary?.success === true && Number.isInteger(summary?.numTotalTests)) {
        caseCount = summary.numTotalTests;
      }
    } catch {
      caseCount = null;
    }
  }

  return {
    fileCount: files.length,
    caseCount
  };
}

function getSnapshotDate() {
  const trackedFiles = [
    ...walkFiles(path.join(REPO_ROOT, 'js'), (_fullPath, name) => name.endsWith('.js')),
    ...walkHtmlFiles(REPO_ROOT),
    ...walkFiles(REPO_ROOT, (_fullPath, name) => ['sw.js', 'styles.css', 'fonts.css'].includes(name)),
    ...walkFiles(REPO_ROOT, (_fullPath, name) => name.endsWith('.webmanifest')),
    path.join(REPO_ROOT, 'tarifas.json')
  ]
    .map((filePath) => path.relative(REPO_ROOT, filePath))
    .filter((relPath) => fs.existsSync(path.join(REPO_ROOT, relPath)));

  return trackedFiles
    .map((relPath) => getExpectedDate(relPath))
    .sort()
    .slice(-1)[0] || TODAY_YMD;
}

function formatApproxKb(bytes) {
  const kb = bytes / 1024;
  if (kb >= 10) return `~${Math.round(kb)} KB`;
  return `~${kb.toFixed(1).replace('.', ',')} KB`;
}

function getNormalizedUtf8Size(relPath) {
  const normalized = readUtf8(relPath).replace(/\r\n/g, '\n');
  return Buffer.byteLength(normalized, 'utf8');
}

function syncReadmeAndCapacidades() {
  const snapshotDate = getSnapshotDate();
  const html = countHtmlMetrics();
  const js = countJsMetrics();
  const tests = countTestMetrics();
  const tarifas = JSON.parse(readUtf8('tarifas.json'));

  const replacements = [
    {
      file: 'README.md',
      apply(content) {
        let next = content;
        next = next.replace(/## Estado Actual \(\d{4}-\d{2}-\d{2}\)/, `## Estado Actual (${snapshotDate})`);
        next = next.replace(/- \d+ paginas HTML publicas:/, `- ${html.totalPublic} paginas HTML publicas:`);
        next = next.replace(/  - \d+ en raiz\./, `  - ${html.rootHtml} en raiz.`);
        next = next.replace(/  - \d+ en `estadisticas\/`\./, `  - ${html.statsHtml} en \`estadisticas/\`.`);
        next = next.replace(/  - \d+ en `guias\/` \(indice \+ \d+ guias\)\./, `  - ${html.guiasHtml} en \`guias/\` (indice + ${html.guiasHtml - 1} guias).`);
        next = next.replace(/- \d+ modulos JavaScript en `js\/` \(incluye `js\/bv\/`\)\./, `- ${js.moduleCount} modulos JavaScript en \`js/\` (incluye \`js/bv/\`).`);
        next = next.replace(/- [\d.]+ lineas JS aproximadas\./, `- ${js.lineCount.toLocaleString('de-DE')} lineas JS aproximadas.`);
        next = next.replace(/- \d+ tarifas en `tarifas\.json`\./, `- ${tarifas.tarifas.length} tarifas en \`tarifas.json\`.`);
        if (tests.caseCount !== null) {
          next = next.replace(/- Suite de tests Vitest con \d+ archivos y \d+ casos\./, `- Suite de tests Vitest con ${tests.fileCount} archivos y ${tests.caseCount} casos.`);
        } else {
          next = next.replace(/- Suite de tests Vitest con \d+ archivos y \d+ casos\./, (line) =>
            line.replace(/Suite de tests Vitest con \d+ archivos/, `Suite de tests Vitest con ${tests.fileCount} archivos`)
          );
        }
        return next;
      }
    },
    {
      file: 'CAPACIDADES-WEB.md',
      apply(content) {
        let next = content;
        next = next.replace(/Ultima actualizacion: \d{4}-\d{2}-\d{2}/, `Ultima actualizacion: ${snapshotDate}`);
        next = next.replace(/- Modulos JS: \d+ \(`js\/\*\.js` \+ `js\/bv\/\*\.js`\)\./, `- Modulos JS: ${js.moduleCount} (\`js/*.js\` + \`js/bv/*.js\`).`);
        next = next.replace(/- Lineas JS aproximadas: [\d.]+\./, `- Lineas JS aproximadas: ${js.lineCount.toLocaleString('de-DE')}.`);
        next = next.replace(/- `tarifas\.json` \(\d+ tarifas\)\./, `- \`tarifas.json\` (${tarifas.tarifas.length} tarifas).`);
        next = next.replace(/- \d+ archivos de test \(`tests\/\*\.test\.js`\)\./, `- ${tests.fileCount} archivos de test (\`tests/*.test.js\`).`);
        if (tests.caseCount !== null) {
          next = next.replace(/- \d+ casos `it\(\)\/test\(\)` en la ultima ejecucion local verificada\./, `- ${tests.caseCount} casos \`it()/test()\` en la ultima ejecucion local verificada.`);
        }
        return next;
      }
    }
  ];

  for (const { file, apply } of replacements) {
    updateFile(file, apply);
  }
}

function syncJsonSchema() {
  const tarifas = JSON.parse(readUtf8('tarifas.json'));
  const tarifasSize = formatApproxKb(getNormalizedUtf8Size('tarifas.json'));

  updateFile('JSON-SCHEMA.md', (content) => {
    let next = content;
    next = next.replace(/\*\*Tamaño\*\*: ~[\d.,]+ KB/, `**Tamaño**: ${tarifasSize}`);
    next = next.replace(/\*\*Última actualización\*\*: \d{4}-\d{2}-\d{2}(?: \(`updatedAt`: `[^`]+`\))?/, `**Última actualización**: ${String(tarifas.updatedAt || '').slice(0, 10)} (\`updatedAt\`: \`${tarifas.updatedAt}\`)`);
    next = next.replace(/\*\*Total tarifas documentadas\*\*: \d+/, `**Total tarifas documentadas**: ${tarifas.tarifas.length}`);

    return next;
  });
}

function syncAssistantReferences() {
  const snapshotDate = getSnapshotDate();
  const tarifas = JSON.parse(readUtf8('tarifas.json'));
  const count = tarifas.tarifas.length;

  updateFile('llms.txt', (content) => {
    let next = content;
    next = next.replace(/Last updated: \d{4}-\d{2}-\d{2}/, `Last updated: ${snapshotDate}`);
    next = next.replace(
      /`tarifas\.json`: commercial tariffs dataset \(\d+ tariffs as of \d{4}-\d{2}-\d{2}\)\./,
      `\`tarifas.json\`: commercial tariffs dataset (${count} tariffs as of ${snapshotDate}).`
    );
    return next;
  });

  updateFile('llms-full.txt', (content) => {
    let next = content;
    next = next.replace(/Last updated: \d{4}-\d{2}-\d{2}/, `Last updated: ${snapshotDate}`);
    next = next.replace(
      /current documented size: \d+ tariffs as of \d{4}-\d{2}-\d{2}/,
      `current documented size: ${count} tariffs as of ${snapshotDate}`
    );
    return next;
  });
}

function main() {
  ensureAuxDirs();
  syncHtmlDateMetadata();
  syncGuidesSearchIndex(REPO_ROOT);
  if (INCLUDE_REPO_DOCS) {
    syncReadmeAndCapacidades();
    syncJsonSchema();
    syncAssistantReferences();
  }
  syncSitemap();
}

main();
