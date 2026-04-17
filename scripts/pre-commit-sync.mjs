import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function runGit(args, options = {}) {
  return run('git', args, options).trim();
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSyncInput(relPath) {
  return (
    relPath.endsWith('.html') ||
    /^js\/.+\.js$/.test(relPath) ||
    relPath === 'sw.js' ||
    relPath === 'styles.css' ||
    relPath === 'fonts.css' ||
    relPath.endsWith('.webmanifest') ||
    relPath === 'tarifas.json' ||
    relPath === 'novedades.json'
  );
}

const repoRoot = runGit(['rev-parse', '--show-toplevel']);
const syncScriptPath = path.join(repoRoot, 'scripts', 'sync-seo-docs.mjs');
process.chdir(repoRoot);

const stagedFiles = splitLines(runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
if (stagedFiles.length === 0) process.exit(0);

const needsSync = stagedFiles.some(isSyncInput);
if (!needsSync) process.exit(0);

const blockingFiles = [
  ...splitLines(runGit(['diff', '--name-only'])),
  ...splitLines(runGit(['ls-files', '--others', '--exclude-standard']))
].filter((relPath) => isSyncInput(relPath) && !stagedFiles.includes(relPath));

if (blockingFiles.length > 0) {
  console.error('Cannot auto-sync docs/SEO with unstaged relevant changes present:');
  for (const file of blockingFiles) {
    console.error(`- ${file}`);
  }
  console.error('Stage or stash those files first, then retry the commit.');
  process.exit(1);
}

console.log('Synchronizing sitemap, feed and repo docs before commit...');
run(process.execPath, [syncScriptPath, '--include-repo-docs'], {
  cwd: repoRoot,
  stdio: 'inherit'
});

const filesToStage = new Set([
  'sitemap.xml',
  'feed.xml',
  'README.md',
  'CAPACIDADES-WEB.md',
  'JSON-SCHEMA.md'
]);

for (const relPath of stagedFiles) {
  if (relPath.endsWith('.html')) {
    filesToStage.add(relPath);
  }
}

const existingFiles = [...filesToStage].filter((relPath) =>
  fs.existsSync(path.join(repoRoot, relPath))
);

if (existingFiles.length > 0) {
  runGit(['add', '--', ...existingFiles]);
}

console.log('Derived docs and metadata synchronized.');
