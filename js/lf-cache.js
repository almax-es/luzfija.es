// ===== LuzFija: Cache de Tarifas =====

(function() {
  'use strict';

  const { 
    el, JSON_URL, TARIFAS_CACHE_KEY, TARIFAS_CACHE_TTL,
    setStatus, toast 
  } = window.LF;

  // ===== LECTURA DE CACHÉ =====
  function readTarifasCache(opts) {
    const allowExpired = Boolean(opts && opts.allowExpired);
    try {
      const raw = localStorage.getItem(TARIFAS_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      const data = parsed && parsed.data;
      const ts = (parsed && parsed.timestamp) ? Number(parsed.timestamp) : 0;

      if (!Array.isArray(data) || !data.length) return null;

      const age = Date.now() - ts;
      const expired = age > TARIFAS_CACHE_TTL;

      if (expired && !allowExpired) return null;

      return { data, expired, ageMs: age, meta: parsed };
    } catch (e) {
      return null;
    }
  }

  // ===== ESCRITURA DE CACHÉ =====
  function writeTarifasCache(tarifas, meta) {
    try {
      const payload = Object.assign({}, meta || {}, {
        data: tarifas,
        timestamp: Date.now()
      });
      localStorage.setItem(TARIFAS_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  // ===== RENDER FECHA ACTUALIZACIÓN =====
  function renderTarifasUpdated(meta) {
    if (!el.tarifasUpdated) return;
    const m = meta || window.LF.__LF_tarifasMeta || null;

    const iso = m && m.updatedAt;

    if (!iso) {
      el.tarifasUpdated.textContent = 'Tarifas: sin fecha de actualización';
      el.tarifasUpdated.title = '';
      return;
    }

    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) {
      el.tarifasUpdated.textContent = 'Tarifas: sin fecha de actualización';
      el.tarifasUpdated.title = '';
      return;
    }

    const fmt = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    el.tarifasUpdated.textContent = 'Actualizado el ' + fmt.format(dt);
    el.tarifasUpdated.title = 'Última actualización del listado de tarifas: ' + iso;
  }

  // ===== FETCH TARIFAS =====
  async function fetchTarifas(forceRefresh = false, opts) {
    const silent = Boolean(opts && opts.silent);
    
    // 1) Prioridad: localStorage (válido)
    if (!forceRefresh) {
      const cached = readTarifasCache({ allowExpired: false });
      if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
        window.LF.baseTarifasCache = cached.data;
        window.LF.__LF_tarifasMeta = cached.meta || null;
        renderTarifasUpdated(window.LF.__LF_tarifasMeta);
        if (window.LF.__LF_tarifasMeta && window.LF.__LF_tarifasMeta.updatedAt) {
          return true;
        }
      }
    }

    // 2) Red
    if (!silent) setStatus('Cargando tarifas...', 'loading');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Query-buster SOLO si forzamos refresh manual
      const url = forceRefresh ? `${JSON_URL}?v=${Date.now()}` : JSON_URL;

      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'default'
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('HTTP ' + response.status);

      const data = await response.json();
      const tarifas = Array.isArray(data.tarifas) ? data.tarifas : null;

      if (!tarifas || tarifas.length === 0) {
        throw new Error('JSON sin tarifas válidas');
      }

      window.LF.baseTarifasCache = tarifas;
      window.LF.__LF_tarifasMeta = { updatedAt: data.updatedAt || null };

      renderTarifasUpdated(window.LF.__LF_tarifasMeta);
      writeTarifasCache(tarifas, window.LF.__LF_tarifasMeta);

      if (!silent) {
        setTimeout(() => setStatus('Listo para calcular', 'idle'), 500);
      }
      return true;

    } catch (e) {
      // 3) Fallback: usar caché expirada si hay problemas de red
      const cached = readTarifasCache({ allowExpired: true });
      if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
        window.LF.baseTarifasCache = cached.data;
        window.LF.__LF_tarifasMeta = cached.meta || null;
        renderTarifasUpdated(window.LF.__LF_tarifasMeta);
        if (!silent) {
          toast('Sin conexión: usando tarifas cacheadas', 'err');
          setStatus('Tarifas cacheadas', 'err');
        }
        return true;
      }

      lfDbg('[ERROR] Error cargando tarifas JSON:', e);
      if (!silent) {
        setStatus('Error conexión', 'err');
        toast('Error cargando tarifas desde el servidor.', 'err');
      }
      return false;
    }
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    readTarifasCache,
    writeTarifasCache,
    renderTarifasUpdated,
    fetchTarifas
  });

  // Compatibilidad
  window.readTarifasCache = readTarifasCache;
  window.fetchTarifas = fetchTarifas;
  window.renderTarifasUpdated = renderTarifasUpdated;

})();
