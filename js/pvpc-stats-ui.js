(() => {
  const geoNames = {
    '8741': 'Península',
    '8742': 'Canarias',
    '8743': 'Baleares',
    '8744': 'Ceuta',
    '8745': 'Melilla'
  };

  const sections = {
    trend: document.querySelector('[data-loading][aria-labelledby="trendTitle"]'),
    kpis: document.querySelector('[data-loading][aria-labelledby="kpiTitle"]'),
    savings: document.querySelector('[data-loading][aria-labelledby="savingsTitle"]'),
    heatmap: document.querySelector('[data-loading][aria-labelledby="heatmapTitle"]'),
    clock: document.querySelector('[data-loading][aria-labelledby="clockTitle"]'),
    weekday: document.querySelector('[data-loading][aria-labelledby="weekdayTitle"]'),
    comparison: document.querySelector('[data-loading][aria-labelledby="comparisonTitle"]')
  };

  const elements = {
    geoSelector: document.getElementById('geoSelector'),
    yearSelector: document.getElementById('yearSelector'),
    heroBadges: document.getElementById('heroBadges'),
    heroLastDay: document.getElementById('heroLastDay'),
    heroLastDayDate: document.getElementById('heroLastDayDate'),
    heroAvg7: document.getElementById('heroAvg7'),
    heroAvg30: document.getElementById('heroAvg30'),
    heroYoY: document.getElementById('heroYoY'),
    heroYoYSub: document.getElementById('heroYoYSub'),
    heroContext: document.getElementById('heroContext'),
    heroContextSub: document.getElementById('heroContextSub'),
    dataWarning: document.getElementById('dataWarning'),
    dataMeta: document.getElementById('dataMeta'),
    insightText: document.getElementById('insightText'),
    trendDailyBtn: document.getElementById('trendDailyBtn'),
    trendMonthlyBtn: document.getElementById('trendMonthlyBtn'),
    trendInsights: document.getElementById('trendInsights'),
    trendHint: document.getElementById('trendHint'),
    kpiAvg: document.getElementById('kpiAvg'),
    kpiMin: document.getElementById('kpiMin'),
    kpiMinDate: document.getElementById('kpiMinDate'),
    kpiMax: document.getElementById('kpiMax'),
    kpiMaxDate: document.getElementById('kpiMaxDate'),
    kpiSolar: document.getElementById('kpiSolar'),
    savingsPreset: document.getElementById('savingsPreset'),
    savingsDuration: document.getElementById('savingsDuration'),
    savingsDayType: document.getElementById('savingsDayType'),
    savingsKwh: document.getElementById('savingsKwh'),
    savingsUses: document.getElementById('savingsUses'),
    savingsWindows: document.getElementById('savingsWindows'),
    savingsSummary: document.getElementById('savingsSummary'),
    savingsHint: document.getElementById('savingsHint'),
    heatmapGrid: document.getElementById('heatmapGrid'),
    comparisonControls: document.getElementById('comparisonControls'),
    toast: document.getElementById('toast'),
    modal: document.getElementById('dayModal'),
    modalTitle: document.getElementById('dayModalTitle'),
    modalSubtitle: document.getElementById('dayModalSubtitle'),
    dayCheapest: document.getElementById('dayCheapest'),
    dayExpensive: document.getElementById('dayExpensive'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    useDayBtn: document.getElementById('useDayBtn')
  };

  const charts = {
    trend: null,
    clock: null,
    weekday: null,
    comparison: null,
    day: null
  };

  const worker = 'Worker' in window ? new Worker('/js/pvpc-stats-worker.js') : null;
  let workerId = 0;
  const workerRequests = new Map();

  const state = {
    geoId: elements.geoSelector.value,
    year: elements.yearSelector.value,
    comparisonYears: [],
    visibleYears: new Set(),
    yearData: null,
    yearDataKey: null,
    lastAnalysis: null,
    comparisonToken: 0,
    comparisonMode: 'smooth',
    trendMode: 'daily',
    comparisonSeriesByYear: null,
    comparisonPrefsFromUrl: {},
    savingsOverrides: {
      duration: false,
      kwh: false
    },
    savings: {
      preset: 'lavadora',
      duration: 1,
      dayType: 'any',
      kwh: 0.8,
      usesPerMonth: 10
    }
  };

  const savingsPresets = {
    lavadora: { label: 'Lavadora (1h)', duration: 1, kwh: 0.8 },
    lavavajillas: { label: 'Lavavajillas (2h)', duration: 2, kwh: 1.2 },
    termo: { label: 'Termo (3h)', duration: 3, kwh: 2.5 },
    coche: { label: 'Coche EV (4h)', duration: 4, kwh: 12 },
    personalizado: { label: 'Personalizado', duration: 2, kwh: 1.5 }
  };

  const bestWindowsCache = new Map();

  const setLoading = (section, isLoading) => {
    if (!section) return;
    section.dataset.loading = isLoading ? 'true' : 'false';
  };

  const showToast = (message) => {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    setTimeout(() => elements.toast.classList.remove('show'), 2000);
  };

  const runWorker = (type, payload) => {
    if (!worker) return null;
    const id = workerId++;
    worker.postMessage({ id, type, payload });
    return new Promise((resolve, reject) => {
      workerRequests.set(id, { resolve, reject });
    });
  };

  if (worker) {
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const handler = workerRequests.get(id);
      if (!handler) return;
      workerRequests.delete(id);
      if (error) {
        handler.reject(new Error(error));
      } else {
        handler.resolve(result);
      }
    };
  }

  const getDayOfYearUTC = (year, month, day) => {
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / oneDay) - 1;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '--';
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString('es-ES');
  };

  const formatValue = (value) => {
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  };

  const formatEuroKwh = (value) => {
    if (!Number.isFinite(value)) return '--';
    return `${value.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/kWh`;
  };

  const formatCurrency = (value) => {
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  };

  const formatDelta = (value) => {
    if (!Number.isFinite(value)) return '--';
    const sign = value >= 0 ? 'Ahorro' : 'Sobrecoste';
    return `${sign} ${formatCurrency(Math.abs(value))}`;
  };

  const dayOfYear = (dateStr) => {
    const date = new Date(`${dateStr}T12:00:00`);
    const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
    const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const buildDayOfYearTable = (year) => {
    const totalDays = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    const table = [];
    const date = new Date(Date.UTC(year, 0, 1));
    for (let i = 1; i <= totalDays; i += 1) {
      const iso = date.toISOString().slice(0, 10);
      table[i] = {
        month: date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''),
        monthIndex: date.getUTCMonth(),
        iso,
        day: date.getUTCDate()
      };
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return table;
  };

  const buildMonthlyTicks = (year) => {
    const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return monthLabels.map((label, index) => {
      const dateStr = `${year}-${String(index + 1).padStart(2, '0')}-15`;
      return {
        value: dayOfYear(dateStr),
        label
      };
    });
  };

  const buildMonthIndexTicks = () => {
    const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return monthLabels.map((label, index) => ({ value: index + 1, label }));
  };

  const buildMonthlyPointsFromDaily = (values, dayTable) => {
    const sums = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    (values || []).forEach((value, idx) => {
      const v = Number.isFinite(value) ? value : null;
      if (v === null) return;
      const entry = dayTable[idx + 1];
      const m = entry?.monthIndex;
      if (m === undefined || m === null) return;
      sums[m] += v;
      counts[m] += 1;
    });
    return sums.map((sum, monthIndex) => ({
      x: monthIndex + 1,
      y: counts[monthIndex] ? sum / counts[monthIndex] : null
    }));
  };

  const smoothMovingAverage = (points, window = 7) => {
    const half = Math.floor(window / 2);
    return points.map((point, index) => {
      if (!Number.isFinite(point.y)) {
        return { ...point, y: null };
      }
      let sum = 0;
      let count = 0;
      for (let i = index - half; i <= index + half; i += 1) {
        if (i < 0 || i >= points.length) continue;
        const value = points[i]?.y;
        if (Number.isFinite(value)) {
          sum += value;
          count += 1;
        }
      }
      return {
        ...point,
        y: count ? sum / count : null
      };
    });
  };

  const clampNumber = (value, { min = 0, max = Infinity, fallback = 0 } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  };

  const allowedDurations = [1, 2, 3, 4, 6];

  const normalizeDuration = (value, fallback) => {
    const numeric = clampNumber(value, { min: 1, max: 6, fallback });
    if (allowedDurations.includes(numeric)) return numeric;
    return allowedDurations.reduce((prev, curr) => (
      Math.abs(curr - numeric) < Math.abs(prev - numeric) ? curr : prev
    ), allowedDurations[0]);
  };

  const buildShareParams = () => {
    const params = new URLSearchParams();
    params.set('geo', state.geoId);
    params.set('year', state.year);
    if (state.visibleYears?.size) {
      params.set('visibleYears', Array.from(state.visibleYears).join(','));
    }
    if (state.comparisonMode && state.comparisonMode !== 'smooth') {
      params.set('comparisonMode', state.comparisonMode);
    }
    if (state.savings?.preset) params.set('savingsPreset', state.savings.preset);
    if (state.savings?.duration) params.set('savingsDuration', String(state.savings.duration));
    if (state.savings?.dayType) params.set('savingsDayType', state.savings.dayType);
    if (Number.isFinite(state.savings?.kwh)) params.set('savingsKwh', String(state.savings.kwh));
    if (Number.isFinite(state.savings?.usesPerMonth)) params.set('savingsUses', String(state.savings.usesPerMonth));
    return params;
  };

  const readURL = () => {
    const params = new URLSearchParams(window.location.search);
    const year = params.get('year');
    const geo = params.get('geo');
    const visibleYears = params.get('visibleYears');
    const comparisonMode = params.get('comparisonMode');
    const comparisonShowDaily = params.get('comparisonShowDaily');
    const savingsPreset = params.get('savingsPreset');
    const savingsDuration = params.get('savingsDuration');
    const savingsDayType = params.get('savingsDayType');
    const savingsKwh = params.get('savingsKwh');
    const savingsUses = params.get('savingsUses');

    if (year && document.querySelector(`#yearSelector option[value="${year}"]`)) {
      elements.yearSelector.value = year;
      state.year = year;
    }

    if (geo && document.querySelector(`#geoSelector option[value="${geo}"]`)) {
      elements.geoSelector.value = geo;
      state.geoId = geo;
    }

    if (visibleYears) {
      const parsedYears = visibleYears.split(',').map(value => value.trim()).filter(Boolean);
      state.comparisonPrefsFromUrl.visibleYears = parsedYears;
      state.visibleYears = new Set(parsedYears);
    }

    if (comparisonMode && ['smooth', 'daily', 'monthly'].includes(comparisonMode)) {
      state.comparisonPrefsFromUrl.mode = comparisonMode;
      state.comparisonMode = comparisonMode;
    } else if (comparisonShowDaily !== null) {
      const showDaily = comparisonShowDaily === '1' || comparisonShowDaily === 'true';
      state.comparisonPrefsFromUrl.mode = showDaily ? 'daily' : 'smooth';
      state.comparisonMode = state.comparisonPrefsFromUrl.mode;
    }

    if (savingsPreset && savingsPresets[savingsPreset]) {
      state.savings.preset = savingsPreset;
    }

    if (savingsDuration) {
      state.savings.duration = normalizeDuration(savingsDuration, state.savings.duration);
      state.savingsOverrides.duration = true;
    }

    if (savingsDayType && ['any', 'weekday', 'weekend'].includes(savingsDayType)) {
      state.savings.dayType = savingsDayType;
    }

    if (savingsKwh) {
      state.savings.kwh = clampNumber(savingsKwh, { min: 0.1, max: 100, fallback: state.savings.kwh });
      state.savingsOverrides.kwh = true;
    }

    if (savingsUses) {
      state.savings.usesPerMonth = clampNumber(savingsUses, { min: 1, max: 60, fallback: state.savings.usesPerMonth });
    }
  };

  const updateURL = () => {
    const params = buildShareParams();
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  };

  const updateMeta = (kpis) => {
    const yearLabel = state.year === '2026' ? '2026 (en curso)' : state.year;
    const geoName = geoNames[state.geoId] || 'España';
    const descText = `Precio medio PVPC ${yearLabel} en ${geoName}: ${kpis.avgPrice.toFixed(4)} €/kWh. Mínimo ${kpis.minPrice.toFixed(4)} €, máximo ${kpis.maxPrice.toFixed(4)} €. Gráficos interactivos y análisis histórico.`;

    document.title = `Precio Luz ${yearLabel} - Estadísticas PVPC ${geoName} | LuzFija.es`;

    const metaDescription = document.getElementById('meta-description');
    const ogTitle = document.getElementById('og-title');
    const ogDescription = document.getElementById('og-description');
    const ogUrl = document.getElementById('og-url');
    const canonical = document.getElementById('canonical');
    const twitterTitle = document.getElementById('twitter-title');
    const twitterDesc = document.getElementById('twitter-description');

    if (metaDescription) metaDescription.setAttribute('content', descText);
    if (ogTitle) ogTitle.setAttribute('content', `Estadísticas PVPC ${yearLabel} - ${geoName} | LuzFija.es`);
    if (ogDescription) ogDescription.setAttribute('content', descText);
    if (ogUrl) ogUrl.setAttribute('content', 'https://luzfija.es/estadisticas/');
    if (canonical) canonical.setAttribute('href', 'https://luzfija.es/estadisticas/');
    if (twitterTitle) twitterTitle.setAttribute('content', `Precio Luz ${yearLabel} - ${geoName}`);
    if (twitterDesc) twitterDesc.setAttribute('content', `Media: ${kpis.avgPrice.toFixed(4)} €/kWh | Ver análisis completo →`);
  };

  const setHeroLoading = (isLoading) => {
    if (!elements.heroKpiGrid) return;
    elements.heroKpiGrid.dataset.loading = isLoading ? 'true' : 'false';
  };

  const lastFinite = (values) => {
    if (!Array.isArray(values)) return { index: -1, value: null };
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (Number.isFinite(values[i])) return { index: i, value: values[i] };
    }
    return { index: -1, value: null };
  };

  const avgLastN = (values, n) => {
    if (!Array.isArray(values) || !values.length) return null;
    let sum = 0;
    let count = 0;
    for (let i = values.length - 1; i >= 0 && count < n; i -= 1) {
      const v = values[i];
      if (Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    return count ? sum / count : null;
  };

  const percentileRank = (values, target) => {
    const nums = (values || []).filter(Number.isFinite);
    if (!nums.length || !Number.isFinite(target)) return null;
    let below = 0;
    nums.forEach((v) => { if (v <= target) below += 1; });
    return below / nums.length;
  };

  const describeContext = (rank) => {
    if (!Number.isFinite(rank)) return { label: '—', sub: '' };
    const p = Math.round(rank * 100);
    if (p <= 15) return { label: 'Muy barato', sub: `Percentil ${p} (muy bajo)` };
    if (p <= 35) return { label: 'Barato', sub: `Percentil ${p} (bajo)` };
    if (p <= 65) return { label: 'Normal', sub: `Percentil ${p} (típico)` };
    if (p <= 85) return { label: 'Caro', sub: `Percentil ${p} (alto)` };
    return { label: 'Muy caro', sub: `Percentil ${p} (muy alto)` };
  };

  const renderHeroSummary = async (analysis) => {
    if (!analysis || !state.yearData) return;

    setHeroLoading(true);

    try {
      const series = toDailySeries(state.yearData)?.values || [];
      const last = lastFinite(series);
      const lastDate = last.index >= 0
        ? new Date(Date.UTC(Number(state.year), 0, last.index + 1)).toISOString().slice(0, 10)
        : null;

      const avg7 = avgLastN(series, 7);
      const avg30 = avgLastN(series, 30);

      if (elements.heroLastDay) elements.heroLastDay.textContent = Number.isFinite(last.value) ? formatEuroKwh(last.value) : '--';
      if (elements.heroLastDayDate) elements.heroLastDayDate.textContent = lastDate ? formatDate(lastDate) : '—';
      if (elements.heroAvg7) elements.heroAvg7.textContent = Number.isFinite(avg7) ? formatValue(avg7) : '--';
      if (elements.heroAvg30) elements.heroAvg30.textContent = Number.isFinite(avg30) ? formatValue(avg30) : '--';

      const rank = percentileRank(series, Number.isFinite(avg7) ? avg7 : last.value);
      const context = describeContext(rank);

      if (elements.heroContext) elements.heroContext.textContent = context.label;
      if (elements.heroContextSub) elements.heroContextSub.textContent = context.sub;

      // YoY (YTD) vs año anterior, mismo rango de días disponible
      const currentYear = Number(state.year);
      const prevYear = currentYear - 1;
      const endDateStr = analysis?.status?.updatedUntil || lastDate;
      const endDay = endDateStr ? dayOfYear(endDateStr) : null;

      if (prevYear >= 2022 && endDay) {
        const prevData = await window.PVPC_STATS.loadYearData(state.geoId, prevYear);
        const prevYtd = calculateYtdAverage(prevData, endDay);
        const currYtd = calculateYtdAverage(state.yearData, endDay);
        if (Number.isFinite(prevYtd) && prevYtd > 0 && Number.isFinite(currYtd)) {
          const diff = ((currYtd - prevYtd) / prevYtd) * 100;
          const sign = diff >= 0 ? '+' : '';
          if (elements.heroYoY) elements.heroYoY.textContent = `${sign}${diff.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
          if (elements.heroYoYSub) elements.heroYoYSub.textContent = `YTD vs ${prevYear} (hasta ${formatDate(endDateStr)})`;
        } else {
          if (elements.heroYoY) elements.heroYoY.textContent = '--';
          if (elements.heroYoYSub) elements.heroYoYSub.textContent = `Sin datos comparables (${prevYear}).`;
        }
      } else {
        if (elements.heroYoY) elements.heroYoY.textContent = '--';
        if (elements.heroYoYSub) elements.heroYoYSub.textContent = `Comparativa disponible desde 2022.`;
      }
    } catch (error) {
      console.error(error);
    } finally {
      setHeroLoading(false);
    }
  };

  const updateTrendPills = () => {
    const isDaily = state.trendMode === 'daily';
    const isMonthly = state.trendMode === 'monthly';
    if (elements.trendDailyBtn) {
      elements.trendDailyBtn.classList.toggle('pill--active', isDaily);
      elements.trendDailyBtn.setAttribute('aria-pressed', String(isDaily));
    }
    if (elements.trendMonthlyBtn) {
      elements.trendMonthlyBtn.classList.toggle('pill--active', isMonthly);
      elements.trendMonthlyBtn.setAttribute('aria-pressed', String(isMonthly));
    }
  };

  const renderTrendChart = () => {
    if (!state.yearData) return;
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.trend) charts.trend.destroy();

    const computed = getComputedStyle(document.documentElement);
    const primary = computed.getPropertyValue('--primary-color').trim() || '#3b82f6';
    const textColor = computed.getPropertyValue('--text-main').trim() || '#0f172a';
    const mutedColor = computed.getPropertyValue('--text-muted').trim() || '#64748b';
    const borderColor = computed.getPropertyValue('--border-color').trim() || '#e2e8f0';
    const bgCard = computed.getPropertyValue('--bg-card').trim() || '#ffffff';

    const yearNumber = Number(state.year);
    const dayTable = buildDayOfYearTable(yearNumber);
    const series = toDailySeries(state.yearData)?.values || [];

    const dailyPoints = series.map((value, idx) => ({
      x: idx + 1,
      y: Number.isFinite(value) ? value : null
    }));

    const monthlyPoints = buildMonthlyPointsFromDaily(series, dayTable);

    const isMonthly = state.trendMode === 'monthly';
    const xTicks = isMonthly ? buildMonthIndexTicks() : buildMonthlyTicks(yearNumber);
    const tickLabelMap = new Map(xTicks.map(tick => [tick.value, tick.label]));
    const xMax = isMonthly ? 12 : 366;

    const dataset = {
      label: `PVPC ${state.year}`,
      data: isMonthly ? monthlyPoints : dailyPoints,
      borderColor: primary,
      backgroundColor: hexToRgba(primary, 0.16),
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.25,
      spanGaps: false,
      borderWidth: 2
    };

    charts.trend = new Chart(ctx, {
      type: 'line',
      data: { datasets: [dataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: bgCard,
            titleColor: textColor,
            bodyColor: mutedColor,
            borderColor,
            borderWidth: 1,
            padding: 14,
            cornerRadius: 12,
            displayColors: false,
            callbacks: {
              title: (context) => {
                const x = context[0]?.parsed?.x;
                if (!Number.isFinite(x)) return '';
                if (isMonthly) {
                  return tickLabelMap.get(x) || `Mes ${x}`;
                }
                const entry = dayTable[x];
                if (!entry) return `Día ${x}`;
                return `${entry.day} ${entry.month}`;
              },
              label: (context) => `Media: ${formatEuroKwh(context.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: 1,
            max: xMax,
            border: { display: false },
            grid: { display: false },
            afterBuildTicks: (scale) => {
              scale.ticks = xTicks.map(tick => ({ value: tick.value }));
            },
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              color: mutedColor,
              padding: 10,
              font: { family: "'Outfit', sans-serif", size: 11, weight: 600 },
              callback: (value) => tickLabelMap.get(Number(value)) || ''
            }
          },
          y: {
            beginAtZero: false,
            border: { display: false },
            grid: { color: hexToRgba(borderColor, 0.5), drawBorder: false },
            ticks: {
              padding: 12,
              color: mutedColor,
              font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
              callback: (value) => {
                if (!Number.isFinite(value)) return '';
                return formatEuroKwh(value).replace(' €/kWh', ' €');
              }
            }
          }
        }
      }
    });

    // Insights laterales
    if (elements.trendInsights) {
      const dailyValues = series.filter(Number.isFinite);
      const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const validMonths = monthlyPoints.filter(point => Number.isFinite(point.y));
      const cheapestMonth = validMonths.reduce((best, curr) => (curr.y < best.y ? curr : best), validMonths[0] || { x: 1, y: null });
      const expensiveMonth = validMonths.reduce((best, curr) => (curr.y > best.y ? curr : best), validMonths[0] || { x: 1, y: null });

      const p10 = window.PVPC_STATS.getPercentile(dailyValues, 0.1);
      const p90 = window.PVPC_STATS.getPercentile(dailyValues, 0.9);
      const cheapDays = dailyValues.filter(v => v <= p10).length;
      const expensiveDays = dailyValues.filter(v => v >= p90).length;

      const solar = state.lastAnalysis?.hourlyProfile?.data || [];
      const solarAvg = (solar[12] + solar[13] + solar[14] + solar[15] + solar[16] + solar[17]) / 6;
      const avg = state.lastAnalysis?.kpis?.avgPrice || 0;
      const solarDiff = Number.isFinite(solarAvg) && avg ? ((solarAvg - avg) / avg) * 100 : 0;

      elements.trendInsights.innerHTML = `
        <li><strong>Mes más barato:</strong> ${Number.isFinite(cheapestMonth.y) ? `${monthNames[(cheapestMonth.x || 1) - 1]} · ${formatEuroKwh(cheapestMonth.y)}` : '—'}</li>
        <li><strong>Mes más caro:</strong> ${Number.isFinite(expensiveMonth.y) ? `${monthNames[(expensiveMonth.x || 1) - 1]} · ${formatEuroKwh(expensiveMonth.y)}` : '—'}</li>
        <li><strong>Rango típico diario (P10–P90):</strong> ${Number.isFinite(p10) && Number.isFinite(p90) ? `${formatEuroKwh(p10)} → ${formatEuroKwh(p90)}` : '—'}</li>
        <li><strong>Días extremos:</strong> ${cheapDays} muy baratos · ${expensiveDays} muy caros</li>
        <li><strong>Valle solar (12–17h):</strong> ${Number.isFinite(solarAvg) ? `${formatEuroKwh(solarAvg)} (${solarDiff.toLocaleString('es-ES', { maximumFractionDigits: 1 })}% vs media)` : '—'}</li>
      `;
    }

    if (elements.trendHint) {
      elements.trendHint.textContent = isMonthly
        ? 'Vista mensual: muestra la media de cada mes para ver la tendencia sin ruido.'
        : 'Vista diaria: cada punto es la media del día. Útil para detectar picos y valles.';
    }

    updateTrendPills();
  };

  const renderKPIs = ({ kpis, hourlyProfile }) => {
    elements.kpiAvg.textContent = formatValue(kpis.avgPrice);
    elements.kpiMin.textContent = formatValue(kpis.minPrice);
    elements.kpiMinDate.textContent = `${formatDate(kpis.minHour?.date)} (${new Date(kpis.minHour?.ts * 1000).getHours()}:00)`;
    elements.kpiMax.textContent = formatValue(kpis.maxPrice);
    elements.kpiMaxDate.textContent = `${formatDate(kpis.maxHour?.date)} (${new Date(kpis.maxHour?.ts * 1000).getHours()}:00)`;

    const hourly = hourlyProfile.data;
    const solarAvg = (hourly[12] + hourly[13] + hourly[14] + hourly[15] + hourly[16] + hourly[17]) / 6;
    elements.kpiSolar.textContent = formatValue(solarAvg || 0);
  };

  const formatStatusDate = (dateStr) => {
    if (!dateStr) return '--';
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString('es-ES');
  };

  const renderStatusBadges = (status) => {
    if (!elements.heroBadges || !status) return;
    const coverageStart = formatStatusDate(status.coverageFrom);
    const updatedUntil = formatStatusDate(status.updatedUntil);
    const coverageIsPartial = status.coverageFrom && status.coverageFrom !== `${state.year}-01-01`;
    const completionPercent = Number.isFinite(status.coverageCompleteness)
      ? Math.round(status.coverageCompleteness * 100)
      : 0;

    elements.heroBadges.innerHTML = `
      <span class="badge badge-muted">Actualizado hasta: ${updatedUntil}</span>
      <span class="badge badge-muted">${coverageIsPartial ? `Cobertura parcial oficial: desde ${coverageStart}` : `Cobertura: desde ${coverageStart}`}</span>
      <span class="badge">Completitud (rango): ${completionPercent}%</span>
    `;

    if (elements.dataMeta) {
      const months = status.monthsLoaded?.length ? status.monthsLoaded.join(', ') : '—';
      elements.dataMeta.textContent = `Días cargados: ${status.loadedDays} · Meses: ${months}`;
    }
  };

  const renderDataWarning = (status) => {
    if (!elements.dataWarning || !status) return;
    elements.dataWarning.textContent = '';
    const currentYear = Number(state.year) === new Date().getFullYear();
    if (!currentYear || !status.updatedUntil) return;
    const updatedDate = new Date(`${status.updatedUntil}T12:00:00`);
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (updatedDate < todayDate) {
      elements.dataWarning.textContent = `Aviso: faltan días recientes. Último dato disponible el ${formatStatusDate(status.updatedUntil)}.`;
    }
  };

  const calculateYtdAverage = (yearData, endDayOfYear) => {
    const series = toDailySeries(yearData).values;
    const limit = Math.min(series.length, endDayOfYear);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < limit; i += 1) {
      const value = series[i];
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    return count ? sum / count : null;
  };

  const renderInsight = async (kpis, geoId, status) => {
    const currentYear = Number(state.year);
    const prevYear = currentYear - 1;

    if (prevYear >= 2022) {
      const prevData = await window.PVPC_STATS.loadYearData(geoId, prevYear);
      if (!prevData || !Object.keys(prevData.days).length) {
        elements.insightText.textContent = `Analizando el mercado de ${currentYear}. Usa el reloj del ahorro para planificar tu consumo.`;
        return;
      }
      const isCurrentYear = String(currentYear) === new Date().getFullYear().toString();
      if (isCurrentYear && status?.updatedUntil) {
        const endDay = dayOfYear(status.updatedUntil);
        const prevYtd = calculateYtdAverage(prevData, endDay);
        const currentYtd = calculateYtdAverage(state.yearData, endDay);
        const diff = prevYtd ? ((currentYtd - prevYtd) / prevYtd) * 100 : 0;
        const trend = diff > 0 ? 'más caro' : 'más barato';
        elements.insightText.textContent = `YTD ${currentYear}: el PVPC está siendo un ${Math.abs(diff).toLocaleString('es-ES', { maximumFractionDigits: 1 })}% ${trend} que en ${prevYear} en el mismo rango.`;
        return;
      }

      const prevAvg = window.PVPC_STATS.getKPIs(prevData).avgPrice;
      const diff = prevAvg ? ((kpis.avgPrice - prevAvg) / prevAvg) * 100 : 0;
      const trend = diff > 0 ? 'más caro' : 'más barato';
      const verb = String(currentYear) === new Date().getFullYear().toString() ? 'está siendo' : 'fue';
      elements.insightText.textContent = `En ${currentYear}, el PVPC ${verb} un ${Math.abs(diff).toLocaleString('es-ES', { maximumFractionDigits: 1 })}% ${trend} que en ${prevYear}.`;
    } else {
      elements.insightText.textContent = `Analizando el mercado de ${currentYear}. Usa el reloj del ahorro para planificar tu consumo.`;
    }
  };

  const buildHeatmap = (heatmapData) => {
    if (!elements.heatmapGrid) return;
    elements.heatmapGrid.innerHTML = '';
    const year = Number(state.year);
    
    // 1. Generar etiquetas de meses
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    monthNames.forEach((m, i) => {
      // Calcular columna aproximada (semana) para el mes
      const date = new Date(year, i, 1);
      const dayOfYear = getDayOfYearUTC(year, i + 1, 1);
      const weekIndex = Math.floor(dayOfYear / 7) + 1;
      
      const label = document.createElement('div');
      label.className = 'heatmap-month-label';
      label.textContent = m;
      label.style.gridColumnStart = weekIndex;
      label.style.gridRowStart = 1;
      elements.heatmapGrid.appendChild(label);
    });

    // 2. Generar días
    const firstDay = new Date(year, 0, 1);
    const offsetDay = (day => (day + 6) % 7)(firstDay.getDay()); 

    heatmapData.forEach((day) => {
      const date = new Date(`${day.date}T12:00:00`);
      const dayOfYear = getDayOfYearUTC(date.getFullYear(), date.getMonth() + 1, date.getDate());
      const weekIndex = Math.floor((dayOfYear + offsetDay) / 7) + 1;
      const dayOfWeek = (date.getDay() + 6) % 7; // 0=Lunes

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'heatmap-day';
      btn.style.background = `var(--color-level-${day.intensity})`;
      btn.style.gridColumnStart = weekIndex;
      btn.style.gridRowStart = dayOfWeek + 2; // +2 porque row 1 son labels
      btn.setAttribute('data-tip', `${formatDate(day.date)} · ${formatValue(day.price)} €/kWh`);
      btn.setAttribute('aria-label', `Detalle del día ${formatDate(day.date)}`);
      btn.dataset.date = day.date;
      elements.heatmapGrid.appendChild(btn);
    });
  };

const renderClockChart = (hourlyProfile) => {
  const canvas = document.getElementById('clockChart');
  if (!canvas || !hourlyProfile) return;
  const ctx = canvas.getContext('2d');
  if (charts.clock) charts.clock.destroy();

  const computed = getComputedStyle(document.documentElement);
  const primary = computed.getPropertyValue('--primary-color').trim() || '#3b82f6';
  const textColor = computed.getPropertyValue('--text-main').trim() || '#0f172a';
  const mutedColor = computed.getPropertyValue('--text-muted').trim() || '#64748b';
  const borderColor = computed.getPropertyValue('--border-color').trim() || '#e2e8f0';
  const bgCard = computed.getPropertyValue('--bg-card').trim() || '#ffffff';

  charts.clock = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hourlyProfile.labels,
      datasets: [{
        label: 'Media horaria (€/kWh)',
        data: hourlyProfile.data,
        borderColor: primary,
        backgroundColor: hexToRgba(primary, 0.18),
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: bgCard,
          titleColor: textColor,
          bodyColor: mutedColor,
          borderColor,
          borderWidth: 1,
          padding: 14,
          cornerRadius: 12,
          displayColors: false,
          callbacks: {
            label: (context) => `Media: ${formatEuroKwh(context.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: mutedColor,
            font: { family: "'Outfit', sans-serif", size: 10, weight: 600 },
            maxRotation: 0,
            autoSkip: true
          },
          border: { display: false }
        },
        y: {
          beginAtZero: false,
          grid: { color: hexToRgba(borderColor, 0.5) },
          ticks: {
            color: mutedColor,
            font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
            callback: (value) => {
              if (!Number.isFinite(value)) return '';
              return formatEuroKwh(value).replace(' €/kWh', ' €');
            }
          },
          border: { display: false }
        }
      }
    }
  });
};

const renderWeekdayChart = (weekdayProfile) => {
  const canvas = document.getElementById('weekdayChart');
  if (!canvas || !weekdayProfile) return;
  const ctx = canvas.getContext('2d');
  if (charts.weekday) charts.weekday.destroy();

  const computed = getComputedStyle(document.documentElement);
  const primary = computed.getPropertyValue('--primary-color').trim() || '#3b82f6';
  const mutedColor = computed.getPropertyValue('--text-muted').trim() || '#64748b';
  const borderColor = computed.getPropertyValue('--border-color').trim() || '#e2e8f0';

  charts.weekday = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weekdayProfile.labels,
      datasets: [{
        data: weekdayProfile.data,
        backgroundColor: hexToRgba(primary, 0.7),
        borderColor: primary,
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: mutedColor, font: { family: "'Outfit', sans-serif", size: 11, weight: 600 } },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { color: hexToRgba(borderColor, 0.5) },
          ticks: {
            color: mutedColor,
            font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
            callback: (value) => {
              if (!Number.isFinite(value)) return '';
              return formatEuroKwh(value).replace(' €/kWh', ' €');
            }
          },
          border: { display: false }
        }
      }
    }
  });
};

  const buildDailyHourlyAverages = (yearData, dayType = 'any') => {
    const daily = [];
    Object.entries(yearData.days).forEach(([dateStr, hours]) => {
      if (dayType !== 'any') {
        const day = new Date(`${dateStr}T12:00:00`).getDay();
        const isWeekend = day === 0 || day === 6;
        if (dayType === 'weekday' && isWeekend) return;
        if (dayType === 'weekend' && !isWeekend) return;
      }
      const buckets = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
      hours.forEach(([ts, price]) => {
        const hour = new Date(ts * 1000).getHours();
        buckets[hour].sum += price;
        buckets[hour].count += 1;
      });
      const hourly = buckets.map(bucket => (bucket.count ? bucket.sum / bucket.count : null));
      daily.push({ dateStr, hourly });
    });
    return daily;
  };

  const formatHourLabel = (startHour, duration) => {
    const pad = (value) => String(value).padStart(2, '0');
    const endHour = (startHour + duration) % 24;
    return `${pad(startHour)}:00–${pad(endHour)}:00`;
  };

  const computeBestWindowsLocal = (yearData, options = {}) => {
    const duration = Math.max(1, Number(options.duration) || 1);
    const dayType = options.dayType || 'any';
    const daily = buildDailyHourlyAverages(yearData, dayType);
    const windows = [];

    for (let start = 0; start < 24; start += 1) {
      const values = [];
      daily.forEach(({ hourly }) => {
        let sum = 0;
        let valid = true;
        for (let offset = 0; offset < duration; offset += 1) {
          const idx = (start + offset) % 24;
          const value = hourly[idx];
          if (!Number.isFinite(value)) {
            valid = false;
            break;
          }
          sum += value;
        }
        if (valid) {
          values.push(sum / duration);
        }
      });

      windows.push({
        startHour: start,
        label: formatHourLabel(start, duration),
        sampleCount: values.length,
        p10: window.PVPC_STATS.getPercentile(values, 0.1),
        p50: window.PVPC_STATS.getPercentile(values, 0.5),
        p90: window.PVPC_STATS.getPercentile(values, 0.9)
      });
    }

    const validWindows = windows.filter(windowItem => windowItem.sampleCount > 0);
    const sortedByP50 = [...validWindows].sort((a, b) => a.p50 - b.p50);
    const topWindows = sortedByP50.slice(0, 3);
    const worstWindow = [...validWindows].sort((a, b) => b.p50 - a.p50)[0] || null;
    const peakWindow = duration === 2
      ? validWindows.find(windowItem => windowItem.startHour === 20) || worstWindow
      : worstWindow;

    return {
      topWindows,
      worstWindow,
      peakWindow,
      dayCount: daily.length
    };
  };

  const toDailySeries = (yearData) => {
    if (window.PVPC_STATS?.toDailySeries) {
      return window.PVPC_STATS.toDailySeries(yearData);
    }

    const values = new Array(366).fill(null);
    const sortedDates = Object.keys(yearData.days).sort();
    sortedDates.forEach(dateStr => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dayOfYear = getDayOfYearUTC(y, m, d);
      const hours = yearData.days[dateStr];
      const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;
      if (dayOfYear >= 0 && dayOfYear < 366) {
        values[dayOfYear] = avg;
      }
    });

    return {
      values,
      coverageFrom: sortedDates.length ? sortedDates[0] : null,
      coverageTo: sortedDates.length ? sortedDates[sortedDates.length - 1] : null
    };
  };

  const buildComparisonFromSeries = (seriesByYear) => {
    return { seriesByYear };
  };

  const getBestWindowsCacheKey = (geoId, year, duration, dayType) => (
    `bestWindows:${geoId}:${year}:${duration}:${dayType}`
  );

  const loadBestWindowsCache = (cacheKey, updatedUntil) => {
    if (bestWindowsCache.has(cacheKey)) {
      return bestWindowsCache.get(cacheKey);
    }
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const stored = JSON.parse(raw);
      if (stored?.updatedUntil && updatedUntil && stored.updatedUntil !== updatedUntil) {
        return null;
      }
      bestWindowsCache.set(cacheKey, stored.result);
      return stored.result;
    } catch (error) {
      return null;
    }
  };

  const saveBestWindowsCache = (cacheKey, result, updatedUntil) => {
    bestWindowsCache.set(cacheKey, result);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ updatedUntil, result }));
    } catch (error) {
      console.error(error);
    }
  };

  const renderSavingsResults = (result) => {
    if (!elements.savingsWindows || !elements.savingsSummary) return;
    if (!result?.topWindows?.length) {
      elements.savingsWindows.innerHTML = '<li class="window-item">No hay suficientes datos para esta combinación.</li>';
      elements.savingsSummary.innerHTML = '';
      if (elements.savingsHint) {
        elements.savingsHint.textContent = 'Prueba con otra duración o rango de días.';
      }
      return;
    }

    const kwh = state.savings.kwh;
    const uses = state.savings.usesPerMonth;
    const avgPrice = state.lastAnalysis?.kpis?.avgPrice || 0;
    const baseline = result.peakWindow || result.worstWindow;
    const baselinePrice = baseline?.p50 || avgPrice;

    elements.savingsWindows.innerHTML = result.topWindows.map((windowItem, index) => {
      const costPerUse = windowItem.p50 * kwh;
      const costPerMonth = costPerUse * uses;
      const savingsVsPeak = (baselinePrice - windowItem.p50) * kwh;
      const savingsVsAvg = (avgPrice - windowItem.p50) * kwh;
      return `
        <li class="window-item">
          <div class="window-item__title">
            <span>#${index + 1}</span>
            <strong>${windowItem.label}</strong>
          </div>
          <div class="window-item__meta">
            <span>Precio típico (P50): ${formatEuroKwh(windowItem.p50)}</span>
            <span>Rango P10–P90: ${formatEuroKwh(windowItem.p10)} → ${formatEuroKwh(windowItem.p90)}</span>
          </div>
          <div class="window-item__meta window-item__meta--stack">
            <span>≈ ${formatCurrency(costPerUse)} por uso · ≈ ${formatCurrency(costPerMonth)} / mes</span>
            <span>${formatDelta(savingsVsPeak)} vs hora cara típica</span>
            <span>${formatDelta(savingsVsAvg)} vs media anual</span>
          </div>
        </li>
      `;
    }).join('');

    const best = result.topWindows[0];
    const bestCost = best.p50 * kwh;
    const bestMonthly = bestCost * uses;
    const baselineCost = baselinePrice * kwh;
    const monthlyPeakDiff = (baselinePrice - best.p50) * kwh * uses;
    const monthlyAvgDiff = (avgPrice - best.p50) * kwh * uses;

    elements.savingsSummary.innerHTML = `
      <li><strong>Ventana líder:</strong> ${best.label} · ${formatEuroKwh(best.p50)}</li>
      <li><strong>Coste estimado:</strong> ${formatCurrency(bestCost)} por uso · ${formatCurrency(bestMonthly)} al mes</li>
      <li><strong>Hora cara típica:</strong> ${baseline?.label || '—'} · ${formatEuroKwh(baselinePrice)} (${formatCurrency(baselineCost)} por uso)</li>
      <li><strong>Impacto mensual:</strong> ${formatDelta(monthlyPeakDiff)} vs hora cara · ${formatDelta(monthlyAvgDiff)} vs media anual</li>
    `;

    if (elements.savingsHint) {
      elements.savingsHint.textContent = `Cálculo basado en ${result.dayCount} días con datos válidos. Ventanas permiten cruzar medianoche.`;
    }
  };

  const loadSavingsWindows = async () => {
    if (!state.yearData) return;
    const { duration, dayType } = state.savings;
    const cacheKey = getBestWindowsCacheKey(state.geoId, state.year, duration, dayType);
    const updatedUntil = state.lastAnalysis?.status?.updatedUntil || null;

    const cached = loadBestWindowsCache(cacheKey, updatedUntil);
    if (cached) {
      renderSavingsResults(cached);
      setLoading(sections.savings, false);
      return;
    }

    setLoading(sections.savings, true);
    try {
      const result = worker
        ? await runWorker('bestWindows', { yearData: state.yearData, options: { duration, dayType } })
        : computeBestWindowsLocal(state.yearData, { duration, dayType });
      if (result) {
        saveBestWindowsCache(cacheKey, result, updatedUntil);
        renderSavingsResults(result);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(sections.savings, false);
    }
  };

  const syncSavingsInputs = () => {
    if (!elements.savingsPreset) return;
    elements.savingsPreset.value = state.savings.preset;
    if (elements.savingsDuration) elements.savingsDuration.value = String(state.savings.duration);
    if (elements.savingsDayType) elements.savingsDayType.value = state.savings.dayType;
    if (elements.savingsKwh) elements.savingsKwh.value = String(state.savings.kwh);
    if (elements.savingsUses) elements.savingsUses.value = String(state.savings.usesPerMonth);
  };

  const applyPreset = (presetKey, { sync = true } = {}) => {
    const preset = savingsPresets[presetKey];
    if (!preset) return;
    state.savings.preset = presetKey;
    if (!state.savingsOverrides.duration) {
      state.savings.duration = preset.duration;
    }
    if (!state.savingsOverrides.kwh) {
      state.savings.kwh = preset.kwh;
    }
    if (sync) syncSavingsInputs();
  };

  const hexToRgba = (hex, alpha) => {
    const value = hex.replace('#', '');
    const numeric = value.length === 3
      ? value.split('').map((c) => c + c).join('')
      : value;
    const int = parseInt(numeric, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const getComparisonPrefsKey = (geoId) => `comparisonPrefs:${geoId}`;

  const loadComparisonPrefs = (geoId) => {
    try {
      const raw = localStorage.getItem(getComparisonPrefsKey(geoId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const saveComparisonPrefs = (geoId) => {
    try {
      const payload = {
        visibleYears: Array.from(state.visibleYears),
        mode: state.comparisonMode
      };
      localStorage.setItem(getComparisonPrefsKey(geoId), JSON.stringify(payload));
    } catch (error) {
      console.error(error);
    }
  };

  const applyComparisonVisibility = () => {
    if (!charts.comparison) return;
    charts.comparison.data.datasets.forEach(dataset => {
      dataset.hidden = !state.visibleYears.has(dataset.label);
      const isSelected = dataset.label === state.year;
      dataset.borderWidth = isSelected ? 3 : 1.5;
      dataset.borderColor = isSelected ? dataset.baseColor : hexToRgba(dataset.baseColor, 0.35);
      dataset.backgroundColor = isSelected ? dataset.fillColor : 'transparent';
      dataset.order = isSelected ? 0 : 1;
    });
    charts.comparison.update('none');
  };

  const updateComparisonVisibility = (chart, visibleYearsSet) => {
    if (!chart) return;
    chart.data.datasets.forEach(dataset => {
      dataset.hidden = !visibleYearsSet.has(dataset.label);
    });
    chart.update('none');
  };

  const updateComparisonSeries = (chart) => {
    if (!chart) return;
    chart.data.datasets.forEach(dataset => {
      if (state.comparisonMode === 'daily') dataset.data = dataset.dailyPoints;
      else if (state.comparisonMode === 'monthly') dataset.data = dataset.monthlyPoints;
      else dataset.data = dataset.smoothPoints;
    });
    chart.update('none');
  };

  const buildShareUrl = () => {
    const params = buildShareParams();
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  const copyShareUrl = async () => {
    const url = buildShareUrl();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast('Enlace copiado al portapapeles.');
      } else {
        window.prompt('Copia el enlace:', url);
      }
    } catch (error) {
      console.error(error);
      showToast('No se pudo copiar el enlace.');
    }
  };

  const downloadComparisonPng = () => {
    const canvas = document.getElementById('comparisonChart');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparativa-pvpc-${state.geoId}-${state.year}.png`;
    link.click();
  };

  const buildCsvForVisibleYears = () => {
    const seriesByYear = state.comparisonSeriesByYear;
    if (!seriesByYear) return '';
    const fallbackYears = state.visibleYears?.size ? Array.from(state.visibleYears) : [state.year];
    const years = fallbackYears.filter(year => seriesByYear[year]);
    if (!years.length) return '';

    if (years.length === 1) {
      const year = years[0];
      const values = seriesByYear[year]?.values || [];
      const rows = ['date,dayOfYear,year,avgPriceEurKwh'];
      values.forEach((value, index) => {
        const day = index + 1;
        const date = new Date(Date.UTC(Number(year), 0, day));
        const dateStr = date.toISOString().slice(0, 10);
        const valueStr = Number.isFinite(value) ? value.toFixed(6) : '';
        rows.push(`${dateStr},${day},${year},${valueStr}`);
      });
      return rows.join('\n');
    }

    const rows = [];
    const header = ['dateApprox', 'dayOfYear', ...years];
    rows.push(header.join(','));
    const maxDays = 366;
    for (let index = 0; index < maxDays; index += 1) {
      const day = index + 1;
      const date = new Date(Date.UTC(2024, 0, day));
      const dateApprox = date.toISOString().slice(5, 10);
      const row = [dateApprox, day];
      years.forEach((year) => {
        const value = seriesByYear[year]?.values?.[index];
        row.push(Number.isFinite(value) ? value.toFixed(6) : '');
      });
      rows.push(row.join(','));
    }
    return rows.join('\n');
  };

  const downloadComparisonCsv = () => {
    const csv = buildCsvForVisibleYears();
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparativa-pvpc-${state.geoId}-${state.year}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderComparisonControls = (years, selectedYear) => {
    if (!elements.comparisonControls) return;
    elements.comparisonControls.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'comparison-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-sm btn-outline';
    copyBtn.textContent = 'Copiar enlace';
    copyBtn.addEventListener('click', copyShareUrl);

    const pngBtn = document.createElement('button');
    pngBtn.type = 'button';
    pngBtn.className = 'btn btn-sm btn-outline';
    pngBtn.textContent = 'Descargar PNG';
    pngBtn.addEventListener('click', downloadComparisonPng);

    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'btn btn-sm btn-outline';
    csvBtn.textContent = 'Descargar CSV';
    csvBtn.addEventListener('click', downloadComparisonCsv);

    actions.append(copyBtn, pngBtn, csvBtn);
    elements.comparisonControls.appendChild(actions);

    const header = document.createElement('div');
    header.className = 'segmented';

    const showAllBtn = document.createElement('button');
    showAllBtn.type = 'button';
    showAllBtn.className = 'pill';
    showAllBtn.textContent = 'Mostrar todo';
    showAllBtn.addEventListener('click', () => {
      state.visibleYears = new Set(years);
      saveComparisonPrefs(state.geoId);
      renderComparisonControls(years, selectedYear);
      applyComparisonVisibility();
      updateURL();
    });

    const isolateBtn = document.createElement('button');
    isolateBtn.type = 'button';
    isolateBtn.className = 'pill';
    isolateBtn.textContent = 'Solo seleccionado';
    isolateBtn.addEventListener('click', () => {
      state.visibleYears = new Set([selectedYear]);
      saveComparisonPrefs(state.geoId);
      renderComparisonControls(years, selectedYear);
      applyComparisonVisibility();
      updateURL();
    });

    const modeGroup = document.createElement('div');
    modeGroup.className = 'segmented';
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'Vista de la comparativa');

    const modes = [
      { key: 'monthly', label: 'Mensual' },
      { key: 'smooth', label: 'Suavizado' },
      { key: 'daily', label: 'Diario' }
    ];

    modes.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = state.comparisonMode === mode.key;
      btn.className = `pill ${isActive ? 'pill--active' : ''}`;
      btn.textContent = mode.label;
      btn.setAttribute('aria-pressed', isActive);
      btn.addEventListener('click', () => {
        if (state.comparisonMode === mode.key) return;
        state.comparisonMode = mode.key;
        saveComparisonPrefs(state.geoId);
        if (state.comparisonSeriesByYear) {
          renderComparisonChart(state.comparisonSeriesByYear, state.year, { window: 7 });
          return;
        }
        renderComparisonControls(years, selectedYear);
        updateComparisonSeries(charts.comparison);
        applyComparisonVisibility();
        updateURL();
      });
      modeGroup.appendChild(btn);
    });

    header.append(showAllBtn, isolateBtn);
    elements.comparisonControls.appendChild(header);
    elements.comparisonControls.appendChild(modeGroup);

    const yearList = document.createElement('div');
    yearList.className = 'segmented segmented--years';

    years.forEach((year) => {
      const isActive = state.visibleYears.has(year);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pill ${isActive ? 'pill--active' : ''}`;
      btn.setAttribute('aria-pressed', isActive);
      btn.dataset.year = year;
      btn.textContent = year;

      btn.addEventListener('click', (event) => {
        if (event.altKey) {
          state.visibleYears = new Set([year]);
        } else if (isActive) {
          if (state.visibleYears.size > 1) {
            state.visibleYears.delete(year);
          }
        } else {
          state.visibleYears.add(year);
        }
        saveComparisonPrefs(state.geoId);
        renderComparisonControls(years, selectedYear);
        applyComparisonVisibility();
        updateURL();
      });

      yearList.appendChild(btn);
    });

    elements.comparisonControls.appendChild(yearList);
  };

  const renderComparisonChart = (seriesByYear, selectedYear, options = {}) => {
    const canvas = document.getElementById('comparisonChart');
    const ctx = canvas.getContext('2d');
    if (charts.comparison) charts.comparison.destroy();

    const colors = {
      '2022': '#ef4444',
      '2023': '#f59e0b',
      '2024': '#10b981',
      '2025': '#3b82f6',
      '2026': '#8b5cf6',
      '2021': '#64748b'
    };

    const computed = getComputedStyle(document.documentElement);
    const textColor = computed.getPropertyValue('--text-main').trim() || '#0f172a';
    const mutedColor = computed.getPropertyValue('--text-muted').trim() || '#64748b';
    const borderColor = computed.getPropertyValue('--border-color').trim() || '#e2e8f0';
    const bgCard = computed.getPropertyValue('--bg-card').trim() || '#ffffff';

    const years = Object.keys(seriesByYear);
    const selectedYearNumber = Number(selectedYear) || new Date().getFullYear();
    const referenceYear = 2024;
    const dayTable = buildDayOfYearTable(referenceYear);

    const prefs = loadComparisonPrefs(state.geoId);

    // Preferencias ya cargadas arriba
    let effectiveMode = state.comparisonMode || 'smooth';
    if (state.comparisonPrefsFromUrl?.mode && ['smooth', 'daily', 'monthly'].includes(state.comparisonPrefsFromUrl.mode)) {
      effectiveMode = state.comparisonPrefsFromUrl.mode;
    } else if (prefs?.mode && ['smooth', 'daily', 'monthly'].includes(prefs.mode)) {
      effectiveMode = prefs.mode;
    } else if (prefs?.showDaily !== undefined) {
      // retro-compatibilidad con preferencias antiguas
      effectiveMode = prefs.showDaily ? 'daily' : 'smooth';
    }
    state.comparisonMode = effectiveMode;

    const xMax = effectiveMode === 'monthly' ? 12 : 366;
    const xTicks = effectiveMode === 'monthly' ? buildMonthIndexTicks() : buildMonthlyTicks(referenceYear);
    const tickLabelMap = new Map(xTicks.map((tick) => [tick.value, tick.label]));

    const datasets = years.map((year) => {
      const series = seriesByYear[year];
      const baseColor = colors[year] || '#94a3b8';
      const points = (series?.values || []).map((value, index) => ({
        x: index + 1,
        y: Number.isFinite(value) ? value : null
      }));
      const smoothPoints = smoothMovingAverage(points, options.window || 7);
      const monthlyPoints = buildMonthlyPointsFromDaily(series?.values || [], dayTable);
      const isSelected = year === selectedYear;
      const gradient = ctx.createLinearGradient(0, 0, 0, 400);
      gradient.addColorStop(0, hexToRgba(baseColor, 0.25));
      gradient.addColorStop(1, hexToRgba(baseColor, 0));

      return {
        label: year,
        data: effectiveMode === 'daily' ? points : (effectiveMode === 'monthly' ? monthlyPoints : smoothPoints),
        dailyPoints: points,
        smoothPoints,
        monthlyPoints,
        baseColor,
        fillColor: gradient,
        borderColor: isSelected ? baseColor : hexToRgba(baseColor, 0.35),
        borderWidth: isSelected ? 3 : 1.5,
        backgroundColor: isSelected ? gradient : 'transparent',
        fill: isSelected && effectiveMode !== 'monthly',
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.35,
        spanGaps: false,
        order: isSelected ? 0 : 1
      };
    });

    const tooltipCache = { dataIndex: null, topSet: null, total: 0 };

    charts.comparison = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: bgCard,
            titleColor: textColor,
            bodyColor: mutedColor,
            borderColor,
            borderWidth: 1,
            padding: 14,
            cornerRadius: 12,
            boxPadding: 6,
            usePointStyle: true,
            itemSort: (a, b) => (b.raw?.y ?? -Infinity) - (a.raw?.y ?? -Infinity),
            filter: (item) => {
              const index = item.dataIndex;
              if (tooltipCache.dataIndex !== index) {
                const items = item.chart.data.datasets
                  .map((dataset, datasetIndex) => {
                    const value = dataset.data[index]?.y;
                    return { datasetIndex, value };
                  })
                  .filter(entry => Number.isFinite(entry.value))
                  .sort((a, b) => b.value - a.value);
                tooltipCache.dataIndex = index;
                tooltipCache.total = items.length;
                tooltipCache.topSet = new Set(items.slice(0, 5).map(entry => entry.datasetIndex));
              }
              return tooltipCache.topSet?.has(item.datasetIndex);
            },
            callbacks: {
              title: (context) => {
                const x = context[0]?.parsed?.x;
                if (!Number.isFinite(x)) return '';
                if (effectiveMode === 'monthly') {
                  return tickLabelMap.get(x) || `Mes ${x}`;
                }
                const entry = dayTable[x];
                if (!entry) return `Día ${x}`;
                return `${entry.day} ${entry.month}`;
              },
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                return `${label}: ${formatEuroKwh(value)}`;
              },
              labelColor: (context) => ({
                borderColor: 'transparent',
                backgroundColor: context.dataset.baseColor,
                borderRadius: 4
              }),
              afterBody: (context) => {
                const visibleCount = context.length;
                const total = tooltipCache.total || visibleCount;
                const hidden = total - visibleCount;
                return hidden > 0 ? `+${hidden} más` : '';
              }
            }
          }
        },
        elements: {
          line: { borderCapStyle: 'round' }
        },
        scales: {
          x: {
            type: 'linear',
            min: 1,
            max: xMax,
            border: { display: false },
            grid: { display: false },
            afterBuildTicks: (scale) => {
              scale.ticks = xTicks.map(tick => ({ value: tick.value }));
            },
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              color: mutedColor,
              padding: 10,
              font: { family: "'Outfit', sans-serif", size: 11, weight: 600 },
              callback: (value) => tickLabelMap.get(Number(value)) || ''
            }
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: {
              color: hexToRgba(borderColor, 0.5),
              drawBorder: false
            },
            ticks: {
              padding: 12,
              color: mutedColor,
              font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
              callback: (value) => {
                if (!Number.isFinite(value)) return '';
                return formatEuroKwh(value).replace(' €/kWh', ' €');
              }
            }
          }
        }
      }
    });

    if (state.comparisonPrefsFromUrl?.showDaily !== undefined) {
      state.comparisonShowDaily = state.comparisonPrefsFromUrl.showDaily;
    } else if (prefs?.showDaily !== undefined) {
      state.comparisonShowDaily = prefs.showDaily;
    }

    updateComparisonSeries(charts.comparison);

    if (state.comparisonPrefsFromUrl?.visibleYears?.length) {
      state.visibleYears = new Set(state.comparisonPrefsFromUrl.visibleYears.filter(year => years.includes(year)));
    } else if (prefs?.visibleYears?.length) {
      state.visibleYears = new Set(prefs.visibleYears.filter((year) => years.includes(year)));
    } else {
      state.visibleYears = new Set(years);
    }
    state.visibleYears.add(selectedYear);
    state.comparisonPrefsFromUrl = {};
    renderComparisonControls(years, selectedYear);
    applyComparisonVisibility();
    updateURL();
  };

  const loadComparisonAsync = ({ geoId, years, token }) => {
    const requestToken = token;
    setLoading(sections.comparison, true);

    const schedule = (callback) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 800 });
      } else {
        setTimeout(callback, 50);
      }
    };

    schedule(async () => {
      if (requestToken !== state.comparisonToken) return;

      try {
        const tasks = years.map(yearOption => async () => {
          if (requestToken !== state.comparisonToken) return null;
          const data = await window.PVPC_STATS.loadYearData(geoId, yearOption);
          if (requestToken !== state.comparisonToken) return null;
          if (!data || !Object.keys(data.days).length) return null;
          return { year: yearOption, series: toDailySeries(data) };
        });

        const results = await window.PVPC_STATS.runWithConcurrency(tasks, 2);
        if (requestToken !== state.comparisonToken) return;

        const seriesByYear = {};
        results.forEach(result => {
          if (result?.series) {
            seriesByYear[result.year] = result.series;
          }
        });

        const comparisonSeries = worker
          ? await runWorker('compareSeries', { seriesByYear })
          : buildComparisonFromSeries(seriesByYear);

        if (requestToken !== state.comparisonToken) return;

        const comparisonData = comparisonSeries?.seriesByYear || seriesByYear;
        if (Object.keys(comparisonData).length) {
          state.comparisonSeriesByYear = comparisonData;
          renderComparisonChart(comparisonData, state.year, { window: 7 });
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (requestToken === state.comparisonToken) {
          setLoading(sections.comparison, false);
        }
      }
    });
  };

  const loadData = async () => {
    state.comparisonToken += 1;
    const comparisonToken = state.comparisonToken;
    setLoading(sections.kpis, true);
    setLoading(sections.savings, true);
    setLoading(sections.heatmap, true);
    setLoading(sections.clock, true);
    setLoading(sections.weekday, true);
    setLoading(sections.trend, true);
    setLoading(sections.comparison, true);

    const geoId = state.geoId;
    const year = state.year;

    try {
      const yearData = await window.PVPC_STATS.loadYearData(geoId, year);
      if (!yearData || !Object.keys(yearData.days).length) {
        elements.insightText.textContent = 'No hay datos disponibles para este año.';
        setHeroLoading(false);
        setLoading(sections.kpis, false);
        setLoading(sections.savings, false);
        setLoading(sections.heatmap, false);
        setLoading(sections.clock, false);
        setLoading(sections.weekday, false);
        setLoading(sections.trend, false);
        setLoading(sections.comparison, false);
        return;
      }

      state.yearData = yearData;
      state.yearDataKey = `${geoId}-${year}`;

      const options = {
        exampleDay: null
      };

      const analysis = worker
        ? await runWorker('analyzeYear', { yearData, options })
        : window.PVPC_STATS.analyzeYear(yearData, options);

      state.lastAnalysis = analysis;
      await renderHeroSummary(analysis);
      renderTrendChart();
      setLoading(sections.trend, false);
      renderKPIs(analysis);
      buildHeatmap(analysis.heatmap);
      renderClockChart(analysis.hourlyProfile);
      renderWeekdayChart(analysis.weekdayProfile);
      updateMeta(analysis.kpis);
      renderStatusBadges(analysis.status);
      renderDataWarning(analysis.status);
      renderInsight(analysis.kpis, geoId, analysis.status);
      await loadSavingsWindows();

      setLoading(sections.kpis, false);
      setLoading(sections.savings, false);
      setLoading(sections.heatmap, false);
      setLoading(sections.clock, false);
      setLoading(sections.weekday, false);

      const comparisonYears = Array.from(elements.yearSelector.options).map(option => option.value);
      state.comparisonYears = comparisonYears;
      loadComparisonAsync({ geoId, years: comparisonYears, token: comparisonToken });
    } catch (error) {
      elements.insightText.textContent = 'No se pudieron cargar los datos. Inténtalo de nuevo.';
      setHeroLoading(false);
      console.error(error);
      setLoading(sections.trend, false);
      setLoading(sections.comparison, false);
    } finally {
      setLoading(sections.kpis, false);
      setLoading(sections.savings, false);
      setLoading(sections.heatmap, false);
      setLoading(sections.clock, false);
      setLoading(sections.weekday, false);
      setLoading(sections.trend, false);
    }
  };

  let lastFocused = null;
  let modalKeydownHandler = null;

  const getModalFocusables = () => {
    const container = elements.modal.querySelector('.modal__content');
    if (!container) return [];
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled'));
  };

  function openModal() {
    lastFocused = document.activeElement;
    elements.modal.hidden = false;
    elements.closeModalBtn?.focus();

    modalKeydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === 'Tab') {
        const focusableItems = getModalFocusables();
        if (!focusableItems.length) {
          event.preventDefault();
          return;
        }
        const first = focusableItems[0];
        const last = focusableItems[focusableItems.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', modalKeydownHandler);
  }

  function closeModal() {
    elements.modal.hidden = true;
    if (modalKeydownHandler) {
      document.removeEventListener('keydown', modalKeydownHandler);
      modalKeydownHandler = null;
    }
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  function renderDayModal(dateStr, detail) {
    elements.modalTitle.textContent = `Detalle del ${formatDate(dateStr)}`;
    elements.modalSubtitle.textContent = `Precio horario y ranking de horas para ${formatDate(dateStr)}.`;

    elements.dayCheapest.innerHTML = detail.cheapest.map(item => `<li>${item.label} · ${formatValue(item.price)} €/kWh</li>`).join('');
    elements.dayExpensive.innerHTML = detail.expensive.map(item => `<li>${item.label} · ${formatValue(item.price)} €/kWh</li>`).join('');

  const ctx = document.getElementById('dayChart').getContext('2d');
  if (charts.day) charts.day.destroy();

  const computed = getComputedStyle(document.documentElement);
  const primary = computed.getPropertyValue('--primary-color').trim() || '#3b82f6';
  const textColor = computed.getPropertyValue('--text-main').trim() || '#0f172a';
  const mutedColor = computed.getPropertyValue('--text-muted').trim() || '#64748b';
  const borderColor = computed.getPropertyValue('--border-color').trim() || '#e2e8f0';
  const bgCard = computed.getPropertyValue('--bg-card').trim() || '#ffffff';

  charts.day = new Chart(ctx, {
    type: 'line',
    data: {
      labels: detail.labels,
      datasets: [{
        label: 'Precio (€/kWh)',
        data: detail.data,
        borderColor: primary,
        backgroundColor: hexToRgba(primary, 0.14),
        tension: 0.25,
        pointRadius: 2,
        pointHoverRadius: 4,
        fill: true,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: bgCard,
          titleColor: textColor,
          bodyColor: mutedColor,
          borderColor,
          borderWidth: 1,
          padding: 14,
          cornerRadius: 12,
          displayColors: false,
          callbacks: {
            label: (context) => `Precio: ${formatEuroKwh(context.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: mutedColor, font: { family: "'Outfit', sans-serif", size: 10, weight: 600 } },
          border: { display: false }
        },
        y: {
          beginAtZero: false,
          grid: { color: hexToRgba(borderColor, 0.5) },
          ticks: {
            color: mutedColor,
            font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
            callback: (value) => {
              if (!Number.isFinite(value)) return '';
              return formatEuroKwh(value).replace(' €/kWh', ' €');
            }
          },
          border: { display: false }
        }
      }
    }
  });

  openModal();
}

  const getDayDetailLocal = (yearData, dateStr) => {
    const hours = yearData.days[dateStr] || [];
    const entries = hours.map(([ts, price]) => ({
      ts,
      price,
      date: new Date(ts * 1000)
    }));
    const labels = entries.map(entry => entry.date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }));
    const data = entries.map(entry => entry.price);
    const sorted = [...entries].sort((a, b) => a.price - b.price);
    const cheapest = sorted.slice(0, 3).map(entry => ({
      label: entry.date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }),
      price: entry.price
    }));
    const expensive = sorted.slice(-3).reverse().map(entry => ({
      label: entry.date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }),
      price: entry.price
    }));
    return { labels, data, cheapest, expensive };
  };

  const onDayClick = async (dateStr) => {
    let yearData = state.yearData;
    if (!yearData || state.yearDataKey !== `${state.geoId}-${state.year}`) {
      yearData = await window.PVPC_STATS.loadYearData(state.geoId, state.year);
      state.yearData = yearData;
      state.yearDataKey = `${state.geoId}-${state.year}`;
    }
    const detail = worker
      ? await runWorker('dayDetail', { yearData, dateStr })
      : getDayDetailLocal(yearData, dateStr);

    if (elements.useDayBtn) elements.useDayBtn.style.display = 'none';

    renderDayModal(dateStr, detail);
  };

  elements.geoSelector.addEventListener('change', () => {
    state.geoId = elements.geoSelector.value;
    updateURL();
    loadData();
  });

  elements.yearSelector.addEventListener('change', () => {
    state.year = elements.yearSelector.value;
    updateURL();
    loadData();
  });

  if (elements.savingsPreset) {
    elements.savingsPreset.addEventListener('change', () => {
      state.savingsOverrides = { duration: false, kwh: false };
      applyPreset(elements.savingsPreset.value);
      updateURL();
      loadSavingsWindows();
    });
  }

  if (elements.savingsDuration) {
    elements.savingsDuration.addEventListener('change', () => {
      state.savingsOverrides.duration = true;
      state.savings.duration = normalizeDuration(elements.savingsDuration.value, state.savings.duration);
      if (state.savings.preset !== 'personalizado') {
        state.savings.preset = 'personalizado';
        if (elements.savingsPreset) elements.savingsPreset.value = 'personalizado';
      }
      updateURL();
      loadSavingsWindows();
    });
  }

  if (elements.savingsDayType) {
    elements.savingsDayType.addEventListener('change', () => {
      state.savings.dayType = elements.savingsDayType.value;
      updateURL();
      loadSavingsWindows();
    });
  }

  if (elements.savingsKwh) {
    elements.savingsKwh.addEventListener('change', () => {
      state.savingsOverrides.kwh = true;
      state.savings.kwh = clampNumber(elements.savingsKwh.value, { min: 0.1, max: 100, fallback: state.savings.kwh });
      if (state.savings.preset !== 'personalizado') {
        state.savings.preset = 'personalizado';
        if (elements.savingsPreset) elements.savingsPreset.value = 'personalizado';
      }
      updateURL();
      loadSavingsWindows();
    });
  }

  if (elements.savingsUses) {
    elements.savingsUses.addEventListener('change', () => {
      state.savings.usesPerMonth = clampNumber(elements.savingsUses.value, { min: 1, max: 60, fallback: state.savings.usesPerMonth });
      updateURL();
      loadSavingsWindows();
    });
  }

  // --- Trend controls (Evolución anual) ---
  if (elements.trendDailyBtn) {
    elements.trendDailyBtn.addEventListener('click', () => {
      if (state.trendMode === 'daily') return;
      state.trendMode = 'daily';
      renderTrendChart();
    });
  }

  if (elements.trendMonthlyBtn) {
    elements.trendMonthlyBtn.addEventListener('click', () => {
      if (state.trendMode === 'monthly') return;
      state.trendMode = 'monthly';
      renderTrendChart();
    });
  }
  // --- Global Tooltip Logic ---
  const tooltip = document.createElement('div');
  tooltip.id = 'globalTooltip';
  tooltip.style.pointerEvents = 'none'; // Asegurar que no bloquea ratón
  document.body.appendChild(tooltip);

  if (elements.heatmapGrid) {
    elements.heatmapGrid.addEventListener('mouseover', (e) => {
      const target = e.target.closest('.heatmap-day');
      if (target) {
        tooltip.textContent = target.getAttribute('data-tip');
        
        // Posicionar inicial
        const rect = target.getBoundingClientRect();
        // Centrar sobre la celda
        const x = rect.left + rect.width / 2;
        const y = rect.top;
        
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
        tooltip.style.transform = `translate(-50%, -130%)`; // Mover arriba y centrar
        
        tooltip.style.display = 'block';
      }
    });

    elements.heatmapGrid.addEventListener('mouseout', (e) => {
       const target = e.target.closest('.heatmap-day');
       if (target) {
         tooltip.style.display = 'none';
       }
    });

    elements.heatmapGrid.addEventListener('click', (event) => {
      const target = event.target.closest('.heatmap-day');
      if (!target) return;
      onDayClick(target.dataset.date);
    });

    elements.heatmapGrid.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest('.heatmap-day');
      if (!target) return;
      event.preventDefault();
      onDayClick(target.dataset.date);
    });
  }

  if (elements.closeModalBtn) elements.closeModalBtn.addEventListener('click', closeModal);
  if (elements.modal) {
    elements.modal.addEventListener('click', (event) => {
      if (event.target.dataset.close) {
        closeModal();
      }
    });
  }

  readURL();
  applyPreset(state.savings.preset, { sync: false });
  syncSavingsInputs();
  updateURL();
  loadData();
})();
