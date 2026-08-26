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

  const FACTURA_MAX_DIAS = 370;

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
          // Solo coma: normalmente decimal (12,34). Si parece miles US con múltiples grupos (1,234,567) -> quitar comas.
          // Heurística: si empieza por 0, (p.ej. "0,123"), es decimal (muy común en precios/kWh)
          if (/^-?0,\d+$/.test(s)) {
            s = s.replace(',', '.');
          } else if (/^-?\d{1,3}(,\d{3}){2,}$/.test(s)) {
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

      // El QR CNMC publica prP1/prP2 en €/kW·año, mientras que "Mi tarifa"
      // y el motor principal usan €/kW·día. El proyecto anualiza y prorratea
      // siempre sobre una base comercial fija de 365 días; no depende de que
      // la fecha de factura caiga en un año bisiesto.
      function __LF_qrAnnualPowerPriceToDaily(value){
        return Number.isFinite(value) ? value / 365 : null;
      }

      function __LF_qrCustomTarifaAvailability(info){
        // "Mi tarifa" modela precios fijos sin cuota mensual. E0 es libre 3P
        // y F0 libre 1P; indexadas, planas, flexibles y variantes con cuota
        // necesitan conceptos que el formulario principal no puede representar.
        if (!info || !info.tipoContrato) {
          return { precios: null, motivo: 'qr-datos-incompletos' };
        }
        if (!['E0', 'F0'].includes(info.tipoContrato)) {
          return { precios: null, motivo: 'tipo-no-representable' };
        }
        const singleEnergyPrice = info.tipoContrato === 'F0';
        const prices = {
          punta: info.precioEnergiaP1,
          // F0 declara un único precio. Algunos emisores dejan prE2/prE3 a 0
          // y otros los rellenan aunque el campo no sea aplicable; el código de
          // contrato es la fuente que determina cómo debe modelarse la tarifa.
          llano: singleEnergyPrice ? info.precioEnergiaP1 : info.precioEnergiaP2,
          valle: singleEnergyPrice ? info.precioEnergiaP1 : info.precioEnergiaP3,
          p1: __LF_qrAnnualPowerPriceToDaily(info.precioPotenciaP1),
          p2: __LF_qrAnnualPowerPriceToDaily(info.precioPotenciaP2)
        };
        if (!Object.values(prices).every(Number.isFinite)) {
          return { precios: null, motivo: 'qr-precios-incompletos' };
        }
        if (prices.punta < 0 || prices.punta > 1
          || prices.llano < 0 || prices.llano > 1
          || prices.valle < 0 || prices.valle > 1
          || prices.p1 <= 0 || prices.p1 > 1
          || prices.p2 < 0 || prices.p2 > 1) {
          return { precios: null, motivo: 'qr-precios-incompletos' };
        }
        return { precios: prices, motivo: 'ok' };
      }

      function __LF_qrInfoToCustomTarifaPrices(info){
        // API historica conservada para consumidores y pruebas existentes.
        return __LF_qrCustomTarifaAvailability(info).precios;
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
          // Date.UTC normaliza desbordamientos en silencio (31/02 -> algun dia de marzo), asi
          // que isNaN() nunca detecta una fecha imposible por si sola. Comprobacion de ida y
          // vuelta con getters UTC (coherente con Date.UTC arriba; makeStrictDate() en
          // lf-csv-utils.js hace lo mismo pero con getters locales, porque ahi la fecha se
          // construye en hora local, no en UTC).
          if (
            isNaN(dt.getTime()) ||
            dt.getUTCFullYear() !== y ||
            dt.getUTCMonth() !== mo ||
            dt.getUTCDate() !== da
          ) return null;
          return dt;
        };
        const a = parse(d1);
        const b = parse(d2);
        if (!a || !b) return null;
        const ms = (b.getTime() - a.getTime());
        // INCLUSIVO A PROPOSITO (no tocar sin leer esto). Este helper NO recibe fechas de
        // lectura de contador: recibe el rango de facturacion en lenguaje natural que
        // capturan reRango/reRango2 ("del 01/06/2026 al 30/06/2026", "Periodo de
        // facturacion: ..."), que en castellano incluye ambos extremos: junio entero son
        // 30 dias, no 29. La semantica CNMC de lectura inicial excluida SI se aplica, pero
        // en la ruta del QR (iniF/finF), que calcula su diferencia SIN +1 unas lineas mas
        // abajo. Son dos rutas distintas con dos semanticas distintas, ambas correctas.
        // Quitar este +1 infravalora en 1 dia los costes fijos de toda factura leida por
        // esta via (regresion propuesta y descartada el 15/08/2026; ver AUDITORIA-IA.md).
        const days = Math.floor(ms / 86400000) + 1;
        if (!isFinite(days) || days <= 0 || days > FACTURA_MAX_DIAS) return null;
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
            const matchPunta = linea.match(/(?:punta[\s-]*llano|p1)[^0-9]{0,30}([\d,.]+)\s*kw\b/i);
            
            // Intentar buscar P2 (Valle) en la misma línea
            const matchValle = linea.match(/(?:valle|p3)[^0-9]{0,30}([\d,.]+)\s*kw\b/i);
            
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
            const matchPuntaLlano = linea.match(/pot\.\s*punta[\s-]*llano\s+([\d,.]+)\s*kw\b/i);
            if (matchPuntaLlano) {
              const p1 = parseFloat(matchPuntaLlano[1].replace(',', '.'));
              
              // Buscar "Pot. Valle" en las siguientes líneas
              for (let j = i + 1; j < Math.min(i + 3, lineas.length); j++) {
                const lineaSiguiente = lineas[j];
                const matchValle = lineaSiguiente.match(/pot\.\s*valle\s+([\d,.]+)\s*kw\b/i);
                
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
                // Si la fila trae una cantidad explícita en kWh, esa magnitud tiene
                // prioridad sobre precios e importes posteriores. Ej.:
                // "P1 100 kWh 0,15 €/kWh 15,00 €" debe devolver 100, no 15.
                const quantity = str.match(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+[,.]\d+|\d+)\s*kwh\b/i);
                if (quantity) {
                  const num = __LF_normNum(quantity[1]);
                  return num != null && num >= 0 && num <= 1000000 ? num : null;
                }

                // "€/kWh" expresa un precio, no una cantidad de energía. Si no hay
                // una cantidad explícita anterior en kWh, no extraer ningún número de
                // una fila monetaria: antes "P1 0,15 €/kWh" se convertía en 0,15 kWh.
                if (/(?:€|\beur\b|euros?)|\/\s*kwh\b/i.test(str)) return null;

                const nums = str.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+[,.]\d+|\d+/g);
                if (!nums || nums.length === 0) return null;
                
                // En la tabla de lecturas Endesa las filas pueden no repetir "kWh":
                // el último número es la diferencia/consumo, tras lecturas y coeficientes.
                for (let k = nums.length - 1; k >= 0; k--) {
                  const num = __LF_normNum(nums[k]);
                  // El consumo de un periodo 2.0TD puede superar 5.000 kWh (p. ej.
                  // pequeños negocios con potencia cercana a 15 kW). El antiguo techo local
                  // hacía que 6.000 kWh se rechazasen y el bucle retrocediera hasta un 0 de la
                  // propia fila, fabricando consumo cero. Mantener el mismo máximo amplio que
                  // el resto del parser; seguimos recorriendo desde el final porque en esta
                  // tabla Endesa la diferencia/consumo es la última magnitud de la fila.
                  if (num != null && num >= 0 && num <= 2000000) return num;
                }
                return null;
              };
              
              // Una cabecera de columnas como "P1 P2 P3" no es una fila de consumo.
              // Antes la misma línea satisfacía las tres ramas y extraerConsumo() devolvía
              // el último dígito de la cabecera (3), fabricando 3/3/3 y evitando que el
              // fallback compacto leyera los valores reales de la fila siguiente.
              const esPunta = /(?:\bpunta\b|\bp1\b)/i.test(lineaLow);
              const esLlano = /(?:\bllano\b|\bp2\b)/i.test(lineaLow);
              const esValle = /(?:\bvalle\b|\bp3\b)/i.test(lineaLow);
              const etiquetasPeriodo = Number(esPunta) + Number(esLlano) + Number(esValle);
              if (etiquetasPeriodo !== 1) continue;

              if (esPunta && punta === null) {
                punta = extraerConsumo(lineaActual);
              }
              if (esLlano && llano === null) {
                llano = extraerConsumo(lineaActual);
              }
              if (esValle && valle === null) {
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

      // Algunas facturas imprimen en la MISMA fila la lectura acumulada del contador y
      // el consumo del periodo, por ejemplo:
      //   "Lectura en P2: 7.158 kWh  Consumo en P2: 38 kWh"
      // Los fallbacks genéricos por etiqueta P1/P2/P3 pueden quedarse con la primera
      // magnitud (la lectura) aunque exista un "Consumo en Pn" inequívoco unos caracteres
      // después. Esta extracción prioriza solo etiquetas explícitas de CONSUMO y por ello
      // no compite con "Lectura en Pn", producción, excedentes ni otras magnitudes.
      function __LF_extractExplicitPeriodConsumption(texto) {
        if (!texto) return null;
        const t = String(texto);
        const valueFor = (periodRe) => {
          const re = new RegExp(
            `\\bconsumo\\s+(?:en\\s+)?${periodRe}(?:\\s*\\([^)]*\\))?\\s*:?\\s*` +
            `([0-9](?:[0-9.,]*[0-9])?)\\s*kwh\\b`,
            'i'
          );
          const m = t.match(re);
          if (!m) return null;
          const n = __LF_normNum(m[1]);
          return n != null && n >= 0 && n <= 2000000 ? n : null;
        };
        const punta = valueFor('(?:p1|punta)');
        const llano = valueFor('(?:p2|llano)');
        const valle = valueFor('(?:p3|valle)');
        return punta != null && llano != null && valle != null
          ? { punta, llano, valle }
          : null;
      }

      // Tabla real de varias comercializadoras/representantes:
      //   Desde | Hasta | Lectura anterior | Lectura actual | Ajuste | Consumo
      //   Consumo P1 13/09/2023 12/10/2023 11587.00 11627.00 40.00
      // En estas filas la última magnitud es el consumo del periodo. Sin reconocer la
      // cabecera, los fallbacks "P1 + número" interpretaban el día 13 de la primera fecha
      // como 13 kWh (y los de potencia podían reutilizar el mismo 13 como 13 kW).
      function __LF_extractMeterReadingConsumptionTable(texto) {
        if (!texto) return null;
        const lines = String(texto).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const numberRe = /[+-]?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/g;
        const dateRe = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g;

        for (let i = 0; i < lines.length; i++) {
          const header = lines[i].toLowerCase();
          const isHeader = /\bdesde\b/.test(header)
            && /\bhasta\b/.test(header)
            && /lectura\s+anterior/.test(header)
            && /lectura\s+actual/.test(header)
            && /\bconsumo\b/.test(header);
          if (!isHeader) continue;

          const values = { p1: null, p2: null, p3: null };
          for (let j = i + 1; j < Math.min(lines.length, i + 14); j++) {
            const row = lines[j];
            const label = row.match(/^\s*consumo\s+(?:en\s+)?(p1|p2|p3|punta|llano|valle)\b/i);
            if (!label) continue;
            const keyRaw = label[1].toLowerCase();
            const key = keyRaw === 'punta' ? 'p1' : keyRaw === 'llano' ? 'p2' : keyRaw === 'valle' ? 'p3' : keyRaw;

            // Eliminar fechas antes de recoger magnitudes: evita que los componentes
            // 13/09/2023 entren en el conjunto de candidatos. Con la cabecera anterior,
            // la última cifra restante corresponde a la columna Consumo (tras Ajuste).
            const withoutDates = row.slice(label[0].length).replace(dateRe, ' ');
            const nums = withoutDates.match(numberRe) || [];
            if (!nums.length) continue;
            const n = __LF_normNum(nums[nums.length - 1]);
            if (n != null && n >= 0 && n <= 2000000) values[key] = n;
          }

          if (values.p1 != null && values.p2 != null && values.p3 != null) {
            return { punta: values.p1, llano: values.p2, valle: values.p3 };
          }
        }
        return null;
      }

      // Quita SOLO magnitudes de energía etiquetadas como algo distinto de consumo.
      // Es deliberadamente local: una versión anterior bloqueaba todo el documento por
      // contener "Lectura anterior/actual" en cualquier sitio y rompía facturas normales.
      // Aquí se elimina únicamente el tramo "Lectura/Producción/... Pn ... X kWh", de
      // modo que una fila "Lectura ... 8231 kWh Consumo ... 46 kWh" conserva el consumo.
      function __LF_stripNonConsumptionEnergyQuantities(texto) {
        if (!texto) return '';
        const label = '(?:lectura(?:\\s+(?:actual|anterior))?|producci[oó]n|generaci[oó]n|energ[ií]a\\s+generada|autoconsumo|vertido|inyecci[oó]n|exportaci[oó]n|excedentes?)';
        const period = '(?:p[123]|punta|llano|valle)';
        const number = '(?:[+\\-−]?\\s*)(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)';
        const re = new RegExp(`\\b${label}\\s+(?:en\\s+)?${period}(?:\\s*\\([^)]*\\))?[^\\n]{0,120}?${number}\\s*kwh\\b`, 'gi');
        return String(texto).replace(re, ' ');
      }

      // Las facturas rectificativas pueden expresar cantidades de energía negativas. El
      // comparador solo modela consumos no negativos; convertir "P1 -100 kWh" en +100 kWh
      // sería mucho peor que dejar el campo pendiente de revisión. Los extractores históricos
      // buscaban el primer dígito y podían tragarse el signo en el tramo [^0-9].
      //
      // Se detecta únicamente una cantidad negativa que termina en kWh y está ligada a un
      // periodo/consumo. Antes se eliminan lecturas, producción, autoconsumo y excedentes para
      // no confundir una magnitud solar negativa con consumo facturado.
      function __LF_hasNegativeBilledConsumption(texto) {
        const t = __LF_stripNonConsumptionEnergyQuantities(String(texto || ''));
        if (!t) return false;
        const n = '(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)';
        const period = '(?:p[123]|punta|llano|valle|periodo\\s*[123])';
        const patterns = [
          new RegExp(`\\b${period}\\b[^\\n]{0,80}?[-−]\\s*${n}\\s*kwh\\b`, 'i'),
          new RegExp(`\\b(?:consumo|energ[ií]a\\s+activa|t[eé]rmino\\s+de\\s+energ[ií]a)[^\\n]{0,100}?\\b${period}\\b[^\\n]{0,80}?[-−]\\s*${n}\\s*kwh\\b`, 'i'),
          new RegExp(`\\b(?:consumo|energ[ií]a)\\s+total\\b[^\\n]{0,60}?[-−]\\s*${n}\\s*kwh\\b`, 'i')
        ];
        return patterns.some(re => re.test(t));
      }

      // Tabla de lecturas con una fila final de consumo por periodos:
      //   Lectura | Fecha | P1 | P2 | P3
      //   Lectura inicial (kWh) ...
      //   Lectura final (kWh) ...
      //   Consumo (kWh) 100 200 300
      //
      // La etiqueta exacta y los tres únicos valores de la fila forman una fuente
      // estructural inequívoca. Sin esta ruta, al compactar el documento los fallbacks
      // por P1/P2/P3 podían asociar las etiquetas de la cabecera con componentes de las
      // fechas de lectura, devolver sus componentes como kWh y aun alcanzar 100% de
      // confianza. No aceptamos cuatro/seis columnas ni cruzamos saltos de línea: esos
      // formatos necesitan su propio contrato para no recortar periodos o totales.
      function __LF_extractThreePeriodConsumptionRow(texto) {
        if (!texto) return null;
        const number = '([0-9](?:[0-9.,]*[0-9])?)';
        const rowRe = new RegExp(
          `^\\s*consumo\\s*\\(\\s*kwh\\s*\\)\\s+${number}\\s+${number}\\s+${number}\\s*$`,
          'i'
        );
        const lines = String(texto).split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(rowRe);
          if (!match) continue;
          const values = match.slice(1, 4).map(value => __LF_normNum(value));
          if (values.every(value => value != null && value >= 0 && value <= 2000000)) {
            return { punta: values[0], llano: values[1], valle: values[2] };
          }
        }
        return null;
      }

      // FIX: extraer triple consumo explícito "Consumo en el periodo"


      function __LF_extractTripleConsumo(texto){
        if (!texto) return null;
        const t = String(texto);

        // Los formatos inequívocos ganan antes de cualquier heurística por compañía o
        // fallback de etiquetas. Ambos aparecen en facturas reales y contienen a la vez
        // lecturas acumuladas y consumo, por lo que el orden de prioridad es esencial.
        const explicitConsumption = __LF_extractExplicitPeriodConsumption(t);
        if (explicitConsumption) return explicitConsumption;

        const readingTableConsumption = __LF_extractMeterReadingConsumptionTable(t);
        if (readingTableConsumption) return readingTableConsumption;

        const threePeriodRow = __LF_extractThreePeriodConsumptionRow(t);
        if (threePeriodRow) return threePeriodRow;

        // El resto de heurísticas de consumo no debe ver cantidades etiquetadas como
        // lecturas, generación, producción o exportación. Se conserva el resto del texto
        // (incluido cualquier "Consumo en Pn" que comparta fila con una lectura).
        const genericText = __LF_stripNonConsumptionEnergyQuantities(t);

        // ✅ NUEVO: Intentar extracción específica para Endesa PRIMERO
        const endesaResult = __LF_extractConsumoEndesa(genericText);
        if (endesaResult) {
          return endesaResult;
        }

        // Si el documento contiene una sección explícita de consumo/energía facturada,
        // priorizarla sobre tablas de lecturas acumuladas del contador. Una factura puede
        // incluir ambos bloques y los valores de lectura (p. ej. 12.345 kWh acumulados)
        // no son el consumo del periodo.
        const sectionRe = /(?:consumo(?:\s+facturado)?|energ[ií]a\s+activa|t[eé]rmino\s+de\s+energ[ií]a)/gi;
        let sectionMatch;
        while ((sectionMatch = sectionRe.exec(genericText)) !== null) {
          let sub = genericText.slice(sectionMatch.index, sectionMatch.index + 900);
          // No dejar que una mención genérica como "Consumo total: 600 kWh" haga
          // que este bloque atraviese después una tabla de LECTURAS acumuladas y use
          // sus P1/P2/P3 como consumo facturado. Si existe un bloque de consumo real
          // más adelante, sectionRe lo encontrará en su propia iteración.
          const readingsIdx = sub.search(/\blecturas\s+(?:del\s+|de\s+la\s+)(?:contador|distribuidora)\b/i);
          if (readingsIdx > 0) sub = sub.slice(0, readingsIdx);
          const readQuantity = (labelRe) => {
            const m = sub.match(new RegExp(`${labelRe.source}[^0-9]{0,50}([0-9][0-9.,]*)\\s*kwh\\b`, 'i'));
            if (!m) return null;
            const n = __LF_normNum(m[1]);
            return n != null && n >= 0 && n <= 2000000 ? n : null;
          };
          const ep = readQuantity(/(?:\bpunta\b|\bp1\b|periodo\s*1)/i);
          const el = readQuantity(/(?:\bllano\b|\bp2\b|periodo\s*2)/i);
          const ev = readQuantity(/(?:\bvalle\b|\bp3\b|periodo\s*3)/i);
          if (ep != null && el != null && ev != null) return { punta: ep, llano: el, valle: ev };
        }

        // Si solo encontramos contexto explícito de lecturas del contador, no tratar sus
        // acumulados como consumo. Los extractores específicos (Endesa/Visalia/Octopus)
        // ya se ejecutan antes y pueden calcular/seleccionar el dato correcto cuando el
        // formato de esa compañía está soportado.
        // ACOTADO DOS VECES A PROPOSITO, y conviene no relajarlo otra vez. Este guard es la
        // parte de la ronda 6 que mas dano colateral ha hecho:
        //   1) La version original incluia "lectura actual|anterior", que aparece de pasada en
        //      casi cualquier factura española. Medido: "Lectura anterior: 15/01/2026" +
        //      "Punta 100 kWh..." pasaba de 100/200/300 a null.
        //   2) Aun acotado, "lecturas?" en singular y con articulo opcional seguia casando la
        //      frase "Ajuste lectura distribuidora" de las facturas de DISA, que NO es una
        //      tabla de lecturas. Consecuencia real medida sobre una factura de verdad
        //      (Factura EP26 1003403.pdf): los consumos 346/310/313 desaparecian pese a que el
        //      documento dice "Energia P1 346 kWh x 0,108700 EUR/kWh", y la confianza caia de
        //      100% a 50%. Regresion confirmada contra el informe de QA del 14/07/2026.
        // Ahora exige PLURAL + articulo, que es como se titula de verdad la tabla ("Lecturas
        // del contador" / "Lecturas de la distribuidora"). Ante la duda, no guardar: no hacerlo
        // solo devuelve el comportamiento previo a la ronda 6, que llevaba meses funcionando.
        if (/\blecturas\s+(?:del\s+|de\s+la\s+)(?:contador|distribuidora)\b/i.test(genericText)) {
          return null;
        }

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Punta/P1
        const p = __LF_extraerNumero(genericText, [
          /(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bpunta\b|\bp1\b|periodo\s*1)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:punta|p1)[:\s]+([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p1[^\d]{0,20}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i,
          // NUEVOS BRUTALES
          /\bp1\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,  // "P1 ... 100 kWh"
          /punta[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,  // "Punta ... 100 kWh"
          /activa[^\n]{0,80}p1[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i,  // "activa ... P1 ... 100" sin contexto de precio
          /\bp1[^\n]{0,100}\bkwh\b(?:(?!\b(?:p[123]|punta|llano|valle|periodo)\b)[^0-9]){0,30}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])(?!\s*(?:d[ií]as?\b|€|eur\b|\/))/i  // "P1 ... kWh ... 100" sin cruzar a otra etiqueta/campo
        ], 0, 1000000);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Llano/P2
        const l = __LF_extraerNumero(genericText, [
          /(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bllano\b|\bp2\b|periodo\s*2)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:llano|p2)[:\s]+([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p2[^\d]{0,20}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i,
          // NUEVOS BRUTALES
          /\bp2\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /llano[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /activa[^\n]{0,80}p2[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i,
          /\bp2[^\n]{0,100}\bkwh\b(?:(?!\b(?:p[123]|punta|llano|valle|periodo)\b)[^0-9]){0,30}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])(?!\s*(?:d[ií]as?\b|€|eur\b|\/))/i
        ], 0, 1000000);

        // PATRONES UNIVERSALES ULTRA-ROBUSTOS: Valle/P3
        const v = __LF_extraerNumero(genericText, [
          /(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /energ[ií]a[^\n]{0,80}(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo[^\n]{0,80}(?:\bvalle\b|\bp3\b|periodo\s*3)[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\b(?:valle|p3)[:\s]+([0-9][0-9.,]*)\s*kwh\b/i,
          /consumo\s*(?:activa|total)?[^\n]{0,80}p3[^\d]{0,20}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i,
          // NUEVOS BRUTALES
          /\bp3\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /valle[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
          /activa[^\n]{0,80}p3[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i,
          /\bp3[^\n]{0,100}\bkwh\b(?:(?!\b(?:p[123]|punta|llano|valle|periodo)\b)[^0-9]){0,30}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])(?!\s*(?:d[ií]as?\b|€|eur\b|\/))/i
        ], 0, 1000000);

        if (p != null && l != null && v != null){
          return { punta: p, llano: l, valle: v };
        }

        // Tablas donde "kWh" aparece una sola vez como unidad de la fila y los tres
        // periodos se expresan por columnas. No basta con tomar los tres primeros números:
        // eso confundía los dígitos de P1/P2/P3, días o precios €/kWh con consumos.
        const lines = genericText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        for (const line of lines){
          const low = line.toLowerCase();
          // Producción/generación/exportación son magnitudes solares distintas del
          // consumo de red. No interpretar una tabla de esas magnitudes como consumo.
          if (/(?:producci[oó]n|generaci[oó]n|energ[ií]a\s+generada|autoconsumo|vertido|inyecci[oó]n|exportaci[oó]n|excedentes?)/i.test(low)
            && !/\bconsumo\b/i.test(low)) continue;
          // Un kWh usado como denominador de precio (€/kWh) no demuestra que la fila
          // contenga una cantidad de energía. Quitamos denominadores antes de comprobarlo.
          const quantityContext = low.replace(/\/\s*kwh\b/g, '');
          if (!/\bkwh\b/.test(quantityContext)) continue;

          const parsePair = (labelRe) => {
            const labelMatch = line.match(labelRe);
            if (!labelMatch) return null;
            const start = (labelMatch.index ?? 0) + labelMatch[0].length;
            let segment = line.slice(start);
            // No cruzar a la etiqueta del siguiente periodo. Antes "P1 kWh P2 200..."
            // podia tomar el "2" de P2 como consumo P1 al compactar lineas.
            const nextLabel = segment.search(/\b(?:p[123]|punta|llano|valle)\b/i);
            if (nextLabel >= 0) segment = segment.slice(0, nextLabel);
            const m = segment.match(/(?:^|[^0-9.,])([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])/);
            if (!m) return null;
            // En una línea compactada, "P1 0,15 €/kWh P2 ..." tiene exactamente
            // la misma forma etiqueta+numero que una tabla de consumos. Miramos lo que
            // sigue al número para no convertir un precio unitario en energía.
            const suffix = segment.slice((m.index ?? 0) + m[0].length);
            if (/^\s*(?:€|eur\b|euros?\b|\/\s*kwh\b|kw\b|d[ií]as?\b)/i.test(suffix)) return null;
            const value = __LF_normNum(m[1]);
            return value != null && value >= 0 && value <= 1000000 ? value : null;
          };

          // Formato intercalado: "P1 100 P2 200 P3 300" o
          // "Punta 100 Llano 200 Valle 300" con la unidad kWh en la cabecera/fila.
          if (/\bp1\b/i.test(line) && /\bp2\b/i.test(line) && /\bp3\b/i.test(line)) {
            // Formato cabecera primero: "P1 P2 P3 100 200 300". Resolverlo antes
            // del formato intercalado evita tomar el "2" de P2 como valor de P1.
            if (/\bp1\b[^0-9]{0,15}\bp2\b[^0-9]{0,15}\bp3\b/i.test(line)) {
              const tail = line.replace(/^.*?\bp3\b/i, '');
              const vals = (tail.match(/[0-9][0-9.,]*/g) || [])
                .map(x => __LF_normNum(x))
                .filter(x => x != null && x >= 0 && x <= 1000000);
              if (vals.length >= 3) return { punta: vals[0], llano: vals[1], valle: vals[2] };
            }

            const pp = parsePair(/\bp1\b/i);
            const pl = parsePair(/\bp2\b/i);
            const pv = parsePair(/\bp3\b/i);
            if (pp != null && pl != null && pv != null) return { punta: pp, llano: pl, valle: pv };
          }

          if (/\bpunta\b/i.test(line) && /\bllano\b/i.test(line) && /\bvalle\b/i.test(line)) {
            if (/\bpunta\b[^0-9]{0,20}\bllano\b[^0-9]{0,20}\bvalle\b/i.test(line)) {
              const tail = line.replace(/^.*?\bvalle\b/i, '');
              const vals = (tail.match(/[0-9][0-9.,]*/g) || [])
                .map(x => __LF_normNum(x))
                .filter(x => x != null && x >= 0 && x <= 1000000);
              if (vals.length >= 3) return { punta: vals[0], llano: vals[1], valle: vals[2] };
            }

            const pp = parsePair(/\bpunta\b/i);
            const pl = parsePair(/\bllano\b/i);
            const pv = parsePair(/\bvalle\b/i);
            if (pp != null && pl != null && pv != null) return { punta: pp, llano: pl, valle: pv };
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
          // 0/0/0 es un periodo valido (sin consumo, pero con costes fijos).
          // La presencia de la tabla, no que su suma sea positiva, demuestra que los
          // tres valores se han detectado realmente.
          if ([p1, p2, p3].every(v => Number.isFinite(v) && v >= 0)) {
            lfDbg('[OCTOPUS-CONSUMO] Tabla contador:', { p1, p2, p3 });
            return { punta: p1, llano: p2, valle: p3 };
          }
        }

        // Método 2: sumar valores de cada "Punta X kWh" principal en secciones Energía Activa
        // (para facturas multi-periodo donde los valores están desglosados)
        const sumAll = (re) => {
          const r = new RegExp(re.source, 'gi');
          let m, total = 0, found = false;
          while ((m = r.exec(t)) !== null) {
            const v = __LF_normNum(m[1]);
            // Cada línea representa un bloque facturado distinto. Dos bloques pueden tener
            // exactamente el mismo consumo, y un periodo puede ser legítimamente 0 kWh.
            if (v != null && v >= 0) {
              found = true;
              total += v;
            }
          }
          return found ? Math.round(total * 100) / 100 : null;
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

        // Bualá (marca comercial de Energy Plus Iberia). La extracción económica se
        // apoya en la estructura de la tabla y no en esta marca; detectarla sirve para
        // identificar correctamente la factura en la interfaz sin confundirla con la
        // distribuidora i-DE que también aparece en el documento.
        if (
          t.includes('bualá') || t.includes('buala.es') ||
          t.includes('energy plus iberia')
        ) return 'buala';

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
            ], 1, FACTURA_MAX_DIAS);
            
          case 'iberdrola':
            // Iberdrola: "DIAS FACTURADOS: FECHA... 24"
            return __LF_extraerNumero(texto, [
              /d[i\u00ed\u00cc]as?\s*facturados?.{0,100}?(\d{1,3})\b/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'energyavm':
            // Enérgya VM: "x 31 días x" o "31días x"
            return __LF_extraerNumero(texto, [
              /x\s*(\d{1,3})\s*d[ií\u00cc].as?\s*x/i,
              /(\d{1,3})d[ií\u00cc].as?\s*x/i,
              /x\s*(\d{1,3})\s*d.as?\s*x/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'totalenergies':
            // TotalEnergies: "(31 día(s))" o "Alquiler equipos (31 días)"
            return __LF_extraerNumero(texto, [
              /\b(\d{1,3})\s*d[ií]a\(s\)/i,
              /potencia[^\n]{0,120}(\d{1,3})\s*d[ií]a\(s\)/i,
              /alquiler[^\n]{0,80}\(\s*(\d{1,3})\s*d[ií]as?\)/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'octopus':
            // Octopus: "DD-MM-YYYY a DD-MM-YYYY (X días)"
            return __LF_extraerNumero(texto, [
              /\d{2}-\d{2}-\d{4}\s+a\s+\d{2}-\d{2}-\d{4}\s+\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'visalia':
            // Visalia: "Consumo periodo: X días"
            return __LF_extraerNumero(texto, [
              /consumo\s+periodo\s*:\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'plenitude':
            // Plenitude: "* X días"
            return __LF_extraerNumero(texto, [
              /\*\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'energiaxxi':
            // Energía XXI: "(X días)" en contexto de periodo
            return __LF_extraerNumero(texto, [
              /\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i,
              /periodo[^)]{0,80}\(\s*(\d{1,3})\s*d[ií]as?\s*\)/i
            ], 1, FACTURA_MAX_DIAS);
            
          case 'imagina':
            // Imagina Energía: en potencia contratada aparece "€/kW * X Días"
            return __LF_extraerNumero(texto, [
              /€\s*\/\s*k[wW]\s*\*\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\/\s*k[wW]\s*\*\s*(\d{1,3})\s*d[ií]as?\b/i,
              /\*\s*(\d{1,3})\s*d[ií]as?\b/i
            ], 1, FACTURA_MAX_DIAS);
            
          default:
            // Genérico: intentar todos los patrones
            return null;
        }
      }
      
      // Extraer una pareja P1/P2 únicamente desde una sección inequívocamente
      // contractual. Se usa cuando la factura también contiene "potencias máximas
      // demandadas", porque la mera presencia global de "potencia contratada" no basta:
      // un encabezado vacío seguido por la tabla de máximas podía legitimar esos máximos.
      function __LF_extractContractPowerPair(texto){
        const t = String(texto || '');
        if (!t) return null;
        const markerRe = /(?:potencias?\s+contratadas?|potencia\s+contratada|datos\s+(?:del|de\s+tu)\s+contrato|condiciones\s+del\s+contrato|datos\s+del\s+suministro)/gi;
        const maxDemandRe = /potencias?\s+m[aá]ximas?\s+demandadas?/i;
        let markerMatch;

        while ((markerMatch = markerRe.exec(t)) !== null) {
          let section = t.slice(markerMatch.index, markerMatch.index + 700);
          const maxIdx = section.search(maxDemandRe);
          if (maxIdx > 0) section = section.slice(0, maxIdx);

          const p1 = __LF_extraerNumero(section, [
            /\b(?:p1|punta(?:[-\s]*llano)?)\b[^0-9]{0,30}([0-9][0-9.,]*)\s*kw\b/i
          ], 0, 40);
          const p2 = __LF_extraerNumero(section, [
            /\b(?:p2|p3|valle)\b[^0-9]{0,30}([0-9][0-9.,]*)\s*kw\b/i
          ], 0.1, 40);
          if (p1 != null && p2 != null) return { p1, p2 };
        }
        return null;
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
            // Con máximas demandadas presentes, restringir la lectura a una sección
            // contractual. Los patrones P1/P2/P3 de DISA serían demasiado amplios sobre
            // el documento completo y podrían convertir esos máximos en contrato.
            if (/potencias?\s+m[aá]ximas?\s+demandadas?/i.test(texto)) {
              return __LF_extractContractPowerPair(texto);
            }

            // DISA: en el término de potencia suele venir P1 y P3 (sin P2 explícita).
            // En 2.0TD tratamos P3 como el segundo periodo de potencia (P2 en el formulario).
            const parseDecimal = (raw, allowZero = false) => {
              if (!raw) return null;
              const v = parseFloat(String(raw).replace(',', '.'));
              return ((allowZero ? v >= 0 : v > 0) && v <= 40) ? v : null;
            };

            const mP1 = texto.match(/\bp1\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)\b(?!\s*h)/i);
            const mP2 = texto.match(/\bp2\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)\b(?!\s*h)/i);
            const mP3 = texto.match(/\bp3\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)\b(?!\s*h)/i);

            const p1_di = parseDecimal(mP1 && mP1[1], true);
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
            // Con máximas demandadas presentes, solo aceptar P1/P2 si están dentro de
            // una sección contractual inequívoca.
            if (/potencias?\s+m[aá]ximas?\s+demandadas?/i.test(texto)) {
              return __LF_extractContractPowerPair(texto);
            }

            // TotalEnergies: "P1: 4,50 P2: 4,50 kW" (kW después de P2).
            // No aceptar un simple "Potencia P1: 0,15 €/kW día": eso es el precio
            // del término de potencia, no la potencia contratada.
            const p1_te = __LF_extraerNumero(texto, [
              /potencia\s+contratada[^\n]{0,80}\bp1\b[^0-9]{0,30}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:€|eur\b|euros?\b|\/\s*kw\b))/i,
              /\bp1[:\s]+([0-9][0-9.,]*)\s*(?:p2|kw\b)/i
            ], 0, 40);
            const p2_te = __LF_extraerNumero(texto, [
              /potencia\s+contratada[^\n]{0,120}\bp2\b[^0-9]{0,30}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:€|eur\b|euros?\b|\/\s*kw\b))/i,
              /\bp2[:\s]+([0-9][0-9.,]*)\s*kw\b/i
            ], 0.1, 40);
            return { p1: p1_te, p2: p2_te };
          }
            
          case 'imagina': {
            // Igual que en el fallback genérico: con máximas demandadas presentes,
            // limitar la lectura a la sección contractual y no al documento completo.
            if (/potencias?\s+m[aá]ximas?\s+demandadas?/i.test(texto)) {
              return __LF_extractContractPowerPair(texto);
            }

            // Imagina Energía: "P1 5,750 kW * ... * 30 Días" (bloque Potencia contratada)
            const low_im = texto.toLowerCase();
            let sub_im = texto;
            const idx_im = low_im.indexOf('potencia contratada');
            if (idx_im >= 0) sub_im = texto.slice(idx_im, idx_im + 800);

            const p1_im = __LF_extraerNumero(sub_im, [
              /\bp1\b[^\d]{0,20}([0-9][0-9.,]*)\s*k\s*(?:w|vv)(?!\s*h)\b/i
            ], 0, 40);
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

            if (p1_oc != null && p1_oc >= 0 && p1_oc <= 40) {
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

            if (p1_pl != null && p1_pl >= 0 && p1_pl <= 40) {
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
        const urlPattern = /https:\/\/comparador\.cnmc\.gob\.es\/comparador\/QRE(?:2)?\?[^\s"'\n]+/;
        const match = texto.match(urlPattern);
        if (match) {
          lfDbg('[QR TEXTO] ✓ URL encontrada en texto');
          return match[0];
        }
        return null;
      }



      function __LF_isTrustedCnmcQrUrl(qrUrl) {
        if (!qrUrl) return false;
        try {
          const url = new URL(qrUrl);
          return url.protocol === 'https:'
            && url.hostname.toLowerCase() === 'comparador.cnmc.gob.es'
            && (url.pathname === '/comparador/QRE' || url.pathname === '/comparador/QRE2');
        } catch (_) {
          return false;
        }
      }

      function __LF_isCnmcCommercializerCode(value) {
        return /^R2-\d{3,4}$/.test(String(value ?? '').trim().toUpperCase());
      }

      function __LF_parseQRData(qrUrl) {
        if (!__LF_isTrustedCnmcQrUrl(qrUrl)) return null;
        
        try {
          const url = new URL(qrUrl);
          const params = url.searchParams;
          // La resolución CNMC declara indiferente el uso de mayúsculas/minúsculas
          // en los nombres de parámetros del QR. URLSearchParams.get() sí distingue
          // mayúsculas, así que normalizamos las claves para aceptar todo el formato
          // permitido sin relajar la validación del origen ni de los valores.
          const paramsCI = new Map();
          for (const [key, value] of params.entries()) {
            const normalizedKey = key.toLowerCase();
            if (!paramsCI.has(normalizedKey)) paramsCI.set(normalizedKey, value);
          }
          const getParam = (key) => paramsCI.get(key.toLowerCase()) ?? null;
          
          // Extraer datos clave. Los QR oficiales expresan pPx en kW y cfPx en kWh.
          // Aceptamos también el valor desnudo por compatibilidad con QR antiguos/tests,
          // pero NO un prefijo numérico seguido de una unidad/cadena distinta: antes
          // "pP1=3.45kWh" o incluso "pP1=3.45texto" se aceptaban como 3,45 kW con
          // confianza 100 %, pese a ser un parámetro dimensionalmente inválido.
          const parseQrNumber = (raw, expectedUnit) => {
            const unit = expectedUnit === 'kwh' ? 'kwh' : 'kw';
            const re = new RegExp(`^([+-]?\\d+(?:[.,]\\d+)?)(?:\\s*${unit})?$`, 'i');
            const m = String(raw ?? '').trim().match(re);
            if (!m) return null;
            const n = Number(m[1].replace(',', '.'));
            return Number.isFinite(n) ? n : null;
          };

          // Los campos informativos del QR se aceptan solo si el valor completo es
          // numérico. No usamos parseFloat: convertiría "85.38texto" en un importe
          // aparentemente válido y terminaría mostrando contenido no estructurado.
          const parseQrDecimal = (key, { min = -1000000000, max = 1000000000 } = {}) => {
            const raw = getParam(key);
            if (raw == null || String(raw).trim() === '') return null;
            const m = String(raw).trim().match(/^[+-]?\d+(?:[.,]\d+)?$/);
            if (!m) return null;
            const n = Number(m[0].replace(',', '.'));
            return Number.isFinite(n) && n >= min && n <= max ? n : null;
          };

          const parseQrDate = (raw) => {
            const m = String(raw ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!m) return null;
            const y = Number(m[1]);
            const mo = Number(m[2]) - 1;
            const d = Number(m[3]);
            const date = new Date(Date.UTC(y, mo, d));
            // Date normaliza fechas imposibles (2026-02-31 -> marzo). El QR no debe
            // convertir silenciosamente una fecha inválida en días plausibles.
            if (
              !Number.isFinite(date.getTime())
              || date.getUTCFullYear() !== y
              || date.getUTCMonth() !== mo
              || date.getUTCDate() !== d
            ) return null;
            return String(raw).trim();
          };

          const parseQrEnum = (key, allowed) => {
            const value = String(getParam(key) ?? '').trim().toUpperCase();
            return allowed.has(value) ? value : null;
          };

          const p1 = parseQrNumber(getParam('pP1'), 'kw');
          const p2 = parseQrNumber(getParam('pP2'), 'kw');
          const cfP1 = parseQrNumber(getParam('cfP1'), 'kwh');
          const cfP2 = parseQrNumber(getParam('cfP2'), 'kwh');
          const cfP3 = parseQrNumber(getParam('cfP3'), 'kwh');
          const fechaInicio = getParam('iniF');
          const fechaFin = getParam('finF');
          const maxKw = Number(window.LF_CONFIG?.POTENCIA_MAX_KW ?? 15);
          
          if (
            p1 == null || p2 == null || cfP1 == null || cfP2 == null || cfP3 == null
            || p1 < 0 || p2 <= 0
            || (Number.isFinite(maxKw) && (p1 > maxKw || p2 > maxKw))
            || cfP1 < 0 || cfP2 < 0 || cfP3 < 0
          ) {
            lfDbg('[QR] ⚠️  QR inválido - campos numéricos ausentes o fuera de rango');
            return null;
          }
          
          // iniF/finF tienen semántica CNMC: inicio excluido y fin incluido, por eso
          // la diferencia directa ya es el número de días. Una fecha inválida no debe
          // contaminar los datos numéricos válidos del QR; se deja dias=null para que
          // el parser del PDF pueda completar ese campo.
          let dias = null;
          let fechaInicioValida = null;
          let fechaFinValida = null;
          if (fechaInicio && fechaFin) {
            const inicio = parseQrDate(fechaInicio);
            const fin = parseQrDate(fechaFin);
            if (inicio && fin) {
              const calc = Math.floor((Date.parse(fin + 'T00:00:00Z') - Date.parse(inicio + 'T00:00:00Z')) / 86400000);
              if (Number.isFinite(calc) && calc > 0 && calc <= FACTURA_MAX_DIAS) {
                dias = calc;
                fechaInicioValida = inicio;
                fechaFinValida = fin;
              }
            }
          }

          const codigoComercializadoraRaw = String(getParam('com') ?? '').trim().toUpperCase();
          // El formato regulado original era R2-XXX, pero el censo vivo de la
          // CNMC ya asigna codigos de cuatro cifras (R2-1000 en adelante).
          const codigoComercializadora = __LF_isCnmcCommercializerCode(codigoComercializadoraRaw)
            ? codigoComercializadoraRaw
            : null;
          const finPenRaw = String(getParam('finPen') ?? '').trim();
          const finPermanencia = finPenRaw === '0000-00-00' ? null : parseQrDate(finPenRaw);
          const permanencia = finPenRaw === '0000-00-00'
            ? false
            : (finPermanencia ? true : null);
          const tipoContrato = parseQrEnum('tc', new Set([
            'A0', 'A1', 'B0', 'B1', 'C0', 'C1', 'D0', 'D1',
            'E0', 'E1', 'F0', 'F1', 'G0', 'G1', 'H0', 'H1'
          ]));
          const revisionRaw = parseQrDecimal('rev', { min: 0, max: 5 });
          const revisionPrecios = Number.isInteger(revisionRaw) ? revisionRaw : null;

          // Modelo informativo deliberadamente acotado. No se copia CUPS, código postal
          // ni la URL completa del QR: la interfaz solo recibe datos contractuales y
          // económicos necesarios para explicar la factura localmente.
          const qrInfo = {
            codigoComercializadora,
            fechaInicio: fechaInicioValida,
            fechaFin: fechaFinValida,
            fechaFactura: parseQrDate(getParam('fFact')),
            inicioConsumoAnual: parseQrDate(getParam('iniA')),
            finContrato: parseQrDate(getParam('finContrato')),
            permanencia,
            finPermanencia,
            tipoContrato,
            tipoFactura: parseQrEnum('tf', new Set(['A', 'N', 'R', 'C', 'G'])),
            revisionPrecios,
            energiaVerde: (() => {
              const value = parseQrEnum('verde', new Set(['0', '1']));
              return value == null ? null : value === '1';
            })(),
            totalFacturado: parseQrDecimal('imp'),
            importePotencia: parseQrDecimal('impPot'),
            importeEnergia: parseQrDecimal('impEner'),
            importeServiciosAdicionales: parseQrDecimal('impSA'),
            importeOtrosConIE: parseQrDecimal('impOtrosConIE'),
            importeOtrosSinIE: parseQrDecimal('impOtrosSinIE'),
            compensacionExcedentes: parseQrDecimal('exc', { min: 0 }),
            descuentoBonoSocial: parseQrDecimal('dtoBS', { min: 0 }),
            financiacionBonoSocial: parseQrDecimal('finBS'),
            descuento: parseQrDecimal('dto'),
            ajuste: parseQrDecimal('ajuste'),
            precioPotenciaP1: parseQrDecimal('prP1', { min: 0 }),
            precioPotenciaP2: parseQrDecimal('prP2', { min: 0 }),
            precioEnergiaP1: parseQrDecimal('prE1', { min: 0 }),
            precioEnergiaP2: parseQrDecimal('prE2', { min: 0 }),
            precioEnergiaP3: parseQrDecimal('prE3', { min: 0 }),
            potenciaMaximaP1: parseQrDecimal('pmaxP1', { min: 0 }),
            potenciaMaximaP2: parseQrDecimal('pmaxP2', { min: 0 }),
            consumoAnualP1: parseQrDecimal('caP1', { min: 0 }),
            consumoAnualP2: parseQrDecimal('caP2', { min: 0 }),
            consumoAnualP3: parseQrDecimal('caP3', { min: 0 }),
            cambioPrecios: (() => {
              const value = parseQrDecimal('cambio', { min: 0, max: 2 });
              return Number.isInteger(value) ? value : null;
            })(),
            promocion: (() => {
              const value = parseQrEnum('promo', new Set(['0', '1']));
              return value == null ? null : value === '1';
            })()
          };
          
          const datos = {
            p1,
            p2,
            consumoPunta: cfP1,
            consumoLlano: cfP2,
            consumoValle: cfP3,
            dias,
            // Metadatos internos para comprobar que el periodo del PDF corresponde
            // al mismo documento antes de mezclar fuentes. No se muestran ni se aplican.
            _fechaInicio: fechaInicioValida,
            _fechaFin: fechaFinValida,
            codigoComercializadora,
            qrInfo,
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

        // LuzFija modela exclusivamente 2.0TD (2 periodos de potencia + 3 de energía).
        // Un documento que declara DE FORMA EXPLÍCITA otro peaje no debe reinterpretarse
        // recortando sus primeros periodos: una 3.0TD tiene seis periodos y puede tener
        // P1/P2 <= 15 kW mientras otro periodo supera 15 kW. En ese caso el antiguo parser
        // llegaba a 100% de confianza con una estructura que el comparador no representa.
        // Acotamos el detector a etiquetas inequívocas de acceso/ATR para no inferir el
        // peaje por una mención incidental a "3.0TD" en texto comercial o explicativo.
        const ACCESO = String.raw`\b(?:peaje(?:\s+de\s+acceso)?|tarifa(?:\s+de)?\s+acceso|atr)\b[^0-9\n]{0,25}`;
        const unsupportedAccessMatch = tAll.match(
          new RegExp(ACCESO + String.raw`((?:3[.,]0|6[.,][1-4])\s*td)\b`, 'i')
        );
        // Si el propio documento declara ADEMAS un peaje 2.0TD, esa declaracion manda: una
        // factura solo tiene un peaje, y la mencion a 3.0TD es entonces informativa (la letra
        // pequena "si supera 15 kW se le aplicara el peaje de acceso 3.0TD" es habitual en
        // facturas y anexos 2.0TD perfectamente normales). Sin esta comprobacion, medido,
        // una 2.0TD que declaraba su peaje correctamente quedaba BLOQUEADA por esa frase.
        // Se prefiere el falso negativo (no bloquear) al falso positivo (romper una factura
        // valida): no bloquear solo devuelve el comportamiento anterior, bloquear de mas
        // inutiliza el lector de facturas para un usuario legitimo.
        const declaraPeajeSoportado = new RegExp(ACCESO + String.raw`2[.,]0\s*td\b`, 'i').test(tAll);
        if (unsupportedAccessMatch && !declaraPeajeSoportado) {
          const peajeAcceso = unsupportedAccessMatch[1]
            .replace(',', '.')
            .replace(/\s+/g, '')
            .toUpperCase();
          lfDbg('[PEAJE] ⚠️ Factura fuera del dominio 2.0TD:', peajeAcceso);
          return {
            compania,
            dias: null,
            p1: null,
            p2: null,
            consumoPunta: null,
            consumoLlano: null,
            consumoValle: null,
            consumoTotalDetectado: null,
            confianza: 0,
            peajeAcceso,
            peajeNoSoportado: true,
            _fechaInicio: fIni,
            _fechaFin: fFin
          };
        }

        // Los días de factura son enteros. Neutralizamos tokens decimales en la copia usada solo para días antes de
        // ejecutar sus regex para evitar matches parciales: "30,5 días" podía
        // degradarse a 5 días (o a 30 en otros patrones). Si existe otra mención válida
        // en la factura seguirá disponible para los extractores.
        const tDias = tAll.replace(/\b\d{1,3}[.,]\d+\b/g, ' ');
        
        // Intentar extracción específica por compañía primero
        let dias = __LF_extraerDiasCompania(tDias, compania);
        
        // Si no se detectó o es genérico, usar patrones universales ULTRA-ROBUSTOS
        if (dias == null) {
          dias = __LF_extraerNumero(tDias, [
          // Patrones base probados
          /\bdies?\s*[:-]?\s*(\d{1,3})\b/i,  // Catalán: "Dies: 30"
          /d[i\u00ed\u00cc]as?\s*facturados?.{0,100}?(\d{1,3})\b/i,  // Iberdrola ultra-permisivo
          /d[ií]as\s*(?:facturables|facturados|de\s*facturaci[oó]n|de\s*periodo|del\s*periodo|total)\s*[:-]?\s*(\d{1,3})\b/i,
          /\btotal\s*d[ií]as\b[^0-9]{0,10}(\d{1,3})\b/i,
          /\b(\d{1,3})\s*d[ií]as\b\s*(?:de\s*facturaci[oó]n|facturados)\b/i,
          
          // Paréntesis y formato especial
          /\(\s*(\d{1,3})\s*dies?\s*\)/i,  // Catalán: "(30 dies)"
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
          /\bd[ií]as?\b\s*[:-]?\s*(\d{1,3})\b/i,  // "días: 31" / "días 31" sin cruzar a otros campos
          /(\d{1,3})\s*d[ií]as?\b/i,  // Número seguido de "días" (ultra genérico)
          /duraci[oó]n[^\d]{0,40}(\d{1,3})\s*d[ií]as?\b/i,  // "duración ... 31 días"
          /\bperiodo[:\s]+(\d{1,3})\s*d[ií]as?\b/i,  // "periodo: 31 días"
          /factura[^\d]{0,60}(\d{1,3})\s*d[ií]as?\b/i,  // "factura ... 31 días"
          /desde[^\n]{0,100}hasta[^\n]{0,50}\(\s*(\d{1,3})\s*d[ií]as?\)/i,  // "desde X hasta Y (31 días)"
          /n[uú]mero\s*de\s*d[ií]as[:\s]*(\d{1,3})\b/i,  // "número de días: 31"
          /alquiler[^\d]{0,80}(\d{1,3})\s*d[ií]as?\b/i,  // "alquiler ... 31 días"
          /\b(\d{1,3})\s+d\b/i,  // "31 d"; exige espacio para no leer "1ºD" de una dirección
          /vigencia[^\d]{0,40}(\d{1,3})\s*d[ií]as?\b/i  // "vigencia ... 31 días"
        ], 1, FACTURA_MAX_DIAS, 'DÍAS');  // ← ACTIVAR DEBUG
        }
        
        lfDbg('[DEBUG DÍAS] Compañía:', compania, '| Resultado:', dias);

        if ((dias == null || dias <= 0) && fIni && fFin){
          const calc = __LF_daysInclusive(fIni, fFin);
          if (calc != null) dias = calc;
        }

        // --- Potencias (kW) ---
        // Intentar extracción específica por compañía
        // Algunos extractores específicos (especialmente Endesa/Energía XXI) dependen
        // de la estructura por líneas de la factura. Probar primero el texto original
        // preserva esa información y dejar tAll como fallback mantiene compatibilidad
        // con formatos en una sola línea.
        const potenciasCompania = (compania === 'endesa' || compania === 'energiaxxi')
          ? (__LF_extraerPotenciasCompania(textLines, compania) || __LF_extraerPotenciasCompania(tAll, compania))
          : __LF_extraerPotenciasCompania(tAll, compania);
        
        let p1, p2;
        if (potenciasCompania) {
          p1 = potenciasCompania.p1;
          p2 = potenciasCompania.p2;
          lfDbg('[DEBUG POTENCIAS] Usando patrones específicos de', compania);
        } else {
          // Fallback: patrones genéricos ULTRA-ROBUSTOS
          // Caso regulatoriamente válido: P1 contratada puede ser exactamente 0 kW
          // (p. ej. un segundo suministro dedicado a recarga de VE). Para las potencias
          // genéricas separamos deliberadamente dos clases de patrón:
          //   1) contexto amplio "Potencia ... P1 ... valor" -> SOLO texto estructurado;
          //   2) etiqueta pegada al valor ("P1: 3,45 kW") -> puede usar texto compacto.
          // Mezclarlas sobre tAll fabricaba asociaciones entre líneas distintas.
          const powerCompact = textCompact || textLines.replace(/\s+/g, ' ').trim();

          const p1CeroStructured = __LF_extraerNumero(textLines, [
            /potencia\s+contratada[^\n]{0,80}(?:p1|punta(?:[-\s]*llano)?)[^0-9]{0,30}(0(?:[.,]0+)?)\s*kw\b/i,
            /\bpotencia\b[^\n]{0,80}\b(?:p1|punta)\b[^0-9\n]{0,20}(0(?:[.,]0+)?)\s*kw\b/i
          ], 0, 0);
          const p1CeroCompact = __LF_extraerNumero(powerCompact, [
            /potencia\s+contratada\s*\(kw\)\s*(0(?:[.,]0+)?)\b/i,
            /\b(?:p1|punta|periodo\s*1)\b\s*[:-]?\s*(0(?:[.,]0+)?)\s*kw\b/i
          ], 0, 0);

          const p1Structured = __LF_extraerNumero(textLines, [
            /potencia\s*contratada[^\n]{0,80}\b(?:p1|punta)\b[^0-9\n]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /potencia\s*(?:facturada)?[^\n]{0,80}\b(?:p1|punta|periodo\s*1)\b[^0-9\n]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            // Formato inverso en LA MISMA línea: "Potencia 3,45 kW P1".
            /\bpotencia\b[^\n]{0,120}?(?:^|[^0-9.,])([0-9](?:[0-9.,]*[0-9])?)\s*kw\b[^\n]{0,60}\b(?:p1|punta|periodo\s*1)\b/im
          ], 0, 40, 'P1-ESTRUCTURADA');
          const p2Structured = __LF_extraerNumero(textLines, [
            /potencia\s*contratada[^\n]{0,80}\b(?:p2|valle)\b[^0-9\n]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /potencia\s*(?:facturada)?[^\n]{0,80}\b(?:p2|valle|periodo\s*2)\b[^0-9\n]{0,60}([0-9][0-9.,]*)\s*kw\b/i,
            /\bpotencia\b[^\n]{0,120}?(?:^|[^0-9.,])([0-9](?:[0-9.,]*[0-9])?)\s*kw\b[^\n]{0,60}\b(?:p2|valle|periodo\s*2)\b/im
          ], 0.1, 40, 'P2-ESTRUCTURADA');

          const p1Compact = __LF_extraerNumero(powerCompact, [
            /\b(?:p1|punta|periodo\s*1)[:\s]*([0-9][0-9.,]*)\s*kw\b/i,
            /\b(?:p1|punta)[:\s]+([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|kwh\b|€|eur\b|euros?\b|\/\s*kw\b))/i,
            /periodo\s*(?:1|punta)[^\d]{0,50}([0-9][0-9.,]*)\s*kw\b/i,
            /\bp1[^\d]{0,30}([0-9][0-9.,]*)\s*kw\b/i,
            /punta[^\d]{0,40}([0-9][0-9.,]*)\s*kw\b/i,
            /contratada[^\n]{0,80}p1[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|kwh\b|€|eur\b|euros?\b|\/\s*kw\b))/i
          ], 0, 40, 'P1-COMPACTA');
          const p2Compact = __LF_extraerNumero(powerCompact, [
            /\b(?:p2|valle|periodo\s*2)[:\s]*([0-9][0-9.,]*)\s*kw\b/i,
            /\b(?:p2|valle)[:\s]+([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|kwh\b|€|eur\b|euros?\b|\/\s*kw\b))/i,
            /periodo\s*(?:2|valle|llano)[^\d]{0,50}([0-9][0-9.,]*)\s*kw\b/i,
            /\bp2[^\d]{0,30}([0-9][0-9.,]*)\s*kw\b/i,
            /(?:valle|llano)[^\d]{0,40}([0-9][0-9.,]*)\s*kw\b/i,
            /contratada[^\n]{0,80}p2[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:[/.-]\s*\d|kwh\b|€|eur\b|euros?\b|\/\s*kw\b))/i
          ], 0.1, 40, 'P2-COMPACTA');

          if (p1CeroStructured === 0 || p1CeroCompact === 0) p1 = 0;
          else p1 = p1Structured ?? p1Compact;
          p2 = p2Structured ?? p2Compact;
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

        // "Potencias máximas demandadas" son medidas históricas del contador, NO
        // potencia contratada (la CNMC las modela incluso como campos distintos en el QR).
        // Si ningún extractor específico seguro resolvió el contrato, solo recuperamos P1/P2
        // desde una sección contractual acotada; de lo contrario dejamos null/null.
        if (!potenciasCompania && /potencias?\s+m[aá]ximas?\s+demandadas?/i.test(tAll)) {
          const contractPair = __LF_extractContractPowerPair(textLines)
            || __LF_extractContractPowerPair(tAll);
          if (contractPair) {
            p1 = contractPair.p1;
            p2 = contractPair.p2;
          } else {
            p1 = null;
            p2 = null;
          }
        }


        lfDbg('[DEBUG POTENCIAS] P1:', p1, '| P2:', p2);

        // --- Consumos (kWh) ---
        let octopusTriple = null;
        if (compania === 'octopus') {
          octopusTriple = __LF_extractConsumoOctopus(textLines) || __LF_extractConsumoOctopus(tAll);
        }
        let visaliaTriple = null;
        if (compania === 'visalia') {
          // Visalia pone lecturas brutas del contador en pág. 3 que confunden al parser genérico.
          // Usamos el extractor específico que lee "Término de energía P1/P2/P3 X kWh" de pág. 2.
          visaliaTriple = __LF_extractConsumoVisalia(textLines) || __LF_extractConsumoVisalia(tAll);
        }
        // El fallback compacto SE MANTIENE a proposito. Se propuso (15/08/2026) limitarlo a
        // fuentes que ya vinieran sin saltos de linea, para que compactar no "fabricase" una
        // tabla falsa a partir de precios unitarios. Medido contra el parser real: el
        // endurecimiento de __LF_extractTripleConsumo ya neutraliza ese caso por si solo
        // (devuelve null sobre "30 dias P1 0,15 EUR/kWh P2 ... P3 ..."), mientras que
        // desactivar el fallback SI rompia un formato legitimo y frecuente en PDF: etiquetas
        // y valores en lineas alternas ("Punta\n100\nLlano\n200\nValle\n300"), que pasaba de
        // 100/200/300 a no detectar nada. Ver AUDITORIA-IA.md.
        const structuredTriple = __LF_extractTripleConsumo(textLines);
        const compactTriple = structuredTriple ? null : __LF_extractTripleConsumo(textCompact);
        const triple = octopusTriple || visaliaTriple || structuredTriple || compactTriple;
        // Los fallbacks individuales deben trabajar sobre la misma vista saneada que el
        // extractor triple. Si no, una tabla que el triple descarta correctamente por ser
        // "Lectura en P1" o "Producción P1" vuelve a contaminar el resultado aquí.
        const consumptionAll = __LF_stripNonConsumptionEnergyQuantities(tAll);
        const consumoNegativoDetectado = __LF_hasNegativeBilledConsumption(tAll);

        let cPunta, cLlano, cValle;

        if (triple){
          lfDbg('[DEBUG CONSUMOS] Triple detectado:', triple);
          cPunta = triple.punta;
          cLlano = triple.llano;
          cValle = triple.valle;
        } else if (/\blecturas\s+(?:del\s+|de\s+la\s+)(?:contador|distribuidora)\b/i.test(tAll)) {
          // No degradar una tabla de lecturas acumuladas al fallback individual: ese
          // fallback volvería a convertir P1/P2/P3 del contador en consumo facturado.
          cPunta = null;
          cLlano = null;
          cValle = null;
        } else {
          // Fallback individual con patrones ULTRA-ROBUSTOS
          cPunta = __LF_extraerNumero(consumptionAll, [
            /\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p1|punta|periodo\s*1)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /\b(?:punta|p1)[:\s]+([0-9][0-9.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p1[^\d]{0,20}([0-9][0-9.,]*)/i,
            /(?:punta|p1)[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp1\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /punta[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p1[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i
          ], 0, 2000000, 'CONSUMO-P1');

          cLlano = __LF_extraerNumero(consumptionAll, [
            /\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p2|llano|periodo\s*2)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /\b(?:llano|p2)[:\s]+([0-9][0-9.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p2[^\d]{0,20}([0-9][0-9.,]*)/i,
            /(?:llano|p2)[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp2\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /llano[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p2[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i
          ], 0, 2000000, 'CONSUMO-P2');

          cValle = __LF_extraerNumero(consumptionAll, [
            /\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /energ[ií]a[^\n]{0,120}\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /consumo[^\n]{0,120}\b(?:p3|valle|periodo\s*3)\b[^0-9]{0,80}([0-9][0-9.,]*)\s*kwh\b/i,
            /\b(?:valle|p3)[:\s]+([0-9][0-9.,]*)\s*kwh/i,
            /consumo\s*kwh[^\n]{0,80}p3[^\d]{0,20}([0-9][0-9.,]*)/i,
            /(?:valle|p3)[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            // NUEVOS BRUTALES
            /\bp3\b[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /valle[^\d]{0,50}([0-9][0-9.,]+)\s*kwh/i,
            /activa[^\n]{0,100}p3[^\d]{0,40}([0-9](?:[0-9.,]*[0-9])?)(?![0-9.,])\b(?!\s*(?:€|eur\b|euros?\b|kw\b|\/\s*kwh\b))/i
          ], 0, 2000000, 'CONSUMO-P3');
          
          lfDbg('[DEBUG CONSUMOS] Fallback individual - P:', cPunta, 'L:', cLlano, 'V:', cValle);
        }

        if (consumoNegativoDetectado) {
          // Fail-closed: el motor y el formulario principal no aceptan consumo negativo.
          // No publicamos el valor absoluto que pudieron capturar regex legacy ni inventamos
          // una reinterpretación de una factura rectificativa.
          cPunta = null;
          cLlano = null;
          cValle = null;
        }

        // Total por si no hay desglose
        let cTotal = __LF_extraerNumero(tAll, [
          /\bconsumo\s*total\b[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\benerg[ií]a\s*total\b[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i,
          /\bconsumo\b[^0-9]{0,40}([0-9][0-9.,]*)\s*kwh\b/i
        ], 0, 3000000);
        if (consumoNegativoDetectado) cTotal = null;

        // Se conserva SOLO como dato informativo/auxiliar (consumoTotalDetectado en el objeto de
        // retorno), nunca como sustituto del reparto por periodos: publicar 0/total/0 como si
        // fuera el reparto real producia facturas con 100% de confianza y un reparto horario
        // inventado por el parser, no extraido de la factura.

        // Calcular confianza basada en campos detectados
        const campos = [dias, p1, p2, cPunta, cLlano, cValle];
        const detectados = campos.filter(v => v != null && Number.isFinite(v)).length;
        let confianza = Math.round((detectados / 6) * 100);
        
        // NUEVO: Ajustar confianza si usamos fallbacks genéricos (menos confiable)
        if (compania === 'endesa' && triple === null
          && (cPunta != null || cLlano != null || cValle != null)) {
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
          // Informativo, NUNCA se usa como sustituto de consumoPunta/Llano/Valle en el calculo:
          // ver comentario junto a cTotal mas arriba.
          consumoTotalDetectado: cTotal,
          consumoNegativoDetectado,
          confianza: confianza,
          _fechaInicio: fIni,
          _fechaFin: fFin
        };
      }


  window.__LF_FacturaParsers = {
    __LF_normNum,
    __LF_qrAnnualPowerPriceToDaily,
    __LF_qrCustomTarifaAvailability,
    __LF_qrInfoToCustomTarifaPrices,
    __LF_daysInclusive,
    __LF_extraerNumero,
    __LF_extractPotenciasEndesa,
    __LF_extractConsumoEndesa,
    __LF_extractTripleConsumo,
    __LF_extractConsumoOctopus,
    __LF_extractConsumoVisalia,
    __LF_hasNegativeBilledConsumption,
    __LF_detectarCompania,
    __LF_extraerDiasCompania,
    __LF_extraerPotenciasCompania,
    __LF_extractQRUrl,
    __LF_isTrustedCnmcQrUrl,
    __LF_isCnmcCommercializerCode,
    __LF_parseQRData,
    __LF_parsearDatos
  };
})();
