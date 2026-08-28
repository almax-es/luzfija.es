/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

(() => {
  'use strict';

  const statsCsvModule = window.__LF_PvpcStatsCsv || {};
  const {
    computeCsvCompensation,
    parseCsvOrXlsx
  } = statsCsvModule;

  function trackStatsInitIncomplete(dependency) {
    try {
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail('init-incompleto', ['estadisticas', dependency], {
          title: `Observatorio sin dependencia ${dependency}`
        });
      }
    } catch (_) {}
  }

  // Primer anyo con datos en `data/pvpc/` (el dataset arranca en 2021-06).
  // FUENTE UNICA del rango de anyos: la usan parseParams(), normalizeSelectedYears()
  // y populateYearSelector(). El <select> del HTML NO lleva opciones cableadas: si el
  // rango vive en dos sitios, al cruzar el anyo el control queda vacio mientras el
  // estado interno ya trabaja con el anyo nuevo.
  const DATASET_MIN_YEAR = 2021;

  function getAvailableYearsDesc(today = new Date()) {
    const currentYear = today.getFullYear();
    const years = [];
    for (let y = currentYear; y >= DATASET_MIN_YEAR; y--) years.push(y);
    return years;
  }

  function populateYearSelector(select, today = new Date()) {
    if (!select) return [];
    const years = getAvailableYearsDesc(today);
    const rendered = years.map(String);
    const actual = Array.from(select.options).map((o) => o.value);
    // Solo se reconstruye si difiere: evita perder la seleccion en un re-render.
    if (actual.length !== rendered.length || actual.some((v, i) => v !== rendered[i])) {
      select.textContent = '';
      years.forEach((y) => {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        select.appendChild(opt);
      });
    }
    return rendered;
  }

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

    evolutionTitle: document.getElementById('evolutionTitle'),
    trendTitle: document.getElementById('trendTitle'),
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

  const csvSection = document.getElementById('csv-excedentes');

  const canvases = {
    trend: document.getElementById('trendChart'),
    hourly: document.getElementById('hourlyChart'),
    compare: document.getElementById('compareChart')
  };

  let charts = { trend: null, hourly: null, compare: null };

  function trackStatsEvent(eventName, detail, title) {
    try {
      if (typeof window.__LF_trackDetail === 'function') {
        window.__LF_trackDetail(eventName, detail, { title });
      }
    } catch (_) {}
  }

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
    // NBSP para que el espacio entre número y unidad no se "coma" visualmente
    // y para evitar saltos de línea raros en móvil.
    return `${toComma(value.toFixed(decimals))}\u00A0kWh`;
  }

  function safeMean(values) {
    const nums = values.filter(v => Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((a,b) => a + b, 0) / nums.length;
  }

  // Los KPIs no dependen todos del mismo año: rolling 12m y YoY también leen el
  // anterior. No basta con mirar la parcialidad del año visible.
  function getKpiPartialFlags(currentStatus, previousStatus, yoy) {
    const current = Boolean(currentStatus?.partial || currentStatus?.provisional);
    return {
      current,
      rolling12m: current || Boolean(previousStatus?.partial),
      yoy: current || Boolean(yoy?.partial)
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

    const rawType = p.get('type');
    const rawGeo = p.get('geo');
    const rawYear = p.get('year');
    const rawMonth = p.get('month');
    const rawTrendMode = p.get('trendMode');
    const yearNumber = Number(rawYear);

    return {
      type: rawType === 'surplus' || rawType === 'pvpc' ? rawType : defaults.type,
      geo: Object.prototype.hasOwnProperty.call(geoNames, rawGeo) ? rawGeo : defaults.geo,
      year: Number.isInteger(yearNumber) && yearNumber >= DATASET_MIN_YEAR && yearNumber <= now.getFullYear()
        ? String(yearNumber)
        : defaults.year,
      month: rawMonth === 'all' || /^(?:0[1-9]|1[0-2])$/.test(rawMonth || '') ? rawMonth : defaults.month,
      trendMode: rawTrendMode === 'monthly' || rawTrendMode === 'daily' ? rawTrendMode : defaults.trendMode,
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
    elOn.setAttribute('aria-pressed', 'true');
    elOff.classList.remove('is-active');
    elOff.setAttribute('aria-pressed', 'false');
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
    // Subtitulos estrechos: el mensaje largo se queda en los bloques anchos y
    // aqui basta con retirar el "Cargando..." que si no quedaria indefinido.
    if (els.kpiAvg7Sub) els.kpiAvg7Sub.textContent = 'No disponible';
    if (els.kpiAvg30Sub) els.kpiAvg30Sub.textContent = 'No disponible';
    if (els.kpiAvg12mSub) els.kpiAvg12mSub.textContent = 'No disponible';
    if (els.kpiYoYSub) els.kpiYoYSub.textContent = 'No disponible';
  }

  function getMonthCoverage(dateStrings, provisionalDays = []) {
    const dates = [...new Set((dateStrings || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    if (!dates.length) return { complete: false, end: null };

    const [year, month] = dates[0].split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return { complete: false, end: dates[dates.length - 1] };
    }
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
    if (dates.some((d) => !d.startsWith(monthPrefix))) {
      return { complete: false, end: dates[dates.length - 1] };
    }

    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const expectedStart = `${monthPrefix}01`;
    const expectedEnd = `${monthPrefix}${String(lastDay).padStart(2, '0')}`;
    return {
      complete: dates.length === lastDay
        && dates[0] === expectedStart
        && dates[dates.length - 1] === expectedEnd
        && !provisionalDays.some((d) => dates.includes(d)),
      end: dates[dates.length - 1]
    };
  }

  function buildMonthlyFromDaily(labels, dailyValues, provisionalDays = []) {
    const sums = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    const datesByMonth = Array.from({ length: 12 }, () => []);

    labels.forEach((dateStr, i) => {
      const v = dailyValues[i];
      if (!Number.isFinite(v)) return;
      const parts = dateStr.split('-').map(Number);
      if (parts.length !== 3) return;
      const m = parts[1] - 1;
      if (m < 0 || m > 11) return;
      sums[m] += v;
      counts[m] += 1;
      datesByMonth[m].push(dateStr);
    });

    const months = [];
    const values = [];
    const complete = [];
    const coverageTo = [];
    for (let m = 0; m < 12; m++) {
      const coverage = getMonthCoverage(datesByMonth[m], provisionalDays);
      months.push(fmtMonth(m));
      complete.push(coverage.complete);
      coverageTo.push(coverage.end);
      values.push(counts[m] ? (sums[m] / counts[m]) : null);
    }
    return { labels: months, values, counts, complete, coverageTo };
  }

  function computeWindowOptions(hourlyAvg, duration) {
    const options = [];
    const L = Math.max(1, Math.min(24, duration));
    for (let start = 0; start <= 24 - L; start++) {
      const slice = hourlyAvg.slice(start, start + L);
      // Un bloque horario solo es comparable si TODAS sus horas tienen datos. En un
      // día provisional, promediar las horas conocidas e ignorar los `null` restantes
      // convertiría un bloque incompleto en una recomendación aparentemente real.
      if (slice.length !== L || slice.some((value) => !Number.isFinite(value))) continue;
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

  function buildTrendDataset(daily, monthly, mode) {
    if (mode === 'daily') return { labels: daily.labels, data: daily.data, complete: null, coverageTo: null };
    return { labels: monthly.labels, data: monthly.values, complete: monthly.complete, coverageTo: monthly.coverageTo };
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

  function getTrendMaxTicksLimit(mode, width) {
    const compact = Number.isFinite(Number(width)) && Number(width) < 520;
    if (mode === 'daily') return compact ? 3 : 8;
    return compact ? 6 : 12;
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
        animation: { duration: 0 },
        responsive: true,
        maintainAspectRatio: false,
        onResize: (chart, size) => {
          const ticks = chart.options?.scales?.x?.ticks;
          if (ticks) ticks.maxTicksLimit = getTrendMaxTicksLimit(mode, size?.width);
        },
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
              label: (ctx) => {
                const partialMonth = mode === 'monthly' && ds.complete?.[ctx.dataIndex] === false && ds.coverageTo?.[ctx.dataIndex];
                return ` ${fmtCents(ctx.parsed.y)}${partialMonth ? ` · media hasta ${ds.coverageTo[ctx.dataIndex]}` : ''}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: textColor,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: getTrendMaxTicksLimit(mode, canvases.trend.parentElement?.clientWidth || window.innerWidth),
              font: { family: 'Outfit', weight: '600' }
            },
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
        animation: { duration: 0 },
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
        animation: { duration: 0 },
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
      // Una comparativa interanual solo enfrenta meses naturales cerrados. El mes
      // vigente puede ser perfectamente sano y fresco aunque termine hoy: su media
      // hasta la fecha no es equivalente a la media completa de agosto de otro año.
      values.push(cnt && getMonthCoverage(dates, yearData.meta?.provisionalDays || []).complete ? (sum / cnt) : null);
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

    return {
      prevAvg,
      pct: ((currentYtdAvg - prevAvg) / prevAvg) * 100,
      prevEnd,
      partial: Boolean(PVPC_STATS.getYearStatus(prevData)?.partial)
    };
  }

  function getMonthlyExtremes(monthly, isSurplus) {
    const pairs = monthly.values
      .map((v, i) => ({ m: i, v }))
      .filter((x) => Number.isFinite(x.v) && monthly.complete?.[x.m] === true);
    if (!pairs.length) return null;

    let min = pairs[0];
    let max = pairs[0];
    for (const p of pairs) {
      if (p.v < min.v) min = p;
      if (p.v > max.v) max = p;
    }

    return {
      best: isSurplus ? max : min,
      worst: isSurplus ? min : max
    };
  }

  function setInsights(monthly, isSurplus) {
    const extremes = getMonthlyExtremes(monthly, isSurplus);
    if (!extremes) return;

    els.insightCheapest.textContent = `${fmtMonth(extremes.best.m)} · ${fmtCents(extremes.best.v)}`;
    els.insightWorst.textContent = `${fmtMonth(extremes.worst.m)} · ${fmtCents(extremes.worst.v)}`;
  }

  function setRange(kpis) {
    if (!kpis) return;
    els.insightRange.textContent = `${fmtCents(kpis.minPrice)} – ${fmtCents(kpis.maxPrice)}`;
  }

  function updateCopyForType(isSurplus) {
    if (els.evolutionTitle) {
      els.evolutionTitle.textContent = isSurplus ? 'Evolución de los excedentes' : 'Evolución del PVPC';
    }
    if (els.trendTitle) {
      els.trendTitle.textContent = isSurplus ? 'Tendencia de los excedentes' : 'Tendencia del año';
    }
    if (els.insightCheapestLabel) {
      els.insightCheapestLabel.textContent = 'Mejor mes cerrado (media)';
    }
    if (els.insightWorstLabel) {
      els.insightWorstLabel.textContent = 'Peor mes cerrado (media)';
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
        ? 'Paradójicamente, las horas centrales (con más sol) suelen tener precios más bajos debido al exceso de oferta solar (efecto caníbal). A menudo los excedentes se pagan mejor a primera hora de la mañana o última de la tarde. El gráfico “Perfil horario” te muestra la realidad de tu zona.'
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

  async function renderComparison(type, geo, selectedYears, year, accent, gridColor, textColor, isCurrent) {
    if (isCurrent && !isCurrent()) return;

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

    if (isCurrent && !isCurrent()) return;

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
    // Poblar antes de asignar: un <select> descarta un value que no exista entre sus
    // opciones y se queda vacio (value === '', selectedIndex === -1).
    populateYearSelector(els.year);
    if (els.year) els.year.value = state.year;
    if (els.month) els.month.value = state.month;
    setTrendMode(state);
  }

  function getChartThemeColors() {
    const isLight = document.documentElement.classList.contains('light-mode');
    return {
      gridColor: isLight ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)',
      textColor: isLight ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.78)'
    };
  }

  function applyChartTheme(chart, gridColor, textColor) {
    if (!chart?.options) return false;
    const scales = chart.options.scales || {};
    ['x', 'y'].forEach((axis) => {
      if (scales[axis]?.ticks) scales[axis].ticks.color = textColor;
    });
    if (scales.y?.grid) scales.y.grid.color = gridColor;
    const legendLabels = chart.options.plugins?.legend?.labels;
    if (legendLabels) legendLabels.color = textColor;
    if (typeof chart.update === 'function') chart.update('none');
    return true;
  }

  function syncChartTheme() {
    const { gridColor, textColor } = getChartThemeColors();
    Object.values(charts).forEach((chart) => applyChartTheme(chart, gridColor, textColor));
  }

  function attachThemeToggle() {
    const btn = document.getElementById('btnTheme');
    if (!btn) return;
    // shell-lite.js es el propietario del tema en esta pagina. Este listener se limita
    // a repintar el contenido interno de los canvas DESPUES de que el shell cambie la
    // clase; sin ello Chart.js conserva los colores del tema con el que fue construido.
    btn.addEventListener('click', () => {
      setTimeout(syncChartTheme, 0);
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
    const minYear = DATASET_MIN_YEAR;

    let selected = [];
    if (compareYearsParam) {
      selected = [...new Set(compareYearsParam.split(',', 32)
        .map(s => Number(s.trim()))
        .filter(y => Number.isInteger(y) && y >= minYear && y <= currentYear))]
        .sort((a,b) => b-a);
    }
    if (!selected.length) {
      const requested = Number(year);
      const y = Number.isInteger(requested) && requested >= minYear && requested <= currentYear
        ? requested
        : currentYear;
      selected = [y, y - 1, y - 2].filter(v => v >= minYear);
    }
    // Máximo 4 para legibilidad
    return selected.slice(0, 4);
  }

  function getHourlyCoverageState(status, hourlySource, month) {
    const dates = Object.keys(hourlySource?.days || {});
    const provisionalSet = new Set(status?.provisionalDays || []);
    const provisionalDays = dates.filter((d) => provisionalSet.has(d));
    const failedMonths = month === 'all'
      ? [...(status?.failedMonths || [])]
      : (status?.failedMonths || []).filter((m) => m === month);
    return {
      days: dates.length,
      completeDays: Math.max(0, dates.length - provisionalDays.length),
      provisionalDays,
      failedMonths,
      partial: failedMonths.length > 0,
      provisional: provisionalDays.length > 0
    };
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

    // La ventana pertenece al año seleccionado y debe anclarse en SU ultima
    // observacion. Si ese año no cargo ni un solo dia, usar la ultima fecha del
    // año anterior convierte silenciosamente una media vieja en el KPI actual.
    const currentDates = Object.keys(currentData.days).sort();
    if (!currentDates.length) return null;

    const merged = { ...(prevData?.days || {}), ...currentData.days };
    const dates = Object.keys(merged).sort();
    const lastDateStr = currentDates[currentDates.length - 1];
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
    if (typeof computeCsvCompensation !== 'function' || typeof parseCsvOrXlsx !== 'function') {
      showError('La página no terminó de cargarse. Recárgala para abrir el observatorio.');
      trackStatsInitIncomplete('stats-csv');
      return;
    }
    if (!window.PVPC_STATS) {
      showError('Motor PVPC no disponible.');
      trackStatsInitIncomplete('stats-engine');
      return;
    }
    if (typeof window.Chart !== 'function') {
      showError('Los gráficos no terminaron de cargarse. Recarga la página para intentarlo de nuevo.');
      trackStatsInitIncomplete('chartjs');
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

    applyStateToControls(state);

    const csvState = {
      records: null,
      canaryClock: null
    };

    const formatYmLabel = (ym) => {
      const [y, m] = String(ym).split('-');
      const mi = Number(m) - 1;
      return `${fmtMonth(mi)} ${y}`;
    };

    const setCsvNote = (text) => {
      if (!csvEls.note) return;
      csvEls.note.hidden = false;
      if (csvEls.note.textContent === text) return;
      csvEls.note.textContent = text;
    };

    const renderCsvStats = (stats, { announceEmpty = true } = {}) => {
      if (!csvEls.kpis) return;
      const hasData = stats && Number.isFinite(stats.totalKwh) && stats.totalKwh > 0;
      csvEls.kpis.hidden = !hasData;
      csvEls.summary.hidden = !hasData;
      csvEls.tableWrap.hidden = !hasData;
      if (csvEls.note) csvEls.note.hidden = false;

      if (!hasData) {
        if (announceEmpty) setCsvNote('Sube un CSV/XLSX con excedentes horarios para ver el cálculo.');
        return;
      }

      if (csvEls.totalKwh) {
        const inputKwh = Number.isFinite(stats.inputKwh) ? stats.inputKwh : stats.totalKwh;
        csvEls.totalKwh.textContent = fmtKwh(inputKwh, 1);
      }
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
              <td data-label="Mes">${formatYmLabel(row.ym)}</td>
              <td data-label="Energía vertida"><span class="csv-td-value">${fmtKwh(Number.isFinite(row.inputKwh) ? row.inputKwh : row.kwh, 1)}</span></td>
              <td data-label="Precio medio"><span class="csv-td-value">${fmtCents(row.avg, 4)}</span></td>
              <td data-label="Importe"><span class="csv-td-value">${row.pricedHours > 0 ? fmtEur(row.eur) : '—'}</span></td>
              <td data-label="Tramo principal (80%)"><span class="csv-td-value">${winLabel}</span></td>
              <td data-label="Hora pico vertido"><span class="csv-td-value">${peak}</span></td>
            </tr>
          `;
        }).join('');
      }

      setCsvNote(stats.missing
        ? `Nota: ${stats.missing} horas (${fmtKwh(stats.missingKwh || 0, 1)}) no encontraron precio horario en el histórico para la zona seleccionada. La compensación y el precio medio solo incluyen la energía con precio disponible.`
        : 'Archivo procesado correctamente.');
    };

    const refreshCsvStats = async (isCurrent) => {
      if (!csvState.records) return;
      const records = csvState.records;
      const geo = state.geo;
      const crossesCanaryClock = csvState.canaryClock !== null
        && csvState.canaryClock !== (String(geo) === '8742');
      const hasDstTransitionRecords = window.LF?.csvUtils?.hasDstTransitionRecords;
      const hasDstTransition = typeof hasDstTransitionRecords !== 'function'
        || hasDstTransitionRecords(records);
      if (crossesCanaryClock && hasDstTransition) {
        renderCsvStats(null, { announceEmpty: false });
        setCsvNote('La curva contiene un cambio de hora que se numera de forma distinta en Canarias. Reimporta el archivo con la zona seleccionada.');
        return;
      }
      const stats = await computeCsvCompensation(records, geo);
      if (records !== csvState.records || String(geo) !== String(state.geo)) return;
      if (isCurrent && !isCurrent()) return;
      renderCsvStats(stats);
    };

    if (csvEls.btn && csvEls.input) {
      csvEls.btn.addEventListener('click', () => csvEls.input.click());
      csvEls.input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const extension = window.LF?.csvUtils?.safeFileExtensionForTracking?.(file.name) || 'desconocido';
        csvEls.btn.disabled = true;
        csvEls.btn.textContent = '⏳ Procesando...';
        setCsvNote('Procesando archivo…');
        try {
          const importGeo = String(state.geo);
          const parsed = await parseCsvOrXlsx(file, geoNames[importGeo] || 'Península');
          const records = Array.isArray(parsed.records) ? parsed.records : [];
          csvState.records = records;
          csvState.canaryClock = importGeo === '8742';
          await refreshCsvStats();
          trackStatsEvent('csv-import-completado', ['estadisticas', extension], 'CSV/XLSX de excedentes importado en observatorio');
        } catch (err) {
          // Tercer segmento con el motivo, igual que home y solar. Sin el, en analitica se
          // veia solo 'csv-import-error/estadisticas/csv' y no habia forma de saber por que
          // habia fallado la importacion. csvErrorCodeForTracking solo devuelve slugs de una
          // lista cerrada: nunca viaja texto del archivo del usuario.
          const errorCode = window.LF?.csvUtils?.csvErrorCodeForTracking?.(err?.message || '') || 'otro';
          trackStatsEvent('csv-import-error', ['estadisticas', extension, errorCode], 'Error importando CSV/XLSX en observatorio');
          // La selección nueva sustituye conceptualmente a la anterior aunque falle. Si se
          // limpia solo la UI, un cambio posterior de año/zona vuelve a ejecutar
          // refreshCsvStats() y resucita silenciosamente los records del archivo previo.
          csvState.records = null;
          csvState.canaryClock = null;
          renderCsvStats(null, { announceEmpty: false });
          setCsvNote(`Error: ${err?.message || 'No se pudo procesar el archivo.'}`);
        } finally {
          csvEls.btn.disabled = false;
          csvEls.btn.textContent = '📤 Subir CSV/XLSX';
          csvEls.input.value = '';
        }
      });
    }

    let _rerenderToken = 0;
    let _comparisonToken = 0;
    const rerender = debounce(async ({ push = false } = {}) => {
      const myToken = ++_rerenderToken;
      setLoadingText();
      writeParams(state, { replace: !push });

      // activar UI de modo
      setTrendMode(state);

      const accent = getCssVar('--accent', '#8B5CF6');
      const { gridColor, textColor } = getChartThemeColors();

      let yearData;
      try {
        yearData = await PVPC_STATS.loadYearData(Number(state.geo), Number(state.year), state.type);
      } catch (e) {
        // Una carga de una selección anterior puede fallar después de que una selección
        // más reciente ya haya terminado correctamente. Igual que en el camino de éxito,
        // el error solo pertenece al render que lo inició: un render obsoleto no debe
        // sobrescribir la UI actual con un falso "Error cargando dataset local".
        if (myToken !== _rerenderToken) return;
        showError('Error cargando dataset local.');
        return;
      }
      if (myToken !== _rerenderToken) return;

      // Cargar año anterior para media móvil 12 meses
      let prevYearData = null;
      try {
        prevYearData = await PVPC_STATS.loadYearData(Number(state.geo), Number(state.year) - 1, state.type);
      } catch (_) {}
      if (myToken !== _rerenderToken) return;

      const status = PVPC_STATS.getYearStatus(yearData);
      const prevStatus = prevYearData ? PVPC_STATS.getYearStatus(prevYearData) : null;

      const daily = PVPC_STATS.getDailyEvolution(yearData);
      const monthly = buildMonthlyFromDaily(daily.labels, daily.data, status.provisionalDays);
      const kpis = PVPC_STATS.getKPIs(yearData);
      const isSurplus = state.type === 'surplus';
      updateCopyForType(isSurplus);
      if (csvSection) csvSection.hidden = !isSurplus;

      // KPIs principales
      const lastIdx = daily.labels.length - 1;
      const lastDate = lastIdx >= 0 ? daily.labels[lastIdx] : null;
      const lastVal = lastIdx >= 0 ? daily.data[lastIdx] : null;
      const ytdAvg = safeMean(daily.data);

      const isCurrentYear = String(state.year) === String(new Date().getFullYear());

      // Todo KPI derivado de `daily`/`yearData.days` hereda la cobertura del año: si algun
      // mes fallo, esos dias sencillamente NO estan en `daily`, y sin este aviso el KPI se ve
      // identico a uno completo. Antes solo el pie del grafico de tendencia lo señalaba
      // (bloqueante 2, 12/08/2026): rolling 7/30 dias, cierre/YoY y anual quedaban en
      // silencio aunque su ventana de calculo estuviera incompleta.
      const partialFlags = getKpiPartialFlags(status, prevStatus, null);
      const kpiPartialSuffix = partialFlags.current ? ` · ⚠ ${status.provisional && !status.partial ? 'provisional' : 'parcial'}` : '';

      // Kpi 1: Último día (o Cierre año)
      els.kpiLast.textContent = fmtCents(lastVal);
      els.kpiLastSub.textContent = lastDate ? (isCurrentYear ? `Media del día · ${lastDate}${kpiPartialSuffix}` : `Cierre a ${lastDate}${kpiPartialSuffix}`) : '—';

      // Kpi 2 & 3: Dinámicos
      if (isCurrentYear) {
        // Modo "En curso": 7 días y 30 días
        const last7 = safeMean(daily.data.slice(Math.max(0, daily.data.length - 7)));
        const last30 = safeMean(daily.data.slice(Math.max(0, daily.data.length - 30)));

        if (els.lblKpi2) els.lblKpi2.textContent = 'Media 7 días';
        els.kpiAvg7.textContent = fmtCents(last7);
        els.kpiAvg7Sub.textContent = lastDate ? `Últimos 7 días${kpiPartialSuffix}` : '—';

        if (els.lblKpi3) els.lblKpi3.textContent = 'Media 30 días';
        els.kpiAvg30.textContent = fmtCents(last30);
        els.kpiAvg30Sub.textContent = lastDate ? `Últimos 30 días${kpiPartialSuffix}` : '—';
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
        els.kpiAvg7Sub.textContent = bestDayDate ? `${bestDayDate}${kpiPartialSuffix}` : '—';

        if (els.lblKpi3) els.lblKpi3.textContent = 'Peor día del año';
        els.kpiAvg30.textContent = fmtCents(worstDayVal);
        els.kpiAvg30Sub.textContent = worstDayDate ? `${worstDayDate}${kpiPartialSuffix}` : '—';
      }

      // Kpi 4: 12 meses / Anual
      const rolling12m = computeRolling12m(yearData, prevYearData);
      els.kpiAvg12m.textContent = fmtCents(rolling12m);
      const rollingPartialSuffix = partialFlags.rolling12m ? ' · ⚠ parcial' : '';
      const historicalAvgLabel = Number(state.year) === 2021 ? 'Media Jun–Dic' : 'Media anual';
      els.kpiAvg12mSub.textContent = lastDate ? `${isCurrentYear ? 'Últimos 12 meses' : historicalAvgLabel}${rollingPartialSuffix}` : '—';

      // YoY (a mismas fechas)
      try {
        const yoy = await computeYoY(state.type, state.geo, state.year, lastDate, ytdAvg);
        if (myToken !== _rerenderToken) return;
        if (yoy) {
          const yoyPartialSuffix = getKpiPartialFlags(status, prevStatus, yoy).yoy ? ' · ⚠ parcial' : '';
          els.kpiYoY.textContent = fmtPct(yoy.pct, 0);
          els.kpiYoYSub.textContent = `Hasta ${lastDate} vs ${yoy.prevEnd}${yoyPartialSuffix}`;
        } else {
          els.kpiYoY.textContent = '—';
          els.kpiYoYSub.textContent = 'Sin histórico comparable';
        }
      } catch (_) {
        if (myToken !== _rerenderToken) return;
        els.kpiYoY.textContent = '—';
        els.kpiYoYSub.textContent = 'Sin histórico comparable';
      }
      if (myToken !== _rerenderToken) return;

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
      const partialSuffix = status.partial
        ? ` · ⚠ datos parciales: falló ${status.failedMonths.length === 1 ? 'el mes' : 'los meses'} ${status.failedMonths.join(', ')}`
        : (status.provisional ? ` · ⚠ datos provisionales: ${status.provisionalDays.join(', ')}` : '');
      els.trendMeta.textContent = `${labelPrefix} · ${state.year} · meses cargados: ${monthsLoaded}${partialSuffix}`;
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
      const hourlyCoverage = getHourlyCoverageState(status, hourlySource, state.month);
      const dayLabel = hourlyCoverage.provisional
        ? `${hourlyCoverage.completeDays} días completos + ${hourlyCoverage.provisionalDays.length} provisional${hourlyCoverage.provisionalDays.length === 1 ? '' : 'es'}`
        : `${hourlyCoverage.days} días`;
      const hourlyCoverageSuffix = hourlyCoverage.partial
        ? ` · ⚠ cobertura parcial: faltan ${hourlyCoverage.failedMonths.join(', ')}`
        : (hourlyCoverage.provisional ? ' · ⚠ datos provisionales' : '');
      els.hourlyMeta.textContent = `Perfil promedio${monthLabel} (${dayLabel})${hourlyCoverageSuffix}`;

      // Consejito basado en mejor bloque 3h
      const windows3 = computeWindowOptions(hourlyAll.data, 3);
      const window3 = windows3.length ? (isSurplus ? windows3[windows3.length - 1] : windows3[0]) : null;
      if (window3) {
        const consejoPrefix = state.type === 'surplus' ? 'de media, el bloque de 3 horas donde mejor se pagan los excedentes' : 'de media, el bloque de 3 horas más barato';
        const adviceState = hourlyCoverage.partial ? ' parcial' : (hourlyCoverage.provisional ? ' provisional' : '');
        const coverageIntro = adviceState ? 'con la cobertura disponible, ' : '';
        els.hourlyCallout.innerHTML = `<strong>Consejo${adviceState}:</strong> ${coverageIntro}${consejoPrefix} suele ser <strong>${hourRangeLabel(window3.start, window3.end)}</strong> (${fmtCents(window3.avg)}).`;
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

        const comparisonToken = ++_comparisonToken;
        await renderComparison(
          state.type,
          state.geo,
          state.compareYears,
          state.year,
          accent,
          gridColor,
          textColor,
          () => myToken === _rerenderToken && comparisonToken === _comparisonToken
        );
      };

      buildCompareYearChips(allYears, state.compareYears, toggleYear);
      const comparisonToken = ++_comparisonToken;
      await renderComparison(
        state.type,
        state.geo,
        state.compareYears,
        state.year,
        accent,
        gridColor,
        textColor,
        () => myToken === _rerenderToken && comparisonToken === _comparisonToken
      );
      if (myToken !== _rerenderToken) return;

      await refreshCsvStats(() => myToken === _rerenderToken);
    }, 80);

    attachControlHandlers(state, rerender);
    await rerender({ push: false });
  }

  window.__LF_PvpcStatsUiHelpers = {
    getKpiPartialFlags,
    computeWindowOptions,
    parseParams,
    normalizeSelectedYears,
    getMonthCoverage,
    buildMonthlyFromDaily,
    computeMonthlyFromYearData,
    getMonthlyExtremes,
    getHourlyCoverageState,
    computeRolling12m,
    getAvailableYearsDesc,
    populateYearSelector,
    getTrendMaxTicksLimit,
    getChartThemeColors,
    applyChartTheme,
    DATASET_MIN_YEAR
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
