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
  // El módulo cuelga listeners anónimos de window/document en cada import;
  // hay que desmontarlos entre tests para que un dispatch no dispare instancias previas.
  let boundListeners = [];

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));

    boundListeners = [];
    [window, document].forEach((target) => {
      const original = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((type, handler, opts) => {
        boundListeners.push([target, type, handler, opts]);
        return original(type, handler, opts);
      });
    });

    document.body.innerHTML = `
      <select id="zonaFiscal">
        <option value="Península">Península</option>
        <option value="Canarias">Canarias</option>
        <option value="CeutaMelilla">Ceuta y Melilla</option>
      </select>
      <div id="pvpcInline" hidden>
        <span id="pvpcNow"></span>
        <span id="pvpcAvg"></span>
        <span id="pvpcMin"></span>
        <span id="pvpcMax"></span>
        <span id="pvpcNowHour"></span>
        <span id="pvpcMinHour"></span>
        <span id="pvpcMaxHour"></span>
      </div>
    `;

    localStorage.clear();
    delete window.LF;
    delete window.__LF_indexExtraPvpcInlineRefreshBound;
  });

  afterEach(() => {
    boundListeners.forEach(([target, type, handler, opts]) => target.removeEventListener(type, handler, opts));
    boundListeners = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.LF;
    delete window.__LF_indexExtraPvpcInlineRefreshBound;
  });

  it('purga la promesa rechazada: un fallo transitorio no deja el widget muerto hasta recargar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.getElementById('zonaFiscal').value = 'Península';

    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return okJson({ days: { '2026-04-22': buildDayPairs('2026-04-22') } });
    });

    await import('../js/index-extra.js');
    await vi.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(document.getElementById('pvpcInline').hidden).toBe(true);

    // Al volver el foco se reintenta y, con la entrada fallida purgada, refetchea y se recupera
    window.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(document.getElementById('pvpcInline').hidden).toBe(false);
  });

  it('refetchea el mes cacheado cuando el día pedido aún no existía (pestaña que cruza la medianoche)', async () => {
    document.getElementById('zonaFiscal').value = 'Península';

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
    await vi.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(document.getElementById('pvpcInline').hidden).toBe(false);

    // Amanece el día 23: la clave diaria cambia, el mes cacheado no tiene el día → refetch
    vi.setSystemTime(new Date('2026-04-23T10:00:00Z'));
    window.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(document.getElementById('pvpcInline').hidden).toBe(false);
    expect(document.getElementById('pvpcMin').textContent).toContain('0.500');
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
    await vi.runAllTimersAsync();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const helpers = window.LF.indexExtraPvpcHelpers;
    const ctx = { geo: 8741, tz: 'Europe/Madrid' };

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
