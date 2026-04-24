import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const DATASETS = ['pvpc', 'surplus'];
const ymdFormatters = new Map();
const expectedPointsCache = new Map();

function ymdInTimeZone(timestampSeconds, timeZone) {
  if (!ymdFormatters.has(timeZone)) {
    ymdFormatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }));
  }
  const formatter = ymdFormatters.get(timeZone);
  const parts = formatter.formatToParts(new Date(timestampSeconds * 1000));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function expectedHourlyPoints(day, timeZone) {
  const cacheKey = `${timeZone}:${day}`;
  if (expectedPointsCache.has(cacheKey)) return expectedPointsCache.get(cacheKey);

  const [year, month, date] = day.split('-').map(Number);
  const start = Date.UTC(year, month - 1, date - 1, 18, 0, 0) / 1000;
  const end = Date.UTC(year, month - 1, date + 2, 6, 0, 0) / 1000;
  let count = 0;

  for (let ts = start; ts <= end; ts += 3600) {
    if (ymdInTimeZone(ts, timeZone) === day) count += 1;
  }

  expectedPointsCache.set(cacheKey, count);
  return count;
}

describe('PVPC and surplus dataset integrity', () => {
  it('keeps historical daily hourly series complete for the dataset timezone', () => {
    const failures = [];

    DATASETS.forEach((dataset) => {
      const datasetRoot = path.join(repoRoot, 'data', dataset);
      const geoDirs = fs.readdirSync(datasetRoot)
        .filter((name) => /^\d+$/.test(name))
        .sort();

      geoDirs.forEach((geo) => {
        const geoRoot = path.join(datasetRoot, geo);
        const monthFiles = fs.readdirSync(geoRoot)
          .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
          .sort();
        const parsedFiles = monthFiles.map((file) => ({
          file,
          data: JSON.parse(fs.readFileSync(path.join(geoRoot, file), 'utf8'))
        }));
        const latestDay = parsedFiles
          .flatMap(({ data }) => Object.keys(data.days || {}))
          .sort()
          .at(-1);

        parsedFiles.forEach(({ file, data }) => {
          const timeZone = data.timezone || 'Europe/Madrid';

          Object.entries(data.days || {}).forEach(([day, rows]) => {
            const expected = expectedHourlyPoints(day, timeZone);
            if (day === latestDay && rows.length < expected) return;

            if (rows.length !== expected) {
              failures.push(`${dataset}/${geo}/${file} ${day}: points=${rows.length}, expected=${expected}`);
              return;
            }

            for (let i = 1; i < rows.length; i += 1) {
              const step = rows[i][0] - rows[i - 1][0];
              if (step !== 3600) {
                failures.push(`${dataset}/${geo}/${file} ${day}: step=${step} at idx=${i}`);
                break;
              }
            }
          });
        });
      });
    });

    expect(failures).toEqual([]);
  }, 15000);
});
