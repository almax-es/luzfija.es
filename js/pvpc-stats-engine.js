/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Motor de cálculo para estadísticas PVPC
// Se encarga de cargar datos y procesarlos para gráficos

const PVPC_STATS = {
    cache: new Map(),
    manifestCache: new Map(),
    inFlightYearData: new Map(),
    inFlightGeoIndexes: new Map(),
    hourFormatterCache: new Map(),
    cacheMax: 8,
    maxConcurrentFetches: 4,

    // Un mes es utilizable solo si CADA dia declarado cubre su dia civil completo
    // (23/24/25 puntos horarios segun DST, contiguos, sin huecos ni duplicados, sin
    // ninguna hora ajena al dia). Antes solo se comprobaba "cada fila es un par
    // numerico", asi que un dia con un unico punto horario pasaba como sano y el
    // mes entero se cacheaba como completo (bloqueante 2, 12/08/2026).
    //
    // Excepcion: el dia local vigente (hoy, en la zona del propio dataset) puede
    // estar parcialmente publicado — ESIOS aun no ha terminado de publicarlo. Se
    // acepta con menos horas de las esperadas, pero todo lo publicado tiene que
    // ser correcto y contiguo desde la medianoche; nunca se acepta con MAS horas
    // de las esperadas ni con huecos/duplicados/horas de otro dia.
    hasUsableMonthPayload(data, expectedMonth = null, options = {}) {
        return this.getMonthCoverage(data, expectedMonth, options).ok;
    },

    getMonthCoverage(data, expectedMonth = null, options = {}) {
        const validator = window.LF?.csvUtils?.validatePvpcMonthCoverage;
        const identityValidator = window.LF?.csvUtils?.validateStaticPriceDatasetIdentity;
        if (typeof validator !== 'function') return { ok: false, reason: 'validator-unavailable' };
        if (typeof identityValidator !== 'function') return { ok: false, reason: 'identity-validator-unavailable' };
        const timeZone = options.timeZone || this.getDatasetTimeZone(options);
        const identity = identityValidator(data, {
            expectedGeoId: Number(options.geoId),
            expectedIndicator: options.type === 'surplus' ? 1739 : 1001,
            expectedTimeZone: timeZone
        });
        if (!identity.ok) return identity;
        const todayLocal = options.todayLocal || null;
        const freshnessDays = options.type === 'surplus' ? 2 : 1;
        return validator(data, expectedMonth, timeZone, { todayLocal, freshnessDays });
    },

    getGeoTimeZone(geoId) {
        return Number(geoId) === 8742 ? 'Atlantic/Canary' : 'Europe/Madrid';
    },

    getDatasetTimeZone(context) {
        if (context && typeof context === 'object') {
            if (typeof context.timezone === 'string' && context.timezone) return context.timezone;
            if (context.type === 'surplus') return 'Europe/Madrid';
            return this.getGeoTimeZone(context.geoId);
        }

        return this.getGeoTimeZone(context);
    },

    getHourFormatter(context) {
        const tz = this.getDatasetTimeZone(context);
        if (this.hourFormatterCache.has(tz)) {
            return this.hourFormatterCache.get(tz);
        }

        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            hourCycle: 'h23',
            hour12: false
        });

        this.hourFormatterCache.set(tz, formatter);
        return formatter;
    },

    getTimestampHour(timestampSeconds, context) {
        const ts = timestampSeconds instanceof Date
            ? Math.floor(timestampSeconds.getTime() / 1000)
            : Number(timestampSeconds);

        if (!Number.isFinite(ts)) return null;

        const parts = this.getHourFormatter(context).formatToParts(new Date(ts * 1000));
        const hourPart = parts.find((part) => part.type === 'hour');
        const hour = Number(hourPart ? hourPart.value : NaN);
        return Number.isFinite(hour) ? hour : null;
    },

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

    async loadGeoIndex(type, geoId) {
        const key = `${type}-${geoId}`;
        if (this.manifestCache.has(key)) {
            return this.manifestCache.get(key);
        }
        if (this.inFlightGeoIndexes.has(key)) {
            return this.inFlightGeoIndexes.get(key);
        }

        const loadPromise = (async () => {
            const { response: res, data: json } = await window.LF.csvUtils.fetchJsonWithTimeout(`/data/${type}/${geoId}/index.json`);
            if (!res || !res.ok) {
                return null;
            }

            const expectedTimeZone = this.getDatasetTimeZone({ geoId, type });
            const files = Array.isArray(json?.files) ? json.files : null;
            if (!files || files.length === 0) return null;

            const monthsByYear = new Map();
            files.forEach((entry) => {
                const fileName = entry && typeof entry.file === "string" ? entry.file : "";
                const match = fileName.match(/^(\d{4})-(\d{2})\.json$/);
                if (!match) return;

                const y = Number(match[1]);
                const month = match[2];
                if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
                monthsByYear.get(y).add(month);
            });

            if (monthsByYear.size === 0) return null;
            const manifest = {
                monthsByYear,
                // El path/type/geo solicitado define la zona. El manifest solo descubre
                // ficheros; metadata degradada no puede cambiar la interpretación horaria.
                timezone: expectedTimeZone
            };
            this.manifestCache.set(key, manifest);
            return manifest;
        })()
            .catch(() => null)
            .finally(() => {
                this.inFlightGeoIndexes.delete(key);
            });

        this.inFlightGeoIndexes.set(key, loadPromise);
        return loadPromise;
    },

    async buildYearData(geoId, year, type = 'pvpc', cacheKey = `${type}-${geoId}-${year}`) {
        const tasks = [];
        const monthLabels = [];
        // El indice es una ayuda de descubrimiento/metadata, no la fuente de verdad de
        // completitud anual. Si un deploy degrada `index.json` omitiendo un mes histórico,
        // saltarselo convertiría un año incompleto en "completo" y cacheable. La expectativa
        // se deriva del calendario conocido; cada mensual confirma después su disponibilidad.
        const manifest = await this.loadGeoIndex(type, geoId);
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        // "Hoy" en la zona del propio dataset, no en la del runtime: el dia local vigente
        // puede diferir (p.ej. Canarias) de la fecha del navegador que ejecuta el calculo.
        const buildTimeZone = manifest?.timezone || this.getDatasetTimeZone({ geoId, type });
        const todayLocal = window.LF?.csvUtils?.formatYmdInTimeZone?.(Date.now() / 1000, buildTimeZone) || null;

        for (let m = 1; m <= 12; m++) {
            // Optimización: No pedir meses futuros ni anteriores a Junio 2021
            if (year > currentYear) continue;
            if (Number(year) === currentYear && m > currentMonth) continue;
            if (Number(year) === 2021 && m < 6) continue;

            const monthStr = String(m).padStart(2, '0');
            const url = `/data/${type}/${geoId}/${year}-${monthStr}.json`;
            monthLabels.push(monthStr);
            tasks.push(async () => {
                try {
                    const { response: res, data: json } = await window.LF.csvUtils.fetchJsonWithTimeout(url);
                    if (!res || !res.ok) return null;
                    const coverage = this.getMonthCoverage(json, `${year}-${monthStr}`, { geoId, type, timeZone: buildTimeZone, todayLocal });
                    if (!coverage.ok) return null;
                    return { data: json, provisionalDays: coverage.provisionalDays };
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
                type,
                timezone: manifest?.timezone || this.getDatasetTimeZone({ geoId, type }),
                monthsExpected: [...monthLabels],
                monthsLoaded: [],
                failedMonths: [],
                provisionalDays: [],
                partial: false,
                from: null,
                to: null,
                latestDate: null,
                daysCount: 0
            }
        };

        monthlyResults.forEach((monthData, index) => {
            if (monthData?.data?.days) {
                Object.assign(yearData.days, monthData.data.days);
                yearData.meta.monthsLoaded.push(monthLabels[index]);
                yearData.meta.provisionalDays.push(...(monthData.provisionalDays || []));
                if (typeof monthData.data.timezone === 'string' && monthData.data.timezone) {
                    yearData.meta.timezone = monthData.data.timezone;
                }
                if (monthData.data.from) {
                    yearData.meta.from = yearData.meta.from ? Math.min(Date.parse(`${monthData.data.from}T00:00:00`), yearData.meta.from) : Date.parse(`${monthData.data.from}T00:00:00`);
                }
                if (monthData.data.to) {
                    yearData.meta.to = yearData.meta.to ? Math.max(Date.parse(`${monthData.data.to}T00:00:00`), yearData.meta.to) : Date.parse(`${monthData.data.to}T00:00:00`);
                }
            } else {
                yearData.meta.failedMonths.push(monthLabels[index]);
            }
        });
        yearData.meta.partial = yearData.meta.failedMonths.length > 0;

        const sortedDates = Object.keys(yearData.days).sort();
        yearData.meta.latestDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
        yearData.meta.daysCount = sortedDates.length;

        // Un año parcialmente descargado sirve para mostrar degradación explícita,
        // pero no se convierte en caché pegajosa de sesión: una recarga/reintento debe
        // poder recuperar el mes que falló cuando vuelva la red.
        if (!yearData.meta.partial && yearData.meta.provisionalDays.length === 0) {
            this.touchCache(cacheKey, yearData);
        }
        return yearData;
    },

    /**
     * Carga todos los datos disponibles para una zona y año
     * @param {number} geoId - ID de la zona (8741 Península, etc)
     * @param {number} year - Año a cargar (ej. 2024)
     * @param {string} type - Tipo de dato ('pvpc' o 'surplus')
     * @returns {Promise<Object>} - Objeto con todos los precios horarios del año
     */
    async loadYearData(geoId, year, type = 'pvpc') {
        const cacheKey = `${type}-${geoId}-${year}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            this.touchCache(cacheKey, cached);
            return cached;
        }

        if (this.inFlightYearData.has(cacheKey)) {
            return this.inFlightYearData.get(cacheKey);
        }

        const loadPromise = this.buildYearData(geoId, year, type, cacheKey)
            .finally(() => {
                this.inFlightYearData.delete(cacheKey);
            });

        this.inFlightYearData.set(cacheKey, loadPromise);
        return loadPromise;
    },

    getYearStatus(yearData) {
        const year = yearData.meta?.year;
        const totalDays = this.daysInYear(year);
        const sortedDates = Object.keys(yearData.days).sort();
        const loadedDays = sortedDates.length;
        const coverageFrom = sortedDates.length ? sortedDates[0] : null;
        const coverageTo = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
        const updatedUntil = yearData.meta?.latestDate || coverageTo;
        const oneDay = 1000 * 60 * 60 * 24;
        const coverageDays = coverageFrom && coverageTo
            ? Math.round((this.parseDateLocal(coverageTo) - this.parseDateLocal(coverageFrom)) / oneDay) + 1
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
            yearCompleteness,
            monthsExpected: yearData.meta?.monthsExpected || [],
            monthsLoaded: yearData.meta?.monthsLoaded || [],
            failedMonths: yearData.meta?.failedMonths || [],
            provisionalDays: yearData.meta?.provisionalDays || [],
            partial: Boolean(yearData.meta?.partial),
            provisional: (yearData.meta?.provisionalDays || []).length > 0
        };
    },

    parseDateLocal(dateStr) {
        return new Date(`${dateStr}T12:00:00`);
    },

    /**
     * Índice canónico (0-365) para alinear series de distintos años sobre un
     * mismo eje de 366 posiciones. Se calcula siempre contra un año bisiesto,
     * de modo que el 29-feb ocupa la posición 59 en todos los años: en los no
     * bisiestos esa posición queda vacía en vez de desplazar un día todo el
     * tramo marzo-diciembre. Ojo: calcular el índice sobre el año real (su
     * posición dentro de ese año) desalinea los años no bisiestos.
     */
    canonicalDayIndex(month, day) {
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor((Date.UTC(2024, month - 1, day) - Date.UTC(2024, 0, 1)) / oneDay);
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
            // Un año sin una sola observación no tiene precio 0: no tiene precio.
            // Mantener `null` permite que la UI muestre “—” y no un rango ficticio
            // 0,000–0,000 €/kWh cuando todos los meses fallaron al cargar.
            avgPrice: countHours ? sumPrice / countHours : null,
            minPrice: countHours ? minPrice : null,
            maxPrice: countHours ? maxPrice : null,
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

    toDailySeries(yearData) {
        const values = new Array(366).fill(null);
        const sortedDates = Object.keys(yearData.days).sort();
        sortedDates.forEach(dateStr => {
            const [, m, d] = dateStr.split('-').map(Number);
            const dayOfYear = this.canonicalDayIndex(m, d);
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
    },

    /**
     * Prepara datos para el perfil horario promedio (0h - 23h)
     */
    getHourlyProfile(yearData) {
        const hourlySums = new Array(24).fill(0);
        const hourlyCounts = new Array(24).fill(0);
        const timeContext = yearData?.meta;

        Object.values(yearData.days).forEach(hours => {
            hours.forEach(([ts, price]) => {
                const hour = this.getTimestampHour(ts, timeContext);
                if (!Number.isFinite(hour)) return;
                hourlySums[hour] += price;
                hourlyCounts[hour]++;
            });
        });

        // Ausencia de observaciones no equivale a precio 0. Esto ocurre de forma normal
        // en un día provisional todavía incompleto (p. ej. el día 1 del mes): usar 0
        // hacía que la UI dibujara horas no publicadas como gratuitas y pudiera
        // recomendarlas como el bloque más barato. Chart.js admite `null` como hueco.
        const data = hourlySums.map((sum, i) => hourlyCounts[i] ? sum / hourlyCounts[i] : null);
        const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

        return { labels, data };
    },

    /**
     * Construye el dataset de un año para los gráficos de comparación
     * multianual. Devuelve null si yearData está vacío o ausente.
     * `extra` permite añadir opciones de dataset (p. ej. borderWidth)
     * sin alterar las comunes (label, data, tension, pointRadius).
     */
    _buildYearDataset(yearData, year, extra = {}) {
        if (!yearData || !Object.keys(yearData.days).length) return null;
        const values = new Array(366).fill(null);
        const sortedDates = Object.keys(yearData.days).sort();

        sortedDates.forEach(dateStr => {
            const [, m, d] = dateStr.split('-').map(Number);
            const dayOfYear = this.canonicalDayIndex(m, d);
            const hours = yearData.days[dateStr];
            const avg = hours.reduce((sum, h) => sum + h[1], 0) / hours.length;

            if (dayOfYear >= 0 && dayOfYear < 366) {
                values[dayOfYear] = avg;
            }
        });

        return { label: year, data: values, tension: 0.3, pointRadius: 0, ...extra };
    },

    /**
     * Etiquetas canónicas de eje X (366 días) para los gráficos de
     * comparación multianual. Usa 2024 (bisiesto) para cubrir el 29-feb.
     */
    _comparisonLabels() {
        const labels = [];
        const date = new Date(2024, 0, 1);
        for (let i = 0; i < 366; i++) {
            labels.push(date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }));
            date.setDate(date.getDate() + 1);
        }
        return labels;
    },

    /**
     * Prepara datos para comparación multianual (varias líneas en un mismo gráfico)
     */
    async getMultiYearComparison(geoId, years, type = 'pvpc') {
        const datasets = [];

        for (const year of years) {
            const data = await this.loadYearData(geoId, year, type);
            const dataset = this._buildYearDataset(data, year, { borderWidth: 2 });
            if (dataset) datasets.push(dataset);
        }

        return { labels: this._comparisonLabels(), datasets };
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

    formatHourRange(startRef, durationHours, context) {
        const startTs = startRef instanceof Date
            ? Math.floor(startRef.getTime() / 1000)
            : Number(startRef);

        if (!Number.isFinite(startTs)) return '';

        const startHour = this.getTimestampHour(startTs, context);
        const endHour = this.getTimestampHour(startTs + (durationHours * 60 * 60), context);

        if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return '';

        const startLabel = `${String(startHour).padStart(2, '0')}:00`;
        const endLabel = `${String(endHour).padStart(2, '0')}:00`;
        return `${startLabel}–${endLabel}`;
    },

    getWindowStats(yearData, options = {}) {
        const duration = Number(options.duration) || 1;
        const dayType = options.dayType || 'any';
        const exampleDay = options.exampleDay || null;
        const windowsMap = new Map();
        const timeContext = yearData?.meta;

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

            const entries = hours.map(([ts, price]) => ({ ts, price }));

            for (let i = 0; i <= entries.length - duration; i++) {
                let sum = 0;
                for (let j = 0; j < duration; j++) {
                    sum += entries[i + j].price;
                }

                const average = sum / duration;
                const label = this.formatHourRange(entries[i].ts, duration, timeContext);
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

        Object.keys(dataByYear).forEach((year) => {
            const dataset = this._buildYearDataset(dataByYear[year], year);
            if (dataset) datasets.push(dataset);
        });

        return { labels: this._comparisonLabels(), datasets };
    }
};

window.PVPC_STATS = PVPC_STATS;
