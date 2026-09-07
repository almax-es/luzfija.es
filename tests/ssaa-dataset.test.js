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
});
