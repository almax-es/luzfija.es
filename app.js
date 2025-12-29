// ===== LuzFija: consola silenciosa por defecto (activar con ?debug=1) =====
(function () {
  try {
    const params = new URLSearchParams(location.search);
    const debug =
      params.get("debug") === "1" ||
      localStorage.getItem("lf_debug") === "1";

    // Guardar flag global para uso en el resto del código
    window.__LF_DEBUG = debug;

    if (!debug) {
      const noop = function () {};
      console.log = noop;
      console.debug = noop;
      console.info = noop;
      console.group = noop;
      console.groupCollapsed = noop;
      console.groupEnd = noop;
      console.table = noop;
      console.time = noop;
      console.timeEnd = noop;
      // Mantener errores visibles por si algo falla de verdad:
      // console.warn y console.error NO se tocan
    }
  } catch (e) {
    // Si algo falla aquí, no romper la app
  }
})();

// Helper: log solo si debug está activo
const lfDbg = (...args) => { if (window.__LF_DEBUG) console.log(...args); };

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
        evt.preventDefault();
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
      const iso = m && (m.publishedAt || m.published_at || m.srcPublishedAt || m.tarifasPublishedAt || null);
      if(!iso){
        el.tarifasUpdated.textContent = 'Tarifas: sin fecha de actualización';
        return;
      }
      const dt = new Date(iso);
      if(!Number.isFinite(dt.getTime())){
        el.tarifasUpdated.textContent = 'Tarifas: sin fecha de actualización';
        return;
      }
      const fmt = new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      // Texto corto y útil
      el.tarifasUpdated.textContent = 'Tarifas actualizadas: ' + fmt.format(dt);

      // Tooltip con ISO original
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
          // Si la caché no guarda publishedAt (versiones antiguas), seguimos a red para obtenerlo
          if (__LF_tarifasMeta && (__LF_tarifasMeta.publishedAt || __LF_tarifasMeta.srcPublishedAt || __LF_tarifasMeta.tarifasPublishedAt)) {
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
        const __publishedAt = data.publishedAt || data.timestamp || null;
        __LF_tarifasMeta = { version: data.version || null, publishedAt: __publishedAt };
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

        console.error('Error cargando tarifas JSON:', e);
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

    function calculateLocal(values) {
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

      const resultados = cachedTarifas.map((t, index) => {
        if (t.esPVPC && t.pvpcNotComputable) {
          return {
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
            solarNoCalculable: solarOn  // Marcar si solar está activo
          };
        }
        if (t.esPVPC && t.metaPvpc) {
          const m = t.metaPvpc;
          const potenciaNum = m.terminoFijo;
          const consumoNum = m.terminoVariable;
          const impuestosNum = (m.bonoSocial || 0) + m.impuestoElectrico + m.equipoMedida + m.iva;
          const totalNum = m.totalFactura;
          return {
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
            solarNoCalculable: solarOn  // Marcar si solar está activo
          };
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
          // PVPC: compensación no calculable (precio variable horario)
          solarNoCalculable = true;
        } else if(solarOn && !t.esPVPC){
          exKwh = clampNonNeg(exTotal);
          // Verificar si es tarifa indexada ANTES de comprobar si hay excedentes
          if(fv && fv.tipo !== 'NO COMPENSA'){
            precioExc = getFvExcPrice(fv);
            if(precioExc === null){
              // Tarifa indexada: no podemos calcular compensación
              solarNoCalculable = true;
            } else if(exKwh > 0 && precioExc > 0){
              // Solo calcular compensación si hay excedentes Y precio válido
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

        // Base para impuesto eléctrico (Excel: SUM(G:I) con G,H,I ya redondeados a 2 decimales)
        const sumaBase = pot + consAdj + tarifaAdj;
        const impuestoElec = round2(Math.max((5.11269632 / 100) * sumaBase, (cPunta + cLlano + cValle) * 0.001));

        // Alquiler contador (Excel: ROUND(dias*0.026667,2))
        const margen = round2(dias * 0.026667);

        const baseEnergia = sumaBase + margen;
        const subtotal = baseEnergia + impuestoElec;

        // Base de IVA (Excel: SUM(G:K))
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

          // Para el ranking: restar excedente que va a BV (no la BV usada del mes anterior)
          // Así el ranking refleja el "coste real" considerando el ahorro que acumulas
          // NUNCA usar BV del mes anterior (totalFinal) para el ranking
          const totalNum = solarOn && fv && fv.bv
            ? round2(Math.max(0, totalBase - excedenteSobranteEur))
            : totalBase;
          return {
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
          };
        }

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

        // Para el ranking: restar excedente que va a BV (no la BV usada del mes anterior)
        // NUNCA usar BV del mes anterior (totalFinal) para el ranking
        const total = solarOn && fv && fv.bv
          ? round2(Math.max(0, totalBase - excedenteSobranteEur))
          : totalBase;

        return {
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
        };
      });

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
  // Scroll lock + restore focus (unificado)
  const __csvPrevFocus = document.activeElement;
  if (window.__LF_modalUtil){ window.__LF_modalUtil.lockScroll(); window.__LF_modalUtil.rememberFocus(); }

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
  try{ const b = modal.querySelector('#btnCerrarCSV'); b && b.focus && b.focus(); }catch(_){ }

  
  // Focus trap (para Tab dentro del modal)
  let __csvFocusTrapCleanup = null;
  try{
    const content = modal.querySelector('.modal-content') || modal;
    if (window.__LF_modalUtil) __csvFocusTrapCleanup = window.__LF_modalUtil.trapFocus(content);
  }catch(_){}


  // Activar scroll-lock y gestionar cierre
  __csvLock();
  const btnCerrarX = content.querySelector('#btnCerrarCSVX');
  let __csvCloseOnEsc = null;
  let __csvCloseOnBackdrop = null;
  const closeCSVModal = () => {
    if (__csvCloseOnEsc) document.removeEventListener('keydown', __csvCloseOnEsc);
    if (__csvCloseOnBackdrop) modal.removeEventListener('click', __csvCloseOnBackdrop);
    __csvUnlock();
    try{ if (__csvFocusTrapCleanup) __csvFocusTrapCleanup(); }catch(_){ }
    if (window.__LF_modalUtil){ window.__LF_modalUtil.unlockScroll(); window.__LF_modalUtil.restoreFocus(); }
    else { document.documentElement.style.overflow=''; document.body.style.overflow=''; }
    try{ __csvPrevFocus && __csvPrevFocus.focus && __csvPrevFocus.focus(); }catch(_){ }
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
    console.error('[CSV] ERROR CRÍTICO:', error);
  }
}