// ===== LuzFija: Tarifas (sin caché) =====

(function() {
  'use strict';

  const { 
    el, JSON_URL,
    setStatus, toast 
  } = window.LF;

  // Evitar carreras: si hay una descarga en curso, reutilizamos la promesa.
  let tarifasFetchPromise = null;

  // ===== CACHÉ DESACTIVADA (tarifas siempre desde red) =====
  function readTarifasCache() { return null; }
  function writeTarifasCache() {}

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

    // Si ya hay una descarga en curso, reutilizarla (evita datos viejos por carreras).
    if (tarifasFetchPromise) {
      return tarifasFetchPromise;
    }

    // Red (siempre)
    if (!silent) setStatus('Cargando tarifas...', 'loading');

    tarifasFetchPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        // Siempre bust de caché para tarifas (no-store + query param)
        const sep = JSON_URL.includes('?') ? '&' : '?';
        const url = `${JSON_URL}${sep}v=${Date.now()}`;

        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store'
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

        if (!silent) {
          setTimeout(() => setStatus('Listo para calcular', 'idle'), 500);
        }
        return true;

      } catch (e) {
        lfDbg('[ERROR] Error cargando tarifas JSON:', e);
        if (!silent) {
          setStatus('Error conexión', 'err');
          toast('Error cargando tarifas desde el servidor.', 'err');
        }
        return false;
      } finally {
        tarifasFetchPromise = null;
      }
    })();

    return tarifasFetchPromise;
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
