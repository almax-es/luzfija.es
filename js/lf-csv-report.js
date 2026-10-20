/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: aviso de importacion fallida + reporte del archivo =====
// Bloque persistente que sustituye al toast cuando falla una importacion CSV/XLSX en los
// tres importadores (home, simulador solar y observatorio). Dos objetivos, por este orden:
//
// 1. Explicar el fallo en lenguaje de usuario y decir QUE fichero hace falta (la curva
//    horaria del contador, de la distribuidora o de Datadis). No se describen clics de
//    ningun portal: cambian a menudo y la guia quedaria obsoleta.
// 2. Conseguir que el usuario nos mande el archivo. Hasta el 20/10/2026 el error era un toast
//    que desaparecia a los 15 s (o al primer toque en solar), con pointer-events:none, y pedia
//    escribir a mano a un email con "el archivo completo" y "5 lineas de ejemplo". Nadie lo
//    hacia, y la firma cerrada de csv-import-formato (ANALITICA-GOATCOUNTER.md 6.5.3) dice la
//    forma del fichero pero no de donde sale.
//
// Privacidad (contrato, lo vigila tests/csv-report.test.js):
// - NADA sale solo. La web no tiene backend: el bloque arma un `mailto:` que abre el correo
//   del propio usuario con el texto ya escrito, y es el usuario quien decide enviarlo.
// - La muestra se genera en local, oculta CUPS, DNI/NIE, IBAN, emails, telefonos, direcciones
//   y filas etiquetadas (titular, nombre, direccion...) y se ENSENA en un cuadro editable antes
//   de enviar nada.
// - A analitica solo viajan categorias de listas cerradas (contexto, codigo de error, tipo de
//   origen, distribuidora o marca de inversor de la lista). El texto libre del usuario
//   (comercializadora, detalle) va solo en el correo, nunca a GoatCounter.
// - Todo el contenido derivado del fichero se pinta con textContent / value, nunca innerHTML.
//
// Carga: se usa de forma perezosa (solo al fallar una importacion). Si este modulo no llega a
// cargar, cada importador conserva su aviso anterior (toast o nota), asi que nunca rompe la
// importacion. Ver ARRANQUE-CARGA.md.

(function() {
  'use strict';

  const REPORT_EMAIL = 'hola@luzfija.es';
  const SAMPLE_MAX_BYTES = 65536;
  const SAMPLE_MAX_LINES = 15;
  const SAMPLE_MAX_LINE_CHARS = 240;
  const XLSX_SAMPLE_MAX_SHEETS = 4;
  const XLSX_SAMPLE_MAX_ROWS = 12;
  const XLSX_SHEET_NAMES_MAX = 8;
  // Outlook y otros clientes de escritorio truncan o rechazan URLs mailto de mas de ~2.000
  // caracteres. Por encima de este presupuesto la muestra del cuerpo se recorta por el final
  // (el boton Copiar conserva siempre el texto completo).
  const MAILTO_MAX_CHARS = 1900;

  const CONTEXTS = {
    home: { label: 'Comparador principal', facturaHere: true },
    solar: { label: 'Comparador de tarifas solares', facturaHere: false },
    estadisticas: { label: 'Observatorio (CSV de excedentes)', facturaHere: false }
  };

  // Errores en los que el fichero no tiene nada que analizar: no se pide el reporte.
  const NO_REPORT_CODES = new Set(['archivo-grande', 'sin-archivo', 'rango-fechas']);

  // Errores de FORMATO: el fichero no es la curva horaria que se esperaba.
  const FORMAT_CODES = new Set([
    'cabecera-no-detectada', 'cabecera', 'filas-invalidas', 'columnas',
    'formato-no-soportado', 'archivo-vacio', 'excel-dimensiones-excesivas'
  ]);

  // ===== ORIGEN DEL ARCHIVO (listas cerradas) =====
  // `slug` es lo unico que puede viajar a analitica. `detail` define el segundo paso:
  // una lista cerrada (tambien trackeable) o texto libre (solo para el correo).
  const DISTRIBUIDORAS = [
    ['ide', 'i-DE (Iberdrola)'],
    ['edistribucion', 'e-distribución (Endesa)'],
    ['ufd', 'UFD (Naturgy)'],
    ['eredes', 'E-REDES'],
    ['viesgo', 'Viesgo'],
    ['otra', 'Otra distribuidora'],
    ['no-se', 'No sé cuál es']
  ];

  const INVERSORES = [
    ['huawei', 'Huawei (FusionSolar)'],
    ['sma', 'SMA (Sunny Portal)'],
    ['fronius', 'Fronius (Solar.web)'],
    ['goodwe', 'GoodWe (SEMS)'],
    ['growatt', 'Growatt (ShinePhone)'],
    ['solaredge', 'SolarEdge'],
    ['enphase', 'Enphase'],
    ['sungrow', 'Sungrow (iSolarCloud)'],
    ['solis', 'Solis (SolisCloud)'],
    ['victron', 'Victron (VRM)'],
    ['ingeteam', 'Ingeteam'],
    ['shelly', 'Shelly u otro medidor'],
    ['otra', 'Otra marca']
  ];

  const ORIGINS = [
    { slug: 'distribuidora', label: 'Web o app de mi distribuidora', detail: { kind: 'list', label: '¿Qué distribuidora?', options: DISTRIBUIDORAS } },
    { slug: 'datadis', label: 'Datadis', detail: null },
    { slug: 'comercializadora', label: 'Web o app de mi comercializadora (la que me factura)', detail: { kind: 'text', label: '¿Qué comercializadora?', placeholder: 'Ej.: Octopus, Repsol, Holaluz…' } },
    { slug: 'inversor', label: 'App de las placas o del inversor', detail: { kind: 'list', label: '¿Qué marca?', options: INVERSORES } },
    { slug: 'otro', label: 'Otro sitio', detail: { kind: 'text', label: '¿De dónde?', placeholder: 'Cuéntanos de dónde lo has sacado' } },
    { slug: 'no-se', label: 'No lo sé', detail: null }
  ];

  function findOrigin(slug) {
    return ORIGINS.find((o) => o.slug === slug) || null;
  }

  // Devuelve solo slugs de las listas cerradas; cualquier otra cosa se normaliza a ''.
  function originTrackingSegments(originSlug, detailValue) {
    const origin = findOrigin(originSlug);
    if (!origin) return ['sin-origen'];
    if (origin.detail && origin.detail.kind === 'list') {
      const known = origin.detail.options.some(([slug]) => slug === detailValue);
      return [origin.slug, known ? detailValue : 'sin-detalle'];
    }
    return [origin.slug];
  }

  function describeOrigin(originSlug, detailValue) {
    const origin = findOrigin(originSlug);
    if (!origin) return '(sin indicar)';
    if (!origin.detail) return origin.label;
    const detail = String(detailValue ?? '').trim();
    if (origin.detail.kind === 'list') {
      const match = origin.detail.options.find(([slug]) => slug === detail);
      return match ? `${origin.label}: ${match[1]}` : `${origin.label} (sin especificar)`;
    }
    return detail ? `${origin.label}: ${detail}` : `${origin.label} (sin especificar)`;
  }

  // ===== MENSAJE PARA EL USUARIO =====
  // buildHeaderError (lf-csv-utils.js) anade al mensaje un bloque tecnico y la peticion
  // antigua de escribir a mano. El bloque tecnico sigue siendo util en el reporte; la
  // peticion se sustituye por este aviso. No se toca buildHeaderError: csvErrorCodeForTracking
  // clasifica por la primera linea y varios tests fijan su formato.
  const TECHNICAL_MARKER = '\nSeparador detectado:';
  const LEGACY_SUPPORT_MARKER = 'Si tu archivo no se importa, escribe a';

  function splitImportErrorMessage(message) {
    const raw = String(message ?? '').replace(/\r\n?/g, '\n').trim();
    let userPart = raw;
    let technical = '';
    const technicalAt = raw.indexOf(TECHNICAL_MARKER);
    if (technicalAt !== -1) {
      userPart = raw.slice(0, technicalAt);
      technical = raw.slice(technicalAt + 1);
    }
    const supportAt = technical.indexOf(LEGACY_SUPPORT_MARKER);
    if (supportAt !== -1) technical = technical.slice(0, supportAt);
    const userSupportAt = userPart.indexOf(LEGACY_SUPPORT_MARKER);
    if (userSupportAt !== -1) userPart = userPart.slice(0, userSupportAt);
    return {
      userMessage: userPart.trim() || 'No se pudo procesar el archivo.',
      technical: technical.trim()
    };
  }

  function fileExtension(fileName) {
    const parts = String(fileName ?? '').split('.');
    return parts.length > 1 ? parts.pop().trim().toLowerCase() : '';
  }

  // Pista sobre QUE fichero hace falta. Describe el fichero, no los clics de ningun portal.
  function userHintFor(errorCode, context, ext) {
    const ctx = CONTEXTS[context] || CONTEXTS.home;
    if (ext === 'pdf') {
      return ctx.facturaHere
        ? 'Parece un PDF. Si es tu factura, súbela con el botón «Subir factura»; aquí hace falta la curva horaria en CSV o Excel.'
        : 'Parece un PDF. Si es tu factura, súbela en el comparador principal con «Subir factura»; aquí hace falta la curva horaria en CSV o Excel.';
    }
    const needs = context === 'estadisticas'
      ? 'Lo que funciona es la curva horaria del contador con la energía vertida (excedentes) hora a hora'
      : 'Lo que funciona es la curva horaria del contador (consumo hora a hora en kWh)';
    if (FORMAT_CODES.has(errorCode) || errorCode === 'otro') {
      return `${needs}, que descargas del área de clientes de tu distribuidora o de Datadis. ` +
        'Los informes de la app de las placas o del inversor y los resúmenes mensuales no sirven. ' +
        'Si lo has abierto y guardado con Excel, prueba con el archivo original.';
    }
    if (errorCode === 'datos-subhorarios') {
      return 'Descarga la curva horaria (una fila por hora) en lugar de la cuartohoraria.';
    }
    if (errorCode === 'agregado-por-periodo') {
      return `${needs}, no el total por periodos P1/P2/P3.`;
    }
    return '';
  }

  function shouldOfferReport(errorCode, ext) {
    if (ext === 'pdf') return false;
    return !NO_REPORT_CODES.has(String(errorCode || ''));
  }

  // ===== ANONIMIZADO =====
  const LABEL_RE = /^(titular|nombre|apellidos?|razon social|cliente|direccion|domicilio|calle|poblacion|localidad|municipio|codigo postal|cp|provincia|nif|dni|nie|cif|documento|telefono|movil|email|e-mail|correo|iban|cuenta|contrato|n[ºo°]? ?contrato|numero de contrato|poliza)\b/;
  const STREET_RE = /^(c\/|c\.\s|calle|avda\.?|avenida|av\.|plaza|pza\.?|paseo|pso\.?|camino|ctra\.?|carretera|urb\.?|urbanizacion|ronda|travesia|pasaje|poligono|partida)(\s|$)/;

  function foldForMatch(value) {
    let s = String(value ?? '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) {}
    return s.replace(/^["'\s]+/, '').replace(/[_]+/g, ' ');
  }

  function maskPatterns(text) {
    return String(text ?? '')
      // CUPS: ES + 16 digitos + 2 letras de control (+ sufijo opcional); se acepta con espacios.
      .replace(/\bES\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?[A-Z]{2}(?:\s?\d[A-Z0-9]?)?\b/gi, '[CUPS]')
      .replace(/\bES[0-9A-Z]{16,22}\b/gi, '[CUPS]')
      .replace(/\bES\d{2}(?:[ -]?\d{4}){5}\b/gi, '[IBAN]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
      .replace(/\b[XYZ][-\s]?\d{7}[-\s]?[A-HJ-NP-TV-Z]\b/gi, '[DNI]')
      .replace(/\b\d{8}[-\s]?[A-HJ-NP-TV-Z]\b/gi, '[DNI]')
      .replace(/(?:\+34[\s-]?)?\b[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, '[teléfono]');
  }

  // Celda que empieza por una etiqueta personal: conserva la etiqueta y oculta el resto
  // ("Titular: Juan" -> "Titular: [oculto]", "Titular Juan" -> "Titular [oculto]").
  function maskLabelledCell(cell) {
    const raw = String(cell);
    const colon = raw.indexOf(':');
    if (colon !== -1) {
      return raw.slice(colon + 1).trim() ? `${raw.slice(0, colon + 1)} [oculto]` : raw;
    }
    const lead = raw.length - raw.replace(/^["'\s]+/, '').length;
    const match = LABEL_RE.exec(foldForMatch(raw));
    const labelEnd = lead + (match ? match[0].length : 0);
    return raw.slice(labelEnd).trim() ? `${raw.slice(0, labelEnd)} [oculto]` : raw;
  }

  // Dos casos de datos personales fuera de patron:
  // - Ficha "etiqueta;valor" (2-3 celdas con contenido, tipica de las cabeceras de los Excel de
  //   distribuidora): se ocultan la etiqueta y todo lo que la sigue en la fila.
  // - Tabla con una columna personal ("CUPS;Titular;Fecha;..."): se conserva el nombre de la
  //   columna y se ocultan sus valores en las filas siguientes (state.sensitiveCols).
  // Cualquier celda con forma de direccion postal se oculta siempre.
  function maskCells(cells, state) {
    const nonEmpty = cells.filter((cell) => foldForMatch(cell).trim()).length;
    const isRecordRow = nonEmpty <= 3;
    const labelCols = [];
    let labelled = false;
    const masked = cells.map((cell, idx) => {
      const folded = foldForMatch(cell).trim();
      if (!folded) return cell;
      if (labelled) return '[oculto]';
      if (LABEL_RE.test(folded)) {
        if (isRecordRow) {
          labelled = true;
          return maskLabelledCell(cell);
        }
        labelCols.push(idx);
        return cell;
      }
      if (state.sensitiveCols.has(idx)) return '[oculto]';
      if (STREET_RE.test(folded)) return '[dirección]';
      return cell;
    });
    if (labelCols.length) state.sensitiveCols = new Set(labelCols);
    return masked;
  }

  function detectSeparator(lines) {
    let best = null;
    let bestCount = 0;
    for (const sep of [';', ',', '\t', '|']) {
      const count = lines.filter((line) => line.includes(sep)).length;
      if (count > bestCount) { best = sep; bestCount = count; }
    }
    return best;
  }

  function anonymizeSampleText(text) {
    const lines = String(text ?? '').split('\n');
    const sep = detectSeparator(lines);
    const state = { sensitiveCols: new Set() };
    return lines.map((line) => {
      // Las cabeceras de hoja de un Excel ([Hoja 1: ...]) reinician las columnas sensibles.
      if (/^\[Hoja \d+: /.test(line)) state.sensitiveCols = new Set();
      const cells = sep ? line.split(sep) : [line];
      return maskPatterns(maskCells(cells, state).join(sep || ''));
    }).join('\n');
  }

  // El bloque tecnico de buildHeaderError lista las cabeceras en una sola linea con prefijo
  // ("Cabeceras normalizadas detectadas: titular, juan_perez"): la mejor fila candidata, que
  // puede ser una ficha "Titular;Nombre". Se anonimiza la lista como si fuera una fila.
  function anonymizeTechnical(technical) {
    return String(technical ?? '').split('\n').map((line) => {
      const match = /^(Cabeceras normalizadas detectadas:\s*)(.*)$/.exec(line);
      if (!match) return maskPatterns(line);
      const cells = match[2].split(/,\s*/);
      return match[1] + anonymizeSampleText(cells.join(';')).split(';').join(', ');
    }).join('\n');
  }

  // ===== MUESTRA DEL ARCHIVO =====
  function decodeSampleBytes(bytes) {
    if (!bytes || !bytes.length) return { encoding: 'vacio', text: '' };
    const b = bytes;
    let encoding = '';
    if (b[0] === 0xff && b[1] === 0xfe) encoding = 'utf-16le';
    else if (b[0] === 0xfe && b[1] === 0xff) encoding = 'utf-16be';
    else {
      let zerosEven = 0;
      let zerosOdd = 0;
      for (let i = 0; i < b.length; i++) {
        if (b[i] === 0) { if (i % 2 === 0) zerosEven++; else zerosOdd++; }
      }
      if ((zerosEven + zerosOdd) / b.length > 0.1) encoding = zerosOdd >= zerosEven ? 'utf-16le' : 'utf-16be';
    }
    if (encoding) {
      try {
        return { encoding, text: new TextDecoder(encoding).decode(b).replace(/^\uFEFF/, '') };
      } catch (_) {}
    }
    try {
      return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^\uFEFF/, '') };
    } catch (_) {}
    try {
      return { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(b) };
    } catch (_) {
      return { encoding: 'desconocida', text: '' };
    }
  }

  function looksBinary(text) {
    if (!text) return false;
    let control = 0;
    const len = Math.min(text.length, 4000);
    for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) control++;
    }
    return control / len > 0.05;
  }

  function firstLinesSample(text, maxLines = SAMPLE_MAX_LINES) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
      .filter((line) => line.trim())
      .slice(0, maxLines)
      .map((line) => (line.length > SAMPLE_MAX_LINE_CHARS ? `${line.slice(0, SAMPLE_MAX_LINE_CHARS)}…` : line));
    return lines.join('\n');
  }

  function isZip(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  function isOle(bytes) {
    return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  }
  function isPdf(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }

  async function readFileBytes(file, maxBytes) {
    if (!file || typeof file.slice !== 'function') return null;
    const blob = typeof maxBytes === 'number' ? file.slice(0, maxBytes) : file;
    if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
    if (typeof FileReader === 'function') {
      const buffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });
      return new Uint8Array(buffer);
    }
    return null;
  }

  // Hojas y primeras filas de un Excel. Solo se lee si SheetJS ya esta cargado (lo carga el
  // importador antes de fallar); sheetRows acota lo que se materializa por hoja, asi que una
  // hoja con dimensiones enormes no cuesta memoria aqui.
  function sampleFromWorkbookBytes(bytes, XLSXLib) {
    if (!XLSXLib || typeof XLSXLib.read !== 'function') {
      return { sheetNames: [], text: '(no se pudo leer el Excel en el navegador)' };
    }
    const workbook = XLSXLib.read(bytes, { type: 'array', sheetRows: XLSX_SAMPLE_MAX_ROWS, cellNF: false, cellHTML: false });
    const names = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    const parts = [];
    names.slice(0, XLSX_SAMPLE_MAX_SHEETS).forEach((name, idx) => {
      const sheet = workbook.Sheets[name];
      let csv = '';
      try {
        csv = XLSXLib.utils.sheet_to_csv(sheet, { FS: ';', blankrows: false });
      } catch (_) {}
      parts.push(`[Hoja ${idx + 1}: ${name}]\n${firstLinesSample(csv, XLSX_SAMPLE_MAX_ROWS) || '(vacía)'}`);
    });
    if (names.length > XLSX_SAMPLE_MAX_SHEETS) parts.push(`(${names.length - XLSX_SAMPLE_MAX_SHEETS} hojas más sin mostrar)`);
    return { sheetNames: names.slice(0, XLSX_SHEET_NAMES_MAX), text: parts.join('\n\n') };
  }

  // Devuelve { kind, encoding, sheetNames, sample } con la muestra YA anonimizada.
  async function buildFileSample(file, options = {}) {
    const result = { kind: 'desconocido', encoding: '', sheetNames: [], sample: '' };
    let bytes;
    try {
      bytes = await readFileBytes(file, SAMPLE_MAX_BYTES);
    } catch (_) {
      bytes = null;
    }
    if (!bytes) {
      result.sample = '(no se pudo leer el archivo)';
      return result;
    }
    if (!bytes.length) {
      result.kind = 'vacio';
      result.sample = '(el archivo está vacío)';
      return result;
    }
    if (isPdf(bytes)) {
      result.kind = 'pdf';
      result.sample = '(PDF: no se incluye contenido)';
      return result;
    }
    if (isZip(bytes) || isOle(bytes)) {
      result.kind = isZip(bytes) ? 'xlsx' : 'xls-antiguo';
      try {
        // El Excel se necesita entero: el directorio del ZIP va al final del fichero.
        const full = await readFileBytes(file);
        const XLSXLib = options.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
        const wb = sampleFromWorkbookBytes(full, XLSXLib);
        result.sheetNames = wb.sheetNames.map((name) => anonymizeSampleText(name));
        result.sample = anonymizeSampleText(wb.text);
      } catch (_) {
        result.sample = '(no se pudo leer el Excel en el navegador)';
      }
      return result;
    }
    const decoded = decodeSampleBytes(bytes);
    result.encoding = decoded.encoding;
    if (looksBinary(decoded.text)) {
      result.kind = 'binario';
      result.sample = '(archivo binario: no se incluye contenido)';
      return result;
    }
    result.kind = /^\s*</.test(decoded.text) ? 'html-o-xml' : 'texto';
    let text = decoded.text;
    if (bytes.length >= SAMPLE_MAX_BYTES) text = text.slice(0, text.lastIndexOf('\n') > 0 ? text.lastIndexOf('\n') : text.length);
    result.sample = anonymizeSampleText(firstLinesSample(text));
    return result;
  }

  function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '?';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  // Texto que el usuario revisa y edita antes de enviar. Nunca incluye el nombre del
  // archivo: muchos lo llevan con el CUPS o el nombre del titular.
  function buildReportText({ context, ext, size, errorCode, userMessage, technical, signature, sample }) {
    const ctx = CONTEXTS[context] || CONTEXTS.home;
    const lines = [
      `Herramienta: ${ctx.label}`,
      `Archivo: .${ext || '?'} · ${formatSize(size)}${sample && sample.encoding ? ` · ${sample.encoding}` : ''}`,
      `Error: ${anonymizeSampleText(userMessage)}`,
      `Código: ${errorCode || 'otro'}`
    ];
    if (Array.isArray(signature) && signature.length) lines.push(`Firma: ${signature.join(' · ')}`);
    if (technical) lines.push(anonymizeTechnical(technical));
    if (sample && sample.sheetNames && sample.sheetNames.length) lines.push(`Hojas: ${sample.sheetNames.join(' | ')}`);
    lines.push('', 'Primeras líneas (CUPS y datos personales ocultos):', (sample && sample.sample) || '(sin muestra)');
    return lines.join('\n');
  }

  function buildMailtoHref({ context, originSlug, originDetail, reportText, maxChars = MAILTO_MAX_CHARS }) {
    const ctx = CONTEXTS[context] || CONTEXTS.home;
    const subject = `Archivo que no se importa en LuzFija (${ctx.label})`;
    const head = [
      'Hola:',
      '',
      'Este archivo no se importa en LuzFija.',
      `¿De dónde lo he sacado? ${describeOrigin(originSlug, originDetail)}`,
      '',
      '(Si puedes, adjunta también el archivo a este correo: ayuda todavía más.)',
      '',
      '--- Datos generados por la web ---'
    ].join('\n');
    const build = (text) => `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${head}\n${text}`)}`;
    const full = String(reportText ?? '');
    let href = build(full);
    if (href.length <= maxChars) return { href, truncated: false };
    const reportLines = full.split('\n');
    const note = '[…texto recortado para que quepa en el correo; pulsa «Copiar texto» en la web para pegarlo entero]';
    while (reportLines.length > 1) {
      reportLines.pop();
      href = build(`${reportLines.join('\n')}\n${note}`);
      if (href.length <= maxChars) return { href, truncated: true };
    }
    return { href: build(note), truncated: true };
  }

  // ===== UI =====
  function track(context, detail) {
    try {
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail('csv-reporte', [context, ...detail], { title: `Reporte de archivo CSV/XLSX: ${context}` });
      }
    } catch (_) {}
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    (children || []).forEach((child) => { if (child) node.appendChild(child); });
    return node;
  }

  function panelId(context) {
    return `lfCsvReport-${context}`;
  }

  function dismiss(context) {
    try {
      const existing = document.getElementById(panelId(context));
      if (existing) existing.remove();
    } catch (_) {}
  }

  function copyText(text, textarea) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(textarea));
    }
    return Promise.resolve(legacyCopy(textarea));
  }

  function legacyCopy(textarea) {
    try {
      textarea.focus();
      textarea.select();
      return document.execCommand('copy');
    } catch (_) {
      return false;
    }
  }

  // `prependTo` (home: <main>, debajo de la barra de acciones) o `anchor` (se inserta justo
  // despues: solar tras el boton de subida, observatorio tras su nota).
  function placePanel(panel, { anchor, prependTo }) {
    if (prependTo && typeof prependTo.insertBefore === 'function') {
      prependTo.insertBefore(panel, prependTo.firstChild);
      return true;
    }
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
      return true;
    }
    return false;
  }

  /**
   * Muestra el bloque de error persistente de una importacion fallida.
   * @param {Object} opts
   * @param {'home'|'solar'|'estadisticas'} opts.context
   * @param {File} opts.file - Archivo que fallo (solo se lee en local)
   * @param {string} opts.message - Mensaje de error del importador
   * @param {string} opts.errorCode - Codigo normalizado de csvErrorCodeForTracking
   * @param {Element} [opts.anchor] - Elemento tras el que se inserta el bloque
   * @param {Element} [opts.prependTo] - Contenedor al principio del cual se inserta (gana a anchor)
   * @returns {HTMLElement|null} El bloque, o null si no se pudo pintar (el llamante cae al aviso antiguo)
   */
  function showImportError(opts) {
    const context = CONTEXTS[opts && opts.context] ? opts.context : null;
    if (!context || typeof document === 'undefined') return null;
    const file = opts.file || null;
    const errorCode = String(opts.errorCode || 'otro');
    const ext = fileExtension(file && file.name);
    const { userMessage, technical } = splitImportErrorMessage(opts.message);
    const hint = userHintFor(errorCode, context, ext);
    const offerReport = shouldOfferReport(errorCode, ext);

    dismiss(context);
    const id = panelId(context);
    const titleId = `${id}-title`;
    const panel = el('section', { id, className: 'lf-csv-report', 'aria-labelledby': titleId, 'data-error-code': errorCode });

    const closeBtn = el('button', { type: 'button', className: 'lf-csv-report__close', 'aria-label': 'Cerrar aviso', text: '✕' });
    closeBtn.addEventListener('click', () => {
      track(context, ['cerrado']);
      dismiss(context);
    });
    const title = el('h3', { id: titleId, className: 'lf-csv-report__title', tabindex: '-1', text: '😕 No hemos podido usar este archivo' });
    panel.appendChild(el('div', { className: 'lf-csv-report__head' }, [title, closeBtn]));
    panel.appendChild(el('p', { className: 'lf-csv-report__msg', text: userMessage }));
    if (hint) panel.appendChild(el('p', { className: 'lf-csv-report__hint', text: hint }));

    if (offerReport) {
      const box = el('div', { className: 'lf-csv-report__ask' });
      box.appendChild(el('h4', { className: 'lf-csv-report__ask-title', text: '¿Me ayudas a que funcione?' }));
      box.appendChild(el('p', {
        className: 'lf-csv-report__pitch',
        text: 'Soy aLMaX y hago LuzFija yo solo. Si me mandas este archivo, lo reviso personalmente y te contesto: ' +
          'o lo adapto para que funcione, o te digo exactamente qué archivo descargar para que sí funcione. ' +
          'Además ayudas a quien venga detrás con el mismo archivo.'
      }));

      // Paso 1: origen (obligatorio para enviar; "No lo sé" cuenta como respuesta).
      const originSelectId = `${id}-origin`;
      const originSelect = el('select', { id: originSelectId, className: 'lf-csv-report__select', required: true });
      originSelect.appendChild(el('option', { value: '', text: 'Elige una opción…' }));
      ORIGINS.forEach((o) => originSelect.appendChild(el('option', { value: o.slug, text: o.label })));
      box.appendChild(el('label', { className: 'lf-csv-report__label', for: originSelectId, text: '1. ¿De dónde has sacado el archivo?' }));
      box.appendChild(originSelect);

      const detailWrap = el('div', { className: 'lf-csv-report__detail', hidden: true });
      box.appendChild(detailWrap);
      let detailInput = null;

      // Paso 2: lo que se enviara, editable.
      const textareaId = `${id}-text`;
      const textarea = el('textarea', { id: textareaId, className: 'lf-csv-report__text', rows: '9', spellcheck: 'false' });
      textarea.value = 'Preparando la muestra del archivo…';
      const details = el('details', { className: 'lf-csv-report__preview' }, [
        el('summary', { text: '2. Revisa lo que se enviará (puedes editarlo)' }),
        el('p', { className: 'lf-csv-report__fine', text: 'Hemos ocultado CUPS, DNI, IBAN, emails, teléfonos y direcciones. Borra o cambia lo que quieras antes de enviarlo.' }),
        el('label', { className: 'sr-only', for: textareaId, text: 'Texto que se enviará' }),
        textarea
      ]);
      box.appendChild(details);

      const sendLink = el('a', {
        className: 'btn lf-csv-report__send',
        href: `mailto:${REPORT_EMAIL}`,
        'aria-disabled': 'true',
        'data-lf-no-generic-track': true,
        text: '📧 Enviar a hola@luzfija.es'
      });
      const copyBtn = el('button', { type: 'button', className: 'btn lf-csv-report__copy', text: '📋 Copiar texto' });
      const laterBtn = el('button', { type: 'button', className: 'btn lf-csv-report__later', text: 'Ahora no' });
      const status = el('p', { className: 'lf-csv-report__status', role: 'status', 'aria-live': 'polite' });
      box.appendChild(el('div', { className: 'lf-csv-report__actions' }, [sendLink, copyBtn, laterBtn]));
      box.appendChild(status);
      box.appendChild(el('p', {
        className: 'lf-csv-report__fine',
        text: 'Se abrirá tu correo con el texto ya escrito: tú decides si lo envías. Si no se abre, copia el texto y mándalo a hola@luzfija.es. ' +
          'Si puedes, adjunta también el archivo: ayuda todavía más. Nada se envía solo: tu archivo no sale de tu dispositivo.'
      }));
      panel.appendChild(box);

      const currentDetail = () => (detailInput ? detailInput.value : '');
      const fullText = () => `¿De dónde lo he sacado? ${describeOrigin(originSelect.value, currentDetail())}\n${textarea.value}`;
      const refresh = () => {
        const hasOrigin = Boolean(findOrigin(originSelect.value));
        const { href } = buildMailtoHref({ context, originSlug: originSelect.value, originDetail: currentDetail(), reportText: textarea.value });
        sendLink.setAttribute('href', href);
        sendLink.setAttribute('aria-disabled', hasOrigin ? 'false' : 'true');
        sendLink.classList.toggle('is-disabled', !hasOrigin);
      };

      originSelect.addEventListener('change', () => {
        const origin = findOrigin(originSelect.value);
        detailWrap.textContent = '';
        detailInput = null;
        detailWrap.hidden = !(origin && origin.detail);
        if (origin && origin.detail) {
          const detailId = `${id}-detail`;
          detailWrap.appendChild(el('label', { className: 'lf-csv-report__label', for: detailId, text: origin.detail.label }));
          if (origin.detail.kind === 'list') {
            detailInput = el('select', { id: detailId, className: 'lf-csv-report__select' });
            detailInput.appendChild(el('option', { value: '', text: 'Elige una opción…' }));
            origin.detail.options.forEach(([slug, label]) => detailInput.appendChild(el('option', { value: slug, text: label })));
            detailInput.addEventListener('change', () => {
              refresh();
              track(context, ['origen', ...originTrackingSegments(originSelect.value, detailInput.value)]);
            });
          } else {
            detailInput = el('input', { id: detailId, type: 'text', className: 'lf-csv-report__input', maxlength: '120', placeholder: origin.detail.placeholder, autocomplete: 'off' });
            detailInput.addEventListener('input', refresh);
          }
          detailWrap.appendChild(detailInput);
        }
        if (origin) status.textContent = '';
        refresh();
        if (origin && !(origin.detail && origin.detail.kind === 'list')) {
          track(context, ['origen', ...originTrackingSegments(originSelect.value, '')]);
        }
      });
      textarea.addEventListener('input', refresh);

      sendLink.addEventListener('click', (e) => {
        if (!findOrigin(originSelect.value)) {
          e.preventDefault();
          status.textContent = 'Elige antes de dónde has sacado el archivo: es lo que más nos ayuda a arreglarlo.';
          try { originSelect.focus(); } catch (_) {}
          return;
        }
        track(context, ['enviar', ...originTrackingSegments(originSelect.value, currentDetail())]);
        status.textContent = '¡Gracias! Si no se ha abierto tu correo, pulsa «Copiar texto» y mándalo a hola@luzfija.es.';
      });
      copyBtn.addEventListener('click', () => {
        copyText(fullText(), textarea).then((ok) => {
          status.textContent = ok
            ? 'Texto copiado. Pégalo en un correo a hola@luzfija.es (y adjunta el archivo si puedes).'
            : 'No se pudo copiar automáticamente: selecciona el texto del cuadro y cópialo a mano.';
        });
        track(context, ['copiar', ...originTrackingSegments(originSelect.value, currentDetail())]);
      });
      laterBtn.addEventListener('click', () => {
        track(context, ['cerrado']);
        dismiss(context);
      });

      refresh();
      const signaturePromise = (file && typeof window.LF?.csvUtils?.csvFormatSignatureFromFile === 'function')
        ? window.LF.csvUtils.csvFormatSignatureFromFile(file).catch(() => null)
        : Promise.resolve(null);
      Promise.all([buildFileSample(file).catch(() => null), signaturePromise]).then(([sample, signature]) => {
        if (!panel.isConnected) return;
        // Si el usuario ya ha empezado a editar, no se le pisa el texto.
        if (textarea.value !== 'Preparando la muestra del archivo…') return;
        textarea.value = buildReportText({
          context, ext, size: file && file.size, errorCode, userMessage, technical, signature, sample
        });
        refresh();
      });
    }

    if (!placePanel(panel, opts)) return null;
    track(context, ['mostrado', errorCode]);
    try {
      if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      title.focus({ preventScroll: true });
    } catch (_) {}
    return panel;
  }

  window.LF = window.LF || {};
  window.LF.csvReport = {
    REPORT_EMAIL,
    ORIGINS,
    showImportError,
    dismiss,
    // Puras, exportadas para tests
    splitImportErrorMessage,
    userHintFor,
    shouldOfferReport,
    anonymizeSampleText,
    decodeSampleBytes,
    buildFileSample,
    buildReportText,
    buildMailtoHref,
    originTrackingSegments,
    describeOrigin
  };
})();
