/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: Precios horarios de excedentes =====
// Calcula el valor de excedentes indexados usando la curva horaria real del usuario.

(function () {
  'use strict';

  const root = window.LF = window.LF || {};

  const monthCache = new Map();
  const inFlightMonthCache = new Map();
  let hourIndexCache = new WeakMap();
  const hourFormatterCache = new Map();
  const MAX_CONCURRENT_FETCHES = 4;
  const HOURLY_INDEX_MAX_MISSING_SHARE = 0.10;
  const HOURLY_INDEX_MAX_MISSING_KWH_SHARE = 0.10;

  function ymKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function ymdKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function normalizeZona(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function getSurplusGeoCandidates(zonaFiscal) {
    const zona = normalizeZona(zonaFiscal);
    if (zona.includes('canarias')) return ['8742'];
    if (zona.includes('baleares')) return ['8743'];
    if (zona.includes('ceuta') && zona.includes('melilla')) return ['8744', '8745'];
    if (zona.includes('melilla')) return ['8745'];
    if (zona.includes('ceuta')) return ['8744'];
    return ['8741'];
  }

  function getHourFormatter(timeZone) {
    const zone = timeZone || 'Europe/Madrid';
    if (hourFormatterCache.has(zone)) return hourFormatterCache.get(zone);

    const formatter = new Intl.DateTimeFormat('es-ES', {
      hour: '2-digit',
      hour12: false,
      timeZone: zone
    });
    hourFormatterCache.set(zone, formatter);
    return formatter;
  }

  function hourFromTs(tsSeconds, timeZone) {
    const hStr = getHourFormatter(timeZone).format(new Date(Number(tsSeconds) * 1000));
    let h = parseInt(hStr, 10);
    if (h === 24) h = 0;
    return Number.isFinite(h) ? h : 0;
  }

  function buildCnmcHourIndexMap(dayHours, timeZone = 'Europe/Madrid') {
    if (!Array.isArray(dayHours)) return new Map();

    let perZone = hourIndexCache.get(dayHours);
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
      hourIndexCache.set(dayHours, perZone);
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

  async function runWithConcurrency(tasks, limit = MAX_CONCURRENT_FETCHES) {
    const results = new Array(tasks.length);
    let index = 0;
    const workers = new Array(Math.min(limit, tasks.length)).fill(null).map(async () => {
      while (index < tasks.length) {
        const current = index;
        index += 1;
        results[current] = await tasks[current]();
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function loadSurplusMonth(geo, ym) {
    const key = `${geo}-${ym}`;
    if (monthCache.has(key)) return monthCache.get(key);
    if (inFlightMonthCache.has(key)) return inFlightMonthCache.get(key);

    const promise = (async () => {
      try {
        const res = await fetch(`/data/surplus/${geo}/${ym}.json`);
        if (!res.ok) {
          monthCache.set(key, null);
          return null;
        }
        const data = await res.json();
        monthCache.set(key, data);
        return data;
      } catch (_) {
        monthCache.set(key, null);
        return null;
      } finally {
        inFlightMonthCache.delete(key);
      }
    })();

    inFlightMonthCache.set(key, promise);
    return promise;
  }

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

  function summarizeCompensation({ monthly, monthlyHourly, hourly, totalKwh, totalEur, missing, totalMissingKwh, totalPricedHours }) {
    const monthsOrdered = Object.keys(monthly).sort();
    const monthlyRows = monthsOrdered.map((ym) => {
      const row = monthly[ym];
      const hourlyKwh = monthlyHourly[ym] || new Array(24).fill(0);
      const window80 = bestWindowForShare(hourlyKwh, 0.8);
      const peakHour = hourlyKwh.reduce((acc, v, i) => (v > acc.v ? { h: i, v } : acc), { h: 0, v: -1 });
      const pricedHours = row.pricedHours || 0;
      const missing = row.missing || 0;
      const missingKwh = row.missingKwh || 0;
      const totalHours = pricedHours + missing;
      const totalMonthKwh = row.kwh + missingKwh;
      return {
        ym,
        kwh: row.kwh,
        eur: row.eur,
        avg: row.kwh ? row.eur / row.kwh : 0,
        missing,
        missingKwh,
        pricedHours,
        missingShare: totalHours > 0 ? missing / totalHours : 0,
        missingKwhShare: totalMonthKwh > 0 ? missingKwh / totalMonthKwh : 0,
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

    return {
      totalKwh,
      totalEur,
      avgPrice,
      best,
      worst,
      monthlyRows,
      solarShare,
      topHours,
      peakHour: topHours.length ? topHours[0] : null,
      missing,
      missingKwh: totalMissingKwh || 0,
      pricedHours: totalPricedHours || 0,
      missingShare: ((totalPricedHours || 0) + missing) > 0 ? missing / ((totalPricedHours || 0) + missing) : 0,
      missingKwhShare: (totalKwh + (totalMissingKwh || 0)) > 0 ? (totalMissingKwh || 0) / (totalKwh + (totalMissingKwh || 0)) : 0,
      partialCoverageRejected: false
    };
  }

  async function computeHourlyCompensation(records, options = {}) {
    const valid = (records || []).filter((r) => {
      return r
        && r.fecha instanceof Date
        && !isNaN(r.fecha.getTime())
        && Number.isFinite(Number(r.excedente))
        && Number(r.excedente) > 0;
    });

    const geoCandidates = Array.isArray(options.geoCandidates) && options.geoCandidates.length
      ? options.geoCandidates.map(String)
      : (options.geo ? [String(options.geo)] : getSurplusGeoCandidates(options.zonaFiscal));

    const monthSet = new Set();
    valid.forEach(r => monthSet.add(ymKey(r.fecha)));
    const months = Array.from(monthSet).sort();
    const monthData = {};

    await runWithConcurrency(months.map((ym) => async () => {
      let selected = null;
      for (const geo of geoCandidates) {
        const data = await loadSurplusMonth(geo, ym);
        if (data) {
          selected = { geo, data };
          break;
        }
      }
      monthData[ym] = selected;
    }));

    const monthly = {};
    const monthlyHourly = {};
    const hourly = new Array(24).fill(0);
    let totalKwh = 0;
    let totalEur = 0;
    let missing = 0;
    let totalMissingKwh = 0;
    let totalPricedHours = 0;

    function markMissing(ym, missingKwh = 0) {
      const numericMissingKwh = Number(missingKwh ?? 0);
      const kwh = Math.max(0, Number.isFinite(numericMissingKwh) ? numericMissingKwh : 0);
      missing += 1;
      totalMissingKwh += kwh;
      if (!monthly[ym]) monthly[ym] = { kwh: 0, eur: 0, missing: 0, missingKwh: 0, pricedHours: 0 };
      monthly[ym].missing += 1;
      monthly[ym].missingKwh += kwh;
    }

    valid.forEach((r) => {
      const visualHour = getVisualHourBucket(Number(r.hora), r.fecha);
      if (visualHour === null) { markMissing(ymKey(r.fecha), r.excedente); return; }

      const dateKey = ymdKey(r.fecha);
      const ym = ymKey(r.fecha);
      const selected = monthData[ym];
      const data = selected?.data;
      const dayHours = data?.days?.[dateKey];
      if (!dayHours) { markMissing(ym, r.excedente); return; }

      const timeZone = data?.timezone || 'Europe/Madrid';
      const hourIdx = getHourIndex(Number(r.hora), r.fecha, dayHours, timeZone);
      if (hourIdx === null || !dayHours[hourIdx]) { markMissing(ym, r.excedente); return; }

      const price = Number(dayHours[hourIdx][1]);
      if (!Number.isFinite(price)) { markMissing(ym, r.excedente); return; }

      const kwh = Number(r.excedente) || 0;
      const eur = kwh * price;

      totalKwh += kwh;
      totalEur += eur;
      totalPricedHours += 1;
      hourly[visualHour] += kwh;

      if (!monthly[ym]) monthly[ym] = { kwh: 0, eur: 0, missing: 0, missingKwh: 0, pricedHours: 0 };
      monthly[ym].kwh += kwh;
      monthly[ym].eur += eur;
      monthly[ym].pricedHours += 1;

      if (!monthlyHourly[ym]) monthlyHourly[ym] = new Array(24).fill(0);
      monthlyHourly[ym][visualHour] += kwh;
    });

    months.forEach((ym) => {
      if (!monthly[ym]) monthly[ym] = { kwh: 0, eur: 0, missing: 0, missingKwh: 0, pricedHours: 0 };
    });

    return summarizeCompensation({ monthly, monthlyHourly, hourly, totalKwh, totalEur, missing, totalMissingKwh, totalPricedHours });
  }

  function applyMonthlyIndexedValues(months, stats) {
    const byMonth = new Map((stats?.monthlyRows || []).map(row => [row.ym, row]));
    if (stats && typeof stats === 'object') {
      stats.partialCoverageRejected = false;
      stats.partialCoverageRejectedMonths = 0;
      stats.partialCoverageTotalMonths = 0;
    }
    return (months || []).map((month) => {
      const row = byMonth.get(month.key);
      if (!row || !Number.isFinite(row.eur)) return month;
      if (row.kwh <= 0 && !(row.missing > 0)) return month;
      if (stats && typeof stats === 'object') stats.partialCoverageTotalMonths += 1;
      const missingShare = Number(row.missingShare) || 0;
      const missingKwhShare = Number(row.missingKwhShare) || 0;
      if (
        (row.missing || 0) > 0
        && (
          row.kwh <= 0
          || missingShare > HOURLY_INDEX_MAX_MISSING_SHARE
          || missingKwhShare > HOURLY_INDEX_MAX_MISSING_KWH_SHARE
        )
      ) {
        if (stats && typeof stats === 'object') {
          stats.partialCoverageRejected = true;
          stats.partialCoverageRejectedMonths += 1;
        }
        return Object.assign({}, month, {
          indexedMissingHours: row.missing || 0,
          indexedMissingKwh: row.missingKwh || 0,
          indexedPricedHours: row.pricedHours || 0,
          indexedSurplusWarning: 'partial-coverage-rejected',
          indexedSurplusSource: 'hourly-index-partial-rejected'
        });
      }
      return Object.assign({}, month, {
        indexedSurplusEur: row.eur,
        indexedAvgPrice: row.avg,
        indexedMissingHours: row.missing || 0,
        indexedMissingKwh: row.missingKwh || 0,
        indexedPricedHours: row.pricedHours || 0,
        indexedSurplusWarning: (row.missing || 0) > 0 ? 'partial' : '',
        indexedSurplusSource: 'hourly-index-base'
      });
    });
  }

  root.surplusPrices = {
    getSurplusGeoCandidates,
    loadSurplusMonth,
    computeHourlyCompensation,
    applyMonthlyIndexedValues,
    buildCnmcHourIndexMap,
    getHourIndex,
    getVisualHourBucket,
    HOURLY_INDEX_MAX_MISSING_SHARE,
    HOURLY_INDEX_MAX_MISSING_KWH_SHARE,
    _clearCaches() {
      monthCache.clear();
      inFlightMonthCache.clear();
      // WeakMap no implementa clear(); reinstanciarlo sí invalida las entradas
      // aunque el array clave siga vivo durante esta sesión.
      hourIndexCache = new WeakMap();
      hourFormatterCache.clear();
    }
  };
})();
