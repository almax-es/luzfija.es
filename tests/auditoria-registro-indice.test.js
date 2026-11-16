/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseAuditRegistrySections,
  renderAuditRegistryIndex
} from '../scripts/audit-registry-index.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');
const GUIDE = 'AUDITORIA-IA.md';
const REGISTRY = 'AUDITORIA-REGISTRO.md';
const START = '<!-- REGISTRO-INDICE:INICIO -->';
const END = '<!-- REGISTRO-INDICE:FIN -->';

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

function registrySections(content) {
  return parseAuditRegistrySections(content, REGISTRY);
}

function indexBlock(content) {
  const startAt = content.indexOf(START);
  const endAt = content.indexOf(END);
  return content.slice(startAt + START.length, endAt);
}

// La particion del 27/08/2026 dejo el detalle en AUDITORIA-REGISTRO.md y un indice generado en
// AUDITORIA-IA.md. Estos contratos evitan que el indice y el registro se separen en silencio.
describe('Indice del registro de auditorias', () => {
  it('tiene los marcadores del bloque generado exactamente una vez', () => {
    const guide = read(GUIDE);
    expect(guide.split(START)).toHaveLength(2);
    expect(guide.split(END)).toHaveLength(2);
    expect(guide.indexOf(START)).toBeLessThan(guide.indexOf(END));
  });

  it('usa anchors unicos en el registro', () => {
    const ids = registrySections(read(REGISTRY)).map((section) => section.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exige una pareja adyacente y segura para cada anchor y cada titulo ###', () => {
    const lines = read(REGISTRY).split(/\r?\n/);
    const anchors = lines.filter((line) => /^<a id="[^"]+"><\/a>$/.test(line));
    const headings = lines.filter((line) => /^###\s+/.test(line));

    expect(anchors).toHaveLength(headings.length);
    for (let i = 0; i < lines.length; i += 1) {
      const anchor = lines[i].match(/^<a id="([^"]+)"><\/a>$/);
      if (anchor) {
        expect(anchor[1]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(lines[i + 1]).toMatch(/^###\s+\S/);
      }
      if (/^###\s+/.test(lines[i])) {
        expect(lines[i - 1]).toMatch(/^<a id="[^"]+"><\/a>$/);
      }
    }
  });

  it('mantiene el indice en correspondencia exacta con las secciones del registro', () => {
    const sections = registrySections(read(REGISTRY));
    const esperado = renderAuditRegistryIndex(sections, REGISTRY);
    expect(indexBlock(read(GUIDE)).trim()).toBe(esperado);
  });

  it('no deja secciones del registro fuera del indice ni entradas sobrantes', () => {
    const enRegistro = registrySections(read(REGISTRY)).map((section) => section.id).sort();
    const enIndice = [...indexBlock(read(GUIDE)).matchAll(/\(AUDITORIA-REGISTRO\.md#([^)]+)\)/g)]
      .map((match) => match[1])
      .sort();
    expect(enIndice).toEqual(enRegistro);
  });

  it('enlaza la tabla de areas solo a anchors que existen en el registro', () => {
    const ids = new Set(registrySections(read(REGISTRY)).map((section) => section.id));
    const guide = read(GUIDE);
    const table = guide.match(/## Areas Ya Auditadas Y Su Estado\s+([\s\S]*?)\n\n## /)?.[1] || '';
    const filas = table
      .split(/\r?\n/)
      .filter((line) => /^\| (?!Area |---)/.test(line));
    expect(filas.length).toBeGreaterThan(0);
    for (const line of filas) expect(line).toContain('AUDITORIA-REGISTRO.md#');
    const referidos = filas.flatMap((line) => [...line.matchAll(/\(AUDITORIA-REGISTRO\.md#([^)]+)\)/g)].map((m) => m[1]));
    expect(referidos.length).toBeGreaterThan(0);
    for (const id of referidos) expect(ids).toContain(id);
  });

  it('hace fallar el parser ante titulos o anchors huerfanos y anchors inseguros', () => {
    expect(() => parseAuditRegistrySections('<a id="uno"></a>\n### Uno\n\n### Huerfana'))
      .toThrow(/sin anchor inmediato/i);
    expect(() => parseAuditRegistrySections('<a id="uno"></a>\n### Uno\n\n<a id="huerfano"></a>'))
      .toThrow(/no seguido inmediatamente/i);
    expect(() => parseAuditRegistrySections('<a id="Anchor malo"></a>\n### Uno'))
      .toThrow(/anchor no seguro/i);
  });

  it('hace fallar el parser ante anchors duplicados', () => {
    expect(() => parseAuditRegistrySections([
      '<a id="repetido"></a>',
      '### Uno',
      '',
      '<a id="repetido"></a>',
      '### Dos'
    ].join('\n'))).toThrow(/anchor duplicado/i);
  });

  it('escapa los caracteres que romperian la etiqueta Markdown del indice', () => {
    expect(renderAuditRegistryIndex([
      { id: 'caso-especial', title: String.raw`Caso [A] \ B` }
    ])).toBe(String.raw`- [Caso \[A\] \\ B](AUDITORIA-REGISTRO.md#caso-especial)`);
  });

  it('incluye la guia generada en el contrato de check:repo-docs', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts?.['check:repo-docs']).toContain(GUIDE);
  });

  it('documenta el comando que realmente regenera el indice del registro', () => {
    const guide = read(GUIDE);
    expect(guide).toContain('`npm run sync:repo-docs` lo reescribe');
    expect(guide).not.toContain('`npm run sync:seo-docs` lo reescribe');
  });

  it('publica por separado la guia y el registro para asistentes externos', () => {
    const lines = read('llms.txt').split(/\r?\n/);
    expect(lines).toContain(
      '- Technical audit method and index: https://raw.githubusercontent.com/almax-es/luzfija.es/main/AUDITORIA-IA.md'
    );
    expect(lines).toContain(
      '- Detailed audit registry (consult only by relevant area): https://raw.githubusercontent.com/almax-es/luzfija.es/main/AUDITORIA-REGISTRO.md'
    );
  });
});
