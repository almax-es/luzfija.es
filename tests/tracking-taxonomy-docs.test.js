// Cada base de evento que emite el codigo debe estar documentada en ANALITICA-GOATCOUNTER.md.
//
// 24/09/2026: al revisar el control sobre la analitica aparecieron 7 bases emitidas desde
// tracking.js sin ninguna mencion en la doc (una de ellas, `csv-exportado`, era ademas codigo
// muerto sobre un boton retirado). La doc es la fuente de verdad de que datos salen hacia
// GoatCounter: un evento sin documentar es un evento que nadie ha revisado contra la politica de
// privacidad.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'ANALITICA-GOATCOUNTER.md'), 'utf8');

function listFiles(dir, extensions) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(relative, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(relative);
  }
  return out;
}

// Llamadas a cualquier funcion cuyo nombre contenga "track" con un nombre de evento literal como
// primer argumento: trackDetailedEvent('x', ...), __LF_trackDetail('x', ...), trackGuideEvent(...).
const CALL = /\b([\w$.]*track[\w$]*)\(\s*['"`]([a-z0-9][a-z0-9-]*)['"`/]/gi;

// Envoltorios cuyo primer argumento es un DETALLE, no la base: la base la fijan ellos por dentro.
// trackStatsInitIncomplete('chartjs') -> `init-incompleto/estadisticas/chartjs` y
// trackErrorRecurrence('csp') -> `error-recurrencia/csp/...`. Sus bases se comprueban aparte.
const DETAIL_WRAPPERS = { trackStatsInitIncomplete: 'init-incompleto', trackErrorRecurrence: 'error-recurrencia' };

function emittedBases() {
  const files = [
    ...listFiles('js', ['.js', '.mjs']),
    ...fs.readdirSync(root).filter((f) => f.endsWith('.html')),
    ...listFiles('guias', ['.html']),
    ...listFiles('estadisticas', ['.html'])
  ];
  const bases = new Map();
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of code.matchAll(CALL)) {
      const callee = match[1].split('.').pop();
      if (Object.hasOwn(DETAIL_WRAPPERS, callee)) continue;
      const base = match[2].toLowerCase();
      if (!bases.has(base)) bases.set(base, new Set());
      bases.get(base).add(file);
    }
  }
  return bases;
}

describe('taxonomía de eventos frente a ANALITICA-GOATCOUNTER.md', () => {
  const bases = emittedBases();

  it('el escáner encuentra los emisores reales (no pasa en vacío)', () => {
    for (const conocida of ['calculo-realizado', 'guias-busqueda', 'pagina-404', 'tarifa-click-contratar']) {
      expect(bases.has(conocida)).toBe(true);
    }
    expect(bases.size).toBeGreaterThan(30);
  });

  it('las bases que fijan los envoltorios de detalle también están documentadas', () => {
    const codigo = listFiles('js', ['.js']).map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    for (const [envoltorio, base] of Object.entries(DETAIL_WRAPPERS)) {
      expect(codigo).toContain('function ' + envoltorio);
      expect(doc).toContain('`' + base);
    }
  });

  it('toda base emitida aparece documentada como `base` o `base/...`', () => {
    const sinDocumentar = [...bases.entries()]
      .filter(([base]) => !new RegExp('`' + base.replace(/-/g, '\\-') + '[`/]').test(doc))
      .map(([base, files]) => `${base} (${[...files].join(', ')})`);
    expect(sinDocumentar).toEqual([]);
  });
});
