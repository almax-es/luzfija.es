import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// A diferencia de render-ui.test.js, aqui formatMoney replica el real de
// lf-utils.js (dos decimales y coma). El mock simplificado de aquel fichero
// (n => n + ' €') si distingue "0 €" de "19.69 €", pero no reproduce el formato
// que ve el usuario, y este fichero comprueba precisamente la cadena visible.
const formatMoney = (n) => {
  if (n === null || n === undefined || n === '') return '—';
  const value = Number(n);
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(2).replace('.', ',') + ' €';
};
const escapeHtml = (s) => s;

Object.assign(global.window, {
  LF: {
    $: (id) => document.getElementById(id),
    state: { rows: [], filter: 'all', sort: { key: 'totalNum', dir: 'asc' } },
    el: {},
    formatMoney,
    escapeHtml,
    lfDbg: vi.fn(),
    setStatus: vi.fn(),
    toast: vi.fn(),
    animateCounter: (element, text) => { if (element) element.textContent = text; },
    createSuccessParticles: vi.fn(),
    initTooltips: vi.fn(),
    parseNum: (value) => {
      const normalized = String(value ?? '').replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    updateSortIcons: vi.fn(),
    renderTarifasUpdated: vi.fn(),
    bindTooltipElement: vi.fn(),
    yieldControl: vi.fn(() => Promise.resolve())
  }
});

Object.defineProperty(global.window, 'localStorage', {
  value: { getItem: vi.fn(), setItem: vi.fn() },
  writable: true
});

const renderCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-render.js'), 'utf8');
const renderFn = new Function('window', renderCode);

// Fila alcanzable por el motor: calc.test.js ("BV cubre la factura completa")
// produce justo este par de valores, fvTotalFinal = 0 con totalNum > 0.
const filaBvCubierta = (overrides = {}) => ({
  nombre: 'BV cubierta',
  tipo: '3P',
  totalNum: 19.69,
  total: '19,69 €',
  potencia: '11,98 €',
  consumo: '7,23 €',
  impuestos: '3,76 €',
  webUrl: 'https://example.com/bv-cubierta',
  fvTipo: 'SIMPLE + BV',
  fvApplied: true,
  fvExKwh: 100,
  fvPriceUsed: 0.08,
  fvCredit1: 10,
  fvCredit2: 30,
  fvBvSaldoFin: 5,
  fvTotalFinal: 0,
  ...overrides
});

describe('Total BV: cero pagado frente a coste de ranking (lf-render.js)', () => {

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    window.document.body.innerHTML = `
      <input id="p1" value="0">
      <input id="p2" value="0">
      <input id="dias" value="30">
      <input id="cPunta" value="0">
      <input id="cLlano" value="0">
      <input id="cValle" value="0">
      <div id="heroKpis">
        <div id="kpiBest"></div>
        <div id="kpiPrice"></div>
      </div>
      <div id="statsBar">
        <div id="statMin"></div>
        <div id="statAvg"></div>
        <div id="statMax"></div>
      </div>
      <div id="toolbar"></div>
      <div id="pvpcInfo"></div>
      <div id="resultsLiveStatus" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="solarHomeEstimatorNotice" hidden></div>
      <div id="consumoLimitsNotice" hidden></div>
      <div id="chartTopBody"></div>
      <table id="table">
        <thead>
          <tr>
            <th data-sort="nombre"><span id="si_nombre"></span></th>
            <th data-sort="totalNum"><span id="si_totalNum"></span></th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div id="emptyBox" class="is-hidden"></div>
    `;

    window.LF.state.rows = [];
    window.LF.state.filter = 'all';
    window.LF.state.sort = { key: 'totalNum', dir: 'asc' };
    delete window.pvpcLastMeta;

    window.LF.el = {
      heroKpis: document.getElementById('heroKpis'),
      kpiBest: document.getElementById('kpiBest'),
      kpiPrice: document.getElementById('kpiPrice'),
      statsBar: document.getElementById('statsBar'),
      statMin: document.getElementById('statMin'),
      statAvg: document.getElementById('statAvg'),
      statMax: document.getElementById('statMax'),
      toolbar: document.getElementById('toolbar'),
      pvpcInfo: document.getElementById('pvpcInfo'),
      resultsLiveStatus: document.getElementById('resultsLiveStatus'),
      chartTopBody: document.getElementById('chartTopBody'),
      table: document.getElementById('table'),
      tbody: document.getElementById('tbody'),
      emptyBox: document.getElementById('emptyBox'),
      sortIcons: {
        nombre: document.getElementById('si_nombre'),
        totalNum: document.getElementById('si_totalNum')
      }
    };

    renderFn(global.window);
  });

  it('Con la factura cubierta por la BV, "Pagas este mes" es 0,00 € y el ranking conserva su coste', async () => {
    window.LF.state.rows = [filaBvCubierta()];

    await window.LF.renderTable();

    const tip = document.querySelector('.fv-icon').getAttribute('data-tip');
    expect(tip).toContain('Pagas este mes: 0,00 € (usando BV acumulada)');
    expect(tip).toContain('Ranking (coste real): 19,69 € (sin BV del pasado)');

    const totalCellTitle = document.querySelector('.total-cell').getAttribute('title');
    expect(totalCellTitle).toContain('Pagas: 0,00 €');
    expect(totalCellTitle).toContain('Ranking: 19,69 €');

    const totalAmount = document.querySelector('.js-total-amount');
    expect(totalAmount.getAttribute('data-pagas')).toBe('0,00 €');
    expect(totalAmount.getAttribute('data-ranking')).toBe('19,69 €');
  });

  // Los tres valores ausentes se prueban por separado a proposito: null y '' se
  // convierten en un CERO finito con Number(), asi que un guard basado solo en
  // Number.isFinite los tomaria por un importe pagado de 0,00 € en vez de caer al
  // coste de ranking. Sin estos dos casos, borrar los chequeos !== null / !== ''
  // dejaria la suite en verde.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['cadena vacia', '']
  ])('Sin fvTotalFinal utilizable (%s) se sigue cayendo al coste de ranking', async (_label, valorAusente) => {
    window.LF.state.rows = [filaBvCubierta({ fvTotalFinal: valorAusente })];

    await window.LF.renderTable();

    const tip = document.querySelector('.fv-icon').getAttribute('data-tip');
    expect(tip).toContain('Pagas este mes: 19,69 € (usando BV acumulada)');

    const totalCellTitle = document.querySelector('.total-cell').getAttribute('title');
    expect(totalCellTitle).toContain('Pagas: 19,69 €');
  });

});
