(() => {
  const geoNames = {
    '8741': 'Península',
    '8742': 'Canarias',
    '8743': 'Baleares',
    '8744': 'Ceuta',
    '8745': 'Melilla'
  };

  const sections = {
    kpis: document.querySelector('[data-loading][aria-labelledby="kpiTitle"]'),
    heatmap: document.querySelector('[data-loading][aria-labelledby="heatmapTitle"]'),
    clock: document.querySelector('[data-loading][aria-labelledby="clockTitle"]'),
    weekday: document.querySelector('[data-loading][aria-labelledby="weekdayTitle"]'),
    comparison: document.querySelector('[data-loading][aria-labelledby="comparisonTitle"]')
  };

  const elements = {
    geoSelector: document.getElementById('geoSelector'),
    yearSelector: document.getElementById('yearSelector'),
    insightText: document.getElementById('insightText'),
    kpiAvg: document.getElementById('kpiAvg'),
    kpiMin: document.getElementById('kpiMin'),
    kpiMinDate: document.getElementById('kpiMinDate'),
    kpiMax: document.getElementById('kpiMax'),
    kpiMaxDate: document.getElementById('kpiMaxDate'),
    kpiSolar: document.getElementById('kpiSolar'),
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
    comparisonToken: 0
  };

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

  const readURL = () => {
    const params = new URLSearchParams(window.location.search);
    const year = params.get('year');
    const geo = params.get('geo');

    if (year && document.querySelector(`#yearSelector option[value="${year}"]`)) {
      elements.yearSelector.value = year;
      state.year = year;
    }

    if (geo && document.querySelector(`#geoSelector option[value="${geo}"]`)) {
      elements.geoSelector.value = geo;
      state.geoId = geo;
    }
  };

  const updateURL = () => {
    const params = new URLSearchParams();
    params.set('geo', state.geoId);
    params.set('year', state.year);
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

  const renderInsight = async (kpis, geoId) => {
    const currentYear = Number(state.year);
    const prevYear = currentYear - 1;

    if (prevYear >= 2022) {
      const prevData = await window.PVPC_STATS.loadYearData(geoId, prevYear);
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
    const datasets = Object.entries(seriesByYear).map(([year, series]) => ({
      label: year,
      data: series.values,
      tension: 0.3,
      pointRadius: 0
    }));

    // Generar labels mensuales
    const labels = [];
    const date = new Date(2024, 0, 1);
    for (let i = 0; i < 366; i++) {
      if (date.getDate() === 15) {
        labels.push(date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''));
      } else {
        labels.push('');
      }
      date.setDate(date.getDate() + 1);
    }

    return {
      labels,
      datasets
    };
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
    if (!elements.comparisonControls) return;
    elements.comparisonControls.innerHTML = '';
    
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.type = 'button';
    toggleAllBtn.className = 'btn btn-ghost btn-sm';
    toggleAllBtn.style.fontSize = '0.75rem';
    toggleAllBtn.textContent = state.visibleYears.size === datasets.length ? 'Ocultar todos' : 'Ver todos';
    
    toggleAllBtn.addEventListener('click', () => {
      if (state.visibleYears.size === datasets.length) {
        state.visibleYears.clear();
        state.visibleYears.add(state.year); 
      } else {
        datasets.forEach(ds => state.visibleYears.add(ds.label));
      }
      renderComparisonControls(datasets);
      applyComparisonVisibility();
    });
    elements.comparisonControls.appendChild(toggleAllBtn);

    datasets.forEach((ds) => {
      const isActive = state.visibleYears.has(ds.label);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'year-pill';
      btn.setAttribute('aria-pressed', isActive);
      
      if (isActive) {
        btn.style.backgroundColor = ds.baseColor;
        btn.style.borderColor = ds.baseColor;
      } else {
        btn.style.color = 'var(--text-muted)';
      }

      btn.innerHTML = `
        ${!isActive ? `<span class="year-pill__dot" style="background-color:${ds.baseColor}"></span>` : ''}
        ${ds.label}
      `;

      btn.addEventListener('click', () => {
        if (isActive) {
          if (state.visibleYears.size > 1) {
             state.visibleYears.delete(ds.label);
          }
        } else {
          state.visibleYears.add(ds.label);
        }
        renderComparisonControls(datasets); 
        applyComparisonVisibility();
      });
      
      elements.comparisonControls.appendChild(btn);
    });
  };

  const renderComparisonChart = (comparisonData) => {
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

    const datasets = comparisonData.datasets.map(ds => {
      const isSelected = ds.label === state.year;
      const baseColor = colors[ds.label] || '#94a3b8';
      
      let backgroundColor = 'transparent';
      
      if (isSelected) {
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, `${baseColor}66`);
        gradient.addColorStop(1, `${baseColor}05`);
        backgroundColor = gradient;
      }

      return {
        ...ds,
        baseColor: baseColor,
        borderColor: isSelected ? baseColor : `${baseColor}80`,
        borderWidth: isSelected ? 3 : 2,
        backgroundColor: backgroundColor,
        fill: isSelected,
        pointRadius: 0,
        order: isSelected ? 0 : 1,
        shadowBlur: isSelected ? 10 : 0,
        shadowColor: isSelected ? baseColor : 'transparent'
      };
    });

        charts.comparison = new Chart(ctx, {
          type: 'line',
          data: {
            labels: comparisonData.labels,
            datasets
          },
          options: {
            responsive: true,
            interaction: {
              mode: 'index',
              intersect: false,
            },
            plugins: {
              legend: {
                display: false // Ocultamos leyenda nativa, ya tenemos los botones "pills" abajo
              },
              tooltip: {
                backgroundColor: 'rgba(255, 255, 255, 0.95)', // Fondo blanco
                titleColor: '#1e293b', // Texto oscuro
                titleFont: { family: "'Outfit', sans-serif", weight: 800, size: 13 },
                bodyColor: '#64748b',
                bodyFont: { family: "'Outfit', sans-serif", size: 12 },
                borderColor: 'rgba(0,0,0,0.05)',
                borderWidth: 1,
                padding: 16,
                cornerRadius: 12,
                boxPadding: 6,
                usePointStyle: true,
                titleAlign: 'center',
                shadowOffsetX: 0,
                shadowOffsetY: 10,
                shadowBlur: 20,
                shadowColor: 'rgba(0,0,0,0.15)', // Sombra suave "Apple style"
                itemSort: (a, b) => b.raw - a.raw,
                callbacks: {
                  title: (context) => {
                    const date = new Date(2024, 0, 1);
                    date.setDate(date.getDate() + context[0].dataIndex);
                    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                  },
                  label: (context) => {
                    let label = context.dataset.label || '';
                    const val = context.parsed.y !== null ? formatValue(context.parsed.y) : '--';
                    return ` ${label}: ${val} €/kWh`;
                  },
                  labelColor: (context) => {
                    return {
                      borderColor: 'transparent',
                      backgroundColor: context.dataset.baseColor,
                      borderRadius: 4
                    };
                  }
                }
              }
            },
            elements: {
              point: { radius: 0, hoverRadius: 6, hoverBorderWidth: 3, hoverBorderColor: '#fff' },
              line: { tension: 0.4, borderCapStyle: 'round' }
            },
            layout: {
                padding: { top: 20, bottom: 10 }
            },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false, drawBorder: false, drawOnChartArea: false, drawTicks: false },
            ticks: { 
              maxRotation: 0, 
              autoSkip: false,
              padding: 10,
              font: { family: "'Outfit', sans-serif", size: 11, weight: 600 },
              color: '#94a3b8' 
            } 
          },
              y: {
                beginAtZero: true,
                border: { display: false }, // Sin línea vertical izquierda
                grid: {
                    color: '#f1f5f9', // Gris muy muy claro
                    borderDash: [4, 4], // Punteado elegante
                    drawBorder: false,
                    tickLength: 0
                },
                ticks: {
                  padding: 15,
                  font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
                  color: '#94a3b8',
                  callback: (value) => value.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €'
                }
              }
            }
          }
        });
    state.visibleYears = new Set(datasets.map(ds => ds.label));
    renderComparisonControls(datasets);
    applyComparisonVisibility();
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

        const comparison = worker
          ? await runWorker('compareSeries', { seriesByYear })
          : buildComparisonFromSeries(seriesByYear);

        if (requestToken !== state.comparisonToken) return;

        if (comparison?.datasets?.length) {
          renderComparisonChart(comparison);
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
    setLoading(sections.heatmap, true);
    setLoading(sections.clock, true);
    setLoading(sections.weekday, true);
    setLoading(sections.comparison, true);

    const geoId = state.geoId;
    const year = state.year;

    try {
      const yearData = await window.PVPC_STATS.loadYearData(geoId, year);
      if (!yearData || !Object.keys(yearData.days).length) {
        elements.insightText.textContent = 'No hay datos disponibles para este año.';
        setLoading(sections.kpis, false);
        setLoading(sections.heatmap, false);
        setLoading(sections.clock, false);
        setLoading(sections.weekday, false);
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
      renderKPIs(analysis);
      buildHeatmap(analysis.heatmap);
      renderClockChart(analysis.hourlyProfile);
      renderWeekdayChart(analysis.weekdayProfile);
      updateMeta(analysis.kpis);
      renderInsight(analysis.kpis, geoId);

      setLoading(sections.kpis, false);
      setLoading(sections.heatmap, false);
      setLoading(sections.clock, false);
      setLoading(sections.weekday, false);

      const comparisonYears = Array.from(elements.yearSelector.options).map(option => option.value);
      state.comparisonYears = comparisonYears;
      loadComparisonAsync({ geoId, years: comparisonYears, token: comparisonToken });
    } catch (error) {
      elements.insightText.textContent = 'No se pudieron cargar los datos. Inténtalo de nuevo.';
      console.error(error);
      setLoading(sections.comparison, false);
    } finally {
      setLoading(sections.kpis, false);
      setLoading(sections.heatmap, false);
      setLoading(sections.clock, false);
      setLoading(sections.weekday, false);
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
  updateURL();
  loadData();
})();
