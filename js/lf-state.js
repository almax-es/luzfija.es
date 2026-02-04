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
  const TARIFAS_CACHE_TTL = 30 * 1000; // 30 segundos (antes 5 min)

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
  const params = new URLSearchParams(window.location.search);
  const SERVER_PARAMS = {};
  for (const [key, value] of params.entries()) {
    SERVER_PARAMS[key] = value;
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
    btnReset: null,
    btnShare: null,
    btnRefreshTarifas: null,
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
    hasValidationError: false
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
    el.btnReset = $('btnReset');
    el.btnShare = $('btnShare');
    el.btnRefreshTarifas = $('btnRefreshTarifas');
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
    TARIFAS_CACHE_TTL,
    DEFAULTS,
    SERVER_PARAMS,
    
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
