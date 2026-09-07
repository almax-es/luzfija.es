import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Ronda 22 (05/09/2026). El codigo ya distinguia la causa real de cada fallo de catalogo
// (__lfTarifasStatus / __lfTarifasFailureKind) pero TODAS terminaban en el mismo
// "Error conexion", que manda al usuario a revisar su wifi por un 404 o un JSON corrupto.
// Lo mismo pasaba con los precios de manhana: "no publicado todavia" y "fallo de red" se
// veian identicos (la pestanha simplemente no aparecia). Estos tests fijan la distincion.

function readJs(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', 'js', ...parts), 'utf8');
}

function loadModule(relPath, win) {
  const code = readJs(relPath);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', `${code}`)(win, win.document, win.navigator);
}

describe('Mensajes de fallo de catalogo segun la causa real', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.LF = window.LF || {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.LF;
  });

  function describir(error) {
    loadModule('lf-cache.js', window);
    return window.LF.describirFalloTarifas(error);
  }

  it('un HTTP 404 no se presenta como fallo de conexion', () => {
    const error = new Error('HTTP 404');
    error.__lfTarifasStatus = 404;
    const fallo = describir(error);

    expect(fallo.kind).toBe('servidor');
    expect(fallo.status).not.toBe('Error conexión');
    expect(fallo.toast).toContain('404');
    // El texto con cache tampoco puede afirmar que no hay conexion.
    expect(fallo.toastConCache).not.toContain('Sin conexión');
  });

  it('un HTTP 500 tambien se atribuye al servidor', () => {
    const error = new Error('HTTP 500');
    error.__lfTarifasStatus = 500;
    const fallo = describir(error);

    expect(fallo.kind).toBe('servidor');
    expect(fallo.toast).toContain('500');
  });

  it('un JSON no parseable se presenta como datos invalidos, no como red', () => {
    const error = new Error('Unexpected token');
    error.__lfTarifasFailureKind = 'json-parse';
    const fallo = describir(error);

    expect(fallo.kind).toBe('datos');
    expect(fallo.status).not.toBe('Error conexión');
    expect(fallo.toastConCache).not.toContain('Sin conexión');
  });

  it('un JSON valido pero sin tarifas utilizables tambien es "datos"', () => {
    const error = new Error('JSON sin tarifas válidas');
    error.__lfTarifasFailureKind = 'json-invalid';
    expect(describir(error).kind).toBe('datos');
  });

  it('un fallo de red real si conserva el texto de conexion', () => {
    const fallo = describir(new TypeError('Failed to fetch'));

    expect(fallo.kind).toBe('red');
    expect(fallo.status).toBe('Error conexión');
    expect(fallo.toastConCache).toContain('Sin conexión');
  });

  it('sin informacion de causa no se inventa una: cae al texto de red', () => {
    // Importante: es el caso que ve un consumidor con fetchTarifas mockeado. Preferimos el
    // texto historico antes que afirmar una causa que no se ha observado.
    const fallo = describir(null);
    expect(fallo.kind).toBe('red');
    expect(fallo.status).toBe('Error conexión');
  });
});

describe('Precios de manhana: dia no publicado frente a fallo real', () => {
  it('el centinela de dia no publicado va marcado para poder distinguirlo', () => {
    const code = readJs('index-extra.js');
    // La marca tiene que existir en el punto que lanza el "sin datos" del dataset estatico.
    expect(code).toContain('__lfPvpcDiaNoPublicado');
    const idx = code.indexOf('Sin datos (dataset estático)');
    expect(idx).toBeGreaterThan(-1);
    // La marca se asigna junto al centinela, no en otro sitio del fichero.
    expect(code.slice(idx, idx + 200)).toContain('__lfPvpcDiaNoPublicado');
  });

  it('el catch de manhana solo calla ante el centinela, no ante cualquier error', () => {
    const code = readJs('index-extra.js');
    const idx = code.indexOf("[PVPC] Mañana no disponible");
    expect(idx).toBeGreaterThan(-1);
    const bloque = code.slice(idx, idx + 500);
    // Debe consultar la marca antes de decidir si avisa.
    expect(bloque).toContain('__lfPvpcDiaNoPublicado');
    expect(bloque).toContain('pvpcMananaAviso');
  });

  it('index.html tiene el contenedor del aviso, oculto por defecto', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
    const idx = html.indexOf('id="pvpcMananaAviso"');
    expect(idx).toBeGreaterThan(-1);
    const tag = html.slice(idx, idx + 200);
    expect(tag).toContain('display:none');
    expect(tag).toContain('role="status"');
  });
});

describe('Comparativa por anhos: cobertura parcial visible', () => {
  it('renderComparison consulta meta.partial y escribe en compareMeta', () => {
    const code = readJs('pvpc-stats-ui.js');
    const idx = code.indexOf('async function renderComparison');
    expect(idx).toBeGreaterThan(-1);
    const fn = code.slice(idx, code.indexOf('function setTrendMode', idx));

    expect(fn).toContain('meta.partial');
    expect(fn).toContain('failedMonths');
    expect(fn).toContain('compareMeta');
  });

  it('el elemento compareMeta existe en el marcado del Observatorio', () => {
    const html = fs.readFileSync(
      path.resolve(__dirname, '..', 'estadisticas', 'index.html'),
      'utf8'
    );
    const idx = html.indexOf('id="compareMeta"');
    expect(idx).toBeGreaterThan(-1);
    expect(html.slice(idx - 120, idx + 120)).toContain('role="status"');
  });

  it('un anho que no carga tampoco desaparece en silencio', () => {
    const code = readJs('pvpc-stats-ui.js');
    const idx = code.indexOf('async function renderComparison');
    const fn = code.slice(idx, code.indexOf('function setTrendMode', idx));
    // La rama de resultado nulo debe registrar el anho, no solo hacer `continue`.
    expect(fn).toContain('no se pudo cargar');
  });
});
