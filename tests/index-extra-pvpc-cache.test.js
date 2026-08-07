import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

function buildDayPairs(dateStr, flatPrice = null) {
  const baseTs = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
  return Array.from({ length: 24 }, (_, i) => [baseTs + (i * 3600), flatPrice != null ? flatPrice : 0.1 + (i / 1000)]);
}

function okJson(data) {
  return {
    ok: true,
    json: async () => data
  };
}

describe('index-extra PVPC month cache', () => {
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

  it('purga una promesa rechazada para permitir reintentos del modal', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return okJson({ days: { '2026-04-22': buildDayPairs('2026-04-22') } });
    });

    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };
    await expect(helpers.fetchDay('2026-04-22', ctx)).rejects.toThrow('network down');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const day = await helpers.fetchDay('2026-04-22', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(day.entries).toHaveLength(24);
  });

  it('refetchea el mes cacheado cuando el día pedido aún no existía', async () => {
    const monthDay22 = { days: { '2026-04-22': buildDayPairs('2026-04-22') } };
    const monthBothDays = {
      days: {
        '2026-04-22': buildDayPairs('2026-04-22'),
        '2026-04-23': buildDayPairs('2026-04-23', 0.5)
      }
    };

    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return okJson(calls === 1 ? monthDay22 : monthBothDays);
    });

    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };
    await helpers.fetchDay('2026-04-22', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const day23 = await helpers.fetchDay('2026-04-23', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(day23.entries.every((entry) => entry.price === 0.5)).toBe(true);
  });

  it('precios de mañana: un solo refetch si aún no están publicados, y aparecen cuando el dataset se actualiza', async () => {
    document.getElementById('zonaFiscal').value = 'Península';

    const monthDay22 = { days: { '2026-04-22': buildDayPairs('2026-04-22') } };
    const monthBothDays = {
      days: {
        '2026-04-22': buildDayPairs('2026-04-22'),
        '2026-04-23': buildDayPairs('2026-04-23')
      }
    };

    let publicado = false;
    global.fetch = vi.fn(async () => okJson(publicado ? monthBothDays : monthDay22));

    await import('../js/index-extra.js');
    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };
    await helpers.fetchDay('2026-04-22', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Mañana aún no publicado: exactamente un refetch y error controlado, sin bucle
    await expect(helpers.fetchDay('2026-04-23', ctx)).rejects.toThrow('Sin datos');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Dataset actualizado (publicación vespertina): la siguiente petición lo recoge
    publicado = true;
    const day = await helpers.fetchDay('2026-04-23', ctx);
    expect(day.entries).toHaveLength(24);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    // Y queda cacheado: repetir la petición no vuelve a pedir el fichero
    await helpers.fetchDay('2026-04-23', ctx);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
