(() => {
  const geoNames = {
    '8741': 'Península',
    '8742': 'Canarias',
    '8743': 'Baleares',
    '8744': 'Ceuta',
    '8745': 'Melilla'
  };

  const presets = {
    custom: { label: 'Personalizado', hours: 2 },
    lavadora: { label: 'Lavadora (1h)', hours: 1 },
    lavavajillas: { label: 'Lavavajillas (2h)', hours: 2 },
    termo: { label: 'Termo eléctrico (3h)', hours: 3 },
    coche: { label: 'Coche eléctrico (4h)', hours: 4 }
  };

  const sections = {
    savings: document.querySelector('[data-loading][aria-labelledby="savingsTitle"]'),
    kpis: document.querySelector('[data-loading][aria-labelledby="kpiTitle"]'),
    heatmap: document.querySelector('[data-loading][aria-labelledby="heatmapTitle"]'),
    clock: document.querySelector('[data-loading][aria-labelledby="clockTitle"]'),
    weekday: document.querySelector('[data-loading][aria-labelledby="weekdayTitle"]'),
    daily: document.querySelector('[data-loading][aria-labelledby="dailyTitle"]'),
    comparison: document.querySelector('[data-loading][aria-labelledby="comparisonTitle"]')
  };

  const elements = {
    geoSelector: document.getElementById('geoSelector'),
    yearSelector: document.getElementById('yearSelector'),
    usagePreset: document.getElementById('usagePreset'),
    usageHours: document.getElementById('usageHours'),
    dayType: document.getElementById('dayType'),
    insightText: document.getElementById('insightText'),
    updatedBadge: document.getElementById('updatedBadge'),
    completenessBadge: document.getElementById('completenessBadge'),
    dataWarning: document.getElementById('dataWarning'),
    kpiAvg: document.getElementById('kpiAvg'),
    kpiMin: document.getElementById('kpiMin'),
    kpiMinDate: document.getElementById('kpiMinDate'),
    kpiMax: document.getElementById('kpiMax'),
    kpiMaxDate: document.getElementById('kpiMaxDate'),
    kpiSolar: document.getElementById('kpiSolar'),
    kpiVolatility: document.getElementById('kpiVolatility'),
    kpiP90: document.getElementById('kpiP90'),
    heatmapGrid: document.getElementById('heatmapGrid'),
    cheapestWindows: document.getElementById('cheapestWindows'),
    bestWindow: document.getElementById('bestWindow'),
    worstWindow: document.getElementById('worstWindow'),
    savingsHighlight: document.getElementById('savingsHighlight'),
    comparisonControls: document.getElementById('comparisonControls'),
    exampleBadge: document.getElementById('exampleBadge'),
    exampleDate: document.getElementById('exampleDate'),
    clearExampleBtn: document.getElementById('clearExampleBtn'),
    shareBtn: document.getElementById('shareBtn'),
    resetBtn: document.getElementById('resetBtn'),
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
    clock: null,
    weekday: null,
    daily: null,
    comparison: null,
    day: null
  };

  const worker = 'Worker' in window ? new Worker('/js/pvpc-stats-worker.js') : null;
  let workerId = 0;
  const workerRequests = new Map();

  const state = {
    geoId: elements.geoSelector.value,
    year: elements.yearSelector.value,
    usagePreset: 'custom',
    usageHours: Number(elements.usageHours.value),
    dayType: elements.dayType.value,
    exampleDay: null,
    comparisonYears: [],
    visibleYears: new Set()
  };

  const setLoading = (section, isLoading) => {
    if (!section) return;
    section.dataset.loading = isLoading ? 'true' : 'false';
  };

  const showToast = (message) => {
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

  const formatValue = (value) => value.toFixed(4);

  const readURL = () => {
    const params = new URLSearchParams(window.location.search);
    const year = params.get('year');
    const geo = params.get('geo');
    const duration = params.get('duration');
    const dayType = params.get('day');
    const preset = params.get('preset');

    if (year && document.querySelector(`#yearSelector option[value="${year}"]`)) {
      elements.yearSelector.value = year;
      state.year = year;
    }

    if (geo && document.querySelector(`#geoSelector option[value="${geo}"]`)) {
      elements.geoSelector.value = geo;
      state.geoId = geo;
    }

    if (duration && elements.usageHours.querySelector(`option[value="${duration}"]`)) {
      elements.usageHours.value = duration;
      state.usageHours = Number(duration);
    }

    if (dayType && elements.dayType.querySelector(`option[value="${dayType}"]`)) {
      elements.dayType.value = dayType;
      state.dayType = dayType;
    }

    if (preset && presets[preset]) {
      elements.usagePreset.value = preset;
      state.usagePreset = preset;
    }
  };

  const updateURL = () => {
    const params = new URLSearchParams();
    params.set('geo', state.geoId);
    params.set('year', state.year);
    params.set('duration', String(state.usageHours));
    params.set('day', state.dayType);
    params.set('preset', state.usagePreset);
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

  const renderKPIs = ({ kpis, hourlyProfile, p10, p90 }) => {
    elements.kpiAvg.textContent = formatValue(kpis.avgPrice);
    elements.kpiMin.textContent = formatValue(kpis.minPrice);
    elements.kpiMinDate.textContent = formatDate(kpis.minHour?.date);
    elements.kpiMax.textContent = formatValue(kpis.maxPrice);
    elements.kpiMaxDate.textContent = formatDate(kpis.maxHour?.date);

    const hourly = hourlyProfile.data;
    const solarAvg = (hourly[12] + hourly[13] + hourly[14] + hourly[15] + hourly[16] + hourly[17]) / 6;
    elements.kpiSolar.textContent = formatValue(solarAvg || 0);

    elements.kpiVolatility.textContent = formatValue(p90 - p10);
    elements.kpiP90.textContent = formatValue(p90);
  };

  const renderInsight = async (kpis, geoId) => {
    const currentYear = Number(state.year);
    const prevYear = currentYear - 1;

    if (prevYear >= 2022) {
      const prevData = await window.PVPC_STATS.loadYearData(geoId, prevYear);
      const prevAvg = window.PVPC_STATS.getKPIs(prevData).avgPrice;
      const diff = prevAvg ? ((kpis.avgPrice - prevAvg) / prevAvg) * 100 : 0;
      const trend = diff > 0 ? 'más caro' : 'más barato';
      elements.insightText.textContent = `En ${currentYear}, el PVPC está siendo un ${Math.abs(diff).toFixed(1)}% ${trend} que en ${prevYear}.`;
    } else {
      elements.insightText.textContent = `Analizando el mercado de ${currentYear}. Usa el reloj del ahorro para planificar tu consumo.`;
    }
  };

  const renderWindowList = (windowStats, kpis) => {
    elements.cheapestWindows.innerHTML = '';

    if (!windowStats.cheapest.length) {
      elements.cheapestWindows.innerHTML = '<li class="window-item">No hay datos suficientes para este filtro.</li>';
      return;
    }

    const expensive = windowStats.expensive?.avg || kpis.avgPrice;

    windowStats.cheapest.forEach((window) => {
      const savingsVsExpensive = expensive - window.avg;
      const savingsVsAvg = kpis.avgPrice - window.avg;

      const li = document.createElement('li');
      li.className = 'window-item';
      li.innerHTML = `
        <div class="window-item__title">
          <span>${window.label}</span>
          <strong>${formatValue(window.avg)} €/kWh</strong>
        </div>
        <div class="window-item__meta">
          <span>Ahorro vs pico: ${formatValue(savingsVsExpensive)} €/kWh</span>
          <span>Riesgo P10/P50/P90: ${formatValue(window.p10)} · ${formatValue(window.p50)} · ${formatValue(window.p90)}</span>
        </div>
        <div class="window-item__meta">
          <span>Ahorro vs media anual: ${formatValue(savingsVsAvg)} €/kWh</span>
        </div>
      `;
      elements.cheapestWindows.appendChild(li);
    });
  };

  const renderSummary = (summaryStats, kpis) => {
    if (!summaryStats.cheapest.length) {
      elements.bestWindow.textContent = '--';
      elements.worstWindow.textContent = '--';
      elements.savingsHighlight.textContent = '--';
      return;
    }

    const best = summaryStats.cheapest[0];
    const worst = summaryStats.expensive;

    elements.bestWindow.textContent = `${best.label} (${formatValue(best.avg)} €/kWh)`;
    elements.worstWindow.textContent = `${worst.label} (${formatValue(worst.avg)} €/kWh)`;
    elements.savingsHighlight.textContent = `Hasta ${formatValue(worst.avg - best.avg)} €/kWh frente a la franja más cara.`;
  };

  const renderStatus = (status) => {
    elements.updatedBadge.textContent = `Actualizado hasta: ${formatDate(status.updatedUntil)}`;
    elements.completenessBadge.textContent = `Completitud: ${(status.completeness * 100).toFixed(1)}%`;

    if (status.completeness < 0.98) {
      elements.dataWarning.textContent = `Datos incompletos: ${status.loadedDays} de ${status.totalDays} días cargados.`;
    } else {
      elements.dataWarning.textContent = '';
    }
  };

  const buildHeatmap = (heatmapData) => {
    elements.heatmapGrid.innerHTML = '';
    const year = Number(state.year);
    const firstDay = new Date(year, 0, 1);
    const firstWeekday = (firstDay.getDay() + 6) % 7;

    heatmapData.forEach((day) => {
      const date = new Date(`${day.date}T12:00:00`);
      const dayOfYear = getDayOfYearUTC(date.getFullYear(), date.getMonth() + 1, date.getDate());
      const weekIndex = Math.floor((dayOfYear + firstWeekday) / 7);
      const dayIndex = (date.getDay() + 6) % 7;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'heatmap-day';
      btn.style.background = `var(--color-level-${day.intensity})`;
      btn.style.gridColumnStart = weekIndex + 1;
      btn.style.gridRowStart = dayIndex + 1;
      btn.setAttribute('data-tip', `${formatDate(day.date)} · ${formatValue(day.price)} €/kWh`);
      btn.setAttribute('aria-label', `Detalle del día ${formatDate(day.date)}`);
      btn.dataset.date = day.date;
      elements.heatmapGrid.appendChild(btn);
    });
  };

  const renderClockChart = (hourlyProfile) => {
    const ctx = document.getElementById('clockChart').getContext('2d');
    if (charts.clock) charts.clock.destroy();
    const data = hourlyProfile.data;
    const min = Math.min(...data);
    const max = Math.max(...data);

    charts.clock = new Chart(ctx, {
      type: 'polarArea',
      data: {
        labels: hourlyProfile.labels,
        datasets: [{
          data,
          backgroundColor: data.map((value) => {
            const ratio = max !== min ? (value - min) / (max - min) : 0;
            return `hsla(${(1 - ratio) * 120}, 70%, 50%, 0.65)`;
          })
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { r: { ticks: { display: false } } }
      }
    });
  };

  const renderWeekdayChart = (weekdayProfile) => {
    const ctx = document.getElementById('weekdayChart').getContext('2d');
    if (charts.weekday) charts.weekday.destroy();
    charts.weekday = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weekdayProfile.labels,
        datasets: [{
          data: weekdayProfile.data,
          backgroundColor: '#8b5cf6',
          borderRadius: 6
        }]
      },
      options: { plugins: { legend: { display: false } } }
    });
  };

  const renderDailyChart = (dailyEvolution) => {
    const ctx = document.getElementById('dailyChart').getContext('2d');
    if (charts.daily) charts.daily.destroy();
    charts.daily = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dailyEvolution.labels,
        datasets: [{
          label: 'Precio (€/kWh)',
          data: dailyEvolution.data,
          borderColor: '#3b82f6',
          fill: true,
          backgroundColor: 'rgba(59,130,246,0.1)',
          tension: 0.3,
          pointRadius: 0
        }]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } }
      }
    });
  };

  const applyComparisonVisibility = () => {
    if (!charts.comparison) return;
    charts.comparison.data.datasets.forEach(dataset => {
      dataset.hidden = !state.visibleYears.has(dataset.label);
      const isSelected = dataset.label === state.year;
      dataset.borderWidth = isSelected ? 3 : 1.5;
      dataset.borderColor = isSelected ? dataset.baseColor : `${dataset.baseColor}55`;
    });
    charts.comparison.update();
  };

  const renderComparisonControls = (datasets) => {
    elements.comparisonControls.innerHTML = '';
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.type = 'button';
    toggleAllBtn.className = 'btn btn-ghost btn-sm';
    toggleAllBtn.textContent = state.visibleYears.size === datasets.length ? 'Ocultar todo' : 'Mostrar todo';
    toggleAllBtn.addEventListener('click', () => {
      if (state.visibleYears.size === datasets.length) {
        state.visibleYears.clear();
      } else {
        datasets.forEach(ds => state.visibleYears.add(ds.label));
      }
      renderComparisonControls(datasets);
      applyComparisonVisibility();
    });
    elements.comparisonControls.appendChild(toggleAllBtn);

    datasets.forEach((ds) => {
      const label = document.createElement('label');
      label.className = 'year-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.visibleYears.has(ds.label);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.visibleYears.add(ds.label);
        } else {
          state.visibleYears.delete(ds.label);
        }
        applyComparisonVisibility();
      });
      const text = document.createElement('span');
      text.textContent = ds.label;
      label.appendChild(checkbox);
      label.appendChild(text);
      elements.comparisonControls.appendChild(label);
    });
  };

  const renderComparisonChart = (comparisonData) => {
    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (charts.comparison) charts.comparison.destroy();

    const colors = {
      '2022': '#ef4444',
      '2023': '#f59e0b',
      '2024': '#10b981',
      '2025': '#3b82f6',
      '2026': '#8b5cf6',
      '2021': '#64748b'
    };

    const datasets = comparisonData.datasets.map(ds => ({
      ...ds,
      baseColor: colors[ds.label] || '#94a3b8',
      borderColor: colors[ds.label] || '#94a3b8',
      borderWidth: ds.label === state.year ? 3 : 1.5,
      pointRadius: 0
    }));

    charts.comparison = new Chart(ctx, {
      type: 'line',
      data: {
        labels: comparisonData.labels,
        datasets
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } }
      }
    });

    state.visibleYears = new Set(datasets.map(ds => ds.label));
    renderComparisonControls(datasets);
    applyComparisonVisibility();
  };

  const openModal = () => {
    elements.modal.hidden = false;
  };

  const closeModal = () => {
    elements.modal.hidden = true;
  };

  const renderDayModal = (dateStr, detail) => {
    elements.modalTitle.textContent = `Detalle del ${formatDate(dateStr)}`;
    elements.modalSubtitle.textContent = `Precio horario y ranking de horas para ${formatDate(dateStr)}.`;

    elements.dayCheapest.innerHTML = detail.cheapest.map(item => `<li>${item.label} · ${formatValue(item.price)} €/kWh</li>`).join('');
    elements.dayExpensive.innerHTML = detail.expensive.map(item => `<li>${item.label} · ${formatValue(item.price)} €/kWh</li>`).join('');

    const ctx = document.getElementById('dayChart').getContext('2d');
    if (charts.day) charts.day.destroy();
    charts.day = new Chart(ctx, {
      type: 'line',
      data: {
        labels: detail.labels,
        datasets: [{
          label: 'Precio (€/kWh)',
          data: detail.data,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.12)',
          tension: 0.3,
          pointRadius: 2
        }]
      },
      options: { plugins: { legend: { display: false } } }
    });

    openModal();
  };

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

  const loadData = async () => {
    setLoading(sections.savings, true);
    setLoading(sections.kpis, true);
    setLoading(sections.heatmap, true);
    setLoading(sections.clock, true);
    setLoading(sections.weekday, true);
    setLoading(sections.daily, true);
    setLoading(sections.comparison, true);

    const geoId = state.geoId;
    const year = state.year;

    try {
      const yearData = await window.PVPC_STATS.loadYearData(geoId, year);
      if (!yearData || !Object.keys(yearData.days).length) {
        elements.insightText.textContent = 'No hay datos disponibles para este año.';
        return;
      }

      const options = {
        duration: state.usageHours,
        dayType: state.dayType,
        exampleDay: state.exampleDay
      };

      const analysis = worker
        ? await runWorker('analyzeYear', { yearData, options })
        : window.PVPC_STATS.analyzeYear(yearData, options);

      renderKPIs(analysis);
      renderStatus(analysis.status);
      renderWindowList(analysis.windowStats, analysis.kpis);
      renderSummary(analysis.summaryStats, analysis.kpis);
      buildHeatmap(analysis.heatmap);
      renderClockChart(analysis.hourlyProfile);
      renderWeekdayChart(analysis.weekdayProfile);
      renderDailyChart(analysis.dailyEvolution);
      updateMeta(analysis.kpis);
      renderInsight(analysis.kpis, geoId);

      const comparisonYears = Array.from(elements.yearSelector.options).map(option => option.value);
      state.comparisonYears = comparisonYears;
      const comparisonDataByYear = {};

      await Promise.all(comparisonYears.map(async (yearOption) => {
        const data = await window.PVPC_STATS.loadYearData(geoId, yearOption);
        if (data && Object.keys(data.days).length) {
          comparisonDataByYear[yearOption] = data;
        }
      }));

      const comparison = worker
        ? await runWorker('compareYears', { dataByYear: comparisonDataByYear })
        : window.PVPC_STATS.buildComparison(comparisonDataByYear);

      renderComparisonChart(comparison);
    } catch (error) {
      elements.insightText.textContent = 'No se pudieron cargar los datos. Inténtalo de nuevo.';
      console.error(error);
    } finally {
      setLoading(sections.savings, false);
      setLoading(sections.kpis, false);
      setLoading(sections.heatmap, false);
      setLoading(sections.clock, false);
      setLoading(sections.weekday, false);
      setLoading(sections.daily, false);
      setLoading(sections.comparison, false);
    }
  };

  const onDayClick = async (dateStr) => {
    const yearData = await window.PVPC_STATS.loadYearData(state.geoId, state.year);
    const detail = worker
      ? await runWorker('dayDetail', { yearData, dateStr })
      : getDayDetailLocal(yearData, dateStr);

    elements.useDayBtn.onclick = () => {
      state.exampleDay = dateStr;
      elements.exampleBadge.hidden = false;
      elements.exampleDate.textContent = formatDate(dateStr);
      elements.clearExampleBtn.hidden = false;
      closeModal();
      loadData();
    };

    renderDayModal(dateStr, detail);
  };

  const resetExample = () => {
    state.exampleDay = null;
    elements.exampleBadge.hidden = true;
    elements.clearExampleBtn.hidden = true;
    loadData();
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

  elements.dayType.addEventListener('change', () => {
    state.dayType = elements.dayType.value;
    updateURL();
    loadData();
  });

  elements.usageHours.addEventListener('change', () => {
    state.usageHours = Number(elements.usageHours.value);
    state.usagePreset = 'custom';
    elements.usagePreset.value = 'custom';
    updateURL();
    loadData();
  });

  elements.usagePreset.addEventListener('change', () => {
    const preset = elements.usagePreset.value;
    state.usagePreset = preset;
    if (presets[preset]) {
      state.usageHours = presets[preset].hours;
      elements.usageHours.value = String(state.usageHours);
    }
    updateURL();
    loadData();
  });

  elements.clearExampleBtn.addEventListener('click', resetExample);

  elements.shareBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Enlace copiado al portapapeles.');
    } catch (error) {
      showToast('No se pudo copiar el enlace.');
    }
  });

  elements.resetBtn.addEventListener('click', () => {
    elements.geoSelector.value = '8741';
    elements.yearSelector.value = '2026';
    elements.dayType.value = 'any';
    elements.usagePreset.value = 'custom';
    elements.usageHours.value = '2';

    state.geoId = elements.geoSelector.value;
    state.year = elements.yearSelector.value;
    state.dayType = elements.dayType.value;
    state.usagePreset = elements.usagePreset.value;
    state.usageHours = Number(elements.usageHours.value);
    resetExample();
    updateURL();
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

  elements.closeModalBtn.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', (event) => {
    if (event.target.dataset.close) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.modal.hidden) {
      closeModal();
    }
  });

  readURL();
  updateURL();
  loadData();
})();
