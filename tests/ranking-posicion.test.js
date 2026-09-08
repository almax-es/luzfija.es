import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 *
 * Ronda 27 (08/09/2026). El contrato del puesto en el ranking de la home:
 *
 * El puesto que se pinta pertenece a la FILA (`posicion`, que fija el ranking
 * economico de lf-calc.js), no a la vista. Filtrar 1P/3P u ordenar por otra columna
 * cambia que filas se ven y en que orden, no cual es su posicion en el ranking.
 * Antes se numeraba por el indice del array ya filtrado y ordenado, asi que con
 * Total descendente la tarifa MAS CARA lucia "#1" al lado de su propio
 * "+45,95 EUR respecto a la mejor" (reproducido en produccion, build 20260908-112647).
 *
 * El chip movil de "Mi tarifa" hereda ese mismo puesto; su regresion vive en
 * tests/mi-tarifa-chip.test.js, junto al resto del contrato del chip.
 */

const formatMoney = (n) => n + ' €';

function setupRenderEnv() {
  Object.assign(global.window, {
    LF: {
      $: (id) => document.getElementById(id),
      state: { rows: [], filter: 'all', sort: { key: 'totalNum', dir: 'asc' } },
      el: {},
      formatMoney,
      escapeHtml: (s) => s,
      lfDbg: vi.fn(),
      setStatus: vi.fn(),
      toast: vi.fn(),
      animateCounter: vi.fn(),
      createSuccessParticles: vi.fn(),
      initTooltips: vi.fn(),
      bindTooltipElement: vi.fn(),
      updateSortIcons: vi.fn(),
      renderTarifasUpdated: vi.fn(),
      parseNum: (v) => Number(String(v ?? '').replace(',', '.')) || 0,
      yieldControl: () => Promise.resolve()
    }
  });

  document.body.innerHTML = `
    <input id="p1" value="0"><input id="p2" value="0"><input id="dias" value="30">
    <input id="cPunta" value="0"><input id="cLlano" value="0"><input id="cValle" value="0">
    <div id="heroKpis"><div id="kpiBest"></div><div id="kpiPrice"></div></div>
    <div id="statsBar"><div id="statMin"></div><div id="statAvg"></div><div id="statMax"></div></div>
    <div id="toolbar"></div><div id="pvpcInfo"></div>
    <div id="resultsLiveStatus" role="status"></div>
    <div id="solarHomeEstimatorNotice" hidden></div>
    <div id="consumoLimitsNotice" hidden></div>
    <div id="chartTop"></div><div id="chartTopBody"></div>
    <table id="table"><thead><tr>
      <th data-sort="nombre"><span id="si_nombre"></span></th>
      <th data-sort="totalNum"><span id="si_totalNum"></span></th>
    </tr></thead><tbody id="tbody"></tbody></table>
    <div id="emptyBox"></div>
    <section id="seccionResultados"></section>
    <div id="miTarifaChip" hidden>
      <span id="miTarifaChipRank"></span>
      <span id="miTarifaChipTotal"></span>
      <span id="miTarifaChipDiff"></span>
    </div>
  `;
  document.getElementById('seccionResultados').scrollIntoView = vi.fn();

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

  const renderCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-render.js'), 'utf8');
  new Function('window', renderCode)(global.window);
}

// Tres filas tal y como salen de lf-calc.js: ya ordenadas por importe y con su
// posicion economica congelada.
const FILAS = [
  { nombre: 'Barata 1P', tipo: '1P', posicion: 1, totalNum: 50, total: '50,00 €', vsMejor: '—', vsMejorNum: 0, esMejor: true, potenciaNum: 30, consumoNum: 20, impuestosNum: 0, impuestos: '0,00 €' },
  { nombre: 'Media 3P', tipo: '3P', posicion: 2, totalNum: 60, total: '60,00 €', vsMejor: '+10,00 €', vsMejorNum: 10, potenciaNum: 20, consumoNum: 40, impuestosNum: 0, impuestos: '0,00 €' },
  { nombre: 'Cara 3P', tipo: '3P', posicion: 3, totalNum: 70, total: '70,00 €', vsMejor: '+20,00 €', vsMejorNum: 20, potenciaNum: 10, consumoNum: 60, impuestosNum: 0, impuestos: '0,00 €' }
];

const puestosPintados = () => [...document.querySelectorAll('#tbody tr')].map((tr) => ({
  puesto: tr.querySelector('td')?.textContent.trim(),
  nombre: tr.querySelectorAll('td')[1]?.textContent || ''
}));

describe('ranking home: el puesto pertenece a la fila, no a la vista', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
    setupRenderEnv();
    window.LF.state.rows = FILAS.map((f) => ({ ...f }));
  });

  it('con Total ascendente numera 1, 2, 3', async () => {
    await window.LF.renderTable();
    expect(puestosPintados().map((r) => r.puesto)).toEqual(['1', '2', '3']);
  });

  it('con Total DESCENDENTE la mas cara conserva su puesto 3, no pasa a ser "#1"', async () => {
    window.LF.state.sort = { key: 'totalNum', dir: 'desc' };
    await window.LF.renderTable();

    const filas = puestosPintados();
    // El orden visible SI se invierte: la tabla obedece al usuario.
    expect(filas.map((r) => r.nombre.includes('Cara'))).toEqual([true, false, false]);
    // Pero el puesto no: la primera fila de la vista es la 3a del ranking.
    expect(filas.map((r) => r.puesto)).toEqual(['3', '2', '1']);
  });

  it('ordenando por otra columna el puesto sigue siendo el economico', async () => {
    window.LF.state.sort = { key: 'nombre', dir: 'asc' };
    await window.LF.renderTable();

    const filas = puestosPintados();
    expect(filas.map((r) => r.nombre.includes('Barata'))).toEqual([true, false, false]);
    expect(filas.map((r) => r.puesto)).toEqual(['1', '3', '2']);
  });

  it('con el filtro 3P las filas conservan su puesto global (2 y 3, no 1 y 2)', async () => {
    window.LF.state.filter = '3P';
    await window.LF.renderTable();

    const filas = puestosPintados();
    expect(filas.length).toBe(2);
    expect(filas.map((r) => r.puesto)).toEqual(['2', '3']);
  });

  it('las medallas (oro/plata/bronce) siguen al puesto, no a la fila de arriba', async () => {
    window.LF.state.sort = { key: 'totalNum', dir: 'desc' };
    await window.LF.renderTable();

    const clases = [...document.querySelectorAll('#tbody tr')].map((tr) => tr.querySelector('td').className);
    // Vista invertida: arriba la 3a del ranking, que se lleva el bronce, no el oro.
    expect(clases).toEqual(['rank-3', 'rank-2', 'rank-1']);
  });

  it('sin puesto comparable no reparte medalla', async () => {
    window.LF.state.rows = [
      { nombre: 'Sin dato', tipo: '1P', posicion: 1, totalNum: Number.POSITIVE_INFINITY, total: '—', vsMejor: '—', dataUnavailable: true, potenciaNum: 0, consumoNum: 0, impuestosNum: 0, impuestos: '—' }
    ];
    await window.LF.renderTable();
    expect(document.querySelector('#tbody tr td').className).toBe('');
  });

  it('una fila sin total comparable sigue pintando guion, no un numero', async () => {
    window.LF.state.rows = [
      { ...FILAS[0] },
      { nombre: 'Sin dato', tipo: '1P', posicion: 2, totalNum: Number.POSITIVE_INFINITY, total: '—', vsMejor: '—', dataUnavailable: true, potenciaNum: 0, consumoNum: 0, impuestosNum: 0, impuestos: '—' }
    ];
    await window.LF.renderTable();
    expect(puestosPintados().map((r) => r.puesto)).toEqual(['1', '—']);
  });

  it('sin `posicion` (fila de procedencia desconocida) cae al indice y no deja hueco', async () => {
    window.LF.state.rows = FILAS.map(({ posicion, ...resto }) => { void posicion; return resto; });
    await window.LF.renderTable();
    expect(puestosPintados().map((r) => r.puesto)).toEqual(['1', '2', '3']);
  });
});
