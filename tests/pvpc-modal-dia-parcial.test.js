/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Cara visible del mismo defecto que cubre `tests/index-extra-dia-parcial.test.js`: con el
// dia en curso a 23 horas (Canarias), el modal PVPC mostraba "Error al cargar precios" y los
// KPIs a rayas. Aqui se comprueba lo que ve el usuario: lista pintada, aviso de dia
// incompleto y, sobre todo, que NO se rotule como precio de "ahora" el de una hora que ya paso.
//
// IMPORTANTE para quien anada tests aqui: `index-extra.js` engancha su inicializacion a
// `DOMContentLoaded` sobre `document`, que en jsdom sobrevive a todo el fichero. Reimportar el
// modulo y volver a disparar el evento en cada test deja instancias VIEJAS escuchando, y cada
// una repinta el modal con el mes que tenga en su cache. Se detecto porque un test mostraba el
// precio del fixture del test anterior. Por eso el modulo se importa UNA sola vez y cada test
// usa un MES distinto, para que las claves de la cache mensual no se crucen.

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

const CANARY_TZ = 'Atlantic/Canary';

function buildDayPairs(dateStr, priceAt) {
  const baseTs = localMidnightEpoch(dateStr, CANARY_TZ);
  const nextTs = localMidnightEpoch(addCalendarDay(dateStr), CANARY_TZ);
  const hours = (nextTs - baseTs) / 3600;
  return Array.from({ length: hours }, (_, i) => [baseTs + (i * 3600), priceAt(i)]);
}

function mockMes(dateStr, pairs) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      schema_version: 2,
      geo_id: 8742,
      timezone: CANARY_TZ,
      indicator: 1001,
      unit: 'EUR/kWh',
      epoch_unit: 's',
      days: { [dateStr]: pairs }
    })
  }));
}

async function flush() {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const $ = (id) => document.getElementById(id);

async function abrirModal() {
  $('btnPVPCInfo').click();
  await flush();
}

async function cerrarModal() {
  $('btnCerrarPVPCInfo').click();
  await flush();
}

beforeAll(async () => {
  document.body.innerHTML = `
    <select id="zonaFiscal"><option value="Canarias" selected>Canarias</option></select>
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
});

describe('Modal PVPC con el dia en curso incompleto (Canarias)', () => {
  it('pinta las horas publicadas y avisa de que el dia no esta completo', async () => {
    const dia = '2026-09-10';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T22:30:00Z')); // 23:30 en Canarias
    mockMes(dia, buildDayPairs(dia, (i) => 0.1 + (i / 1000)).slice(0, 23));

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.textContent).not.toContain('Error al cargar precios');
    expect(lista.querySelectorAll('[data-is-now]')).toHaveLength(23);
    expect(lista.textContent).toMatch(/todav[ií]a no está completo/i);
  });

  it('no rotula como "ahora" el precio de una hora que ya paso', async () => {
    const dia = '2026-08-12';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-12T22:30:00Z')); // 23:30 en Canarias
    // Precio inconfundible en la ultima hora publicada (22:00 local, indice 22).
    mockMes(dia, buildDayPairs(dia, (i) => (i === 22 ? 0.777 : 0.1)).slice(0, 23));

    await abrirModal();

    expect($('modalPVPCNow').textContent).not.toContain('0,777');
    expect($('modalPVPCNow').textContent).toMatch(/pendiente de publicar/i);
    expect($('modalPVPCNowHour').textContent).toContain('--:--');
    expect($('modalPVPCHoursList').innerHTML).not.toContain('AHORA');
    // El maximo si es un dato real de lo publicado y se sigue mostrando.
    expect($('modalPVPCMax').textContent).toContain('0,777');
  });

  it('con la hora en curso publicada sigue mostrando su precio como "ahora"', async () => {
    const dia = '2026-07-15';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-15T19:30:00Z')); // 20:30 en Canarias
    mockMes(dia, buildDayPairs(dia, (i) => (i === 20 ? 0.456 : 0.1)).slice(0, 23));

    await abrirModal();

    expect($('modalPVPCNow').textContent).toContain('0,456');
    expect($('modalPVPCNowHour').textContent).toContain('20:00');
    expect($('modalPVPCHoursList').innerHTML).toContain('AHORA');
  });

  it('un dia completo no muestra el aviso de incompleto', async () => {
    const dia = '2026-06-18';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-18T19:30:00Z')); // 20:30 en Canarias
    mockMes(dia, buildDayPairs(dia, (i) => 0.1 + (i / 1000)));

    await abrirModal();

    const lista = $('modalPVPCHoursList');
    expect(lista.querySelectorAll('[data-is-now]')).toHaveLength(24);
    expect(lista.textContent).not.toMatch(/todav[ií]a no está completo/i);
    expect($('modalPVPCNow').textContent).toContain('€/kWh');
  });
});
