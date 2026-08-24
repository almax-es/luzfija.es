import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', '_site', 'node_modules', 'tests', 'scripts', 'logs']);
const versionedAssetRe = /(?:src|href)\s*=\s*["'][^"'?#]+\.(?:js|mjs|css)\?v=([^"'&#]+)[^"']*["']/gi;

function listPublishedHtml(dir = repoRoot) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listPublishedHtml(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(fullPath);
  }
  return result;
}

function collectVersionedAssets(html, relativePath) {
  const assets = [];
  for (const match of html.matchAll(versionedAssetRe)) {
    assets.push({ file: relativePath, version: match[1], reference: match[0] });
  }
  return assets;
}

describe('versionado de assets publicables', () => {
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
