import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * El inventario `vendor/README.md` es la fuente de verdad de que hay dentro de
 * `vendor/`: version, parches locales y SHA-256 de cada fichero. Un inventario
 * que se desalinea del contenido real es peor que no tenerlo, porque se sigue
 * consultando con confianza. Estos tests lo atan al disco.
 */

const repoRoot = path.resolve(__dirname, '..');
const vendorDir = path.join(repoRoot, 'vendor');
const INVENTORY_NAME = 'README.md';
const inventory = fs.readFileSync(path.join(vendorDir, INVENTORY_NAME), 'utf8');

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

// Todos los ficheros regulares bajo vendor/, sin filtrar por extension: una
// dependencia futura puede traer .json, .css, .data o .bin y no debe quedar
// fuera del inventario solo porque el test no conociera su extension.
function listVendorFiles() {
  const out = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) { walk(abs); continue; }
      if (!item.isFile()) continue;
      out.push(path.relative(vendorDir, abs).split(path.sep).join('/'));
    }
  };
  walk(vendorDir);
  return out.sort();
}

// Pares (ruta, sha) tal y como los declara el inventario:
//   - `xlsx/xlsx.full.min.js`
//     - **SHA-256:** `cc0151...`
function parseInventoryEntries(markdown) {
  const entries = [];
  let currentFile = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fileMatch = line.match(/^\s*-\s+`([^`]+)`/);
    if (fileMatch && /\.[a-z0-9]+$/i.test(fileMatch[1])) {
      currentFile = fileMatch[1];
      continue;
    }
    const shaMatch = line.match(/\*\*SHA-256:\*\*\s*`([0-9a-f]{64})`/i);
    if (shaMatch && currentFile) {
      entries.push({ file: currentFile, sha: shaMatch[1].toLowerCase() });
      currentFile = null;
    }
  }
  return entries;
}

const entries = parseInventoryEntries(inventory);
const vendorFiles = listVendorFiles();

describe('Inventario de vendor', () => {
  it('declara todos los ficheros de vendor/ salvo el propio inventario', () => {
    const declared = new Set(entries.map((e) => e.file));
    const undeclared = vendorFiles.filter((f) => f !== INVENTORY_NAME && !declared.has(f));
    expect(undeclared, 'ficheros en vendor/ sin ficha en README.md').toEqual([]);
  });

  it('no declara fichas duplicadas para la misma ruta', () => {
    const seen = new Map();
    const duplicated = [];
    for (const { file } of entries) {
      if (seen.has(file)) duplicated.push(file);
      seen.set(file, true);
    }
    expect(duplicated, 'rutas declaradas mas de una vez').toEqual([]);
  });

  it('no declara ninguna ruta que se salga de vendor/', () => {
    const escaping = entries.filter(({ file }) => {
      if (path.isAbsolute(file)) return true;
      const resolved = path.resolve(vendorDir, file);
      return resolved !== vendorDir && !resolved.startsWith(vendorDir + path.sep);
    });
    expect(escaping.map((e) => e.file), 'rutas fuera de vendor/').toEqual([]);
  });

  it('declara una ficha por cada fichero real', () => {
    expect(entries.length).toBe(vendorFiles.length - 1); // -1: el propio README.md
  });

  it.each(entries)('$file coincide con el SHA-256 declarado', ({ file, sha }) => {
    const abs = path.join(vendorDir, file);
    expect(fs.existsSync(abs), `no existe vendor/${file}`).toBe(true);
    expect(sha256File(abs)).toBe(sha);
  });
});

describe('Linea base de GoatCounter', () => {
  const dir = path.join(vendorDir, 'goatcounter');
  const baselinePath = path.join(dir, 'count.upstream.js');
  const servedPath = path.join(dir, 'count.js');
  const patchPath = path.join(dir, 'count.local.patch');

  it('conserva la copia prístina de upstream para poder reaplicar los parches', () => {
    expect(fs.existsSync(baselinePath)).toBe(true);
    expect(fs.existsSync(patchPath)).toBe(true);
  });

  // El parche se genero una vez sin cabeceras ---/+++ (se recortaban con
  // `sed '1,2d'`). El aplicador de este fichero las ignora, asi que el golden
  // pasaba igual, pero `git apply` las exige: el procedimiento documentado en
  // vendor/README.md fallaba con "patch fragment without header". Un parche que
  // solo sirve para el test y no para reaplicarlo a mano no cumple su proposito.
  it('el parche golden lleva cabeceras aplicables con git apply', () => {
    const patch = fs.readFileSync(patchPath, 'utf8');
    const [first, second] = patch.split('\n');
    expect(first, 'falta la cabecera --- del diff unificado').toBe('--- a/count.js');
    expect(second, 'falta la cabecera +++ del diff unificado').toBe('+++ b/count.js');
    expect(patch).toMatch(/^@@ /m);
  });

  it('la línea base es upstream puro: sin ninguno de los dos parches locales', () => {
    const code = fs.readFileSync(baselinePath, 'utf8');
    expect(code).not.toContain('safe_query');
    expect(code).not.toContain('force_image');
    expect(code).toContain('q: location.search');
  });

  it('el fichero servido conserva los DOS parches locales', () => {
    const code = fs.readFileSync(servedPath, 'utf8');
    // Parche 1: privacidad de la query.
    expect(code).toContain('q: safe_query()');
    expect(code).toContain('var safe_query = function()');
    expect(code).not.toContain('q: location.search');
    // Parche 2: confirmacion de entrega del outbox de diagnosticos.
    expect(code).toContain('force_image');
    expect(code).toContain('on_sent');
    expect(code).toContain('on_error');
  });

  // ESTE es el test que cierra el hueco que dejaban los anteriores: se puede
  // actualizar count.js (y su SHA en el inventario) dejando count.upstream.js
  // antiguo. Los ficheros seguirian siendo distintos, la base seguiria pareciendo
  // pura y los tokens de los parches seguirian presentes, pero la base ya no seria
  // la de partida y el merge a tres bandas daria un resultado falso.
  // Aqui se exige la relacion completa: servido === base + parche golden.
  it('el fichero servido es exactamente la línea base con el parche local aplicado', () => {
    const baseline = fs.readFileSync(baselinePath, 'utf8');
    const served = fs.readFileSync(servedPath, 'utf8');
    const patch = fs.readFileSync(patchPath, 'utf8');

    expect(applyUnifiedDiff(baseline, patch)).toBe(served);
  });
});

/**
 * Aplicador minimo de diff unificado (`diff -u`, sin cabeceras ---/+++).
 * Deliberadamente estricto: si una linea de contexto o de borrado no coincide
 * exactamente con la base, lanza. Eso es lo que convierte el test en una prueba
 * de que la base y el servido siguen siendo coherentes entre si.
 */
function applyUnifiedDiff(source, patch) {
  const srcLines = source.split('\n');
  const out = [];
  let cursor = 0; // indice 0-based sobre srcLines

  const patchLines = patch.split('\n');
  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;

    const start = Number(hunk[1]) - 1;
    if (start < cursor) throw new Error('hunks desordenados o solapados en el parche');
    out.push(...srcLines.slice(cursor, start));
    cursor = start;

    for (i++; i < patchLines.length; i++) {
      const body = patchLines[i];
      if (/^@@ /.test(body)) { i--; break; }
      if (body === '' && i === patchLines.length - 1) break; // salto final del fichero
      const marker = body[0];
      const text = body.slice(1);
      if (marker === ' ' || marker === undefined) {
        if (srcLines[cursor] !== text) {
          throw new Error(`contexto no coincide en la linea ${cursor + 1}: ${JSON.stringify(srcLines[cursor])} vs ${JSON.stringify(text)}`);
        }
        out.push(srcLines[cursor]);
        cursor++;
      } else if (marker === '-') {
        if (srcLines[cursor] !== text) {
          throw new Error(`linea a borrar no coincide en la ${cursor + 1}: ${JSON.stringify(srcLines[cursor])} vs ${JSON.stringify(text)}`);
        }
        cursor++;
      } else if (marker === '+') {
        out.push(text);
      } else {
        throw new Error(`marcador de diff no soportado: ${JSON.stringify(body)}`);
      }
    }
  }

  out.push(...srcLines.slice(cursor));
  return out.join('\n');
}
