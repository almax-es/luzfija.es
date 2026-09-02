/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

    (function(){
      function __LF_installPromiseWithResolversShim(){
        if (typeof Promise.withResolvers === 'function') return;

        Object.defineProperty(Promise, 'withResolvers', {
          configurable: true,
          enumerable: false,
          writable: true,
          value: function withResolvers() {
            let resolve;
            let reject;
            const promise = new this((resolvePromise, rejectPromise) => {
              resolve = resolvePromise;
              reject = rejectPromise;
            });
            return { promise, resolve, reject };
          }
        });
      }

      function __LF_installMapGetOrInsertComputedShim(){
        if (typeof Map.prototype.getOrInsertComputed === 'function') return;

        const mapHas = Map.prototype.has;
        const mapGet = Map.prototype.get;
        const mapSet = Map.prototype.set;
        const brandCheckKey = Symbol('lf-map-brand-check');

        Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
          configurable: true,
          enumerable: false,
          writable: true,
          value: function getOrInsertComputed(key, callback) {
            // Ejecutar primero el mismo brand check que el metodo nativo.
            mapHas.call(this, brandCheckKey);
            if (typeof callback !== 'function') {
              throw new TypeError('callback must be callable');
            }

            const canonicalKey = key === 0 ? 0 : key;
            if (mapHas.call(this, canonicalKey)) return mapGet.call(this, canonicalKey);

            const value = Reflect.apply(callback, undefined, [canonicalKey]);
            // El callback puede haber insertado la clave: el resultado calculado
            // prevalece, conservando la posicion existente de la entrada.
            mapSet.call(this, canonicalKey, value);
            return value;
          }
        });
      }

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
        __LF_qrAnnualPowerPriceToDaily,
        __LF_qrCustomTarifaAvailability,
        __LF_extractQRUrl,
        __LF_isTrustedCnmcQrUrl,
        __LF_isCnmcCommercializerCode,
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
      let __LF_cnmcRegistryPromise = null;
      // Deadline del censo CNMC. Ver __LF_resolveCnmcCommercializer(): el censo se espera
      // con await dentro del flujo del QR, asi que sin el la factura entera puede quedarse
      // colgada. 5 s da margen a un movil en frio sin bloquear al usuario.
      const CNMC_REGISTRY_TIMEOUT_MS = 5000;

      function __LF_safeRegistryText(value, maxLength) {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > maxLength) return null;
        for (const char of text) {
          const code = char.charCodeAt(0);
          if (code <= 31 || code === 127) return null;
        }
        return text;
      }

      function __LF_safeRegistryWebsite(value) {
        try {
          const url = new URL(String(value || ''));
          return /^https?:$/.test(url.protocol) ? url.toString() : null;
        } catch (_) {
          return null;
        }
      }

      async function __LF_resolveCnmcCommercializer(code) {
        const normalizedCode = String(code ?? '').trim().toUpperCase();
        if (!__LF_isCnmcCommercializerCode(normalizedCode) || typeof window.fetch !== 'function') return null;

        if (!__LF_cnmcRegistryPromise) {
          // El censo se espera con `await` antes de seguir procesando la factura (mas
          // abajo, en el flujo del QR): un fetch que no resuelve NUNCA no deja solo la
          // ficha sin nombre de comercializadora, deja colgado el extractor entero. El
          // `.catch()` de abajo solo cubre el RECHAZO, asi que hace falta un deadline.
          // No se usa csvUtils.fetchJsonWithTimeout a proposito: cargar el censo no
          // justifica acoplar factura.js al modulo de CSV, y `window.fetch` es ademas el
          // punto que interceptan los tests de integracion.
          // 5 s, no 1,5 s como la telemetria: un movil con arranque en frio necesita mas
          // margen, y aqui el coste de rendirse pronto es perder el nombre de la
          // comercializadora en una factura que si se habria podido resolver.
          // Sin AbortController no hay forma de poner deadline. El nombre de la
          // comercializadora es OPCIONAL, asi que se prefiere renunciar a el antes que
          // lanzar un fetch que podria colgar el extractor entero en ese navegador.
          if (typeof AbortController !== 'function') return null;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), CNMC_REGISTRY_TIMEOUT_MS);
          const intento = window.fetch(
            __LF_versionedUrl('data/cnmc-commercializers.json'),
            {
              cache: 'force-cache',
              credentials: 'same-origin',
              signal: controller.signal
            }
          ).then(async response => {
            if (!response.ok) throw new Error(`Censo CNMC no disponible (${response.status})`);
            // El temporizador sigue vivo hasta que el cuerpo termina de leerse: `fetch`
            // resuelve con las cabeceras y un `response.json()` atascado dejaria el
            // mismo cuelgue que se quiere evitar.
            const payload = await response.json();
            return payload?.commercializers && typeof payload.commercializers === 'object'
              ? payload.commercializers
              : {};
          }).catch(error => {
            lfDbg('[QR] No se pudo cargar el censo CNMC:', error?.message || error);
            // Un corte transitorio no puede dejar la pestana sin censo hasta que se
            // recargue: se purga la promesa fallida para que la siguiente factura
            // reintente. El check de identidad evita anular una carga posterior que
            // ya este en vuelo (mismo patron que __pvpcLoadMonth en index-extra.js).
            if (__LF_cnmcRegistryPromise === intento) __LF_cnmcRegistryPromise = null;
            return {};
          }).finally(() => clearTimeout(timeoutId));
          __LF_cnmcRegistryPromise = intento;
        }

        const registry = await __LF_cnmcRegistryPromise;
        const entry = registry[normalizedCode];
        const name = __LF_safeRegistryText(entry?.name, 180);
        if (!name) return null;
        return {
          code: normalizedCode,
          name,
          phone: __LF_safeRegistryText(entry?.phone, 80),
          website: __LF_safeRegistryWebsite(entry?.website)
        };
      }

      window.__LF_restoreFocusEl = null;
      window.__LF_focusTrapCleanup = null;
      window.__LF_scrollY = 0; // compatibilidad con integraciones legacy; ya no gobierna el scroll-lock
      let __LF_scrollLockToken = null;
      let __LF_scrollFallbackState = null;
      let __LF_lastParsedConfianza = 0;
      let __LF_lastQrCustomTarifaPrices = null;
      let __LF_modalHideTimer = null;
      let __LF_lastFile = null;

      let __LF_pdfjsLoading = null;
      let __LF_pdfjsImportFailures = 0;
      let __LF_pdfWorkerRetryGeneration = 0;
      if (typeof window.__LF_FACTURA_BUSY !== 'boolean') window.__LF_FACTURA_BUSY = false;
      let __LF_operationSeq = 0;
      let __LF_activeOperation = 0;
      const __LF_pendingOperations = new Set();
      const __LF_operationAborters = new Map();
      const __LF_OPERATION_CANCELLED = 'LF_FACTURA_OPERATION_CANCELLED';
      const __LF_MAX_PDF_SIZE_MB = 20;
      const __LF_MAX_PDF_SIZE_BYTES = __LF_MAX_PDF_SIZE_MB * 1024 * 1024;
      const __LF_MAX_PDF_TEXT_PAGES = 20;
      const __LF_MAX_PDF_RENDER_PIXELS = 16 * 1024 * 1024;
      const __LF_MAX_PDF_RENDER_DIMENSION = 8192;
      const __LF_MAX_PDF_PROCESSING_MS = 90 * 1000;
      // Deadline propio del import() del core. Debe quedar POR DEBAJO del watchdog
      // para dar un error atribuible en vez de que lo tape el corte general, y muy
      // por encima de cualquier descarga real: 518 KB en 60 s son menos de 70 kbps.
      const __LF_PDFJS_LOAD_TIMEOUT_MS = 60 * 1000;
      const __LF_OCR_SCAN_INVITE = '⚠️ No se ha detectado texto seleccionable. Parece un PDF escaneado: puedes leerlo con OCR o introducir los datos manualmente.';

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

      function __LF_registerOperationAborter(operationId, aborter){
        if (!operationId || typeof aborter !== 'function') return () => {};
        let active = true;
        const wrapped = () => {
          if (!active) return undefined;
          active = false;
          const set = __LF_operationAborters.get(operationId);
          set?.delete(wrapped);
          if (set && set.size === 0) __LF_operationAborters.delete(operationId);
          return aborter();
        };
        let set = __LF_operationAborters.get(operationId);
        if (!set) {
          set = new Set();
          __LF_operationAborters.set(operationId, set);
        }
        set.add(wrapped);
        if (!__LF_isCurrentOperation(operationId)) {
          try { Promise.resolve(wrapped()).catch(()=>{}); } catch (_) {}
        }
        return () => {
          if (!active) return;
          active = false;
          const current = __LF_operationAborters.get(operationId);
          current?.delete(wrapped);
          if (current && current.size === 0) __LF_operationAborters.delete(operationId);
        };
      }

      function __LF_cancelOperationResources(operationId){
        const set = __LF_operationAborters.get(operationId);
        if (!set) return;
        __LF_operationAborters.delete(operationId);
        for (const abort of [...set]) {
          try { Promise.resolve(abort()).catch(()=>{}); } catch (_) {}
        }
      }

      function __LF_finishOperation(operationId){
        __LF_pendingOperations.delete(operationId);
        __LF_operationAborters.delete(operationId);
        if (__LF_isCurrentOperation(operationId)) {
          __LF_activeOperation = 0;
          window.__LF_FACTURA_BUSY = false;
        }
        __LF_syncPrivacyMode();
      }

      function __LF_invalidateOperation(){
        const operationId = __LF_activeOperation;
        __LF_activeOperation = 0;
        __LF_operationSeq++;
        if (operationId) __LF_cancelOperationResources(operationId);
      }

      function __LF_startProcessingWatchdog(operationId, onTimeout, timeoutMs = __LF_MAX_PDF_PROCESSING_MS){
        return setTimeout(() => {
          if (!__LF_isCurrentOperation(operationId)) return;
          // Mantener la operación en pending hasta que sus promesas terminen conserva
          // el modo privacidad. Invalidarla impide que una resolución tardía escriba
          // sobre el modal, y los aborters cancelan worker/render cuando es posible.
          __LF_invalidateOperation();
          window.__LF_FACTURA_BUSY = false;
          try { onTimeout?.(); } catch (_) {}
        }, timeoutMs);
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

      function __LF_getSafePdfViewport(page, requestedScale){
        const scale = Number(requestedScale);
        if (!page || typeof page.getViewport !== 'function' || !Number.isFinite(scale) || scale <= 0) {
          throw new Error('Dimensiones de página PDF inválidas');
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const baseWidth = Number(baseViewport?.width);
        const baseHeight = Number(baseViewport?.height);
        if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) {
          throw new Error('Dimensiones de página PDF inválidas');
        }

        const scaleByPixels = Math.sqrt(__LF_MAX_PDF_RENDER_PIXELS / (baseWidth * baseHeight));
        const scaleByDimension = Math.min(
          __LF_MAX_PDF_RENDER_DIMENSION / baseWidth,
          __LF_MAX_PDF_RENDER_DIMENSION / baseHeight
        );
        const safeScale = Math.min(scale, scaleByPixels, scaleByDimension);
        if (!Number.isFinite(safeScale) || safeScale <= 0) {
          throw new Error('Dimensiones de página PDF inválidas');
        }

        const viewport = page.getViewport({ scale: safeScale });
        const width = Math.max(1, Math.floor(Number(viewport.width)));
        const height = Math.max(1, Math.floor(Number(viewport.height)));
        if (
          !Number.isFinite(width) || !Number.isFinite(height)
          || width > __LF_MAX_PDF_RENDER_DIMENSION
          || height > __LF_MAX_PDF_RENDER_DIMENSION
          || width * height > __LF_MAX_PDF_RENDER_PIXELS
        ) {
          throw new Error('Dimensiones de página PDF demasiado grandes');
        }

        return { viewport, width, height, scale: safeScale };
      }

      function __LF_ensurePdfRuntimeCompatibility(){
        __LF_installPromiseWithResolversShim();
        __LF_installMapGetOrInsertComputedShim();
      }

      async function __LF_readPageTextContent(page, params = {}){
        if (!page || typeof page.streamTextContent !== 'function') {
          // Compatibilidad defensiva con mocks/integraciones antiguas. La ruta
          // productiva de PDF.js 6.x usa el reader de Web Streams: hay versiones
          // afectadas de Safari/WebKit sin ReadableStream[Symbol.asyncIterator],
          // que es lo que getTextContent() intenta consumir con `for await`.
          return page.getTextContent(params);
        }

        const stream = page.streamTextContent(params);
        const reader = stream?.getReader?.();
        if (!reader || typeof reader.read !== 'function') {
          return page.getTextContent(params);
        }

        const textContent = {
          items: [],
          styles: Object.create(null),
          lang: null
        };
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value || typeof value !== 'object') continue;
            textContent.lang ??= value.lang ?? null;
            if (value.styles && typeof value.styles === 'object') {
              Object.assign(textContent.styles, value.styles);
            }
            if (Array.isArray(value.items)) textContent.items.push(...value.items);
          }
        } finally {
          try { reader.releaseLock?.(); } catch (_) {}
        }
        return textContent;
      }

      function __LF_pdfWorkerSrc(){
        const workerUrl = new URL(__LF_versionedUrl("js/pdfjs-worker-bootstrap.mjs"), document.baseURI);
        if (__LF_pdfWorkerRetryGeneration > 0) {
          // El fragmento cambia la identidad del modulo en Chromium, pero nunca
          // forma parte de la peticion HTTP y conserva intacta la query ?v=.
          workerUrl.hash = `lf-pdf-worker-retry-${__LF_pdfWorkerRetryGeneration}`;
        }
        return workerUrl.href;
      }

      function __LF_ensurePdfWorker(){
        const lib = window.pdfjsLib;
        if (!lib) return false;
        if (!lib.GlobalWorkerOptions.workerSrc) {
          // Bootstrap propio: instala el shim en el realm Worker y reexporta
          // WorkerMessageHandler para conservar el fallback fake-worker de PDF.js.
          lib.GlobalWorkerOptions.workerSrc = __LF_pdfWorkerSrc();
        }
        return true;
      }

      function __LF_preparePdfWorkerRetry(error){
        const message = String(error && error.message || '');
        if (!message.includes('Setting up fake worker failed:')) return false;
        if (!window.pdfjsLib) return false;

        // PDF.js 6.x memoriza internamente el Promise rechazado del fake-worker.
        // No mutamos esa API interna: descartamos este namespace ya fallido y
        // hacemos que el proximo intento importe un namespace PDF.js nuevo. El
        // bootstrap del worker recibe tambien una identidad nueva solo por hash.
        __LF_pdfjsImportFailures++;
        __LF_pdfWorkerRetryGeneration++;
        window.pdfjsLib = null;
        return true;
      }

      // import() no se puede cancelar y, si la red deja la peticion pendiente para
      // siempre, la promesa nunca se asienta: sin este deadline __LF_pdfjsLoading
      // quedaria envenenado y TODOS los intentos posteriores esperarian a un muerto.
      // El timer se limpia al terminar para no dejar 60 s de temporizador vivo en
      // cada carga normal.
      async function __LF_importWithTimeout(src, timeoutMs){
        let timeoutId = null;
        try {
          return await Promise.race([
            import(src),
            new Promise((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error('Tiempo de espera agotado cargando PDF.js'));
              }, timeoutMs);
            })
          ]);
        } finally {
          if (timeoutId !== null) clearTimeout(timeoutId);
        }
      }

      async function __LF_ensurePdfJs(){
        __LF_ensurePdfRuntimeCompatibility();
        if (window.pdfjsLib && __LF_ensurePdfWorker()) return window.pdfjsLib;

        if (__LF_pdfjsLoading){
          try { await __LF_pdfjsLoading; }
          finally { __LF_pdfjsLoading = null; }
          if (window.pdfjsLib && __LF_ensurePdfWorker()) return window.pdfjsLib;
        }

        const baseSrc = __LF_versionedUrl("vendor/pdfjs/pdf.min.mjs");
        // Chromium conserva en el module map un import() fallido para la misma
        // identidad. Un fragmento nuevo fuerza una evaluacion nueva sin alterar
        // el pathname ni la query de build enviada por HTTP.
        const importUrl = new URL(baseSrc, document.baseURI);
        if (__LF_pdfjsImportFailures > 0) {
          // Tiene que cambiar la URL **HTTP**, no solo la identidad del modulo: un
          // `#fragment` no viaja en la peticion y, medido en WebKit, tras un import()
          // colgado a nivel de red el reintento NO emitia una peticion nueva y el
          // segundo intento del usuario volvia a fallar. La query si fuerza descarga
          // nueva. Solo se anade tras un fallo, asi que la carga normal no cambia, y
          // `v` se conserva intacto para no romper el guard de build del SW.
          importUrl.searchParams.set('lf_retry', String(__LF_pdfjsImportFailures));
        }
        const src = importUrl.href;
        __LF_pdfjsLoading = (async()=>{
          try {
            const mod = await __LF_importWithTimeout(src, __LF_PDFJS_LOAD_TIMEOUT_MS);
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
          } catch (error) {
            __LF_pdfjsImportFailures++;
            throw error;
          }
        })();

        try { await __LF_pdfjsLoading; }
        finally { __LF_pdfjsLoading = null; }

        if (!window.pdfjsLib || !__LF_ensurePdfWorker()){
          throw new Error("PDF.js no disponible");
        }
        return window.pdfjsLib;
      }


      async function __LF_extraerTextoPDF(file, operationId){
        await __LF_ensurePdfJs();
        const ab = await file.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: ab, verbosity: __LF_pdfVerbosityErrors() });
        let pdf;
        let loadingTaskDestroyed = false;
        const destroyLoadingTask = async () => {
          if (loadingTaskDestroyed) return;
          loadingTaskDestroyed = true;
          try{ if (loadingTask && loadingTask.destroy) await loadingTask.destroy(); }catch(_){}
        };
        const unregisterLoadingTask = __LF_registerOperationAborter(operationId, destroyLoadingTask);

        try{
          pdf = await loadingTask.promise;
          if (operationId) __LF_assertCurrentOperation(operationId);
          let lines = [];
          let compact = '';
          const pageTexts = [];
          const qrHintPages = [];
          const qrHintRe = /\bqr\b|comparador|cnmc|qre\?/i;
          const pagesTotal = Number.isFinite(pdf.numPages) ? pdf.numPages : 0;
          const pagesScanned = Math.min(pagesTotal, __LF_MAX_PDF_TEXT_PAGES);

          for (let p=1; p<=pagesScanned; p++){
            const page = await pdf.getPage(p);
            const pageLineStart = lines.length;
            let items = [];
            try{
              if (operationId) __LF_assertCurrentOperation(operationId);
              const tc = await __LF_readPageTextContent(page);
              if (operationId) __LF_assertCurrentOperation(operationId);
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
            const pageTextLines = lines.slice(pageLineStart).join('\n');
            const pageTextCompact = pageCompact.replace(/\s+/g,' ').trim();
            pageTexts.push({ textLines: pageTextLines, textCompact: pageTextCompact });
            compact += pageCompact + '\n';
            if (qrHintRe.test(pageCompact)) qrHintPages.push(p);
          }

          const textLines = lines.join('\n');
          const textCompact = compact.replace(/\s+/g,' ').trim();
          return { textLines, textCompact, textRawLen: (textCompact || '').length, pageTexts, qrHintPages, pagesTotal, pagesScanned };
        } finally {
          unregisterLoadingTask();
          try{ if (pdf && pdf.cleanup) await pdf.cleanup(); }catch(_){}
          // pdf.js 6.x elimina PDFDocumentProxy.destroy(); liberar via loadingTask
          await destroyLoadingTask();
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

          const operationId = options.operationId || null;
          const arrayBuffer = await pdfFile.arrayBuffer();
          if (operationId) __LF_assertCurrentOperation(operationId);
          loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, verbosity: __LF_pdfVerbosityErrors() });
          let loadingTaskDestroyed = false;
          const destroyLoadingTask = async () => {
            if (loadingTaskDestroyed) return;
            loadingTaskDestroyed = true;
            try{ if (loadingTask && loadingTask.destroy) await loadingTask.destroy(); }catch(_){}
          };
          const unregisterLoadingTask = __LF_registerOperationAborter(operationId, destroyLoadingTask);
          let pdf;
          try {
            pdf = await loadingTask.promise;
            if (operationId) __LF_assertCurrentOperation(operationId);

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
            try {
              if (operationId) __LF_assertCurrentOperation(operationId);
              for (const scale of scales) {
                let canvas = null;
                try {
                  const safeViewport = __LF_getSafePdfViewport(page, scale);
                  const viewport = safeViewport.viewport;

                  canvas = document.createElement('canvas');
                  const context = canvas.getContext('2d');
                  if (!context) throw new Error('No se pudo crear el canvas para analizar el PDF');
                  canvas.width = safeViewport.width;
                  canvas.height = safeViewport.height;

                  const renderTask = page.render({ canvasContext: context, viewport });
                  const unregisterRenderTask = __LF_registerOperationAborter(operationId, () => {
                    try{ renderTask.cancel?.(); }catch(_){}
                  });
                  try {
                    await renderTask.promise;
                  } finally {
                    unregisterRenderTask();
                  }
                  if (operationId) __LF_assertCurrentOperation(operationId);
                  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

                  // Intentar con y sin inversión
                  const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "attemptBoth"
                  });

                  if (code && code.data) {
                    lfDbg(`[QR jsQR] Código detectado (escala ${safeViewport.scale}) [contenido oculto]`);
                    if (__LF_isTrustedCnmcQrUrl(code.data)) {
                      lfDbg(`[QR jsQR] ✅ QR CNMC válido encontrado en página ${pageNum} (escala ${safeViewport.scale})`);
                      return code.data;
                    }
                  }
                } finally {
                  try{ if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove?.(); } }catch(_){}
                }
              }
            } finally {
              try{ if (page && page.cleanup) await page.cleanup(); }catch(_){}
            }
          }

            lfDbg('[QR jsQR] ⚠️ No se detectó QR en ninguna página');
            return null;
          } finally {
            unregisterLoadingTask();
            await destroyLoadingTask();
          }
        } catch (error) {
          if (options.operationId && !__LF_isCurrentOperation(options.operationId)) {
            const cancelled = new Error('Operacion de factura cancelada');
            cancelled.code = __LF_OPERATION_CANCELLED;
            throw cancelled;
          }
          lfDbg('[QR jsQR] ❌ Error:', error.message);
          return null;
        }
      }
      
      /**
       * Extrae URL QR del texto del PDF
       */
      function __LF_parsePeriodDate(raw){
        const value = String(raw ?? '').trim();
        let y, m, d;
        let match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
        } else {
          match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
          if (!match) return null;
          d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
          if (y < 100) y += 2000;
        }
        const date = new Date(Date.UTC(y, m - 1, d));
        if (
          !Number.isFinite(date.getTime())
          || date.getUTCFullYear() !== y
          || date.getUTCMonth() !== m - 1
          || date.getUTCDate() !== d
        ) return null;
        return date;
      }

      function __LF_hasMultipleInvoicePagePeriods(pageTexts){
        const candidates = [];
        for (const pageText of Array.isArray(pageTexts) ? pageTexts : []) {
          const datosPagina = __LF_parsearDatos(pageText?.textLines || '', pageText?.textCompact || '');
          // Una pagina solo cuenta como factura candidata si contiene un periodo valido y
          // una pieza estructural completa: las dos potencias o el reparto P1/P2/P3. Asi no
          // bloqueamos por tablas historicas o rangos auxiliares incompletos.
          const hasPowerPair = datosPagina?.p1 != null && datosPagina?.p2 != null;
          const hasConsumptionSplit = datosPagina?.consumoPunta != null
            && datosPagina?.consumoLlano != null
            && datosPagina?.consumoValle != null;
          if (!hasPowerPair && !hasConsumptionSplit) continue;
          const inicio = __LF_parsePeriodDate(datosPagina?._fechaInicio);
          const fin = __LF_parsePeriodDate(datosPagina?._fechaFin);
          if (!inicio || !fin) continue;
          candidates.push({
            period: `${inicio.toISOString().slice(0,10)}/${fin.toISOString().slice(0,10)}`,
            hasPowerPair,
            hasConsumptionSplit
          });
        }

        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            const a = candidates[i];
            const b = candidates[j];
            if (a.period === b.period) continue;
            // Mantener el guard previo (potencias + potencias) y cerrar tambien la mezcla
            // que puede completar una factura con potencias de un periodo y P1/P2/P3 de otro.
            if (
              (a.hasPowerPair && b.hasPowerPair)
              || (a.hasPowerPair && b.hasConsumptionSplit)
              || (a.hasConsumptionSplit && b.hasPowerPair)
            ) return true;
          }
        }
        return false;
      }

      function __LF_failClosedMultipleInvoices(datos){
        if (!datos) return datos;
        datos.dias = null;
        datos.p1 = null;
        datos.p2 = null;
        datos.consumoPunta = null;
        datos.consumoLlano = null;
        datos.consumoValle = null;
        datos.consumoTotalDetectado = null;
        datos.confianza = 0;
        datos.multiplesFacturasDetectadas = true;
        return datos;
      }

      function __LF_qrPdfPeriodsCompatible(datosQR, datosPDF){
        const qrIni = __LF_parsePeriodDate(datosQR?._fechaInicio);
        const qrFin = __LF_parsePeriodDate(datosQR?._fechaFin);
        const pdfIni = __LF_parsePeriodDate(datosPDF?._fechaInicio);
        const pdfFin = __LF_parsePeriodDate(datosPDF?._fechaFin);
        if (!qrIni || !qrFin || !pdfIni || !pdfFin) return null;
        const dayDiff = (a, b) => Math.abs(a.getTime() - b.getTime()) / 86400000;
        // Las fechas del QR son lecturas (inicio excluido) y el rango impreso puede
        // desplazarse ligeramente. Dos dias cubren esa diferencia sin considerar
        // compatibles dos facturas mensuales distintas dentro del mismo PDF.
        return dayDiff(qrIni, pdfIni) <= 2 && dayDiff(qrFin, pdfFin) <= 2;
      }

      function __LF_showContextualWarnings(datos){
        // Función para mostrar advertencias contextuales basadas en los datos extraídos
        const avisos = [];

        if (datos?.periodoQrPdfDiscrepante) {
          avisos.push('⚠️ El periodo del QR CNMC no coincide con el periodo detectado en el PDF. Se conservan los días del QR y se desactiva el autocálculo. Si el archivo contiene varias facturas o suministros, sube solo la factura que quieras comparar.');
        }

        if (datos?.diasQrPdfDifieren && !datos?.periodoQrPdfDiscrepante) {
          avisos.push(`ℹ️ El periodo detectado en el PDF equivale a <b>${datos.diasDetectadosPdf} días</b>; usamos <b>${datos.diasDeclaradosQr} días</b> calculados con las fechas del QR CNMC (inicio excluido y fin incluido).`);
        }

        if (datos?.multiplesFacturasDetectadas) {
          avisos.push('⚠️ Se han detectado varias facturas con periodos distintos en el mismo PDF. No se ha rellenado ningún dato automáticamente para evitar mezclar importes de facturas diferentes. Sube solo la factura que quieras comparar o introduce manualmente los datos de una sola factura.');
        }

        if (datos?.peajeNoSoportado) {
          const peaje = __LF_escapeWarnHtml(datos.peajeAcceso || 'no soportado');
          avisos.push(`⚠️ Esta factura declara el peaje <b>${peaje}</b>. El comparador solo modela 2.0TD (2 periodos de potencia y 3 de energía), así que estos datos no se pueden aplicar.`);
        }

        if (datos?.consumoNegativoDetectado) {
          avisos.push('⚠️ Se han detectado cantidades de consumo negativas, típicas de una factura rectificativa o abono. No se han importado como consumos positivos. El comparador modela consumos no negativos: revisa la factura y no apliques esos valores automáticamente.');
        }

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
        if (totalConsumo === 0 && datos.consumoTotalDetectado != null){
          // El parser encontro un consumo total pero no el reparto Punta/Llano/Valle: no se
          // rellena con un reparto inventado (ver factura-parsers.js), asi que hay que pedirlo.
          avisos.push(`⚠️ Se detectó un consumo total de ${datos.consumoTotalDetectado} kWh, pero no su reparto Punta/Llano/Valle. Introduce el reparto manualmente antes de aplicar.`);
        } else if (totalConsumo === 0
          && datos.consumoPunta != null
          && datos.consumoLlano != null
          && datos.consumoValle != null){
          avisos.push(`ℹ️ Se detectó un consumo de <b>0 kWh</b> en los tres periodos. Verifica que sea correcto.`);
        } else if (totalConsumo === 0){
          avisos.push(`⚠️ No se detectó ningún consumo. Introduce los valores manualmente.`);
        } else if (totalConsumo > 5000){
          avisos.push(`ℹ️ Consumo total muy alto: ${totalConsumo} kWh. Verifica que los valores sean correctos.`);
        }

        // Verificar confianza
        if (datos.confianza < 50 && !datos?.multiplesFacturasDetectadas){
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
      function __LF_focusFacturaStage(id){
        const target = __LF_q(id);
        if (!target || typeof target.focus !== 'function') return;
        setTimeout(() => {
          const modal = __LF_q('modalFactura');
          if (!modal || modal.getAttribute('aria-hidden') === 'true' || modal.hasAttribute('hidden')) return;
          try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
        }, 0);
      }

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

      function __LF_formatQrDate(value) {
        const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
      }

      function __LF_formatQrNumber(value, digits = 2) {
        if (!Number.isFinite(value)) return null;
        return new Intl.NumberFormat('es-ES', {
          minimumFractionDigits: 0,
          maximumFractionDigits: digits
        }).format(value);
      }

      function __LF_formatQrEuro(value) {
        if (!Number.isFinite(value)) return null;
        return new Intl.NumberFormat('es-ES', {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(value);
      }

      function __LF_formatQrPowerPrice(value) {
        if (!Number.isFinite(value)) return null;
        const annual = `${__LF_formatQrNumber(value, 6)} €/kW·año`;
        const daily = __LF_qrAnnualPowerPriceToDaily(value);
        if (!Number.isFinite(daily)) return annual;
        return `${__LF_formatQrNumber(daily, 6)} €/kW·día (equivalente a ${annual} del QR CNMC)`;
      }

      function __LF_contractTypeLabel(code) {
        const labels = {
          A: 'PVPC regulado',
          B: 'Indexado al mercado horario',
          C: 'Indexado con un precio de energía',
          D: 'Indexado con 3 precios de energía',
          E: 'Mercado libre · 3 precios de energía',
          F: 'Mercado libre · un precio de energía',
          G: 'Tarifa flexible',
          H: 'Tarifa plana'
        };
        if (!/^[A-H][01]$/.test(String(code || ''))) return null;
        const base = labels[code[0]];
        return code[1] === '1' ? `${base} · cuota mensual acordada` : base;
      }

      function __LF_revisionLabel(code) {
        return ({
          0: 'Anual',
          1: 'Semestral',
          2: 'Trimestral',
          3: 'Mensual',
          4: 'Cada 3 años',
          5: 'Cada 5 años'
        })[code] || null;
      }

      function __LF_invoiceTypeLabel(code) {
        return ({
          A: 'Anuladora',
          N: 'Normal',
          R: 'Rectificadora',
          C: 'Complementaria',
          G: 'Regularizadora'
        })[code] || null;
      }

      function __LF_priceChangeLabel(code) {
        return ({
          0: 'No indicado',
          1: 'Cambio dentro de esta factura',
          2: 'Cambio en la siguiente factura'
        })[code] || null;
      }

      function __LF_appendQrInfoGroup(section, title, items) {
        const validItems = items.filter(item => item.value != null && item.value !== '');
        if (!validItems.length) return;

        const group = document.createElement('div');
        group.className = 'qr-factura-group';
        const heading = document.createElement('h5');
        heading.textContent = title;
        group.appendChild(heading);

        const grid = document.createElement('dl');
        grid.className = 'qr-factura-grid';
        for (const item of validItems) {
          const fact = document.createElement('div');
          fact.className = item.wide ? 'qr-factura-fact qr-factura-fact-wide' : 'qr-factura-fact';
          const term = document.createElement('dt');
          term.textContent = item.label;
          const description = document.createElement('dd');
          description.textContent = item.value;
          fact.append(term, description);
          grid.appendChild(fact);
        }
        group.appendChild(grid);
        section.appendChild(group);
      }

      // El QR declara prE*/prP* SIN impuestos NI descuentos (Resolucion CNMC,
      // BOE-A-2022-16989), mientras impEner/impPot SI incorporan los descuentos
      // asociados a esos terminos. Contrastarlos revela si la factura aplica un
      // descuento que los precios declarados no reflejan. Mirar solo el campo `dto`
      // NO basta: la resolucion permite que el descuento venga ya incorporado al
      // importe y no aparezca ahi.
      //
      // Tolerancia: los consumos del QR (cfP1/2/3) llegan en kWh ENTEROS, asi que
      // parte del desvio es redondeo de la propia fuente, no descuento. Medido sobre
      // facturas reales sin descuento: la potencia cuadra al centimo (0,00%) y la
      // energia desvia ~0,2%. Un descuento real es de otro orden de magnitud.
      //
      // De paso, esta comprobacion es la confirmacion normativa del divisor 365 que
      // usa __LF_qrAnnualPowerPriceToDaily: prP x kW x dias/365 reproduce impPot
      // EXACTAMENTE en las facturas del banco de pruebas; con 366 no cuadra.
      const QR_COHERENCIA_TOLERANCIA = 0.02;
      const QR_COHERENCIA_MINIMO_EUR = 0.15;

      function __LF_qrPricesMatchDeclaredAmounts(datos, precios) {
        if (!precios) return { coherente: false, precios: null, motivo: 'sin-precios' };

        const info = datos?.qrInfo;

        // `cambio=1` significa que hubo un cambio de precios DENTRO del periodo
        // facturado: prE*/prP* traen el precio ACTUALIZADO mientras impEner/impPot
        // son el subtotal de toda la factura, con los dos precios mezclados. El
        // contraste no puede distinguir ahi un descuento de un cambio de tarifa, y
        // acusar de descuento a quien solo cambio de precio seria peor que callar.
        if (Number(info?.cambioPrecios) === 1) {
          return { coherente: false, precios: null, motivo: 'cambio-precios-periodo' };
        }

        // Number(null) y Number('') son 0: una ausencia se convertiria en un cero
        // que falsea el contraste. Solo valen numeros finitos ya presentes.
        const num = valor => (typeof valor === 'number' && Number.isFinite(valor) ? valor : NaN);
        const dias = num(datos?.dias);
        const consumos = [datos?.consumoPunta, datos?.consumoLlano, datos?.consumoValle].map(num);
        const potencias = [datos?.p1, datos?.p2].map(num);

        // Devuelve null (incontrastable), 'ok', 'descuento' o 'incoherente'.
        // LA DIRECCION IMPORTA: un descuento solo puede hacer que se facture MENOS de
        // lo que los precios explican. Si se factura MAS, la causa es otra (unidades
        // mal publicadas, periodo distinto, recargos) y acusar de descuento seria
        // mentir al usuario. Casos reales que lo destaparon (25/08/2026): Endesa
        // declara 10,11 EUR de energia frente a 9,854 calculados, y el QR de Octopus
        // publica prP1/prP2 en EUR/kW/dia en vez de EUR/kW/anyo como exige la
        // resolucion (0,093 x 365 = 33,95 EUR/kW/anyo, coherente; al reves, absurdo).
        const comparar = (calculado, declarado) => {
          if (!Number.isFinite(calculado) || !Number.isFinite(declarado) || declarado < 0) return null;
          const desvio = Math.abs(calculado - declarado);
          if (desvio <= QR_COHERENCIA_MINIMO_EUR) return 'ok';
          // Un subtotal declarado de 0 con precios positivos NO es "incontrastable":
          // es justo el caso de una promocion del 100% sobre ese termino.
          if (declarado === 0) return 'descuento';
          if (desvio / declarado <= QR_COHERENCIA_TOLERANCIA) return 'ok';
          return calculado > declarado ? 'descuento' : 'incoherente';
        };

        const energiaCalculada = consumos.every(Number.isFinite)
          ? consumos[0] * precios.punta + consumos[1] * precios.llano + consumos[2] * precios.valle
          : NaN;
        // `dias` puede venir del PDF cuando el QR no trae iniF/finF validos (ver la
        // combinacion en el paso 3). Validar el impPot DECLARADO POR EL QR con dias
        // de otra fuente no seria un contraste homogeneo, asi que la potencia solo se
        // contrasta si el propio QR aporta el periodo. `fechaInicio`/`fechaFin` solo
        // se rellenan cuando esas fechas pasan la validacion estricta.
        const periodoDelQr = Boolean(info?.fechaInicio && info?.fechaFin);
        const potenciaPorDias = d => (potencias.every(Number.isFinite) && Number.isFinite(d)
          ? (potencias[0] * precios.p1 + potencias[1] * precios.p2) * d
          : NaN);

        // num() y no Number(): un importe ausente (`null`) daria 0 y, frente a un
        // calculo positivo, se leeria como descuento. La falta de evidencia no puede
        // convertirse en evidencia.
        const importeEnergia = num(info?.importeEnergia);
        const importePotencia = num(info?.importePotencia);

        const energiaOk = comparar(energiaCalculada, importeEnergia);

        // El QR puede declarar sus dias y facturar la potencia con otro recuento: caso
        // real de Plenitude (25/08/2026), donde impPot solo cuadra con los 32 dias del
        // PDF y no con los 31 del QR. Si ambos recuentos son plausibles, basta con que
        // UNO reproduzca el importe: es una discrepancia de dias ya conocida y avisada
        // en otro sitio, no un descuento.
        // Los dias del PDF solo valen como recuento alternativo si PDF y QR hablan del
        // MISMO periodo. Con `periodoQrPdfDiscrepante` ya sabemos que no (tipico de un
        // PDF con varias facturas), asi que esos dias son de otra factura y no pueden
        // legitimar los precios de esta: seria la misma mezcla que el resto del codigo
        // evita al combinar fuentes.
        const diasAlternativos = [
          dias,
          datos?.periodoQrPdfDiscrepante ? NaN : num(datos?.diasDetectadosPdf)
        ].filter(d => Number.isFinite(d) && d > 0);
        let potenciaOk = periodoDelQr ? comparar(potenciaPorDias(dias), importePotencia) : null;
        if (periodoDelQr && potenciaOk && potenciaOk !== 'ok') {
          const alguno = diasAlternativos.some(d => comparar(potenciaPorDias(d), importePotencia) === 'ok');
          if (alguno) potenciaOk = 'ok';
        }

        // `null` = ese termino no se puede contrastar (el QR no trae el importe, o el
        // periodo no es suyo). DECISION DELIBERADA: no bloquea. Se prefiere un falso
        // negativo —dejar pasar un descuento que solo afecta a un termino no
        // contrastable— antes que retirar la importacion a todo el que tenga un QR
        // incompleto, que es mucho mas frecuente. Si un termino SI se puede contrastar
        // y falla, eso si bloquea.
        const veredictos = [energiaOk, potenciaOk];
        if (veredictos.some(v => v && v !== 'ok')) {
          return {
            coherente: false,
            precios: null,
            // Si alguno apunta a descuento, ese es el motivo util para el usuario;
            // si solo hay incoherencias de otro signo, no se le acusa de descuento.
            motivo: veredictos.includes('descuento') ? 'descuento-no-reflejado' : 'qr-incoherente',
            energiaOk,
            potenciaOk
          };
        }
        return { coherente: true, precios, motivo: 'ok', energiaOk, potenciaOk };
      }

      // Expuesto solo para pruebas: la regla de coherencia QR/importes tiene bordes
      // (cambio de precios en el periodo, importes a 0, periodo ausente) que se fijan
      // mejor contra la funcion que montando un PDF completo por caso.
      window.__LF_facturaQrHelpers = {
        qrPricesMatchDeclaredAmounts: __LF_qrPricesMatchDeclaredAmounts,
        // El deadline del censo se fija mejor aqui que montando un PDF completo: hace
        // falta una red que ni responda ni corte, que es justo lo que no se puede
        // reproducir con el flujo normal de subida.
        resolveCnmcCommercializer: __LF_resolveCnmcCommercializer
      };

      function __LF_appendQrCustomTarifaSelector(section, prices, coherencia) {
        if (!prices) {
          const MOTIVOS = {
            'tipo-no-representable': {
              tipo: 'info',
              titulo: 'Esta modalidad no se puede importar como «Mi tarifa»',
              texto: 'El QR indica un contrato que el comparador no puede representar fielmente. '
                + 'Los consumos y las potencias de la factura sí se pueden aplicar al formulario.'
            },
            'qr-datos-incompletos': {
              tipo: 'info',
              titulo: 'El QR no incluye todos los datos necesarios',
              texto: 'Falta la modalidad del contrato, así que no podemos saber si sus precios '
                + 'encajan en «Mi tarifa». Puedes introducirlos manualmente si los conoces.'
            },
            'qr-precios-incompletos': {
              tipo: 'info',
              titulo: 'El QR no incluye todos los precios necesarios',
              texto: 'Falta algún precio de energía o potencia, o contiene un valor que no se '
                + 'puede usar con seguridad. Puedes completar «Mi tarifa» manualmente.'
            },
            'descuento-no-reflejado': {
              tipo: 'warning',
              titulo: 'Estos precios no reflejan lo que estás pagando',
              texto: 'El importe facturado no cuadra con los precios declarados, señal de que tu '
                + 'factura aplica un descuento que el QR no recoge. Importarlos haría parecer tu '
                + 'tarifa más cara de lo que pagas.'
            },
            'cambio-precios-periodo': {
              tipo: 'warning',
              titulo: 'La factura mezcla dos precios distintos',
              texto: 'Esta factura tuvo un cambio de precios a mitad del periodo: el QR declara el '
                + 'precio nuevo, pero los importes suman ambos tramos. Puedes introducir a mano el '
                + 'precio que te aplica ahora.'
            },
            'qr-incoherente': {
              tipo: 'warning',
              titulo: 'Los datos económicos del QR no son coherentes',
              texto: 'Los precios y los importes declarados no encajan entre sí, así que no se '
                + 'puede garantizar que representen lo que pagas. Puedes introducirlos a mano '
                + 'comprobándolos en tu contrato.'
            }
          };
          const contenido = MOTIVOS[coherencia?.motivo];
          if (contenido) {
            const aviso = document.createElement('div');
            aviso.className = `qr-factura-import-aviso qr-factura-import-aviso--${contenido.tipo}`;
            aviso.setAttribute('role', 'note');
            aviso.dataset.motivo = coherencia.motivo;

            const icono = document.createElement('span');
            icono.className = 'qr-factura-import-aviso-icono';
            icono.setAttribute('aria-hidden', 'true');
            icono.textContent = contenido.tipo === 'warning' ? '!' : 'i';

            const cuerpo = document.createElement('div');
            cuerpo.className = 'qr-factura-import-aviso-cuerpo';
            const titulo = document.createElement('strong');
            titulo.textContent = contenido.titulo;
            const texto = document.createElement('p');
            texto.textContent = contenido.texto;
            cuerpo.append(titulo, texto);
            aviso.append(icono, cuerpo);
            section.appendChild(aviso);
          }
          return;
        }
        const wrap = document.createElement('div');
        wrap.className = 'qr-factura-import-tarifa';

        const label = document.createElement('label');
        label.className = 'fv-check';
        label.htmlFor = 'usarPreciosQrMiTarifa';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'usarPreciosQrMiTarifa';
        const title = document.createElement('span');
        title.textContent = 'Usar estos precios para comparar como “Mi tarifa”';
        label.append(checkbox, title);

        const note = document.createElement('p');
        note.textContent = 'Son los precios base que tu comercializadora declara en el QR, antes de descuentos. Importa solo energía y potencia: no mezcla descuentos, servicios, autoconsumo ni batería virtual anteriores.';
        wrap.append(label, note);
        section.appendChild(wrap);
      }

      function __LF_renderQrInfo(datos) {
        const info = datos?.qrInfo;
        if (!info) return null;

        const section = document.createElement('section');
        section.className = 'qr-factura-info';
        section.setAttribute('aria-label', 'Información declarada en el QR CNMC');

        const header = document.createElement('div');
        header.className = 'qr-factura-header';
        const titleWrap = document.createElement('div');
        const eyebrow = document.createElement('span');
        eyebrow.className = 'qr-factura-eyebrow';
        eyebrow.textContent = 'QR CNMC verificado';
        const title = document.createElement('h4');
        title.textContent = info.comercializadora?.name || 'Información de tu factura';
        titleWrap.append(eyebrow, title);
        const localBadge = document.createElement('span');
        localBadge.className = 'qr-factura-local';
        localBadge.textContent = 'Procesado localmente';
        header.append(titleWrap, localBadge);
        section.appendChild(header);

        const periodStart = __LF_formatQrDate(info.fechaInicio);
        const periodEnd = __LF_formatQrDate(info.fechaFin);
        const period = periodStart && periodEnd
          ? `${periodStart} – ${periodEnd}${Number.isInteger(datos.dias) ? ` · ${datos.dias} días` : ''}`
          : null;
        const permanence = info.permanencia === false
          ? 'No'
          : (info.permanencia === true
            ? `Sí${__LF_formatQrDate(info.finPermanencia) ? `, hasta ${__LF_formatQrDate(info.finPermanencia)}` : ''}`
            : null);
        const services = Number.isFinite(info.importeServiciosAdicionales)
          ? (info.importeServiciosAdicionales === 0 ? 'No' : `Sí · ${__LF_formatQrEuro(info.importeServiciosAdicionales)}`)
          : null;

        __LF_appendQrInfoGroup(section, 'Resumen', [
          { label: 'Periodo facturado', value: period, wide: true },
          { label: 'Fecha de factura', value: __LF_formatQrDate(info.fechaFactura) },
          { label: 'Tipo de factura', value: __LF_invoiceTypeLabel(info.tipoFactura) },
          { label: 'Total facturado', value: __LF_formatQrEuro(info.totalFacturado) },
          { label: 'Tipo de contrato', value: __LF_contractTypeLabel(info.tipoContrato), wide: true },
          { label: 'Renovación del contrato', value: __LF_formatQrDate(info.finContrato) },
          { label: 'Permanencia', value: permanence },
          { label: 'Revisión de precios', value: __LF_revisionLabel(info.revisionPrecios) },
          { label: 'Cambio de precios', value: __LF_priceChangeLabel(info.cambioPrecios) },
          { label: 'Promoción temporal', value: info.promocion == null ? null : (info.promocion ? 'Sí' : 'No') },
          { label: 'Servicios adicionales', value: services },
          { label: 'Oferta de energía verde', value: info.energiaVerde == null ? null : (info.energiaVerde ? 'Sí' : 'No') }
        ]);

        __LF_appendQrInfoGroup(section, 'Precios contratados (antes de descuentos)', [
          { label: 'Energía punta', value: Number.isFinite(info.precioEnergiaP1) ? `${__LF_formatQrNumber(info.precioEnergiaP1, 6)} €/kWh` : null },
          { label: 'Energía llano', value: Number.isFinite(info.precioEnergiaP2) ? `${__LF_formatQrNumber(info.precioEnergiaP2, 6)} €/kWh` : null },
          { label: 'Energía valle', value: Number.isFinite(info.precioEnergiaP3) ? `${__LF_formatQrNumber(info.precioEnergiaP3, 6)} €/kWh` : null },
          { label: 'Potencia punta', value: __LF_formatQrPowerPrice(info.precioPotenciaP1) },
          { label: 'Potencia valle', value: __LF_formatQrPowerPrice(info.precioPotenciaP2) }
        ]);
        const disponibilidad = __LF_qrCustomTarifaAvailability(info);
        const coherencia = disponibilidad.precios
          ? __LF_qrPricesMatchDeclaredAmounts(datos, disponibilidad.precios)
          : { coherente: false, precios: null, motivo: disponibilidad.motivo };
        // Si la factura aplica un descuento que los precios declarados no reflejan,
        // importarlos haria parecer la tarifa del usuario mas cara de lo que paga.
        __LF_lastQrCustomTarifaPrices = coherencia.coherente ? coherencia.precios : null;
        __LF_appendQrCustomTarifaSelector(section, __LF_lastQrCustomTarifaPrices, coherencia);

        __LF_appendQrInfoGroup(section, 'Desglose declarado', [
          { label: 'Potencia', value: __LF_formatQrEuro(info.importePotencia) },
          { label: 'Energía', value: __LF_formatQrEuro(info.importeEnergia) },
          { label: 'Compensación de excedentes', value: __LF_formatQrEuro(info.compensacionExcedentes) },
          { label: 'Descuento bono social', value: __LF_formatQrEuro(info.descuentoBonoSocial) },
          { label: 'Financiación bono social', value: __LF_formatQrEuro(info.financiacionBonoSocial) },
          { label: 'Otros con impuesto eléctrico', value: __LF_formatQrEuro(info.importeOtrosConIE) },
          { label: 'Otros sin impuesto eléctrico', value: __LF_formatQrEuro(info.importeOtrosSinIE) },
          { label: 'Descuento', value: __LF_formatQrEuro(info.descuento) },
          { label: 'Ajuste', value: __LF_formatQrEuro(info.ajuste) }
        ]);

        __LF_appendQrInfoGroup(section, 'Potencia y consumo', [
          { label: 'Potencia contratada punta', value: Number.isFinite(datos.p1) ? `${__LF_formatQrNumber(datos.p1, 3)} kW` : null },
          { label: 'Potencia contratada valle', value: Number.isFinite(datos.p2) ? `${__LF_formatQrNumber(datos.p2, 3)} kW` : null },
          { label: 'Máxima demandada punta', value: Number.isFinite(info.potenciaMaximaP1) ? `${__LF_formatQrNumber(info.potenciaMaximaP1, 3)} kW` : null },
          { label: 'Máxima demandada valle', value: Number.isFinite(info.potenciaMaximaP2) ? `${__LF_formatQrNumber(info.potenciaMaximaP2, 3)} kW` : null },
          { label: 'Consumo facturado P1 / P2 / P3', value: `${__LF_formatQrNumber(datos.consumoPunta, 3)} / ${__LF_formatQrNumber(datos.consumoLlano, 3)} / ${__LF_formatQrNumber(datos.consumoValle, 3)} kWh`, wide: true },
          {
            label: `Consumo acumulado desde ${__LF_formatQrDate(info.inicioConsumoAnual) || 'el inicio disponible'} · P1 / P2 / P3`,
            value: [info.consumoAnualP1, info.consumoAnualP2, info.consumoAnualP3].every(Number.isFinite)
              ? `${__LF_formatQrNumber(info.consumoAnualP1, 3)} / ${__LF_formatQrNumber(info.consumoAnualP2, 3)} / ${__LF_formatQrNumber(info.consumoAnualP3, 3)} kWh`
              : null,
            wide: true
          }
        ]);

        if (info.comercializadora?.phone || info.comercializadora?.website) {
          const contact = document.createElement('div');
          contact.className = 'qr-factura-contact';
          const label = document.createElement('strong');
          label.textContent = 'Contacto de la comercializadora';
          contact.appendChild(label);
          if (info.comercializadora.phone) {
            const phone = document.createElement('span');
            phone.textContent = info.comercializadora.phone;
            contact.appendChild(phone);
          }
          if (info.comercializadora.website) {
            const website = document.createElement('a');
            website.href = info.comercializadora.website;
            website.target = '_blank';
            website.rel = 'noopener noreferrer';
            website.textContent = 'Web oficial';
            contact.appendChild(website);
          }
          section.appendChild(contact);
        }

        const note = document.createElement('p');
        note.className = 'qr-factura-note';
        note.textContent = 'Información declarada por la comercializadora en el QR regulado. LuzFija no guarda el PDF, el CUPS ni la URL del QR.';
        section.appendChild(note);
        return section;
      }

      function __LF_renderForm(datos) {
        const form = __LF_q('formValidacionFactura');
        if (!form) return;
        __LF_lastParsedConfianza = Number(datos?.confianza || 0);
        __LF_lastQrCustomTarifaPrices = null;
        // El bloqueo por peaje se marca SOBRE EL FORMULARIO, no en una variable de modulo.
        // Con estado de modulo la marca sobrevivia al formulario que la origino: bastaba
        // procesar una 3.0TD para que una factura 2.0TD posterior siguiera sin poder
        // aplicarse (y contaminaba tests entre si). Atada al form, desaparece en cuanto el
        // formulario se reconstruye, que es exactamente la vida util que debe tener.
        if (datos?.peajeNoSoportado) {
          form.dataset.peajeNoSoportado = String(datos.peajeAcceso || 'no soportado');
        } else {
          delete form.dataset.peajeNoSoportado;
        }
        
        // ✅ Limpiar y añadir elementos DOM (no strings HTML)
        form.innerHTML = '';
        const qrInfo = __LF_renderQrInfo(datos);
        if (qrInfo) form.appendChild(qrInfo);
        form.appendChild(__LF_crearInputValidacion('p1', 'Potencia P1 (kW)', datos.p1));
        form.appendChild(__LF_crearInputValidacion('p2', 'Potencia P2 (kW)', datos.p2));
        form.appendChild(__LF_crearInputValidacion('dias', 'Días de facturación', datos.dias));
        form.appendChild(__LF_crearInputValidacion('consumoPunta', 'Consumo Punta / P1 / E1 (kWh)', datos.consumoPunta));
        form.appendChild(__LF_crearInputValidacion('consumoLlano', 'Consumo Llano / P2 / E2 (kWh)', datos.consumoLlano));
        form.appendChild(__LF_crearInputValidacion('consumoValle', 'Consumo Valle / P3 / E3 (kWh)', datos.consumoValle));
        
        // Mostrar compañía detectada si no es genérico
        const companiaEl = __LF_q('companiaDetectada');
        const nombreEl = __LF_q('nombreCompania');
        if (companiaEl && nombreEl && datos.companiaNombre) {
          nombreEl.textContent = datos.companiaNombre;
          __LF_show(companiaEl);
        } else if (companiaEl && nombreEl && datos.compania && datos.compania !== 'generico') {
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
            'disa': 'DISA Energía',
            'buala': 'Bualá'
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
              'QR+PDF':       { texto: 'QR CNMC + respaldo PDF', bg: '#059669', color: '#fff' },
              'LINK_CNMC+PDF':{ texto: 'Enlace CNMC + respaldo PDF', bg: '#059669', color: '#fff' },
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

      function __LF_removeExactWarning(msg){
        const a = __LF_q('avisoFactura');
        if (!a) return '';
        const obsoleteHtml = __LF_warnHtml(msg).trim();
        const retained = a.innerHTML
          .split(/<br\s*\/?>(?:\s*<br\s*\/?>)+/i)
          .map(part => part.trim())
          .filter(part => part && part !== obsoleteHtml);
        a.innerHTML = retained.join('<br><br>');
        if (retained.length) __LF_show(a);
        else __LF_hide(a);
        return a.innerHTML;
      }

      function __LF_restoreWarningHtml(html){
        const a = __LF_q('avisoFactura');
        const retained = String(html || '').trim();
        if (!a || !retained) return;
        const current = a.innerHTML.trim();
        if (current.includes(retained)) return;
        a.innerHTML = current ? current + '<br><br>' + retained : retained;
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
        if (__LF_scrollLockToken || __LF_scrollFallbackState) return;
        const shared = window.LF?.modalScrollLock;
        if (shared && typeof shared.lock === 'function') {
          __LF_scrollLockToken = shared.lock('factura');
          return;
        }
        const body = document.body;
        const html = document.documentElement;
        __LF_scrollFallbackState = {
          scrollTop: Number(body?.scrollTop) || 0,
          bodyOverflow: body?.style?.overflow || '',
          htmlOverflow: html?.style?.overflow || ''
        };
        if (body?.style) body.style.overflow = 'hidden';
        if (html?.style) html.style.overflow = 'hidden';
      }
      function __LF_unlockScroll(){
        const shared = window.LF?.modalScrollLock;
        if (__LF_scrollLockToken && shared && typeof shared.unlock === 'function') {
          shared.unlock(__LF_scrollLockToken);
          __LF_scrollLockToken = null;
          return;
        }
        if (!__LF_scrollFallbackState) return;
        const state = __LF_scrollFallbackState;
        __LF_scrollFallbackState = null;
        if (document.body?.style) document.body.style.overflow = state.bodyOverflow;
        if (document.documentElement?.style) document.documentElement.style.overflow = state.htmlOverflow;
        if (document.body) document.body.scrollTop = state.scrollTop;
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

        // Precarga oportunista: entre abrir el modal y elegir el PDF en Archivos/
        // iCloud suelen pasar varios segundos, tiempo que en red movil se puede
        // aprovechar para descargar el lector antes de que haga falta. Es
        // fire-and-forget: __LF_ensurePdfJs() es idempotente (__LF_pdfjsLoading
        // evita duplicar la descarga) y si falla aqui, se reintenta igual al subir.
        __LF_ensurePdfJs().catch(()=>{});
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
        const fileType = String(file?.type || '').trim().toLowerCase();
        const fileName = String(file?.name || '').trim();
        if (!file || (fileType !== 'application/pdf' && !/\.pdf$/i.test(fileName))){
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
        __LF_focusFacturaStage('loaderFactura');

        const processingWatchdog = __LF_startProcessingWatchdog(operationId, () => {
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('uploadAreaFactura'));
          __LF_focusFacturaStage('uploadAreaFactura');
          if (typeof toast === 'function') {
            toast('La factura está tardando demasiado. Inténtalo de nuevo o introduce los datos manualmente.', 'err');
          }
          lfDbg('[TIMEOUT] Procesamiento de factura PDF cancelado tras 90 segundos');
        });

        try{
          const { textLines, textCompact, textRawLen, pageTexts, qrHintPages, pagesTotal, pagesScanned } = await __LF_extraerTextoPDF(file, operationId);
          __LF_assertCurrentOperation(operationId);
          const pdfPageWarning = __LF_pdfPageLimitWarning({ pagesTotal, pagesScanned });

          // NO mostrar resultados todavía, el QR puede tardar 2-3 segundos más.
          // Incluso un PDF escaneado sin texto seleccionable puede llevar un QR CNMC
          // perfectamente legible por imagen, así que no debemos cortar antes de jsQR.
          const hasSelectableText = Boolean(textRawLen && textRawLen >= 40);

          // ====================================================================
          // PASO 1: Intentar QR desde TEXTO (solo si realmente hay texto)
          // ====================================================================
          let datosQR = null;
          let qrOrigen = null; // 'LINK_CNMC+PDF' o 'QR+PDF'
          if (hasSelectableText) {
            const tAll = (textLines + '\n' + textCompact).replace(/[\u00A0\t]/g,' ').replace(/\s+/g,' ').trim();
            const qrUrlTexto = __LF_extractQRUrl(tAll);
            if (qrUrlTexto) {
              datosQR = __LF_parseQRData(qrUrlTexto);
              if (datosQR) qrOrigen = 'LINK_CNMC+PDF';
            }
          }

          // ====================================================================
          // PASO 2: Intentar QR con jsQR (escaneo de imagen)
          // ====================================================================
          if (!datosQR) {
            lfDbg('[QR] Texto no tiene URL válida, intentando jsQR...');
            try {
              const qrUrlImagen = await __LF_extractQRFromPDF(file, { qrHintPages, operationId });
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

          // Si no hay texto ni QR por imagen, conservar exactamente el flujo anterior:
          // ofrecer OCR/manual en vez de intentar parsear un documento vacío.
          if (!datosQR && !hasSelectableText){
            __LF_hide(__LF_q('loaderFactura'));
            __LF_show(__LF_q('resultadoFactura'));
            __LF_focusFacturaStage('resultadoFacturaTitulo');
            __LF_warn(__LF_OCR_SCAN_INVITE);
            if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);
            __LF_show(__LF_q('btnOcrFactura'));
            __LF_show(__LF_q('ctaOcrFactura'));
            __LF_setBadge(0);
            __LF_renderForm({ p1:null,p2:null,dias:null,consumoPunta:null,consumoLlano:null,consumoValle:null,confianza:0,fuenteDatos:null });
            return;
          }

          // ====================================================================
          // PASO 3: Si tenemos QR, combinar inteligentemente con PDF
          // ====================================================================
          if (datosQR) {
            lfDbg('[QR] ✅ QR encontrado - validando con datos del PDF');

            // El QR identifica a la comercializadora mediante el código público R2.
            // Lo resolvemos contra una copia local versionada del censo CNMC: no se
            // consulta el QR ni se envía ningún dato de la factura a un tercero.
            const commercializer = await __LF_resolveCnmcCommercializer(datosQR.codigoComercializadora);
            __LF_assertCurrentOperation(operationId);
            if (commercializer && datosQR.qrInfo) {
              datosQR.qrInfo.comercializadora = commercializer;
            }
            
            // Parsear PDF completo para tener datos de fallback y, sobre todo,
            // respetar una declaración explícita de peaje fuera de 2.0TD. Esa señal
            // estructural debe dominar incluso si existe QR: una factura 3.0TD/6.xTD
            // no se puede reinterpretar recortando P1/P2 y tres consumos del QR.
            const datosPDF = __LF_parsearDatos(textLines, textCompact);
            if (datosPDF.peajeNoSoportado) {
              datosPDF.fuenteDatos = 'PDF';
              __LF_hide(__LF_q('loaderFactura'));
              __LF_show(__LF_q('resultadoFactura'));
              __LF_focusFacturaStage('resultadoFacturaTitulo');
              __LF_setBadge(0);
              __LF_renderForm(datosPDF);
              __LF_showContextualWarnings(datosPDF);
              if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);
              return;
            }
            
            // COMBINAR: usar QR como fuente principal y completar solo ausencias con
            // PDF. Antes de mezclar cualquier fallback comprobamos que el rango pertenezca al mismo
            // periodo que el QR. En un PDF con varias facturas, el parser global puede
            // encontrar el primer rango del documento mientras el único QR CNMC está
            // en una factura posterior. Esa mezcla no puede conservar confianza 100.
            const periodosCompatibles = __LF_qrPdfPeriodsCompatible(datosQR, datosPDF);
            const diasDifieren = datosQR.dias != null && datosPDF.dias != null && datosQR.dias !== datosPDF.dias;
            const discrepanciaPeriodo = periodosCompatibles === false
              || (periodosCompatibles === null && diasDifieren && Math.abs(datosQR.dias - datosPDF.dias) > 2);

            const datosCombinados = {
              // Potencias: del QR, si no están → del PDF
              p1: datosQR.p1 != null ? datosQR.p1 : datosPDF.p1,
              p2: datosQR.p2 != null ? datosQR.p2 : datosPDF.p2,
              
              // Consumos: del QR, si no están → del PDF
              consumoPunta: datosQR.consumoPunta != null ? datosQR.consumoPunta : datosPDF.consumoPunta,
              consumoLlano: datosQR.consumoLlano != null ? datosQR.consumoLlano : datosPDF.consumoLlano,
              consumoValle: datosQR.consumoValle != null ? datosQR.consumoValle : datosPDF.consumoValle,
              // Informativo, mismo criterio QR-primero-si-existe: el QR no suele traer un total
              // "sin reparto" (ya viene estructurado), asi que en la practica esto vendra del PDF.
              consumoTotalDetectado: datosQR.consumoTotalDetectado != null ? datosQR.consumoTotalDetectado : datosPDF.consumoTotalDetectado,
              
              // DÍAS: el QR válido manda. El PDF solo completa el campo si las
              // fechas estructuradas del QR faltan o son inválidas.
              dias: datosQR.dias != null ? datosQR.dias : datosPDF.dias,
              
              confianza: discrepanciaPeriodo ? 75 : 100,
              periodoQrPdfDiscrepante: discrepanciaPeriodo,
              diasQrPdfDifieren: diasDifieren,
              diasDeclaradosQr: diasDifieren ? datosQR.dias : null,
              diasDetectadosPdf: diasDifieren ? datosPDF.dias : null,
              fuenteDatos: qrOrigen || 'QR+PDF',
              compania: datosPDF.compania,
              companiaNombre: commercializer?.name || null,
              codigoComercializadora: datosQR.codigoComercializadora,
              qrInfo: datosQR.qrInfo
            };
            
            lfDbg('[QR] ✅ Datos combinados:', datosCombinados);
            
            // AHORA SÍ: mostrar resultados con los datos completos
            __LF_hide(__LF_q('loaderFactura'));
            __LF_show(__LF_q('resultadoFactura'));
            __LF_focusFacturaStage('resultadoFacturaTitulo');
            
            __LF_setBadge(datosCombinados.confianza);
            __LF_renderForm(datosCombinados);
            if (datosCombinados.periodoQrPdfDiscrepante || datosCombinados.diasQrPdfDifieren) {
              __LF_showContextualWarnings(datosCombinados);
            }
            if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);
            return;
          }

          // ====================================================================
          // PASO 4: FALLBACK - Parseo PDF completo (sin QR)
          // ====================================================================
          lfDbg('[QR] QR no encontrado - usando parseo PDF');
          const datos = __LF_parsearDatos(textLines, textCompact);
          datos.fuenteDatos = 'PDF';
          if (!datos.peajeNoSoportado && __LF_hasMultipleInvoicePagePeriods(pageTexts)) {
            __LF_failClosedMultipleInvoices(datos);
          }

          // AHORA SÍ: mostrar resultados con los datos completos
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));
          __LF_focusFacturaStage('resultadoFacturaTitulo');

          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Mostrar advertencias contextuales
          __LF_showContextualWarnings(datos);
          if (pdfPageWarning) __LF_appendWarn(pdfPageWarning);

        }catch(err){
          if (!__LF_isCurrentOperation(operationId) || __LF_isCancelledOperation(err)) return;
          __LF_preparePdfWorkerRetry(err);
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('uploadAreaFactura'));
          __LF_focusFacturaStage('uploadAreaFactura');
          if (typeof toast === 'function') toast('Error al procesar factura PDF', 'err');
          lfDbg('[ERROR] processPdf:', err);
        } finally {
          clearTimeout(processingWatchdog);
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
          __LF_focusFacturaStage('loaderFactura');
          __LF_hide(__LF_q('resultadoFactura'));

          const T = await __LF_loadTesseract();
          __LF_assertCurrentOperation(operationId);

          const ab = await file.arrayBuffer();
          __LF_assertCurrentOperation(operationId);
          let pdf = null;
          let ocrLoadingTask = null;
          let ocrLoadingTaskDestroyed = false;
          let tessWorker = null;
          let tessWorkerTerminated = false;
          let unregisterPdfAbort = () => {};
          let unregisterTessAbort = () => {};
          const destroyOcrLoadingTask = async () => {
            if (ocrLoadingTaskDestroyed) return;
            ocrLoadingTaskDestroyed = true;
            try{ if (ocrLoadingTask && ocrLoadingTask.destroy) await ocrLoadingTask.destroy(); }catch(_){}
          };
          const terminateTessWorker = async () => {
            if (tessWorkerTerminated) return;
            tessWorkerTerminated = true;
            try{ if (tessWorker && tessWorker.terminate) await tessWorker.terminate(); }catch(_){}
          };
          try{
            const __LF_tessOpts = {
              workerPath: __LF_assetUrl('vendor/tesseract/worker.min.js'),
              corePath: __LF_assetUrl('vendor/tesseract-core/tesseract-core.wasm.js'),
              langPath: __LF_assetUrl('vendor/tessdata/'),
              workerBlobURL: false
            };
            tessWorker = await T.createWorker('spa', undefined, __LF_tessOpts);
            unregisterTessAbort = __LF_registerOperationAborter(operationId, terminateTessWorker);
            __LF_assertCurrentOperation(operationId);

            ocrLoadingTask = window.pdfjsLib.getDocument({ data: ab, verbosity: __LF_pdfVerbosityErrors() });
            unregisterPdfAbort = __LF_registerOperationAborter(operationId, destroyOcrLoadingTask);
            pdf = await ocrLoadingTask.promise;
            __LF_assertCurrentOperation(operationId);

            let ocrText = '';
            const ocrPageTexts = [];
          const pagesToScan = Math.min(pdf.numPages, 2);

          for (let p=1; p<=pagesToScan; p++){
            const page = await pdf.getPage(p);
            let canvas = null;
            try {
              __LF_assertCurrentOperation(operationId);
              const safeViewport = __LF_getSafePdfViewport(page, 2.0);
              const viewport = safeViewport.viewport;
              canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d', { willReadFrequently:true });
              if (!ctx) throw new Error('No se pudo crear el canvas para OCR');
              canvas.width = safeViewport.width;
              canvas.height = safeViewport.height;
              const renderTask = page.render({ canvasContext: ctx, viewport });
              const unregisterRenderTask = __LF_registerOperationAborter(operationId, () => {
                try{ renderTask.cancel?.(); }catch(_){}
              });
              try {
                await renderTask.promise;
              } finally {
                unregisterRenderTask();
              }
              __LF_assertCurrentOperation(operationId);

              const { data } = await tessWorker.recognize(canvas);
              __LF_assertCurrentOperation(operationId);
              const pageOcrText = data.text || '';
              ocrText += pageOcrText + '\n';
              ocrPageTexts.push({
                textLines: pageOcrText.split('\n').map(l=>l.trim()).filter(Boolean).join('\n'),
                textCompact: pageOcrText.replace(/\s+/g,' ').trim()
              });
            } finally {
              // Limpieza best-effort para reducir retención de datos en memoria incluso si render/OCR falla.
              try{ if (page && page.cleanup) await page.cleanup(); }catch(_){}
              try{ if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove?.(); } }catch(_){}
            }
          }

          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));
          __LF_focusFacturaStage('resultadoFacturaTitulo');

          const compact = ocrText.replace(/\s+/g,' ').trim();
          const lines = ocrText.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');

          const datos = __LF_parsearDatos(lines, compact);
          datos.fuenteDatos = 'OCR';
          if (!datos.peajeNoSoportado && __LF_hasMultipleInvoicePagePeriods(ocrPageTexts)) {
            __LF_failClosedMultipleInvoices(datos);
          }
          __LF_setBadge(datos.confianza);
          __LF_renderForm(datos);

          // Retirar solo la invitacion que ya quedo obsoleta. Los avisos de
          // paginas, peaje, ambiguedad o confianza se conservan.
          const avisoOCR = __LF_q('avisoFactura');
          const avisosPreviosConservados = __LF_removeExactWarning(__LF_OCR_SCAN_INVITE);

          // Mostrar advertencias contextuales + nota de OCR
          __LF_showContextualWarnings(datos);
          __LF_restoreWarningHtml(avisosPreviosConservados);
          
          if (avisoOCR && avisoOCR.textContent){
            avisoOCR.textContent = '🧠 OCR aplicado. ' + avisoOCR.textContent;
          } else {
            __LF_warn('🧠 OCR aplicado. Revisa con cuidado antes de aplicar.');
          }


          } finally {
            unregisterPdfAbort();
            unregisterTessAbort();
            try{ if (pdf && pdf.cleanup) await pdf.cleanup(); }catch(_){/* noop */}
            // pdf.js 6.x elimina PDFDocumentProxy.destroy(); liberar via loadingTask
            await destroyOcrLoadingTask();
            await terminateTessWorker();
          }
        }catch(err){
          if (!__LF_isCurrentOperation(operationId) || __LF_isCancelledOperation(err)) return;
          __LF_hide(__LF_q('loaderFactura'));
          __LF_show(__LF_q('resultadoFactura'));
          __LF_focusFacturaStage('resultadoFacturaTitulo');
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
        const formPeaje = __LF_q('formValidacionFactura');
        const peajeBloqueado = formPeaje?.dataset?.peajeNoSoportado || null;
        if (peajeBloqueado) {
          if (typeof toast === 'function') {
            toast(`No se puede aplicar una factura ${peajeBloqueado}: el comparador solo modela 2.0TD`, 'err');
          }
          return;
        }

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
        const maxKw = (cfg?.POTENCIA_MAX_KW != null) ? cfg.POTENCIA_MAX_KW : 15;
        // Mantener el mismo dominio que el formulario principal y el peaje 2.0TD.
        // P1 puede ser 0 kW (p. ej. segundo suministro dedicado a recarga de VE);
        // P2 sigue siendo positiva. No imponer un suelo arbitrario de 0,5 kW.
        if (v.p1 == null || v.p1 < 0 || v.p1 > maxKw){ ok=false; __LF_markErr('p1', true); } else __LF_markErr('p1', false);
        if (v.p2 == null || v.p2 <= 0 || v.p2 > maxKw){ ok=false; __LF_markErr('p2', true); } else __LF_markErr('p2', false);

        if (v.dias == null || !Number.isInteger(v.dias) || v.dias < 1 || v.dias > 370){ ok=false; __LF_markErr('dias', true); } else __LF_markErr('dias', false);

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

        // 15/08/2026, residual detectado por ChatGPT (novena ronda, 4a revision): estos set()
        // asignan .value directamente, sin disparar 'input', asi que ni markPending() ni
        // state.generation se enteraban de este cambio economico. Si ya habia un calculo en
        // vuelo con los valores VIEJOS, ese calculo podia terminar y limpiar "pending" como si
        // el resultado siguiera vigente, aunque el formulario ya mostrara los datos nuevos de
        // la factura. Bump explicito, igual que hace cualquier listener de input real.
        if (typeof window.markPending === 'function') window.markPending();

        try{ if (typeof updateKwhHint === 'function') updateKwhHint(); }catch(_){}
        try{ if (typeof validateInputs === 'function') validateInputs(); }catch(_){}
        try{ if (typeof saveInputs === 'function') saveInputs(); }catch(_){}

        const importQrTarifaRequested = __LF_q('usarPreciosQrMiTarifa')?.checked === true;
        const importQrTarifaApplied = importQrTarifaRequested
          && Boolean(__LF_lastQrCustomTarifaPrices)
          && typeof window.LF?.applyCustomTarifaPrices === 'function'
          && window.LF.applyCustomTarifaPrices(__LF_lastQrCustomTarifaPrices);

        // Si "Comparar con mi tarifa actual" está marcado, avisar que debe rellenar precios
        const compararMiTarifa = document.getElementById('compararMiTarifa');
        
        if (importQrTarifaApplied) {
          if (typeof toast === 'function') {
            toast('✅ Datos y precios aplicados como “Mi tarifa”', 'ok');
          }
        } else if (importQrTarifaRequested) {
          if (typeof toast === 'function') {
            toast('Los datos se aplicaron, pero no pude trasladar los precios a “Mi tarifa”', 'err');
          }
        } else if (compararMiTarifa && compararMiTarifa.checked) {
          if (typeof toast === 'function') {
            toast('✅ Datos aplicados. Rellena los PRECIOS de tu tarifa manualmente', 'ok');
          }
        } else if (typeof toast === 'function') {
          // Si NO tiene "Mi tarifa" marcado, toast normal
          toast('✅ Datos aplicados correctamente', 'ok');
        }

        const confidencePct = Math.max(0, Math.min(100, Number(__LF_lastParsedConfianza || 0)));

        // Una "Mi tarifa" ya activa sigue requiriendo revisión para no mezclar precios
        // manuales anteriores con la factura nueva. La única excepción es el opt-in del QR:
        // sus cinco precios proceden del mismo documento y applyCustomTarifaPrices ya los
        // ha validado, normalizado y persistido antes de llegar a este punto.
        const customTarifaActiva = Boolean(compararMiTarifa?.checked);
        const customTarifaNeedsReview = importQrTarifaRequested
          ? !importQrTarifaApplied
          : customTarifaActiva;
        const exTotalVal = __LF_normNum(document.getElementById('exTotal')?.value);
        const bvSaldoVal = __LF_normNum(document.getElementById('bvSaldo')?.value);
        const solarStateNotParsed = Boolean(document.getElementById('solarOn')?.checked) &&
          ((exTotalVal != null && exTotalVal > 0) || (bvSaldoVal != null && bvSaldoVal > 0));

        const importedSolarNeedsReview = importQrTarifaApplied && Boolean(document.getElementById('solarOn')?.checked);
        const shouldAutoCalc = confidencePct >= 99.5
          && !customTarifaNeedsReview
          && !solarStateNotParsed
          && !importedSolarNeedsReview;

        // ✅ PRIVACIDAD: una vez aplicados los datos, ya no necesitamos retener el PDF
        __LF_lastFile = null;

        if (window.LF.cancelRender) window.LF.cancelRender();

        __LF_closeModal();

        hideResultsToInitialState();

        if (shouldAutoCalc){
          setStatus('Calculando...', 'loading');
          runCalculation();
        } else if (importedSolarNeedsReview) {
          setStatus('Hemos importado los precios de energía y potencia. Revisa la compensación solar y la batería virtual antes de calcular.', 'idle');
        } else if (customTarifaNeedsReview) {
          setStatus('Hemos rellenado los datos de la factura. Revisa los precios de "Mi tarifa" antes de calcular.', 'idle');
        } else if (solarStateNotParsed) {
          setStatus('Hemos rellenado los datos de la factura. Revisa tus excedentes y saldo de batería virtual antes de calcular.', 'idle');
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
