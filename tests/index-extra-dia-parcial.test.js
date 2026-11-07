/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// 10/09/2026: en Canarias la ultima hora del dia civil (23:00 local) cae dentro del dia
// PENINSULAR siguiente, que ESIOS todavia no ha publicado cuando corre la descarga nocturna.
// El fichero mensual de 8742 sale por eso cada dia con el dia en curso a 23 horas y su propio
// aviso ("unexpected points=23 expected=24 or 96"), y `tests/pvpc-dataset-integrity.test.js`
// acepta expresamente que el ultimo dia publicado llegue corto.
//
// El validador local del modal exigia el dia completo, asi que la vista rapida de PVPC
// respondia "Sin datos (dataset estatico)" TODOS los dias en zona Canarias mientras Peninsula
// funcionaba. El contrato compartido ya preveia el caso con `allowPartial` para los dias
// `>= hoy`; lo que faltaba era que el modal lo aplicara.

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

function buildDayPairs(dateStr, timeZone) {
  const baseTs = localMidnightEpoch(dateStr, timeZone);
  const nextTs = localMidnightEpoch(addCalendarDay(dateStr), timeZone);
  const hours = (nextTs - baseTs) / 3600;
  return Array.from({ length: hours }, (_, i) => [baseTs + (i * 3600), 0.1 + (i / 1000)]);
}

function canariasMonth(days) {
  return {
    schema_version: 2,
    geo_id: 8742,
    timezone: 'Atlantic/Canary',
    indicator: 1001,
    unit: 'EUR/kWh',
    epoch_unit: 's',
    days
  };
}

const CANARY_TZ = 'Atlantic/Canary';
const CTX = { geo: 8742, tz: CANARY_TZ };
const HOY = '2026-09-10';
const AYER = '2026-09-09';
// 22:30Z = 23:30 en Canarias (UTC+1 en verano): la ultima hora del dia, la que falta.
const AHORA = '2026-09-10T22:30:00Z';

async function cargarModulos() {
  document.body.innerHTML = '<select id="zonaFiscal"><option value="Canarias" selected>Canarias</option></select>';
  localStorage.clear();
  delete window.LF;
  await import('../js/lf-csv-utils.js');
  await import('../js/index-extra.js');
  return window.LF.indexExtraPvpcHelpers;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  localStorage.clear();
  delete window.LF;
});

describe('Vista rapida PVPC: dia en curso incompleto', () => {
  it('acepta el dia de hoy sin su ultima hora y no gasta un refetch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    const parcial = buildDayPairs(HOY, CANARY_TZ).slice(0, 23);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => canariasMonth({ [HOY]: parcial }) }));

    const helpers = await cargarModulos();
    const day = await helpers.fetchDay(HOY, CTX);

    expect(day.entries).toHaveLength(23);
    expect(day.partial).toBe(true);
    // Un dia utilizable no debe disparar el refetch reservado a payloads rotos.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('marca como completo el dia que si llega entero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => canariasMonth({ [HOY]: buildDayPairs(HOY, CANARY_TZ) })
    }));

    const helpers = await cargarModulos();
    const day = await helpers.fetchDay(HOY, CTX);

    expect(day.entries).toHaveLength(24);
    expect(day.partial).toBe(false);
  });

  it('sigue rechazando un dia HISTORICO incompleto', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    const parcialHistorico = buildDayPairs(AYER, CANARY_TZ).slice(0, 23);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => canariasMonth({ [AYER]: parcialHistorico }) }));

    const helpers = await cargarModulos();

    await expect(helpers.fetchDay(AYER, CTX)).rejects.toThrow('Sin datos');
  });

  it('sigue rechazando un dia en curso al que le falta la PRIMERA hora', async () => {
    // `allowPartial` solo tolera huecos por el extremo final: un dia que no empieza en la
    // medianoche de su zona esta mal construido, no a medio publicar.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    const sinPrimeraHora = buildDayPairs(HOY, CANARY_TZ).slice(1);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => canariasMonth({ [HOY]: sinPrimeraHora }) }));

    const helpers = await cargarModulos();

    await expect(helpers.fetchDay(HOY, CTX)).rejects.toThrow('Sin datos');
  });

  it('sigue rechazando un dia en curso con un hueco en medio', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    const conHueco = buildDayPairs(HOY, CANARY_TZ);
    conHueco.splice(10, 1);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => canariasMonth({ [HOY]: conHueco }) }));

    const helpers = await cargarModulos();

    await expect(helpers.fetchDay(HOY, CTX)).rejects.toThrow('Sin datos');
  });

  it('sin lf-csv-utils cargado, la copia local decide lo mismo', async () => {
    // Carga parcial o test que solo trae index-extra: el fallback interno tiene que aceptar
    // y rechazar exactamente los mismos dias que el validador compartido. Si divergen, el
    // modal se comporta distinto segun el orden de carga de los scripts.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    const parcialHoy = buildDayPairs(HOY, CANARY_TZ).slice(0, 23);
    const parcialAyer = buildDayPairs(AYER, CANARY_TZ).slice(0, 23);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => canariasMonth({ [AYER]: parcialAyer, [HOY]: parcialHoy })
    }));

    document.body.innerHTML = '<select id="zonaFiscal"><option value="Canarias" selected>Canarias</option></select>';
    localStorage.clear();
    delete window.LF;
    await import('../js/index-extra.js');
    expect(window.LF.csvUtils).toBeUndefined();
    const helpers = window.LF.indexExtraPvpcHelpers;

    const hoy = await helpers.fetchDay(HOY, CTX);
    expect(hoy.entries).toHaveLength(23);
    expect(hoy.partial).toBe(true);
    await expect(helpers.fetchDay(AYER, CTX)).rejects.toThrow('Sin datos');
  });

  it('Peninsula conserva la exigencia de dia completo para los dias cerrados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
    const parcialHistorico = buildDayPairs('2026-09-08', 'Europe/Madrid').slice(0, 23);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schema_version: 2,
        geo_id: 8741,
        timezone: 'Europe/Madrid',
        indicator: 1001,
        unit: 'EUR/kWh',
        epoch_unit: 's',
        days: { '2026-09-08': parcialHistorico }
      })
    }));

    const helpers = await cargarModulos();

    await expect(helpers.fetchDay('2026-09-08', { geo: 8741, tz: 'Europe/Madrid' })).rejects.toThrow('Sin datos');
  });
});
