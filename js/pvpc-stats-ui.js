(() => {
  'use strict';

  const geoNames = {
    '8741': 'Península',
    '8742': 'Canarias',
    '8743': 'Baleares',
    '8744': 'Ceuta',
    '8745': 'Melilla'
  };

  const els = {
    type: document.getElementById('typeSelector'),
    geo: document.getElementById('geoSelector'),
    year: document.getElementById('yearSelector'),
    month: document.getElementById('monthSelector'),

    kpiLast: document.getElementById('kpiLast'),
    kpiLastSub: document.getElementById('kpiLastSub'),
    kpiAvg7: document.getElementById('kpiAvg7'),
    kpiAvg7Sub: document.getElementById('kpiAvg7Sub'),
    kpiAvg30: document.getElementById('kpiAvg30'),
    kpiAvg30Sub: document.getElementById('kpiAvg30Sub'),
    kpiAvg12m: document.getElementById('kpiAvg12m'),
    kpiAvg12mSub: document.getElementById('kpiAvg12mSub'),
    kpiYoY: document.getElementById('kpiYoY'),
    kpiYoYSub: document.getElementById('kpiYoYSub'),

    lblKpi2: document.getElementById('lblKpi2'),
    lblKpi3: document.getElementById('lblKpi3'),

    trendModeMonthly: document.getElementById('trendModeMonthly'),
    trendModeDaily: document.getElementById('trendModeDaily'),
    trendMeta: document.getElementById('trendMeta'),
    insightCheapest: document.getElementById('insightCheapest'),
    insightWorst: document.getElementById('insightWorst'),
    insightRange: document.getElementById('insightRange'),
    insightCheapestLabel: document.getElementById('insightCheapestLabel'),
    insightWorstLabel: document.getElementById('insightWorstLabel'),
    insightRangeLabel: document.getElementById('insightRangeLabel'),

    hourlyMeta: document.getElementById('hourlyMeta'),
    hourlyCallout: document.getElementById('hourlyCallout'),
    hourlyTitle: document.getElementById('hourlyTitle'),
    hourlySubtitle: document.getElementById('hourlySubtitle'),

    faqCheapestSummary: document.getElementById('faqCheapestSummary'),
    faqCheapestBody: document.getElementById('faqCheapestBody'),

    compareYears: document.getElementById('compareYears')
  };

  const canvases = {
    trend: document.getElementById('trendChart'),
    hourly: document.getElementById('hourlyChart'),
    compare: document.getElementById('compareChart')
  };

  let charts = { trend: null, hourly: null, compare: null };

  function getCssVar(name, fallback = '') {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function toComma(n) {
    return String(n).replace('.', ',');
  }

  function fmtCents(priceEurKwh, decimals = 3) {
    if (!Number.isFinite(priceEurKwh)) return '—';
    return `${toComma(priceEurKwh.toFixed(decimals))} €/kWh`;
  }

  function fmtPct(p, decimals = 0) {
    if (!Number.isFinite(p)) return '—';
    const sign = p > 0 ? '+' : '';
    return `${sign}${toComma(p.toFixed(decimals))}%`;
  }

  function fmtMonth(m) {
    const map = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return map[m] || '';
  }

  function fmtEur(value) {
    if (!Number.isFinite(value)) return '—';
    return `${toComma(value.toFixed(2))} €`;
  }

  function fmtKwh(value, decimals = 1) {
    if (!Number.isFinite(value)) return '—';
    return `${toComma(value.toFixed(decimals))} kWh`;
  }

  function safeMean(values) {
    const nums = values.filter(v => Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((a,b) => a + b, 0) / nums.length;
  }

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
      script.src = new URL('vendor/xlsx/xlsx.full.min.js', document.baseURI).toString();
      script.onload = resolve;
      script.onerror = () => reject(new Error('No se pudo cargar XLSX'));
      document.head.appendChild(script);
    });
  }

  async function parseCsvOrXlsx(file) {
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
      const { parseEnergyTableRows, guessEnergyHeaderRow, parseNumberFlexible } = csvUtils;
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
      const headerRowIndex = guessEnergyHeaderRow ? guessEnergyHeaderRow(data) : 0;
      return parseEnergyTableRows(data, {
        parseNumber: parseNumberFlexible,
        headerRowIndex
      });
    }

    throw new Error('Formato no soportado. Solo CSV/XLSX.');
  }

  const csvMonthCache = new Map();

  function getHourIndex(rawHour, dateObj) {
    const h = Number.isFinite(rawHour) ? Number(rawHour) : (dateObj ? dateObj.getHours() : NaN);
    if (!Number.isFinite(h)) return null;
    if (h === 24) return 23;
    if (h >= 1 && h <= 24) return h - 1;
    if (h >= 0 && h <= 23) return h;
    return null;
  }

  async function loadSurplusMonth(geo, ym) {
    const key = `${geo}-${ym}`;
    if (csvMonthCache.has(key)) return csvMonthCache.get(key);
    const url = `/data/surplus/${geo}/${ym}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
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
      const hourIdx = getHourIndex(r.hora, r.fecha);
      if (hourIdx === null) { missing += 1; return; }

      const data = monthData[ym];
      const dayHours = data?.days?.[dateKey];
      if (!dayHours || !dayHours[hourIdx]) { missing += 1; return; }

      const price = Number(dayHours[hourIdx][1]);
      if (!Number.isFinite(price)) { missing += 1; return; }

      const kwh = Number(r.excedente) || 0;
      const eur = kwh * price;
      totalKwh += kwh;
      totalEur += eur;
      hourly[hourIdx] += kwh;

      if (!monthly[ym]) monthly[ym] = { kwh: 0, eur: 0 };
      monthly[ym].kwh += kwh;
      monthly[ym].eur += eur;

      if (!monthlyHourly[ym]) monthlyHourly[ym] = new Array(24).fill(0);
      monthlyHourly[ym][hourIdx] += kwh;
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

  function parseParams() {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    const now = new Date();
    const defaults = {
      type: 'pvpc',
      geo: '8741',
      year: String(now.getFullYear()),
      month: 'all',
      trendMode: 'daily',
      compareYears: ''
    };

    const type = p.get('type') || defaults.type;
    const geo = p.get('geo') || defaults.geo;
    const year = p.get('year') || defaults.year;
    const month = p.get('month') || defaults.month;

    return {
      type,
      geo,
      year,
      month,
      trendMode: p.get('trendMode') || defaults.trendMode,
      compareYears: p.get('compareYears') || defaults.compareYears
    };
  }

  function writeParams(state, { replace = true } = {}) {
    const url = new URL(window.location.href);
    const p = url.searchParams;

    p.set('type', state.type);
    p.set('geo', state.geo);
    p.set('year', state.year);
    p.set('month', state.month);
    p.set('trendMode', state.trendMode);

    if (state.compareYears && state.compareYears.length) {
      p.set('compareYears', state.compareYears.join(','));
    } else {
      p.delete('compareYears');
    }

    const newUrl = url.pathname + '?' + p.toString() + (url.hash || '');
    if (replace) {
      history.replaceState(null, '', newUrl);
    } else {
      history.pushState(null, '', newUrl);
    }
  }

  function setActive(elOn, elOff) {
    if (!elOn || !elOff) return;
    elOn.classList.add('is-active');
    elOn.setAttribute('aria-selected', 'true');
    elOff.classList.remove('is-active');
    elOff.setAttribute('aria-selected', 'false');
  }

  function setLoadingText() {
    if (els.kpiLast) els.kpiLast.textContent = '—';
    if (els.kpiAvg7) els.kpiAvg7.textContent = '—';
    if (els.kpiAvg30) els.kpiAvg30.textContent = '—';
    if (els.kpiAvg12m) els.kpiAvg12m.textContent = '—';
    if (els.kpiYoY) els.kpiYoY.textContent = '—';

    if (els.kpiLastSub) els.kpiLastSub.textContent = 'Cargando…';
    if (els.kpiAvg7Sub) els.kpiAvg7Sub.textContent = 'Cargando…';
    if (els.kpiAvg30Sub) els.kpiAvg30Sub.textContent = 'Cargando…';
    if (els.kpiAvg12mSub) els.kpiAvg12mSub.textContent = 'Cargando…';
    if (els.kpiYoYSub) els.kpiYoYSub.textContent = 'A mismas fechas';

    if (els.trendMeta) els.trendMeta.textContent = 'Cargando…';
    if (els.hourlyMeta) els.hourlyMeta.textContent = 'Cargando…';
    if (els.hourlyCallout) els.hourlyCallout.textContent = 'Consejo: Cargando…';

    if (els.insightCheapest) els.insightCheapest.textContent = '—';
    if (els.insightWorst) els.insightWorst.textContent = '—';
    if (els.insightRange) els.insightRange.textContent = '—';
  }

  function showError(msg) {
    if (els.kpiLastSub) els.kpiLastSub.textContent = msg;
    if (els.trendMeta) els.trendMeta.textContent = msg;
    if (els.hourlyMeta) els.hourlyMeta.textContent = msg;
    if (els.hourlyCallout) els.hourlyCallout.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function buildMonthlyFromDaily(labels, dailyValues) {
    const sums = new Array(12).fill(0);
    const counts = new Array(12).fill(0);

    labels.forEach((dateStr, i) => {
      const v = dailyValues[i];
      if (!Number.isFinite(v)) return;
      const parts = dateStr.split('-').map(Number);
      if (parts.length !== 3) return;
      const m = parts[1] - 1;
      if (m < 0 || m > 11) return;
      sums[m] += v;
      counts[m] += 1;
    });

    const months = [];
    const values = [];
    for (let m = 0; m < 12; m++) {
      if (counts[m]) {
        months.push(fmtMonth(m));
        values.push(sums[m] / counts[m]);
      } else {
        months.push(fmtMonth(m));
        values.push(null);
      }
    }
    return { labels: months, values, counts };
  }

  function computeWindowOptions(hourlyAvg, duration) {
    const options = [];
    const L = Math.max(1, Math.min(24, duration));
    for (let start = 0; start <= 24 - L; start++) {
      const slice = hourlyAvg.slice(start, start + L);
      const avg = safeMean(slice);
      if (avg === null) continue;
      options.push({ start, end: start + L, avg });
    }
    options.sort((a, b) => a.avg - b.avg);
    return options;
  }

  function hourRangeLabel(start, end) {
    const s = String(start).padStart(2, '0') + ':00';
    const e = String(end).padStart(2, '0') + ':00';
    return `${s}–${e}`;
  }

  function computeHourlyByDayType(yearData, dayType) {
    const sums = new Array(24).fill(0);
    const counts = new Array(24).fill(0);

    const dates = Object.keys(yearData.days || {}).sort();
    for (const dateStr of dates) {
      const d = PVPC_STATS.parseDateLocal(dateStr);
      const dow = d.getDay(); // 0 domingo
      const isWeekend = (dow === 0 || dow === 6);

      if (dayType === 'workday' && isWeekend) continue;
      if (dayType === 'weekend' && !isWeekend) continue;

      const hours = yearData.days[dateStr] || [];
      for (const [ts, price] of hours) {
        const hour = new Date(ts * 1000).getHours();
        if (hour < 0 || hour > 23) continue;
        if (!Number.isFinite(price)) continue;
        sums[hour] += price;
        counts[hour] += 1;
      }
    }

    const avg = sums.map((s, i) => counts[i] ? s / counts[i] : null);
    return { avg, counts };
  }

  function buildTrendDataset(daily, monthly, mode) {
    if (mode === 'daily') return { labels: daily.labels, data: daily.data };
    return { labels: monthly.labels, data: monthly.values };
  }

  function destroyChart(key) {
    try {
      if (charts[key]) {
        charts[key].destroy();
        charts[key] = null;
      }
    } catch (_) {}
  }

  function createGradient(ctx, color) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, color.replace(')', ', 0.4)').replace('rgb', 'rgba'));
    gradient.addColorStop(1, color.replace(')', ', 0.0)').replace('rgb', 'rgba'));
    return gradient;
  }

  function renderTrendChart(daily, monthly, mode, accent, gridColor, textColor, label) {
    const ds = buildTrendDataset(daily, monthly, mode);
    const ctx = canvases.trend.getContext('2d');
    const gradient = createGradient(ctx, accent);

    const config = {
      type: 'line',
      data: {
        labels: ds.labels,
        datasets: [{
          label,
          data: ds.data,
          borderColor: accent,
          backgroundColor: gradient,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: accent,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20, 20, 22, 0.9)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 12,
            cornerRadius: 12,
            displayColors: false,
            callbacks: {
              label: (ctx) => ` ${fmtCents(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: mode === 'daily' ? 8 : 12, font: { family: 'Outfit', weight: '600' } },
            grid: { display: false }
          },
          y: {
            ticks: { color: textColor, callback: (v) => `${toComma(Number(v).toFixed(2))}`, font: { family: 'Outfit', weight: '600' } },
            grid: { color: gridColor, borderDash: [4, 4] },
            border: { display: false }
          }
        }
      }
    };

    destroyChart('trend');
    charts.trend = new Chart(canvases.trend, config);
  }

  function renderHourlyChart(hourlyAvg, accent, gridColor, textColor, label) {
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const ctx = canvases.hourly.getContext('2d');
    const gradient = createGradient(ctx, accent);

    const config = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data: hourlyAvg,
          borderColor: accent,
          backgroundColor: gradient,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: accent,
          pointHoverBorderColor: '#fff',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20, 20, 22, 0.9)',
            padding: 12,
            cornerRadius: 12,
            displayColors: false,
            callbacks: {
              label: (ctx) => ` ${fmtCents(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { family: 'Outfit', weight: '600' } },
            grid: { display: false }
          },
          y: {
            ticks: { color: textColor, callback: (v) => `${toComma(Number(v).toFixed(2))}`, font: { family: 'Outfit', weight: '600' } },
            grid: { color: gridColor, borderDash: [4, 4] },
            border: { display: false }
          }
        }
      }
    };

    destroyChart('hourly');
    charts.hourly = new Chart(canvases.hourly, config);
  }

  function renderCompareChart(monthLabels, datasets, accent, gridColor, textColor) {
    // Para legibilidad: colores alternos a partir del accent sin “arcoíris”.
    const base = accent || '#8B5CF6';
    const colors = [
      base,
      getCssVar('--accent2', '#22C55E') || '#22C55E',
      '#F59E0B',
      '#EF4444'
    ];

    const ds = datasets.map((d, i) => ({
      label: d.label,
      data: d.data,
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length],
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 6,
      tension: 0.4,
      fill: false
    }));

    const config = {
      type: 'line',
      data: { labels: monthLabels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: true, labels: { color: textColor, boxWidth: 10, usePointStyle: true, font: { family: 'Outfit', weight: '700' } } },
          tooltip: {
            backgroundColor: 'rgba(20, 20, 22, 0.9)',
            padding: 12,
            cornerRadius: 12,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtCents(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { ticks: { color: textColor, font: { family: 'Outfit', weight: '600' } }, grid: { display: false } },
          y: {
            ticks: { color: textColor, callback: (v) => `${toComma(Number(v).toFixed(2))}`, font: { family: 'Outfit', weight: '600' } },
            grid: { color: gridColor, borderDash: [4, 4] },
            border: { display: false }
          }
        }
      }
    };

    destroyChart('compare');
    charts.compare = new Chart(canvases.compare, config);
  }

  function computeMonthlyFromYearData(yearData) {
    const labels = [];
    const values = [];

    for (let m = 1; m <= 12; m++) {
      const monthStr = String(m).padStart(2, '0');
      const prefix = `${yearData.meta.year}-${monthStr}-`;
      const dates = Object.keys(yearData.days).filter(d => d.startsWith(prefix)).sort();
      if (!dates.length) {
        labels.push(fmtMonth(m - 1));
        values.push(null);
        continue;
      }

      let sum = 0;
      let cnt = 0;
      for (const dateStr of dates) {
        const hours = yearData.days[dateStr] || [];
        for (const [, price] of hours) {
          if (!Number.isFinite(price)) continue;
          sum += price;
          cnt += 1;
        }
      }
      labels.push(fmtMonth(m - 1));
      values.push(cnt ? (sum / cnt) : null);
    }

    return { labels, values };
  }

  async function computeYoY(type, geo, year, currentEndDateStr, currentYtdAvg) {
    const prevYear = String(Number(year) - 1);
    if (Number(prevYear) < 2021) return null;
    if (!currentEndDateStr) return null;

    const [_, mm, dd] = currentEndDateStr.split('-');
    const prevEnd = `${prevYear}-${mm}-${dd}`;

    const prevData = await PVPC_STATS.loadYearData(Number(geo), Number(prevYear), type);
    const prevDaily = PVPC_STATS.getDailyEvolution(prevData);
    const prevValues = prevDaily.labels
      .map((d, i) => (d <= prevEnd ? prevDaily.data[i] : null))
      .filter(v => Number.isFinite(v));

    const prevAvg = safeMean(prevValues);
    if (!Number.isFinite(prevAvg) || !Number.isFinite(currentYtdAvg) || prevAvg === 0) return null;

    return { prevAvg, pct: ((currentYtdAvg - prevAvg) / prevAvg) * 100, prevEnd };
  }

  function setInsights(monthly, isSurplus) {
    const pairs = monthly.values.map((v, i) => ({ m: i, v })).filter(x => Number.isFinite(x.v));
    if (!pairs.length) return;

    let min = pairs[0];
    let max = pairs[0];
    for (const p of pairs) {
      if (p.v < min.v) min = p;
      if (p.v > max.v) max = p;
    }

    const best = isSurplus ? max : min;
    const worst = isSurplus ? min : max;

    els.insightCheapest.textContent = `${fmtMonth(best.m)} · ${fmtCents(best.v)}`;
    els.insightWorst.textContent = `${fmtMonth(worst.m)} · ${fmtCents(worst.v)}`;
  }

  function setRange(kpis) {
    if (!kpis) return;
    els.insightRange.textContent = `${fmtCents(kpis.minPrice)} – ${fmtCents(kpis.maxPrice)}`;
  }

  function updateCopyForType(isSurplus) {
    if (els.insightCheapestLabel) {
      els.insightCheapestLabel.textContent = 'Mejor mes (media)';
    }
    if (els.insightWorstLabel) {
      els.insightWorstLabel.textContent = 'Peor mes (media)';
    }
    if (els.insightRangeLabel) {
      els.insightRangeLabel.textContent = 'Rango (min–máx)';
    }
    if (els.hourlyTitle) {
      els.hourlyTitle.textContent = isSurplus
        ? '¿A qué horas se pagan mejor los excedentes?'
        : '¿A qué horas suele ser más barato?';
    }
    if (els.hourlySubtitle) {
      els.hourlySubtitle.textContent = isSurplus
        ? 'Perfil horario promedio del año. Útil para estimar a qué horas se pagan mejor los excedentes.'
        : 'Perfil horario promedio del año. Útil para desplazar consumos: termo, lavadora, recarga, cocina, etc.';
    }
    if (els.faqCheapestSummary) {
      els.faqCheapestSummary.textContent = isSurplus
        ? '¿Cuándo se pagan mejor los excedentes?'
        : '¿Cuándo suele ser más barato?';
    }
    if (els.faqCheapestBody) {
      els.faqCheapestBody.textContent = isSurplus
        ? 'A menudo las horas centrales del día tienden a pagar mejor los excedentes (sobre todo con alta producción solar), pero depende del año y de la zona. El gráfico “Perfil horario” te lo muestra de forma directa.'
        : 'A menudo las horas centrales del día tienden a ser más baratas (sobre todo con alta producción solar), pero depende del año y de la zona. El gráfico “Perfil horario” te lo muestra de forma directa.';
    }
  }

  function buildCompareYearChips(allYearsDesc, selectedYears, onToggle) {
    els.compareYears.innerHTML = '';
    for (const y of allYearsDesc) {
      const isOn = selectedYears.includes(y);
      const id = `cy_${y}`;
      const chip = document.createElement('label');
      chip.className = `chip ${isOn ? 'is-on' : ''}`;
      chip.setAttribute('for', id);
      chip.innerHTML = `
        <input id="${id}" type="checkbox" ${isOn ? 'checked' : ''} />
        <span>${y}</span>
      `;
      chip.addEventListener('click', (e) => {
        // dejar que el checkbox cambie, pero manejar lógica aquí
        e.preventDefault();
        onToggle(y);
      });
      els.compareYears.appendChild(chip);
    }
  }

  async function renderComparison(type, geo, selectedYears, year, accent, gridColor, textColor) {
    const datasets = [];
    const baseYear = Number(year);
    let years = Array.isArray(selectedYears) ? selectedYears.slice() : [];

    if (!years.length && Number.isFinite(baseYear)) {
      years = [baseYear, baseYear - 1, baseYear - 2];
    }

    years = years
      .map((y) => Number(y))
      .filter((y) => Number.isFinite(y) && y >= 2021);

    // cargar en paralelo
    const promises = years.map(y => PVPC_STATS.loadYearData(Number(geo), Number(y), type).then(d => ({ y, d })).catch(() => null));
    const results = await Promise.all(promises);

    for (const r of results) {
      if (!r || !r.d) continue;
      const monthly = computeMonthlyFromYearData(r.d);
      datasets.push({ label: String(r.y), data: monthly.values });
    }

    // etiquetas (meses)
    const monthLabels = Array.from({ length: 12 }, (_, i) => fmtMonth(i));
    renderCompareChart(monthLabels, datasets, accent, gridColor, textColor);
  }

  function setTrendMode(state) {
    if (state.trendMode === 'daily') setActive(els.trendModeDaily, els.trendModeMonthly);
    else setActive(els.trendModeMonthly, els.trendModeDaily);
  }

  function applyStateToControls(state) {
    if (els.type) els.type.value = state.type;
    if (els.geo) els.geo.value = state.geo;
    if (els.year) els.year.value = state.year;
    if (els.month) els.month.value = state.month;
    setTrendMode(state);
  }

  function attachThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const key = window.__ALMAX_THEME_KEY || 'almax_theme';

    btn.addEventListener('click', () => {
      const isLight = document.documentElement.classList.toggle('light-mode');
      try {
        localStorage.setItem(key, isLight ? 'light' : 'dark');
      } catch (_) {}
    });
  }

  function attachControlHandlers(state, rerender) {
    const onChange = () => rerender({ push: false });

    if (els.type) els.type.addEventListener('change', () => { state.type = els.type.value; onChange(); });
    els.geo.addEventListener('change', () => { state.geo = els.geo.value; onChange(); });
    els.year.addEventListener('change', () => { state.year = els.year.value; onChange(); });
    if (els.month) els.month.addEventListener('change', () => { state.month = els.month.value; onChange(); });

    els.trendModeMonthly.addEventListener('click', () => { state.trendMode = 'monthly'; rerender({ push: false }); });
    els.trendModeDaily.addEventListener('click', () => { state.trendMode = 'daily'; rerender({ push: false }); });
  }

  function normalizeSelectedYears(year, compareYearsParam) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const minYear = 2021;

    let selected = [];
    if (compareYearsParam) {
      selected = compareYearsParam.split(',')
        .map(s => Number(s.trim()))
        .filter(y => Number.isFinite(y) && y >= minYear && y <= currentYear)
        .sort((a,b) => b-a);
    }
    if (!selected.length) {
      const y = Number(year);
      selected = [y, y - 1, y - 2].filter(v => v >= minYear);
    }
    // Máximo 4 para legibilidad
    return selected.slice(0, 4);
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function computeRolling12m(currentData, prevData) {
    if (!currentData || !currentData.days) return null;

    const merged = { ...(prevData?.days || {}), ...currentData.days };
    const dates = Object.keys(merged).sort();
    if (!dates.length) return null;

    const lastDateStr = dates[dates.length - 1];
    if (!lastDateStr) return null;

    const parts = lastDateStr.split('-').map(Number);
    // lastDateStr is YYYY-MM-DD. parts: [2026, 1, 27] (month is 1-based in split, but Date needs 0-based if using Date, but here we construct string)
    // Cutoff string: Year-1
    const cutoffYear = parts[0] - 1;
    const cutoffStr = `${cutoffYear}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;

    const validValues = [];
    // Iterate backwards
    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      if (d <= cutoffStr) break; // Stop if we go beyond 1 year ago

      const hours = merged[d];
      if (hours && hours.length) {
        const avg = hours.reduce((a, b) => a + b[1], 0) / hours.length;
        validValues.push(avg);
      }
    }

    return safeMean(validValues);
  }

  async function main() {
    if (!window.PVPC_STATS) {
      showError('Motor PVPC no disponible.');
      return;
    }

    attachThemeToggle();

    const csvEls = {
      input: document.getElementById('csvExcedentesInput'),
      btn: document.getElementById('csvExcedentesBtn'),
      kpis: document.getElementById('csvExcedentesKpis'),
      totalKwh: document.getElementById('csvTotalKwh'),
      totalEur: document.getElementById('csvTotalEur'),
      avgEurKwh: document.getElementById('csvAvgEurKwh'),
      bestMonth: document.getElementById('csvBestMonth'),
      worstMonth: document.getElementById('csvWorstMonth'),
      summary: document.getElementById('csvExcedentesSummary'),
      peakHour: document.getElementById('csvPeakHour'),
      topHours: document.getElementById('csvTopHours'),
      tableWrap: document.getElementById('csvExcedentesTableWrap'),
      tableBody: document.getElementById('csvExcedentesTableBody'),
      note: document.getElementById('csvExcedentesNote')
    };

    const params = parseParams();
    const currentSystemYear = String(new Date().getFullYear());
    
    const state = {
      type: params.type || 'pvpc',
      geo: params.geo,
      year: params.year || currentSystemYear,
      month: params.month || 'all',
      trendMode: params.trendMode === 'daily' ? 'daily' : 'monthly',
      compareYears: normalizeSelectedYears(params.year || currentSystemYear, params.compareYears)
    };

    console.log(`[PVPC-OBS] Año detectado por sistema: ${currentSystemYear}`);
    applyStateToControls(state);

    const csvState = {
      records: null
    };

    const formatYmLabel = (ym) => {
      const [y, m] = String(ym).split('-');
      const mi = Number(m) - 1;
      return `${fmtMonth(mi)} ${y}`;
    };

    const renderCsvStats = (stats) => {
      if (!csvEls.kpis) return;
      const hasData = stats && Number.isFinite(stats.totalKwh) && stats.totalKwh > 0;
      csvEls.kpis.hidden = !hasData;
      csvEls.summary.hidden = !hasData;
      csvEls.tableWrap.hidden = !hasData;
      if (csvEls.note) csvEls.note.hidden = false;

      if (!hasData) {
        if (csvEls.note) {
          csvEls.note.textContent = 'Sube un CSV/XLSX con excedentes horarios para ver el cálculo.';
        }
        return;
      }

      if (csvEls.totalKwh) csvEls.totalKwh.textContent = fmtKwh(stats.totalKwh, 1);
      if (csvEls.totalEur) csvEls.totalEur.textContent = fmtEur(stats.totalEur);
      if (csvEls.avgEurKwh) csvEls.avgEurKwh.textContent = fmtCents(stats.avgPrice, 4);

      if (csvEls.bestMonth) {
        csvEls.bestMonth.textContent = stats.best ? `${formatYmLabel(stats.best.ym)} · ${fmtCents(stats.best.avg, 4)}` : '—';
      }
      if (csvEls.worstMonth) {
        csvEls.worstMonth.textContent = stats.worst ? `${formatYmLabel(stats.worst.ym)} · ${fmtCents(stats.worst.avg, 4)}` : '—';
      }

      if (csvEls.peakHour) {
        if (stats.peakHour) {
          const h = stats.peakHour.h;
          const next = (h + 1) % 24;
          csvEls.peakHour.textContent = `${String(h).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00`;
        } else {
          csvEls.peakHour.textContent = '—';
        }
      }
      if (csvEls.topHours) {
        if (stats.topHours && stats.topHours.length) {
          csvEls.topHours.textContent = stats.topHours.map((r) => {
            const next = (r.h + 1) % 24;
            return `${String(r.h).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00 (${toComma((r.share * 100).toFixed(1))}%)`;
          }).join(' · ');
        } else {
          csvEls.topHours.textContent = '—';
        }
      }

      if (csvEls.tableBody) {
        csvEls.tableBody.innerHTML = stats.monthlyRows.map((row) => {
          const win = row.window80;
          const winPct = win ? (win.sum / row.kwh) : 0;
          const winLabel = win
            ? `${String(win.start).padStart(2, '0')}:00–${String((win.end + 1) % 24).padStart(2, '0')}:00 (${win.len}h · ${toComma((winPct * 100).toFixed(1))}%)`
            : '—';
          const peak = Number.isFinite(row.peakHour) ? `${String(row.peakHour).padStart(2, '0')}:00–${String((row.peakHour + 1) % 24).padStart(2, '0')}:00` : '—';
          return `
            <tr>
              <td>${formatYmLabel(row.ym)}</td>
              <td>${fmtKwh(row.kwh, 1)}</td>
              <td>${fmtCents(row.avg, 4)}</td>
              <td>${fmtEur(row.eur)}</td>
              <td>${winLabel}</td>
              <td>${peak}</td>
            </tr>
          `;
        }).join('');
      }

      if (csvEls.note) {
        csvEls.note.textContent = stats.missing
          ? `Nota: ${stats.missing} horas no encontraron precio horario en el histórico para la zona seleccionada.`
          : ' ';
      }
    };

    const refreshCsvStats = async () => {
      if (!csvState.records) return;
      const stats = await computeCsvCompensation(csvState.records, state.geo);
      renderCsvStats(stats);
    };

    if (csvEls.btn && csvEls.input) {
      csvEls.btn.addEventListener('click', () => csvEls.input.click());
      csvEls.input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        csvEls.btn.disabled = true;
        csvEls.btn.textContent = '⏳ Procesando...';
        try {
          const parsed = await parseCsvOrXlsx(file);
          const records = Array.isArray(parsed.records) ? parsed.records : [];
          csvState.records = records;
          await refreshCsvStats();
        } catch (err) {
          renderCsvStats(null);
          if (csvEls.note) {
            csvEls.note.hidden = false;
            csvEls.note.textContent = `Error: ${err?.message || 'No se pudo procesar el archivo.'}`;
          }
        } finally {
          csvEls.btn.disabled = false;
          csvEls.btn.textContent = '📤 Subir CSV/XLSX';
          csvEls.input.value = '';
        }
      });
    }

    const rerender = debounce(async ({ push = false } = {}) => {
      setLoadingText();
      writeParams(state, { replace: !push });

      // activar UI de modo
      setTrendMode(state);

      const accent = getCssVar('--accent', '#8B5CF6');
      const gridColor = document.documentElement.classList.contains('light-mode') ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)';
      const textColor = document.documentElement.classList.contains('light-mode') ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.78)';

      let yearData;
      try {
        yearData = await PVPC_STATS.loadYearData(Number(state.geo), Number(state.year), state.type);
      } catch (e) {
        showError('Error cargando dataset local.');
        return;
      }

      // Cargar año anterior para media móvil 12 meses
      let prevYearData = null;
      try {
        prevYearData = await PVPC_STATS.loadYearData(Number(state.geo), Number(state.year) - 1, state.type);
      } catch (_) {}

      const status = PVPC_STATS.getYearStatus(yearData);

      const daily = PVPC_STATS.getDailyEvolution(yearData);
      const monthly = buildMonthlyFromDaily(daily.labels, daily.data);
      const kpis = PVPC_STATS.getKPIs(yearData);
      const isSurplus = state.type === 'surplus';
      updateCopyForType(isSurplus);

      // KPIs principales
      const lastIdx = daily.labels.length - 1;
      const lastDate = lastIdx >= 0 ? daily.labels[lastIdx] : null;
      const lastVal = lastIdx >= 0 ? daily.data[lastIdx] : null;
      const ytdAvg = safeMean(daily.data);

      const isCurrentYear = String(state.year) === String(new Date().getFullYear());

      // Kpi 1: Último día (o Cierre año)
      els.kpiLast.textContent = fmtCents(lastVal);
      els.kpiLastSub.textContent = lastDate ? (isCurrentYear ? `Media del día · ${lastDate}` : `Cierre a ${lastDate}`) : '—';

      // Kpi 2 & 3: Dinámicos
      if (isCurrentYear) {
        // Modo "En curso": 7 días y 30 días
        const last7 = safeMean(daily.data.slice(Math.max(0, daily.data.length - 7)));
        const last30 = safeMean(daily.data.slice(Math.max(0, daily.data.length - 30)));

        if (els.lblKpi2) els.lblKpi2.textContent = 'Media 7 días';
        els.kpiAvg7.textContent = fmtCents(last7);
        els.kpiAvg7Sub.textContent = lastDate ? `Últimos 7 días` : '—';

        if (els.lblKpi3) els.lblKpi3.textContent = 'Media 30 días';
        els.kpiAvg30.textContent = fmtCents(last30);
        els.kpiAvg30Sub.textContent = lastDate ? `Últimos 30 días` : '—';
      } else {
        // Modo "Histórico": Mínimo y Máximo anual (media diaria)
        let minDay = Infinity, maxDay = -Infinity;
        let minDate = '', maxDate = '';
        
        daily.data.forEach((val, i) => {
          if (Number.isFinite(val)) {
            if (val < minDay) { minDay = val; minDate = daily.labels[i]; }
            if (val > maxDay) { maxDay = val; maxDate = daily.labels[i]; }
          }
        });

        if (minDay === Infinity) minDay = null;
        if (maxDay === -Infinity) maxDay = null;

        const bestDayVal = isSurplus ? maxDay : minDay;
        const bestDayDate = isSurplus ? maxDate : minDate;
        const worstDayVal = isSurplus ? minDay : maxDay;
        const worstDayDate = isSurplus ? minDate : maxDate;

        if (els.lblKpi2) els.lblKpi2.textContent = 'Mejor día del año';
        els.kpiAvg7.textContent = fmtCents(bestDayVal);
        els.kpiAvg7Sub.textContent = bestDayDate || '—';

        if (els.lblKpi3) els.lblKpi3.textContent = 'Peor día del año';
        els.kpiAvg30.textContent = fmtCents(worstDayVal);
        els.kpiAvg30Sub.textContent = worstDayDate || '—';
      }

      // Kpi 4: 12 meses / Anual
      const rolling12m = computeRolling12m(yearData, prevYearData);
      els.kpiAvg12m.textContent = fmtCents(rolling12m);
      els.kpiAvg12mSub.textContent = lastDate ? (isCurrentYear ? 'Últimos 12 meses' : 'Media anual') : '—';

      // YoY (a mismas fechas)
      try {
        const yoy = await computeYoY(state.type, state.geo, state.year, lastDate, ytdAvg);
        if (yoy) {
          els.kpiYoY.textContent = fmtPct(yoy.pct, 0);
          els.kpiYoYSub.textContent = `Hasta ${lastDate} vs ${yoy.prevEnd}`;
        } else {
          els.kpiYoY.textContent = '—';
          els.kpiYoYSub.textContent = 'Sin histórico comparable';
        }
      } catch (_) {
        els.kpiYoY.textContent = '—';
        els.kpiYoYSub.textContent = 'Sin histórico comparable';
      }

      // Tendencia
      const mode = state.trendMode;
      renderTrendChart(
        daily,
        monthly,
        mode,
        accent,
        gridColor,
        textColor,
        isSurplus ? 'Excedentes (media)' : 'PVPC (media)'
      );

      const monthsLoaded = status.monthsLoaded && status.monthsLoaded.length ? status.monthsLoaded.join(', ') : '—';
      const labelPrefix = state.type === 'surplus' ? 'Excedentes' : (geoNames[String(state.geo)] || 'Zona');
      els.trendMeta.textContent = `${labelPrefix} · ${state.year} · meses cargados: ${monthsLoaded}`;
      setInsights(monthly, isSurplus);
      setRange(kpis);

      // Horario
      const hourlySource = (function () {
        if (!state.month || state.month === 'all') return yearData;
        const monthPrefix = `${state.year}-${state.month}-`;
        const days = {};
        Object.keys(yearData.days || {}).forEach((d) => {
          if (d.startsWith(monthPrefix)) days[d] = yearData.days[d];
        });
        return { ...yearData, days };
      })();

      const hourlyAll = PVPC_STATS.getHourlyProfile(hourlySource);
      renderHourlyChart(
        hourlyAll.data,
        accent,
        gridColor,
        textColor,
        isSurplus ? 'Excedentes por hora' : 'PVPC por hora'
      );
      const monthLabel = (state.month && state.month !== 'all') ? ` · ${fmtMonth(Number(state.month) - 1)}` : '';
      const hourlyDays = Object.keys(hourlySource.days || {}).length;
      els.hourlyMeta.textContent = `Perfil promedio${monthLabel} (${hourlyDays} días)`;

      // Consejito basado en mejor bloque 3h
      const windows3 = computeWindowOptions(hourlyAll.data, 3);
      const window3 = windows3.length ? (isSurplus ? windows3[windows3.length - 1] : windows3[0]) : null;
      if (window3) {
        const consejoPrefix = state.type === 'surplus' ? 'de media, el bloque de 3 horas donde mejor se pagan los excedentes' : 'de media, el bloque de 3 horas más barato';
        els.hourlyCallout.innerHTML = `<strong>Consejo:</strong> ${consejoPrefix} suele ser <strong>${hourRangeLabel(window3.start, window3.end)}</strong> (${fmtCents(window3.avg)}).`;
      } else {
        els.hourlyCallout.textContent = 'Consejo: sin datos suficientes.';
      }

      // Comparativa años (mensual)
      const currentYear = new Date().getFullYear();
      const allYears = [];
      for (let y = currentYear; y >= 2021; y--) allYears.push(y);

      const toggleYear = async (y) => {
        const selected = [...state.compareYears];
        const idx = selected.indexOf(y);
        if (idx >= 0) selected.splice(idx, 1);
        else selected.unshift(y);

        // limitar a 4 por legibilidad
        if (selected.length > 4) selected.splice(4);

        state.compareYears = selected.sort((a,b) => b-a);
        buildCompareYearChips(allYears, state.compareYears, toggleYear);
        writeParams(state, { replace: true });

        await renderComparison(state.type, state.geo, state.compareYears, state.year, accent, gridColor, textColor);
      };

      buildCompareYearChips(allYears, state.compareYears, toggleYear);
      await renderComparison(state.type, state.geo, state.compareYears, state.year, accent, gridColor, textColor);

      await refreshCsvStats();
    }, 80);

    attachControlHandlers(state, rerender);
    await rerender({ push: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
