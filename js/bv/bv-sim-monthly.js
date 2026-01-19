window.BVSim = window.BVSim || {};

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

  const mes = String(viernesSanto.getMonth() + 1).padStart(2, '0');
  const dia = String(viernesSanto.getDate()).padStart(2, '0');
  return `${year}-${mes}-${dia}`;
}

function getFestivosNacionales(year) {
  return [
    `${year}-01-01`, `${year}-01-06`,
    calcularViernesSanto(year),
    `${year}-05-01`, `${year}-08-15`, `${year}-10-12`,
    `${year}-11-01`, `${year}-12-06`, `${year}-12-08`, `${year}-12-25`
  ];
}

function getPeriodoHorarioCSV(fecha, hora) {
  const diaSemana = fecha.getDay();
  const esFinde = diaSemana === 0 || diaSemana === 6;

  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  const fechaStr = `${year}-${month}-${day}`;

  const festivosNacionales = getFestivosNacionales(year);
  const esFestivo = festivosNacionales.includes(fechaStr);

  if (esFinde || esFestivo) return 'P3';

  const horaInicio = hora - 1;
  if (horaInicio >= 0 && horaInicio < 8) return 'P3';
  if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) return 'P1';
  return 'P2';
}

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

window.BVSim.simulateMonthly = function (importResult, potenciaP1, potenciaP2) {
  const months = window.BVSim.bucketizeByMonth(importResult.records);
  return { ok: true, months };
};

window.BVSim.round2 = function (value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

window.BVSim.calcMonthForTarifa = function ({
  month,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoPrev
}) {
  const round2 = window.BVSim.round2;
  const dias = Number(month?.spanDays) || Number(month?.daysWithData) || 0;
  const pot = round2((potenciaP1 * dias * tarifa.p1) + (potenciaP2 * dias * tarifa.p2));
  const consEur = round2(
    (month.importByPeriod.P1 * tarifa.cPunta)
    + (month.importByPeriod.P2 * tarifa.cLlano)
    + (month.importByPeriod.P3 * tarifa.cValle)
  );
  const tarifaAcceso = round2(LF_CONFIG.calcularBonoSocial(dias));
  const exKwh = Number(month.exportTotalKWh) || 0;
  const precioExc = Number(tarifa.fv.exc);
  const creditoPotencial = round2(exKwh * precioExc);
  const credit1 = round2(Math.min(creditoPotencial, consEur));
  const consAdj = round2(Math.max(0, consEur - credit1));
  const excedenteSobranteEur = round2(Math.max(0, creditoPotencial - credit1));
  const sumaBase = round2(pot + consAdj + tarifaAcceso);
  const impuestoElec = round2(LF_CONFIG.calcularIEE(sumaBase, month.importTotalKWh));
  const alquilerContador = round2(LF_CONFIG.calcularAlquilerContador(dias));
  const ivaBase = round2(pot + consAdj + tarifaAcceso + impuestoElec + alquilerContador);
  const ivaCuota = round2(ivaBase * LF_CONFIG.territorios.peninsula.impuestos.energia);
  const totalBase = round2(ivaBase + ivaCuota);

  const credit2 = round2(Math.min(Math.max(0, bvSaldoPrev), totalBase));
  const bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bvSaldoPrev - credit2));
  const totalPagar = round2(Math.max(0, totalBase - credit2));

  const totalReal = round2(Math.max(0, totalBase - excedenteSobranteEur));

  return {
    key: month.key,
    dias,
    pot,
    consEur,
    tarifaAcceso,
    impuestoElec,
    alquilerContador,
    ivaCuota,
    totalBase,
    exKwh,
    precioExc,
    credit1,
    excedenteSobranteEur,
    bvSaldoPrev,
    credit2,
    bvSaldoFin,
    totalPagar,
    totalReal
  };
};

window.BVSim.simulateForTarifaDemo = function ({
  months,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial = 0
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
      bvSaldoPrev: bvSaldo
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

window.BVSim.simulateForAllTarifasBV = function ({
  months,
  tarifasBV,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial = 0
}) {
  if (!Array.isArray(months) || !Array.isArray(tarifasBV)) {
    return { ok: false, error: 'Parámetros inválidos.' };
  }

  const results = [];

  for (const tarifa of tarifasBV) {
    const result = window.BVSim.simulateForTarifaDemo({
      months,
      tarifa,
      potenciaP1,
      potenciaP2,
      bvSaldoInicial
    });

    if (!result || !result.ok) {
      return {
        ok: false,
        error: result?.error || `Error al simular tarifa ${tarifa?.nombre || 'desconocida'}.`
      };
    }

    results.push({
      tarifa: result.tarifa,
      rows: result.rows,
      totals: result.totals
    });
  }

  return { ok: true, results };
};

window.BVSim.simulateForAllTarifasBV = function ({
  months,
  tarifasBV,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial = 0
}) {
  try {
    const results = tarifasBV.map((tarifa) => {
      return window.BVSim.simulateForTarifaDemo({
        months,
        tarifa,
        potenciaP1,
        potenciaP2,
        bvSaldoInicial
      });
    });

    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error?.message || 'Error en simulación masiva.' };
  }
};

window.BVSim.round2 = function (n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

window.BVSim.loadTarifasBV = async function () { try { const response = await fetch('tarifas.json'); if (!response.ok) return { ok: false, error: 'Error al cargar tarifas.json' }; const data = await response.json(); const tarifas = Array.isArray(data?.tarifas) ? data.tarifas : []; const tarifasBV = tarifas.filter(t => t?.fv?.bv === true); return { ok: true, tarifasBV }; } catch (e) { return { ok: false, error: e.message }; } };
