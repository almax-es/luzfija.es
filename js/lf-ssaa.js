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
  let datasetPromise = null;
  let datasetCache = null;

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function asPublishedRate(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
    const ds = normalizeDataset(dataset);
    if (!ds) return false;
    const latestMonth = String(ds.latest_complete_month || '');
    if (!/^\d{4}-\d{2}$/.test(latestMonth)) return false;
    if (!Object.prototype.hasOwnProperty.call(ds.values || {}, latestMonth)) return false;
    const latestDirect = asPublishedRate(ds.values[latestMonth]);
    return latestDirect !== null;
  }

  async function loadDataset() {
    if (datasetCache) return datasetCache;
    if (datasetPromise) return datasetPromise;

    const url = window.SSAA_DATASET_URL || DEFAULT_URL;
    datasetPromise = window.LF.csvUtils.fetchWithTimeout(url, { cache: 'no-store' })
      .then((response) => (response && response.ok) ? response.json() : null)
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
      eur: round2(kwh * resolved.rate),
      month: resolved.month || null,
      reason: resolved.reason || null
    };
  }

  window.LF.ssaa = {
    loadDataset,
    getRateForMonth,
    resolveRate,
    mustApply,
    calcCharge,
    _setDatasetForTests(data) {
      datasetCache = normalizeDataset(data);
      datasetPromise = null;
    }
  };
})();
