window.BVSim = window.BVSim || {};

(function () {
  'use strict';

  // ===== IMPORTAR UTILIDADES CSV =====
  // Funciones robustas de parsing compartidas con lf-csv-import.js
  const {
    stripBomAndTrim,
    stripOuterQuotes,
    parseNumberFlexibleCSV,
    parseNumberFlexible,
    splitCSVLine,
    detectCSVSeparator,
    parseDateFlexible,
    calcularViernesSanto,
    getFestivosNacionales,
    getPeriodoHorarioCSV,
    ymdLocal
  } = window.LF.csvUtils || {};

  let xlsxLoading = null;

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    if (xlsxLoading) return xlsxLoading;

    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/xlsx/xlsx.full.min.js', document.baseURI).toString();
      script.onload = () => resolve();
    const { parseCSVToRows, parseEnergyTableRows } = window.LF.csvUtils || {};
    if (typeof parseCSVToRows !== 'function' || typeof parseEnergyTableRows !== 'function') {
      throw new Error('No se pudo cargar el parser de CSV');
    const { rows } = parseCSVToRows(fileContent);
    return parseEnergyTableRows(rows, { parseNumber: parseNumberFlexibleCSV });
      const kwh = Math.max(importKwh - exportKwh, 0);
      const excedente = Math.max(exportKwh - importKwh, 0);

      const periodo = mapPeriodo(periodoTarStr);

      records.push({ fecha, hora, kwh, excedente, autoconsumo: 0, periodo, esReal: true });
    }

    return {
      records,
      hasExcedenteColumn: true,
      hasAutoconsumoColumn: false
    };
  }

  // ===== FESTIVOS Y PERIODOS =====
  // NOTA: Las funciones calcularViernesSanto, getFestivosNacionales, getPeriodoHorarioCSV,
  // parseDateFlexible, parseNumberFlexible ahora se importan desde lf-csv-utils.js (lÃ­neas 6-17)

  async function parseXLSXConsumos(fileBuffer) {
    await ensureXLSX();

    const workbook = XLSX.read(fileBuffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

    if (data.length < 2) {
      throw new Error('Archivo Excel vacÃ­o o formato no reconocido');
    }

    function isHourlyMatrixHeaderRow(row) {
      if (!Array.isArray(row)) return false;
      for (let h = 1; h <= 24; h++) {
        const expected = `H${String(h).padStart(2, '0')}`;
        const got = String(row[h] ?? '').trim().toUpperCase();
        if (got !== expected) return false;
      }
      return true;
    }

    function parseXLSXConsumosMatriz(dataRows, headerRow) {
      const records = [];

      for (let i = headerRow + 1; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (!row || row.length < 2) continue;

        const fecha = parseDateFlexible(row[0]);
        if (!fecha) continue;

        for (let h = 1; h <= 24; h++) {
          let kwh = parseNumberFlexible(row[h]);
          if (!Number.isFinite(kwh)) kwh = 0;

          const periodo = getPeriodoHorarioCSV(fecha, h);

          records.push({
            fecha,
            hora: h,
            kwh,
            excedente: 0,
            autoconsumo: 0,
            periodo,
            esReal: true
          });
        }
      }

      return {
        records,
        warnings: ['No se detectaron excedentes; se importará con excedentes=0.'],
        hasExcedenteColumn: false,
        hasAutoconsumoColumn: false
      };
    }

    let matrixHeaderRow = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      if (isHourlyMatrixHeaderRow(data[i])) {
        matrixHeaderRow = i;
        break;
      }
    }
    if (matrixHeaderRow !== -1) {
      return parseXLSXConsumosMatriz(data, matrixHeaderRow);
    }

    const { parseEnergyTableRows, guessEnergyHeaderRow } = window.LF.csvUtils || {};
    if (typeof parseEnergyTableRows !== 'function' || typeof guessEnergyHeaderRow !== 'function') {
      throw new Error('No se pudo cargar el parser de Excel');
    }

    const headerRow = guessEnergyHeaderRow(data);
    if (headerRow === -1) {
    return parseEnergyTableRows(data, {
      headerRowIndex: headerRow,
      parseNumber: parseNumberFlexible
      records,
      hasExcedenteColumn: true,
      hasAutoconsumoColumn: false
    };
  }

  // ===== UTILIDAD DE FORMATO =====
  // NOTA: ymdLocal ahora se importa desde lf-csv-utils.js

  function buildMeta(records, hasExcedenteColumn, hasAutoconsumoColumn) {
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
      hasAutoconsumoColumn: Boolean(hasAutoconsumoColumn)
    };
  }

  window.BVSim.importFile = async function (file) {
    if (!file) {
      return { ok: false, error: 'No se ha seleccionado ningÃºn archivo.' };
    }

    // Validar tamaÃ±o (mÃ¡ximo 10 MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = Math.round(file.size / 1024 / 1024);
      return {
        ok: false,
        error: `El archivo es demasiado grande (${sizeMB} MB). El tamaÃ±o mÃ¡ximo permitido es 10 MB.`
      };
    }

    const extension = file.name.split('.').pop().toLowerCase();

    // Validar MIME type para mayor seguridad
    if (extension === 'csv') {
      if (file.type && !file.type.includes('text/') && !file.type.includes('application/')) {
        return { ok: false, error: 'El archivo no parece ser un CSV vÃ¡lido.' };
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      const validMimes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/octet-stream' // Algunos sistemas usan esto para xlsx
      ];
      if (file.type && !validMimes.some(mime => file.type.includes(mime))) {
        return { ok: false, error: 'El archivo no parece ser un Excel vÃ¡lido.' };
      }
    } else {
      return { ok: false, error: 'Formato no soportado. Solo CSV y Excel (.xlsx, .xls).' };
    }

    try {
      let parsed;

      if (extension === 'csv') {
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(new Error('Error al leer el archivo'));
          reader.readAsText(file);
        });
        parsed = parseCSVConsumos(content);
      } else if (extension === 'xlsx' || extension === 'xls') {
        const buffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(new Error('Error al leer el archivo Excel'));
          reader.readAsArrayBuffer(file);
        });
        parsed = await parseXLSXConsumos(buffer);
      }

      const records = Array.isArray(parsed.records) ? parsed.records : [];
      if (records.length === 0) {
      const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
        meta,
        warnings
        };
      }

      const meta = buildMeta(records, parsed.hasExcedenteColumn, parsed.hasAutoconsumoColumn);

      return {
        ok: true,
        records,
        meta
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || 'Error al procesar el archivo.'
      };
    }
  };
})();
