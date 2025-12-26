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

      // Calcular periodo de facturación
      const periodo = buildPvpcPeriodo(dias);
      const [fechaInicioYMD, fechaFinYMD] = periodo.periodoFacturacion.split(',');
      
      // Convertir fechas de YYYY-MM-DD a DD/MM/YYYY
      function convertirFecha(ymd) {
        const [y, m, d] = ymd.split('-');
        return `${d}/${m}/${y}`;
      }
      
      const fechaInicio = convertirFecha(fechaInicioYMD);
      const fechaFin = convertirFecha(fechaFinYMD);

      // Mapear zona a código numérico para el endpoint
      const zonaNum = esCanarias ? 2 : 1; // 1=Península, 2=Canarias, 3=Baleares, 4=Ceuta, 5=Melilla

      // Construir URL del nuevo endpoint
      const params = new URLSearchParams({
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        consumo_p1: String(Math.round(cPunta)),
        consumo_p2: String(Math.round(cLlano)),
        consumo_p3: String(Math.round(cValle)),
        potencia_p1: p1.toFixed(2),
        potencia_p2: p2.toFixed(2),
        zona: String(zonaNum),
        es_vivienda: viviendaMarcada ? 'true' : 'false'
      });

      // Usar PVPC_FACTURA_URL (o PVPC_PROXY_URL por retrocompatibilidad)
      const baseUrl = window.PVPC_FACTURA_URL || window.PVPC_PROXY_URL || '';
      if (!baseUrl) {
        console.error('PVPC: window.PVPC_FACTURA_URL no configurado');
        if (typeof toast === 'function' && !pvpcErrorShown) {
          toast('PVPC no disponible. Configura endpoint.', 'err');
          pvpcErrorShown = true;
        }
        return null;
      }

      const apiUrl = `${baseUrl}?${params}`;

      console.group('PVPC obtenerPVPC (ESIOS)');
      console.log('API URL:', apiUrl);
      console.log('Periodo:', fechaInicio, 'al', fechaFin, `(${dias} días)`);
      console.log(`Potencias: P1=${p1.toFixed(2)} P2=${p2.toFixed(2)}`);
      console.log(`Consumos: Punta=${Math.round(cPunta)} Llano=${Math.round(cLlano)} Valle=${Math.round(cValle)}`);
      console.log(`Zona: ${esCanarias ? 'Canarias' : 'Península'} (${zonaNum})`);
      console.log(`Vivienda: ${viviendaMarcada}`);
      console.groupEnd();

      try {
        const result = await fetchJsonWithTimeout(apiUrl, 12000);
        pvpcErrorShown = false;
        
        // El nuevo endpoint ya devuelve los datos en formato correcto
        // No necesita parsear, devolver directamente
        return result;
        
      } catch (error) {
        console.warn('PVPC fetch falló:', error?.message || error);
        if (typeof toast === 'function' && !pvpcErrorShown) {
          toast('PVPC (regulada) no disponible ahora. Intenta de nuevo.', 'err');
          pvpcErrorShown = true;
        }
        return null;
      }
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