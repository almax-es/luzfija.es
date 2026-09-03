import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const ignoredTrackedDirs = new Set(['_site', 'tests', 'scripts', 'logs']);
const versionedAssetRe = /(?:src|href)\s*=\s*["'][^"'?#]+\.(?:js|mjs|css)\?v=([^"'&#]+)[^"']*["']/gi;

function listPublishedHtml() {
  const trackedHtml = execFileSync('git', ['ls-files', '-z', '--', '*.html'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return trackedHtml
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => !ignoredTrackedDirs.has(relativePath.split('/')[0]))
    .map((relativePath) => path.join(repoRoot, relativePath));
}

function collectVersionedAssets(html, relativePath) {
  const assets = [];
  for (const match of html.matchAll(versionedAssetRe)) {
    assets.push({ file: relativePath, version: match[1], reference: match[0] });
  }
  return assets;
}

describe('versionado de assets publicables', () => {
  it('ignora HTML locales no rastreados por Git', () => {
    const untrackedPath = path.join(repoRoot, '.asset-version-untracked-test.html');
    fs.writeFileSync(untrackedPath, '<script src="/js/local.js?v=otro-build"></script>', 'utf8');
    try {
      expect(listPublishedHtml()).not.toContain(untrackedPath);
    } finally {
      fs.rmSync(untrackedPath, { force: true });
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
