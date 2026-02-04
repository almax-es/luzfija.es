// ===== BEGIN PVPC MODULE =====
    // Precios PVPC: Se cargan desde dataset estático en /data/pvpc/{geoId}/{YYYY-MM}.json
    // Dataset actualizado diariamente por GitHub Actions (scripts/pvpc_auto_fill.py)
    // que descarga de ESIOS API y carga huecos automáticamente.

    const PVPC_CACHE_PREFIX = 'pvpc_cache_v1';
    const PVPC_CACHE_LIMIT = 30;
    const pvpcCacheMemory = new Map();
    const pvpcInFlight = new Map();
    
    // Exponer como variable global para que lf-render.js pueda acceder
    window.pvpcLastMeta = null;
    window.pvpcPotenciaExcedida = false;
    
    let pvpcErrorShown = false;

    // Debug (no ensucia consola en producción)
    const PVPC_DEBUG = (function(){
      try{
        const p = new URLSearchParams(location.search);
        return p.get('debug') === '1' || localStorage.getItem('lf_debug') === '1' || window.__LF_DEBUG === true;
      }catch(e){ return window.__LF_DEBUG === true; }
    })();
    const pvpcDbg = (...args) => {
      if (PVPC_DEBUG && typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log('[PVPC]', ...args);
      }
    };

    const round2 = (n) => Math.round(n * 100) / 100;


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

    function computePvpcFiscal(meta, fiscal) {
      const CFG = window.LF_CONFIG;
      const terr = CFG ? CFG.getTerritorio(fiscal?.zona) : null;
      const impuestos = terr?.impuestos || {};
      const baseEnergia = (meta.terminoFijo || 0) + (meta.costeMargenPot || 0) + (meta.terminoVariable || 0) + (meta.bonoSocial || 0);
      const baseContador = meta.equipoMedida || 0;
      const impuestoElec = meta.impuestoElectrico || 0;
      const isCanarias = fiscal?.esCanarias || fiscal?.zona === 'canarias';
      const isCeutaMelilla = fiscal?.esCeutaMelilla || fiscal?.zona === 'ceutamelilla';
      const usoFiscal = fiscal?.usoFiscal || 'otros';
      let impuestoEnergia = 0;
      let impuestoContador = 0;
      let ivaBase = 0;
      let baseIPSI = 0;
      let iva = 0;

      if (isCanarias) {
        const energiaOtros = Number.isFinite(impuestos.energiaOtros) ? impuestos.energiaOtros : 0;
        impuestoEnergia = usoFiscal === 'vivienda' ? 0 : round2((baseEnergia + impuestoElec) * energiaOtros);
        const tipoContador = Number.isFinite(impuestos.contador) ? impuestos.contador : 0;
        impuestoContador = round2(baseContador * tipoContador);
      } else if (isCeutaMelilla) {
        baseIPSI = baseEnergia + impuestoElec;
        const energia = Number.isFinite(impuestos.energia) ? impuestos.energia : 0;
        impuestoEnergia = round2(baseIPSI * energia);
        const tipoContador = Number.isFinite(impuestos.contador) ? impuestos.contador : 0;
        impuestoContador = round2(baseContador * tipoContador);
      } else {
        ivaBase = baseEnergia + impuestoElec + baseContador;
        const energia = Number.isFinite(impuestos.energia) ? impuestos.energia : 0;
        impuestoEnergia = round2(ivaBase * energia);
        iva = impuestoEnergia;
      }

      const totalFactura = round2(baseEnergia + impuestoElec + baseContador + impuestoEnergia + impuestoContador);
      const impuestosTotal = round2((meta.bonoSocial || 0) + impuestoElec + baseContador + impuestoEnergia + impuestoContador);
      const impuestoTipo = impuestos.tipo || (isCanarias ? 'IGIC' : isCeutaMelilla ? 'IPSI' : 'IVA');

      return {
        baseEnergia,
        baseContador,
        impuestoEnergia,
        impuestoContador,
        ivaBase,
        baseIPSI,
        iva,
        totalFactura,
        impuestosTotal,
        impuestoTipo,
        usoFiscal,
        isCanarias,
        isCeutaMelilla
      };
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
      const zonaRaw = values?.zonaFiscal || 'Península';
      const zonaFiscal = zonaRaw === 'Canarias' ? 'Canarias' 
                       : zonaRaw === 'CeutaMelilla' ? 'CeutaMelilla' 
                       : 'Península';
      const viviendaCanarias = zonaFiscal === 'Canarias' && Boolean(values?.viviendaCanarias);
      const codigoPostal = window.LF_CONFIG.getCodigoPostalAPI(zonaFiscal);
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
      const d=Math.min(Math.max(Number(dias)||0,1),370);
      
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
      
      // Si ya es un número, lo devolvemos tal cual
      if (typeof val === 'number') return val;

      let s = String(val).trim().replace(/\s/g, '');
      
      // Detectar formato español de miles: "1.234" o "1.234,56" o "123.456.789,12"
      // Patrón: 1-3 dígitos, seguido de (punto + exactamente 3 dígitos) una o más veces
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
        // Es formato español: quitar puntos (separadores de miles), cambiar coma por punto
        s = s.replace(/\./g, '').replace(',', '.');
      }
      // Si tiene coma pero NO tiene puntos, o los puntos no siguen patrón de miles
      else if (s.includes(',')) {
        // Cambiar coma por punto decimal
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
        costeMargenPot: 0,
        terminoVariable: 0,
        bonoSocial: 0,
        impuestoElectrico: 0,
        equipoMedida: 0,
        iva: 0,
        totalFactura: 0,
        baseEnergia: 0,
        baseContador: 0,
        impuestoEnergia: 0,
        impuestoContador: 0,
        impuestosTotal: 0,
        ivaBase: 0,
        baseIPSI: 0,
        usoFiscal: 'otros'
      };

      let rangoFechas = null;
      let textoCompleto = '';

      try {
        const rangoTexto = stripHtml(lista[0]?.cabecera || lista[0]?.concepto || '');
        const rangoMatch = /Periodo:\s*del\s*(\d{2}\/\d{2}\/\d{4})\s*al\s*(\d{2}\/\d{2}\/\d{4})/i.exec(rangoTexto);
        if (rangoMatch) rangoFechas = { inicio: rangoMatch[1], fin: rangoMatch[2] };
      } catch (e) {}

      if (PVPC_DEBUG) console.group('PVPC parsearRespuestaPVPC (FIXED)');
      try {
        lista.forEach(item => {
          const cabeceraRaw = stripHtml(item?.cabecera || item?.concepto || '').trim();
          const cabecera = cabeceraRaw.toLowerCase();

          const exp = stripHtml(item?.explicacion || item?.detalle || item?.descripcion || '');
          textoCompleto += ` ${cabeceraRaw} ${exp} `;

          const importe = parseEuro(item?.importe ?? item?.valor ?? item?.precio ?? item?.total);

          pvpcDbg(`Concepto: ${cabecera} -> Importe: ${importe}`);

          if (cabecera.includes('margen de comercialización') || cabecera.includes('margen de comercializacion')) {
            meta.costeMargenPot += importe;
          }
          else if (cabecera.includes('término fijo') || cabecera.includes('termino fijo') || (cabecera.includes('potencia') && !cabecera.includes('margen'))) {
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
          else if (cabecera.includes('igic') || cabecera.includes('ipsi')) {
            meta.impuestoEnergia += importe;
          }
          else if (cabecera.includes('total factura')) {
            meta.totalFactura = importe;
          }
        });
      } finally {
        if (PVPC_DEBUG) console.groupEnd();
      }

      if (meta.totalFactura <= 0) {
        meta.totalFactura = meta.terminoFijo + meta.costeMargenPot + meta.terminoVariable + meta.bonoSocial + meta.impuestoElectrico + meta.equipoMedida + meta.iva;
      }
      if (meta.totalFactura <= 0) return null;

      const texto = stripHtml(textoCompleto || '');

      if (PVPC_DEBUG) {
        pvpcDbg('Texto completo extraído:', texto.substring(0, 500) + '...');
        pvpcDbg('Buscando precios por periodo...');
      }

      function extraerMaxPorPeriodo(periodo) {
        // Patrón más flexible: busca "P1:", "P1 ", "P1=", etc seguido de número €/kWh
        // Acepta espacios, paréntesis opcionales, y diferentes formatos
        const patterns = [
          // Formato 1: "P1: 0.123 €/kWh" o "P1 (descripción): 0.123 €/kWh"
          periodo + '(?:\\s*\\([^)]*\\))?\\s*[:=]\\s*([0-9]+(?:[.,][0-9]+)?)\\s*€\\s*\\/\\s*kWh',
          // Formato 2: "P1 0.123 €/kWh" (sin dos puntos)
          periodo + '\\s+([0-9]+(?:[.,][0-9]+)?)\\s*€\\s*\\/\\s*kWh',
          // Formato 3: más flexible con espacios
          periodo + '[:\\s=]+([0-9]+(?:[.,][0-9]+)?)\\s*€\\s*\\/\\s*kWh'
        ];

        const vals = [];
        
        for (const pattern of patterns) {
          const re = new RegExp(pattern, 'gi');
          for (const m of texto.matchAll(re)) {
            const v = parseEuro(m[1]);
            if (v > 0) {
              vals.push(v);
              pvpcDbg(`  ✓ ${periodo} encontrado: ${v.toFixed(4)} €/kWh`);
            }
          }
        }
        
        if (!vals.length) {
          pvpcDbg(`  ✗ ${periodo} NO encontrado en el texto`);
          return null;
        }
        
        // Calcular el promedio en lugar del máximo
        const sum = vals.reduce((acc, v) => acc + v, 0);
        const avg = sum / vals.length;
        pvpcDbg(`  → ${periodo} promedio: ${avg.toFixed(4)} €/kWh (de ${vals.length} valores)`);
        return avg;
      }

      const precioPunta = extraerMaxPorPeriodo('P1');
      const precioLlano = extraerMaxPorPeriodo('P2');
      const precioValle = extraerMaxPorPeriodo('P3');

      return { ...meta, precioPunta, precioLlano, precioValle, rangoFechas };
    }

    // PVPC (tarifa regulada) calculado 100% en local a partir de precios horarios
    // oficiales (REE/ESIOS, indicador 1001) previamente descargados en /data/pvpc.
    // Nota: este cálculo usa medias horarias por periodo (aproximación neutral).
    async function obtenerPVPC_LOCAL(values){
      const dias = Math.min(Math.max(Math.trunc(values?.dias) || 0, 1), 370);
      const p1 = Math.max(0, asNumber(values?.p1, 0));
      const p2 = Math.max(0, asNumber(values?.p2, 0));
      const cPunta = Math.max(0, asNumber(values?.cPunta, 0));
      const cLlano = Math.max(0, asNumber(values?.cLlano, 0));
      const cValle = Math.max(0, asNumber(values?.cValle, 0));
      
      const fiscal = typeof __LF_getFiscalContext === 'function'
        ? __LF_getFiscalContext(values)
        : (() => {
          const _parseNum = window.LF?.parseNum || (v => Math.max(0, Number(v) || 0));
          const _clampNonNeg = window.LF?.clampNonNeg || (n => Math.max(0, Number(n) || 0));
          const p1Num = _clampNonNeg(_parseNum(values?.p1));
          const p2Num = _clampNonNeg(_parseNum(values?.p2));
          const zonaRaw = (values?.zonaFiscal || '').toLowerCase();
          const zona = zonaRaw === 'canarias' ? 'canarias'
                     : zonaRaw === 'ceutamelilla' ? 'ceutamelilla'
                     : 'península';
          const potenciaContratada = Math.max(p1Num || 0, p2Num || 0);
          const esCanarias = zona === 'canarias';
          const esCeutaMelilla = zona === 'ceutamelilla';
          const viviendaMarcada = Boolean(values?.viviendaCanarias);
          const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
          const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';
          return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal, esCanarias, esCeutaMelilla };
        })();

      const esCanarias = fiscal?.esCanarias || (fiscal?.zona === 'canarias');
      const esCeutaMelilla = fiscal?.esCeutaMelilla || (fiscal?.zona === 'ceutamelilla');
      const viviendaMarcada = Boolean(fiscal?.viviendaMarcada);
      const potenciaContratada = Number(fiscal?.potenciaContratada || 0);

      // PVPC solo disponible para potencia ≤ 10 kW en toda España
      window.pvpcPotenciaExcedida = potenciaContratada > 10;
      if (window.pvpcPotenciaExcedida) {
        return null;
      }

      // Festivos nacionales de fecha FIJA (MM-DD) según CNMC Circular 3/2020.
      // EXCLUYE festivos móviles como Viernes Santo (BOE-A-2020-1066).
      // Se usa únicamente para la lógica de periodos 2.0TD (valle todo el día).
      const FESTIVOS_NACIONALES_MMDD = new Set([
        '01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'
      ]);

      // Festivo nacional (solo fecha fija). Input esperado: "YYYY-MM-DD".
      const esFestivoNacional = (ymd) => {
        const s = String(ymd || '');
        if (s.length < 10) return false;
        const mmdd = s.slice(5, 10);
        return FESTIVOS_NACIONALES_MMDD.has(mmdd);
      };
const PEAJES_POT_DIA = {
        p1: 0.075901,
        p2: 0.001987,
        margen: 0.008529
      };

      // GeoId para precios horarios (REE/ESIOS). En el UI Ceuta/Melilla viene combinado;
      // usamos el geo_id de Ceuta (8744). Si por cualquier razón faltase, hacemos fallback a 8745.
      const geoMap = { 'Península': 8741, 'Canarias': 8742, 'Baleares': 8743, 'CeutaMelilla': 8744 };
      const zonaFiscal = esCanarias ? 'Canarias' : esCeutaMelilla ? 'CeutaMelilla' : 'Península';
      const geoId = geoMap[zonaFiscal] || 8741;
      const geoFallbackId = (zonaFiscal === 'CeutaMelilla') ? 8745 : null;

      // Periodo: últimos N días cerrados, terminando en AYER (incluido).
      // Se calcula en hora local para evitar desajustes por UTC (toISOString).
      const endDate = startOfDayLocal(new Date());
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (dias - 1));

      const startStr = formatYMD(startDate);
      const endStr = formatYMD(endDate);

      const weekdayFromYMD = (ymd) => {
        const parts = String(ymd || '').split('-').map(Number);
        if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 0;
        const [y, m, d] = parts;
        return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      };

      if (PVPC_DEBUG) console.group('PVPC obtenerPVPC_LOCAL');
      pvpcDbg('Periodo:', startStr, 'al', endStr, `(${dias} días)`);
      pvpcDbg('Zona:', zonaFiscal, `(geoId: ${geoId})`);
      if (PVPC_DEBUG) console.groupEnd();

      try {
        const filesToRead = new Set();
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          filesToRead.add(`${year}-${month}`);
        }

        const allPrices = {};
        const missingMonths = [];
        // Zona horaria por defecto según geo (se refuerza con el campo "timezone" de cada JSON)
        let dataTimezone = (geoId === 8742) ? 'Atlantic/Canary' : 'Europe/Madrid';
        for (const monthKey of filesToRead) {
          const primaryUrl = `/data/pvpc/${geoId}/${monthKey}.json`;
          let response = await fetch(primaryUrl);
          if ((!response || !response.ok) && geoFallbackId) {
            const fallbackUrl = `/data/pvpc/${geoFallbackId}/${monthKey}.json`;
            response = await fetch(fallbackUrl);
          }
          if (!response || !response.ok) {
            pvpcDbg(`[WARN] Datos PVPC faltantes para mes: ${monthKey} (geo: ${geoId})`);
            missingMonths.push(monthKey);
            continue;
          }
          const data = await response.json();
          if (data && typeof data.timezone === 'string' && data.timezone) dataTimezone = data.timezone;
          Object.assign(allPrices, data.days || {});
        }
        
        // Si faltan muchos meses, avisar
        if (missingMonths.length > 0) {
          const monthsStr = missingMonths.join(', ');
          console.warn(`[PVPC] ⚠️ Datos incompletos. Faltan meses: ${monthsStr}`);
          pvpcDbg(`[ERROR] Cálculo PVPC incompleto. Periodo solicitado: ${startStr} al ${endStr}, pero faltan datos para: ${monthsStr}`);
        }

        // Extraer hora local (de la zona del geo) desde el epoch. Esto evita errores en días con cambio de hora.
        const hourFormatter = new Intl.DateTimeFormat('es-ES', {
          hour: '2-digit',
          hour12: false,
          timeZone: dataTimezone
        });
        const hourFromTs = (tsSeconds) => {
          const hStr = hourFormatter.format(new Date(Number(tsSeconds) * 1000));
          let h = parseInt(hStr, 10);
          if (h === 24) h = 0;
          return Number.isFinite(h) ? h : 0;
        };

        // Horarios según zona (CNMC Circular 3/2020)
        // Península/Baleares/Canarias: iguales (10-14 y 18-22)
        // Ceuta/Melilla: desplazados +1h (11-15 y 19-23)
        const horasPunta = esCeutaMelilla ? [11,12,13,14,19,20,21,22] : [10,11,12,13,18,19,20,21];
        const horasValle = [0,1,2,3,4,5,6,7]; // Igual para todas las zonas
        
        // Calcular precios medios por periodo (método de aproximación)
        let sumPunta = 0, countPunta = 0;
        let sumLlano = 0, countLlano = 0;
        let sumValle = 0, countValle = 0;
        
        const curr = new Date(startDate);
        while (curr <= endDate) {
          const dateStr = formatYMD(curr);
          const dayPrices = allPrices[dateStr];
          
          if (dayPrices && Array.isArray(dayPrices)) {
            const dayOfWeek = weekdayFromYMD(dateStr);
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isFestivo = esFestivoNacional(dateStr);

            dayPrices.forEach(([ts, precio]) => {
              const hora = hourFromTs(ts);
              // FINES DE SEMANA Y FESTIVOS: TODO EL DÍA ES VALLE
              if (isWeekend || isFestivo) {
                sumValle += precio;
                countValle++;
              } else {
                // Laborables normales
                if (horasPunta.includes(hora)) {
                  sumPunta += precio;
                  countPunta++;
                } else if (horasValle.includes(hora)) {
                  sumValle += precio;
                  countValle++;
                } else {
                  sumLlano += precio;
                  countLlano++;
                }
              }
            });
          }
          
          curr.setDate(curr.getDate() + 1);
        }
        
        if (countPunta === 0 && countLlano === 0 && countValle === 0) {
          throw new Error('No hay datos para el periodo');
        }
        
        const precioP1 = countPunta > 0 ? sumPunta / countPunta : 0;
        const precioP2 = countLlano > 0 ? sumLlano / countLlano : 0;
        const precioP3 = countValle > 0 ? sumValle / countValle : 0;
        
        pvpcErrorShown = false;
        
        // TÉRMINO FIJO (solo peajes de potencia)
        const costePeajePotP1 = p1 * PEAJES_POT_DIA.p1 * dias;
        const costePeajePotP2 = p2 * PEAJES_POT_DIA.p2 * dias;
        const terminoFijo = costePeajePotP1 + costePeajePotP2;

        // MARGEN DE COMERCIALIZACIÓN (separado)
        const costeMargenPot = p1 * PEAJES_POT_DIA.margen * dias;
        
        // TÉRMINO VARIABLE
        const terminoVariable = cPunta * precioP1 + cLlano * precioP2 + cValle * precioP3;
        
        const consumoTotal = cPunta + cLlano + cValle;
        const precioMedio = consumoTotal > 0 ? terminoVariable / consumoTotal : 0;
        
        // BONO SOCIAL
        const bonoSocial = window.LF_CONFIG ? window.LF_CONFIG.calcularBonoSocial(dias) : (6.979247 / 365 * dias);
        
        // IMPUESTO ELÉCTRICO
        const baseIEE = terminoFijo + costeMargenPot + terminoVariable + bonoSocial;
        const impuestoElectrico = (window.LF_CONFIG && typeof window.LF_CONFIG.calcularIEE === 'function')
          ? round2(window.LF_CONFIG.calcularIEE(baseIEE, consumoTotal))
          : round2(Math.max((5.11269632 / 100) * baseIEE, consumoTotal * 0.001));
        
        // ALQUILER
        const equipoMedida = window.LF_CONFIG ? window.LF_CONFIG.calcularAlquilerContador(dias) : (dias * 0.81 * 12 / 365);

        const fiscalMeta = computePvpcFiscal({
          terminoFijo,
          costeMargenPot,
          terminoVariable,
          bonoSocial,
          impuestoElectrico,
          equipoMedida
        }, fiscal);

        const totalFactura = fiscalMeta.totalFactura;

        const impuestoLineas = (() => {
          if (fiscalMeta.isCanarias) {
            return [
              {
                cabecera: 'IGIC energía',
                importe: fiscalMeta.impuestoEnergia.toFixed(2)
              },
              {
                cabecera: 'IGIC contador',
                importe: fiscalMeta.impuestoContador.toFixed(2)
              }
            ];
          }
          if (fiscalMeta.isCeutaMelilla) {
            return [
              {
                cabecera: 'IPSI energía',
                importe: fiscalMeta.impuestoEnergia.toFixed(2)
              },
              {
                cabecera: 'IPSI contador',
                importe: fiscalMeta.impuestoContador.toFixed(2)
              }
            ];
          }
          return [
            {
              cabecera: 'IVA',
              importe: fiscalMeta.iva.toFixed(2)
            }
          ];
        })();
        
          return {
          resultadoPVPC: [
            {
              cabecera: `Periodo: del ${startStr.split('-').reverse().join('/')} al ${endStr.split('-').reverse().join('/')}`,
              importe: '0.00'
            },
            {
              cabecera: 'Término de Potencia',
              importe: terminoFijo.toFixed(2),
              explicacion: `Importe por peajes de transporte y distribución de potencia\nP1 (Punta): ${p1} kW × ${PEAJES_POT_DIA.p1.toFixed(6)} €/kW·día × ${dias} días = ${costePeajePotP1.toFixed(2)} €\nP2 (Valle): ${p2} kW × ${PEAJES_POT_DIA.p2.toFixed(6)} €/kW·día × ${dias} días = ${costePeajePotP2.toFixed(2)} €`
            },
            {
              cabecera: 'Margen de comercialización',
              importe: costeMargenPot.toFixed(2),
              explicacion: `Margen de comercialización fijo sobre P1: ${p1} kW × ${PEAJES_POT_DIA.margen.toFixed(6)} €/kW·día × ${dias} días = ${costeMargenPot.toFixed(2)} €`
            },
            {
              cabecera: 'Término variable',
              importe: terminoVariable.toFixed(2),
              explicacion: `Coste energía: ${Math.round(consumoTotal)} kWh x ${precioMedio.toFixed(6)} €/kWh = ${terminoVariable.toFixed(2)} €\n\nPrecios medios estimados del término variable por periodo (incluye peajes/cargos + coste de la energía):\n- P1 (Punta): ${precioP1.toFixed(4)} €/kWh\n- P2 (Llano): ${precioP2.toFixed(4)} €/kWh\n- P3 (Valle): ${precioP3.toFixed(4)} €/kWh\n\nPrecio medio estimado del término variable: ${precioMedio.toFixed(6)} €/kWh\n\nMetodología: media horaria por periodo sobre precios oficiales horarios REE/ESIOS (indicador 1001). El simulador de la CNMC puede diferir ligeramente al aplicar perfiles estadísticos de consumo.`
            },
            {
              cabecera: 'Financiación del bono social',
              importe: bonoSocial.toFixed(2)
            },
            {
              cabecera: 'Impuesto eléctrico',
              importe: impuestoElectrico.toFixed(2)
            },
            {
              cabecera: 'Equipo de medida',
              importe: equipoMedida.toFixed(2)
            },
            ...impuestoLineas,
            {
              cabecera: 'Total Factura',
              importe: totalFactura.toFixed(2)
            }
          ],
          // CAMPOS EXTRA PARA USO INTERNO (inyectados para evitar parseo de strings)
          precioPunta: precioP1,
          precioLlano: precioP2,
          precioValle: precioP3,
          totalFactura: totalFactura,
          terminoFijo: terminoFijo,
          terminoVariable: terminoVariable,
          impuestoElectrico: impuestoElectrico,
          bonoSocial: bonoSocial,
          equipoMedida: equipoMedida,
          costeMargenPot: costeMargenPot
        };
      } catch (err) {
        pvpcDbg('[ERROR] PVPC lectura de datos locales falló:', err?.message || err);
        if (typeof toast === 'function' && !pvpcErrorShown) {
          toast('PVPC: No se pudieron cargar los datos de precios. Compara con tarifas comerciales.', 'err');
          pvpcErrorShown = true;
        }
        return null;
      }
    }


    function pvpcSignatureFromValues(v){
      const norm=n=>Number(Number(n||0).toFixed(4));
      const zonaRaw = v?.zonaFiscal || 'Península';
      const zonaFiscal = zonaRaw === 'Canarias' ? 'Canarias' 
                       : zonaRaw === 'CeutaMelilla' ? 'CeutaMelilla' 
                       : 'Península';
      const values={
        dias: Math.min(Math.max(Math.trunc(v?.dias)||0,1),370),
        p1: norm(v?.p1),
        p2: norm(v?.p2),
        cPunta: norm(v?.cPunta),
        cLlano: norm(v?.cLlano),
        cValle: norm(v?.cValle),
        zonaFiscal,
        viviendaCanarias: zonaFiscal === 'Canarias' && Boolean(v?.viviendaCanarias)
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
          const _parseNum = window.LF?.parseNum || (v => Math.max(0, Number(v) || 0));
          const _clampNonNeg = window.LF?.clampNonNeg || (n => Math.max(0, Number(n) || 0));
          const p1Num = _clampNonNeg(_parseNum(values?.p1));
          const p2Num = _clampNonNeg(_parseNum(values?.p2));
          const zonaRaw = (values?.zonaFiscal || '').toLowerCase();
          const zona = zonaRaw === 'canarias' ? 'canarias'
                     : zonaRaw === 'ceutamelilla' ? 'ceutamelilla'
                     : 'península';
          const potenciaContratada = Math.max(p1Num || 0, p2Num || 0);
          const esCanarias = zona === 'canarias';
          const esCeutaMelilla = zona === 'ceutamelilla';
          const viviendaMarcada = Boolean(values?.viviendaCanarias);
          const esViviendaTipoCero = esCanarias && viviendaMarcada && potenciaContratada > 0 && potenciaContratada <= 10;
          const usoFiscal = esViviendaTipoCero ? 'vivienda' : 'otros';
          return { zona, viviendaMarcada, potenciaContratada, esViviendaTipoCero, usoFiscal, esCanarias, esCeutaMelilla };
        })();
      const esCanarias = fiscal?.esCanarias || (fiscal?.zona === 'canarias');
      const viviendaMarcada = Boolean(fiscal?.viviendaMarcada);
      const potenciaContratada = Number(fiscal?.potenciaContratada || 0);
      // PVPC solo disponible para potencia ≤ 10 kW en toda España
      window.pvpcPotenciaExcedida = potenciaContratada > 10;

      if (window.pvpcPotenciaExcedida) {
        window.pvpcLastMeta = null;
        return {
          nombre:'PVPC (Regulada) ⚡',
          tipo:'3P',
          p1:0, p2:0,
          cPunta:0,
          cLlano:0,
          cValle:0,
	          web:'https://www.esios.ree.es/',
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
        window.pvpcLastMeta = window.pvpcPotenciaExcedida ? null : (cached.meta||null);
        const tarifaCached = { ...cached.tarifa };
        tarifaCached.pvpcWarning = window.pvpcPotenciaExcedida;
        tarifaCached.pvpcNotComputable = window.pvpcPotenciaExcedida;
        if(window.pvpcPotenciaExcedida){
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
	          const data=await obtenerPVPC_LOCAL(values);
	          if(!data){ if(!pvpcErrorShown){toast('PVPC: Datos de precios no disponibles para tu zona/período.','err'); pvpcErrorShown=true;} return null; }
          const parsed=parsearRespuestaPVPC(data);
          if(!parsed){ if(!pvpcErrorShown){toast('PVPC: Error al procesar datos de precios.','err'); pvpcErrorShown=true;} return null; }

          const fiscalMeta = computePvpcFiscal(parsed, fiscal);
          const totalFactura = (Number.isFinite(fiscalMeta.totalFactura) && fiscalMeta.totalFactura > 0)
            ? fiscalMeta.totalFactura
            : parsed.totalFactura;

          const tarifa={
            nombre:'PVPC (Regulada) ⚡',
            tipo:'3P',
            p1:0, p2:0,
            cPunta:parsed.precioPunta||0,
            cLlano:parsed.precioLlano||0,
            cValle:parsed.precioValle||0,
	            web:'https://www.esios.ree.es/',
            esPVPC:true,
            pvpcWarning: window.pvpcPotenciaExcedida,
            pvpcNotComputable: window.pvpcPotenciaExcedida,
            metaPvpc:{
              terminoFijo:parsed.terminoFijo,
              costeMargenPot:parsed.costeMargenPot||0,
              terminoVariable:parsed.terminoVariable,
              bonoSocial:parsed.bonoSocial||0,
              impuestoElectrico:parsed.impuestoElectrico,
              equipoMedida:parsed.equipoMedida,
              iva:fiscalMeta.iva,
              totalFactura:totalFactura,
              baseEnergia:fiscalMeta.baseEnergia,
              baseContador:fiscalMeta.baseContador,
              impuestoEnergia:fiscalMeta.impuestoEnergia,
              impuestoContador:fiscalMeta.impuestoContador,
              impuestosTotal:fiscalMeta.impuestosTotal,
              ivaBase:fiscalMeta.ivaBase,
              baseIPSI:fiscalMeta.baseIPSI,
              usoFiscal:fiscalMeta.usoFiscal
            }
          };

          if(window.pvpcPotenciaExcedida){
            tarifa.totalNum = Number.POSITIVE_INFINITY;
            tarifa.total = '—';
            tarifa.impuestos = '—';
            tarifa.impuestosNum = 0;
            tarifa.potencia = '—';
            tarifa.consumo = '—';
            tarifa.potenciaNum = 0;
            tarifa.consumoNum = 0;
          }

          window.pvpcLastMeta={
            precioPunta:parsed.precioPunta,
            precioLlano:parsed.precioLlano,
            precioValle:parsed.precioValle,
            rangoFechas:parsed.rangoFechas||null,
            fechaConsulta:new Date().toISOString()
          };

          const payload={tarifa, meta: window.pvpcLastMeta, ts: Date.now()};
          persistPvpcCacheEntry(signature,payload);
          return tarifa;
        }catch(err){
          pvpcDbg('[ERROR] Error procesando PVPC', err);
          if(!pvpcErrorShown){toast('PVPC: Error inesperado. Compara con tarifas comerciales.','err'); pvpcErrorShown=true;}
          return null;
        }
      })();

      pvpcInFlight.set(signature,p);
      return p.finally(()=>pvpcInFlight.delete(signature));
    }

    // ===== EXPORT FOR TESTING & MODERN USAGE =====
    window.LF = window.LF || {};
    window.LF.pvpc = {
        crearTarifaPVPC,
        obtenerPVPC_LOCAL,
        parsearRespuestaPVPC
    };

    // ===== END PVPC MODULE =====
