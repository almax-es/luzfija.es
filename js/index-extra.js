// index-extra.js
// Scripts extraídos de index.html para mejorar cacheo, mantenimiento y facilitar CSP.
(function () {
  'use strict';

      // Cargar y mostrar novedades
      (async function cargarNovedades() {
        try {
          const response = await fetch('/novedades.json');
          const novedades = await response.json();
          const container = document.getElementById('novedadesContainer');
          
          if (!container || !novedades || novedades.length === 0) return;
          
          // Iconos según tipo
          const iconos = {
            'alerta': '⚠️',
            'novedad': '✨',
            'info': '📊',
            'tip': '💡',
            'caso': '🎯'
          };
          
          // Colores según tipo
          const colores = {
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
            title.textContent = (nov.titulo ?? '').toString();

            const text = document.createElement('p');
            text.style.cssText = 'font-size:13px; color:var(--muted); margin:0; line-height:1.5;';
            
            // Sanitización manual: solo permitir enlaces seguros (anti-XSS)
            const textoRaw = (nov.texto ?? '').toString();
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
          
          // Fecha de HOY en España (Europe/Madrid)
          const fechaStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Madrid',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date());

          // PVPC público cacheado en Vercel (CNMC)
          const response = await fetch(window.PVPC_PRICES_URL + encodeURIComponent(fechaStr));

          if (!response.ok) throw new Error('Error API CNMC (PVPC)');

          const data = await response.json();
          const precios = data && Array.isArray(data.prices) ? data.prices : null;

          if (!precios || precios.length !== 24) throw new Error('Sin datos PVPC');

          const ahora = Number(new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Madrid',
            hour: '2-digit',
            hour12: false
          }).format(new Date()));
          const precioActual = precios[ahora];
          const precioMin = Math.min(...precios);
          const precioMax = Math.max(...precios);
          const precioMedio = precios.reduce((a, b) => a + b, 0) / precios.length;
          
          const horaMin = precios.indexOf(precioMin);
          const horaMax = precios.indexOf(precioMax);
          
          pvpcNow.textContent = precioActual.toFixed(3);
          pvpcNowHour.textContent = `(${ahora}:00h)`;
          pvpcAvg.textContent = `${precioMedio.toFixed(3)} €/kWh`;
          pvpcMin.textContent = `${precioMin.toFixed(3)} €/kWh`;
          pvpcMinHour.textContent = `${horaMin}:00h`;
          pvpcMax.textContent = `${precioMax.toFixed(3)} €/kWh`;
          pvpcMaxHour.textContent = `${horaMax}:00h`;

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
      const get = (t) => parts.find(p => p.type === t)?.value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    }

    let pvpcHoy = null;
    let pvpcManana = null;
    let diaActivo = 'hoy';
    let __pvpcLocked = false;
    let __pvpcScrollY = 0;
    function __pvpcLock(){
      if (document.documentElement.style.overflow === 'hidden') return;
      __pvpcScrollY = window.scrollY || 0;
      document.documentElement.style.overflow = 'hidden';
      __pvpcLocked = true;
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
        const hoy = new Date();
        const fechaStr = ymdMadrid(hoy);
        const response = await fetch(window.PVPC_PRICES_URL + encodeURIComponent(fechaStr));
        if (!response.ok) throw new Error('Error API');
        const data = await response.json();
        if (!data?.prices || data.prices.length !== 24) throw new Error('Sin datos');

        // Obtener hora actual en zona horaria Madrid (consistente con el resto del sitio)
        const ahoraMadridStr = new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
        const ahoraMadrid = new Date(ahoraMadridStr);
        const ahora = ahoraMadrid.getHours();
        
        pvpcHoy = {
          precios: data.prices,
          ahora,
          precioActual: data.prices[ahora],
          precioMin: Math.min(...data.prices),
          precioMax: Math.max(...data.prices),
          horaMin: data.prices.indexOf(Math.min(...data.prices)),
          horaMax: data.prices.indexOf(Math.max(...data.prices))
        };
      } catch (e) {
        console.error('[PVPC] Error hoy:', e);
      }
    }

    // Cargar precios de MAÑANA (si es después de las 20:15h EN ESPAÑA)
    async function cargarManana() {
      try {
        // Obtener hora ACTUAL en España
        const ahoraEspana = new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
        const fechaEspana = new Date(ahoraEspana);
        const hora = fechaEspana.getHours();
        const minutos = fechaEspana.getMinutes();
        
        if (window.__LF_DEBUG || (new URLSearchParams(location.search)).get('debug') === '1' || localStorage.getItem('lf_debug') === '1') console.log(`[PVPC] Hora en España: ${hora}:${minutos}`);
        
        // Solo cargar si es después de las 20:15h
        if (hora < 20 || (hora === 20 && minutos < 15)) {
          if (window.__LF_DEBUG || (new URLSearchParams(location.search)).get('debug') === '1' || localStorage.getItem('lf_debug') === '1') console.log('[PVPC] Todavía no son las 20:15h en España, no se carga mañana');
          return;
        }

        const hoy = new Date();
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);
        const fechaStr = ymdMadrid(manana);
        
        if (window.__LF_DEBUG || (new URLSearchParams(location.search)).get('debug') === '1' || localStorage.getItem('lf_debug') === '1') console.log(`[PVPC] Cargando precios de mañana: ${fechaStr}`);
        
        const response = await fetch(window.PVPC_PRICES_URL + encodeURIComponent(fechaStr));
        if (!response.ok) throw new Error('Error API');
        const data = await response.json();
        if (!data?.prices || data.prices.length !== 24) throw new Error('Sin datos');

        pvpcManana = {
          precios: data.prices,
          precioMin: Math.min(...data.prices),
          precioMax: Math.max(...data.prices),
          horaMin: data.prices.indexOf(Math.min(...data.prices)),
          horaMax: data.prices.indexOf(Math.max(...data.prices))
        };

        // Mostrar tab de mañana
        tabManana.style.display = 'block';
        if (window.__LF_DEBUG || (new URLSearchParams(location.search)).get('debug') === '1' || localStorage.getItem('lf_debug') === '1') console.log('[PVPC] Tab mañana activado');
      } catch (e) {
        console.error('[PVPC] Error mañana:', e);
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
      const { precios, ahora, precioActual, precioMin, precioMax, horaMin, horaMax } = datos;
      
      // Actualizar cabecera
      if (esHoy) {
        document.getElementById('modalPVPCLabel').textContent = 'Ahora';
document.getElementById('modalPVPCNow').textContent = `${precioActual.toFixed(3).replace('.', ',')} €/kWh`;
        document.getElementById('modalPVPCNowHour').textContent = `${ahora}:00h`;
      } else {
        document.getElementById('modalPVPCLabel').textContent = 'Mañana';
        document.getElementById('modalPVPCNow').textContent = 'Precios del día siguiente';
        document.getElementById('modalPVPCNowHour').textContent = '';
      }
      
document.getElementById('modalPVPCMin').textContent = `${precioMin.toFixed(3).replace('.', ',')}`;
      document.getElementById('modalPVPCMinHour').textContent = `${horaMin}:00h`;
document.getElementById('modalPVPCMax').textContent = `${precioMax.toFixed(3).replace('.', ',')}`;
      document.getElementById('modalPVPCMaxHour').textContent = `${horaMax}:00h`;

      // Grid 2 columnas
      const rango = precioMax - precioMin;
      let col1 = '', col2 = '';
      
      precios.forEach((precio, hora) => {
        const isNow = esHoy && hora === ahora;
        const porcentaje = rango > 0 ? ((precio - precioMin) / rango) * 100 : 50;
        
        let color = '#eab308';
        if (precio === precioMin) color = '#10b981';
        else if (precio === precioMax) color = '#ef4444';
        else if (precio < precioMin + rango * 0.33) color = '#22c55e';
        else if (precio > precioMax - rango * 0.33) color = '#f97316';
        
        const comentario = getComentario(precio, hora, precioMin, precioMax);
        
        const item = `
          <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.05); ${isNow ? 'background: linear-gradient(135deg, rgba(255,180,50,.12) 0%, rgba(255,120,50,.06) 100%); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,180,50,.2);' : ''}" ${isNow ? 'id="pvpc-hora-actual"' : ''}>
            <div style="display: grid; grid-template-columns: 42px 1fr 80px; gap: 8px; align-items: center;">
              <div style="font-weight: 700; font-size: ${isNow ? '14px' : '13px'}; color: ${isNow ? 'var(--accent)' : 'var(--text)'};">
                ${String(hora).padStart(2, '0')}:00
              </div>
              <div style="height: 6px; background: rgba(255,255,255,.08); border-radius: 999px; overflow: hidden;">
                <div style="height: 100%; width: ${porcentaje}%; background: ${color}; border-radius: 999px;"></div>
              </div>
              <div class="u-fw-700 u-text-right u-text-12">
                ${precio.toFixed(3).replace('.', ',')}
              </div>
            </div>
            <div style="font-size: 11px; color: var(--muted); margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.03); line-height: 1.3;">
              ${isNow ? '<strong style="color: var(--accent); font-size: 10px;">← AHORA</strong> • ' : ''}${comentario}
            </div>
          </div>
        `;
        
        if (hora < 12) col1 += item;
        else col2 += item;
      });

      const html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>${col1}</div>
          <div>${col2}</div>
        </div>
      `;

      document.getElementById('modalPVPCHoursList').innerHTML = html;

      // Scroll a hora actual
      if (esHoy) {
        setTimeout(() => {
          const elem = document.getElementById('pvpc-hora-actual');
          if (elem) elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }

    // Cambiar tab
    function cambiarTab(tab) {
      diaActivo = tab;
      
      // Estilos tabs
      if (tab === 'hoy') {
        tabHoy.style.background = 'var(--accent)';
        tabHoy.style.color = '#fff';
        tabManana.style.background = 'transparent';
        tabManana.style.color = 'var(--text)';
        if (pvpcHoy) renderizarLista(pvpcHoy, true);
      } else {
        tabHoy.style.background = 'transparent';
        tabHoy.style.color = 'var(--text)';
        tabManana.style.background = 'var(--accent)';
        tabManana.style.color = '#fff';
        if (pvpcManana) renderizarLista(pvpcManana, false);
      }
    }

    tabHoy.addEventListener('click', () => cambiarTab('hoy'));
    tabManana.addEventListener('click', () => cambiarTab('manana'));

    // Abrir modal
    let elementoAnterior = null;
    btnPVPCInfo.addEventListener('click', async () => {
      // Guardar elemento que tenía focus para restaurarlo después
      elementoAnterior = document.activeElement;
      
      // Mostrar modal inmediatamente
      modalPVPCInfo.style.display = 'flex';
      modalPVPCInfo.classList.add('show');
      modalPVPCInfo.setAttribute('aria-hidden', 'false');
      __pvpcLock();
      
      // Dar focus al botón de cerrar
      setTimeout(() => btnCerrarPVPCInfo.focus(), 100);
      
      // Cargar datos si no están cargados
      if (!pvpcHoy) {
        document.getElementById('modalPVPCHoursList').innerHTML = '<p class="u-loading-text">⏳ Cargando...</p>';
        
        // Cargar precios de hoy
        await cargarHoy();
        
        // Cargar precios de mañana si corresponde
        await cargarManana();
        
        // Actualizar vista
        if (pvpcHoy) {
          cambiarTab(diaActivo);
        } else {
          document.getElementById('modalPVPCHoursList').innerHTML = '<p class="u-loading-text">❌ Error al cargar precios. Inténtalo de nuevo.</p>';
        }
      } else {
        cambiarTab(diaActivo);
      }
    });

    // Cerrar modal
    const cerrarModal = () => {
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
    btnCerrarPVPCX?.addEventListener('click', cerrarModal);
    
    modalPVPCInfo.addEventListener('click', (e) => {
      if (e.target === modalPVPCInfo) cerrarModal();
    });
    
    // Cerrar con ESC y manejar focus-trap
    document.addEventListener('keydown', (e) => {
      if (modalPVPCInfo.classList.contains('show')) {
        if (e.key === 'Escape') {
          cerrarModal();
        } else if (e.key === 'Tab') {
          // Focus trap simple: mantener focus dentro del modal
          const focusables = modalPVPCInfo.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
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
