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

function isoDayNumber(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

describe('PVPC and surplus dataset structural integrity', () => {
  it('keeps history contiguous and complete while allowing only the latest published day to be partial', () => {
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
        const entries = [];

        monthFiles.forEach((file) => {
          const data = JSON.parse(fs.readFileSync(path.join(geoRoot, file), 'utf8'));
          const timeZone = data.timezone || 'Europe/Madrid';
          Object.entries(data.days || {}).forEach(([day, rows]) => {
            entries.push({ day, rows, file, timeZone });
          });
        });

        entries.sort((a, b) => a.day.localeCompare(b.day));
        if (entries.length === 0) {
          failures.push(`${dataset}/${geo}: no published days`);
          return;
        }

        const latestDay = entries[entries.length - 1].day;
        for (let i = 0; i < entries.length; i += 1) {
          const { day, rows, file, timeZone } = entries[i];
          const expected = expectedHourlyPoints(day, timeZone);
          const isLatestPublishedDay = day === latestDay;

          if (!Array.isArray(rows) || rows.length === 0) {
            failures.push(`${dataset}/${geo}/${file} ${day}: empty or invalid points`);
            continue;
          }
          if ((!isLatestPublishedDay && rows.length !== expected)
              || (isLatestPublishedDay && rows.length > expected)) {
            const relation = isLatestPublishedDay ? 'maxExpected' : 'expected';
            failures.push(`${dataset}/${geo}/${file} ${day}: points=${rows.length}, ${relation}=${expected}`);
          }

          if (i > 0) {
            const previousDay = entries[i - 1].day;
            const gap = isoDayNumber(day) - isoDayNumber(previousDay);
            if (gap !== 1) {
              failures.push(`${dataset}/${geo}: non-contiguous days ${previousDay} -> ${day} (gap=${gap})`);
            }
          }

          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const [timestamp] = rows[rowIndex];
            const timestampDay = ymdInTimeZone(timestamp, timeZone);
            if (timestampDay !== day) {
              failures.push(`${dataset}/${geo}/${file} ${day}: timestamp day=${timestampDay} at idx=${rowIndex}`);
              break;
            }

            if (rowIndex === 0) continue;
            const step = timestamp - rows[rowIndex - 1][0];
            if (step !== 3600) {
              failures.push(`${dataset}/${geo}/${file} ${day}: step=${step} at idx=${rowIndex}`);
              break;
            }
          }
        }
      });
    });

    expect(failures).toEqual([]);
  }, 15000);
});
