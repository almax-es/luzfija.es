import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('SSAA dataset', () => {
  it('exposes the latest complete monthly adjustment-services value in EUR/kWh', () => {
    const datasetPath = path.join(repoRoot, 'data', 'ssaa', 'index.json');
    const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

    expect(data).toMatchObject({
      schema_version: 1,
      source: 'ESIOS',
      indicator: 10328,
      timezone: 'Europe/Madrid',
      unit: 'EUR/kWh'
    });

    expect(data.values).toBeTruthy();
    expect(Object.keys(data.values).length).toBeGreaterThan(0);
    expect(data.latest_complete_month).toMatch(/^\d{4}-\d{2}$/);
    expect(data.latest_value).toBe(data.values[data.latest_complete_month]);

    Object.entries(data.values).forEach(([month, value]) => {
      expect(month).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(0.1);
    });
  });

  // Ronda 38: el productor reescribia el fichero solo con la respuesta de ESIOS, y un HTTP 200
  // con un unico mes dejaba 1 mes publicado con este test en verde. El simulador solar necesita
  // la tasa de cada mes de un historico de un ano; un mes ausente deja sin valorar las tarifas
  // que repercuten SSAA.
  it('publica un historico continuo de al menos 13 meses, con from/to en sus extremos', () => {
    const datasetPath = path.join(repoRoot, 'data', 'ssaa', 'index.json');
    const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    const months = Object.keys(data.values).sort();

    expect(months.length).toBeGreaterThanOrEqual(13);
    expect(data.from).toBe(months[0]);
    expect(data.to).toBe(months[months.length - 1]);
    for (let i = 1; i < months.length; i += 1) {
      const [year, month] = months[i - 1].split('-').map(Number);
      const siguiente = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
      expect(months[i]).toBe(siguiente);
    }
  });
});
