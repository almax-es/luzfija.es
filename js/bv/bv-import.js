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
      script.onerror = () => reject(new Error('Error al cargar librería XLSX'));
      document.head.appendChild(script);
    });

    return xlsxLoading;
  }

  // ===== FUNCIONES DE PARSING =====
  // NOTA: Las funciones stripBomAndTrim, stripOuterQuotes, parseNumberFlexibleCSV,
  // splitCSVLine ahora se importan desde lf-csv-utils.js (líneas 6-17)

  function parseCSVConsumos(fileContent) {
    const lines = String(fileContent || '').split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV vacío o inválido');

    const header = stripBomAndTrim(lines[0]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isIberdrolaCliente = header.includes('consumo wh') && header.includes('generacion wh');
    const isFormatoEspanol = header.includes('ae_kwh') || header.includes('consumo_kwh');

    if (!isFormatoEspanol && !isIberdrolaCliente) {
      throw new Error('Formato CSV no reconocido. Se esperaba el formato estándar de distribuidoras españolas');
    }

    if (isIberdrolaCliente) {
      return parseCSVIberdrolaCliente(lines);
    }

    const isDatadisNuevo = header.includes('consumo_kwh') && header.includes('metodoobtencion') && header.includes('energiavertida_kwh');

    const tieneSolar = header.includes('as_kwh') || header.includes('energiavertida_kwh');
    const tieneAutoconsumo = header.includes('ae_autocons_kwh') || header.includes('energiaautoconsumida_kwh');
    const records = [];

    // Detectar separador de forma robusta usando la cabecera (evita falsos positivos por decimales con coma).
    let separator = ';';
    {
      const headerLine = stripBomAndTrim(lines[0]);
      const semi = (headerLine.match(/;/g) || []).length;
      const comma = (headerLine.match(/,/g) || []).length;
      if (semi === 0 && comma === 0) {
        separator = ';';
      } else {
        separator = semi >= comma ? ';' : ',';
      }
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = splitCSVLine(line, separator);
      if (cols.length < 4) continue;

      // ... resto del código igual, usando 'cols' ...

      const fechaStr = stripOuterQuotes(cols[1]);
      const hora = parseInt(stripOuterQuotes(cols[2]), 10);
      if (hora < 1 || hora > 25) continue; // Hora fuera de rango (soporta d�a de 25 horas)
      const kwhStr = stripOuterQuotes(cols[3]);

let excedenteStr = null;
let autoconsumoStr = null;
let estadoStr = '';

if (isDatadisNuevo) {
  // cups;fecha;hora;consumo_kWh;metodoObtencion;energiaVertida_kWh;energiaGenerada_kWh;energiaAutoconsumida_kWh
  excedenteStr = cols[5];
  autoconsumoStr = cols[7];
  estadoStr = cols.length > 4 ? stripOuterQuotes(cols[4]) : '';
} else {
  excedenteStr = tieneSolar ? cols[4] : null;
  autoconsumoStr = tieneAutoconsumo ? cols[5] : null;

  // Calcular índice de la columna REAL/ESTIMADO dinámicamente
  let idxReal = 4;
  if (tieneSolar) idxReal++;
  if (tieneAutoconsumo) idxReal++;

  estadoStr = idxReal < cols.length ? stripOuterQuotes(cols[idxReal]) : '';
}

const esReal = isDatadisNuevo
  ? (estadoStr.toLowerCase().startsWith('real') || estadoStr === 'R')
  : (estadoStr === 'R');


      if (!kwhStr || kwhStr.trim() === '') continue;

      const kwh = parseNumberFlexibleCSV(kwhStr);
      if (isNaN(kwh) || kwh < 0 || kwh > 10000) continue; // Filtrar valores absurdos

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

      const fecha = parseDateFlexible(fechaStr);
      if (!fecha) continue;

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

    // Formato i-DE / Iberdrola: normalmente
    // CUPS;FECHA-HORA;INV / VER;PERIODO TARIFARIO;CONSUMO Wh;GENERACION Wh;
    // (puede venir con ';' final). Además puede haber 25ª hora (cambio horario de octubre).
    const headerLine = stripBomAndTrim(lines[0]);
    const separator = detectCSVSeparator(headerLine);

    const normHeader = (h) => stripOuterQuotes(String(h ?? ''))
      .trim()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');

    const headerColsRaw = splitCSVLine(headerLine, separator);
    const headerKeys = headerColsRaw.map(normHeader);

    const idxFechaHora = headerKeys.indexOf('fechahora');
    const idxConsumoWh = headerKeys.indexOf('consumowh');
    const idxGeneracionWh = headerKeys.indexOf('generacionwh');
    const idxInvVer = headerKeys.indexOf('invver');
    const idxPeriodoTar = headerKeys.indexOf('periodotarifario');

    if (idxFechaHora < 0 || idxConsumoWh < 0 || idxGeneracionWh < 0) {
      throw new Error('Formato Iberdrola no reconocido: faltan columnas FECHA-HORA / CONSUMO Wh / GENERACION Wh');
    }

    const mapPeriodo = (raw) => {
      const p = String(raw ?? '').trim().toUpperCase();
      if (!p) return null;
      if (p.includes('PUNTA') || p === 'P1') return 'P1';
      if (p.includes('LLANO') || p === 'P2') return 'P2';
      if (p.includes('VALLE') || p === 'P3') return 'P3';
      return null;
    };

    const seen = new Map();
    function ymdKeyLocal(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    function computeHoraCNMC(fechaObj, hourNum, invVerRaw) {
      if (hourNum === 2) {
  // Día normal: solo hay un 02:00 (INV/VER suele ser 0 en todo invierno).
  // Día cambio horario (fin de octubre): 02:00 aparece dos veces. Mapear a 3 y 25 según ocurrencia/INV/VER.
  const key = `${ymdKeyLocal(fechaObj)}|02`;
  const c = (seen.get(key) || 0) + 1;
  seen.set(key, c);

  const inv = String(invVerRaw ?? '').trim();
  if (inv === '1') return 3;          // 02:00 en horario de verano (primera)
  if (inv === '0') return (c >= 2) ? 25 : 3; // 02:00 repetida (segunda) solo si hay duplicidad

  // Fallback si INV/VER no viene o es distinto: por orden de aparición
  if (c === 1) return 3;
  if (c === 2) return 25;
}
return hourNum + 1;
    }

    for (let i = 1; i < lines.length; i++) {
      const line = String(lines[i] ?? '').trim();
      if (!line) continue;

      let cols = splitCSVLine(line, separator);
      if (cols.length && String(cols[cols.length - 1]).trim() === '') cols = cols.slice(0, -1);

      if (cols.length <= Math.max(idxFechaHora, idxConsumoWh, idxGeneracionWh)) continue;

      const fechaHoraStr = stripOuterQuotes(cols[idxFechaHora]);
      const consumoWhStr = stripOuterQuotes(cols[idxConsumoWh]);
      const generacionWhStr = stripOuterQuotes(cols[idxGeneracionWh]);
      const invVerStr = idxInvVer !== -1 ? stripOuterQuotes(cols[idxInvVer]) : '';
      const periodoTarStr = idxPeriodoTar !== -1 ? stripOuterQuotes(cols[idxPeriodoTar]) : '';

      if (!fechaHoraStr) continue;

      const [fechaParte, horaParte] = String(fechaHoraStr).split(' ');
      if (!fechaParte || !horaParte) continue;

      const hourNum = parseInt(String(horaParte).split(':')[0], 10);
      if (!Number.isFinite(hourNum) || hourNum < 0 || hourNum > 23) continue;

      const fecha = parseDateFlexible(fechaParte);
      if (!fecha) continue;

      const hora = computeHoraCNMC(fecha, hourNum, invVerStr);
      if (hora < 1 || hora > 25) continue;

      const consumoWh = parseNumberFlexibleCSV(consumoWhStr);
      const generacionWh = parseNumberFlexibleCSV(generacionWhStr);

      const importKwh = Number.isFinite(consumoWh) ? (consumoWh / 1000) : 0;
      const exportKwh = Number.isFinite(generacionWh) ? (generacionWh / 1000) : 0;

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
  // parseDateFlexible, parseNumberFlexible ahora se importan desde lf-csv-utils.js (líneas 6-17)

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

    const colInvVer = headers.findIndex(h => {
      const hStr = String(h).toUpperCase().replace(/\s+/g, '');
      return hStr.includes('INV') && hStr.includes('VER');
    });

    const mapPeriodo = (raw) => {
      const p = String(raw ?? '').trim().toUpperCase();
      if (!p) return null;
      if (p.includes('PUNTA') || p === 'P1') return 'P1';
      if (p.includes('LLANO') || p === 'P2') return 'P2';
      if (p.includes('VALLE') || p === 'P3') return 'P3';
      return null;
    };

    const seen = new Map();
    function ymdKeyLocal(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    function computeHoraCNMC(fechaObj, hourNum, invVerRaw) {
      if (hourNum === 2) {
  // Día normal: solo hay un 02:00 (INV/VER suele ser 0 en todo invierno).
  // Día cambio horario (fin de octubre): 02:00 aparece dos veces. Mapear a 3 y 25 según ocurrencia/INV/VER.
  const key = `${ymdKeyLocal(fechaObj)}|02`;
  const c = (seen.get(key) || 0) + 1;
  seen.set(key, c);

  const inv = String(invVerRaw ?? '').trim();
  if (inv === '1') return 3;          // 02:00 en horario de verano (primera)
  if (inv === '0') return (c >= 2) ? 25 : 3; // 02:00 repetida (segunda) solo si hay duplicidad

  // Fallback si INV/VER no viene o es distinto: por orden de aparición
  if (c === 1) return 3;
  if (c === 2) return 25;
}
return hourNum + 1;
    }

    const records = [];

    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 2) continue;

      const fechaHoraRaw = row[colFechaHora];
      if (!fechaHoraRaw) continue;

      const periodoTarifario = colPeriodo !== -1 ? String(row[colPeriodo] || '').trim() : '';
      const invVerRaw = colInvVer !== -1 ? row[colInvVer] : '';

      const consumoWhRaw = parseNumberFlexible(row[colConsumo]);
      const generacionWhRaw = parseNumberFlexible(row[colGeneracion]);
      const consumoWh = Number.isFinite(consumoWhRaw) ? consumoWhRaw : 0;
      const generacionWh = Number.isFinite(generacionWhRaw) ? generacionWhRaw : 0;

      const fechaHoraStr = String(fechaHoraRaw);
      const [fechaStr, horaStr] = fechaHoraStr.split(' ');
      if (!fechaStr || !horaStr) continue;

      const fecha = parseDateFlexible(fechaStr);
      if (!fecha) continue;

      const hourNum = parseInt(horaStr.split(':')[0], 10);
      if (!Number.isFinite(hourNum) || hourNum < 0 || hourNum > 23) continue;

      const horaCNMC = computeHoraCNMC(fecha, hourNum, invVerRaw);

      const importKwh = consumoWh / 1000;
      const exportKwh = generacionWh / 1000;

      const kwh = Math.max(importKwh - exportKwh, 0);
      const excedente = Math.max(exportKwh - importKwh, 0);

      const periodo = mapPeriodo(periodoTarifario);

      records.push({
        fecha,
        hora: horaCNMC,
        kwh,
        excedente,
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
        return { ok: false, error: 'El archivo no parece ser un CSV válido.' };
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      const validMimes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/octet-stream' // Algunos sistemas usan esto para xlsx
      ];
      if (file.type && !validMimes.some(mime => file.type.includes(mime))) {
        return { ok: false, error: 'El archivo no parece ser un Excel válido.' };
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
        return { ok: false, error: 'No se encontraron datos válidos en el archivo.' };
      }

      if (!parsed.hasExcedenteColumn) {
        return {
          ok: false,
          error: 'El archivo no tiene datos de excedentes (columna AS_kWh o similar). Asegúrate de descargar el informe de "Autoconsumo" o "Excedentes" desde tu distribuidora, no solo el de consumo.'
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
