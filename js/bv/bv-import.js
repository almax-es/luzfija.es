/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

window.BVSim = window.BVSim || {};

(function () {
  'use strict';

  // ===== IMPORTAR UTILIDADES CSV =====
  const {
    parseNumberFlexible,
    parseNumberFlexibleCSV,
    ymdLocal,
    buildImportError,
    validateCsvSpanFromRecords
  } = window.LF.csvUtils || {};

  // El simulador solar es el unico flujo donde una columna de excedentes sin reconocer
  // invalida el resultado entero: se bloquea en vez de importar con excedentes=0.
  const UNMAPPED_SOLAR_POLICY = 'error';

  // ===== LAZY LOAD XLSX =====
  let xlsxLoading = null;

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    if (xlsxLoading) return xlsxLoading;

    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../../vendor/xlsx/xlsx.full.min.js', document.baseURI).toString();
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Error al cargar librería XLSX'));
      document.head.appendChild(script);
    });
    xlsxLoading = xlsxLoading.catch(err => { xlsxLoading = null; throw err; });

    return xlsxLoading;
  }

  // ===== PARSEO CSV =====
  function parseCSVConsumos(fileContent, zona = null) {
    const { parseCSVToRows, parseEnergyTableRows } = window.LF.csvUtils || {};
    if (typeof parseCSVToRows !== 'function' || typeof parseEnergyTableRows !== 'function') {
      throw new Error('No se pudo cargar el parser de CSV (lf-csv-utils.js faltante)');
    }

    const { rows, separator, headerRowIndex } = parseCSVToRows(fileContent);
    // parseEnergyTableRows devuelve { records: [...], warnings: [...] }
    // records tiene formato: { fecha, hora, kwh, excedente, autoconsumo, periodo, esReal }
    return parseEnergyTableRows(rows, {
      parseNumber: parseNumberFlexibleCSV,
      separator,
      headerRowIndex,
      zonaFiscal: zona, // Pasar zona para clasificar periodos correctamente (BV)
      unmappedSolarPolicy: UNMAPPED_SOLAR_POLICY
    });
  }

  // ===== PARSEO XLSX =====
  async function parseXLSXConsumos(fileBuffer, zona = null) {
    await ensureXLSX();

    const workbook = XLSX.read(fileBuffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

    if (!data || data.length < 2) {
      throw buildImportError('Archivo Excel vacío o formato no reconocido.');
    }

    const {
      parseEnergyTableRows,
      guessEnergyHeaderRow,
      bestEnergyHeaderCandidate,
      findHourlyMatrixHeaderRow,
      parseHourlyMatrixRows
    } = window.LF.csvUtils || {};
    if (typeof parseEnergyTableRows !== 'function' || typeof guessEnergyHeaderRow !== 'function'
      || typeof findHourlyMatrixHeaderRow !== 'function' || typeof parseHourlyMatrixRows !== 'function') {
      throw new Error('No se pudo cargar el parser de Excel');
    }

    // --- Matriz horaria (E-REDES y similares) ---
    // Implementacion compartida en lf-csv-utils.js: antes estaba duplicada aqui sin
    // validar negativos, texto ni el limite de 10.000 kWh.
    const matrixHeaderRow = findHourlyMatrixHeaderRow(data);
    if (matrixHeaderRow !== -1) {
      // computePeriodo:false a proposito. bucketizeByMonth respeta record.periodo si viene
      // relleno (salvo Ceuta/Melilla), y aqui todavia no se conoce la zona definitiva de la
      // simulacion: precalcularlo dejaria el periodo mal si el usuario simula otra zona.
      return parseHourlyMatrixRows(data, matrixHeaderRow, {
        parseNumber: parseNumberFlexible,
        computePeriodo: false
      });
    }

    // Formato estándar (columnas)
    const headerRow = guessEnergyHeaderRow(data);
    if (headerRow === -1) {
      // Se adjunta la mejor fila candidata para que el mensaje diga qué columnas se vieron
      // en vez de "(sin cabeceras)". Nunca viaja a analítica.
      throw buildImportError('No se encontró la fila de cabecera en el Excel.', {
        headersNorm: bestEnergyHeaderCandidate(data)
      });
    }

    return parseEnergyTableRows(data, {
      headerRowIndex: headerRow,
      parseNumber: parseNumberFlexible,
      zonaFiscal: zona, // Pasar zona para clasificar periodos correctamente (BV)
      unmappedSolarPolicy: UNMAPPED_SOLAR_POLICY
    });
  }

  // ===== UTILIDAD DE FORMATO =====
  function ymLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function buildMeta(records, hasExcedenteColumn, hasAutoconsumoColumn, isDatadisMonthly = false) {
    let minDate = null;
    let maxDate = null;
    const months = new Set();

    records.forEach((record) => {
      const fecha = record.fecha;
      if (!fecha) return;

      if (!minDate || fecha < minDate) minDate = fecha;
      if (!maxDate || fecha > maxDate) maxDate = fecha;

      const monthKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      months.add(monthKey);
    });

    return {
      rows: records.length,
      start: minDate ? ymdLocal(minDate) : '',
      end: maxDate ? ymdLocal(maxDate) : '',
      months: months.size,
      hasExcedenteColumn: Boolean(hasExcedenteColumn),
      hasAutoconsumoColumn: Boolean(hasAutoconsumoColumn),
      isDatadisMonthly: Boolean(isDatadisMonthly)
    };
  }

  // ===== INTERFAZ PÚBLICA =====
  /**
   * Importa archivo CSV/XLSX con datos de consumo.
   * @param {File} file - Archivo a importar
   * @param {string} zona - Zona CNMC ('Península'|'Canarias'|'CeutaMelilla'). Opcional.
   * @returns {Promise<Object>} {ok, records, warnings, error}
   */
  window.BVSim.importFile = async function (file, zona = null) {
    if (!file) {
      return { ok: false, error: 'No se ha seleccionado ningún archivo.' };
    }

    // Validar tamaño (máximo 10 MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = Math.round(file.size / 1024 / 1024);
      return {
        ok: false,
        error: `El archivo es demasiado grande (${sizeMB} MB). El tamaño máximo permitido es 10 MB.`
      };
    }

    const extension = file.name.split('.').pop().toLowerCase();

    // Validar MIME type para mayor seguridad
    if (extension === 'csv') {
      if (file.type && !file.type.includes('text/') && !file.type.includes('application/')) {
        // Warning: algunos CSV vienen con mime type vacío o excel, permitimos si la extensión es csv
        // return { ok: false, error: 'El archivo no parece ser un CSV válido.' };
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      // Permitir validación laxa de mime para excel
    } else {
      return { ok: false, error: 'Formato no soportado. Solo CSV y Excel (.xlsx, .xls).' };
    }

    try {
      let parsed;

      if (extension === 'csv') {
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(new Error('Error al leer el archivo CSV'));
          reader.readAsText(file);
        });
        parsed = parseCSVConsumos(content, zona);
      } else {
        const buffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(new Error('Error al leer el archivo Excel'));
          reader.readAsArrayBuffer(file);
        });
        parsed = await parseXLSXConsumos(buffer, zona);
      }

      const records = Array.isArray(parsed.records) ? parsed.records : [];
      if (records.length === 0) {
        const message = buildImportError
          ? buildImportError('El archivo no contiene datos de consumo válidos o reconocibles.').message
          : 'El archivo no contiene datos de consumo válidos o reconocibles.';
        return { ok: false, error: message };
      }

      const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
      if (typeof validateCsvSpanFromRecords === 'function') {
        // Comparador solar: acepta hasta 12 meses; si llegan 13, recorta a 12.
        const spanCheck = validateCsvSpanFromRecords(records, {
          maxDays: 370,
          requireExactly12Months: true,  // ← Modo solar: máximo 13 meses, ajuste a 12 si procede
          coverageThreshold: 80,         // ← 80% mínimo de cobertura por mes
          isDatadisMonthly: parsed.isDatadisMonthly || false
        });

        if (!spanCheck.ok) {
          return { ok: false, error: spanCheck.error };
        }

        // Aplicar filtro de meses si es necesario
        if (Array.isArray(spanCheck.monthsToDrop) && spanCheck.monthsToDrop.length > 0) {
          const monthsToDrop = new Set(spanCheck.monthsToDrop);
          const filtered = records.filter((record) => {
            const fecha = record && record.fecha;
            if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return false;
            return !monthsToDrop.has(ymLocal(fecha));
          });
          if (filtered.length === 0) {
            return {
              ok: false,
              error: 'Tras aplicar el recorte a 12 meses, no quedan registros válidos para procesar.'
            };
          }
          parsed.records = filtered;
          if (spanCheck.warning) warnings.push(spanCheck.warning);
        }
      }

      const filteredRecords = Array.isArray(parsed.records) ? parsed.records : [];
      const meta = buildMeta(filteredRecords, parsed.hasExcedenteColumn, parsed.hasAutoconsumoColumn, parsed.isDatadisMonthly || false);

      return {
        ok: true,
        records: filteredRecords,
        meta,
        warnings
      };
    } catch (error) {
      console.error('Error importando fichero:', error);
      return {
        ok: false,
        error: error?.message || 'Error al procesar el archivo.'
      };
    }
  };
})();
