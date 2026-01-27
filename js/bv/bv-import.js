window.BVSim = window.BVSim || {};

(function () {
  'use strict';

  // ===== IMPORTAR UTILIDADES CSV =====
  const {
    parseDateFlexible,
    parseNumberFlexible,
    parseNumberFlexibleCSV,
    getPeriodoHorarioCSV,
    ymdLocal,
    buildImportError
  } = window.LF.csvUtils || {};

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

    return xlsxLoading;
  }

  // ===== PARSEO CSV =====
  function parseCSVConsumos(fileContent) {
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
      headerRowIndex
    });
  }

  // ===== PARSEO XLSX =====
  async function parseXLSXConsumos(fileBuffer) {
    await ensureXLSX();

    const workbook = XLSX.read(fileBuffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

    if (!data || data.length < 2) {
      throw buildImportError('Archivo Excel vacío o formato no reconocido.');
    }

    const { parseEnergyTableRows, guessEnergyHeaderRow } = window.LF.csvUtils || {};
    if (typeof parseEnergyTableRows !== 'function' || typeof guessEnergyHeaderRow !== 'function') {
      throw new Error('No se pudo cargar el parser de Excel');
    }

    // --- Soporte matriz horaria (E-REDES) ---
    function isHourlyMatrixHeaderRow(row) {
      if (!Array.isArray(row)) return false;
      for (let h = 1; h <= 24; h++) {
        const expected = `H${String(h).padStart(2, '0')}`;
        const got = String(row[h] ?? '').trim().toUpperCase();
        if (got !== expected) return false;
      }
      return true;
    }

    function parseXLSXConsumosMatriz(data, headerRow) {
      const records = [];
      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
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
        warnings: ['Formato matriz horaria detectado (excedentes = 0).'],
        hasExcedenteColumn: false,
        hasAutoconsumoColumn: false
      };
    }

    // Detectar matriz horaria
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

    // Formato estándar (columnas)
    const headerRow = guessEnergyHeaderRow(data);
    if (headerRow === -1) {
      throw buildImportError('No se encontró la fila de cabecera en el Excel.');
    }

    return parseEnergyTableRows(data, {
      headerRowIndex: headerRow,
      parseNumber: parseNumberFlexible
    });
  }

  // ===== UTILIDAD DE FORMATO =====
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

  // ===== INTERFAZ PÚBLICA =====
  window.BVSim.importFile = async function (file) {
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
        parsed = parseCSVConsumos(content);
      } else {
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
        const message = buildImportError
          ? buildImportError('El archivo no contiene datos de consumo válidos o reconocibles.').message
          : 'El archivo no contiene datos de consumo válidos o reconocibles.';
        return { ok: false, error: message };
      }

      const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
      const meta = buildMeta(records, parsed.hasExcedenteColumn, parsed.hasAutoconsumoColumn);

      // Validar rango de fechas (máximo ~1 año)
      if (meta.start && meta.end) {
        const dStart = new Date(meta.start);
        const dEnd = new Date(meta.end);
        const diffTime = Math.abs(dEnd - dStart);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        if (diffDays > 370) {
          return { ok: false, error: 'El archivo contiene más de 12 meses (' + diffDays + ' días). Por favor, sube un fichero de máximo 1 año.' };
        }
      }

      return {
        ok: true,
        records,
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
