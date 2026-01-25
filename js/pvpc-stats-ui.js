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
    dataWarning: document.getElementById('dataWarning'),
    dataMeta: document.getElementById('dataMeta'),
    insightText: document.getElementById('insightText'),
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
    usageChips: document.getElementById('usageChips'),
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
    comparisonToken: 0,
    comparisonShowDaily: false,
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
      table[i] = {
        month: date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''),
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
    if (state.comparisonShowDaily) {
      params.set('comparisonShowDaily', '1');
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

    if (comparisonShowDaily !== null) {
      state.comparisonPrefsFromUrl.showDaily = comparisonShowDaily === '1' || comparisonShowDaily === 'true';
      state.comparisonShowDaily = state.comparisonPrefsFromUrl.showDaily;
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

  const updateSchema = (kpis, yearLabel, geoName) => {
    let schemaScript = document.getElementById('dynamic-schema');
    if (!schemaScript) {
      schemaScript = document.createElement('script');
      schemaScript.id = 'dynamic-schema';
      schemaScript.type = 'application/ld+json';
      document.head.appendChild(schemaScript);
    }

    const avgPrice = kpis.avgPrice.toFixed(4);
    const minPrice = kpis.minPrice.toFixed(4);
    
    const schemaData = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "name": "Inicio",
              "item": "https://luzfija.es/"
            },
            {
              "@type": "ListItem",
              "position": 2,
              "name": "Estadísticas PVPC",
              "item": window.location.href
            }
          ]
        },
        {
          "@type": "Dataset",
          "name": `Histórico Precio Luz PVPC ${yearLabel} - ${geoName}`,
          "description": `Datos horarios y diarios del precio de la electricidad (PVPC) en ${geoName} durante ${yearLabel}. Precio medio: ${avgPrice} €/kWh.`,
          "license": "https://creativecommons.org/licenses/by/4.0/",
          "creator": {
            "@type": "Organization",
            "name": "LuzFija.es"
          },
          "distribution": [
            {
              "@type": "DataDownload",
              "encodingFormat": "text/csv",
              "contentUrl": `https://luzfija.es/data/pvpc/${state.geoId}/${state.year}.json` // Enlace lógico al recurso
            }
          ],
          "variableMeasured": [
            {
              "@type": "PropertyValue",
              "name": "Precio Medio",
              "unitText": "EUR/kWh",
              "value": avgPrice
            },
            {
              "@type": "PropertyValue",
              "name": "Precio Mínimo",
              "unitText": "EUR/kWh",
              "value": minPrice
            }
          ]
        }
      ]
    };

    schemaScript.textContent = JSON.stringify(schemaData);
  };

  const updateMeta = (kpis) => {
    const yearLabel = state.year === '2026' ? '2026' : state.year;
    const geoName = geoNames[state.geoId] || 'España';
    
    // Título SEO-optimizado: Intención de búsqueda + Datos clave
    document.title = `Precio Luz ${yearLabel}: Estadísticas PVPC y Horas Baratas ${geoName} | LuzFija.es`;

    // Descripción persuasiva (CTR)
    const descText = `Consulta el histórico del precio de la luz en ${yearLabel}. Media actual: ${kpis.avgPrice.toFixed(4)} €/kWh. Descubre las horas más baratas para ahorrar y compara la evolución anual del PVPC en ${geoName}.`;

    const metaDescription = document.getElementById('meta-description');
    const ogTitle = document.getElementById('og-title');
    const ogDescription = document.getElementById('og-description');
    const twitterTitle = document.getElementById('twitter-title');
    const twitterDesc = document.getElementById('twitter-description');

    if (metaDescription) metaDescription.setAttribute('content', descText);
    if (ogTitle) ogTitle.setAttribute('content', `Precio Luz ${yearLabel}: Análisis y Estadísticas ${geoName}`);
    if (ogDescription) ogDescription.setAttribute('content', descText);
    if (twitterTitle) twitterTitle.setAttribute('content', `Precio Luz ${yearLabel} - ${geoName}`);
    if (twitterDesc) twitterDesc.setAttribute('content', `Media: ${kpis.avgPrice.toFixed(4)} €/kWh | ¿Cuándo es más barato consumir? Ver análisis →`);

    updateSchema(kpis, yearLabel, geoName);
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
      const savingsVsPeak = (baselinePrice - windowItem.p50) * kwh;
      
      return `
        <div class="window-card-pro ${index === 0 ? 'window-card-pro--top' : ''}">
          <span class="w-rank">#${index + 1}</span>
          <span class="w-time">${windowItem.label}</span>
          <div class="w-price-box">
            <span class="w-price-main">${formatValue(windowItem.p50)} €/kWh</span>
          </div>
          <div class="w-meta">
            ≈ ${formatCurrency(costPerUse)} por uso<br>
            Rango: ${formatValue(windowItem.p10)} – ${formatValue(windowItem.p90)}
          </div>
          <div class="w-saving-badge">
            -${formatCurrency(savingsVsPeak)} vs pico
          </div>
        </div>
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
    if (!elements.usageChips) return;
    // Update active chip
    elements.usageChips.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('chip--active', c.dataset.preset === state.savings.preset);
    });
    
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
        showDaily: state.comparisonShowDaily
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
      dataset.data = state.comparisonShowDaily ? dataset.dailyPoints : dataset.smoothPoints;
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

    const dailyBtn = document.createElement('button');
    dailyBtn.type = 'button';
    dailyBtn.className = `pill ${state.comparisonShowDaily ? 'pill--active' : ''}`;
    dailyBtn.textContent = state.comparisonShowDaily ? 'Ver suavizado' : 'Ver datos diarios';
    dailyBtn.addEventListener('click', () => {
      state.comparisonShowDaily = !state.comparisonShowDaily;
      saveComparisonPrefs(state.geoId);
      renderComparisonControls(years, selectedYear);
      updateComparisonSeries(charts.comparison);
      applyComparisonVisibility();
      updateURL();
    });

    header.append(showAllBtn, isolateBtn, dailyBtn);
    elements.comparisonControls.appendChild(header);

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
    const monthlyTicks = buildMonthlyTicks(selectedYearNumber);
    const tickLabelMap = new Map(monthlyTicks.map((tick) => [tick.value, tick.label]));
    const dayTable = buildDayOfYearTable(selectedYearNumber);

    const datasets = years.map((year) => {
      const series = seriesByYear[year];
      const baseColor = colors[year] || '#94a3b8';
      const points = (series?.values || []).map((value, index) => ({
        x: index + 1,
        y: Number.isFinite(value) ? value : null
      }));
      const smoothPoints = smoothMovingAverage(points, options.window || 7);
      const isSelected = year === selectedYear;
      const gradient = ctx.createLinearGradient(0, 0, 0, 400);
      gradient.addColorStop(0, hexToRgba(baseColor, 0.25));
      gradient.addColorStop(1, hexToRgba(baseColor, 0));

      return {
        label: year,
        data: state.comparisonShowDaily ? points : smoothPoints,
        dailyPoints: points,
        smoothPoints,
        baseColor,
        fillColor: gradient,
        borderColor: isSelected ? baseColor : hexToRgba(baseColor, 0.35),
        borderWidth: isSelected ? 3 : 1.5,
        backgroundColor: isSelected ? gradient : 'transparent',
        fill: isSelected,
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
                const dayIndex = context[0].parsed.x;
                const entry = dayTable[dayIndex];
                if (!entry) return `Día ${dayIndex}`;
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
            max: 366,
            border: { display: false },
            grid: { display: false },
            afterBuildTicks: (scale) => {
              scale.ticks = monthlyTicks.map(tick => ({ value: tick.value }));
            },
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              color: mutedColor,
              padding: 10,
              font: { family: "'Outfit', sans-serif", size: 11, weight: 600 },
              callback: (value) => tickLabelMap.get(value) || ''
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

    const prefs = loadComparisonPrefs(state.geoId);
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
    setLoading(sections.comparison, true);

    const geoId = state.geoId;
    const year = state.year;

    try {
      const yearData = await window.PVPC_STATS.loadYearData(geoId, year);
      if (!yearData || !Object.keys(yearData.days).length) {
        elements.insightText.textContent = 'No hay datos disponibles para este año.';
        setLoading(sections.kpis, false);
        setLoading(sections.savings, false);
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
      console.error(error);
      setLoading(sections.comparison, false);
    } finally {
      setLoading(sections.kpis, false);
      setLoading(sections.savings, false);
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

  if (elements.usageChips) {
    elements.usageChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.savingsOverrides = { duration: false, kwh: false };
      applyPreset(chip.dataset.preset);
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
