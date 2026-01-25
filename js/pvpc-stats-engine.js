// Motor de cálculo para estadísticas PVPC
// Se encarga de cargar datos y procesarlos para gráficos

const PVPC_STATS = {
    // Cache de datos en memoria para no volver a pedir años/meses ya cargados
    cache: new Map(),

    /**
     * Carga todos los datos disponibles para una zona y año
     * @param {number} geoId - ID de la zona (8741 Península, etc)
     * @param {number} year - Año a cargar (ej. 2024)
     * @returns {Promise<Object>} - Objeto con todos los precios horarios del año
     */
    async loadYearData(geoId, year) {
        const cacheKey = `${geoId}-${year}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

        const promises = [];
        // Intentamos cargar los 12 meses
        for (let m = 1; m <= 12; m++) {
            const monthStr = String(m).padStart(2, '0');
            const url = `/data/pvpc/${geoId}/${year}-${monthStr}.json`;
            
            promises.push(
                fetch(url)
                    .then(res => {
                        if (!res.ok) return null; // Mes no disponible (futuro o error)
                        return res.json();
                    })
                    .catch(() => null)
            );
        }

        const monthlyResults = await Promise.all(promises);
        
        // Unificar todos los días en un solo objeto
        const yearData = {
            days: {},
            meta: { geoId, year }
        };

        monthlyResults.forEach(monthData => {
            if (monthData && monthData.days) {
                Object.assign(yearData.days, monthData.days);
            }
        });

        this.cache.set(cacheKey, yearData);
        return yearData;
    },

    /**
     * Procesa datos para obtener estadísticas globales (KPIs)
     */
    getKPIs(yearData) {
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let sumPrice = 0;
        let countHours = 0;
        let maxDay = null;
        let minDay = null;
        let maxHour = null;
        let minHour = null;

        Object.entries(yearData.days).forEach(([date, hours]) => {
            let dailySum = 0;
            hours.forEach(([ts, price]) => {
                // Precio actual (convertir a €/MWh para visualización si se prefiere, o dejar en €/kWh)
                // Aquí trabajaremos en €/kWh que es el estándar de la web
                if (price < minPrice) {
                    minPrice = price;
                    minHour = { date, ts, price };
                }
                if (price > maxPrice) {
                    maxPrice = price;
                    maxHour = { date, ts, price };
                }
                sumPrice += price;
                dailySum += price;
                countHours++;
            });
            
            const dailyAvg = dailySum / hours.length;
            // Podríamos calcular días más caros/baratos aquí también
        });

        return {
            avgPrice: countHours ? (sumPrice / countHours) : 0,
            minPrice,
            maxPrice,
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
        
        // Ordenar fechas
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
            hours.forEach(([ts, price], index) => {
                // Asumimos que el array viene ordenado 0h a 23h
                // Para ser más robustos podríamos sacar la hora del TS
                const date = new Date(ts * 1000);
                // Ajustar a hora local de la zona si fuera necesario, 
                // pero los JSON ya vienen con la hora correcta en orden
                // El índice 0 suele ser las 00:00
                const hour = index % 24; 
                
                hourlySums[hour] += price;
                hourlyCounts[hour]++;
            });
        });

        const data = hourlySums.map((sum, i) => hourlyCounts[i] ? sum / hourlyCounts[i] : 0);
        const labels = Array.from({length: 24}, (_, i) => `${i}:00`);

        return { labels, data };
    },

    /**
     * Analiza días de la semana (Lunes vs Domingo, etc)
     */
    getWeekdayProfile(yearData) {
        const sums = new Array(7).fill(0); // 0=Domingo, 1=Lunes...
        const counts = new Array(7).fill(0);

        Object.entries(yearData.days).forEach(([dateStr, hours]) => {
            const date = new Date(dateStr);
            const day = date.getDay(); // 0-6
            
            const dailyAvg = hours.reduce((acc, h) => acc + h[1], 0) / hours.length;
            sums[day] += dailyAvg;
            counts[day]++;
        });

        // Reordenar para empezar en Lunes (1) y terminar en Domingo (0)
        const orderedData = [];
        const orderedLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        
        // Lunes(1) a Sábado(6)
        for(let i=1; i<=6; i++) {
            orderedData.push(counts[i] ? sums[i]/counts[i] : 0);
        }
        // Domingo(0) al final
        orderedData.push(counts[0] ? sums[0]/counts[0] : 0);

        return { labels: orderedLabels, data: orderedData };
    }
};

// Exportar globalmente
window.PVPC_STATS = PVPC_STATS;
