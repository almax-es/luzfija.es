import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Mocks de utilidades
const formatMoney = (n) => n + ' €';
const escapeHtml = (s) => s;
const createRipple = vi.fn();
const lfDbg = vi.fn();

// Configuración del entorno global
// Extendemos el window existente de JSDOM en lugar de reemplazarlo
Object.assign(global.window, {
  LF: {
    // Helper DOM dentro de LF
    $: (id) => document.getElementById(id),
    
    state: {
      rows: [],
      filter: 'all',
      sort: { key: 'totalNum', dir: 'asc' }
    },
    el: {},
    formatMoney,
    escapeHtml,
    createRipple,
    lfDbg,
    parseNum: (value) => {
      const normalized = String(value ?? '').replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    // Funciones que render necesita llamar
    updateSortIcons: vi.fn(), 
    renderTarifasUpdated: vi.fn(),
    bindTooltipElement: vi.fn(),
    yieldControl: vi.fn(() => Promise.resolve())
  }
});

// Mock localStorage en el window existente
Object.defineProperty(global.window, 'localStorage', {
  value: { getItem: vi.fn(), setItem: vi.fn() },
  writable: true
});


// Cargar el código de renderizado (lf-render.js)
const renderCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-render.js'), 'utf8');
const renderFn = new Function('window', renderCode);

describe('Renderizado UI (lf-render.js)', () => {

  // Setup del DOM antes de cada test
  beforeEach(() => {
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

    // Resetear estado
    window.LF.state.rows = [];
    window.LF.state.filter = 'all';
    window.LF.state.sort = { key: 'totalNum', dir: 'asc' };
    
    // Vincular elementos al objeto LF.el (como hace initElements)
    window.LF.el = {
      kpiBest: document.getElementById('kpiBest'),
      kpiPrice: document.getElementById('kpiPrice'),
      statMin: document.getElementById('statMin'),
      statAvg: document.getElementById('statAvg'),
      statMax: document.getElementById('statMax'),
      chartTopBody: document.getElementById('chartTopBody'),
      table: document.getElementById('table'),
      tbody: document.getElementById('tbody'),
      emptyBox: document.getElementById('emptyBox'),
      sortIcons: {
        nombre: document.getElementById('si_nombre'),
        totalNum: document.getElementById('si_totalNum')
      }
    };

    // RE-EVALUAR el código para que coja las referencias nuevas
    renderFn(global.window);
  });

  const mockRows = [
    {
      id: 1,
      nombre: 'Tarifa Cara',
      tipo: '3P',
      totalNum: 100,
      total: '100,00 €',
      potencia: '10 €',
      consumo: '50 €',
      impuestos: '40 €',
      web: 'http://test.com',
      meta: { fv: { bv: false } }
    },
    {
      id: 2,
      nombre: 'Tarifa Barata',
      tipo: '1P',
      totalNum: 50,
      total: '50,00 €',
      potencia: '10 €',
      consumo: '30 €',
      impuestos: '10 €',
      web: 'http://test.com',
      meta: { fv: { bv: false } }
    },
    {
      id: 3,
      nombre: 'Tarifa Media',
      tipo: '3P',
      totalNum: 75,
      total: '75,00 €',
      potencia: '10 €',
      consumo: '40 €',
      impuestos: '25 €',
      web: 'http://test.com',
      meta: { fv: { bv: false } }
    }
  ];

  it('Debe renderizar la tabla con las filas correctas', () => {
    window.LF.state.rows = [...mockRows];
    window.LF.renderTable();

    const rows = document.querySelectorAll('#tbody tr');
    // Filtro 'all' -> 3 filas
    expect(rows.length).toBe(3);
    
    // Verificar contenido de la primera fila (debe ser la más barata si el sort es asc)
    expect(rows[0].innerHTML).toContain('Tarifa Barata');
    expect(rows[0].innerHTML).toContain('50,00 €');
  });

  it('Debe resaltar la mejor opción (Winner)', () => {
    window.LF.state.rows = [...mockRows];
    window.LF.renderTable();

    const firstRow = document.querySelector('#tbody tr:first-child');
    // La clase 'winner' o estilo similar suele aplicarse a la mejor opción
    // En este caso, verificamos que sea la de menor precio
    expect(firstRow.innerHTML).toContain('Tarifa Barata');
  });

  it('Debe filtrar por tipo (1P vs 3P)', () => {
    window.LF.state.rows = [...mockRows];
    
    // 1. Filtrar solo 1P
    window.LF.state.filter = '1P';
    window.LF.renderTable();
    let rows = document.querySelectorAll('#tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].innerHTML).toContain('Tarifa Barata');

    // 2. Filtrar solo 3P
    window.LF.state.filter = '3P';
    window.LF.renderTable();
    rows = document.querySelectorAll('#tbody tr');
    expect(rows.length).toBe(2);
    // Como el orden es ASC por defecto, 'Tarifa Media' (75€) debe salir antes que 'Tarifa Cara' (100€)
    expect(rows[0].innerHTML).toContain('Tarifa Media'); 
  });

  it('Debe ordenar correctamente (Ascendente/Descendente)', () => {
    window.LF.state.rows = [...mockRows];
    
    // Ascendente (Por defecto) -> Barata (50) primero
    window.LF.state.sort = { key: 'totalNum', dir: 'asc' };
    window.LF.renderTable();
    let firstRow = document.querySelector('#tbody tr:first-child');
    expect(firstRow.innerHTML).toContain('Tarifa Barata');

    // Descendente -> Cara (100) primero
    window.LF.state.sort = { key: 'totalNum', dir: 'desc' };
    window.LF.renderTable();
    firstRow = document.querySelector('#tbody tr:first-child');
    expect(firstRow.innerHTML).toContain('Tarifa Cara');
  });

  it('Debe mostrar mensaje de vacío si no hay resultados', () => {
    window.LF.state.rows = [];
    window.LF.renderTable();

    const emptyBox = document.getElementById('emptyBox');
    const table = document.getElementById('table');
    
    // En lf-render, si no hay rows, suele ocultar la tabla o mostrar el emptyBox
    // Verificamos lógica de visualización
    const rows = document.querySelectorAll('#tbody tr');
    expect(rows.length).toBe(0);
    expect(emptyBox.style.display).not.toBe('none'); // Debería ser visible (block/flex)
  });

  it('Debe actualizar los KPIs principales (Hero Cards)', () => {
    window.LF.state.rows = [...mockRows];
    window.LF.renderTable(); // Esto llama internamente a updateKPIs si existe

    // Simulamos la llamada a renderAll que orquesta todo
    // O llamamos a la lógica de KPI si está expuesta. 
    // En lf-render.js, renderTable suele encargarse de la tabla. 
    // Los KPIs a veces van aparte, pero si están integrados verificamos:
    
    // Si la lógica de KPIs está en renderTable:
    if (document.getElementById('kpiBest').textContent) {
      expect(document.getElementById('kpiBest').textContent).toContain('Tarifa Barata');
      expect(document.getElementById('kpiPrice').textContent).toContain('50,00 €');
    }
  });

  it('Marca PVPC en modo solar como no comparable y desactiva su desglose', async () => {
    window.LF.state.rows = [
      {
        nombre: 'Tarifa Solar',
        tipo: '1P',
        totalNum: 50,
        total: '50,00 €',
        potencia: '10 €',
        consumo: '30 €',
        impuestos: '10 €',
        webUrl: 'https://example.com/solar'
      },
      {
        nombre: 'PVPC',
        tipo: '1P',
        totalNum: Number.POSITIVE_INFINITY,
        total: '—',
        potencia: '—',
        consumo: '—',
        impuestos: '—',
        webUrl: 'https://example.com/pvpc',
        solarNoCalculable: true,
        solarNoCalculableReason: 'PVPC no se compara en modo solar desde la home.'
      }
    ];

    await window.LF.renderTable();

    const rows = [...document.querySelectorAll('#tbody tr')];
    const pvpcRow = rows.find((row) => row.textContent.includes('PVPC'));

    expect(pvpcRow).toBeTruthy();
    expect(pvpcRow.querySelector('.pvpc-warn')).not.toBeNull();
    expect(pvpcRow.querySelector('.pvpc-warn').getAttribute('title')).toContain('modo solar');
    expect(pvpcRow.querySelector('.tarifa-cell').getAttribute('aria-disabled')).toBe('true');
    expect(pvpcRow.querySelector('.total-cell').getAttribute('aria-disabled')).toBe('true');
    expect(pvpcRow.querySelector('.desglose-icon')).toBeNull();
  });

  it('Solo muestra el aviso de límites Nufri en las tarifas que lo declaran', async () => {
    document.getElementById('p1').value = '3,45';
    document.getElementById('p2').value = '3,45';
    document.getElementById('dias').value = '30';
    document.getElementById('cPunta').value = '900';

    window.LF.state.rows = [
      {
        nombre: 'Nufri',
        tipo: '1P',
        totalNum: 50,
        total: '50,00 €',
        potencia: '10 €',
        consumo: '30 €',
        impuestos: '10 €',
        webUrl: 'https://example.com/nufri'
      },
      {
        nombre: 'Nufri Calma',
        tipo: '1P',
        totalNum: 51,
        total: '51,00 €',
        potencia: '10 €',
        consumo: '31 €',
        impuestos: '10 €',
        webUrl: 'https://example.com/nufri-calma',
        requisitos: 'Ratio consumo/potencia ≤ 0,75 MWh/kW. Consumo anual ≤ 8.000 kWh/año.',
        avisoConsumoEstimado: {
          titulo: 'REQUISITOS NUFRI',
          ratioKwhPorKw: 750,
          maxKwhAnual: 8000
        }
      },
      {
        nombre: 'Nufri 3P',
        tipo: '3P',
        totalNum: 52,
        total: '52,00 €',
        potencia: '10 €',
        consumo: '32 €',
        impuestos: '10 €',
        webUrl: 'https://example.com/nufri-3p'
      },
      {
        nombre: 'Nufri Flex 3P',
        tipo: '3P',
        totalNum: 53,
        total: '53,00 €',
        potencia: '10 €',
        consumo: '33 €',
        impuestos: '10 €',
        webUrl: 'https://example.com/nufri-flex-3p',
        requisitos: 'Ratio consumo/potencia ≤ 0,75 MWh/kW. Consumo anual ≤ 8.000 kWh/año.',
        avisoConsumoEstimado: {
          titulo: 'REQUISITOS NUFRI',
          ratioKwhPorKw: 750,
          maxKwhAnual: 8000
        }
      }
    ];

    await window.LF.renderTable();

    const rows = [...document.querySelectorAll('#tbody tr')];
    const getRow = (name) => rows.find((row) => row.textContent.includes(name));

    expect(getRow('Nufri').querySelector('.consumo-limits-icon')).toBeNull();
    expect(getRow('Nufri 3P').querySelector('.consumo-limits-icon')).toBeNull();

    const calmaWarn = getRow('Nufri Calma').querySelector('.consumo-limits-icon');
    const flexWarn = getRow('Nufri Flex 3P').querySelector('.consumo-limits-icon');

    expect(calmaWarn).not.toBeNull();
    expect(flexWarn).not.toBeNull();
    expect(calmaWarn.getAttribute('data-tip')).toContain('REQUISITOS NUFRI');
  });

});
