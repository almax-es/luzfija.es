/**
 * @vitest-environment node
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'logs']);

function walkFiles(dirPath, exts) {
  const out = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkFiles(path.join(dirPath, entry.name), exts));
      continue;
    }

    if (entry.isFile() && exts.includes(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dirPath, entry.name));
    }
  }

  return out;
}

function findBlankAnchors(content) {
  return [...content.matchAll(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi)].map((m) => m[0]);
}

describe('External link hardening', () => {
  it('requires noopener + noreferrer on every target=_blank anchor', () => {
    const htmlFiles = walkFiles(REPO_ROOT, ['.html']);
    const jsFiles = walkFiles(path.join(REPO_ROOT, 'js'), ['.js']);
    const files = [...htmlFiles, ...jsFiles];
    const errors = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const tags = findBlankAnchors(content);

      for (const tag of tags) {
        const relMatch = tag.match(/rel\s*=\s*["']([^"']*)["']/i);
        const rel = (relMatch?.[1] || '').toLowerCase();
        const hasNoopener = rel.includes('noopener');
        const hasNoreferrer = rel.includes('noreferrer');

        if (!hasNoopener || !hasNoreferrer) {
          errors.push(`${path.relative(REPO_ROOT, filePath)} => ${tag}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });
});
