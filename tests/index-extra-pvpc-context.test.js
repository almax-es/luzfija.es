import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

function buildDayPairs(dateStr) {
  const baseTs = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
  return Array.from({ length: 24 }, (_, i) => [baseTs + (i * 3600), 0.1 + (i / 1000)]);
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
        return okJson({ days: { '2026-04-22': buildDayPairs('2026-04-22') } });
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
