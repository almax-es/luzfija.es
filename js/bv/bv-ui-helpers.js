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

  // Tramos de origen de un mes compuesto (un año que empieza a mitad de mes parte un mes
  // natural en dos trozos de años distintos). Es la unica fuente de esa procedencia: de aqui
  // salen tanto la etiqueta que ve el usuario como las claves con las que
  // applyMonthlyIndexedValues busca los excedentes valorados hora a hora. Sin ellas el mes
  // declararia los dias de los dos tramos y cobraria la compensacion de uno solo.
  // `from`/`to` son solo para la etiqueta y son opcionales a proposito: si se exigiesen, un
  // tramo sin ellos desapareceria de la lista y el mes sumaria el consumo de dos tramos
  // mientras el indexado valoraria uno. La clave y los dias son lo que no puede faltar.
  const segments = Array.isArray(meta?.segments) ? meta.segments.reduce((acc, segment) => {
    const segKey = typeof segment?.key === 'string' ? segment.key.trim() : '';
    const days = Math.round(Number(segment?.days));
    if (!/^\d{4}-\d{2}$/.test(segKey)) return acc;
    if (!Number.isFinite(days) || days <= 0 || days > 31) return acc;
    if (acc.some((item) => item.key === segKey)) return acc;
    const entry = { key: segKey, days };
    const from = Math.round(Number(segment?.from));
    const to = Math.round(Number(segment?.to));
    if (Number.isFinite(from) && from >= 1 && from <= 31
      && Number.isFinite(to) && to >= from && to <= 31) {
      entry.from = from;
      entry.to = to;
    }
    const kwh = Number(segment?.kwh);
    if (Number.isFinite(kwh) && kwh > 0) entry.kwh = Math.round(kwh * 100) / 100;
    acc.push(entry);
    return acc;
  }, []) : [];
  // Procedencia, no solo forma. Un escenario compartido llega por la URL, se descodifica y
  // entra aqui sin otra validacion, y de estos tramos salen DOS consumidores economicos: la
  // tasa de servicios de ajuste de cada mes y las claves con las que se suman los excedentes
  // valorados hora a hora. Un tramo ajeno inyectado a mano sumaria a este mes la compensacion
  // de otro, que ademas seguiria cobrandola por su cuenta: duplicacion, no traspaso. Un mes
  // compuesto legitimo solo puede tener dos tramos y ambos son el mismo mes natural que la
  // fila. Si algo no encaja se descarta el conjunto entero y el mes vuelve a ser simple, que
  // es el comportamiento conservador: cobra de mas en su tasa, nunca de menos.
  const mismoMesNatural = segments.every((segment) => segment.key.slice(5) === key.slice(5));
  const procedenciaValida = segments.length === 2
    && mismoMesNatural
    && segments.some((segment) => segment.key === key);
  if (procedenciaValida) {
    normalized.segments = segments.sort((a, b) => a.key.localeCompare(b.key));
  }

  return normalized;
};

// Reduce los meses del CSV a las doce filas de la rejilla. Cuando un mes del año llega en dos
// tramos de años distintos (un histórico de 365 dias que empieza a mitad de mes parte en dos
// su primer mes), los tramos se SUMAN en una sola fila en vez de quedarse con el mas reciente:
// quedarse con uno tiraba entre 9 y 20 dias de datos reales y dejaba el periodo por debajo del
// año. El recorte de dias solapados ya se hizo sobre los registros horarios al importar, asi
// que aqui los dos tramos nunca describen el mismo dia del mes.
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
    const dayOf = (dateStr) => {
      const parsed = Math.round(Number(String(dateStr || '').slice(8, 10)));
      return Number.isFinite(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null;
    };
    const days = Math.max(0, Math.round(Number(month?.daysWithData)) || 0);
    const from = dayOf(month?.start);
    const to = dayOf(month?.end);
    // El consumo del tramo viaja con el: los SSAA son un dataset mensual historico y cada tramo
    // debe pagar la tasa de SU mes, asi que hace falta saber cuanto consumo le toca a cada uno.
    const kwhTramo = ['P1', 'P2', 'P3'].reduce((acc, periodo) => {
      const valor = Number(month?.importByPeriod?.[periodo]);
      return acc + (Number.isFinite(valor) ? Math.max(0, valor) : 0);
    }, 0);
    const segment = days > 0
      ? Object.assign(
        { key, days },
        from !== null && to !== null && to >= from ? { from, to } : null,
        kwhTramo > 0 ? { kwh: Math.round(kwhTramo * 100) / 100 } : null
      )
      : null;

    const existing = monthDataMap.get(monthIndex);
    if (!existing) {
      monthDataMap.set(monthIndex, {
        year,
        p1: Number(month?.importByPeriod?.P1) || 0,
        p2: Number(month?.importByPeriod?.P2) || 0,
        p3: Number(month?.importByPeriod?.P3) || 0,
        vert: Number(month?.exportTotalKWh) || 0,
        segments: segment ? [segment] : [],
        daysWithData: days,
        meta: window.BVSim.manualUi.normalizeMonthMeta({
          key,
          daysWithData: month?.daysWithData,
          daysInMonth: month?.daysInMonth
        })
      });
      return;
    }

    // La clave de la fila es la del tramo que puede albergar mas dias, con el reciente ganando
    // el empate. Misma regla que buildEdgeStitchPlan al recortar (lf-csv-utils.js), aplicada
    // aqui por separado para no acoplar esta reduccion al plan de cosido. Solo cambia algo
    // cuando el mes partido es febrero con un bisiesto por medio: elegir el febrero corto
    // toparia a 28 dias una fila que aporta 29 y perderia un dia real de consumo.
    const diasDelMes = (anyo) => new Date(anyo, monthIndex + 1, 0).getDate();
    const diasNuevo = diasDelMes(year);
    const diasExistente = Number(existing.meta?.daysInMonth) || diasDelMes(existing.year);
    const nuevoEsDestino = diasNuevo > diasExistente || (diasNuevo === diasExistente && year > existing.year);
    const mergedSegments = segment ? [...existing.segments, segment] : existing.segments;
    const mergedDays = existing.daysWithData + days;
    const targetKey = nuevoEsDestino ? key : `${existing.year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const targetDaysInMonth = nuevoEsDestino
      ? (Number(month?.daysInMonth) || diasNuevo)
      : diasExistente;

    monthDataMap.set(monthIndex, {
      year: Math.max(existing.year, year),
      p1: existing.p1 + (Number(month?.importByPeriod?.P1) || 0),
      p2: existing.p2 + (Number(month?.importByPeriod?.P2) || 0),
      p3: existing.p3 + (Number(month?.importByPeriod?.P3) || 0),
      vert: existing.vert + (Number(month?.exportTotalKWh) || 0),
      segments: mergedSegments,
      daysWithData: mergedDays,
      meta: window.BVSim.manualUi.normalizeMonthMeta({
        key: targetKey,
        daysWithData: mergedDays,
        daysInMonth: targetDaysInMonth,
        segments: mergedSegments
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
    // Un mes "aportado" es el que readManualEntriesFromGrid() incluyo en el array (al menos un
    // campo con contenido no vacio), NO el que tiene algun valor > 0 — un mes con los 4 campos
    // explicitamente a cero sigue teniendo costes fijos (potencia, contador, cuota BV) y debe
    // simularse igual, no desaparecer como si nunca se hubiera introducido.
    if (entries?.[i] === undefined) continue;
    const entry = entries[i] || {};
    const p1 = Number(entry.p1) || 0;
    const p2 = Number(entry.p2) || 0;
    const p3 = Number(entry.p3) || 0;
    const totalCons = p1 + p2 + p3;
    const vert = Number(entry.vert) || 0;

    const rawMeta = monthMetaByIndex instanceof Map ? monthMetaByIndex.get(i) : monthMetaByIndex[i];
    const meta = window.BVSim.manualUi.normalizeMonthMeta(rawMeta);
    const fallbackKey = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
    const key = meta?.key || fallbackKey;
    const [year, month] = key.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    const row = {
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
    };

    // Mes compuesto por dos tramos: `sourceKeys` se deriva de los tramos, no se guarda aparte,
    // para que no puedan contradecirse. Es lo que permite a applyMonthlyIndexedValues sumar los
    // excedentes valorados de los dos meses de origen en esta unica fila.
    if (Array.isArray(meta?.segments) && meta.segments.length > 1) {
      row.segments = meta.segments;
      row.sourceKeys = meta.segments.map((segment) => segment.key);
    }

    months.push(row);
  }

  return months;
};

// Distingue un año realmente cubierto de una presentación anual aproximada.
// El filtro usa esta señal para no ofrecer extrapolación sobre un periodo que
// ya contiene doce meses consecutivos y al menos 365 días reales.
window.BVSim.manualUi.hasFullAnnualConsumptionCoverage = function hasFullAnnualConsumptionCoverage(months) {
  if (!Array.isArray(months) || months.length < 12) return false;

  const uniqueMonths = new Set();
  const monthOrdinals = [];
  let coveredDays = 0;
  for (const month of months) {
    const key = String(month?.key || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return false;
    uniqueMonths.add(key);
    const [year, monthNumber] = key.split('-').map(Number);
    monthOrdinals.push((year * 12) + monthNumber);
    const calendarDays = new Date(year, monthNumber, 0).getDate();
    const declaredDays = Math.round(Number(month?.daysWithData));
    coveredDays += Math.min(calendarDays, Math.max(0, Number.isFinite(declaredDays) ? declaredDays : 0));
  }

  const orderedMonths = [...new Set(monthOrdinals)].sort((a, b) => a - b);
  const isConsecutiveYear = orderedMonths.length === 12
    && orderedMonths.every((month, index) => index === 0 || month === orderedMonths[index - 1] + 1);
  return uniqueMonths.size >= 12 && isConsecutiveYear && coveredDays >= 365;
};

// Días civiles realmente representados por el consumo. Una clave mensual
// duplicada cuenta una sola vez y conserva la mayor cobertura declarada.
window.BVSim.manualUi.getConsumptionCoverageDays = function getConsumptionCoverageDays(months) {
  if (!Array.isArray(months)) return 0;
  const daysByMonth = new Map();
  for (const month of months) {
    const key = String(month?.key || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) continue;
    const [year, monthNumber] = key.split('-').map(Number);
    const calendarDays = new Date(year, monthNumber, 0).getDate();
    const declaredDays = Math.round(Number(month?.daysWithData));
    const coveredDays = Math.min(calendarDays, Math.max(0, Number.isFinite(declaredDays) ? declaredDays : 0));
    daysByMonth.set(key, Math.max(daysByMonth.get(key) || 0, coveredDays));
  }
  return [...daysByMonth.values()].reduce((total, days) => total + days, 0);
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

// Un escenario guardado/compartido transporta mesInicio como clave completa YYYY-MM, pero una
// tabla manual sin meta reconstruye sus claves con el año en curso: al abrir en 2026 un escenario
// creado en 2025, la clave exacta ya no existe entre las opciones y el mes de inicio se perdia en
// silencio (cambiando el arrastre de BV, el coste y el ranking). Aqui el mes natural manda cuando
// la clave exacta ya no esta, pero solo si no hay ambiguedad: con dos junios de años distintos no
// se adivina, se falla cerrado y queda el orden por defecto.
window.BVSim.manualUi.resolveMonthStartKey = function resolveMonthStartKey(months, requestedKey) {
  const requested = typeof requestedKey === 'string' ? requestedKey.trim() : '';
  if (!requested) return '';

  const keys = (Array.isArray(months) ? months : [])
    .map((month) => typeof month?.key === 'string' ? month.key : '')
    .filter((key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key));
  if (keys.includes(requested)) return requested;

  const match = /^\d{4}-(0[1-9]|1[0-2])$/.exec(requested);
  if (!match) return '';
  const sameCalendarMonth = keys.filter((key) => key.slice(5) === match[1]);
  return sameCalendarMonth.length === 1 ? sameCalendarMonth[0] : '';
};

// totals.pagado ya viene redondeado a centimos por simulateForTarifaDemo(), asi que el unico
// empate economico representable es la igualdad exacta. El guard anterior (Math.abs(diff) < 0.01)
// trataba como empate el 88,7% de las diferencias reales de un centimo, porque en IEEE-754
// 7.87 - 7.86 = 0.00999999999999978...: una tarifa un centimo mas cara podia colarse por delante
// gracias a su saldo BV, contra el contrato de ordenar primero por pagado.
window.BVSim.manualUi.compareRankedResultsByPaid = function compareRankedResultsByPaid(a, b) {
  const pagadoA = Number(a?.totals?.pagado);
  const pagadoB = Number(b?.totals?.pagado);
  if (pagadoA === pagadoB) {
    return Number(b?.totals?.bvFinal) - Number(a?.totals?.bvFinal);
  }
  return pagadoA - pagadoB;
};

window.BVSim.manualUi.createHourlyTraceControls = function createHourlyTraceControls(hourlyTraceState, escapeHtmlFn = (value) => String(value || '')) {
  // rev sube en cualquier mutacion real de la traza (no en los early-return que no cambian
  // nada): un calculo en curso puede comparar esto contra lo que capturo al empezar, sin
  // tener que serializar miles de registros para detectar el cambio.
  function bumpHourlyTraceRev() {
    hourlyTraceState.rev = (hourlyTraceState.rev || 0) + 1;
  }

  function clearHourlyTraceState() {
    hourlyTraceState.records = null;
    hourlyTraceState.zonaFiscal = null;
    hourlyTraceState.dirty = false;
    hourlyTraceState.reason = '';
    hourlyTraceState.stats = null;
    bumpHourlyTraceRev();
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
    bumpHourlyTraceRev();
  }

  function invalidateHourlyTrace(reason) {
    if (!hourlyTraceState.records) return;
    hourlyTraceState.dirty = true;
    hourlyTraceState.reason = reason || 'manual-edit';
    hourlyTraceState.stats = null;
    bumpHourlyTraceRev();
  }

  function usesCanaryClock(zonaFiscal) {
    const profiles = window.LF?.csvUtils?.getCsvZoneProfiles?.(zonaFiscal);
    if (profiles) return profiles.zonaHoraria === 'canarias';
    return String(zonaFiscal || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .includes('canaria');
  }

  // Al cambiar entre zonas con el mismo reloj, la traza sigue siendo valida y solo caducan
  // sus stats. Peninsula/Canarias necesitan horas canonicas distintas en los dos cambios DST;
  // si la curva contiene uno, se invalida de forma explicita en vez de cruzarla desplazada.
  function retargetHourlyTraceZone(zonaFiscal) {
    if (!Array.isArray(hourlyTraceState.records) || hourlyTraceState.records.length === 0) return false;
    if (hourlyTraceState.dirty) return false;
    const crossesCanaryClock = usesCanaryClock(hourlyTraceState.zonaFiscal) !== usesCanaryClock(zonaFiscal);
    const hasDstTransitionRecords = window.LF?.csvUtils?.hasDstTransitionRecords;
    if (crossesCanaryClock
      && (typeof hasDstTransitionRecords !== 'function' || hasDstTransitionRecords(hourlyTraceState.records))) {
      invalidateHourlyTrace('zone-hour-shift');
      return false;
    }
    hourlyTraceState.zonaFiscal = zonaFiscal || null;
    hourlyTraceState.stats = null;
    bumpHourlyTraceRev();
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
    } else if (hourlyTraceState.reason === 'zone-hour-shift') {
      return 'La curva contiene un cambio de hora que se numera de forma distinta en Canarias. Reimporta el CSV con la zona correcta para usar el cálculo horario de excedentes. Se usa ' + refPrice + '&nbsp;€/kWh de referencia.';
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
