/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

    (function(){
      if (window.__LF_facturaParserLoaded) return;

      if (!window.__LF_FacturaParsers) {
        // factura-parsers.js se carga antes que este fichero. Si una descarga
        // puntual falla, no lanzar una excepcion que rompa la inicializacion de
        // la home: dejamos el boton con un aviso accionable y permitimos que un
        // reintento futuro vuelva a ejecutar este modulo.
        window.__LF_facturaModuleReady = false;
        window.__LF_bindFacturaParser = function() {
          const btn = document.getElementById('btnSubirFactura');
          if (!btn || btn.dataset.lfFacturaUnavailableBound === '1') return;
          btn.dataset.lfFacturaUnavailableBound = '1';
          btn.addEventListener('click', function() {
            const msg = 'La lectura de facturas no terminó de cargarse. Recarga la página para volver a intentarlo.';
            if (window.LF && typeof window.LF.toast === 'function') window.LF.toast(msg, 'err');
            else if (typeof window.toast === 'function') window.toast(msg, 'err');
          });
        };
        try {
          if (typeof window.__LF_trackDetail === 'function') {
            window.__LF_trackDetail('init-incompleto', ['home', 'factura-parsers'], {
              title: 'Extractor de factura sin factura-parsers'
            });
          }
        } catch (_) {}
        return;
      }
      window.__LF_facturaParserLoaded = true;
      const {
        __LF_normNum,
        __LF_extractQRUrl,
        __LF_parseQRData,
        __LF_parsearDatos
      } = window.__LF_FacturaParsers;

      // Helper de debug: solo loguea si __LF_DEBUG está activo
      // y no estamos en flujo sensible de factura.
      const lfDbg = (...args) => {
        if (window.__LF_DEBUG && !window.__LF_PRIVACY_MODE && !window.__LF_FACTURA_BUSY) console.log(...args);
      };

      // Raíz del sitio calculada a partir de la URL del propio script.
      // Esto evita problemas con GitHub Pages cuando hay subpath (p.ej. /repo/).
      const __LF_SITE_ROOT = (() => {
        try {
          const cur = document.currentScript && document.currentScript.src;
          return cur ? new URL('..', cur) : new URL('./', document.baseURI);
        } catch (_) {
          return new URL('./', document.baseURI);
        }
      })();
      const __LF_assetUrl = (rel) => new URL(rel, __LF_SITE_ROOT).toString();
      const __LF_BUILD_VER = (() => {
        try {
          if (typeof window.__LF_BUILD_ID === 'string' && window.__LF_BUILD_ID.trim())
            return window.__LF_BUILD_ID.trim();
          const cur = document.currentScript && document.currentScript.src;
          if (cur) return new URL(cur, location.href).searchParams.get('v') || '';
        } catch (_) {}
        return '';
      })();
      const __LF_versionedUrl = (rel) => {
        const url = __LF_assetUrl(rel);
        return __LF_BUILD_VER ? url + '?v=' + encodeURIComponent(__LF_BUILD_VER) : url;
      };

      window.__LF_restoreFocusEl = null;
      window.__LF_focusTrapCleanup = null;
      window.__LF_scrollY = 0;
      let __LF_lastParsedConfianza = 0;
      let __LF_modalHideTimer = null;
      let __LF_lastFile = null;

      let __LF_pdfjsLoading = null;
      if (typeof window.__LF_FACTURA_BUSY !== 'boolean') window.__LF_FACTURA_BUSY = false;
      let __LF_operationSeq = 0;
      let __LF_activeOperation = 0;
      const __LF_pendingOperations = new Set();
      const __LF_OPERATION_CANCELLED = 'LF_FACTURA_OPERATION_CANCELLED';
      const __LF_MAX_PDF_SIZE_MB = 20;
      const __LF_MAX_PDF_SIZE_BYTES = __LF_MAX_PDF_SIZE_MB * 1024 * 1024;
      const __LF_MAX_PDF_TEXT_PAGES = 20;

      function __LF_beginOperation(){
        if (window.__LF_FACTURA_BUSY || __LF_activeOperation !== 0) return null;
        const operationId = ++__LF_operationSeq;
        __LF_activeOperation = operationId;
        __LF_pendingOperations.add(operationId);
        window.__LF_FACTURA_BUSY = true;
        return operationId;
      }

      function __LF_isCurrentOperation(operationId){
        return operationId !== null && __LF_activeOperation === operationId;
      }

      function __LF_assertCurrentOperation(operationId){
        if (__LF_isCurrentOperation(operationId)) return;
        const error = new Error('Operacion de factura cancelada');
        error.code = __LF_OPERATION_CANCELLED;
        throw error;
      }

      function __LF_isCancelledOperation(error){
        return error?.code === __LF_OPERATION_CANCELLED;
      }

      function __LF_finishOperation(operationId){
        __LF_pendingOperations.delete(operationId);
        if (__LF_isCurrentOperation(operationId)) {
          __LF_activeOperation = 0;
          window.__LF_FACTURA_BUSY = false;
        }
        __LF_syncPrivacyMode();
      }

      function __LF_invalidateOperation(){
        __LF_activeOperation = 0;
        __LF_operationSeq++;
      }

      function __LF_syncPrivacyMode(){
        const modalOpen = __LF_q('modalFactura')?.classList.contains('show') === true;
        window.__LF_PRIVACY_MODE = modalOpen || __LF_pendingOperations.size > 0;
      }

      function __LF_formatSizeMb(bytes){
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.ceil(n / 1024 / 1024);
      }

      function __LF_pdfVerbosityErrors(){
        try{
          const lib = window.pdfjsLib;
          return (lib && lib.VerbosityLevel) ? lib.VerbosityLevel.ERRORS : 0;
        } catch(_){
          return 0;
        }
      }

      function __LF_ensurePdfWorker(){
        const lib = window.pdfjsLib;
        if (!lib) return false;
        if (!lib.GlobalWorkerOptions.workerSrc) {
          lib.GlobalWorkerOptions.workerSrc = __LF_versionedUrl("vendor/pdfjs/pdf.worker.min.mjs");
        }
        return true;
      }

      async function __LF_ensurePdfJs(){
        if (window.pdfjsLib && __LF_ensurePdfWorker()) return window.pdfjsLib;

        if (__LF_pdfjsLoading){
          try { await __LF_pdfjsLoading; }
          finally { __LF_pdfjsLoading = null; }
          if (window.pdfjsLib && __LF_ensurePdfWorker()) return window.pdfjsLib;
        }

        const src = __LF_versionedUrl("vendor/pdfjs/pdf.min.mjs");
        __LF_pdfjsLoading = (async()=>{
          const mod = await import(src);
          const lib = (mod && (mod.pdfjsLib || mod.default)) ? (mod.pdfjsLib || mod.default) : mod;
          window.pdfjsLib = lib;

          // Reducir ruido: solo errores (sin warnings TT/TrueType, etc.)
          try{
            if (lib && lib.setVerbosityLevel && lib.VerbosityLevel){
              lib.setVerbosityLevel(lib.VerbosityLevel.ERRORS);
            }
          } catch(_){}
          try{
            if (lib && lib.GlobalWorkerOptions && lib.VerbosityLevel){
              lib.GlobalWorkerOptions.verbosity = lib.VerbosityLevel.ERRORS;
            }
          } catch(_){}

          __LF_ensurePdfWorker();
          return lib;
        })();

        try { await __LF_pdfjsLoading; }
        finally { __LF_pdfjsLoading = null; }

        if (!window.pdfjsLib || !__LF_ensurePdfWorker()){
          throw new Error("PDF.js no disponible");
        }
        return window.pdfjsLib;
      }


      async function __LF_extraerTextoPDF(file){
        await __LF_ensurePdfJs();
        const ab = await file.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: ab, verbosity: __LF_pdfVerbosityErrors() });
        let pdf;

        try{
          pdf = await loadingTask.promise;
          let lines = [];
          let compact = '';
          const qrHintPages = [];
          const qrHintRe = /\bqr\b|comparador|cnmc|qre\?/i;
          const pagesTotal = Number.isFinite(pdf.numPages) ? pdf.numPages : 0;
          const pagesScanned = Math.min(pagesTotal, __LF_MAX_PDF_TEXT_PAGES);

          for (let p=1; p<=pagesScanned; p++){
            const page = await pdf.getPage(p);
            let items = [];
            try{
              const tc = await page.getTextContent();
              items = (tc.items || []).map(it => ({
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
            } finally {
              try{ if (page && page.cleanup) await page.cleanup(); }catch(_){}
            }

            // Extraer URLs de anotaciones (links embebidos en el PDF)
            try {
              const annots = await page.getAnnotations();
              for (const a of annots) {
                if (a.url) {
                  items.push({ str: a.url, x: 0, y: 0 });
                  lines.push(a.url);
                }
              }
            } catch(_){}

            const pageCompact = items.map(i=>i.str).join(' ');
            compact += pageCompact + '\n';
            if (qrHintRe.test(pageCompact)) qrHintPages.push(p);
          }

          const textLines = lines.join('\n');
          const textCompact = compact.replace(/\s+/g,' ').trim();
          return { textLines, textCompact, textRawLen: (textCompact || '').length, qrHintPages, pagesTotal, pagesScanned };
        } finally {
          try{ if (pdf && pdf.cleanup) await pdf.cleanup(); }catch(_){}
          // pdf.js 6.x elimina PDFDocumentProxy.destroy(); liberar via loadingTask
          try{ if (loadingTask && loadingTask.destroy) await loadingTask.destroy(); }catch(_){}
        }
      }

      async function __LF_loadJsQR() {
        if (window.jsQR) return window.jsQR;
        
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          // Self-host: /vendor/jsqr/jsQR.js
          script.src = __LF_versionedUrl('vendor/jsqr/jsQR.js');
          script.onload = () => resolve(window.jsQR);
          script.onerror = () => reject(new Error('jsQR no disponible'));
          document.head.appendChild(script);
        });
      }

      /**
       * Extrae QR code de PDF usando jsQR
       * Versión original multi-escala + qrHintPages para ordenar páginas candidatas
       */
      async function __LF_extractQRFromPDF(pdfFile, options = {}) {
        let loadingTask = null;
        try {
          lfDbg('[QR jsQR] Escaneando PDF...');

          const jsQR = await __LF_loadJsQR();
          const pdfjsLib = await __LF_ensurePdfJs();

          const arrayBuffer = await pdfFile.arrayBuffer();
          loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, verbosity: __LF_pdfVerbosityErrors() });
          const pdf = await loadingTask.promise;

          // Intentar con múltiples escalas para mejor detección
          const scales = [3.0, 2.5, 2.0, 1.5];
          const maxPages = Math.min(pdf.numPages, 3);

          // Usar qrHintPages para priorizar páginas candidatas
          const hinted = Array.isArray(options.qrHintPages) ? options.qrHintPages : [];
          const hintedInRange = [...new Set(hinted.filter(n => Number.isInteger(n) && n >= 1 && n <= maxPages))];
          const pageOrder = [
            ...hintedInRange,
            ...Array.from({ length: maxPages }, (_, i) => i + 1).filter(n => !hintedInRange.includes(n))
          ];

          for (const pageNum of pageOrder) {
            lfDbg(`[QR jsQR] Página ${pageNum}/${maxPages}...`);
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
                lfDbg(`[QR jsQR] Código detectado (escala ${scale}) [contenido oculto]`);
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
        } finally {
          try{ if (loadingTask && loadingTask.destroy) await loadingTask.destroy(); }catch(_){}
        }
      }
      
      /**
       * Extrae URL QR del texto del PDF
       */
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
          avisos.push(`ℹ️ Consumo total muy alto: ${totalConsumo} kWh. Verifica que los valores sean correctos.`);
        }

        // Verificar confianza
        if (datos.confianza < 50){
          avisos.push(`⚠️ Confianza baja (${datos.confianza}%). Revisa cuidadosamente todos los campos antes de aplicar. Si es un PDF escaneado, prueba a leerlo con OCR.`);
          __LF_show(__LF_q('btnOcrFactura'));
          __LF_show(__LF_q('ctaOcrFactura'));
        } else if (datos.confianza < 80){
          avisos.push(`ℹ️ Confianza media (${datos.confianza}%). Revisa los campos marcados con ⚠️ antes de aplicar.`);
        }

        // Mostrar avisos concatenados
        if (avisos.length > 0){
          __LF_warn(avisos.join('\n\n'));
        }
      }

      function __LF_q(id){ return document.getElementById(id); }
      function __LF_show(el){ if(el){ el.classList?.remove('is-hidden'); el.style.display = ''; } }
      function __LF_hide(el){ if(el){ el.style.display = 'none'; el.classList?.add('is-hidden'); } }

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
            'atulado': 'Atulado Energía',
            'octopus': 'Octopus Energy',
            'visalia': 'Visalia',
            'plenitude': 'Eni Plenitude',
            'energiaxxi': 'Energía XXI',
            'disa': 'DISA Energía'
          };
          nombreEl.textContent = nombres[datos.compania] || datos.compania;
          __LF_show(companiaEl);
        } else if (companiaEl) {
          __LF_hide(companiaEl);
        }

        // Mostrar badge de fuente de datos
        const fuenteBadge = __LF_q('fuenteDatosBadge');
        if (fuenteBadge) {
          const fuente = datos.fuenteDatos;
          if (!fuente) {
            fuenteBadge.style.display = 'none';
            fuenteBadge.textContent = '';
          } else {
            const fuenteMap = {
              'QR+PDF':       { texto: 'QR + Parser',        bg: '#059669', color: '#fff' },
              'LINK_CNMC+PDF':{ texto: 'Link CNMC + Parser', bg: '#059669', color: '#fff' },
              'PDF':          { texto: 'Parser PDF',          bg: '#3b82f6', color: '#fff' },
              'OCR':          { texto: 'OCR',                 bg: '#f59e0b', color: '#000' }
            };
            const info = fuenteMap[fuente] || fuenteMap['PDF'];
            fuenteBadge.textContent = info.texto;
            fuenteBadge.style.background = info.bg;
            fuenteBadge.style.color = info.color;
            fuenteBadge.style.display = 'inline-block';
          }
        }
      }

      function __LF_escapeWarnHtml(text){
        return String(text ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function __LF_warnHtml(msg){
        const markerOpen = '__LF_B_OPEN__';
        const markerClose = '__LF_B_CLOSE__';
        return __LF_escapeWarnHtml(
          String(msg ?? '')
            .replace(/<\s*b\s*>/gi, markerOpen)
            .replace(/<\s*\/\s*b\s*>/gi, markerClose)
        )
          .replace(new RegExp(markerOpen, 'g'), '<b>')
          .replace(new RegExp(markerClose, 'g'), '</b>')
          .replace(/\n/g, '<br>');
      }

      function __LF_warn(msg){
        const a = __LF_q('avisoFactura');
        if (!a) return;
        const html = __LF_warnHtml(msg);
        a.innerHTML = html;
        __LF_show(a);
      }

      function __LF_appendWarn(msg){
        const a = __LF_q('avisoFactura');
        if (!a) return;
        const html = __LF_warnHtml(msg);
        if (a.innerHTML.trim()) {
          a.innerHTML += '<br><br>' + html;
        } else {
          a.innerHTML = html;
        }
        __LF_show(a);
      }

      function __LF_pdfPageLimitWarning(meta){
        const total = Number(meta?.pagesTotal);
        const scanned = Number(meta?.pagesScanned);
        if (!Number.isFinite(total) || !Number.isFinite(scanned) || total <= scanned) return '';
        return `⚠️ El PDF tiene ${total} páginas. Para evitar bloqueos se han analizado solo las primeras ${scanned}. Si faltan datos, sube el PDF de factura sin anexos o introduce los datos manualmente.`;
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
        // 🔒 ACTIVAR MODO PRIVACIDAD (bloquea todo tracking)
        window.__LF_PRIVACY_MODE = true;
        
        const modal = __LF_q('modalFactura');
        if (!modal) return;

        window.__LF_restoreFocusEl = document.activeElement;

        if (__LF_modalHideTimer) {
          clearTimeout(__LF_modalHideTimer);
          __LF_modalHideTimer = null;
        }
        modal.removeAttribute('hidden');
        modal.removeAttribute('inert');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden','false');
        __LF_lockScroll();

        __LF_show(__LF_q('uploadAreaFactura'));
        __LF_hide(__LF_q('loaderFactura'));
        __LF_hide(__LF_q('resultadoFactura'));
        __LF_hide(__LF_q('btnOcrFactura'));
        __LF_hide(__LF_q('ctaOcrFactura'));

        const aviso = __LF_q('avisoFactura'); if(aviso){ aviso.innerHTML=''; __LF_hide(aviso); }
        const fi = __LF_q('fileInputFactura'); if(fi) fi.value = '';
        __LF_lastFile = null;
        __LF_lastParsedConfianza = 0;

        __LF_focusTrapAttach(modal);
        setTimeout(()=>{ (__LF_q('uploadAreaFactura') || modal).focus?.(); }, 0);
      }

      function __LF_closeModal(){
        // Invalidar primero evita que una promesa anterior vuelva a escribir en el modal.
        __LF_invalidateOperation();

        try {
          // ✅ PRIVACIDAD: soltar referencias a la factura al cerrar
          // (evita que quede accesible desde JS después de cerrar el modal)
          try{
            const fi = __LF_q('fileInputFactura');
            if (fi) fi.value = '';
          } catch(_){/* noop */}
          __LF_lastFile = null;
          __LF_lastParsedConfianza = 0;

          // ✅ PRIVACIDAD: limpiar datos extraídos que hayan quedado en el DOM
          // (si se ejecutase JS después, no tendría “material” fácil que leer)
          try{
            const ids = [
              'val_dias','val_p1','val_p2',
              'val_consumoPunta','val_consumoLlano','val_consumoValle'
            ];
            for (const id of ids){
              const el = __LF_q(id);
              if (el) el.value = '';
            }
            const badge = __LF_q('confianzaBadge');
            if (badge){
              badge.classList.remove('alta','media','baja');
              badge.textContent = '--';
            }
            const fuenteBadge = __LF_q('fuenteDatosBadge');
            if (fuenteBadge){ fuenteBadge.style.display = 'none'; fuenteBadge.textContent = ''; }
            const form = __LF_q('formValidacionFactura');
            if (form) form.innerHTML = '';
            const companiaEl = __LF_q('companiaDetectada');
            if (companiaEl) __LF_hide(companiaEl);
            const nombreEl = __LF_q('nombreCompania');
            if (nombreEl) nombreEl.textContent = '';
            const aviso = __LF_q('avisoFactura');
            if (aviso){ aviso.innerHTML=''; __LF_hide(aviso); }
          } catch(_){/* noop */}

          const modal = __LF_q('modalFactura');
          if (!modal) return;

          modal.classList.remove('show');
          modal.setAttribute('aria-hidden','true');
          modal.setAttribute('inert', '');
          __LF_unlockScroll();

          __LF_focusTrapDetach();
          const prev = window.__LF_restoreFocusEl;
          if (prev && prev.focus) prev.focus();
          window.__LF_restoreFocusEl = null;

          if (__LF_modalHideTimer) clearTimeout(__LF_modalHideTimer);
          __LF_modalHideTimer = setTimeout(() => {
            modal.setAttribute('hidden', '');
          }, 200);
        } finally {
          // Reactivar tracking solo cuando referencias y DOM sensible ya estan limpios.
          window.__LF_FACTURA_BUSY = false;
          __LF_syncPrivacyMode();
        }
      }

      async function __LF_processPdf(file){
        // PRIVACIDAD: liberar el selector incluso si el fichero se rechaza en la validación.
        try{
          const fi = __LF_q('fileInputFactura');
          if (fi) fi.value = '';
        }catch(_){/* noop */}
        if (!file || file.type !== 'application/pdf'){
          if (typeof toast === 'function') toast('Sube un PDF válido', 'err');
          return;
        }
        if (file.size > __LF_MAX_PDF_SIZE_BYTES) {
          const sizeMB = __LF_formatSizeMb(file.size);
          if (typeof toast === 'function') toast(`El PDF es demasiado grande (${sizeMB} MB). Máximo ${__LF_MAX_PDF_SIZE_MB} MB.`, 'err');
          return;
        }
        const operationId = __LF_beginOperation();
        if (operationId === null) {
          if (typeof toast === 'function') toast('Ya hay una factura procesándose', 'err');
          return;
        }
        __LF_lastFile = file;

// PRIMERO: Ocultar área de subida y sección de resultados
        __LF_hide(__LF_q('uploadAreaFactura'));
        __LF_hide(__LF_q('resultadoFactura'));
        __LF_hide(__LF_q('btnOcrFactura'));
        __LF_hide(__LF_q('ctaOcrFactura'));
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
          const { textLines, textCompact, textRawLen, qrHintPages, pagesTotal, pagesScanned } = await __LF_extraerTextoPDF(file);
          __LF_assertCurrentOperation(operationId);
          const pdfPageWarning = __LF_pdfPageLimitWarning({ pagesTotal, pagesScanned });

          // NO mostrar resultados todavía, el QR puede tardar 2-3 segundos más

          if (!textRawLen || textRawLen < 40){
            __LF_hide(__LF_q('loaderFactura'));
            __LF_show(__LF_q('resultadoFactura'));
            __LF_warn('⚠️ No se ha detectado texto seleccionable. Parece un PDF escaneado: puedes leerlo con OCR o introducir los datos manualmente.');
            if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);
            __LF_show(__LF_q('btnOcrFactura'));
            __LF_show(__LF_q('ctaOcrFactura'));
            __LF_setBadge(0);
            __LF_renderForm({ p1:null,p2:null,dias:null,consumoPunta:null,consumoLlano:null,consumoValle:null,confianza:0,fuenteDatos:null });
            return;
          }

          // ====================================================================
          // PASO 1: Intentar QR desde TEXTO
          // ====================================================================
          const tAll = (textLines + '\n' + textCompact).replace(/[\u00A0\t]/g,' ').replace(/\s+/g,' ').trim();
          const qrUrlTexto = __LF_extractQRUrl(tAll);
          
          let datosQR = null;
          let qrOrigen = null; // 'LINK_CNMC+PDF' o 'QR+PDF'
          if (qrUrlTexto) {
            datosQR = __LF_parseQRData(qrUrlTexto);
            if (datosQR) qrOrigen = 'LINK_CNMC+PDF';
          }

          // ====================================================================
          // PASO 2: Intentar QR con jsQR (escaneo de imagen)
          // ====================================================================
          if (!datosQR) {
            lfDbg('[QR] Texto no tiene URL, intentando jsQR...');
            try {
              const qrUrlImagen = await __LF_extractQRFromPDF(file, { qrHintPages });
              __LF_assertCurrentOperation(operationId);
              if (qrUrlImagen) {
                datosQR = __LF_parseQRData(qrUrlImagen);
                if (datosQR) qrOrigen = 'QR+PDF';
              }
            } catch (jsqrError) {
              if (__LF_isCancelledOperation(jsqrError)) throw jsqrError;
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
              fuenteDatos: qrOrigen || 'QR+PDF',
              compania: datosPDF.compania
            };
            
            lfDbg('[QR] ✅ Datos combinados:', datosCombinados);
            
            // AHORA SÍ: mostrar resultados con los datos completos
            __LF_hide(__LF_q('loaderFactura'));
            __LF_show(__LF_q('resultadoFactura'));
            
            __LF_setBadge(100);
            __LF_renderForm(datosCombinados);
            if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);
            return;
          }

          // ====================================================================
          // PASO 4: FALLBACK - Parseo PDF completo (sin QR)
          // ====================================================================
          lfDbg('[QR] QR no encontrado - usando parseo PDF');
          const datos = __LF_parsearDatos(textLines, textCompact);
          datos.fuenteDatos = 'PDF';

          // AHORA SÍ: mostrar resultados con los datos completos
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));

          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Mostrar advertencias contextuales
          __LF_showContextualWarnings(datos);
          if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);

        }catch(err){
          if (!__LF_isCurrentOperation(operationId) || __LF_isCancelledOperation(err)) return;
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('uploadAreaFactura'));
          if (typeof toast === 'function') toast('Error al procesar factura PDF', 'err');
          lfDbg('[ERROR] processPdf:', err);
        } finally {
          __LF_finishOperation(operationId);
        }
      }


      async function __LF_loadTesseract(){
        try{
          const mod = await import(__LF_assetUrl('vendor/tesseract/tesseract.esm.min.js'));
          return mod.default || mod;
        }catch(e){
          if (window.Tesseract) return window.Tesseract;
          await new Promise((ok,ko)=>{
            const s = document.createElement('script');
            s.src = __LF_assetUrl('vendor/tesseract/tesseract.min.js');
            s.onload = ok; s.onerror = ko;
            document.head.appendChild(s);
          });
          return window.Tesseract;
        }
      }

      async function __LF_runOcrOnLastFile(){
        const file = __LF_lastFile;
        if (!file){
          if (typeof toast === 'function') toast('Primero sube/arrastra un PDF', 'err');
          return;
        }

        const operationId = __LF_beginOperation();
        if (operationId === null) {
          if (typeof toast === 'function') toast('Ya hay una factura procesándose', 'err');
          return;
        }

        try{
          try{
            await __LF_ensurePdfJs();
            __LF_assertCurrentOperation(operationId);
          }catch(error){
            if (__LF_isCancelledOperation(error)) throw error;
            if (typeof toast === 'function') toast('PDF.js no disponible', 'err');
            return;
          }

          __LF_hide(__LF_q('uploadAreaFactura'));
          __LF_hide(__LF_q('ctaOcrFactura'));
          __LF_show(__LF_q('loaderFactura'));
          __LF_hide(__LF_q('resultadoFactura'));

          const T = await __LF_loadTesseract();
          __LF_assertCurrentOperation(operationId);

          const ab = await file.arrayBuffer();
          __LF_assertCurrentOperation(operationId);
          let pdf = null;
          let ocrLoadingTask = null;
          try{
            ocrLoadingTask = window.pdfjsLib.getDocument({ data: ab, verbosity: __LF_pdfVerbosityErrors() });
            pdf = await ocrLoadingTask.promise;
            __LF_assertCurrentOperation(operationId);

            let ocrText = '';
          const pagesToScan = Math.min(pdf.numPages, 2);

          for (let p=1; p<=pagesToScan; p++){
            const page = await pdf.getPage(p);
            __LF_assertCurrentOperation(operationId);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently:true });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
            __LF_assertCurrentOperation(operationId);

            const __LF_tessOpts = {
              workerPath: __LF_assetUrl('vendor/tesseract/worker.min.js'),
              corePath: __LF_assetUrl('vendor/tesseract-core/tesseract-core.wasm.js'),
              langPath: __LF_assetUrl('vendor/tessdata/'),
            };
            const { data } = await T.recognize(canvas, 'spa', __LF_tessOpts);
            __LF_assertCurrentOperation(operationId);
            ocrText += (data.text || '') + '\n';

            // Limpieza best-effort para reducir retención de datos en memoria
            try{ if (page && page.cleanup) await page.cleanup(); }catch(_){}
            try{ canvas.width = 0; canvas.height = 0; canvas.remove?.(); }catch(_){}
          }

          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));

          const compact = ocrText.replace(/\s+/g,' ').trim();
          const lines = ocrText.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');

          const datos = __LF_parsearDatos(lines, compact);
          datos.fuenteDatos = 'OCR';
          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Mostrar advertencias contextuales + nota de OCR
          __LF_showContextualWarnings(datos);
          
          const avisoOCR = __LF_q('avisoFactura');
          if (avisoOCR && avisoOCR.textContent){
            avisoOCR.textContent = '🧠 OCR aplicado. ' + avisoOCR.textContent;
          } else {
            __LF_warn('🧠 OCR aplicado. Revisa con cuidado antes de aplicar.');
          }


          } finally {
            try{ if (pdf && pdf.cleanup) await pdf.cleanup(); }catch(_){/* noop */}
            // pdf.js 6.x elimina PDFDocumentProxy.destroy(); liberar via loadingTask
            try{ if (ocrLoadingTask && ocrLoadingTask.destroy) await ocrLoadingTask.destroy(); }catch(_){/* noop */}
          }
        }catch(err){
          if (!__LF_isCurrentOperation(operationId) || __LF_isCancelledOperation(err)) return;
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));
          __LF_show(__LF_q('ctaOcrFactura'));
          if (typeof toast === 'function') toast('OCR falló o no pudo ejecutarse', 'err');
          lfDbg('[ERROR]', err);
        } finally {
          __LF_finishOperation(operationId);
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

        const cfg = window.LF_CONFIG;
        const minKw = (cfg?.POTENCIA_MIN_KW != null) ? cfg.POTENCIA_MIN_KW : 0.5;
        const maxKw = (cfg?.POTENCIA_MAX_KW != null) ? cfg.POTENCIA_MAX_KW : 20;
        if (v.p1 == null || v.p1 < minKw || v.p1 > maxKw){ ok=false; __LF_markErr('p1', true); } else __LF_markErr('p1', false);
        if (v.p2 == null || v.p2 < minKw || v.p2 > maxKw){ ok=false; __LF_markErr('p2', true); } else __LF_markErr('p2', false);

        if (v.dias == null || v.dias < 1 || v.dias > 366){ ok=false; __LF_markErr('dias', true); } else __LF_markErr('dias', false);

        if (v.consumoPunta == null || v.consumoPunta < 0 || v.consumoPunta > 200000){ ok=false; __LF_markErr('consumoPunta', true); } else __LF_markErr('consumoPunta', false);
        if (v.consumoLlano == null || v.consumoLlano < 0 || v.consumoLlano > 200000){ ok=false; __LF_markErr('consumoLlano', true); } else __LF_markErr('consumoLlano', false);
        if (v.consumoValle == null || v.consumoValle < 0 || v.consumoValle > 200000){ ok=false; __LF_markErr('consumoValle', true); } else __LF_markErr('consumoValle', false);

        if (!ok){
          if (typeof toast === 'function') toast('Revisa los campos marcados en rojo antes de aplicar', 'err');
          return;
        }

        // Limpiar datos de CSV solo cuando la factura es válida
        if (window.LF) {
          if (typeof window.LF.clearCsvImportState === 'function') {
            window.LF.clearCsvImportState();
          } else {
            window.LF.consumosHorarios = null;
            window.LF.csvConsumosRef = null;
            window.LF.pvpcPeriodoCSV = false;
          }
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

        // ✅ PRIVACIDAD: una vez aplicados los datos, ya no necesitamos retener el PDF
        __LF_lastFile = null;

        if (window.LF.cancelRender) window.LF.cancelRender();

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
        __LF_q('btnOcrFacturaCta')?.addEventListener('click', __LF_runOcrOnLastFile);
      };


      // API mínima para carga diferida desde app.js
      window.__LF_openFacturaModal = __LF_openModal;
      window.__LF_facturaModuleReady = true;
    })();
