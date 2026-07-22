import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const trackingCode = fs.readFileSync(path.resolve(__dirname, '../js/tracking.js'), 'utf8');

function bootstrapTracking() {
  const fn = new Function(trackingCode);
  fn();
}

function dispatchUnhandledRejection(reason) {
  const evt = new Event('unhandledrejection');
  Object.defineProperty(evt, 'reason', {
    value: reason,
    configurable: true
  });
  window.dispatchEvent(evt);
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();

  window.goatcounter = { count: vi.fn() };
  delete window.currentYear;
  delete window.__LF_track;
  delete window.__LF_PRIVACY_MODE;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tracking error filtering and dedupe', () => {
  it('define currentYear si tracking se ejecuta sin config.js previo', () => {
    bootstrapTracking();

    expect(typeof window.currentYear).toBe('number');
    expect(new Function('return typeof currentYear')()).toBe('number');
  });

  it('ignora errores sin origen fiable (filename vacío)', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '',
      lineno: 0,
      colno: 0
    });
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).not.toHaveBeenCalled();
  });

  it('trackea errores de scripts first-party', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '/js/index-extra.js',
      lineno: 101,
      colno: 23
    });
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript/index-extra/101/desconocido',
        event: true
      })
    );
  });

  it('deduplica el mismo error en la misma sesión', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '/js/index-extra.js',
      lineno: 101,
      colno: 23
    });
    window.dispatchEvent(evt);
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
  });

  it('separa el error de carga de <script src> de las excepciones JS', () => {
    bootstrapTracking();

    const script = document.createElement('script');
    script.src = '/js/pvpc.js';
    document.head.appendChild(script);
    script.dispatchEvent(new Event('error'));

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-script-load/pvpc/0/desconocido',
        event: true,
        title: expect.stringMatching(/Carga de script fallida.*\/js\/pvpc\.js:0.*online:(?:si|no).*sw:(?:si|no)/)
      })
    );
  });

  it('reclasifica ruido legado del loader index-extra', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:index-extra-compat')
      })
    );
  });

  it('reclasifica ruido legacy de index-extra aunque el eventName no sea error-javascript', () => {
    bootstrapTracking();

    window.__LF_track('custom-event', {
      title: 'Compat: index-extra omitido (sin soporte ES2020) event'
    });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado',
        event: true,
        title: expect.stringContaining('tipo:index-extra-compat')
      })
    );
  });

  it('reclasifica ruido stale-cache de promesas con formato legacy', () => {
    bootstrapTracking();

    dispatchUnhandledRejection('Promise reject: currentYear is not defined event');

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((payload) =>
      payload &&
      payload.path === 'error-legacy-filtrado' &&
      payload.event === true &&
      String(payload.title || '').includes('tipo:currentyear-stale')
    )).toBe(true);
  });

  it('reclasifica ruido stale-cache aunque llegue con otro eventName', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Promise reject: currentYear is not defined event'
    });

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((payload) =>
      payload &&
      payload.path === 'error-legacy-filtrado' &&
      payload.event === true &&
      String(payload.title || '').includes('tipo:currentyear-stale')
    )).toBe(true);
  });

  it('reclasifica ruido stale-cache cuando reason es objeto con message', () => {
    bootstrapTracking();

    dispatchUnhandledRejection({ message: 'currentYear is not defined' });

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((payload) =>
      payload &&
      payload.path === 'error-legacy-filtrado' &&
      payload.event === true &&
      String(payload.title || '').includes('tipo:currentyear-stale')
    )).toBe(true);
  });

  it('redacta posibles datos personales en errores no manejados antes de trackearlos', () => {
    bootstrapTracking();

    dispatchUnhandledRejection(new Error('Fallo procesando ES0021000000000000AB usuario@example.com https://example.com/factura/123456789'));

    // El path no se compara exacto: el stack real de este test depende del SO
    // (en Linux es absoluto y se parsea, en Windows no), asi que solo se exige
    // la base. Lo que si es invariante: ningun dato personal llega al path.
    const payload = window.goatcounter.count.mock.calls
      .map((call) => call[0])
      .find((item) => item && String(item.path || '').startsWith('error-promise') && String(item.title || '').includes('[cups]'));
    expect(payload).toBeTruthy();
    expect(payload.path).toMatch(/^error-promise\//);
    expect(payload.path).not.toContain('ES0021000000000000AB');
    expect(payload.path).not.toContain('usuario@example.com');
    expect(payload.path).not.toContain('example.com');
    expect(payload.title).toContain('[cups]');
    expect(payload.title).toContain('[email]');
    expect(payload.title).toContain('[url]');
    expect(payload.title).not.toContain('ES0021000000000000AB');
    expect(payload.title).not.toContain('usuario@example.com');
    expect(payload.title).not.toContain('https://example.com');
  });

  it('ignora rejections originadas en scripts de terceros (stack cross-origin)', () => {
    bootstrapTracking();

    const err = new Error("undefined is not an object (evaluating 'response.foo')");
    err.stack = "global code@https://hidden/inject.js:99:15";
    dispatchUnhandledRejection(err);

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((p) => p && String(p.path || '').startsWith('error-promise'))).toBe(false);
  });

  it('ignora rejections de extensiones del navegador (chrome-extension:// y moz-extension://)', () => {
    // El stack de una extension usa un esquema con "//". La regex captura la
    // forma protocolo-relativa ("//uuid/script.js"), que new URL() resuelve a
    // un host distinto a luzfija.es => isSameOriginUrl=false => se descarta.
    bootstrapTracking();

    const stacks = [
      'at handler (chrome-extension://abcdefghijklmnop/content.js:12:5)',
      'onMessage@moz-extension://11111111-2222-3333/inject.js:7:9'
    ];
    for (const stack of stacks) {
      const err = new Error("undefined is not an object (evaluating 'response.data')");
      err.stack = stack;
      dispatchUnhandledRejection(err);
    }

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((p) => p && String(p.path || '').startsWith('error-promise'))).toBe(false);
  });

  it('rastrea rejections cuyo stack apunta a nuestro propio origen', () => {
    bootstrapTracking();

    const err = new Error('Error al cargar tarifas');
    err.stack = "at fetchTarifas (/js/pvpc.js:554:20)";
    dispatchUnhandledRejection(err);

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    expect(calls.some((p) =>
      p && p.path === 'error-promise/pvpc/554/desconocido' &&
      String(p.title || '').includes('/js/pvpc.js:554')
    )).toBe(true);
  });

  it('separa familias de promesas sin stack sin llevar el mensaje libre al path', () => {
    bootstrapTracking();

    dispatchUnhandledRejection('calculateTotal is not a function');
    dispatchUnhandledRejection('Failed to fetch');

    const promisePaths = window.goatcounter.count.mock.calls
      .map((call) => call[0] && call[0].path)
      .filter((value) => String(value || '').startsWith('error-promise/'));
    expect(promisePaths).toContain('error-promise/not-a-function/0/desconocido');
    expect(promisePaths).toContain('error-promise/network/0/desconocido');
    expect(promisePaths).not.toContain('error-promise/desconocido/0/desconocido');
    expect(promisePaths.join('|')).not.toContain('calculateTotal');
    expect(promisePaths.join('|')).not.toContain('Failed');
  });

  it('no reclasifica mensajes parecidos sin firma legacy', () => {
    bootstrapTracking();

    const title = 'currentYear helper inicializado correctamente';
    window.__LF_track('error-javascript', { title });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript',
        event: true,
        title
      })
    );
  });

  it('no duplica evento al reclasificar desde trackEvent directo', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    const calls = window.goatcounter.count.mock.calls.map(c => c[0]);
    const legacyCalls = calls.filter((payload) => payload && payload.path === 'error-legacy-filtrado');
    const jsErrorCalls = calls.filter((payload) => payload && payload.path === 'error-javascript');

    expect(legacyCalls.length).toBe(1);
    expect(jsErrorCalls.length).toBe(0);
  });
});

// GoatCounter agrupa por `path` y solo sustituye el `title` de una ruta cuando el
// titulo nuevo se repite mas de 10 veces. Si fichero/linea/build viajaran solo en
// el titulo, un error nuevo quedaria escondido bajo el contador de uno antiguo.
describe('Path de errores: fichero, linea y build', () => {
  function dispatchJsError({ filename, lineno, colno, message }) {
    window.dispatchEvent(new ErrorEvent('error', {
      message: message || 'Uncaught TypeError: x is not a function',
      filename,
      lineno,
      colno
    }));
  }

  function paths() {
    return window.goatcounter.count.mock.calls
      .map((c) => c[0])
      .filter(Boolean)
      .map((p) => p.path);
  }

  it('separa en rutas distintas errores de ficheros distintos', () => {
    bootstrapTracking();

    dispatchJsError({ filename: '/js/bv/bv-ui.js', lineno: 1187, colno: 32 });
    dispatchJsError({ filename: '/js/pvpc.js', lineno: 1187, colno: 32 });

    expect(paths()).toEqual([
      'error-javascript/bv-ui/1187/desconocido',
      'error-javascript/pvpc/1187/desconocido'
    ]);
  });

  it('separa en rutas distintas errores de lineas distintas del mismo fichero', () => {
    bootstrapTracking();

    dispatchJsError({ filename: '/js/bv/bv-ui.js', lineno: 1187, colno: 32 });
    dispatchJsError({ filename: '/js/bv/bv-ui.js', lineno: 1193, colno: 32 });

    expect(paths()).toEqual([
      'error-javascript/bv-ui/1187/desconocido',
      'error-javascript/bv-ui/1193/desconocido'
    ]);
  });

  it('nunca lleva al path el mensaje de error ni datos personales', () => {
    bootstrapTracking();

    dispatchJsError({
      filename: '/js/factura.js',
      lineno: 42,
      colno: 7,
      message: 'Fallo con ES0021000000000000AB y usuario@example.com en https://example.com/f/123456789'
    });

    const payload = window.goatcounter.count.mock.calls.map((c) => c[0])[0];
    expect(payload.path).toBe('error-javascript/factura/42/desconocido');
    expect(payload.path).not.toContain('ES0021000000000000AB');
    expect(payload.path).not.toContain('usuario@example.com');
    expect(payload.path).not.toContain('example.com');
    expect(payload.path).not.toContain('Fallo');
    // El mensaje saneado sigue viajando en el title.
    expect(payload.title).toContain('[cups]');
  });

});

// El build viaja en el path para poder distinguir un fallo del codigo actual de
// uno que solo sobrevive en clientes con cache antigua. Se prueba en unitario
// sobre el constructor: los listeners de `error` se acumulan entre tests dentro
// del mismo fichero (jsdom comparte `window`) y el dedupe dejaria pasar solo el
// del primer bootstrap, mientras que `__LF_trackingUtils` si se reasigna.
describe('buildErrorEventPath', () => {
  function utilsWithBuild(buildId) {
    if (buildId === null) delete window.__LF_BUILD_ID;
    else window.__LF_BUILD_ID = buildId;
    bootstrapTracking();
    return window.__LF_trackingUtils;
  }

  afterEach(() => {
    delete window.__LF_BUILD_ID;
  });

  it('incluye el build id valido para distinguir codigo antiguo del actual', () => {
    const utils = utilsWithBuild('20260721-075326');

    expect(utils.buildErrorEventPath('error-javascript', '/js/bv/bv-ui.js', 1187))
      .toBe('error-javascript/bv-ui/1187/20260721-075326');
  });

  it('degrada a "desconocido" un build id con formato invalido', () => {
    const utils = utilsWithBuild('../../etc/passwd');

    expect(utils.buildErrorEventPath('error-javascript', '/js/bv/bv-ui.js', 1187))
      .toBe('error-javascript/bv-ui/1187/desconocido');
  });

  it('reduce el fichero a basename sin ruta, query ni extension', () => {
    const utils = utilsWithBuild('20260721-075326');

    expect(utils.buildErrorEventPath('error-javascript', '/js/bv/bv-ui.js?v=20260721-075326', 9))
      .toBe('error-javascript/bv-ui/9/20260721-075326');
    expect(utils.buildErrorEventPath('error-promise', 'https://luzfija.es/js/pvpc.js#frag', 554))
      .toBe('error-promise/pvpc/554/20260721-075326');
  });

  it('normaliza fichero ausente y lineas no numericas o negativas', () => {
    const utils = utilsWithBuild('20260721-075326');

    expect(utils.buildErrorEventPath('error-promise', '', 0))
      .toBe('error-promise/desconocido/0/20260721-075326');
    expect(utils.buildErrorEventPath('error-promise', '(inline)', 'abc'))
      .toBe('error-promise/inline/0/20260721-075326');
    expect(utils.buildErrorEventPath('error-promise', '/js/pvpc.js', -5))
      .toBe('error-promise/pvpc/0/20260721-075326');
  });

  it('no deja pasar al path datos personales aunque vengan en el nombre de fichero', () => {
    const utils = utilsWithBuild('20260721-075326');

    const p = utils.buildErrorEventPath(
      'error-javascript',
      '/js/ES0021000000000000AB usuario@example.com.js',
      42
    );
    // eventSegment solo pasa a minusculas: sin redactar, el CUPS seguiria ahi.
    expect(p.toLowerCase()).not.toContain('es0021000000000000ab');
    expect(p).not.toContain('@');
    expect(p).toBe('error-javascript/cups-email/42/20260721-075326');
    expect(p).toMatch(/^error-javascript\/[a-z0-9-]+\/42\/20260721-075326$/);
  });
});
