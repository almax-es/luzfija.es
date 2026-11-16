import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Firma de formato de los ficheros CSV/XLSX no reconocidos (`csv-import-formato/*`).
// Garantia de privacidad: cada segmento sale de una lista cerrada; ni texto, ni numeros,
// ni nombres de columna del fichero del usuario. Ver ANALITICA-GOATCOUNTER.md 6.5.3.

const KINDS = ['texto', 'texto-no-utf8', 'html', 'xml', 'json', 'pdf', 'zip', 'ole', 'utf16', 'binario', 'vacio'];
const SEPARATORS = ['pyc', 'coma', 'tab', 'barra', 'ninguno', 'na'];
const COLUMNS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7-10', 'c11-23', 'c24-30', 'c31-mas', 'na'];
const DATES = ['iso', 'dmy', 'serial', 'sin-fecha', 'na'];
const TOKENS = ['fe', 'ho', 'co', 'kw', 'wh', 'ae', 'as', 'cu', 'pe', 'en', 'ex', 'ge', 'ra', 'mt', 'le', 'po', 'me', 'pn', 'hm'];

function expectClosedSignature(signature) {
  expect(signature).toHaveLength(5);
  const [kind, sep, cols, date, tokens] = signature;
  expect(KINDS).toContain(kind);
  expect(SEPARATORS).toContain(sep);
  expect(COLUMNS).toContain(cols);
  expect(DATES).toContain(date);
  if (tokens !== 'sin-tokens') {
    expect(tokens.startsWith('t-')).toBe(true);
    tokens.slice(2).split('-').forEach((token) => expect(TOKENS).toContain(token));
  }
}

const bytes = (text) => new TextEncoder().encode(text);

describe('csvFormatSignatureForTracking (funcion pura)', () => {
  let utils;
  beforeAll(async () => {
    await import('../js/lf-utils.js');
    await import('../js/lf-csv-utils.js');
    utils = window.LF.csvUtils;
  });

  it('solo se emite para errores de formato, no para errores de datos', () => {
    for (const code of ['cabecera-no-detectada', 'cabecera', 'filas-invalidas', 'columnas', 'formato-no-soportado', 'archivo-vacio']) {
      expect(utils.shouldTrackFormatSignature(code)).toBe(true);
    }
    for (const code of ['rango-fechas', 'periodo-duplicado', 'valor-invalido', 'otro', '', undefined]) {
      expect(utils.shouldTrackFormatSignature(code)).toBe(false);
    }
  });

  it('describe un CSV real de distribuidora con tokens de la lista cerrada', () => {
    const csv = fs.readFileSync(path.resolve(__dirname, 'fixtures/datadis_nuevo.csv'));
    const signature = utils.csvFormatSignatureForTracking(new Uint8Array(csv));
    expectClosedSignature(signature);
    expect(signature.slice(0, 4)).toEqual(['texto', 'pyc', 'c7-10', 'dmy']);
    for (const token of ['fe', 'ho', 'co', 'kw', 'cu', 'en', 'ex', 'ge', 'mt']) {
      expect(signature[4].split('-')).toContain(token);
    }
  });

  it('reconoce la matriz horaria H01..H24 como un unico token', () => {
    const header = ['Fecha', ...Array.from({ length: 24 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`)].join(';');
    const row = ['2025-01-01', ...Array(24).fill('0,3')].join(';');
    const signature = utils.csvFormatSignatureForTracking(bytes(`${header}\n${row}\n${row}`));
    expectClosedSignature(signature);
    expect(signature.slice(0, 4)).toEqual(['texto', 'pyc', 'c24-30', 'iso']);
    expect(signature[4]).toBe('t-fe-hm');
  });

  it('una cabecera desconocida no viaja: solo aparece como ausencia de tokens', () => {
    const csv = 'Zeitstempel,Verbrauch,Zaehler\n2025-01-01 00:00,0.4,ABC\n2025-01-01 01:00,0.3,ABC';
    const signature = utils.csvFormatSignatureForTracking(bytes(csv));
    expect(signature).toEqual(['texto', 'coma', 'c3', 'iso', 'sin-tokens']);
  });

  it('nunca incluye CUPS, nombres, emails, direcciones ni valores del fichero', () => {
    const csv = [
      'Titular: Juan Pérez;ES0021000000000000AB;juan.perez@example.com;C/ Mayor 123',
      'Mi columna rara;Otra columna;Importe 78,45 €',
      'ES0021000000000000AB;01/02/2025;1234,56'
    ].join('\r\n');
    const signature = utils.csvFormatSignatureForTracking(bytes(csv));
    expectClosedSignature(signature);
    const joined = signature.join('/');
    for (const secret of ['juan', 'perez', 'es0021', '0021', 'example', 'mayor', '123', '1234', '78']) {
      expect(joined.toLowerCase()).not.toContain(secret);
    }
  });

  it('detecta ficheros que no son texto: HTML disfrazado de Excel, XLSX, XLS antiguo, PDF, UTF-16 y vacio', () => {
    expect(utils.csvFormatSignatureForTracking(bytes('<html><body><table><tr><td>Fecha</td></tr></table>')))
      .toEqual(['html', 'na', 'na', 'na', 'sin-tokens']);
    expect(utils.csvFormatSignatureForTracking(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])))
      .toEqual(['zip', 'na', 'na', 'na', 'sin-tokens']);
    expect(utils.csvFormatSignatureForTracking(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])))
      .toEqual(['ole', 'na', 'na', 'na', 'sin-tokens']);
    expect(utils.csvFormatSignatureForTracking(bytes('%PDF-1.7\n...'))[0]).toBe('pdf');
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('Fecha;Hora').flatMap((ch) => [ch.charCodeAt(0), 0])]);
    expect(utils.csvFormatSignatureForTracking(utf16)[0]).toBe('utf16');
    expect(utils.csvFormatSignatureForTracking(new Uint8Array(0))[0]).toBe('vacio');
    expect(utils.csvFormatSignatureForTracking(bytes('\n\n  \n'))[0]).toBe('vacio');
  });

  it('marca el texto que no es UTF-8 (Latin-1) sin decodificarlo como contenido', () => {
    const latin1 = new Uint8Array([...bytes('Fecha;Hora;Consumo;Opci'), 0xf3, 0x6e, 0x0a, ...bytes('01/01/2025;1;0,4;R')]);
    const signature = utils.csvFormatSignatureForTracking(latin1);
    expectClosedSignature(signature);
    expect(signature[0]).toBe('texto-no-utf8');
    expect(signature[1]).toBe('pyc');
  });

  it('solo analiza los primeros 64 KiB y descarta la linea cortada', () => {
    const header = 'Fecha;Hora;Consumo_kWh\n';
    const row = '01/01/2025;1;0,400\n';
    const big = header + row.repeat(10000);
    const signature = utils.csvFormatSignatureForTracking(bytes(big));
    expect(signature).toEqual(['texto', 'pyc', 'c3', 'dmy', 't-fe-ho-co-kw']);
  });

  it('csvFormatSignatureFromFile lee el fichero y devuelve null si no puede', async () => {
    const file = new File(['Fecha;Hora;AE_kWh\n01/01/2025;1;0,4'], 'consumo.csv', { type: 'text/csv' });
    const signature = await utils.csvFormatSignatureFromFile(file);
    expect(signature).toEqual(['texto', 'pyc', 'c3', 'dmy', 't-fe-ho-kw-ae']);
    expect(await utils.csvFormatSignatureFromFile(null)).toBeNull();
    expect(await utils.csvFormatSignatureFromFile({})).toBeNull();
  });
});

function waitForCall(mock, eventName, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const call = mock.mock.calls.find((args) => args[0] === eventName);
      if (call) return resolve(call);
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout esperando ${eventName}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe('csv-import-formato en el importador real de la home', () => {
  beforeAll(async () => {
    await import('../js/lf-utils.js');
    window.LF = window.LF || {};
    window.LF.toast = vi.fn();
    await import('../js/lf-csv-utils.js');
    await import('../js/lf-csv-import.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '<div class="actions-center"></div>';
    window.__LF_trackDetail = vi.fn();
    const previo = document.getElementById('csvConsumoInput');
    if (previo) previo.remove();
  });

  function importar(file) {
    window.initCSVImporter();
    const input = document.getElementById('csvConsumoInput');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('una cabecera no reconocida emite la firma cerrada y nada del contenido', async () => {
    const contenido = 'ES9999000000000000XY;Juan Pérez;C/ Falsa 123\nES9999000000000000XY;31/12/2025;0,4';
    importar(new File([contenido], 'datos.csv', { type: 'text/csv' }));

    await waitForCall(window.__LF_trackDetail, 'csv-import-error');
    const [, detail, meta] = await waitForCall(window.__LF_trackDetail, 'csv-import-formato');
    expect(detail.slice(0, 2)).toEqual(['home', 'csv']);
    expectClosedSignature(detail.slice(2));
    expect(meta).toEqual({ title: 'Formato de CSV/XLSX no reconocido en home' });

    const payload = JSON.stringify(window.__LF_trackDetail.mock.calls);
    for (const secret of ['ES9999', 'Juan', 'Falsa', '123', '31/12']) {
      expect(payload).not.toContain(secret);
    }
  });

  it('un error de datos (no de formato) no emite firma', async () => {
    const csv = 'Fecha;Hora;Consumo_kWh\n01/01/2025;1;0,4\n01/01/2025;1;0,5';
    importar(new File([csv], 'dup.csv', { type: 'text/csv' }));
    const [, detail] = await waitForCall(window.__LF_trackDetail, 'csv-import-error');
    expect(detail[2]).not.toBe('cabecera-no-detectada');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(window.__LF_trackDetail.mock.calls.some((args) => args[0] === 'csv-import-formato')).toBe(false);
  });
});
