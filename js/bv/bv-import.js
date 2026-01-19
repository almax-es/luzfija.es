window.BVSim = window.BVSim || {};

(function () {
  'use strict';

  let xlsxLoading = null;

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    if (xlsxLoading) return xlsxLoading;

    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/xlsx/xlsx.full.min.js', document.baseURI).toString();
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Error al cargar librería XLSX'));
      document.head.appendChild(script);
    });

    return xlsxLoading;
  }

  function stripBomAndTrim(value) {
    return String(value ?? '').replace(/^\uFEFF/, '').trim();
  }

  function stripOuterQuotes(value) {
    let str = stripBomAndTrim(value);
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1).trim();
    }
    return str;
  }

  function parseNumberFlexibleCSV(value) {
    const raw = stripOuterQuotes(value);
    if (!raw) return NaN;

    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    let norm = raw;

    if (hasComma && hasDot) {
      if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
        norm = raw.replace(/\./g, '').replace(',', '.');
      } else {
        norm = raw.replace(/,/g, '');
      }
    } else if (hasComma && !hasDot) {
      norm = raw.replace(',', '.');
    }

    return Number(norm);
  }

  function parseCSVConsumos(fileContent) {
    const lines = String(fileContent || '').split('\n');
    if (lines.length < 2) throw new Error('CSV vacío o inválido');

    const header = stripBomAndTrim(lines[0]).toLowerCase();
    const isIberdrolaCliente = header.includes('consumo wh') && header.includes('generacion wh');
    const isFormatoEspanol = header.includes('ae_kwh') || header.includes('consumo_kwh');

    if (!isFormatoEspanol && !isIberdrolaCliente) {
      throw new Error('Formato CSV no reconocido. Se esperaba el formato estándar de distribuidoras españolas');
    }

    if (isIberdrolaCliente) {
      return parseCSVIberdrolaCliente(lines);
    }

    const tieneSolar = header.includes('as_kwh');
    const tieneAutoconsumo = header.includes('ae_autocons_kwh');
    const records = [];

    // Detectar separador más probable en la primera línea de datos
    let separator = ';';
    if (lines.length > 1) {
      const firstLine = lines[1];
      const countSemi = (firstLine.match(/;/g) || []).length;
      const countComma = (firstLine.match(/,/g) || []).length;
      if (countComma > countSemi) separator = ',';
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(separator);
      if (cols.length < 4) continue;

      // ... resto del código igual, usando 'cols' ...

      const fechaStr = stripOuterQuotes(cols[1]);
      const hora = parseInt(stripOuterQuotes(cols[2]), 10);
      const kwhStr = stripOuterQuotes(cols[3]);
      const excedenteStr = tieneSolar ? cols[4] : null;
      const autoconsumoStr = tieneAutoconsumo ? cols[5] : null;
      
      // Calcular índice de la columna REAL/ESTIMADO dinámicamente
      let idxReal = 4;
      if (tieneSolar) idxReal++;
      if (tieneAutoconsumo) idxReal++;
      
      const estadoStr = stripOuterQuotes(cols[idxReal]);
      const esReal = estadoStr === 'R';

      if (!kwhStr || kwhStr.trim() === '') continue;

      const kwh = parseNumberFlexibleCSV(kwhStr);
      if (isNaN(kwh)) continue;

      let excedente = 0;
      if (excedenteStr && excedenteStr.trim() !== '') {
        const exc = parseNumberFlexibleCSV(excedenteStr);
        if (!isNaN(exc)) excedente = exc;
      }

      let autoconsumo = 0;
      if (autoconsumoStr && autoconsumoStr.trim() !== '') {
        const auto = parseNumberFlexibleCSV(autoconsumoStr);
        if (!isNaN(auto)) autoconsumo = auto;
      }

      const [dia, mes, año] = String(fechaStr || '').split('/').map(Number);
      const fecha = new Date(año, mes - 1, dia);
      if (isNaN(fecha.getTime())) continue;

      records.push({ fecha, hora, kwh, excedente, autoconsumo, esReal });
    }

    return {
      records,
      hasExcedenteColumn: tieneSolar,
      hasAutoconsumoColumn: tieneAutoconsumo
    };
  }

  function parseCSVIberdrolaCliente(lines) {
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',');
      if (cols.length < 6) continue;

      const fechaHoraStr = stripOuterQuotes(cols[1]);
      const consumoWhStr = stripOuterQuotes(cols[4]);
      const generacionWhStr = stripOuterQuotes(cols[5]);

      if (!fechaHoraStr || !consumoWhStr) continue;

      const [fechaParte, horaParte] = fechaHoraStr.split(' ');
      if (!fechaParte || !horaParte) continue;

      const [año, mes, dia] = fechaParte.split('/').map(Number);
      const horaNum = parseInt(horaParte.split(':')[0], 10);
      const fecha = new Date(año, mes - 1, dia);
      if (isNaN(fecha.getTime())) continue;

      const hora = horaNum + 1;
      const consumoWh = parseNumberFlexibleCSV(consumoWhStr);
      if (isNaN(consumoWh)) continue;
      const kwh = consumoWh / 1000;

      let excedente = 0;
      if (generacionWhStr && generacionWhStr.trim() !== '') {
        const generacionWh = parseNumberFlexibleCSV(generacionWhStr);
        if (!isNaN(generacionWh)) excedente = generacionWh / 1000;
      }

      records.push({ fecha, hora, kwh, excedente, autoconsumo: 0, esReal: true });
    }

    return {
      records,
      hasExcedenteColumn: true,
      hasAutoconsumoColumn: false
    };
  }

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

  function getFestivosNacionales(year) {
    return [
      `${year}-01-01`, `${year}-01-06`,
      calcularViernesSanto(year),
      `${year}-05-01`, `${year}-08-15`, `${year}-10-12`,
      `${year}-11-01`, `${year}-12-06`, `${year}-12-08`, `${year}-12-25`
    ];
  }

  function getPeriodoHorarioCSV(fecha, hora) {
    const diaSemana = fecha.getDay();
    const esFinde = diaSemana === 0 || diaSemana === 6;

    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    const fechaStr = `${year}-${month}-${day}`;

    const festivosNacionales = getFestivosNacionales(year);
    const esFestivo = festivosNacionales.includes(fechaStr);

    if (esFinde || esFestivo) return 'P3';

    const horaInicio = hora - 1;
    if (horaInicio >= 0 && horaInicio < 8) return 'P3';
    if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) return 'P1';
    return 'P2';
  }

  function parseDateFlexible(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return value;

    const str = String(value ?? '').trim();
    if (!str) return null;

    const firstToken = str.split(' ')[0];

    let match = firstToken.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
      const d = Number(match[1]);
      const mo = Number(match[2]);
      const y = Number(match[3]);
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    match = firstToken.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      const y = Number(match[1]);
      const mo = Number(match[2]);
      const d = Number(match[3]);
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const dt = new Date(firstToken);
    return isNaN(dt.getTime()) ? null : dt;
  }

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

  async function parseXLSXConsumos(fileBuffer) {
    await ensureXLSX();

    const workbook = XLSX.read(fileBuffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

    if (data.length < 2) {
      throw new Error('Archivo Excel vacío o formato no reconocido');
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

    let headerRow = -1;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      if (row && row.some(cell => String(cell).toUpperCase().includes('FECHA'))) {
        headerRow = i;
        break;
      }
    }

    if (headerRow === -1) {
      throw new Error('No se encontró la fila de cabecera en el Excel');
    }

    const headers = data[headerRow];
    if (!headers || headers.length < 4) {
      throw new Error('Formato Excel no reconocido');
    }

    const colFechaHora = headers.findIndex(h => String(h).toUpperCase().includes('FECHA'));
    const colPeriodo = headers.findIndex(h => {
      const hStr = String(h).toUpperCase();
      return hStr.includes('PERIODO') && hStr.includes('TARIFARIO');
    });
    const colConsumo = headers.findIndex(h => String(h).toUpperCase().includes('CONSUMO'));
    const colGeneracion = headers.findIndex(h => String(h).toUpperCase().includes('GENERACION'));

    if (colFechaHora === -1 || colConsumo === -1 || colGeneracion === -1) {
      throw new Error('No se encontraron las columnas necesarias en el Excel');
    }

    const records = [];

    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 4) continue;

      const fechaHoraStr = row[colFechaHora];
      const periodoTarifario = colPeriodo !== -1 ? String(row[colPeriodo] || '').trim() : '';
      const consumoWh = parseFloat(row[colConsumo]) || 0;
      const generacionWh = parseFloat(row[colGeneracion]) || 0;

      if (!fechaHoraStr) continue;

      const [fechaStr, horaStr] = String(fechaHoraStr).split(' ');
      if (!fechaStr || !horaStr) continue;

      const [año, mes, dia] = fechaStr.split('/').map(Number);
      const horaXLSX = parseInt(horaStr.split(':')[0], 10);
      const horaCNMC = horaXLSX + 1;

      const fecha = new Date(año, mes - 1, dia);
      if (isNaN(fecha.getTime())) continue;

      const consumoKwh = consumoWh / 1000;
      const generacionKwh = generacionWh / 1000;

      let periodo = null;
      if (periodoTarifario) {
        const pUpper = periodoTarifario.toUpperCase();
        if (pUpper.includes('PUNTA') || pUpper === 'P1') periodo = 'P1';
        else if (pUpper.includes('LLANO') || pUpper === 'P2') periodo = 'P2';
        else if (pUpper.includes('VALLE') || pUpper === 'P3') periodo = 'P3';
      }

      records.push({
        fecha,
        hora: horaCNMC,
        kwh: consumoKwh,
        excedente: generacionKwh,
        autoconsumo: 0,
        periodo,
        esReal: true
      });
    }

    return {
      records,
      hasExcedenteColumn: true,
      hasAutoconsumoColumn: false
    };
  }

  function ymdLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

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
      return { ok: false, error: 'No se ha seleccionado ningún archivo.' };
    }

    const extension = file.name.split('.').pop().toLowerCase();

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
      } else {
        return { ok: false, error: 'Formato no soportado. Solo CSV y Excel (.xlsx, .xls)' };
      }

      const records = Array.isArray(parsed.records) ? parsed.records : [];
      if (records.length === 0) {
        return { ok: false, error: 'No se encontraron datos válidos en el archivo.' };
      }

      if (!parsed.hasExcedenteColumn) {
        return {
          ok: false,
          error: 'El archivo no incluye excedentes/exportación; esta herramienta es solo para autoconsumo con BV.'
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
