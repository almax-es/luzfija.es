/**
 * @vitest-environment node
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

function walkJsFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('repo docs metrics', () => {
  it('keeps documented JS module counts aligned with the repo', () => {
    const moduleCount = walkJsFiles(path.join(repoRoot, 'js')).length;
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    const capacidades = fs.readFileSync(path.join(repoRoot, 'CAPACIDADES-WEB.md'), 'utf8');

    expect(readme).toContain(`- ${moduleCount} modulos JavaScript en \`js/\` (incluye \`js/bv/\`).`);
    expect(capacidades).toContain(`- Modulos JS: ${moduleCount} (\`js/*.js\` + \`js/bv/*.js\`).`);
  });

  it('sync script updates CAPACIDADES-WEB module count automatically', () => {
    const syncScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'sync-seo-docs.mjs'), 'utf8');

    expect(syncScript).toMatch(/Modulos JS: \$\{js\.moduleCount\}/);
  });
});
