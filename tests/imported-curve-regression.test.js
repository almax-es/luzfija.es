import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Regresión - Persistencia de curva horaria importada', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');
  const csvImportCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
  const facturaCode = fs.readdirSync(path.resolve(__dirname, '../js'))
    .filter((file) => /^factura.*\.js$/.test(file))
    .sort()
    .map((file) => fs.readFileSync(path.resolve(__dirname, '../js', file), 'utf8'))
    .join('\n');

  it('el botón Calcular no borra consumosHorarios antes de recalcular', () => {
    const start = code.indexOf("currentEl.btnCalc.addEventListener('click'");
    expect(start).toBeGreaterThan(-1);

    const block = code.slice(start, start + 500);
    expect(block).not.toMatch(/consumosHorarios\s*=\s*null/);
  });

  it('la recalculación con Enter tampoco borra la curva horaria importada', () => {
    const start = code.indexOf("input.addEventListener('keypress'");
    expect(start).toBeGreaterThan(-1);

    const block = code.slice(start, start + 700);
    expect(block).not.toMatch(/consumosHorarios\s*=\s*null/);
  });

  it('la invalidación fina del modo CSV depende de la referencia importada, no del click en sí', () => {
    expect(code).toMatch(/csvConsumosRefMatches\s*\(\s*values,\s*window\.LF\.csvConsumosRef\s*\)/);
    expect(code).toMatch(/clearCsvImportState\s*\(/);
  });

  it('los radios de bono social guardan estado y dejan el cálculo pendiente', () => {
    expect(code).toContain('input[name="bonoSocialTipo"], input[name="bonoSocialLimite"]');
    expect(code).toMatch(/saveInputs\(\);\s*scheduleCalculateDebounced\(\);/);
  });

  it('al aplicar CSV guarda también la referencia de dias\/punta\/llano\/valle', () => {
    expect(csvImportCode).toMatch(/window\.LF\.csvConsumosRef\s*=/);
    expect(csvImportCode).toMatch(/buildCsvConsumosRef/);
  });

  it('al aplicar factura invalida completo el estado CSV previo', () => {
    expect(facturaCode).toMatch(/clearCsvImportState/);
    expect(facturaCode).toMatch(/pvpcPeriodoCSV\s*=\s*false|clearCsvImportState/);
  });
});
