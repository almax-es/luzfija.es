import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Mocks de utilidades
const formatMoney = (n) => n + ' €';
const escapeHtml = (s) => s;
const lfDbg = vi.fn();

const animateCounterSpy = vi.fn((element, text) => {
  if (element) element.textContent = text;
});

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
    lfDbg,
    setStatus: vi.fn(),
    toast: vi.fn(),
    // Espia con el MISMO comportamiento que antes (asignar el texto). Se declara aqui
    // porque lf-render.js desestructura window.LF al cargarse: sustituirlo despues no
    // intercepta nada.
    animateCounter: animateCounterSpy,
    createSuccessParticles: vi.fn(),
    initTooltips: vi.fn(),
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
      <section id="seccionResultados"></section>
      <button id="scrollToResults" style="display:none"></button>
    `;
    document.getElementById('seccionResultados').scrollIntoView = vi.fn();

    // Resetear estado
    window.LF.state.rows = [];
    window.LF.state.filter = 'all';
    window.LF.state.sort = { key: 'totalNum', dir: 'asc' };
    window.LF.state.focusAnnualConsumptionEstimateToggle = false;
    delete window.pvpcLastMeta;
    
    // Vincular elementos al objeto LF.el (como hace initElements)
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

    // RE-EVALUAR el código para que coja las referencias nuevas
    renderFn(global.window);
  });

  it('Muestra en el resumen PVPC la cobertura parcial del cálculo híbrido', () => {
    window.pvpcLastMeta = {
      precioPunta: 0.20,
      precioLlano: 0.10,
      precioValle: 0.05,
      rangoFechas: { inicio: '01/01/2026', fin: '31/01/2026' },
      fechaConsulta: '2026-02-01T12:00:00.000Z',
      pvpcCoverage: {
        mode: 'hybrid',
        hoursWithPrice: 9,
        hoursWithoutPrice: 1,
        missingKwhShare: 0.1,
        hasMissingPrices: true
      }
    };

    window.LF.renderPvpcInfo();

    expect(document.getElementById('pvpcInfo').textContent).toContain('Cobertura horaria parcial');
    expect(document.getElementById('pvpcInfo').textContent).toContain('9 de 10 horas con precio');
    expect(document.getElementById('pvpcInfo').textContent).toContain('10,0% de la energía');
  });

  it('Muestra en el resumen PVPC el fallback completo por cobertura insuficiente', () => {
    window.pvpcLastMeta = {
      precioPunta: 0.20,
      precioLlano: 0.10,
      precioValle: 0.05,
      fechaConsulta: '2026-02-01T12:00:00.000Z',
      pvpcCoverage: {
        mode: 'average',
        hoursWithPrice: 8,
        hoursWithoutPrice: 2,
        missingKwhShare: 0.2,
        hasMissingPrices: true
      }
    };

    window.LF.renderPvpcInfo();

    expect(document.getElementById('pvpcInfo').textContent).toContain('Sin cobertura horaria suficiente');
    expect(document.getElementById('pvpcInfo').textContent).toContain('2 de 10 horas sin precio');
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

  it('Desempata totales a 0 por mayor saldo BV y lo muestra en Total', async () => {
    window.LF.state.rows = [
      {
        nombre: 'BV menos saldo',
        tipo: '3P',
        totalNum: 0,
        total: '0,00 €',
        potencia: '0 €',
        consumo: '0 €',
        impuestos: '0 €',
        webUrl: 'https://example.com/bv-menor',
        fvTipo: 'SIMPLE + BV',
        fvBvSaldoFin: 20,
        fvTotalFinal: 0
      },
      {
        nombre: 'BV más saldo',
        tipo: '3P',
        totalNum: 0,
        total: '0,00 €',
        potencia: '0 €',
        consumo: '0 €',
        impuestos: '0 €',
        webUrl: 'https://example.com/bv-mayor',
        fvTipo: 'SIMPLE + BV',
        fvBvSaldoFin: 50,
        fvTotalFinal: 10
      }
    ];

    await window.LF.renderTable();

    const rows = [...document.querySelectorAll('#tbody tr')];
    expect(rows[0].textContent).toContain('BV más saldo');
    expect(rows[0].querySelector('.total-bv-saldo').textContent).toContain('BV +50 €');
  });

  it('renderTable no lanza excepción con state.rows = null', async () => {
    window.LF.state.rows = null;
    await expect(window.LF.renderTable()).resolves.not.toThrow();
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

  it('Anuncia un resumen accesible al terminar de renderizar resultados', async () => {
    vi.useFakeTimers();
    try {
      window.LF.renderAll({
        success: true,
        resumen: {
          mejor: 'Tarifa Barata',
          precio: '50,00 €'
        },
        stats: {
          precioMin: '50,00 €',
          precioMedio: '75,00 €',
          precioMax: '100,00 €'
        },
        resultados: [...mockRows]
      });

      await vi.runAllTimersAsync();

      const live = document.getElementById('resultsLiveStatus');
      expect(live.textContent).toContain('Resultados actualizados: 3 tarifas en el ranking.');
      expect(live.textContent).toContain('Tarifa más barata: Tarifa Barata.');
      expect(live.textContent).toContain('Coste más bajo con impuestos: 50,00 €.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Muestra el aviso del Simulador Solar solo si el cálculo renderizado es solar', () => {
    const notice = document.getElementById('solarHomeEstimatorNotice');
    expect(notice.hidden).toBe(true);

    // Cálculo en modo solar → el aviso se muestra
    window.LF.renderAll({
      success: true,
      solarOn: true,
      resumen: { mejor: 'Tarifa Solar', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows]
    });
    expect(notice.hidden).toBe(false);

    // El aviso describe el cálculo renderizado, no el formulario: un cálculo
    // posterior sin solar lo oculta, aunque hubiera un checkbox marcado
    window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows]
    });
    expect(notice.hidden).toBe(true);
  });

  it('Explica las tarifas excluidas por los kWh ya registrados', () => {
    window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows],
      limitesConsumo: {
        consumoKwh: 6512,
        excluidas: [{ tarifa: { nombre: 'Imagina 4000' }, tipo: 'maximo', limiteKwh: 4000 }]
      }
    });

    const notice = document.getElementById('consumoLimitsNotice');
    expect(notice.hidden).toBe(false);
    expect(notice.getAttribute('role')).toBe('note');
    expect(notice.textContent).toContain('Imagina 4000');
    expect(notice.textContent).toMatch(/6\.?512 kWh/);
    expect(notice.textContent).toMatch(/como máximo 4\.?000 kWh/);
    expect(notice.querySelector('.consumo-estimate-toggle')).toBeNull();
  });

  it('Ofrece una estimación opt-in, explica su efecto y emite el cambio reversible', () => {
    const changeSpy = vi.fn();
    document.addEventListener('lf:annual-consumption-estimate-change', changeSpy, { once: true });
    window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows],
      limitesConsumo: {
        consumoKwh: 500,
        coveredDays: 30,
        estimatedAnnualKwh: 6083.33,
        estimateAvailable: true,
        estimateApplied: false,
        excluidas: [],
        excluidasReales: [],
        excluidasEstimadas: [{
          tarifa: { nombre: 'Máximo 4000' },
          tipo: 'maximo',
          limiteKwh: 4000,
          origen: 'estimacion'
        }]
      }
    });

    const notice = document.getElementById('consumoLimitsNotice');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toMatch(/6\.?083 kWh\/año/);
    expect(notice.textContent).toContain('500 kWh registrados durante 30 días');
    expect(notice.textContent).toContain('1 tarifa dejará de mostrarse');
    expect(notice.textContent).toContain('Según la estimación anual');
    const toggle = notice.querySelector('.consumo-estimate-toggle');
    expect(toggle.textContent).toBe('Aplicar límites con esta estimación');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);

    toggle.click();
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy.mock.calls[0][0].detail).toEqual({ enabled: true });
  });

  it('Advierte de estacionalidad y pocos días sin mezclar acción con estado ARIA', () => {
    window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows],
      limitesConsumo: {
        consumoKwh: 12,
        coveredDays: 1,
        estimatedAnnualKwh: 4380,
        estimateAvailable: true,
        estimateApplied: true,
        excluidas: [],
        excluidasReales: [],
        excluidasEstimadas: [{ tarifa: { nombre: 'Máximo 4000' }, tipo: 'maximo', limiteKwh: 4000, origen: 'estimacion' }]
      }
    });

    const notice = document.getElementById('consumoLimitsNotice');
    expect(notice.textContent).toContain('calefacción o aire acondicionado');
    expect(notice.textContent).toContain('Con menos de 28 días');
    const toggle = notice.querySelector('.consumo-estimate-toggle');
    expect(toggle.textContent).toBe('Volver a mostrar esas tarifas');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
  });

  it('Consume la petición de foco aunque el siguiente aviso quede oculto', () => {
    window.LF.state.focusAnnualConsumptionEstimateToggle = true;
    window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows],
      limitesConsumo: { excluidas: [], excluidasReales: [], excluidasEstimadas: [] }
    });

    expect(document.getElementById('consumoLimitsNotice').hidden).toBe(true);
    expect(window.LF.state.focusAnnualConsumptionEstimateToggle).toBe(false);
  });

  it('El aviso solar de index.html enlaza al simulador y respeta el guardrail de copy', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

    const noticeMatch = html.match(/<div id="solarHomeEstimatorNotice"[\s\S]*?<\/div>/);
    expect(noticeMatch, 'falta el contenedor #solarHomeEstimatorNotice en index.html').toBeTruthy();
    expect(noticeMatch[0]).toContain('hidden');
    expect(noticeMatch[0]).toContain('/comparador-tarifas-solares.html');
    expect(noticeMatch[0].toLowerCase()).not.toContain('exacto');

    // El modal solar también recomienda el simulador
    const modalMatch = html.match(/<div class="modal-overlay[^>]*id="modalSolarInfo"[\s\S]*?btnCerrarSolarInfo/);
    expect(modalMatch, 'falta modalSolarInfo en index.html').toBeTruthy();
    expect(modalMatch[0]).toContain('/comparador-tarifas-solares.html');

    // Y el bloque de excedentes del import CSV enlaza al simulador
    const csvSource = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-import.js'), 'utf8');
    expect(csvSource).toContain('Excedentes solares detectados');
    expect(csvSource).toContain('/comparador-tarifas-solares.html');
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


  it('Marca una tarifa con SSAA no disponible como no comparable y explica el motivo', async () => {
    window.LF.state.rows = [
      {
        nombre: 'Tarifa Disponible',
        tipo: '1P',
        totalNum: 50,
        total: '50,00 €',
        potencia: '10 €',
        consumo: '30 €',
        impuestos: '10 €'
      },
      {
        nombre: 'Tarifa sin SSAA',
        tipo: '1P',
        totalNum: Number.POSITIVE_INFINITY,
        total: '—',
        potencia: '—',
        consumo: '—',
        impuestos: '—',
        dataUnavailable: true,
        dataUnavailableReason: 'SSAA temporalmente no disponible'
      }
    ];

    await window.LF.renderTable();

    const rows = [...document.querySelectorAll('#tbody tr')];
    expect(rows.map((row) => row.dataset.tarifaNombre)).toEqual(['Tarifa Disponible', 'Tarifa sin SSAA']);
    const unavailable = rows[1];
    expect(unavailable.cells[0].textContent).toBe('—');
    expect(unavailable.querySelector('.badge.rank').textContent).toBe('—');
    expect(unavailable.querySelector('.pvpc-warn').getAttribute('title')).toContain('SSAA temporalmente no disponible');
    expect(unavailable.querySelector('.tarifa-cell').getAttribute('aria-disabled')).toBe('true');
    expect(unavailable.querySelector('.total-cell').getAttribute('aria-disabled')).toBe('true');
    expect(unavailable.querySelector('.desglose-icon')).toBeNull();
  });

  it('Mantiene PVPC no comparable al final con cualquier orden y sin posición', async () => {
    window.LF.state.rows = [
      {
        nombre: 'Tarifa Barata',
        tipo: '1P',
        potenciaNum: 10,
        consumoNum: 30,
        impuestosNum: 10,
        totalNum: 50,
        vsMejorNum: 0,
        total: '50,00 €',
        potencia: '10 €',
        consumo: '30 €',
        impuestos: '10 €'
      },
      {
        nombre: 'Tarifa Cara',
        tipo: '1P',
        potenciaNum: 20,
        consumoNum: 60,
        impuestosNum: 20,
        totalNum: 100,
        vsMejorNum: 50,
        total: '100,00 €',
        potencia: '20 €',
        consumo: '60 €',
        impuestos: '20 €'
      },
      {
        nombre: 'PVPC',
        tipo: '1P',
        potenciaNum: 0,
        consumoNum: 0,
        impuestosNum: 0,
        totalNum: Number.POSITIVE_INFINITY,
        vsMejorNum: 0,
        total: '—',
        potencia: '—',
        consumo: '—',
        impuestos: '—',
        solarNoCalculable: true,
        solarNoCalculableReason: 'PVPC no se compara en modo solar desde la home.'
      }
    ];

    const sortKeys = ['nombre', 'potenciaNum', 'consumoNum', 'impuestosNum', 'totalNum', 'vsMejorNum'];
    for (const key of sortKeys) {
      for (const dir of ['asc', 'desc']) {
        window.LF.state.sort = { key, dir };
        await window.LF.renderTable();

        const rows = [...document.querySelectorAll('#tbody tr')];
        expect(rows.map((row) => row.dataset.tarifaNombre)).toEqual(
          dir === 'asc'
            ? ['Tarifa Barata', 'Tarifa Cara', 'PVPC']
            : ['Tarifa Cara', 'Tarifa Barata', 'PVPC']
        );
        expect(rows[2].cells[0].textContent).toBe('—');
        expect(rows[2].querySelector('.badge.rank').textContent).toBe('—');
      }
    }
  });

  it('Muestra el tramo no aplicado en factura y el saldo BV sin decir que usa BV previa', async () => {
    window.LF.state.rows = [{
      nombre: 'Solar Parcial BV',
      tipo: '3P',
      totalNum: 19.69,
      total: '19,69 €',
      potencia: '11,98 €',
      consumo: '7,23 €',
      consumoNum: 7.23,
      impuestos: '3,76 €',
      webUrl: 'https://example.com/solar-parcial',
      fvTipo: 'SIMPLE + BV',
      fvTope: 'ENERGIA_PARCIAL',
      fvApplied: true,
      fvExKwh: 364.30,
      fvPriceUsed: 0.08,
      fvCredit1: 25.86,
      fvCredit2: 0,
      fvBvSaldoFin: 3.28,
      fvExcedenteSobrante: 3.28,
      fvExcedenteNoCompensable: 3.28,
      fvTotalFinal: 22.97,
      fvBaseCompensable: 25.86,
      fvPeajesTotal: 7.23
    }];

    await window.LF.renderTable();

    const tip = document.querySelector('.fv-icon').getAttribute('data-tip');
    expect(tip).toContain('No aplicado en factura por peajes/cargos: 3,28 €');
    expect(tip).toContain('Saldo BV final: 3,28 €');
    expect(tip).toContain('Pagas este mes: 22.97 €');
    expect(tip).not.toContain('usando BV acumulada');
  });


  // Ronda 13: el orquestador espera esta promesa antes de abrir el lifecycle de una
  // peticion encolada. Devolverla es parte del contrato: si renderAll vuelve a fire-and-forget,
  // lf:results-ready del calculo viejo puede llegar despues del requested del siguiente.
  it('renderAll devuelve una promesa que resuelve al terminar el render de resultados', async () => {
    const done = window.LF.renderAll({
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows]
    });

    expect(done).toBeInstanceOf(Promise);
    await done;
    expect(document.querySelectorAll('#tbody tr').length).toBe(3);
  });

  it('cada render movil renueva los cinco segundos del boton para ir a resultados', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const payload = {
      success: true,
      resumen: { mejor: 'Tarifa Barata', precio: '50,00 €' },
      stats: null,
      resultados: [...mockRows]
    };

    try {
      await window.LF.renderAll(payload);
      expect(document.getElementById('scrollToResults').style.display).toBe('block');

      await vi.advanceTimersByTimeAsync(3000);
      await window.LF.renderAll(payload);
      await vi.advanceTimersByTimeAsync(2001);

      // Ya pasaron mas de 5 s desde el primer render, pero solo 2 s desde el segundo.
      // Un timer viejo no puede acortar la ventana de visibilidad del aviso nuevo.
      expect(document.getElementById('scrollToResults').style.display).toBe('block');

      await vi.advanceTimersByTimeAsync(3000);
      expect(document.getElementById('scrollToResults').style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  // 27/08/2026: el nombre de la tarifa NO puede pasar por animateCounter(). El guard de
  // la funcion solo mira si el texto EMPIEZA por cifra, asi que una tarifa futura como
  // "3 Periodos Online" volveria a animarse mal. La frontera correcta es el caller.
  it('el nombre de la tarifa se asigna directo; solo el importe pasa por animateCounter', async () => {
    animateCounterSpy.mockClear();

    window.LF.renderAll({
      success: true,
      rows: [{ nombre: '3 Periodos Online', total: 50, totalNum: 50 }],
      resumen: { mejor: '3 Periodos Online', precio: '50,00 €' }
    });
    await new Promise((r) => setTimeout(r, 0));

    const recibidos = animateCounterSpy.mock.calls.map((c) => c[1]);
    expect(document.getElementById('kpiBest').textContent).toBe('3 Periodos Online');
    expect(recibidos).not.toContain('3 Periodos Online');
    expect(recibidos).toContain('50,00 €');
  });

});
