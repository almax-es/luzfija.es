/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: Tarifas (sin caché) =====

(function() {
  'use strict';

  const { 
    el, JSON_URL,
    setStatus, toast 
  } = window.LF;
  const debugLog = (...args) => {
    const fn = window.LF?.lfDbg || window.lfDbg;
    if (typeof fn === 'function') fn(...args);
  };

  // Evitar carreras: si hay una descarga en curso, reutilizamos la promesa.
  let tarifasFetchPromise = null;
  const FOREGROUND_TERMINAL_DIAGNOSTIC_REASONS = new Set(['startup', 'calculate', 'direct']);

  function shouldTrackTarifasTerminalOutcome(diagnosticReason) {
    return FOREGROUND_TERMINAL_DIAGNOSTIC_REASONS.has(diagnosticReason);
  }

  function trackTarifasTerminalOutcome(outcome, diagnosticReason, attempt) {
    if (typeof window.__LF_trackDetail !== 'function') return;
    if (!shouldTrackTarifasTerminalOutcome(diagnosticReason)) return;
    const reason = diagnosticReason || 'direct';
    window.__LF_trackDetail('error-context', [
      'fetch-terminal', 'tarifas', outcome, reason, 'a' + attempt,
      window.__LF_BUILD_ID || 'desconocido'
    ], {
      title: outcome === 'recovered'
        ? 'Carga de tarifas recuperada tras reintento'
        : 'Carga de tarifas fallida tras agotar reintentos'
    });
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
  async function fetchTarifas(_forceRefresh = false, opts) {
    const silent = Boolean(opts && opts.silent);
    const diagnosticReason = opts && opts.diagnosticReason ? opts.diagnosticReason : 'direct';

    // Si ya hay una descarga en curso, reutilizarla (evita datos viejos por carreras).
    if (tarifasFetchPromise) {
      return tarifasFetchPromise;
    }

    // Red (siempre)
    if (!silent) setStatus('Cargando tarifas...', 'loading');

    tarifasFetchPromise = (async () => {
      const maxAttempts = 2;
      let lastError = null;
      let attemptsMade;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attemptsMade = attempt;
        let timeoutId = null;
        let url = '';
        try {
          const controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), 15000);

          // Siempre bust de caché para tarifas (no-store + query param).
          const sep = JSON_URL.includes('?') ? '&' : '?';
          url = `${JSON_URL}${sep}v=${Date.now()}`;

          const response = await fetch(url, {
            signal: controller.signal,
            cache: 'no-store',
            __lfDiagnosticReason: diagnosticReason,
            __lfDiagnosticAttempt: attempt,
            __lfDiagnosticTrackAbort: 'timeout'
          });

          if (!response || !response.ok) {
            const status = response ? Number(response.status) : 0;
            const error = new Error('HTTP ' + (status || 'unknown'));
            error.__lfTarifasStatus = status;
            error.__lfRetryable = !response || status === 408 || status === 429 || status >= 500;
            throw error;
          }

          let data;
          try {
            data = await response.json();
          } catch (cause) {
            const error = cause && (typeof cause === 'object' || typeof cause === 'function')
              ? cause
              : new Error('JSON no parseable');
            error.__lfTarifasFailureKind = cause && cause.name === 'AbortError'
              ? 'timeout'
              : 'json-parse';
            throw error;
          }
          const tarifas = Array.isArray(data.tarifas) ? data.tarifas : null;

          if (!tarifas || tarifas.length === 0) {
            const error = new Error('JSON sin tarifas válidas');
            error.__lfTarifasFailureKind = 'json-invalid';
            // Una respuesta JSON válida pero vacía es determinista; repetirla
            // inmediatamente solo añade latencia y tráfico.
            error.__lfRetryable = false;
            throw error;
          }

          window.LF.baseTarifasCache = tarifas;
          window.LF.__LF_tarifasMeta = { updatedAt: data.updatedAt || null };

          renderTarifasUpdated(window.LF.__LF_tarifasMeta);

          if (attempt > 1 && shouldTrackTarifasTerminalOutcome(diagnosticReason) &&
              typeof window.__LF_trackDetail === 'function') {
            window.__LF_trackDetail('network-recovered', [
              'tarifas', diagnosticReason, 'a' + attempt,
              window.__LF_BUILD_ID || 'desconocido'
            ], { title: 'Carga de tarifas recuperada tras reintento' });
            trackTarifasTerminalOutcome('recovered', diagnosticReason, attempt);
          }
          if (!silent) {
            setTimeout(() => setStatus('Listo para calcular', 'idle'), 500);
          }
          return true;
        } catch (error) {
          lastError = error;
          const failureKind = error && error.__lfTarifasFailureKind;
          const httpStatus = Number(error && error.__lfTarifasStatus) || 0;
          const wrapperAlreadyReportsHttp = httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
          if ((failureKind || (httpStatus && !wrapperAlreadyReportsHttp)) &&
              typeof window.__LF_reportNetworkFailure === 'function') {
            const reportedKind = failureKind || 'http-error';
            window.__LF_reportNetworkFailure(url || JSON_URL, httpStatus, reportedKind, {
              reason: diagnosticReason,
              attempt,
              errorKind: failureKind || 'http'
            });
          }
          const retryable = (!error || error.__lfRetryable !== false) && navigator.onLine !== false;
          if (attempt < maxAttempts && retryable) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            continue;
          }
          break;
        } finally {
          if (timeoutId !== null) clearTimeout(timeoutId);
        }
      }

      if (attemptsMade === maxAttempts && shouldTrackTarifasTerminalOutcome(diagnosticReason)) {
        trackTarifasTerminalOutcome('failed', diagnosticReason, attemptsMade);
      }
      debugLog('[ERROR] Error cargando tarifas JSON:', lastError);
      if (!silent) {
        setStatus('Error conexión', 'err');
        toast('Error cargando tarifas desde el servidor.', 'err');
      }
      return false;
    })().finally(() => {
      tarifasFetchPromise = null;
    });

    return tarifasFetchPromise;
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    renderTarifasUpdated,
    fetchTarifas
  });

  // Compatibilidad
  window.fetchTarifas = fetchTarifas;
  window.renderTarifasUpdated = renderTarifasUpdated;

})();
