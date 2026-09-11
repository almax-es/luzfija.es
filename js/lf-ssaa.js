/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

(function() {
  'use strict';

  window.LF = window.LF || {};

  const DEFAULT_URL = '/data/ssaa/index.json';
  const MAX_PLAUSIBLE_RATE_EUR_KWH = 0.1;
  let datasetPromise = null;
  let datasetCache = null;

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function roundMoneyProduct(...factors) {
    const helper = window.LF_CONFIG && window.LF_CONFIG.roundMoneyProducts;
    return typeof helper === 'function'
      ? helper([factors])
      : round2(factors.reduce((product, factor) => product * Number(factor), 1));
  }

  function asPublishedRate(value) {
    return typeof value === 'number' && Number.isFinite(value)
      && value >= 0 && value < MAX_PLAUSIBLE_RATE_EUR_KWH
      ? value
      : null;
  }

  function normalizeDataset(data) {
    if (!data || typeof data !== 'object') return null;
    const values = data.values && typeof data.values === 'object' ? data.values : {};
    const latestValue = asPublishedRate(data.latest_value);
    return {
      ...data,
      values,
      latest_value: latestValue
    };
  }

  function hasUsableDatasetRate(dataset) {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) return false;
    if (dataset.schema_version !== 1 || dataset.indicator !== 10328
      || dataset.unit !== 'EUR/kWh' || dataset.timezone !== 'Europe/Madrid') return false;
    if (!dataset.values || typeof dataset.values !== 'object' || Array.isArray(dataset.values)) return false;

    const entries = Object.entries(dataset.values);
    if (!entries.length || entries.some(([month, rate]) => !/^\d{4}-\d{2}$/.test(month) || asPublishedRate(rate) === null)) {
      return false;
    }

    const latestMonth = String(dataset.latest_complete_month || '');
    if (!/^\d{4}-\d{2}$/.test(latestMonth)) return false;
    if (!Object.prototype.hasOwnProperty.call(dataset.values, latestMonth)) return false;
    const latestDirect = asPublishedRate(dataset.values[latestMonth]);
    const latestValue = asPublishedRate(dataset.latest_value);
    if (latestDirect === null || latestValue === null || latestDirect !== latestValue) return false;
    if (dataset.to != null && dataset.to !== latestMonth) return false;
    return true;
  }

  async function loadDataset() {
    if (datasetCache) return datasetCache;
    if (datasetPromise) return datasetPromise;

    const url = window.SSAA_DATASET_URL || DEFAULT_URL;
    datasetPromise = window.LF.csvUtils.fetchJsonWithTimeout(url, { cache: 'no-store' })
      .then(({ response, data }) => (response && response.ok) ? data : null)
      .then((data) => {
        // Un HTTP 200 con JSON vacío/malformado tampoco es un dataset válido.
        // No se hace negative-cache: el siguiente cálculo puede reintentar cuando
        // el origen vuelva a servir una serie mensual utilizable.
        datasetCache = hasUsableDatasetRate(data) ? normalizeDataset(data) : null;
        return datasetCache;
      })
      .catch(() => null)
      .finally(() => {
        datasetPromise = null;
      });

    return datasetPromise;
  }

  function isUsableMonth(ds, monthKey) {
    if (!monthKey || !ds?.values || ds.values[monthKey] === undefined) return false;
    return !ds.latest_complete_month || monthKey <= ds.latest_complete_month;
  }

  function unavailableRate(reason, requestedMonth = null) {
    return { available: false, rate: null, month: null, requestedMonth, reason };
  }

  function resolveRate(dataset, monthKey) {
    const ds = normalizeDataset(dataset);
    const requestedMonth = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : null;
    if (!ds) return unavailableRate('dataset-unavailable', requestedMonth);

    if (isUsableMonth(ds, requestedMonth)) {
      const direct = asPublishedRate(ds.values[requestedMonth]);
      if (direct !== null) {
        return { available: true, rate: direct, month: requestedMonth, requestedMonth, reason: null };
      }
    }

    const latestMonth = /^\d{4}-\d{2}$/.test(String(ds.latest_complete_month || ''))
      ? String(ds.latest_complete_month)
      : null;
    const latestDirect = latestMonth && ds.values?.[latestMonth] !== undefined
      ? asPublishedRate(ds.values[latestMonth])
      : null;
    const latestValue = asPublishedRate(ds.latest_value);
    const fallbackRate = latestDirect !== null ? latestDirect : latestValue;

    // Un mes futuro o todavía parcial puede usar, de forma deliberada, el último
    // mes completo publicado. Un mes histórico que ya debería estar en el dataset
    // NO puede sustituirse silenciosamente por un valor actual: falsearía el coste.
    if (requestedMonth && latestMonth && requestedMonth <= latestMonth) {
      return unavailableRate('historical-month-unavailable', requestedMonth);
    }
    if (fallbackRate === null) {
      return unavailableRate('rate-unavailable', requestedMonth);
    }
    return {
      available: true,
      rate: fallbackRate,
      month: latestMonth,
      requestedMonth,
      reason: requestedMonth && latestMonth && requestedMonth > latestMonth ? 'latest-complete-fallback' : null
    };
  }

  function getRateForMonth(dataset, monthKey) {
    const resolved = resolveRate(dataset, monthKey);
    return resolved.available ? resolved.rate : null;
  }

  function mustApply(tarifa) {
    return Boolean(tarifa && tarifa.incluyeServiciosAjuste === false && !tarifa.esPVPC);
  }

  function calcCharge(tarifa, consumoKwh, dataset, monthKey) {
    if (!mustApply(tarifa)) {
      return { aplica: false, available: true, rate: 0, eur: 0, month: null, reason: null };
    }
    const kwh = Number(consumoKwh);
    const resolved = resolveRate(dataset, monthKey);
    // Con consumo nulo el coste SSAA es exactamente 0 aunque no haya dataset.
    if (!Number.isFinite(kwh) || kwh <= 0) {
      return {
        aplica: true,
        available: true,
        rate: resolved.available ? resolved.rate : 0,
        eur: 0,
        month: resolved.available ? (resolved.month || null) : null,
        reason: null
      };
    }
    if (!resolved.available) {
      return {
        aplica: true,
        available: false,
        rate: null,
        eur: null,
        month: null,
        reason: resolved.reason,
        requestedMonth: resolved.requestedMonth || null
      };
    }
    return {
      aplica: true,
      available: true,
      rate: resolved.rate,
      eur: roundMoneyProduct(kwh, resolved.rate),
      month: resolved.month || null,
      reason: resolved.reason || null
    };
  }

  /**
   * Cargo de un mes COMPUESTO por tramos de meses naturales distintos (el simulador solar cose
   * en una sola fila los dos trozos del mes que un historico de 365 dias parte por la mitad).
   *
   * Los SSAA son un dataset mensual historico: aplicar la clave de un solo tramo a todo el mes
   * cobraria a los dias del otro año una tasa que no es la suya, y ademas puede descartar una
   * tasa publicada en favor del valor de reserva (el caso real: 20 dias de septiembre de 2025,
   * con tasa propia, cobrados al ultimo mes completo porque la fila lleva la clave de 2026).
   *
   * El consumo se reparte entre los tramos por su peso en kWh, y si esos kWh no estan (metadata
   * guardada antes de existir este campo) por sus dias. Se reparte el consumo ACTUAL de la fila,
   * no el importado, para que una edicion manual de la tabla siga repartiendose con la unica
   * proporcion conocida en vez de contradecir el total que el usuario ve.
   *
   * @param {Array} segments - [{key:'YYYY-MM', kwh?, days?}, ...]
   */
  function calcChargeForSegments(tarifa, consumoKwh, dataset, segments) {
    const tramos = (Array.isArray(segments) ? segments : [])
      .filter((segment) => /^\d{4}-\d{2}$/.test(String(segment?.key || '')));
    if (tramos.length < 2) {
      return calcCharge(tarifa, consumoKwh, dataset, tramos[0]?.key ?? null);
    }
    if (!mustApply(tarifa)) {
      return { aplica: false, available: true, rate: 0, eur: 0, month: null, reason: null };
    }

    const pesoDe = (segment, campo) => {
      const valor = Number(segment?.[campo]);
      return Number.isFinite(valor) && valor > 0 ? valor : 0;
    };
    const totalKwhTramos = tramos.reduce((acc, segment) => acc + pesoDe(segment, 'kwh'), 0);
    const totalDiasTramos = tramos.reduce((acc, segment) => acc + pesoDe(segment, 'days'), 0);
    const campoPeso = totalKwhTramos > 0 ? 'kwh' : 'days';
    const totalPeso = totalKwhTramos > 0 ? totalKwhTramos : totalDiasTramos;

    const resueltos = tramos.map((segment) => ({ segment, resolved: resolveRate(dataset, segment.key) }));
    const meses = resueltos
      .map(({ resolved, segment }) => resolved.month || segment.key)
      .join(' + ');

    const kwh = Number(consumoKwh);
    // Fallo CERRADO, igual que con un solo mes: si a UN tramo le falta la tasa, no se valora el
    // mes con la del otro. Omitir un coste regulado de media fila abarataria la tarifa en
    // silencio, que es justo lo que este camino evita.
    const sinTasa = resueltos.find(({ resolved }) => !resolved.available);
    if (sinTasa && Number.isFinite(kwh) && kwh > 0) {
      return {
        aplica: true,
        available: false,
        rate: null,
        eur: null,
        month: null,
        reason: sinTasa.resolved.reason,
        requestedMonth: sinTasa.resolved.requestedMonth || sinTasa.segment.key
      };
    }
    if (!Number.isFinite(kwh) || kwh <= 0) {
      return {
        aplica: true,
        available: true,
        rate: sinTasa ? 0 : (resueltos[0].resolved.rate || 0),
        eur: 0,
        month: sinTasa ? null : meses,
        reason: null
      };
    }
    if (totalPeso <= 0) {
      return calcCharge(tarifa, consumoKwh, dataset, tramos[tramos.length - 1].key);
    }

    const eurCrudo = resueltos.reduce((acc, { segment, resolved }) => {
      const parte = kwh * (pesoDe(segment, campoPeso) / totalPeso);
      return acc + (parte * resolved.rate);
    }, 0);
    // La tasa devuelta es la media ponderada real: la UI muestra "kWh x tasa = eur" y con
    // cualquier otra el producto no cuadraria con el importe cobrado.
    return {
      aplica: true,
      available: true,
      rate: eurCrudo / kwh,
      eur: Math.round((eurCrudo + Number.EPSILON) * 100) / 100,
      month: meses,
      reason: null
    };
  }

  window.LF.ssaa = {
    loadDataset,
    getRateForMonth,
    resolveRate,
    mustApply,
    calcCharge,
    calcChargeForSegments,
    _setDatasetForTests(data) {
      datasetCache = normalizeDataset(data);
      datasetPromise = null;
    }
  };
})();
