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

function getAttr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  return (tag.match(re) || [])[1] || '';
}

function relTokens(tag) {
  return new Set(getAttr(tag, 'rel').toLowerCase().split(/\s+/).filter(Boolean));
}

function lineFor(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function findBlankTargetIssues(content, relPath) {
  const issues = [];
  const re = /<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi;
  for (const match of content.matchAll(re)) {
    const tag = match[0];
    if (!relTokens(tag).has('noopener')) issues.push(`${relPath}:${lineFor(content, match.index)}`);
  }
  return issues;
}

function isTransactionalTariffLink(tag) {
  const classes = new Set(getAttr(tag, 'class').split(/\s+/).filter(Boolean));
  return ['web', 'bv-link-tarifa', 'bv-alt-btn-info'].some((className) => classes.has(className));
}

function findTransactionalTariffLinkIssues(content, relPath) {
  const issues = [];
  const re = /<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi;
  for (const match of content.matchAll(re)) {
    const tag = match[0];
    if (!isTransactionalTariffLink(tag)) continue;

    const tokens = relTokens(tag);
    const referrerPolicy = getAttr(tag, 'referrerpolicy').toLowerCase();
    const line = lineFor(content, match.index);

    if (!tokens.has('nofollow')) issues.push(`${relPath}:${line} missing rel=nofollow`);
    if (tokens.has('noreferrer')) issues.push(`${relPath}:${line} must not use rel=noreferrer`);
    if (tokens.has('sponsored')) issues.push(`${relPath}:${line} must not use rel=sponsored`);
    if (referrerPolicy !== 'origin') issues.push(`${relPath}:${line} missing referrerpolicy=origin`);
  }
  return issues;
}

describe('External link hardening', () => {
  it('all target=_blank links in HTML/JS include rel=noopener', () => {
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

  it('transactional tariff links send origin referrer without passing SEO signals', () => {
    const root = path.resolve(__dirname, '..');
    const files = [
      path.join(root, 'js', 'lf-render.js'),
      path.join(root, 'js', 'bv', 'bv-ui.js')
    ];
    const issues = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(root, file).replace(/\\/g, '/');
      issues.push(...findTransactionalTariffLinkIssues(content, relPath));
    }

    expect(issues, issues.join('\n')).toEqual([]);
  });
});
