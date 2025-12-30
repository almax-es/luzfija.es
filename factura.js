    (function(){
      if (window.__LF_facturaParserLoaded) return;
      window.__LF_facturaParserLoaded = true;

      // Helper de debug: solo loguea si __LF_DEBUG está activo
      const lfDbg = (...args) => { if (window.__LF_DEBUG) console.log(...args); };

      window.__LF_lastFile = null;
      window.__LF_restoreFocusEl = null;
      window.__LF_focusTrapCleanup = null;
      window.__LF_scrollY = 0;
      let __LF_lastParsedConfianza = 0;

      let __LF_pdfjsLoading = null;
      const __LF_PDFJS_SOURCES = [
        {
          lib: "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
          worker: "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
        },
        {
          lib: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
          worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
        }
      ];
      let __LF_pdfWorkerSrcSelected = null;
      function __LF_ensurePdfWorker(){
        const lib = window.pdfjsLib;
        if (!lib) return false;
        if (!lib.GlobalWorkerOptions.workerSrc) {
          lib.GlobalWorkerOptions.workerSrc = __LF_pdfWorkerSrcSelected || __LF_PDFJS_SOURCES[0].worker;
        }
        return true;
      }

      function __LF_loadScript(src){
        return new Promise((resolve, reject)=>{
          const s = document.createElement("script");
          s.src = src;
          s.async = true;
          s.crossOrigin = "anonymous"; // Necesario para SRI (Subresource Integrity)
          s.onload = () => resolve(true);
          s.onerror = () => reject(new Error("No se pudo cargar: " + src));
          document.head.appendChild(s);
        });
      }

      async function __LF_ensurePdfJs(){
        if (window.pdfjsLib && __LF_ensurePdfWorker()) return window.pdfjsLib;
        if (__LF_pdfjsLoading) {
          await __LF_pdfjsLoading;
        }
        if (window.pdfjsLib && __LF_ensurePdfWorker()) return window.pdfjsLib;
        const existingScript = document.querySelector('script[src*="pdfjs-dist@3.11.174/build/pdf.min.js"]');
        if (existingScript && !window.pdfjsLib){
          if (!__LF_pdfjsLoading){
            __LF_pdfjsLoading = new Promise((resolve) => {
              let done = false;
              let timer;
              const finish = () => {
                if (done) return;
                done = true;
                existingScript.removeEventListener("load", onLoad);
                existingScript.removeEventListener("error", onError);
                clearTimeout(timer);
                resolve();
              };
              const onLoad = () => finish();
              const onError = () => finish();
              timer = setTimeout(finish, 4000);
              existingScript.addEventListener("load", onLoad);
              existingScript.addEventListener("error", onError);
            });
          }
          await __LF_pdfjsLoading;
          __LF_pdfjsLoading = null;
        }
        if (!window.pdfjsLib){
          let lastErr = null;
          for (const srcSet of __LF_PDFJS_SOURCES){
            try {
              __LF_pdfWorkerSrcSelected = srcSet.worker;
              __LF_pdfjsLoading = __LF_loadScript(srcSet.lib);
              await __LF_pdfjsLoading;
              __LF_pdfjsLoading = null;
              if (window.pdfjsLib && __LF_ensurePdfWorker()) break;
            } catch (e) {
              lastErr = e;
              __LF_pdfjsLoading = null;
            }
          }
          if (!window.pdfjsLib && lastErr) throw lastErr;
        }
        if (!window.pdfjsLib || !__LF_ensurePdfWorker()){
          throw new Error("PDF.js no disponible");
        }
        return window.pdfjsLib;
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
        const days = Math.floor(ms / 86400000);
        if (!isFinite(days) || days <= 0 || days > 400) return null;
        return days;
      }

      async function __LF_extraerTextoPDF(file){
        await __LF_ensurePdfJs();
        const ab = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;

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
          if (debugLabel) lfDbg(`[DEBUG ${debugLabel}] ❌ No matches encontrados en ${patrones.length} patrones`);
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
          lfDbg(`[DEBUG ${debugLabel}] ✅ Match encontrado:`, {
            valor: result,
            totalMatches: hits.length,
            frecuencia: bestCount,
            primerMatch: debugMatches[0]
          });
        }
        
        return result;
      }

      // NUEVO: Extracción específica para potencias contratadas de Endesa
      function __LF_extractPotenciasEndesa(texto) {
        const lineas = texto.split(/\r?\n/).map(l => l.trim());
        
        // Buscar "Potencias contratadas: punta-llano X kW; valle Y kW"
        for (let i = 0; i < lineas.length; i++) {
          const linea = lineas[i];
          const lineaLow = linea.toLowerCase();
          
          if (lineaLow.includes('potencias contratadas')) {
            // Patrón: "punta-llano 2,300 kW; valle 3,450 kW"
            const matchPuntaLlano = linea.match(/punta[\s\-]*llano\s+([\d,\.]+)\s*kw/i);
            const matchValle = linea.match(/valle\s+([\d,\.]+)\s*kw/i);
            
            if (matchPuntaLlano && matchValle) {
              const p1 = parseFloat(matchPuntaLlano[1].replace(',', '.'));
              const p2 = parseFloat(matchValle[1].replace(',', '.'));
              
              if (!isNaN(p1) && !isNaN(p2)) {
                lfDbg('[ENDESA-POTENCIAS] Detectadas desde "Potencias contratadas":', { p1, p2 });
                return { p1, p2 };
              }
            }
          }
          
          // También buscar en el detalle de factura: "Pot. Punta-Llano 2,300 kW"
          if (lineaLow.includes('pot.') && lineaLow.includes('punta')) {
            const matchPuntaLlano = linea.match(/pot\.\s*punta[\s\-]*llano\s+([\d,\.]+)\s*kw/i);
            if (matchPuntaLlano) {
              const p1 = parseFloat(matchPuntaLlano[1].replace(',', '.'));
              
              // Buscar "Pot. Valle" en las siguientes líneas
              for (let j = i + 1; j < Math.min(i + 3, lineas.length); j++) {
                const lineaSiguiente = lineas[j];
                const matchValle = lineaSiguiente.match(/pot\.\s*valle\s+([\d,\.]+)\s*kw/i);
                
                if (matchValle) {
                  const p2 = parseFloat(matchValle[1].replace(',', '.'));
                  
                  if (!isNaN(p1) && !isNaN(p2)) {
                    lfDbg('[ENDESA-POTENCIAS] Detectadas desde detalle de factura:', { p1, p2 });
                    return { p1, p2 };
                  }
                }
              }
            }
          }
        }
        
        return null;
      }

      // NUEVO: Extracción específica para facturas de Endesa
      function __LF_extractConsumoEndesa(texto) {
        const lineas = texto.split(/\r?\n/).map(l => l.trim());
        
        for (let i = 0; i < lineas.length; i++) {
          const linea = lineas[i];
          const lineaLow = linea.toLowerCase();
          
          // Buscar la fila con "Energía" y "kWh" (encabezado de la tabla)
          if ((lineaLow.includes('energía') || lineaLow.includes('energia')) && 
              lineaLow.includes('kwh')) {
            
            // Buscar Punta, Llano, Valle en las siguientes ~10 líneas (no necesariamente consecutivas)
            let punta = null, llano = null, valle = null;
            
            for (let j = i + 1; j < Math.min(i + 10, lineas.length); j++) {
              const lineaActual = lineas[j];
              const lineaLow = lineaActual.toLowerCase();
              
              const extraerConsumo = (str) => {
                const nums = str.match(/\d+[,\.]\d+|\d+/g);
                if (!nums || nums.length === 0) return null;
                
                // Buscar de atrás hacia adelante el primer número que sea consumo razonable (0-5000)
                for (let k = nums.length - 1; k >= 0; k--) {
                  let normalizado = nums[k].replace(',', '.');
                  const partes = normalizado.split('.');
                  if (partes.length > 2) {
                    const decimal = partes.pop();
                    normalizado = partes.join('') + '.' + decimal;
                  }
                  const num = parseFloat(normalizado);
                  // Filtrar: debe ser razonable para consumo mensual (0-5000 kWh)
                  if (!isNaN(num) && num >= 0 && num <= 5000) {
                    return num;
                  }
                }
                return null;
              };
              
              if ((lineaLow.includes('punta') || lineaLow.includes('p1')) && punta === null) {
                punta = extraerConsumo(lineaActual);
              }
              if ((lineaLow.includes('llano') || lineaLow.includes('p2')) && llano === null) {
                llano = extraerConsumo(lineaActual);
              }
              if ((lineaLow.includes('valle') || lineaLow.includes('p3')) && valle === null) {
                valle = extraerConsumo(lineaActual);
              }
              
              // Si ya tenemos los 3, salir
              if (punta != null && llano != null && valle != null) {
                lfDbg('[ENDESA-ESPECÍFICO] Tabla detectada:', { punta, llano, valle });
                return { punta, llano, valle };
              }
            }
          }
        }
        
        return null;
      }

      // FIX: extraer triple consumo explícito "Consumo en el periodo"
      function __LF_extractTripleConsumo(texto){
        if (!texto) return null;
        const t = String(texto);

        // ✅ NUEVO: Intentar extracción específica para Endesa PRIMERO
        const endesaResult = __LF_extractConsumoEndesa(t);
        if (endesaResult) {
          return endesaResult;
        }

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

        // ✅ Gana Energía (comercializadora) — evitar falso positivo por "IBERDROLA DISTRIBUCION" (distribuidora i-DE)
        if (
          t.includes('gana energía') || t.includes('gana energia') ||
          t.includes('ganaenergia.com') || t.includes('clientes@ganaenergia.com') ||
          t.includes('gaolania') || t.includes('gaolania servicios') ||
          t.includes('b98717457')
        ) return 'ganaenergia';

        // ✅ Visalia / Grupo Visalia (comercializadora) — evitar falso positivo por "Distribuidora: ENDESA"
        // En esta factura aparecen señales claras de Visalia (dominio/email/CIF), aunque la distribuidora sea ENDESA.
        if (
          t.includes('visalia.com.es') ||
          t.includes('clientes@grupovisalia.com') ||
          t.includes('datos@grupovisalia.com') ||
          t.includes('grupovisalia') ||
          t.includes('doméstica gas y electricidad') || t.includes('domestica gas y electricidad') ||
          t.includes('b99340564')
        ) return 'visalia';

        // ⚠️ Endesa: NO detectar por la distribuidora (e-distribución / endesadistribucion).
        // Solo marcamos "endesa" cuando hay señales claras de la comercializadora.
        if (t.includes('endesa')) {
          const endesaCom = (
            t.includes('endesa energía') || t.includes('endesa energia') ||
            t.includes('endesaenergia') ||
            t.includes('endesaclientes') || t.includes('endesa clientes') ||
            t.includes('@endesa') ||
            t.includes('www.endesa') || t.includes('endesa.com')
          );

          const endesaDist = (
            t.includes('endesadistribucion') ||
            t.includes('zonaprivada.endesadistribucion') ||
            t.includes('e-distribución') || t.includes('e-distribucion') ||
            (t.includes('distribuidora') && t.includes('endesa'))
          );

          if (endesaCom) return 'endesa';
          if (!endesaDist) return 'endesa'; // "ENDESA" sin señales de distribuidora: asumimos comercializadora
          // Si solo aparece por la distribuidora, NO clasificamos como endesa
        }

        // ⚠️ Iberdrola: NO detectar por la distribuidora (i-DE / IBERDROLA DISTRIBUCION).
        // Solo marcamos "iberdrola" cuando hay señales claras de la comercializadora.
        const iberCom = (
          t.includes('iberdrola clientes') ||
          t.includes('iberdrola comercial') ||
          t.includes('iberdrola comercializ') ||
          t.includes('curenergia') || t.includes('curenergía') ||
          t.includes('@iberdrola.') ||
          t.includes('www.iberdrola') || t.includes('iberdrola.es') || t.includes('iberdrola.com')
        );

        if (t.includes('iberdrola')) {
          const iberDist = (
            t.includes('iberdrola distribuci') ||
            (t.includes('distribuidora') && t.includes('iberdrola')) ||
            t.includes('i-de') || t.includes('i de redes') ||
            t.includes('redes eléctricas inteligentes') || t.includes('redes electricas inteligentes')
          );
          if (iberCom) return 'iberdrola';
          if (!iberDist) return 'iberdrola'; // "Iberdrola" sin señales de distribuidora: asumimos comercializadora
          // Si solo aparece por la distribuidora, NO clasificamos como iberdrola
        }

        if (t.includes('totalenergies')) return 'totalenergies';
        if (t.includes('octopus')) return 'octopus';

        // Visalia (fallback por nombre)
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
          case 'endesa':
            // Endesa: "del 31/07/2022 a 05/08/2022 (5 días)"
            return __LF_extraerNumero(texto, [
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,
              /periodo.*?\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, 200);
            
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
          case 'endesa':
            // Endesa: usar función específica
            const endesaPotencias = __LF_extractPotenciasEndesa(texto);
            if (endesaPotencias) {
              return endesaPotencias;
            }
            return null;
            
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

      // ============================================================================
      // EXTRACTOR QR - Prioridad máxima (100% confianza)
      // ============================================================================
      
      /**
       * Parsea la URL del QR code y extrae todos los datos
       * @param {string} qrUrl - URL del QR code
       * @returns {object|null} - Datos extraídos o null si falla
       */

      // ============================================================================
      // EXTRACTOR QR CON jsQR (JavaScript puro - navegador)
      // ============================================================================
      
      /**
       * Carga la librería jsQR
       */
      async function __LF_loadJsQR() {
        if (window.jsQR) return window.jsQR;
        
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
          script.crossOrigin = 'anonymous'; // Necesario para SRI
          script.onload = () => resolve(window.jsQR);
          script.onerror = () => reject(new Error('jsQR no disponible'));
          document.head.appendChild(script);
        });
      }
      
      /**
       * Extrae QR code de PDF usando jsQR
       */
      async function __LF_extractQRFromPDF(pdfFile) {
        try {
          lfDbg('[QR jsQR] Escaneando PDF...');
          
          const jsQR = await __LF_loadJsQR();
          const pdfjsLib = await __LF_ensurePdfJs();
          
          const arrayBuffer = await pdfFile.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          
          // Intentar con múltiples escalas para mejor detección
          const scales = [3.0, 2.5, 2.0, 1.5];
          
          for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 3); pageNum++) {
            lfDbg(`[QR jsQR] Página ${pageNum}/${Math.min(pdf.numPages, 3)}...`);
            const page = await pdf.getPage(pageNum);
            
            for (const scale of scales) {
              const viewport = page.getViewport({ scale });
              
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              
              await page.render({ canvasContext: context, viewport }).promise;
              const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
              
              // Intentar con y sin inversión
              const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "attemptBoth"
              });
              
              if (code && code.data) {
                lfDbg(`[QR jsQR] Código detectado (escala ${scale}):`, code.data.substring(0, 50));
                if (code.data.includes('comparador.cnmc.gob.es')) {
                  lfDbg(`[QR jsQR] ✅ QR encontrado en página ${pageNum} (escala ${scale})`);
                  return code.data;
                }
              }
            }
          }
          
          lfDbg('[QR jsQR] ⚠️ No se detectó QR en ninguna página');
          return null;
        } catch (error) {
          lfDbg('[QR jsQR] ❌ Error:', error.message);
          return null;
        }
      }
      
      /**
       * Extrae URL QR del texto del PDF
       */
      function __LF_extractQRUrl(texto) {
        if (!texto) return null;
        const urlPattern = /https:\/\/comparador\.cnmc\.gob\.es\/comparador\/QRE\?[^\s"'\n]+/;
        const match = texto.match(urlPattern);
        if (match) {
          lfDbg('[QR TEXTO] ✓ URL encontrada en texto');
          return match[0];
        }
        return null;
      }

      function __LF_parseQRData(qrUrl) {
        if (!qrUrl || !qrUrl.includes('comparador.cnmc.gob.es')) {
          return null;
        }
        
        try {
          const url = new URL(qrUrl);
          const params = url.searchParams;
          
          // Extraer datos clave
          const p1 = params.get('pP1');
          const p2 = params.get('pP2');
          const cfP1 = params.get('cfP1');
          const cfP2 = params.get('cfP2');
          const cfP3 = params.get('cfP3');
          const fechaInicio = params.get('iniF');
          const fechaFin = params.get('finF');
          
          // Validar que tenemos los datos mínimos necesarios
          if (!p1 || !p2 || !cfP1 || !cfP2 || !cfP3) {
            lfDbg('[QR] ⚠️  QR incompleto - faltan campos obligatorios');
            return null;
          }
          
          // Calcular días
          let dias = null;
          if (fechaInicio && fechaFin) {
            try {
              const inicio = new Date(fechaInicio);
              const fin = new Date(fechaFin);
              dias = Math.floor((fin - inicio) / (1000 * 60 * 60 * 24));
            } catch (e) {
              lfDbg('[QR] ⚠️  Error calculando días:', e);
            }
          }
          
          const datos = {
            p1: parseFloat(p1),
            p2: parseFloat(p2),
            consumoPunta: parseFloat(cfP1),
            consumoLlano: parseFloat(cfP2),
            consumoValle: parseFloat(cfP3),
            dias: dias,
            confianza: 100,
            fuenteDatos: 'QR',
            cups: params.get('cups') || null,
            fechaInicio: fechaInicio,
            fechaFin: fechaFin,
            importeTotal: params.get('imp') ? parseFloat(params.get('imp')) : null
          };
          
          lfDbg('[QR] ✅ Datos extraídos del QR:', datos);
          return datos;
          
        } catch (error) {
          lfDbg('[QR] ❌ Error parseando QR:', error);
          return null;
        }
      }

      function __LF_parsearDatos(textoLineas, textoCompacto){
        lfDbg('[PARSER v1765179628-VERCEL-CLEAN] 🚀 Iniciando parseo...');
        const textLines = String(textoLineas || '');
        const textCompact = String(textoCompacto || '');
        
        const tAll = (textLines + '\n' + textCompact)
          .replace(/[\u00A0\t]/g,' ')
          .replace(/\s+/g,' ')
          .trim();

        // --- Fechas y días ---
        const dateSep = '[\\/\\.\\-]';
        const D = `(?:\\d{1,2})${dateSep}(?:\\d{1,2})${dateSep}(?:\\d{2,4})`;
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
        lfDbg('[DEBUG] Compañía detectada:', compania);
        
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
        
        lfDbg('[DEBUG DÍAS] Compañía:', compania, '| Resultado:', dias);

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
          lfDbg('[DEBUG POTENCIAS] Usando patrones específicos de', compania);
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
        
        lfDbg('[DEBUG POTENCIAS] P1:', p1, '| P2:', p2);

        // --- Consumos (kWh) ---
        const triple = __LF_extractTripleConsumo(textLines) || __LF_extractTripleConsumo(textCompact);

        let cPunta = null, cLlano = null, cValle = null;

        if (triple){
          lfDbg('[DEBUG CONSUMOS] Triple detectado:', triple);
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
          
          lfDbg('[DEBUG CONSUMOS] Fallback individual - P:', cPunta, 'L:', cLlano, 'V:', cValle);
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
        let confianza = Math.round((detectados / 6) * 100);
        
        // NUEVO: Ajustar confianza si usamos fallbacks genéricos (menos confiable)
        if (compania === 'endesa' && triple === null && (cPunta || cLlano || cValle)) {
          // Si Endesa pero consumos vienen del fallback genérico, reducir confianza
          confianza = Math.min(confianza, 70);
          lfDbg('[CONFIANZA] Ajustada a máx 70% (consumos desde fallback genérico)');
        }
        
        // Detectar si hay "potencias máximas demandadas" cerca de las potencias extraídas
        if (p1 != null && p2 != null) {
          const textoLower = tAll.toLowerCase();
          const idxPot = textoLower.indexOf('potencia');
          if (idxPot >= 0) {
            const fragmento = tAll.substring(Math.max(0, idxPot - 100), idxPot + 500);
            if (/m[áa]xim[ao]s?\s+demandad[ao]s?/i.test(fragmento)) {
              // Hay riesgo de confusión con máximas demandadas
              if (!potenciasCompania) {
                confianza = Math.min(confianza, 75);
                lfDbg('[CONFIANZA] Ajustada a máx 75% (detectadas "máximas demandadas" cerca)');
              }
            }
          }
        }

        // LOG CONSOLIDADO FINAL
        lfDbg('═══════════════════════════════════════════════════════');
        lfDbg('📊 RESULTADO FINAL DEL PARSEO');
        lfDbg('═══════════════════════════════════════════════════════');
        lfDbg('🏢 Compañía detectada:', compania);
        lfDbg('📅 Días de facturación:', dias);
        lfDbg('⚡ Potencia P1 (kW):', p1);
        lfDbg('⚡ Potencia P2 (kW):', p2);
        lfDbg('💡 Consumo Punta (kWh):', cPunta);
        lfDbg('💡 Consumo Llano (kWh):', cLlano);
        lfDbg('💡 Consumo Valle (kWh):', cValle);
        lfDbg('✅ Confianza:', confianza + '%', '(' + detectados + '/6 campos)');
        lfDbg('📆 Periodo:', fIni || 'N/A', '→', fFin || 'N/A');
        lfDbg('═══════════════════════════════════════════════════════');

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

      // ✅ VERSIÓN SEGURA - Crea elementos DOM en lugar de HTML string (previene XSS)
      function __LF_crearInputValidacion(id, label, valor) {
        const ok = (valor != null);
        const valorFormateado = ok ? String(valor).replace('.', ',') : '';
        
        const wrap = document.createElement('div');
        wrap.className = 'input-validacion ' + (ok ? 'detectado' : 'no-detectado');
        wrap.dataset.field = id;
        
        const labelEl = document.createElement('label');
        labelEl.htmlFor = 'val_' + id;
        labelEl.style.cssText = 'font-size:12px; font-weight:900; color:var(--muted); margin-bottom:6px; display:block';
        labelEl.textContent = label;
        wrap.appendChild(labelEl);
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'val_' + id;
        input.className = 'input';
        input.value = valorFormateado;
        if (!ok) input.placeholder = '❌ No detectado - introduce manualmente';
        wrap.appendChild(input);
        
        const indicator = document.createElement('span');
        indicator.className = ok ? 'check' : 'warning';
        indicator.textContent = ok ? '✓' : '⚠️';
        wrap.appendChild(indicator);
        
        return wrap;
      }

      function __LF_renderForm(datos) {
        const form = __LF_q('formValidacionFactura');
        if (!form) return;
        __LF_lastParsedConfianza = Number(datos?.confianza || 0);
        
        // ✅ Limpiar y añadir elementos DOM (no strings HTML)
        form.innerHTML = '';
        form.appendChild(__LF_crearInputValidacion('p1', 'Potencia P1 (kW)', datos.p1));
        form.appendChild(__LF_crearInputValidacion('p2', 'Potencia P2 (kW)', datos.p2));
        form.appendChild(__LF_crearInputValidacion('dias', 'Días de facturación', datos.dias));
        form.appendChild(__LF_crearInputValidacion('consumoPunta', 'Consumo Punta / P1 / E1 (kWh)', datos.consumoPunta));
        form.appendChild(__LF_crearInputValidacion('consumoLlano', 'Consumo Llano / P2 / E2 (kWh)', datos.consumoLlano));
        form.appendChild(__LF_crearInputValidacion('consumoValle', 'Consumo Valle / P3 / E3 (kWh)', datos.consumoValle));
        
        // Mostrar compañía detectada si no es genérico
        const companiaEl = __LF_q('companiaDetectada');
        const nombreEl = __LF_q('nombreCompania');
        if (companiaEl && nombreEl && datos.compania && datos.compania !== 'generico') {
          const nombres = {
            'endesa': 'Endesa Energía',
            'iberdrola': 'Iberdrola',
            'ganaenergia': 'Gana Energía',
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
        window.__LF_lastFile = file;

        // PRIMERO: Ocultar área de subida y sección de resultados
        __LF_hide(__LF_q('uploadAreaFactura'));
        __LF_hide(__LF_q('resultadoFactura'));
        __LF_hide(__LF_q('btnOcrFactura'));
        const aviso = __LF_q('avisoFactura'); 
        if(aviso){ aviso.innerHTML=''; __LF_hide(aviso); }
        
        // SEGUNDO: Limpiar contenido del formulario anterior (ya no es visible)
        const form = __LF_q('formValidacionFactura');
        if (form) form.innerHTML = '';
        const companiaEl = __LF_q('companiaDetectada');
        if (companiaEl) __LF_hide(companiaEl);
        const badge = __LF_q('confianzaBadge');
        if (badge) badge.textContent = '';
        
        // TERCERO: Mostrar SOLO el loader
        __LF_show(__LF_q('loaderFactura'));

        try{
          const { textLines, textCompact, textRawLen } = await __LF_extraerTextoPDF(file);

          // NO mostrar resultados todavía, el QR puede tardar 2-3 segundos más

          if (!textRawLen || textRawLen < 40){
            __LF_hide(__LF_q('loaderFactura'));
            __LF_show(__LF_q('resultadoFactura'));
            __LF_warn('⚠️ No se ha detectado texto seleccionable. Parece un PDF escaneado. Puedes probar <b>OCR (experimental)</b> o introducir los datos manualmente.');
            __LF_show(__LF_q('btnOcrFactura'));
            __LF_setBadge(0);
            __LF_renderForm({ p1:null,p2:null,dias:null,consumoPunta:null,consumoLlano:null,consumoValle:null,confianza:0 });
            return;
          }

          // ====================================================================
          // PASO 1: Intentar QR desde TEXTO
          // ====================================================================
          const tAll = (textLines + '\n' + textCompact).replace(/[\u00A0\t]/g,' ').replace(/\s+/g,' ').trim();
          const qrUrlTexto = __LF_extractQRUrl(tAll);
          
          let datosQR = null;
          if (qrUrlTexto) {
            datosQR = __LF_parseQRData(qrUrlTexto);
          }
          
          // ====================================================================
          // PASO 2: Intentar QR con jsQR (escaneo de imagen)
          // ====================================================================
          if (!datosQR) {
            lfDbg('[QR] Texto no tiene URL, intentando jsQR...');
            try {
              const qrUrlImagen = await __LF_extractQRFromPDF(file);
              if (qrUrlImagen) {
                datosQR = __LF_parseQRData(qrUrlImagen);
              }
            } catch (jsqrError) {
              lfDbg('[QR jsQR] No disponible:', jsqrError.message);
            }
          }

          // ====================================================================
          // PASO 3: Si tenemos QR, combinar inteligentemente con PDF
          // ====================================================================
          if (datosQR) {
            lfDbg('[QR] ✅ QR encontrado - validando con datos del PDF');
            
            // Parsear PDF completo para tener datos de fallback
            const datosPDF = __LF_parsearDatos(textLines, textCompact);
            
            // COMBINAR: usar QR como base, completar/corregir con PDF
            const datosCombinados = {
              // Potencias: del QR, si no están → del PDF
              p1: datosQR.p1 != null ? datosQR.p1 : datosPDF.p1,
              p2: datosQR.p2 != null ? datosQR.p2 : datosPDF.p2,
              
              // Consumos: del QR, si no están → del PDF
              consumoPunta: datosQR.consumoPunta != null ? datosQR.consumoPunta : datosPDF.consumoPunta,
              consumoLlano: datosQR.consumoLlano != null ? datosQR.consumoLlano : datosPDF.consumoLlano,
              consumoValle: datosQR.consumoValle != null ? datosQR.consumoValle : datosPDF.consumoValle,
              
              // DÍAS: lógica especial
              dias: (() => {
                const diasQR = datosQR.dias;
                const diasPDF = datosPDF.dias;
                
                // Si NO hay días en PDF → usar QR
                if (!diasPDF) {
                  lfDbg('[DÍAS] PDF no tiene días, usando QR:', diasQR);
                  return diasQR;
                }
                
                // Si QR y PDF coinciden → usar QR (fuente oficial)
                if (diasQR === diasPDF) {
                  lfDbg('[DÍAS] QR y PDF coinciden (' + diasQR + '), usando QR');
                  return diasQR;
                }
                
                // Si son diferentes → usar PDF (lo que cobran)
                lfDbg('[DÍAS] QR (' + diasQR + ') ≠ PDF (' + diasPDF + '), usando PDF (lo que cobran)');
                return diasPDF;
              })(),
              
              confianza: 100,
              fuenteDatos: 'QR+PDF',
              compania: datosPDF.compania
            };
            
            lfDbg('[QR] ✅ Datos combinados:', datosCombinados);
            
            // AHORA SÍ: mostrar resultados con los datos completos
            __LF_hide(__LF_q('loaderFactura'));
            __LF_show(__LF_q('resultadoFactura'));
            
            __LF_setBadge(100);
            __LF_renderForm(datosCombinados);
            return;
          }

          // ====================================================================
          // PASO 4: FALLBACK - Parseo PDF completo (sin QR)
          // ====================================================================
          lfDbg('[QR] QR no encontrado - usando parseo PDF');
          const datos = __LF_parsearDatos(textLines, textCompact);
          
          // AHORA SÍ: mostrar resultados con los datos completos
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));
          
          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Mostrar advertencias contextuales
          __LF_showContextualWarnings(datos);

        }catch(err){
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('uploadAreaFactura'));
          if (typeof toast === 'function') toast('Error al procesar factura PDF', 'err');
          lfDbg('[ERROR] processPdf:', err);
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
            s.crossOrigin = 'anonymous'; // Necesario para SRI
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

        try{ await __LF_ensurePdfJs(); }catch(_){
          if (typeof toast === 'function') toast('PDF.js no disponible', 'err');
          return;
        }

        __LF_hide(__LF_q('uploadAreaFactura'));
        __LF_show(__LF_q('loaderFactura'));
        __LF_hide(__LF_q('resultadoFactura'));

        try{
          const T = await __LF_loadTesseract();

          const ab = await file.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;

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
          lfDbg('[ERROR]', err);
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

        // Si "Comparar con mi tarifa actual" está marcado, avisar que debe rellenar precios
        const compararMiTarifa = document.getElementById('compararMiTarifa');
        
        if (compararMiTarifa && compararMiTarifa.checked) {
          if (typeof toast === 'function') {
            toast('✅ Datos aplicados. Rellena los PRECIOS de tu tarifa manualmente', 'ok');
          }
        } else if (typeof toast === 'function') {
          // Si NO tiene "Mi tarifa" marcado, toast normal
          toast('✅ Datos aplicados correctamente', 'ok');
        }

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
        const btnCerrarX = __LF_q('btnCerrarFacturaX');

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
        btnCerrarX?.addEventListener('click', __LF_closeModal);

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


      // API mínima para carga diferida desde app.js
      window.__LF_openFacturaModal = __LF_openModal;
      window.__LF_facturaModuleReady = true;
    })();