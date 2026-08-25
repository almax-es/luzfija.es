import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

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
  delete window.__LF_FACTURA_BUSY;
  delete window.__LF_BUILD_ID;
  delete window.__LF_PENDING_INIT_RECOVERY;
  delete window.__LF_requestInitRecovery;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tracking error filtering and occurrence counting', () => {
  it('define currentYear si tracking se ejecuta sin config.js previo', () => {
    bootstrapTracking();

    expect(typeof window.currentYear).toBe('number');
    expect(new Function('return typeof currentYear')()).toBe('number');
  });

  // El error en si se sigue descartando igual que antes; lo unico nuevo es que
  // queda un contador del motivo, para poder afirmar con datos "este ruido no es
  // nuestro" en vez de suponerlo. El mensaje libre nunca acompaña al contador.
  it('ignora errores sin origen fiable (filename vacío) y cuenta el descarte', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '',
      lineno: 0,
      colno: 0
    });
    window.dispatchEvent(evt);

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths.some((p) => String(p).startsWith('error-javascript/'))).toBe(false);
    expect(paths).toContain('error-descartado/sin-filename/desconocido');
    expect(window.goatcounter.count.mock.calls.every(
      (call) => !String(call[0]?.title || '').includes('SyntaxError')
    )).toBe(true);
  });

  it('ignora código inyectado atribuido a la línea imposible del documento y cuenta el descarte', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token 'else'",
      filename: '/',
      lineno: 1,
      colno: 219
    });
    window.dispatchEvent(evt);

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths.some((p) => String(p).startsWith('error-javascript/'))).toBe(false);
    expect(paths).toContain('error-descartado/linea-imposible/desconocido');
  });

  // NOTA DE HARNESS: bootstrapTracking() no retira los listeners anteriores, asi
  // que se acumulan sobre la misma ventana jsdom. Solo el primero registrado
  // procesa cada evento (los demas lo ven ya marcado en el WeakSet compartido
  // window.__LF_TRACKING_HANDLED_ERROR_EVENTS), y ese primer closure conserva su
  // Set de motivos durante todo el fichero. Por eso este test usa un motivo que
  // ningun test anterior dispara: 'sin-posicion'.
  it('cuenta cada motivo de descarte una sola vez por carga, no por aparición', () => {
    bootstrapTracking();

    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'Uncaught TypeError: ruido repetido ' + i,
        filename: 'https://cdn.tercero.example/widget.js',
        lineno: 0,
        colno: 0
      }));
    }

    const descartes = window.goatcounter.count.mock.calls
      .map((call) => call[0]?.path)
      .filter((p) => String(p).startsWith('error-descartado/'));
    // Una sola extension puede lanzar cientos de excepciones por carga: el
    // contador debe leerse como "cargas afectadas", no como "excepciones".
    expect(descartes).toEqual(['error-descartado/sin-posicion/desconocido']);
  });

  it('mantiene errores inline atribuibles a una línea ejecutable del documento', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: 'Uncaught TypeError: prueba',
      filename: '/',
      lineno: 18,
      colno: 7
    });
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript/desconocido/18/desconocido',
        event: true
      })
    );
  });

  it('mantiene errores reales de ficheros first-party minificados en línea 1', () => {
    bootstrapTracking();

    const evt = new ErrorEvent('error', {
      message: 'Uncaught TypeError: prueba',
      filename: '/js/app.min.js',
      lineno: 1,
      colno: 219
    });
    window.dispatchEvent(evt);

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript/app-min/1/desconocido',
        event: true
      })
    );
  });

  it('recupera fichero, línea y columna desde el stack cuando ErrorEvent no los aporta', () => {
    bootstrapTracking();
    const error = new Error('Fallo interno');
    error.stack = `at calcular (${window.location.origin}/js/pvpc.js:554:27)`;

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Fallo interno',
      error
    }));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('error-javascript/pvpc/554/desconocido');
    expect(paths).toContain('error-context/javascript/pvpc/554/desconocido/c27/home/generic/other/ready');
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

    expect(window.goatcounter.count).toHaveBeenCalledTimes(2);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-javascript/index-extra/101/desconocido',
        event: true
      })
    );
  });

  it('conserva cada aparición real del mismo error en la misma sesión', () => {
    bootstrapTracking();

    const dispatchOccurrence = () => window.dispatchEvent(new ErrorEvent('error', {
      message: "Uncaught SyntaxError: Unexpected token ')'",
      filename: '/js/index-extra.js',
      lineno: 101,
      colno: 23
    }));
    dispatchOccurrence();
    dispatchOccurrence();

    // El evento primario conserva TODAS sus apariciones en el mismo path (es lo
    // que hace comparables las cifras del panel). Al cruzar el umbral de 2 se
    // emite ADEMAS un companero de recurrencia, una sola vez, que es lo que
    // permite distinguir una pestaña ruidosa de un fallo extendido.
    expect(window.goatcounter.count).toHaveBeenCalledTimes(5);
    expect(window.goatcounter.count.mock.calls.map((call) => call[0]?.path)).toEqual([
      'error-javascript/index-extra/101/desconocido',
      'error-context/javascript/index-extra/101/desconocido/c23/home/syntax/other/ready',
      'error-javascript/index-extra/101/desconocido',
      'error-recurrencia/javascript/index-extra-101/desconocido/ge2',
      'error-context/javascript/index-extra/101/desconocido/c23/home/syntax/other/ready'
    ]);
  });

  it('no repite el compañero de recurrencia entre umbrales', () => {
    bootstrapTracking();

    const dispatchOccurrence = () => window.dispatchEvent(new ErrorEvent('error', {
      message: 'Uncaught TypeError: repetido',
      filename: '/js/lf-ui.js',
      lineno: 55,
      colno: 3
    }));
    for (let i = 0; i < 5; i += 1) dispatchOccurrence();

    const recurrencias = window.goatcounter.count.mock.calls
      .map((call) => call[0]?.path)
      .filter((p) => String(p).startsWith('error-recurrencia/'));
    // 5 apariciones cruzan los umbrales 2 y 4, no el de 10.
    expect(recurrencias).toEqual([
      'error-recurrencia/javascript/lf-ui-55/desconocido/ge2',
      'error-recurrencia/javascript/lf-ui-55/desconocido/ge4'
    ]);
  });

  it('no transmite ningún identificador en el contador de recurrencia', () => {
    bootstrapTracking();

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Uncaught TypeError: x',
      filename: '/js/lf-render.js',
      lineno: 9,
      colno: 1
    }));
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Uncaught TypeError: x',
      filename: '/js/lf-render.js',
      lineno: 9,
      colno: 1
    }));

    // El contador vive en sessionStorage y muere con la pestaña; lo que sale por
    // la red es solo la categoria y el umbral, nunca la clave ni un id.
    const claves = Object.keys(sessionStorage).filter((k) => k.startsWith('lf_err_rec_'));
    expect(claves.length).toBeGreaterThan(0);
    const enviados = window.goatcounter.count.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(enviados.every((payload) => !payload.includes('lf_err_rec_'))).toBe(true);
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

  it('captura estilos first-party y añade diagnóstico de entrega cerrado', async () => {
    bootstrapTracking();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/styles.css';
    document.head.appendChild(link);

    link.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      expect(window.goatcounter.count.mock.calls.some((call) =>
        String(call[0]?.path || '').startsWith('error-context/cssl/')
      )).toBe(true);
    });

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain('error-resource-load/styles/0/desconocido');
    const contextPath = paths.find((path) => String(path).startsWith('error-context/cssl/'));
    expect(contextPath).toMatch(/^error-context\/cssl\/styles\/0\/desconocido\/c0\/home\/r\/o\/(?:on|off)\/sw[01]\//);
    expect(contextPath.split('/')).toHaveLength(16);
    expect(contextPath.length).toBeLessThanOrEqual(180);
    expect(contextPath).not.toContain('resource-schema-overflow');
    expect(contextPath.split('/').at(-1)).toMatch(/^(?:p\d{1,3}[jchdo]|pf|ps|pt|pn|pu)$/);
  });

  it('lee Cache Storage antes de ejecutar la sonda y marca la sonda para bypass del SW', async () => {
    const originalFetch = window.fetch;
    const originalCaches = Object.getOwnPropertyDescriptor(window, 'caches');
    const order = [];
    const nativeFetch = vi.fn(async () => {
      order.push('probe');
      return { status: 200, headers: { get: vi.fn(() => 'text/css') } };
    });
    window.fetch = nativeFetch;
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: vi.fn(async () => {
          order.push('cache');
          return [];
        })
      }
    });
    try {
      bootstrapTracking();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/styles.css?v=build';
      document.head.appendChild(link);
      link.dispatchEvent(new Event('error'));

      await vi.waitFor(() => expect(nativeFetch).toHaveBeenCalledTimes(1));
      expect(order).toEqual(['cache', 'probe']);
      expect(String(nativeFetch.mock.calls[0][0])).toContain('__lfprobe=1');
      expect(nativeFetch.mock.calls[0][1]).not.toHaveProperty('__lfDiagnosticProbe');
    } finally {
      window.fetch = originalFetch;
      if (originalCaches) Object.defineProperty(window, 'caches', originalCaches);
      else delete window.caches;
    }
  });

  it('no consulta caché, SW ni red para recursos fallidos durante privacidad de factura', async () => {
    const originalFetch = window.fetch;
    const originalCaches = Object.getOwnPropertyDescriptor(window, 'caches');
    const nativeFetch = vi.fn();
    const cacheKeys = vi.fn(async () => []);
    window.fetch = nativeFetch;
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { keys: cacheKeys }
    });
    try {
      bootstrapTracking();
      window.__LF_PRIVACY_MODE = true;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/styles.css';
      document.head.appendChild(link);
      link.dispatchEvent(new Event('error'));
      await Promise.resolve();
      await Promise.resolve();

      expect(nativeFetch).not.toHaveBeenCalled();
      expect(cacheKeys).not.toHaveBeenCalled();
      expect(window.goatcounter.count).not.toHaveBeenCalled();
    } finally {
      window.fetch = originalFetch;
      if (originalCaches) Object.defineProperty(window, 'caches', originalCaches);
      else delete window.caches;
    }
  });

  it('captura violaciones CSP y clasifica su fuente sin enviar URLs libres', () => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'script-src-elem' },
      disposition: { value: 'enforce' },
      blockedURI: { value: 'https://tercero.example/usuario@example.com/script.js' },
      sourceFile: { value: 'chrome-extension://abcdefghijkl/inject.js' },
      lineNumber: { value: 42 }
    });

    window.dispatchEvent(event);

    const payload = window.goatcounter.count.mock.calls.map((call) => call[0]).find((item) =>
      String(item?.path || '').startsWith('error-csp/')
    );
    // El dominio del recurso bloqueado SI viaja (identifica el recurso, no a la
    // persona); la ruta, el subdominio y el email que llevaba dentro NO.
    expect(payload.path).toBe(
      'error-csp/script-src-elem/cross-origin/tercero-example/extension/extension/0/enforce/home/desconocido/other'
    );
    expect(payload.path).not.toContain('usuario');
    expect(payload.path).not.toContain('script.js');
    expect(payload.path).not.toContain('abcdefghijkl');
    expect(payload.title).not.toContain('usuario@example.com');
  });

  it.each(['img-src', 'connect-src', 'default-src'])(
    'no autorreporta el bloqueo CSP %s del propio endpoint de GoatCounter',
    (directive) => {
      bootstrapTracking();
      const event = new Event('securitypolicyviolation');
      Object.defineProperties(event, {
        effectiveDirective: { value: directive },
        disposition: { value: 'enforce' },
        blockedURI: { value: 'https://luzfija.goatcounter.com/count?p=error-csp%2Fprueba' },
        sourceFile: { value: window.location.origin + '/vendor/goatcounter/count.js' },
        lineNumber: { value: 181 }
      });

      window.dispatchEvent(event);

      const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
      expect(paths.some((value) => String(value || '').startsWith('error-csp/'))).toBe(false);
      expect(localStorage.getItem('lf_error_outbox_v1')).toBeNull();
    }
  );

  it('conserva una violación img-src ajena a GoatCounter', () => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'img-src' },
      disposition: { value: 'enforce' },
      blockedURI: { value: 'https://imagenes.example/foto.png' },
      sourceFile: { value: window.location.origin + '/js/lf-render.js' },
      lineNumber: { value: 10 }
    });

    window.dispatchEvent(event);

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^error-csp\/img-src\/cross-origin\/imagenes-example\//),
        event: true
      })
    );
  });

  it('recorta el subdominio del recurso bloqueado a los dos últimos labels', () => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'font-src' },
      disposition: { value: 'enforce' },
      // Un subdominio puede transportar un identificador: no debe sobrevivir.
      blockedURI: { value: 'https://cliente-12345.tracker.example.com/f.woff2' },
      sourceFile: { value: '' }
    });

    window.dispatchEvent(event);

    const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
      .find((value) => String(value || '').startsWith('error-csp/'));
    expect(path).toContain('/cross-origin/example-com/');
    expect(path).not.toContain('cliente-12345');
    expect(path).not.toContain('tracker');
  });

  it('clasifica como extensión el recurso bloqueado servido por una extensión', () => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'font-src' },
      disposition: { value: 'enforce' },
      blockedURI: { value: 'chrome-extension://abcdefghijkl/fuente.woff2' },
      sourceFile: { value: '' }
    });

    window.dispatchEvent(event);

    const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
      .find((value) => String(value || '').startsWith('error-csp/'));
    expect(path).toContain('/extension/sin-host/');
    expect(path).not.toContain('abcdefghijkl');
  });

  it.each([
    ['https://127.0.0.1/f.woff2', 'ip'],
    ['http://localhost:8080/f.woff2', 'localhost']
  ])('bucketiza %s sin volcar el host literal al path', (blockedURI, expected) => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'font-src' },
      disposition: { value: 'enforce' },
      blockedURI: { value: blockedURI },
      sourceFile: { value: '' }
    });

    window.dispatchEvent(event);

    const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
      .find((value) => String(value || '').startsWith('error-csp/'));
    expect(path).toContain('/cross-origin/' + expected + '/');
  });

  // Caso que motivo separar los dos ejes: un CSS PROPIO pidiendo una fuente
  // EXTERNA. Con un unico veredicto "propio/ajeno" esto se archivaria como ruido
  // ajeno, escondiendo justo el bug que hay que arreglar.
  it('distingue iniciador propio de objetivo externo en la misma violación', () => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'font-src' },
      disposition: { value: 'enforce' },
      blockedURI: { value: 'https://fonts.gstatic.com/s/fuente.woff2' },
      sourceFile: { value: window.location.origin + '/css/estilos.css' },
      lineNumber: { value: 42 }
    });

    window.dispatchEvent(event);

    const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
      .find((value) => String(value || '').startsWith('error-csp/'));
    // objetivo externo (categoria conocida) + iniciador propio con fichero y linea
    expect(path).toContain('/cross-origin/gstatic/same-origin/estilos/42/');
  });

  it('atribuye CSP first-party al fichero y línea exactos', () => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'font-src' },
      disposition: { value: 'enforce' },
      blockedURI: { value: 'https://fonts.example/fuente.woff2' },
      sourceFile: { value: window.location.origin + '/styles.css?v=build' },
      lineNumber: { value: 18 }
    });

    window.dispatchEvent(event);

    const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
      .find((value) => String(value || '').startsWith('error-csp/'));
    expect(path).toBe(
      'error-csp/font-src/cross-origin/fonts-example/same-origin/styles/18/enforce/home/desconocido/other'
    );
    expect(path).not.toContain('fuente.woff2');
  });

  it.each([
    ['data', 'data'],
    ['data:', 'data'],
    ['blob', 'blob'],
    ['blob:', 'blob'],
    ['wasm-eval', 'wasm-eval'],
    ['filesystem', 'filesystem'],
    ['trusted-types-policy', 'trusted-types-policy'],
    ['trusted-types-sink', 'trusted-types-sink']
  ])('no confunde blockedURI CSP %s con un recurso same-origin', (blockedURI, expectedKind) => {
    bootstrapTracking();
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      effectiveDirective: { value: 'font-src' },
      disposition: { value: 'enforce' },
      blockedURI: { value: blockedURI },
      sourceFile: { value: 'chrome-extension://abcdefghijkl/inject.js' }
    });

    window.dispatchEvent(event);

    const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
      .find((value) => String(value || '').startsWith('error-csp/'));
    expect(path).toContain('/' + expectedKind + '/sin-host/extension/');
    expect(path).not.toContain('/same-origin/');
  });

  it('reclasifica ruido legado del loader index-extra', () => {
    bootstrapTracking();

    window.__LF_track('error-javascript', {
      title: 'Compat: index-extra omitido (sin soporte ES2020)'
    });

    expect(window.goatcounter.count).toHaveBeenCalledTimes(1);
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'error-legacy-filtrado/index-extra-compat/desconocido',
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
        path: 'error-legacy-filtrado/index-extra-compat/desconocido',
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
      payload.path === 'error-legacy-filtrado/currentyear-stale/desconocido' &&
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
      payload.path === 'error-legacy-filtrado/currentyear-stale/desconocido' &&
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
      payload.path === 'error-legacy-filtrado/currentyear-stale/desconocido' &&
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
      .find((item) => item && String(item.path || '').startsWith('error-promise/'));
    expect(payload).toBeTruthy();
    expect(payload.path).toMatch(/^error-promise\//);
    expect(payload.path).not.toContain('ES0021000000000000AB');
    expect(payload.path).not.toContain('usuario@example.com');
    expect(payload.path).not.toContain('example.com');
    // El mensaje NUNCA llega al title, ni siquiera saneado: solo categoria cerrada.
    expect(payload.title).not.toContain('ES0021000000000000AB');
    expect(payload.title).not.toContain('usuario@example.com');
    expect(payload.title).not.toContain('https://example.com');
    expect(payload.title).not.toContain('Fallo procesando');
    expect(payload.title).not.toContain('[cups]');
    expect(payload.title).not.toContain('[email]');
    expect(payload.title).not.toContain('[url]');
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

  it('descarta runtime.sendMessage de extensiones aunque WebKit no aporte stack', () => {
    bootstrapTracking();

    dispatchUnhandledRejection({
      message: 'Invalid call to runtime.sendMessage(). Tab not found'
    });

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

  it('conserva motivos falsy para clasificarlos sin convertirlos en string', () => {
    bootstrapTracking();

    dispatchUnhandledRejection(null);
    dispatchUnhandledRejection(0);

    const promisePaths = window.goatcounter.count.mock.calls
      .map((call) => call[0] && call[0].path)
      .filter((value) => String(value || '').startsWith('error-promise/'));
    expect(promisePaths).toContain('error-promise/desconocido/0/desconocido');
    expect(promisePaths).toContain('error-promise/primitive/0/desconocido');
  });

  it('no convierte en error un fetch rechazado durante pagehide', async () => {
    const originalFetch = window.fetch;
    const nativeFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: vi.fn(() => 'application/json; charset=utf-8') }
      });
    window.fetch = nativeFetch;
    try {
      bootstrapTracking();
      window.dispatchEvent(new Event('pagehide'));

      await expect(window.fetch('/data/pvpc/index.json', {
        cache: 'no-store',
        __lfDiagnosticReason: 'startup'
      })).rejects.toThrow('Failed to fetch');

      const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
      expect(paths.some((path) => String(path || '').startsWith('error-network/'))).toBe(false);
      expect(paths.some((path) => String(path || '').startsWith('error-context/fetch/'))).toBe(false);
      expect(nativeFetch.mock.calls[0][1]).toEqual({ cache: 'no-store' });
      expect(nativeFetch).toHaveBeenCalledTimes(1);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('no convierte en error un rechazo de refresco silencioso', async () => {
    const originalFetch = window.fetch;
    const nativeFetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    window.fetch = nativeFetch;
    try {
      bootstrapTracking();

      await expect(window.fetch('/tarifas.json', {
        cache: 'no-store',
        __lfDiagnosticReason: 'online',
        __lfDiagnosticAttempt: 1
      })).rejects.toThrow('Failed to fetch');

      const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
      expect(paths.some((path) => String(path || '').startsWith('error-network/'))).toBe(false);
      expect(paths.some((path) => String(path || '').startsWith('error-context/fetch/'))).toBe(false);
      expect(nativeFetch).toHaveBeenCalledTimes(1);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('no registra como fallo el AbortError intencionado', async () => {
    const originalFetch = window.fetch;
    const abort = new DOMException('Aborted', 'AbortError');
    window.fetch = vi.fn(() => Promise.reject(abort));
    try {
      bootstrapTracking();
      await expect(window.fetch('/tarifas.json')).rejects.toThrow('Aborted');
      expect(window.goatcounter.count.mock.calls.some((call) =>
        String(call[0]?.path || '').startsWith('error-network/')
      )).toBe(false);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('registra como timeout solo el AbortError marcado por el temporizador interno', async () => {
    const originalFetch = window.fetch;
    const abort = new DOMException('Aborted', 'AbortError');
    const nativeFetch = vi.fn(() => Promise.reject(abort));
    window.fetch = nativeFetch;
    try {
      bootstrapTracking();
      await expect(window.fetch('/tarifas.json', {
        cache: 'no-store',
        __lfDiagnosticReason: 'calculate',
        __lfDiagnosticAttempt: 1,
        __lfDiagnosticTrackAbort: 'timeout'
      })).rejects.toThrow('Aborted');

      const path = window.goatcounter.count.mock.calls.map((call) => call[0]?.path)
        .find((value) => String(value || '').startsWith('error-network/'));
      expect(path).toBe(
        'error-network/tarifas/tarifas/timeout/home/desconocido/calculate/a1/' +
        'visible/active/timeout/online/sw-no/other'
      );
      expect(nativeFetch.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('conserva inputs URL y Request y no filtra metadatos internos al fetch nativo', async () => {
    const originalFetch = window.fetch;
    const nativeFetch = vi.fn(async () => ({ status: 200, headers: { get: vi.fn(() => 'application/json') } }));
    window.fetch = nativeFetch;
    try {
      bootstrapTracking();
      const url = new URL('/data/pvpc/index.json', window.location.origin);
      const request = new Request(url.href);

      await window.fetch(url);
      await window.fetch(request, {
        cache: 'no-store',
        __lfDiagnosticReason: 'startup',
        __lfDiagnosticAttempt: 2
      });

      expect(nativeFetch.mock.calls[0][0]).toBe(url);
      expect(nativeFetch.mock.calls[0][1]).toBeUndefined();
      expect(nativeFetch.mock.calls[1][0]).toBe(request);
      expect(nativeFetch.mock.calls[1][1]).toEqual({ cache: 'no-store' });
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('conserva tres rechazos idénticos como tres apariciones completas', async () => {
    const originalFetch = window.fetch;
    const nativeFetch = vi.fn((_url, init) => {
      if (init && init.cache === 'reload') {
        return Promise.resolve({
          status: 200,
          headers: { get: vi.fn(() => 'application/json') }
        });
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    window.fetch = nativeFetch;
    try {
      bootstrapTracking();
      for (let i = 0; i < 3; i += 1) {
        await expect(window.fetch('/tarifas.json', {
          __lfDiagnosticReason: 'calculate'
        })).rejects.toThrow('Failed to fetch');
      }

      await vi.waitFor(() => {
        const paths = window.goatcounter.count.mock.calls.map((call) => String(call[0]?.path || ''));
        expect(paths.filter((path) => path.startsWith('error-context/fetch/'))).toHaveLength(3);
      });

      const paths = window.goatcounter.count.mock.calls.map((call) => String(call[0]?.path || ''));
      expect(paths.filter((path) => path.startsWith('error-network/tarifas/tarifas/rejected/'))).toHaveLength(3);
      expect(paths.filter((path) => path.startsWith('error-context/fetch/tarifas/tarifas/rejected/')))
        .toHaveLength(3);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('mantiene completos los primarios network y CSP incluso en una ruta 404 extrema', async () => {
    const longRoute = '/' + 'ruta-inexistente-muy-larga-'.repeat(5);
    const dom = new JSDOM('<!doctype html><title>404</title>', {
      url: 'https://luzfija.es' + longRoute,
      runScripts: 'outside-only'
    });
    const isolatedWindow = dom.window;
    const sent = [];
    isolatedWindow.__LF_BUILD_ID = '20260802-180538';
    isolatedWindow.goatcounter = { count: (payload) => sent.push(payload) };
    isolatedWindow.fetch = vi.fn((input) => {
      if (String(input).includes('__lfprobe=1')) {
        return Promise.resolve({ status: 200, headers: { get: () => 'application/json' } });
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    try {
      isolatedWindow.eval(trackingCode);
      await isolatedWindow.fetch('/data/surplus/' + 'fichero-larguisimo-'.repeat(5) + '.json', {
        __lfDiagnosticReason: 'calculate',
        __lfDiagnosticAttempt: 2
      }).catch(() => {});

      const csp = new isolatedWindow.Event('securitypolicyviolation');
      Object.defineProperties(csp, {
        effectiveDirective: { value: 'require-trusted-types-for-con-un-sufijo-excesivo' },
        disposition: { value: 'enforce' },
        blockedURI: { value: 'https://third.example/font.woff2' },
        sourceFile: { value: 'chrome-extension://abcdefghijkl/inject.js' }
      });
      isolatedWindow.dispatchEvent(csp);
      await new Promise((resolve) => isolatedWindow.setTimeout(resolve, 0));

      const primaryPaths = sent.map((payload) => payload.path)
        .filter((value) => /^error-(?:network|csp)\//.test(String(value)));
      expect(primaryPaths).toHaveLength(2);
      expect(primaryPaths.every((value) => value.length <= 180)).toBe(true);
      expect(primaryPaths.find((value) => value.startsWith('error-network/')))
        .toMatch(/\/a2\/(?:visible|prerender)\/active\/network\/online\/sw-no\/other$/);
      expect(primaryPaths.find((value) => value.startsWith('error-csp/')))
        .toMatch(/\/enforce\/[^/]+\/20260802-180538\/other$/);
      expect(primaryPaths.join('|')).not.toContain('schema-overflow');
    } finally {
      dom.window.close();
    }
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
    const legacyCalls = calls.filter((payload) => payload && String(payload.path || '').startsWith('error-legacy-filtrado/'));
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
      'error-context/javascript/bv-ui/1187/desconocido/c32/home/not-a-function/other/ready',
      'error-javascript/pvpc/1187/desconocido',
      'error-context/javascript/pvpc/1187/desconocido/c32/home/not-a-function/other/ready'
    ]);
  });

  it('separa en rutas distintas errores de lineas distintas del mismo fichero', () => {
    bootstrapTracking();

    dispatchJsError({ filename: '/js/bv/bv-ui.js', lineno: 1187, colno: 32 });
    dispatchJsError({ filename: '/js/bv/bv-ui.js', lineno: 1193, colno: 32 });

    expect(paths()).toEqual([
      'error-javascript/bv-ui/1187/desconocido',
      'error-context/javascript/bv-ui/1187/desconocido/c32/home/not-a-function/other/ready',
      'error-javascript/bv-ui/1193/desconocido',
      'error-context/javascript/bv-ui/1193/desconocido/c32/home/not-a-function/other/ready'
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
    // El mensaje NUNCA llega al title, ni siquiera saneado: solo categoria cerrada.
    expect(payload.title).not.toContain('[cups]');
    expect(payload.title).not.toContain('ES0021000000000000AB');
    expect(payload.title).not.toContain('usuario@example.com');
    expect(payload.title).not.toContain('example.com');
    expect(payload.title).not.toContain('Fallo');
    expect(payload.title).toContain('generic');
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

describe('Deduplicado de errores por build', () => {
  function runPage(buildId, storedDedupe) {
    const dom = new JSDOM('<!doctype html><title>Prueba</title>', {
      url: 'https://luzfija.es/',
      runScripts: 'outside-only'
    });
    const isolatedWindow = dom.window;
    const sent = [];
    isolatedWindow.__LF_BUILD_ID = buildId;
    isolatedWindow.goatcounter = { count: (payload) => sent.push(payload) };
    if (storedDedupe) {
      isolatedWindow.sessionStorage.setItem('lf_js_error_dedupe_v2', storedDedupe);
    }
    isolatedWindow.eval(trackingCode);
    isolatedWindow.dispatchEvent(new isolatedWindow.ErrorEvent('error', {
      message: 'Mismo fallo',
      filename: '/js/app.js',
      lineno: 10,
      colno: 2
    }));
    return {
      sent,
      storedDedupe: isolatedWindow.sessionStorage.getItem('lf_js_error_dedupe_v2')
    };
  }

  it('no deja que un build anterior silencie el mismo error del build actual', () => {
    const oldPage = runPage('20260722-091724');
    const currentPage = runPage('20260722-103502', oldPage.storedDedupe);

    expect(oldPage.sent.map((payload) => payload.path)).toContain(
      'error-javascript/app/10/20260722-091724'
    );
    expect(currentPage.sent.map((payload) => payload.path)).toContain(
      'error-javascript/app/10/20260722-103502'
    );
  });
});

// `init-incompleto` es la senal con la que se vigila si las defensas de carga
// parcial actuan sobre usuarios reales. Sin build en el path, GoatCounter suma en
// una sola fila las degradaciones de builds distintos (comprobado en el export del
// 22/07/2026: init-incompleto/estadisticas/stats-csv mezclaba 091724 y 103502) y
// solo quedaba atribuirlas correlacionando por hora, que es aproximado.
describe('sello de build en init-incompleto', () => {
  function bootWithBuild(buildId) {
    if (buildId === null) delete window.__LF_BUILD_ID;
    else window.__LF_BUILD_ID = buildId;
    bootstrapTracking();
  }

  function paths() {
    return window.goatcounter.count.mock.calls
      .map((c) => c[0])
      .filter(Boolean)
      .map((p) => p.path)
      .filter((path) => !String(path).startsWith('error-context/'));
  }

  afterEach(() => {
    delete window.__LF_BUILD_ID;
  });

  it('anade el build actual como ultimo segmento', () => {
    bootWithBuild('20260722-121753');

    window.__LF_trackDetail('init-incompleto', ['home', 'app-core'], { title: 'x' });

    expect(paths()).toEqual(['init-incompleto/home/app-core/20260722-121753']);
  });

  it('separa el mismo evento emitido desde builds distintos', () => {
    bootWithBuild('20260722-091724');
    window.__LF_trackDetail('init-incompleto', ['estadisticas', 'stats-csv'], { title: 'x' });

    bootWithBuild('20260722-103502');
    window.__LF_trackDetail('init-incompleto', ['estadisticas', 'stats-csv'], { title: 'x' });

    expect(paths()).toEqual([
      'init-incompleto/estadisticas/stats-csv/20260722-091724',
      'init-incompleto/estadisticas/stats-csv/20260722-103502'
    ]);
  });

  it('degrada a "desconocido" un build con formato invalido', () => {
    bootWithBuild('../../etc/passwd');

    window.__LF_trackDetail('init-incompleto', ['solar', 'manual-ui'], { title: 'x' });

    expect(paths()).toEqual(['init-incompleto/solar/manual-ui/desconocido']);
  });

  it('sella tambien si el emisor no escribe el slug exacto', () => {
    bootWithBuild('20260722-121753');

    window.__LF_trackDetail('Init-Incompleto', ['home', 'app-core'], { title: 'x' });

    expect(paths()).toEqual(['init-incompleto/home/app-core/20260722-121753']);
  });

  it('no sella los eventos normales de producto', () => {
    bootWithBuild('20260722-121753');

    window.__LF_trackDetail('calculo-realizado', 'home', { title: 'x' });
    window.__LF_trackDetail('csv-import-error', ['home', 'csv', 'cabecera'], { title: 'x' });

    expect(paths()).toEqual(['calculo-realizado/home', 'csv-import-error/home/csv/cabecera']);
  });

  it('no muta el array de detalle del emisor', () => {
    bootWithBuild('20260722-121753');
    const detail = ['home', 'app-core'];

    window.__LF_trackDetail('init-incompleto', detail, { title: 'x' });

    expect(detail).toEqual(['home', 'app-core']);
  });

  it('mantiene el path acotado y sin datos libres del emisor', () => {
    bootWithBuild('20260722-121753');

    window.__LF_trackDetail('init-incompleto', ['home', 'app-core'], {
      title: 'Fallo con ES0021000000000000AB y usuario@example.com'
    });

    const path = paths()[0];
    expect(path.length).toBeLessThanOrEqual(180);
    expect(path).not.toContain('@');
    expect(path.toLowerCase()).not.toContain('es0021000000000000ab');
  });

  it('reserva el sufijo del build aunque los detalles agoten el limite del path', () => {
    bootWithBuild('20260722-121753');

    window.__LF_trackDetail('init-incompleto', ['a'.repeat(90), 'b'.repeat(90)], { title: 'x' });

    const path = paths()[0];
    expect(path.length).toBeLessThanOrEqual(180);
    expect(path).toMatch(/\/20260722-121753$/);
  });

  it('añade contexto cerrado a las degradaciones de inicialización', () => {
    bootWithBuild('20260722-121753');

    window.__LF_trackDetail('init-incompleto', ['solar', 'manual-ui'], { title: 'x' });

    const contextPath = window.goatcounter.count.mock.calls
      .map((call) => call[0]?.path)
      .find((path) => String(path).startsWith('error-context/init/'));
    expect(contextPath).toBe('error-context/init/manual-ui/0/20260722-121753/c0/home/init-incompleto/other/ready');
  });
});
