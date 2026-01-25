const parseDateLocal = (dateStr) => new Date(`${dateStr}T12:00:00`);

const dayOfYearUTC = (year, month, day) => {
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / oneDay) - 1;
};

const getPercentile = (values, percentile) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const formatHourRange = (startDate, durationHours) => {
  const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);
  const format = (date) => date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${format(startDate)}–${format(endDate)}`;
};

const getYearStatus = (yearData) => {
  const year = yearData.meta?.year;
  const totalDays = isLeapYear(year) ? 366 : 365;
  const sortedDates = Object.keys(yearData.days).sort();
  const loadedDays = sortedDates.length;
  const coverageFrom = sortedDates.length ? sortedDates[0] : null;
  const coverageTo = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
  const updatedUntil = yearData.meta?.latestDate || coverageTo;
  const oneDay = 1000 * 60 * 60 * 24;
  const coverageDays = coverageFrom && coverageTo
    ? Math.round((parseDateLocal(coverageTo) - parseDateLocal(coverageFrom)) / oneDay) + 1
    : 0;
  const coverageCompleteness = coverageDays ? loadedDays / coverageDays : 0;
  const yearCompleteness = totalDays ? loadedDays / totalDays : 0;
  return {
    updatedUntil,
    completeness: yearCompleteness,
    loadedDays,
    totalDays,
    coverageFrom,
    coverageTo,
    coverageDays,
    coverageCompleteness,
    yearCompleteness
  };
};

const isLeapYear = (year) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0);

const getKPIs = (yearData) => {
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let sumPrice = 0;
  let countHours = 0;
  let minHour = null;
  let maxHour = null;

  Object.entries(yearData.days).forEach(([date, hours]) => {
    hours.forEach(([ts, price]) => {
      if (price < minPrice) {
        minPrice = price;
        minHour = { date, ts, price };
      }
      if (price > maxPrice) {
        maxPrice = price;
        maxHour = { date, ts, price };
      }
      sumPrice += price;
      countHours += 1;
    });
  });

  return {
    avgPrice: countHours ? sumPrice / countHours : 0,
    minPrice: Number.isFinite(minPrice) ? minPrice : 0,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : 0,
    minHour,
    maxHour
  };
};

const getHourlyProfile = (yearData) => {
  const hourlySums = new Array(24).fill(0);
  const hourlyCounts = new Array(24).fill(0);

  Object.values(yearData.days).forEach(hours => {
    hours.forEach(([ts, price]) => {
      const hour = new Date(ts * 1000).getHours();
      hourlySums[hour] += price;
      hourlyCounts[hour] += 1;
    });
  });

  const data = hourlySums.map((sum, i) => hourlyCounts[i] ? sum / hourlyCounts[i] : 0);
  const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  return { labels, data };
};

const getWeekdayProfile = (yearData) => {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);

  Object.entries(yearData.days).forEach(([dateStr, hours]) => {
    const day = parseDateLocal(dateStr).getDay();
    const dailyAvg = hours.reduce((acc, h) => acc + h[1], 0) / hours.length;
    sums[day] += dailyAvg;
    counts[day] += 1;
  });

  const data = [];
  for (let i = 1; i <= 6; i++) {
    data.push(counts[i] ? sums[i] / counts[i] : 0);
  }
  data.push(counts[0] ? sums[0] / counts[0] : 0);

  return { labels: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'], data };
};

const getDailyEvolution = (yearData) => {
  const labels = [];
  const data = [];
  Object.keys(yearData.days).sort().forEach(date => {
    const hours = yearData.days[date];
    const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;
    labels.push(date);
    data.push(avg);
  });
  return { labels, data };
};

const getHeatmapData = (yearData) => {
  const sortedDates = Object.keys(yearData.days).sort();
  if (!sortedDates.length) return [];
  const prices = sortedDates.map(date => {
    const hours = yearData.days[date];
    return hours.reduce((sum, h) => sum + h[1], 0) / hours.length;
  });
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  return sortedDates.map((date, index) => {
    const price = prices[index];
    const intensity = range > 0 ? Math.floor(((price - min) / range) * 4) : 0;
    return { date, price, intensity };
  });
};

const getWindowStats = (yearData, options = {}) => {
  const duration = Number(options.duration) || 1;
  const dayType = options.dayType || 'any';
  const exampleDay = options.exampleDay || null;
  const windowsMap = new Map();

  const dateKeys = exampleDay ? [exampleDay] : Object.keys(yearData.days);
  dateKeys.forEach(dateStr => {
    const hours = yearData.days[dateStr];
    if (!hours || hours.length < duration) return;

    if (!exampleDay && dayType !== 'any') {
      const day = parseDateLocal(dateStr).getDay();
      const isWeekend = day === 0 || day === 6;
      if (dayType === 'weekday' && isWeekend) return;
      if (dayType === 'weekend' && !isWeekend) return;
    }

    const entries = hours.map(([ts, price]) => ({ ts, price, date: new Date(ts * 1000) }));
    for (let i = 0; i <= entries.length - duration; i++) {
      let sum = 0;
      for (let j = 0; j < duration; j++) {
        sum += entries[i + j].price;
      }
      const average = sum / duration;
      const label = formatHourRange(entries[i].date, duration);
      const existing = windowsMap.get(label) || { values: [], sum: 0, count: 0 };
      existing.values.push(average);
      existing.sum += average;
      existing.count += 1;
      windowsMap.set(label, existing);
    }
  });

  const windows = Array.from(windowsMap.entries()).map(([label, stats]) => {
    const avg = stats.count ? stats.sum / stats.count : 0;
    return {
      label,
      avg,
      p10: getPercentile(stats.values, 0.1),
      p50: getPercentile(stats.values, 0.5),
      p90: getPercentile(stats.values, 0.9)
    };
  });

  windows.sort((a, b) => a.avg - b.avg);

  return {
    windows,
    cheapest: windows.slice(0, 3),
    expensive: windows.length ? windows[windows.length - 1] : null
  };
};

const analyzeYear = (yearData, options) => {
  const kpis = getKPIs(yearData);
  const hourlyProfile = getHourlyProfile(yearData);
  const weekdayProfile = getWeekdayProfile(yearData);
  const dailyEvolution = getDailyEvolution(yearData);
  const heatmap = getHeatmapData(yearData);
  const status = getYearStatus(yearData);

  const hourlyPrices = Object.values(yearData.days).flat().map(entry => entry[1]);
  const p10 = getPercentile(hourlyPrices, 0.1);
  const p90 = getPercentile(hourlyPrices, 0.9);

  const windowStats = getWindowStats(yearData, options);
  const summaryStats = getWindowStats(yearData, { duration: options.duration || 1, dayType: 'any' });

  return {
    kpis,
    hourlyProfile,
    weekdayProfile,
    dailyEvolution,
    heatmap,
    status,
    p10,
    p90,
    windowStats,
    summaryStats
  };
};

const buildComparison = (dataByYear) => {
  const datasets = [];
  Object.keys(dataByYear).forEach((year) => {
    const data = dataByYear[year];
    if (!data || !Object.keys(data.days).length) return;
    const values = new Array(366).fill(null);
    Object.keys(data.days).sort().forEach(dateStr => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dayOfYear = dayOfYearUTC(y, m, d);
      const hours = data.days[dateStr];
      const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;
      if (dayOfYear >= 0 && dayOfYear < 366) {
        values[dayOfYear] = avg;
      }
    });
    datasets.push({ label: year, data: values, tension: 0.3, pointRadius: 0 });
  });

  const labels = [];
  const date = new Date(2024, 0, 1);
  for (let i = 0; i < 366; i++) {
    labels.push(date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }));
    date.setDate(date.getDate() + 1);
  }

  return { labels, datasets };
};

const buildComparisonFromSeries = (seriesByYear) => {
  const datasets = [];
  Object.entries(seriesByYear).forEach(([year, series]) => {
    if (!series || !Array.isArray(series.values)) return;
    datasets.push({
      label: year,
      data: series.values,
      tension: 0.3,
      pointRadius: 0
    });
  });

  const labels = [];
  const date = new Date(2024, 0, 1);
  for (let i = 0; i < 366; i++) {
    labels.push(date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }));
    date.setDate(date.getDate() + 1);
  }

  return { labels, datasets };
};

const getDayDetail = (yearData, dateStr) => {
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

self.onmessage = (event) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'analyzeYear') {
      const result = analyzeYear(payload.yearData, payload.options || {});
      self.postMessage({ id, result });
      return;
    }
    if (type === 'compareYears') {
      const result = buildComparison(payload.dataByYear);
      self.postMessage({ id, result });
      return;
    }
    if (type === 'compareSeries') {
      const result = buildComparisonFromSeries(payload.seriesByYear || {});
      self.postMessage({ id, result });
      return;
    }
    if (type === 'dayDetail') {
      const result = getDayDetail(payload.yearData, payload.dateStr);
      self.postMessage({ id, result });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
