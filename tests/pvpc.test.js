import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Simulamos el entorno del navegador
global.window = {
  location: { hostname: 'localhost', search: '' },
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  },
  LF: {} 
};
global.fetch = vi.fn();
global.window.toast = vi.fn();

// Cargar dependencias necesarias
const loadScript = (filePath) => {
  const code = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
  const fn = new Function('window', 'location', 'localStorage', code);
  fn(global.window, global.window.location, global.window.localStorage);
};

// Activar debug para ver errores internos
global.window.__LF_DEBUG = true;

// Cargar config real antes que utilidades dependientes
loadScript('../js/lf-config.js');
// Cargar lf-utils primero (pvpc.js usa window.LF)
loadScript('../js/lf-utils.js');
// Cargar el clasificador horario canónico usado por el modo híbrido
loadScript('../js/lf-csv-utils.js');
// Cargar pvpc.js
loadScript('../js/pvpc.js');

describe('PVPC Engine (js/pvpc.js)', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.window.localStorage.getItem.mockReturnValue(null);
    global.window.toast.mockClear();
    vi.spyOn(console, 'log'); // Espiar logs
    delete global.window.LF.consumosHorarios;
    delete global.window.LF.pvpcPeriodoCSV;
  });

  function pvpcIdentity(geoId = 8741, timezone = 'Europe/Madrid') {
    return {
      schema_version: 2,
      geo_id: Number(geoId),
      timezone,
      indicator: 1001,
      unit: 'EUR/kWh',
      epoch_unit: 's'
    };
  }

  function addCalendarDay(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }

  function localMidnightEpoch(dateStr, timeZone = 'Europe/Madrid') {
    const utcGuess = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23'
    });

    for (let shiftHours = -14; shiftHours <= 14; shiftHours += 1) {
      const candidate = utcGuess + (shiftHours * 3600);
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate * 1000))
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, part.value])
      );
      if (`${parts.year}-${parts.month}-${parts.day}` === dateStr && parts.hour === '00') {
        return candidate;
      }
    }

    throw new Error(`No se pudo resolver medianoche local para ${dateStr} en ${timeZone}`);
  }

  // Helper de precios P1/P2/P3 anclado al día civil real de Madrid.
  // Al calcular la duración hasta la siguiente medianoche también funciona en
  // días DST de 23/25 horas y clasifica cada punto por su hora local efectiva.
  function generateMockDayPrices(p1, p2, p3, ymd = '2025-01-07') {
    const timeZone = 'Europe/Madrid';
    const baseTs = localMidnightEpoch(ymd, timeZone);
    const nextTs = localMidnightEpoch(addCalendarDay(ymd), timeZone);
    const hourFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23'
    });

    const priceForHour = (hour) => {
      if (hour < 8) return p3;
      if (hour < 10) return p2;
      if (hour < 14) return p1;
      if (hour < 18) return p2;
      if (hour < 22) return p1;
      return p2;
    };

    const prices = [];
    for (let ts = baseTs; ts < nextTs; ts += 3600) {
      const localHour = Number(hourFormatter.format(new Date(ts * 1000)));
      prices.push([ts, priceForHour(localHour)]);
    }
    return prices;
  }

  function generateMadridDayPrices(ymd, price = 0.10) {
    const baseTs = Date.parse(`${ymd}T00:00:00+01:00`) / 1000;
    return Array.from({ length: 24 }, (_, h) => [baseTs + h * 3600, price]);
  }

  function generateCompleteMadridMonth(ym, price = 0.10) {
    const [year, month] = ym.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = {};
    for (let day = 1; day <= lastDay; day += 1) {
      const ymd = `${ym}-${String(day).padStart(2, '0')}`;
      days[ymd] = generateMockDayPrices(price, price, price, ymd);
    }
    return days;
  }

  function generateDstFallbackDayPrices() {
    const prices = [];
    const baseTs = Date.parse('2024-10-26T22:00:00Z') / 1000; // 00:00 local del 27/10/2024

    for (let i = 0; i < 25; i++) {
      const ts = baseTs + i * 3600;
      let price = 0.10;
      if (i === 2) price = 0.20; // primera 02:00 local
      if (i === 3) price = 0.50; // segunda 02:00 local (hora 25)
      prices.push([ts, price]);
    }

    return prices;
  }

  function generateDstSpringForwardDayPrices() {
    const prices = [];
    const baseTs = Date.parse('2026-03-28T23:00:00Z') / 1000; // 00:00 local del 29/03/2026

    for (let i = 0; i < 23; i++) {
      const ts = baseTs + i * 3600;
      let price = 0.10;
      if (i === 2) price = 0.50; // 03:00 local; la hora 02:00 no existe
      prices.push([ts, price]);
    }

    return prices;
  }

  function generateCanaryDstFallbackDayPrices() {
    const prices = [];
    const baseTs = Date.parse('2024-10-26T23:00:00Z') / 1000; // 00:00 local canaria

    for (let i = 0; i < 25; i++) {
      const ts = baseTs + i * 3600;
      let price = 0.10;
      if (i === 1) price = 0.20; // primera 01:00 local
      if (i === 2) price = 0.50; // segunda 01:00 local (hora 25)
      prices.push([ts, price]);
    }

    return prices;
  }

  it('obtenerPVPC_LOCAL debe descargar y calcular precios medios correctamente', async () => {
    const apiP1 = 0.20;
    const apiP2 = 0.10;
    const apiP3 = 0.05;

    // Mock del JSON mensual
    const mockJson = {
      ...pvpcIdentity(8741, 'Europe/Madrid'),
      // Proveemos datos para varios dias por si la logica interna usa "ayer" o "hoy"
      days: {
        '2025-01-07': generateMockDayPrices(apiP1, apiP2, apiP3), // Ayer
        '2025-01-08': generateMockDayPrices(apiP1, apiP2, apiP3, '2025-01-08')  // Hoy (mockeado)
      },
      meta: { max_after_conversion: 0.20 }
    };

    global.fetch.mockImplementation((url) => {
      console.log('DEBUG TEST FETCH:', url);
      return Promise.resolve({
        ok: true,
        json: async () => mockJson
      });
    });

    // Inputs del usuario (simulados)
    // El sistema de PVPC usa estos inputs para saber que rango de fechas descargar
    // dias=1, fecha fin = hoy (simulada)
    // PERO obtenerPVPC_LOCAL calcula la fecha internamente basandose en "hoy".
    // Tenemos que mockear Date para que "hoy" sea 2025-01-08
    
    const mockDate = new Date('2025-01-08T12:00:00Z');
    vi.setSystemTime(mockDate);

    const inputs = {
      zonaFiscal: 'Península',
      p1: 3.45, p2: 3.45,
      dias: 1,
      cPunta: 10, cLlano: 10, cValle: 10
    };

    // Ejecutar
    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL(inputs);
    
    console.log('DEBUG RESULT:', JSON.stringify(result, null, 2));

    // Verificaciones
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toBeDefined();
    
    // La logica interna de PVPC calcula medias.
    // Como hemos puesto precios fijos constantes, la media debe ser exacta.
    expect(result.precioPunta).toBeCloseTo(apiP1, 3);
    expect(result.precioLlano).toBeCloseTo(apiP2, 3);
    expect(result.precioValle).toBeCloseTo(apiP3, 3);
    
    vi.useRealTimers();
  });

  // 26/08/2026, residual senyalado por Codex: el test de `esFestivoNacionalMmdd` en
  // csv.test.js cubre el helper, pero no que pvpc.js LO LLAME. Sustituir el resultado de
  // `esFestivoNacional()` (js/pvpc.js:583-586) por un false constante dejaba aquella
  // regresion en verde. Este caso entra por el recorrido productivo completo:
  // 6 de enero de 2026 (Reyes) cae en MARTES, asi que si el motor no reconoce el festivo
  // lo clasificara como laborable y repartira las horas en P1/P2/P3.
  // Precios por franja 3/2/1: si TODO el dia es valle, la media de las 24 horas es 2,0;
  // si se reparte por horario, el valle serian solo las horas < 8, es decir 1,0.
  it('un festivo nacional entre semana clasifica TODO el dia como valle (recorrido PVPC)', async () => {
    vi.setSystemTime(new Date('2026-01-07T12:00:00Z'));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2026-01-06': generateMockDayPrices(3, 2, 1, '2026-01-06') }
      })
    });

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Peninsula', p1: 3.45, p2: 3.45, dias: 1,
      cPunta: 10, cLlano: 10, cValle: 10
    });

    expect(result).toBeDefined();
    // Media de las 24 horas del dia completo, no solo de las nocturnas.
    // "TODO el dia es valle" se fija exigiendo que punta y llano queden SIN muestras.
    // Solo con la media del valle no bastaba: mover unicamente las 8 horas punta al valle
    // y dejar las llano como P2 daria (8*1 + 8*3)/16 = 2,0 igualmente (Codex, 26/08/2026).
    expect(result.precioPunta).toBe(0);
    expect(result.precioLlano).toBe(0);
    expect(result.precioValle).toBeCloseTo(2.0, 6);

    vi.useRealTimers();
  });

  it('rechaza un HTTP 200 horario completo si pertenece a otro indicador', async () => {
    vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        indicator: 1739,
        days: { '2025-02-28': generateMadridDayPrices('2025-02-28', 9.99) }
      })
    });

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
      cPunta: 10, cLlano: 10, cValle: 10
    });

    expect(result).toBeNull();
    expect(global.window.localStorage.setItem).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('prorratea la potencia PVPC 2026 desde los importes anuales oficiales sin redondeo diario previo', async () => {
    vi.setSystemTime(new Date('2026-01-08T12:00:00Z'));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2026-01-07': generateMockDayPrices(0.10, 0.10, 0.10, '2026-01-07') },
        meta: { max_after_conversion: 0.10 }
      })
    });

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 9.3, p2: 9.3, dias: 1,
      cPunta: 0, cLlano: 0, cValle: 0,
      fechaYmd: '2026-01-07'
    });

    expect(result).toBeDefined();
    expect(result.terminoFijo).toBeCloseTo(0.7243766432876712, 12);
    expect(result.costeMargenPot).toBeCloseTo(0.07931753424657534, 12);
    expect(result.totalFactura).toBe(1.09);
    expect(window.LF_CONFIG.peajesPotenciaPVPC.p1).toBeCloseTo(27.704413 / 365, 15);
    expect(window.LF_CONFIG.peajesPotenciaPVPC.p2).toBeCloseTo(0.725423 / 365, 15);
    expect(window.LF_CONFIG.peajesPotenciaPVPC.margen).toBeCloseTo(3.113 / 365, 15);
    vi.useRealTimers();
  });

  it('redondea exactamente el CCF anual en la frontera 5 kW × 3,113 × 365/365', async () => {
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    global.fetch.mockImplementation((url) => {
      const match = /(\d{4}-\d{2})\.json/.exec(String(url));
      if (!match) throw new Error(`URL mensual inesperada: ${url}`);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...pvpcIdentity(8741, 'Europe/Madrid'),
          days: generateCompleteMadridMonth(match[1])
        })
      });
    });

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 5, p2: 0, dias: 365,
      cPunta: 0, cLlano: 0, cValle: 0,
      fechaYmd: '2025-12-31'
    });

    expect(result).toBeDefined();
    expect(result.costeMargenPot).toBeCloseTo(15.565, 12);
    expect(result.resultadoPVPC.find((row) => row.cabecera === 'Margen de comercialización')?.importe).toBe('15.57');
    vi.useRealTimers();
  });

  it('obtenerPVPC_LOCAL debe manejar errores de red', async () => {
    global.fetch.mockRejectedValue(new Error('Network fail'));
    
    const inputs = { zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1 };
    
    // No debe lanzar excepcion, sino devolver null (y loguear error)
    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL(inputs);

    expect(result).toBeNull();
  });

  it('valida días cerrados completos y detecta horas ausentes o valores inválidos', () => {
    const full = generateMadridDayPrices('2025-02-28');
    expect(global.window.LF.pvpc.validateClosedPvpcDay('2025-02-28', full, 'Europe/Madrid')).toMatchObject({ ok: true, points: 24 });
    expect(global.window.LF.pvpc.validateClosedPvpcDay('2025-02-28', full.slice(0, -1), 'Europe/Madrid')).toMatchObject({ ok: false, reason: 'missing-last-hour' });

    const withNullPrice = full.map((pair) => [...pair]);
    withNullPrice[10][1] = null;
    expect(global.window.LF.pvpc.validateClosedPvpcDay('2025-02-28', withNullPrice, 'Europe/Madrid')).toMatchObject({ ok: false, reason: 'invalid-entry' });
  });

  it('acepta días DST cerrados de 23 y 25 horas cuando cubren todo el día civil', () => {
    expect(global.window.LF.pvpc.validateClosedPvpcDay(
      '2026-03-29',
      generateDstSpringForwardDayPrices(),
      'Europe/Madrid'
    )).toMatchObject({ ok: true, points: 23 });
    expect(global.window.LF.pvpc.validateClosedPvpcDay(
      '2024-10-27',
      generateDstFallbackDayPrices(),
      'Europe/Madrid'
    )).toMatchObject({ ok: true, points: 25 });
  });


  it('PVPC estandar rechaza un dia normal de 23/24 aunque el JSON mensual responda 200', async () => {
    vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: {
          '2025-02-28': generateMadridDayPrices('2025-02-28', 0.10).slice(0, -1)
        }
      })
    });

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
      cPunta: 10, cLlano: 10, cValle: 10
    });

    expect(result).toBeNull();

    const validPlusCorrupt = generateMadridDayPrices('2025-02-28', 0.10);
    validPlusCorrupt.push([validPlusCorrupt.at(-1)[0] + 3600, null]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2025-02-28': validPlusCorrupt }
      })
    });
    const malformed = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
      cPunta: 10, cLlano: 10, cValle: 10
    });
    expect(malformed).toBeNull();
    vi.useRealTimers();
  });

  // FRONTERA CSV / ESTANDAR. El mismo dataset (24 horas validas + 1 fila corrupta) debe
  // producir resultados OPUESTOS segun la ruta, porque sus contratos son distintos:
  //   - PVPC estandar: exige cobertura integra del dia cerrado -> falla cerrado.
  //   - CSV: tiene su propio contrato de cobertura y puede consumir las horas validas.
  // Una normalizacion destructiva ejecutada ANTES de bifurcar rompia la segunda mitad:
  // descartaba el dia entero y CSV devolvia null (regresion detectada el 12/08/2026).
  describe('24 horas válidas + 1 fila corrupta: contratos distintos por ruta', () => {
    const diaConFilaCorrupta = () => {
      const pares = generateMadridDayPrices('2025-02-28', 0.10);
      pares.push([pares.at(-1)[0] + 3600, null]); // fila corrupta: precio no numérico
      return pares;
    };

    const responder = () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ...pvpcIdentity(8741, 'Europe/Madrid'),
          days: { '2025-02-28': diaConFilaCorrupta() }
        })
      });
    };

    it('PVPC estándar falla cerrado', async () => {
      vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
      responder();
      global.window.LF.consumosHorarios = null;
      global.window.LF.pvpcPeriodoCSV = false;

      const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
        zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
        cPunta: 10, cLlano: 10, cValle: 10
      });

      expect(result).toBeNull();
      vi.useRealTimers();
    });

    it('CSV sí calcula, y la fila corrupta no altera las horas válidas que consume', async () => {
      vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
      responder();
      // Dos horas reales del dia, ambas con precio 0,10 en el fixture.
      global.window.LF.consumosHorarios = [
        { fecha: new Date(2025, 1, 28), hora: 4, kwh: 1 },
        { fecha: new Date(2025, 1, 28), hora: 12, kwh: 2 }
      ];
      global.window.LF.pvpcPeriodoCSV = true;

      const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
        zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
        cPunta: 3, cLlano: 0, cValle: 0
      });

      expect(result).toBeTruthy();
      // 3 kWh x 0,10 EUR/kWh: la fila corrupta no ha contaminado ningun precio.
      expect(result.terminoVariable).toBeCloseTo(0.30, 6);
      expect(result.pvpcCoverage.mode).toBe('exact');
      expect(result.pvpcCoverage.hoursWithoutPrice).toBe(0);
      expect(result.pvpcCoverage.hoursWithPrice).toBe(2);

      global.window.LF.consumosHorarios = null;
      global.window.LF.pvpcPeriodoCSV = false;
      vi.useRealTimers();
    });

    // El caso anterior deja la fila corrupta DESPUES de la ultima hora valida, asi que
    // no colisiona con ninguna hora que el CSV consuma: mata la regresion de la
    // normalizacion previa, pero no protege cada `usablePvpcRows()` por separado.
    // Verificado por mutacion: quitar el filtro de un solo consumidor lo dejaba verde.
    it('una fila corrupta en la MISMA hora consumida no desplaza la numeración CNMC', async () => {
      vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
      const pares = generateMadridDayPrices('2025-02-28', 0.10);
      // Duplicado corrupto de la hora 12 CNMC (indice 11): mismo timestamp, precio nulo.
      // Sin filtro por fila, buildCnmcHourEntries contaria dos ocurrencias de esa hora
      // local y la segunda pasaria a ser hora 25, desplazando la numeracion del dia.
      pares.splice(11, 0, [pares[11][0], null]);
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ...pvpcIdentity(8741, 'Europe/Madrid'), days: { '2025-02-28': pares } })
      });
      global.window.LF.consumosHorarios = [
        { fecha: new Date(2025, 1, 28), hora: 12, kwh: 2 }
      ];
      global.window.LF.pvpcPeriodoCSV = true;

      const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
        zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
        cPunta: 2, cLlano: 0, cValle: 0
      });

      expect(result).toBeTruthy();
      expect(result.pvpcCoverage.mode).toBe('exact');
      expect(result.pvpcCoverage.hoursWithoutPrice).toBe(0);
      // 2 kWh x 0,10: si la fila corrupta hubiera desplazado la hora 12, el cruce
      // exacto no la encontraria y caeria a hibrido/medias.
      expect(result.terminoVariable).toBeCloseTo(0.20, 6);

      global.window.LF.consumosHorarios = null;
      global.window.LF.pvpcPeriodoCSV = false;
      vi.useRealTimers();
    });

    it('una fila corrupta no contamina las medias P1/P2/P3 del modo medias', async () => {
      vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
      const pares = generateMadridDayPrices('2025-02-28', 0.10);
      pares.splice(5, 0, [pares[5][0], null]); // corrupta en zona valle
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ...pvpcIdentity(8741, 'Europe/Madrid'), days: { '2025-02-28': pares } })
      });
      // La hora 25 no existe en un dia normal de 24 h: 1 de 2 horas sin precio supera
      // el umbral del 10%, asi que el calculo cae al modo MEDIAS. Ese modo si consume
      // precioP1/P2/P3, de modo que una fila corrupta colada en las sumas daria NaN.
      global.window.LF.consumosHorarios = [
        { fecha: new Date(2025, 1, 28), hora: 3, kwh: 1 },
        { fecha: new Date(2025, 1, 28), hora: 25, kwh: 1 }
      ];
      global.window.LF.pvpcPeriodoCSV = true;

      const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
        zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 1,
        cPunta: 0, cLlano: 0, cValle: 2
      });

      expect(result).toBeTruthy();
      expect(result.pvpcCoverage.mode).toBe('average');
      expect(Number.isFinite(result.terminoVariable)).toBe(true);
      // Modo medias: 2 kWh valle x media P3. Todo el fixture vale 0,10, asi que
      // cualquier contaminacion de la media rompe este importe.
      expect(result.terminoVariable).toBeCloseTo(0.20, 6);

      global.window.LF.consumosHorarios = null;
      global.window.LF.pvpcPeriodoCSV = false;
      vi.useRealTimers();
    });
  });

  it('PVPC estándar falla cerrado si un mes solicitado devuelve 503 y no persiste caché parcial', async () => {
    vi.setSystemTime(new Date('2025-03-02T12:00:00Z'));
    global.fetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/2025-02.json')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...pvpcIdentity(8741, 'Europe/Madrid'),
            days: { '2025-02-28': generateMadridDayPrices('2025-02-28', 0.10) }
          })
        });
      }
      if (u.includes('/2025-03.json')) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      }
      throw new Error(`URL inesperada: ${u}`);
    });

    const values = {
      zonaFiscal: 'Península', p1: 3.45, p2: 3.45, dias: 2,
      cPunta: 10, cLlano: 10, cValle: 10
    };
    const raw = await global.window.LF.pvpc.obtenerPVPC_LOCAL(values);
    expect(raw).toBeNull();

    global.window.localStorage.setItem.mockClear();
    // El aviso visual es opcional: si lf-ui.js no llegó a cargar, el camino de
    // recuperación debe seguir devolviendo null y nunca lanzar ReferenceError.
    const toastStub = global.window.toast;
    delete global.window.toast;
    let tarifa;
    try {
      tarifa = await global.window.LF.pvpc.crearTarifaPVPC(values);
    } finally {
      global.window.toast = toastStub;
    }
    expect(tarifa).toBeNull();
    expect(global.window.localStorage.setItem).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('crearTarifaPVPC aplica el régimen fiscal actual aunque el periodo PVPC cierre ayer', async () => {
    const apiP1 = 0.20;
    const apiP2 = 0.10;
    const apiP3 = 0.05;
    const mockJson = {
      ...pvpcIdentity(8741, 'Europe/Madrid'),
      days: {
        '2026-03-20': generateMockDayPrices(apiP1, apiP2, apiP3, '2026-03-20')
      },
      meta: { max_after_conversion: 0.20 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));

    const tarifa = await global.window.LF.pvpc.crearTarifaPVPC({
      zonaFiscal: 'Península',
      p1: 4,
      p2: 4,
      dias: 1,
      cPunta: 10,
      cLlano: 10,
      cValle: 10,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    expect(tarifa).toBeTruthy();
    expect(global.window.localStorage.getItem.mock.calls.some(([key]) => String(key).startsWith('pvpc_cache_v3:'))).toBe(true);
    expect(global.window.localStorage.getItem.mock.calls.some(([key]) => String(key).startsWith('pvpc_cache_v2:'))).toBe(false);
    expect(global.window.localStorage.setItem.mock.calls.some(([key]) => String(key).startsWith('pvpc_cache_v3:'))).toBe(true);
    expect(global.window.localStorage.setItem.mock.calls.some(([key]) => String(key).startsWith('pvpc_cache_v2:'))).toBe(false);
    expect(tarifa.metaPvpc.fechaYmd).toBe('2026-03-21');
    expect(tarifa.metaPvpc.usoFiscal).toBe('iva_general');

    const baseIEE = tarifa.metaPvpc.terminoFijo
      + tarifa.metaPvpc.costeMargenPot
      + tarifa.metaPvpc.terminoVariable
      + tarifa.metaPvpc.bonoSocial;
    const expectedIEE = Math.round(global.window.LF_CONFIG.calcularIEE(baseIEE, 30, '2026-03-21') * 100) / 100;

    expect(tarifa.metaPvpc.impuestoElectrico).toBe(expectedIEE);

    vi.useRealTimers();
  });

  it('crearTarifaPVPC aplica IVA general con 10 kW exactos y separa la caché por bono social', async () => {
    const mockJson = {
      ...pvpcIdentity(8741, 'Europe/Madrid'),
      days: {
        '2026-03-20': generateMockDayPrices(0.20, 0.10, 0.05, '2026-03-20')
      },
      meta: { max_after_conversion: 0.20 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));

    const baseInputs = {
      zonaFiscal: 'Península',
      p1: 10,
      p2: 10,
      dias: 1,
      cPunta: 10,
      cLlano: 10,
      cValle: 10
    };

    const severe = await global.window.LF.pvpc.crearTarifaPVPC({
      ...baseInputs,
      bonoSocialOn: true,
      bonoSocialTipo: 'severo',
      bonoSocialLimite: 1587
    });

    const noBonus = await global.window.LF.pvpc.crearTarifaPVPC({
      ...baseInputs,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable',
      bonoSocialLimite: 1587
    });

    expect(severe.metaPvpc.usoFiscal).toBe('iva_general');
    expect(noBonus.metaPvpc.usoFiscal).toBe('iva_general');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('obtenerPVPC_LOCAL cruza correctamente la hora 25 del cambio horario en modo CSV exacto', async () => {
    const mockJson = {
      ...pvpcIdentity(8741, 'Europe/Madrid'),
      days: {
        '2024-10-27': generateDstFallbackDayPrices()
      },
      meta: { max_after_conversion: 0.50 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date(2024, 9, 27), hora: 3, kwh: 1 },
      { fecha: new Date(2024, 9, 27), hora: 25, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 2,
      cLlano: 0,
      cValle: 0
    });

    expect(result).toBeTruthy();
    expect(result.terminoVariable).toBeCloseTo(0.70, 3);
    expect(result.pvpcCoverage.mode).toBe('exact');
    expect(result.pvpcCoverage.hoursWithoutPrice).toBe(0);
  });

  it('obtenerPVPC_LOCAL cruza el CCH-CONS 1-23 de marzo tras normalizarlo', async () => {
    const mockJson = {
      ...pvpcIdentity(8741, 'Europe/Madrid'),
      days: {
        '2026-03-29': generateDstSpringForwardDayPrices()
      },
      meta: { max_after_conversion: 0.50 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh'],
      ...Array.from({ length: 23 }, (_, i) => ['29/03/2026', String(i + 1), '1'])
    ];
    const parsed = global.window.LF.csvUtils.parseEnergyTableRows(rows, {
      headerRowIndex: 0,
      zonaFiscal: 'Península'
    });
    global.window.LF.consumosHorarios = parsed.records;
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 0,
      cValle: 23
    });

    expect(result).toBeTruthy();
    expect(result.terminoVariable).toBeCloseTo(2.70, 3);
    expect(result.pvpcCoverage.mode).toBe('exact');
    expect(result.pvpcCoverage.hoursWithoutPrice).toBe(0);
  });

  it('obtenerPVPC_LOCAL separa la hora 1 repetida de Canarias en octubre', async () => {
    const mockJson = {
      ...pvpcIdentity(8742, 'Atlantic/Canary'),
      days: {
        '2024-10-27': generateCanaryDstFallbackDayPrices()
      },
      meta: { max_after_conversion: 0.50 }
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockJson
    });

    const rows = [
      ['Fecha', 'Hora', 'Consumo_kWh', 'INV_VER'],
      ['27/10/2024', '0', '0', '1'],
      ['27/10/2024', '1', '1', '1'],
      ['27/10/2024', '1', '1', '0']
    ];
    const parsed = global.window.LF.csvUtils.parseEnergyTableRows(rows, {
      headerRowIndex: 0,
      zonaFiscal: 'Canarias'
    });
    global.window.LF.consumosHorarios = parsed.records;
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Canarias',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 0,
      cValle: 2
    });

    expect(parsed.records.map(record => record.hora)).toEqual([1, 2, 25]);
    expect(result).toBeTruthy();
    expect(result.terminoVariable).toBeCloseTo(0.70, 3);
    expect(result.pvpcCoverage.mode).toBe('exact');
    expect(result.pvpcCoverage.hoursWithoutPrice).toBe(0);
  });

  it('obtenerPVPC_LOCAL no acepta modo CSV exacto si faltan precios horarios', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: {
          '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05)
        }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date('2025-01-07T00:00:00'), hora: 11, kwh: 1 },
      { fecha: new Date('2025-01-08T00:00:00'), hora: 11, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 2,
      cPunta: 2,
      cLlano: 0,
      cValle: 0,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    const variable = result.resultadoPVPC.find(row => row.cabecera === 'Término variable');
    expect(result.terminoVariable).toBeCloseTo(0.40, 3);
    expect(variable.explicacion).not.toContain('cálculo exacto hora a hora');
    expect(variable.explicacion).toContain('1 de 2 horas con consumo');
    expect(variable.explicacion).toContain('supera el umbral máximo del 10%');
    expect(result.pvpcCoverage.mode).toBe('average');
  });

  it('obtenerPVPC_LOCAL documenta como fallback un CSV exacto con hora 0', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: {
          '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05)
        }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date('2025-01-07T00:00:00'), hora: 0, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 0,
      cValle: 1,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    const variable = result.resultadoPVPC.find(row => row.cabecera === 'Término variable');
    expect(result.terminoVariable).toBeCloseTo(0.05, 3);
    expect(variable.explicacion).not.toContain('cálculo exacto hora a hora');
    expect(variable.explicacion).toContain('1 de 1 horas con consumo');
    expect(result.pvpcCoverage.mode).toBe('average');
    expect(result.pvpcCoverage.fallbackReason).toContain('media P1/P2/P3 válida');
  });

  it('obtenerPVPC_LOCAL falla cerrado si el fallback no tiene media del periodo consumido', async () => {
    const pricesSinP3 = generateMockDayPrices(0.20, 0.10, 0.05).slice(8);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2025-01-07': pricesSinP3 }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date(2025, 0, 7), hora: 1, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 0,
      cValle: 1,
      bonoSocialOn: false,
      bonoSocialTipo: 'vulnerable'
    });

    expect(result).toBeNull();
    expect(global.window.toast).toHaveBeenCalledWith(
      'PVPC: No se pudieron cargar los datos de precios. Compara con tarifas comerciales.',
      'err'
    );
  });

  it('obtenerPVPC_LOCAL combina precios exactos y medias con un 10% residual de horas y kWh', async () => {
    const prices = generateMockDayPrices(0.20, 0.10, 0.05);
    prices[0][1] = 0.50;
    prices.splice(1, 1); // Falta la hora CNMC 2 (01:00 local)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 2,
      cValle: 8
    });

    const expectedP3Mean = (0.50 + (6 * 0.05)) / 7;
    const expectedHybridCost = 0.50 + (6 * 0.05) + expectedP3Mean + (2 * 0.10);
    const variable = result.resultadoPVPC.find(row => row.cabecera === 'Término variable');

    expect(result.terminoVariable).toBeCloseTo(expectedHybridCost, 8);
    expect(result.pvpcCoverage).toMatchObject({
      mode: 'hybrid',
      hoursWithPrice: 9,
      hoursWithoutPrice: 1,
      kwhWithPrice: 9,
      kwhWithoutPrice: 1,
      missingHoursShare: 0.1,
      missingKwhShare: 0.1,
      hasMissingPrices: true
    });
    expect(variable.explicacion).toContain('cálculo horario con cobertura parcial');
    expect(variable.explicacion).toContain('9 de 10 horas con consumo');
    expect(variable.explicacion).not.toContain('cálculo exacto hora a hora');
    const expectedIeeBase = result.terminoFijo
      + result.costeMargenPot
      + result.terminoVariable
      + result.bonoSocial;
    const expectedIee = Math.round(global.window.LF_CONFIG.calcularIEE(
      expectedIeeBase,
      10,
      global.window.LF_CONFIG.getTodayYmd()
    ) * 100) / 100;
    expect(result.impuestoElectrico).toBe(expectedIee);
  });

  it('obtenerPVPC_LOCAL rechaza el híbrido si solo el peso de kWh supera el 10%', async () => {
    const prices = generateMockDayPrices(0.20, 0.10, 0.05);
    prices.splice(1, 1);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i + 1,
      kwh: i === 1 ? 2 : 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 0,
      cLlano: 2,
      cValle: 9
    });

    expect(result.pvpcCoverage.mode).toBe('average');
    expect(result.pvpcCoverage.missingHoursShare).toBe(0.1);
    expect(result.pvpcCoverage.missingKwhShare).toBeCloseTo(2 / 11, 8);
    expect(result.pvpcCoverage.fallbackReason).toContain('supera el umbral');
  });

  it('obtenerPVPC_LOCAL usa el periodo canónico desplazado de Ceuta/Melilla al estimar un hueco', async () => {
    const prices = generateMockDayPrices(0.30, 0.10, 0.05);
    prices.splice(11, 1); // Hora CNMC 12: P1 en Ceuta/Melilla (inicio 11:00)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8744, 'Europe/Madrid'),
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i === 9 ? 12 : i + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'CeutaMelilla',
      p1: 3.45,
      p2: 3.45,
      dias: 1,
      cPunta: 1,
      cLlano: 1,
      cValle: 8
    });

    const exactKnownCost = (8 * 0.05) + 0.10;
    expect(result.terminoVariable).toBeCloseTo(exactKnownCost + result.precioPunta, 8);
    expect(result.terminoVariable).not.toBeCloseTo(exactKnownCost + result.precioLlano, 8);
    expect(result.pvpcCoverage.mode).toBe('hybrid');
  });

  it('obtenerPVPC_LOCAL ignora horas sin precio cuando su consumo es cero', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05) }
      })
    });

    global.window.LF.consumosHorarios = [
      { fecha: new Date(2025, 0, 7), hora: 11, kwh: 1 },
      { fecha: new Date(2025, 0, 8), hora: 11, kwh: 0 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 2,
      cPunta: 1,
      cLlano: 0,
      cValle: 0
    });

    expect(result.pvpcCoverage).toMatchObject({
      mode: 'exact',
      hoursWithPrice: 1,
      hoursWithoutPrice: 0,
      kwhWithPrice: 1,
      kwhWithoutPrice: 0
    });
  });

  it('obtenerPVPC_LOCAL no usa híbrido residual si falta un mes completo con consumo', async () => {
    const januaryPrices = generateMockDayPrices(0.20, 0.10, 0.05);
    global.fetch.mockImplementation((url) => Promise.resolve(
      String(url).includes('2025-01')
        ? {
            ok: true,
            json: async () => ({
              ...pvpcIdentity(8741, 'Europe/Madrid'),
              days: { '2025-01-31': januaryPrices }
            })
          }
        : { ok: false }
    ));

    global.window.LF.consumosHorarios = [
      ...Array.from({ length: 9 }, (_, i) => ({
        fecha: new Date(2025, 0, 31),
        hora: i + 1,
        kwh: 1
      })),
      { fecha: new Date(2025, 1, 1), hora: 1, kwh: 1 }
    ];
    global.window.LF.pvpcPeriodoCSV = true;

    const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
      zonaFiscal: 'Península',
      p1: 3.45,
      p2: 3.45,
      dias: 2,
      cPunta: 0,
      cLlano: 1,
      cValle: 9
    });

    expect(result.pvpcCoverage.mode).toBe('average');
    expect(result.pvpcCoverage.missingMonths).toEqual(['2025-02']);
    expect(result.pvpcCoverage.fallbackReason).toContain('mes completo');
  });

  it('crearTarifaPVPC no persiste resultados con cobertura horaria parcial', async () => {
    const prices = generateMockDayPrices(0.20, 0.10, 0.05);
    prices.splice(1, 1);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: { '2025-01-07': prices }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 10 }, (_, i) => ({
      fecha: new Date(2025, 0, 7),
      hora: i + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    const tarifa = await global.window.LF.pvpc.crearTarifaPVPC({
      zonaFiscal: 'Península',
      p1: 6.123,
      p2: 6.123,
      dias: 1,
      cPunta: 0,
      cLlano: 2,
      cValle: 8
    });

    expect(tarifa).toBeTruthy();
    expect(global.window.pvpcLastMeta.pvpcCoverage.mode).toBe('hybrid');
    expect(global.window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('obtenerPVPC_LOCAL cede el hilo durante el cruce CSV exacto largo', async () => {
    const yieldControl = vi.fn(() => Promise.resolve());
    global.window.LF.yieldControl = yieldControl;

    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 20;
      return now;
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...pvpcIdentity(8741, 'Europe/Madrid'),
        days: {
          '2025-01-07': generateMockDayPrices(0.20, 0.10, 0.05)
        }
      })
    });

    global.window.LF.consumosHorarios = Array.from({ length: 512 }, (_, i) => ({
      fecha: new Date('2025-01-07T00:00:00'),
      hora: (i % 24) + 1,
      kwh: 1
    }));
    global.window.LF.pvpcPeriodoCSV = true;

    try {
      const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
        zonaFiscal: 'Península',
        p1: 3.45,
        p2: 3.45,
        dias: 1,
        cPunta: 512,
        cLlano: 0,
        cValle: 0,
        bonoSocialOn: false,
        bonoSocialTipo: 'vulnerable'
      });

      expect(result).toBeTruthy();
      expect(yieldControl).toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  // Frontera temporal del periodo PVPC estandar (bug confirmado 13/08/2026, ver
  // AUDITORIA-IA.md "Frontera Temporal Del Periodo PVPC Estandar"). El periodo debe
  // decidirse con el dia civil de la ZONA ELECTRICA seleccionada, nunca con la del
  // host/navegador. `getClosedPvpcPeriodYmd`/`getPvpcAnchorDate` son funciones PURAS:
  // toman `now`+`timeZone` explicitos y no leen Date.getFullYear/getMonth/getDate del
  // host en ningun punto, asi que estos tests no dependen de la TZ del runner.
  describe('Frontera temporal del periodo PVPC estandar (zona electrica, no del host)', () => {
    function generateFlatDayPrices(ymd, timeZone, price) {
      const baseTs = localMidnightEpoch(ymd, timeZone);
      const nextTs = localMidnightEpoch(addCalendarDay(ymd), timeZone);
      const prices = [];
      for (let ts = baseTs; ts < nextTs; ts += 3600) prices.push([ts, price]);
      return prices;
    }

    it('1) Canarias: dias=1 y dias=7 en la franja divergente con Madrid', () => {
      const now = new Date('2026-08-13T22:30:00Z');
      // A las 22:30Z, Canarias (WEST, UTC+1 en agosto) va por 2026-08-13 23:30: el
      // dia en curso es el 13, el ultimo CERRADO es el 12.
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Atlantic/Canary', 1, now))
        .toEqual({ startStr: '2026-08-12', endStr: '2026-08-12' });
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Atlantic/Canary', 7, now))
        .toEqual({ startStr: '2026-08-06', endStr: '2026-08-12' });
    });

    it('2) Peninsula en el MISMO instante: Madrid ya esta en el dia siguiente', () => {
      const now = new Date('2026-08-13T22:30:00Z');
      // A las 22:30Z, Madrid (CEST, UTC+2 en agosto) va por 2026-08-14 00:30: el dia
      // ya cerrado es el 13, no el 12 (frontera exactamente opuesta a Canarias).
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 1, now))
        .toEqual({ startStr: '2026-08-13', endStr: '2026-08-13' });
    });

    it('3) el resultado depende solo de (now, timeZone): tres zonas, un mismo instante', () => {
      // `now` se construye con formato ISO + "Z" (instante UTC inequivoco): la timezone
      // del proceso que ejecuta el test es irrelevante para construirlo. La UNICA
      // variable entre las tres llamadas es el parametro `timeZone` explicito.
      const now = new Date('2026-08-13T22:30:00Z');
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Atlantic/Canary', 1, now).endStr)
        .toBe('2026-08-12');
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 1, now).endStr)
        .toBe('2026-08-13');
      // Tercera zona sin relacion con Espana, para descartar cualquier caso especial
      // Madrid/Canarias oculto en la implementacion.
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Asia/Tokyo', 1, now).endStr)
        .toBe('2026-08-13');
    });

    it('4) fin de mes: "ayer" cruza correctamente de septiembre a agosto', () => {
      const now = new Date('2026-09-01T10:00:00Z'); // Madrid CEST: local 2026-09-01 12:00
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 1, now))
        .toEqual({ startStr: '2026-08-31', endStr: '2026-08-31' });
      // dias>1 sigue funcionando sin errores tras cruzar el mes.
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 5, now))
        .toEqual({ startStr: '2026-08-27', endStr: '2026-08-31' });
    });

    it('5) cambio de año: "ayer" cruza correctamente de enero a diciembre', () => {
      const now = new Date('2027-01-01T10:00:00Z'); // Madrid CET: local 2027-01-01 11:00
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 1, now))
        .toEqual({ startStr: '2026-12-31', endStr: '2026-12-31' });
    });

    it('6) DST primavera: "ayer" es el dia de 23 horas, restado como UN dia civil', () => {
      // Cambio de hora en Europe/Madrid: 2026-03-29 (ultimo domingo de marzo, 02:00->03:00).
      const now = new Date('2026-03-30T09:00:00Z'); // Madrid CEST: local 2026-03-30 11:00
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 1, now))
        .toEqual({ startStr: '2026-03-29', endStr: '2026-03-29' });
      // dias=2 no debe duplicar ni saltarse el dia corto: un dia civil menos cada vez.
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 2, now))
        .toEqual({ startStr: '2026-03-28', endStr: '2026-03-29' });
    });

    it('7) DST otoño: "ayer" es el dia de 25 horas, restado como UN dia civil', () => {
      // Cambio de hora en Europe/Madrid: 2026-10-25 (ultimo domingo de octubre, 03:00->02:00).
      const now = new Date('2026-10-26T09:00:00Z'); // Madrid CET: local 2026-10-26 10:00
      expect(global.window.LF.pvpc.getClosedPvpcPeriodYmd('Europe/Madrid', 1, now))
        .toEqual({ startStr: '2026-10-25', endStr: '2026-10-25' });
    });

    it('8) anchor de cache Canarias: mismo dia civil que el periodo, no el del host', () => {
      const now = new Date('2026-08-13T22:30:00Z');
      expect(global.window.LF.pvpc.getPvpcAnchorDate('Canarias', now)).toBe('2026-08-12');
    });

    it('9) anchor de cache Peninsula: mismo instante, frontera civil distinta', () => {
      const now = new Date('2026-08-13T22:30:00Z');
      expect(global.window.LF.pvpc.getPvpcAnchorDate('Península', now)).toBe('2026-08-13');
    });

    // 10) Integracion monetaria: atraviesa obtenerPVPC_LOCAL de verdad, no solo el helper
    // puro. `vi.setSystemTime` fija el INSTANTE absoluto; la resolucion de zona usa
    // Intl.DateTimeFormat con timezone explicita (Atlantic/Canary), que no consulta la
    // TZ configurada en el proceso que ejecuta el test: por eso este test es reproducible
    // igual en cualquier maquina/CI, sin tocar TZ ni depender de donde se ejecute.
    it('10) obtenerPVPC_LOCAL usa el ultimo dia CERRADO de Canarias, no el dia en curso ya completo', async () => {
      vi.setSystemTime(new Date('2026-08-13T22:30:00Z'));

      try {
        // Ambos dias estan estructuralmente COMPLETOS (24 puntos, dia civil correcto de
        // Atlantic/Canary): el 13 pasaria validateClosedPvpcDay() igual que el 12, pero a
        // las 22:30Z en Canarias el 13 sigue EN CURSO. Precios deliberadamente distintos
        // para poder distinguir por cual dia calculo el motor.
        const dia12 = generateFlatDayPrices('2026-08-12', 'Atlantic/Canary', 0.10);
        const dia13 = generateFlatDayPrices('2026-08-13', 'Atlantic/Canary', 0.30);

        global.fetch.mockImplementation((url) => {
          const u = String(url);
          if (u.includes('/data/pvpc/8742/2026-08.json')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                ...pvpcIdentity(8742, 'Atlantic/Canary'),
                days: { '2026-08-12': dia12, '2026-08-13': dia13 }
              })
            });
          }
          throw new Error(`URL inesperada en el test de frontera temporal: ${u}`);
        });

        const result = await global.window.LF.pvpc.obtenerPVPC_LOCAL({
          zonaFiscal: 'Canarias',
          p1: 4.6, p2: 4.6, dias: 1,
          cPunta: 100, cLlano: 100, cValle: 100
        });

        expect(result).toBeTruthy();
        // Con el codigo VIEJO esto daria 0,30 (dia 13, seleccionado con la TZ del host);
        // con el codigo CORREGIDO debe dar 0,10 (dia 12, ultimo cerrado de Canarias).
        expect(result.precioPunta).toBeCloseTo(0.10, 6);
        expect(result.precioLlano).toBeCloseTo(0.10, 6);
        expect(result.precioValle).toBeCloseTo(0.10, 6);
      } finally {
        // En un finally: si una asercion o el motor fallan antes de llegar aqui, los
        // fake timers no deben quedar activos contaminando el resto del fichero.
        vi.useRealTimers();
      }
    });
  });

});
