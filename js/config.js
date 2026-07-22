/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Guard global defensivo: definir currentYear antes que nada.
// Esto evita errores "currentYear is not defined" en código asíncrono.
try {
  if (typeof window.currentYear !== 'number') {
    window.currentYear = new Date().getFullYear();
  }
  // Compatibilidad extra: algunos scripts legacy usan el identificador global desnudo.
  // En scripts no-módulo, "var" top-level crea el binding global esperado.
  var currentYear = window.currentYear;
  window.currentYear = currentYear;
} catch (_) {
  // Si falla, continuar silenciosamente
}

function normalizeLegacyErrorText(value) {
  const text = (value === null || value === undefined) ? '' : String(value);
  const lower = text.toLowerCase();
  try {
    return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {
    return lower;
  }
}

function normalizeLegacyPath(pathLike) {
  let path = normalizeLegacyErrorText(pathLike || '');
  if (!path) return '';
  const q = path.indexOf('?');
  if (q !== -1) path = path.slice(0, q);
  const h = path.indexOf('#');
  if (h !== -1) path = path.slice(0, h);
  return path.replace(/^[/#]+/, '').replace(/[/#]+$/, '');
}

function isLegacyErrorPath(pathLike) {
  const path = normalizeLegacyPath(pathLike);
  if (!path) return true;
  // Desde 2026-07 los errores llevan detalle en el path
  // (error-javascript/<fichero>/<linea>/<build>), asi que no basta comparar
  // la ruta exacta: hay que reconocer tambien las variantes con segmentos.
  return path === 'error-promise' ||
         path === 'error-javascript' ||
         path === 'error-script-load' ||
         path.startsWith('error-promise/') ||
         path.startsWith('error-javascript/') ||
         path.startsWith('error-script-load/');
}

function extractLegacyReasonMessage(reason) {
  if (!reason) return '';
  if (reason instanceof Error) return String(reason.message || reason.name || '');
  if (typeof reason === 'object' && typeof reason.message === 'string') {
    return reason.message;
  }
  return String(reason);
}

function isLegacyCurrentYearNoise(reason) {
  const msg = normalizeLegacyErrorText(extractLegacyReasonMessage(reason));
  if (!msg || msg.indexOf('currentyear') === -1) return false;
  if (msg.indexOf('not defined') !== -1) return true;
  if (msg.indexOf('undefined') !== -1) return true;
  if (msg.indexOf('no esta definid') !== -1) return true;
  return false;
}

function isLegacyIndexExtraCompatNoise(textLike) {
  const msg = normalizeLegacyErrorText(textLike);
  if (!msg || msg.indexOf('index-extra') === -1) return false;
  if (msg.indexOf('compat') === -1) return false;
  if (msg.indexOf('omitid') !== -1) return true;
  if (msg.indexOf('es2020') !== -1) return true;
  return false;
}

function getLegacyGoatPayloadKind(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const path = normalizeLegacyPath(payload.path || '');
  const title = payload.title || '';

  if (isLegacyCurrentYearNoise(title)) {
    if (isLegacyErrorPath(path)) return 'currentyear-stale';
  }

  if (isLegacyIndexExtraCompatNoise(title)) {
    if (isLegacyErrorPath(path)) return 'index-extra-compat';
  }

  return '';
}

function getLegacyTelemetryRoute() {
  try {
    if (location && typeof location.pathname === 'string' && location.pathname) {
      return location.pathname;
    }
  } catch (_) {}
  return '/';
}

function remapLegacyGoatPayload(payload, kind) {
  const originalPath = normalizeLegacyErrorText(payload && payload.path ? payload.path : '');
  const buildId = (typeof window.__LF_BUILD_ID === 'string' && window.__LF_BUILD_ID.trim())
    ? window.__LF_BUILD_ID.trim()
    : 'unknown';
  const route = getLegacyTelemetryRoute();
  const parts = [
    'tipo:' + (kind || 'legacy'),
    'origen:config-guard',
    'evento:' + (originalPath || 'desconocido'),
    'b:' + buildId,
    '@' + route
  ];
  return {
    path: 'error-legacy-filtrado',
    title: parts.join(' | ').substring(0, 150),
    event: true
  };
}

function wrapGoatCounterCount(goatcounterLike) {
  if (!goatcounterLike || typeof goatcounterLike.count !== 'function') return false;
  if (goatcounterLike.__LF_LEGACY_NOISE_GUARD === true) return true;

  const originalCount = goatcounterLike.count.bind(goatcounterLike);
  goatcounterLike.count = function(payload) {
    try {
      const kind = getLegacyGoatPayloadKind(payload);
      if (kind) payload = remapLegacyGoatPayload(payload, kind);
    } catch (_) {}
    return originalCount(payload);
  };
  goatcounterLike.__LF_LEGACY_NOISE_GUARD = true;
  return true;
}

function prepareGoatCounterGuard(goatcounterLike) {
  try {
    if (!goatcounterLike || typeof goatcounterLike !== 'object') return false;
    if (typeof goatcounterLike.count === 'function') return wrapGoatCounterCount(goatcounterLike);

    // tracking crea primero `window.goatcounter = {}` y count.js añade el
    // método más tarde sobre ESE MISMO objeto. Vigilar la primera asignación del
    // método cierra el hueco que un setter solo sobre window.goatcounter no ve.
    const desc = Object.getOwnPropertyDescriptor(goatcounterLike, 'count');
    if (desc && desc.configurable === false) return false;
    Object.defineProperty(goatcounterLike, 'count', {
      configurable: true,
      enumerable: true,
      get: function() { return undefined; },
      set: function(value) {
        Object.defineProperty(goatcounterLike, 'count', {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
        wrapGoatCounterCount(goatcounterLike);
      }
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Guard global de último recurso: filtra ruido legacy incluso si se ejecuta tracking antiguo.
if (window.__LF_LEGACY_GOAT_GUARD_CONFIG !== true) {
  window.__LF_LEGACY_GOAT_GUARD_CONFIG = true;

  let goatRef = window.goatcounter;
  prepareGoatCounterGuard(goatRef);

  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'goatcounter');
    if (!desc || desc.configurable !== false) {
      Object.defineProperty(window, 'goatcounter', {
        configurable: true,
        enumerable: true,
        get: function() { return goatRef; },
        set: function(value) {
          goatRef = value;
          prepareGoatCounterGuard(goatRef);
        }
      });
    }
  } catch (_) {
    // Entornos donde no se puede redefinir window.goatcounter: best-effort sobre el valor actual.
  }

}

// Filtro temprano de ruido legacy antes de que tracking.js lo envíe a GoatCounter.
if (window.__LF_LEGACY_CURRENTYEAR_FILTER_CONFIG !== true) {
  window.__LF_LEGACY_CURRENTYEAR_FILTER_CONFIG = true;
  window.addEventListener('unhandledrejection', function(e) {
    try {
      if (!isLegacyCurrentYearNoise(e && e.reason)) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    } catch (_) {}
  }, true);
}

// Configuración PVPC - Dataset estático
// PVPC se calcula 100% en local a partir del dataset en /data/pvpc.
// Datasets actualizados diariamente por GitHub Actions desde ESIOS API.
window.PVPC_DATASET_BASE = "/data/pvpc";
window.SSAA_DATASET_URL = "/data/ssaa/index.json";
