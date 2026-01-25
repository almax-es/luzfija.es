// Motor de cálculo para estadísticas PVPC
// Se encarga de cargar datos y procesarlos para gráficos

const PVPC_STATS = {
    cache: new Map(),
    cacheMax: 8,
    maxConcurrentFetches: 4,

    touchCache(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        this.cache.set(key, value);
        if (this.cache.size > this.cacheMax) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    },

    async runWithConcurrency(tasks, limit = this.maxConcurrentFetches) {
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
    },

    /**
     * Carga todos los datos disponibles para una zona y año
     * @param {number} geoId - ID de la zona (8741 Península, etc)
     * @param {number} year - Año a cargar (ej. 2024)
     * @returns {Promise<Object>} - Objeto con todos los precios horarios del año
     */
    async loadYearData(geoId, year) {
        const cacheKey = `${geoId}-${year}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            this.touchCache(cacheKey, cached);
            return cached;
        }

        const tasks = [];
        const monthLabels = [];
        for (let m = 1; m <= 12; m++) {
            const monthStr = String(m).padStart(2, '0');
            const url = `/data/pvpc/${geoId}/${year}-${monthStr}.json`;
            monthLabels.push(monthStr);
            tasks.push(async () => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) return null;
                    return await res.json();
                } catch (error) {
                    return null;
                }
            });
        }

        const monthlyResults = await this.runWithConcurrency(tasks);

        const yearData = {
            days: {},
            meta: {
                geoId,
                year,
                monthsLoaded: [],
                from: null,
                to: null,
                latestDate: null,
                daysCount: 0
            }
        };

        monthlyResults.forEach((monthData, index) => {
            if (monthData && monthData.days) {
                Object.assign(yearData.days, monthData.days);
                yearData.meta.monthsLoaded.push(monthLabels[index]);
                if (monthData.from) {
                    yearData.meta.from = yearData.meta.from ? Math.min(Date.parse(`${monthData.from}T00:00:00`), yearData.meta.from) : Date.parse(`${monthData.from}T00:00:00`);
                }
                if (monthData.to) {
                    yearData.meta.to = yearData.meta.to ? Math.max(Date.parse(`${monthData.to}T00:00:00`), yearData.meta.to) : Date.parse(`${monthData.to}T00:00:00`);
                }
            }
        });

        const sortedDates = Object.keys(yearData.days).sort();
        yearData.meta.latestDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
        yearData.meta.daysCount = sortedDates.length;

        this.touchCache(cacheKey, yearData);
        return yearData;
    },

    getYearStatus(yearData) {
        const year = yearData.meta?.year;
        const totalDays = this.daysInYear(year);
        const loadedDays = Object.keys(yearData.days).length;
        const completeness = totalDays ? loadedDays / totalDays : 0;
        const updatedUntil = yearData.meta?.latestDate || (loadedDays ? Object.keys(yearData.days).sort().pop() : null);

        return {
            updatedUntil,
            completeness,
            loadedDays,
            totalDays,
            monthsLoaded: yearData.meta?.monthsLoaded || []
        };
    },

    parseDateLocal(dateStr) {
        return new Date(`${dateStr}T12:00:00`);
    },

    dayOfYearUTC(year, month, day) {
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / oneDay) - 1;
    },

    daysInYear(year) {
        if (!year) return 0;
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
    },

    getPercentile(values, percentile) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = (sorted.length - 1) * percentile;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) return sorted[lower];
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    },

    /**
     * Procesa datos para obtener estadísticas globales (KPIs)
     */
    getKPIs(yearData) {
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let sumPrice = 0;
        let countHours = 0;
        let maxHour = null;
        let minHour = null;

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
                countHours++;
            });
        });

        return {
            avgPrice: countHours ? sumPrice / countHours : 0,
            minPrice: Number.isFinite(minPrice) ? minPrice : 0,
            maxPrice: Number.isFinite(maxPrice) ? maxPrice : 0,
            minHour,
            maxHour
        };
    },

    /**
     * Prepara datos para el gráfico de evolución diaria
     */
    getDailyEvolution(yearData) {
        const labels = [];
        const data = [];
        const sortedDates = Object.keys(yearData.days).sort();

        sortedDates.forEach(date => {
            const hours = yearData.days[date];
            const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;
            labels.push(date);
            data.push(avg);
        });

        return { labels, data };
    },

    /**
     * Prepara datos para el perfil horario promedio (0h - 23h)
     */
    getHourlyProfile(yearData) {
        const hourlySums = new Array(24).fill(0);
        const hourlyCounts = new Array(24).fill(0);

        Object.values(yearData.days).forEach(hours => {
            hours.forEach(([ts, price]) => {
                const date = new Date(ts * 1000);
                const hour = date.getHours();
                hourlySums[hour] += price;
                hourlyCounts[hour]++;
            });
        });

        const data = hourlySums.map((sum, i) => hourlyCounts[i] ? sum / hourlyCounts[i] : 0);
        const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

        return { labels, data };
    },

    /**
     * Prepara datos para comparación multianual (varias líneas en un mismo gráfico)
     */
    async getMultiYearComparison(geoId, years) {
        const datasets = [];

        for (const year of years) {
            const data = await this.loadYearData(geoId, year);
            if (!data || Object.keys(data.days).length === 0) continue;

            const values = new Array(366).fill(null);
            const sortedDates = Object.keys(data.days).sort();

            sortedDates.forEach(dateStr => {
                const [y, m, d] = dateStr.split('-').map(Number);
                const dayOfYear = this.dayOfYearUTC(y, m, d);
                const hours = data.days[dateStr];
                const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;

                if (dayOfYear >= 0 && dayOfYear < 366) {
                    values[dayOfYear] = avg;
                }
            });

            datasets.push({
                label: year,
                data: values,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2
            });
        }

        const labels = [];
        const date = new Date(2024, 0, 1);
        for (let i = 0; i < 366; i++) {
            labels.push(date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }));
            date.setDate(date.getDate() + 1);
        }

        return { labels, datasets };
    },

    /**
     * Prepara datos para el mapa de calor (Heatmap)
     */
    getHeatmapData(yearData) {
        const sortedDates = Object.keys(yearData.days).sort();
        if (!sortedDates.length) return [];

        const prices = sortedDates.map(d => {
            const h = yearData.days[d];
            return h.reduce((acc, curr) => acc + curr[1], 0) / h.length;
        });

        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = max - min;

        return sortedDates.map((date, i) => {
            const price = prices[i];
            const intensity = range > 0 ? Math.floor(((price - min) / range) * 4) : 0;
            return { date, price, intensity };
        });
    },

    /**
     * Analiza días de la semana (Lunes vs Domingo, etc)
     */
    getWeekdayProfile(yearData) {
        const sums = new Array(7).fill(0);
        const counts = new Array(7).fill(0);

        Object.entries(yearData.days).forEach(([dateStr, hours]) => {
            const date = this.parseDateLocal(dateStr);
            const day = date.getDay();

            const dailyAvg = hours.reduce((acc, h) => acc + h[1], 0) / hours.length;
            sums[day] += dailyAvg;
            counts[day]++;
        });

        const orderedData = [];
        const orderedLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

        for (let i = 1; i <= 6; i++) {
            orderedData.push(counts[i] ? sums[i] / counts[i] : 0);
        }
        orderedData.push(counts[0] ? sums[0] / counts[0] : 0);

        return { labels: orderedLabels, data: orderedData };
    },

    formatHourRange(startDate, durationHours) {
        const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);
        const format = (date) => date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${format(startDate)}–${format(endDate)}`;
    },

    getWindowStats(yearData, options = {}) {
        const duration = Number(options.duration) || 1;
        const dayType = options.dayType || 'any';
        const exampleDay = options.exampleDay || null;
        const windowsMap = new Map();

        const dateKeys = exampleDay ? [exampleDay] : Object.keys(yearData.days);
        dateKeys.forEach(dateStr => {
            const hours = yearData.days[dateStr];
            if (!hours || hours.length < duration) return;

            if (!exampleDay && dayType !== 'any') {
                const day = this.parseDateLocal(dateStr).getDay();
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
                const label = this.formatHourRange(entries[i].date, duration);
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
                p10: this.getPercentile(stats.values, 0.1),
                p50: this.getPercentile(stats.values, 0.5),
                p90: this.getPercentile(stats.values, 0.9)
            };
        });

        windows.sort((a, b) => a.avg - b.avg);

        return {
            windows,
            cheapest: windows.slice(0, 3),
            expensive: windows.length ? windows[windows.length - 1] : null
        };
    },

    analyzeYear(yearData, options = {}) {
        const kpis = this.getKPIs(yearData);
        const hourlyProfile = this.getHourlyProfile(yearData);
        const weekdayProfile = this.getWeekdayProfile(yearData);
        const dailyEvolution = this.getDailyEvolution(yearData);
        const heatmap = this.getHeatmapData(yearData);
        const status = this.getYearStatus(yearData);

        const hourlyPrices = Object.values(yearData.days).flat().map((entry) => entry[1]);
        const p10 = this.getPercentile(hourlyPrices, 0.1);
        const p90 = this.getPercentile(hourlyPrices, 0.9);

        const windowStats = this.getWindowStats(yearData, options);
        const summaryStats = this.getWindowStats(yearData, { duration: options.duration || 1, dayType: 'any' });

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
    },

    buildComparison(dataByYear) {
        const datasets = [];
        const years = Object.keys(dataByYear);

        years.forEach((year) => {
            const data = dataByYear[year];
            if (!data || !Object.keys(data.days).length) return;
            const values = new Array(366).fill(null);
            Object.keys(data.days).sort().forEach(dateStr => {
                const [y, m, d] = dateStr.split('-').map(Number);
                const dayOfYear = this.dayOfYearUTC(y, m, d);
                const hours = data.days[dateStr];
                const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;
                if (dayOfYear >= 0 && dayOfYear < 366) {
                    values[dayOfYear] = avg;
                }
            });

            datasets.push({
                label: year,
                data: values,
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
    }
};

window.PVPC_STATS = PVPC_STATS;
