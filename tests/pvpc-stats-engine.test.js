import { beforeAll, describe, expect, it } from 'vitest';

process.env.TZ = 'America/Los_Angeles';

beforeAll(async () => {
  await import('../js/pvpc-stats-engine.js');
});

describe('PVPC_STATS date handling', () => {
  it('uses timestamps to map hours on DST forward days', () => {
    const start = new Date(2024, 2, 10, 0, 0, 0);
    const hours = [];
    for (let i = 0; i < 23; i++) {
      const ts = Math.floor((start.getTime() + i * 3600 * 1000) / 1000);
      const hour = new Date(ts * 1000).getHours();
      hours.push([ts, hour]);
    }

    const yearData = {
      days: {
        '2024-03-10': hours
      },
      meta: { year: 2024 }
    };

    const profile = window.PVPC_STATS.getHourlyProfile(yearData);
    expect(profile.data[2]).toBe(0);
    expect(profile.data[3]).toBe(3);
  });

  it('parses weekday using a stable local date', () => {
    const ts = Math.floor(new Date(2024, 2, 10, 12, 0, 0).getTime() / 1000);
    const yearData = {
      days: {
        '2024-03-10': [[ts, 1]]
      },
      meta: { year: 2024 }
    };

    const profile = window.PVPC_STATS.getWeekdayProfile(yearData);
    expect(profile.data[6]).toBeCloseTo(1);
    expect(profile.data[5]).toBeCloseTo(0);
  });
});
