window.BVSim = window.BVSim || {};

// ===== UTILIDADES DE FECHA =====
function calcularViernesSanto(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  const pascua = new Date(year, month - 1, day);
  const viernesSanto = new Date(pascua);
  viernesSanto.setDate(pascua.getDate() - 2);

  const mStr = String(viernesSanto.getMonth() + 1).padStart(2, '0');
  const dStr = String(viernesSanto.getDate()).padStart(2, '0');
  return `${year}-${mStr}-${dStr}`;
}

const _festivosCache = new Map();

function getFestivosNacionales(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return new Set();
  if (_festivosCache.has(y)) return _festivosCache.get(y);

  const festivos = [
    `${y}-01-01`, `${y}-01-06`,
    calcularViernesSanto(y),
    `${y}-05-01`, `${y}-08-15`, `${y}-10-12`,
    `${y}-11-01`, `${y}-12-06`, `${y}-12-08`, `${y}-12-25`
  ];

  const set = new Set(festivos);
  _festivosCache.set(y, set);
  return set;
}

function getPeriodoHorarioCSV(fecha, hora) {
  const diaSemana = fecha.getDay();
  const esFinde = diaSemana === 0 || diaSemana === 6;

  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  const fechaStr = `${year}-${month}-${day}`;

  const festivosNacionales = getFestivosNacionales(year);
  const esFestivo = festivosNacionales.has(fechaStr);

  if (esFinde || esFestivo) return 'P3';

  const horaInicio = hora - 1;
  if (horaInicio >= 0 && horaInicio < 8) return 'P3';
  if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) return 'P1';
  return 'P2';
}

// ===== AGRUPACIÓN MENSUAL (BUCKETS) =====
window.BVSim.bucketizeByMonth = function (records) {
  const monthsMap = new Map();

  (records || []).forEach((record) => {
    if (!record || !record.fecha) return;

    const fecha = record.fecha instanceof Date ? record.fecha : new Date(record.fecha);
    if (isNaN(fecha.getTime())) return;

    const year = fecha.getFullYear();
    const monthIndex = fecha.getMonth() + 1;
    const month = String(monthIndex).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    const key = `${year}-${month}`;

    if (!monthsMap.has(key)) {
      const daysInMonth = new Date(year, monthIndex, 0).getDate();
      monthsMap.set(key, {
        key,
        start: null,
        end: null,
        daysWithData: 0,
        daysInMonth,
        coveragePct: 0,
        importByPeriod: { P1: 0, P2: 0, P3: 0 },
        importTotalKWh: 0,
        exportTotalKWh: 0,
        _daysSet: new Set(),
        _minStamp: null,
        _maxStamp: null,
        _minDateStr: null,
        _maxDateStr: null
      });
    }

    const bucket = monthsMap.get(key);
    const dateKey = `${key}-${day}`;
    const dateStamp = new Date(year, monthIndex - 1, Number(day)).getTime();
    bucket._daysSet.add(dateKey);

    if (bucket._minStamp === null || dateStamp < bucket._minStamp) {
      bucket._minStamp = dateStamp;
      bucket._minDateStr = dateKey;
    }

    if (bucket._maxStamp === null || dateStamp > bucket._maxStamp) {
      bucket._maxStamp = dateStamp;
      bucket._maxDateStr = dateKey;
    }

    const importKwh = Number(record.kwh);
    const exportKwh = Number(record.excedente);

    if (Number.isFinite(importKwh)) {
      bucket.importTotalKWh += importKwh;
      const hora = Number(record.hora);
      const periodo = record.periodo || (Number.isFinite(hora) ? getPeriodoHorarioCSV(fecha, hora) : null);
      if (periodo && bucket.importByPeriod[periodo] !== undefined) {
        bucket.importByPeriod[periodo] += importKwh;
      }
    }

    if (Number.isFinite(exportKwh)) {
      bucket.exportTotalKWh += exportKwh;
    }
  });

  const months = Array.from(monthsMap.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((month) => {
      const daysWithData = month._daysSet.size;
      const coveragePct = month.daysInMonth > 0
        ? Math.round((daysWithData / month.daysInMonth) * 1000) / 10
        : 0;

      const spanDays = month._minStamp !== null && month._maxStamp !== null
        ? Math.round((month._maxStamp - month._minStamp) / 86400000) + 1
        : 0;

      return {
        key: month.key,
        start: month._minDateStr,
        end: month._maxDateStr,
        spanDays,
        daysWithData,
        daysInMonth: month.daysInMonth,
        coveragePct,
        importByPeriod: month.importByPeriod,
        importTotalKWh: month.importTotalKWh,
        exportTotalKWh: month.exportTotalKWh
      };
    });

  return months;
};

// Solo devuelve los meses agrupados, la simulación económica va aparte
window.BVSim.simulateMonthly = function (importResult, potenciaP1, potenciaP2) {
  const months = window.BVSim.bucketizeByMonth(importResult.records);
  return { ok: true, months };
};

// ===== UTILIDADES MATEMÁTICAS =====
window.BVSim.round2 = function (n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
};

// ===== SIMULACIÓN ECONÓMICA (MES INDIVIDUAL) =====
window.BVSim.calcMonthForTarifa = function ({
  month,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoPrev,
  zonaFiscal = 'Península',
  esVivienda = true
}) {
  const round2 = window.BVSim.round2;
  // Importante: para evitar inflar costes si el CSV tiene huecos, usamos SOLO los días con datos.
  const dias = Number(month?.daysWithData) || 0;
  
  // Potencia
  const pot = round2((potenciaP1 * dias * tarifa.p1) + (potenciaP2 * dias * tarifa.p2));
  
  // Consumo (Energía)
  const consEur = round2(
    (month.importByPeriod.P1 * tarifa.cPunta)
    + (month.importByPeriod.P2 * tarifa.cLlano)
    + (month.importByPeriod.P3 * tarifa.cValle)
  );
  
  // Bono social (Financiación)
  const bonoSocialAnual = (window.LF_CONFIG && window.LF_CONFIG.bonoSocial) 
    ? window.LF_CONFIG.bonoSocial.eurosAnuales 
    : 6.979247; 
  
  const costeBonoSocial = round2(bonoSocialAnual / 365 * dias);
  
  // Excedentes
  const exKwh = Number(month.exportTotalKWh) || 0;
  let precioExc = Number(tarifa.fv.exc);
  
  // Si es indexada y no tiene precio fijo, estimamos 0.06 (media pool excedentes)
  if (precioExc <= 0 && tarifa.tipo === 'INDEXADA') {
    precioExc = 0.06;
  }
  
  const creditoPotencial = round2(exKwh * precioExc);
  
  // Compensación (límite: coste energía)
  const credit1 = round2(Math.min(creditoPotencial, consEur));
  const consAdj = round2(Math.max(0, consEur - credit1));
  const excedenteSobranteEur = round2(Math.max(0, creditoPotencial - credit1));
  
  // Impuestos
  const sumaBaseIEE = round2(pot + consAdj);
  
  let impuestoElec = 0;
  if (window.LF_CONFIG && window.LF_CONFIG.calcularIEE) {
    impuestoElec = round2(window.LF_CONFIG.calcularIEE(sumaBaseIEE, month.importTotalKWh, zonaFiscal));
  } else {
    const tasaIEE = zonaFiscal === 'Península' ? 0.0511269632 : 0.01; 
    impuestoElec = round2(Math.max(tasaIEE * sumaBaseIEE, month.importTotalKWh * 0.0005)); 
  }

  // Alquiler
  let alquilerContador = 0;
  if (window.LF_CONFIG && window.LF_CONFIG.calcularAlquilerContador) {
    alquilerContador = round2(window.LF_CONFIG.calcularAlquilerContador(dias));
  } else {
    alquilerContador = round2(dias * 0.81 * 12 / 365);
  }

  // IVA / IGIC / IPSI
  let tasaIVA = 0.21;
  if (zonaFiscal === 'Canarias') {
    tasaIVA = esVivienda ? 0.00 : 0.03; 
  } else if (zonaFiscal === 'CeutaMelilla') {
    tasaIVA = 0.01;
  }

  const ivaBase = round2(pot + consAdj + costeBonoSocial + impuestoElec + alquilerContador);
  const ivaCuota = round2(ivaBase * tasaIVA);
  const totalBase = round2(ivaBase + ivaCuota);

  // Batería Virtual (Hucha)
  // Importante: si la tarifa NO tiene BV, no debe aplicarse saldo previo ni acumular sobrantes.
  const hasBV = Boolean(tarifa?.fv?.bv);
  const bvPrev = hasBV ? Math.max(0, Number(bvSaldoPrev) || 0) : 0;
  const credit2 = hasBV ? round2(Math.min(bvPrev, totalBase)) : 0;
  const bvSaldoFin = hasBV
    ? round2(excedenteSobranteEur + Math.max(0, bvPrev - credit2))
    : 0;
  const totalPagar = hasBV ? round2(Math.max(0, totalBase - credit2)) : totalBase;

  // Coste Real (si no tuvieras hucha anterior)
  const totalReal = round2(Math.max(0, totalBase - (hasBV ? excedenteSobranteEur : 0)));

  return {
    key: month.key,
    dias,
    pot,
    consEur,
    costeBonoSocial,
    impuestoElec,
    alquilerContador,
    ivaCuota,
    totalBase,
    exKwh,
    precioExc,
    credit1,
    excedenteSobranteEur,
    hasBV,
    bvSaldoPrev: bvPrev,
    credit2,
    bvSaldoFin,
    totalPagar,
    totalReal
  };
};

// ===== SIMULACIÓN BUCLE (TODA LA TARIFA) =====
window.BVSim.simulateForTarifaDemo = function ({
  months,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial = 0,
  zonaFiscal = 'Península',
  esVivienda = true
}) {
  if (!Array.isArray(months) || !tarifa) {
    return { ok: false, error: 'Parámetros inválidos.' };
  }

  let bvSaldo = Number(bvSaldoInicial) || 0;
  const rows = months.map((month) => {
    const row = window.BVSim.calcMonthForTarifa({
      month,
      tarifa,
      potenciaP1,
      potenciaP2,
      bvSaldoPrev: bvSaldo,
      zonaFiscal,
      esVivienda
    });
    bvSaldo = row.bvSaldoFin;
    return row;
  });

  const totals = rows.reduce((acc, row) => ({
    pagado: acc.pagado + row.totalPagar,
    real: acc.real + row.totalReal,
    credit1Total: acc.credit1Total + row.credit1,
    credit2Total: acc.credit2Total + row.credit2
  }), {
    pagado: 0,
    real: 0,
    credit1Total: 0,
    credit2Total: 0
  });

  return {
    ok: true,
    tarifa,
    rows,
    totals: {
      pagado: window.BVSim.round2(totals.pagado),
      real: window.BVSim.round2(totals.real),
      bvFinal: window.BVSim.round2(bvSaldo),
      credit1Total: window.BVSim.round2(totals.credit1Total),
      credit2Total: window.BVSim.round2(totals.credit2Total)
    }
  };
};

// ===== SIMULACIÓN MASIVA (TODAS LAS TARIFAS) =====
window.BVSim.simulateForAllTarifasBV = function ({
  months,
  tarifasBV,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial = 0,
  zonaFiscal = 'Península',
  esVivienda = true
}) {
  try {
    const results = tarifasBV.map((tarifa) => {
      return window.BVSim.simulateForTarifaDemo({
        months,
        tarifa,
        potenciaP1,
        potenciaP2,
        bvSaldoInicial,
        zonaFiscal,
        esVivienda
      });
    });

    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error?.message || 'Error en simulación masiva.' };
  }
};

// ===== CARGAR TARIFAS =====
window.BVSim.loadTarifasBV = async function () {
  try {
    const response = await fetch('tarifas.json');
    if (!response.ok) {
      return { ok: false, error: `Error al cargar tarifas.json (${response.status}).` };
    }

    const data = await response.json();
    const tarifas = Array.isArray(data?.tarifas) ? data.tarifas : [];

    // Solo tarifas que remuneren excedentes a precio fijo (exc > 0) y NO sean indexadas.
    // (El usuario quiere excluir excedentes a precio indexado.)
    const tarifasBV = tarifas.filter((tarifa) => {
      if (!tarifa || !tarifa.fv) return false;
      const exc = Number(tarifa.fv.exc);
      if (!Number.isFinite(exc) || exc <= 0) return false;
      const tipoTarifa = String(tarifa.tipo || '').toUpperCase();
      const tipoFV = String(tarifa.fv.tipo || '').toUpperCase();
      const isIndexada = tipoTarifa === 'INDEXADA' || tipoFV.includes('INDEX');
      return !isIndexada;
    });

    if (tarifasBV.length === 0) {
      return {
        ok: false,
        error: 'No hay tarifas con batería virtual disponibles actualmente. El simulador solo muestra tarifas con precio fijo de excedentes (no indexadas).'
      };
    }

    return { ok: true, tarifasBV };
  } catch (error) {
    return { ok: false, error: error?.message || 'Error al cargar tarifas BV.' };
  }
};