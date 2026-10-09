import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const styles = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');
const statsEnhanced = fs.readFileSync(
  path.resolve(__dirname, '../estadisticas/estadisticas-mejorado.css'),
  'utf8'
);

describe('Contratos CSS de rendimiento', () => {
  it('no reintroduce blur de 24px en las tarjetas grandes compartidas', () => {
    expect(styles).not.toContain('backdrop-filter: blur(24px)');
    expect(styles).not.toContain('-webkit-backdrop-filter: blur(24px)');
  });

  it('no mantiene una animacion infinita de sombra en el primer KPI del observatorio', () => {
    const firstKpiRule = statsEnhanced.match(/\.kpi:first-child\s*\{([\s\S]*?)\}/);

    expect(firstKpiRule).not.toBeNull();
    expect(firstKpiRule[1]).not.toContain('infinite');
    expect(statsEnhanced).not.toContain('obs-goldenPulse');
  });
});
