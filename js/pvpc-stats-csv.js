/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

(() => {
  'use strict';

  if (window.__LF_pvpcStatsCsvLoaded) return;
  window.__LF_pvpcStatsCsvLoaded = true;

  function ymdKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function ymKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // Misma cascada de identidad de build que js/tracking.js. Se resuelve en la
  // evaluacion sincrona del script a proposito: dentro de ensureXLSX() (lazy,
  // tras un gesto del usuario) document.currentScript ya vale null.
  const XLSX_BUILD_ID = (() => {
    try {
      if (typeof window.__LF_BUILD_ID === 'string' && window.__LF_BUILD_ID.trim()) {
        return window.__LF_BUILD_ID.trim();
      }
      const cs = document.currentScript && document.currentScript.src ? String(document.currentScript.src) : '';
      if (cs) return new URL(cs, location.href).searchParams.get('v') || '';
    } catch (_) {}
    return '';
  })();

  // El vendor debe arrastrar el ?v= del build como el resto de assets: sin el,
  // un cliente puede seguir ejecutando la copia anterior de SheetJS tras un
  // despliegue que la actualice.
  function xlsxVendorUrl() {
    const path = '/vendor/xlsx/xlsx.full.min.js';
    return XLSX_BUILD_ID ? path + '?v=' + encodeURIComponent(XLSX_BUILD_ID) : path;
  }

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = xlsxVendorUrl();
      script.onload = resolve;
      script.onerror = () => reject(new Error('No se pudo cargar XLSX'));
      document.head.appendChild(script);
    });
  }

  const MAX_CSV_FILE_SIZE_MB = 10;
  const MAX_CSV_FILE_SIZE_BYTES = MAX_CSV_FILE_SIZE_MB * 1024 * 1024;

  function formatSizeMb(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.ceil(n / 1024 / 1024);
  }

  function assertCsvFileSize(file) {
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size <= MAX_CSV_FILE_SIZE_BYTES) return;
    const sizeMB = formatSizeMb(size);
    throw new Error(`El archivo es demasiado grande (${sizeMB} MB). El tamaño máximo permitido es ${MAX_CSV_FILE_SIZE_MB} MB.`);
  }

  async function parseCsvOrXlsx(file, zonaFiscal = 'Península') {
    assertCsvFileSize(file);
    const csvUtils = window.LF?.csvUtils;
    if (!csvUtils) throw new Error('CSV utils no disponibles.');

    const ext = String(file.name || '').split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const content = await file.text();
      const { parseCSVToRows, parseEnergyTableRows, parseNumberFlexibleCSV } = csvUtils;
      const { rows, separator, headerRowIndex } = parseCSVToRows(content);
      return parseEnergyTableRows(rows, {
        parseNumber: parseNumberFlexibleCSV,
        separator,
        headerRowIndex,
        zonaFiscal,
        // En el observatorio los excedentes SON la carga util. En CSV no hay parser
        // alternativo, asi que una columna de excedentes sin reconocer debe fallar en vez
        // de agregar ceros. En la rama XLSX si hay fallback y alli la politica es 'warn'.
        unmappedSolarPolicy: 'error'
      });
    }

    if (ext === 'xlsx' || ext === 'xls') {
      await ensureXLSX();
      const { parseEnergyTableRows, guessEnergyHeaderRow, parseNumberFlexible, parseDateFlexible, buildUnmappedSolarError, assertXlsxSheetWithinLimits, assertRelevantXlsxFormulasResolved } = csvUtils;
      const buffer = await file.arrayBuffer();
      // sheets: 0 evita que XLSX.read() parsee (y materialice en memoria) hojas que este
      // codigo nunca va a leer: solo se consume la primera. Sin esto, una segunda hoja con
      // muchas celdas reales ya se ha parseado antes de que el guard de dimensiones pueda
      // rechazar nada.
      const workbook = XLSX.read(buffer, { type: 'array', sheets: 0, sheetStubs: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      // Fail-closed: si el guard de dimensiones no esta disponible (p. ej. un futuro error de
      // orden de scripts), no se procesa el XLSX sin haberlo comprobado.
      if (typeof assertXlsxSheetWithinLimits !== 'function') {
        throw new Error('No se pudo validar el archivo Excel; inténtalo de nuevo.');
      }
      if (typeof assertRelevantXlsxFormulasResolved !== 'function') {
        throw new Error('No se pudo validar las fórmulas del archivo Excel; inténtalo de nuevo.');
      }
      assertXlsxSheetWithinLimits(sheet, XLSX);
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
      const headerRowIndexRaw = guessEnergyHeaderRow ? guessEnergyHeaderRow(data) : 0;
      const headerRowIndex = headerRowIndexRaw >= 0 ? headerRowIndexRaw : 0;
      assertRelevantXlsxFormulasResolved(sheet, data, headerRowIndex);
      const parsed = parseEnergyTableRows(data, {
        parseNumber: parseNumberFlexible,
        headerRowIndex,
        zonaFiscal,
        // 'warn' y NO 'error' a proposito: mas abajo hay un parser alternativo para un
        // subconjunto seguro de cabeceras. El parser comun devuelve por indice cuales puede
        // consumir ese fallback; las demas columnas solares pendientes se bloquean.
        unmappedSolarPolicy: 'warn',
        // Este alias ya existía en el Observatorio, pero su parser local omitía la
        // normalización 0-23/DST/unidades/duplicados. Resolverlo dentro del parser común
        // conserva la semántica de excedente bruto y reutiliza todas las garantías canónicas.
        mapSafeFallbackSolarExport: true
      });
      const records = Array.isArray(parsed?.records) ? parsed.records : [];
      const hasExcedentes = records.some(r => Number.isFinite(r?.excedente) && r.excedente > 0);

      const solarIndices = Array.isArray(parsed?.unmappedSolarIndices) ? parsed.unmappedSolarIndices : [];
      const fallbackExportIndices = Array.isArray(parsed?.unmappedSolarFallbackExportIndices)
        ? parsed.unmappedSolarFallbackExportIndices
        : [];

      // Aborta si queda alguna columna solar que nadie ha consumido. `resueltoIdx` es la que
      // el fallback si ha usado, y se excluye del recuento. Este guard se aplica antes de
      // TODOS los retornos: tambien cuando el parser comun ya encontro excedentes.
      const abortarSiQuedaColumnaSolar = (resueltoIdx = -1) => {
        const pendientes = solarIndices
          .filter(i => i !== resueltoIdx)
          .map(i => (parsed?.headersNorm || [])[i] || `columna ${i + 1}`);
        if (!pendientes.length) return;
        if (typeof buildUnmappedSolarError === 'function') {
          throw buildUnmappedSolarError(pendientes, parsed?.headersNorm || []);
        }
        throw new Error(
          `El archivo contiene columnas que parecen representar energía solar, pero no se reconocen con seguridad. No se importará como cero.`
        );
      };

      if (records.length && hasExcedentes) {
        abortarSiQuedaColumnaSolar();
        return parsed;
      }

      const normalizeHeader = (value) => {
        let str = String(value ?? '').trim();
        if (!str) return '';
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        str = str.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return str;
      };

      const headerRow = Array.isArray(data[headerRowIndex]) ? data[headerRowIndex] : [];
      const headersNorm = headerRow.map(normalizeHeader);
      const idxFecha = headersNorm.findIndex(h => h === 'fecha' || h === 'date');
      const idxHora = headersNorm.findIndex(h => h === 'hora' || h === 'hour');
      const idxFechaHora = headersNorm.findIndex(h => h === 'fecha_hora' || h === 'fecha_hora_consumo' || h === 'datetime');
      // La seleccion semantica la hace el parser comun. Aqui solo se usa el indice ya
      // clasificado, de modo que no existe una segunda heuristica local que pueda divergir
      // (por ejemplo, includes('export') aceptaba antes "Export when").
      const idxExport = fallbackExportIndices.length ? fallbackExportIndices[0] : -1;

      if (idxExport === -1 || (idxFecha === -1 && idxFechaHora === -1)) {
        abortarSiQuedaColumnaSolar();
        return parsed;
      }

      const fallbackRecords = [];
      for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row.length) continue;
        let fecha;
        let hora;
        if (idxFechaHora !== -1) {
          const dateHour = parseDateHourValue(row[idxFechaHora], parseDateFlexible);
          fecha = dateHour.fecha;
          hora = dateHour.hora;
        } else {
          fecha = parseDateFlexible ? parseDateFlexible(row[idxFecha]) : null;
          hora = parseNumberFlexible ? parseNumberFlexible(row[idxHora]) : Number(row[idxHora]);
        }
        if (!fecha || !(fecha instanceof Date) || isNaN(fecha.getTime())) continue;
        const excedente = parseNumberFlexible ? parseNumberFlexible(row[idxExport]) : Number(row[idxExport]);
        if (!Number.isFinite(excedente)) continue;
        fallbackRecords.push({
          fecha,
          hora,
          kwh: 0,
          excedente,
          autoconsumo: 0,
          periodo: null,
          esReal: true
        });
      }

      if (fallbackRecords.length) {
        // Antes de aceptar: que no quede NINGUNA otra columna solar sin consumir. Si el
        // fichero trae 'Energia exportada total' a cero y 'Inyeccion a red' con los valores
        // reales, devolver los ceros del fallback seria el mismo fallo silencioso.
        abortarSiQuedaColumnaSolar(idxExport);
        return { records: fallbackRecords, warnings: ['Importación XLSX: aplicado parser alternativo para excedentes.'] };
      }
      abortarSiQuedaColumnaSolar();
      return parsed;
    }

    throw new Error('Formato no soportado. Solo CSV/XLSX.');
  }

  function parseDateHourValue(value, parseDateFlexible) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return {
        fecha: new Date(value.getFullYear(), value.getMonth(), value.getDate()),
        // Normalizar a hora CNMC (1-24) para que getHourIndex mantenga el mismo contrato.
        hora: value.getHours() + 1
      };
    }

    const raw = String(value ?? '').trim();
    if (!raw) return { fecha: null, hora: null };

    const combined = raw.match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})[T\s]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/i);
    if (combined) {
      const fecha = parseDateFlexible ? parseDateFlexible(combined[1]) : null;
      const hour = Number(combined[2]);
      if (fecha instanceof Date && !isNaN(fecha.getTime()) && Number.isFinite(hour) && hour >= 0 && hour <= 23) {
        return { fecha, hora: hour + 1 };
      }
    }

    const fecha = parseDateFlexible ? parseDateFlexible(raw) : null;
    return {
      fecha: fecha instanceof Date && !isNaN(fecha.getTime()) ? fecha : null,
      hora: null
    };
  }

  const csvMonthCache = new Map();
  const csvHourIndexCache = new WeakMap();
  const csvHourFormatterCache = new Map();

  function getHourFormatter(timeZone) {
    const zone = timeZone || 'Europe/Madrid';
    if (!csvHourFormatterCache.has(zone)) {
      csvHourFormatterCache.set(zone, new Intl.DateTimeFormat('es-ES', {
        hour: '2-digit',
        hour12: false,
        timeZone: zone
      }));
    }
    return csvHourFormatterCache.get(zone);
  }

  function hourFromTs(tsSeconds, timeZone) {
    const hStr = getHourFormatter(timeZone).format(new Date(Number(tsSeconds) * 1000));
    let h = parseInt(hStr, 10);
    if (h === 24) h = 0;
    return Number.isFinite(h) ? h : 0;
  }

  function buildCnmcHourIndexMap(dayHours, timeZone = 'Europe/Madrid') {
    if (!Array.isArray(dayHours)) return new Map();

    let perZone = csvHourIndexCache.get(dayHours);
    if (perZone && perZone.has(timeZone)) return perZone.get(timeZone);

    const totalsByHour = new Map();
    const rawEntries = dayHours.map(([ts], index) => ({
      index,
      hour: hourFromTs(ts, timeZone)
    }));

    rawEntries.forEach((entry) => {
      totalsByHour.set(entry.hour, (totalsByHour.get(entry.hour) || 0) + 1);
    });

    const seenByHour = new Map();
    const byCnmcHour = new Map();
    rawEntries.forEach((entry) => {
      const occurrence = (seenByHour.get(entry.hour) || 0) + 1;
      seenByHour.set(entry.hour, occurrence);

      const totalOccurrences = totalsByHour.get(entry.hour) || 1;
      const cnmcHour = totalOccurrences > 1 && occurrence > 1
        ? 25
        : (entry.hour + 1);
      byCnmcHour.set(cnmcHour, entry.index);
    });

    if (!perZone) {
      perZone = new Map();
      csvHourIndexCache.set(dayHours, perZone);
    }
    perZone.set(timeZone, byCnmcHour);
    return byCnmcHour;
  }

  function getHourIndex(rawHour, dateObj, dayHours = null, timeZone = 'Europe/Madrid') {
    const h = Number.isFinite(rawHour) ? Number(rawHour) : (dateObj ? dateObj.getHours() : NaN);
    if (!Number.isFinite(h)) return null;
    if (Array.isArray(dayHours) && dayHours.length) {
      const exactMap = buildCnmcHourIndexMap(dayHours, timeZone);
      return exactMap.has(h) ? exactMap.get(h) : null;
    }
    if (h === 24) return 23;
    if (h >= 1 && h <= 24) return h - 1;
    if (h >= 0 && h <= 23) return h;
    return null;
  }

  function getVisualHourBucket(rawHour, dateObj) {
    const h = Number.isFinite(rawHour) ? Number(rawHour) : (dateObj ? dateObj.getHours() : NaN);
    if (!Number.isFinite(h)) return null;
    if (h === 25) return 2;
    if (h === 24) return 23;
    if (h >= 1 && h <= 24) return Math.min(h - 1, 23);
    if (h >= 0 && h <= 23) return h;
    return null;
  }

  // Misma regla que home y Observatorio, via el validador compartido de lf-csv-utils.js:
  // cada dia declarado debe cubrir su dia civil completo (23/24/25 puntos segun DST,
  // contiguos, sin huecos/duplicados/horas ajenas). El dia local vigente puede estar
  // parcial. Antes solo se comprobaba "cada fila es un par numerico" (bloqueante 2,
  // 12/08/2026): un dia con un unico punto horario pasaba como sano.
  function getMonthCoverage(data, expectedMonth = null, geo = null) {
    const validator = window.LF?.csvUtils?.validatePvpcMonthCoverage;
    if (typeof validator !== 'function') return { ok: false, reason: 'validator-unavailable' };
    // Separar identidad del fichero y reloj de cobertura. En excedentes, la metadata
    // `timezone` no puede imponerse desde el geo: el contrato CCH-CONS ya auditado depende
    // del reloj declarado por el dataset (Canarias pierde la 01:00 en marzo, no la 02:00).
    // Sí se rechaza una identidad EXPLICITAMENTE contradictoria (geo/indicador/unidad/epoch).
    const timeZone = typeof data?.timezone === 'string' && data.timezone
      ? data.timezone
      : (Number(geo) === 8742 ? 'Atlantic/Canary' : 'Europe/Madrid');
    const identityValidator = window.LF?.csvUtils?.validateStaticPriceDatasetIdentity;
    if (typeof identityValidator !== 'function') return { ok: false, reason: 'identity-validator-unavailable' };
    const identity = identityValidator(data, {
      expectedGeoId: Number(geo),
      expectedIndicator: 1739,
      allowMissingFields: true
    });
    if (!identity.ok) return identity;
    const todayLocal = window.LF?.csvUtils?.formatYmdInTimeZone?.(Date.now() / 1000, timeZone) || null;
    return validator(data, expectedMonth, timeZone, { todayLocal, freshnessDays: 2 });
  }

  async function loadSurplusMonth(geo, ym) {
    const key = `${geo}-${ym}`;
    if (csvMonthCache.has(key)) return csvMonthCache.get(key);
    const url = `/data/surplus/${geo}/${ym}.json`;
    try {
      const { response: res, data } = await window.LF.csvUtils.fetchJsonWithTimeout(url);
      if (!res || !res.ok) {
        // Los fallos HTTP no son datos. No se guardan como null para que una
        // segunda búsqueda en la misma sesión pueda recuperar el mes.
        return null;
      }
      const coverage = getMonthCoverage(data, ym, geo);
      if (!coverage.ok) return null;
      if (!coverage.provisionalDays.length) csvMonthCache.set(key, data);
      return data;
    } catch (_) {
      // Igual que en lf-surplus-prices.js: un fallo de red debe ser reintentable.
      return null;
    }
  }

  async function computeCsvCompensation(records, geo) {
    if (window.LF?.surplusPrices?.computeHourlyCompensation) {
      return window.LF.surplusPrices.computeHourlyCompensation(records, { geo });
    }

    const monthSet = new Set();
    const valid = records.filter(r => r && r.fecha instanceof Date && Number.isFinite(r.excedente) && r.excedente > 0);
    valid.forEach(r => monthSet.add(ymKey(r.fecha)));
    const months = Array.from(monthSet).sort();

    const monthData = {};
    await PVPC_STATS.runWithConcurrency(months.map((ym) => async () => {
      monthData[ym] = await loadSurplusMonth(geo, ym);
    }));

    const monthly = {};
    const monthlyHourly = {};
    const hourly = new Array(24).fill(0);
    let totalKwh = 0;
    let totalEur = 0;
    let missing = 0;
    // kWh que el usuario aporto pero no se pudieron valorar. `totalKwh` cuenta solo lo
    // valorado (contrato que NO se toca, porque alimenta el calculo economico), asi que
    // sin esto la vista mostraria menos energia de la que el usuario subio. Es el mismo
    // criterio ya aplicado en js/lf-surplus-prices.js, que es la ruta normal: esta funcion
    // solo se ejecuta como fallback si ese modulo no llego a cargarse.
    let missingKwh = 0;
    const monthlyMissingKwh = {};

    valid.forEach((r) => {
      const dateKey = ymdKey(r.fecha);
      const ym = ymKey(r.fecha);
      const data = monthData[ym];
      const sinPrecio = () => {
        const kwhSinPrecio = Number(r.excedente) || 0;
        missing += 1;
        missingKwh += kwhSinPrecio;
        monthlyMissingKwh[ym] = (monthlyMissingKwh[ym] || 0) + kwhSinPrecio;
      };
      const dayHours = data?.days?.[dateKey];
      if (!dayHours) { sinPrecio(); return; }

      const timeZone = data?.timezone || (geo === '8742' ? 'Atlantic/Canary' : 'Europe/Madrid');
      const hourIdx = getHourIndex(r.hora, r.fecha, dayHours, timeZone);
      if (hourIdx === null || !dayHours[hourIdx]) { sinPrecio(); return; }

      const price = Number(dayHours[hourIdx][1]);
      if (!Number.isFinite(price)) { sinPrecio(); return; }

      const kwh = Number(r.excedente) || 0;
      const eur = kwh * price;
      const visualHour = getVisualHourBucket(r.hora, r.fecha);
      if (visualHour === null) { sinPrecio(); return; }
      totalKwh += kwh;
      totalEur += eur;
      hourly[visualHour] += kwh;

      // `pricedHours` lo consume la tabla del Observatorio para decidir si muestra el
      // importe o un guion. Sin este contador, el fallback pintaba "—" en el importe de
      // un mes que SI tenia compensacion calculada.
      if (!monthly[ym]) monthly[ym] = { kwh: 0, eur: 0, pricedHours: 0 };
      monthly[ym].kwh += kwh;
      monthly[ym].eur += eur;
      monthly[ym].pricedHours += 1;

      if (!monthlyHourly[ym]) monthlyHourly[ym] = new Array(24).fill(0);
      monthlyHourly[ym][visualHour] += kwh;
    });

    function bestWindowForShare(hourlyKwh, shareTarget = 0.8) {
      const total = hourlyKwh.reduce((a, b) => a + b, 0);
      if (!total) return null;
      const target = total * shareTarget;
      let best = null;
      for (let start = 0; start < 24; start++) {
        let sum = 0;
        for (let end = start; end < 24; end++) {
          sum += hourlyKwh[end];
          if (sum >= target) {
            const len = end - start + 1;
            if (!best || len < best.len || (len === best.len && sum > best.sum)) {
              best = { start, end, len, sum };
            }
            break;
          }
        }
      }
      return best;
    }

    const monthsOrdered = Object.keys(monthly).sort();
    const monthlyRows = monthsOrdered.map((ym) => {
      const row = monthly[ym];
      const hourlyKwh = monthlyHourly[ym] || new Array(24).fill(0);
      const window80 = bestWindowForShare(hourlyKwh, 0.8);
      const peakHour = hourlyKwh.reduce((acc, v, i) => (v > acc.v ? { h: i, v } : acc), { h: 0, v: -1 });
      return {
        ym,
        kwh: row.kwh,
        eur: row.eur,
        // Sin kWh valorados no hay precio medio ponderado; `0` seria un dato inventado.
        avg: row.kwh ? row.eur / row.kwh : null,
        // Energia realmente aportada por el usuario en ese mes, valorada o no.
        inputKwh: row.kwh + (monthlyMissingKwh[ym] || 0),
        pricedHours: row.pricedHours || 0,
        window80,
        peakHour: peakHour && peakHour.v > 0 ? peakHour.h : null
      };
    });

    const avgPrice = totalKwh ? totalEur / totalKwh : 0;
    // Un mes sin una sola hora valorada no puede ser el mejor ni el peor: su `avg` no es
    // un precio real. Aqui el caso no llega a darse (un mes solo se crea cuando hubo al
    // menos una hora con precio), pero se filtra igual para no depender de esa sutileza
    // si el acumulado cambia, y para no divergir de js/lf-surplus-prices.js.
    const comparableMonthlyRows = monthlyRows.filter((r) => r.kwh > 0 && Number.isFinite(r.avg));
    const best = comparableMonthlyRows.reduce((acc, r) => (!acc || r.avg > acc.avg ? r : acc), null);
    const worst = comparableMonthlyRows.reduce((acc, r) => (!acc || r.avg < acc.avg ? r : acc), null);

    const solarStart = 9;
    const solarEnd = 18;
    const solarKwh = hourly.slice(solarStart, solarEnd + 1).reduce((a, b) => a + b, 0);
    const solarShare = totalKwh ? (solarKwh / totalKwh) : 0;

    const hourShares = hourly.map((kwh, h) => ({
      h,
      kwh,
      share: totalKwh ? (kwh / totalKwh) : 0
    })).filter(r => r.kwh > 0).sort((a, b) => b.kwh - a.kwh);

    const topHours = hourShares.slice(0, 3);
    const peakHour = topHours.length ? topHours[0] : null;

    return {
      totalKwh,
      // Informativo: energia aportada, valorada o no. `totalKwh` mantiene su semantica.
      inputKwh: totalKwh + missingKwh,
      totalEur,
      avgPrice,
      best,
      worst,
      monthlyRows,
      solarShare,
      topHours,
      peakHour,
      missing,
      // La nota de la UI muestra "N horas (X kWh) no encontraron precio"; sin este campo
      // el fallback mostraria siempre 0,0 kWh aunque faltase cobertura.
      missingKwh
    };
  }

  window.__LF_PvpcStatsCsv = {
    ensureXLSX,
    MAX_CSV_FILE_SIZE_MB,
    MAX_CSV_FILE_SIZE_BYTES,
    formatSizeMb,
    assertCsvFileSize,
    parseCsvOrXlsx,
    parseDateHourValue,
    csvMonthCache,
    csvHourIndexCache,
    csvHourFormatterCache,
    getHourFormatter,
    hourFromTs,
    buildCnmcHourIndexMap,
    getHourIndex,
    getVisualHourBucket,
    loadSurplusMonth,
    computeCsvCompensation
  };

  window.LF = window.LF || {};
  window.LF.pvpcStatsCsvHelpers = Object.assign({}, window.LF.pvpcStatsCsvHelpers, {
    parseDateHourValue,
    getHourIndex,
    buildCnmcHourIndexMap,
    getVisualHourBucket,
    parseCsvOrXlsx
  });
})();
