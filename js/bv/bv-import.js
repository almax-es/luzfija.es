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
    if (lines.length < 2) throw new Error('CSV vacio o invalido');

    const headerLineRaw = stripBomAndTrim(lines[0]);
    const headerForDetect = headerLineRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1) Formato i-DE / Iberdrola (cliente) bruto (consumo + generacion simultaneos)
    const isIberdrolaCliente = headerForDetect.includes('consumo wh') && headerForDetect.includes('generacion wh');
    if (isIberdrolaCliente) {
      return parseCSVIberdrolaCliente(lines);
    }

    // 2) Formato estandar (distribuidoras / Datadis) -> mapeo por cabeceras (sin wizard, fail-closed)
    // Detectar separador de forma robusta usando la cabecera (evita falsos positivos por decimales con coma).
    let separator = ';';
    {
      const semi = (headerLineRaw.match(/;/g) || []).length;
      const comma = (headerLineRaw.match(/,/g) || []).length;
      if (semi === 0 && comma === 0) {
        separator = ';';
      } else {
        separator = semi >= comma ? ';' : ',';
      }
    }

    const headerColsRaw = splitCSVLine(headerLineRaw, separator);

    const normKey = (h) => stripOuterQuotes(String(h ?? ''))
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase -> snake_case
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\(.*?\)/g, '')           // quita parentesis (p.ej. (kWh))
      .replace(/[^a-z0-9]+/g, '_')        // separadores -> _
      .replace(/^_+|_+$/g, '')            // trim _
      .replace(/_+/g, '_');               // colapsa __

    const headerKeys = headerColsRaw.map(normKey);

    const ALIAS = {
      // basicos
      fecha: ['fecha', 'date', 'dia'],
      hora: ['hora', 'hour', 'periodo', 'intervalo'],
      // consumo / excedentes neteados
      consumo: [
        'ae_kwh', 'consumo_kwh', 'energia_consumida_kwh', 'energia_consumida',
        'import_kwh', 'importacion_kwh', 'energia_activa_importada_kwh',
        'ae_k_wh',
        'consumo_k_wh',
        'energia_consumida_k_wh'
      ],
      excedente: [
        'as_kwh', 'energia_vertida_kwh', 'energia_vertida', 'vertido_kwh',
        'excedente_kwh', 'export_kwh', 'exportacion_kwh', 'inyeccion_kwh',
        'energia_activa_exportada_kwh',
        'energiavertida_kwh',
        'energiavertida',
        'as_k_wh',
        'energia_vertida_k_wh'
      ],
      autoconsumo: [
        'ae_autocons_kwh', 'energia_autoconsumida_kwh', 'energia_autoconsumida',
        'autoconsumo_kwh',
        'energiaautoconsumida_kwh',
        'energiaautoconsumida',
        'ae_k_wh',
        'consumo_k_wh',
        'energia_consumida_k_wh'
      ],
      // calidad / real-estimado
      realEstimado: ['real_estimado', 'realest', 'metodoobtencion', 'metodo_obtencion'],
    };

    const sampleForSupport = () => {
      const sample = [];
      for (let i = 0; i < Math.min(lines.length, 6); i++) {
        if (lines[i] && String(lines[i]).trim() !== '') sample.push(String(lines[i]).trim());
      }
      return sample.join('\n');
    };

    const supportHint = () => (
      '\n\n---\n' +
      'Si tu archivo no se importa, envia a hola@luzfija.es: (1) tu distribuidora, (2) el archivo o (3) al menos estas lineas de ejemplo:\n' +
      sampleForSupport() +
      '\n---'
    );

    const findCandidates = (aliases) => {
      const set = new Set(aliases);
      const idxs = [];
      for (let i = 0; i < headerKeys.length; i++) {
        if (set.has(headerKeys[i])) idxs.push(i);
      }
      return idxs;
    };

    const pickUniqueIndex = (aliases, fieldLabel, required) => {
      const idxs = findCandidates(aliases);
      if (idxs.length === 1) return idxs[0];
      if (idxs.length === 0) {
        if (required) throw new Error(`CSV no reconocido: no se encontro una columna de ${fieldLabel}.${supportHint()}`);
        return -1;
      }
      const names = idxs.map(i => stripOuterQuotes(String(headerColsRaw[i] ?? '')).trim()).filter(Boolean).join(', ');
      throw new Error(`CSV ambiguo: se han encontrado varias columnas candidatas para ${fieldLabel}: ${names}.${supportHint()}`);
    };

    // Columnas obligatorias
    const idxFecha = pickUniqueIndex(ALIAS.fecha, 'fecha', true);
    const idxHora = pickUniqueIndex(ALIAS.hora, 'hora', true);
    const idxConsumo = pickUniqueIndex(ALIAS.consumo, 'consumo (AE / importacion)', true);

    // Opcionales
    const idxExcedente = pickUniqueIndex(ALIAS.excedente, 'excedentes (AS / vertido)', false);
    const idxAutoconsumo = pickUniqueIndex(ALIAS.autoconsumo, 'autoconsumo', false);
    const idxRealEstimado = pickUniqueIndex(ALIAS.realEstimado, 'REAL/ESTIMADO', false);

    const records = [];
    let appliedHourlyNetting = false;
    let totalDataLines = 0;
    let parsedLines = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = String(lines[i] ?? '').trim();
      if (!line) continue;

      totalDataLines++;

      const cols = splitCSVLine(line, separator);
      if (!cols || cols.length < 3) continue;

      const fechaStr = stripOuterQuotes(cols[idxFecha]);
      const horaRaw = stripOuterQuotes(cols[idxHora]);
      const hora = parseInt(horaRaw, 10);
      if (!Number.isFinite(hora) || hora < 1 || hora > 25) continue; // soporta dia de 25 horas

      const kwhStr = stripOuterQuotes(cols[idxConsumo]);
      if (!kwhStr || String(kwhStr).trim() === '') continue;

      const fecha = parseDateFlexible(fechaStr);
      if (!fecha) continue;

      const kwh = parseNumberFlexibleCSV(kwhStr);
      if (!Number.isFinite(kwh) || kwh < 0 || kwh > 10000) continue;

      let excedente = 0;
      if (idxExcedente >= 0) {
        const excStr = stripOuterQuotes(cols[idxExcedente]);
        if (excStr && String(excStr).trim() !== '') {
          const exc = parseNumberFlexibleCSV(excStr);
          if (Number.isFinite(exc) && exc >= 0) excedente = exc;
        }
      }

      let autoconsumo = 0;
      if (idxAutoconsumo >= 0) {
        const aStr = stripOuterQuotes(cols[idxAutoconsumo]);
        if (aStr && String(aStr).trim() !== '') {
          const a = parseNumberFlexibleCSV(aStr);
          if (Number.isFinite(a) && a >= 0) autoconsumo = a;
        }
      }

      let esReal = true;
      if (idxRealEstimado >= 0) {
        const st = stripOuterQuotes(cols[idxRealEstimado]);
        const s = String(st ?? '').trim().toLowerCase();
        // acepta 'R' o 'REAL...' (en algunos ficheros viene 'Real/Estimado' o 'metodoObtencion')
        esReal = (s === 'r' || s.startsWith('real'));
      }

      records.push({ fecha, hora, kwh, excedente, autoconsumo, esReal });
      parsedLines++;
    }

    if (records.length === 0) {
      throw new Error('No se encontraron datos validos en // Validacion anti-silent-fail: algunos ficheros (p.ej. ciertas distribuidoras) pueden traer importacion (AE) y exportacion (AS)
// simultaneas dentro de la misma hora (datos brutos). En ese caso, aplicamos neteo horario (RD 244/2019) para normalizar.
const simult = records.filter(r => (r.kwh > 0) && (r.excedente > 0));
if (simult.length > 0) {
  for (const r of simult) {
    const imp = Number(r.kwh) || 0;
    const exp = Number(r.excedente) || 0;
    r.kwh = Math.max(imp - exp, 0);
    r.excedente = Math.max(exp - imp, 0);
  }
  appliedHourlyNetting = true;

  // Si aun asi queda simultaneo, entonces si es un CSV incompatible (parse / mapeo incorrecto)
  const still = records.filter(r => (r.kwh > 0) && (r.excedente > 0));
  if (still.length > 0) {
    throw new Error(
      'CSV incompatible: se han detectado horas con consumo y excedente simultaneos. ' +
      'No ha sido posible normalizar aplicando neteo horario, por lo que el mapeo de columnas o el separador no parecen correctos. ' +
      'Envia el ejemplo a soporte.' +
      supportHint()
    );
  }
}
        supportHint()
      );
    }

    // Si se han saltado demasiadas filas, probablemente fecha/hora/decimales no se han interpretado bien
    if (totalDataLines > 0 && parsedLines / totalDataLines < 0.5) {
      throw new Error(
        'CSV no reconocido: muchas filas no se han podido interpretar (fecha/hora/valores). ' +
        'Revisa el separador y el formato de fecha/hora.' +
        supportHint()
      );
    }

    return {
      records,
      hasExcedenteColumn: idxExcedente >= 0,
      hasAutoconsumoColumn: idxAutoconsumo >= 0,
      appliedHourlyNetting
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

    // Intento adicional: formato estandar (Fecha + Hora + AE/AS, con o sin autoconsumo / real-estimado)
    const normKeyX = (h) => String(h ?? '')
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase -> snake_case
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');

    const headerKeysX = (headers || []).map(normKeyX);

    const ALIAS_X = {
      fecha: ['fecha', 'date', 'dia'],
      hora: ['hora', 'hour', 'periodo', 'intervalo'],
      consumo: [
        'ae_kwh', 'consumo_kwh', 'energia_consumida_kwh', 'energia_consumida',
        'import_kwh', 'importacion_kwh', 'energia_activa_importada_kwh'
      ],
      excedente: [
        'as_kwh', 'energia_vertida_kwh', 'energia_vertida', 'vertido_kwh',
        'excedente_kwh', 'export_kwh', 'exportacion_kwh', 'inyeccion_kwh',
        'energia_activa_exportada_kwh'
      ],
      autoconsumo: [
        'ae_autocons_kwh', 'energia_autoconsumida_kwh', 'energia_autoconsumida',
        'autoconsumo_kwh'
      ],
      realEstimado: ['real_estimado', 'realest', 'metodoobtencion', 'metodo_obtencion'],
    };

    const findCandidatesX = (aliases) => {
      const set = new Set(aliases);
      const idxs = [];
      for (let i = 0; i < headerKeysX.length; i++) {
        if (set.has(headerKeysX[i])) idxs.push(i);
      }
      return idxs;
    };

    const pickUniqueIndexX = (aliases, required) => {
      const idxs = findCandidatesX(aliases);
      if (idxs.length === 1) return idxs[0];
      if (idxs.length === 0) return required ? -2 : -1; // -2: missing required
      return -3; // -3: ambiguous
    };

    function tryParseXLSXTablaEstandar() {
      const idxFecha = pickUniqueIndexX(ALIAS_X.fecha, true);
      const idxHora = pickUniqueIndexX(ALIAS_X.hora, true);
      const idxConsumo = pickUniqueIndexX(ALIAS_X.consumo, true);

      // Required missing / ambiguous -> no match
      if (idxFecha < 0 || idxHora < 0 || idxConsumo < 0) return null;

      const idxExcedente = pickUniqueIndexX(ALIAS_X.excedente, false);
      if (idxExcedente === -3) return null; // excedente ambiguo: mejor fallar

      const idxAutoconsumo = pickUniqueIndexX(ALIAS_X.autoconsumo, false);
      const idxRealEstimado = pickUniqueIndexX(ALIAS_X.realEstimado, false);

      if (idxAutoconsumo === -3) return null;
      if (idxRealEstimado === -3) return null;

      const records = [];
      let total = 0;
      let parsed = 0;

      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 2) continue;

        total++;

        const fecha = parseDateFlexible(row[idxFecha]);
        const hora = parseInt(String(row[idxHora] ?? '').trim(), 10);
        if (!fecha || !Number.isFinite(hora) || hora < 1 || hora > 25) continue;

        let kwh = parseNumberFlexible(row[idxConsumo]);
        if (!Number.isFinite(kwh) || kwh < 0 || kwh > 10000) continue;

        let excedente = 0;
        if (idxExcedente >= 0) {
          const v = parseNumberFlexible(row[idxExcedente]);
          if (Number.isFinite(v) && v >= 0) excedente = v;
        }

        let autoconsumo = 0;
        if (idxAutoconsumo >= 0) {
          const v = parseNumberFlexible(row[idxAutoconsumo]);
          if (Number.isFinite(v) && v >= 0) autoconsumo = v;
        }

        let esReal = true;
        if (idxRealEstimado >= 0) {
          const s = String(row[idxRealEstimado] ?? '').trim().toLowerCase();
          esReal = (s === 'r' || s.startsWith('real'));
        }

        records.push({ fecha, hora, kwh, excedente, autoconsumo, esReal });
        parsed++;
      }

      if (records.length === 0) return null;

      const simult = records.filter(r => (r.kwh > 0) && (r.excedente > 0));
      if (simult.length > 0) return null;

      if (total > 0 && parsed / total < 0.5) return null;

      return {
        records,
        hasExcedenteColumn: idxExcedente >= 0,
        hasAutoconsumoColumn: idxAutoconsumo >= 0
      };
    }


    const colFechaHora = headers.findIndex(h => String(h).toUpperCase().includes('FECHA'));
    const colPeriodo = headers.findIndex(h => {
      const hStr = String(h).toUpperCase();
      return hStr.includes('PERIODO') && hStr.includes('TARIFARIO');
    });
    const colConsumo = headers.findIndex(h => String(h).toUpperCase().includes('CONSUMO'));
    const colGeneracion = headers.findIndex(h => String(h).toUpperCase().includes('GENERACION'));

    if (colFechaHora === -1 || colConsumo === -1 || colGeneracion === -1) {
      const estandar = tryParseXLSXTablaEstandar();
      if (estandar) return estandar;
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

      let warning = null;
      if (!parsed.hasExcedenteColumn) {
        warning = 'No se han detectado excedentes (AS_kWh o similar). Se importara con excedentes = 0.';
      }

      if (parsed.appliedHourlyNetting) {
        const msg = 'Se han detectado horas con importacion y exportacion simultaneas; se ha aplicado neteo horario (RD 244/2019) para normalizar.';
        warning = warning ? (warning + ' ' + msg) : msg;
      }

      const meta = buildMeta(records, parsed.hasExcedenteColumn, parsed.hasAutoconsumoColumn);

      return {
        ok: true,
        records,
        meta,
        warning
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || 'Error al procesar el archivo.'
      };
    }
  };
})();
