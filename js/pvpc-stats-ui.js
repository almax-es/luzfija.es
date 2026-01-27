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
    geo: document.getElementById('geoSelector'),
    year: document.getElementById('yearSelector'),

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

    hourlyMeta: document.getElementById('hourlyMeta'),
    hourlyCallout: document.getElementById('hourlyCallout'),

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

  function safeMean(values) {
    const nums = values.filter(v => Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((a,b) => a + b, 0) / nums.length;
  }

  function parseParams() {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    const now = new Date();
    const defaults = {
      geo: '8741',
      year: String(now.getFullYear()),
      trendMode: 'daily',
      compareYears: ''
    };

    const geo = p.get('geo') || defaults.geo;
    const year = p.get('year') || defaults.year;

    return {
      geo,
      year,
      trendMode: p.get('trendMode') || defaults.trendMode,
      compareYears: p.get('compareYears') || defaults.compareYears
    };
  }

  function writeParams(state, { replace = true } = {}) {
    const url = new URL(window.location.href);
    const p = url.searchParams;

    p.set('geo', state.geo);
    p.set('year', state.year);
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

  function renderTrendChart(daily, monthly, mode, accent, gridColor, textColor) {
    const ds = buildTrendDataset(daily, monthly, mode);
    const ctx = canvases.trend.getContext('2d');
    const gradient = createGradient(ctx, accent);

    const config = {
      type: 'line',
      data: {
        labels: ds.labels,
        datasets: [{
          label: 'PVPC (media)',
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

  function renderHourlyChart(hourlyAvg, accent, gridColor, textColor) {
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const ctx = canvases.hourly.getContext('2d');
    const gradient = createGradient(ctx, accent);

    const config = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'PVPC por hora',
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

  async function computeYoY(geo, year, currentEndDateStr, currentYtdAvg) {
    const prevYear = String(Number(year) - 1);
    if (Number(prevYear) < 2021) return null;
    if (!currentEndDateStr) return null;

    const [_, mm, dd] = currentEndDateStr.split('-');
    const prevEnd = `${prevYear}-${mm}-${dd}`;

    const prevData = await PVPC_STATS.loadYearData(Number(geo), Number(prevYear));
    const prevDaily = PVPC_STATS.getDailyEvolution(prevData);
    const prevValues = prevDaily.labels
      .map((d, i) => (d <= prevEnd ? prevDaily.data[i] : null))
      .filter(v => Number.isFinite(v));

    const prevAvg = safeMean(prevValues);
    if (!Number.isFinite(prevAvg) || !Number.isFinite(currentYtdAvg) || prevAvg === 0) return null;

    return { prevAvg, pct: ((currentYtdAvg - prevAvg) / prevAvg) * 100, prevEnd };
  }

  function setInsights(monthly) {
    const pairs = monthly.values.map((v, i) => ({ m: i, v })).filter(x => Number.isFinite(x.v));
    if (!pairs.length) return;

    let min = pairs[0];
    let max = pairs[0];
    for (const p of pairs) {
      if (p.v < min.v) min = p;
      if (p.v > max.v) max = p;
    }

    els.insightCheapest.textContent = `${fmtMonth(min.m)} · ${fmtCents(min.v)}`;
    els.insightWorst.textContent = `${fmtMonth(max.m)} · ${fmtCents(max.v)}`;
  }

  function setRange(kpis) {
    if (!kpis) return;
    els.insightRange.textContent = `${fmtCents(kpis.minPrice)} – ${fmtCents(kpis.maxPrice)}`;
  }

  function setRange(kpis) {
    if (!kpis) return;
    els.insightRange.textContent = `${fmtCents(kpis.minPrice)} – ${fmtCents(kpis.maxPrice)}`;
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

  async function renderComparison(geo, selectedYears, accent, gridColor, textColor) {
    const datasets = [];
    // cargar en paralelo
    const promises = selectedYears.map(y => PVPC_STATS.loadYearData(Number(geo), Number(y)).then(d => ({ y, d })).catch(() => null));
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
    if (els.geo) els.geo.value = state.geo;
    if (els.year) els.year.value = state.year;
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

    els.geo.addEventListener('change', () => { state.geo = els.geo.value; onChange(); });
    els.year.addEventListener('change', () => { state.year = els.year.value; onChange(); });

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

    const params = parseParams();
    const currentSystemYear = String(new Date().getFullYear());
    
    const state = {
      geo: params.geo,
      year: params.year || currentSystemYear,
      trendMode: params.trendMode === 'daily' ? 'daily' : 'monthly',
      compareYears: normalizeSelectedYears(params.year || currentSystemYear, params.compareYears)
    };

    console.log(`[PVPC-OBS] Año detectado por sistema: ${currentSystemYear}`);
    applyStateToControls(state);

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
        yearData = await PVPC_STATS.loadYearData(Number(state.geo), Number(state.year));
      } catch (e) {
        showError('Error cargando dataset local.');
        return;
      }

      // Cargar año anterior para media móvil 12 meses
      let prevYearData = null;
      try {
        prevYearData = await PVPC_STATS.loadYearData(Number(state.geo), Number(state.year) - 1);
      } catch (_) {}

      const status = PVPC_STATS.getYearStatus(yearData);

      const daily = PVPC_STATS.getDailyEvolution(yearData);
      const monthly = buildMonthlyFromDaily(daily.labels, daily.data);
      const kpis = PVPC_STATS.getKPIs(yearData);

      // KPIs principales
      const lastIdx = daily.labels.length - 1;
      const lastDate = lastIdx >= 0 ? daily.labels[lastIdx] : null;
      const lastVal = lastIdx >= 0 ? daily.data[lastIdx] : null;

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

        if (els.lblKpi2) els.lblKpi2.textContent = 'Mejor día del año';
        els.kpiAvg7.textContent = fmtCents(minDay);
        els.kpiAvg7Sub.textContent = minDate || '—';

        if (els.lblKpi3) els.lblKpi3.textContent = 'Peor día del año';
        els.kpiAvg30.textContent = fmtCents(maxDay);
        els.kpiAvg30Sub.textContent = maxDate || '—';
      }

      // Kpi 4: 12 meses / Anual
      const rolling12m = computeRolling12m(yearData, prevYearData);
      els.kpiAvg12m.textContent = fmtCents(rolling12m);
      els.kpiAvg12mSub.textContent = lastDate ? (isCurrentYear ? 'Últimos 12 meses' : 'Media anual') : '—';

      // YoY (a mismas fechas)
      try {
        const yoy = await computeYoY(state.geo, state.year, lastDate, ytdAvg);
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
      renderTrendChart(daily, monthly, mode, accent, gridColor, textColor);

      const monthsLoaded = status.monthsLoaded && status.monthsLoaded.length ? status.monthsLoaded.join(', ') : '—';
      els.trendMeta.textContent = `${geoNames[String(state.geo)] || 'Zona'} · ${state.year} · meses cargados: ${monthsLoaded}`;
      setInsights(monthly);
      setRange(kpis);

      // Horario
      const hourlyAll = PVPC_STATS.getHourlyProfile(yearData);
      renderHourlyChart(hourlyAll.data, accent, gridColor, textColor);
      els.hourlyMeta.textContent = `Perfil promedio del año (${status.loadedDays} días)`;

      // Consejito basado en mejor bloque 3h
      const window3 = computeWindowOptions(hourlyAll.data, 3)[0];
      if (window3) {
        els.hourlyCallout.innerHTML = `<strong>Consejo:</strong> de media, el bloque de 3 horas más barato suele ser <strong>${hourRangeLabel(window3.start, window3.end)}</strong> (${fmtCents(window3.avg)}).`;
      } else {
        els.hourlyCallout.textContent = 'Consejo: sin datos suficientes.';
      }

      // Comparativa años (mensual)
      const now = new Date();
      const currentYear = now.getFullYear();
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

        await renderComparison(state.geo, state.compareYears, accent, gridColor, textColor);
      };

      buildCompareYearChips(allYears, state.compareYears, toggleYear);
      await renderComparison(state.geo, state.compareYears, accent, gridColor, textColor);
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
