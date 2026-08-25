import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const trackingCode = fs.readFileSync(path.resolve(__dirname, '../js/tracking.js'), 'utf8');
const lfAppCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-app.js'), 'utf8');
const bvUiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const goatCounterCode = fs.readFileSync(path.resolve(__dirname, '../vendor/goatcounter/count.js'), 'utf8');

function bootstrapTracking() {
  const fn = new Function(trackingCode);
  fn();
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();

  delete window.goatcounter;
  delete window.__LF_track;
  delete window.__LF_PRIVACY_MODE;
  delete window.__LF_FACTURA_BUSY;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Coherencia entre la politica publicada y el codigo', () => {
  const privacidadHtml = fs.readFileSync(path.resolve(__dirname, '../privacidad.html'), 'utf8');

  // La politica declaraba 16 apariciones mientras el codigo guardaba 64. Este
  // test ata la cifra publicada a la constante real para que no vuelva a
  // desalinearse: si alguien cambia ERROR_OUTBOX_MAX, este test falla hasta que
  // se actualice privacidad.html.
  it('publica en privacidad.html el mismo limite de outbox que aplica el codigo', () => {
    const codeMatch = trackingCode.match(/const\s+ERROR_OUTBOX_MAX\s*=\s*(\d+)\s*;/);
    expect(codeMatch, 'no se encontro ERROR_OUTBOX_MAX en js/tracking.js').not.toBeNull();
    const codeLimit = Number(codeMatch[1]);

    const policyMatch = privacidadHtml.match(/hasta\s+(\d+)\s+apariciones\s+con\s+rutas\s+t[eé]cnicas/i);
    expect(policyMatch, 'no se encontro la cifra de apariciones en privacidad.html').not.toBeNull();
    const policyLimit = Number(policyMatch[1]);

    expect(policyLimit).toBe(codeLimit);
  });

  it('declara la retencion del outbox con el mismo TTL que aplica el codigo', () => {
    const ttlMatch = trackingCode.match(/const\s+ERROR_OUTBOX_TTL_MS\s*=\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\s*;/);
    expect(ttlMatch, 'no se encontro ERROR_OUTBOX_TTL_MS en js/tracking.js').not.toBeNull();
    expect(privacidadHtml).toMatch(
      new RegExp('m[aá]ximo\\s+de\\s+' + ttlMatch[1] + '\\s+d[ií]as', 'i')
    );
  });

  it('declara el dominio saneado del recurso bloqueado por CSP', () => {
    expect(privacidadHtml).toMatch(/CSP/);
    expect(privacidadHtml).toMatch(/dominio<\/strong>\s*de ese recurso/i);
    expect(privacidadHtml).toMatch(/sin ruta, par[aá]metros/i);
  });

  it('declara el contador tecnico en sessionStorage', () => {
    expect(privacidadHtml).toMatch(/sessionStorage/);
    expect(privacidadHtml).toMatch(/no se genera ni se transmite ning[uú]n identificador/i);
  });
});

describe('Tracking privacy behavior', () => {
  it('no inicializa tracking cuando existe opt-out', () => {
    localStorage.setItem('lf_error_outbox_v1', JSON.stringify([
      { path: 'error-javascript/app/10/20260722-103502', at: Date.now() }
    ]));
    localStorage.setItem('goatcounter_optout', 'true');
    const appendSpy = vi.spyOn(document.head, 'appendChild');

    bootstrapTracking();

    expect(window.__LF_track).toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('lf_error_outbox_v1')).toBeNull();
  });

  it('persiste solo paths saneados cuando el sender todavía no está disponible', () => {
    bootstrapTracking();

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Fallo ES0021000000000000AB usuario@example.com',
      filename: '/js/app.js',
      lineno: 10,
      colno: 3
    }));

    const stored = JSON.parse(localStorage.getItem('lf_error_outbox_v1'));
    expect(stored.map((entry) => entry.path)).toEqual([
      'error-javascript/app/10/desconocido',
      'error-context/javascript/app/10/desconocido/c3/home/generic/other/ready'
    ]);
    expect(JSON.stringify(stored)).not.toContain('ES0021000000000000AB');
    expect(JSON.stringify(stored)).not.toContain('usuario@example.com');
    expect(stored.every((entry) => Object.keys(entry).sort().join(',') === 'at,path')).toBe(true);
  });

  it('persiste el resultado terminal de tarifas bajo error-context', () => {
    bootstrapTracking();

    window.__LF_trackDetail('error-context', [
      'fetch-terminal', 'tarifas', 'failed', 'calculate', 'a2', '20260804-144336'
    ], { title: 'Carga de tarifas fallida tras agotar reintentos' });

    const stored = JSON.parse(localStorage.getItem('lf_error_outbox_v1'));
    expect(stored).toEqual([
      {
        path: 'error-context/fetch-terminal/tarifas/failed/calculate/a2/20260804-144336',
        at: expect.any(Number)
      }
    ]);
  });

  it('reenvía en la siguiente carga un diagnóstico pendiente y limpia el outbox', async () => {
    const pendingPath = 'error-script-load/shell-lite/0/20260730-080100';
    localStorage.setItem('lf_error_outbox_v1', JSON.stringify([
      { path: pendingPath, at: Date.now() }
    ]));
    window.goatcounter = { count: vi.fn() };

    bootstrapTracking();
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
    await Promise.resolve();

    // El reenvio llega marcado como diferido: GoatCounter sella hora y referrer
    // al recibir, no al ocurrir, asi que sin marca un diagnostico de hace dias
    // se leeria como si acabara de pasar y se atribuiria a la sesion equivocada.
    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: pendingPath + '/diferido',
        title: expect.stringContaining('Diagnóstico diferido'),
        event: true
      })
    );
    // El outbox se sigue indexando por la ruta original, sin marcar.
    expect(localStorage.getItem('lf_error_outbox_v1')).toBeNull();
  });

  // La marca no puede depender de que haya recarga: un fallo ocurrido sin red y
  // entregado al volver la conexion en la MISMA pestaña tambien llega a
  // GoatCounter con la hora del reenvio, no con la del fallo.
  it('marca como diferido un diagnóstico generado sin red y enviado al recuperarla', () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.goatcounter = { count: vi.fn() };
    bootstrapTracking();

    window.__LF_track('error-network/json/datos/rejected/home/desconocido/online/sw-no/other');
    expect(window.goatcounter.count).not.toHaveBeenCalled();

    onLineSpy.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain(
      'error-network/json/datos/rejected/home/desconocido/online/sw-no/other/diferido'
    );
  });

  it('no marca como diferido un evento de producto retenido por el mismo corte', () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.goatcounter = { count: vi.fn() };
    bootstrapTracking();

    window.__LF_track('evento-producto/ejemplo');
    onLineSpy.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    // `/diferido` es taxonomia de diagnostico: un evento de producto no se usa
    // para atribuir incidencias y no debe heredarla.
    expect(paths).toContain('evento-producto/ejemplo');
    expect(paths.every((p) => !String(p).endsWith('/diferido'))).toBe(true);
  });

  it('no vuelve a marcar un diagnóstico que ya venía marcado como diferido', async () => {
    const alreadyMarked = 'error-script-load/shell-lite/0/20260730-080100/diferido';
    localStorage.setItem('lf_error_outbox_v1', JSON.stringify([
      { path: alreadyMarked, at: Date.now() }
    ]));
    window.goatcounter = { count: vi.fn() };

    bootstrapTracking();
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
    await Promise.resolve();

    const paths = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(paths).toContain(alreadyMarked);
    expect(paths.every((p) => !String(p).includes('/diferido/diferido'))).toBe(true);
  });

  it('conserva por separado apariciones repetidas del mismo diagnóstico', () => {
    window.goatcounter = { count: vi.fn(() => false) };
    bootstrapTracking();

    window.__LF_track('error-network/json/datos/rejected/home/desconocido/online/sw-no/other');
    window.__LF_track('error-network/json/datos/rejected/home/desconocido/online/sw-no/other');

    const stored = JSON.parse(localStorage.getItem('lf_error_outbox_v1'));
    expect(stored).toHaveLength(2);
    expect(stored[0].path).toBe(stored[1].path);
    expect(stored[0].at).not.toBe(stored[1].at);
    expect(stored.every((entry) => Object.keys(entry).sort().join(',') === 'at,path')).toBe(true);
  });

  it('acota el outbox a las 64 apariciones más recientes', () => {
    window.goatcounter = { count: vi.fn(() => false) };
    bootstrapTracking();

    for (let i = 0; i < 70; i += 1) {
      window.__LF_track('error-network/json/datos-' + i + '/rejected/home/desconocido/online/sw-no/other');
    }

    const stored = JSON.parse(localStorage.getItem('lf_error_outbox_v1'));
    expect(stored).toHaveLength(64);
    expect(stored[0].path).toContain('datos-6');
    expect(stored.at(-1).path).toContain('datos-69');
  });

  it('reproduce todas las apariciones repetidas que sobrevivieron a una recarga', async () => {
    const pendingPath = 'error-script-load/shell-lite/0/20260730-080100';
    const now = Date.now();
    localStorage.setItem('lf_error_outbox_v1', JSON.stringify([
      { path: pendingPath, at: now },
      { path: pendingPath, at: now + 1 }
    ]));
    window.goatcounter = { count: vi.fn() };

    bootstrapTracking();
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
    await Promise.resolve();

    const matching = window.goatcounter.count.mock.calls
      .filter((call) => call[0]?.path === pendingPath + '/diferido');
    expect(matching).toHaveLength(2);
    expect(localStorage.getItem('lf_error_outbox_v1')).toBeNull();
  });

  it('entrega 64 diagnósticos hidratados sin que diez eventos ordinarios los expulsen', async () => {
    const now = Date.now();
    const pending = Array.from({ length: 64 }, (_, index) => ({
      path: 'error-network/json/datos-' + index + '/rejected/home/desconocido',
      at: now + index
    }));
    localStorage.setItem('lf_error_outbox_v1', JSON.stringify(pending));
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    for (let i = 0; i < 10; i += 1) {
      window.__LF_track('evento-producto-' + i, { title: 'Producto ' + i });
    }

    const sender = appendSpy.mock.calls[0][0];
    window.goatcounter = { count: vi.fn() };
    sender.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    const delivered = window.goatcounter.count.mock.calls.map((call) => call[0]?.path);
    expect(delivered.filter((path) => String(path).startsWith('error-network/'))).toHaveLength(64);
    expect(delivered.filter((path) => String(path).startsWith('evento-producto-'))).toHaveLength(10);
    expect(localStorage.getItem('lf_error_outbox_v1')).toBeNull();
  });

  it('preserva el opt-out de analítica (y el resto de datos del usuario) al limpiar caché local', () => {
    // "Limpiar cache" (14/08/2026) ya no es un localStorage.clear() con lista blanca de
    // restauracion: borra solo las claves pvpc_cache_v3:*, asi que goatcounter_optout y
    // cualquier otro dato del usuario (Mi tarifa, escenario solar, tema...) sobreviven sin
    // necesidad de guardarlos/restaurarlos aparte. Ver tests/bv-ui-zona-grid.test.js y
    // tests/inputs.test.js para la cobertura funcional completa de ese comportamiento.
    for (const code of [lfAppCode, bvUiCode]) {
      expect(code).not.toMatch(/localStorage\.clear\(\)/);
      expect(code).toMatch(/key\.startsWith\('pvpc_cache_v3:'\)/);
    }
  });

  it('bloquea eventos cuando __LF_PRIVACY_MODE está activo', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    bootstrapTracking();

    expect(typeof window.__LF_track).toBe('function');
    window.__LF_PRIVACY_MODE = true;
    window.__LF_track('evento-privado', { title: 'No debería enviarse' });

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('aplica el opt-out inmediatamente aunque tracking ya estuviera inicializado', () => {
    window.goatcounter = { count: vi.fn() };
    bootstrapTracking();
    localStorage.setItem('lf_error_outbox_v1', JSON.stringify([
      { path: 'error-javascript/app/10/desconocido', at: Date.now() }
    ]));
    localStorage.setItem('goatcounter_optout', 'true');

    window.__LF_track('error-javascript/app/11/desconocido', { title: 'No sale' });

    expect(window.goatcounter.count).not.toHaveBeenCalled();
    expect(localStorage.getItem('lf_error_outbox_v1')).toBeNull();
  });

  it('bloquea eventos cuando la extracción de factura está ocupada', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    bootstrapTracking();

    expect(typeof window.__LF_track).toBe('function');
    window.__LF_FACTURA_BUSY = true;
    window.__LF_track('evento-factura', { title: 'No debería enviarse' });

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('carga GoatCounter bajo demanda y vacía cola al terminar de cargar', async () => {
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    window.__LF_track('evento-cola', { title: 'Evento en cola' });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const injectedScript = appendSpy.mock.calls[0][0];
    expect(injectedScript.tagName).toBe('SCRIPT');
    expect(injectedScript.src).toContain('/vendor/goatcounter/count.js?v=');

    window.goatcounter = { count: vi.fn() };
    injectedScript.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'evento-cola',
        title: 'Evento en cola',
        event: true
      })
    );
  });

  it('reutiliza script existente de GoatCounter aunque no lleve query de versión', async () => {
    const existing = document.createElement('script');
    existing.src = '/vendor/goatcounter/count.js';
    document.head.appendChild(existing);

    const appendSpy = vi.spyOn(document.head, 'appendChild');

    bootstrapTracking();
    window.__LF_track('evento-reutilizado', { title: 'Reutiliza sender existente' });

    expect(appendSpy).not.toHaveBeenCalled();

    window.goatcounter = { count: vi.fn() };
    existing.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'evento-reutilizado',
        title: 'Reutiliza sender existente',
        event: true
      })
    );
  });

  it('retira un sender fallido, reintenta y conserva la cola ante un fallo transitorio', async () => {
    vi.useFakeTimers();
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    window.__LF_track('evento-reintento', { title: 'Debe sobrevivir al primer fallo' });

    const firstScript = appendSpy.mock.calls[0][0];
    firstScript.dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();
    expect(firstScript.isConnected).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    const secondScript = appendSpy.mock.calls[1][0];
    expect(secondScript).toBeTruthy();
    expect(secondScript).not.toBe(firstScript);

    window.goatcounter = { count: vi.fn() };
    secondScript.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'evento-reintento' })
    );
  });

  it('respeta el backoff y no supera tres cargas hasta que vuelva la conexión', async () => {
    vi.useFakeTimers();
    const originalAppend = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => originalAppend(node));

    bootstrapTracking();
    window.__LF_track('evento-uno');
    appendSpy.mock.calls[0][0].dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();

    window.__LF_track('evento-durante-backoff');
    expect(appendSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    appendSpy.mock.calls[1][0].dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20000);
    appendSpy.mock.calls[2][0].dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();

    window.__LF_track('evento-tras-agotar-intentos');
    await Promise.resolve();
    expect(appendSpy).toHaveBeenCalledTimes(3);
  });

  it('si GoatCounter ya está listo, envía sin inyectar script', () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    window.goatcounter = { count: vi.fn() };

    bootstrapTracking();
    window.__LF_track('evento-directo', { title: 'Directo' });

    expect(window.goatcounter.count).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'evento-directo',
        title: 'Directo',
        event: true
      })
    );
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('el count.js local no envía query completa con configuraciones o búsquedas', () => {
    expect(goatCounterCode).toContain('safe_query()');
    expect(goatCounterCode).not.toContain('q: location.search');
  });

  it('el pageview automático del sender respeta la privacidad de factura aunque count.js termine de cargar después', () => {
    const originalSendBeacon = navigator.sendBeacon;
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true
    });

    window.__LF_PRIVACY_MODE = true;
    window.goatcounter = {
      allow_local: true,
      endpoint: 'https://luzfija.goatcounter.com/count'
    };
    new Function(goatCounterCode)();

    expect(window.goatcounter.filter()).toBe('LuzFija invoice privacy mode');
    expect(beacon).not.toHaveBeenCalled();

    window.__LF_PRIVACY_MODE = false;
    window.__LF_FACTURA_BUSY = true;
    expect(window.goatcounter.filter()).toBe('LuzFija invoice privacy mode');
    expect(window.goatcounter.count({ path: '/factura-en-proceso' })).toBe(false);
    expect(beacon).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true
    });
  });

  it('el sender sigue contando si el getter de window.localStorage lanza SecurityError', () => {
    const originalSendBeacon = navigator.sendBeacon;
    const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('bloqueado', 'SecurityError'); }
    });

    try {
      window.goatcounter = {
        no_onload: true,
        allow_local: true,
        endpoint: 'https://luzfija.goatcounter.com/count'
      };
      new Function(goatCounterCode)();

      expect(window.goatcounter.filter()).toBe(false);
      expect(window.goatcounter.count({ path: '/storage-denied' })).toBe(true);
      expect(beacon).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'localStorage', originalStorage);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: originalSendBeacon,
        configurable: true
      });
    }
  });

  it('el sender confirma beacon y notifica el resultado del fallback de imagen', () => {
    const originalSendBeacon = navigator.sendBeacon;
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(() => false),
      configurable: true
    });
    window.goatcounter = {
      no_onload: true,
      allow_local: true,
      endpoint: 'https://luzfija.goatcounter.com/count'
    };
    new Function(goatCounterCode)();
    const onSent = vi.fn();
    const onError = vi.fn();

    const pending = window.goatcounter.count({
      path: 'error-context/prueba',
      event: true,
      on_sent: onSent,
      on_error: onError
    });
    const image = document.body.querySelector('img');
    expect(pending).toBe(false);
    image.dispatchEvent(new Event('load'));
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    const failed = window.goatcounter.count({
      path: 'error-context/prueba-2',
      event: true,
      on_sent: onSent,
      on_error: onError
    });
    const failedImage = document.body.querySelector('img');
    expect(failed).toBe(false);
    failedImage.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true
    });
  });

  it('force_image evita dar por entregado un diagnóstico solo porque beacon lo aceptó', () => {
    const originalSendBeacon = navigator.sendBeacon;
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true
    });
    window.goatcounter = {
      no_onload: true,
      allow_local: true,
      endpoint: 'https://luzfija.goatcounter.com/count'
    };
    new Function(goatCounterCode)();
    const onSent = vi.fn();

    const pending = window.goatcounter.count({
      path: 'error-context/prueba-confirmada',
      event: true,
      force_image: true,
      on_sent: onSent
    });

    const image = document.body.querySelector('img');
    expect(pending).toBe(false);
    expect(beacon).not.toHaveBeenCalled();
    expect(image.src).not.toContain('force_image');
    image.dispatchEvent(new Event('load'));
    expect(onSent).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true
    });
  });
});
