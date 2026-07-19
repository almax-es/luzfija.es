/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

(function(){
  if (window.__LF_facturaParsersLoaded) return;
  window.__LF_facturaParsersLoaded = true;

  // Helper de debug: solo loguea si __LF_DEBUG está activo
  // y no estamos en flujo sensible de factura.
  const lfDbg = (...args) => {
    if (window.__LF_DEBUG && !window.__LF_PRIVACY_MODE && !window.__LF_FACTURA_BUSY) console.log(...args);
  };

      function __LF_normNum(raw){
        if (raw == null) return null;
        let s = String(raw)
          .replace(/\s+/g,'')
          .replace(/[€$]/g,'')
          .replace(/kwh|kw/gi,'')
          .replace(/[^0-9,.-]/g,'');
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
          // Solo coma: normalmente decimal (12,34). Si parece miles US (1,234,567) -> quitar comas.
          // Heurística: si empieza por 0, (p.ej. "0,123"), es decimal (muy común en precios/kWh)
          if (/^-?0,\d+$/.test(s)) {
            s = s.replace(',', '.');
          } else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
            s = s.replace(/,/g,'');
          } else {
            s = s.replace(',', '.');
          }
        } else {
          // Solo punto (o ninguno): puede ser decimal (0.123) o miles (1.234 / 12.345.678)
          if (/^-?0\.\d+$/.test(s)) {
            // dejar tal cual
          } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
            s = s.replace(/\./g,'');
          } else {
            const parts = s.split('.');
            if (parts.length > 2){
              const last = parts.pop();
              s = parts.join('') + '.' + last;
            }
          }
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
      }



      function __LF_daysInclusive(d1, d2){
        const parse = (s) => {
          if (!s) return null;
          const t = String(s).trim().replace(/[.-]/g,'/').replace(/\s+/g,' ');
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

      // NUEVO: Extracción específica para potencias contratadas de Endesa / Energía XXI


      function __LF_extractPotenciasEndesa(texto) {
        const lineas = texto.split(/\r?\n/).map(l => l.trim());
        
        // Buscar "Potencias contratadas: punta-llano X kW; valle Y kW"
        // O versión Energía XXI: "Potencia contratada en punta-llano: 8,000 kW Potencia contratada en valle: 8,000 kW"
        for (let i = 0; i < lineas.length; i++) {
          const linea = lineas[i];
          const lineaLow = linea.toLowerCase();
          
          if (lineaLow.includes('potencia') && lineaLow.includes('contratada')) {
            // Patrón 1: "punta-llano 2,300 kW; valle 3,450 kW" (Endesa Clásica)
            // Patrón 2: "en punta-llano: 8,000 kW ... en valle: 8,000 kW" (Energía XXI)
            
            // Intentar buscar P1 (Punta-Llano)
            // Regex flexible: busca "punta...llano" seguido de números
            const matchPunta = linea.match(/(?:punta[\s-]*llano|p1)[^0-9]{0,30}([\d,.]+)\s*kw/i);
            
            // Intentar buscar P2 (Valle) en la misma línea
            const matchValle = linea.match(/(?:valle|p3)[^0-9]{0,30}([\d,.]+)\s*kw/i);
            
            if (matchPunta && matchValle) {
              const p1 = parseFloat(matchPunta[1].replace(',', '.'));
              const p2 = parseFloat(matchValle[1].replace(',', '.'));
              
              if (!isNaN(p1) && !isNaN(p2)) {
                lfDbg('[ENDESA-POTENCIAS] Detectadas en misma línea:', { p1, p2 });
                return { p1, p2 };
              }
            }
          }
          
          // También buscar en el detalle de factura: "Pot. Punta-Llano 2,300 kW"
          if (lineaLow.includes('pot.') && lineaLow.includes('punta')) {
            const matchPuntaLlano = linea.match(/pot\.\s*punta[\s-]*llano\s+([\d,.]+)\s*kw/i);
            if (matchPuntaLlano) {
              const p1 = parseFloat(matchPuntaLlano[1].replace(',', '.'));
              
              // Buscar "Pot. Valle" en las siguientes líneas
              for (let j = i + 1; j < Math.min(i + 3, lineas.length); j++) {
                const lineaSiguiente = lineas[j];
                const matchValle = lineaSiguiente.match(/pot\.\s*valle\s+([\d,.]+)\s*kw/i);
                
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
                const nums = str.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+[,.]\d+|\d+/g);
                if (!nums || nums.length === 0) return null;
                
                // Buscar de atrás hacia adelante el primer número que sea consumo razonable (0-5000)
                for (let k = nums.length - 1; k >= 0; k--) {
                  const num = __LF_normNum(nums[k]);
                  // Filtrar: debe ser razonable para consumo mensual (0-5000 kWh)
                  if (num != null && num >= 0 && num <= 5000) {
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
          /(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:punta|p1)[:\s]+([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:punta|p1)[:\s]+([0-9][0-9.,]*)\b[^\d]{0,10}kwh/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p1[^\d]{0,20}([0-9][0-9.,]*)/i,
          // NUEVOS BRUTALES
          /\bp1\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,  // "P1 ... 100 kWh"
          /punta[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,  // "Punta ... 100 kWh"
          /activa[^\n]{0,80}p1[^\d]{0,40}([0-9][0-9.,]*)/i,  // "activa ... P1 ... 100"
          /\bp1[^\n]{0,100}kwh[^\d]{0,30}([0-9][0-9.,]+)/i  // "P1 ... kWh ... 100"
        ], 0, 1000000);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Llano/P2
        const l = __LF_extraerNumero(t, [
          /(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:llano|p2)[:\s]+([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:llano|p2)[:\s]+([0-9][0-9.,]*)\b[^\d]{0,10}kwh/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p2[^\d]{0,20}([0-9][0-9.,]*)/i,
          // NUEVOS BRUTALES
          /\bp2\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /llano[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /activa[^\n]{0,80}p2[^\d]{0,40}([0-9][0-9.,]*)/i,
          /\bp2[^\n]{0,100}kwh[^\d]{0,30}([0-9][0-9.,]+)/i
        ], 0, 1000000);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Valle/P3
        const v = __LF_extraerNumero(t, [
          /(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:valle|p3)[:\s]+([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:valle|p3)[:\s]+([0-9][0-9.,]*)\b[^\d]{0,10}kwh/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p3[^\d]{0,20}([0-9][0-9.,]*)/i,
          // NUEVOS BRUTALES
          /\bp3\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /valle[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /activa[^\n]{0,80}p3[^\d]{0,40}([0-9][0-9.,]*)/i,
          /\bp3[^\n]{0,100}kwh[^\d]{0,30}([0-9][0-9.,]+)/i
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

          const n = (line.match(/[0-9][0-9.,]*/g) || [])
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

      // Octopus multi-periodo: sumar consumos de varios periodos en la misma factura
      // Ej: Periodo 1 "Punta 18,15 kWh" + Periodo 2 "Punta 16,85 kWh" = 35 kWh total


      function __LF_extractConsumoOctopus(texto) {
        if (!texto) return null;
        const t = String(texto);

        // Método 1: tabla de lecturas "Consumo kWh  35  28  56  0  0  0  119"
        // Esta tabla tiene los totales reales del contador (siempre presente en Octopus)
        const mTabla = t.match(/consumo\s+kwh\s+(\d+)\s+(\d+)\s+(\d+)/i);
        if (mTabla) {
          const p1 = parseInt(mTabla[1], 10);
          const p2 = parseInt(mTabla[2], 10);
          const p3 = parseInt(mTabla[3], 10);
          if (p1 + p2 + p3 > 0) {
            lfDbg('[OCTOPUS-CONSUMO] Tabla contador:', { p1, p2, p3 });
            return { punta: p1, llano: p2, valle: p3 };
          }
        }

        // Método 2: sumar valores de cada "Punta X kWh" principal en secciones Energía Activa
        // (para facturas multi-periodo donde los valores están desglosados)
        const sumAll = (re) => {
          const r = new RegExp(re.source, 'gi');
          const seen = new Set();
          let m, total = 0;
          while ((m = r.exec(t)) !== null) {
            const v = __LF_normNum(m[1]);
            if (v != null && v > 0 && !seen.has(v)) {
              seen.add(v);
              total += v;
            }
          }
          return total > 0 ? Math.round(total * 100) / 100 : null;
        };

        const punta = sumAll(/(?:^|\n)\s*punta\s+([0-9][0-9.,]*)\s*kwh/i);
        const llano = sumAll(/(?:^|\n)\s*llano\s+([0-9][0-9.,]*)\s*kwh/i);
        const valle = sumAll(/(?:^|\n)\s*valle\s+([0-9][0-9.,]*)\s*kwh/i);

        if (punta != null && llano != null && valle != null) {
          lfDbg('[OCTOPUS-CONSUMO] Sumado multi-periodo:', { punta, llano, valle });
          return { punta, llano, valle };
        }

        return null;
      }

      // Visalia: extrae consumos de las líneas "Término de energía P1/P2/P3 X,XX kWh"
      // de la página de detalle, ignorando la tabla "Lectura de la distribuidora" (página 3)
      // que contiene lecturas brutas del contador (ej: P1=15364,00) que NO son el consumo facturado.


      function __LF_extractConsumoVisalia(texto) {
        if (!texto) return null;
        const t = String(texto);

        const mP1 = t.match(/t[eé]rmino\s+de\s+energ[ií]a\s+p1\s+([0-9][0-9.,]*)\s*kwh/i);
        const mP2 = t.match(/t[eé]rmino\s+de\s+energ[ií]a\s+p2\s+([0-9][0-9.,]*)\s*kwh/i);
        const mP3 = t.match(/t[eé]rmino\s+de\s+energ[ií]a\s+p3\s+([0-9][0-9.,]*)\s*kwh/i);

        // Si no hay ninguna línea de término de energía, no podemos ayudar
        if (!mP1 && !mP2 && !mP3) return null;

        const punta = mP1 ? (__LF_normNum(mP1[1]) ?? 0) : 0;
        const llano = mP2 ? (__LF_normNum(mP2[1]) ?? 0) : 0;
        const valle = mP3 ? (__LF_normNum(mP3[1]) ?? 0) : 0;

        lfDbg('[VISALIA-CONSUMO] Extraído de "Término de energía":', { punta, llano, valle });
        return { punta, llano, valle };
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

        // ✅ DISA Energía Eléctrica
        if (
          t.includes('disa energía') || t.includes('disa energia') ||
          t.includes('disa energía eléctrica') || t.includes('disa energia electrica') ||
          t.includes('disagrupo.es') || t.includes('oficinavirtual.disagrupo.es') ||
          t.includes('descuento disa')
        ) return 'disa';

        // ✅ Energía XXI (Mercado Regulado Endesa) - ANTES de Endesa Libre
        if (t.includes('energía xxi') || t.includes('energia xxi') || t.includes('energiaxxi')) return 'energiaxxi';
        if (t.includes('plenitude') || t.includes('eniplenitude')) return 'plenitude';

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

        // ✅ Atulado Energía (Hidroeléctrica El Carmen Energía, S.L.)
        if (
          t.includes('atulado') ||
          t.includes('atuladoenergia.com') ||
          t.includes('hidroeléctrica el carmen') || t.includes('hidroelectrica el carmen') ||
          t.includes('b82773888')
        ) return 'atulado';

        // Enérgya VM: múltiples variantes
        // Nota: usar 'energya' (no 'energ') para evitar falso positivo con "Energía" + "Telegestión"
        if (t.includes('enérgya vm') || t.includes('energya vm') || t.includes('energya-vm') ||
            t.includes('enérgya') || t.includes('energyavm') ||
            (t.includes('energya') && t.includes('gestión'))) return 'energyavm';

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
          case 'energiaxxi': // Mismo formato que Endesa a menudo
          case 'endesa': {
            // Endesa: usar función específica
            const endesaPotencias = __LF_extractPotenciasEndesa(texto);
            if (endesaPotencias) {
              return endesaPotencias;
            }
            return null;
          }

          case 'disa': {
            // DISA: en el término de potencia suele venir P1 y P3 (sin P2 explícita).
            // En 2.0TD tratamos P3 como el segundo periodo de potencia (P2 en el formulario).
            const parseDecimal = (raw) => {
              if (!raw) return null;
              const v = parseFloat(String(raw).replace(',', '.'));
              return (v > 0 && v <= 40) ? v : null;
            };

            const mP1 = texto.match(/\bp1\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)\b(?!\s*h)/i);
            const mP2 = texto.match(/\bp2\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)\b(?!\s*h)/i);
            const mP3 = texto.match(/\bp3\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)\b(?!\s*h)/i);

            const p1_di = parseDecimal(mP1 && mP1[1]);
            let p2_di = parseDecimal(mP2 && mP2[1]);
            const p3_di = parseDecimal(mP3 && mP3[1]);

            if (p2_di == null && p3_di != null) p2_di = p3_di;

            if (p1_di != null || p2_di != null) {
              lfDbg('[DISA-POTENCIAS] P1:', p1_di, '| P2:', p2_di, '| P3(raw):', p3_di);
              return { p1: p1_di, p2: p2_di };
            }
            return null;
          }
            
          case 'totalenergies': {
            // TotalEnergies: "P1: 4,50 P2: 4,50 kW" (kW después de P2)
            const p1_te = __LF_extraerNumero(texto, [
              /potencia\s*(?:contratada)?[:\s]+p1[:\s]+([0-9][0-9.,]*)/i,
              /\bp1[:\s]+([0-9][0-9.,]*)\s*(?:p2|kw)/i
            ], 0.1, 40);
            const p2_te = __LF_extraerNumero(texto, [
              /potencia\s*(?:contratada)?[:\s]+p2[:\s]+([0-9][0-9.,]*)/i,
              /\bp2[:\s]+([0-9][0-9.,]*)\s*kw\b/i
            ], 0.1, 40);
            return { p1: p1_te, p2: p2_te };
          }
            
          case 'imagina': {
            // Imagina Energía: "P1 5,750 kW * ... * 30 Días" (bloque Potencia contratada)
            const low_im = texto.toLowerCase();
            let sub_im = texto;
            const idx_im = low_im.indexOf('potencia contratada');
            if (idx_im >= 0) sub_im = texto.slice(idx_im, idx_im + 800);

            const p1_im = __LF_extraerNumero(sub_im, [
              /\bp1\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)(?!\s*h)\b/i
            ], 0.1, 40);
            const p2_im = __LF_extraerNumero(sub_im, [
              /\bp2\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)(?!\s*h)\b/i
            ], 0.1, 40);
            return { p1: p1_im, p2: p2_im };
          }

          case 'octopus': {
            // Octopus Energy: "Punta 3,300 kW * 29 días" / "Valle 3,300 kW * 29 días"
            // Y tabla: "Potencia Contratada (kW) 3,300 3,300 0 0 0 0"
            // NOTA: "3,300" usa coma decimal (=3.3 kW) pero normNum lo interpreta
            // como miles US (=3300), así que parseamos manualmente.
            let p1_oc = null, p2_oc = null;

            // Patrón 1: tabla "Potencia Contratada (kW) X,XXX Y,YYY"
            const mPotC = texto.match(/potencia\s+contratada\s*\(kw\)\s+([0-9][0-9.,]*)\s+([0-9][0-9.,]*)/i);
            if (mPotC) {
              p1_oc = parseFloat(mPotC[1].replace(',', '.'));
              p2_oc = parseFloat(mPotC[2].replace(',', '.'));
            }

            // Patrón 2: "Punta X,XXX kW *" (el * distingue potencia de consumo kWh)
            if (p1_oc == null) {
              const mP = texto.match(/punta\s+([0-9][0-9.,]*)\s*kw\s*\*/i);
              if (mP) p1_oc = parseFloat(mP[1].replace(',', '.'));
            }
            if (p2_oc == null) {
              const mV = texto.match(/valle\s+([0-9][0-9.,]*)\s*kw\s*\*/i);
              if (mV) p2_oc = parseFloat(mV[1].replace(',', '.'));
            }

            // Patrón 3: "Potencia Facturada (kW) X,XXX Y,YYY"
            if (p1_oc == null) {
              const mPotF = texto.match(/potencia\s+facturada\s*\(kw\)\s+([0-9][0-9.,]*)\s+([0-9][0-9.,]*)/i);
              if (mPotF) {
                p1_oc = parseFloat(mPotF[1].replace(',', '.'));
                p2_oc = parseFloat(mPotF[2].replace(',', '.'));
              }
            }

            if (p1_oc != null && p1_oc > 0 && p1_oc <= 40) {
              lfDbg('[OCTOPUS-POTENCIAS] P1:', p1_oc, '| P2:', p2_oc);
              return { p1: p1_oc, p2: p2_oc };
            }
            return null;  // fallback a genérico
          }

          case 'plenitude': {
            // Plenitude: "Potencia contratada P1: 3,450 kW P2: 3,450 kW"
            // y detalle: "Periodo P1 (...): 3,4500 kW * 0,073782 €/kW día * 32 días"
            // NOTA: "3,450" usa coma decimal (=3.45 kW) pero normNum lo interpreta
            // como miles US (=3450), así que parseamos con replace(',','.').
            let p1_pl = null, p2_pl = null;

            // Patrón 1: "Potencia contratada P1: X kW P2: Y kW"
            const mPl1 = texto.match(/potencia\s+contratada\s+p1[:\s]+([0-9][0-9.,]*)\s*kw\b/i);
            const mPl2 = texto.match(/potencia\s+contratada\s+[^\n]*p2[:\s]+([0-9][0-9.,]*)\s*kw\b/i);
            if (mPl1) p1_pl = parseFloat(mPl1[1].replace(',', '.'));
            if (mPl2) p2_pl = parseFloat(mPl2[1].replace(',', '.'));

            // Patrón 2: "Periodo P1 (...): X kW *" (detalle factura)
            if (p1_pl == null) {
              const mD1 = texto.match(/periodo\s+p1\b[^:]*:\s*([0-9][0-9.,]*)\s*kw\s*\*/i);
              if (mD1) p1_pl = parseFloat(mD1[1].replace(',', '.'));
            }
            if (p2_pl == null) {
              const mD2 = texto.match(/periodo\s+p2\b[^:]*:\s*([0-9][0-9.,]*)\s*kw\s*\*/i);
              if (mD2) p2_pl = parseFloat(mD2[1].replace(',', '.'));
            }

            if (p1_pl != null && p1_pl > 0 && p1_pl <= 40) {
              lfDbg('[PLENITUDE-POTENCIAS] P1:', p1_pl, '| P2:', p2_pl);
              return { p1: p1_pl, p2: p2_pl };
            }
            return null;
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
            fuenteDatos: 'QR'
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
          /d[ií]as\s*(?:facturables|facturados|de\s*facturaci[oó]n|de\s*periodo|del\s*periodo|total)\s*[:-]?\s*(\d{1,3})\b/i,
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
          /d[ií]as\s*facturados\s*[:-]?\s*(\d{1,3})\b/i,
          
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
            /potencia\s*contratada[^\n]{0,80}\b(?:p1|punta)\b[^0-9]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /\b(?:p1|punta|periodo\s*1)[:\s]*([0-9][0-9.,]*)\s*kw\b/i,
            /potencia\s*(?:facturada)?[^\n]{0,80}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /\bpotencia\b[^\n]{0,120}([0-9][0-9.,]*)\s*kw\b[^\n]{0,60}\b(?:p1|punta|periodo\s*1)\b/i,
            /\b(?:p1|punta)[:\s]+([0-9][0-9.,]*)\b/i,  // P1: 3.45 (sin kW)
            /periodo\s*(?:1|punta)[^\d]{0,50}([0-9][0-9.,]*)\s*kw\b/i,
            // NUEVOS BRUTALES
            /pot[^\n]{0,50}\bp1\b[^\d]{0,40}([0-9][0-9.,]*)/i,  // "pot ... P1 ... 3.45"
            /\bp1[^\d]{0,30}([0-9][0-9.,]*)\s*kw\b/i,  // "P1 ... 3.45 kW" (kw\b evita kWh)
            /punta[^\d]{0,40}([0-9][0-9.,]*)\s*kw\b/i,  // "punta ... 3.45 kW" (kw\b evita kWh)
            /contratada[^\n]{0,80}p1[^\d]{0,40}([0-9][0-9.,]*)/i  // "contratada ... P1 ... 3.45"
          ], 0.1, 40, 'P1');

          p2 = __LF_extraerNumero(tAll, [
            /potencia\s*contratada[^\n]{0,80}\b(?:p2|valle)\b[^0-9]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /\b(?:p2|valle|periodo\s*2)[:\s]*([0-9][0-9.,]*)\s*kw\b/i,
            /potencia\s*(?:facturada)?[^\n]{0,80}\b(?:p2|valle|periodo\s*2)\b[^0-9]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /\bpotencia\b[^\n]{0,120}([0-9][0-9.,]*)\s*kw\b[^\n]{0,60}\b(?:p2|valle|periodo\s*2)\b/i,
            /\b(?:p2|valle)[:\s]+([0-9][0-9.,]*)\b/i,
            /periodo\s*(?:2|valle|llano)[^\d]{0,50}([0-9][0-9.,]*)\s*kw\b/i,
            // NUEVOS BRUTALES
            /pot[^\n]{0,50}\bp2\b[^\d]{0,40}([0-9][0-9.,]*)/i,
            /\bp2[^\d]{0,30}([0-9][0-9.,]*)\s*kw\b/i,  // kw\b evita kWh
            /(?:valle|llano)[^\d]{0,40}([0-9][0-9.,]*)\s*kw\b/i,  // kw\b evita kWh
            /contratada[^\n]{0,80}p2[^\d]{0,40}([0-9][0-9.,]*)/i
          ], 0.1, 40, 'P2');
        }
        
        // Safety net: si potencias son null, reintentar con comma-como-decimal
        // Esto cubre compañías que escriben "3,300 kW" o "3,450 kW" donde
        // normNum malinterpreta "X,XX0" como miles US en vez de decimal español.
        if (p1 == null || p2 == null) {
          const kwPatterns = [
            /potencia\s*contratada\s*p1[:\s]+([0-9][0-9.,]*)\s*kw\b/i,
            /\b(?:p1|punta)\s+([0-9][0-9.,]*)\s*kw\s*[*x]/i,
            /potencia\s+contratada\s*\(kw\)\s+([0-9][0-9.,]*)/i,
            /\bperiodo\s+p1\b[^:]*:\s*([0-9][0-9.,]*)\s*kw\b/i,
            /\bp1\b[^\d]{0,20}([0-9][0-9.,]*)\s*kw\b(?!\s*h)/i
          ];
          const kwPatterns2 = [
            /potencia\s*contratada\s*[^\n]*p2[:\s]+([0-9][0-9.,]*)\s*kw\b/i,
            /\b(?:p2|valle)\s+([0-9][0-9.,]*)\s*kw\s*[*x]/i,
            /potencia\s+contratada\s*\(kw\)\s+[0-9][0-9.,]*\s+([0-9][0-9.,]*)/i,
            /\bperiodo\s+p2\b[^:]*:\s*([0-9][0-9.,]*)\s*kw\b/i,
            /\bp2\b[^\d]{0,20}([0-9][0-9.,]*)\s*kw\b(?!\s*h)/i
          ];
          const tryDecimal = (patterns) => {
            for (const re of patterns) {
              const m = tAll.match(re);
              if (m) {
                const v = parseFloat(m[1].replace(',', '.'));
                if (v > 0 && v <= 40) return v;
              }
            }
            return null;
          };
          if (p1 == null) {
            p1 = tryDecimal(kwPatterns);
            if (p1 != null) lfDbg('[POTENCIAS SAFETY-NET] P1 recuperado con comma-decimal:', p1);
          }
          if (p2 == null) {
            p2 = tryDecimal(kwPatterns2);
            if (p2 != null) lfDbg('[POTENCIAS SAFETY-NET] P2 recuperado con comma-decimal:', p2);
          }
        }

        lfDbg('[DEBUG POTENCIAS] P1:', p1, '| P2:', p2);

        // --- Consumos (kWh) ---
        let octopusTriple = null;
        if (compania === 'octopus') {
          octopusTriple = __LF_extractConsumoOctopus(tAll);
        }
        let visaliaTriple = null;
        if (compania === 'visalia') {
          // Visalia pone lecturas brutas del contador en pág. 3 que confunden al parser genérico.
          // Usamos el extractor específico que lee "Término de energía P1/P2/P3 X kWh" de pág. 2.
          visaliaTriple = __LF_extractConsumoVisalia(textLines) || __LF_extractConsumoVisalia(tAll);
        }
        const triple = octopusTriple || visaliaTriple || __LF_extractTripleConsumo(textLines) || __LF_extractTripleConsumo(textCompact);

        let cPunta, cLlano, cValle;

        if (triple){
          lfDbg('[DEBUG CONSUMOS] Triple detectado:', triple);
          cPunta = triple.punta;
          cLlano = triple.llano;
          cValle = triple.valle;
        } else {
          // Fallback individual con patrones ULTRA-ROBUSTOS
          cPunta = __LF_extraerNumero(tAll, [
            /\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /\b(?:punta|p1)[:\s]+([0-9][0-9.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p1[^\d]{0,20}([0-9][0-9.,]*)/i,
            /(?:punta|p1)[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp1\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /punta[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p1[^\d]{0,40}([0-9][0-9.,]*)/i
          ], 0, 2000000, 'CONSUMO-P1');

          cLlano = __LF_extraerNumero(tAll, [
            /\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /\b(?:llano|p2)[:\s]+([0-9][0-9.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p2[^\d]{0,20}([0-9][0-9.,]*)/i,
            /(?:llano|p2)[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp2\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /llano[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p2[^\d]{0,40}([0-9][0-9.,]*)/i
          ], 0, 2000000, 'CONSUMO-P2');

          cValle = __LF_extraerNumero(tAll, [
            /\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /\b(?:valle|p3)[:\s]+([0-9][0-9.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p3[^\d]{0,20}([0-9][0-9.,]*)/i,
            /(?:valle|p3)[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp3\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /valle[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p3[^\d]{0,40}([0-9][0-9.,]*)/i
          ], 0, 2000000, 'CONSUMO-P3');
          
          lfDbg('[DEBUG CONSUMOS] Fallback individual - P:', cPunta, 'L:', cLlano, 'V:', cValle);
        }

        // Total por si no hay desglose
        const cTotal = __LF_extraerNumero(tAll, [
          /\bconsumo\s*total\b[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\benerg[ií]a\s*total\b[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\bconsumo\b[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i
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


  window.__LF_FacturaParsers = {
    __LF_normNum,
    __LF_daysInclusive,
    __LF_extraerNumero,
    __LF_extractPotenciasEndesa,
    __LF_extractConsumoEndesa,
    __LF_extractTripleConsumo,
    __LF_extractConsumoOctopus,
    __LF_extractConsumoVisalia,
    __LF_detectarCompania,
    __LF_extraerDiasCompania,
    __LF_extraerPotenciasCompania,
    __LF_extractQRUrl,
    __LF_parseQRData,
    __LF_parsearDatos
  };
})();

