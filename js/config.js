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
  if (msg.indexOf('no esta definid') !== -1) return true;
  return false;
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
// Dataset actualizado diariamente por GitHub Actions desde ESIOS API.
window.PVPC_DATASET_BASE = "/data/pvpc";
