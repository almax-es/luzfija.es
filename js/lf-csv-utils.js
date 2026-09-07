/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: CSV Utilities =====
// Biblioteca común para parsing robusto de archivos CSV de distribuidoras eléctricas
// Funciones puras sin dependencias externas, reutilizables por múltiples importadores

(function() {
  'use strict';

  const DEFAULT_FETCH_TIMEOUT_MS = 15000;

  /**
   * Ejecuta fetch con un deadline finito sin cambiar la política de HTTP/reintentos
   * del consumidor. Si el caller aporta signal, su cancelación también se propaga.
   * @param {RequestInfo|URL} resource - Recurso solicitado
   * @param {RequestInit} options - Opciones nativas de fetch
   * @param {number} timeoutMs - Timeout en milisegundos
   * @returns {Promise<Response>} Respuesta nativa de fetch
   */
  function fetchWithTimeout(resource, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const init = options && typeof options === 'object' ? options : {};
    const parsedTimeout = Number(timeoutMs);
    const effectiveTimeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const externalSignal = init.signal;
    let externalAbortHandler = null;

    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
      externalAbortHandler = () => controller.abort();
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
    return Promise.resolve()
      .then(() => fetch(resource, { ...init, signal: controller.signal }))
      .finally(() => {
        clearTimeout(timeoutId);
        if (externalAbortHandler && typeof externalSignal?.removeEventListener === 'function') {
          externalSignal.removeEventListener('abort', externalAbortHandler);
        }
      });
  }

  /**
   * Variante para JSON estático: el deadline cubre también la lectura/parsing del body.
   * `fetch()` puede resolver al recibir headers y dejar `response.json()` pendiente si la
   * respuesta queda cortada a medias; limpiar el timer en ese punto dejaría el loader colgado.
   * Para HTTP no-2xx no se consume el cuerpo: el caller conserva la Response para decidir
   * su política de fallback/reintento.
   * @returns {Promise<{response: Response, data: any}>}
   */
  async function fetchJsonWithTimeout(resource, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const init = options && typeof options === 'object' ? options : {};
    const parsedTimeout = Number(timeoutMs);
    const effectiveTimeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const externalSignal = init.signal;
    let externalAbortHandler = null;

    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
      externalAbortHandler = () => controller.abort();
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
      const response = await fetch(resource, { ...init, signal: controller.signal });
      if (!response || !response.ok) return { response, data: null };
      const data = await response.json();
      return { response, data };
    } finally {
      clearTimeout(timeoutId);
      if (externalAbortHandler && typeof externalSignal?.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  // ===== NORMALIZACIÓN DE VALORES =====

  /**
   * Elimina BOM (Byte Order Mark) UTF-8 y espacios en blanco.
   * Muchas distribuidoras exportan CSV con BOM invisible que rompe el parseo.
   * @param {*} value - Valor a normalizar
   * @returns {string} Valor sin BOM y sin espacios en los extremos
   */
  function stripBomAndTrim(value) {
    return String(value ?? '').replace(/^\uFEFF/, '').trim();
  }

  /**
   * Elimina comillas exteriores (simples o dobles) de un valor.
   * Respeta comillas internas y solo elimina el par exterior.
   * @param {*} value - Valor potencialmente entrecomillado
   * @returns {string} Valor sin comillas exteriores
   */
  function stripOuterQuotes(value) {
    let str = stripBomAndTrim(value);
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1).trim();
    }
    return str;
  }

  /**
   * Parsea un número de forma flexible, manejando formatos ES y US.
   * Soporta: "1.234,56" (ES), "1,234.56" (US), "1234.56", "1234,56"
   * E-REDES (Portugal) exporta números entrecomillados con coma decimal.
   * @param {*} value - Valor a parsear
   * @returns {number} Número parseado o NaN si inválido
   */
  function parseNumberFlexibleCSV(value) {
    const raw = stripOuterQuotes(value);
    if (!raw) return NaN;

    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    let norm = raw;

    // Maneja 1.234,56 (ES) y 1,234.56 (US)
    if (hasComma && hasDot) {
      if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
        // Formato ES: 1.234,56 -> 1234.56
        norm = raw.replace(/\./g, '').replace(',', '.');
      } else {
        // Formato US: 1,234.56 -> 1234.56
        norm = raw.replace(/,/g, '');
      }
    } else if (hasComma && !hasDot) {
      // Solo coma: asumimos decimal ES
      norm = raw.replace(',', '.');
    }

    return Number(norm);
  }

  // ===== PARSING ROBUSTO DE CSV =====

  /**
   * Parsea una línea CSV respetando campos entrecomillados y comillas escapadas.
   * Implementa un autómata de estados finitos para manejo correcto de:
   * - Campos con comillas: "Nombre, Apellido"
   * - Comillas escapadas: "Valor con ""comillas"" internas"
   * - Separadores dentro de campos entrecomillados
   *
   * @param {string} line - Línea CSV a parsear
   * @param {string} separator - Separador a usar (';' o ',')
   * @returns {string[]} Array de valores parseados
   *
   * @example
   * splitCSVLine('12345;"01/01/2024";1;"1,234";R', ';')
   * // => ['12345', '01/01/2024', '1', '1,234', 'R']
   */
  function splitCSVLine(line, separator) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    const s = String(line ?? '');

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (ch === '"') {
        if (inQuotes && s[i + 1] === '"') {
          // Comilla escapada: "" dentro de un campo entrecomillado
          cur += '"';
          i++;
          continue;
        }
        // Toggle estado entrecomillado
        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && ch === separator) {
        // Separador fuera de comillas: fin de campo
        out.push(cur);
        cur = '';
        continue;
      }

      // Carácter normal
      cur += ch;
    }

    // Añadir último campo
    out.push(cur);
    return out;
  }

  /**
   * Detecta automáticamente el separador CSV (';' o ',') basándose en la cabecera.
   * Cuenta ocurrencias de cada separador y elige el más frecuente.
   * Evita falsos positivos con decimales usando la cabecera (que no tiene números).
   *
   * @param {string} headerLine - Primera línea del CSV (cabecera)
   * @returns {string} ';' o ',' según el separador detectado
   *
   * @example
   * detectCSVSeparator('CUPS;Fecha;Hora;Consumo') // => ';'
   * detectCSVSeparator('CUPS,Date,Hour,Consumption') // => ','
   */
  function detectCSVSeparator(headerLine) {
    const semi = (headerLine.match(/;/g) || []).length;
    const comma = (headerLine.match(/,/g) || []).length;

    // Si no hay ninguno, asumir punto y coma (formato español estándar)
    if (semi === 0 && comma === 0) return ';';

    return semi >= comma ? ';' : ',';
  }

  // ===== PARSING DE FECHAS =====

  function makeStrictDate(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getFullYear() !== y ||
      dt.getMonth() !== mo - 1 ||
      dt.getDate() !== d
    ) {
      return null;
    }
    return dt;
  }

  /**
   * Parsea una fecha de forma flexible aceptando múltiples formatos.
   * Formatos soportados:
   * - dd/mm/yyyy, dd-mm-yyyy (formato español)
   * - yyyy/mm/dd, yyyy-mm-dd (formato ISO)
   * - Objetos Date nativos (pass-through)
   * - Ignora componente hora si existe ("01/01/2024 00:00")
   *
   * @param {*} value - Valor a parsear como fecha
   * @returns {Date|null} Objeto Date o null si inválido
   *
   * @example
   * parseDateFlexible('01/01/2024') // => Date(2024, 0, 1)
   * parseDateFlexible('2024-01-01') // => Date(2024, 0, 1)
   * parseDateFlexible('01/01/2024 00:00') // => Date(2024, 0, 1) (ignora hora)
   */
  function parseDateFlexible(value) {
    // Si ya es un Date válido, retornarlo
    if (value instanceof Date && !isNaN(value.getTime())) return value;

    const str = String(value ?? '').trim();
    if (!str) return null;

    // Ignorar hora si existe (tomar solo la parte de fecha; separa por espacio o T de ISO 8601)
    const firstToken = str.split(/[T\s]/)[0];

    // Formato Datadis mensual: YYYY/MM (sin día; devuelve día 1 del mes)
    const matchYMOnly = firstToken.match(/^(\d{4})\/(\d{2})$/);
    if (matchYMOnly) {
      return makeStrictDate(Number(matchYMOnly[1]), Number(matchYMOnly[2]), 1);
    }

    // Formato: dd/mm/yyyy o dd-mm-yyyy
    let match = firstToken.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) {
      return makeStrictDate(Number(match[3]), Number(match[2]), Number(match[1]));
    }

    // Formato: yyyy/mm/dd o yyyy-mm-dd
    match = firstToken.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (match) {
      return makeStrictDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    // Último recurso: Date.parse (depende del navegador)
    const dt = new Date(firstToken);
    return isNaN(dt.getTime()) ? null : dt;
  }

  /**
   * Parsea un número de forma flexible (alias sin sufijo CSV, para Excel).
   * @param {*} value - Valor a parsear
   * @returns {number} Número parseado o NaN si inválido
   */
  function parseNumberFlexible(value) {
    if (typeof value === 'number') return value;

    const str = String(value ?? '').trim();
    if (!str) return NaN;

    const hasComma = str.includes(',');
    const hasDot = str.includes('.');
    let norm = str;

    if (hasComma && hasDot) {
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        norm = str.replace(/\./g, '').replace(',', '.');
      } else {
        norm = str.replace(/,/g, '');
      }
    } else if (hasComma && !hasDot) {
      norm = str.replace(',', '.');
    }

    return Number(norm);
  }

  // ===== NORMALIZACIÓN DE CABECERAS Y COLUMNAS =====

  const HEADER_ALIASES = {
    fecha: [
      'fecha', 'date', 'dia', 'fecha_lectura', 'fecha_consumo', 'dia_lectura'
    ],
    // Solo alias INEQUIVOCOS de hora. Los nombres que pueden significar tanto la hora
    // del dia como el periodo tarifario viven en HORA_PERIODO_AMBIGUOUS y se clasifican
    // mirando sus valores, no su nombre (ver classifyHourPeriodColumns).
    hora: [
      'hora', 'hour', 'hora_intervalo'
    ],
    fechaHora: [
      'fecha_hora', 'fechahora', 'fecha_y_hora', 'fecha_hora_lectura', 'fecha_hora_consumo',
      'fecha_hora_inicio', 'fecha_hora_fin', 'fecha_horaria', 'timestamp', 'datetime'
    ],
    importacion: [
      'ae_kwh', 'consumo_kwh', 'energia_consumida_kwh', 'energia_consumo_kwh',
      'import_kwh', 'importacion_kwh', 'energia_importada_kwh', 'consumo_wh',
      'energia_consumida_wh', 'energia_consumo_wh', 'consumo_energia_kwh', 'consumo_energia_wh',
      // UFD (España): EHCR (kWh) = energía horaria consumida / importación
      'ehcr_kwh', 'ehcr'
    ],
    exportacion: [
      'as_kwh', 'energia_vertida_kwh', 'vertido_kwh', 'export_kwh', 'exportacion_kwh',
      'inyeccion_kwh', 'energia_exportada_kwh', 'energia_excedente_kwh', 'excedente_kwh',
      'generacion_wh', 'generacion_kwh', 'energia_vertida_wh', 'as_wh',
      // UFD (España): EHEX (kWh) = energía horaria excedentaria / exportación
      'ehex_kwh', 'ehex'
    ],
    autoconsumo: [
      'ae_autocons_kwh', 'energia_autoconsumida_kwh', 'autoconsumo_kwh', 'autoconsumo_wh'
    ],
    realEstimado: [
      'real_estimado', 'metodo_obtencion', 'metodoobtencion', 'real_estimada'
    ],
    // Solo alias INEQUIVOCOS de periodo tarifario.
    periodo: [
      'periodo_tarifario', 'periodo_tarifa'
    ],
    invVer: [
      'inv_ver', 'invver', 'invierno_verano'
    ]
  };

  // Nombres que en la practica designan tanto la hora del dia (1..24) como el periodo
  // tarifario (P1/P2/P3). Antes estaban todos en HEADER_ALIASES.hora, lo que provocaba
  // dos fallos: un fichero con "Hora" Y "Periodo" se rechazaba por ambiguedad, y un
  // fichero con solo "Periodo" con valores P1/P2/P3 se importaba fabricando las horas
  // 1, 2 y 3 (extractHourNumber extrae el digito de "P1").
  const HORA_PERIODO_AMBIGUOUS = [
    'periodo', 'period', 'periodo_horario', 'tramo', 'intervalo'
  ];

  // Terminos que delatan una columna de energia solar (excedentes, vertido, generacion).
  // Se usan para el centinela de columnas sin mapear, nunca para mapear automaticamente:
  // ninguno de ellos indica por si mismo direccion ni unidad.
  // Direccionales FUERTES: por si solos ya designan energia que sale de la instalacion.
  const SOLAR_STRONG_TOKENS = [
    'vertid', 'excedent', 'inyec', 'injec', 'volcad', 'feed_in'
  ];

  // Indicadores de GENERACION: aparecen tambien en columnas que no son energia
  // ('id_generador', 'numero_de_generadores', 'rendimiento_generador', 'producto'...),
  // asi que exigen ademas un marcador de energia en el mismo nombre. Generacion no
  // equivale a vertido: si ya hay una exportacion mapeada, estas columnas son auxiliares.
  // Se usa el lexema 'genera' y no 'generac' porque este ultimo no casa con
  // 'energia_generada_kwh', que es un nombre real de Datadis.
  const SOLAR_GENERATION_TOKENS = ['genera', 'produc'];

  // Formas de exportacion que, como TOKEN COMPLETO, si expresan direccion aunque la
  // cabecera no declare unidad. Esto conserva cabeceras reales como "Exportacion total"
  // sin volver a aceptar metadatos como "Export when".
  const SOLAR_EXPORT_DIRECTION_TOKENS = [
    'exportacion', 'exportaciones',
    'exportado', 'exportada', 'exportados', 'exportadas',
    'exported'
  ];

  // Contexto energetico. Se compara por TOKEN COMPLETO (el nombre normalizado se parte por
  // '_'), no por subcadena: con subcadena, 'wh' casaba dentro de 'wholesale' y de 'when',
  // y disparaba el centinela con 'producto_wholesale' o 'export_when'.
  // NO incluye 'kw': es potencia, no energia ('capacidad_generador_kw' no es una columna
  // de excedentes). Incluye 'energy' para cabeceras en ingles.
  const SOLAR_ENERGY_CONTEXT_TOKENS = ['kwh', 'wh', 'energia', 'energy'];

  function hasEnergyContext(header) {
    const parts = String(header || '').split('_');
    return parts.some(part => SOLAR_ENERGY_CONTEXT_TOKENS.includes(part));
  }

  function hasExplicitExportDirection(header) {
    const parts = String(header || '').split('_').filter(Boolean);
    if (parts.some(part => SOLAR_EXPORT_DIRECTION_TOKENS.includes(part))) return true;
    // En ingles, "Export total" es direccional; "Export when" no lo es.
    return parts.includes('export') && parts.includes('total');
  }

  // Compuestos del tipo "energia entregada a la red". No se pueden expresar como una sola
  // subcadena: normalizado queda 'energia_entregada_a_la_red', que NO contiene
  // 'entregad_a_red'. Se comprueban en dos componentes: raiz + 'red'.
  const SOLAR_RED_ROOT_TOKENS = ['entregad', 'cedid', 'devuelt'];

  // Terminos de metadato que tienen PRECEDENCIA sobre los direccionales: "Potencia de
  // generacion" o "Precio excedentes" casan con un token direccional pero no son energia.
  // Los textuales ('observacion', 'nota'...) evitan que una columna de texto con algun
  // codigo numerico suelto dispare el centinela.
  // OJO: 'id' NO puede estar en esta lista. Como la comparacion es por substring,
  // excluiria 'energia_vertida_kwh' y 'excedentes_vertidos_kwh' ("vertida"/"vertidos"
  // contienen "id") y dejaria el centinela inservible.
  const SOLAR_METADATA_TOKENS = [
    'precio', 'coste', 'tarifa', 'potencia', 'porcentaje', 'coeficiente',
    'tipo', 'codigo', 'estado', 'modalidad',
    'observacion', 'comentario', 'descripcion', 'incidencia', 'nota'
  ];

  // Metadato por TOKEN COMPLETO. Aqui caben terminos cortos o ingleses que serian
  // peligrosos como subcadena: por ejemplo, 'rate' aparece dentro de 'generated'.
  const SOLAR_METADATA_EXACT_TOKENS = [
    'id', 'numero', 'number', 'count', 'fecha', 'date', 'hora', 'time', 'when',
    'price', 'cost', 'rate', 'tariff', 'power', 'percentage', 'coefficient',
    'type', 'code', 'status', 'mode', 'comment', 'comments', 'description',
    'note', 'notes'
  ];

  function isSolarMetadataHeader(header) {
    if (!header) return false;
    const parts = String(header).split('_').filter(Boolean);
    return SOLAR_METADATA_TOKENS.some(token => header.includes(token))
      || parts.some(token => SOLAR_METADATA_EXACT_TOKENS.includes(token));
  }

  // True si la cabecera representa una medida alternativa de EXPORTACION. Esta distincion
  // evita bloquear formatos Datadis validos que incluyen a la vez energia vertida (mapeada)
  // y energia generada (magnitud auxiliar, no otra columna de excedentes).
  function looksLikeSolarExportHeader(header) {
    if (!header || isSolarMetadataHeader(header)) return false;
    if (SOLAR_STRONG_TOKENS.some(token => header.includes(token))) return true;
    if (header.includes('red') && SOLAR_RED_ROOT_TOKENS.some(token => header.includes(token))) return true;
    if (hasExplicitExportDirection(header)) return true;
    return header.includes('export') && hasEnergyContext(header);
  }

  // True si el nombre sugiere cualquier energia solar sin mapear. Cuando no existe una
  // exportacion reconocida, la presencia de generacion/produccion tambien es relevante:
  // indica que el fichero es solar y no debe simularse con excedentes cero en silencio.
  function looksLikeSolarEnergyHeader(header) {
    if (looksLikeSolarExportHeader(header)) return true;
    if (!header || isSolarMetadataHeader(header)) return false;
    return SOLAR_GENERATION_TOKENS.some(token => header.includes(token))
      && hasEnergyContext(header);
  }

  // Subconjunto de cabeceras solares que el parser alternativo del observatorio puede
  // interpretar con seguridad COMO EXCEDENTES. Generacion, inyeccion o energia entregada
  // siguen siendo sospechosas, pero no se convierten automaticamente en exportacion.
  function canFallbackMapSolarAsExport(header) {
    if (!looksLikeSolarEnergyHeader(header)) return false;
    if (header.startsWith('ehex')) return true;
    if (header.includes('excedent') || header.includes('vertid')) return true;
    if (hasExplicitExportDirection(header)) return true;
    return header.includes('export') && hasEnergyContext(header);
  }

  // Mensaje unico del centinela. Vive aqui porque la regla de taxonomia
  // ('columna-solar' en csvErrorCodeForTracking) casa contra su texto, asi que no puede
  // haber dos redacciones distintas repartidas por los consumidores.
  function buildUnmappedSolarError(columns, headersNorm, options = {}) {
    const lista = (columns || []).map(h => `"${h}"`).join(', ');
    const sujeto = (columns || []).length === 1
      ? 'una columna que parece representar'
      : 'columnas que parecen representar';
    return buildHeaderError(
      `El archivo contiene ${sujeto} energía solar (${lista}), pero no se reconoce con seguridad. No se importará como cero.`,
      headersNorm || [],
      options
    );
  }

  const SUPPORT_MESSAGE = [
    'Si tu archivo no se importa, escribe a hola@luzfija.es indicando:',
    '(1) tu distribuidora,',
    '(2) el archivo completo,',
    '(3) y al menos 5 líneas de ejemplo incluyendo cabecera.'
  ].join('\n');

  function normalizeHeaderName(value) {
    let str = stripBomAndTrim(value);
    if (!str) return '';

    // Convertir camelCase a snake_case
    str = str.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

    str = str.toLowerCase();
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    str = str.replace(/[^a-z0-9]+/g, '_');
    str = str.replace(/k_?w_?h/g, 'kwh');
    str = str.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

    return str;
  }

  function normalizeHeaders(headers) {
    return (headers || []).map(normalizeHeaderName);
  }

  // ===== DATADIS MENSUAL =====

  function isDatadisMonthlyFormat(headersNorm) {
    const set = new Set(headersNorm);
    return set.has('fecha')
      && set.has('valle') && set.has('llano') && set.has('punta')
      && (set.has('energia_vertida_kwh') || set.has('energia_generada_kwh') || set.has('energia_autoconsumida_kwh'));
  }

  function parseDatadisMonthlyRows(rows, options = {}) {
    const headerRowIndex = Number.isFinite(options.headerRowIndex) ? options.headerRowIndex : 0;
    const separator = options.separator || null;
    const parseNumber = options.parseNumber || parseNumberFlexible;
    const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

    const headerRow = rows[headerRowIndex];
    const headersNorm = normalizeHeaders(headerRow);

    const fechaIdx    = headersNorm.indexOf('fecha');
    const valleIdx    = headersNorm.indexOf('valle');
    const llanoIdx    = headersNorm.indexOf('llano');
    const puntaIdx    = headersNorm.indexOf('punta');
    const vertidaIdx  = headersNorm.indexOf('energia_vertida_kwh');
    const generadaIdx = headersNorm.indexOf('energia_generada_kwh');
    const autoIdx     = headersNorm.indexOf('energia_autoconsumida_kwh');

    if (fechaIdx === -1 || valleIdx === -1 || llanoIdx === -1 || puntaIdx === -1) {
      throw buildHeaderError(
        'Formato Datadis mensual: faltan columnas obligatorias (Fecha, Valle, Llano, Punta).',
        headersNorm, { separator }
      );
    }

    const missingSolar = [
      vertidaIdx  === -1 && 'Energia_vertida_kWh',
      generadaIdx === -1 && 'Energia_generada_kWh',
      autoIdx     === -1 && 'Energia_autoconsumida_kWh'
    ].filter(Boolean);
    if (missingSolar.length > 0) {
      throw buildHeaderError(
        `Formato Datadis mensual: para validar la generación solar se necesitan las tres columnas ` +
        `(${missingSolar.join(', ')}).`,
        headersNorm, { separator }
      );
    }

    const dataRows = rows.slice(headerRowIndex + 1);
    const records = [];
    const seenMonths = new Set();

    for (const row of dataRows) {
      if (!row || !Array.isArray(row)) continue;
      if (!row.some(cell => String(cell ?? '').trim() !== '')) continue;

      const fechaRaw = String(row[fechaIdx] ?? '').trim();
      if (!fechaRaw) {
        // La fila tiene contenido en otros campos pero falta la fecha → error
        throw buildHeaderError(
          `Formato Datadis mensual: se encontró una fila con datos pero sin fecha. ` +
          `El formato esperado es YYYY/MM (ej: 2025/01).`,
          headersNorm, { separator }
        );
      }
      const fecha = parseDateFlexible(fechaRaw);
      if (!fecha || isNaN(fecha.getTime())) {
        throw buildHeaderError(
          `Formato Datadis mensual: fecha no reconocida en una fila de datos ("${fechaRaw}"). ` +
          `El formato esperado es YYYY/MM (ej: 2025/01).`,
          headersNorm, { separator }
        );
      }

      const valle = parseNumber(row[valleIdx]);
      const llano = parseNumber(row[llanoIdx]);
      const punta = parseNumber(row[puntaIdx]);
      const valleInvalido = !Number.isFinite(valle) || valle < 0;
      const llanoInvalido = !Number.isFinite(llano) || llano < 0;
      const puntaInvalido = !Number.isFinite(punta) || punta < 0;
      if (valleInvalido || llanoInvalido || puntaInvalido) {
        const monthKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
        const badField = valleInvalido ? 'Valle' : llanoInvalido ? 'Llano' : 'Punta';
        const badIdx = valleInvalido ? valleIdx : llanoInvalido ? llanoIdx : puntaIdx;
        throw buildHeaderError(
          `Error en ${formatMonthYear(monthKey)}: el campo "${badField}" no contiene un número válido ` +
          `(valor: "${row[badIdx]}").`,
          headersNorm, { separator }
        );
      }

      const vert = parseNumber(row[vertidaIdx]);
      const gen  = parseNumber(row[generadaIdx]);
      const auto = parseNumber(row[autoIdx]);

      const monthKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

      if (!Number.isFinite(vert) || !Number.isFinite(gen) || !Number.isFinite(auto) ||
          vert < 0 || gen < 0 || auto < 0) {
        throw buildHeaderError(
          `Error en ${formatMonthYear(monthKey)}: los campos de generación solar contienen valores no numéricos o negativos ` +
          `(Vertida=${vert}, Generada=${gen}, Autoconsumida=${auto}).`,
          headersNorm, { separator }
        );
      }

      if (Math.abs(gen - (vert + auto)) > 0.05) {
        throw buildHeaderError(
          `Error en ${formatMonthYear(monthKey)}: Energia_generada (${r2(gen)} kWh) ≠ ` +
          `Energia_vertida (${r2(vert)} kWh) + Energia_autoconsumida (${r2(auto)} kWh).\n\n` +
          `Los datos de generación solar son inconsistentes. ` +
          `Descarga el archivo de nuevo o contacta con tu distribuidora.`,
          headersNorm, { separator }
        );
      }

      if (seenMonths.has(monthKey)) {
        throw buildImportError(
          `Hay un mes duplicado en el formato mensual de Datadis (${monthKey}). ` +
          'La importación se ha cancelado; no se ha incorporado ningún dato de este archivo. ' +
          'Revisa el archivo: probablemente se exportó o se pegó dos veces el mismo mes.',
          { headersNorm, separator }
        );
      }
      seenMonths.add(monthKey);

      records.push({ fecha, hora: 1,  kwh: r2(valle), excedente: 0,       autoconsumo: 0,       periodo: 'P3', esReal: true });
      records.push({ fecha, hora: 11, kwh: r2(llano), excedente: 0,       autoconsumo: 0,       periodo: 'P2', esReal: true });
      records.push({ fecha, hora: 12, kwh: r2(punta), excedente: r2(vert), autoconsumo: r2(auto), periodo: 'P1', esReal: true });
    }

    if (records.length === 0) {
      throw buildHeaderError(
        'Formato Datadis mensual: no se encontraron filas de datos válidas.',
        headersNorm, { separator }
      );
    }

    return {
      records,
      warnings: [],
      hasExcedenteColumn: true,
      hasAutoconsumoColumn: true,
      isDatadisMonthly: true
    };
  }

  function buildHeaderError(message, headersNorm, options = {}) {
    const headersList = headersNorm.length ? headersNorm.join(', ') : '(sin cabeceras)';
    const separatorLabel = options.separator ? `"${options.separator}"` : 'N/A';
    return new Error(
      `${message}\nSeparador detectado: ${separatorLabel}\n` +
      `Cabeceras normalizadas detectadas: ${headersList}\n${SUPPORT_MESSAGE}`
    );
  }

  function buildImportError(message, options = {}) {
    const headersNorm = Array.isArray(options.headersNorm) ? options.headersNorm : [];
    return buildHeaderError(message, headersNorm, { separator: options.separator || null });
  }

  // Techo defensivo antes de sheet_to_json(): un XLSX puede declarar un rango de hoja
  // (!ref) muy superior a sus celdas realmente ocupadas — el navegador confia en ese rango
  // declarado y puede intentar materializar un array acorde a el, consumiendo CPU/memoria
  // desproporcionados con un fichero pequeño en disco. Ningun consumo real (varios años de
  // datos horarios) se acerca a estos limites, generosos a proposito para no rechazar
  // exportaciones legitimas de distribuidoras.
  const MAX_XLSX_ROWS = 150000;
  const MAX_XLSX_CELLS = 2000000;

  function assertXlsxSheetWithinLimits(sheet, XLSXLib) {
    const ref = sheet && sheet['!ref'];
    if (!ref || !XLSXLib || typeof XLSXLib.utils?.decode_range !== 'function') return;
    const range = XLSXLib.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    if (rows > MAX_XLSX_ROWS || rows * cols > MAX_XLSX_CELLS) {
      throw buildImportError(
        `La hoja de cálculo declara unas dimensiones excesivas (${rows} filas × ${cols} columnas) para ser un consumo real. Revisa el archivo o exporta un rango más pequeño.`
      );
    }
  }


  // SheetJS no calcula fórmulas: solo puede devolver el valor cacheado que venga dentro del
  // XLSX. Si una fórmula de una columna económica/horaria no trae ese cache, sheet_to_json()
  // omite la celda y el parser compartido podría confundirla con "Sin dato" y convertirla a
  // 0 kWh. Se detecta ANTES del parser económico mirando la celda original de la hoja.
  //
  // El guard es deliberadamente selectivo: una fórmula sin cache en una columna de notas o
  // metadatos no invalida una curva que no usa esa columna. Las fórmulas con resultado cacheado
  // sí se conservan; no intentamos evaluarlas ni confiamos en el texto de la fórmula.
  function __LF_xlsxColumnIndexFromAddress(address) {
    const match = String(address || '').match(/^\$?([A-Z]+)\$?(\d+)$/i);
    if (!match) return null;
    let col = 0;
    const letters = match[1].toUpperCase();
    for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
    return { col: col - 1, row: Number(match[2]) - 1 };
  }

  function __LF_relevantXlsxColumns(rows, headerRowIndex, options = {}) {
    const headerRow = Array.isArray(rows?.[headerRowIndex]) ? rows[headerRowIndex] : [];
    const headersNorm = normalizeHeaders(headerRow);
    const relevant = new Set();

    if (options.format === 'matrix' || isHourlyMatrixHeaderRow(headerRow)) {
      const last = matrixHasH25Column(headerRow) ? 25 : 24;
      for (let c = 0; c <= last; c++) relevant.add(c);
      return relevant;
    }

    if (isDatadisMonthlyFormat(headersNorm)) {
      [
        'fecha', 'valle', 'llano', 'punta',
        'energia_vertida_kwh', 'energia_generada_kwh', 'energia_autoconsumida_kwh'
      ].forEach((name) => {
        const idx = headersNorm.indexOf(name);
        if (idx >= 0) relevant.add(idx);
      });
      return relevant;
    }

    try {
      const mapping = detectColumnMapping(headersNorm, {
        dataRows: Array.isArray(rows) ? rows.slice(headerRowIndex + 1) : []
      });
      [
        mapping.fechaIdx, mapping.horaIdx, mapping.fechaHoraIdx, mapping.importIdx,
        mapping.exportIdx, mapping.autoconsumoIdx, mapping.realEstimadoIdx,
        mapping.periodoIdx, mapping.invVerIdx
      ].forEach((idx) => {
        if (idx !== null && idx !== undefined) relevant.add(idx);
      });

      // El Observatorio admite un alias solar adicional mediante el centinela compartido.
      // Aunque una fórmula sin cache no aporte una muestra numérica y por eso el centinela no
      // pueda clasificarla por contenido, la cabecera sigue delatando una magnitud solar.
      headersNorm.forEach((header, idx) => {
        if (header && looksLikeSolarEnergyHeader(header)) relevant.add(idx);
      });
    } catch (_) {
      // El parser canónico emitirá después el diagnóstico de cabecera. No sustituimos ese
      // error por uno de fórmulas cuando todavía ni siquiera se sabe qué columnas son datos.
    }

    return relevant;
  }

  function assertRelevantXlsxFormulasResolved(sheet, rows, headerRowIndex, options = {}) {
    if (!sheet || typeof sheet !== 'object' || !Array.isArray(rows)) return;
    const relevant = __LF_relevantXlsxColumns(rows, headerRowIndex, options);
    if (!relevant.size) return;
    const headerRow = Array.isArray(rows[headerRowIndex]) ? rows[headerRowIndex] : [];

    for (const [address, cell] of Object.entries(sheet)) {
      if (!cell || typeof cell !== 'object' || !cell.f) continue;
      const pos = __LF_xlsxColumnIndexFromAddress(address);
      if (!pos || pos.row <= headerRowIndex || !relevant.has(pos.col)) continue;
      const unresolved = cell.t === 'e' || cell.t === 'z'
        || cell.v === undefined || cell.v === null
        || (typeof cell.v === 'number' && !Number.isFinite(cell.v));
      if (!unresolved) continue;

      const label = stripBomAndTrim(headerRow[pos.col]) || `columna ${pos.col + 1}`;
      throw buildImportError(
        `La hoja contiene una fórmula sin resultado calculado en "${label}" (fila ${pos.row + 1}). ` +
        'LuzFija no evalúa fórmulas de Excel: abre el archivo en tu hoja de cálculo, recalcula y guárdalo antes de importarlo.'
      );
    }
  }

  // Clasifica un mensaje de error de importación en un código estable para analítica.
  // Garantía de privacidad: solo devuelve slugs de esta lista fija, nunca texto del
  // archivo del usuario. Clasifica sobre la primera línea porque buildHeaderError
  // añade a todos los mensajes un sufijo con el separador y las cabeceras detectadas.
  function csvErrorCodeForTracking(message) {
    let firstLine = String(message ?? '').split('\n')[0].toLowerCase();
    try {
      firstLine = firstLine.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {}

    const rules = [
      ['archivo-grande',       ['demasiado grande']],
      ['excel-dimensiones-excesivas', ['dimensiones excesivas']],
      ['formato-no-soportado', ['formato no soportado']],
      ['sin-archivo',          ['no se ha seleccionado']],
      ['error-lectura',        ['error al leer el archivo', 'no se pudo cargar el parser']],
      ['archivo-vacio',        ['vacio o formato no reconocido', 'vacio o invalido']],
      // Estas dos van ANTES de 'datos-inconsistentes' a proposito: el mensaje del centinela
      // nombra la columna sospechosa y, si esa columna se llama 'energia_generada_kwh',
      // casaria con el fragmento 'energia_generada' de datos-inconsistentes. El diagnostico
      // util es que hay energia solar sin reconocer, no que los datos sean incoherentes.
      ['columna-solar',        ['parece representar energia solar', 'parecen representar energia solar']],
      ['agregado-por-periodo', ['agregado por periodo tarifario']],
      ['datos-inconsistentes', ['energia_generada', 'excedentes simultaneos']],
      // 'dia' sin tilde a proposito: firstLine ya paso por normalize('NFD') + strip de
      // diacriticos (linea 608), pero estos fragmentos de 'rules' NO se normalizan, asi que
      // un fragmento con tilde nunca haria match contra el mensaje ya normalizado.
      ['periodo-duplicado',    ['fecha y hora', 'dia duplicado en la matriz', 'mes duplicado en el formato mensual']],
      ['valor-invalido',       ['no contiene un numero valido', 'valores no numericos', 'fecha no reconocida', 'pero sin fecha']],
      ['columnas',             ['columna']],
      // Antes que el cajon 'cabecera': hasta 25/07/2026 estas dos causas caian en el mismo
      // slug (el mensaje de "la mayoria de filas" contiene "cabecera" Y "separador"), y en
      // GoatCounter no habia forma de distinguir un formato no reconocido de un separador mal
      // detectado. 'cabecera' se conserva como fallback legacy.
      ['filas-invalidas',      ['la mayoria de filas', 'matriz horaria tiene']],
      ['cabecera-no-detectada', ['no se pudo detectar la cabecera', 'no se encontro la fila de cabecera', 'no se encontro una cabecera valida']],
      ['cabecera',             ['cabecera', 'separador']],
      ['rango-fechas',         ['abarca', 'meses distintos', 'recorte a 12 meses', 'datos muy fragmentados', 'historico tiene un hueco']],
      ['sin-datos-validos',    ['datos validos', 'filas de datos validas', 'datos de consumo validos', 'registros validos', 'fechas validas']]
    ];

    for (const [code, fragments] of rules) {
      if (fragments.some(fragment => firstLine.includes(fragment))) return code;
    }
    return 'otro';
  }

  // Extensión segura para analítica: solo valores de una lista fija. Sin allowlist,
  // un nombre de archivo sin punto (split('.').pop() devuelve el nombre entero) o con
  // sufijo arbitrario viajaría como segmento del path del evento.
  function safeFileExtensionForTracking(fileName) {
    const parts = String(fileName ?? '').split('.');
    const ext = parts.length > 1 ? parts.pop().trim().toLowerCase() : '';
    return ['csv', 'xlsx', 'xls'].includes(ext) ? ext : 'desconocido';
  }

  // Celda sin dato: vacia o con uno de los marcadores literales que usan algunas
  // distribuidoras (UFD escribe "Sin dato" en vez de dejarla vacia).
  function isNoDataCellValue(value) {
    const s = stripOuterQuotes(value).trim().toLowerCase();
    if (!s) return true;
    if (s === 'sin dato' || s === 'sin datos') return true;
    if (s === 'n/a' || s === 'na') return true;
    if (s === '-' || s === '—') return true;
    if (s === 's/d' || s === 'sd') return true;
    if (s === 'null' || s === 'undefined') return true;
    return false;
  }

  function findHeaderMatches(headersNorm, aliases) {
    const aliasSet = new Set(aliases);
    const matches = [];
    headersNorm.forEach((header, idx) => {
      if (aliasSet.has(header)) matches.push(idx);
    });
    return matches;
  }

  function pickUniqueColumn(name, matches, headersNorm, required = true, options = {}) {
    if (matches.length > 1) {
      const candidates = matches.map(idx => headersNorm[idx]).join(', ');
      throw buildHeaderError(
        `Columna "${name}" ambigua: se encontraron ${matches.length} coincidencias. Candidatas: ${candidates}.`,
        headersNorm,
        options
      );
    }
    if (matches.length === 0) {
      if (required) {
        throw buildHeaderError(
          `No se identificó la columna obligatoria de "${name}".`,
          headersNorm,
          options
        );
      }
      return null;
    }
    return matches[0];
  }

  // Clasifica una columna ambigua (Periodo, Tramo, Intervalo...) mirando SUS VALORES.
  // Devuelve 'hora' | 'periodo' | 'desconocido'.
  // No se usa extractHourNumber a proposito: convertiria "P1" en 1 y volveriamos al
  // fallo original de fabricar horas a partir de etiquetas de periodo.
  // Interpreta un valor como numero de hora. Acepta el entero puro ("7", "07"), el entero
  // escrito con decimal cero ("7.0", "7,0") y la hora en punto ("07:00").
  // Devuelve null si no encaja: NO se usa extractHourNumber, que extraeria el 1 de "P1".
  function parseHourLikeValue(raw) {
    let m = /^(\d{1,2})$/.exec(raw);
    if (!m) m = /^(\d{1,2})[.,]0+$/.exec(raw);
    if (!m) m = /^(\d{1,2}):00(?::00)?$/.exec(raw);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return (n >= 0 && n <= 25) ? n : null;
  }

  function classifyAmbiguousColumn(dataRows, columnIdx, options = {}) {
    const maxSamples = Number.isFinite(options.maxSamples) ? options.maxSamples : 200;
    let hourLike = 0;
    let periodLike = 0;
    let significant = 0;
    let hasHourDiscriminator = false;

    for (const row of dataRows || []) {
      if (!Array.isArray(row)) continue;
      const raw = stripOuterQuotes(row[columnIdx]).trim();
      if (!raw || isNoDataCellValue(raw)) continue;
      significant++;
      if (significant > maxSamples) break;

      const hour = parseHourLikeValue(raw);
      if (hour !== null) {
        hourLike++;
        // Un 0 o un valor 4..25 no puede ser una etiqueta P1/P2/P3 disfrazada.
        if (hour === 0 || hour > 3) hasHourDiscriminator = true;
        continue;
      }
      if (mapPeriodoLabel(raw)) { periodLike++; continue; }
      // Valor significativo que no es ni hora ni periodo: la columna no es homogenea.
      return 'desconocido';
    }

    if (significant === 0) return 'desconocido';
    // Se exige que TODAS las muestras significativas sean de la misma clase.
    if (hourLike > 0 && periodLike > 0) return 'desconocido';
    if (periodLike > 0) return 'periodo';
    if (hourLike === 0) return 'desconocido';
    // Solo valores 1/2/3 (o un subconjunto) sin ningun discriminador horario: es
    // indistinguible de P1/P2/P3 escrito sin la P. Antes se tomaba por hora y un agregado
    // por periodos entraba como las horas 1, 2 y 3.
    if (!hasHourDiscriminator) return 'desconocido';
    return 'hora';
  }

  // Resuelve que columna hace de hora y cual de periodo tarifario.
  // Invariante: una misma columna NUNCA puede ocupar horaIdx y periodoIdx a la vez.
  function classifyHourPeriodColumns(headersNorm, dataRows, options = {}) {
    const horaMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.hora);
    const periodoMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.periodo);
    const ambiguousMatches = findHeaderMatches(headersNorm, HORA_PERIODO_AMBIGUOUS);
    const warnings = [];

    if (horaMatches.length > 1) {
      throw buildHeaderError(
        `Columna "hora" ambigua: se encontraron ${horaMatches.length} coincidencias. Candidatas: ${horaMatches.map(i => headersNorm[i]).join(', ')}.`,
        headersNorm,
        options
      );
    }
    if (periodoMatches.length > 1) {
      throw buildHeaderError(
        `Columna "periodo tarifario" ambigua: se encontraron ${periodoMatches.length} coincidencias. Candidatas: ${periodoMatches.map(i => headersNorm[i]).join(', ')}.`,
        headersNorm,
        options
      );
    }

    let horaIdx = horaMatches.length ? horaMatches[0] : null;
    let periodoIdx = periodoMatches.length ? periodoMatches[0] : null;

    for (const idx of ambiguousMatches) {
      const kind = classifyAmbiguousColumn(dataRows, idx, options);

      if (kind === 'periodo') {
        if (periodoIdx === null) periodoIdx = idx;
        continue;
      }

      if (kind === 'hora') {
        if (horaIdx === null) { horaIdx = idx; continue; }
        // Si la hora ya venia de un alias INEQUIVOCO, ese gana y la ambigua se ignora sin
        // riesgo: el periodo no se pierde, se recalcula desde fecha y hora.
        if (horaMatches.length) {
          warnings.push(`Se ignoró la columna "${headersNorm[idx]}": ya hay una columna de hora explícita ("${headersNorm[horaMatches[0]]}").`);
          continue;
        }
        // Dos columnas AMBIGUAS que las dos parecen hora: no hay forma de saber cual es la
        // buena, y elegir la primera en silencio es adivinar.
        throw buildHeaderError(
          `Hay dos columnas que podrían ser la hora ("${headersNorm[horaIdx]}" y "${headersNorm[idx]}") y ninguna se llama explícitamente "hora". No se puede decidir cuál usar.`,
          headersNorm,
          options
        );
      }

      // Contenido mixto o irreconocible: solo importa si nos hace falta para la hora.
      if (horaIdx === null && options.needsHora !== false) {
        throw buildHeaderError(
          `La columna "${headersNorm[idx]}" no se pudo interpretar ni como hora (0-25) ni como periodo tarifario (P1/P2/P3), y no hay ninguna columna de hora reconocible.`,
          headersNorm,
          options
        );
      }
    }

    // Nunca la misma columna en ambos papeles.
    if (horaIdx !== null && horaIdx === periodoIdx) periodoIdx = null;

    return { horaIdx, periodoIdx, warnings };
  }

  // Centinela de columnas de energia solar sin mapear. NO mapea nada: solo detecta que
  // el archivo trae energia solar que no hemos sabido reconocer, para no importarla como
  // cero en silencio. La politica (error o aviso) la decide el llamante.
  function detectUnmappedSolarColumns(headersNorm, mapping, dataRows, options = {}) {
    const parseNumber = options.parseNumber || parseNumberFlexible;
    const used = new Set(
      [
        mapping.fechaIdx, mapping.horaIdx, mapping.fechaHoraIdx, mapping.importIdx,
        mapping.exportIdx, mapping.autoconsumoIdx, mapping.realEstimadoIdx,
        mapping.periodoIdx, mapping.invVerIdx
      ].filter(idx => idx !== null && idx !== undefined)
    );

    const found = [];
    headersNorm.forEach((header, idx) => {
      if (used.has(idx) || !header) return;
      if (!looksLikeSolarEnergyHeader(header)) return;
      // Si ya existe una columna de excedentes mapeada, solo interesan otras medidas de
      // exportacion. Generacion/produccion son magnitudes distintas y legitimas (Datadis
      // incluye energia vertida + generada + autoconsumida en el mismo fichero).
      if (mapping.exportIdx !== null && !looksLikeSolarExportHeader(header)) return;

      // La columna tiene que traer numeros de verdad. Los marcadores conocidos de "sin
      // dato" se ignoran en el recuento: antes se exigia numeric === seen, y bastaba un
      // solo "Sin dato" en la columna para desactivar el centinela por completo.
      let numeric = 0;
      let significant = 0;
      for (const row of dataRows || []) {
        if (!Array.isArray(row)) continue;
        const raw = stripOuterQuotes(row[idx]).trim();
        if (!raw || isNoDataCellValue(raw)) continue;
        significant++;
        if (Number.isFinite(parseNumber(raw))) numeric++;
        if (significant >= 50) break;
      }
      if (significant === 0) return;
      // Umbral graduado. Si la cabecera ya trae unidad o contexto energetico ("Inyección a
      // red (kWh)"), es inequivocamente una columna de energia y basta UNA muestra
      // numerica: con el 80% fijo, una sola celda malformada entre cuatro bajaba al 75% y
      // desactivaba el centinela. Sin contexto energetico en el nombre se exige mayoria,
      // para que un codigo numerico suelto en una columna de texto no bloquee.
      const minRatio = hasEnergyContext(header) ? 0 : 0.8;
      // Se devuelve el INDICE ademas del nombre: un consumidor con parser alternativo
      // propio no puede unir por nombre, porque normaliza las cabeceras de otra forma.
      if (numeric > 0 && numeric / significant >= minRatio) {
        found.push({
          index: idx,
          header,
          fallbackExport: canFallbackMapSolarAsExport(header)
        });
      }
    });

    return found;
  }

  function detectColumnMapping(headersNorm, options = {}) {
    const fechaMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.fecha);
    const fechaHoraMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.fechaHora);

    if (fechaHoraMatches.length > 1) {
      throw buildHeaderError('Columna de fecha/hora ambigua: hay varias posibles.', headersNorm, options);
    }
    // La clasificacion hora/periodo mira los valores, asi que necesita las filas de datos.
    const dataRows = Array.isArray(options.dataRows) ? options.dataRows : [];
    const usaFechaHora = fechaHoraMatches.length === 1;
    const { horaIdx: horaResuelta, periodoIdx: periodoResuelto, warnings: horaWarnings } =
      classifyHourPeriodColumns(headersNorm, dataRows, { ...options, needsHora: !usaFechaHora });

    if (usaFechaHora && (fechaMatches.length || horaResuelta !== null)) {
      throw buildHeaderError(
        'No se puede decidir entre "fecha_hora" y columnas separadas de fecha/hora.',
        headersNorm,
        options
      );
    }

    const importMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.importacion);
    const exportMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.exportacion);
    const autoconsumoMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.autoconsumo);
    const realMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.realEstimado);
    const invVerMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.invVer);

    const fechaIdx = usaFechaHora ? null : pickUniqueColumn('fecha', fechaMatches, headersNorm, true, options);
    const fechaHoraIdx = usaFechaHora ? fechaHoraMatches[0] : null;
    const horaIdx = usaFechaHora ? null : horaResuelta;
    if (!usaFechaHora && horaIdx === null) {
      // Caso tipico: fichero agregado por periodo tarifario (P1/P2/P3) sin hora. Antes se
      // importaba fabricando las horas 1, 2 y 3 a partir del digito de la etiqueta.
      if (periodoResuelto !== null) {
        throw buildHeaderError(
          `El archivo está agregado por periodo tarifario ("${headersNorm[periodoResuelto]}" contiene P1/P2/P3) y no trae ninguna columna de hora. Se necesita una curva horaria para calcular; no se puede repartir un agregado por periodos entre las 24 horas.`,
          headersNorm,
          options
        );
      }
      throw buildHeaderError(
        'No se identificó la columna obligatoria de "hora".',
        headersNorm,
        options
      );
    }

    const importIdx = pickUniqueColumn('consumo/importación', importMatches, headersNorm, true, options);
    const exportIdx = pickUniqueColumn('excedente/exportación', exportMatches, headersNorm, false, options);
    const autoconsumoIdx = pickUniqueColumn('autoconsumo', autoconsumoMatches, headersNorm, false, options);
    const realEstimadoIdx = pickUniqueColumn('real/estimado', realMatches, headersNorm, false, options);
    const invVerIdx = pickUniqueColumn('INV/VER', invVerMatches, headersNorm, false, options);

    return {
      fechaIdx,
      horaIdx,
      fechaHoraIdx,
      importIdx,
      exportIdx,
      autoconsumoIdx,
      realEstimadoIdx,
      periodoIdx: periodoResuelto,
      invVerIdx,
      warnings: horaWarnings
    };
  }

  const HEADER_SCORE_TOKENS = new Set([
    'fecha', 'hora', 'ae', 'as', 'consumo', 'import', 'export', 'excedente',
    'vertida', 'vertido', 'generacion', 'metodo', 'real', 'estimado',
    'real_estimado', 'metodo_obtencion', 'energia', 'autoconsumo'
  ]);

  function scoreHeaderRow(headersNorm) {
    const aliasSet = new Set([
      ...HEADER_ALIASES.fecha,
      ...HEADER_ALIASES.hora,
      // Los ambiguos siguen puntuando para detectar la fila de cabecera: solo su
      // interpretacion (hora o periodo) se decide por contenido, no su relevancia.
      ...HORA_PERIODO_AMBIGUOUS,
      ...HEADER_ALIASES.fechaHora,
      ...HEADER_ALIASES.importacion,
      ...HEADER_ALIASES.exportacion,
      ...HEADER_ALIASES.autoconsumo,
      ...HEADER_ALIASES.realEstimado
    ]);

    let score = 0;
    let hasFecha = false;
    let hasEnergy = false;
    headersNorm.forEach((header) => {
      if (aliasSet.has(header)) score += 2;
      HEADER_SCORE_TOKENS.forEach((token) => {
        if (header.includes(token)) score += 1;
      });
      if (HEADER_ALIASES.fecha.includes(header) || HEADER_ALIASES.fechaHora.includes(header)) {
        hasFecha = true;
      }
      if (HEADER_ALIASES.importacion.includes(header) || HEADER_ALIASES.exportacion.includes(header)) {
        hasEnergy = true;
      }
    });
    return { score, hasFecha, hasEnergy };
  }

  // Ancho minimo de una fila de cabecera. Se admiten 2 columnas cuando son exactamente
  // fecha_hora + consumo: es un dataset completo y valido, y antes se rechazaba solo por
  // ancho aunque los dos alias fueran perfectos.
  function meetsMinColumns(headersNorm) {
    if (headersNorm.length >= 3) return true;
    if (headersNorm.length !== 2) return false;
    const hasFechaHora = headersNorm.some(h => HEADER_ALIASES.fechaHora.includes(h));
    const hasImport = headersNorm.some(h => HEADER_ALIASES.importacion.includes(h));
    return hasFechaHora && hasImport;
  }

  function detectHeaderRow(lines, separator, maxRows = 30) {
    const candidates = lines || [];
    let scanned = 0;
    let best = { score: -1, headersNorm: [] };
    for (let i = 0; i < candidates.length && scanned < maxRows; i++) {
      const line = candidates[i];
      if (!stripBomAndTrim(line)) continue;
      scanned++;
      const cols = splitCSVLine(line, separator);
      const headersNorm = normalizeHeaders(cols);
      const { score, hasFecha, hasEnergy } = scoreHeaderRow(headersNorm);
      if (score > best.score) best = { score, headersNorm };
      if (!meetsMinColumns(headersNorm)) continue;
      if (score >= 3 && hasFecha && hasEnergy) {
        return { index: i, headers: cols, headersNorm, bestCandidateNorm: headersNorm };
      }
    }
    return { index: -1, headers: [], headersNorm: [], bestCandidateNorm: best.headersNorm };
  }

  function detectCSVSeparatorFromLines(lines, maxRows = 30) {
    const separators = [';', ','];
    const scores = separators.map((separator) => {
      const result = detectHeaderRow(lines, separator, maxRows);
      return { separator, score: result.headersNorm.length ? scoreHeaderRow(result.headersNorm).score : 0 };
    });
    const best = scores.sort((a, b) => b.score - a.score)[0];
    if (best.score > 0) return best.separator;
    const firstNonEmpty = (lines || []).find(line => stripBomAndTrim(line));
    return detectCSVSeparator(stripBomAndTrim(firstNonEmpty || ''));
  }

  function extractHourNumber(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    const str = stripOuterQuotes(raw).trim();
    if (!str) return null;
    const match = str.match(/(\d{1,2})/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return Number.isFinite(num) ? num : null;
  }

  function mapPeriodoLabel(raw) {
    const p = String(raw ?? '').trim().toUpperCase();
    if (!p) return null;
    if (p.includes('PUNTA') || p === 'P1') return 'P1';
    if (p.includes('LLANO') || p === 'P2') return 'P2';
    if (p.includes('VALLE') || p === 'P3') return 'P3';
    return null;
  }

  function splitDateTime(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
      return { date, hour: value.getHours() };
    }
    const raw = stripOuterQuotes(value);
    if (!raw) return { date: null, hour: null };
    const match = raw.match(/(\d{1,2}):(\d{2})/);
    const timePart = match ? match[1] : null;
    const datePart = raw.split(/[ T]/)[0];
    const date = parseDateFlexible(datePart);
    const hour = timePart !== null ? parseInt(timePart, 10) : null;
    return { date, hour: Number.isFinite(hour) ? hour : null };
  }

  function getRowDateHour(row, mapping) {
    if (!row || !Array.isArray(row)) return { fecha: null, hourNum: null };
    if (mapping.fechaHoraIdx !== null && mapping.fechaHoraIdx !== undefined) {
      const dt = splitDateTime(row[mapping.fechaHoraIdx]);
      return { fecha: dt.date, hourNum: dt.hour };
    }
    return {
      fecha: parseDateFlexible(row[mapping.fechaIdx]),
      hourNum: extractHourNumber(row[mapping.horaIdx])
    };
  }

  function inferHourBaseFromPeriods(dataRows, mapping, zonaFiscal) {
    if (mapping.periodoIdx === null || mapping.periodoIdx === undefined) return null;

    let zeroMatches = 0;
    let cnmcMatches = 0;

    for (const row of dataRows || []) {
      const expected = mapPeriodoLabel(row && row[mapping.periodoIdx]);
      if (!expected) continue;

      const { fecha, hourNum } = getRowDateHour(row, mapping);
      if (!(fecha instanceof Date) || isNaN(fecha.getTime()) || !Number.isFinite(hourNum)) continue;

      if (hourNum >= 1 && hourNum <= 25) {
        if (getPeriodoHorarioCSV(fecha, hourNum, zonaFiscal) === expected) cnmcMatches++;
      }

      const zeroHour = hourNum + 1;
      if (zeroHour >= 1 && zeroHour <= 25) {
        if (getPeriodoHorarioCSV(fecha, zeroHour, zonaFiscal) === expected) zeroMatches++;
      }
    }

    if (zeroMatches === 0 && cnmcMatches === 0) return null;
    if (zeroMatches > cnmcMatches) return { base: 'zero', reason: 'periodMatch' };
    if (cnmcMatches > zeroMatches) return { base: 'cnmc', reason: 'periodMatch' };
    return null;
  }

  function detectHourBase(dataRows, mapping, options = {}) {
    const rows = dataRows || [];
    let foundZero = false;
    let found24 = false;
    let parsedHours = 0;
    for (const row of rows) {
      const { hourNum } = getRowDateHour(row, mapping);
      if (hourNum === null) continue;
      parsedHours++;
      if (hourNum === 0) foundZero = true;
      if (hourNum === 24 || hourNum === 25) found24 = true;
    }
    if (foundZero) return { base: 'zero', reason: 'explicitZero' };
    if (found24) return { base: 'cnmc', reason: 'explicitCnmc' };

    if (mapping.fechaHoraIdx !== null && mapping.fechaHoraIdx !== undefined) {
      // Una columna fecha_hora representa horas reales del reloj local.
      return { base: 'zero', reason: 'dateTimeColumn' };
    }

    const zonaFiscal = options.zonaFiscal ||
      (typeof window !== 'undefined' && window.LF?.getInputValues?.()?.zonaFiscal) ||
      'Península';
    // En Ceuta/Melilla no nos fiamos de la columna Periodo para inferir la base horaria: sus
    // limites de P1/P2/P3 estan desplazados respecto a Peninsula, asi que un CSV con periodos
    // calculados para otra zona puede casar por coincidencia con la interpretacion de hora
    // equivocada (0-23 vs 1-24) y desplazar todas las horas una posicion. Las senales fuertes
    // (hora 0 explicita, hora 24/25, columna fecha_hora) siguen aplicando igual arriba; solo se
    // omite esta inferencia debil basada en Periodo.
    const esCeutaMelilla = getCsvZoneProfiles(zonaFiscal).perfilPeriodos === 'ceuta-melilla';
    const inferredByPeriod = esCeutaMelilla ? null : inferHourBaseFromPeriods(rows, mapping, zonaFiscal);
    if (inferredByPeriod) return inferredByPeriod;

    if (parsedHours > 0) {
      return { base: 'cnmc', reason: 'ambiguousDefault' };
    }

    return { base: 'cnmc', reason: 'default' };
  }

  function isCanariasFiscalZone(zonaFiscal) {
    return String(zonaFiscal || '').trim() === '8742'
      || normalizeZonaFiscal(zonaFiscal).includes('canaria');
  }

  function getCsvZoneProfiles(zonaFiscal) {
    const geoId = String(zonaFiscal || '').trim();
    const zonaNorm = normalizeZonaFiscal(zonaFiscal);
    const isCeutaMelilla = geoId === '8744' || geoId === '8745'
      || (zonaNorm.includes('ceuta') && zonaNorm.includes('melilla'));
    return {
      zonaHoraria: isCanariasFiscalZone(zonaFiscal) ? 'canarias' : 'europa-madrid',
      perfilPeriodos: isCeutaMelilla ? 'ceuta-melilla' : 'general'
    };
  }

  function hasDstTransitionRecords(records) {
    return Array.isArray(records) && records.some((record) => {
      const fecha = record?.fecha;
      if (!(fecha instanceof Date) || isNaN(fecha.getTime()) || fecha.getDay() !== 0) return false;
      const month = fecha.getMonth();
      return (month === 2 || month === 9) && fecha.getDate() + 7 > 31;
    });
  }

  function detectCompressedSpringDates(dataRows, mapping, hourBase) {
    const compressedDates = new Set();
    if (hourBase !== 'cnmc' || mapping.fechaHoraIdx !== null) return compressedDates;

    const hoursByDate = new Map();
    for (const row of dataRows || []) {
      const { fecha, hourNum } = getRowDateHour(row, mapping);
      if (!esDiaCambioHorarioMarzo(fecha) || !Number.isInteger(hourNum)) continue;
      const key = ymdLocal(fecha);
      if (!hoursByDate.has(key)) hoursByDate.set(key, new Set());
      hoursByDate.get(key).add(hourNum);
    }

    hoursByDate.forEach((hours, key) => {
      const isSequentialCchCons = hours.size === 23
        && Array.from({ length: 23 }, (_, index) => index + 1).every(hour => hours.has(hour));
      if (isSequentialCchCons) compressedDates.add(key);
    });

    return compressedDates;
  }

  function buildHourResolver(mapping, hourBase, options = {}) {
    const seen = new Map();
    const zonaFiscal = options.zonaFiscal || 'Península';
    const repeatedClockHour = isCanariasFiscalZone(zonaFiscal) ? 1 : 2;
    const compressedSpringDates = options.compressedSpringDates instanceof Set
      ? options.compressedSpringDates
      : new Set();

    return function resolveHour(fecha, hourNum, invVerRaw) {
      if (!Number.isFinite(hourNum)) return null;
      if (hourBase === 'zero') {
        if (hourNum === repeatedClockHour && esDiaCambioHorarioOctubre(fecha)) {
          const key = `${ymdLocal(fecha)}|${String(repeatedClockHour).padStart(2, '0')}`;
          const count = (seen.get(key) || 0) + 1;
          seen.set(key, count);
          const inv = stripOuterQuotes(invVerRaw).trim();
          if (inv === '1') return repeatedClockHour + 1;
          if (inv === '0') return 25;
          return count >= 2 ? 25 : repeatedClockHour + 1;
        }
        return hourNum + 1;
      }

      if (compressedSpringDates.has(ymdLocal(fecha))) {
        const firstCompressedHour = repeatedClockHour + 1;
        return hourNum >= firstCompressedHour ? hourNum + 1 : hourNum;
      }
      return hourNum;
    };
  }

  function detectUnitFactor(headerNorm, sampleRows, columnIdx, parseNumber) {
    if (headerNorm.includes('kwh')) return { factor: 1, converted: false };
    if (headerNorm.includes('wh')) {
      return { factor: 0.001, converted: true };
    }

    const samples = [];
    for (let i = 0; i < sampleRows.length && samples.length < 20; i++) {
      const row = sampleRows[i];
      if (!row || !Array.isArray(row)) continue;
      const value = parseNumber(row[columnIdx]);
      if (Number.isFinite(value)) samples.push(value);
    }
    const max = samples.length ? Math.max(...samples) : 0;
    // Si el valor máximo es >= 100, es altamente probable que sean Wh (ej: 120Wh vs 0.12kWh)
    if (max >= 100) {
      return { factor: 0.001, converted: true };
    }
    return { factor: 1, converted: false };
  }

  function parseEnergyTableRows(rows, options = {}) {
    const parseNumber = options.parseNumber || parseNumberFlexible;
    const headerRowIndex = Number.isFinite(options.headerRowIndex) ? options.headerRowIndex : 0;
    const separator = options.separator || null;

    if (!Array.isArray(rows) || rows.length <= headerRowIndex) {
      throw buildHeaderError('Archivo vacío o formato no reconocido.', [], { separator });
    }

    const headerRow = rows[headerRowIndex];
    if (!Array.isArray(headerRow) || headerRow.length === 0) {
      throw buildHeaderError('No se encontró una cabecera válida en el archivo.', [], { separator });
    }

    const headersNorm = normalizeHeaders(headerRow);

    // Desvío: formato mensual Datadis — debe evaluarse antes de detectColumnMapping
    // porque Datadis no tiene columna 'importacion' y la función fallaría
    if (isDatadisMonthlyFormat(headersNorm)) {
      return parseDatadisMonthlyRows(rows, options);
    }

    const headersRaw = (headerRow || []).map(cell => stripBomAndTrim(cell));
    const dataRows = rows.slice(headerRowIndex + 1);
    const mapping = detectColumnMapping(headersNorm, { separator, dataRows });
    const warnings = [];
    const emptyCells = {
      import: 0,
      export: 0
    };

    if (Array.isArray(mapping.warnings)) warnings.push(...mapping.warnings);

    // Se revisan SIEMPRE las columnas no utilizadas, incluso cuando ya hay una exportacion
    // reconocida. De otro modo, AS_kWh podia ocultar una segunda "Inyeccion a red" y esta
    // quedaba fuera del calculo sin ningun diagnostico.
    let unmappedSolarFound = detectUnmappedSolarColumns(headersNorm, mapping, dataRows, { parseNumber });
    let mappedFallbackExportIdx = null;
    if (options.mapSafeFallbackSolarExport === true && mapping.exportIdx === null) {
      const fallbackCandidates = unmappedSolarFound.filter(c => c.fallbackExport);
      if (fallbackCandidates.length === 1) {
        mappedFallbackExportIdx = fallbackCandidates[0].index;
        mapping.exportIdx = mappedFallbackExportIdx;
        warnings.push('Importación XLSX: aplicado parser alternativo para excedentes.');
        // Recalcular el centinela con la columna ya consumida. Si queda otra exportación
        // sospechosa, el caller del Observatorio conserva su guard fail-closed.
        unmappedSolarFound = detectUnmappedSolarColumns(headersNorm, mapping, dataRows, { parseNumber });
      }
    }
    const unmappedSolarColumns = unmappedSolarFound.map(c => c.header);
    if (unmappedSolarColumns.length) {
      const policy = options.unmappedSolarPolicy === 'error' ? 'error' : 'warn';
      if (policy === 'error') {
        throw buildUnmappedSolarError(unmappedSolarColumns, headersNorm, { separator });
      }
      const lista = unmappedSolarColumns.map(h => `"${h}"`).join(', ');
      const referencia = unmappedSolarColumns.length === 1 ? 'esa columna' : 'esas columnas';
      warnings.push(`El archivo contiene ${lista}, que parece energía solar pero no se reconoce con seguridad; ${referencia} NO se ha usado en el cálculo.`);
    }
    if (mapping.exportIdx === null) {
      warnings.push('No se detectaron excedentes; se importará con excedentes=0.');
    }

    const zonaFiscal = options.zonaFiscal ||
      (typeof window !== 'undefined' && window.LF?.getInputValues?.()?.zonaFiscal) ||
      'Península';
    const esCeutaMelilla = getCsvZoneProfiles(zonaFiscal).perfilPeriodos === 'ceuta-melilla';
    const hourBaseInfo = detectHourBase(dataRows, mapping, { zonaFiscal });
    const hourBase = hourBaseInfo.base;
    const compressedSpringDates = detectCompressedSpringDates(dataRows, mapping, hourBase);
    if (hourBase === 'zero' && hourBaseInfo.reason === 'explicitZero') {
      warnings.push('Ajustado formato de hora (0-23 → 1-24).');
    } else if (hourBase === 'zero' && hourBaseInfo.reason === 'periodMatch') {
      warnings.push('Formato horario inferido como 0-23 por coherencia con el periodo tarifario.');
    } else if (hourBase === 'cnmc' && hourBaseInfo.reason === 'ambiguousDefault' && compressedSpringDates.size === 0) {
      warnings.push('Formato horario ambiguo: no hay señal suficiente para distinguir 0-23 de 1-24. Se conserva 1-24 (CNMC).');
    }
    if (compressedSpringDates.size > 0) {
      warnings.push('Ajustado cambio horario de marzo (CCH-CONS 1-23 → horas reales).');
    }

    const importRes = detectUnitFactor(headersNorm[mapping.importIdx], dataRows, mapping.importIdx, parseNumber);
    const exportRes = mapping.exportIdx !== null
      ? detectUnitFactor(headersNorm[mapping.exportIdx], dataRows, mapping.exportIdx, parseNumber)
      : { factor: 1, converted: false };
    const autoRes = mapping.autoconsumoIdx !== null
      ? detectUnitFactor(headersNorm[mapping.autoconsumoIdx], dataRows, mapping.autoconsumoIdx, parseNumber)
      : { factor: 1, converted: false };

    const importFactor = importRes.factor;
    const exportFactor = exportRes.factor;
    const autoconsumoFactor = autoRes.factor;

    if (importRes.converted || exportRes.converted || autoRes.converted) {
      const convertedFields = [];
      if (importRes.converted) convertedFields.push('consumo');
      if (exportRes.converted) convertedFields.push('excedentes');
      if (autoRes.converted) convertedFields.push('autoconsumo');
      warnings.push(`Valores en Wh detectados (${convertedFields.join(', ')}); convertidos a kWh.`);
    }

    const resolveHour = buildHourResolver(mapping, hourBase, { zonaFiscal, compressedSpringDates });
    const records = [];
    const seenDateHour = new Set();
    let totalRows = 0;
    let parsedRows = 0;
    let simultaneousCount = 0;
    let outOfRangeCount = 0;
    let h25DiscardedCount = 0;
    const threshold = 1e-6;

    const isEmptyCell = isNoDataCellValue;
    const columnLabel = (idx) => headersRaw[idx] || headersNorm[idx] || `columna ${idx + 1}`;

    for (const row of dataRows) {
      if (!row || !Array.isArray(row)) continue;
      const hasData = row.some(cell => String(cell ?? '').trim() !== '');
      if (!hasData) continue;
      totalRows++;

      const { fecha, hourNum } = getRowDateHour(row, mapping);

      if (!fecha || !Number.isFinite(hourNum)) continue;
      const hora = resolveHour(fecha, hourNum, mapping.invVerIdx !== null ? row[mapping.invVerIdx] : null);
      if (!Number.isFinite(hora) || hora < 1 || hora > 25) continue;
      // Igual que en la matriz H01..H25: la clave CNMC 25 solo existe el último
      // domingo de octubre. Aceptarla cualquier otro día crea una hora inexistente
      // que no puede cruzarse con PVPC y distorsiona la curva importada.
      if (hora === 25 && !esDiaCambioHorarioOctubre(fecha)) {
        h25DiscardedCount++;
        continue;
      }

      let importRaw = 0;
      if (mappedFallbackExportIdx === null) {
        importRaw = parseNumber(row[mapping.importIdx]);
        if (!Number.isFinite(importRaw)) {
          if (isEmptyCell(row[mapping.importIdx])) {
            importRaw = 0;
            emptyCells.import += 1;
          } else {
            continue;
          }
        }
        if (importRaw < 0) continue;
      }

      let exportRaw = 0;
      if (mapping.exportIdx !== null) {
        exportRaw = parseNumber(row[mapping.exportIdx]);
        if (!Number.isFinite(exportRaw)) {
          if (isEmptyCell(row[mapping.exportIdx])) {
            exportRaw = 0;
            emptyCells.export += 1;
          } else {
            continue;
          }
        }
        if (exportRaw < 0) continue;
      }

      let autoconsumoRaw = 0;
      if (mapping.autoconsumoIdx !== null) {
        const auto = parseNumber(row[mapping.autoconsumoIdx]);
        if (Number.isFinite(auto) && auto >= 0) autoconsumoRaw = auto;
      }

      const importKwh = importRaw * importFactor;
      const exportKwh = exportRaw * exportFactor;
      const autoconsumo = autoconsumoRaw * autoconsumoFactor;

      if (importKwh > 10000 || exportKwh > 10000) {
        outOfRangeCount++;
        continue;
      }

      if (importKwh > threshold && exportKwh > threshold) {
        simultaneousCount++;
      }

      // El alias solar adicional del Observatorio representa exportación ya medida, no
      // una lectura bidireccional que deba netearse contra el consumo. Se conserva la
      // semántica histórica de su fallback (kWh=0, excedente=exportación), pero ahora fecha,
      // hora, DST, unidades, duplicados y límites pasan por este parser canónico.
      const kwh = mappedFallbackExportIdx !== null ? 0 : Math.max(importKwh - exportKwh, 0);
      const excedente = mappedFallbackExportIdx !== null ? exportKwh : Math.max(exportKwh - importKwh, 0);

      let esReal = true;
      if (mapping.realEstimadoIdx !== null) {
        const estado = String(row[mapping.realEstimadoIdx] ?? '').trim().toLowerCase();
        esReal = estado.startsWith('real') || estado === 'r';
      }

      // Si el CSV trae columna de periodo, usarla
      // Si no, calcular automáticamente para evitar divergencias aguas abajo
      // EXCEPTO en Ceuta/Melilla: sus limites P1/P2/P3 estan desplazados respecto a Peninsula,
      // asi que una columna Periodo del fichero (calculada por la distribuidora con OTRA zona)
      // no es fiable aqui — se recalcula siempre por fecha/hora, igual que ya hace
      // bv-sim-monthly.js para el simulador solar. Esto mantiene home y BV de acuerdo.
      let periodo;
      if (mappedFallbackExportIdx !== null) {
        // El Observatorio no consume periodos tarifarios en este fallback; mantener null como
        // hacía la ruta anterior evita introducir una semántica nueva al eliminar el parser local.
        periodo = null;
      } else if (esCeutaMelilla) {
        periodo = getPeriodoHorarioCSV(fecha, hora, zonaFiscal);
      } else if (mapping.periodoIdx !== null) {
        periodo = mapPeriodoLabel(row[mapping.periodoIdx]);
      } else {
        // Calcular periodo automáticamente usando la función canónica
        // Obtener zona: priorizar options.zonaFiscal (BV), fallback a comparador principal
        periodo = getPeriodoHorarioCSV(fecha, hora, zonaFiscal);
      }

      const dateHourKey = `${ymdLocal(fecha)}|${hora}`;
      if (seenDateHour.has(dateHourKey)) {
        throw buildImportError(
          `Hay filas duplicadas para la misma fecha y hora (${ymdLocal(fecha)}, hora ${hora}). ` +
          'La importación se ha cancelado; no se ha incorporado ningún dato de este archivo. ' +
          'Revisa el archivo: probablemente se exportó o se pegó dos veces el mismo periodo.',
          { headersNorm, separator }
        );
      }
      seenDateHour.add(dateHourKey);

      records.push({
        fecha,
        hora,
        kwh,
        excedente,
        autoconsumo,
        periodo,
        esReal
      });
      parsedRows++;
    }

    if (totalRows > 0 && parsedRows / totalRows < 0.5) {
      throw buildHeaderError(
        'La mayoría de filas no se pudo interpretar; probable separador o cabecera incorrecta.',
        headersNorm,
        { separator }
      );
    }

    if (emptyCells.import > 0) {
      warnings.push(`Se encontraron ${emptyCells.import} celdas vacías o "Sin dato" en la columna ${columnLabel(mapping.importIdx)}; interpretadas como 0.`);
    }
    if (mapping.exportIdx !== null && emptyCells.export > 0) {
      warnings.push(`Se encontraron ${emptyCells.export} celdas vacías o "Sin dato" en la columna ${columnLabel(mapping.exportIdx)}; interpretadas como 0.`);
    }
    if (simultaneousCount > 0) {
      warnings.push(`Neteo horario aplicado en ${simultaneousCount} filas con consumo y excedentes simultáneos.`);
    }
    if (outOfRangeCount > 0) {
      warnings.push(`Se descartaron ${outOfRangeCount} filas con valores horarios superiores a 10.000 kWh.`);
    }
    if (h25DiscardedCount > 0) {
      warnings.push(`Se descartaron ${h25DiscardedCount} filas con hora 25 en días que no son el cambio de hora de octubre.`);
    }

    return {
      records,
      warnings,
      hasExcedenteColumn: mapping.exportIdx !== null,
      hasAutoconsumoColumn: mapping.autoconsumoIdx !== null,
      // Metadato estructurado para los consumidores que tienen su propio parser
      // alternativo: les permite distinguir "el fallback resolvio la columna" de
      // "nadie la resolvio y los excedentes van a quedar en cero".
      unmappedSolarColumns,
      // Indices en la MISMA fila de cabecera que ha recibido este parser. Es la unica clave
      // de union fiable para un consumidor que normaliza los nombres de otra manera.
      unmappedSolarIndices: unmappedSolarFound.map(c => c.index),
      // Subconjunto cuya semantica permite que el observatorio lo use como excedentes.
      // Evita que el consumidor mantenga una segunda heuristica de nombres divergente.
      unmappedSolarFallbackExportIndices: unmappedSolarFound
        .filter(c => c.fallbackExport)
        .map(c => c.index),
      headersNorm
    };
  }

  // ===== MATRIZ HORARIA (Fecha + H01..H24) =====
  // Implementacion unica para home y solar. Antes estaba duplicada en lf-csv-import.js y
  // bv/bv-import.js con politicas divergentes: la home convertia negativos a 0 y avisaba,
  // el solar los conservaba tal cual, y ninguna de las dos aplicaba el limite de 10.000 kWh
  // ni rechazaba una matriz entera de texto.
  function isHourlyMatrixHeaderRow(row) {
    if (!Array.isArray(row)) return false;
    for (let h = 1; h <= 24; h++) {
      const expected = `H${String(h).padStart(2, '0')}`;
      if (String(row[h] ?? '').trim().toUpperCase() !== expected) return false;
    }
    return true;
  }

  // El dia corto es el ULTIMO domingo de marzo. La hora local que desaparece depende
  // de la zona: 02:00 en Peninsula y 01:00 en Canarias.
  function esDiaCambioHorarioMarzo(fecha) {
    if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return false;
    if (fecha.getMonth() !== 2) return false; // 2 = marzo
    if (fecha.getDay() !== 0) return false;   // 0 = domingo
    return fecha.getDate() + 7 > 31;
  }

  // La hora 25 solo existe el dia en que termina el horario de verano: el ULTIMO domingo
  // de octubre. La hora repetida es 02:00 en Peninsula y 01:00 en Canarias.
  function esDiaCambioHorarioOctubre(fecha) {
    if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return false;
    if (fecha.getMonth() !== 9) return false; // 9 = octubre
    if (fecha.getDay() !== 0) return false;   // 0 = domingo
    // Ultimo domingo: no queda ningun otro domingo despues dentro de octubre.
    return fecha.getDate() + 7 > 31;
  }

  // Solo se acepta una columna de hora 25 si la cabecera la declara explicitamente como
  // H25. Sin esto, una columna final de "Total diario" entraba como consumo de la hora 25.
  function matrixHasH25Column(headerRow) {
    return Array.isArray(headerRow) && String(headerRow[25] ?? '').trim().toUpperCase() === 'H25';
  }

  // Ventana de 30 filas, igual que la deteccion tabular (antes eran 10, asi que un Excel
  // con mas de 10 lineas de preambulo fallaba aunque la matriz estuviera bien formada).
  function findHourlyMatrixHeaderRow(data, maxRows = 30) {
    const rows = data || [];
    const limit = Math.min(maxRows, rows.length);
    for (let i = 0; i < limit; i++) {
      if (isHourlyMatrixHeaderRow(rows[i])) return i;
    }
    return -1;
  }

  // options.computePeriodo:
  //   true  (por defecto) -> se calcula el periodo tarifario aqui. Es lo que necesita la home.
  //   false -> se deja `periodo: null`. Lo necesita el simulador solar, porque
  //            bucketizeByMonth RESPETA record.periodo si viene relleno (salvo Ceuta/Melilla),
  //            y a la hora de importar todavia no se conoce la zona definitiva.
  function parseHourlyMatrixRows(data, headerRowIndex, options = {}) {
    const parseNumber = options.parseNumber || parseNumberFlexible;
    const computePeriodo = options.computePeriodo !== false;
    const zonaFiscal = options.zonaFiscal
      || (typeof window !== 'undefined' && window.LF?.getInputValues?.()?.zonaFiscal)
      || 'Península';

    const records = [];
    const seenDates = new Set();
    const counters = { sinDato: 0, negativos: 0, fueraDeRango: 0, noNumericos: 0, h25Descartada: 0 };
    let nonEmptyCells = 0;
    let validCells = 0;

    // La hora 25 exige que la cabecera la declare. Antes se leia row[25] siempre que
    // trajera algo, asi que una columna final de "Total diario" se importaba como el
    // consumo de la hora 25, y ademas cualquier dia del año.
    const hasH25 = matrixHasH25Column(data[headerRowIndex]);
    const lastHour = hasH25 ? 25 : 24;

    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 2) continue;

      const fecha = parseDateFlexible(row[0]);
      if (!fecha) continue;

      const recordsBeforeRow = records.length;

      for (let h = 1; h <= lastHour; h++) {
        const raw = row[h];
        if (h === 25) {
          if (raw === undefined || raw === null || String(raw).trim() === '') continue;
          // Declarada en cabecera, pero la hora 25 solo existe el ultimo domingo de octubre.
          if (!esDiaCambioHorarioOctubre(fecha)) { counters.h25Descartada++; continue; }
        }

        const isEmpty = isNoDataCellValue(raw);
        if (!isEmpty) nonEmptyCells++;

        const kwh = parseNumber(raw);

        // Vacio o marcador conocido -> 0 con aviso. Conserva la hora en la curva.
        if (isEmpty) {
          if (h === 25) continue;
          counters.sinDato++;
          records.push(buildMatrixRecord(fecha, h, 0, zonaFiscal, computePeriodo));
          continue;
        }
        // Texto arbitrario -> se descarta la hora. No hay 0 defendible.
        if (!Number.isFinite(kwh)) {
          counters.noNumericos++;
          continue;
        }
        // Negativo -> se descarta la hora. El motor PVPC ya ignora las horas a 0
        // (js/pvpc.js hace Math.max(0, kwh) y salta si es 0), asi que convertirlo a 0 no
        // conservaria cobertura y en cambio ampliaria el rango de descarga de precios.
        if (kwh < 0) {
          counters.negativos++;
          continue;
        }
        if (kwh > 10000) {
          counters.fueraDeRango++;
          continue;
        }

        validCells++;
        records.push(buildMatrixRecord(fecha, h, kwh, zonaFiscal, computePeriodo));
      }

      // Una fecha solo cuenta como "vista" si la fila realmente aporto algun registro
      // importable: una fila con fecha valida pero todas sus horas descartadas (texto,
      // negativo, fuera de rango, H25 fuera de fecha) no debe bloquear como duplicada una
      // fila posterior valida del mismo dia.
      if (records.length > recordsBeforeRow) {
        const dateKey = ymdLocal(fecha);
        if (seenDates.has(dateKey)) {
          throw buildImportError(
            `Hay un día duplicado en la matriz horaria (${dateKey}). ` +
            'La importación se ha cancelado; no se ha incorporado ningún dato de este archivo. ' +
            'Revisa el archivo: probablemente se exportó o se pegó dos veces la misma fila.',
            { headersNorm: normalizeHeaders(data[headerRowIndex] || []) }
          );
        }
        seenDates.add(dateKey);
      }
    }

    const invalidCells = counters.negativos + counters.fueraDeRango + counters.noNumericos;

    if (validCells === 0) {
      // "filas invalidas" y no "cabecera no detectada": la cabecera H01..H24 SI se
      // reconocio, el problema esta en los datos.
      throw buildImportError(
        'La mayoría de filas no se pudo interpretar: la matriz horaria no contiene ningún valor numérico válido.',
        { headersNorm: normalizeHeaders(data[headerRowIndex] || []) }
      );
    }
    if (nonEmptyCells > 0 && invalidCells / nonEmptyCells >= 0.5) {
      throw buildImportError(
        `La matriz horaria tiene ${invalidCells} de ${nonEmptyCells} celdas con valores no interpretables; probable formato incorrecto.`,
        { headersNorm: normalizeHeaders(data[headerRowIndex] || []) }
      );
    }

    const warnings = ['No se detectaron excedentes; se importará con excedentes=0.'];
    if (counters.sinDato > 0) {
      warnings.push(`Se encontraron ${counters.sinDato} horas sin dato en la matriz; interpretadas como 0 kWh.`);
    }
    if (counters.noNumericos > 0) {
      warnings.push(`Se descartaron ${counters.noNumericos} horas con valores no numéricos.`);
    }
    if (counters.negativos > 0) {
      warnings.push(`Se descartaron ${counters.negativos} horas con consumo negativo.`);
    }
    if (counters.fueraDeRango > 0) {
      warnings.push(`Se descartaron ${counters.fueraDeRango} horas con valores superiores a 10.000 kWh.`);
    }
    if (counters.h25Descartada > 0) {
      warnings.push(`Se descartaron ${counters.h25Descartada} valores de la columna H25 en días que no son el cambio de hora de octubre.`);
    }

    return {
      records,
      warnings,
      hasExcedenteColumn: false,
      hasAutoconsumoColumn: false,
      matrixCounters: counters
    };
  }

  // Descartar una hora no desplaza las demas: cada registro lleva su `hora` explicita.
  function buildMatrixRecord(fecha, hora, kwh, zonaFiscal, computePeriodo) {
    return {
      fecha,
      hora, // H01 => 1 (00:00-01:00) ... H24 => 24 (23:00-24:00)
      kwh,
      excedente: 0,
      autoconsumo: 0,
      periodo: computePeriodo ? getPeriodoHorarioCSV(fecha, hora, zonaFiscal) : null,
      esReal: true
    };
  }

  function parseCSVToRows(fileContent) {
    const lines = String(fileContent || '').split(/\r?\n/);
    if (!lines.length) {
      throw buildHeaderError('CSV vacío o inválido.', [], { separator: null });
    }

    const separator = detectCSVSeparatorFromLines(lines, 30);
    const headerInfo = detectHeaderRow(lines, separator, 30);
    if (headerInfo.index === -1) {
      const fallbackLine = lines.find(line => stripBomAndTrim(line));
      const fallbackHeaders = fallbackLine ? normalizeHeaders(splitCSVLine(fallbackLine, separator)) : [];
      throw buildHeaderError(
        'No se pudo detectar la cabecera del CSV.',
        fallbackHeaders,
        { separator }
      );
    }

    const rows = [];
    const headerRow = splitCSVLine(lines[headerInfo.index], separator);
    const headerNorm = normalizeHeaders(headerRow);
    rows.push(headerRow);
    for (let i = headerInfo.index + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!stripBomAndTrim(line)) continue;
      const row = splitCSVLine(line, separator);
      const rowNorm = normalizeHeaders(row);
      const headerScore = scoreHeaderRow(rowNorm);
      if (rowNorm.length >= 3 && headerScore.score >= 3 && headerScore.hasFecha && headerScore.hasEnergy) {
        if (rowNorm.join('|') === headerNorm.join('|')) continue;
      }
      rows.push(row);
    }

    return { rows, separator, headerRowIndex: 0 };
  }

  function findEnergyHeaderRow(dataRows, maxRows = 30) {
    const candidates = dataRows || [];
    let scanned = 0;
    let best = { score: -1, headersNorm: [] };
    for (let i = 0; i < candidates.length && scanned < maxRows; i++) {
      const row = candidates[i];
      if (!row || !Array.isArray(row)) continue;
      const hasContent = row.some(cell => stripBomAndTrim(cell));
      if (!hasContent) continue;
      scanned++;
      const headersNorm = normalizeHeaders(row);
      const { score, hasFecha, hasEnergy } = scoreHeaderRow(headersNorm);
      if (score > best.score) best = { score, headersNorm };
      if (!meetsMinColumns(headersNorm)) continue;
      if (score >= 3 && hasFecha && hasEnergy) {
        return { index: i, headersNorm, bestCandidateNorm: headersNorm };
      }
    }
    return { index: -1, headersNorm: [], bestCandidateNorm: best.headersNorm };
  }

  function guessEnergyHeaderRow(dataRows, maxRows = 30) {
    return findEnergyHeaderRow(dataRows, maxRows).index;
  }

  // Mejor fila candidata a cabecera cuando la deteccion falla. Sirve para que el mensaje
  // de error local diga que columnas se vieron en vez de "(sin cabeceras)".
  // Nunca viaja a analitica: solo al mensaje que ve el usuario.
  function bestEnergyHeaderCandidate(dataRows, maxRows = 30) {
    return findEnergyHeaderRow(dataRows, maxRows).bestCandidateNorm;
  }

  // ===== FESTIVOS Y PERIODOS TARIFARIOS =====

  /**
   * Fuente única de los festivos nacionales españoles de fecha FIJA (MM-DD)
   * según CNMC Circular 3/2020 (BOE-A-2020-1066). EXCLUYE festivos móviles
   * (Viernes Santo, Corpus Christi). También se consume desde pvpc.js para
   * evitar divergencia entre el motor PVPC y la clasificación CSV.
   * @type {ReadonlySet<string>}
   */
  const FESTIVOS_NACIONALES_MMDD = Object.freeze(new Set([
    '01-01', // Año Nuevo
    '01-06', // Reyes
    '05-01', // Día del Trabajo
    '08-15', // Asunción
    '10-12', // Fiesta Nacional
    '11-01', // Todos los Santos
    '12-06', // Constitución
    '12-08', // Inmaculada
    '12-25'  // Navidad
  ]));

  /**
   * Comprueba si una cadena 'MM-DD' corresponde a un festivo nacional fijo.
   * Acepta solo strings de formato exacto 'MM-DD'; cualquier otra entrada
   * devuelve false (defensivo). Es la API pública compartida con pvpc.js.
   *
   * @param {string} mmdd - Cadena en formato 'MM-DD'
   * @returns {boolean}
   */
  function esFestivoNacionalMmdd(mmdd) {
    if (typeof mmdd !== 'string' || mmdd.length !== 5 || mmdd[2] !== '-') return false;
    return FESTIVOS_NACIONALES_MMDD.has(mmdd);
  }

  /**
   * Caché de festivos por año para optimizar cálculos repetidos.
   * Reduce complejidad de O(n) a O(1) para cada año único.
   * @type {Map<number, Set<string>>}
   */
  const _festivosCache = new Map();

  /**
   * Retorna los festivos nacionales españoles para un año (CNMC Circular 3/2020).
   * Solo incluye festivos de fecha FIJA (excluyendo móviles como Viernes Santo).
   * Incluye: Año Nuevo, Reyes, 1 Mayo, 15 Agosto, 12 Octubre,
   * 1 Noviembre, 6/8/25 Diciembre.
   * Usa caché interno para mejorar performance.
   *
   * Nota: Viernes Santo (móvil) está EXCLUIDO según CNMC BOE-A-2020-1066
   * "días festivos de ámbito nacional con exclusión de los que no tienen fecha fija"
   *
   * @param {number} year - Año
   * @returns {Set<string>} Set de fechas en formato 'yyyy-mm-dd'
   */
  function getFestivosNacionales(year) {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 1) return new Set();

    // Retornar desde caché si existe
    if (_festivosCache.has(y)) return _festivosCache.get(y);

    const festivos = [];
    for (const mmdd of FESTIVOS_NACIONALES_MMDD) {
      festivos.push(`${y}-${mmdd}`);
    }

    const set = new Set(festivos);
    _festivosCache.set(y, set);
    return set;
  }

  /**
   * Determina el periodo tarifario (P1/P2/P3) para una fecha y hora dadas.
   * Reglas CNMC Circular 3/2020 para tarifa 2.0TD:
   * - P3 (Valle): 0-8h, fines de semana, festivos nacionales
   * - P1 (Punta): según zona (ver abajo)
   * - P2 (Llano): resto de horas (laborables)
   *
   * Zonas soportadas (CNMC):
   * - Península/Baleares/Canarias: P1 = 10-14h y 18-22h
   * - Ceuta/Melilla: P1 = 11-15h y 19-23h
   *
   * @param {Date} fecha - Fecha a evaluar
   * @param {number} hora - Hora CNMC (1-24, donde 1 = 00:00-01:00)
   * @param {string} zona - Zona geográfica ('peninsula'|'ceutaMelilla'). Default: 'peninsula'
   * @returns {string} 'P1', 'P2' o 'P3'
   */
  function getPeriodoHorarioCSV(fecha, hora, zona = 'peninsula') {
    const diaSemana = fecha.getDay(); // 0=domingo, 6=sábado
    const esFinde = diaSemana === 0 || diaSemana === 6;

    // Formatear fecha como yyyy-mm-dd
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    const fechaStr = `${year}-${month}-${day}`;

    // Verificar si es festivo nacional
    const festivosNacionales = getFestivosNacionales(year);
    const esFestivo = festivosNacionales instanceof Set
      ? festivosNacionales.has(fechaStr)
      : Array.isArray(festivosNacionales) && festivosNacionales.includes(fechaStr);

    // Fines de semana y festivos: siempre P3
    if (esFinde || esFestivo) return 'P3';

    const zonaNorm = normalizeZonaFiscal(zona);

    // Hora inicio: hora CNMC - 1 (hora 1 = 0-1h -> horaInicio=0). La hora 25
    // representa la repetida local: 02:00 en Peninsula y 01:00 en Canarias.
    const horaInicio = hora === 25
      ? (isCanariasFiscalZone(zona) ? 1 : 2)
      : (hora - 1);

    // Valle: 0-8h (igual para todas las zonas)
    if (horaInicio >= 0 && horaInicio < 8) return 'P3';

    // Punta: según zona CNMC
    // Detección robusta: cualquier variante que contenga "ceuta" Y "melilla"
    const esCeutaMelilla = zonaNorm.includes('ceuta') && zonaNorm.includes('melilla');
    if (esCeutaMelilla) {
      // Ceuta/Melilla: P1 = 11-15h y 19-23h
      if ((horaInicio >= 11 && horaInicio < 15) || (horaInicio >= 19 && horaInicio < 23)) {
        return 'P1';
      }
    } else {
      // Península/Baleares/Canarias: P1 = 10-14h y 18-22h
      if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) {
        return 'P1';
      }
    }

    // Llano: resto
    return 'P2';
  }

  function normalizeZonaFiscal(zona) {
    return (zona || '')
      .toString()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar tildes
      .replace(/[^a-z]/g, ''); // Quitar espacios, guiones, etc.
  }

  /**
   * Formatea una fecha como yyyy-mm-dd (zona horaria local).
   * @param {Date} date - Fecha a formatear
   * @returns {string} Fecha en formato 'yyyy-mm-dd'
   */
  function ymdLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const MS_PER_DAY = 86400000;

  function spanDaysInclusiveFromTimestamps(minTs, maxTs) {
    if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) return 0;
    const min = new Date(minTs);
    const max = new Date(maxTs);
    const minUTC = Date.UTC(min.getFullYear(), min.getMonth(), min.getDate());
    const maxUTC = Date.UTC(max.getFullYear(), max.getMonth(), max.getDate());
    return Math.floor((maxUTC - minUTC) / MS_PER_DAY) + 1;
  }

  /**
   * Calcula la cobertura de datos por mes (días con datos / días totales del mes)
   * @param {Array} records - Array de registros con fecha
   * @returns {Map} Map con monthKey → { daysWithData, daysInMonth, coverage }
   */
  function calculateMonthCoverage(records) {
    const monthData = new Map();

    (records || []).forEach((record) => {
      const fecha = record && record.fecha;
      if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return;

      const year = fecha.getFullYear();
      const month = fecha.getMonth();
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      const dayKey = `${monthKey}-${String(fecha.getDate()).padStart(2, '0')}`;

      if (!monthData.has(monthKey)) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        monthData.set(monthKey, {
          daysWithData: new Set(),
          daysInMonth,
          coverage: 0
        });
      }

      monthData.get(monthKey).daysWithData.add(dayKey);
    });

    // Calcular cobertura
    monthData.forEach((data) => {
      data.coverage = (data.daysWithData.size / data.daysInMonth) * 100;
      data.daysWithData = data.daysWithData.size; // Convertir Set a número
    });

    return monthData;
  }

  /**
   * Formatea un mes-año legible (2025-01 → "enero 2025")
   */
  function formatMonthYear(monthKey) {
    const [year, month] = monthKey.split('-');
    const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
  }

  function monthsAgoCutoff(today, months) {
    const base = today instanceof Date && !isNaN(today.getTime()) ? today : new Date();
    const targetMonth = base.getMonth() - months;
    const firstOfMonth = new Date(base.getFullYear(), targetMonth, 1);
    const lastDay = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();
    const cutoff = new Date(
      firstOfMonth.getFullYear(),
      firstOfMonth.getMonth(),
      Math.min(base.getDate(), lastDay)
    );
    cutoff.setHours(0, 0, 0, 0);
    return cutoff;
  }

  // Comprueba que una lista ordenada de claves "YYYY-MM" no tenga huecos internos (cada mes es
  // el siguiente natural del anterior, con acarreo de año en diciembre->enero).
  function monthsAreConsecutive(sortedMonthKeys) {
    for (let i = 1; i < sortedMonthKeys.length; i++) {
      const [py, pm] = sortedMonthKeys[i - 1].split('-').map(Number);
      const [cy, cm] = sortedMonthKeys[i].split('-').map(Number);
      const expectedY = pm === 12 ? py + 1 : py;
      const expectedM = pm === 12 ? 1 : pm + 1;
      if (cy !== expectedY || cm !== expectedM) {
        return { ok: false, gapAfter: sortedMonthKeys[i - 1], gapBefore: sortedMonthKeys[i] };
      }
    }
    return { ok: true };
  }

  function validateCsvSpanFromRecords(records, options = {}) {
    const maxDays = Number.isFinite(options.maxDays) ? options.maxDays : 370;
    const requireExactly12Months = options.requireExactly12Months || false;
    const coverageThreshold = options.coverageThreshold || 80; // % mínimo de cobertura
    const staleWarningMonths = Number.isFinite(options.staleWarningMonths) && options.staleWarningMonths > 0
      ? options.staleWarningMonths
      : null;
    const todayRaw = options.today instanceof Date ? options.today : (options.today ? new Date(options.today) : new Date());
    const today = todayRaw instanceof Date && !isNaN(todayRaw.getTime()) ? todayRaw : new Date();

    let minTs = null;
    let maxTs = null;
    const months = new Set();

    (records || []).forEach((record) => {
      const fecha = record && record.fecha;
      if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return;
      const ts = fecha.getTime();
      if (minTs === null || ts < minTs) minTs = ts;
      if (maxTs === null || ts > maxTs) maxTs = ts;
      const monthKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      months.add(monthKey);
    });

    // Para Datadis mensual los records tienen fecha = día 1 de cada mes.
    // Ajustar maxTs al último día del mes más reciente para que spanDays y endYmd sean correctos.
    if (options.isDatadisMonthly && maxTs !== null) {
      const d = new Date(maxTs);
      maxTs = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
    }

    const monthsSorted = Array.from(months).sort();
    const monthsDistinct = monthsSorted.length;
    let monthsUsed = [];
    let monthsToDrop = [];

    if (minTs === null || maxTs === null) {
      return {
        ok: false,
        error: 'No se encontraron fechas válidas en el CSV.'
      };
    }

    const spanDays = spanDaysInclusiveFromTimestamps(minTs, maxTs);
    const startYmd = ymdLocal(new Date(minTs));
    const endYmd = ymdLocal(new Date(maxTs));
    const staleWarning = (() => {
      if (!staleWarningMonths) return '';
      const endDate = new Date(maxTs);
      if (endDate >= monthsAgoCutoff(today, staleWarningMonths)) return '';
      return `⚠️ CSV antiguo: los datos terminan el ${endYmd}, hace más de ${staleWarningMonths} meses.\n\n` +
             `Las tarifas actuales pueden no representar bien ese período; revisa que estás importando el archivo correcto.`;
    })();

    if (spanDays > maxDays) {
      return {
        ok: false,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop,
        error: `El CSV abarca ${spanDays} días (${startYmd} → ${endYmd}).\n\n` +
               `El máximo permitido es ${maxDays} días (~1 año).\n\n` +
               `💡 Exporta un período más corto desde tu distribuidora o plataforma de datos.`
      };
    }

    // ===== MODO 1: Sin restricción de 12 meses (Comparador Principal) =====
    if (!requireExactly12Months) {
      monthsUsed = monthsSorted;

      const message = monthsDistinct === 13
        ? `✓ CSV procesado: ${spanDays} días en ${monthsDistinct} meses (${startYmd} → ${endYmd}).\n\n` +
          `Se utilizan TODOS los datos sin descartar ningún mes.`
        : `✓ CSV procesado: ${spanDays} días en ${monthsDistinct} meses (${startYmd} → ${endYmd}).`;

      return {
        ok: true,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop: [],
        info: message,
        warning: staleWarning || undefined
      };
    }

    // ===== MODO 2: Requiere exactamente 12 meses (Comparador Solar) =====

    if (monthsDistinct > 13) {
      return {
        ok: false,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop,
        error: `El CSV contiene ${monthsDistinct} meses distintos.\n\n` +
               `El comparador solar requiere máximo 13 meses consecutivos (se ajusta automáticamente a 12).\n\n` +
               `💡 Exporta un período de ~1 año desde tu distribuidora.`
      };
    }

    // No exige meses completos (eso lo gestiona el descarte inteligente de abajo para el caso
    // de 13 meses), solo prohibe que falte un mes ENTERO en medio del rango: encadenar
    // junio->agosto sin julio dejaria que la BV heredase saldo de un mes que nunca se simulo.
    const consecutividad = monthsAreConsecutive(monthsSorted);
    if (!consecutividad.ok) {
      return {
        ok: false,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop,
        error: `El histórico tiene un hueco: falta al menos un mes completo entre ` +
               `${formatMonthYear(consecutividad.gapAfter)} y ${formatMonthYear(consecutividad.gapBefore)}.\n\n` +
               `El simulador solar necesita meses consecutivos, sin huecos internos, para calcular ` +
               `bien la batería virtual mes a mes.\n\n` +
               `💡 Exporta un período continuo desde tu distribuidora.`
      };
    }

    if (monthsDistinct <= 12) {
      monthsUsed = monthsSorted;
      return {
        ok: true,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop: []
      };
    }

    // ===== Caso especial: 13 meses → descartar inteligentemente =====

    const monthCoverage = calculateMonthCoverage(records);
    const firstMonth = monthsSorted[0];
    const lastMonth = monthsSorted[monthsSorted.length - 1];

    const firstCoverage = monthCoverage.get(firstMonth);
    const lastCoverage = monthCoverage.get(lastMonth);

    const firstIsIncomplete = firstCoverage.coverage < coverageThreshold;
    const lastIsIncomplete = lastCoverage.coverage < coverageThreshold;

    // Decidir qué descartar
    if (firstIsIncomplete && !lastIsIncomplete) {
      // Descartar el primero (incompleto)
      monthsToDrop = [firstMonth];
      monthsUsed = monthsSorted.slice(1);

      return {
        ok: true,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop,
        warning: `📊 CSV con 13 meses detectado (${startYmd} → ${endYmd}).\n\n` +
                 `✂️ Se descarta ${formatMonthYear(firstMonth)} porque tiene datos incompletos:\n` +
                 `   • Solo ${firstCoverage.daysWithData} de ${firstCoverage.daysInMonth} días (${Math.round(firstCoverage.coverage)}% cobertura)\n\n` +
                 `✓ Se usan los últimos 12 meses completos:\n` +
                 `   • ${formatMonthYear(monthsUsed[0])} → ${formatMonthYear(monthsUsed[monthsUsed.length - 1])}\n` +
                 `   • Total: ~${spanDays - Math.round(spanDays / 13)} días utilizados`
      };
    }

    if (!firstIsIncomplete && lastIsIncomplete) {
      // Descartar el último (incompleto)
      monthsToDrop = [lastMonth];
      monthsUsed = monthsSorted.slice(0, -1);

      return {
        ok: true,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop,
        warning: `📊 CSV con 13 meses detectado (${startYmd} → ${endYmd}).\n\n` +
                 `✂️ Se descarta ${formatMonthYear(lastMonth)} porque tiene datos incompletos:\n` +
                 `   • Solo ${lastCoverage.daysWithData} de ${lastCoverage.daysInMonth} días (${Math.round(lastCoverage.coverage)}% cobertura)\n\n` +
                 `✓ Se usan los primeros 12 meses completos:\n` +
                 `   • ${formatMonthYear(monthsUsed[0])} → ${formatMonthYear(monthsUsed[monthsUsed.length - 1])}\n` +
                 `   • Total: ~${spanDays - Math.round(spanDays / 13)} días utilizados`
      };
    }

    if (firstIsIncomplete && lastIsIncomplete) {
      // Ambos incompletos: intentar descartar solo el primero primero
      // Si eso da exactamente 12 meses, lo usamos. Si no, descartar ambos.

      const tryDropFirst = monthsSorted.slice(1);  // 12 meses si empezamos con 13

      if (tryDropFirst.length === 12) {
        // Descartar solo el primero es suficiente
        monthsToDrop = [firstMonth];
        monthsUsed = tryDropFirst;

        return {
          ok: true,
          spanDays,
          startYmd,
          endYmd,
          monthsDistinct,
          monthsUsed,
          monthsToDrop,
          warning: `📊 CSV con 13 meses detectado (${startYmd} → ${endYmd}).\n\n` +
                   `✂️ Se descarta ${formatMonthYear(firstMonth)} porque tiene datos incompletos:\n` +
                   `   • Solo ${firstCoverage.daysWithData} de ${firstCoverage.daysInMonth} días (${Math.round(firstCoverage.coverage)}% cobertura)\n\n` +
                   `✓ Se usan los últimos 12 meses:\n` +
                   `   • ${formatMonthYear(monthsUsed[0])} → ${formatMonthYear(monthsUsed[monthsUsed.length - 1])}\n` +
                   `   • Total: ~${spanDays - Math.round(spanDays / 13)} días utilizados`
        };
      }

      // Si no es suficiente, descartar ambos
      monthsToDrop = [firstMonth, lastMonth];
      monthsUsed = monthsSorted.slice(1, -1);

      if (monthsUsed.length < 11) {
        return {
          ok: false,
          spanDays,
          startYmd,
          endYmd,
          monthsDistinct,
          monthsUsed,
          monthsToDrop,
          error: `El CSV tiene datos muy fragmentados:\n\n` +
                 `• ${formatMonthYear(firstMonth)}: ${firstCoverage.daysWithData}/${firstCoverage.daysInMonth} días (${Math.round(firstCoverage.coverage)}%)\n` +
                 `• ${formatMonthYear(lastMonth)}: ${lastCoverage.daysWithData}/${lastCoverage.daysInMonth} días (${Math.round(lastCoverage.coverage)}%)\n\n` +
                 `Tras descartar los meses incompletos quedan solo ${monthsUsed.length} meses.\n\n` +
                 `💡 Exporta un período de 12 meses más completo.`
        };
      }

      return {
        ok: true,
        spanDays,
        startYmd,
        endYmd,
        monthsDistinct,
        monthsUsed,
        monthsToDrop,
        warning: `📊 CSV con 13 meses detectado (${startYmd} → ${endYmd}).\n\n` +
                 `✂️ Se descartan 2 meses con datos incompletos:\n` +
                 `   • ${formatMonthYear(firstMonth)}: ${firstCoverage.daysWithData}/${firstCoverage.daysInMonth} días (${Math.round(firstCoverage.coverage)}%)\n` +
                 `   • ${formatMonthYear(lastMonth)}: ${lastCoverage.daysWithData}/${lastCoverage.daysInMonth} días (${Math.round(lastCoverage.coverage)}%)\n\n` +
                 `✓ Se usan los ${monthsUsed.length} meses centrales más completos:\n` +
                 `   • ${formatMonthYear(monthsUsed[0])} → ${formatMonthYear(monthsUsed[monthsUsed.length - 1])}`
      };
    }

    // Ambos completos → descartar el primero (criterio: usar los más recientes)
    monthsToDrop = [firstMonth];
    monthsUsed = monthsSorted.slice(1);

    return {
      ok: true,
      spanDays,
      startYmd,
      endYmd,
      monthsDistinct,
      monthsUsed,
      monthsToDrop,
      warning: `📊 CSV con 13 meses detectado (${startYmd} → ${endYmd}).\n\n` +
               `Todos los meses tienen datos completos.\n\n` +
               `✂️ Se descarta ${formatMonthYear(firstMonth)} (el más antiguo) para usar los 12 meses más recientes:\n` +
               `   • ${formatMonthYear(monthsUsed[0])} → ${formatMonthYear(monthsUsed[monthsUsed.length - 1])}\n` +
               `   • Total: ~${spanDays - Math.round(spanDays / 13)} días utilizados`
    };
  }

  // ===== VALIDACION DE DIA CIVIL PVPC (compartida por home, Observatorio y excedentes) =====
  //
  // Fuente unica del contrato "que cuenta como un dia PVPC/excedentes utilizable". Antes de
  // esto, home (js/pvpc.js), el Observatorio (js/pvpc-stats-engine.js, js/pvpc-stats-csv.js) y
  // excedentes (js/lf-surplus-prices.js) tenian TRES implementaciones divergentes que solo
  // comprobaban "cada fila es un par numerico", sin exigir cardinalidad horaria (23/24/25 segun
  // DST), continuidad ni que las horas pertenecieran realmente al dia civil declarado. Un mes
  // historico con un dia de un solo punto horario pasaba como "sano" y se cacheaba como completo.
  //
  // NO reutiliza `ymdLocal` (unas lineas mas arriba): esa funcion usa la zona horaria del
  // NAVEGADOR (getFullYear/getMonth/getDate), mientras que un dataset PVPC/excedentes tiene su
  // propia zona horaria explicita (Europe/Madrid o Atlantic/Canary) que no puede depender de
  // donde este el usuario. `formatYmdInTimeZone` usa Intl.DateTimeFormat con esa zona.

  const pvpcDateFormatterCache = new Map();
  function formatYmdInTimeZone(tsSeconds, timeZone) {
    const zone = timeZone || 'Europe/Madrid';
    let formatter = pvpcDateFormatterCache.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone
      });
      pvpcDateFormatterCache.set(zone, formatter);
    }
    const parts = formatter.formatToParts(new Date(Number(tsSeconds) * 1000));
    const values = {};
    parts.forEach((part) => {
      if (part.type !== 'literal') values[part.type] = part.value;
    });
    return `${values.year}-${values.month}-${values.day}`;
  }

  // Validacion general de un dia. `allowPartial` relaja SOLO la cardinalidad minima y la
  // exigencia de que el dia llegue hasta la ultima hora: un dia que aun se esta publicando
  // (normalmente "hoy") puede tener menos horas de las esperadas, pero todo lo publicado tiene
  // que ser correcto, pertenecer al dia civil declarado y ser contiguo desde la medianoche. Sin
  // `allowPartial`, el dia debe estar completo (23/24/25 puntos exactos segun DST).
  function validatePvpcDayCoverage(dateStr, dayPrices, timeZone, { allowPartial = false } = {}) {
    if (!Array.isArray(dayPrices) || dayPrices.length < 1) {
      return { ok: false, reason: 'point-count' };
    }
    if (!allowPartial && (dayPrices.length < 23 || dayPrices.length > 25)) {
      return { ok: false, reason: 'point-count' };
    }
    if (allowPartial && dayPrices.length > 25) {
      return { ok: false, reason: 'point-count' };
    }
    if (dayPrices.some((entry) => (
      !Array.isArray(entry)
      || typeof entry[0] !== 'number' || !Number.isFinite(entry[0])
      || typeof entry[1] !== 'number' || !Number.isFinite(entry[1])
    ))) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const entries = dayPrices.map((entry) => ({ ts: entry[0], price: entry[1] }));
    entries.sort((a, b) => a.ts - b.ts);
    if (entries.some((entry) => formatYmdInTimeZone(entry.ts, timeZone) !== dateStr)) {
      return { ok: false, reason: 'wrong-local-day' };
    }
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].ts - entries[i - 1].ts !== 3600) {
        return { ok: false, reason: 'non-contiguous' };
      }
    }
    if (formatYmdInTimeZone(entries[0].ts - 3600, timeZone) === dateStr) {
      return { ok: false, reason: 'missing-first-hour' };
    }
    if (!allowPartial && formatYmdInTimeZone(entries[entries.length - 1].ts + 3600, timeZone) === dateStr) {
      return { ok: false, reason: 'missing-last-hour' };
    }
    return { ok: true, points: entries.length };
  }

  // Dia CERRADO: nunca puede estar parcial. Usada por el calculo PVPC estandar de la home, cuyo
  // periodo solicitado siempre termina ayer (nunca pide el dia de hoy).
  function validateClosedPvpcDay(dateStr, dayPrices, timeZone) {
    return validatePvpcDayCoverage(dateStr, dayPrices, timeZone, { allowPartial: false });
  }

  function addDaysYmd(dateStr, amount) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
  }

  function lastDayOfMonth(ym) {
    const [year, month] = ym.split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }

  // Identidad minima de los datasets horarios estaticos. La cobertura temporal no basta:
  // un fichero completo pero servido bajo la ruta equivocada (otra zona/indicador/unidad)
  // produciria una cifra economicamente falsa. Esta comprobacion vive en la frontera de
  // lectura para que ningun consumidor tenga que reinterpretar los metadatos por su cuenta.
  function validateStaticPriceDatasetIdentity(data, {
    expectedGeoId = null,
    expectedIndicator = null,
    expectedTimeZone = null,
    allowMissingFields = false
  } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'invalid-dataset' };
    }
    if (data.schema_version !== 2) return { ok: false, reason: 'unsupported-schema' };

    const missing = (value) => value === undefined || value === null;

    if (missing(data.geo_id)) {
      if (!allowMissingFields) return { ok: false, reason: 'missing-geo-id' };
    } else if (typeof data.geo_id !== 'number' || !Number.isInteger(data.geo_id)) {
      return { ok: false, reason: 'invalid-geo-id' };
    } else if (expectedGeoId !== null && data.geo_id !== Number(expectedGeoId)) {
      return { ok: false, reason: 'geo-id-mismatch' };
    }

    if (missing(data.indicator)) {
      if (!allowMissingFields) return { ok: false, reason: 'missing-indicator' };
    } else if (typeof data.indicator !== 'number' || !Number.isInteger(data.indicator)) {
      return { ok: false, reason: 'invalid-indicator' };
    } else if (expectedIndicator !== null && data.indicator !== Number(expectedIndicator)) {
      return { ok: false, reason: 'indicator-mismatch' };
    }

    if (missing(data.unit)) {
      if (!allowMissingFields) return { ok: false, reason: 'missing-unit' };
    } else if (data.unit !== 'EUR/kWh') {
      return { ok: false, reason: 'unit-mismatch' };
    }

    if (missing(data.epoch_unit)) {
      if (!allowMissingFields) return { ok: false, reason: 'missing-epoch-unit' };
    } else if (data.epoch_unit !== 's') {
      return { ok: false, reason: 'epoch-unit-mismatch' };
    }

    if (missing(data.timezone)) {
      if (!allowMissingFields) return { ok: false, reason: 'missing-timezone' };
    } else if (typeof data.timezone !== 'string' || !data.timezone) {
      return { ok: false, reason: 'invalid-timezone' };
    } else if (expectedTimeZone !== null && data.timezone !== expectedTimeZone) {
      return { ok: false, reason: 'timezone-mismatch' };
    }

    return { ok: true };
  }

  // Un JSON mensual no es sano solo porque sus dias presentes lo sean: debe declarar un
  // intervalo real (`from`/`to`) y contener TODAS sus fechas consecutivas. Los meses ya
  // cerrados deben cubrir del dia 1 al ultimo natural; el mes vigente puede terminar en
  // el ultimo dia publicado, pero nunca tener agujeros internos.
  function validatePvpcMonthCoverage(data, expectedMonth, timeZone, { todayLocal = null, freshnessDays = null } = {}) {
    if (!data || typeof data !== 'object' || !/^\d{4}-\d{2}$/.test(expectedMonth)
      || !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) {
      return { ok: false, reason: 'invalid-month' };
    }
    const dates = Object.keys(data.days).sort();
    // Los datasets runtime generados por el repositorio usan schema v2. Aceptar un
    // payload legacy aquí permitiría que un HTTP 200 truncado omitiera `from`/`to` y
    // esquivara toda la garantía mensual.
    if (data.schema_version !== 2) return { ok: false, reason: 'unsupported-schema' };
    if (!dates.length || !/^\d{4}-\d{2}-\d{2}$/.test(data.from) || !/^\d{4}-\d{2}-\d{2}$/.test(data.to)) {
      return { ok: false, reason: 'missing-range' };
    }
    const monthStart = `${expectedMonth}-01`;
    const monthEnd = lastDayOfMonth(expectedMonth);
    if (data.from !== dates[0] || data.to !== dates[dates.length - 1]
      || data.from < monthStart || data.to > monthEnd) {
      return { ok: false, reason: 'range-mismatch' };
    }
    // Todo mes anterior al mes local vigente es cerrado. El vigente/futuro puede acabar
    // en el ultimo dia que REE haya publicado, pero siempre empieza el dia 1.
    const currentMonth = todayLocal?.slice(0, 7) || null;
    if (data.from !== monthStart || (currentMonth && expectedMonth < currentMonth && data.to !== monthEnd)) {
      return { ok: false, reason: 'incomplete-month' };
    }
    // Integridad no implica frescura: durante el mes vigente una copia 2xx antigua puede
    // ser internamente perfecta pero quedarse congelada. Cada consumidor aporta la misma
    // tolerancia que usa su guard operativo (PVPC: 1 dia; excedentes: 2 dias).
    if (currentMonth === expectedMonth && Number.isInteger(freshnessDays) && freshnessDays >= 0
      && data.to < addDaysYmd(todayLocal, -freshnessDays)) {
      return { ok: false, reason: 'stale-month' };
    }
    const provisionalDays = [];
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      if (!date.startsWith(`${expectedMonth}-`) || (i > 0 && date !== addDaysYmd(dates[i - 1], 1))) {
        return { ok: false, reason: 'non-contiguous-days' };
      }
      const allowPartial = todayLocal !== null && date >= todayLocal;
      const coverage = validatePvpcDayCoverage(date, data.days[date], timeZone, { allowPartial });
      if (!coverage.ok) return { ok: false, reason: coverage.reason, date };
      if (allowPartial && !validateClosedPvpcDay(date, data.days[date], timeZone).ok) provisionalDays.push(date);
    }
    return { ok: true, provisionalDays };
  }

  // ===== EXPORTAR API PÚBLICA =====

  window.LF = window.LF || {};
  window.LF.csvUtils = {
    // Red
    fetchWithTimeout,
    fetchJsonWithTimeout,

    // Normalización
    stripBomAndTrim,
    stripOuterQuotes,
    parseNumberFlexibleCSV,
    parseNumberFlexible,
    normalizeHeaderName,
    normalizeHeaders,
    normalizeZonaFiscal,
    getCsvZoneProfiles,
    hasDstTransitionRecords,
    buildImportError,
    assertXlsxSheetWithinLimits,
    assertRelevantXlsxFormulasResolved,
    csvErrorCodeForTracking,
    safeFileExtensionForTracking,
    detectHeaderRow,

    // Parsing CSV
    splitCSVLine,
    detectCSVSeparator,
    detectCSVSeparatorFromLines,
    parseCSVToRows,
    parseEnergyTableRows,
    guessEnergyHeaderRow,
    bestEnergyHeaderCandidate,
    isDatadisMonthlyFormat,
    parseDatadisMonthlyRows,

    // Mapeo de columnas y centinelas
    detectColumnMapping,
    classifyAmbiguousColumn,
    detectUnmappedSolarColumns,
    buildUnmappedSolarError,

    // Matriz horaria (Fecha + H01..H24), compartida por home y solar
    isHourlyMatrixHeaderRow,
    findHourlyMatrixHeaderRow,
    parseHourlyMatrixRows,

    // Fechas
    parseDateFlexible,
    ymdLocal,
    spanDaysInclusiveFromTimestamps,
    validateCsvSpanFromRecords,
    monthsAreConsecutive,
    calculateMonthCoverage,
    formatMonthYear,
    addDaysYmd,

    // Festivos y periodos
    getFestivosNacionales,
    esFestivoNacionalMmdd,
    getPeriodoHorarioCSV,

    // Validacion de dia civil PVPC/excedentes (home, Observatorio, excedentes)
    formatYmdInTimeZone,
    validatePvpcDayCoverage,
    validateClosedPvpcDay,
    validateStaticPriceDatasetIdentity,
    validatePvpcMonthCoverage
  };

  // Debug log
  if (typeof lfDbg === 'function') {
    lfDbg('[CSV-Utils] Biblioteca cargada correctamente');
  }

})();
