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
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.github' || entry.name === '.antigravitycli' || entry.name.startsWith('.codex-')) continue;
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

function resolveLocalHtml(currentFile, targetPath) {
  const cleanTarget = targetPath.split('?')[0];
  if (!cleanTarget) return currentFile;
  let resolvedPath = cleanTarget.startsWith('/')
    ? path.join(REPO_ROOT, cleanTarget)
    : path.resolve(path.dirname(currentFile), cleanTarget);
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    resolvedPath = path.join(resolvedPath, 'index.html');
  }
  return resolvedPath;
}

function collectAnchorIds(content) {
  const ids = new Set();
  for (const match of content.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) ids.add(match[1]);
  return ids;
}

// Enlaces <a href="...#fragmento"> locales cuyo destino no tiene ese id. `contentOf(file)`
// lee el HTML de destino, para poder probar el detector sin tocar disco.
function findBrokenFragments(file, content, contentOf) {
  const broken = [];
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']*#[^"']*)["']/gi;
  for (const match of content.matchAll(hrefRe)) {
    const href = match[1];
    if (/^(https?:|mailto:|tel:|javascript:|ftp:|data:)/i.test(href)) continue;
    const hashAt = href.indexOf('#');
    let fragment = href.slice(hashAt + 1);
    if (!fragment) continue;
    try { fragment = decodeURIComponent(fragment); } catch { /* se compara tal cual */ }
    const target = resolveLocalHtml(file, href.slice(0, hashAt));
    if (!target.endsWith('.html')) continue;
    const targetContent = target === file ? content : contentOf(target);
    if (targetContent == null) continue; // destino inexistente: ya lo reporta el test de enlaces
    if (!collectAnchorIds(targetContent).has(fragment)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      broken.push({ href, line });
    }
  }
  return broken;
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

  it('verifies that every local link with #fragment points to an existing id', () => {
    const readHtml = (target) => (fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null);
    const issues = [];
    for (const file of walkFiles(REPO_ROOT, ['.html'])) {
      const relPath = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      for (const { href, line } of findBrokenFragments(file, fs.readFileSync(file, 'utf8'), readHtml)) {
        issues.push(`[FRAGMENTO ROTO] En ${relPath}:${line} -> href="${href}" no tiene destino`);
      }
    }
    expect(issues, `Enlaces a secciones que no existen:\n${issues.join('\n')}`).toEqual([]);
  });

  it('the fragment check fails on an invented id and passes on a real one', () => {
    const page = path.join(REPO_ROOT, 'guias', 'demo.html');
    const other = path.join(REPO_ROOT, 'guias', 'otra.html');
    const pages = { [other]: '<h2 id="destino">x</h2>' };
    const html = [
      '<a href="#faq">bien</a><section id="faq"></section>',
      '<a href="#no-existe">mal</a>',
      '<a href="otra.html#destino">bien</a>',
      '<a href="otra.html#inventado">mal</a>',
      '<a href="https://example.com/#x">externo</a>',
    ].join('\n');
    const broken = findBrokenFragments(page, html, (target) => pages[target] ?? null);
    expect(broken.map((b) => b.href)).toEqual(['#no-existe', 'otra.html#inventado']);
  });
});
