import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';
const HTML_SKIP_DIRS = new Set(['.git', 'node_modules', 'logs', 'scripts']);

function runGit(args) {
  try {
    return String(
      execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    ).trim();
  } catch {
    return '';
  }
}

function getTodayYmd() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const TODAY_YMD = getTodayYmd();
const gitDateCache = new Map();
const gitDirtyCache = new Map();

function isDirty(relPath) {
  if (gitDirtyCache.has(relPath)) return gitDirtyCache.get(relPath);
  const status = runGit(['status', '--porcelain', '--', relPath]);
  const dirty = status.length > 0;
  gitDirtyCache.set(relPath, dirty);
  return dirty;
}

function getGitLastModifiedDate(relPath) {
  if (gitDateCache.has(relPath)) return gitDateCache.get(relPath);
  const value = runGit(['log', '-1', '--format=%cs', '--', relPath]) || TODAY_YMD;
  gitDateCache.set(relPath, value);
  return value;
}

function getExpectedDate(relPath) {
  return isDirty(relPath) ? TODAY_YMD : getGitLastModifiedDate(relPath);
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

function pageUrlFromRelPath(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (normalized === 'index.html') return `${BASE_URL}/`;
  if (normalized.endsWith('/index.html')) {
    return `${BASE_URL}/${normalized.slice(0, -'/index.html'.length)}/`;
  }
  return `${BASE_URL}/${normalized}`;
}

function relPathFromSiteUrl(siteUrl) {
  const url = new URL(siteUrl);
  if (url.origin !== BASE_URL) return null;
  if (url.pathname === '/') return 'index.html';
  if (url.pathname.endsWith('/')) return `${url.pathname.slice(1)}index.html`.replace(/\//g, path.sep);
  return url.pathname.slice(1).replace(/\//g, path.sep);
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

function getIndexablePages() {
  const htmlFiles = walkHtmlFiles(REPO_ROOT);
  return htmlFiles
    .map((filePath) => {
      const relPath = path.relative(REPO_ROOT, filePath);
      const html = fs.readFileSync(filePath, 'utf8');
      const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
      let robots = '';
      for (const tag of metaTags) {
        const attrs = parseAttributes(tag);
        if (String(attrs.name || '').toLowerCase() === 'robots') {
          robots = String(attrs.content || '').toLowerCase();
          break;
        }
      }

      return {
        relPath,
        url: pageUrlFromRelPath(relPath),
        indexable: !robots.includes('noindex')
      };
    })
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function replaceDateModified(content, ymd) {
  return content.replace(
    /("dateModified"\s*:\s*")(\d{4}-\d{2}-\d{2})([^"]*)(")/g,
    (_, prefix, _date, suffix, quote) => `${prefix}${ymd}${suffix}${quote}`
  );
}

function syncHtmlDateModified() {
  for (const filePath of walkHtmlFiles(REPO_ROOT)) {
    const relPath = path.relative(REPO_ROOT, filePath);
    updateFile(relPath, (content) => replaceDateModified(content, getExpectedDate(relPath)));
  }
}

function syncSitemap() {
  updateFile('sitemap.xml', (content) =>
    content.replace(/<url>\s*([\s\S]*?)\s*<\/url>/g, (block) => {
      const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
      if (!locMatch) return block;

      const relPath = relPathFromSiteUrl(String(locMatch[1] || '').trim());
      if (!relPath) return block;

      const expectedDate = getExpectedDate(relPath);
      return block.replace(/<lastmod>[^<]+<\/lastmod>/i, `<lastmod>${expectedDate}</lastmod>`);
    })
  );
}

function formatRssBuildDate(ymd) {
  const date = new Date(`${ymd}T12:00:00+02:00`);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdays[date.getUTCDay()]}, ${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} 12:00:00 +0200`;
}

function syncFeed() {
  const buildDate = formatRssBuildDate(
    [getExpectedDate('novedades.html'), getExpectedDate('novedades.json')]
      .sort()
      .slice(-1)[0]
  );

  updateFile('feed.xml', (content) =>
    content.replace(/<lastBuildDate>[^<]+<\/lastBuildDate>/i, `<lastBuildDate>${buildDate}</lastBuildDate>`)
  );
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

  let caseCount = 0;
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const matches = source.match(/\b(?:it|test)\s*\(/g);
    caseCount += matches ? matches.length : 0;
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
    ...walkFiles(path.join(REPO_ROOT, 'tests'), (_fullPath, name) => name.endsWith('.test.js')),
    path.join(REPO_ROOT, 'tarifas.json'),
    path.join(REPO_ROOT, 'novedades.json')
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

function syncReadmeAndCapacidades() {
  const snapshotDate = getSnapshotDate();
  const html = countHtmlMetrics();
  const js = countJsMetrics();
  const tests = countTestMetrics();
  const tarifas = JSON.parse(readUtf8('tarifas.json'));
  const novedades = JSON.parse(readUtf8('novedades.json'));

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
        next = next.replace(/- \d+ novedades activas en `novedades\.json`\./, `- ${novedades.length} novedades activas en \`novedades.json\`.`);
        next = next.replace(/- Suite de tests Vitest con \d+ archivos y \d+ casos\./, `- Suite de tests Vitest con ${tests.fileCount} archivos y ${tests.caseCount} casos.`);
        return next;
      }
    },
    {
      file: 'CAPACIDADES-WEB.md',
      apply(content) {
        let next = content;
        next = next.replace(/Ultima actualizacion: \d{4}-\d{2}-\d{2}/, `Ultima actualizacion: ${snapshotDate}`);
        next = next.replace(/- Lineas JS aproximadas: [\d.]+\./, `- Lineas JS aproximadas: ${js.lineCount.toLocaleString('de-DE')}.`);
        next = next.replace(/- `tarifas\.json` \(\d+ tarifas\)\./, `- \`tarifas.json\` (${tarifas.tarifas.length} tarifas).`);
        next = next.replace(/- `novedades\.json` \(\d+ entradas activas\)\./, `- \`novedades.json\` (${novedades.length} entradas activas).`);
        next = next.replace(/- \d+ archivos de test \(`tests\/\*\.test\.js`\)\./, `- ${tests.fileCount} archivos de test (\`tests/*.test.js\`).`);
        next = next.replace(/- \d+ casos `it\(\)\/test\(\)` en la ultima ejecucion local verificada\./, `- ${tests.caseCount} casos \`it()/test()\` en la ultima ejecucion local verificada.`);
        return next;
      }
    }
  ];

  for (const { file, apply } of replacements) {
    updateFile(file, apply);
  }
}

function syncJsonSchema() {
  const tarifasPath = path.join(REPO_ROOT, 'tarifas.json');
  const novedadesPath = path.join(REPO_ROOT, 'novedades.json');
  const tarifas = JSON.parse(fs.readFileSync(tarifasPath, 'utf8'));
  const novedades = JSON.parse(fs.readFileSync(novedadesPath, 'utf8'));
  const tarifasSize = formatApproxKb(fs.statSync(tarifasPath).size);
  const novedadesSize = formatApproxKb(fs.statSync(novedadesPath).size);
  const novedadesDate = getExpectedDate('novedades.json');

  updateFile('JSON-SCHEMA.md', (content) => {
    let next = content;
    next = next.replace(/\*\*Tamaño\*\*: ~[\d.,]+ KB/, `**Tamaño**: ${tarifasSize}`);
    next = next.replace(/\*\*Última actualización\*\*: \d{4}-\d{2}-\d{2}(?: \(`updatedAt`: `[^`]+`\))?/, `**Última actualización**: ${String(tarifas.updatedAt || '').slice(0, 10)} (\`updatedAt\`: \`${tarifas.updatedAt}\`)`);
    next = next.replace(/\*\*Total tarifas documentadas\*\*: \d+/, `**Total tarifas documentadas**: ${tarifas.tarifas.length}`);

    const novedadesSectionPattern = /(\*\*Ubicación\*\*: `\/novedades\.json`\r?\n)(\*\*Tamaño\*\*: ~[\d.,]+ KB\r?\n)(\*\*Estructura\*\*: Array de objetos \(NO envuelto en objeto padre\)\r?\n)(\*\*Última actualización\*\*: [^\r\n]+\r?\n)(\*\*Total noticias activas\*\*: \d+ \(histórico ilimitado\))/;
    next = next.replace(
      novedadesSectionPattern,
      `$1**Tamaño**: ${novedadesSize}\n$3**Última actualización**: ${novedadesDate}\n**Total noticias activas**: ${novedades.length} (histórico ilimitado)`
    );

    return next;
  });
}

function main() {
  syncHtmlDateModified();
  syncSitemap();
  syncFeed();
  syncReadmeAndCapacidades();
  syncJsonSchema();
}

main();
