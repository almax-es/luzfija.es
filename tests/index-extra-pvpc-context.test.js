import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

function addCalendarDay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function localMidnightEpoch(dateStr, timeZone) {
  const utcGuess = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  });

  for (let shiftHours = -14; shiftHours <= 14; shiftHours += 1) {
    const candidate = utcGuess + (shiftHours * 3600);
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate * 1000))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    if (`${parts.year}-${parts.month}-${parts.day}` === dateStr && parts.hour === '00') {
      return candidate;
    }
  }
  throw new Error(`No se pudo resolver medianoche local para ${dateStr} en ${timeZone}`);
}

function buildDayPairs(dateStr, timeZone = 'Europe/Madrid') {
  const baseTs = localMidnightEpoch(dateStr, timeZone);
  const nextTs = localMidnightEpoch(addCalendarDay(dateStr), timeZone);
  const hours = (nextTs - baseTs) / 3600;
  return Array.from({ length: hours }, (_, i) => [baseTs + (i * 3600), 0.1 + (i / 1000)]);
}

function okJson(data) {
  return {
    ok: true,
    json: async () => data
  };
}

describe('index-extra PVPC modal context', () => {
  beforeEach(() => {
    vi.resetModules();

    document.body.innerHTML = `
      <select id="zonaFiscal">
        <option value="Península">Península</option>
        <option value="Canarias">Canarias</option>
        <option value="CeutaMelilla">Ceuta y Melilla</option>
      </select>
    `;

    localStorage.clear();
    delete window.LF;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.LF;
  });

  it('prioriza la zona visible del formulario sobre el último localStorage guardado', async () => {
    localStorage.setItem('almax_comparador_v6_inputs', JSON.stringify({ zonaFiscal: 'Península' }));
    document.getElementById('zonaFiscal').value = 'Canarias';

    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('/data/pvpc/8742/2026-04.json')) {
        return okJson({ days: { '2026-04-22': buildDayPairs('2026-04-22', 'Atlantic/Canary') } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    await import('../js/index-extra.js');

    const helpers = window.LF?.indexExtraPvpcHelpers;
    expect(helpers).toBeTruthy();
    expect(helpers.getUserContext()).toEqual({ geo: 8742, tz: 'Atlantic/Canary' });
    await helpers.fetchDay('2026-04-22', helpers.getUserContext());
    expect(global.fetch).toHaveBeenCalledWith('/data/pvpc/8742/2026-04.json', { cache: 'no-cache' });
  });

  it('genera una key distinta cuando cambia la zona o cambia el día', async () => {
    document.getElementById('zonaFiscal').value = 'Península';
    await import('../js/index-extra.js');

    const helpers = window.LF.indexExtraPvpcHelpers;
    const baseDate = new Date('2026-04-22T12:00:00Z');
    const keyPeninsula = helpers.buildQuickViewKey('pvpc', baseDate);

    document.getElementById('zonaFiscal').value = 'Canarias';
    const keyCanarias = helpers.buildQuickViewKey('pvpc', baseDate);
    const keyNextDay = helpers.buildQuickViewKey('pvpc', new Date('2026-04-23T12:00:00Z'));

    expect(keyCanarias).not.toBe(keyPeninsula);
    expect(keyNextDay).not.toBe(keyCanarias);
  });
});
