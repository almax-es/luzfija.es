/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

window.BVSim = window.BVSim || {};

// ===== UTILIDADES DE FECHA =====
// IMPORTANTE: Usar siempre las funciones canónicas de lf-csv-utils.js
// para garantizar consistencia en el cálculo de periodos horarios entre
// el comparador principal y el simulador BV.
//
// Las funciones duplicadas se han eliminado para evitar divergencias,
// especialmente en el manejo de la hora 25 (cambio horario de octubre).

/**
 * Obtiene el periodo horario usando la implementación canónica de csv-utils.
 * Si window.LF.csvUtils no está disponible, falla con error claro.
 * @param {Date} fecha - Fecha a evaluar
 * @param {number} hora - Hora CNMC (1-24, donde 25 = cambio horario octubre)
 * @param {string} zona - Zona geográfica ('peninsula'|'ceutaMelilla'). Default: 'peninsula'
 * @returns {string} 'P1', 'P2' o 'P3'
 */
function getPeriodoHorarioCSV(fecha, hora, zona = 'peninsula') {
  // Verificar que las utilidades canónicas están disponibles
  if (!window.LF || !window.LF.csvUtils || typeof window.LF.csvUtils.getPeriodoHorarioCSV !== 'function') {
    const errorMsg =
      '❌ BVSim ERROR CRÍTICO: No se pudo acceder a window.LF.csvUtils.getPeriodoHorarioCSV.\n' +
      '📋 Solución: Asegúrate de que lf-csv-utils.js está cargado ANTES que bv-sim-monthly.js en el HTML.\n' +
      '🔍 Debug info:\n' +
      `  - window.LF existe: ${!!window.LF}\n` +
      `  - window.LF.csvUtils existe: ${!!(window.LF && window.LF.csvUtils)}\n` +
      `  - getPeriodoHorarioCSV existe: ${!!(window.LF && window.LF.csvUtils && window.LF.csvUtils.getPeriodoHorarioCSV)}`;

    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Delegar al cálculo canónico (que maneja correctamente hora 25 y zonas CNMC)
  return window.LF.csvUtils.getPeriodoHorarioCSV(fecha, hora, zona);
}

// Verificación temprana al cargar el módulo (advertencia en consola)
if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (!window.LF || !window.LF.csvUtils || !window.LF.csvUtils.getPeriodoHorarioCSV) {
      console.warn(
        '⚠️ BVSim: window.LF.csvUtils no está disponible.\n' +
        'Si usas el simulador BV, asegúrate de cargar lf-csv-utils.js primero.'
      );
    }
  }, 0);
}

// ===== AGRUPACIÓN MENSUAL (BUCKETS) =====
/**
 * Agrupa registros de consumo por mes y período tarifario (P1/P2/P3).
 *
 * @param {Array} records - Records con {fecha, hora, kwh, excedente, periodo}
 * @param {string} zona - Zona CNMC ('peninsula'|'ceutaMelilla'). Default: 'peninsula'
 * @returns {Array} Meses agrupados con kWh por período
 */
window.BVSim.bucketizeByMonth = function (records, zona = 'peninsula') {
  const monthsMap = new Map();
  const round2 = typeof window.BVSim.round2 === 'function'
    ? window.BVSim.round2
    : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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

      // Determinar periodo: en Ceuta/Melilla SIEMPRE recalcular por zona (CNMC)
      // porque CSV puede traer periodos calculados con horario Península
      const zonaNorm = (zona || '').toString().toLowerCase().replace(/[^a-z]/g, '');
      // Detección robusta: cualquier variante que contenga "ceuta" Y "melilla"
      const esCeutaMelilla = zonaNorm.includes('ceuta') && zonaNorm.includes('melilla');

      let periodo = null;
      if (esCeutaMelilla && Number.isFinite(hora)) {
        // Ceuta/Melilla: ignorar record.periodo, recalcular con zona correcta
        periodo = getPeriodoHorarioCSV(fecha, hora, zona);
      } else {
        // Península/Canarias: respetar record.periodo si existe, sino calcular
        periodo = record.periodo || (Number.isFinite(hora) ? getPeriodoHorarioCSV(fecha, hora, zona) : null);
      }

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
        importByPeriod: {
          P1: round2(month.importByPeriod.P1),
          P2: round2(month.importByPeriod.P2),
          P3: round2(month.importByPeriod.P3)
        },
        importTotalKWh: round2(month.importTotalKWh),
        exportTotalKWh: round2(month.exportTotalKWh)
      };
    });

  return months;
};

// Solo devuelve los meses agrupados, la simulación económica va aparte
/**
 * Agrupa records importados en meses.
 *
 * @param {Object} importResult - Resultado de importación con {records}
 * @param {number} potenciaP1 - Potencia P1 (sin usar, para compatibilidad)
 * @param {number} potenciaP2 - Potencia P2 (sin usar, para compatibilidad)
 * @param {string} zona - Zona CNMC ('peninsula'|'ceutaMelilla'). Default: 'peninsula'
 * @returns {Object} {ok, months}
 */
window.BVSim.simulateMonthly = function (importResult, potenciaP1, potenciaP2, zona = 'peninsula') {
  const months = window.BVSim.bucketizeByMonth(importResult.records, zona);
  return { ok: true, months };
};

// ===== UTILIDADES MATEMÁTICAS =====
window.BVSim.round2 = function (n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
};

window.BVSim.getPrecioBVMensual = function (tarifa) {
  const raw = Number(tarifa?.fv?.precioBV);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
};

window.BVSim.INDEXED_SURPLUS_REFERENCE_PRICE = 0.02;

// ===== SIMULACIÓN ECONÓMICA (MES INDIVIDUAL) =====
window.BVSim.calcMonthForTarifa = function ({
  month,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoPrev,
  zonaFiscal = 'Península',
  esVivienda = true,
  ssaaDataset = null
}) {
  const round2 = window.BVSim.round2;
  // Importante: para evitar inflar costes si el CSV tiene huecos, usamos SOLO los días con datos.
  const dias = Number(month?.daysWithData) || 0;

  // Potencia
  const pot = round2((potenciaP1 * dias * tarifa.p1) + (potenciaP2 * dias * tarifa.p2));

  // Consumo (Energía)
  const consBaseEur = round2(
    (month.importByPeriod.P1 * tarifa.cPunta)
    + (month.importByPeriod.P2 * tarifa.cLlano)
    + (month.importByPeriod.P3 * tarifa.cValle)
  );
  const ssaa = (window.LF?.ssaa && typeof window.LF.ssaa.calcCharge === 'function')
    ? window.LF.ssaa.calcCharge(tarifa, Number(month.importTotalKWh) || 0, ssaaDataset, month.key)
    : { aplica: false, rate: 0, eur: 0, month: null };
  const ssaaEur = round2(ssaa.eur || 0);
  const consEur = round2(consBaseEur + ssaaEur);

  // Bono social (Financiación)
  const bonoSocialAnual = (window.LF_CONFIG && window.LF_CONFIG.bonoSocial)
    ? window.LF_CONFIG.bonoSocial.eurosAnuales
    : 6.979247;

  const costeBonoSocial = round2(bonoSocialAnual / 365 * dias);

  // Excedentes
  const exKwh = Number(month.exportTotalKWh) || 0;
  const esIndexada = tarifa?.fv?.exc === -1;
  let precioExcSource = 'fixed';
  let precioExc = Number(tarifa?.fv?.exc);
  let creditoPotencial = 0;

  if (esIndexada) {
    const indexedEur = Number(month?.indexedSurplusEur);
    const hasIndexedHourlyValue = month?.indexedSurplusSource === 'hourly-index-base'
      && Number.isFinite(indexedEur);

    if (hasIndexedHourlyValue) {
      creditoPotencial = round2(Math.max(0, indexedEur));
      precioExc = exKwh > 0 ? creditoPotencial / exKwh : 0;
      precioExcSource = 'hourly-index-base';
    } else {
      precioExc = window.BVSim.INDEXED_SURPLUS_REFERENCE_PRICE;
      creditoPotencial = round2(exKwh * precioExc);
      precioExcSource = 'reference-0.02';
    }
  } else {
    if (!Number.isFinite(precioExc)) precioExc = 0;
    precioExc = Math.max(0, precioExc);
    creditoPotencial = round2(exKwh * precioExc);
  }

  const hasBV = Boolean(tarifa?.fv?.bv);
  const precioBVMensual = hasBV ? window.BVSim.getPrecioBVMensual(tarifa) : 0;
  const daysInMonth = Number(month?.daysInMonth) || dias || 30;
  const costeBV = hasBV && precioBVMensual > 0
    ? round2(precioBVMensual * Math.min(Math.max(dias, 0), daysInMonth) / daysInMonth)
    : 0;

  // Compensación (límite: coste energía, o energía pura si ENERGIA_PARCIAL)
  let baseCompensable = consEur;
  let peajesTotal = 0;
  const esCompParcial = tarifa?.fv?.tope === 'ENERGIA_PARCIAL';
  if (esCompParcial) {
    const pc = (window.LF_CONFIG && window.LF_CONFIG.peajesCargosEnergia) || {};
    peajesTotal = round2(
      (month.importByPeriod.P1 || 0) * (pc.P1 || 0)
      + (month.importByPeriod.P2 || 0) * (pc.P2 || 0)
      + (month.importByPeriod.P3 || 0) * (pc.P3 || 0)
    );
    baseCompensable = Math.max(0, consEur - peajesTotal);
  }
  const credit1 = round2(Math.min(creditoPotencial, baseCompensable));
  const consAdj = round2(Math.max(0, consEur - credit1));
  const excedenteNoCompensableEur = esCompParcial
    ? round2(Math.max(0, Math.min(creditoPotencial, consEur) - credit1))
    : 0;
  const excedenteSobranteEur = round2(Math.max(0, creditoPotencial - credit1));

  // ===== IMPUESTOS (alineados con el comparador principal: js/lf-calc.js) =====
  const CFG = window.LF_CONFIG || {};
  const consumoTotalKwh = Number(month.importTotalKWh) || 0;

  // Base para IEE: potencia + energía neta + bono social (financiación)
  const sumaBase = round2(pot + consAdj + costeBonoSocial);
  const fiscalDateYmd = (() => {
    const key = String(month?.key || '');
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return undefined;
    const year = Number(m[1]);
    const monthNum = Number(m[2]);
    const lastDay = new Date(year, monthNum, 0).getDate();
    return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`;
  })();

  let impuestoElec = 0;
  if (CFG && typeof CFG.calcularIEE === 'function') {
    impuestoElec = round2(CFG.calcularIEE(sumaBase, consumoTotalKwh, fiscalDateYmd));
  } else {
    // Fallback derivado de la config si faltase la helper central.
    const ieePct = Number(CFG?.iee?.porcentaje) || 0;
    const ieeMin = Number(CFG?.iee?.minimoEurosKwh) || 0;
    impuestoElec = round2(Math.max((ieePct / 100) * sumaBase, consumoTotalKwh * ieeMin));
  }

  // Alquiler
  let alquilerContador = 0;
  if (CFG && typeof CFG.calcularAlquilerContador === 'function') {
    alquilerContador = round2(CFG.calcularAlquilerContador(dias));
  } else {
    alquilerContador = round2(dias * 0.81 * 12 / 365);
  }

  // IVA / IGIC / IPSI
  // Ojo: en Canarias y Ceuta/Melilla el contador tributa con un tipo distinto.
  const terr = (CFG && typeof CFG.getTerritorio === 'function')
    ? CFG.getTerritorio(zonaFiscal)
    : null;

  // `ivaCuota` = impuesto indirecto (IVA/IGIC/IPSI). Mantener el nombre para no romper la UI.
  let ivaCuota = 0;
  let totalBase = 0;

  const tipoImpuesto = String(terr?.impuestos?.tipo || '').toUpperCase();
  const potenciaContratada = Math.max(0, Number(potenciaP1) || 0, Number(potenciaP2) || 0);
  const limiteKw = Number(terr?.limiteViviendaKw) || 10;
  const esViviendaTipoCero = tipoImpuesto === 'IGIC' && Boolean(esVivienda) && potenciaContratada > 0 && potenciaContratada <= limiteKw;
  const fiscalContext = (CFG && typeof CFG.getFiscalContext === 'function')
    ? CFG.getFiscalContext({
        zona: zonaFiscal,
        potenciaContratada,
        viviendaCanarias: esVivienda,
        fechaYmd: fiscalDateYmd
      })
    : null;

  if (CFG && typeof CFG.calcularImpuestoIndirecto === 'function') {
    const taxCalc = CFG.calcularImpuestoIndirecto({
      zona: zonaFiscal,
      usoFiscal: fiscalContext?.usoFiscal || (esViviendaTipoCero ? 'vivienda' : (tipoImpuesto === 'IPSI' ? 'ipsi' : 'otros')),
      baseEnergia: sumaBase,
      impuestoElectrico: impuestoElec,
      baseContador: alquilerContador,
      baseServicios: costeBV,
      potenciaContratada,
      viviendaCanarias: esVivienda,
      fechaYmd: fiscalDateYmd
    });

    ivaCuota = round2(taxCalc.tipo === 'IVA' ? taxCalc.iva : taxCalc.impuestoTotal);
    totalBase = round2(sumaBase + impuestoElec + alquilerContador + costeBV + taxCalc.impuestoEnergia + taxCalc.impuestoContador + (taxCalc.impuestoServicios || 0));
  } else if (tipoImpuesto === 'IGIC') {
    const igicEnergia = esViviendaTipoCero
      ? 0
      : round2((sumaBase + impuestoElec) * (Number(terr?.impuestos?.energiaOtros) || 0));
    const igicContador = round2(alquilerContador * (Number(terr?.impuestos?.contador) || 0));
    const igicServicios = round2(costeBV * (Number(terr?.impuestos?.contador) || 0));

    ivaCuota = round2(igicEnergia + igicContador + igicServicios);
    totalBase = round2(sumaBase + impuestoElec + igicEnergia + alquilerContador + igicContador + costeBV + igicServicios);
  } else if (tipoImpuesto === 'IPSI') {
    const ipsiEnergia = round2((sumaBase + impuestoElec) * (Number(terr?.impuestos?.energia) || 0));
    const ipsiContador = round2(alquilerContador * (Number(terr?.impuestos?.contador) || 0));
    const ipsiServicios = round2(costeBV * (Number(terr?.impuestos?.contador) || 0));

    ivaCuota = round2(ipsiEnergia + ipsiContador + ipsiServicios);
    totalBase = round2(sumaBase + impuestoElec + ipsiEnergia + alquilerContador + ipsiContador + costeBV + ipsiServicios);
  } else {
    const ivaRate = Number(terr?.impuestos?.energia) || 0;
    const ivaBase = round2(sumaBase + impuestoElec + alquilerContador + costeBV);

    ivaCuota = round2(ivaBase * ivaRate);
    totalBase = round2(ivaBase + ivaCuota);
  }

  // Batería virtual:
  // - totalBaseConCosteBV es la factura del mes antes de usar saldo previo:
  //   potencia + energía neta + impuestos + alquiler + cuota BV, si existe.
  // - credit2 usa saldo BV anterior y puede cubrir toda la factura, incluida la cuota BV.
  // - excedenteSobranteEur es excedente nuevo del mes; solo se acumula si hasBV=true.
  // - totalReal descuenta el excedente nuevo acumulable, pero no el saldo heredado.
  // - Sin BV: no se usa saldo previo, no se acumula sobrante y totalReal=totalPagar.

  const totalBaseConCosteBV = totalBase;
  const bvPrev = hasBV ? Math.max(0, Number(bvSaldoPrev) || 0) : 0;
  const credit2 = hasBV ? round2(Math.min(bvPrev, totalBaseConCosteBV)) : 0;
  const bvSaldoFin = hasBV
    ? round2(excedenteSobranteEur + Math.max(0, bvPrev - credit2))
    : 0;
  const totalPagar = hasBV ? round2(Math.max(0, totalBaseConCosteBV - credit2)) : totalBaseConCosteBV;

  // Coste Real (si no tuvieras hucha anterior)
  const totalReal = round2(Math.max(0, totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0)));

  return {
    key: month.key,
    dias,
    pot,
    consEur,
    costeBonoSocial,
    sumaBase,
    impuestoElec,
    alquilerContador,
    ivaCuota,
    impuestoIndirectoTipo: terr?.impuestos?.tipo || (zonaFiscal === 'Canarias' ? 'IGIC' : (zonaFiscal === 'CeutaMelilla' ? 'IPSI' : 'IVA')),
    totalBase: totalBaseConCosteBV,
    precioBVMensual,
    costeBV,
    exKwh,
    precioExc,
    precioExcSource,
    creditoPotencial,
    indexedSurplusEur: Number.isFinite(Number(month?.indexedSurplusEur)) ? Number(month.indexedSurplusEur) : null,
    indexedAvgPrice: Number.isFinite(Number(month?.indexedAvgPrice)) ? Number(month.indexedAvgPrice) : null,
    indexedMissingHours: Number.isFinite(Number(month?.indexedMissingHours)) ? Number(month.indexedMissingHours) : 0,
    credit1,
    excedenteSobranteEur,
    excedenteNoCompensableEur,
    hasBV,
    bvSaldoPrev: bvPrev,
    credit2,
    bvSaldoFin,
    totalPagar,
    totalReal,
    baseCompensable,
    peajesTotal,
    consBaseEur,
    importTotalKWh: consumoTotalKwh,
    ssaaEur,
    ssaaRate: ssaa.rate || 0,
    ssaaMonth: ssaa.month || null,
    ssaaApplied: Boolean(ssaa.aplica && ssaaEur > 0)
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
  esVivienda = true,
  ssaaDataset = null
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
      esVivienda,
      ssaaDataset
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
// `bvSaldoInicial` admite un número (mismo saldo para todas, comportamiento clásico)
// o una función (tarifa) => número, para que la UI decida a qué tarifa aplica el
// saldo (p.ej. solo a "Mi tarifa": la hucha no se transfiere entre comercializadoras).
window.BVSim.simulateForAllTarifasBV = function ({
  months,
  tarifasBV,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial = 0,
  zonaFiscal = 'Península',
  esVivienda = true,
  ssaaDataset = null
}) {
  try {
    const resolveSaldoInicial = typeof bvSaldoInicial === 'function'
      ? bvSaldoInicial
      : () => bvSaldoInicial;
    const results = tarifasBV.map((tarifa) => {
      return window.BVSim.simulateForTarifaDemo({
        months,
        tarifa,
        potenciaP1,
        potenciaP2,
        bvSaldoInicial: Math.max(0, Number(resolveSaldoInicial(tarifa)) || 0),
        zonaFiscal,
        esVivienda,
        ssaaDataset
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
    const baseUrl = (window.LF && window.LF.JSON_URL) ? window.LF.JSON_URL : 'tarifas.json';
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}v=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, error: `Error al cargar tarifas.json (${response.status}).` };
    }

    const data = await response.json();
    const tarifas = Array.isArray(data?.tarifas) ? data.tarifas : [];

    // Solo tarifas con excedentes remunerados.
    // BV se decide en la UI por fv.bv; el precio de excedentes puede ser fijo o indexado (-1).
    const tarifasBV = tarifas.filter((tarifa) => {
      if (!tarifa || !tarifa.fv) return false;
      const rawExc = tarifa.fv.exc;
      const tieneExcRemunerado = (rawExc === -1) || (Number.isFinite(Number(rawExc)) && Number(rawExc) > 0);
      return tieneExcRemunerado;
    });

    if (tarifasBV.length === 0) {
      return {
        ok: false,
        error: 'No hay tarifas remuneradas de excedentes disponibles actualmente.'
      };
    }

    return { ok: true, tarifasBV };
  } catch (error) {
    return { ok: false, error: error?.message || 'Error al cargar tarifas BV.' };
  }
};
