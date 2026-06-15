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

  function normalizeDataset(data) {
    if (!data || typeof data !== 'object') return null;
    const values = data.values && typeof data.values === 'object' ? data.values : {};
    const latestValue = Number(data.latest_value);
    return {
      ...data,
      values,
      latest_value: Number.isFinite(latestValue) ? latestValue : 0
    };
  }

  async function loadDataset() {
    if (datasetCache) return datasetCache;
    if (datasetPromise) return datasetPromise;

    const url = window.SSAA_DATASET_URL || DEFAULT_URL;
    datasetPromise = fetch(url, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        datasetCache = normalizeDataset(data);
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

  function resolveRate(dataset, monthKey) {
    const ds = normalizeDataset(dataset);
    if (!ds) return { rate: 0, month: null };
    if (isUsableMonth(ds, monthKey)) {
      const direct = Number(ds.values[monthKey]);
      if (Number.isFinite(direct) && direct > 0) return { rate: direct, month: monthKey };
    }
    const latest = Number(ds.latest_value);
    return {
      rate: Number.isFinite(latest) && latest > 0 ? latest : 0,
      month: ds.latest_complete_month || null
    };
  }

  function getRateForMonth(dataset, monthKey) {
    return resolveRate(dataset, monthKey).rate;
  }

  function mustApply(tarifa) {
    return Boolean(tarifa && tarifa.incluyeServiciosAjuste === false && !tarifa.esPVPC);
  }

  function calcCharge(tarifa, consumoKwh, dataset, monthKey) {
    if (!mustApply(tarifa)) {
      return { aplica: false, rate: 0, eur: 0, month: null };
    }
    const kwh = Number(consumoKwh);
    const resolved = resolveRate(dataset, monthKey);
    const rate = resolved.rate;
    if (!Number.isFinite(kwh) || kwh <= 0 || rate <= 0) {
      return { aplica: true, rate, eur: 0, month: resolved.month || null };
    }
    return {
      aplica: true,
      rate,
      eur: round2(kwh * rate),
      month: resolved.month || null
    };
  }

  window.LF.ssaa = {
    loadDataset,
    getRateForMonth,
    mustApply,
    calcCharge,
    _setDatasetForTests(data) {
      datasetCache = normalizeDataset(data);
      datasetPromise = null;
    }
  };
})();
