    const $ = id => document.getElementById(id);

    // URL DEL JSON ESTÁTICO DE TARIFAS EN EL MISMO HOST
    const JSON_URL = 'tarifas.json';

    const LS_KEY = 'almax_comparador_v6_inputs';
    const THEME_KEY = window.__ALMAX_THEME_KEY || 'almax_theme';

    // VALORES POR DEFECTO PARA PRIMERA VISITA
    const DEFAULTS = { p1:'3,45', p2:'3,45', dias:'30', cPunta:'100', cLlano:'100', cValle:'100', zonaFiscal:'Península', viviendaCanarias:true };

    // RECOGIDA DE PARÁMETROS URL (para enlaces compartidos)
    const params = new URLSearchParams(window.location.search);
    const SERVER_PARAMS = {};
    for (const [key, value] of params.entries()) { SERVER_PARAMS[key] = value; }

    const el = {
      inputs: { p1:$('p1'), p2:$('p2'), dias:$('dias'), cPunta:$('cPunta'), cLlano:$('cLlano'), cValle:$('cValle'), zonaFiscal:$('zonaFiscal'), viviendaCanarias:$('viviendaCanarias') },
      btnCalc: $('btnCalc'), btnText: $('btnText'), btnSpinner: $('btnSpinner'),
      statusPill: $('statusPill'), statusText: $('statusText'), errorBox: $('errorBox'), errorText: $('errorText'),
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

    // ===== BEGIN PVPC MODULE =====
    // NOTA: La API de la CNMC tiene CORS bloqueado desde dominios externos.
    // Para habilitar PVPC en producción:
    // 1) Crea un proxy (ej. Vercel Serverless Function) que añada Access-Control-Allow-Origin:*
    // 2) Define window.PVPC_PROXY_URL en el HTML ANTES de este script.
    // 3) El comparador usará automáticamente ese proxy cuando el fetch directo falle por CORS.

    const PVPC_CACHE_PREFIX = 'pvpc_cache_v1';
    const PVPC_CACHE_LIMIT = 30;
    const pvpcCacheMemory = new Map();
    const pvpcInFlight = new Map();
    let pvpcLastMeta = null;
    let pvpcErrorShown = false;
    let pvpcCasoInvalidoCanariasViviendaPotAlta = false;

    // Helper robusto: soporta número, "3.45", "3,45", "1.234,56", "1,234.56" y entradas con separadores repetidos
    function asNumber(v, fallback = 0) {
      if (typeof v === 'number' && Number.isFinite(v)) return v;

      let s = String(v ?? '').trim();
      if (!s) return fallback;

      const hasComma = s.includes(',');
      const hasDot = s.includes('.');

      // Si hay coma y punto, el último separador suele ser el decimal
      if (hasComma && hasDot) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
          // decimal = coma, miles = punto → "1.234,56"
          s = s.replace(/\./g, '');
          const parts = s.split(',');
          const dec = parts.pop();
          s = parts.join('') + '.' + dec;
        } else {
          // decimal = punto, miles = coma → "1,234.56"
          s = s.replace(/,/g, '');
        }
      } else if (hasComma) {
        // Solo comas: tratar la ÚLTIMA como decimal, las anteriores como miles
        const parts = s.split(',');
        const dec = parts.pop();
        s = parts.join('') + '.' + dec;
      } else if (hasDot) {
        // Solo puntos: tratar el ÚLTIMO como decimal, los anteriores como miles
        const parts = s.split('.');
        const dec = parts.pop();
        s = parts.join('') + '.' + dec;
      }

      // Limpia basura (mantiene solo números, punto y signo menos)
      s = s.replace(/[^0-9.\-]/g, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : fallback;
    }


    function startOfDayLocal(date){
      const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());
      d.setHours(0,0,0,0);return d;
    }

    function addDays(date,n){
      const d=new Date(date);d.setDate(d.getDate()+n);return d;
    }

    function formatYMD(date){
      const y=date.getFullYear();
      const m=String(date.getMonth()+1).padStart(2,'0');
      const d=String(date.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }

    function getPvpcAnchorDate(){
      const yesterday=startOfDayLocal(new Date());
      yesterday.setDate(yesterday.getDate()-1);
      return formatYMD(yesterday);
    }

    function buildPvpcCacheKey(values){
      const {p1=0,p2=0,dias=0,cPunta=0,cLlano=0,cValle=0}=values||{};
      const zonaFiscal = values?.zonaFiscal === 'Canarias' ? 'Canarias' : 'Península';
      const viviendaCanarias = zonaFiscal === 'Canarias' && Boolean(values?.viviendaCanarias);
      const codigoPostal = zonaFiscal === 'Canarias' ? '35001' : '50010';
      return `${PVPC_CACHE_PREFIX}:${getPvpcAnchorDate()}:${zonaFiscal}:${codigoPostal}:${viviendaCanarias?'1':'0'}:${p1}:${p2}:${dias}:${cPunta}:${cLlano}:${cValle}`;
    }

    function readPvpcCacheEntry(key){
      if(pvpcCacheMemory.has(key)) return pvpcCacheMemory.get(key);
      try{
        const raw=localStorage.getItem(key);
        if(!raw) return null;
        const parsed=JSON.parse(raw);
        pvpcCacheMemory.set(key,parsed);
        return parsed;
      }catch(e){ return null; }
    }

    function persistPvpcCacheEntry(key, payload){
      try{ localStorage.setItem(key, JSON.stringify(payload)); }catch(e){}
      pvpcCacheMemory.set(key,payload);
      enforcePvpcCacheLimit();
    }

    function buildPvpcPeriodo(dias){
      const d=Math.min(Math.max(Number(dias)||0,1),365);
      
      // 1. Empezamos con "hoy"
      const today = new Date();
      
      // 2. Definimos el "fin" como AYER (para tener el día completo cerrado)
      const end = startOfDayLocal(today);
      end.setDate(end.getDate() - 1);
      
      // 3. El inicio es "fin - dias"
      const start = addDays(end, -d);
      
      // Formateo YYYY-MM-DD
      const periodoFacturacion = `${formatYMD(start)},${formatYMD(end)}`;
      
      return {
        periodoFacturacion,
        fechaInicio: `${formatYMD(start)}T00:00:00`,
        inicioFacturacion: start.getTime(),
        finFacturacion: end.getTime()
      };
    }

    async function fetchJsonWithTimeout(url, ms, headers){
      const controller=new AbortController();
      const t=setTimeout(()=>controller.abort(),ms);
      try{
        const res=await fetch(url,{signal:controller.signal,headers:headers||{}});
        if(!res.ok) throw new Error('HTTP '+res.status);
        return await res.json();
      }finally{ clearTimeout(t); }
    }

    function stripHtml(str){ return String(str||'').replace(/<[^>]*>/g,''); }

    // --- CORRECCIÓN DE PARSEO DE NÚMEROS ---
    function parseEuro(val) {
      if (val === null || val === undefined) return 0;
      
      // Si ya es un número, lo devolvemos tal cual (evita el error de los miles)
      if (typeof val === 'number') return val;

      let s = String(val).trim();
      
      // Si viene con formato español "1.234,56" -> quitar puntos, cambiar coma por punto
      if (s.includes(',') && s.indexOf('.') < s.indexOf(',')) {
         s = s.replace(/\./g, '').replace(',', '.');
      } 
      // Si viene solo con comas "12,50" -> cambiar por punto
      else if (s.includes(',')) {
         s = s.replace(',', '.');
      }
      
      // Limpiar cualquier carácter que no sea número, punto o guion
      s = s.replace(/[^0-9.-]/g, '');
      
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    }

    function parsePrecioFromTexto(texto, etiqueta){
      const re=new RegExp(`${etiqueta}\\s*:\\s*([\\d.,]+)\\s*€`, 'i');
      const m=re.exec(stripHtml(texto||''));
      if(!m||!m[1])return null;
      // Usamos parseEuro para ser consistentes con el formato numérico
      return parseEuro(m[1]);
    }

    function parsearRespuestaPVPC(data) {
      const lista = Array.isArray(data) ? data : (data?.resultadoPVPC || []);
      if (!lista || !lista.length) return null;

      const meta = {
        terminoFijo: 0,
        terminoVariable: 0,
        bonoSocial: 0,
        impuestoElectrico: 0,
        equipoMedida: 0,
        iva: 0,
        totalFactura: 0
      };

      let rangoFechas = null;
      let textoCompleto = '';

      try {
        const rangoTexto = stripHtml(lista[0]?.cabecera || lista[0]?.concepto || '');
        const rangoMatch = /Periodo:\s*del\s*(\d{2}\/\d{2}\/\d{4})\s*al\s*(\d{2}\/\d{2}\/\d{4})/i.exec(rangoTexto);
        if (rangoMatch) rangoFechas = { inicio: rangoMatch[1], fin: rangoMatch[2] };
      } catch (e) {}

      console.group('PVPC parsearRespuestaPVPC (FIXED)');
      try {
        lista.forEach(item => {
          const cabeceraRaw = stripHtml(item?.cabecera || item?.concepto || '').trim();
          const cabecera = cabeceraRaw.toLowerCase();

          const exp = stripHtml(item?.explicacion || item?.detalle || item?.descripcion || '');
          textoCompleto += ` ${cabeceraRaw} ${exp} `;

          const importe = parseEuro(item?.importe ?? item?.valor ?? item?.precio ?? item?.total);

          console.log(`Concepto: ${cabecera} -> Importe: ${importe}`);

          if (cabecera.includes('término fijo') || cabecera.includes('termino fijo') || cabecera.includes('potencia')) {
            meta.terminoFijo += importe;
          }
          else if (cabecera.includes('término variable') || cabecera.includes('termino variable') || cabecera.includes('energía') || cabecera.includes('energia')) {
            meta.terminoVariable += importe;
          }
          else if (cabecera.includes('financiación del bono social') || cabecera.includes('financiacion del bono social') || cabecera.includes('bono social')) {
            meta.bonoSocial += importe;
          }
          else if (cabecera.includes('impuesto eléctrico') || cabecera.includes('impuesto electrico')) {
            meta.impuestoElectrico += importe;
          }
          else if (cabecera.includes('equipo de medida') || cabecera.includes('alquiler')) {
            meta.equipoMedida += importe;
          }
          else if (cabecera.includes('iva') || cabecera.includes('impuesto sobre el valor')) {
            meta.iva += importe;
          }
          else if (cabecera.includes('total factura')) {
            meta.totalFactura = importe;
          }
        });
      } finally {
        console.groupEnd();
      }

      if (meta.totalFactura <= 0) {
        meta.totalFactura = meta.terminoFijo + meta.terminoVariable + meta.bonoSocial + meta.impuestoElectrico + meta.equipoMedida + meta.iva;
      }
      if (meta.totalFactura <= 0) return null;

      const texto = stripHtml(textoCompleto || '');

      function extraerMaxPorPeriodo(periodo) {
        // OJO: en strings hay que usar \\s, o construir el patrón sin escapes rotos
        const pattern =
        periodo +
      '(?:\\s*\\([^)]*\\))?\\s*[:=]\\s*([0-9]+(?:[.,][0-9]+)?)\\s*€\\s*\\/\\s*kWh';

      const re = new RegExp(pattern, 'gi');

      const vals = [];
      for (const m of texto.matchAll(re)) {
      const v = parseEuro(m[1]);
      if (v > 0) vals.push(v);
     }
    if (!vals.length) return null;
    return Math.max(...vals);
  }

      const precioPunta = extraerMaxPorPeriodo('P1');
      const precioLlano = extraerMaxPorPeriodo('P2');
      const precioValle = extraerMaxPorPeriodo('P3');

      return { ...meta, precioPunta, precioLlano, precioValle, rangoFechas };
    }

    function normalizeProxyBase(p){
      const raw = String(p || '').trim();
      if(!raw) return '';
      // Si ya parece terminar en url=, perfecto
      if(raw.endsWith('?url=') || raw.endsWith('&url=') || raw.endsWith('url=')) return raw;

      // Si contiene ? pero no url=, añadir &url=
      if(raw.includes('?')) {
        const sep = (raw.endsWith('?') || raw.endsWith('&')) ? '' : '&';
        return raw + sep + 'url=';
      }

      // Si no contiene ?, añadir ?url=
      return raw + (raw.endsWith('/') ? '' : '') + '?url=';
    }

    async function obtenerPVPC_CNMC(values){
      // Inputs robustos con validación y clamp
      const diasRaw = asNumber(values?.dias, 30);
      const dias = Math.min(365, Math.max(1, Math.round(diasRaw))); // clamp 1..365
      const p1 = Math.max(0, asNumber(values?.p1, 0));              // clamp >= 0
      const p2 = Math.max(0, asNumber(values?.p2, 0));              // clamp >= 0
      const cPunta = Math.max(0, asNumber(values?.cPunta, 0));      // clamp >= 0
      const cLlano = Math.max(0, asNumber(values?.cLlano, 0));      // clamp >= 0
      const cValle = Math.max(0, asNumber(values?.cValle, 0));      // clamp >= 0
      const fiscal = typeof __LF_getFiscalContext === 'function'
        ? __LF_getFiscalContext(values)
        : (() => {
          const p1Num = clampNonNeg(parseNum(values?.p1));
          const p2Num = clampNonNeg(parseNum(values?.p2));
          const zona = (values?.zonaFiscal || '').toLowerCase() === 'canarias' ? 'canarias' : 'península';
          const potenciaContratada = Math.max(p1Num || 0, p2Num || 0);
          const esCanarias = zona === 'canarias';
          const viviendaMarcada = Boolean(values?.viviendaCanarias);
          const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
          const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';
          return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal };
        })();
      const esCanarias = (fiscal?.zona === 'canarias');
      const viviendaMarcada = Boolean(fiscal?.viviendaMarcada);
      const potenciaContratada = Number(fiscal?.potenciaContratada || 0);
      pvpcCasoInvalidoCanariasViviendaPotAlta = esCanarias && viviendaMarcada && potenciaContratada > 10;
      if (pvpcCasoInvalidoCanariasViviendaPotAlta) {
        return null;
      }
      const zonaFiscal = esCanarias ? 'Canarias' : 'Península';
      const viviendaCanarias = esCanarias && viviendaMarcada;

      const periodo = buildPvpcPeriodo(dias);

      // La CNMC manda las fechas así: "YYYY-MM-DD,YYYY-MM-DD"
      const [fechaInicioYMD, fechaFinYMD] = periodo.periodoFacturacion.split(',');

      // Código postal solicitado por el usuario
      const codigoPostal = zonaFiscal === 'Canarias' ? '35001' : '50010';

      const params = new URLSearchParams({
        // 👇 Copiado de la llamada que a ellos les devuelve 200
        tipoContador: 'T',
        periodoFacturacion: `${fechaInicioYMD},${fechaFinYMD}`,
        codigoPostal,

        bonoSocial: 'false',
        tipoConsumidor: '1',
        categoria: '1',
        contador: '1',

        potenciaPrimeraFranja: p1.toFixed(2),
        potenciaSegundaFranja: p2.toFixed(2),

        consumo1: String(Math.round(cPunta)),
        consumo2: String(Math.round(cLlano)),
        consumo3: String(Math.round(cValle)),

        vivienda: viviendaMarcada ? 'true' : 'false',
        tarifa: '4', // 2.0TD
        calculoAntiguo: 'false',
        autoconsumo: 'false',
        perfilConsumo: '8', // Perfil medio

        // Ojo: aquí ellos usan solo fecha (sin hora)
        fechaInicio: fechaInicioYMD,
        fechaFin: fechaFinYMD,

        // Aquí usan "potenciaAutoconsumo", no "potenciaConsumo". Usamos media o P1.
        potenciaAutoconsumo: ((p1 + p2) / 2).toFixed(1),

        // Y estos nombres EXACTOS:
        inicioPFacturacion: String(periodo.inicioFacturacion),
        finPFacturacion: String(periodo.finFacturacion)
      });

      const apiUrl = `https://comparador.cnmc.gob.es/api/ofertas/pvpc?${params.toString()}`;

      console.group('PVPC obtenerPVPC_CNMC');
      console.log('API URL:', apiUrl);
      console.log('Periodo:', periodo.periodoFacturacion, `(${dias} días)`);
      console.log(`Potencias: P1=${p1.toFixed(2)} P2=${p2.toFixed(2)} → promedio=${((p1+p2)/2).toFixed(1)}`);
      console.log(`Consumos: Punta=${Math.round(cPunta)} Llano=${Math.round(cLlano)} Valle=${Math.round(cValle)}`);
      console.groupEnd();

      // 🔥 Si hay proxy, usarlo DIRECTAMENTE (evita request CORS inútil)
      const proxyBase = window.PVPC_PROXY_URL ? normalizeProxyBase(window.PVPC_PROXY_URL) : '';
      if (proxyBase) {
        try {
          const proxyUrl = `${proxyBase}${encodeURIComponent(apiUrl)}`;
          console.log('PVPC: ✅ Usando proxy directo:', proxyUrl);
          const result = await fetchJsonWithTimeout(proxyUrl, 12000);
          pvpcErrorShown = false;
          return result;
        } catch (proxyErr) {
          console.warn('PVPC fetch con proxy falló:', proxyErr?.message || proxyErr);
          if (typeof toast === 'function' && !pvpcErrorShown) {
            toast('PVPC (regulada) no disponible ahora mismo. Intenta de nuevo con ⚡ Calcular.', 'err');
            pvpcErrorShown = true;
          }
          return null;
        }
      }

      // Si no hay proxy configurado
      console.info('PVPC: ⚠️ window.PVPC_PROXY_URL no configurado. PVPC no disponible.');
      if (typeof toast === 'function' && !pvpcErrorShown) {
        toast('PVPC (regulada) no disponible. Configura proxy para habilitar.', 'err');
        pvpcErrorShown = true;
      }
      return null;
    }

    function pvpcSignatureFromValues(v){
      const norm=n=>Number(Number(n||0).toFixed(4));
      const values={
        dias: Math.min(Math.max(Math.trunc(v?.dias)||0,1),365),
        p1: norm(v?.p1),
        p2: norm(v?.p2),
        cPunta: norm(v?.cPunta),
        cLlano: norm(v?.cLlano),
        cValle: norm(v?.cValle),
        zonaFiscal: v?.zonaFiscal === 'Canarias' ? 'Canarias' : 'Península',
        viviendaCanarias: v?.zonaFiscal === 'Canarias' && Boolean(v?.viviendaCanarias)
      };
      return buildPvpcCacheKey(values);
    }

    function enforcePvpcCacheLimit(){
      try{
        const entries=[];
        for(let i=0;i<localStorage.length;i++){
          const k=localStorage.key(i);
          if(k && k.startsWith(`${PVPC_CACHE_PREFIX}:`)){
            let ts=0;
            try{ const parsed=JSON.parse(localStorage.getItem(k)); ts=parsed?.ts||0; }catch(e){}
            entries.push({k,ts});
          }
        }
        if(entries.length<=PVPC_CACHE_LIMIT) return;
        entries.sort((a,b)=>a.ts-b.ts);
        const remove=entries.length-PVPC_CACHE_LIMIT;
        for(let i=0;i<remove;i++){
          localStorage.removeItem(entries[i].k);
          pvpcCacheMemory.delete(entries[i].k);
        }
      }catch(e){}
    }

    async function crearTarifaPVPC(values){
      const fiscal = typeof __LF_getFiscalContext === 'function'
        ? __LF_getFiscalContext(values)
        : (() => {
          const p1Num = clampNonNeg(parseNum(values?.p1));
          const p2Num = clampNonNeg(parseNum(values?.p2));
          const zona = (values?.zonaFiscal || '').toLowerCase() === 'canarias' ? 'canarias' : 'península';
          const potenciaContratada = Math.max(p1Num || 0, p2Num || 0);
          const esCanarias = zona === 'canarias';
          const viviendaMarcada = Boolean(values?.viviendaCanarias);
          const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
          const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';
          return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal };
        })();
      const esCanarias = (fiscal?.zona === 'canarias');
      const viviendaMarcada = Boolean(fiscal?.viviendaMarcada);
      const potenciaContratada = Number(fiscal?.potenciaContratada || 0);
      pvpcCasoInvalidoCanariasViviendaPotAlta = esCanarias && viviendaMarcada && potenciaContratada > 10;

      if (pvpcCasoInvalidoCanariasViviendaPotAlta) {
        pvpcLastMeta = null;
        return {
          nombre:'PVPC (Regulada) ⚡',
          tipo:'3P',
          p1:0, p2:0,
          cPunta:0,
          cLlano:0,
          cValle:0,
          web:'https://facturaluz2.cnmc.es/',
          esPVPC:true,
          pvpcWarning: true,
          pvpcNotComputable: true,
          potenciaNum: 0,
          potencia: '—',
          consumoNum: 0,
          consumo: '—',
          impuestosNum: 0,
          impuestos: '—',
          totalNum: Number.POSITIVE_INFINITY,
          total: '—',
          metaPvpc: null
        };
      }

      const signature=pvpcSignatureFromValues(values);
      if(pvpcInFlight.has(signature)) return pvpcInFlight.get(signature);

      const cached=readPvpcCacheEntry(signature);
      if(cached && cached.tarifa){
        pvpcLastMeta = pvpcCasoInvalidoCanariasViviendaPotAlta ? null : (cached.meta||null);
        const tarifaCached = { ...cached.tarifa };
        tarifaCached.pvpcWarning = pvpcCasoInvalidoCanariasViviendaPotAlta;
        tarifaCached.pvpcNotComputable = pvpcCasoInvalidoCanariasViviendaPotAlta;
        if(pvpcCasoInvalidoCanariasViviendaPotAlta){
          tarifaCached.totalNum = Number.POSITIVE_INFINITY;
          tarifaCached.total = '—';
          tarifaCached.impuestos = '—';
          tarifaCached.impuestosNum = 0;
          tarifaCached.potencia = '—';
          tarifaCached.consumo = '—';
          tarifaCached.potenciaNum = 0;
          tarifaCached.consumoNum = 0;
        }
        return tarifaCached;
      }

      const p=(async()=>{
        try{
          const data=await obtenerPVPC_CNMC(values);
          if(!data){ if(!pvpcErrorShown){toast('PVPC (regulada) no disponible ahora mismo. Mostrando ranking sin PVPC; puedes reintentar con ⚡ Calcular.','err'); pvpcErrorShown=true;} return null; }
          const parsed=parsearRespuestaPVPC(data);
          if(!parsed){ if(!pvpcErrorShown){toast('PVPC (regulada) no disponible ahora mismo. Mostrando ranking sin PVPC; puedes reintentar con ⚡ Calcular.','err'); pvpcErrorShown=true;} return null; }

          const tarifa={
            nombre:'PVPC (Regulada) ⚡',
            tipo:'3P',
            p1:0, p2:0,
            cPunta:parsed.precioPunta||0,
            cLlano:parsed.precioLlano||0,
            cValle:parsed.precioValle||0,
            web:'https://facturaluz2.cnmc.es/',
            esPVPC:true,
            pvpcWarning: pvpcCasoInvalidoCanariasViviendaPotAlta,
            pvpcNotComputable: pvpcCasoInvalidoCanariasViviendaPotAlta,
            metaPvpc:{
              terminoFijo:parsed.terminoFijo,
              terminoVariable:parsed.terminoVariable,
              bonoSocial:parsed.bonoSocial||0,
              impuestoElectrico:parsed.impuestoElectrico,
              equipoMedida:parsed.equipoMedida,
              iva:parsed.iva,
              totalFactura:parsed.totalFactura
            }
          };

          if(pvpcCasoInvalidoCanariasViviendaPotAlta){
            tarifa.totalNum = Number.POSITIVE_INFINITY;
            tarifa.total = '—';
            tarifa.impuestos = '—';
            tarifa.impuestosNum = 0;
            tarifa.potencia = '—';
            tarifa.consumo = '—';
            tarifa.potenciaNum = 0;
            tarifa.consumoNum = 0;
          }

          pvpcLastMeta={
            precioPunta:parsed.precioPunta,
            precioLlano:parsed.precioLlano,
            precioValle:parsed.precioValle,
            rangoFechas:parsed.rangoFechas||null,
            fechaConsulta:new Date().toISOString()
          };

          const payload={tarifa, meta: pvpcLastMeta, ts: Date.now()};
          persistPvpcCacheEntry(signature,payload);
          return tarifa;
        }catch(err){
          console.error('Error procesando PVPC',err);
          if(!pvpcErrorShown){toast('PVPC (regulada) no disponible ahora mismo. Mostrando ranking sin PVPC; puedes reintentar con ⚡ Calcular.','err'); pvpcErrorShown=true;}
          return null;
        }
      })();

      pvpcInFlight.set(signature,p);
      return p.finally(()=>pvpcInFlight.delete(signature));
    }
    // ===== END PVPC MODULE =====

    let activeTooltip = null;
    let tooltipPinned = false;
    let tooltipRaf = null;

    function positionTooltip(target){
      if(!target)return;
      if(tooltipRaf) cancelAnimationFrame(tooltipRaf);
      tooltipRaf = requestAnimationFrame(() => {
        const tip = target.getAttribute('data-tip') || '';
        el.globalTooltip.textContent = tip;
        el.globalTooltip.style.display = 'block';
        el.globalTooltip.style.visibility = 'hidden';
        el.globalTooltip.style.opacity = '0';
        el.globalTooltip.setAttribute('aria-hidden', tip ? 'false' : 'true');
        const rect = target.getBoundingClientRect();
        const ttRect = el.globalTooltip.getBoundingClientRect();
        let top = rect.top - ttRect.height - 10;
        if(top < 8) top = rect.bottom + 10;
        let left = rect.left + rect.width / 2 - ttRect.width / 2;
        const maxLeft = window.innerWidth - ttRect.width - 8;
        left = Math.max(8, Math.min(maxLeft, left));
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

    async function fetchTarifas(forceRefresh = false) {
      // 0) Prioridad: memoria (baseTarifasCache)
      if (!forceRefresh && Array.isArray(baseTarifasCache) && baseTarifasCache.length > 0) {
        return true;
      }

      // 1) Prioridad: localStorage (válido)
      if (!forceRefresh) {
        const cached = readTarifasCache({ allowExpired: false });
        if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
          baseTarifasCache = cached.data;
          return true;
        }
      }

      // 2) Red
      setStatus('Cargando tarifas...', 'loading');

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
        writeTarifasCache(tarifas, { version: data.version || null });

        setStatus('Datos actualizados', 'ok');
        setTimeout(() => setStatus('Listo para calcular', 'idle'), 1500);
        return true;

      } catch (e) {
        // 3) Fallback: usar caché expirada si hay problemas de red
        const cached = readTarifasCache({ allowExpired: true });
        if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
          baseTarifasCache = cached.data;
          toast('Sin conexión: usando tarifas cacheadas', 'err');
          setStatus('Tarifas cacheadas', 'err');
          return true;
        }

        console.error('Error cargando tarifas JSON:', e);
        setStatus('Error conexión', 'err');
        toast('Error cargando tarifas desde el servidor.', 'err');
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
      return { p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias };
    }

    function signatureFromValues(v) {
      return [v.p1, v.p2, v.dias, v.cPunta, v.cLlano, v.cValle, v.zonaFiscal, v.viviendaCanarias ? '1' : '0'].join('|');
    }

    function calculateLocal(values) {
      const { p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias } = values || getInputValues();
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
            webUrl: t.web
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
            webUrl: t.web
          };
        }

        const pot = round2((p1 * dias * t.p1) + (p2 * dias * t.p2));
        const cons = round2((cPunta * t.cPunta) + (cLlano * t.cLlano) + (cValle * t.cValle));
        const tarifaAcceso = round2(4.650987 / 365 * dias);

        // Base para impuesto eléctrico (Excel: SUM(G:I) con G,H,I ya redondeados a 2 decimales)
        const sumaBase = pot + cons + tarifaAcceso;
        const impuestoElec = round2(Math.max((5.11269632 / 100) * sumaBase, (cPunta + cLlano + cValle) * 0.001));

        // Alquiler contador (Excel: ROUND(dias*0.026667,2))
        const margen = round2(dias * 0.026667);

        const baseEnergia = sumaBase + margen;
        const subtotal = baseEnergia + impuestoElec;

        // Base de IVA (Excel: SUM(G:K))
        const ivaBase = pot + cons + tarifaAcceso + impuestoElec + margen;

        if (isCanarias) {
          const alquilerContador = dias * (0.81 / 30);
          const igicBase = fiscal.usoFiscal === 'vivienda' ? 0 : (baseEnergia + impuestoElec) * 0.03;
          const igicContador = alquilerContador * 0.07;
          const impuestosNum = impuestoElec + igicBase + igicContador;
          const totalNum = baseEnergia + impuestoElec + igicBase + igicContador + alquilerContador;
          return {
            ...t,
            posicion: index + 1,
            potenciaNum: pot, potencia: formatMoney(pot),
            consumoNum: cons, consumo: formatMoney(cons),
            impuestosNum,
            impuestos: formatMoney(impuestosNum),
            totalNum, total: formatMoney(totalNum),
            webUrl: t.web,
            iva: 0
          };
        }

        const iva = round2(ivaBase * 0.21);
        const total = round2(ivaBase + iva);

        return {
          ...t,
          posicion: index + 1,
          potenciaNum: pot, potencia: formatMoney(pot),
          consumoNum: cons, consumo: formatMoney(cons),
          impuestosNum: round2(tarifaAcceso + impuestoElec + margen + iva),
          impuestos: formatMoney(round2(tarifaAcceso + impuestoElec + margen + iva)),
          totalNum: total, total: formatMoney(total),
          webUrl: t.web
        };
      });

      resultados.sort((a, b) => a.totalNum - b.totalNum);

      const firstValida = resultados.find(r => Number.isFinite(r.totalNum)) || resultados[0];
      const bestPrice = firstValida ? firstValida.totalNum : 0;
      const processed = resultados.map((r, i) => {
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
        return;
      }
      
      if (Object.keys(SERVER_PARAMS).length > 0) {
        const d = Object.assign({}, DEFAULTS, SERVER_PARAMS);
        for(const k in DEFAULTS){
          if(!el.inputs[k]) continue;
          if(el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(d[k], DEFAULTS[k]);
          else el.inputs[k].value = formatValueForDisplay(d[k]);
        }
        updateKwhHint();
        updateZonaFiscalUI();
        return;
      }
      let savedData = {};
      try { const r = localStorage.getItem(LS_KEY); if (r) savedData = JSON.parse(r); } catch(e){}
      const finalData = { ...DEFAULTS, ...savedData };
      for (const k in DEFAULTS){
        if(!el.inputs[k]) continue;
        if(el.inputs[k].type === 'checkbox') el.inputs[k].checked = asBool(finalData[k], DEFAULTS[k]);
        else el.inputs[k].value = formatValueForDisplay(finalData[k]);
      }
      updateKwhHint();
      updateZonaFiscalUI();
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
      el.kwhHint.textContent=`${t.toFixed(2).replace('.',',')} kWh`;
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

    function clearErrorStyles(){ Object.values(el.inputs).forEach(i=>i.classList.remove('error')); }

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
      const a=pos?'▲':'▼';
      return `<span class="vs-text ${c}">${a} ${escapeHtml(s)}</span>`;
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
        s.forEach((r) => {
          const tr = document.createElement('tr');
          if (r.esMejor) tr.classList.add('best');
          const w = r.webUrl
            ? `<a class="web" href="${escapeHtml(r.webUrl)}" target="_blank" rel="noopener" title="Abrir web">🔗</a>`
            : '';
          const nombreBase = r.nombre || '';
          const nombreWarn = r.pvpcNotComputable
            ? `<span class="pvpc-warn" title="PVPC no disponible para esta configuración">⚠</span>`
            : (r.pvpcWarning ? ' ⚠' : '');
          const nombreDisplay = `<span class="tarifa-nombre">${escapeHtml(nombreBase)}</span>${nombreWarn}`;
          tr.innerHTML =
            `<td>${escapeHtml(r.posicion)}</td>`+
            `<td title="${escapeHtml(nombreBase)}">${nombreDisplay}</td>`+
            `<td>${escapeHtml(r.potencia)}</td>`+
            `<td>${escapeHtml(r.consumo)}</td>`+
            `<td>${escapeHtml(r.impuestos)}</td>`+
            `<td><strong style="font-weight:1100; color: rgba(167,139,250,1);">${escapeHtml(r.total)}</strong></td>`+
            `<td class="vs">${formatVsWithBar(r.vsMejor,r.vsMejorNum)}</td>`+
            `<td>${rowTipoBadge(r.tipo)}</td>`+
            `<td style="text-align:center">${w}</td>`;
          frag.appendChild(tr);
        });

        el.tbody.replaceChildren(frag);
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
                  tabindex="-1"
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

    (function(){
      if (window.__LF_facturaParserLoaded) return;
      window.__LF_facturaParserLoaded = true;

      window.__LF_lastFile = null;
      window.__LF_restoreFocusEl = null;
      window.__LF_focusTrapCleanup = null;
      window.__LF_scrollY = 0;
      let __LF_lastParsedConfianza = 0;

      const __LF_scriptOnce = Object.create(null);
      function __LF_loadScriptOnce(src){
        if (__LF_scriptOnce[src]) return __LF_scriptOnce[src];
        __LF_scriptOnce[src] = new Promise((resolve, reject)=>{
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = ()=>resolve(true);
          s.onerror = ()=>reject(new Error('No se pudo cargar: ' + src));
          document.head.appendChild(s);
        });
        return __LF_scriptOnce[src];
      }


      function __LF_ensurePdfWorker(){
        if (!window.pdfjsLib) return false;
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        }
        return true;
      }

      function __LF_normNum(raw){
        if (raw == null) return null;
        let s = String(raw)
          .replace(/\s+/g,'')
          .replace(/[€$]/g,'')
          .replace(/kwh|kw/gi,'')
          .replace(/[^0-9,.\-]/g,'');
        if (!s) return null;

        const hasComma = s.includes(',');
        const hasDot = s.includes('.');
        if (hasComma && hasDot){
          if (s.lastIndexOf(',') > s.lastIndexOf('.')){
            s = s.replace(/\./g,'').replace(',', '.');
          } else {
            s = s.replace(/,/g,'');
          }
        } else if (hasComma && !hasDot){
          s = s.replace(',', '.');
        } else {
          const parts = s.split('.');
          if (parts.length > 2){
            const last = parts.pop();
            s = parts.join('') + '.' + last;
          }
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
      }

      function __LF_daysInclusive(d1, d2){
        const parse = (s) => {
          if (!s) return null;
          const t = String(s).trim().replace(/[\.\-]/g,'/').replace(/\s+/g,' ');
          const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          if (!m) return null;
          let y = parseInt(m[3],10);
          if (y < 100) y = 2000 + y; // facturas modernas
          const mo = parseInt(m[2],10) - 1;
          const da = parseInt(m[1],10);
          const dt = new Date(Date.UTC(y, mo, da));
          if (isNaN(dt.getTime())) return null;
          return dt;
        };
        const a = parse(d1);
        const b = parse(d2);
        if (!a || !b) return null;
        const ms = (b.getTime() - a.getTime());
        const days = Math.floor(ms / 86400000) + 1;
        if (!isFinite(days) || days <= 0 || days > 400) return null;
        return days;
      }

      async function __LF_extraerTextoPDF(file){
        if (!window.pdfjsLib){
          // Lazy-load PDF.js solo cuando se sube una factura
          await __LF_loadScriptOnce('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js');
        }
        if (!__LF_ensurePdfWorker()) throw new Error("PDF.js no disponible");
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

        let lines = [];
        let compact = '';

        for (let p=1; p<=pdf.numPages; p++){
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          const items = (tc.items || []).map(it => ({
            str: (it.str || '').trim(),
            x: it.transform?.[4] ?? 0,
            y: it.transform?.[5] ?? 0
          })).filter(it => it.str);

          items.sort((a,b)=> (b.y - a.y) || (a.x - b.x));
          let currentY = null;
          let buf = [];
          const flush = () => {
            if (!buf.length) return;
            const line = buf.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim();
            if (line) lines.push(line);
            buf = [];
          };

          for (const it of items){
            if (currentY === null) { currentY = it.y; buf.push(it); continue; }
            if (Math.abs(it.y - currentY) > 2.5){
              flush();
              currentY = it.y;
            }
            buf.push(it);
          }
          flush();

          compact += items.map(i=>i.str).join(' ') + '\n';
        }

        const textLines = lines.join('\n');
        const textCompact = compact.replace(/\s+/g,' ').trim();
        return { textLines, textCompact, textRawLen: (textCompact || '').length };
      }

      function __LF_extraerNumero(texto, patrones, min, max, debugLabel){
        const hits = [];
        const debugMatches = []; // Para logging
        
        for (let i = 0; i < patrones.length; i++){
          const re = patrones[i];
          const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : (re.flags + 'g'));
          let m;
          let patternHits = 0;
          while ((m = r.exec(texto)) !== null){
            const raw = m[1] ?? m[0];
            const n = __LF_normNum(raw);
            if (n == null) continue;
            if (min != null && n < min) continue;
            if (max != null && n > max) continue;
            hits.push(n);
            patternHits++;
            
            // Guardar match para debug
            if (debugLabel && patternHits === 1) {
              const contextStart = Math.max(0, m.index - 30);
              const contextEnd = Math.min(texto.length, m.index + m[0].length + 30);
              const context = texto.substring(contextStart, contextEnd).replace(/\s+/g, ' ');
              debugMatches.push({
                pattern: i,
                value: n,
                context: '...' + context + '...'
              });
            }
          }
        }
        
        if (!hits.length) {
          if (debugLabel) console.log(`[DEBUG ${debugLabel}] ❌ No matches encontrados en ${patrones.length} patrones`);
          return null;
        }

        const freq = new Map();
        for (const n of hits){
          const k = (Math.round(n*1000)/1000).toString();
          freq.set(k, (freq.get(k)||0)+1);
        }
        let best = null, bestCount = -1;
        for (const [k,c] of freq.entries()){
          if (c > bestCount){ bestCount = c; best = parseFloat(k); }
        }
        
        const result = Number.isFinite(best) ? best : hits[0];
        
        if (debugLabel && debugMatches.length > 0) {
          console.log(`[DEBUG ${debugLabel}] ✅ Match encontrado:`, {
            valor: result,
            totalMatches: hits.length,
            frecuencia: bestCount,
            primerMatch: debugMatches[0]
          });
        }
        
        return result;
      }

      // FIX: extraer triple consumo explícito "Consumo en el periodo"
      function __LF_extractTripleConsumo(texto){
        if (!texto) return null;
        const t = String(texto);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Punta/P1
        const p = __LF_extraerNumero(t, [
          /(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /\b(?:punta|p1)[:\s]+([0-9][0-9\.,]*)\s*kwh\b/i,
          /\b(?:punta|p1)[:\s]+([0-9][0-9\.,]*)\b[^\d]{0,10}kwh/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p1[^\d]{0,20}([0-9][0-9\.,]*)/i,
          // NUEVOS BRUTALES
          /\bp1\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,  // "P1 ... 100 kWh"
          /punta[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,  // "Punta ... 100 kWh"
          /activa[^\n]{0,80}p1[^\d]{0,40}([0-9][0-9\.,]*)/i,  // "activa ... P1 ... 100"
          /\bp1[^\n]{0,100}kwh[^\d]{0,30}([0-9][0-9\.,]+)/i  // "P1 ... kWh ... 100"
        ], 0, 1000000);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Llano/P2
        const l = __LF_extraerNumero(t, [
          /(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /\b(?:llano|p2)[:\s]+([0-9][0-9\.,]*)\s*kwh\b/i,
          /\b(?:llano|p2)[:\s]+([0-9][0-9\.,]*)\b[^\d]{0,10}kwh/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p2[^\d]{0,20}([0-9][0-9\.,]*)/i,
          // NUEVOS BRUTALES
          /\bp2\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
          /llano[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
          /activa[^\n]{0,80}p2[^\d]{0,40}([0-9][0-9\.,]*)/i,
          /\bp2[^\n]{0,100}kwh[^\d]{0,30}([0-9][0-9\.,]+)/i
        ], 0, 1000000);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Valle/P3
        const v = __LF_extraerNumero(t, [
          /(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /\b(?:valle|p3)[:\s]+([0-9][0-9\.,]*)\s*kwh\b/i,
          /\b(?:valle|p3)[:\s]+([0-9][0-9\.,]*)\b[^\d]{0,10}kwh/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p3[^\d]{0,20}([0-9][0-9\.,]*)/i,
          // NUEVOS BRUTALES
          /\bp3\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
          /valle[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
          /activa[^\n]{0,80}p3[^\d]{0,40}([0-9][0-9\.,]*)/i,
          /\bp3[^\n]{0,100}kwh[^\d]{0,30}([0-9][0-9\.,]+)/i
        ], 0, 1000000);

        if (p != null && l != null && v != null){
          return { punta: p, llano: l, valle: v };
        }

        // Tablas donde solo aparece "Energía (kWh)" una vez y luego valores por columnas (P1 P2 P3)
        const lines = t.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        for (const line of lines){
          const low = line.toLowerCase();
          if (!/kwh/.test(low)) continue;
          const hasLabels = /(\bpunta\b|\bllano\b|\bvalle\b|\bp1\b|\bp2\b|\bp3\b|periodo\s*[123])/.test(low);
          if (!hasLabels) continue;

          const n = (line.match(/[0-9][0-9\.,]*/g) || [])
            .map(s=>__LF_normNum(s))
            .filter(x=>x!=null && x>=0);

          const cand = n.filter(x=>x<=1000000);
          if (cand.length < 3) continue;

          if (/\bp1\b/.test(low) && /\bp2\b/.test(low) && /\bp3\b/.test(low)){
            return { punta: cand[0], llano: cand[1], valle: cand[2] };
          }
          if (/\bpunta\b/.test(low) && /\bllano\b/.test(low) && /\bvalle\b/.test(low)){
            return { punta: cand[0], llano: cand[1], valle: cand[2] };
          }
        }

        return null;
      }

      // ========== DETECCIÓN Y EXTRACCIÓN POR COMPAÑÍA ==========
      
      function __LF_detectarCompania(texto){
        const t = texto.toLowerCase();
        
        if (t.includes('iberdrola')) return 'iberdrola';
        if (t.includes('totalenergies')) return 'totalenergies';
        if (t.includes('octopus')) return 'octopus';
        if (t.includes('visalia')) return 'visalia';
        if (t.includes('energía xxi') || t.includes('energia xxi') || t.includes('energiaxxi')) return 'energiaxxi';  // ANTES de plenitude
        if (t.includes('plenitude') || t.includes('eni')) return 'plenitude';
        // Enérgya VM: múltiples variantes
        if (t.includes('enérgya vm') || t.includes('energya vm') || t.includes('energya-vm') || 
            t.includes('enérgya') || t.includes('energyavm') || 
            (t.includes('energ') && t.includes('gestión'))) return 'energyavm';
        
        // Imagina Energía
        if (t.includes('imagina energía') || t.includes('imagina energia') || t.includes('imaginaenergia')) return 'imagina';
        if (t.includes('imagina') && t.includes('energ')) return 'imagina';
        
        return 'generico';
      }
      
      // Extraer días según compañía
      function __LF_extraerDiasCompania(texto, compania){
        switch(compania){
          case 'iberdrola':
            // Iberdrola: "DIAS FACTURADOS: FECHA... 24"
            return __LF_extraerNumero(texto, [
              /d[i\u00ed\u00cc]as?\s*facturados?.{0,100}?(\d{1,3})\b/i
            ], 1, 200);
            
          case 'energyavm':
            // Enérgya VM: "x 31 días x" o "31días x"
            return __LF_extraerNumero(texto, [
              /x\s*(\d{1,3})\s*d[ií\u00cc].as?\s*x/i,
              /(\d{1,3})d[ií\u00cc].as?\s*x/i,
              /x\s*(\d{1,3})\s*d.as?\s*x/i
            ], 1, 200);
            
          case 'totalenergies':
            // TotalEnergies: "(31 día(s))" o "Alquiler equipos (31 días)"
            return __LF_extraerNumero(texto, [
              /\b(\d{1,3})\s*d[ií]a\(s\)/i,
              /potencia[^\n]{0,120}(\d{1,3})\s*d[ií]a\(s\)/i,
              /alquiler[^\n]{0,80}\(\s*(\d{1,3})\s*d[ií]as?\)/i
            ], 1, 200);
            
          case 'octopus':
            // Octopus: "DD-MM-YYYY a DD-MM-YYYY (X días)"
            return __LF_extraerNumero(texto, [
              /\d{2}-\d{2}-\d{4}\s+a\s+\d{2}-\d{2}-\d{4}\s+\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, 200);
            
          case 'visalia':
            // Visalia: "Consumo periodo: X días"
            return __LF_extraerNumero(texto, [
              /consumo\s+periodo\s*:\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, 200);
            
          case 'plenitude':
            // Plenitude: "* X días"
            return __LF_extraerNumero(texto, [
              /\*\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, 200);
            
          case 'energiaxxi':
            // Energía XXI: "(X días)" en contexto de periodo
            return __LF_extraerNumero(texto, [
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,
              /periodo[^)]{0,80}\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, 200);
            
          case 'imagina':
            // Imagina Energía: en potencia contratada aparece "€/kW * X Días"
            return __LF_extraerNumero(texto, [
              /€\s*\/\s*k[wW]\s*\*\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\/\s*k[wW]\s*\*\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\*\s*(\d{1,3})\s*d[ií]as?\b/i
            ], 1, 200);
            
          default:
            // Genérico: intentar todos los patrones
            return null;
        }
      }
      
      // Extraer potencias según compañía
      function __LF_extraerPotenciasCompania(texto, compania){
        switch(compania){
          case 'totalenergies':
            // TotalEnergies: "P1: 4,50 P2: 4,50 kW" (kW después de P2)
            const p1_te = __LF_extraerNumero(texto, [
              /potencia\s*(?:contratada)?[:\s]+p1[:\s]+([0-9][0-9\.,]*)/i,
              /\bp1[:\s]+([0-9][0-9\.,]*)\s*(?:p2|kw)/i
            ], 0.1, 40);
            const p2_te = __LF_extraerNumero(texto, [
              /potencia\s*(?:contratada)?[:\s]+p2[:\s]+([0-9][0-9\.,]*)/i,
              /\bp2[:\s]+([0-9][0-9\.,]*)\s*kw\b/i
            ], 0.1, 40);
            return { p1: p1_te, p2: p2_te };
            
          case 'imagina': {
            // Imagina Energía: "P1 5,750 kW * ... * 30 Días" (bloque Potencia contratada)
            const low_im = texto.toLowerCase();
            let sub_im = texto;
            const idx_im = low_im.indexOf('potencia contratada');
            if (idx_im >= 0) sub_im = texto.slice(idx_im, idx_im + 800);

            const p1_im = __LF_extraerNumero(sub_im, [
              /\bp1\b[^\d]{0,20}([0-9][0-9\.,]*)\s*k\s*(?:w|vv)(?!\s*h)\b/i
            ], 0.1, 40);
            const p2_im = __LF_extraerNumero(sub_im, [
              /\bp2\b[^\d]{0,20}([0-9][0-9\.,]*)\s*k\s*(?:w|vv)(?!\s*h)\b/i
            ], 0.1, 40);
            return { p1: p1_im, p2: p2_im };
          }
            
          default:
            // Genérico: patrones estándar
            return null;
        }
      }

      function __LF_parsearDatos(textoLineas, textoCompacto){
        console.log('[PARSER v1765179628-VERCEL-CLEAN] 🚀 Iniciando parseo...');
        const textLines = String(textoLineas || '');
        const textCompact = String(textoCompacto || '');

        // Normalización suave
        const tAll = (textLines + '\n' + textCompact)
          .replace(/[\u00A0\t]/g,' ')
          .replace(/\s+/g,' ')
          .trim();

        // --- Fechas y días ---
        const dateSep = '[\\/\\.\\-]';
        const D = `(\\d{1,2})${dateSep}(\\d{1,2})${dateSep}(\\d{2,4})`;
        const reRango = new RegExp(`(?:del|desde)\\s*(${D})\\s*(?:al|hasta|a)\\s*(${D})`, 'i');
        const reRango2 = new RegExp(`(?:periodo|per[ií]odo|facturaci[oó]n)[^0-9]{0,40}(${D})\\s*(?:-|–|—|a)\\s*(${D})`, 'i');

        let fIni = null, fFin = null;
        const mm = tAll.match(reRango) || tAll.match(reRango2);
        if (mm){
          fIni = mm[1];
          fFin = mm[2];
        }

        // NUEVO: Detectar compañía
        const compania = __LF_detectarCompania(tAll);
        console.log('[DEBUG] Compañía detectada:', compania);
        
        // Intentar extracción específica por compañía primero
        let dias = __LF_extraerDiasCompania(tAll, compania);
        
        // Si no se detectó o es genérico, usar patrones universales ULTRA-ROBUSTOS
        if (dias == null) {
          dias = __LF_extraerNumero(tAll, [
          // Patrones base probados
          /d[i\u00ed\u00cc]as?\s*facturados?.{0,100}?(\d{1,3})\b/i,  // Iberdrola ultra-permisivo
          /d[ií]as\s*(?:facturables|facturados|de\s*facturaci[oó]n|de\s*periodo|del\s*periodo|total)\s*[:\-]?\s*(\d{1,3})\b/i,
          /\btotal\s*d[ií]as\b[^0-9]{0,10}(\d{1,3})\b/i,
          /\b(\d{1,3})\s*d[ií]as\b\s*(?:de\s*facturaci[oó]n|facturados)\b/i,
          
          // Paréntesis y formato especial
          /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,  // (31 días)
          /periodo[^)]{0,80}\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,
          /\b(\d{1,3})\s*d[ií]a\(s\)/i,  // 31 día(s)
          /potencia[^\n]{0,120}(\d{1,3})\s*d[ií]a\(s\)/i,
          /\d{2}-\d{2}-\d{4}\s+a\s+\d{2}-\d{2}-\d{4}\s+\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,  // Octopus
          
          // Contextos específicos
          /consumo\s+periodo\s*:\s*(\d{1,3})\s*d[ií]as?\b/i,
          /\*\s*(\d{1,3})\s*d[ií]as?\b/i,
          /d[ií]as\s*facturados\s*[:\-]?\s*(\d{1,3})\b/i,
          
          // Enérgya VM y encoding corrupto
          /x\s*(\d{1,3})\s*d[ií\u00cc].as?\s*x/i,
          /(\d{1,3})d[ií\u00cc].as?\s*x/i,
          /x\s*(\d{1,3})\s*d.as?\s*x/i,
          
          // Variantes adicionales
          /periodo\s*de\s*(?:consumo|facturaci[oó]n)[^\d]{0,50}(\d{1,3})\s*d[ií]as?\b/i,
          /\bfactur[a-z]*\s*por\s*(\d{1,3})\s*d[ií]as?\b/i,
          /\bd[ií]as?\s*de\s*consumo[:\s]*(\d{1,3})\b/i,
          
          // NUEVOS PATRONES BRUTALES
          /\bd[ií]as?\b[^\d]{0,30}(\d{1,3})\b/i,  // "días" seguido de número en 30 chars
          /(\d{1,3})\s*d[ií]as?\b/i,  // Número seguido de "días" (ultra genérico)
          /duraci[oó]n[^\d]{0,40}(\d{1,3})\s*d[ií]as?\b/i,  // "duración ... 31 días"
          /\bperiodo[:\s]+(\d{1,3})\s*d[ií]as?\b/i,  // "periodo: 31 días"
          /factura[^\d]{0,60}(\d{1,3})\s*d[ií]as?\b/i,  // "factura ... 31 días"
          /desde[^\n]{0,100}hasta[^\n]{0,50}\(\s*(\d{1,3})\s*d[ií]as?\)/i,  // "desde X hasta Y (31 días)"
          /n[uú]mero\s*de\s*d[ií]as[:\s]*(\d{1,3})\b/i,  // "número de días: 31"
          /alquiler[^\d]{0,80}(\d{1,3})\s*d[ií]as?\b/i,  // "alquiler ... 31 días"
          /\b(\d{1,3})\b[^\d]{0,5}d\b/i,  // "31 d" (días abreviado)
          /vigencia[^\d]{0,40}(\d{1,3})\s*d[ií]as?\b/i  // "vigencia ... 31 días"
        ], 1, 200, 'DÍAS');  // ← ACTIVAR DEBUG
        }
        
        console.log('[DEBUG DÍAS] Compañía:', compania, '| Resultado:', dias);

        if ((dias == null || dias <= 0) && fIni && fFin){
          const calc = __LF_daysInclusive(fIni, fFin);
          if (calc != null) dias = calc;
        }

        // --- Potencias (kW) ---
        // Intentar extracción específica por compañía
        const potenciasCompania = __LF_extraerPotenciasCompania(tAll, compania);
        
        let p1, p2;
        if (potenciasCompania) {
          p1 = potenciasCompania.p1;
          p2 = potenciasCompania.p2;
          console.log('[DEBUG POTENCIAS] Usando patrones específicos de', compania);
        } else {
          // Fallback: patrones genéricos ULTRA-ROBUSTOS
          p1 = __LF_extraerNumero(tAll, [
            /potencia\s*contratada[^\n]{0,80}\b(?:p1|punta)\b[^0-9]{0,60}([0-9][0-9\.,]*)\s*kw\b/i,
            /\b(?:p1|punta|periodo\s*1)[:\s]*([0-9][0-9\.,]*)\s*kw\b/i,
            /potencia\s*(?:facturada)?[^\n]{0,80}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,60}([0-9][0-9\.,]*)\s*kw\b/i,
            /\bpotencia\b[^\n]{0,120}([0-9][0-9\.,]*)\s*kw\b[^\n]{0,60}\b(?:p1|punta|periodo\s*1)\b/i,
            /\b(?:p1|punta)[:\s]+([0-9][0-9\.,]*)\b/i,  // P1: 3.45 (sin kW)
            /periodo\s*(?:1|punta)[^\d]{0,50}([0-9][0-9\.,]*)\s*kw\b/i,
            // NUEVOS BRUTALES
            /pot[^\n]{0,50}\bp1\b[^\d]{0,40}([0-9][0-9\.,]*)/i,  // "pot ... P1 ... 3.45"
            /\bp1[^\d]{0,30}([0-9][0-9\.,]*)\s*kw/i,  // "P1 ... 3.45 kW"
            /punta[^\d]{0,40}([0-9][0-9\.,]*)\s*kw/i,  // "punta ... 3.45 kW"
            /contratada[^\n]{0,80}p1[^\d]{0,40}([0-9][0-9\.,]*)/i  // "contratada ... P1 ... 3.45"
          ], 0.1, 40, 'P1');

          p2 = __LF_extraerNumero(tAll, [
            /potencia\s*contratada[^\n]{0,80}\b(?:p2|valle)\b[^0-9]{0,60}([0-9][0-9\.,]*)\s*kw\b/i,
            /\b(?:p2|valle|periodo\s*2)[:\s]*([0-9][0-9\.,]*)\s*kw\b/i,
            /potencia\s*(?:facturada)?[^\n]{0,80}\b(?:p2|valle|periodo\s*2)\b[^0-9]{0,60}([0-9][0-9\.,]*)\s*kw\b/i,
            /\bpotencia\b[^\n]{0,120}([0-9][0-9\.,]*)\s*kw\b[^\n]{0,60}\b(?:p2|valle|periodo\s*2)\b/i,
            /\b(?:p2|valle)[:\s]+([0-9][0-9\.,]*)\b/i,
            /periodo\s*(?:2|valle|llano)[^\d]{0,50}([0-9][0-9\.,]*)\s*kw\b/i,
            // NUEVOS BRUTALES
            /pot[^\n]{0,50}\bp2\b[^\d]{0,40}([0-9][0-9\.,]*)/i,
            /\bp2[^\d]{0,30}([0-9][0-9\.,]*)\s*kw/i,
            /(?:valle|llano)[^\d]{0,40}([0-9][0-9\.,]*)\s*kw/i,
            /contratada[^\n]{0,80}p2[^\d]{0,40}([0-9][0-9\.,]*)/i
          ], 0.1, 40, 'P2');
        }
        
        console.log('[DEBUG POTENCIAS] P1:', p1, '| P2:', p2);

        // --- Consumos (kWh) ---
        const triple = __LF_extractTripleConsumo(textLines) || __LF_extractTripleConsumo(textCompact);

        let cPunta = null, cLlano = null, cValle = null;

        if (triple){
          console.log('[DEBUG CONSUMOS] Triple detectado:', triple);
          cPunta = triple.punta;
          cLlano = triple.llano;
          cValle = triple.valle;
        } else {
          // Fallback individual con patrones ULTRA-ROBUSTOS
          cPunta = __LF_extraerNumero(tAll, [
            /\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /\b(?:punta|p1)[:\s]+([0-9][0-9\.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p1[^\d]{0,20}([0-9][0-9\.,]*)/i,
            /(?:punta|p1)[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp1\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            /punta[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p1[^\d]{0,40}([0-9][0-9\.,]*)/i
          ], 0, 2000000, 'CONSUMO-P1');

          cLlano = __LF_extraerNumero(tAll, [
            /\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /\b(?:llano|p2)[:\s]+([0-9][0-9\.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p2[^\d]{0,20}([0-9][0-9\.,]*)/i,
            /(?:llano|p2)[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp2\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            /llano[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p2[^\d]{0,40}([0-9][0-9\.,]*)/i
          ], 0, 2000000, 'CONSUMO-P2');

          cValle = __LF_extraerNumero(tAll, [
            /\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9\.,]*)\s*kwh\b/i,
            /\b(?:valle|p3)[:\s]+([0-9][0-9\.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p3[^\d]{0,20}([0-9][0-9\.,]*)/i,
            /(?:valle|p3)[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp3\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            /valle[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p3[^\d]{0,40}([0-9][0-9\.,]*)/i
          ], 0, 2000000, 'CONSUMO-P3');
          
          console.log('[DEBUG CONSUMOS] Fallback individual - P:', cPunta, 'L:', cLlano, 'V:', cValle);
        }

        // Total por si no hay desglose
        const cTotal = __LF_extraerNumero(tAll, [
          /\bconsumo\s*total\b[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /\benerg[ií]a\s*total\b[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i,
          /\bconsumo\b[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i
        ], 0, 3000000);

        if ((cPunta==null && cLlano==null && cValle==null) && (cTotal!=null)){
          cPunta = 0;
          cLlano = cTotal;
          cValle = 0;
        }

        // Calcular confianza basada en campos detectados
        const campos = [dias, p1, p2, cPunta, cLlano, cValle];
        const detectados = campos.filter(v => v != null && Number.isFinite(v)).length;
        const confianza = Math.round((detectados / 6) * 100);

        // LOG CONSOLIDADO FINAL
        console.log('═══════════════════════════════════════════════════════');
        console.log('📊 RESULTADO FINAL DEL PARSEO');
        console.log('═══════════════════════════════════════════════════════');
        console.log('🏢 Compañía detectada:', compania);
        console.log('📅 Días de facturación:', dias);
        console.log('⚡ Potencia P1 (kW):', p1);
        console.log('⚡ Potencia P2 (kW):', p2);
        console.log('💡 Consumo Punta (kWh):', cPunta);
        console.log('💡 Consumo Llano (kWh):', cLlano);
        console.log('💡 Consumo Valle (kWh):', cValle);
        console.log('✅ Confianza:', confianza + '%', '(' + detectados + '/6 campos)');
        console.log('📆 Periodo:', fIni || 'N/A', '→', fFin || 'N/A');
        console.log('═══════════════════════════════════════════════════════');

        return {
          compania: compania,
          dias: dias,
          p1: p1,
          p2: p2,
          consumoPunta: cPunta,
          consumoLlano: cLlano,
          consumoValle: cValle,
          confianza: confianza,
          _fechaInicio: fIni,
          _fechaFin: fFin
        };
      }

      function __LF_showContextualWarnings(datos){
        // Función para mostrar advertencias contextuales basadas en los datos extraídos
        const avisos = [];

        // Verificar días
        if (datos.dias != null){
          if (datos.dias < 20){
            avisos.push(`⚠️ Se detectaron <b>${datos.dias} días</b>. Esto parece una <b>factura parcial</b> o periodo corto. Verifica que sea correcto.`);
          } else if (datos.dias > 40 && datos.dias <= 70){
            avisos.push(`ℹ️ Se detectaron <b>${datos.dias} días</b>. Factura <b>no mensual</b> (bimensual ~60 días). Es correcto si tu periodo de facturación es cada 2 meses.`);
          } else if (datos.dias > 70){
            avisos.push(`⚠️ Se detectaron <b>${datos.dias} días</b>. Periodo muy largo (trimestral/semestral). Verifica que sea correcto antes de aplicar.`);
          }
        }

        // Verificar potencias (alertar si son inusuales)
        if (datos.p1 != null && datos.p2 != null){
          if (Math.abs(datos.p1 - datos.p2) > 2){
            avisos.push(`ℹ️ <b>P1 (${datos.p1} kW)</b> y <b>P2 (${datos.p2} kW)</b> tienen gran diferencia. Verifica que sean correctas.`);
          }
          if (datos.p1 > 15 || datos.p2 > 15){
            avisos.push(`⚠️ Potencias muy altas detectadas (<b>P1: ${datos.p1} kW, P2: ${datos.p2} kW</b>). Esto es inusual para viviendas. Revisa si es correcto.`);
          }
        }

        // Verificar consumos (alertar si son muy altos o todos cero)
        const totalConsumo = (datos.consumoPunta || 0) + (datos.consumoLlano || 0) + (datos.consumoValle || 0);
        if (totalConsumo === 0){
          avisos.push(`⚠️ No se detectó ningún consumo. Introduce los valores manualmente.`);
        } else if (totalConsumo > 5000){
          avisos.push(`ℹ️ Consumo total muy alto: <b>${totalConsumo} kWh</b>. Verifica que los valores sean correctos.`);
        }

        // Verificar confianza
        if (datos.confianza < 50){
          avisos.push(`⚠️ <b>Confianza baja (${datos.confianza}%)</b>. Revisa cuidadosamente todos los campos antes de aplicar. Puedes probar <b>OCR experimental</b> si es un PDF escaneado.`);
          __LF_show(__LF_q('btnOcrFactura'));
        } else if (datos.confianza < 80){
          avisos.push(`ℹ️ Confianza media (${datos.confianza}%). Revisa los campos marcados con ⚠️ antes de aplicar.`);
        }

        // Mostrar avisos concatenados
        if (avisos.length > 0){
          __LF_warn(avisos.join('<br><br>'));
        }
      }

      function __LF_q(id){ return document.getElementById(id); }
      function __LF_show(el){ if(el) el.style.display = ''; }
      function __LF_hide(el){ if(el) el.style.display = 'none'; }

      function __LF_setBadge(conf){
        const b = __LF_q('confianzaBadge');
        if (!b) return;
        b.classList.remove('alta','media','baja');
        b.textContent = (conf ?? 0) + '% confianza';
        if (conf >= 80) b.classList.add('alta');
        else if (conf >= 50) b.classList.add('media');
        else b.classList.add('baja');
      }

      function __LF_crearInputValidacion(id, label, valor){
        const ok = (valor != null);
        const valorFormateado = ok ? String(valor).replace('.', ',') : '';
        return `
          <div class="input-validacion ${ok ? 'detectado' : 'no-detectado'}" data-field="${id}">
            <label for="val_${id}" style="font-size:12px; font-weight:900; color:var(--muted); margin-bottom:6px; display:block">${label}</label>
            <input type="text" id="val_${id}" class="input" value="${valorFormateado}"
              placeholder="${ok ? '' : '❌ No detectado - introduce manualmente'}" />
            ${ok ? '<span class="check">✓</span>' : '<span class="warning">⚠️</span>'}
          </div>
        `;
      }

      function __LF_renderForm(datos){
        const form = __LF_q('formValidacionFactura');
        if (!form) return;
        __LF_lastParsedConfianza = Number(datos?.confianza || 0);
        form.innerHTML =
          __LF_crearInputValidacion('p1','Potencia P1 (kW)', datos.p1) +
          __LF_crearInputValidacion('p2','Potencia P2 (kW)', datos.p2) +
          __LF_crearInputValidacion('dias','Días de facturación', datos.dias) +
          __LF_crearInputValidacion('consumoPunta','Consumo Punta / P1 / E1 (kWh)', datos.consumoPunta) +
          __LF_crearInputValidacion('consumoLlano','Consumo Llano / P2 / E2 (kWh)', datos.consumoLlano) +
          __LF_crearInputValidacion('consumoValle','Consumo Valle / P3 / E3 (kWh)', datos.consumoValle);
        
        // Mostrar compañía detectada si no es genérico
        const companiaEl = __LF_q('companiaDetectada');
        const nombreEl = __LF_q('nombreCompania');
        if (companiaEl && nombreEl && datos.compania && datos.compania !== 'generico') {
          const nombres = {
            'iberdrola': 'Iberdrola',
            'totalenergies': 'TotalEnergies',
            'energyavm': 'Enérgya VM',
            'octopus': 'Octopus Energy',
            'visalia': 'Visalia',
            'plenitude': 'Eni Plenitude',
            'energiaxxi': 'Energía XXI'
          };
          nombreEl.textContent = nombres[datos.compania] || datos.compania;
          __LF_show(companiaEl);
        } else if (companiaEl) {
          __LF_hide(companiaEl);
        }
      }

      function __LF_warn(msg){
        const a = __LF_q('avisoFactura');
        if (!a) return;
        a.innerHTML = msg;
        __LF_show(a);
      }

      function __LF_focusTrapAttach(modal){
        __LF_focusTrapDetach();
        const focusables = () => Array.from(modal.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);

        const onKeyDown = (e) => {
          if (e.key !== 'Tab') return;
          const els = focusables();
          if (!els.length) return;
          const first = els[0];
          const last = els[els.length - 1];
          if (e.shiftKey && document.activeElement === first){
            e.preventDefault(); last.focus();
          } else if (!e.shiftKey && document.activeElement === last){
            e.preventDefault(); first.focus();
          }
        };

        modal.addEventListener('keydown', onKeyDown);
        window.__LF_focusTrapCleanup = () => modal.removeEventListener('keydown', onKeyDown);
      }

      function __LF_focusTrapDetach(){
        if (typeof window.__LF_focusTrapCleanup === 'function'){
          window.__LF_focusTrapCleanup();
        }
        window.__LF_focusTrapCleanup = null;
      }

      function __LF_lockScroll(){
        window.__LF_scrollY = window.scrollY || 0;
        document.documentElement.style.overflow = 'hidden';
      }
      function __LF_unlockScroll(){
        document.documentElement.style.overflow = '';
        window.scrollTo(0, window.__LF_scrollY || 0);
      }

      function __LF_openModal(){
        const modal = __LF_q('modalFactura');
        if (!modal) return;

        window.__LF_restoreFocusEl = document.activeElement;

        modal.classList.add('show');
        modal.setAttribute('aria-hidden','false');
        __LF_lockScroll();

        __LF_show(__LF_q('uploadAreaFactura'));
        __LF_hide(__LF_q('loaderFactura'));
        __LF_hide(__LF_q('resultadoFactura'));
        __LF_hide(__LF_q('btnOcrFactura'));

        const aviso = __LF_q('avisoFactura'); if(aviso){ aviso.innerHTML=''; __LF_hide(aviso); }
        const fi = __LF_q('fileInputFactura'); if(fi) fi.value = '';
        window.__LF_lastFile = null;
        __LF_lastParsedConfianza = 0;

        __LF_focusTrapAttach(modal);
        setTimeout(()=>{ (__LF_q('uploadAreaFactura') || modal).focus?.(); }, 0);
      }

      function __LF_closeModal(){
        const modal = __LF_q('modalFactura');
        if (!modal) return;

        modal.classList.remove('show');
        modal.setAttribute('aria-hidden','true');
        __LF_unlockScroll();

        __LF_focusTrapDetach();
        const prev = window.__LF_restoreFocusEl;
        if (prev && prev.focus) prev.focus();
        window.__LF_restoreFocusEl = null;
      }

      async function __LF_processPdf(file){
        if (!file || file.type !== 'application/pdf'){
          if (typeof toast === 'function') toast('Sube un PDF válido', 'err');
          return;
        }
        if (!window.pdfjsLib){
          if (typeof toast === 'function') toast('PDF.js no se ha cargado (bloqueo de red/CSP)', 'err');
          return;
        }
        window.__LF_lastFile = file;

        __LF_hide(__LF_q('uploadAreaFactura'));
        __LF_show(__LF_q('loaderFactura'));
        __LF_hide(__LF_q('resultadoFactura'));
        __LF_hide(__LF_q('btnOcrFactura'));
        const aviso = __LF_q('avisoFactura'); if(aviso){ aviso.innerHTML=''; __LF_hide(aviso); }

        try{
          const { textLines, textCompact, textRawLen } = await __LF_extraerTextoPDF(file);

          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));

          if (!textRawLen || textRawLen < 40){
            __LF_warn('⚠️ No se ha detectado texto seleccionable. Parece un PDF escaneado. Puedes probar <b>OCR (experimental)</b> o introducir los datos manualmente.');
            __LF_show(__LF_q('btnOcrFactura'));
            __LF_setBadge(0);
            __LF_renderForm({ p1:null,p2:null,dias:null,consumoPunta:null,consumoLlano:null,consumoValle:null,confianza:0 });
            return;
          }

          const datos = __LF_parsearDatos(textLines, textCompact);
          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Mostrar advertencias contextuales
          __LF_showContextualWarnings(datos);

        }catch(err){
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('uploadAreaFactura'));
          if (typeof toast === 'function') toast('Error al procesar factura PDF', 'err');
          console.error(err);
        }
      }

      async function __LF_loadTesseract(){
        try{
          const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
          return mod.default || mod;
        }catch(e){
          if (window.Tesseract) return window.Tesseract;
          await new Promise((ok,ko)=>{
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            s.onload = ok; s.onerror = ko;
            document.head.appendChild(s);
          });
          return window.Tesseract;
        }
      }

      async function __LF_runOcrOnLastFile(){
        const file = window.__LF_lastFile;
        if (!file){
          if (typeof toast === 'function') toast('Primero sube/arrastra un PDF', 'err');
          return;
        }
        if (!window.pdfjsLib || !__LF_ensurePdfWorker()){
          if (typeof toast === 'function') toast('PDF.js no disponible', 'err');
          return;
        }

        __LF_hide(__LF_q('uploadAreaFactura'));
        __LF_show(__LF_q('loaderFactura'));
        __LF_hide(__LF_q('resultadoFactura'));

        try{
          const T = await __LF_loadTesseract();

          const ab = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

          let ocrText = '';
          const pagesToScan = Math.min(pdf.numPages, 2);

          for (let p=1; p<=pagesToScan; p++){
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently:true });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;

            const { data } = await T.recognize(canvas, 'spa');
            ocrText += (data.text || '') + '\n';
          }

          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));

          const compact = ocrText.replace(/\s+/g,' ').trim();
          const lines = ocrText.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');

          const datos = __LF_parsearDatos(lines, compact);
          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Mostrar advertencias contextuales + nota de OCR experimental
          __LF_showContextualWarnings(datos);
          
          const avisoOCR = __LF_q('avisoFactura');
          if (avisoOCR && avisoOCR.innerHTML){
            avisoOCR.innerHTML = '🧠 <b>OCR aplicado (experimental).</b> ' + avisoOCR.innerHTML;
          } else {
            __LF_warn('🧠 <b>OCR aplicado (experimental).</b> Revisa con cuidado antes de aplicar.');
          }

        }catch(err){
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));
          if (typeof toast === 'function') toast('OCR falló o no pudo ejecutarse', 'err');
          console.error(err);
        }
      }

      function __LF_markErr(fieldId, isErr){
        const wrap = document.querySelector('.input-validacion[data-field="'+fieldId+'"]');
        if (!wrap) return;
        wrap.classList.toggle('err', !!isErr);
      }

      function __LF_applyValues(){
        const v = {
          p1: __LF_normNum(__LF_q('val_p1')?.value),
          p2: __LF_normNum(__LF_q('val_p2')?.value),
          dias: __LF_normNum(__LF_q('val_dias')?.value),
          consumoPunta: __LF_normNum(__LF_q('val_consumoPunta')?.value),
          consumoLlano: __LF_normNum(__LF_q('val_consumoLlano')?.value),
          consumoValle: __LF_normNum(__LF_q('val_consumoValle')?.value),
        };

        let ok = true;

        if (v.p1 == null || v.p1 < 0.5 || v.p1 > 20){ ok=false; __LF_markErr('p1', true); } else __LF_markErr('p1', false);
        if (v.p2 == null || v.p2 < 0.5 || v.p2 > 20){ ok=false; __LF_markErr('p2', true); } else __LF_markErr('p2', false);

        if (v.dias == null || v.dias < 1 || v.dias > 366){ ok=false; __LF_markErr('dias', true); } else __LF_markErr('dias', false);

        if (v.consumoPunta == null || v.consumoPunta < 0 || v.consumoPunta > 200000){ ok=false; __LF_markErr('consumoPunta', true); } else __LF_markErr('consumoPunta', false);
        if (v.consumoLlano == null || v.consumoLlano < 0 || v.consumoLlano > 200000){ ok=false; __LF_markErr('consumoLlano', true); } else __LF_markErr('consumoLlano', false);
        if (v.consumoValle == null || v.consumoValle < 0 || v.consumoValle > 200000){ ok=false; __LF_markErr('consumoValle', true); } else __LF_markErr('consumoValle', false);

        if (!ok){
          if (typeof toast === 'function') toast('Revisa los campos marcados en rojo antes de aplicar', 'err');
          return;
        }

        const set = (id, val) => { 
          const el = document.getElementById(id); 
          if (el) el.value = String(val).replace('.', ','); 
        };
        set('p1', v.p1);
        set('p2', v.p2);
        set('dias', v.dias);
        set('cPunta', v.consumoPunta);
        set('cLlano', v.consumoLlano);
        set('cValle', v.consumoValle);

        try{ if (typeof updateKwhHint === 'function') updateKwhHint(); }catch(_){}
        try{ if (typeof validateInputs === 'function') validateInputs(); }catch(_){}
        try{ if (typeof saveInputs === 'function') saveInputs(); }catch(_){}

        if (typeof toast === 'function') toast('✅ Datos aplicados correctamente', 'ok');

        const confidencePct = Math.max(0, Math.min(100, Number(__LF_lastParsedConfianza || 0)));
        const shouldAutoCalc = confidencePct >= 99.5; // Consideramos ≥99.5% como confianza plena para cubrir redondeos

        __LF_closeModal();

        hideResultsToInitialState();

        if (shouldAutoCalc){
          setStatus('Calculando...', 'loading');
          runCalculation();
        } else {
          setStatus('Hemos rellenado los datos con la factura. Revísalos y pulsa Calcular.', 'idle');
        }
      }

      window.__LF_bindFacturaParser = function(){
        const btn = __LF_q('btnSubirFactura');
        const modal = __LF_q('modalFactura');
        const uploadArea = __LF_q('uploadAreaFactura');
        const fileInput = __LF_q('fileInputFactura');
        const btnAplicar = __LF_q('btnAplicarFactura');
        const btnCancelar = __LF_q('btnCancelarFactura');
        const btnOcr = __LF_q('btnOcrFactura');

        if (!btn || !modal) return;
        if (btn.__LF_BOUND) return;
        btn.__LF_BOUND = true;

        // Guard global anti “abrir PDF al soltar fuera”
        if (!document.__LF_DND_GUARD){
          document.__LF_DND_GUARD = true;
          ['dragenter','dragover','dragleave','drop'].forEach(evt=>{
            document.addEventListener(evt, (e)=>{
              e.preventDefault();
              e.stopPropagation();
            }, false);
          });
        }

        btn.addEventListener('click', __LF_openModal);
        btnCancelar?.addEventListener('click', __LF_closeModal);

        modal.addEventListener('click', (e)=>{
          if (e.target === modal) __LF_closeModal();
        });

        document.addEventListener('keydown', (e)=>{
          if (e.key === 'Escape' && modal.classList.contains('show')) __LF_closeModal();
        });

        uploadArea?.addEventListener('click', ()=> fileInput?.click());
        uploadArea?.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fileInput?.click(); }});

        uploadArea?.addEventListener('dragover', (e)=>{
          e.preventDefault();
          uploadArea.classList.add('dragging');
        });
        uploadArea?.addEventListener('dragleave', ()=>{
          uploadArea.classList.remove('dragging');
        });
        uploadArea?.addEventListener('drop', (e)=>{
          e.preventDefault();
          uploadArea.classList.remove('dragging');
          const f = e.dataTransfer?.files?.[0];
          if (f) __LF_processPdf(f);
        });

        fileInput?.addEventListener('change', (e)=>{
          const f = e.target?.files?.[0];
          if (f) __LF_processPdf(f);
        });

        btnAplicar?.addEventListener('click', __LF_applyValues);
        btnOcr?.addEventListener('click', __LF_runOcrOnLastFile);
      };

    })();

    function runCalculation(forceRefresh = false){
      if (el.btnCalc && el.btnCalc.disabled) return;
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

      saveInputs();
      setStatus('Calculando...', 'loading');

      const loaded = await fetchTarifas(forceRefresh);
      if(!loaded) return;

      const pvpc = await crearTarifaPVPC(values);
      const base = Array.isArray(baseTarifasCache) ? baseTarifasCache.slice() : [];
      cachedTarifas = pvpc ? [...base, pvpc] : base;
      if(!pvpc) pvpcLastMeta=null;

      calculateLocal(values);
      state.lastSignature = signature;
      state.pending = false;
    }

    function toggleMenu(force){
      const s=(typeof force==='boolean')?force:!el.menuPanel.classList.contains('show');
      el.menuPanel.classList.toggle('show',s);
      el.btnMenu.setAttribute('aria-expanded',s?'true':'false');
    }

    document.addEventListener('DOMContentLoaded', async ()=>{
      initTooltips();
      applyThemeClass(document.documentElement.classList.contains('light-mode')?'light':'dark');
      updateThemeIcon();
      loadInputs();

      initialStatusText = el.statusText?.textContent || '';
      initialStatusClass = el.statusPill?.className || '';

      validateInputs();
      markPending('Introduce tus datos y pulsa Calcular para ver el ranking.');

      Object.values(el.inputs).forEach(i=>{
        i.addEventListener('input',()=>{
          updateKwhHint();
          scheduleCalculateDebounced();
        });
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
        toggleMenu();
      });

      el.menuPanel.addEventListener('click',(e)=>e.stopPropagation());
      document.addEventListener('click',()=>toggleMenu(false));
      document.addEventListener('keydown',(e)=>{if(e.key==='Escape')toggleMenu(false);});

      el.btnReset.addEventListener('click',(e)=>{
        createRipple(el.btnReset,e);
        toggleMenu(false);
        window.location.href = window.location.pathname + '?reset=1';
      });

      el.btnExport.addEventListener('click',(e)=>{
        createRipple(el.btnExport,e);
        toggleMenu(false);
        if(!state.rows || state.rows.length === 0){ toast('No hay datos para descargar','err'); return; }
        const headers = ['#','Tarifa','Potencia','Consumo','Impuestos','Total','Vs Mejor','Tipo','Web'];
        const rows = state.rows.map(r=>[r.posicion,r.nombre,r.potencia,r.consumo,r.impuestos,r.total,r.vsMejor,r.tipo,r.webUrl||'']);
        const csv = [headers, ...rows].map(r=>r.join(';')).join('\n');
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], {type:'text/csv;charset=utf-8;'});
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href',url);
        link.setAttribute('download',`ranking_tarifas_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility='hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast('Ranking descargado');
      });

      el.btnShare.addEventListener('click', async (e) => {
        createRipple(el.btnShare,e);
        toggleMenu(false);

        const d = saveInputs();
        const qp = new URLSearchParams(d).toString();
        const url = `${window.location.origin}${window.location.pathname}?${qp}`;
        await copyText(url);
        toast('Enlace copiado al portapapeles');
      });

      if (typeof window.__LF_bindFacturaParser === 'function') {
        window.__LF_bindFacturaParser();
      }

      $('scrollToResults').addEventListener('click',()=>$('heroKpis').scrollIntoView({behavior:'smooth',block:'start'}));
    });
  

// Fallback: si por cualquier motivo no se bindeó el click del área de subida, intenta abrir el selector
document.addEventListener('click', (e)=>{
  const ua = e.target && (e.target.closest ? e.target.closest('#uploadAreaFactura') : null);
  if (!ua) return;
  const fi = document.getElementById('fileInputFactura');
  if (fi && typeof fi.click === 'function') fi.click();
}, true);
