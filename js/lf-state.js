/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: Estado global y referencias DOM =====
// Centraliza el estado de la aplicación y las referencias a elementos

(function() {
  'use strict';

  const $ = id => document.getElementById(id);

  // URL DEL JSON ESTÁTICO DE TARIFAS
  const JSON_URL = 'tarifas.json';

  // CLAVES DE STORAGE
  const LS_KEY = 'almax_comparador_v6_inputs';
  const THEME_KEY = window.__ALMAX_THEME_KEY || 'almax_theme';
  const TARIFAS_CACHE_KEY = 'luzfija_tarifas_v1';

  // VALORES POR DEFECTO
  const DEFAULTS = {
    p1: '3,45',
    p2: '3,45',
    dias: '30',
    cPunta: '100',
    cLlano: '100',
    cValle: '100',
    zonaFiscal: 'Península',
    viviendaCanarias: true,
    solarOn: false,
    exTotal: '0',
    bvSaldo: '0',
    bonoSocialOn: false,
    bonoSocialTipo: 'vulnerable',
    bonoSocialLimite: '1587'
  };

  // PARÁMETROS URL
  // Solo se aceptan las claves que el propio serializador de "Compartir configuración"
  // (shareConfiguration en lf-app.js) emite, que son exactamente las de DEFAULTS. Derivarla
  // de DEFAULTS y no de una lista escrita a mano evita que se desincronicen al añadir campos.
  //
  // CRÍTICO: la presencia de SERVER_PARAMS es lo que hace a loadInputs() ignorar localStorage
  // y cargar una configuración compartida. Si aquí entrara cualquier parámetro, un simple
  // `?utm_source=x` de un enlace de newsletter mostraría los valores por defecto y al calcular
  // saveInputs() los persistiría, DESTRUYENDO la configuración guardada del usuario.
  // Los parámetros de tracking y diagnóstico (utm_*, fbclid, gclid, ref, debug...) tienen que
  // ser invisibles para el sistema de configuración.
  const SHAREABLE_INPUT_KEYS = Object.freeze(Object.keys(DEFAULTS));
  const params = new URLSearchParams(window.location.search);
  const SERVER_PARAMS = {};
  for (const [key, value] of params.entries()) {
    if (SHAREABLE_INPUT_KEYS.includes(key)) SERVER_PARAMS[key] = value;
  }

  // REFERENCIAS A ELEMENTOS DOM (se inicializan en DOMContentLoaded)
  let el = {
    inputs: {},
    btnCalc: null,
    btnText: null,
    btnSpinner: null,
    statusPill: null,
    statusText: null,
    tarifasUpdated: null,
    errorBox: null,
    errorText: null,
    kwhHint: null,
    heroKpis: null,
    kpiBest: null,
    kpiPrice: null,
    statsBar: null,
    statMin: null,
    statAvg: null,
    statMax: null,
    chartTop: null,
    toolbar: null,
    resultsLiveStatus: null,
    table: null,
    tbody: null,
    emptyBox: null,
    toast: null,
    toastText: null,
    toastDot: null,
    menuRoot: null,
    btnMenu: null,
    menuPanel: null,
    btnTheme: null,
    btnShare: null,
    btnClearCache: null,
    globalTooltip: null,
    pvpcInfo: null,
    viviendaGroup: null
  };

  // ESTADO DE LA APLICACIÓN
  const state = {
    filter: 'all',
    sort: { key: 'totalNum', dir: 'asc' },
    rows: [],
    lastSignature: null,
    debounce: null,
    pending: true,
    // Se incrementa en markPending() (lf-ui.js) cada vez que algo relevante para el
    // calculo cambia: inputs normales, "Mi tarifa" (via scheduleCalculateDebounced desde
    // lf-tarifa-custom.js) o una nueva curva CSV (los inputs que la acompañan disparan el
    // mismo camino). calculate() lo usa para saber si algo cambio DURANTE su propia espera
    // (red, PVPC, render por chunks) sin depender de una firma parcial que podria olvidar
    // un campo economico nuevo.
    generation: 0,
    hasValidationError: false,
    useAnnualConsumptionEstimate: false,
    annualConsumptionEstimateBasis: null,
    focusAnnualConsumptionEstimateToggle: false
  };

  // CACHÉ DE TARIFAS
  let cachedTarifas = [];
  let baseTarifasCache = [];
  let __LF_tarifasMeta = null;

  // ESTADO INICIAL
  let initialStatusText = '';
  let initialStatusClass = '';

  // Inicializar referencias DOM (muta el objeto existente, no reasigna)
  function initElements() {
    // Inputs
    el.inputs = {
      p1: $('p1'),
      p2: $('p2'),
      dias: $('dias'),
      cPunta: $('cPunta'),
      cLlano: $('cLlano'),
      cValle: $('cValle'),
      zonaFiscal: $('zonaFiscal'),
      viviendaCanarias: $('viviendaCanarias'),
      solarOn: $('solarOn'),
      exTotal: $('exTotal'),
      bvSaldo: $('bvSaldo'),
      bonoSocialOn: $('bonoSocialOn')
    };
    
    // Botones y elementos UI
    el.btnCalc = $('btnCalc');
    el.btnText = $('btnText');
    el.btnSpinner = $('btnSpinner');
    el.statusPill = $('statusPill');
    el.statusText = $('statusText');
    el.tarifasUpdated = $('tarifasUpdated');
    el.errorBox = $('errorBox');
    el.errorText = $('errorText');
    el.kwhHint = $('kwhHint');
    el.heroKpis = $('heroKpis');
    el.kpiBest = $('kpiBest');
    el.kpiPrice = $('kpiPrice');
    el.statsBar = $('statsBar');
    el.statMin = $('statMin');
    el.statAvg = $('statAvg');
    el.statMax = $('statMax');
    el.chartTop = $('chartTop');
    el.toolbar = $('toolbar');
    el.resultsLiveStatus = $('resultsLiveStatus');
    el.table = $('table');
    el.tbody = $('tbody');
    el.emptyBox = $('emptyBox');
    el.toast = $('toast');
    el.toastText = $('toastText');
    el.toastDot = $('toastDot');
    el.menuRoot = $('menuRoot');
    el.btnMenu = $('btnMenu');
    el.menuPanel = $('menuPanel');
    el.btnTheme = $('btnTheme');
    el.btnShare = $('btnShare');
    el.btnClearCache = $('btnClearCache');
    el.globalTooltip = $('globalTooltip');
    el.pvpcInfo = $('pvpcInfo');
    el.viviendaGroup = $('viviendaCanariasGroup');
    
    initialStatusText = el.statusText?.textContent || '';
    initialStatusClass = el.statusPill?.className || '';
  }

  // ===== EXPORTAR AL GLOBAL =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    $,
    JSON_URL,
    LS_KEY,
    THEME_KEY,
    TARIFAS_CACHE_KEY,
    DEFAULTS,
    SERVER_PARAMS,
    SHAREABLE_INPUT_KEYS,

    // Getters/setters para estado mutable
    get el() { return el; },
    get state() { return state; },
    get cachedTarifas() { return cachedTarifas; },
    set cachedTarifas(v) { cachedTarifas = v; },
    get baseTarifasCache() { return baseTarifasCache; },
    set baseTarifasCache(v) { baseTarifasCache = v; },
    get __LF_tarifasMeta() { return __LF_tarifasMeta; },
    set __LF_tarifasMeta(v) { __LF_tarifasMeta = v; },
    get initialStatusText() { return initialStatusText; },
    get initialStatusClass() { return initialStatusClass; },
    
    initElements
  });

})();
