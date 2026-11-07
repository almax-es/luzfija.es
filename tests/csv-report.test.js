import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'module';

// Aviso persistente de importacion fallida + reporte del archivo (js/lf-csv-report.js).
// Contrato: el bloque explica el fallo, pide el origen del archivo y arma un mailto a
// hola@luzfija.es con una muestra anonimizada que el usuario ve y edita antes de enviar.
// Nada sale solo; a analitica solo viajan categorias de listas cerradas.

const require = createRequire(import.meta.url);
const XLSXLib = require('../vendor/xlsx/xlsx.full.min.js');

let report;
let utils;

beforeAll(async () => {
  await import('../js/lf-utils.js');
  window.LF = window.LF || {};
  window.LF.toast = vi.fn();
  await import('../js/lf-csv-utils.js');
  await import('../js/lf-csv-report.js');
  await import('../js/lf-csv-import.js');
  report = window.LF.csvReport;
  utils = window.LF.csvUtils;
});

beforeEach(() => {
  document.body.innerHTML = '';
  window.__LF_trackDetail = vi.fn();
  window.LF.toast.mockClear();
});

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      let value;
      try { value = predicate(); } catch (_) { value = null; }
      if (value) return resolve(value);
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function decodeMailto(href) {
  const url = new URL(href);
  return {
    to: url.pathname,
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body')
  };
}

function choose(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickNode(node) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}

function xlsxFile(sheets, name = 'datos.xlsx') {
  const wb = XLSXLib.utils.book_new();
  sheets.forEach(([sheetName, rows]) => XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(rows), sheetName));
  const out = XLSXLib.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([out], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('splitImportErrorMessage', () => {
  it('separa el mensaje de usuario del bloque tecnico y quita la peticion antigua', () => {
    const err = utils.buildImportError('No se pudo detectar la cabecera del CSV.', {
      headersNorm: ['mes', 'importada_kwh'],
      separator: ','
    });
    const { userMessage, technical } = report.splitImportErrorMessage(err.message);
    expect(userMessage).toBe('No se pudo detectar la cabecera del CSV.');
    expect(technical).toContain('Separador detectado: ","');
    expect(technical).toContain('Cabeceras normalizadas detectadas: mes, importada_kwh');
    expect(technical).not.toContain('hola@luzfija.es');
    expect(userMessage).not.toContain('hola@luzfija.es');
  });

  it('un mensaje sin bloque tecnico se conserva entero', () => {
    expect(report.splitImportErrorMessage('El archivo es demasiado grande (12 MB).'))
      .toEqual({ userMessage: 'El archivo es demasiado grande (12 MB).', technical: '' });
    expect(report.splitImportErrorMessage('').userMessage).toBe('No se pudo procesar el archivo.');
  });
});

describe('pistas y cuando se pide el archivo', () => {
  it('un fallo de formato explica que fichero hace falta sin dar a entender que solo sirve Datadis', () => {
    const hint = report.userHintFor('cabecera-no-detectada', 'home', 'csv');
    expect(hint).toContain('curva horaria del contador');
    expect(hint).toContain('distribuidora o de Datadis');
    expect(hint).toContain('inversor');
  });

  it('un PDF lleva a la factura y no pide el archivo (seria la factura con datos personales)', () => {
    expect(report.userHintFor('formato-no-soportado', 'home', 'pdf')).toContain('«Subir factura»');
    expect(report.userHintFor('formato-no-soportado', 'solar', 'pdf')).toContain('comparador principal');
    expect(report.shouldOfferReport('formato-no-soportado', 'pdf')).toBe(false);
  });

  it('no pide el archivo cuando no hay nada que analizar', () => {
    for (const code of ['archivo-grande', 'sin-archivo', 'rango-fechas']) {
      expect(report.shouldOfferReport(code, 'csv')).toBe(false);
    }
    for (const code of ['cabecera-no-detectada', 'filas-invalidas', 'periodo-duplicado', 'otro', 'columna-solar']) {
      expect(report.shouldOfferReport(code, 'csv')).toBe(true);
    }
  });
});

describe('anonymizeSampleText', () => {
  it('oculta CUPS, DNI, NIE, IBAN, emails y telefonos', () => {
    const text = [
      '"ES0031300050554001GX0F";"2025/10/01";"01:00";"0,282";Real',
      'ES 0031 3000 5055 4001 GX0F;x',
      'dni 12345678Z nie X1234567L',
      'iban ES91 2100 0418 4502 0005 1332',
      'mail pepe.perez@example.com tel 612 345 678 o +34 912345678'
    ].join('\n');
    const out = report.anonymizeSampleText(text);
    for (const secret of ['0554001GX0F', '0031 3000', '12345678Z', 'X1234567L', '2100 0418', 'pepe.perez', '612 345 678', '912345678']) {
      expect(out).not.toContain(secret);
    }
    // Los datos de consumo, fechas y horas se conservan: son lo que hay que analizar.
    expect(out).toContain('"2025/10/01";"01:00";"0,282";Real');
  });

  it('oculta las fichas etiqueta;valor de las cabeceras de Excel y las direcciones', () => {
    const out = report.anonymizeSampleText([
      'Titular;Juan Pérez García',
      'Dirección: Calle Mayor 5, Zaragoza',
      'Titular Juan Pérez',
      'Suministro;C/ Alcalá 5',
      'Fecha;Hora;Consumo'
    ].join('\n'));
    for (const secret of ['Juan', 'Pérez', 'Mayor 5', 'Alcalá']) expect(out).not.toContain(secret);
    expect(out).toContain('Titular;[oculto]');
    expect(out).toContain('Dirección: [oculto]');
    expect(out).toContain('Fecha;Hora;Consumo');
  });

  it('en una tabla con columna personal conserva la cabecera y oculta sus valores', () => {
    const out = report.anonymizeSampleText([
      'CUPS;Titular;Fecha;Hora;Consumo_kWh',
      'ES0031300050554001GX0F;Ana López;01/10/2025;1;0,2'
    ].join('\n'));
    expect(out.split('\n')[0]).toBe('CUPS;Titular;Fecha;Hora;Consumo_kWh');
    expect(out.split('\n')[1]).toBe('[CUPS];[oculto];01/10/2025;1;0,2');
  });
});

describe('buildReportText', () => {
  it('anonimiza la lista de cabeceras normalizadas del bloque tecnico (ficha Titular;Nombre)', () => {
    const technical = 'Separador detectado: ";"\nCabeceras normalizadas detectadas: titular, juan_perez_garcia';
    const text = report.buildReportText({
      context: 'home', ext: 'csv', size: 90, errorCode: 'cabecera-no-detectada',
      userMessage: 'No se pudo detectar la cabecera del CSV.', technical, signature: null, sample: null
    });
    expect(text).toContain('Cabeceras normalizadas detectadas: titular, [oculto]');
    expect(text).not.toContain('juan');
    // Una cabecera de tabla normal se conserva entera: es lo que hay que analizar.
    const normal = report.buildReportText({
      context: 'home', ext: 'csv', size: 90, errorCode: 'cabecera-no-detectada', userMessage: 'x',
      technical: 'Cabeceras normalizadas detectadas: cups, fecha, hora, ae_kwh, metodo'
    });
    expect(normal).toContain('Cabeceras normalizadas detectadas: cups, fecha, hora, ae_kwh, metodo');
  });
});

describe('decodeSampleBytes', () => {
  it('lee UTF-16 con BOM (Excel "Texto Unicode") y Windows-1252', () => {
    const text = 'Fecha;Hora;Consumo\n01/10/2025;1;0,2';
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(report.decodeSampleBytes(utf16)).toEqual({ encoding: 'utf-16le', text });

    const latin = new Uint8Array([0x45, 0x6e, 0x65, 0x72, 0x67, 0xed, 0x61]); // "Energía" en 1252
    expect(report.decodeSampleBytes(latin)).toEqual({ encoding: 'windows-1252', text: 'Energía' });
  });
});

describe('buildFileSample', () => {
  it('CSV: primeras lineas anonimizadas', async () => {
    const csv = 'Titular;Juan Pérez\nCUPS;Fecha;Hora;Consumo\nES0031300050554001GX0F;01/10/2025;1;0,2\n';
    const sample = await report.buildFileSample(new File([csv], 'x.csv'));
    expect(sample.kind).toBe('texto');
    expect(sample.encoding).toBe('utf-8');
    expect(sample.sample).not.toContain('Juan');
    expect(sample.sample).not.toContain('0554001GX0F');
    expect(sample.sample).toContain('01/10/2025;1;0,2');
  });

  it('XLSX: nombres de hojas y primeras filas de cada una, sin datos personales', async () => {
    const file = xlsxFile([
      ['Resumen', [['Titular', 'Juan Pérez'], ['CUPS', 'ES0031300050554001GX0F']]],
      ['Curva', [['Fecha', 'Hora', 'kWh'], ['01/10/2025', 1, 0.2]]]
    ]);
    const sample = await report.buildFileSample(file, { XLSX: XLSXLib });
    expect(sample.kind).toBe('xlsx');
    expect(sample.sheetNames).toEqual(['Resumen', 'Curva']);
    expect(sample.sample).toContain('[Hoja 1: Resumen]');
    expect(sample.sample).toContain('[Hoja 2: Curva]');
    expect(sample.sample).toContain('Fecha;Hora;kWh');
    expect(sample.sample).not.toContain('Juan');
    expect(sample.sample).not.toContain('0554001GX0F');
  });

  it('PDF, vacio y binario: nunca incluye contenido', async () => {
    expect((await report.buildFileSample(new File(['%PDF-1.7 Juan'], 'f.pdf'))).sample).not.toContain('Juan');
    expect((await report.buildFileSample(new File([], 'v.csv'))).kind).toBe('vacio');
    const bin = new Uint8Array(400).map((_, i) => (i % 7) + 1);
    expect((await report.buildFileSample(new File([bin], 'b.csv'))).kind).toBe('binario');
  });
});

describe('buildMailtoHref', () => {
  it('va a hola@luzfija.es con el origen y la muestra en el cuerpo', () => {
    const { href, truncated } = report.buildMailtoHref({
      context: 'solar', originSlug: 'distribuidora', originDetail: 'ide', reportText: 'Código: cabecera-no-detectada'
    });
    const mail = decodeMailto(href);
    expect(mail.to).toBe('hola@luzfija.es');
    expect(mail.subject).toContain('Comparador de tarifas solares');
    expect(mail.body).toContain('¿De dónde lo he sacado? Web o app de mi distribuidora: i-DE (Iberdrola)');
    expect(mail.body).toContain('adjunta también el archivo');
    expect(mail.body).toContain('Código: cabecera-no-detectada');
    expect(truncated).toBe(false);
  });

  it('recorta la muestra por el final para no superar el limite de los clientes de correo', () => {
    const long = Array.from({ length: 200 }, (_, i) => `linea ${i};01/10/2025;${i};0,2`).join('\n');
    const { href, truncated } = report.buildMailtoHref({ context: 'home', originSlug: 'datadis', reportText: long });
    expect(truncated).toBe(true);
    expect(href.length).toBeLessThanOrEqual(1900);
    const { body } = decodeMailto(href);
    expect(body).toContain('linea 0;');
    expect(body).toContain('Copiar texto');
  });
});

describe('originTrackingSegments: solo listas cerradas', () => {
  it('distribuidora e inversor viajan como slug de su lista; el texto libre nunca', () => {
    expect(report.originTrackingSegments('distribuidora', 'ufd')).toEqual(['distribuidora', 'ufd']);
    expect(report.originTrackingSegments('inversor', 'huawei')).toEqual(['inversor', 'huawei']);
    expect(report.originTrackingSegments('inversor', 'Mi marca rara')).toEqual(['inversor', 'sin-detalle']);
    expect(report.originTrackingSegments('comercializadora', 'Octopus Energy Juan')).toEqual(['comercializadora']);
    expect(report.originTrackingSegments('otro', 'lo que sea')).toEqual(['otro']);
    expect(report.originTrackingSegments('inventado', 'x')).toEqual(['sin-origen']);
  });
});

describe('showImportError (UI)', () => {
  function mostrar(extra = {}) {
    document.body.innerHTML = '<div id="antes"></div><div id="despues"></div>';
    const message = utils.buildImportError('No se pudo detectar la cabecera del CSV.', { headersNorm: ['mes'], separator: ',' }).message;
    const file = new File(['Titular;Juan Pérez\nMes,Importada kWh\n1/2026,100'], 'ES0031300050554001GX0F.csv');
    return report.showImportError({
      context: 'solar', file, message, errorCode: 'cabecera-no-detectada',
      anchor: document.getElementById('antes'), ...extra
    });
  }

  it('se inserta tras el ancla, persiste y sustituye a un aviso anterior del mismo contexto', () => {
    const panel = mostrar();
    expect(panel.previousElementSibling.id).toBe('antes');
    expect(panel.textContent).toContain('No hemos podido usar este archivo');
    expect(panel.textContent).toContain('No se pudo detectar la cabecera del CSV.');
    expect(panel.textContent).not.toContain('Separador detectado');
    expect(document.activeElement && document.activeElement.id).toBe('lfCsvReport-solar-title');
    mostrar();
    expect(document.querySelectorAll('.lf-csv-report')).toHaveLength(1);
    report.dismiss('solar');
    expect(document.querySelector('.lf-csv-report')).toBeNull();
  });

  it('prependTo gana al ancla (home: al principio de <main>)', () => {
    document.body.innerHTML = '<main id="main"><div id="primero"></div></main>';
    const panel = report.showImportError({
      context: 'home', file: new File(['x'], 'a.csv'), message: 'x', errorCode: 'otro',
      prependTo: document.getElementById('main'), anchor: document.getElementById('primero')
    });
    expect(document.getElementById('main').firstElementChild).toBe(panel);
  });

  it('sin donde pintarlo devuelve null para que el importador use su aviso anterior', () => {
    document.body.innerHTML = '';
    expect(report.showImportError({ context: 'home', file: null, message: 'x', errorCode: 'otro' })).toBeNull();
    expect(report.showImportError({ context: 'inventado', message: 'x', anchor: document.body })).toBeNull();
  });

  it('pinta el mensaje como texto, nunca como HTML', () => {
    document.body.innerHTML = '<div id="a"></div>';
    const panel = report.showImportError({
      context: 'home', file: new File(['x'], 'a.csv'), errorCode: 'otro', anchor: document.getElementById('a'),
      message: 'Error en columna <img src=x onerror="window.__pwned=1">'
    });
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.textContent).toContain('<img src=x');
  });

  it('no deja enviar sin elegir el origen y luego arma el correo con origen y muestra anonimizada', async () => {
    const panel = mostrar();
    const send = panel.querySelector('.lf-csv-report__send');
    const textarea = panel.querySelector('textarea');
    await waitFor(() => textarea.value.includes('Primeras líneas'));

    expect(send.getAttribute('aria-disabled')).toBe('true');
    const blocked = clickNode(send);
    expect(blocked.defaultPrevented).toBe(true);
    expect(panel.querySelector('.lf-csv-report__status').textContent).toContain('de dónde has sacado');

    const origin = panel.querySelector('#lfCsvReport-solar-origin');
    choose(origin, 'distribuidora');
    choose(panel.querySelector('#lfCsvReport-solar-detail'), 'edistribucion');
    expect(send.getAttribute('aria-disabled')).toBe('false');

    const sent = clickNode(send);
    expect(sent.defaultPrevented).toBe(false);
    const mail = decodeMailto(send.getAttribute('href'));
    expect(mail.to).toBe('hola@luzfija.es');
    expect(mail.body).toContain('e-distribución (Endesa)');
    expect(mail.body).toContain('Código: cabecera-no-detectada');
    expect(mail.body).toContain('Cabeceras normalizadas detectadas: mes');
    // Ni el nombre del archivo (lleva el CUPS) ni los datos personales del contenido.
    expect(mail.body).not.toContain('0554001GX0F');
    // Tambien en minusculas: el bloque tecnico lista las cabeceras ya normalizadas.
    expect(mail.body.toLowerCase()).not.toContain('juan');
    expect(mail.body.toLowerCase()).not.toContain('perez');

    const events = window.__LF_trackDetail.mock.calls.filter((c) => c[0] === 'csv-reporte').map((c) => c[1].join('/'));
    expect(events).toContain('solar/mostrado/cabecera-no-detectada');
    expect(events).toContain('solar/origen/distribuidora/edistribucion');
    expect(events).toContain('solar/enviar/distribuidora/edistribucion');
  });

  it('el texto libre (comercializadora) va al correo pero nunca a analitica', async () => {
    const panel = mostrar();
    await waitFor(() => panel.querySelector('textarea').value.includes('Primeras líneas'));
    choose(panel.querySelector('#lfCsvReport-solar-origin'), 'comercializadora');
    const input = panel.querySelector('#lfCsvReport-solar-detail');
    input.value = 'Comercializadora Secreta SL';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const send = panel.querySelector('.lf-csv-report__send');
    clickNode(send);
    expect(decodeMailto(send.getAttribute('href')).body).toContain('Comercializadora Secreta SL');
    expect(JSON.stringify(window.__LF_trackDetail.mock.calls)).not.toContain('Secreta');
  });

  it('las ediciones del usuario en el cuadro van al correo', async () => {
    const panel = mostrar();
    const textarea = panel.querySelector('textarea');
    await waitFor(() => textarea.value.includes('Primeras líneas'));
    textarea.value = 'Texto revisado por mí';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    choose(panel.querySelector('#lfCsvReport-solar-origin'), 'no-se');
    expect(decodeMailto(panel.querySelector('.lf-csv-report__send').getAttribute('href')).body).toContain('Texto revisado por mí');
  });

  it('Copiar usa el portapapeles con el origen incluido', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const panel = mostrar();
    await waitFor(() => panel.querySelector('textarea').value.includes('Primeras líneas'));
    choose(panel.querySelector('#lfCsvReport-solar-origin'), 'datadis');
    clickNode(panel.querySelector('.lf-csv-report__copy'));
    await waitFor(() => writeText.mock.calls.length);
    expect(writeText.mock.calls[0][0]).toContain('¿De dónde lo he sacado? Datadis');
    await waitFor(() => panel.querySelector('.lf-csv-report__status').textContent.includes('copiado'));
  });

  it('archivo demasiado grande: explica el error pero no pide el archivo', () => {
    document.body.innerHTML = '<div id="a"></div>';
    const panel = report.showImportError({
      context: 'home', file: new File(['x'], 'a.csv'), errorCode: 'archivo-grande',
      message: 'El archivo es demasiado grande (12 MB).', anchor: document.getElementById('a')
    });
    expect(panel.textContent).toContain('demasiado grande');
    expect(panel.querySelector('.lf-csv-report__ask')).toBeNull();
  });
});

describe('importador real de la home', () => {
  function importar(file) {
    document.body.innerHTML = '<div class="actions"><div class="actions-center"></div></div><main id="main"><div id="x"></div></main>';
    const previo = document.getElementById('csvConsumoInput');
    if (previo) previo.remove();
    window.initCSVImporter();
    const input = document.getElementById('csvConsumoInput');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('un fichero no reconocido muestra el bloque persistente en lugar del toast', async () => {
    importar(new File(['Mes,Importada kWh,Exportada kWh\n1/2026,100,50'], 'inversor.csv', { type: 'text/csv' }));
    const panel = await waitFor(() => document.getElementById('lfCsvReport-home'));
    expect(document.getElementById('main').firstElementChild).toBe(panel);
    expect(window.LF.toast).not.toHaveBeenCalled();
  });

  it('sin el modulo de reporte vuelve al toast de siempre', async () => {
    const saved = window.LF.csvReport;
    window.LF.csvReport = undefined;
    try {
      importar(new File(['Mes,Importada kWh\n1/2026,100'], 'inversor.csv', { type: 'text/csv' }));
      await waitFor(() => window.LF.toast.mock.calls.length);
      expect(window.LF.toast.mock.calls[0][1]).toBe('err');
      expect(document.getElementById('lfCsvReport-home')).toBeNull();
    } finally {
      window.LF.csvReport = saved;
    }
  });

  it('una importacion nueva retira el aviso del archivo anterior', async () => {
    importar(new File(['Mes,Importada kWh\n1/2026,100'], 'inversor.csv', { type: 'text/csv' }));
    await waitFor(() => document.getElementById('lfCsvReport-home'));
    const input = document.getElementById('csvConsumoInput');
    Object.defineProperty(input, 'files', { value: [new File(['Fecha;Hora;Consumo_kWh\n01/01/2025;1;0,4'], 'b.csv')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Se retira al EMPEZAR la nueva importacion, antes de saber si sale bien o mal.
    expect(document.getElementById('lfCsvReport-home')).toBeNull();
  });
});
