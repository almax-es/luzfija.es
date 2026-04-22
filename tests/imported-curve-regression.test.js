import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Regresión - Persistencia de curva horaria importada', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');

  it('el botón Calcular no borra consumosHorarios ni Sun Club antes de recalcular', () => {
    const start = code.indexOf("currentEl.btnCalc.addEventListener('click'");
    expect(start).toBeGreaterThan(-1);

    const block = code.slice(start, start + 500);
    expect(block).not.toMatch(/consumosHorarios\s*=\s*null/);
    expect(block).not.toMatch(/sunClubEnabled\s*=\s*false/);
  });

  it('la recalculación con Enter tampoco borra la curva horaria importada', () => {
    const start = code.indexOf("input.addEventListener('keypress'");
    expect(start).toBeGreaterThan(-1);

    const block = code.slice(start, start + 700);
    expect(block).not.toMatch(/consumosHorarios\s*=\s*null/);
    expect(block).not.toMatch(/sunClubEnabled\s*=\s*false/);
  });
});
