// index-extra.js
// Scripts extraídos de index.html para mejorar cacheo, mantenimiento y facilitar CSP.
(function () {
  'use strict';

  // ===== PVPC: lectura desde dataset estático (data/pvpc) =====
  const PVPC_DATASET_BASE = window.PVPC_DATASET_BASE || '/data/pvpc';
  const SURPLUS_DATASET_BASE = window.SURPLUS_DATASET_BASE || '/data/surplus';

  // Cache en memoria de ficheros mensuales {key: `${base}/${geo}/${YYYY-MM}`}
  const __pvpcMonthCache = new Map();

  function __pvpcGetUserContext() {
    // Intenta usar la zona fiscal ya elegida en el comparador (si existe)
    const fallback = { geo: 8741, tz: 'Europe/Madrid' };
    try {
      const raw = localStorage.getItem('almax_comparador_v6_inputs');
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      const zona = String((v && v.zonaFiscal) || '').toLowerCase();
      if (zona.includes('canarias')) return { geo: 8742, tz: 'Atlantic/Canary' };
      if (zona.includes('ceutamelilla')) return { geo: 8744, tz: 'Europe/Madrid' };
      return fallback; // Península y Baleares
    } catch (_) {
      return fallback;
    }
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

  async function __pvpcLoadMonth(base, geo, yyyyMM) {
    const key = `${base}/${geo}/${yyyyMM}`;
    if (__pvpcMonthCache.has(key)) return __pvpcMonthCache.get(key);

    const url = `${base}/${geo}/${yyyyMM}.json`;
    const p = fetch(url, { cache: 'no-cache' }).then(async (r) => {
      if (!r.ok) throw new Error(`Dataset no disponible: ${url} (${r.status})`);
      return r.json();
    });

    __pvpcMonthCache.set(key, p);
    return p;
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
    const month = await __pvpcLoadMonth(base, geo, yyyyMM);
    const dayPairs = (month && month.days) ? month.days[dateStr] : undefined;
    if (!Array.isArray(dayPairs) || dayPairs.length < 23 || dayPairs.length > 25) {
      throw new Error('Sin datos (dataset estático)');
    }
    const entries = __pvpcBuildEntries(dayPairs, tz);
    return { entries, tz, geo };
  }



      // Cargar y mostrar novedades
      (async function cargarNovedades() {
        try {
          const response = await fetch('/novedades.json');
          let novedades = await response.json();
          const container = document.getElementById('novedadesContainer');
          
          if (!container || !novedades || novedades.length === 0) return;

          // Ordenar por fecha descendente (asegurar que las nuevas salen arriba)
          novedades.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          
          // Iconos según tipo
          const iconos = {
            'regulatorio': '📜',
            'alerta': '⚠️',
            'novedad': '✨',
            'info': '📊',
            'tip': '💡',
            'caso': '🎯'
          };
          
          // Colores según tipo
          const colores = {
            'regulatorio': '#3B82F6',
            'alerta': 'var(--danger)',
            'novedad': 'var(--accent)',
            'info': 'var(--accent2)',
            'tip': '#f59e0b',
            'caso': '#10b981'
          };
          
          // Mostrar máximo 5 novedades más recientes
          novedades.slice(0, 5).forEach(nov => {
            const icono = iconos[nov.tipo] || '📌';
            const color = colores[nov.tipo] || 'var(--accent)';
            
            const novDiv = document.createElement('div');
            novDiv.setAttribute('role', 'listitem');
            novDiv.style.cssText = `
              background: var(--card-bg);
              border: 1px solid var(--border);
              border-left: 3px solid ${color};
              border-radius: 8px;
              padding: 18px 20px;
              transition: transform 0.2s, box-shadow 0.2s;
            `;

            // Construir DOM sin innerHTML (más robusto y evita inyecciones accidentales)
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:start; gap:12px;';

            const iconEl = document.createElement('span');
            iconEl.style.cssText = 'font-size:24px; line-height:1; flex-shrink:0;';
            iconEl.textContent = icono;

            const content = document.createElement('div');
            content.style.cssText = 'flex:1; min-width:0;';

            const meta = document.createElement('div');
            meta.style.cssText = 'display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:6px;';

            const time = document.createElement('time');
            time.style.cssText = 'font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;';
            time.textContent = formatearFecha(nov.fecha);
            // Mantener atributo datetime si la fecha parece válida
            if (typeof nov.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nov.fecha)) {
              time.setAttribute('datetime', nov.fecha);
            }
            meta.appendChild(time);

            const title = document.createElement('h3');
            title.style.cssText = 'font-size:15px; font-weight:700; margin:0 0 8px 0; color:var(--text); line-height:1.4;';
            title.textContent = ((nov && nov.titulo != null) ? nov.titulo : '').toString();

            const text = document.createElement('p');
            text.style.cssText = 'font-size:13px; color:var(--muted); margin:0; line-height:1.5;';
            
            // Sanitización manual: solo permitir enlaces seguros (anti-XSS)
            const textoRaw = ((nov && nov.texto != null) ? nov.texto : '').toString();
            const linkRegex = /<a\s+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
            
            let lastIndex = 0;
            let match;
            
            while ((match = linkRegex.exec(textoRaw)) !== null) {
              const [fullMatch, href, linkText] = match;
              
              // Texto antes del enlace
              if (match.index > lastIndex) {
                text.appendChild(document.createTextNode(textoRaw.substring(lastIndex, match.index)));
              }
              
              // Crear enlace seguro
              const a = document.createElement('a');
              a.href = href;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              a.textContent = linkText;
              a.style.cssText = `color: ${color}; text-decoration: underline;`;
              text.appendChild(a);
              
              lastIndex = match.index + fullMatch.length;
            }
            
            // Texto después del último enlace
            if (lastIndex < textoRaw.length) {
              text.appendChild(document.createTextNode(textoRaw.substring(lastIndex)));
            }

            content.appendChild(meta);
            content.appendChild(title);
            content.appendChild(text);

            // Enlace (si existe y es seguro)
            if (nov.enlace) {
              let href = '';
              try {
                // Permite http(s) y rutas relativas; bloquea esquemas peligrosos
                const u = new URL(nov.enlace, window.location.href);
                if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
              } catch (e) {
                // Ignorar enlaces inválidos
              }
              if (href) {
                const a = document.createElement('a');
                a.href = href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.style.cssText = `display:inline-flex; align-items:center; gap:4px; margin-top:10px; font-size:12px; color:${color}; font-weight:600; text-decoration:none; transition:opacity 0.2s;`;
                a.textContent = 'Ver más ';

                const arrow = document.createElement('span');
                arrow.style.cssText = 'font-size:10px;';
                arrow.textContent = '→';
                a.appendChild(arrow);

                a.addEventListener('mouseenter', () => { a.style.opacity = '0.85'; });
                a.addEventListener('mouseleave', () => { a.style.opacity = '1'; });
                content.appendChild(a);
              }
            }

            row.appendChild(iconEl);
            row.appendChild(content);
            novDiv.appendChild(row);
            
            // Efecto hover
            novDiv.addEventListener('mouseenter', () => {
              novDiv.style.transform = 'translateX(4px)';
              novDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            });
            novDiv.addEventListener('mouseleave', () => {
              novDiv.style.transform = 'translateX(0)';
              novDiv.style.boxShadow = 'none';
            });
            
            container.appendChild(novDiv);
          });
          
        } catch (error) {
          // Silencioso: si no hay novedades.json, simplemente no se muestra nada
          if (window.__LF_DEBUG) console.log('Novedades no disponibles:', error);
        }
      })();
      
      // Formatear fecha a español
      function formatearFecha(fechaISO) {
        const fecha = new Date(fechaISO + 'T00:00:00');
        const opciones = { day: 'numeric', month: 'short', year: 'numeric' };
        return fecha.toLocaleDateString('es-ES', opciones);
      }

      // Cargar precio PVPC
      (async function cargarPVPC() {
        try {
          const pvpcInline = document.getElementById('pvpcInline');
          const pvpcNow = document.getElementById('pvpcNow');
          const pvpcAvg = document.getElementById('pvpcAvg');
          const pvpcMin = document.getElementById('pvpcMin');
          const pvpcMax = document.getElementById('pvpcMax');
          const pvpcNowHour = document.getElementById('pvpcNowHour');
          const pvpcMinHour = document.getElementById('pvpcMinHour');
          const pvpcMaxHour = document.getElementById('pvpcMaxHour');

          if (!pvpcInline || !pvpcNow || !pvpcAvg || !pvpcMin || !pvpcMax || !pvpcNowHour || !pvpcMinHour || !pvpcMaxHour) return;
          
          // Fecha de HOY según la zona del usuario (si ya eligió zona fiscal en el comparador)
          const __ctx = __pvpcGetUserContext();
          const fechaStr = __pvpcYmdInTZ(new Date(), __ctx.tz);

          // PVPC desde dataset estático (data/pvpc) – sin llamadas a ESIOS en tiempo real
          const day = await __pvpcFetchDay(fechaStr, __ctx, PVPC_DATASET_BASE);
          const entries = day.entries;

          const precios = entries.map(e => e.price);
          const nowIdx = __pvpcFindNowIndex(entries);
          const nowEntry = entries[nowIdx];

          const precioMin = Math.min(...precios);
          const precioMax = Math.max(...precios);
          const precioMedio = precios.reduce((a, b) => a + b, 0) / precios.length;

          const idxMin = precios.indexOf(precioMin);
          const idxMax = precios.indexOf(precioMax);

          pvpcNow.textContent = nowEntry.price.toFixed(3);
          pvpcNowHour.textContent = `(${nowEntry.label}h)`;
          pvpcAvg.textContent = `${precioMedio.toFixed(3)} €/kWh`;
          pvpcMin.textContent = `${precioMin.toFixed(3)} €/kWh`;
          pvpcMinHour.textContent = `${entries[idxMin].label}h`;
          pvpcMax.textContent = `${precioMax.toFixed(3)} €/kWh`;
          pvpcMaxHour.textContent = `${entries[idxMax].label}h`;

          pvpcInline.hidden = false;
        } catch (error) {
          const pvpcInline = document.getElementById('pvpcInline');
          if (pvpcInline) pvpcInline.hidden = true;
          console.error('Error cargando PVPC:', error);
        }
      })();


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

    // Helper: formatear fecha en zona horaria Madrid (evita bug de toISOString con UTC)
    function ymdMadrid(date) {
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const get = (t) => {
        const match = parts.find(p => p.type === t);
        return match ? match.value : '';
      };
      return `${get('year')}-${get('month')}-${get('day')}`;
    }

      let pvpcHoy = null;
      let pvpcManana = null;
      let modalType = 'pvpc';
      let diaActivo = 'hoy';
    let __pvpcLocked = false;
    let __pvpcScrollY = 0;
      function __pvpcLock(){
        if (document.documentElement.style.overflow === 'hidden') return;
        __pvpcScrollY = window.scrollY || 0;
        document.documentElement.style.overflow = 'hidden';
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
      }
    function __pvpcUnlock(){
      if (!__pvpcLocked) return;
      document.documentElement.style.overflow = '';
      window.scrollTo(0, __pvpcScrollY);
      __pvpcLocked = false;
    }


    // Cargar precios de HOY
      async function cargarHoy() {
        try {
          const __ctx = __pvpcGetUserContext();
          const cfg = getModalConfig(modalType);
          const tz = cfg.tzOverride || __ctx.tz;
          const fechaStr = __pvpcYmdInTZ(new Date(), tz);

          const day = await __pvpcFetchDay(fechaStr, { ...__ctx, tz }, cfg.base);
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
        try {
          const __ctx = __pvpcGetUserContext();
          const cfg = getModalConfig(modalType);
          const tz = cfg.tzOverride || __ctx.tz;

          // Mañana en la TZ del usuario
          const hoyStr = __pvpcYmdInTZ(new Date(), tz);
          const fechaStr = __pvpcAddDaysYMD(hoyStr, 1);

          // Intentar cargar. Si no existe (aún no publicado/actualizado), salimos sin error visible.
          const day = await __pvpcFetchDay(fechaStr, { ...__ctx, tz }, cfg.base);
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
        // Si aún no hay datos de mañana en el dataset, no hacemos nada.
        if (window.__LF_DEBUG) console.log('[PVPC] Mañana no disponible todavía:', (e && e.message) || e);
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
          document.getElementById('modalPVPCHoursList').innerHTML = '<p class="u-loading-text">⏳ Cargando...</p>';
          await cargarHoy();
          await cargarManana();
          if (pvpcHoy) cambiarTab('hoy');
        });
        applyModalType(pvpcTypeSelector.value || 'pvpc');
      }

    // Abrir modal
    let elementoAnterior = null;
    let modalAbriendo = false;

    btnPVPCInfo.addEventListener('click', async (e) => {
      // Prevenir comportamiento por defecto y propagación
      e.preventDefault();
      e.stopPropagation();

      // Prevenir doble clic mientras se está abriendo
      if (modalAbriendo) return;
      modalAbriendo = true;

      // Guardar elemento que tenía focus para restaurarlo después
      elementoAnterior = document.activeElement;

      // Mostrar modal inmediatamente (display: flex para que sea visible)
      modalPVPCInfo.style.display = 'flex';
      modalPVPCInfo.setAttribute('aria-hidden', 'false');

      // Diferir la clase .show y el trabajo pesado al siguiente frame
      // para que el navegador pinte la caja del modal antes (mejora INP)
      requestAnimationFrame(() => {
        modalPVPCInfo.classList.add('show');
        __pvpcLock();

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

          // Dar focus sin provocar scroll
          const focusNoScroll = (el) => {
            if (!el || typeof el.focus !== 'function') return;
            try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
          };
          setTimeout(() => {
            focusNoScroll(btnCerrarPVPCX || btnCerrarPVPCInfo);
            modalAbriendo = false;
            modalReadyToClose = true;
          }, 150);
        })();
      });
    });

    // Cerrar modal
    const cerrarModal = () => {
      modalReadyToClose = false; // Resetear flag
      modalPVPCInfo.classList.remove('show');
      setTimeout(() => {
        modalPVPCInfo.style.display = 'none';
        modalPVPCInfo.setAttribute('aria-hidden', 'true');

        __pvpcUnlock();

        // Restaurar focus al elemento anterior
        if (elementoAnterior && elementoAnterior.focus) {
          elementoAnterior.focus();
        }
      }, 300);
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
