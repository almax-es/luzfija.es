/**
 * @vitest-environment node
 *
 * Integration tests for scripts/pre-commit-sync.mjs.
 * Each test runs against an isolated temporary git repo so the actual repo is
 * never touched. The real sync-seo-docs.mjs is replaced with a minimal stub
 * that just rewrites the managed output files, keeping fixture setup fast.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = process.cwd();

const MANAGED_OUTPUTS = [
  'sitemap.xml',
  'data/guides-search-index.json',
  'README.md',
  'CAPACIDADES-WEB.md',
  'JSON-SCHEMA.md',
  'llms.txt',
  'llms-full.txt'
];

// Minimal sync stub: rewrites each output file so git sees a change to re-stage.
const STUB_SYNC_SCRIPT = `
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = ${JSON.stringify(MANAGED_OUTPUTS)};
for (const f of outputs) {
  const full = path.join(repoRoot, f);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, (fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '') + '-synced');
}
`;

function execGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

describe('pre-commit-sync integration (isolated temp repo)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-hook-test-'));

    fs.mkdirSync(path.join(tmpDir, 'scripts'));
    fs.mkdirSync(path.join(tmpDir, 'data'));
    fs.mkdirSync(path.join(tmpDir, 'guias'));

    for (const f of ['pre-commit-sync.mjs', 'pre-commit-sync-lib.mjs']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'scripts', f), path.join(tmpDir, 'scripts', f));
    }
    fs.writeFileSync(path.join(tmpDir, 'scripts', 'sync-seo-docs.mjs'), STUB_SYNC_SCRIPT);

    for (const f of MANAGED_OUTPUTS) {
      fs.writeFileSync(path.join(tmpDir, f), 'initial');
    }

    execGit(['init'], tmpDir);
    execGit(['config', 'user.email', 'test@lf.test'], tmpDir);
    execGit(['config', 'user.name', 'LF Test'], tmpDir);
    execGit(['add', '.'], tmpDir);
    execGit(['commit', '-m', 'initial'], tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runHook() {
    return spawnSync(process.execPath, [path.join(tmpDir, 'scripts', 'pre-commit-sync.mjs')], {
      cwd: tmpDir,
      encoding: 'utf8'
    });
  }

  function getStagedFiles() {
    return execGit(['diff', '--cached', '--name-only'], tmpDir)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  it('exits 0 immediately when no managed files are staged', () => {
    fs.writeFileSync(path.join(tmpDir, 'unrelated.txt'), 'hello');
    execGit(['add', 'unrelated.txt'], tmpDir);

    const result = runHook();

    expect(result.status).toBe(0);
    expect(getStagedFiles()).not.toContain('sitemap.xml');
  });

  it('regenerates and re-stages all outputs when a new HTML file is staged', () => {
    fs.writeFileSync(path.join(tmpDir, 'guias', 'new-guide.html'), '<html><body>test</body></html>');
    execGit(['add', path.join('guias', 'new-guide.html')], tmpDir);

    const result = runHook();

    expect(result.status).toBe(0);
    const staged = getStagedFiles();
    for (const f of MANAGED_OUTPUTS) {
      expect(staged).toContain(f.replaceAll('\\', '/'));
    }
  });

  it('blocks when a managed output has unstaged changes at sync time', () => {
    fs.writeFileSync(path.join(tmpDir, 'guias', 'guide.html'), '<html></html>');
    execGit(['add', path.join('guias', 'guide.html')], tmpDir);

    // Dirty a managed output without staging it
    fs.writeFileSync(path.join(tmpDir, 'sitemap.xml'), 'dirty-unstaged');

    const result = runHook();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dirty managed files');
  });

  it('blocks when a managed HTML file is partially staged (staged + further local edits)', () => {
    const htmlPath = path.join(tmpDir, 'guias', 'partial.html');
    fs.writeFileSync(htmlPath, '<html>v1</html>');
    execGit(['add', path.join('guias', 'partial.html')], tmpDir);
    // Modify again after staging → file is now partially staged
    fs.writeFileSync(htmlPath, '<html>v2</html>');

    const result = runHook();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dirty managed files');
  });

  it('triggers sync when a generator script is staged', () => {
    // Modify sync-seo-docs.mjs itself (it is now a sync input)
    const syncScript = fs.readFileSync(
      path.join(tmpDir, 'scripts', 'sync-seo-docs.mjs'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'scripts', 'sync-seo-docs.mjs'),
      syncScript + '\n// minor change\n'
    );
    execGit(['add', path.join('scripts', 'sync-seo-docs.mjs')], tmpDir);

    const result = runHook();

    expect(result.status).toBe(0);
    const staged = getStagedFiles();
    expect(staged).toContain('sitemap.xml');
  });
});
