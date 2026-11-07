import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function collectHtmlFiles(dir, recursive = true) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? collectHtmlFiles(absolute) : [];
    return entry.isFile() && entry.name.endsWith('.html') ? [absolute] : [];
  });
}

function publicHtmlFiles() {
  return [
    ...collectHtmlFiles(rootDir, false),
    ...collectHtmlFiles(path.join(rootDir, 'guias')),
    ...collectHtmlFiles(path.join(rootDir, 'estadisticas'))
  ];
}

function executableInlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] || '';
    if (/\bsrc\s*=/i.test(attributes) || /\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) {
      continue;
    }
    scripts.push(match[2]);
  }
  return scripts;
}

describe('Sintaxis de scripts inline', () => {
  it('mantiene el DOCTYPE en la línea 1 de todas las páginas públicas', () => {
    const failures = publicHtmlFiles()
      .filter((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0].trim().toLowerCase() !== '<!doctype html>')
      .map((file) => path.relative(rootDir, file));

    expect(failures).toEqual([]);
  });

  it('mantiene parseable todo JavaScript inline de las páginas públicas', () => {
    const failures = [];
    for (const file of publicHtmlFiles()) {
      const relative = path.relative(rootDir, file);
      for (const [index, source] of executableInlineScripts(fs.readFileSync(file, 'utf8')).entries()) {
        try {
          new Function(source);
        } catch (error) {
          failures.push(`${relative} (script inline ${index + 1}): ${error.message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
