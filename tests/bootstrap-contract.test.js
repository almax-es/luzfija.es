import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Contrato de arranque de las tres aplicaciones.
 *
 * Los modulos del sitio son IIFEs que publican y consumen APIs sobre globals
 * compartidos (window.LF, window.BVSim, window.PVPC_STATS...). Varios de ellos
 * DESESTRUCTURAN sus dependencias en tiempo de evaluacion:
 *
 *   const { el, state, THEME_KEY } = window.LF;
 *
 * Esa lectura ocurre una sola vez, al ejecutarse el fichero, y tiene dos
 * desenlaces segun el estado del namespace:
 *
 *   - window.LF existe pero le falta la propiedad: el consumidor captura
 *     `undefined` de forma permanente. No lanza, no hay reintento y no hay
 *     recuperacion sin recargar. Es el caso silencioso.
 *   - window.LF no existe todavia: `const { ... } = window.LF` lanza TypeError
 *     y aborta el IIFE completo. Es ruidoso, pero deja el modulo sin ejecutar.
 *
 * Por eso el orden de ejecucion de los <script> es parte del contrato.
 *
 * Estos tests vigilan RELACIONES entre ficheros, no una foto fija de la lista
 * completa de scripts, y no usan numeros de linea: mover un bloque dentro del
 * mismo documento no debe hacerlos fallar; invertir una dependencia si.
 *
 * El orden que comprueban es el de EJECUCION, no el del documento: ver
 * executionOrder() mas abajo y ARRANQUE-CARGA.md seccion 4.3.
 *
 * Documentacion completa: ARRANQUE-CARGA.md
 */

const ROOT = path.resolve(__dirname, '..');

const HOME = 'index.html';
const SOLAR = 'comparador-tarifas-solares.html';
const STATS = 'estadisticas/index.html';
const APP_PAGES = [HOME, SOLAR, STATS];

// Todas las paginas publicas que cargan theme.js.
const THEMED_PAGES = [
  '404.html',
  'aviso-legal.html',
  'calcular-factura-luz.html',
  'comparador-tarifas-solares.html',
  'comparar-pvpc-tarifa-fija.html',
  'estadisticas/index.html',
  'guias.html',
  'index.html',
  'privacidad.html'
];

function readPage(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

// Neutraliza el contenido de <noscript> conservando la longitud del documento,
// para que los indices sigan siendo comparables. En la ruta solar hay una copia
// de desglose-factura.css dentro de <noscript> que no participa en la cascada.
function blankNoscript(html) {
  return html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, (block) => ' '.repeat(block.length));
}

// 'js/lf-app.js?v=2026...' y '/js/lf-app.js' -> 'js/lf-app.js'
function normalizeAssetPath(value) {
  return String(value || '').split(/[?#]/, 1)[0].replace(/^\.?\//, '');
}

function parseScripts(html) {
  const clean = blankNoscript(html);
  const headEnd = clean.indexOf('</head>');
  const scripts = [];

  for (const match of clean.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!src) continue;
    scripts.push({
      src: normalizeAssetPath(src[1]),
      defer: /\bdefer\b/i.test(attrs),
      async: /\basync\b/i.test(attrs),
      inHead: headEnd !== -1 && match.index < headEnd,
      index: match.index
    });
  }

  return scripts;
}

function parseStylesheets(html) {
  const clean = blankNoscript(html);
  const sheets = [];

  for (const match of clean.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(attrs)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!href) continue;
    sheets.push({ href: normalizeAssetPath(href[1]), index: match.index });
  }

  return sheets;
}

function findScript(scripts, assetPath) {
  return scripts.find((entry) => entry.src === assetPath) || null;
}

function scriptPosition(scripts, assetPath) {
  return scripts.findIndex((entry) => entry.src === assetPath);
}

/**
 * Orden de EJECUCION de scripts clasicos insertados por el parser.
 *
 * No coincide con el orden del documento: el navegador ejecuta primero TODOS los
 * no diferidos, en orden de documento, durante el parseo; y despues TODOS los
 * diferidos, en orden de documento, antes de DOMContentLoaded.
 *
 * De ahi salen las cuatro combinaciones de un par productor -> consumidor:
 *
 *   productor sin defer + consumidor sin defer -> seguro solo si el productor
 *     aparece antes en el documento.
 *   productor con defer + consumidor con defer -> seguro solo si el productor
 *     aparece antes en el documento.
 *   productor sin defer + consumidor con defer -> seguro AUNQUE el consumidor
 *     aparezca antes en el documento: el productor corre durante el parseo y el
 *     consumidor despues.
 *   productor con defer + consumidor sin defer -> INSEGURO SIEMPRE: el
 *     consumidor corre durante el parseo, antes que el productor diferido.
 *
 * `async` queda fuera de este modelo (su orden no es determinista) y por eso
 * esta prohibido en las tres aplicaciones; lo vigila un test aparte.
 */
function executionOrder(scripts) {
  return scripts
    .map((entry, documentIndex) => ({ ...entry, documentIndex }))
    .sort((a, b) => (a.defer === b.defer
      ? a.documentIndex - b.documentIndex
      : (a.defer ? 1 : -1)));
}

function executionPosition(scripts, assetPath) {
  return executionOrder(scripts).findIndex((entry) => entry.src === assetPath);
}

// "con defer, #25 en el documento, #25 en ejecucion"
function describePlacement(scripts, assetPath) {
  const entry = findScript(scripts, assetPath);
  if (!entry) return 'ausente';
  return (entry.defer ? 'con defer' : 'sin defer') +
    `, #${scriptPosition(scripts, assetPath)} en el documento` +
    `, #${executionPosition(scripts, assetPath)} en ejecucion`;
}

function stylesheetPosition(sheets, assetPath) {
  return sheets.findIndex((entry) => entry.href === assetPath);
}

/**
 * Pares productor -> consumidor con acoplamiento real, por pagina.
 * `rompe` describe la funcionalidad que se pierde si se invierte el orden.
 */
const DEPENDENCY_PAIRS = {
  [HOME]: [
    ['js/lf-config.js', 'js/lf-calc.js',
      'window.LF_CONFIG: IVA/IGIC/IPSI, IEE y bono social del motor de calculo'],
    ['js/lf-utils.js', 'js/lf-inputs.js',
      'parseNum/clampNonNeg/formatValueForDisplay: validacion y formato del formulario'],
    ['js/lf-utils.js', 'js/lf-calc.js',
      'clampNonNeg/round2/formatMoney: motor de calculo principal'],
    ['js/lf-utils.js', 'js/lf-render.js',
      'escapeHtml/formatMoney/animateCounter: tabla de resultados y KPIs'],
    ['js/lf-utils.js', 'js/lf-tarifa-custom.js',
      'parseNum/esNumericoValido: tarifa personalizada "Mi tarifa"'],
    ['js/lf-state.js', 'js/lf-ui.js',
      'el/state/THEME_KEY: toast, barra de estado y tema'],
    ['js/lf-state.js', 'js/lf-tooltips.js',
      'el: sistema de tooltips del comparador'],
    ['js/lf-state.js', 'js/lf-cache.js',
      'el/JSON_URL: descarga de tarifas.json'],
    ['js/lf-state.js', 'js/lf-inputs.js',
      'el/state/DEFAULTS/LS_KEY: carga y guardado de inputs'],
    ['js/lf-state.js', 'js/lf-render.js',
      'el/state/$: render de la tabla de resultados'],
    ['js/lf-csv-utils.js', 'js/lf-csv-import.js',
      'window.LF.csvUtils: importacion CSV/XLSX de la home'],
    ['js/lf-ui.js', 'js/lf-cache.js',
      'setStatus/toast: avisos de la descarga de tarifas'],
    ['js/lf-ui.js', 'js/lf-inputs.js',
      'showError/clearErrorStyles/applyButtonState: marcado de errores del formulario'],
    ['js/lf-ui.js', 'js/lf-csv-import.js',
      'toast: avisos del importador CSV'],
    ['js/lf-ui.js', 'js/lf-tarifa-custom.js',
      'toast/showError: validacion de "Mi tarifa"'],
    ['js/lf-tooltips.js', 'js/lf-render.js',
      'initTooltips/bindTooltipElement: tooltips de la tabla'],
    ['js/lf-inputs.js', 'js/lf-calc.js',
      '__LF_getFiscalContext/getInputValues: contexto fiscal del calculo'],
    ['js/factura-parsers.js', 'js/factura.js',
      'window.__LF_FacturaParsers: extraccion de datos de la factura PDF'],
    ['js/lf-sw-update.js', 'js/lf-app.js',
      'window.LF.initSwUpdate: registro del service worker, PWA, offline y auto-update'],
    // factura.js es el unico modulo que puede emitir init-incompleto/* durante su
    // propia evaluacion (rama degradada sin factura-parsers). Los demas guards
    // llaman a __LF_trackDetail mas tarde, ya en DOMContentLoaded o en un click.
    ['js/tracking.js', 'js/factura.js',
      'window.__LF_trackDetail: telemetria init-incompleto/home/factura-parsers ' +
      'emitida en la evaluacion de factura.js']
  ],
  [SOLAR]: [
    ['js/lf-csv-utils.js', 'js/bv/bv-import.js',
      'window.LF.csvUtils: importacion CSV/XLSX del simulador solar'],
    ['js/lf-csv-utils.js', 'js/bv/bv-sim-monthly.js',
      'csvUtils.getPeriodoHorarioCSV: clasificacion P1/P2/P3 del motor mensual'],
    ['js/bv/bv-ui-helpers.js', 'js/bv/bv-ui.js',
      'window.BVSim.manualUi: tabla manual, saldo BV y coste neto'],
    ['js/lf-surplus-prices.js', 'js/bv/bv-ui.js',
      'window.LF.surplusPrices: excedentes indexados contra data/surplus/'],
    ['js/lf-sw-update.js', 'js/shell-lite.js',
      'window.LF.initSwUpdate: registro del service worker en la ruta solar']
  ],
  [STATS]: [
    ['js/pvpc-stats-csv.js', 'js/pvpc-stats-ui.js',
      'window.__LF_PvpcStatsCsv: CSV de excedentes del usuario'],
    ['js/pvpc-stats-engine.js', 'js/pvpc-stats-ui.js',
      'window.PVPC_STATS: carga y agregacion de datos del observatorio'],
    ['vendor/chartjs/chart.umd.js', 'js/pvpc-stats-ui.js',
      'window.Chart: graficos de evolucion, perfil horario y comparativa anual'],
    ['js/lf-csv-utils.js', 'js/pvpc-stats-csv.js',
      'window.LF.csvUtils: parseo del CSV de excedentes'],
    ['js/lf-sw-update.js', 'js/shell-lite.js',
      'window.LF.initSwUpdate: registro del service worker en el observatorio']
  ]
};

// Modulos que crean el namespace con `window.LF = window.LF || {}`.
const LF_NAMESPACE_CREATORS = [
  'js/lf-utils.js',
  'js/lf-ssaa.js',
  'js/lf-csv-utils.js',
  'js/lf-state.js'
];

// Modulos que desestructuran window.LF al evaluarse: para ellos el orden es la
// UNICA defensa posible, porque capturan el valor una sola vez.
const LF_EAGER_CONSUMERS = [
  'js/lf-ui.js',
  'js/lf-tooltips.js',
  'js/lf-cache.js',
  'js/lf-inputs.js',
  'js/lf-calc.js',
  'js/lf-render.js',
  'js/lf-csv-import.js',
  'js/lf-tarifa-custom.js'
];

const HEAD_CHAIN = ['js/error-bootstrap.js', 'js/config.js', 'js/theme.js'];

// CSS especifico de cada aplicacion: va SIEMPRE despues de pro.css.
const PAGE_SPECIFIC_CSS = {
  [HOME]: ['desglose-factura.css'],
  [SOLAR]: ['desglose-factura.css', 'bv-sim.css', 'comparador-solar-mejorado.css'],
  [STATS]: ['estadisticas/estadisticas.css', 'estadisticas/estadisticas-mejorado.css']
};

describe('Contrato de arranque: cadena temprana del <head>', () => {
  it.each(APP_PAGES)('%s ejecuta error-bootstrap -> config -> theme en ese orden', (page) => {
    const scripts = parseScripts(readPage(page));

    const positions = HEAD_CHAIN.map((asset) => ({
      asset,
      position: scriptPosition(scripts, asset)
    }));

    for (const { asset, position } of positions) {
      expect(
        position,
        `${page}: falta ${asset}. La cadena temprana del <head> instala el buffer ` +
        'de errores, los globals legacy y el tema antes de que se ejecute nada mas.'
      ).toBeGreaterThanOrEqual(0);
    }

    expect(
      positions[0].position < positions[1].position,
      `${page}: error-bootstrap.js debe ir ANTES de config.js. Registra el listener ` +
      "de 'error' en fase de captura, asi que solo ve fallos de scripts posteriores; " +
      'si baja, se pierden los errores tempranos y el watchdog de los coordinadores.'
    ).toBe(true);

    expect(
      positions[1].position < positions[2].position,
      `${page}: config.js debe ir ANTES de theme.js. Publica currentYear, ` +
      'PVPC_DATASET_BASE y el guard de goatcounter.count antes que el resto.'
    ).toBe(true);
  });

  it.each(APP_PAGES)('%s mantiene la cadena temprana bloqueante (sin defer ni async)', (page) => {
    const scripts = parseScripts(readPage(page));

    for (const asset of HEAD_CHAIN) {
      const entry = findScript(scripts, asset);
      expect(entry, `${page}: falta ${asset}`).not.toBeNull();
      expect(
        entry.defer || entry.async,
        `${page}: ${asset} no puede llevar defer/async. Diferirlo lo mueve detras ` +
        'del parseo completo del documento y pierde la ventana de arranque que ' +
        'existe justamente para cubrir (errores tempranos, globals legacy, tema).'
      ).toBe(false);
      expect(
        entry.inHead,
        `${page}: ${asset} debe vivir en el <head>, no en el <body>.`
      ).toBe(true);
    }
  });
});

describe('Contrato de arranque: tema antes del CSS', () => {
  it.each(THEMED_PAGES)('%s carga theme.js antes del primer stylesheet y sin diferir', (page) => {
    const html = readPage(page);
    const themeEntry = findScript(parseScripts(html), 'js/theme.js');
    const sheets = parseStylesheets(html);

    expect(themeEntry, `${page}: falta theme.js`).not.toBeNull();
    expect(sheets.length, `${page}: no se ha encontrado ningun stylesheet`).toBeGreaterThan(0);

    expect(
      themeEntry.defer || themeEntry.async,
      `${page}: theme.js no puede llevar defer/async. Aplica .light-mode sobre <html> ` +
      'antes de construir el CSSOM; diferirlo puede permitir un primer pintado con el ' +
      'tema predeterminado y provocar un flash de tema, segun el momento de carga y ' +
      'pintado. No ocurre en todas las cargas, pero no se puede descartar por ' +
      'observacion puntual.'
    ).toBe(false);

    expect(
      themeEntry.index < sheets[0].index,
      `${page}: theme.js debe ir ANTES del primer <link rel="stylesheet"> ` +
      `(ahora el primero es ${sheets[0].href}). Colocado detras, la clase puede ` +
      'llegar despues del primer pintado: puede permitir un primer pintado con el ' +
      'tema predeterminado y provocar un flash de tema, segun el momento de carga y ' +
      'pintado.'
    ).toBe(true);
  });
});

// Las aserciones por par dependen por completo de que executionOrder() modele
// bien la semantica del navegador. Si el modelo estuviera mal, todas ellas
// estarian mal a la vez y en verde. Estos cuatro casos fijan la tabla.
describe('Contrato de arranque: modelo de orden de ejecucion', () => {
  const ejecuta = (list) => executionOrder(list).map((entry) => entry.src);

  it('sin defer: manda el orden del documento', () => {
    expect(ejecuta([
      { src: 'productor', defer: false },
      { src: 'consumidor', defer: false }
    ])).toEqual(['productor', 'consumidor']);

    expect(ejecuta([
      { src: 'consumidor', defer: false },
      { src: 'productor', defer: false }
    ])).toEqual(['consumidor', 'productor']);
  });

  it('ambos con defer: manda el orden del documento', () => {
    expect(ejecuta([
      { src: 'productor', defer: true },
      { src: 'consumidor', defer: true }
    ])).toEqual(['productor', 'consumidor']);

    expect(ejecuta([
      { src: 'consumidor', defer: true },
      { src: 'productor', defer: true }
    ])).toEqual(['consumidor', 'productor']);
  });

  it('productor sin defer + consumidor con defer: seguro aunque el consumidor vaya antes', () => {
    expect(ejecuta([
      { src: 'consumidor', defer: true },
      { src: 'productor', defer: false }
    ])).toEqual(['productor', 'consumidor']);
  });

  it('productor con defer + consumidor sin defer: inseguro aunque el productor vaya antes', () => {
    expect(ejecuta([
      { src: 'productor', defer: true },
      { src: 'consumidor', defer: false }
    ])).toEqual(['consumidor', 'productor']);
  });
});

describe('Contrato de arranque: productores antes que consumidores', () => {
  for (const [page, pairs] of Object.entries(DEPENDENCY_PAIRS)) {
    describe(page, () => {
      const scripts = parseScripts(readPage(page));

      it.each(pairs)('%s se ejecuta antes que %s', (producer, consumer, rompe) => {
        expect(findScript(scripts, producer), `${page}: falta el productor ${producer}`)
          .not.toBeNull();
        expect(findScript(scripts, consumer), `${page}: falta el consumidor ${consumer}`)
          .not.toBeNull();

        const producerPos = executionPosition(scripts, producer);
        const consumerPos = executionPosition(scripts, consumer);

        expect(
          producerPos < consumerPos,
          `${page}: ${producer} debe EJECUTARSE antes que ${consumer}.\n` +
          `Se rompe: ${rompe}.\n` +
          `Estado actual -> ${producer}: ${describePlacement(scripts, producer)}; ` +
          `${consumer}: ${describePlacement(scripts, consumer)}.\n` +
          'Recuerda que el orden de ejecucion no es el del documento: el navegador ' +
          'ejecuta primero todos los scripts sin defer, en orden de documento, y ' +
          'despues todos los diferidos. La combinacion insegura es productor CON ' +
          'defer + consumidor SIN defer: el consumidor corre durante el parseo y lee ' +
          'un global que todavia no existe. Ver ARRANQUE-CARGA.md seccion 4.3.'
        ).toBe(true);
      });
    });
  }
});

describe('Contrato de arranque: atributos defer', () => {
  // Invariante PROPIA de la home, mas estricta que la necesidad tecnica: hay
  // combinaciones mixtas que conservarian una dependencia aislada, pero la home
  // mantiene el body homogeneo para que el orden de ejecucion coincida con el
  // orden de lectura del HTML y no haya que razonar sobre colas diferidas.
  it('index.html mantiene todos los scripts del <body> diferidos (contrato propio)', () => {
    const bodyScripts = parseScripts(readPage(HOME)).filter((entry) => !entry.inHead);

    expect(bodyScripts.length, 'index.html: no se han encontrado scripts en el <body>')
      .toBeGreaterThan(0);

    const sinDefer = bodyScripts.filter((entry) => !entry.defer).map((entry) => entry.src);

    expect(
      sinDefer,
      'index.html: estos scripts del <body> han perdido defer: ' + sinDefer.join(', ') + '.\n' +
      'En la home TODOS los scripts del body son diferidos: es un contrato propio y ' +
      'conservador, no una necesidad tecnica de cada par por separado. Uno sin defer ' +
      'se adelanta a todos los demas; si es lf-app.js, window.LF no existe todavia y ' +
      'la calculadora queda deshabilitada. Ver ARRANQUE-CARGA.md seccion 4.3.'
    ).toEqual([]);
  });

  it.each(APP_PAGES)('%s no usa async en ningun script', (page) => {
    const conAsync = parseScripts(readPage(page))
      .filter((entry) => entry.async)
      .map((entry) => entry.src);

    expect(
      conAsync,
      `${page}: async detectado en ${conAsync.join(', ')}. async ejecuta en cuanto ` +
      'termina la descarga, sin garantia de orden entre ficheros: rompe cualquier ' +
      'dependencia productor -> consumidor de forma no determinista.'
    ).toEqual([]);
  });
});

describe('Contrato de arranque: namespace window.LF', () => {
  it('algun creador de window.LF precede a cada consumidor que desestructura en eval', () => {
    const scripts = parseScripts(readPage(HOME));
    const creatorPositions = LF_NAMESPACE_CREATORS
      .map((asset) => scriptPosition(scripts, asset))
      .filter((position) => position >= 0);

    expect(
      creatorPositions.length,
      'index.html: no se ha encontrado ningun modulo que cree window.LF'
    ).toBeGreaterThan(0);

    const firstCreator = Math.min(...creatorPositions);

    for (const consumer of LF_EAGER_CONSUMERS) {
      const consumerPos = scriptPosition(scripts, consumer);
      expect(consumerPos, `index.html: falta ${consumer}`).toBeGreaterThanOrEqual(0);
      expect(
        firstCreator < consumerPos,
        `index.html: ${consumer} hace "const { ... } = window.LF" al evaluarse y ` +
        'ningun modulo ha creado todavia ese namespace. Adelantarlo lanza un ' +
        'TypeError duro que aborta el IIFE completo en vez de degradar con aviso.'
      ).toBe(true);
    }
  });

  it('los consumidores criticos siguen desestructurando window.LF en eval', () => {
    const sinDestructuring = LF_EAGER_CONSUMERS.filter((asset) => {
      const code = fs.readFileSync(path.join(ROOT, asset), 'utf8');
      return !/\}\s*=\s*window\.LF;/.test(code);
    });

    expect(
      sinDestructuring,
      'Estos modulos ya no desestructuran window.LF al evaluarse: ' +
      sinDestructuring.join(', ') + '.\n' +
      'Si el acoplamiento ha pasado a ser perezoso, actualiza LF_EAGER_CONSUMERS y ' +
      'la seccion 3 de ARRANQUE-CARGA.md para que el contrato no quede obsoleto.'
    ).toEqual([]);
  });
});

describe('Contrato de arranque: cascada CSS', () => {
  it.each(APP_PAGES)('%s carga styles.css -> pro.css -> CSS especifico', (page) => {
    const sheets = parseStylesheets(readPage(page));
    const stylesPos = stylesheetPosition(sheets, 'styles.css');
    const proPos = stylesheetPosition(sheets, 'pro.css');

    expect(stylesPos, `${page}: falta styles.css`).toBeGreaterThanOrEqual(0);
    expect(proPos, `${page}: falta pro.css`).toBeGreaterThanOrEqual(0);

    expect(
      stylesPos < proPos,
      `${page}: styles.css debe ir ANTES de pro.css. pro.css es la capa de correccion ` +
      'sobre styles.css y varias reglas comparten especificidad (por ejemplo ' +
      '.container): invertirlas cambia el layout base.'
    ).toBe(true);

    for (const specific of PAGE_SPECIFIC_CSS[page]) {
      const specificPos = stylesheetPosition(sheets, specific);
      expect(specificPos, `${page}: falta ${specific}`).toBeGreaterThanOrEqual(0);
      expect(
        proPos < specificPos,
        `${page}: pro.css debe ir ANTES de ${specific}. El CSS especifico de pagina es ` +
        'la capa de identidad y gana solo por orden de carga: adelantarlo deja que las ' +
        'reglas anti-overflow de pro.css se impongan (por ejemplo .container ' +
        'max-width:100% o .desglose-modal a ancho casi completo).'
      ).toBe(true);
    }
  });

  it('toda pagina que carga styles.css y pro.css respeta ese orden', () => {
    const violaciones = [];

    for (const page of THEMED_PAGES) {
      const sheets = parseStylesheets(readPage(page));
      const stylesPos = stylesheetPosition(sheets, 'styles.css');
      const proPos = stylesheetPosition(sheets, 'pro.css');
      if (stylesPos < 0 || proPos < 0) continue;
      if (stylesPos > proPos) violaciones.push(page);
    }

    expect(
      violaciones,
      'Paginas con pro.css antes de styles.css: ' + violaciones.join(', ') + '.\n' +
      'Ver ARRANQUE-CARGA.md seccion 4.4.'
    ).toEqual([]);
  });
});
