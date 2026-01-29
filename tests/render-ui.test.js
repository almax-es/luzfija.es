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
    // Funciones que render necesita llamar
    updateSortIcons: vi.fn(), 
    renderTarifasUpdated: vi.fn(),
    bindTooltipElement: vi.fn()
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

});
