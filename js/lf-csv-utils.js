// ===== LuzFija: CSV Utilities =====
// Biblioteca común para parsing robusto de archivos CSV de distribuidoras eléctricas
// Funciones puras sin dependencias externas, reutilizables por múltiples importadores

(function() {
  'use strict';

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

    // Ignorar hora si existe (tomar solo la parte de fecha)
    const firstToken = str.split(' ')[0];

    // Formato: dd/mm/yyyy o dd-mm-yyyy
    let match = firstToken.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
      const d = Number(match[1]);
      const mo = Number(match[2]);
      const y = Number(match[3]);
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Formato: yyyy/mm/dd o yyyy-mm-dd
    match = firstToken.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      const y = Number(match[1]);
      const mo = Number(match[2]);
      const d = Number(match[3]);
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
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
    hora: [
      'hora', 'hour', 'intervalo', 'periodo', 'period', 'periodo_horario', 'tramo', 'hora_intervalo'
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
    periodo: [
      'periodo_tarifario', 'periodo_tarifa', 'periodo'
    ],
    invVer: [
      'inv_ver', 'invver', 'invierno_verano'
    ]
  };

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

  function detectColumnMapping(headersNorm, options = {}) {
    const fechaMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.fecha);
    const horaMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.hora);
    const fechaHoraMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.fechaHora);

    if (fechaHoraMatches.length > 1) {
      throw buildHeaderError('Columna de fecha/hora ambigua: hay varias posibles.', headersNorm, options);
    }
    if (fechaHoraMatches.length === 1 && (fechaMatches.length || horaMatches.length)) {
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
    const periodoMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.periodo);
    const invVerMatches = findHeaderMatches(headersNorm, HEADER_ALIASES.invVer);

    const fechaIdx = fechaHoraMatches.length ? null : pickUniqueColumn('fecha', fechaMatches, headersNorm, true, options);
    const horaIdx = fechaHoraMatches.length ? null : pickUniqueColumn('hora', horaMatches, headersNorm, true, options);
    const fechaHoraIdx = fechaHoraMatches.length ? fechaHoraMatches[0] : null;

    const importIdx = pickUniqueColumn('consumo/importación', importMatches, headersNorm, true, options);
    const exportIdx = pickUniqueColumn('excedente/exportación', exportMatches, headersNorm, false, options);
    const autoconsumoIdx = pickUniqueColumn('autoconsumo', autoconsumoMatches, headersNorm, false, options);
    const realEstimadoIdx = pickUniqueColumn('real/estimado', realMatches, headersNorm, false, options);
    const periodoIdx = pickUniqueColumn('periodo tarifario', periodoMatches, headersNorm, false, options);
    const invVerIdx = pickUniqueColumn('INV/VER', invVerMatches, headersNorm, false, options);

    return {
      fechaIdx,
      horaIdx,
      fechaHoraIdx,
      importIdx,
      exportIdx,
      autoconsumoIdx,
      realEstimadoIdx,
      periodoIdx,
      invVerIdx
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

  function detectHeaderRow(lines, separator, maxRows = 30) {
    const candidates = lines || [];
    let scanned = 0;
    for (let i = 0; i < candidates.length && scanned < maxRows; i++) {
      const line = candidates[i];
      if (!stripBomAndTrim(line)) continue;
      scanned++;
      const cols = splitCSVLine(line, separator);
      if (cols.length < 3) continue;
      const headersNorm = normalizeHeaders(cols);
      const { score, hasFecha, hasEnergy } = scoreHeaderRow(headersNorm);
      if (score >= 3 && hasFecha && hasEnergy) {
        return { index: i, headers: cols, headersNorm };
      }
    }
    return { index: -1, headers: [], headersNorm: [] };
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

  function detectHourBase(dataRows, mapping) {
    const rows = dataRows || [];
    let foundZero = false;
    let found24 = false;
    for (const row of rows) {
      if (!row || !Array.isArray(row)) continue;
      let hourNum = null;
      if (mapping.fechaHoraIdx !== null && mapping.fechaHoraIdx !== undefined) {
        const { hour } = splitDateTime(row[mapping.fechaHoraIdx]);
        hourNum = hour;
      } else {
        hourNum = extractHourNumber(row[mapping.horaIdx]);
      }
      if (hourNum === null) continue;
      if (hourNum === 0) foundZero = true;
      if (hourNum === 24 || hourNum === 25) found24 = true;
    }
    if (foundZero) return 'zero';
    if (found24) return 'cnmc';
    return 'cnmc';
  }

  function buildHourResolver(mapping, hourBase) {
    const seen = new Map();
    return function resolveHour(fecha, hourNum, invVerRaw) {
      if (!Number.isFinite(hourNum)) return null;
      if (hourBase === 'zero') {
        if (hourNum === 2 && mapping.invVerIdx !== null && mapping.invVerIdx !== undefined) {
          const key = `${ymdLocal(fecha)}|02`;
          const count = (seen.get(key) || 0) + 1;
          seen.set(key, count);
          const inv = String(invVerRaw ?? '').trim();
          if (inv === '1') return 3;
          if (inv === '0') return count >= 2 ? 25 : 3;
          if (count === 1) return 3;
          if (count === 2) return 25;
        }
        return hourNum + 1;
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
    const headersRaw = (headerRow || []).map(cell => stripBomAndTrim(cell));
    const mapping = detectColumnMapping(headersNorm, { separator });
    const warnings = [];
    const emptyCells = {
      import: 0,
      export: 0
    };

    if (mapping.exportIdx === null) {
      warnings.push('No se detectaron excedentes; se importará con excedentes=0.');
    }

    const dataRows = rows.slice(headerRowIndex + 1);
    const hourBase = detectHourBase(dataRows, mapping);
    if (hourBase === 'zero') {
      warnings.push('Ajustado formato de hora (0-23 → 1-24).');
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

    const resolveHour = buildHourResolver(mapping, hourBase);
    const records = [];
    let totalRows = 0;
    let parsedRows = 0;
    let simultaneousCount = 0;
    const threshold = 1e-6;

    const isNoDataCell = (value) => {
      const s = stripOuterQuotes(value).trim().toLowerCase();
      if (!s) return true;
      // Algunos ficheros (p.ej. UFD) usan literales en vez de vacío
      if (s === 'sin dato' || s === 'sin datos') return true;
      if (s === 'n/a' || s === 'na') return true;
      if (s === '-' || s === '—') return true;
      if (s === 's/d' || s === 'sd') return true;
      if (s === 'null' || s === 'undefined') return true;
      return false;
    };

    const isEmptyCell = isNoDataCell;
    const columnLabel = (idx) => headersRaw[idx] || headersNorm[idx] || `columna ${idx + 1}`;

    const mapPeriodo = (raw) => {
      const p = String(raw ?? '').trim().toUpperCase();
      if (!p) return null;
      if (p.includes('PUNTA') || p === 'P1') return 'P1';
      if (p.includes('LLANO') || p === 'P2') return 'P2';
      if (p.includes('VALLE') || p === 'P3') return 'P3';
      return null;
    };

    for (const row of dataRows) {
      if (!row || !Array.isArray(row)) continue;
      const hasData = row.some(cell => String(cell ?? '').trim() !== '');
      if (!hasData) continue;
      totalRows++;

      let fecha = null;
      let hourNum = null;

      if (mapping.fechaHoraIdx !== null) {
        const dt = splitDateTime(row[mapping.fechaHoraIdx]);
        fecha = dt.date;
        hourNum = dt.hour;
      } else {
        fecha = parseDateFlexible(row[mapping.fechaIdx]);
        hourNum = extractHourNumber(row[mapping.horaIdx]);
      }

      if (!fecha || !Number.isFinite(hourNum)) continue;
      const hora = resolveHour(fecha, hourNum, mapping.invVerIdx !== null ? row[mapping.invVerIdx] : null);
      if (!Number.isFinite(hora) || hora < 1 || hora > 25) continue;

      let importRaw = parseNumber(row[mapping.importIdx]);
      if (!Number.isFinite(importRaw)) {
        if (isEmptyCell(row[mapping.importIdx])) {
          importRaw = 0;
          emptyCells.import += 1;
        } else {
          continue;
        }
      }
      if (importRaw < 0) continue;

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

      if (importKwh > 10000 || exportKwh > 10000) continue;

      if (importKwh > threshold && exportKwh > threshold) {
        simultaneousCount++;
      }

      const kwh = Math.max(importKwh - exportKwh, 0);
      const excedente = Math.max(exportKwh - importKwh, 0);

      if (kwh > threshold && excedente > threshold) {
        throw buildHeaderError(
          'Se detectaron importación y excedentes simultáneos tras el neteo horario.',
          headersNorm,
          { separator }
        );
      }

      let esReal = true;
      if (mapping.realEstimadoIdx !== null) {
        const estado = String(row[mapping.realEstimadoIdx] ?? '').trim().toLowerCase();
        esReal = estado.startsWith('real') || estado === 'r';
      }

      // Si el CSV trae columna de periodo, usarla
      // Si no, calcular automáticamente para evitar divergencias aguas abajo
      let periodo = null;
      if (mapping.periodoIdx !== null) {
        periodo = mapPeriodo(row[mapping.periodoIdx]);
      } else {
        // Calcular periodo automáticamente usando la función canónica
        periodo = getPeriodoHorarioCSV(fecha, hora);
      }

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

    return {
      records,
      warnings,
      hasExcedenteColumn: mapping.exportIdx !== null,
      hasAutoconsumoColumn: mapping.autoconsumoIdx !== null
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

  function guessEnergyHeaderRow(dataRows, maxRows = 30) {
    const candidates = dataRows || [];
    let scanned = 0;
    for (let i = 0; i < candidates.length && scanned < maxRows; i++) {
      const row = candidates[i];
      if (!row || !Array.isArray(row)) continue;
      const hasContent = row.some(cell => stripBomAndTrim(cell));
      if (!hasContent) continue;
      scanned++;
      const headersNorm = normalizeHeaders(row);
      const { score, hasFecha, hasEnergy } = scoreHeaderRow(headersNorm);
      if (headersNorm.length >= 3 && score >= 3 && hasFecha && hasEnergy) return i;
    }
    return -1;
  }

  // ===== FESTIVOS Y PERIODOS TARIFARIOS =====

  /**
   * Calcula la fecha de Viernes Santo para un año dado.
   * Usa el algoritmo de Gauss para calcular la Pascua, luego resta 2 días.
   * @param {number} year - Año
   * @returns {string} Fecha en formato 'yyyy-mm-dd'
   */
  function calcularViernesSanto(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const pascua = new Date(year, month - 1, day);
    const viernesSanto = new Date(pascua);
    viernesSanto.setDate(pascua.getDate() - 2);

    const mes = String(viernesSanto.getMonth() + 1).padStart(2, '0');
    const dia = String(viernesSanto.getDate()).padStart(2, '0');
    return `${year}-${mes}-${dia}`;
  }

  /**
   * Caché de festivos por año para optimizar cálculos repetidos.
   * Reduce complejidad de O(n) a O(1) para cada año único.
   * @type {Map<number, Set<string>>}
   */
  const _festivosCache = new Map();

  /**
   * Retorna los festivos nacionales españoles para un año.
   * Incluye: Año Nuevo, Reyes, Viernes Santo, 1 Mayo, 15 Agosto, 12 Octubre,
   * 1 Noviembre, 6/8/25 Diciembre.
   * Usa caché interno para mejorar performance.
   *
   * @param {number} year - Año
   * @returns {Set<string>} Set de fechas en formato 'yyyy-mm-dd'
   */
  function getFestivosNacionales(year) {
    const y = Number(year);
    if (!Number.isFinite(y)) return new Set();

    // Retornar desde caché si existe
    if (_festivosCache.has(y)) return _festivosCache.get(y);

    const festivos = [
      `${y}-01-01`, // Año Nuevo
      `${y}-01-06`, // Reyes
      calcularViernesSanto(y), // Viernes Santo (calculado)
      `${y}-05-01`, // Día del Trabajo
      `${y}-08-15`, // Asunción
      `${y}-10-12`, // Fiesta Nacional
      `${y}-11-01`, // Todos los Santos
      `${y}-12-06`, // Constitución
      `${y}-12-08`, // Inmaculada
      `${y}-12-25`  // Navidad
    ];

    const set = new Set(festivos);
    _festivosCache.set(y, set);
    return set;
  }

  /**
   * Determina el periodo tarifario (P1/P2/P3) para una fecha y hora dadas.
   * Reglas CNMC para tarifa 2.0TD:
   * - P3 (Valle): 0-8h, fines de semana, festivos nacionales
   * - P1 (Punta): 10-14h y 18-22h (laborables)
   * - P2 (Llano): resto de horas (laborables)
   *
   * @param {Date} fecha - Fecha a evaluar
   * @param {number} hora - Hora CNMC (1-24, donde 1 = 00:00-01:00)
   * @returns {string} 'P1', 'P2' o 'P3'
   */
  function getPeriodoHorarioCSV(fecha, hora) {
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

    // Hora inicio: hora CNMC - 1 (hora 1 = 0-1h -> horaInicio=0)
    const horaInicio = (hora === 25) ? 2 : (hora - 1); // hora 25 (cambio horario octubre) equivale a 02:00-03:00

    // Valle: 0-8h
    if (horaInicio >= 0 && horaInicio < 8) return 'P3';

    // Punta: 10-14h y 18-22h
    if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) {
      return 'P1';
    }

    // Llano: resto
    return 'P2';
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
    monthData.forEach((data, key) => {
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

  function validateCsvSpanFromRecords(records, options = {}) {
    const maxDays = Number.isFinite(options.maxDays) ? options.maxDays : 370;
    const requireExactly12Months = options.requireExactly12Months || false;
    const coverageThreshold = options.coverageThreshold || 80; // % mínimo de cobertura

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
        info: message
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
      // Ambos incompletos → descartar ambos
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

  // ===== EXPORTAR API PÚBLICA =====

  window.LF = window.LF || {};
  window.LF.csvUtils = {
    // Normalización
    stripBomAndTrim,
    stripOuterQuotes,
    parseNumberFlexibleCSV,
    parseNumberFlexible,
    normalizeHeaderName,
    normalizeHeaders,
    buildImportError,
    detectHeaderRow,

    // Parsing CSV
    splitCSVLine,
    detectCSVSeparator,
    detectCSVSeparatorFromLines,
    parseCSVToRows,
    parseEnergyTableRows,
    guessEnergyHeaderRow,

    // Fechas
    parseDateFlexible,
    ymdLocal,
    spanDaysInclusiveFromTimestamps,
    validateCsvSpanFromRecords,
    calculateMonthCoverage,
    formatMonthYear,

    // Festivos y periodos
    calcularViernesSanto,
    getFestivosNacionales,
    getPeriodoHorarioCSV
  };

  // Debug log
  if (typeof lfDbg === 'function') {
    lfDbg('[CSV-Utils] Biblioteca cargada correctamente');
  }

})();
