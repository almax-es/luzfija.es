/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');

function walkFiles(dir, exts) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.github' || entry.name === '.antigravitycli') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, exts));
    } else if (entry.isFile() && exts.some((ext) => fullPath.endsWith(ext))) {
      out.push(fullPath);
    }
  }
  return out;
}

function checkTargetExists(currentFile, targetPath) {
  // Ignorar urls externas, hashes locales, etc.
  if (!targetPath) return true;
  if (/^(https?:|mailto:|tel:|javascript:|ftp:|data:)/i.test(targetPath)) return true;
  if (targetPath.startsWith('#')) return true;

  // Eliminar el query string o hash si existen en la url local
  const cleanTarget = targetPath.split('?')[0].split('#')[0];
  if (!cleanTarget) return true;

  const currentDir = path.dirname(currentFile);
  let resolvedPath;

  if (cleanTarget.startsWith('/')) {
    resolvedPath = path.join(REPO_ROOT, cleanTarget);
  } else {
    resolvedPath = path.resolve(currentDir, cleanTarget);
  }

  // Si apunta a un directorio, buscar index.html en ese directorio
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    resolvedPath = path.join(resolvedPath, 'index.html');
  }

  return fs.existsSync(resolvedPath);
}

describe('Internal links and assets consistency', () => {
  it('verifies that all local anchors, scripts, images, and pictures point to existing files', () => {
    const htmlFiles = walkFiles(REPO_ROOT, ['.html']);
    const issues = [];

    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(REPO_ROOT, file).replace(/\\/g, '/');

      // 1. Validar <a href="..."> y <link href="...">
      const hrefRe = /<(?:a|link)\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi;
      for (const match of content.matchAll(hrefRe)) {
        const href = match[1];
        if (!checkTargetExists(file, href)) {
          const line = content.slice(0, match.index).split(/\r?\n/).length;
          issues.push(`[ENLACE ROTO] En ${relPath}:${line} -> href="${href}" no existe`);
        }
      }

      // 2. Validar <script src="...">
      const srcRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi;
      for (const match of content.matchAll(srcRe)) {
        const src = match[1];
        if (!checkTargetExists(file, src)) {
          const line = content.slice(0, match.index).split(/\r?\n/).length;
          issues.push(`[SCRIPT ROTO] En ${relPath}:${line} -> src="${src}" no existe`);
        }
      }

      // 3. Validar <img src="...">
      const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi;
      for (const match of content.matchAll(imgRe)) {
        const src = match[1];
        if (!checkTargetExists(file, src)) {
          const line = content.slice(0, match.index).split(/\r?\n/).length;
          issues.push(`[IMAGEN ROTA] En ${relPath}:${line} -> src="${src}" no existe`);
        }
      }

      // 4. Validar <source srcset="...">
      const sourceRe = /<source\b[^>]*\b(?:srcset|src)\s*=\s*["']([^"']*)["']/gi;
      for (const match of content.matchAll(sourceRe)) {
        const srcset = match[1];
        // srcset puede tener múltiples fuentes separadas por comas (por ejemplo para resoluciones), pero aquí normalmente es una ruta webp
        const cleanSrcset = srcset.split(',')[0].trim().split(' ')[0];
        if (!checkTargetExists(file, cleanSrcset)) {
          const line = content.slice(0, match.index).split(/\r?\n/).length;
          issues.push(`[SOURCE ROTO] En ${relPath}:${line} -> srcset/src="${srcset}" no existe`);
        }
      }
    }

    expect(issues, `Se han encontrado los siguientes enlaces o recursos rotos:\n${issues.join('\n')}`).toEqual([]);
  });
});
