/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// La descarga diaria de precios la lanza un cron de GitHub que llega con horas de retraso
// (medido del 08 al 12/11/2026: entre la 01:11 y las 04:09, hora peninsular). Desde las 00:00
// hasta ese momento el fichero del mes responde bien pero no trae el dia de hoy, y el modal
// decia "Error al cargar precios. Inténtalo de nuevo." cada noche (visto en produccion el
// 13/11/2026 a las 00:09). No es un error ni se arregla reintentando: se explica como lo que es.
// Un fallo real (HTTP 503, fichero de otra zona) debe seguir diciendo que es un error.
//
// Mismo aviso que en `tests/pvpc-modal-dia-parcial.test.js`: el modulo se importa UNA sola vez
// y cada test usa un MES distinto para que la cache mensual no se cruce.

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

const TZ = 'Europe/Madrid';

function buildDayPairs(dateStr) {
  const baseTs = localMidnightEpoch(dateStr, TZ);
  const nextTs = localMidnightEpoch(addCalendarDay(dateStr), TZ);
  const hours = (nextTs - baseTs) / 3600;
  return Array.from({ length: hours }, (_, i) => [baseTs + (i * 3600), 0.1 + (i / 1000)]);
}

function mes(dias, geo = 8741) {
  return {
    schema_version: 2,
    geo_id: geo,
    timezone: TZ,
    indicator: 1001,
    unit: 'EUR/kWh',
    epoch_unit: 's',
    days: dias
  };
}

function mockFetch(respuesta) {
  global.fetch = vi.fn(async () => respuesta);
}

async function flush() {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const $ = (id) => document.getElementById(id);
const PENDIENTE = /precios de hoy todavía no están disponibles/i;

async function abrirModal() {
  $('btnPVPCInfo').click();
  await flush();
}

async function cerrarModal() {
  $('btnCerrarPVPCInfo').click();
  await flush();
}

let errorSpy;

beforeAll(async () => {
  document.body.innerHTML = `
    <select id="zonaFiscal"><option value="Península" selected>Península</option></select>
    <button id="btnPVPCInfo">Abrir</button>
    <div id="modalPVPCInfo" aria-hidden="true" style="display:none">
      <span id="modalPVPCTitleText"></span>
      <span id="modalPVPCTypeIcon"></span>
      <span id="modalPVPCHeadline"></span>
      <button id="tabHoy">Hoy</button>
      <button id="tabManana" style="display:none">Mañana</button>
      <span id="modalPVPCLabel"></span>
      <span id="modalPVPCNow"></span>
      <span id="modalPVPCNowHour"></span>
      <span id="modalPVPCMin"></span>
      <span id="modalPVPCMinHour"></span>
      <span id="modalPVPCMax"></span>
      <span id="modalPVPCMaxHour"></span>
      <div id="modalPVPCHoursList"></div>
      <button id="btnCerrarPVPCX">X</button>
      <button id="btnCerrarPVPCInfo">Cerrar</button>
    </div>
  `;
  window.scrollTo = vi.fn();
  window.requestAnimationFrame = (cb) => { cb(0); return 1; };
  window.LF = { el: { inputs: {} } };
  localStorage.clear();

  await import('../js/lf-csv-utils.js');
  await import('../js/index-extra.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
});

afterEach(async () => {
  await cerrarModal();
  vi.useRealTimers();
  if (errorSpy) errorSpy.mockRestore();
});

function fijarAhora(iso) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('Modal PVPC cuando el dia de hoy aun no esta publicado', () => {
  it('lo explica sin llamarlo error y pinta los precios en cuanto llegan', async () => {
    fijarAhora('2026-01-13T00:10:00Z'); // 01:10 del dia 13 en la peninsula
    mockFetch({ ok: true, status: 200, json: async () => mes({ '2026-01-12': buildDayPairs('2026-01-12') }) });

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.textContent).toMatch(PENDIENTE);
    expect(lista.textContent).not.toContain('Error al cargar precios');
    expect(errorSpy).not.toHaveBeenCalled();

    // Llega la descarga diaria: al reabrir se pintan las horas, sin restos del aviso.
    await cerrarModal();
    mockFetch({ ok: true, status: 200, json: async () => mes({
      '2026-01-12': buildDayPairs('2026-01-12'),
      '2026-01-13': buildDayPairs('2026-01-13')
    }) });
    await abrirModal();

    expect(lista.textContent).not.toMatch(PENDIENTE);
    expect(lista.textContent).not.toContain('Error al cargar precios');
    expect(lista.querySelectorAll('[data-is-now]')).toHaveLength(24);
  });

  it('trata igual el dia 1, cuando todavia no existe el fichero del mes (404)', async () => {
    fijarAhora('2026-02-01T00:10:00Z');
    mockFetch({ ok: false, status: 404, json: async () => null });

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.textContent).toMatch(PENDIENTE);
    expect(lista.textContent).not.toContain('Error al cargar precios');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('sigue diciendo que es un error cuando el servidor falla', async () => {
    fijarAhora('2026-03-13T00:10:00Z');
    mockFetch({ ok: false, status: 503, json: async () => null });

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.textContent).toContain('Error al cargar precios');
    expect(lista.textContent).not.toMatch(PENDIENTE);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('sigue diciendo que es un error cuando el fichero es de otra zona', async () => {
    fijarAhora('2026-04-13T00:10:00Z');
    mockFetch({ ok: true, status: 200, json: async () => mes({ '2026-04-12': buildDayPairs('2026-04-12') }, 8742) });

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.textContent).toContain('Error al cargar precios');
    expect(lista.textContent).not.toMatch(PENDIENTE);
  });

  it('sigue diciendo que es un error cuando el dia de hoy viene pero con huecos', async () => {
    fijarAhora('2026-05-13T10:00:00Z');
    const conHueco = buildDayPairs('2026-05-13').filter((_, i) => i !== 5);
    mockFetch({ ok: true, status: 200, json: async () => mes({ '2026-05-13': conHueco }) });

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.textContent).not.toMatch(PENDIENTE);
  });
});
