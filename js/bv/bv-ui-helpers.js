/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

window.BVSim = window.BVSim || {};

window.BVSim.manualUi = window.BVSim.manualUi || {};

window.BVSim.manualUi.normalizeMonthMeta = function normalizeMonthMeta(meta) {
  const key = typeof meta?.key === 'string' ? meta.key.trim() : '';
  if (!/^\d{4}-\d{2}$/.test(key)) return null;

  const daysWithData = Math.round(Number(meta?.daysWithData));
  if (!Number.isFinite(daysWithData) || daysWithData <= 0) return null;

  const [year, month] = key.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const normalized = {
    key,
    daysWithData: Math.min(daysWithData, daysInMonth)
  };

  const explicitDaysInMonth = Math.round(Number(meta?.daysInMonth));
  if (Number.isFinite(explicitDaysInMonth) && explicitDaysInMonth > 0) {
    normalized.daysInMonth = explicitDaysInMonth;
  }

  return normalized;
};

window.BVSim.manualUi.pickLatestMonthData = function pickLatestMonthData(months) {
  const monthDataMap = new Map();
  const yearsFound = new Set();

  (Array.isArray(months) ? months : []).forEach((month) => {
    const key = typeof month?.key === 'string' ? month.key : '';
    const [yearStr, monthStr] = key.split('-');
    const year = parseInt(yearStr, 10);
    const monthIndex = parseInt(monthStr, 10) - 1;
    if (!Number.isFinite(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return;

    yearsFound.add(year);
    const existing = monthDataMap.get(monthIndex);
    if (existing && existing.year >= year) return;

    monthDataMap.set(monthIndex, {
      year,
      p1: Number(month?.importByPeriod?.P1) || 0,
      p2: Number(month?.importByPeriod?.P2) || 0,
      p3: Number(month?.importByPeriod?.P3) || 0,
      vert: Number(month?.exportTotalKWh) || 0,
      meta: window.BVSim.manualUi.normalizeMonthMeta({
        key,
        daysWithData: month?.daysWithData,
        daysInMonth: month?.daysInMonth
      })
    });
  });

  return { monthDataMap, yearsFound };
};

window.BVSim.manualUi.partitionRankableResults = function partitionRankableResults(results) {
  // Lista explicita del contrato numerico de totals (simulateForTarifaDemo), a proposito en
  // vez de Object.values(totals): con la forma generica bastaria añadir a totals una
  // propiedad descriptiva (una etiqueta, un flag) para que TODAS las tarifas cayeran a
  // invalid y el ranking desapareciera entero.
  const numericFields = ['pagado', 'real', 'bvFinal', 'credit1Total', 'credit2Total'];
  const rankable = [];
  const invalid = [];
  (Array.isArray(results) ? results : []).forEach((result) => {
    const totals = result?.totals;
    const esRankeable = Boolean(totals)
      && numericFields.every((field) => Number.isFinite(totals[field]));
    if (esRankeable) {
      rankable.push(result);
    } else {
      invalid.push(result);
    }
  });
  return { rankable, invalid };
};

window.BVSim.manualUi.changesSchedulingZone = function changesSchedulingZone(fromZona, toZona, normalizeZona) {
  if (typeof normalizeZona !== 'function') return false;
  const from = normalizeZona(fromZona);
  const to = normalizeZona(toZona);
  return Boolean(from && to && (from === 'ceutamelilla') !== (to === 'ceutamelilla'));
};

// Se bloquea el calculo cuando el reparto de la tabla es de otra zona horaria y NO se ha
// podido rehacer solo. Hay dos motivos para no poder rehacerlo, y ambos deben bloquear:
//   - la tabla se edito a mano (rehacerla pisaria el trabajo del usuario);
//   - no queda el fichero en memoria, tipicamente tras recargar la pagina (la procedencia se
//     persiste, los registros del CSV no).
// El segundo era el hueco: al no mirar mas que `dirty`, tras una recarga no se recalculaba
// NI se bloqueaba, y se calculaba con periodos de una zona y fiscalidad de otra en silencio.
// `formatZona` traduce el valor interno de la zona a la etiqueta que ve el usuario en el
// selector ('CeutaMelilla' -> 'Ceuta y Melilla', 'Península' -> 'Península y Baleares'). Es
// opcional para no atar este helper al DOM; sin el se usa el valor crudo.
window.BVSim.manualUi.getManualGridZoneMismatchError = function getManualGridZoneMismatchError(importState, zonaFiscal, normalizeZona, formatZona) {
  const origen = importState?.zonaFiscal;
  if (!origen) return '';

  // Fallo CERRADO. Con procedencia conocida y sin el normalizador canonico no hay forma de
  // decidir si la zona nueva cruza el eje horario; devolver '' aqui desactivaria la
  // proteccion en silencio justo cuando la pagina ha cargado a medias.
  if (typeof normalizeZona !== 'function') {
    return 'No se ha podido comprobar con qué zona se repartió el consumo de la tabla porque la página no cargó completa. Recárgala antes de calcular.';
  }

  if (!window.BVSim.manualUi.changesSchedulingZone(origen, zonaFiscal, normalizeZona)) return '';

  // Si el reparto se rehizo solo al cambiar de zona, la procedencia quedo al dia y no se
  // llega hasta aqui. NO se comprueba `result` a proposito: si el repoblado llego a abortar,
  // la procedencia sigue siendo la vieja y hay que bloquear igual (fallo cerrado).
  const motivo = importState.dirty
    ? 'has editado la tabla a mano'
    : 'no se ha podido rehacer el reparto automáticamente';
  const etiquetaOrigen = typeof formatZona === 'function' ? (formatZona(origen) || origen) : origen;
  return `El reparto P1/P2/P3 de la tabla se calculó con el horario de ${etiquetaOrigen} y ${motivo}. `
    + 'Vuelve a importar el archivo con la zona actual, o selecciona de nuevo la zona con la que se importó.';
};

// Via de escape del bloqueo: el usuario declara que ha ajustado el reparto a mano para la
// zona actual. Es lo unico que el programa no puede verificar por su cuenta, asi que exige
// una confirmacion inequivoca en la UI antes de llamar aqui. El fichero original deja de
// describir la tabla, asi que se descarta para que no vuelva a usarse en un recalculo.
window.BVSim.manualUi.acceptManualZoneAdjustment = function acceptManualZoneAdjustment(importState, zonaFiscal) {
  if (!importState || !zonaFiscal) return false;
  importState.zonaFiscal = zonaFiscal;
  importState.result = null;
  return true;
};

window.BVSim.manualUi.clearGridImportState = function clearGridImportState(importState) {
  if (!importState) return;
  importState.result = null;
  importState.zonaFiscal = null;
  importState.dirty = false;
};

window.BVSim.manualUi.buildSimulationMonths = function buildSimulationMonths(entries, options = {}) {
  const currentYear = Number.isFinite(options.currentYear) ? options.currentYear : new Date().getFullYear();
  const monthMetaByIndex = options.monthMetaByIndex || {};
  const months = [];

  for (let i = 0; i < 12; i++) {
    const entry = entries?.[i] || {};
    const p1 = Number(entry.p1) || 0;
    const p2 = Number(entry.p2) || 0;
    const p3 = Number(entry.p3) || 0;
    const totalCons = p1 + p2 + p3;
    const vert = Number(entry.vert) || 0;
    if (!(p1 > 0 || p2 > 0 || p3 > 0 || vert > 0)) continue;

    const rawMeta = monthMetaByIndex instanceof Map ? monthMetaByIndex.get(i) : monthMetaByIndex[i];
    const meta = window.BVSim.manualUi.normalizeMonthMeta(rawMeta);
    const fallbackKey = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
    const key = meta?.key || fallbackKey;
    const [year, month] = key.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    months.push({
      key,
      daysWithData: meta?.daysWithData || daysInMonth,
      daysInMonth,
      importTotalKWh: totalCons,
      exportTotalKWh: vert,
      importByPeriod: {
        P1: p1,
        P2: p2,
        P3: p3
      }
    });
  }

  return months;
};

/**
 * Decide cómo aplicar el saldo BV inicial introducido por el usuario.
 * La hucha pertenece a la comercializadora actual y no se transfiere al cambiar,
 * así que solo aplica a "Mi tarifa ⭐" (esPersonalizada) si tiene BV.
 * @param {Object|null} customTarifa - Tarifa personalizada (o null si no está rellenada)
 * @param {number} saldoVal - Saldo introducido en el formulario
 * @returns {{aplicado: boolean, sinDestino: boolean, resolver: function}}
 */
window.BVSim.manualUi.resolveSaldoConfig = function resolveSaldoConfig(customTarifa, saldoVal) {
  const saldo = Math.max(0, Number(saldoVal) || 0);
  const customHasBV = Boolean(customTarifa?.esPersonalizada && customTarifa?.fv?.bv);
  return {
    aplicado: saldo > 0 && customHasBV,
    sinDestino: saldo > 0 && !customHasBV,
    resolver: (tarifa) => (tarifa?.esPersonalizada && tarifa?.fv?.bv) ? saldo : 0
  };
};

/**
 * Métrica secundaria "coste neto": pagado − saldo BV final del periodo.
 * Corrige el artefacto del mes de corte (si el ciclo termina tras meses solares
 * buenos, la hucha queda cargada y el "pagado" infravalora la tarifa), pero el
 * ranking sigue ordenando por "pagado": el saldo final es valor condicionado a
 * seguir con la comercializadora. No reutilizar totals.real (clampa mes a mes
 * y descarta el sobrante estival).
 * @param {Object|null} totals - Totales de la simulación ({pagado, bvFinal})
 * @param {boolean} hasBV - Si la tarifa tiene batería virtual
 * @returns {{mostrar: boolean, neto: number, aFavor: boolean, importe: number, label: string}}
 */
window.BVSim.manualUi.resolveCosteNeto = function resolveCosteNeto(totals, hasBV) {
  const pagado = Number(totals?.pagado) || 0;
  const bvFinal = Number(totals?.bvFinal) || 0;
  const neto = Math.round((pagado - bvFinal) * 100) / 100;
  const aFavor = neto < -0.005;
  return {
    mostrar: Boolean(hasBV) && bvFinal > 0.005,
    neto,
    aFavor,
    importe: Math.abs(neto),
    label: aFavor ? 'Saldo a favor tras cubrir el periodo' : 'Coste neto si aprovechas el saldo final'
  };
};

window.BVSim.manualUi.rotateMonthsByStart = function rotateMonthsByStart(months, startKey) {
  const list = Array.isArray(months) ? months : [];
  const key = typeof startKey === 'string' ? startKey.trim() : '';
  if (!key) return list.slice();

  const startIdx = list.findIndex((month) => month?.key === key);
  if (startIdx <= 0) return list.slice();

  return list.slice(startIdx).concat(list.slice(0, startIdx));
};

window.BVSim.manualUi.createHourlyTraceControls = function createHourlyTraceControls(hourlyTraceState, escapeHtmlFn = (value) => String(value || '')) {
  function clearHourlyTraceState() {
    hourlyTraceState.records = null;
    hourlyTraceState.zonaFiscal = null;
    hourlyTraceState.dirty = false;
    hourlyTraceState.reason = '';
    hourlyTraceState.stats = null;
  }

  function setHourlyTraceFromImport(importResult, zonaFiscal) {
    if (importResult?.meta?.hasExcedenteColumn === false || importResult?.meta?.isDatadisMonthly === true) {
      clearHourlyTraceState();
      hourlyTraceState.reason = importResult?.meta?.isDatadisMonthly
        ? 'datadis-monthly-no-hourly-trace'
        : 'no-hourly-surplus-column';
      return;
    }
    hourlyTraceState.records = Array.isArray(importResult?.records) ? importResult.records : null;
    hourlyTraceState.zonaFiscal = zonaFiscal || null;
    hourlyTraceState.dirty = false;
    hourlyTraceState.reason = '';
    hourlyTraceState.stats = null;
  }

  function invalidateHourlyTrace(reason) {
    if (!hourlyTraceState.records) return;
    hourlyTraceState.dirty = true;
    hourlyTraceState.reason = reason || 'manual-edit';
    hourlyTraceState.stats = null;
  }

  // Tras recalcular el reparto del grid para otra zona, los registros horarios siguen siendo
  // validos: computeHourlyCompensation recibe la zona en la llamada (solo la usa para elegir
  // los geo de precios de excedentes) y no lee record.periodo. Re-apuntar la zona evita que
  // canUseHourlyTrace degrade a precio de referencia con un mensaje que pide reimportar,
  // contradiciendo al recalculo que se acaba de hacer. Las stats SI caducan: se calcularon
  // con los geo de la zona anterior.
  function retargetHourlyTraceZone(zonaFiscal) {
    if (!Array.isArray(hourlyTraceState.records) || hourlyTraceState.records.length === 0) return false;
    if (hourlyTraceState.dirty) return false;
    hourlyTraceState.zonaFiscal = zonaFiscal || null;
    hourlyTraceState.stats = null;
    return true;
  }

  function canUseHourlyTrace(zonaFiscal) {
    return Array.isArray(hourlyTraceState.records)
      && hourlyTraceState.records.length > 0
      && !hourlyTraceState.dirty
      && String(hourlyTraceState.zonaFiscal || '') === String(zonaFiscal || '');
  }

  function buildIndexedFallbackMsg(hasIndexedTariffs, indexedTraceMode, zonaFiscalVal) {
    if (!hasIndexedTariffs || (indexedTraceMode === 'hourly-index-base' && !hourlyTraceState.stats?.partialCoverageRejected)) return '';
    const _traceActive = Array.isArray(hourlyTraceState.records) && hourlyTraceState.records.length > 0 && !hourlyTraceState.dirty;
    const _traceZona = hourlyTraceState.zonaFiscal;
    const refPrice = (window.LF_CONFIG?.INDEXED_SURPLUS_REFERENCE_PRICE ?? 0.02).toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    if (_traceActive && _traceZona && String(_traceZona) !== String(zonaFiscalVal || '')) {
      return 'El CSV importado es de <strong>' + escapeHtmlFn(String(_traceZona)) + '</strong>; cambia la zona o reimporta para usar el cálculo horario con tu curva. Se usa ' + refPrice + '&nbsp;€/kWh de referencia.';
    } else if (hourlyTraceState.stats?.partialCoverageRejected) {
      const rejected = Number(hourlyTraceState.stats.partialCoverageRejectedMonths) || 0;
      const total = Number(hourlyTraceState.stats.partialCoverageTotalMonths) || 0;
      const scope = rejected > 0 && total > 0
        ? `${rejected} de ${total} ${total === 1 ? 'mes' : 'meses'}`
        : 'algunos meses';
      return 'El histórico del índice no cubre suficientes horas con excedentes del CSV en ' + scope + '. Esos meses usan ' + refPrice + '&nbsp;€/kWh de referencia para evitar un crédito horario parcial.';
    } else if (hourlyTraceState.stats && hourlyTraceState.stats.totalKwh === 0 && (hourlyTraceState.stats.missing || 0) > 0) {
      return 'No hay precios del índice disponibles para el periodo del CSV. Se usa ' + refPrice + '&nbsp;€/kWh de referencia.';
    } else if (hourlyTraceState.reason === 'no-hourly-surplus-column') {
      return 'El CSV importado no tiene columna de excedentes (AS_kWh). Se usa ' + refPrice + '&nbsp;€/kWh de referencia.';
    } else if (_traceActive && hourlyTraceState.stats && hourlyTraceState.stats.totalKwh === 0 && (hourlyTraceState.stats.missing || 0) === 0) {
      return 'Tu CSV no registra excedentes para este periodo. Se usa ' + refPrice + '&nbsp;€/kWh de referencia.';
    }
    return 'Sin CSV con excedentes activo, se usa ' + refPrice + '&nbsp;€/kWh de referencia orientativa.';
  }

  return {
    clear: clearHourlyTraceState,
    setFromImport: setHourlyTraceFromImport,
    invalidate: invalidateHourlyTrace,
    retargetZone: retargetHourlyTraceZone,
    canUse: canUseHourlyTrace,
    buildIndexedFallbackMsg
  };
};
