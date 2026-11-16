import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * @vitest-environment node
 */

// lf-sw-update.js compara el build de la pagina con CACHE_VERSION como texto (AAAAMMDD-HHMMSS) y
// decide si una pagina esta obsoleta. Eso solo es valido si cada despliegue publica una version
// MAYOR que las anteriores: con una menor, una pagina antigua pasaria por actualizada (ronda 42).
// asset-version-consistency.test.js comprueba que HTML y SW coinciden, no que la version crezca.

const repoRoot = path.resolve(__dirname, '..');
const BUILD_ID = /^\d{8}-\d{6}$/;

function currentCacheVersion() {
  const sw = fs.readFileSync(path.join(repoRoot, 'sw.js'), 'utf8');
  return /const CACHE_VERSION = "([^"]+)"/.exec(sw)?.[1];
}

function publishedVersions() {
  try {
    const log = execFileSync('git', ['log', '-n', '40', '-p', '--format=%H', '--', 'sw.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return [...log.matchAll(/^\+const CACHE_VERSION = "(\d{8}-\d{6})"/gm)].map((match) => match[1]);
  } catch (_) {
    return null;
  }
}

describe('CACHE_VERSION crece con cada despliegue', () => {
  it('tiene formato de build', () => {
    expect(currentCacheVersion()).toMatch(BUILD_ID);
  });

  it('no es menor que ninguna version publicada antes en el historial de sw.js', (context) => {
    const versions = publishedVersions();
    // Sin git (o sin historial) no hay con que comparar; CI clona con fetch-depth: 0.
    if (!versions || versions.length === 0) context.skip();
    const current = currentCacheVersion();
    const newer = versions.filter((version) => version > current);
    expect(newer, `CACHE_VERSION ${current} es menor que versiones ya publicadas`).toEqual([]);
  });
});
