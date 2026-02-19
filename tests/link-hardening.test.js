import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function walkFiles(dir, exts) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(fullPath, exts));
    else if (entry.isFile() && exts.some((ext) => fullPath.endsWith(ext))) out.push(fullPath);
  }
  return out;
}

function findBlankTargetIssues(content, relPath) {
  const issues = [];
  const re = /<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi;
  for (const match of content.matchAll(re)) {
    const tag = match[0];
    const relAttr = (tag.match(/rel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const tokens = new Set(relAttr.toLowerCase().split(/\s+/).filter(Boolean));
    if (!(tokens.has('noopener') && tokens.has('noreferrer'))) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      issues.push(`${relPath}:${line}`);
    }
  }
  return issues;
}

describe('External link hardening', () => {
  it('all target=_blank links in HTML/JS include rel=noopener noreferrer', () => {
    const root = path.resolve(__dirname, '..');
    const files = walkFiles(root, ['.html', '.js']);
    const issues = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(root, file).replace(/\\/g, '/');
      issues.push(...findBlankTargetIssues(content, relPath));
    }

    expect(issues, issues.join('\n')).toEqual([]);
  });
});
