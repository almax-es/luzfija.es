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

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/xlsx/xlsx.full.min.js';
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

  async function parseCsvOrXlsx(file) {
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
        headerRowIndex
      });
    }

    if (ext === 'xlsx' || ext === 'xls') {
      await ensureXLSX();
      const { parseEnergyTableRows, guessEnergyHeaderRow, parseNumberFlexible, parseDateFlexible } = csvUtils;
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
      const headerRowIndexRaw = guessEnergyHeaderRow ? guessEnergyHeaderRow(data) : 0;
      const headerRowIndex = headerRowIndexRaw >= 0 ? headerRowIndexRaw : 0;
      const parsed = parseEnergyTableRows(data, {
        parseNumber: parseNumberFlexible,
        headerRowIndex
      });
      const records = Array.isArray(parsed?.records) ? parsed.records : [];
      const hasExcedentes = records.some(r => Number.isFinite(r?.excedente) && r.excedente > 0);
      if (records.length && hasExcedentes) return parsed;

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
      const idxExport = headersNorm.findIndex(h => h.startsWith('ehex') || h.includes('export') || h.includes('excedente') || h.includes('vertido'));

      if (idxExport === -1 || (idxFecha === -1 && idxFechaHora === -1)) {
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
        return { records: fallbackRecords, warnings: ['Importación XLSX: aplicado parser alternativo para excedentes.'] };
      }
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

  async function loadSurplusMonth(geo, ym) {
    const key = `${geo}-${ym}`;
    if (csvMonthCache.has(key)) return csvMonthCache.get(key);
    const url = `/data/surplus/${geo}/${ym}.json`;
    try {
      const res = await fetch(url);
      if (!res || !res.ok) {
        csvMonthCache.set(key, null);
        return null;
      }
      const data = await res.json();
      csvMonthCache.set(key, data);
      return data;
    } catch (_) {
      csvMonthCache.set(key, null);
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

    valid.forEach((r) => {
      const dateKey = ymdKey(r.fecha);
      const ym = ymKey(r.fecha);
      const data = monthData[ym];
      const dayHours = data?.days?.[dateKey];
      if (!dayHours) { missing += 1; return; }

      const timeZone = data?.timezone || (geo === '8742' ? 'Atlantic/Canary' : 'Europe/Madrid');
      const hourIdx = getHourIndex(r.hora, r.fecha, dayHours, timeZone);
      if (hourIdx === null || !dayHours[hourIdx]) { missing += 1; return; }

      const price = Number(dayHours[hourIdx][1]);
      if (!Number.isFinite(price)) { missing += 1; return; }

      const kwh = Number(r.excedente) || 0;
      const eur = kwh * price;
      const visualHour = getVisualHourBucket(r.hora, r.fecha);
      if (visualHour === null) { missing += 1; return; }
      totalKwh += kwh;
      totalEur += eur;
      hourly[visualHour] += kwh;

      if (!monthly[ym]) monthly[ym] = { kwh: 0, eur: 0 };
      monthly[ym].kwh += kwh;
      monthly[ym].eur += eur;

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
        avg: row.kwh ? row.eur / row.kwh : 0,
        window80,
        peakHour: peakHour && peakHour.v > 0 ? peakHour.h : null
      };
    });

    const avgPrice = totalKwh ? totalEur / totalKwh : 0;
    const best = monthlyRows.reduce((acc, r) => (!acc || r.avg > acc.avg ? r : acc), null);
    const worst = monthlyRows.reduce((acc, r) => (!acc || r.avg < acc.avg ? r : acc), null);

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
      totalEur,
      avgPrice,
      best,
      worst,
      monthlyRows,
      solarShare,
      topHours,
      peakHour,
      missing
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
