import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  getBlockingManagedFiles,
  getFilesToRestage,
  needsSync
} from './pre-commit-sync-lib.mjs';

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

const repoRoot = runGit(['rev-parse', '--show-toplevel']);
const syncScriptPath = path.join(repoRoot, 'scripts', 'sync-seo-docs.mjs');
process.chdir(repoRoot);

const stagedFiles = splitLines(runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']));
if (stagedFiles.length === 0) process.exit(0);

if (!needsSync(stagedFiles)) process.exit(0);

const blocking = getBlockingManagedFiles({
  stagedFiles,
  unstagedFiles: splitLines(runGit(['diff', '--name-only'])),
  untrackedFiles: splitLines(runGit(['ls-files', '--others', '--exclude-standard']))
});

if (blocking.hasBlocking) {
  console.error('Cannot auto-sync docs/SEO with dirty managed files present.');

  if (blocking.partiallyStagedManaged.length > 0) {
    console.error('Partially staged managed files:');
    for (const file of blocking.partiallyStagedManaged) {
      console.error(`- ${file}`);
    }
  }

  if (blocking.dirtyButUnstagedManaged.length > 0) {
    console.error('Unstaged managed files:');
    for (const file of blocking.dirtyButUnstagedManaged) {
      console.error(`- ${file}`);
    }
  }

  if (blocking.untrackedManaged.length > 0) {
    console.error('Untracked managed files:');
    for (const file of blocking.untrackedManaged) {
      console.error(`- ${file}`);
    }
  }

  console.error('Stage, stash or discard those managed files first, then retry the commit.');
  process.exit(1);
}

console.log('Synchronizing sitemap, feed, guides search index and repo docs before commit...');
run(process.execPath, [syncScriptPath, '--include-repo-docs'], {
  cwd: repoRoot,
  stdio: 'inherit'
});

const existingFiles = getFilesToRestage(stagedFiles).filter((relPath) =>
  fs.existsSync(path.join(repoRoot, relPath))
);

if (existingFiles.length > 0) {
  runGit(['add', '--', ...existingFiles]);
}

console.log('Derived docs and metadata synchronized.');
