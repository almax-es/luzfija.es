import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const ignoredTrackedDirs = new Set(['_site', 'tests', 'scripts', 'logs']);
const versionedAssetRe = /(?:src|href)\s*=\s*["'][^"'?#]+\.(?:js|mjs|css)\?v=([^"'&#]+)[^"']*["']/gi;

// Solo HTML rastreado por Git: una copia de trabajo local (`.codex-*`, un ZIP
// descomprimido, un _site suelto) trae builds antiguos y haria fallar la suite
// sin que haya nada roto en el repo.
function listTrackedHtml(cwd) {
  const trackedHtml = execFileSync('git', ['ls-files', '-z', '--', '*.html'], {
    cwd,
    encoding: 'utf8'
  });
  return trackedHtml
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => !ignoredTrackedDirs.has(relativePath.split('/')[0]));
}

function listPublishedHtml() {
  return listTrackedHtml(repoRoot).map((relativePath) => path.join(repoRoot, relativePath));
}

function collectVersionedAssets(html, relativePath) {
  const assets = [];
  for (const match of html.matchAll(versionedAssetRe)) {
    assets.push({ file: relativePath, version: match[1], reference: match[0] });
  }
  return assets;
}

describe('versionado de assets publicables', () => {
  // Se prueba contra un repo temporal, NUNCA escribiendo en este: vitest ejecuta
  // los ficheros de test en paralelo y otros recorren la raiz del proyecto
  // (tracking-html-coverage exige que todo HTML cargue tracking.js), asi que un
  // HTML de usar y tirar en la raiz los haria fallar de forma aleatoria.
  it('solo devuelve HTML rastreado y fuera de los directorios de apoyo', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-asset-version-'));
    const escribir = (rel, contenido) => {
      const destino = path.join(sandbox, rel);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, contenido, 'utf8');
    };
    try {
      execFileSync('git', ['init', '-q'], { cwd: sandbox });
      // Publicables, y ademas en subdirectorio para cubrir el caso de guias/.
      escribir('index.html', '<script src="/js/a.js?v=build"></script>');
      escribir('guias/una.html', '<script src="/js/a.js?v=build"></script>');
      // Rastreados pero de apoyo: no son paginas publicadas y arrastran builds
      // de fixtures o de artefactos, asi que no deben entrar en la comparacion.
      for (const apoyo of ['tests/fixture.html', 'scripts/plantilla.html', '_site/index.html', 'logs/informe.html']) {
        escribir(apoyo, '<script src="/js/a.js?v=otro-build"></script>');
      }
      execFileSync('git', ['add', '-A'], { cwd: sandbox });
      // Sin rastrear: la copia de trabajo local que motivo el cambio.
      escribir('suelto.html', '<script src="/js/a.js?v=otro-build"></script>');

      expect(listTrackedHtml(sandbox)).toEqual(['guias/una.html', 'index.html']);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('mantiene un único ?v= en todos los JS/CSS de HTML y lo iguala a CACHE_VERSION', () => {
    const assets = listPublishedHtml().flatMap((htmlPath) => {
      const relativePath = path.relative(repoRoot, htmlPath);
      return collectVersionedAssets(fs.readFileSync(htmlPath, 'utf8'), relativePath);
    });
    expect(assets.length).toBeGreaterThan(0);

    const byVersion = new Map();
    for (const asset of assets) {
      if (!byVersion.has(asset.version)) byVersion.set(asset.version, []);
      byVersion.get(asset.version).push(asset.file);
    }

    const sw = fs.readFileSync(path.join(repoRoot, 'sw.js'), 'utf8');
    const cacheMatch = sw.match(/const\s+CACHE_VERSION\s*=\s*["']([^"']+)["']/);
    expect(cacheMatch, 'sw.js debe declarar CACHE_VERSION como literal').not.toBeNull();
    const cacheVersion = cacheMatch[1];
    const htmlVersions = [...byVersion.keys()];
    const details = htmlVersions
      .map((version) => `${version}: ${[...new Set(byVersion.get(version))].slice(0, 5).join(', ')}`)
      .join(' | ');

    expect(htmlVersions, `Los HTML publicados mezclan ?v=: ${details}`).toEqual([cacheVersion]);
  });

  it('detecta una mezcla de build IDs en referencias versionadas', () => {
    const fixtures = [
      collectVersionedAssets('<script src="/js/a.js?v=20260817-100000"></script>', 'a.html'),
      collectVersionedAssets('<link href="/styles.css?v=20260817-100001" rel="stylesheet">', 'b.html')
    ].flat();

    expect([...new Set(fixtures.map((asset) => asset.version))]).toEqual([
      '20260817-100000',
      '20260817-100001'
    ]);
  });
});
