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

  // ===== EXPORTAR API PÚBLICA =====

  window.LF = window.LF || {};
  window.LF.csvUtils = {
    // Normalización
    stripBomAndTrim,
    stripOuterQuotes,
    parseNumberFlexibleCSV,
    parseNumberFlexible,

    // Parsing CSV
    splitCSVLine,
    detectCSVSeparator,

    // Fechas
    parseDateFlexible,
    ymdLocal,

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
