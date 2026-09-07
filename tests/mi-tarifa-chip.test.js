/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Atajo movil a "Mi tarifa".
 *
 * Lo que vigilan estos tests NO es la estetica del chip, es que siga siendo un
 * ESPEJO de la fila real: si algun dia alguien lo usa para reordenar, recalcular
 * o "destacar" la tarifa propia, el ranking dejaria de ser estrictamente
 * matematico. El chip informa y hace scroll; nada mas.
 *
 * Casi todo se prueba por COMPORTAMIENTO (con IntersectionObserver y matchMedia
 * simulados) en vez de por regex sobre el fuente: los chequeos textuales solo se
 * usan para el CSS, donde no hay otra forma, y para dos contratos que no dejan
 * rastro observable.
 */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const renderCode = read('js/lf-render.js');
const uiCode = read('js/lf-ui.js');
const styles = read('styles.css');
const indexHtml = read('index.html');

// ---------- harness ----------
let observers = [];      // instancias creadas de IntersectionObserver
let mqMatches = true;    // valor que devuelve matchMedia para el breakpoint movil
let breakpointMql = null;

class FakeIO {
  constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
  observe(el) { this.targets.push(el); }
  disconnect() { this.disconnected = true; }
  // Ayuda para simular que la fila entra o sale de pantalla
  fire(isIntersecting) { this.cb([{ isIntersecting, target: this.targets[0] }]); }
}

function fila(extra = {}) {
  return {
    nombre: 'Tarifa X', total: '100,00 €', totalNum: 100, vsMejor: '+10,00 €', vsMejorNum: 10,
    potencia: '10 €', consumo: '80 €', impuestos: '10 €', tipo: '1P', web: '',
    ...extra
  };
}

function createBreakpointMql() {
  const listeners = new Set();
  return {
    get matches() { return mqMatches; },
    addEventListener(type, cb) { if (type === 'change') listeners.add(cb); },
    removeEventListener(type, cb) { if (type === 'change') listeners.delete(cb); },
    addListener(cb) { listeners.add(cb); },
    removeListener(cb) { listeners.delete(cb); },
    emit() {
      const event = { matches: mqMatches, media: '(max-width: 768px)' };
      listeners.forEach((cb) => cb(event));
    }
  };
}

function changeBreakpoint(matches) {
  mqMatches = matches;
  breakpointMql?.emit();
}

async function render(rows, { mobile = true } = {}) {
  observers = [];
  mqMatches = mobile;
  breakpointMql = createBreakpointMql();
  document.body.innerHTML = `
    <input id="p1" value="0"><input id="p2" value="0"><input id="dias" value="30">
    <input id="cPunta" value="0"><input id="cLlano" value="0"><input id="cValle" value="0">
    <div id="heroKpis"><div id="kpiBest"></div><div id="kpiPrice"></div></div>
    <div id="statsBar"><div id="statMin"></div><div id="statAvg"></div><div id="statMax"></div></div>
    <div id="toolbar"></div><div id="pvpcInfo"></div><div id="chartTopBody"></div>
    <div id="resultsLiveStatus"></div><div id="solarHomeEstimatorNotice" hidden></div>
    <table id="table"><thead><tr><th data-sort="totalNum"><span id="si_totalNum"></span></th></tr></thead>
      <tbody id="tbody"></tbody></table>
    <div id="emptyBox"></div>
    <button type="button" id="miTarifaChip" hidden>
      <span id="miTarifaChipRank"></span><span id="miTarifaChipTotal"></span><span id="miTarifaChipDiff"></span>
    </button>`;

  window.LF = {
    $: (id) => document.getElementById(id),
    state: { rows, filter: 'all', sort: { key: 'totalNum', dir: 'asc' } },
    el: {
      tbody: document.getElementById('tbody'),
      table: document.getElementById('table'),
      emptyBox: document.getElementById('emptyBox'),
      heroKpis: document.getElementById('heroKpis')
    },
    formatMoney: (n) => n + ' €',
    escapeHtml: (s) => String(s ?? ''),
    safeUrl: () => '',
    setStatus: vi.fn(), animateCounter: vi.fn(), createSuccessParticles: vi.fn(),
    initTooltips: vi.fn(), bindTooltipElement: vi.fn(),
    parseNum: (v) => Number(String(v ?? '').replace(',', '.')) || 0,
    yieldControl: () => Promise.resolve()
  };
  window.IntersectionObserver = FakeIO;
  window.matchMedia = (q) => /max-width: 768px/.test(q)
    ? breakpointMql
    : {
        matches: false,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn()
      };

  new Function('window', renderCode)(window);
  window.LF.initMiTarifaChip();
  await window.LF.renderTable();
  await new Promise((r) => requestAnimationFrame(() => r()));
  return {
    chip: document.getElementById('miTarifaChip'),
    row: document.querySelector('.custom-tariff-highlight'),
    io: observers[observers.length - 1]
  };
}

beforeEach(() => {
  observers = [];
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  Element.prototype.scrollIntoView = vi.fn();
});

// ---------- comportamiento ----------
describe('mi-tarifa-chip: refleja la fila real', () => {
  it('muestra rank, total y diferencia de la tarifa propia', async () => {
    const { chip } = await render([
      fila({ nombre: 'Barata', total: '50,00 €', totalNum: 50, vsMejor: '—' }),
      fila({ nombre: 'Mi tarifa ⭐', total: '120,00 €', totalNum: 120, vsMejor: '+70,00 €', esPersonalizada: true })
    ]);
    expect(chip.hidden).toBe(false);
    expect(document.getElementById('miTarifaChipRank').textContent).toBe('#2');
    expect(document.getElementById('miTarifaChipTotal').textContent).toBe('120,00 €');
    expect(document.getElementById('miTarifaChipDiff').textContent).toBe('+70,00 €');
  });

  it('la posicion del chip coincide con la celda de ranking de su fila', async () => {
    const { chip, row } = await render([
      fila({ totalNum: 10, total: '10,00 €' }),
      fila({ totalNum: 20, total: '20,00 €' }),
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 30, total: '30,00 €', esPersonalizada: true })
    ]);
    void chip;
    expect(document.getElementById('miTarifaChipRank').textContent)
      .toBe('#' + row.querySelector('td').textContent.trim());
  });

  it('sin diferencia (posicion 1) no pinta un guion suelto', async () => {
    await render([fila({ nombre: 'Mi tarifa ⭐', vsMejor: '—', esPersonalizada: true })]);
    expect(document.getElementById('miTarifaChipDiff').textContent).toBe('');
  });

  it('colorea la diferencia segun el signo', async () => {
    await render([
      fila({ totalNum: 10, total: '10,00 €' }),
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 99, vsMejor: '+89,00 €', esPersonalizada: true })
    ]);
    expect(document.getElementById('miTarifaChipDiff').classList.contains('is-pos')).toBe(true);
  });
});

describe('mi-tarifa-chip: cuando NO debe existir', () => {
  it('en escritorio no se muestra', async () => {
    const { chip } = await render([fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })], { mobile: false });
    expect(chip.hidden).toBe(true);
  });

  it('sin tarifa propia no se muestra', async () => {
    const { chip } = await render([fila(), fila()]);
    expect(chip.hidden).toBe(true);
  });

  it('sin filas no se muestra', async () => {
    const { chip } = await render([]);
    expect(chip.hidden).toBe(true);
  });

  it('si la tarifa propia queda fuera por el filtro, desaparece', async () => {
    const { chip } = await render([
      fila({ tipo: '3P' }),
      fila({ nombre: 'Mi tarifa ⭐', tipo: '1P', esPersonalizada: true })
    ]);
    expect(chip.hidden).toBe(false);
    window.LF.state.filter = '3P';
    await window.LF.renderTable();
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(chip.hidden).toBe(true);
  });

  it('si Mi tarifa no tiene puesto ni total comparable, no muestra un chip vacio', async () => {
    const { chip, row } = await render([
      fila({ totalNum: 10, total: '10,00 €' }),
      fila({
        nombre: 'Mi tarifa ⭐',
        totalNum: Number.POSITIVE_INFINITY,
        total: '—',
        vsMejor: '—',
        solarNoCalculable: true,
        solarNoCalculableReason: 'No se pudo resolver el precio de excedentes',
        esPersonalizada: true
      })
    ]);

    expect(row).not.toBeNull();
    expect(row.querySelector('td').textContent.trim()).toBe('—');
    expect(chip.hidden).toBe(true);
    expect(observers).toHaveLength(0);
  });
});

describe('mi-tarifa-chip: visibilidad segun scroll', () => {
  it('aparece al salir la fila de pantalla y se retira al volver', async () => {
    const { chip, io } = await render([
      fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })
    ]);
    io.fire(false);                                   // fila fuera de viewport
    expect(chip.classList.contains('is-visible')).toBe(true);
    io.fire(true);                                    // fila de vuelta
    expect(chip.classList.contains('is-visible')).toBe(false);
  });
});

describe('mi-tarifa-chip: ciclo de vida sin fugas', () => {
  it('desconecta el observer anterior en cada recalculo', async () => {
    await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const primero = observers[observers.length - 1];
    await window.LF.renderTable();
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(primero.disconnected).toBe(true);
    expect(observers[observers.length - 1]).not.toBe(primero);
  });

  it('vigila la fila NUEVA, no la desechada', async () => {
    const { row } = await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    await window.LF.renderTable();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const nuevo = observers[observers.length - 1];
    const filaNueva = document.querySelector('.custom-tariff-highlight');
    expect(nuevo.targets[0]).toBe(filaNueva);
    expect(nuevo.targets[0]).not.toBe(row);
    expect(document.contains(nuevo.targets[0])).toBe(true);
  });

  it('ignora callbacks ya encolados de un observer desconectado', async () => {
    const { chip } = await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const anterior = observers[observers.length - 1];
    await window.LF.renderTable();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const vigente = observers[observers.length - 1];

    vigente.fire(true);
    expect(chip.classList.contains('is-visible')).toBe(false);
    // FakeIO permite entregar expresamente una entrada vieja ya encolada. Un
    // observer desconectado nunca debe poder contradecir al vigente.
    anterior.fire(false);
    expect(chip.classList.contains('is-visible')).toBe(false);
  });

  it('suelta la fila vieja ANTES de desprenderla del DOM', async () => {
    // Si el observer sigue enganchado cuando replaceChildren() desprende la fila,
    // el navegador emite un ultimo callback con isIntersecting=false y el chip se
    // enciende indebidamente. Con `prefers-reduced-motion` (transicion instantanea)
    // eso era un destello REAL de 44 ms medido en Chrome, no un detalle teorico.
    await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const primero = observers[observers.length - 1];
    const tbody = window.LF.el.tbody;
    const original = tbody.replaceChildren.bind(tbody);
    let desconectadoAlVaciar = null;
    tbody.replaceChildren = (...args) => {
      desconectadoAlVaciar = primero.disconnected; // estado JUSTO antes de vaciar
      return original(...args);
    };
    await window.LF.renderTable();
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(desconectadoAlVaciar).toBe(true);
  });

  it('tambien suelta la fila antes de un vaciado TOTAL', async () => {
    const { chip } = await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const primero = observers[observers.length - 1];
    const tbody = window.LF.el.tbody;
    const original = tbody.replaceChildren.bind(tbody);
    let desconectadoAlVaciar = null;
    tbody.replaceChildren = (...args) => {
      desconectadoAlVaciar = primero.disconnected;
      return original(...args);
    };

    window.LF.state.rows = [];
    await window.LF.renderTable();

    expect(desconectadoAlVaciar).toBe(true);
    expect(chip.hidden).toBe(true);
    expect(tbody.children).toHaveLength(0);
  });

  it('hideResultsToInitialState limpia el chip antes de vaciar la tabla', async () => {
    const { chip } = await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const primero = observers[observers.length - 1];
    const tbody = window.LF.el.tbody;
    const original = tbody.replaceChildren.bind(tbody);
    let desconectadoAlVaciar = null;
    tbody.replaceChildren = (...args) => {
      desconectadoAlVaciar = primero.disconnected;
      return original(...args);
    };

    new Function('window', uiCode)(window);
    window.LF.hideResultsToInitialState();

    expect(desconectadoAlVaciar).toBe(true);
    expect(chip.hidden).toBe(true);
    expect(tbody.children).toHaveLength(0);
  });

  it('sin IntersectionObserver el chip no se muestra nunca', async () => {
    const rows = [fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })];
    const { chip } = await render(rows);
    expect(chip.hidden).toBe(false);
    // Degradacion: mejor no mostrarlo que dejarlo fijo encima del contenido.
    delete window.IntersectionObserver;
    await window.LF.renderTable();
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(chip.hidden).toBe(true);
    expect(chip.classList.contains('is-visible')).toBe(false);
  });

  it('render cancelado entre chunks: solo el observer final vigila la fila final', async () => {
    // Mas de CHUNK_SIZE (10): asi el primer render entra realmente en yieldControl.
    const lentas = Array.from({ length: 11 }, (_, i) => fila({
      nombre: i === 10 ? 'Mi tarifa ⭐' : `Tarifa ${i}`,
      totalNum: i === 10 ? 99 : i + 10,
      total: i === 10 ? '99,00 €' : `${i + 10},00 €`,
      esPersonalizada: i === 10
    }));
    await render(lentas);
    const observersAntes = observers.length;

    // Dejar el yield del primer render colgado para cancelarlo a media.
    let soltar;
    window.LF.yieldControl = () => new Promise((r) => { soltar = r; });
    const primerRender = window.LF.renderTable();
    expect(soltar).toEqual(expect.any(Function));

    // Segundo render con datos distintos: cancela el primero.
    window.LF.yieldControl = () => Promise.resolve();
    window.LF.state.rows = [
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 5, total: '5,00 €', vsMejor: '—', esPersonalizada: true }),
      fila({ totalNum: 10, total: '10,00 €' })
    ];
    const segundoRender = window.LF.renderTable();
    if (soltar) soltar();
    await Promise.all([primerRender, segundoRender]);
    await new Promise((r) => requestAnimationFrame(() => r()));

    const ultimo = observers[observers.length - 1];
    const filaFinal = document.querySelector('.custom-tariff-highlight');
    expect(observers.length).toBeGreaterThan(observersAntes);
    expect(ultimo.disconnected).toBe(false);
    expect(ultimo.targets[0]).toBe(filaFinal);
    expect(document.contains(filaFinal)).toBe(true);
    // Todos los anteriores, desconectados: ni fugas ni observers duplicados.
    observers.slice(0, -1).forEach((o) => expect(o.disconnected).toBe(true));
    // Y el chip acaba con las cifras del calculo que gano.
    expect(document.getElementById('miTarifaChipTotal').textContent).toBe('5,00 €');
    expect(document.getElementById('miTarifaChipRank').textContent).toBe('#1');
  });

  it('un render vacio cancela otro render suspendido entre chunks', async () => {
    const lentas = Array.from({ length: 11 }, (_, i) => fila({
      nombre: i === 10 ? 'Mi tarifa ⭐' : `Tarifa ${i}`,
      totalNum: i + 1,
      total: `${i + 1},00 €`,
      esPersonalizada: i === 10
    }));
    const { chip } = await render(lentas);

    let soltar;
    window.LF.yieldControl = () => new Promise((resolve) => { soltar = resolve; });
    const renderSuspendido = window.LF.renderTable();
    expect(soltar).toEqual(expect.any(Function));

    window.LF.state.rows = [];
    await window.LF.renderTable();
    soltar();
    await renderSuspendido;
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    expect(window.LF.el.tbody.children).toHaveLength(0);
    expect(chip.hidden).toBe(true);
    observers.forEach((observer) => expect(observer.disconnected).toBe(true));
  });

  it('los datos se actualizan ANTES de repintar: nunca cifras del calculo anterior', async () => {
    await render([fila({ totalNum: 10, total: '10,00 €' }),
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 99, total: '99,00 €', vsMejor: '+89,00 €', esPersonalizada: true })]);
    expect(document.getElementById('miTarifaChipTotal').textContent).toBe('99,00 €');

    // Nuevo calculo: la tarifa propia pasa a ser la mas barata.
    window.LF.state.rows = [
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 5, total: '5,00 €', vsMejor: '—', esPersonalizada: true }),
      fila({ totalNum: 10, total: '10,00 €' })
    ];
    const p = window.LF.renderTable();
    // Antes incluso de que termine el render, el dato ya debe ser el nuevo.
    expect(document.getElementById('miTarifaChipTotal').textContent).toBe('5,00 €');
    expect(document.getElementById('miTarifaChipRank').textContent).toBe('#1');
    await p;
  });
});

describe('mi-tarifa-chip: cambio de breakpoint', () => {
  it('el evento real de matchMedia movil -> escritorio -> movil deja el chip coherente', async () => {
    const rows = [fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })];
    const { chip } = await render(rows);
    expect(chip.hidden).toBe(false);

    // A escritorio sin recalcular: el listener de matchMedia hace todo el trabajo.
    const previo = observers[observers.length - 1];
    changeBreakpoint(false);
    expect(chip.hidden).toBe(true);
    expect(previo.disconnected).toBe(true);

    // De vuelta a movil, tambien sin render: recupera datos y fila actuales.
    changeBreakpoint(true);
    const ultimo = observers[observers.length - 1];
    expect(chip.hidden).toBe(false);
    expect(ultimo.disconnected).toBe(false);
    expect(ultimo.targets[0]).toBe(document.querySelector('.custom-tariff-highlight'));
  });
});

describe('mi-tarifa-chip: accesibilidad', () => {
  it('traspasa el foco a la fila destino antes de desplazar', async () => {
    const { chip } = await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const celda = document.querySelector('.custom-tariff-highlight .tarifa-cell');
    const spyFocus = vi.spyOn(celda, 'focus');
    chip.click();
    expect(spyFocus).toHaveBeenCalled();
    expect(spyFocus.mock.calls[0][0]).toEqual({ preventScroll: true });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(spyFocus.mock.invocationCallOrder[0])
      .toBeLessThan(Element.prototype.scrollIntoView.mock.invocationCallOrder[0]);
  });

  it('neutraliza el scroll suave CSS durante el salto y restaura los estilos', async () => {
    const { chip } = await render([fila(), fila({ nombre: 'Mi tarifa ⭐', esPersonalizada: true })]);
    const rootBehaviorInicial = document.documentElement.style.scrollBehavior;
    const bodyBehaviorInicial = document.body.style.scrollBehavior;
    vi.useFakeTimers();
    try {
      document.documentElement.style.scrollBehavior = 'smooth';
      document.body.style.scrollBehavior = 'smooth';
      Element.prototype.scrollIntoView.mockImplementationOnce(() => {
        expect(document.documentElement.style.scrollBehavior).toBe('auto');
        expect(document.body.style.scrollBehavior).toBe('auto');
      });

      chip.click();
      vi.advanceTimersByTime(300);

      // Una sola operacion inmediata: no queda un reintento tardio que pueda
      // interrumpir otro scroll o actuar sobre una fila ya repintada.
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(Element.prototype.scrollIntoView)
        .toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
      expect(document.documentElement.style.scrollBehavior).toBe('smooth');
      expect(document.body.style.scrollBehavior).toBe('smooth');
    } finally {
      vi.useRealTimers();
      document.documentElement.style.scrollBehavior = rootBehaviorInicial;
      document.body.style.scrollBehavior = bodyBehaviorInicial;
    }
  });

  it('describe el destino en aria-label', async () => {
    const { chip } = await render([
      fila({ totalNum: 10, total: '10,00 €' }),
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 99, total: '99,00 €', vsMejor: '+89,00 €', esPersonalizada: true })
    ]);
    const label = chip.getAttribute('aria-label');
    expect(label).toContain('Ir a mi tarifa en el ranking');
    expect(label).toContain('posicion 2');
    expect(label).toContain('99,00 €');
  });

  it('es un boton real, no un div con onclick', () => {
    expect(indexHtml).toMatch(/<button type="button" id="miTarifaChip"/);
  });
});

describe('mi-tarifa-chip: no toca el ranking', () => {
  it('no reordena ni altera ninguna fila', async () => {
    const filas = [
      fila({ nombre: 'A', totalNum: 10, total: '10,00 €' }),
      fila({ nombre: 'Mi tarifa ⭐', totalNum: 99, total: '99,00 €', esPersonalizada: true }),
      fila({ nombre: 'B', totalNum: 50, total: '50,00 €' })
    ];
    const copia = JSON.parse(JSON.stringify(filas));
    await render(filas);
    // Orden pintado: estrictamente por total, sin privilegio para la propia.
    const nombres = [...document.querySelectorAll('#tbody .tarifa-nombre')].map((e) => e.textContent);
    expect(nombres).toEqual(['A', 'B', 'Mi tarifa ⭐']);
    // Y los datos de entrada siguen intactos.
    expect(JSON.parse(JSON.stringify(window.LF.state.rows))).toEqual(copia);
  });

  it('el bloque del chip no reordena ni escribe importes', () => {
    const bloque = renderCode.slice(
      renderCode.indexOf('ATAJO MOVIL A "MI TARIFA"'),
      renderCode.indexOf('===== FILTROS Y ORDENACIÓN =====')
    );
    expect(bloque.length).toBeGreaterThan(500);
    expect(bloque).not.toMatch(/\.sort\(|unshift\(|splice\(|insertBefore\(|totalNum\s*=[^=]/);
    expect(bloque).not.toMatch(/innerHTML/);
  });
});

// ---------- CSS (aqui el chequeo textual es la unica via) ----------
describe('mi-tarifa-chip: estilos', () => {
  it('solo existe bajo el breakpoint movil', () => {
    expect(styles).toMatch(/\.mi-tarifa-chip \{ display: none; \}/);
  });

  it('define fondo opaco propio en oscuro y en claro', () => {
    expect(styles).toMatch(/background: rgba\(11, 16, 32, \.95\)/);
    expect(styles).toMatch(/html\.light-mode \.mi-tarifa-chip:not\(\[hidden\]\) \{[\s\S]*?background: rgba\(255, 255, 255, \.95\)/);
  });

  it('usa colores de diferencia con contraste AA en modo claro', () => {
    expect(styles).toMatch(/html\.light-mode \.mi-tarifa-chip__diff\.is-pos \{ color: #DC2626; \}/);
    expect(styles).toMatch(/html\.light-mode \.mi-tarifa-chip__diff\.is-neg \{ color: #15803D; \}/);
  });

  it('se centra con inset + margin-inline, no con translateX', () => {
    // Con `left:50%` el ancho disponible pasa a ser 100vw-50% y la etiqueta se
    // truncaba a "M..." aunque sobrara sitio. Regresion detectada en Chrome real.
    const bloque = styles.slice(styles.indexOf('ATAJO MOVIL A "MI TARIFA"'));
    expect(bloque).toMatch(/margin-inline: auto;/);
    expect(bloque).toMatch(/width: fit-content;/);
    expect(bloque).not.toMatch(/translate\(-50%/);
  });

  it('sale del arbol de accesibilidad cuando no esta visible', () => {
    // Solo con opacity:0 el boton seguiria siendo enfocable y anunciable.
    const bloque = styles.slice(styles.indexOf('ATAJO MOVIL A "MI TARIFA"'));
    expect(bloque).toMatch(/visibility: hidden;/);
    expect(bloque).toMatch(/\.is-visible \{[\s\S]*?visibility: visible;/);
  });

  it('se oculta con las dos convenciones VISUALES de modal abierto', () => {
    // El overlay del desglose es `.desglose-overlay.active` y translucido
    // (rgba(0,0,0,.7)): sin esta regla el chip se transparentaria por detras.
    expect(styles).toMatch(/body:has\(\.desglose-overlay\.active\) \.mi-tarifa-chip/);
    expect(styles).toMatch(/body:has\(\.modal-overlay\.show\) \.mi-tarifa-chip/);
  });

  it('NO casa por aria-hidden: depende solo de la presencia visual del overlay', () => {
    // La regla del chip debe seguir el estado visual `.show`/`.active`. El
    // atributo semantico se comprueba por separado como invariante de los modales.
    const bloque = styles.slice(styles.indexOf('ATAJO MOVIL A "MI TARIFA"'));
    expect(bloque).not.toMatch(/\.mi-tarifa-chip[^\n]*aria-hidden/);
    expect(bloque).not.toMatch(/aria-hidden[^\n]*\.mi-tarifa-chip/);
  });

  it('INVARIANTE: todo modal que se abre con aria-hidden=false anade .show o .active', () => {
    // De esto depende que baste con las dos reglas visuales de arriba. Si alguien
    // anade un modal que solo cambia aria-hidden, el chip se le colara encima y
    // este test debe avisarlo ANTES de que llegue a produccion.
    const ficheros = ['js/index-extra.js', 'js/lf-inputs.js', 'js/lf-csv-import.js',
      'js/factura.js', 'js/desglose-factura.js'];
    ficheros.forEach((f) => {
      const src = read(f);
      const aperturas = [...src.matchAll(/([\w$.]+)\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]false['"]\s*\)/g)];
      expect(aperturas.length, `${f} ya no contiene la apertura modal inventariada`).toBeGreaterThan(0);

      aperturas.forEach((apertura) => {
        const receptor = apertura[1];
        const inicio = Math.max(0, apertura.index - 700);
        const fin = Math.min(src.length, apertura.index + apertura[0].length + 700);
        const contexto = src.slice(inicio, fin);
        const receptorSeguro = receptor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const marcaVisual = new RegExp(
          `${receptorSeguro}\\.classList\\.add\\(\\s*['"](?:show|active)['"]|` +
          `${receptorSeguro}\\.className\\s*=\\s*['"][^'"]*\\b(?:show|active)\\b`
        );
        expect(
          contexto,
          `${f}: ${receptor} abre con aria-hidden=false sin su propia marca visual`
        ).toMatch(marcaVisual);
      });
    });
  });

  it('queda por debajo de banner, boton flotante, toast y modales', () => {
    expect(styles).toMatch(/z-index: 9996;/);
  });
});
