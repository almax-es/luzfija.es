/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// 14/08/2026 (novena ronda): cambiar el selector PVPC/Excedentes antes de que la carga
// anterior termine podia dejar pvpcHoy/pvpcManana con datos del tipo abandonado, porque
// cargarHoy()/cargarManana() no tenian ningun token que descartara una respuesta vieja.

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
  throw new Error(`No se pudo resolver medianoche local para ${dateStr}`);
}

function buildDayPairs(dateStr, flatPrice, timeZone = 'Europe/Madrid') {
  const baseTs = localMidnightEpoch(dateStr, timeZone);
  const nextTs = localMidnightEpoch(addCalendarDay(dateStr), timeZone);
  const hours = (nextTs - baseTs) / 3600;
  return Array.from({ length: hours }, (_, i) => [baseTs + (i * 3600), flatPrice]);
}

function todayYmd(tz = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function buildMonthPayload(flatPrice) {
  const hoy = todayYmd();
  const manana = addCalendarDay(hoy);
  return {
    days: {
      [hoy]: buildDayPairs(hoy, flatPrice),
      [manana]: buildDayPairs(manana, flatPrice)
    }
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

afterEach(() => {
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.body.scrollTop = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Modal PVPC/Excedentes: no mezcla datos de un tipo abandonado (14/08/2026)', () => {
  it('cambiar de PVPC a Excedentes antes de que la carga vieja resuelva no deja precios de PVPC bajo la cabecera de Excedentes', async () => {
    document.body.innerHTML = `
      <select id="zonaFiscal"><option value="Península" selected>Península</option></select>
      <button id="btnPVPCInfo">Abrir</button>
      <div id="modalPVPCInfo" aria-hidden="true" style="display:none">
        <select id="pvpcTypeSelector">
          <option value="pvpc" selected>PVPC</option>
          <option value="surplus">Excedentes</option>
        </select>
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

    const pvpcMonth = deferred();
    const surplusMonth = deferred();
    global.fetch = vi.fn((url) => {
      const isSurplus = String(url).includes('/data/surplus/');
      const p = isSurplus ? surplusMonth.promise : pvpcMonth.promise;
      return p.then((data) => ({ ok: true, json: async () => data }));
    });

    await import('../js/index-extra.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Abrir el modal: dispara cargarHoy()/cargarManana() para PVPC (tipo por defecto).
    document.getElementById('btnPVPCInfo').click();
    await flush();

    // Antes de que la carga de PVPC resuelva, el usuario cambia a Excedentes: dispara
    // OTRA cargarHoy()/cargarManana(), esta vez para 'surplus'.
    const selector = document.getElementById('pvpcTypeSelector');
    selector.value = 'surplus';
    selector.dispatchEvent(new Event('change'));
    await flush();

    // Resolver la peticion NUEVA (Excedentes) primero...
    surplusMonth.resolve(buildMonthPayload(0.05));
    await flush();

    // ...y la VIEJA (PVPC, ya abandonada) despues.
    pvpcMonth.resolve(buildMonthPayload(0.2));
    await flush();

    // La cabecera dice Excedentes (siempre lo dijo, applyModalType es sincrono)...
    expect(document.getElementById('modalPVPCHeadline').textContent).toContain('excedentes');
    // ...y el precio mostrado tiene que ser el de Excedentes (0,050), NUNCA el de PVPC
    // (0,200) que resolvio despues pero es de un tipo ya abandonado.
    expect(document.getElementById('modalPVPCNow').textContent).toContain('0,050');
    expect(document.getElementById('modalPVPCNow').textContent).not.toContain('0,200');
  });
});
