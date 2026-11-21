/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Guard global defensivo redundante (el principal está en config.js).
// Se mantiene aquí porque algunas entradas legacy cargan theme.js mucho antes
// que cualquier otro script y algunos clientes viejos siguen esperando el
// binding global desnudo `currentYear`.
try {
  if (typeof window.currentYear !== 'number') {
    window.currentYear = new Date().getFullYear();
  }
  var currentYear = window.currentYear;
  window.currentYear = currentYear;
} catch (_) {}

// Sistema de tema claro/oscuro (carga antes del render para evitar flash)
(function(){
  const key = 'almax_theme';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
    window.__ALMAX_THEME_SAVED = saved;
  } catch(e) {
    // localStorage no disponible (modo privado, etc.)
  }
  window.__ALMAX_THEME_KEY = key;

  // Estado visual temprano del formulario de la home (usuario que vuelve). lf-inputs.js restaura lo
  // guardado DESPUES del primer pintado: con placas solares o bono social activados, esos bloques
  // aparecian entonces y empujaban el footer visible en pantallas altas. En la medicion historica de
  // recarga (20/11/2026, antes de este arreglo), el CLS fue 0,012 a 1920x1080 y 0,077 a 1280x1440
  // con las opciones activadas. Antes del CSS se decide lo mismo que loadInputs() y se marca <html>.
  // styles.css muestra esos bloques desde el primer fotograma y updateSolarUI(),
  // updateBonoSocialUI() y updateZonaFiscalUI() retiran la clase al tomar el control.
  // Mismas reglas que lf-inputs.js: un enlace con configuracion compartida (cualquier clave de DEFAULTS,
  // ver SHAREABLE_INPUT_KEYS en lf-state.js) manda sobre lo guardado; asBool() de lf-utils.js.
  // Solo por encima del ancho de un movil (>= 521 px, el corte del formulario a una columna): tablets,
  // ventanas estrechas y escritorio, donde el footer puede estar a la vista al cargar (tambien a 768x1024:
  // 0,002-0,023). En un movil el formulario es tan largo que el salto nunca se veia (CLS 0) y pintar esos
  // bloques en el primer fotograma retrasaba el FCP de quien vuelve ~50 ms (412 px, CPU 4x, medido el
  // 20/11/2026), asi que alli se conserva el arranque de siempre.
  try {
    const path = location.pathname;
    const escritorio = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 521px)').matches;
    if (escritorio && (path === '/' || path === '/index.html')) {
      const CLAVES_COMPARTIBLES = ['p1', 'p2', 'dias', 'cPunta', 'cLlano', 'cValle', 'zonaFiscal',
        'viviendaCanarias', 'solarOn', 'exTotal', 'bvSaldo', 'bonoSocialOn', 'bonoSocialTipo',
        'bonoSocialLimite'];
      const asBoolTemprano = (val, fallback) => {
        if (val === undefined || val === null) return fallback;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (['true', '1', 'si', 'sí', 'yes'].includes(s)) return true;
        if (['false', '0', 'no'].includes(s)) return false;
        return fallback;
      };
      const params = new URLSearchParams(location.search);
      let datos = {};
      if (CLAVES_COMPARTIBLES.some((k) => params.has(k))) {
        params.forEach((v, k) => { datos[k] = v; });
      } else {
        const raw = localStorage.getItem('almax_comparador_v6_inputs');
        const leido = raw ? JSON.parse(raw) : null;
        if (leido && typeof leido === 'object') datos = leido;
      }
      const root = document.documentElement;
      root.classList.toggle('lf-pre-solar', asBoolTemprano(datos.solarOn, false));
      root.classList.toggle('lf-pre-bono', asBoolTemprano(datos.bonoSocialOn, false));
      root.classList.toggle('lf-pre-canarias', datos.zonaFiscal === 'Canarias');
      // Red de seguridad: si lf-inputs.js no llega a ejecutarse (carga parcial), las casillas no se
      // restauran y los bloques no deben quedarse abiertos por la marca. En un arranque sano ya no esta.
      window.addEventListener('load', () => {
        root.classList.remove('lf-pre-solar', 'lf-pre-bono', 'lf-pre-canarias');
      }, { once: true });

      // Indicador "Total kWh": saveInputs() (lf-inputs.js, vistaKwhTrasRecargar) guarda en el mismo JSON
      // los textos que pintara updateKwhHint() con esos datos. Aqui se pintan con la misma estructura y
      // luego updateKwhHint() los sustituye por lo mismo sin mover nada. Con un enlace compartido no hay
      // vista: `datos` sale de la URL, donde solo hay textos y la comprobacion de tipo la descarta. Se espera a que exista #btnCalc (va detras) para no
      // escribir en #kwhHint mientras el parser aun lo rellena; el MutationObserver entrega antes del
      // siguiente pintado.
      const pista = datos.vistaKwh;
      const cifra = /^\d+,\d{2}$/;
      if (pista && typeof pista === 'object' && typeof pista.solar === 'boolean' && typeof pista.total === 'boolean' &&
          cifra.test(pista.t) && cifra.test(pista.ex) && typeof MutationObserver === 'function') {
        const pintar = () => {
          const hint = document.getElementById('kwhHint');
          if (!hint || !document.getElementById('btnCalc')) return false;
          if (pista.solar) {
            const split = document.createElement('div');
            split.className = 'kwh-split';
            [['Red', pista.t], ['Exced.', pista.ex]].forEach(([etiqueta, valor]) => {
              const pill = document.createElement('div');
              pill.className = 'kwh-pill';
              [['kwh-label', etiqueta], ['kwh-value', valor], ['kwh-unit', 'kWh']].forEach(([clase, texto]) => {
                const span = document.createElement('span');
                span.className = clase;
                span.textContent = texto;
                pill.appendChild(span);
              });
              split.appendChild(pill);
            });
            hint.removeAttribute('data-placeholder');
            hint.replaceChildren(split);
          } else if (pista.total) {
            hint.removeAttribute('data-placeholder');
            hint.textContent = pista.t + ' kWh';
          }
          return true;
        };
        if (!pintar()) {
          const mo = new MutationObserver(() => { if (pintar()) mo.disconnect(); });
          mo.observe(document.documentElement, { childList: true, subtree: true });
          document.addEventListener('DOMContentLoaded', () => mo.disconnect(), { once: true });
        }
      }
    }
  } catch (_) {
    // localStorage no disponible o JSON corrupto: sin marca, como antes (lf-inputs lo mostrara al cargar).
  }

  // Observatorio (/estadisticas/): la seccion de CSV de excedentes viene oculta en el HTML (la vista por
  // defecto es PVPC). Con ?type=surplus (enlace desde el simulador solar) se marca <html> para que el CSS la
  // muestre desde el primer fotograma; pvpc-stats-ui.js retira la marca al arrancar (syncCsvSectionVisibility).
  // Misma regla que parseParams(): solo el valor exacto 'surplus'.
  try {
    const path = location.pathname;
    if ((path === '/estadisticas/' || path === '/estadisticas/index.html') &&
        new URLSearchParams(location.search).get('type') === 'surplus') {
      const root = document.documentElement;
      root.classList.add('lf-pre-excedentes');
      window.addEventListener('load', () => { root.classList.remove('lf-pre-excedentes'); }, { once: true });
    }
  } catch (_) {
    // Sin marca: la seccion aparece al arrancar pvpc-stats-ui.js, como antes.
  }

  function normalizeErrorText(value) {
    const text = (value === null || value === undefined) ? '' : String(value);
    const lower = text.toLowerCase();
    try {
      return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {
      return lower;
    }
  }

  function extractErrorMessage(reason) {
    if (!reason) return '';
    if (reason instanceof Error) return String(reason.message || reason.name || '');
    if (typeof reason === 'object' && typeof reason.message === 'string') {
      return reason.message;
    }
    return String(reason);
  }

  function shouldSilenceLegacyCurrentYearError(reason) {
    const msg = normalizeErrorText(extractErrorMessage(reason));
    if (!msg || msg.indexOf('currentyear') === -1) return false;
    if (msg.indexOf('not defined') !== -1) return true;
    if (msg.indexOf('no esta definid') !== -1) return true;
    return false;
  }

  // Bloquea ruido de clientes con JS viejo antes de que lo capture tracking.js legado.
  if (window.__LF_LEGACY_CURRENTYEAR_FILTER !== true) {
    window.__LF_LEGACY_CURRENTYEAR_FILTER = true;
    window.addEventListener('unhandledrejection', function(e) {
      try {
        if (!shouldSilenceLegacyCurrentYearError(e && e.reason)) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      } catch (_) {}
    }, true);
  }

  // Cargar INP debug solo en modo debug (sin ensuciar producción)
  try {
    const params = new URLSearchParams(location.search);
    const debug = params.get('debug') === '1' ||
      localStorage.getItem('lf_debug') === '1' ||
      window.__LF_DEBUG === true;
    if (debug) {
      window.__LF_DEBUG = true;
      const loadDebug = () => {
        if (window.__LF_INP_DEBUG_ACTIVE) return;
        if (document.querySelector('script[data-lf-inp-debug]')) return;
        const s = document.createElement('script');
        s.src = '/js/inp-debug.js';
        s.defer = true;
        s.dataset.lfInpDebug = '1';
        document.head.appendChild(s);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDebug, { once: true });
      } else {
        loadDebug();
      }
    }
  } catch (_) {}
})();
