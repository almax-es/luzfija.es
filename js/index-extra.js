/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// index-extra.js
// Scripts extraídos de index.html para mejorar cacheo, mantenimiento y facilitar CSP.
(function () {
  'use strict';

  // ===== PVPC: lectura desde dataset estático (data/pvpc) =====
  const PVPC_DATASET_BASE = window.PVPC_DATASET_BASE || '/data/pvpc';
  const SURPLUS_DATASET_BASE = window.SURPLUS_DATASET_BASE || '/data/surplus';

  // Cache en memoria de ficheros mensuales {key: `${base}/${geo}/${YYYY-MM}`}
  const __pvpcMonthCache = new Map();

  function __pvpcContextFromZona(zonaRaw) {
    const zona = String(zonaRaw || '').toLowerCase();
    if (zona.includes('canarias')) return { geo: 8742, tz: 'Atlantic/Canary' };
    if (zona.includes('ceutamelilla')) return { geo: 8744, tz: 'Europe/Madrid' };
    return { geo: 8741, tz: 'Europe/Madrid' }; // Península y Baleares
  }

  function __pvpcGetLiveZonaFiscal() {
    const select = document.getElementById('zonaFiscal') || window.LF?.el?.inputs?.zonaFiscal;
    const value = select && typeof select.value === 'string' ? select.value : '';
    return value || null;
  }

  function __pvpcGetSavedZonaFiscal() {
    try {
      const raw = localStorage.getItem('almax_comparador_v6_inputs');
      if (!raw) return null;
      const v = JSON.parse(raw);
      return (v && typeof v.zonaFiscal === 'string' && v.zonaFiscal) ? v.zonaFiscal : null;
    } catch (_) {
      return null;
    }
  }

  function __pvpcGetUserContext() {
    // Priorizar el valor visible del formulario; si no está disponible,
    // usar el último estado guardado como fallback.
    return __pvpcContextFromZona(__pvpcGetLiveZonaFiscal() || __pvpcGetSavedZonaFiscal());
  }

  function __pvpcYmdInTZ(dateObj, tz) {
    // Formato YYYY-MM-DD en la TZ indicada (evita bugs UTC)
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dateObj);
  }

  function __pvpcAddDaysYMD(ymd, days) {
    // ymd en formato YYYY-MM-DD -> ymd+days (en calendario, sin TZ)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return ymd;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d + days, 0, 0, 0));
    return dt.toISOString().slice(0, 10);
  }

  function __pvpcBuildQuickViewKey(type = 'pvpc', now = new Date()) {
    const ctx = __pvpcGetUserContext();
    const tz = type === 'surplus' ? 'Europe/Madrid' : ctx.tz;
    return [type, ctx.geo, tz, __pvpcYmdInTZ(now, tz)].join('|');
  }

  window.LF = window.LF || {};
  window.LF.indexExtraPvpcHelpers = Object.assign({}, window.LF.indexExtraPvpcHelpers, {
    getUserContext: __pvpcGetUserContext,
    getLiveZonaFiscal: __pvpcGetLiveZonaFiscal,
    getSavedZonaFiscal: __pvpcGetSavedZonaFiscal,
    buildQuickViewKey: __pvpcBuildQuickViewKey,
    fetchDay: __pvpcFetchDay
  });

  function __pvpcFetchJsonWithDeadline(url, options = {}, timeoutMs = 15000) {
    // Esta vista rapida conserva el contrato historico de fetch(url, {cache:'no-cache'}):
    // varios consumidores/tests observan esas opciones exactas. El deadline cubre fetch +
    // response.json() mediante una carrera; no aborta el request subyacente, pero la UI deja
    // de esperarlo y la promesa rechazada se purga de la cache para permitir reintento.
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(`Dataset timeout: ${url}`);
        error.name = 'AbortError';
        reject(error);
      }, timeoutMs);
    });
    const request = fetch(url, options).then(async (response) => {
      if (!response || !response.ok) return { response, data: null };
      return { response, data: await response.json() };
    });
    return Promise.race([request, timeout]).finally(() => clearTimeout(timeoutId));
  }

  async function __pvpcLoadMonth(base, geo, yyyyMM, forceRefresh = false) {
    const key = `${base}/${geo}/${yyyyMM}`;
    if (!forceRefresh && __pvpcMonthCache.has(key)) return __pvpcMonthCache.get(key);

    const url = `${base}/${geo}/${yyyyMM}.json`;
    const p = __pvpcFetchJsonWithDeadline(url, { cache: 'no-cache' }).then(({ response, data }) => {
      if (!response || !response.ok) {
        throw new Error(`Dataset no disponible: ${url} (${response ? response.status : 'unknown'})`);
      }
      return data;
    });

    // Purgar fallos de la cache para que el siguiente intento vuelva a pedir el fichero;
    // solo si la entrada sigue siendo esta promesa (un reintento posterior no debe borrarse).
    p.catch(() => {
      if (__pvpcMonthCache.get(key) === p) __pvpcMonthCache.delete(key);
    });

    __pvpcMonthCache.set(key, p);
    return p;
  }

  function __pvpcMonthIdentityUsable(month, base, geo, tz) {
    if (!month || typeof month !== 'object' || Array.isArray(month)) return false;
    const isSurplus = base === SURPLUS_DATASET_BASE;
    const expectedIndicator = isSurplus ? 1739 : 1001;
    const expectedTimeZone = isSurplus ? null : tz;
    const validator = window.LF?.csvUtils?.validateStaticPriceDatasetIdentity;
    if (typeof validator === 'function') {
      return validator(month, {
        expectedGeoId: Number(geo),
        expectedIndicator,
        expectedTimeZone,
        allowMissingFields: true
      }).ok;
    }

    // index-extra puede evaluarse antes que lf-csv-utils en pruebas/cargas parciales.
    // En ese caso no se pierde el hardening principal: metadata presente y contradictoria
    // se rechaza; campos ausentes conservan compatibilidad con payloads v2 ya aceptados.
    if (month.geo_id != null && Number(month.geo_id) !== Number(geo)) return false;
    if (month.indicator != null && Number(month.indicator) !== expectedIndicator) return false;
    if (month.unit != null && month.unit !== 'EUR/kWh') return false;
    if (month.epoch_unit != null && month.epoch_unit !== 's') return false;
    if (expectedTimeZone && month.timezone != null && month.timezone !== expectedTimeZone) return false;
    return true;
  }

  function __pvpcDayPairsUsable(dayPairs, dateStr, tz) {
    if (!Array.isArray(dayPairs) || dayPairs.length < 23 || dayPairs.length > 25) return false;
    let previousTs = null;
    for (const pair of dayPairs) {
      if (!Array.isArray(pair)) return false;
      const ts = pair[0];
      const price = pair[1];
      if (typeof ts !== 'number' || !Number.isFinite(ts) || typeof price !== 'number' || !Number.isFinite(price)) return false;
      if (__pvpcYmdInTZ(new Date(ts * 1000), tz) !== dateStr) return false;
      if (previousTs !== null && ts - previousTs !== 3600) return false;
      previousTs = ts;
    }
    const firstTs = dayPairs[0][0];
    const lastTs = dayPairs[dayPairs.length - 1][0];
    if (__pvpcYmdInTZ(new Date((firstTs - 3600) * 1000), tz) === dateStr) return false;
    if (__pvpcYmdInTZ(new Date((lastTs + 3600) * 1000), tz) === dateStr) return false;
    return true;
  }

  function __pvpcBuildEntries(dayPairs, tz) {
    // dayPairs: [[epoch_s_utc, price], ...]
    const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
    const hours = dayPairs.map(p => Number(hourFmt.format(new Date(p[0] * 1000))));

    // Detectar horas repetidas (cambio de hora, 25h)
    const totalByHour = {};
    hours.forEach(h => { totalByHour[h] = (totalByHour[h] || 0) + 1; });

    const seenByHour = {};
    const entries = dayPairs.map((p, idx) => {
      const epoch = Number(p[0]);
      const price = Number(p[1]);
      const hour = hours[idx];

      const total = totalByHour[hour] || 1;
      const seen = (seenByHour[hour] || 0) + 1;
      seenByHour[hour] = seen;

      const hh = String(hour).padStart(2, '0');
      const label = total > 1 ? `${hh}:00 (${seen})` : `${hh}:00`;

      return { epoch, price, hour, label };
    });

    return entries;
  }

  function __pvpcFindNowIndex(entries) {
    // Devuelve el índice del periodo vigente (epoch <= now < next), robusto ante DST.
    const now = Math.floor(Date.now() / 1000);
    let idx = 0;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].epoch <= now) idx = i;
      else break;
    }
    return idx;
  }

  async function __pvpcFetchDay(dateStr, ctx, base = PVPC_DATASET_BASE) {
    // Devuelve: { entries, tz, geo }
    // Carga desde dataset estático en /data/{type}/{geo}/{YYYY-MM}.json
    const geo = (ctx && ctx.geo != null) ? ctx.geo : 8741;
    const tz = (ctx && ctx.tz != null) ? ctx.tz : 'Europe/Madrid';

    const yyyyMM = dateStr.slice(0, 7);
    let month = await __pvpcLoadMonth(base, geo, yyyyMM);
    let identityOk = __pvpcMonthIdentityUsable(month, base, geo, tz);
    let dayPairs = identityOk && month?.days ? month.days[dateStr] : undefined;
    if (!identityOk || !__pvpcDayPairsUsable(dayPairs, dateStr, tz)) {
      // El mes cacheado puede ser anterior a la publicación de este día (pestaña que
      // cruza la medianoche, precios de mañana ~20:15) o contener un payload 200
      // incompleto/malformado. Un único refetch evita convertir ese estado en una
      // caché pegajosa del modal. La identidad forma parte del mismo commit: un mes
      // completo de otra zona/indicador nunca puede publicarse bajo la cabecera actual.
      month = await __pvpcLoadMonth(base, geo, yyyyMM, true);
      identityOk = __pvpcMonthIdentityUsable(month, base, geo, tz);
      dayPairs = identityOk && month?.days ? month.days[dateStr] : undefined;
    }
    if (!identityOk || !__pvpcDayPairsUsable(dayPairs, dateStr, tz)) {
      // Marcado explicito: "el dia no esta publicado" es un estado NORMAL (los precios de
      // manhana salen sobre las 20:15). Sin esta marca, quien lo captura no puede separarlo
      // de un fallo de red real, y ambos acababan ocultando la pestanha en silencio.
      const sinDatos = new Error('Sin datos (dataset estático)');
      sinDatos.__lfPvpcDiaNoPublicado = true;
      throw sinDatos;
    }
    const entries = __pvpcBuildEntries(dayPairs, tz);
    return { entries, tz, geo };
  }

  // Setup modal PVPC con tabs Hoy/Mañana y grid 2 columnas
  document.addEventListener('DOMContentLoaded', () => {
    const btnPVPCInfo = document.getElementById('btnPVPCInfo');
    const modalPVPCInfo = document.getElementById('modalPVPCInfo');
    const btnCerrarPVPCInfo = document.getElementById('btnCerrarPVPCInfo');
    const btnCerrarPVPCX = document.getElementById('btnCerrarPVPCX');
      const tabHoy = document.getElementById('tabHoy');
      const tabManana = document.getElementById('tabManana');
      const pvpcTypeSelector = document.getElementById('pvpcTypeSelector');
      const modalPVPCTitleText = document.getElementById('modalPVPCTitleText');
      const modalPVPCTypeIcon = document.getElementById('modalPVPCTypeIcon');
      const modalPVPCHeadline = document.getElementById('modalPVPCHeadline');

    if (!btnPVPCInfo || !modalPVPCInfo || !btnCerrarPVPCInfo) {
      if (window.__LF_DEBUG) console.log('[PVPC] Faltan elementos del modal');
      return;
    }


      let pvpcHoy = null;
      let pvpcManana = null;
      let pvpcCacheKey = null;
      let modalType = 'pvpc';
      let diaActivo = 'hoy';
      // Token de tipo (PVPC/Excedentes): cargarHoy()/cargarManana() son async y pueden
      // solaparse si el usuario cambia el selector antes de que la carga anterior termine.
      // Sin esto, una respuesta VIEJA (del tipo ya abandonado) puede resolver despues de la
      // NUEVA y sobrescribir pvpcHoy/pvpcManana con datos del tipo equivocado bajo la
      // cabecera del tipo actual.
      let __pvpcTypeToken = 0;
    let __pvpcLocked = false;
    let __pvpcLockToken = null;
    let __pvpcFallbackState = null;
      function __pvpcLock(){
        if (__pvpcLocked) return;
        const shared = window.LF?.modalScrollLock;
        if (shared && typeof shared.lock === 'function') {
          __pvpcLockToken = shared.lock('pvpc');
        } else {
          const body = document.body;
          const html = document.documentElement;
          __pvpcFallbackState = {
            scrollTop: Number(body?.scrollTop) || 0,
            bodyOverflow: body?.style?.overflow || '',
            htmlOverflow: html?.style?.overflow || ''
          };
          if (body?.style) body.style.overflow = 'hidden';
          if (html?.style) html.style.overflow = 'hidden';
        }
        __pvpcLocked = true;
      }

      function getModalConfig(type) {
        if (type === 'surplus') {
          return {
            base: SURPLUS_DATASET_BASE,
            title: 'Excedentes - Precios por hora',
            icon: '☀️',
            headline: 'Precio de excedentes (autoconsumo)',
            showComments: false,
            tzOverride: 'Europe/Madrid'
          };
        }
        return {
          base: PVPC_DATASET_BASE,
          title: 'PVPC - Precios por hora',
          icon: '⚡',
          headline: 'Precio regulado de la luz',
          showComments: true,
          tzOverride: null
        };
      }

      function applyModalType(type) {
        modalType = type;
        const cfg = getModalConfig(modalType);
        if (modalPVPCTitleText) modalPVPCTitleText.textContent = cfg.title;
        if (modalPVPCTypeIcon) modalPVPCTypeIcon.textContent = cfg.icon;
        if (modalPVPCHeadline) modalPVPCHeadline.textContent = cfg.headline;
      }

      function resetModalData() {
        pvpcHoy = null;
        pvpcManana = null;
        diaActivo = 'hoy';
        // El boton "Mañana" solo se muestra cuando cargarManana() tiene datos (mas abajo);
        // sin este reset, cambiar de tipo/zona a un estado que TODAVIA no tiene "mañana"
        // dejaba el boton visible de la carga anterior, aunque pvpcManana ya sea null.
        const tabManana = document.getElementById('tabManana');
        if (tabManana) tabManana.style.display = 'none';
        // Invalida cualquier cargarHoy()/cargarManana() todavia en vuelo de un estado
        // anterior (cambio de tipo PVPC/Excedentes, o de zona/cache key): su respuesta, si
        // llega despues, se descarta en vez de escribir sobre el estado actual.
        __pvpcTypeToken++;
      }
    function __pvpcUnlock(){
      if (!__pvpcLocked) return;
      const shared = window.LF?.modalScrollLock;
      if (__pvpcLockToken && shared && typeof shared.unlock === 'function') {
        shared.unlock(__pvpcLockToken);
      } else if (__pvpcFallbackState) {
        if (document.body?.style) document.body.style.overflow = __pvpcFallbackState.bodyOverflow;
        if (document.documentElement?.style) document.documentElement.style.overflow = __pvpcFallbackState.htmlOverflow;
        if (document.body) document.body.scrollTop = __pvpcFallbackState.scrollTop;
      }
      __pvpcLockToken = null;
      __pvpcFallbackState = null;
      __pvpcLocked = false;
    }


    // Cargar precios de HOY
      async function cargarHoy() {
        const myTypeToken = __pvpcTypeToken;
        try {
          const __ctx = __pvpcGetUserContext();
          const cfg = getModalConfig(modalType);
          const tz = cfg.tzOverride || __ctx.tz;
          const fechaStr = __pvpcYmdInTZ(new Date(), tz);

          const day = await __pvpcFetchDay(fechaStr, { ...__ctx, tz }, cfg.base);
          // El usuario cambio de tipo (PVPC/Excedentes) mientras esta peticion estaba en
          // vuelo: descartar la respuesta, ya es de un tipo abandonado.
          if (myTypeToken !== __pvpcTypeToken) return;
          const entries = day.entries;
        const precios = entries.map(e => e.price);

        const nowIdx = __pvpcFindNowIndex(entries);

        const precioMin = Math.min(...precios);
        const precioMax = Math.max(...precios);
        const idxMin = precios.indexOf(precioMin);
        const idxMax = precios.indexOf(precioMax);

        pvpcHoy = {
          entries,
          tz: day.tz,
          geo: day.geo,
          nowIdx,
          precioActual: entries[nowIdx] ? entries[nowIdx].price : undefined,
          precioMin,
          precioMax,
          idxMin,
          idxMax
        };
      } catch (e) {
        console.error('[PVPC] Error hoy:', e);
      }
    }

    // Cargar precios de MAÑANA (si están disponibles en el dataset estático)
      async function cargarManana() {
        const myTypeToken = __pvpcTypeToken;
        try {
          const __ctx = __pvpcGetUserContext();
          const cfg = getModalConfig(modalType);
          const tz = cfg.tzOverride || __ctx.tz;

          const avisoPrevio = document.getElementById('pvpcMananaAviso');
          if (avisoPrevio) {
            avisoPrevio.textContent = '';
            avisoPrevio.style.display = 'none';
          }

          // Mañana en la TZ del usuario
          const hoyStr = __pvpcYmdInTZ(new Date(), tz);
          const fechaStr = __pvpcAddDaysYMD(hoyStr, 1);

          // Intentar cargar. Si no existe (aún no publicado/actualizado), salimos sin error visible.
          const day = await __pvpcFetchDay(fechaStr, { ...__ctx, tz }, cfg.base);
          // Mismo motivo que en cargarHoy(): descartar respuestas de un tipo abandonado.
          if (myTypeToken !== __pvpcTypeToken) return;
          const entries = day.entries;
        const precios = entries.map(e => e.price);

        const precioMin = Math.min(...precios);
        const precioMax = Math.max(...precios);
        const idxMin = precios.indexOf(precioMin);
        const idxMax = precios.indexOf(precioMax);

        pvpcManana = {
          entries,
          tz: day.tz,
          geo: day.geo,
          precioMin,
          precioMax,
          idxMin,
          idxMax
        };

        // Mostrar el botón de mañana si se cargaron los datos
        const tabManana = document.getElementById('tabManana');
        if (tabManana) tabManana.style.display = 'block';
      } catch (e) {
        // Dia aun no publicado: estado normal, sin aviso (la pestanha simplemente no aparece).
        // Cualquier otro error (red, timeout, HTTP no-ok, dataset corrupto) SI se avisa: de lo
        // contrario "manhana todavia no esta" y "no he podido cargarlo" se ven identicos.
        if (window.__LF_DEBUG) console.log('[PVPC] Mañana no disponible:', (e && e.message) || e);
        if (!(e && e.__lfPvpcDiaNoPublicado) && myTypeToken === __pvpcTypeToken) {
          const aviso = document.getElementById('pvpcMananaAviso');
          if (aviso) {
            aviso.textContent = 'No he podido comprobar los precios de mañana. Cierra y vuelve a abrir para reintentarlo.';
            aviso.style.display = 'block';
          }
        }
      }
    }

    // Función para obtener comentario gracioso
    function getComentario(precio, hora, precioMin, precioMax) {
      const rango = precioMax - precioMin;
      const umbralBajo = precioMin + (rango * 0.25);
      const umbralAlto = precioMax - (rango * 0.25);

      if (precio === precioMin) {
        return ["🌟 <strong>HORA MÁS BARATA</strong> - Esto es una ganga", "💰 <strong>CHOLLO MÁXIMO</strong> - ¡A cargar todo!", "🎉 <strong>PRECIO MÍNIMO</strong> - Aprovecha ahora"][hora % 3];
      }
      if (precio === precioMax) {
        return ["🔴 <strong>HORA MÁS CARA</strong> - Modo supervivencia", "💸 <strong>PRECIO MÁXIMO</strong> - Apaga hasta la nevera", "⛔ <strong>CARÍSIMO</strong> - Netflix y a oscuras", "🕯️ <strong>RÉCORD</strong> - Velas románticas obligatorias"][hora % 4];
      }
      if (precio < umbralBajo) {
        return ["🧺 Pon la lavadora - Ahorro garantizado", "🔋 Carga el coche eléctrico - Precio ideal", "💦 Lavavajillas a full - Aprovecha", "🌡️ Termo eléctrico al máximo", "❄️ Haz cubitos de hielo para todo el mes", "🍳 Cocina en batch para toda la semana", "💨 Secadora sin remordimientos", "⚡ Máxima potencia - No mires el contador", "🎮 Gaming intensivo sin culpa"][hora % 9];
      }
      if (precio > umbralAlto) {
        return ["⚠️ Evita consumos grandes - Ahorra", "🚫 Nada de hornos ni secadoras", "💡 Modo ahorro activado", "⛔ Solo lo imprescindible", "🕯️ Ambiente romántico obligatorio", "📱 Móvil en modo avión (bueno, casi)", "🥶 Apaga la calefacción, ponte un jersey", "🌙 Mejor una siesta que gastar luz"][hora % 8];
      }
      if (hora >= 0 && hora < 6) return "💤 A dormir mientras ahorras";
      if (hora >= 6 && hora < 9) return "☕ Buenos días - Precio razonable";
      if (hora >= 14 && hora < 17) return "☀️ Ideal para placas solares";
      if (hora >= 22) return "🌙 Buenas noches - Todo tranquilo";
      return "📺 Consumos normales OK";
    }

    // Renderizar lista (grid 2 columnas)
    function renderizarLista(datos, esHoy) {
      const { entries, nowIdx, precioActual, precioMin, precioMax, idxMin, idxMax } = datos;

      // Actualizar cabecera
      if (esHoy) {
        document.getElementById('modalPVPCLabel').textContent = 'Ahora';
        document.getElementById('modalPVPCNow').textContent = `${precioActual.toFixed(3).replace('.', ',')} €/kWh`;
        const labelNow = (entries && entries[nowIdx] && entries[nowIdx].label) || '--:--';
        document.getElementById('modalPVPCNowHour').textContent = `${labelNow}h`;
      } else {
        document.getElementById('modalPVPCLabel').textContent = 'Mañana';
        document.getElementById('modalPVPCNow').textContent = 'Precios del día siguiente';
        document.getElementById('modalPVPCNowHour').textContent = '';
      }

      const labelMin = (entries && entries[idxMin] && entries[idxMin].label) || '--:--';
      const labelMax = (entries && entries[idxMax] && entries[idxMax].label) || '--:--';

      document.getElementById('modalPVPCMin').textContent = `${precioMin.toFixed(3).replace('.', ',')}`;
      document.getElementById('modalPVPCMinHour').textContent = `${labelMin}h`;
      document.getElementById('modalPVPCMax').textContent = `${precioMax.toFixed(3).replace('.', ',')}`;
      document.getElementById('modalPVPCMaxHour').textContent = `${labelMax}h`;

      // Grid 2 columnas
      const rango = precioMax - precioMin;
      let col1 = '', col2 = '';

      // === NUEVO LINK OBSERVATORIO (ARRIBA) ===
      const observatorioLink = `
        <div style="margin-bottom: 20px;">
          <a href="/estadisticas/" style="display: flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: white; padding: 12px 20px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 14px; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25); transition: transform 0.2s, box-shadow 0.2s;">
            <span style="font-size: 18px;">📊</span>
            <span>Ver Observatorio Histórico y Tendencias</span>
            <span style="opacity: 0.8;">→</span>
          </a>
        </div>
      `;

        const cfg = getModalConfig(modalType);
        entries.forEach((e, idx) => {
        const precio = e.price;
        const hora = e.hour;   // hora local (0-23), puede repetirse en DST
        const horaLabel = e.label;

        const isNow = esHoy && idx === nowIdx;
        const porcentaje = rango > 0 ? ((precio - precioMin) / rango) * 100 : 50;

        let color = '#eab308';
        if (precio === precioMin) color = '#10b981';
        else if (precio === precioMax) color = '#ef4444';
        else if (precio < precioMin + rango * 0.33) color = '#22c55e';
        else if (precio > precioMax - rango * 0.33) color = '#f97316';

          const comentario = cfg.showComments ? getComentario(precio, hora, precioMin, precioMax) : '';
          const comentarioHtml = cfg.showComments
            ? `${isNow ? '<strong style="color: var(--accent); font-size: 10px;">← AHORA</strong> • ' : ''}${comentario}`
            : (isNow ? '<strong style="color: var(--accent); font-size: 10px;">← AHORA</strong>' : '');

        const item = `
          <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.06); ${isNow ? 'background: rgba(255,180,50,.06); border-bottom: 1px solid rgba(255,180,50,.2);' : ''}" data-is-now="${isNow ? 'true' : 'false'}">
            <div style="display: grid; grid-template-columns: 64px 1fr 80px; gap: 8px; align-items: center;">
              <div style="font-weight: 700; font-size: ${isNow ? '14px' : '13px'}; color: ${isNow ? 'var(--accent)' : 'var(--text)'};">
                ${horaLabel}
              </div>
              <div style="height: 6px; background: rgba(255,255,255,.08); border-radius: 999px; overflow: hidden;">
                <div style="height: 100%; width: ${porcentaje}%; background: ${color}; border-radius: 999px;"></div>
              </div>
              <div class="u-fw-700 u-text-right u-text-12">
                ${precio.toFixed(3).replace('.', ',')}
              </div>
            </div>
            <div style="font-size: 11px; color: var(--muted); margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.03); line-height: 1.3;">
                ${comentarioHtml}
              </div>
            </div>
          `;

        if (hora < 12) col1 += item;
        else col2 += item;
      });

      const html = `
        ${observatorioLink}
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>${col1}</div>
          <div>${col2}</div>
        </div>
      `;

      const lista = document.getElementById('modalPVPCHoursList');
      if (lista) {
        lista.innerHTML = html;
        lista.scrollTop = 0;
      }

      // Forzar scroll a arriba de forma múltiple para asegurar que funciona
      const forceScrollTop = () => {
        try {
          if (lista) lista.scrollTop = 0;
          const modalContent = modalPVPCInfo.querySelector('.modal-content');
          if (modalContent) modalContent.scrollTop = 0;
          modalPVPCInfo.scrollTop = 0;
        } catch (_) {}
      };

      // Ejecutar varias veces para evitar que el navegador haga scroll automático
      forceScrollTop();
      requestAnimationFrame(() => {
        forceScrollTop();
        setTimeout(forceScrollTop, 50);
      });
    }

    // Cambiar tab
    function cambiarTab(tab) {
      diaActivo = tab;

      // Estilos tabs
      if (tab === 'hoy') {
        tabHoy.style.background = 'var(--accent)';
        tabHoy.style.color = '#fff';
        tabHoy.classList.add('pvpc-tab-active', 'active');
        tabManana.style.background = 'transparent';
        tabManana.style.color = 'var(--text)';
        tabManana.classList.remove('pvpc-tab-active', 'active');
        if (pvpcHoy) renderizarLista(pvpcHoy, true);
      } else {
        tabHoy.style.background = 'transparent';
        tabHoy.style.color = 'var(--text)';
        tabHoy.classList.remove('pvpc-tab-active', 'active');
        tabManana.style.background = 'var(--accent)';
        tabManana.style.color = '#fff';
        tabManana.classList.add('pvpc-tab-active', 'active');
        if (pvpcManana) renderizarLista(pvpcManana, false);
      }
    }

      if (tabHoy) tabHoy.addEventListener('click', () => cambiarTab('hoy'));
      if (tabManana) tabManana.addEventListener('click', () => cambiarTab('manana'));

      if (pvpcTypeSelector) {
        pvpcTypeSelector.addEventListener('change', async () => {
          applyModalType(pvpcTypeSelector.value || 'pvpc');
          resetModalData();
          pvpcCacheKey = null;
          document.getElementById('modalPVPCHoursList').innerHTML = '<p class="u-loading-text">⏳ Cargando...</p>';
          await cargarHoy();
          await cargarManana();
          if (pvpcHoy) cambiarTab('hoy');
        });
        applyModalType(pvpcTypeSelector.value || 'pvpc');
      }

      const zonaFiscal = document.getElementById('zonaFiscal') || window.LF?.el?.inputs?.zonaFiscal;
      if (zonaFiscal && zonaFiscal.dataset.pvpcModalSyncBound !== '1') {
        zonaFiscal.dataset.pvpcModalSyncBound = '1';
        zonaFiscal.addEventListener('change', () => {
          resetModalData();
          pvpcCacheKey = null;
        });
      }

    // Abrir modal
    let elementoAnterior = null;
    let modalAbriendo = false;
    let modalHideTimer = 0;
    let modalFocusTimer = 0;
    let modalOpenSeq = 0;

    const modalCloseDelay = () => {
      const reduce = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      return reduce ? 0 : 300;
    };

    const focusNoScroll = (el) => {
      if (!el || typeof el.focus !== 'function') return;
      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    };

    btnPVPCInfo.addEventListener('click', async (e) => {
      // Prevenir comportamiento por defecto y propagación
      e.preventDefault();
      e.stopPropagation();

      // Prevenir doble clic mientras se está abriendo
      if (modalAbriendo || modalPVPCInfo.classList.contains('show')) return;
      modalAbriendo = true;
      const myOpenSeq = ++modalOpenSeq;

      // Un cierre anterior puede tener pendiente el display:none visual. Si el
      // modal se reabre antes de que venza, ese timer nunca debe cerrar la nueva
      // apertura.
      if (modalHideTimer) {
        clearTimeout(modalHideTimer);
        modalHideTimer = 0;
      }

      // Guardar elemento que tenía focus para restaurarlo después
      elementoAnterior = document.activeElement;

      // Mostrar modal inmediatamente (display: flex para que sea visible)
        modalPVPCInfo.style.display = 'flex';
        modalPVPCInfo.setAttribute('aria-hidden', 'false');

        // Diferir la clase .show y el trabajo pesado al siguiente frame
        // para que el navegador pinte la caja del modal antes (mejora INP)
        requestAnimationFrame(() => {
          if (myOpenSeq !== modalOpenSeq || modalPVPCInfo.getAttribute('aria-hidden') === 'true') return;
          const nextCacheKey = __pvpcBuildQuickViewKey(modalType);
          if (pvpcCacheKey !== nextCacheKey) {
            resetModalData();
            pvpcCacheKey = nextCacheKey;
          }
          modalPVPCInfo.classList.add('show');
          __pvpcLock();
          // El foco debe entrar en el diálogo al abrirse, sin depender de que
          // terminen las cargas PVPC. Con red lenta/atascada, esperar a cargar
          // dejaba el foco detrás de un aria-modal visible.
          focusNoScroll(btnCerrarPVPCX || btnCerrarPVPCInfo);

        // Scroll a arriba
        modalPVPCInfo.scrollTop = 0;
        const modalContent = modalPVPCInfo.querySelector('.modal-content');
        if (modalContent) modalContent.scrollTop = 0;

        // Cargar datos en la siguiente microtarea
        (async () => {
          if (!pvpcHoy) {
            document.getElementById('modalPVPCHoursList').innerHTML = '<p class="u-loading-text">⏳ Cargando...</p>';
            await cargarHoy();
            await cargarManana();
            if (myOpenSeq !== modalOpenSeq || modalPVPCInfo.getAttribute('aria-hidden') === 'true') return;
            if (pvpcHoy) {
              cambiarTab(diaActivo);
            } else {
              document.getElementById('modalPVPCHoursList').innerHTML = '<p class="u-loading-text">❌ Error al cargar precios. Inténtalo de nuevo.</p>';
            }
          } else {
            cambiarTab(diaActivo);
          }

          // Scroll arriba tras carga
          const forceScroll = () => {
            modalPVPCInfo.scrollTop = 0;
            if (modalContent) modalContent.scrollTop = 0;
            const lista = document.getElementById('modalPVPCHoursList');
            if (lista) lista.scrollTop = 0;
          };
          forceScroll();
          requestAnimationFrame(forceScroll);

          // Mantener la temporización histórica que habilita el cierre por
          // backdrop y libera el estado "abriendo", pero sin volver a robar
          // el foco si el usuario ya se movió dentro del diálogo.
          if (modalFocusTimer) clearTimeout(modalFocusTimer);
          modalFocusTimer = setTimeout(() => {
            modalFocusTimer = 0;
            if (myOpenSeq !== modalOpenSeq || !modalPVPCInfo.classList.contains('show')) return;
            modalAbriendo = false;
            modalReadyToClose = true;
          }, 150);

        })();
      });
    });

    // Cerrar modal
    const cerrarModal = () => {
      const closeSeq = ++modalOpenSeq;
      modalAbriendo = false;
      modalReadyToClose = false; // Resetear flag
      if (modalFocusTimer) {
        clearTimeout(modalFocusTimer);
        modalFocusTimer = 0;
      }
      modalPVPCInfo.classList.remove('show');
      modalPVPCInfo.setAttribute('aria-hidden', 'true');
      __pvpcUnlock();

      // Semantica, foco y scroll se restauran al cerrar, no al terminar el fade.
      // Asi reduced-motion no deja un dialogo invisible expuesto durante 300 ms.
      const previousFocus = elementoAnterior;
      elementoAnterior = null;
      if (previousFocus && previousFocus.focus) previousFocus.focus();

      if (modalHideTimer) clearTimeout(modalHideTimer);
      modalHideTimer = setTimeout(() => {
        modalHideTimer = 0;
        if (closeSeq === modalOpenSeq && !modalPVPCInfo.classList.contains('show')) {
          modalPVPCInfo.style.display = 'none';
        }
      }, modalCloseDelay());
    };

    btnCerrarPVPCInfo.addEventListener('click', cerrarModal);
    if (btnCerrarPVPCX) btnCerrarPVPCX.addEventListener('click', cerrarModal);

    // Prevenir que el click de apertura cierre el modal inmediatamente
    let modalReadyToClose = false;

    modalPVPCInfo.addEventListener('click', (e) => {
      if (e.target === modalPVPCInfo && modalReadyToClose) {
        cerrarModal();
      }
    });

    // Cerrar con ESC y manejar focus-trap
    document.addEventListener('keydown', (e) => {
      if (modalPVPCInfo.classList.contains('show')) {
        if (e.key === 'Escape') {
          cerrarModal();
        } else if (e.key === 'Tab') {
          // Focus trap simple: mantener focus dentro del modal
          const focusables = Array.from(
            modalPVPCInfo.querySelectorAll(
              'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter(el => (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

          if (!focusables.length) return;
          const firstFocusable = focusables[0];
          const lastFocusable = focusables[focusables.length - 1];

          if (e.shiftKey && document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    });
  });


  // Ocultar breadcrumb "Inicio" en la página principal (es redundante aquí)
  document.addEventListener('DOMContentLoaded', () => {
    const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
    if (breadcrumb && (window.location.pathname === '/' || window.location.pathname === '/index.html')) {
      breadcrumb.style.display = 'none';
    }
  });
})();
