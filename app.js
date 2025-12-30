// ===== LuzFija: modo debug (activar con ?debug=1 o localStorage lf_debug=1) =====
(function () {
  try {
    const params = new URLSearchParams(location.search);
    const debug = params.get('debug') === '1' || localStorage.getItem('lf_debug') === '1';
    window.__LF_DEBUG = Boolean(debug);
  } catch (e) {
    window.__LF_DEBUG = false;
  }
})();

// Helper: log solo si debug está activo (sin tocar console.*)
const lfDbg = (...args) => {
  if (window.__LF_DEBUG && typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(...args);
  }
};
// Exponerlo por si otros módulos lo quieren usar
window.lfDbg = lfDbg;

    const $ = id => document.getElementById(id);

    // URL DEL JSON ESTÁTICO DE TARIFAS EN EL MISMO HOST
    const JSON_URL = 'tarifas.json';

    const LS_KEY = 'almax_comparador_v6_inputs';
    const THEME_KEY = window.__ALMAX_THEME_KEY || 'almax_theme';

    // ===== LAZY LOAD XLSX (SheetJS) =====
    // Solo se carga cuando el usuario sube un archivo Excel
    // Version pineada: 0.20.3 (última estable a diciembre 2025)
    let xlsxLoading = null;
    
    async function ensureXLSX() {
      if (typeof XLSX !== 'undefined') {
        return; // Ya está cargado
      }
      
      // Si ya está cargando, esperar a que termine
      if (xlsxLoading) {
        return xlsxLoading;
      }
      
      xlsxLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        script.crossOrigin = 'anonymous'; // Necesario para SRI
        script.onload = () => {
          lfDbg('[XLSX] Librería cargada bajo demanda');
          resolve();
        };
        script.onerror = () => {
          reject(new Error('Error al cargar librería XLSX'));
        };
        document.head.appendChild(script);
      });
      
      return xlsxLoading;
    }

    // VALORES POR DEFECTO PARA PRIMERA VISITA
    const DEFAULTS = { p1:'3,45', p2:'3,45', dias:'30', cPunta:'100', cLlano:'100', cValle:'100', zonaFiscal:'Península', viviendaCanarias:true, solarOn:false, exTotal:'0', bvSaldo:'0' };

    // RECOGIDA DE PARÁMETROS URL (para enlaces compartidos)
    const params = new URLSearchParams(window.location.search);
    const SERVER_PARAMS = {};
    for (const [key, value] of params.entries()) { SERVER_PARAMS[key] = value; }

    const el = {
      inputs: { p1:$('p1'), p2:$('p2'), dias:$('dias'), cPunta:$('cPunta'), cLlano:$('cLlano'), cValle:$('cValle'), zonaFiscal:$('zonaFiscal'), viviendaCanarias:$('viviendaCanarias'), solarOn:$('solarOn'), exTotal:$('exTotal'), bvSaldo:$('bvSaldo') },
      btnCalc: $('btnCalc'), btnText: $('btnText'), btnSpinner: $('btnSpinner'),
      statusPill: $('statusPill'), statusText: $('statusText'), tarifasUpdated: $('tarifasUpdated'), errorBox: $('errorBox'), errorText: $('errorText'),
      kwhHint: $('kwhHint'), heroKpis: $('heroKpis'), kpiBest: $('kpiBest'), kpiPrice: $('kpiPrice'),
      statsBar: $('statsBar'), statMin: $('statMin'), statAvg: $('statAvg'), statMax: $('statMax'), chartTop: $('chartTop'),
      toolbar: $('toolbar'), table: $('table'), tbody: $('tbody'), emptyBox: $('emptyBox'),
      toast: $('toast'), toastText: $('toastText'), toastDot: $('toastDot'),
      menuRoot: $('menuRoot'), btnMenu: $('btnMenu'), menuPanel: $('menuPanel'), btnTheme: $('btnTheme'),
      btnExport: $('btnExport'), btnReset: $('btnReset'), btnShare: $('btnShare'),
      globalTooltip: $('globalTooltip'),
      pvpcInfo: $('pvpcInfo'),
      viviendaGroup: $('viviendaCanariasGroup')
    };

    const state = { filter: 'all', sort: { key: 'totalNum', dir: 'asc' }, rows: [], lastSignature: null, debounce: null, pending: true, hasValidationError: false };
    let initialStatusText = '';
    let initialStatusClass = '';
    let cachedTarifas = [];
    let baseTarifasCache = [];

    // PVPC: lógica movida a pvpc.js para mantener app.js más limpio

    let activeTooltip = null;
    let tooltipPinned = false;
    let tooltipRaf = null;

    function positionTooltip(target){
      if(!target)return;
      if(tooltipRaf) cancelAnimationFrame(tooltipRaf);
      tooltipRaf = requestAnimationFrame(() => {
        // Verificar si el elemento todavía está visible en viewport
        const rect = target.getBoundingClientRect();
        const isVisible = rect.top >= 0 && 
                         rect.bottom <= window.innerHeight && 
                         rect.left >= 0 && 
                         rect.right <= window.innerWidth;
        
        // Si el elemento salió del viewport y no está pinned, ocultar tooltip
        if (!isVisible && !tooltipPinned) {
          hideTooltip(true);
          return;
        }
        
        const tip = target.getAttribute('data-tip') || '';
        el.globalTooltip.textContent = tip;
        el.globalTooltip.style.display = 'block';
        el.globalTooltip.style.visibility = 'hidden';
        el.globalTooltip.style.opacity = '0';
        el.globalTooltip.setAttribute('aria-hidden', tip ? 'false' : 'true');
        const ttRect = el.globalTooltip.getBoundingClientRect();
        let top = rect.top - ttRect.height - 10;
        if(top < 8) top = rect.bottom + 10;
        let left = rect.left + rect.width / 2 - ttRect.width / 2;
        const maxLeft = window.innerWidth - ttRect.width - 8;
        left = Math.max(8, Math.min(maxLeft, left));
        // Evitar que el tooltip se salga por abajo/arriba en pantallas pequeñas
        const maxTop = window.innerHeight - ttRect.height - 8;
        top = Math.max(8, Math.min(maxTop, top));
        el.globalTooltip.style.top = `${top}px`;
        el.globalTooltip.style.left = `${left}px`;
        el.globalTooltip.style.visibility = 'visible';
        el.globalTooltip.style.opacity = '1';
      });
    }

    function hideTooltip(force=false){
      if(!force && tooltipPinned)return;
      el.globalTooltip.style.display = 'none';
      el.globalTooltip.setAttribute('aria-hidden','true');
      activeTooltip = null;
      tooltipPinned = false;
    }

    function openTooltip(target){
      activeTooltip = target;
      positionTooltip(target);
    }

    // FIX: tooltips dinámicos e idempotentes
    function bindTooltipElement(t){
      if(!t || t.__LF_TT_BOUND) return;
      t.__LF_TT_BOUND = true;
      t.addEventListener('mouseenter', () => { tooltipPinned = false; openTooltip(t); }, {passive:true});
      t.addEventListener('mouseleave', () => { if(tooltipPinned && activeTooltip===t)return; hideTooltip(); }, {passive:true});
      t.addEventListener('focus', () => { tooltipPinned = false; openTooltip(t); });
      t.addEventListener('blur', () => hideTooltip(true));
      t.addEventListener('click', (evt) => {
        // Evita que el click "active" el label asociado (si el tooltip está dentro de un <label>)
        // y a la vez mantiene el tooltip accesible por teclado.
        evt.preventDefault();
        evt.stopPropagation();
        if(activeTooltip===t && tooltipPinned){ hideTooltip(true); return; }
        tooltipPinned = true;
        openTooltip(t);
      });
      t.addEventListener('keydown', (evt) => {
        if(evt.key==='Enter' || evt.key===' '){ evt.preventDefault(); t.click(); }
      });
    }

    function initTooltips(){
      document.querySelectorAll('.tooltip').forEach(bindTooltipElement);

      if(!document.__LF_TT_GLOBAL_BOUND){
        document.__LF_TT_GLOBAL_BOUND = true;
        document.addEventListener('click', (evt) => {
          if(!tooltipPinned)return;
          if(!evt.target.closest('.tooltip')) hideTooltip(true);
        });

        window.addEventListener('scroll', () => { if(activeTooltip) positionTooltip(activeTooltip); }, {capture:true, passive:true});
        window.addEventListener('resize', () => { if(activeTooltip) positionTooltip(activeTooltip); }, {passive:true});
        document.addEventListener('keydown', (evt) => { if(evt.key==='Escape') hideTooltip(true); });
      }
    }

    function parseNum(str){
      if(str===null||str===undefined)return 0;
      if(typeof str==='number')return Number.isFinite(str)?str:0;
      let s=String(str).trim().replace(/\s/g,'');
      if(!s)return 0;
      if(s.includes(',')&&s.includes('.')){
        const lc=s.lastIndexOf(',');
        const ld=s.lastIndexOf('.');
        if(lc>ld)s=s.replace(/\./g,'').replace(',','.');
        else s=s.replace(/,/g,'');
      }
      else if(s.includes(',')){s=s.replace(',','.');}
      s=s.replace(/[^\d.-]/g,'');
      const n=Number(s);
      return Number.isFinite(n)?n:0;
    }

    function escapeHtml(v){
      return String(v??'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');
    }

    function applyButtonState(isLoading){
      const disabled = isLoading || state.hasValidationError;
      el.btnCalc.disabled = disabled;
      if(isLoading) el.btnCalc.classList.add('calculating');
      else el.btnCalc.classList.remove('calculating');
    }

    function setStatus(text, mode='idle'){
      el.statusText.textContent=text;
      el.statusPill.classList.remove('loading','ok','err');
      if(mode==='loading')el.statusPill.classList.add('loading');
      if(mode==='ok')el.statusPill.classList.add('ok');
      if(mode==='err')el.statusPill.classList.add('err');
      // FIX: limpiar animación cuando no está cargando
      if(mode !== 'loading' && el.btnCalc){
        el.btnCalc.classList.remove('calculating');
        el.btnCalc.style.setProperty('--progress-width', '0%');
      }
      const l=mode==='loading';
      applyButtonState(l);
      el.btnText.style.display=l?'none':'flex';
      el.btnSpinner.style.display=l?'flex':'none';
    }

    function markPending(message='Cambios pendientes. Pulsa Calcular para actualizar.'){
      state.pending=true;
      setStatus(message,'idle');
    }

    function hideResultsToInitialState(){
      // Oculta cualquier resultado visible devolviendo la UI al estado vacío
      const fades=document.querySelectorAll('.fade-container');
      if(fades.length){ fades.forEach(c=>c.classList.remove('show')); }
      ['heroKpis','statsBar','chartTop','toolbar','table','emptyBox'].forEach(id=>{ const block=document.getElementById(id); if(block) block.classList.remove('show'); });
      if(el.heroKpis) el.heroKpis.classList.remove('show');
      if(el.statsBar) el.statsBar.classList.remove('show');
      if(el.table) el.table.classList.remove('show');
      if(el.toolbar) el.toolbar.classList.remove('show');
      if(el.chartTop){
        el.chartTop.classList.remove('show');
        el.chartTop.style.display='none';
      }
      const chartBody=document.getElementById('chartTopBody');
      if(chartBody){
        chartBody.innerHTML='';
      }
      document.querySelectorAll('.chartTop-barFill, .chartTop-barTrack, .chartTop-row').forEach(node=>node.remove());
      if(el.tbody) el.tbody.replaceChildren();
      if(el.emptyBox) el.emptyBox.classList.remove('show');
      if(el.pvpcInfo) el.pvpcInfo.innerHTML='';
      const seoFold=document.getElementById('info');
      if(seoFold) seoFold.classList.remove('show');
      state.rows=[];
      state.lastSignature=null;
    }

    function toast(msg, mode='ok'){
      el.toastText.textContent=msg;
      el.toastDot.classList.remove('ok','err');
      el.toastDot.classList.add(mode==='err'?'err':'ok');
      el.toast.classList.add('show');
      clearTimeout(el.toast._t);
      el.toast._t=setTimeout(()=>el.toast.classList.remove('show'),2800);
    }

    function showError(msg=''){
      if(!el.errorBox)return;
      el.errorText.textContent=msg;
      el.errorBox.classList.toggle('show',Boolean(msg));
    }

    function applyThemeClass(theme){
      const isLight=theme==='light';
      document.documentElement.classList.toggle('light-mode',isLight);
      if(document.body)document.body.classList.toggle('light-mode',isLight);
    }

    function updateThemeIcon(){
      if(!el.btnTheme)return;
      const isLight=document.body.classList.contains('light-mode');
      el.btnTheme.textContent=isLight?'🌙':'☀️';
    }

    const initialTheme=(window.__ALMAX_THEME_SAVED==='light')?'light':'dark';
    applyThemeClass(initialTheme);
    updateThemeIcon();

    function toggleTheme(){
      const isLight=document.body.classList.contains('light-mode');
      const next=isLight?'dark':'light';
      applyThemeClass(next==='light'?'light':'dark');
      try{localStorage.setItem(THEME_KEY,next);}catch(e){}
      updateThemeIcon();
      toast(next==='light'?'Modo claro':'Modo oscuro');
    }

    async function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      return true;
    }

    // ===== CACHÉ ROBUSTA TARIFAS.JSON (memoria + localStorage + TTL) =====
    const TARIFAS_CACHE_KEY = 'luzfija_tarifas_v1';
    const TARIFAS_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

    function readTarifasCache(opts){
      const allowExpired = Boolean(opts && opts.allowExpired);
      try{
        const raw = localStorage.getItem(TARIFAS_CACHE_KEY);
        if(!raw) return null;

        const parsed = JSON.parse(raw);
        const data = parsed && parsed.data;
        const ts = (parsed && parsed.timestamp) ? Number(parsed.timestamp) : 0;

        if(!Array.isArray(data) || !data.length) return null;

        const age = Date.now() - ts;
        const expired = age > TARIFAS_CACHE_TTL;

        if(expired && !allowExpired) return null;

        return { data, expired, ageMs: age, meta: parsed };
      }catch(e){
        return null;
      }
    }

    function writeTarifasCache(tarifas, meta){
      try{
        const payload = Object.assign({}, meta || {}, {
          data: tarifas,
          timestamp: Date.now()
        });
        localStorage.setItem(TARIFAS_CACHE_KEY, JSON.stringify(payload));
      }catch(e){}
    }

    let __LF_tarifasMeta = null;

    function renderTarifasUpdated(meta){
      if(!el.tarifasUpdated) return;
      const m = meta || __LF_tarifasMeta || null;

      // Fuente de verdad (preferir updatedAt si existe)
      const iso = m && (m.updatedAt || m.updated_at || m.publishedAt || m.published_at || m.srcPublishedAt || m.tarifasPublishedAt || null);

      if(!iso){
        el.tarifasUpdated.textContent = 'Tarifas: sin fecha de actualización';
        el.tarifasUpdated.title = '';
        return;
      }

      const dt = new Date(iso);
      if(!Number.isFinite(dt.getTime())){
        el.tarifasUpdated.textContent = 'Tarifas: sin fecha de actualización';
        el.tarifasUpdated.title = '';
        return;
      }

      // Texto discreto, formato ES (solo fecha)
      const fmt = new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit'
      });

      el.tarifasUpdated.textContent = 'Actualizado el ' + fmt.format(dt);
      el.tarifasUpdated.title = 'Última actualización del listado de tarifas: ' + iso;
    }



    async function fetchTarifas(forceRefresh = false, opts) {
      const silent = Boolean(opts && opts.silent);
      // 0) Prioridad: memoria (baseTarifasCache)
      if (!forceRefresh && Array.isArray(baseTarifasCache) && baseTarifasCache.length > 0) {
        // ya tenemos datos en memoria; si hay meta, pintarla
        renderTarifasUpdated(__LF_tarifasMeta);
        return true;
      }

      // 1) Prioridad: localStorage (válido)
      if (!forceRefresh) {
        const cached = readTarifasCache({ allowExpired: false });
        if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
          baseTarifasCache = cached.data;
          __LF_tarifasMeta = cached.meta || null;
          renderTarifasUpdated(__LF_tarifasMeta);
          // Si la caché ya incluye una marca de actualización, no hace falta ir a red
          if (__LF_tarifasMeta && (
            __LF_tarifasMeta.updatedAt || __LF_tarifasMeta.updated_at ||
            __LF_tarifasMeta.publishedAt || __LF_tarifasMeta.published_at ||
            __LF_tarifasMeta.srcPublishedAt || __LF_tarifasMeta.tarifasPublishedAt
          )) {
            return true;
          }
          // Continuar a red para enriquecer meta

        }
      }

      // 2) Red
      if(!silent) setStatus('Cargando tarifas...', 'loading');

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        // Query-buster SOLO si forzamos refresh manual
        const url = forceRefresh ? `${JSON_URL}?v=${Date.now()}` : JSON_URL;

        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'default'
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('HTTP ' + response.status);

        const data = await response.json();
        const tarifas = Array.isArray(data.tarifas) ? data.tarifas : null;

        if (!tarifas || tarifas.length === 0) {
          throw new Error('JSON sin tarifas válidas');
        }

        baseTarifasCache = tarifas;

        // Persistir para recargas/pestañas
        const __updatedAt = data.updatedAt || data.updated_at || data.publishedAt || data.published_at || data.timestamp || null;
        __LF_tarifasMeta = { updatedAt: __updatedAt };
        
        renderTarifasUpdated(__LF_tarifasMeta);
        writeTarifasCache(tarifas, __LF_tarifasMeta);

        if(!silent){
          setStatus('Datos actualizados', 'ok');
          setTimeout(() => setStatus('Listo para calcular', 'idle'), 1500);
        }
        return true;

      } catch (e) {
        // 3) Fallback: usar caché expirada si hay problemas de red
        const cached = readTarifasCache({ allowExpired: true });
        if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
          baseTarifasCache = cached.data;
          __LF_tarifasMeta = cached.meta || null;
          renderTarifasUpdated(__LF_tarifasMeta);
          if(!silent){
            toast('Sin conexión: usando tarifas cacheadas', 'err');
            setStatus('Tarifas cacheadas', 'err');
          }
          return true;
        }

        lfDbg('[ERROR] Error cargando tarifas JSON:', e);
        if(!silent){
          setStatus('Error conexión', 'err');
          toast('Error cargando tarifas desde el servidor.', 'err');
        }
        return false;
      }
    }

    function formatMoney(n) { return n.toFixed(2).replace('.', ',') + ' €'; }

    function clamp01to365Days(raw){
      const d = Math.trunc(raw);
      if(!Number.isFinite(d) || d === 0) return 30;
      return Math.min(365, Math.max(1, d));
    }

    function clampNonNeg(n){ return Math.max(0, Number(n) || 0); }

    /* Redondeo a 2 decimales (como Excel ROUND(...,2)) */
    function round2(x){ return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }


    function __LF_getFiscalContext(values){
      const v = values || getInputValues();
      const zona = (v?.zonaFiscal || '').toLowerCase() === 'canarias' ? 'canarias' : 'península';
      const p1Num = clampNonNeg(parseNum(v?.p1));
      const p2Num = clampNonNeg(parseNum(v?.p2));
      const potenciaContratada = Math.max(p1Num || 0, p2Num || 0);
      const esCanarias = (zona === 'canarias');
      const viviendaMarcada = Boolean(v?.viviendaCanarias);
      const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
      const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';

      return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal };
    }

    function getInputValues() {
      const p1 = clampNonNeg(parseNum(el.inputs.p1.value));
      const p2 = clampNonNeg(parseNum(el.inputs.p2.value));
      const dias = clamp01to365Days(parseNum(el.inputs.dias.value));
      const cPunta = clampNonNeg(parseNum(el.inputs.cPunta.value));
      const cLlano = clampNonNeg(parseNum(el.inputs.cLlano.value));
      const cValle = clampNonNeg(parseNum(el.inputs.cValle.value));
      const zonaFiscal = el.inputs.zonaFiscal?.value === 'Canarias' ? 'Canarias' : 'Península';
      const viviendaCanarias = Boolean(el.inputs.viviendaCanarias?.checked);
      const solarOn = Boolean(el.inputs.solarOn?.checked);
      const exTotal = clampNonNeg(parseNum(el.inputs.exTotal?.value));
      const bvSaldo = clampNonNeg(parseNum(el.inputs.bvSaldo?.value));
      return { p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias, solarOn, exTotal, bvSaldo };
    }

    function signatureFromValues(v) {
      return [v.p1, v.p2, v.dias, v.cPunta, v.cLlano, v.cValle, v.zonaFiscal, v.viviendaCanarias ? '1' : '0', v.solarOn ? '1' : '0', v.exTotal, v.bvSaldo].join('|');
    }

    function getFvExcPrice(fv){
      if(!fv) return 0;
      const raw = fv.exc;
      if(typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
      // Si es 'INDEXADA', devolvemos null para marcarla como no calculable
      if(typeof raw === 'string' && raw.toUpperCase() === 'INDEXADA') return null;
      return 0;
    }

    async function calculateLocal(values) {
      const { p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias, solarOn, exTotal, bvSaldo } = values || getInputValues();
      const fiscal = typeof __LF_getFiscalContext === 'function'
        ? __LF_getFiscalContext({ p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias })
        : (() => {
          const zona = (zonaFiscal || '').toLowerCase() === 'canarias' ? 'canarias' : 'península';
          const potenciaContratada = Math.max(clampNonNeg(parseNum(p1)), clampNonNeg(parseNum(p2)));
          const esCanarias = zona === 'canarias';
          const viviendaMarcada = Boolean(viviendaCanarias);
          const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
          const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';
          return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal };
        })();
      const isCanarias = fiscal.zona === 'canarias';
      if(!cachedTarifas.length) return;

      // OPTIMIZACIÓN INP: Calcular en chunks de 8 tarifas para no bloquear el hilo
      const CHUNK_SIZE = 8;
      const resultados = [];
      
      for (let chunkStart = 0; chunkStart < cachedTarifas.length; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, cachedTarifas.length);
        
        for (let index = chunkStart; index < chunkEnd; index++) {
          const t = cachedTarifas[index];
          
          if (t.esPVPC && t.pvpcNotComputable) {
            resultados.push({
              ...t,
              posicion: index + 1,
              potenciaNum: 0,
              potencia: '—',
              consumoNum: 0,
              consumo: '—',
              impuestosNum: 0,
              impuestos: '—',
              totalNum: Number.POSITIVE_INFINITY,
              total: '—',
              webUrl: t.web,
              solarNoCalculable: solarOn
            });
            continue;
          }
          
          if (t.esPVPC && t.metaPvpc) {
            const m = t.metaPvpc;
            const potenciaNum = m.terminoFijo;
            const consumoNum = m.terminoVariable;
            const impuestosNum = (m.bonoSocial || 0) + m.impuestoElectrico + m.equipoMedida + m.iva;
            const totalNum = m.totalFactura;
            resultados.push({
              ...t,
              posicion: index + 1,
              potenciaNum,
              potencia: formatMoney(potenciaNum),
              consumoNum,
              consumo: formatMoney(consumoNum),
              impuestosNum,
              impuestos: formatMoney(impuestosNum),
              totalNum,
              total: formatMoney(totalNum),
              webUrl: t.web,
              solarNoCalculable: solarOn
            });
            continue;
          }

          const pot = round2((p1 * dias * t.p1) + (p2 * dias * t.p2));
          const cons = round2((cPunta * t.cPunta) + (cLlano * t.cLlano) + (cValle * t.cValle));
          const tarifaAcceso = round2(4.650987 / 365 * dias);

          let consAdj = cons;
          let tarifaAdj = tarifaAcceso;
          let credit1 = 0;
          let credit2 = 0;
          let excedenteSobranteEur = 0;
          let precioExc = 0;
          let exKwh = 0;
          let bvSaldoFin = null;
          const fv = t.fv;
          let fvApplied = false;

          let solarNoCalculable = false;
          if(solarOn && t.esPVPC){
            solarNoCalculable = true;
          } else if(solarOn && !t.esPVPC){
            exKwh = clampNonNeg(exTotal);
            if(fv && fv.tipo !== 'NO COMPENSA'){
              precioExc = getFvExcPrice(fv);
              if(precioExc === null){
                solarNoCalculable = true;
              } else if(exKwh > 0 && precioExc > 0){
                fvApplied = true;
                const creditoPotencial = round2(exKwh * precioExc);
                let baseCompensable = cons;
                if(fv.tope === 'ENERGIA + PEAJES + CARGOS') baseCompensable = cons + tarifaAcceso;
                else if(fv.tope === 'ENERGIA') baseCompensable = cons;
                credit1 = Math.min(creditoPotencial, baseCompensable);
                consAdj = round2(Math.max(0, cons - credit1));
                const restante = Math.max(0, credit1 - cons);
                if(fv.tope === 'ENERGIA + PEAJES + CARGOS'){
                  tarifaAdj = round2(Math.max(0, tarifaAcceso - restante));
                }
                excedenteSobranteEur = Math.max(0, creditoPotencial - credit1);
              }
            }
          }

          const sumaBase = pot + consAdj + tarifaAdj;
          const impuestoElec = round2(Math.max((5.11269632 / 100) * sumaBase, (cPunta + cLlano + cValle) * 0.001));
          const margen = round2(dias * 0.026667);
          const baseEnergia = sumaBase + margen;
          const subtotal = baseEnergia + impuestoElec;
          const ivaBase = pot + consAdj + tarifaAdj + impuestoElec + margen;

          if (isCanarias) {
            const alquilerContador = dias * (0.81 / 30);
            const igicBase = fiscal.usoFiscal === 'vivienda' ? 0 : (baseEnergia + impuestoElec) * 0.03;
            const igicContador = alquilerContador * 0.07;
            const impuestosNum = impuestoElec + igicBase + igicContador;
            const totalBase = baseEnergia + impuestoElec + igicBase + igicContador + alquilerContador;

            let totalFinal = totalBase;
            if(solarOn && fv && fv.bv && fv.tipo === 'SIMPLE + BV'){
              let disponible = bvSaldo;
              let excedenteParaBv = excedenteSobranteEur;
              if(fv.reglaBV === 'MES ACTUAL + BV'){
                if((t.nombre || '').toLowerCase().includes('octopus')){
                  excedenteParaBv = Math.min(excedenteParaBv, round2(1000 * precioExc));
                }
                disponible = bvSaldo + excedenteParaBv;
              }
              credit2 = Math.min(clampNonNeg(disponible), totalBase);
              if(fv.reglaBV === 'BV MES ANTERIOR') bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bvSaldo - credit2));
              else if(fv.reglaBV === 'MES ACTUAL + BV') bvSaldoFin = round2(Math.max(0, (excedenteSobranteEur + bvSaldo) - credit2));
              else bvSaldoFin = null;
              totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
            }

            const totalNum = solarOn && fv && fv.bv
              ? round2(Math.max(0, totalBase - excedenteSobranteEur))
              : totalBase;
            resultados.push({
              ...t,
              posicion: index + 1,
              potenciaNum: pot, potencia: formatMoney(pot),
              consumoNum: consAdj, consumo: formatMoney(consAdj),
              impuestosNum: impuestosNum,
              impuestos: formatMoney(impuestosNum),
              totalNum, total: formatMoney(totalNum),
              webUrl: t.web,
              iva: 0,
              fvTipo: fv ? fv.tipo || null : null,
              fvExcRaw: fv ? fv.exc : null,
              fvRegla: fv ? fv.reglaBV || null : null,
              fvApplied,
              fvExKwh: exKwh,
              fvPriceUsed: precioExc,
              fvCredit1: credit1,
              fvCredit2: credit2,
              fvBvSaldoFin: bvSaldoFin,
              fvExcedenteSobrante: excedenteSobranteEur,
              fvTotalFinal: totalFinal,
              solarNoCalculable
            });
          } else {
            const iva = round2(ivaBase * 0.21);
            const totalBase = round2(ivaBase + iva);

            let totalFinal = totalBase;
            if(solarOn && fv && fv.bv && fv.tipo === 'SIMPLE + BV'){
              let disponible = bvSaldo;
              let excedenteParaBv = excedenteSobranteEur;
              if(fv.reglaBV === 'MES ACTUAL + BV'){
                if((t.nombre || '').toLowerCase().includes('octopus')){
                  excedenteParaBv = Math.min(excedenteParaBv, round2(1000 * precioExc));
                }
                disponible = bvSaldo + excedenteParaBv;
              }
              credit2 = Math.min(clampNonNeg(disponible), totalBase);
              if(fv.reglaBV === 'BV MES ANTERIOR') bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bvSaldo - credit2));
              else if(fv.reglaBV === 'MES ACTUAL + BV') bvSaldoFin = round2(Math.max(0, (excedenteSobranteEur + bvSaldo) - credit2));
              else bvSaldoFin = null;
              totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
            }

            const total = solarOn && fv && fv.bv
              ? round2(Math.max(0, totalBase - excedenteSobranteEur))
              : totalBase;

            resultados.push({
              ...t,
              posicion: index + 1,
              potenciaNum: pot, potencia: formatMoney(pot),
              consumoNum: consAdj, consumo: formatMoney(consAdj),
              impuestosNum: round2(tarifaAdj + impuestoElec + margen + iva),
              impuestos: formatMoney(round2(tarifaAdj + impuestoElec + margen + iva)),
              totalNum: total, total: formatMoney(total),
              webUrl: t.web,
              fvTipo: fv ? fv.tipo || null : null,
              fvExcRaw: fv ? fv.exc : null,
              fvRegla: fv ? fv.reglaBV || null : null,
              fvApplied,
              fvExKwh: exKwh,
              fvPriceUsed: precioExc,
              fvCredit1: credit1,
              fvCredit2: credit2,
              fvBvSaldoFin: bvSaldoFin,
              fvExcedenteSobrante: excedenteSobranteEur,
              fvTotalFinal: totalFinal,
              solarNoCalculable
            });
          }
        }
        
        // CLAVE: Yield al navegador después de cada chunk (excepto el último)
        if (chunkEnd < cachedTarifas.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      resultados.sort((a, b) => {
        const diff = a.totalNum - b.totalNum;
        // Si ambas tienen el mismo precio (especialmente si es 0€)
        // Redondear diff a 2 decimales para evitar floating point errors
        if(Math.abs(Math.round(diff * 100) / 100) < 0.01){
          // Desempatar por saldo BV final (mayor es mejor)
          const bvA = Number(a.fvBvSaldoFin) || 0;
          const bvB = Number(b.fvBvSaldoFin) || 0;
          return bvB - bvA; // Mayor BV primero
        }
        return diff;
      });

      // Filtrar tarifas que requieren FV si usuario no tiene solar PRIMERO
      let resultadosFiltrados = resultados;
      if (!solarOn) {
        resultadosFiltrados = resultados.filter(r => !r.requiereFV);
      }

      const firstValida = resultadosFiltrados.find(r => Number.isFinite(r.totalNum)) || resultadosFiltrados[0];
      const bestPrice = firstValida ? firstValida.totalNum : 0;
      let processed = resultadosFiltrados.map((r, i) => {
        const esMejor = firstValida ? r === firstValida : i === 0;
        const diff = (Number.isFinite(r.totalNum) && Number.isFinite(bestPrice)) ? (r.totalNum - bestPrice) : Number.POSITIVE_INFINITY;
        return {
          ...r, posicion: i + 1, esMejor,
          vsMejorNum: diff, vsMejor: esMejor ? '—' : (Number.isFinite(diff) ? '+' + formatMoney(diff) : '—')
        };
      });

      const preciosValidos = processed.filter(r => Number.isFinite(r.totalNum)).map(r => r.totalNum);
      const min = preciosValidos.length ? Math.min(...preciosValidos) : null;
      const max = preciosValidos.length ? Math.max(...preciosValidos) : null;
      const avg = preciosValidos.length ? (preciosValidos.reduce((a,b)=>a+b,0) / preciosValidos.length) : null;

      renderAll({
        success: true,
        resumen: { mejor: firstValida ? firstValida.nombre : (processed[0]?.nombre || '—'), precio: (firstValida && Number.isFinite(firstValida.totalNum)) ? formatMoney(firstValida.totalNum) : '—' },
        stats: preciosValidos.length ? { precioMin: formatMoney(min), precioMax: formatMoney(max), precioMedio: formatMoney(avg) } : null,
        resultados: processed
      });
    }

    function formatValueForDisplay(val) {
      // Convierte valores numéricos para mostrar con coma
      if (val == null || val === '') return val;
      const str = String(val);
      // Si ya tiene coma, dejarlo
      if (str.includes(',')) return str;
      // Si tiene punto, convertir a coma
      if (str.includes('.')) return str.replace('.', ',');
      return str;
    }

    function asBool(val, fallback=false){
      if(val === undefined || val === null) return fallback;
      if(typeof val === 'boolean') return val;
      const s=String(val).trim().toLowerCase();
      if(['true','1','si','sí','yes'].includes(s)) return true;
      if(['false','0','no'].includes(s)) return false;
      return fallback;
    }

    function migrateExcedentes(data){
      if(!data || typeof data !== 'object') return data;
      const hasExTotal = data.exTotal !== undefined && data.exTotal !== null && data.exTotal !== '';
      const exP = data.exPunta, exL = data.exLlano, exV = data.exValle;
      if(!hasExTotal && (exP !== undefined || exL !== undefined || exV !== undefined)){
        const sum = round2(clampNonNeg(parseNum(exP)) + clampNonNeg(parseNum(exL)) + clampNonNeg(parseNum(exV)));
        data.exTotal = String(sum);
      }
      return data;
    }

    function updateZonaFiscalUI(){
      const zona = el.inputs.zonaFiscal?.value === 'Canarias' ? 'Canarias' : 'Península';
      const isCanarias = zona === 'Canarias';
      if(el.viviendaGroup){
        el.viviendaGroup.style.display = isCanarias ? 'flex' : 'none';
      }
    }

    function loadInputs() {
      // Detectar si viene de restablecer
      const urlParams = new URLSearchParams(window.location.search);
      const isReset = urlParams.get('reset') === '1';

      if (isReset) {
        try { localStorage.removeItem(LS_KEY); } catch(e){}
        try { sessionStorage.removeItem(LS_KEY); } catch(e){}
        // Limpiar URL sin recargar
        window.history.replaceState({}, '', window.location.pathname);
        // Usar solo DEFAULTS, ignorar localStorage
        for (const k in DEFAULTS){
          if(!el.inputs[k]) continue;
          if(el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(DEFAULTS[k], DEFAULTS[k]);
          else el.inputs[k].value = formatValueForDisplay(DEFAULTS[k]);
        }
        updateKwhHint();
        updateZonaFiscalUI();
        updateSolarUI();
        return;
      }
      
      if (Object.keys(SERVER_PARAMS).length > 0) {
        const d = migrateExcedentes(Object.assign({}, DEFAULTS, SERVER_PARAMS));
        for(const k in DEFAULTS){
          if(!el.inputs[k]) continue;
          if(el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(d[k], DEFAULTS[k]);
          else el.inputs[k].value = formatValueForDisplay(d[k]);
        }
        updateKwhHint();
        updateZonaFiscalUI();
        updateSolarUI();
        return;
      }
      let savedData = {};
      try { const r = localStorage.getItem(LS_KEY); if (r) savedData = JSON.parse(r); } catch(e){}
      savedData = migrateExcedentes(savedData);
      const finalData = migrateExcedentes({ ...DEFAULTS, ...savedData });
      for (const k in DEFAULTS){
        if(!el.inputs[k]) continue;
        if(el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(finalData[k], DEFAULTS[k]);
        else el.inputs[k].value = formatValueForDisplay(finalData[k]);
      }
      updateKwhHint();
      updateZonaFiscalUI();
      updateSolarUI();
    }

    function saveInputs(){
      const d={};
      for(const k in DEFAULTS){
        if(!el.inputs[k]) continue;
        d[k]=el.inputs[k].type === 'checkbox' ? Boolean(el.inputs[k].checked) : el.inputs[k].value;
      }
      try { localStorage.setItem(LS_KEY,JSON.stringify(d)); } catch(e){}
      return d;
    }

    function resetInputs(){
      for(const k in DEFAULTS){
        if(!el.inputs[k]) continue;
        if(el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(DEFAULTS[k], false);
        else el.inputs[k].value=formatValueForDisplay(DEFAULTS[k]);
      }
      saveInputs();
      updateKwhHint();
      updateZonaFiscalUI();
      updateSolarUI();
      clearErrorStyles();
      validateInputs();
      markPending('Valores restablecidos. Pulsa Calcular para actualizar.');
      toast('Restablecido');
    }

    function resetToFirstLoadState(){
      // Restablece inputs, filtros y UI al mismo estado que al cargar la página
      const form=document.querySelector('form');
      if(form) form.reset();
      else resetInputs();

      clearErrorStyles();
      showError('');

      updateKwhHint();
      updateZonaFiscalUI();
      updateSolarUI();
      validateInputs();
      saveInputs();

      hideResultsToInitialState();

      if(initialStatusText) el.statusText.textContent=initialStatusText;
      if(initialStatusClass) el.statusPill.className=initialStatusClass;

      applyButtonState(false);

      // FIX: eliminar barra de progreso DESPUÉS de applyButtonState
      if(el.btnCalc){
        el.btnCalc.classList.remove('calculating');
        void el.btnCalc.offsetWidth;
        // Forzar eliminación del ::before con width
        el.btnCalc.style.setProperty('--progress-width', '0%');
      }

      state.pending=true;

      state.filter='all';
      document.querySelectorAll('.fbtn').forEach(b=>{
        b.classList.toggle('active', b.getAttribute('data-filter')==='all');
      });
      state.sort={key:'totalNum',dir:'asc'};
      updateSortIcons();

      if(el.emptyBox) el.emptyBox.classList.remove('show');
      if(el.tbody) el.tbody.replaceChildren();
    }

    function updateKwhHint(){
      const v = getInputValues();
      const t = v.cPunta + v.cLlano + v.cValle;
      const ex = v.exTotal;
      const tStr = t.toFixed(2).replace('.', ',');
      const exStr = ex.toFixed(2).replace('.', ',');
      if(v.solarOn){
        el.kwhHint.innerHTML = `
          <div class="kwh-split">
            <div class="kwh-pill">
              <span class="kwh-label">Red</span>
              <span class="kwh-value">${tStr}</span>
              <span class="kwh-unit">kWh</span>
            </div>
            <div class="kwh-pill">
              <span class="kwh-label">Exced.</span>
              <span class="kwh-value">${exStr}</span>
              <span class="kwh-unit">kWh</span>
            </div>
          </div>`;
      } else {
        el.kwhHint.textContent=`${tStr} kWh`;
      }
    }

    function updateSolarUI(){
      const box = document.getElementById('solarFields');
      if(!box) return;
      const on = Boolean(el.inputs.solarOn?.checked);
      box.style.display = on ? '' : 'none';
      
      // Inicializar modal solar info cuando se muestra por primera vez
      if(on && !window.__solarInfoInitialized){
        window.__solarInfoInitialized = true;
        const modalSolarInfo = $('modalSolarInfo');
        const btnSolarInfo = $('btnSolarInfo');
        const btnCerrarSolarInfo = $('btnCerrarSolarInfo');
        const btnCerrarSolarX = $('btnCerrarSolarX');

        // Scroll lock suave (sin interferir con otros modales)
        let __solarLocked = false;
        let __solarScrollY = 0;
        function __solarLock(){
          if (document.documentElement.style.overflow === 'hidden') return;
          __solarScrollY = window.scrollY || 0;
          document.documentElement.style.overflow = 'hidden';
          __solarLocked = true;
        }
        function __solarUnlock(){
          if (!__solarLocked) return;
          document.documentElement.style.overflow = '';
          window.scrollTo(0, __solarScrollY);
          __solarLocked = false;
        }

        if(btnSolarInfo && modalSolarInfo && btnCerrarSolarInfo){
          btnSolarInfo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modalSolarInfo.style.display = 'flex';
            modalSolarInfo.classList.add('show');
            modalSolarInfo.setAttribute('aria-hidden', 'false');
            __solarLock();
          });
          
          btnCerrarSolarX?.addEventListener('click', () => {
            modalSolarInfo.classList.remove('show');
            setTimeout(() => { modalSolarInfo.style.display = 'none'; }, 200);
            modalSolarInfo.setAttribute('aria-hidden', 'true');
            __solarUnlock();
          });

          btnCerrarSolarInfo.addEventListener('click', () => {
            modalSolarInfo.classList.remove('show');
            setTimeout(() => {
              modalSolarInfo.style.display = 'none';
            }, 200);
            modalSolarInfo.setAttribute('aria-hidden', 'true');
            __solarUnlock();
          });
          
          document.addEventListener('keydown', (e) => {
            if(e.key === 'Escape' && modalSolarInfo.classList.contains('show')){
              modalSolarInfo.classList.remove('show');
              setTimeout(() => { modalSolarInfo.style.display = 'none'; }, 200);
              modalSolarInfo.setAttribute('aria-hidden', 'true');
              __solarUnlock();
            }
          });

          // Cerrar al hacer clic fuera del modal
          modalSolarInfo.addEventListener('click', (e) => {
            if(e.target === modalSolarInfo){
              modalSolarInfo.classList.remove('show');
              setTimeout(() => {
                modalSolarInfo.style.display = 'none';
              }, 200);
              modalSolarInfo.setAttribute('aria-hidden', 'true');
              __solarUnlock();
            }
          });
        } else {
          lfDbg('[DEBUG] Faltan elementos del modal');
        }
      }
    }

    function validateInputs(){
      clearErrorStyles();
      let message='';

      const diasRaw=String(el.inputs.dias.value||'').trim();
      const diasNum=parseNum(el.inputs.dias.value);
      if(!diasRaw){
        message='Introduce los días de facturación (1-365).';
        el.inputs.dias.classList.add('error');
      } else if(!Number.isFinite(diasNum) || diasNum<=0){
        message='Los días deben ser un número entre 1 y 365.';
        el.inputs.dias.classList.add('error');
      }

      state.hasValidationError=Boolean(message);
      if(message) showError(message); else showError('');
      applyButtonState(false);
      return !state.hasValidationError;
    }

    function clearErrorStyles(){ Object.values(el.inputs).forEach(i=>{ if(!i)return; i.classList.remove('error'); }); }

    function rowTipoBadge(t){
      const s=String(t||'').trim();
      if(s==='1P')return `<span class="badge b1">1P</span>`;
      if(s==='3P')return `<span class="badge b3">3P</span>`;
      return `<span class="badge">${escapeHtml(s||'—')}</span>`;
    }

    function formatVsWithBar(v,vn){
      const s=String(v??'').trim();
      if(!s||s==='—'||s==='0'||s==='0,00'||s==='0 €'||s==='0,00 €')return '<span class="vs-text zero">—</span>';
      const pos=s.startsWith('+');
      const c=pos?'pos':'neg';
      // Removed inline arrow to save horizontal space; only show +X,XX €.
      return `<span class="vs-text ${c}">${escapeHtml(s)}</span>`;
    }

    function applyFilters(r){
      const f=state.filter;
      return r.filter(x=>(f==='all'||String(x.tipo||'')===f));
    }

    function applySort(r){
      const {key,dir}=state.sort;
      const asc=dir==='asc';
      const c=r.slice();
      c.sort((a,b)=>{
        const va=a[key],vb=b[key];
        if(key==='nombre'){
          const sa=String(va||'').toLowerCase(),sb=String(vb||'').toLowerCase();
          if(sa>sb)return asc?1:-1;
          if(sa<sb)return asc?-1:1;
          return 0;
        }
        const na=Number(va)||0,nb=Number(vb)||0;
        if(na>nb)return asc?1:-1;
        if(na<nb)return asc?-1:1;
        
        // DESEMPATE: Si totalNum (ranking) es igual, ordenar por totalFinal (lo que pagas)
        if(key==='totalNum'){
          const paA=Number(a.fvTotalFinal)||Number(a.totalNum)||0;
          const paB=Number(b.fvTotalFinal)||Number(b.totalNum)||0;
          if(paA!==paB) return asc?(paA-paB):(paB-paA);
        }
        
        return 0;
      });
      return c;
    }

    function updateSortIcons(){
      ['nombre','potenciaNum','consumoNum','impuestosNum','totalNum','vsMejorNum'].forEach(k=>{
        const i=$('si_'+k);
        if(!i) return;
        if(state.sort.key!==k){ i.textContent=''; return; }
        i.textContent=state.sort.dir==='asc'?'▲':'▼';
      });
    }

    function createRipple(b,e){
      const rect=b.getBoundingClientRect();
      const s=Math.max(rect.width,rect.height);
      const x=e.clientX-rect.left-s/2;
      const y=e.clientY-rect.top-s/2;
      b.style.position='relative';
      b.style.overflow='hidden';
      
      // Crear 3 ondas con diferentes colores y velocidades
      const colors = [
        'rgba(139, 92, 246, 0.4)',   // Púrpura
        'rgba(236, 72, 153, 0.3)',   // Rosa
        'rgba(245, 158, 11, 0.2)'    // Ámbar
      ];
      const delays = [0, 100, 200];
      
      colors.forEach((color, i) => {
        setTimeout(() => {
          const r = document.createElement('span');
          r.style.cssText = `position:absolute;width:${s}px;height:${s}px;border-radius:50%;background:${color};left:${x}px;top:${y}px;pointer-events:none;animation:rippleExpand 0.8s ease-out;`;
          b.appendChild(r);
          setTimeout(() => r.remove(), 800);
        }, delays[i]);
      });
    }



    function createSuccessParticles(element) {
      const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#22C55E'];
      const particleCount = 12;
      
      for (let i = 0; i < particleCount; i++) {
        setTimeout(() => {
          const particle = document.createElement('div');
          particle.className = 'success-particle';
          particle.style.cssText = `
            left: 50%;
            top: 50%;
            background: ${colors[i % colors.length]};
            --tx: ${(Math.random() - 0.5) * 200}px;
            animation-delay: ${i * 0.05}s;
          `;
          element.style.position = 'relative';
          element.appendChild(particle);
          setTimeout(() => particle.remove(), 1100);
        }, i * 50);
      }
    }
    function animateCounter(element, finalText) {
      // Extraer número del texto (ej: "55,60 €" -> 55.60)
      const match = finalText.match(/[\d,.]+/);
      if (!match) {
        element.textContent = finalText;
        return;
      }
      
      const numStr = match[0].replace(',', '.');
      const finalNum = parseFloat(numStr);
      if (isNaN(finalNum)) {
        element.textContent = finalText;
        return;
      }
      
      const duration = 800; // ms
      const steps = 30;
      const stepDuration = duration / steps;
      let currentStep = 0;
      
      const interval = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const easeProgress = 1 - Math.pow(1 - progress, 3); // easeOut cubic
        const currentNum = finalNum * easeProgress;
        
        // Formatear igual que el original
        const formatted = currentNum.toFixed(2).replace('.', ',');
        element.textContent = finalText.replace(match[0], formatted);
        
        if (currentStep >= steps) {
          clearInterval(interval);
          element.textContent = finalText;
        }
      }, stepDuration);
    }
    function renderTable(){
      const f = applyFilters(state.rows);
      const s = applySort(f);

      if (s.length === 0) {
        el.tbody.replaceChildren();
        el.table.classList.remove('show');
        el.emptyBox.classList.add('show');
        return;
      }

      requestAnimationFrame(() => {
        el.emptyBox.classList.remove('show');
        el.table.classList.add('show');

        const frag = document.createDocumentFragment();
        s.forEach((r, idx) => {
          const tr = document.createElement('tr');
          if (r.esMejor) tr.classList.add('best');
          if (r.esPersonalizada) tr.classList.add('custom-tariff-highlight');
          
          const nombreBase = r.nombre || '';

          const w = r.webUrl && r.webUrl !== '#'
            ? `<a class="web" href="${escapeHtml(r.webUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir web" aria-label="Abrir oferta de ${escapeHtml(nombreBase)}">`+
              `<span class="web-icon" aria-hidden="true">🔗</span>`+
              `<span class="web-text">Ver oferta</span>`+
              `</a>`
            : r.esPersonalizada
            ? ''
            : '';
          const nombreWarn = r.pvpcNotComputable
            ? `<span class="pvpc-warn" title="PVPC no disponible para esta configuración">⚠</span>`
            : (r.pvpcWarning ? ' ⚠' : '');

          // Tooltip de requisitos si existen
          const requisitosTooltip = r.requisitos
            ? `<span class="tooltip requisitos-icon" data-tip="${escapeHtml(r.requisitos)}" role="button" tabindex="0" aria-label="Requisitos de contratación" style="margin-left:4px; color:var(--warn); cursor:help;">ⓘ</span>`
            : '';

          let fvIcon = '';
          const precioExc = Number(r.fvPriceUsed || 0);
          const exKwh = Number(r.fvExKwh || 0);
          const credit1 = Number(r.fvCredit1 || 0);
          const credit2 = Number(r.fvCredit2 || 0);
          const bvSaldoFin = r.fvBvSaldoFin;
          const excSobrante = Number(r.fvExcedenteSobrante || 0);
          const totalFinal = Number(r.fvTotalFinal || 0);
          const totalRanking = Number(r.totalNum || 0);
          
          // BV (batería virtual): NO pintamos "Pagas/Ranking" dentro de la celda TOTAL.
          // Motivo: la tabla usa table-layout:fixed + celdas nowrap; cualquier texto extra se corta o se sale.
          // En su lugar, guardamos ambos importes como data-* para mostrarlos como ayuda (tooltip/title) en el icono 💡.
          const isBV = !!(r.fvTipo && r.fvTipo.includes('BV') && r.fvApplied);
          const bvPagasFmt = isBV ? formatMoney(totalFinal) : '';
          const bvRankingFmt = isBV ? formatMoney(totalRanking) : '';
          
          // Si es solar no calculable (PVPC o tarifa indexada)
          let solarDetails = '';
          if(r.solarNoCalculable){
            const tip = 'Compensación excedentes NO calculada (precio variable horario). Consulta tu factura para ver compensación real.';
            fvIcon = `<span class="tooltip fv-icon" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Solar no calculable" style="filter: grayscale(50%);">⚠️☀️</span>`;
            solarDetails = `<div class="solar-details">⚠️ Compensación no calculada (precio variable)</div>`;
          } else if(r.fvApplied && r.fvTipo !== 'NO COMPENSA' && precioExc > 0){
            // Caso con excedentes: mostrar todos los detalles
            const excSobrante = Number(r.fvExcedenteSobrante || 0);
            const totalFinal = Number(r.fvTotalFinal || 0);
            const totalRanking = Number(r.totalNum || 0);
            const tieneBV = r.fvTipo && r.fvTipo.includes('BV');
            
            const parts = [];
            
            // Si hay BV, mostrar info de ranking y pagos (ORDEN MEJORADO)
            if(tieneBV){
              // 1. Primero lo concreto: lo que pagas HOY
              if(credit2 > 0) {
                parts.push(`💰 Pagas este mes: ${totalFinal.toFixed(2)} € (después de usar BV del mes anterior)`);
              } else {
                parts.push(`💰 Pagas este mes: ${totalFinal.toFixed(2)} €`);
              }
              
              // 2. Luego el ranking: para comparar tarifas
              parts.push(`🏆 Ranking: ${totalRanking.toFixed(2)} € (coste real sin contar BV del mes anterior)`);
              
              // 3. Mostrar excedente sobrante solo si hay
              if(excSobrante > 0){
                parts.push(`⚡ Acumulas en BV: ${excSobrante.toFixed(2)} € (se guardará para futuros meses)`);
              }
              
              // 4. SIEMPRE mostrar saldo BV final si la tarifa tiene BV
              if(bvSaldoFin !== null && bvSaldoFin !== undefined){
                parts.push(`🔋 Saldo BV final: ${Number(bvSaldoFin).toFixed(2)} € (disponible para el próximo mes)`);
              }
              
              parts.push(`---`);
            }
            
            // Detalles de excedentes (con explicaciones)
            parts.push(`☀️ Excedentes vertidos: ${exKwh.toFixed(2)} kWh`);
            parts.push(`💰 Precio compensación: ${precioExc.toFixed(3)} €/kWh`);
            parts.push(`✅ Compensado este mes: ${credit1.toFixed(2)} € (descontado de tu consumo de energía)`);
            if(credit2 > 0) parts.push(`🔋 BV usada: ${credit2.toFixed(2)} € (ahorros de meses anteriores aplicados ahora)`);
            
            const tip = parts.join('\n');
            fvIcon = `<span class="tooltip fv-icon fv-ranking" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Detalle FV y Ranking">☀️</span>`;
            // Detalles visibles en móvil
            solarDetails = `<div class="solar-details">☀️ ${escapeHtml(parts.join(' • '))}</div>`;
          } else if(bvSaldoFin !== null && bvSaldoFin !== undefined && r.fvTipo && r.fvTipo.includes('BV')){
            // Caso sin excedentes PERO con batería virtual: mostrar solo info BV
            const parts = [];
            if(credit2 > 0) parts.push(`🔋 BV usada: ${credit2.toFixed(2)} € (ahorros de meses anteriores aplicados ahora)`);
            parts.push(`🔋 Saldo BV final: ${Number(bvSaldoFin).toFixed(2)} € (disponible para el próximo mes)`);
            const tip = parts.join('\n');
            fvIcon = `<span class="tooltip fv-icon" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Detalle BV">🔋</span>`;
            // Detalles visibles en móvil
            solarDetails = `<div class="solar-details">🔋 ${escapeHtml(parts.join(' • '))}</div>`;
          }

          // Cabecera: nombre + iconos (layout estable en móvil)
          const icons = `<span class="tarifa-icons">${fvIcon || ""}${requisitosTooltip || ""}${nombreWarn || ""}</span>`;

          // En móvil, movemos Ranking y Tipo a la cabecera (así evitamos filas extra)
          const badgeRow = `<div class="tarifa-badges" aria-hidden="true">`+
              `<span class="badge rank">#${idx + 1}</span>`+
              `${rowTipoBadge(r.tipo)}`+
            `</div>`;

          const nombreDisplay =
            `${badgeRow}`+
            `<div class="tarifa-title">`+
              `<span class="tarifa-nombre">${escapeHtml(nombreBase)}</span>`+
              `${icons}`+
            `</div>`+
            `${solarDetails || ""}`;
          tr.innerHTML =
            `<td>${idx + 1}</td>`+
            `<td class="tarifa-cell" title="${escapeHtml(nombreBase)}">${nombreDisplay}</td>`+
            `<td>${escapeHtml(r.potencia)}</td>`+
            `<td>${escapeHtml(r.consumo)}</td>`+
            `<td>${escapeHtml(r.impuestos)}</td>`+
            `<td class="total-cell"><span class="total-pill"><strong class="total-price js-total-amount"${isBV ? ` data-pagas="${escapeHtml(bvPagasFmt)}" data-ranking="${escapeHtml(bvRankingFmt)}"` : ""}>${escapeHtml(r.total)}</strong></span></td>`+
            `<td class="vs">${formatVsWithBar(r.vsMejor,r.vsMejorNum)}</td>`+
            `<td>${rowTipoBadge(r.tipo)}</td>`+
            `<td style="text-align:center">${w}</td>`;
          frag.appendChild(tr);
        });

        el.tbody.replaceChildren(frag);

        // Inicializar tooltips para los requisitos recién añadidos
        el.tbody.querySelectorAll('.requisitos-icon').forEach(t => bindTooltipElement(t));
        el.tbody.querySelectorAll('.fv-icon').forEach(t => bindTooltipElement(t));
        updateSortIcons();
      });
    }

    function renderTopChart() {
      const c = document.getElementById('chartTop');
      const body = document.getElementById('chartTopBody');
      if (!c || !body) return;

      const rows = (state.rows || []).filter(r => !r.pvpcNotComputable && r.total !== '—');
      if (!rows.length) {
        c.classList.remove('show');
        body.innerHTML = '';
        return;
      }

      const sorted = rows.slice().sort((a, b) => a.totalNum - b.totalNum).slice(0, 5);
      const max = sorted[sorted.length - 1].totalNum || 1;

      const frag = document.createDocumentFragment();
      sorted.forEach((r, idx) => {
        const row = document.createElement('div');
        row.className = 'chartTop-row';
        if (idx === 0) row.classList.add('best');

        const pct = Math.max(5, Math.round((r.totalNum / max) * 100));

        row.innerHTML = `
          <div class="chartTop-name" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre)}</div>
          <div class="chartTop-barTrack"><div class="chartTop-barFill" data-width="${pct}%"></div></div>
          <div class="chartTop-value">${escapeHtml(r.total || '')}</div>
        `;
        frag.appendChild(row);
      });

      body.replaceChildren(frag);
      c.style.display='';
      c.classList.add('show');

      requestAnimationFrame(() => {
        body.querySelectorAll('.chartTop-barFill').forEach(bar => {
          const w = bar.getAttribute('data-width') || '0%';
          bar.style.width = w;
        });
      });
    }

    function renderPvpcInfo(){
      const div = el.pvpcInfo;
      if(!div) return;

      const warningEl = document.getElementById('pvpc-warning-canarias-potencia');
      if (warningEl) {
        warningEl.style.display = pvpcCasoInvalidoCanariasViviendaPotAlta ? 'block' : 'none';
      }

      if(!pvpcLastMeta){
        div.style.display='none';
        div.textContent='';
        return;
      }

      const fmt = (n) => {
        if (!Number.isFinite(n)) return '—';
        let s = n.toFixed(6);
        s = s.replace(/0+$/,'').replace(/\.$/,'');
        s = s.replace('.',',');
        return `${s} €/kWh`;
      };
      const rango=pvpcLastMeta.rangoFechas?`Periodo oficial: ${pvpcLastMeta.rangoFechas.inicio} - ${pvpcLastMeta.rangoFechas.fin}`:'';
      const fecha=pvpcLastMeta.fechaConsulta?new Date(pvpcLastMeta.fechaConsulta):null;
      
      const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
      const fechaTxt = fecha ? fecha.toLocaleString('es-ES', dateOptions) : '-';

      div.style.display='block';
      div.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:8px; font-weight:900; color:var(--text); font-size:13px;">
            PVPC (tarifa regulada)
            <span class="tooltip"
                  data-tip="Fuente: CNMC (facturaluz2.cnmc.es). Proyecto independiente (no afiliado). El PVPC mostrado es una estimación orientativa basada en los datos introducidos."
                  role="button"
                  tabindex="0"
                  aria-label="Información sobre PVPC">
              i
            </span>
          </div>
          <div style="font-size:11px; color:var(--muted2);">${escapeHtml(fechaTxt)}</div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-top:8px;">
          <div style="display:flex; flex-direction:column; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); padding:6px 10px; border-radius:8px;">
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(239,68,68,1); font-weight:800;">Punta (P1)</span>
            <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(pvpcLastMeta.precioPunta)}</span>
          </div>
          <div style="display:flex; flex-direction:column; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); padding:6px 10px; border-radius:8px;">
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(245,158,11,1); font-weight:800;">Llano (P2)</span>
            <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(pvpcLastMeta.precioLlano)}</span>
          </div>
          <div style="display:flex; flex-direction:column; background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.3); padding:6px 10px; border-radius:8px;">
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(34,197,94,1); font-weight:800;">Valle (P3)</span>
            <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(pvpcLastMeta.precioValle)}</span>
          </div>
        </div>
        ${rango ? `<div style="margin-top:8px; font-size:11px; color:var(--muted2); text-align:right;">${escapeHtml(rango)}</div>` : ''}
      `;
      // FIX: tooltips creados dinámicamente
      initTooltips();
    }

    function renderAll(d){
      if(!d||!d.success){setStatus('Error de cálculo','err');toast('Error al calcular','err');return;}
      state.pending=false;
      setStatus('Resultados actualizados','ok');

      const r=d.resumen||{};
      if(r.mejor) animateCounter(el.kpiBest, r.mejor);
      if(r.precio) animateCounter(el.kpiPrice, r.precio);

      const seoFold=document.getElementById('info');
      if(seoFold) seoFold.classList.add('show');
      el.heroKpis.classList.add('show');
      createSuccessParticles(el.heroKpis);
      
      // Mostrar sección de resultados (primera vez que se calcula)
      const seccionResultados = document.getElementById('seccionResultados');
      const esPrimeraVez = seccionResultados && !seccionResultados.classList.contains('visible');
      if(seccionResultados && esPrimeraVez){
        seccionResultados.classList.add('visible');
        // Scroll suave a resultados después de un pequeño delay para que se renderice
        setTimeout(() => {
          seccionResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }

      const s=d.stats;
      if(s){
        el.statMin.textContent=s.precioMin;
        el.statAvg.textContent=s.precioMedio;
        el.statMax.textContent=s.precioMax;
        el.statsBar.classList.add('show');
      }

      state.rows=Array.isArray(d.resultados)?d.resultados:[];
      el.toolbar.classList.add('show');

      renderTopChart();
      renderTable();
      renderPvpcInfo();

      if(window.innerWidth<1100){
        const sb=$('scrollToResults');
        sb.style.display='block';
        setTimeout(()=>sb.style.display='none',5000);
      }
    }

    function scheduleCalculateDebounced(){
      clearTimeout(state.debounce);
      state.debounce = setTimeout(()=>{
        const valid = validateInputs();
        if(valid) markPending();
        else setStatus('Corrige los datos para calcular','err');
      }, 200);
    }

    
    // Lógica de factura (PDF + OCR + modal) movida a factura.js para mantener app.js más ligero

    function runCalculation(forceRefresh = false){
      if (window.__LF_CALC_INFLIGHT) return;
      calculate(true, forceRefresh);
    }

    async function calculate(isUserAction, forceRefresh = false){
      if(!validateInputs()){
        setStatus('Corrige los datos para calcular','err');
        return;
      }
      const values = getInputValues();
      const signature = signatureFromValues(values);

      // FIX: permitir recalcular en clicks del usuario aunque signature sea igual (sin re-fetch)
      if(!forceRefresh && !isUserAction && state.lastSignature === signature){
        setStatus('Listo para calcular', 'idle');
        return;
      }
      if (window.__LF_CALC_INFLIGHT) return;
      window.__LF_CALC_INFLIGHT = true;
      try{
        saveInputs();
        setStatus('Calculando...', 'loading');

      const loaded = await fetchTarifas(forceRefresh);
      if(!loaded) return;

      const pvpc = await crearTarifaPVPC(values);
      const base = Array.isArray(baseTarifasCache) ? baseTarifasCache.slice() : [];
      
      // Añadir tarifa personalizada si está marcada
      const miTarifa = agregarMiTarifa();
      if (miTarifa) {
        base.unshift(miTarifa);
      }
      
      cachedTarifas = pvpc ? [...base, pvpc] : base;
      if(!pvpc) pvpcLastMeta=null;

      // FIX INP: Dar tiempo al navegador a pintar el spinner antes de bloquear con cálculos
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => setTimeout(resolve, 0));
      await calculateLocal(values);
      state.lastSignature = signature;
      state.pending = false;
      }catch(err){
        lfDbg('[ERROR]', err);
        setStatus('No se ha podido calcular. Inténtalo de nuevo.', 'err');
      }finally{
        window.__LF_CALC_INFLIGHT = false;
      }
    }

    function getMenuItems(){
      if(!el.menuPanel) return [];
      return Array.from(el.menuPanel.querySelectorAll('[role="menuitem"]'));
    }

    function focusMenuItem(which){
      const items = getMenuItems();
      if(!items.length) return;
      const idx = (which === 'last') ? (items.length - 1) : 0;
      try { items[idx].focus({ preventScroll: true }); } catch(e) { items[idx].focus(); }
    }

    function moveMenuFocus(dir){
      const items = getMenuItems();
      if(!items.length) return;
      const active = document.activeElement;
      let i = items.indexOf(active);
      if(i < 0) i = 0;
      i = (i + dir + items.length) % items.length;
      try { items[i].focus({ preventScroll: true }); } catch(e) { items[i].focus(); }
    }

    function toggleMenu(force, opts){
      const options = opts || {};
      const willOpen = (typeof force === 'boolean') ? force : !el.menuPanel.classList.contains('show');
      el.menuPanel.classList.toggle('show', willOpen);
      el.btnMenu.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

      if(willOpen){
        // Si se abre por teclado, mover el foco al primer/último item.
        if(options.focus === 'first') focusMenuItem('first');
        if(options.focus === 'last') focusMenuItem('last');
      }else{
        if(options.returnFocus){
          try { el.btnMenu.focus({ preventScroll: true }); } catch(e) { el.btnMenu.focus(); }
        }
      }
      return willOpen;
    }

    document.addEventListener('DOMContentLoaded', async ()=>{
      initTooltips();
      applyThemeClass(document.documentElement.classList.contains('light-mode')?'light':'dark');
      updateThemeIcon();
      loadInputs();
      updateSolarUI();

      initialStatusText = el.statusText?.textContent || '';
      initialStatusClass = el.statusPill?.className || '';

      validateInputs();
      markPending('Introduce tus datos y pulsa Calcular para ver el ranking.');

      Object.values(el.inputs).forEach(i=>{
        if(!i) return;
        i.addEventListener('input',()=>{
          updateKwhHint();
          scheduleCalculateDebounced();
        });

        // FIX: Normalizar formato decimal (punto → coma) al salir del campo
        // Soluciona inconsistencia visual en móviles donde el teclado numérico solo permite punto
        if (['p1', 'p2', 'cPunta', 'cLlano', 'cValle'].includes(i.id)) {
          i.addEventListener('blur', () => {
            if (i.value) {
              i.value = formatValueForDisplay(i.value);
            }
          });
        }
      });

      if(el.inputs.zonaFiscal){
        el.inputs.zonaFiscal.addEventListener('change',()=>{
          updateZonaFiscalUI();
          scheduleCalculateDebounced();
        });
      }
      if(el.inputs.viviendaCanarias){
        el.inputs.viviendaCanarias.addEventListener('change',()=>{
          scheduleCalculateDebounced();
        });
      }
      if(el.inputs.solarOn){
        el.inputs.solarOn.addEventListener('change',()=>{
          updateSolarUI();
          scheduleCalculateDebounced();
        });
      }

      if(el.btnTheme){
        el.btnTheme.addEventListener('click',(e)=>{
          createRipple(el.btnTheme,e);
          toggleTheme();
        });
      }

      document.querySelectorAll('.fbtn').forEach(b=>{
        b.addEventListener('click',(e)=>{
          createRipple(b,e);
          document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
          b.classList.add('active');
          state.filter=b.getAttribute('data-filter');
          renderTable();
        });
      });

      document.querySelectorAll('thead th.sort').forEach(th=>{
        th.addEventListener('click',()=>{
          const k=th.getAttribute('data-sort');
          if(!k)return;
          if(state.sort.key===k)state.sort.dir=(state.sort.dir==='asc')?'desc':'asc';
          else{state.sort.key=k;state.sort.dir='asc';}
          renderTable();updateSortIcons();
        });
      });

      el.btnCalc.addEventListener('click',(e)=>{
        createRipple(el.btnCalc,e);
        runCalculation(false);
      });

      // Enter en cualquier input → Calcular
      Object.values(el.inputs).forEach(input => {
        if(!input) return;
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            createRipple(el.btnCalc, { clientX: el.btnCalc.offsetLeft + el.btnCalc.offsetWidth/2, clientY: el.btnCalc.offsetTop + el.btnCalc.offsetHeight/2 });
            runCalculation(true);
          }
        });
      });

      el.btnMenu.addEventListener('click',(e)=>{
        createRipple(el.btnMenu,e);
        e.stopPropagation();
        const opened = toggleMenu();
        // Si la apertura viene de teclado (click con detail 0), llevar el foco al primer item.
        if(opened && e.detail === 0){
          focusMenuItem('first');
        }
      });

      el.btnMenu.addEventListener('keydown',(e)=>{
        if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
          e.preventDefault();
          e.stopPropagation();
          const wantLast = (e.key === 'ArrowUp');
          toggleMenu(true, { focus: wantLast ? 'last' : 'first' });
        }else if(e.key === 'Escape'){
          if(el.menuPanel.classList.contains('show')){
            e.preventDefault();
            toggleMenu(false, { returnFocus: true });
          }
        }
      });


      

      el.menuPanel.addEventListener('keydown',(e)=>{
        if(!el.menuPanel.classList.contains('show')) return;
        if(e.key === 'ArrowDown'){
          e.preventDefault();
          moveMenuFocus(+1);
        }else if(e.key === 'ArrowUp'){
          e.preventDefault();
          moveMenuFocus(-1);
        }else if(e.key === 'Home'){
          e.preventDefault();
          focusMenuItem('first');
        }else if(e.key === 'End'){
          e.preventDefault();
          focusMenuItem('last');
        }else if(e.key === 'Escape'){
          e.preventDefault();
          toggleMenu(false, { returnFocus: true });
        }else if(e.key === 'Tab'){
          // Dejar que Tab navegue normal, pero cerrar el menú
          toggleMenu(false);
        }
      });

      // Si el foco sale del contenedor del menú, cerrarlo (mejora navegación con teclado)
      if(el.menuRoot){
        el.menuRoot.addEventListener('focusout',()=>{
          if(!el.menuPanel.classList.contains('show')) return;
          setTimeout(()=>{
            if(!el.menuRoot.contains(document.activeElement)){
              toggleMenu(false);
            }
          },0);
        });
      }
el.menuPanel.addEventListener('click',(e)=>e.stopPropagation());

      // Cerrar menú al pulsar cualquier opción (incluye el enlace de contacto)
      el.menuPanel.addEventListener('click',(e)=>{
        const item = e.target && e.target.closest ? e.target.closest('[role="menuitem"]') : null;
        if(item){
          toggleMenu(false);
        }
      });
      document.addEventListener('click',()=>toggleMenu(false));
      document.addEventListener('keydown',(e)=>{
        if(e.key==='Escape' && el.menuPanel.classList.contains('show')){
          const shouldReturnFocus = el.menuRoot && el.menuRoot.contains(document.activeElement);
          toggleMenu(false, { returnFocus: shouldReturnFocus });
        }
      });

      el.btnReset.addEventListener('click',(e)=>{
        createRipple(el.btnReset,e);
        toggleMenu(false);
        try { localStorage.removeItem(LS_KEY); } catch(e){}
        try { sessionStorage.removeItem(LS_KEY); } catch(e){}
        window.location.href = window.location.pathname + '?reset=1';
      });

      // NOTA: La exportación se maneja en xlsx-export.js
      // No añadir listener aquí para evitar duplicados

      el.btnShare.addEventListener('click', async (e) => {
        createRipple(el.btnShare,e);
        toggleMenu(false);

        const d = saveInputs();
        const qp = new URLSearchParams(d).toString();
        const url = `${window.location.origin}${window.location.pathname}?${qp}`;
        
        // Usar API nativa de compartir en móvil si está disponible
        if (navigator.share) {
          try {
            await navigator.share({
              title: 'Mi configuración - LuzFija.es',
              text: 'Compara tarifas de luz con mi configuración',
              url: url
            });
            toast('Configuración compartida');
            return;
          } catch (err) {
            // Usuario canceló o error - fallback a copiar
            if (err.name !== 'AbortError') {
              lfDbg('[WARN] Error al compartir:', err);
            }
          }
        }
        
        // Fallback: copiar al portapapeles
        await copyText(url);
        toast('Enlace copiado al portapapeles');
      });

      if (typeof window.__LF_bindFacturaParser === 'function') {
        window.__LF_bindFacturaParser();
      }

      // Inicializar importador de CSV
      try {
        initCSVImporter();
      } catch(e) {
        lfDbg('[ERROR] Error inicializando CSV importer:', e);
      }

      $('scrollToResults').addEventListener('click',()=>$('heroKpis').scrollIntoView({behavior:'smooth',block:'start'}));

      // ============================================
      // TARIFA PERSONALIZADA
      // ============================================
      
      // Toggle del formulario de tarifa personalizada
      $('compararMiTarifa')?.addEventListener('change', (e) => {
        const form = $('miTarifaForm');
        if (!form) return;
        form.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) updateMiTarifaForm();
      });

      $('solarOn')?.addEventListener('change', () => {
        if ($('compararMiTarifa')?.checked) updateMiTarifaForm();
      });

      // Mostrar última actualización (si existe en caché) y precargar tarifas en segundo plano
      try{
        const cachedMeta = readTarifasCache({ allowExpired: true });
        if(cachedMeta && cachedMeta.meta){
          __LF_tarifasMeta = cachedMeta.meta;
          renderTarifasUpdated(__LF_tarifasMeta);
        }
      }catch(e){}
      fetchTarifas(false, { silent: true }).catch(()=>{});

    });
  

// --- PWA: registro del Service Worker e instalación opcional ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/sw.js')
      .then(function (reg) {
        // Forzamos check de actualización al cargar (útil durante desarrollo).
        try { if (reg && typeof reg.update === 'function') reg.update(); } catch (e) {}
      })
      .catch(function (err) {
        lfDbg('[ERROR] SW registration failed', err);
      });
  });
}

let __lf_deferredInstallPrompt = null;
let __lf_installButton = null;

// Configuramos el botón de instalación cuando el DOM está listo
document.addEventListener('DOMContentLoaded', function () {
  __lf_installButton = document.querySelector('[data-install-pwa]');
  if (!__lf_installButton) {
    return;
  }

  // El botón empieza oculto y solo se muestra cuando beforeinstallprompt se dispare
  __lf_installButton.style.display = 'none';

  __lf_installButton.addEventListener('click', function () {
    // Si el navegador ha disparado beforeinstallprompt, intentamos usar el diálogo nativo
    if (__lf_deferredInstallPrompt) {
      try {
        __lf_deferredInstallPrompt.prompt();
        __lf_deferredInstallPrompt.userChoice.then(function (choiceResult) {
          if (choiceResult.outcome === 'accepted') {
          }
          __lf_deferredInstallPrompt = null;
          __lf_installButton.style.display = 'none';
        }).catch(function (err) {
          lfDbg('[WARN] Error en userChoice:', err);
        });
      } catch (e) {
        lfDbg('[WARN] No se ha podido lanzar el prompt de instalación nativo:', e);
      }
      return;
    }

    // Fallback: instrucciones según plataforma
    var ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) {
      alert('Para instalar LuzFija, abre el menú del navegador (⋮) y pulsa "Instalar app" o "Añadir a pantalla de inicio".');
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      alert('Para instalar LuzFija, pulsa el botón de compartir y luego "Añadir a pantalla de inicio".');
    } else {
      alert('Puedes instalar esta web como app usando la opción "Instalar" o "Añadir a pantalla de inicio" de tu navegador.');
    }
  });

  // Si el evento ya ha llegado antes de que el DOM esté listo, mostramos el botón
  if (__lf_deferredInstallPrompt) {
    __lf_installButton.style.display = 'inline-flex';
  }
});

// Guardamos el evento cuando el navegador decide que la PWA es instalable
window.addEventListener('beforeinstallprompt', function (event) {
  // No llamamos a preventDefault: permitimos que Chrome muestre su banner nativo
  __lf_deferredInstallPrompt = event;

  if (__lf_installButton) {
    __lf_installButton.style.display = 'inline-flex';
  }
});

// ============================================
// TARIFA PERSONALIZADA - FUNCIONES
// ============================================

function updateMiTarifaForm() {
  const tieneSolar = $('solarOn')?.checked || false;
  const container = $('miTarifaPrecios');
  if (!container) return;
  
  // Aviso informativo + campos con ejemplos numéricos
  container.innerHTML = `
    <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 12px;">
      <div style="display: flex; align-items: start; gap: 8px;">
        <span style="font-size: 16px;">💡</span>
        <div style="color: var(--text); line-height: 1.4;">
          <strong>Busca estos precios en tu factura:</strong><br>
          <span style="color: var(--muted2); font-size: 11px;">
            • <strong>Término de energía:</strong> precios por kWh consumido (Punta/Llano/Valle)<br>
            • <strong>Término de potencia:</strong> precios por kW contratado/día (P1/P2)
          </span>
        </div>
      </div>
    </div>
    
    <div class="form" style="gap:8px;">
      <div class="group">
        <label for="mtPunta">Punta (€/kWh)</label>
        <input id="mtPunta" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,1543">
      </div>
      <div class="group">
        <label for="mtLlano">Llano (€/kWh)</label>
        <input id="mtLlano" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,1234">
      </div>
      <div class="group">
        <label for="mtValle">Valle (€/kWh)</label>
        <input id="mtValle" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0899">
      </div>
    </div>
    <div class="form">
      <div class="group">
        <label for="mtP1">Potencia P1 (€/kW/día)</label>
        <input id="mtP1" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0891">
      </div>
      <div class="group">
        <label for="mtP2">Potencia P2 (€/kW/día)</label>
        <input id="mtP2" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0445">
      </div>
    </div>
  `;
  
  // Si tiene placas solares marcadas, añadir campo de compensación
  if (tieneSolar) {
    container.innerHTML += `
      <div class="group" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
        <label for="mtPrecioExc">☀️ Precio compensación excedentes (€/kWh)</label>
        <input id="mtPrecioExc" class="input" type="text" inputmode="decimal" placeholder="Ej: 0,0743">
        <small style="font-size:11px; color:var(--muted2); margin-top:4px; display:block;">
          Lo que te pagan por los kWh vertidos a la red
        </small>
      </div>
    `;
  }
}

function agregarMiTarifa() {
  if (!$('compararMiTarifa')?.checked) return null;
  
  const tieneSolar = $('solarOn')?.checked || false;
  
  // Leer siempre los 6 campos
  const punta = parseNum($('mtPunta')?.value || '0');
  const llano = parseNum($('mtLlano')?.value || '0');
  const valle = parseNum($('mtValle')?.value || '0');
  const p1 = parseNum($('mtP1')?.value || '0');
  const p2 = parseNum($('mtP2')?.value || '0');
  
  if (punta <= 0 || llano <= 0 || valle <= 0 || p1 <= 0 || p2 <= 0) {
    toast('Completa todos los campos de tu tarifa');
    return null;
  }
  
  // Detectar automáticamente si es 1P o 3P
  const es1P = (punta === llano && llano === valle);
  
  // Precio de compensación solar (si aplica)
  const precioExc = tieneSolar ? parseNum($('mtPrecioExc')?.value || '0') : 0;
  
  const tarifa = {
    nombre: 'Mi tarifa ⭐',
    tipo: es1P ? '1P' : '3P',
    cPunta: punta,
    cLlano: llano,
    cValle: valle,
    p1: p1,
    p2: p2,
    web: '#',
    esPersonalizada: true,
    fv: {
      exc: precioExc,
      tipo: precioExc > 0 ? 'SIMPLE + BV' : 'NO COMPENSA',
      tope: 'ENERGIA',
      bv: precioExc > 0,
      reglaBV: precioExc > 0 ? 'BV MES ANTERIOR' : 'NO APLICA'
    },
    requiereFV: false
  };
  
  return tarifa;
}

// ============================================
// IMPORTAR CSV DE CONSUMOS
// ============================================

function parseCSVConsumos(fileContent) {
  /**
   * Parsea CSV de consumos horarios de distribuidoras españolas
   * Ahora soporta excedentes y autoconsumo
   * 
   * FORMATOS SOPORTADOS:
   * 1. e-distribución BÁSICO: CUPS;Fecha;Hora;AE_kWh;REAL/ESTIMADO
   * 2. e-distribución CON SOLAR: CUPS;Fecha;Hora;AE_kWh;AS_KWh;AE_AUTOCONS_kWh;REAL/ESTIMADO
   * 3. i-DE (Iberdrola): CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion
   * 
   * Formato estándar CNMC:
   * - Fechas: DD/MM/YYYY
   * - Horas: 1-24 (no 0-23)
   * - Separador: punto y coma (;)
   */
  const lines = fileContent.split('\n');
  if (lines.length < 2) throw new Error('CSV vacío o inválido');
  
  const header = lines[0].toLowerCase();
  
  // Detectar formato estándar español (CNMC)
  const isFormatoEspanol = header.includes('ae_kwh') || header.includes('consumo_kwh');
  
  if (!isFormatoEspanol) {
    throw new Error('Formato CSV no reconocido. Se esperaba el formato estándar de distribuidoras españolas (e-distribución, i-DE, etc.)');
  }
  
  // Detectar si tiene columnas de solar
  const tieneSolar = header.includes('as_kwh');
  const tieneAutoconsumo = header.includes('ae_autocons_kwh');
  
  const consumos = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const cols = line.split(';');
    if (cols.length < 4) continue;
    
    // Formato básico: CUPS;Fecha;Hora;Consumo_kWh;Metodo
    // Formato solar: CUPS;Fecha;Hora;AE_kWh;AS_KWh;AE_AUTOCONS_kWh;REAL/ESTIMADO
    const fechaStr = cols[1];  // DD/MM/YYYY
    const hora = parseInt(cols[2]);  // 1-24
    const kwhStr = cols[3];
    
    // Columnas de solar (si existen)
    const excedenteStr = tieneSolar ? cols[4] : null;
    const autoconsumoStr = tieneAutoconsumo ? cols[5] : null;
    const esReal = cols[tieneSolar && tieneAutoconsumo ? 6 : 4] === 'R';
    
    if (!kwhStr || kwhStr.trim() === '') continue;
    
    // Parsear consumo de red
    const kwh = parseFloat(kwhStr.replace(',', '.'));
    if (isNaN(kwh)) continue;
    
    // Parsear excedentes (energía vertida a la red)
    let excedente = 0;
    if (excedenteStr && excedenteStr.trim() !== '') {
      const exc = parseFloat(excedenteStr.replace(',', '.'));
      if (!isNaN(exc)) excedente = exc;
    }
    
    // Parsear autoconsumo (energía solar usada directamente)
    let autoconsumo = 0;
    if (autoconsumoStr && autoconsumoStr.trim() !== '') {
      const auto = parseFloat(autoconsumoStr.replace(',', '.'));
      if (!isNaN(auto)) autoconsumo = auto;
    }
    
    // Parsear fecha DD/MM/YYYY
    const [dia, mes, año] = fechaStr.split('/').map(Number);
    const fecha = new Date(año, mes - 1, dia);
    
    if (isNaN(fecha.getTime())) continue;
    
    consumos.push({ 
      fecha, 
      hora, 
      kwh,           // Consumo de red
      excedente,     // Energía vertida a red (AS_KWh)
      autoconsumo,   // Energía solar autoconsumida (AE_AUTOCONS_kWh)
      esReal 
    });
  }
  
  return consumos;
}

/**
 * Parsea archivos XLSX (Excel) de distribuidoras que usan este formato
 * 
 * FORMATO ESPERADO:
 * - Fila 1: Título (periodo de facturación)
 * - Fila 2: Dirección
 * - Fila 3: Cabeceras (CUPS, FECHA-HORA, INV/VER, PERIODO TARIFARIO, CONSUMO Wh, GENERACION Wh)
 * - Filas siguientes: Datos horarios
 * 
 * CÁLCULO DE EXCEDENTES:
 * - Si GENERACION > CONSUMO → Excedente = GENERACION - CONSUMO
 * - Si CONSUMO > GENERACION → Red cubre la diferencia, excedente = 0
 */
async function parseXLSXConsumos(fileBuffer) {
  // Cargar XLSX bajo demanda si no está disponible
  await ensureXLSX();
  
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
  
  if (data.length < 2) {
    throw new Error('Archivo Excel vacío o formato no reconocido');
  }
  
  // BUG FIX 1: Detectar fila de cabecera buscando "FECHA-HORA" o "FECHA"
  // Las cabeceras pueden estar en fila 0, 1, 2 o 3 según distribuidora
  let headerRow = -1;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    if (row && row.some(cell => {
      const cellStr = String(cell).toUpperCase();
      return cellStr.includes('FECHA-HORA') || cellStr.includes('FECHA');
    })) {
      headerRow = i;
      break;
    }
  }
  
  if (headerRow === -1) {
    throw new Error('No se encontró la fila de cabecera en el Excel');
  }
  
  const headers = data[headerRow];
  if (!headers || headers.length < 4) {
    throw new Error('Formato Excel no reconocido. Se esperan al menos: FECHA, PERIODO, CONSUMO, GENERACION');
  }
  
  // Identificar índices de columnas (más robusto que posiciones fijas)
  const colFechaHora = headers.findIndex(h => {
    const hStr = String(h).toUpperCase();
    return hStr.includes('FECHA');
  });
  const colPeriodo = headers.findIndex(h => {
    const hStr = String(h).toUpperCase();
    return hStr.includes('PERIODO') && hStr.includes('TARIFARIO');
  });
  const colConsumo = headers.findIndex(h => String(h).toUpperCase().includes('CONSUMO'));
  const colGeneracion = headers.findIndex(h => String(h).toUpperCase().includes('GENERACION'));
  
  if (colFechaHora === -1 || colConsumo === -1 || colGeneracion === -1) {
    throw new Error('No se encontraron las columnas necesarias (FECHA, CONSUMO, GENERACION) en el Excel');
  }
  
  const consumos = [];
  
  // Empezar desde la fila siguiente a headers
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 4) continue;
    
    const fechaHoraStr = row[colFechaHora];
    const periodoTarifario = colPeriodo !== -1 ? String(row[colPeriodo] || '').trim() : '';
    const consumoWh = parseFloat(row[colConsumo]) || 0;
    const generacionWh = parseFloat(row[colGeneracion]) || 0;
    
    if (!fechaHoraStr) continue;
    
    const [fechaStr, horaStr] = String(fechaHoraStr).split(' ');
    if (!fechaStr || !horaStr) continue;
    
    const [año, mes, dia] = fechaStr.split('/').map(Number);
    const horaXLSX = parseInt(horaStr.split(':')[0]); // 0-23 en XLSX i-DE
    
    // BUG FIX 2: Convertir hora XLSX (0-23) a hora CNMC (1-24)
    // XLSX hora 0 = 00:00-01:00 → CNMC hora 1
    // XLSX hora 23 = 23:00-00:00 → CNMC hora 24
    const horaCNMC = horaXLSX + 1;
    
    const fecha = new Date(año, mes - 1, dia);
    if (isNaN(fecha.getTime())) continue;
    
    const consumoKwh = consumoWh / 1000;
    const generacionKwh = generacionWh / 1000;
    
    // BUG FIX 3: Usar PERIODO TARIFARIO si está disponible en el fichero
    // Esto evita errores de clasificación por festivos, hora 0, etc.
    let periodoCalculado = null;
    if (periodoTarifario) {
      const pUpper = periodoTarifario.toUpperCase();
      if (pUpper.includes('PUNTA') || pUpper === 'P1') periodoCalculado = 'P1';
      else if (pUpper.includes('LLANO') || pUpper === 'P2') periodoCalculado = 'P2';
      else if (pUpper.includes('VALLE') || pUpper === 'P3') periodoCalculado = 'P3';
    }
    
    // El Excel de I-DE ya trae los valores netos:
    // - CONSUMO Wh: Consumo de RED (ya neto, restado el autoconsumo)
    // - GENERACION Wh: Excedentes vertidos a la red (ya neto)
    // Por tanto, usamos los valores directamente
    
    consumos.push({
      fecha,
      hora: horaCNMC,          // BUG FIX 2: hora CNMC (1-24)
      kwh: consumoKwh,         // Consumo de RED (directo)
      excedente: generacionKwh, // Excedentes (directo)
      autoconsumo: 0,          // No disponible en este formato
      periodo: periodoCalculado, // BUG FIX 3: periodo del fichero (si disponible)
      esReal: true
    });
  }
  
  return consumos;
}

/**
 * Calcula el Viernes Santo para un año dado usando el algoritmo de Gauss (Computus)
 * El Viernes Santo es 2 días antes del Domingo de Pascua
 */
function calcularViernesSanto(year) {
  // Algoritmo de Gauss para calcular la Pascua
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  
  // Esto nos da el Domingo de Pascua
  // Viernes Santo es 2 días antes
  const pascua = new Date(year, month - 1, day);
  const viernesSanto = new Date(pascua);
  viernesSanto.setDate(pascua.getDate() - 2);
  
  const mes = String(viernesSanto.getMonth() + 1).padStart(2, '0');
  const dia = String(viernesSanto.getDate()).padStart(2, '0');
  
  return `${year}-${mes}-${dia}`;
}

/**
 * Genera la lista de festivos nacionales para un año dado
 * Incluye los 10 festivos nacionales oficiales de España
 */
function getFestivosNacionales(year) {
  return [
    `${year}-01-01`, // Año Nuevo
    `${year}-01-06`, // Reyes Magos
    calcularViernesSanto(year), // Viernes Santo (calculado)
    `${year}-05-01`, // Día del Trabajo
    `${year}-08-15`, // Asunción de la Virgen
    `${year}-10-12`, // Fiesta Nacional de España
    `${year}-11-01`, // Todos los Santos
    `${year}-12-06`, // Día de la Constitución
    `${year}-12-08`, // Inmaculada Concepción
    `${year}-12-25`  // Navidad
  ];
}

function getPeriodoHorarioCSV(fecha, hora) {
  /**
   * Determina periodo P1/P2/P3 según RD 148/2021
   * 
   * IMPORTANTE: La hora del CSV representa:
   * Hora 1 = intervalo 00:00-01:00 (hora de inicio: 0)
   * Hora 8 = intervalo 07:00-08:00 (hora de inicio: 7)
   * Hora 9 = intervalo 08:00-09:00 (hora de inicio: 8)
   * Hora 11 = intervalo 10:00-11:00 (hora de inicio: 10)
   * 
   * P3 (Valle): 00:00-08:00 todos + TODO el día en festivos/fines de semana
   * P2 (Llano): 08:00-10:00, 14:00-18:00, 22:00-24:00 en laborables
   * P1 (Punta): 10:00-14:00, 18:00-22:00 en laborables
   */
  
  const diaSemana = fecha.getDay(); // 0=domingo, 6=sábado
  const esFinde = diaSemana === 0 || diaSemana === 6;
  
  // Formatear fecha como YYYY-MM-DD
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  const fechaStr = `${year}-${month}-${day}`;
  
  // Obtener festivos nacionales del año correspondiente
  const festivosNacionales = getFestivosNacionales(year);
  const esFestivo = festivosNacionales.includes(fechaStr);
  
  // Si es festivo o fin de semana, TODO es P3
  if (esFinde || esFestivo) return 'P3';
  
  // La hora del CSV es 1-24, donde hora N representa el intervalo (N-1):00 - N:00
  // Hora de inicio del intervalo
  const horaInicio = hora - 1;
  
  // Laborable normal
  if (horaInicio >= 0 && horaInicio < 8) return 'P3';  // 00:00-08:00
  if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) return 'P1';  // Punta
  return 'P2';  // Llano (08:00-10:00, 14:00-18:00, 22:00-24:00)
}

// Helper: formatear fecha local sin usar UTC (evita bug de toISOString)
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clasificarConsumosPorPeriodo(consumos) {
  const totales = { 
    P1: 0, P2: 0, P3: 0,
    excedentesP1: 0, excedentesP2: 0, excedentesP3: 0,
    autoconsumoP1: 0, autoconsumoP2: 0, autoconsumoP3: 0
  };
  const diasUnicos = new Set();
  let datosReales = 0;
  let datosEstimados = 0;
  
  consumos.forEach(c => {
    // Usar periodo del fichero si está disponible, sino calcularlo
    // Esto evita errores cuando el fichero (ej. XLSX i-DE) ya trae PERIODO TARIFARIO
    const periodo = c.periodo || getPeriodoHorarioCSV(c.fecha, c.hora);
    
    totales[periodo] += c.kwh || 0;
    
    if (c.excedente) {
      totales[`excedentes${periodo}`] += c.excedente;
    }
    
    if (c.autoconsumo) {
      totales[`autoconsumo${periodo}`] += c.autoconsumo;
    }
    
    const fechaKey = ymdLocal(c.fecha);
    diasUnicos.add(fechaKey);
    
    if (c.esReal) datosReales++;
    else datosEstimados++;
  });
  
  const totalKwh = totales.P1 + totales.P2 + totales.P3;
  const totalExcedentes = totales.excedentesP1 + totales.excedentesP2 + totales.excedentesP3;
  const totalAutoconsumo = totales.autoconsumoP1 + totales.autoconsumoP2 + totales.autoconsumoP3;
  const tieneExcedentes = totalExcedentes > 0;
  
  return {
    punta: totales.P1.toFixed(2).replace('.', ','),
    llano: totales.P2.toFixed(2).replace('.', ','),
    valle: totales.P3.toFixed(2).replace('.', ','),
    
    excedentesPunta: totales.excedentesP1.toFixed(2).replace('.', ','),
    excedentesLlano: totales.excedentesP2.toFixed(2).replace('.', ','),
    excedentesValle: totales.excedentesP3.toFixed(2).replace('.', ','),
    
    autoconsumoPunta: totales.autoconsumoP1.toFixed(2).replace('.', ','),
    autoconsumoLlano: totales.autoconsumoP2.toFixed(2).replace('.', ','),
    autoconsumoValle: totales.autoconsumoP3.toFixed(2).replace('.', ','),
    
    dias: diasUnicos.size,
    totalKwh: totalKwh.toFixed(2).replace('.', ','),
    totalExcedentes: totalExcedentes.toFixed(2).replace('.', ','),
    totalAutoconsumo: totalAutoconsumo.toFixed(2).replace('.', ','),
    tieneExcedentes,
    
    datosReales,
    datosEstimados,
    porcentajes: {
      punta: (totales.P1 / totalKwh * 100).toFixed(1).replace('.', ','),
      llano: (totales.P2 / totalKwh * 100).toFixed(1).replace('.', ','),
      valle: (totales.P3 / totalKwh * 100).toFixed(1).replace('.', ',')
    }
  };
}

async function procesarCSVConsumos(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const consumos = parseCSVConsumos(content);
        
        if (consumos.length === 0) {
          reject(new Error('No se encontraron datos válidos en el CSV'));
          return;
        }
        
        const resultado = clasificarConsumosPorPeriodo(consumos);
        resultado.formato = 'CSV';
        resolve(resultado);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsText(file);
  });
}

async function procesarXLSXConsumos(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const buffer = e.target.result;
        const consumos = await parseXLSXConsumos(buffer);
        
        if (consumos.length === 0) {
          reject(new Error('No se encontraron datos válidos en el Excel'));
          return;
        }
        
        const resultado = clasificarConsumosPorPeriodo(consumos);
        resultado.formato = 'XLSX';
        resolve(resultado);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Error al leer el archivo Excel'));
    reader.readAsArrayBuffer(file);
  });
}

function mostrarPreviewCSV(resultado) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'false');

  const isLightMode = document.body.classList.contains('light-mode');

  // Scroll lock suave (sin interferir con otros modales)
  let __csvLocked = false;
  let __csvScrollY = 0;
  function __csvLock(){
    if (document.documentElement.style.overflow === 'hidden') return;
    __csvScrollY = window.scrollY || 0;
    document.documentElement.style.overflow = 'hidden';
    __csvLocked = true;
  }
  function __csvUnlock(){
    if (!__csvLocked) return;
    document.documentElement.style.overflow = '';
    window.scrollTo(0, __csvScrollY);
    __csvLocked = false;
  }

  const content = document.createElement('div');
  content.className = 'modal-content card';
  content.style.maxWidth = '520px';
  // Construir HTML de excedentes si existen
  let excedenteHTML = '';
  if (resultado.tieneExcedentes) {
    const isLightMode = document.body.classList.contains('light-mode');
    const excBg = isLightMode ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.12)';
    const excBorder = isLightMode ? 'rgba(217, 119, 6, 0.4)' : 'rgba(217, 119, 6, 0.3)';
    excedenteHTML = `
      <div style="background: ${excBg}; padding: 16px; border-radius: 12px; margin-top: 16px; border: 1px solid ${excBorder};">
        <div style="font-size: 13px; font-weight: 900; margin-bottom: 12px; color: var(--text); display: flex; align-items: center; gap: 6px;">
          ☀️ Excedentes solares detectados
        </div>
        
        <div style="display: grid; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: var(--muted2);">Total excedentes</span>
            <span style="font-size: 14px; font-weight: 700; color: var(--warn);">${resultado.totalExcedentes} kWh</span>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
            <div>
              <div style="font-size: 10px; color: var(--muted2); margin-bottom: 2px;">Punta</div>
              <div style="font-size: 12px; font-weight: 700; color: var(--text);">${resultado.excedentesPunta} kWh</div>
            </div>
            <div>
              <div style="font-size: 10px; color: var(--muted2); margin-bottom: 2px;">Llano</div>
              <div style="font-size: 12px; font-weight: 700; color: var(--text);">${resultado.excedentesLlano} kWh</div>
            </div>
            <div>
              <div style="font-size: 10px; color: var(--muted2); margin-bottom: 2px;">Valle</div>
              <div style="font-size: 12px; font-weight: 700; color: var(--text);">${resultado.excedentesValle} kWh</div>
            </div>
          </div>
          
          ${resultado.totalAutoconsumo !== '0,00' ? `
          <div style="padding-top: 8px; border-top: 1px solid var(--border);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; color: var(--muted2);">Autoconsumo directo</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--text);">${resultado.totalAutoconsumo} kWh</span>
            </div>
          </div>
          ` : ''}
        </div>
        
        <!-- NUEVO: Checkbox para decidir si aplicar excedentes -->
        <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); cursor: pointer;">
          <input type="checkbox" id="csvAplicarExcedentes" checked style="cursor: pointer; width: 18px; height: 18px;">
          <span style="font-size: 13px; color: var(--text); font-weight: 600;">
            ☀️ Incluir excedentes en el cálculo
          </span>
        </label>
      </div>
    `;
  }
  
  content.innerHTML = `
    <button class="modal-x" id="btnCerrarCSVX" type="button" aria-label="Cerrar">✕</button>
    <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 900; color: var(--text);">
      📊 Consumos detectados${resultado.tieneExcedentes ? ' ☀️' : ''}
    </h3>
    
    <div style="background: ${isLightMode ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.06)'}; padding: 16px; border-radius: 12px; margin-bottom: 16px; border: 1px solid var(--border);">
      <div style="display: grid; gap: 12px;">
        <div>
          <div style="font-size: 12px; color: var(--muted2); margin-bottom: 4px;">Periodo analizado</div>
          <div style="font-size: 16px; font-weight: 700; color: var(--text);">${resultado.dias} días (${resultado.formato})</div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
          <div>
            <div style="font-size: 11px; color: var(--muted2); margin-bottom: 4px;">Punta</div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text);">${resultado.punta} kWh</div>
            <div style="font-size: 10px; color: var(--muted2);">${resultado.porcentajes.punta}%</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--muted2); margin-bottom: 4px;">Llano</div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text);">${resultado.llano} kWh</div>
            <div style="font-size: 10px; color: var(--muted2);">${resultado.porcentajes.llano}%</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--muted2); margin-bottom: 4px;">Valle</div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text);">${resultado.valle} kWh</div>
            <div style="font-size: 10px; color: var(--muted2);">${resultado.porcentajes.valle}%</div>
          </div>
        </div>
        
        <div style="padding-top: 12px; border-top: 1px solid var(--border);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: var(--muted2);">Total consumo</span>
            <span style="font-size: 15px; font-weight: 700; color: var(--text);">${resultado.totalKwh} kWh</span>
          </div>
        </div>
        
        <div style="font-size: 10px; color: var(--muted2); padding-top: 8px; border-top: 1px solid var(--border);">
          ${resultado.datosReales} lecturas reales • ${resultado.datosEstimados} estimadas
        </div>
      </div>
    </div>
    
    ${excedenteHTML}
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px;">
      <button id="btnCancelarCSV" class="btn" type="button" style="background: var(--bg0); color: var(--text); display: flex; align-items: center; justify-content: center; gap: 6px;">
        ✕ Cancelar
      </button>
      <button id="btnAplicarCSV" class="btn primary" type="button" style="display: flex; align-items: center; justify-content: center; gap: 6px;">
        <span id="btnAplicarTexto">✓ Aplicar consumos</span>
      </button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);

  // Activar scroll-lock y gestionar cierre
  __csvLock();
  const btnCerrarX = content.querySelector('#btnCerrarCSVX');
  let __csvCloseOnEsc = null;
  let __csvCloseOnBackdrop = null;
  const closeCSVModal = () => {
    if (__csvCloseOnEsc) document.removeEventListener('keydown', __csvCloseOnEsc);
    if (__csvCloseOnBackdrop) modal.removeEventListener('click', __csvCloseOnBackdrop);
    __csvUnlock();
    modal.remove();
  };
  btnCerrarX?.addEventListener('click', closeCSVModal);

  
  lfDbg('[CSV] Modal añadido al DOM');
  lfDbg('[CSV] Modal display:', modal.style.display);
  lfDbg('[CSV] Modal z-index:', modal.style.zIndex);
  lfDbg('[CSV] Body children:', document.body.children.length);
  
  const btnCancelar = document.getElementById('btnCancelarCSV');
  const btnAplicar = document.getElementById('btnAplicarCSV');
  const btnAplicarTexto = document.getElementById('btnAplicarTexto');
  
  // Listener para actualizar texto del botón según checkbox de excedentes
  if (resultado.tieneExcedentes) {
    const checkboxExcedentes = document.getElementById('csvAplicarExcedentes');
    if (checkboxExcedentes && btnAplicarTexto) {
      // Establecer texto inicial
      btnAplicarTexto.textContent = checkboxExcedentes.checked 
        ? '✓ Aplicar con excedentes' 
        : '✓ Aplicar solo consumos';
      
      checkboxExcedentes.addEventListener('change', () => {
        btnAplicarTexto.textContent = checkboxExcedentes.checked 
          ? '✓ Aplicar con excedentes' 
          : '✓ Aplicar solo consumos';
      });
    }
  } else {
    // Sin excedentes detectados
    if (btnAplicarTexto) {
      btnAplicarTexto.textContent = '✓ Aplicar consumos';
    }
  }
  
  lfDbg('[CSV] Botones encontrados:', btnCancelar !== null, btnAplicar !== null);
  
  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => {
      lfDbg('[CSV] Cancelar clickeado');
      closeCSVModal();
    });
  }
  
  if (btnAplicar) {
    btnAplicar.addEventListener('click', () => {
      lfDbg('[CSV] Aplicar clickeado - rellenando campos');
      
      // Rellenar campos de consumo
      const diasInput = document.getElementById('dias');
      const puntaInput = document.getElementById('cPunta');
      const llanoInput = document.getElementById('cLlano');
      const valleInput = document.getElementById('cValle');
      
      lfDbg('[CSV] Inputs encontrados:', {
        dias: diasInput !== null,
        punta: puntaInput !== null,
        llano: llanoInput !== null,
        valle: valleInput !== null
      });
      
      if (diasInput) diasInput.value = resultado.dias;
      if (puntaInput) {
        puntaInput.value = resultado.punta;
        puntaInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (llanoInput) {
        llanoInput.value = resultado.llano;
        llanoInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (valleInput) {
        valleInput.value = resultado.valle;
        valleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      lfDbg('[CSV] Valores aplicados:', {
        dias: diasInput?.value,
        punta: puntaInput?.value,
        llano: llanoInput?.value,
        valle: valleInput?.value
      });
      
      // IMPORTANTE: SIEMPRE resetear campos de excedentes primero
      const solarCheckbox = document.getElementById('solarOn');
      
      lfDbg('[CSV] Reseteando excedentes - checkbox encontrado:', solarCheckbox !== null);
      
      // Determinar si debemos aplicar excedentes
      let debeAplicarExcedentes = false;
      if (resultado.tieneExcedentes) {
        const checkboxExcedentes = document.getElementById('csvAplicarExcedentes');
        debeAplicarExcedentes = checkboxExcedentes ? checkboxExcedentes.checked : false;
      }
      
      // Rellenar excedentes solo si el usuario lo ha elegido
      if (debeAplicarExcedentes) {
        lfDbg('[CSV] Usuario eligió aplicar excedentes');
        
        if (solarCheckbox && !solarCheckbox.checked) {
          solarCheckbox.checked = true;
          // Disparar evento para mostrar campos solares
          solarCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          lfDbg('[CSV] Checkbox solar activado');
        }
        
        // Esperar un tick para que se muestren los campos
        setTimeout(() => {
          const exTotalInputRetry = document.getElementById('exTotal');
          if (exTotalInputRetry) {
            exTotalInputRetry.value = resultado.totalExcedentes;
            
            // Disparar evento input para que los listeners lo detecten
            exTotalInputRetry.dispatchEvent(new Event('input', { bubbles: true }));
            
            lfDbg('[CSV] Excedentes aplicados:', resultado.totalExcedentes);
            
            // IMPORTANTE: Actualizar el hint de kWh DESPUÉS de rellenar exTotal
            // Esperamos otro tick para que el dispatchEvent se procese primero
            setTimeout(() => {
              if (typeof updateKwhHint === 'function') {
                updateKwhHint();
                lfDbg('[CSV] updateKwhHint llamado después de aplicar excedentes');
              }
            }, 50);
          } else {
            lfDbg('[CSV] ERROR: No se pudo encontrar exTotal después de activar solar');
          }
        }, 100);
      } else {
        // Usuario NO quiere aplicar excedentes O no había excedentes
        lfDbg('[CSV] Limpiando excedentes');
        
        // Desmarcar checkbox de solar y limpiar campos
        if (solarCheckbox && solarCheckbox.checked) {
          solarCheckbox.checked = false;
          solarCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          lfDbg('[CSV] Checkbox solar desactivado');
        }
        
        // Limpiar campo de excedentes si existe
        setTimeout(() => {
          const exTotalInput = document.getElementById('exTotal');
          if (exTotalInput) {
            exTotalInput.value = '';
            exTotalInput.dispatchEvent(new Event('input', { bubbles: true }));
            lfDbg('[CSV] Campo excedentes limpiado');
          }
        }, 100);
      }
      
      closeCSVModal();
      
      if (typeof toast === 'function') {
        const msg = debeAplicarExcedentes 
          ? '✓ Consumos y excedentes aplicados' 
          : '✓ Consumos aplicados desde ' + resultado.formato;
        toast(msg);
      }
      
      try {
        if (typeof updateKwhHint === 'function') updateKwhHint();
        if (typeof validateInputs === 'function') validateInputs();
        if (typeof saveInputs === 'function') saveInputs();
      } catch(e) {
        lfDbg('[CSV] Error en funciones auxiliares:', e);
      }
      
      // IMPORTANTE: Resetear batería virtual a 0 antes de calcular
      // El saldo anterior no tiene sentido con los nuevos datos importados
      try {
        const bvSaldoInput = document.getElementById('bvSaldo');
        if (bvSaldoInput) {
          bvSaldoInput.value = '0';
          bvSaldoInput.dispatchEvent(new Event('input', { bubbles: true }));
          lfDbg('[CSV] Batería Virtual reseteada a 0');
        }
      } catch(e) {
        lfDbg('[CSV] Error reseteando BV:', e);
      }
      
      // Auto-calcular esperando a que campos estén listos (robusto para móviles lentos)
      setTimeout(async () => {
        // Espera activa: verificar que campos tienen valores
        const maxWait = 1000;
        const startTime = Date.now();
        let camposListos = false;
        
        while (Date.now() - startTime < maxWait && !camposListos) {
          const diasOk = document.getElementById('dias')?.value;
          const puntaOk = document.getElementById('cPunta')?.value;
          const llanoOk = document.getElementById('cLlano')?.value;
          const valleOk = document.getElementById('cValle')?.value;
          
          if (diasOk && puntaOk && llanoOk && valleOk) {
            // Si debe tener excedentes, también verificar exTotal
            if (debeAplicarExcedentes) {
              const exTotalOk = document.getElementById('exTotal')?.value;
              if (exTotalOk) {
                lfDbg('[CSV] Todos los campos listos (con excedentes)');
                camposListos = true;
              }
            } else {
              lfDbg('[CSV] Campos básicos listos');
              camposListos = true;
            }
          }
          
          if (!camposListos) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        
        if (!camposListos) {
          lfDbg('[CSV] Timeout esperando campos, calculando de todas formas');
        }
        
        try {
          if (typeof hideResultsToInitialState === 'function') hideResultsToInitialState();
          if (typeof setStatus === 'function') setStatus('Calculando...', 'loading');
          if (typeof runCalculation === 'function') runCalculation();
        } catch(e) {
          lfDbg('[CSV] Error en auto-cálculo:', e);
        }
      }, 150); // Delay inicial para dar tiempo a que campos se rellenen
    });
  }
  
  __csvCloseOnEsc = (e) => {
    if (e.key === 'Escape') closeCSVModal();
  };
  document.addEventListener('keydown', __csvCloseOnEsc);
  
  __csvCloseOnBackdrop = (e) => {
    if (e.target === modal) closeCSVModal();
  };
  modal.addEventListener('click', __csvCloseOnBackdrop);
}

function initCSVImporter() {
  try {
    const container = $('consumosWrapper');
    if (!container) return;
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xlsx,.xls';
    fileInput.style.display = 'none';
    fileInput.id = 'csvConsumoInput';
    
    const btnCSV = document.createElement('button');
    btnCSV.type = 'button';
    btnCSV.className = 'btn';
    btnCSV.style.cssText = 'margin-top: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;';
    btnCSV.innerHTML = '📊 Importar consumos (CSV/Excel)';
    btnCSV.title = 'Subir archivo con consumo horario';
    
    const hint = document.createElement('small');
    hint.style.cssText = 'font-size: 11px; color: var(--muted2); margin-top: 4px; display: block; text-align: center;';
    hint.textContent = 'Descarga tu consumo horario de tu distribuidora (CSV o Excel)';
    
    btnCSV.addEventListener('click', () => {
      fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) {
        return;
      }
      
      btnCSV.disabled = true;
      btnCSV.innerHTML = '⏳ Procesando...';
      
      try {
        let resultado;
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (extension === 'csv') {
          resultado = await procesarCSVConsumos(file);
        } else if (extension === 'xlsx' || extension === 'xls') {
          // XLSX se carga automáticamente en procesarXLSXConsumos
          resultado = await procesarXLSXConsumos(file);
        } else {
          throw new Error('Formato no soportado. Solo CSV y Excel (.xlsx, .xls)');
        }
        
        mostrarPreviewCSV(resultado);
        
        btnCSV.disabled = false;
        btnCSV.innerHTML = '📊 Importar consumos (CSV/Excel)';
        fileInput.value = '';
        
      } catch (error) {
        toast(error.message || 'Error al procesar el archivo', 'err');
        
        btnCSV.disabled = false;
        btnCSV.innerHTML = '📊 Importar consumos (CSV/Excel)';
        fileInput.value = '';
      }
    });
    
    const wrapperDiv = document.createElement('div');
    wrapperDiv.style.cssText = 'margin-top: 12px;';
    wrapperDiv.appendChild(fileInput);
    wrapperDiv.appendChild(btnCSV);
    wrapperDiv.appendChild(hint);
    
    // Insertar DESPUÉS del consumosWrapper
    if (container.nextSibling) {
      container.parentNode.insertBefore(wrapperDiv, container.nextSibling);
    } else {
      container.parentNode.appendChild(wrapperDiv);
    }
    
    // Verificación
    setTimeout(() => {
      const check = document.getElementById('csvConsumoInput');
      if (!check) {
      }
    }, 100);
    
  } catch (error) {
    lfDbg('[CSV] ERROR CRÍTICO:', error);
  }
}
