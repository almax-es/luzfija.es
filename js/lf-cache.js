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
  let tarifasFetchDiagnosticReason = null;
  const sharedImpactReasons = new Set();
  const FOREGROUND_TERMINAL_DIAGNOSTIC_REASONS = new Set(['startup', 'calculate', 'direct']);
  const USER_IMPACT_DIAGNOSTIC_REASONS = new Set(['startup', 'calculate']);

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
        : 'Carga de tarifas fallida al finalizar los intentos aplicables'
    });
  }

  function trackTarifasFailureImpact(diagnosticReason) {
    if (typeof window.__LF_trackDetail !== 'function' ||
        !USER_IMPACT_DIAGNOSTIC_REASONS.has(diagnosticReason)) return;
    const hasSessionTarifas = Array.isArray(window.LF.baseTarifasCache) &&
      window.LF.baseTarifasCache.length > 0;
    const impact = hasSessionTarifas
      ? 'fallback-sesion'
      : (diagnosticReason === 'startup' ? 'sin-datos-iniciales' : 'bloqueado-sin-datos');
    window.__LF_trackDetail('error-context', [
      'tarifas-impacto', diagnosticReason, impact,
      window.__LF_BUILD_ID || 'desconocido'
    ], {
      title: hasSessionTarifas
        ? 'Carga de tarifas fallida; se conserva la descarga valida de la sesion'
        : (diagnosticReason === 'startup'
          ? 'Carga inicial de tarifas fallida sin datos validos disponibles'
          : 'Calculo bloqueado sin datos validos de tarifas disponibles')
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

  // Validacion minima DE FILA compartida con el simulador solar
  // (ver js/lf-utils.js:esTarifaUtilizable). Los guards de integridad del catalogo que
  // siguen son propios de esta cache de sesion y no cambian reglas comerciales.
  const esTarifaUtilizable = window.LF.esTarifaUtilizable;

  function tieneNombresDuplicados(tarifas) {
    const vistos = new Set();
    for (const tarifa of tarifas) {
      const nombre = tarifa.nombre.trim();
      if (vistos.has(nombre)) return true;
      vistos.add(nombre);
    }
    return false;
  }

  function tienePreciosBaseNegativos(tarifas) {
    return tarifas.some((tarifa) =>
      tarifa.p1 < 0 || tarifa.p2 < 0 || tarifa.cPunta < 0 ||
      tarifa.cLlano < 0 || tarifa.cValle < 0
    );
  }

  const CAMPOS_VERSION_RELEVANTES = [
    'tipo', 'p1', 'p2', 'cPunta', 'cLlano', 'cValle', 'fv', 'requiereFV',
    'maxConsumoAnual', 'minConsumoAnualExclusivo', 'incluyeServiciosAjuste'
  ];

  function valoresEquivalentes(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((valor, i) => valoresEquivalentes(valor, b[i]));
    }
    const clavesA = Object.keys(a).sort();
    const clavesB = Object.keys(b).sort();
    if (clavesA.length !== clavesB.length || clavesA.some((clave, i) => clave !== clavesB[i])) return false;
    return clavesA.every((clave) => valoresEquivalentes(a[clave], b[clave]));
  }

  function tarifaEquivalenteParaVersion(a, b) {
    return CAMPOS_VERSION_RELEVANTES.every((campo) => valoresEquivalentes(a[campo], b[campo]));
  }

  function cambiaCatalogoConMismaVersion(tarifas, updatedAt) {
    if (typeof updatedAt !== 'string' || !updatedAt) return false;
    const anterior = window.LF.baseTarifasCache;
    const versionAnterior = window.LF.__LF_tarifasMeta?.updatedAt;
    if (versionAnterior !== updatedAt || !Array.isArray(anterior) || anterior.length === 0 ||
        !anterior.every(esTarifaUtilizable)) {
      return false;
    }

    if (anterior.length !== tarifas.length) return true;
    const anterioresPorNombre = new Map(anterior.map((tarifa) => [tarifa.nombre.trim(), tarifa]));
    return tarifas.some((tarifa) => {
      const previa = anterioresPorNombre.get(tarifa.nombre.trim());
      return !previa || !tarifaEquivalenteParaVersion(previa, tarifa);
    });
  }

  // ===== CLASIFICACION DEL FALLO DE CATALOGO =====
  // La causa real ya se distingue al capturarla (__lfTarifasStatus / __lfTarifasFailureKind),
  // pero durante mucho tiempo TODAS terminaban en el mismo "Error conexion". Un 404 o un JSON
  // corrupto no son una caida de conectividad y el usuario no los arregla revisando su wifi.
  // Este clasificador es la unica fuente del texto para los dos consumidores: el propio
  // fetchTarifas (modo no silencioso) y el boton Calcular en lf-app.js (que llama en silent).
  function describirFalloTarifas(error) {
    const status = Number(error && error.__lfTarifasStatus) || 0;
    const kind = error && error.__lfTarifasFailureKind;

    if (kind === 'json-parse' || kind === 'json-invalid') {
      return {
        kind: 'datos',
        status: 'Datos no válidos',
        toast: 'El listado de tarifas descargado no es válido. Vuelve a intentarlo en unos minutos.',
        toastConCache: 'El listado de tarifas descargado no es válido. Calculando con la última descarga de esta sesión.'
      };
    }
    if (status >= 400) {
      return {
        kind: 'servidor',
        status: 'Error del servidor',
        toast: `El servidor respondió con un error (${status}) al pedir las tarifas.`,
        toastConCache: `El servidor respondió con un error (${status}). Calculando con la última descarga de esta sesión.`
      };
    }
    return {
      kind: 'red',
      status: 'Error conexión',
      toast: 'Error cargando tarifas desde el servidor.',
      toastConCache: 'Sin conexión con el servidor. Calculando con la última descarga de esta sesión.'
    };
  }

  // ===== FETCH TARIFAS =====
  async function fetchTarifas(_forceRefresh = false, opts) {
    const silent = Boolean(opts && opts.silent);
    const diagnosticReason = opts && opts.diagnosticReason ? opts.diagnosticReason : 'direct';

    // Si ya hay una descarga en curso, reutilizarla (evita datos viejos por carreras).
    if (tarifasFetchPromise) {
      // La petición puede haber empezado como precarga/refresco y ser reutilizada
      // después por un cálculo explícito. Si termina fallando, conservar también
      // el impacto real sobre ese cálculo sin lanzar otra descarga en paralelo.
      if (diagnosticReason === 'calculate' &&
          tarifasFetchDiagnosticReason !== 'calculate' &&
          !sharedImpactReasons.has('calculate')) {
        sharedImpactReasons.add('calculate');
        return tarifasFetchPromise.then((success) => {
          if (!success) trackTarifasFailureImpact('calculate');
          return success;
        });
      }
      return tarifasFetchPromise;
    }

    tarifasFetchDiagnosticReason = diagnosticReason;
    sharedImpactReasons.clear();

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
          // `response.json()` resuelve con cualquier valor JSON valido, no solo con un
          // objeto: null, un escalar o un array raiz lo son. Desreferenciar data.tarifas
          // sobre null lanzaba un TypeError que se saltaba la rama json-invalid, no se
          // reportaba a la telemetria de red y disparaba un reintento inutil (un error
          // sin __lfRetryable se trata como reintentable). Cualquier root inesperado debe
          // caer por la misma rama determinista que el resto de datasets inservibles.
          const tarifas = data && typeof data === 'object' && !Array.isArray(data)
            && Array.isArray(data.tarifas)
            ? data.tarifas
            : null;

          // Todo o nada: si una sola fila es inutilizable se descarta el dataset entero y
          // se conserva el ultimo sano. Filtrar en silencio las defectuosas dejaria un
          // ranking incompleto sin que el usuario pueda saberlo. Los nombres son unicos por
          // contrato; ademas, un mismo updatedAt identifica una generacion inmutable, por lo
          // que no puede cambiar el catalogo respecto a una copia sana de esa misma version.
          const estructuraValida = tarifas && tarifas.length > 0 && tarifas.every(esTarifaUtilizable);
          const nombresDuplicados = estructuraValida && tieneNombresDuplicados(tarifas);
          // No se replican aqui los rangos comerciales del generador. Solo se impide que
          // un coeficiente base negativo, aunque sea finito, llegue a producir importes
          // negativos o artificialmente baratos. El cero sigue siendo valido.
          const preciosNegativos = estructuraValida && !nombresDuplicados &&
            tienePreciosBaseNegativos(tarifas);
          const catalogoIncoherente = estructuraValida && !nombresDuplicados && !preciosNegativos &&
            cambiaCatalogoConMismaVersion(tarifas, data.updatedAt);
          if (!estructuraValida || nombresDuplicados || preciosNegativos || catalogoIncoherente) {
            const error = new Error('JSON sin tarifas válidas');
            error.__lfTarifasFailureKind = 'json-invalid';
            // Una respuesta JSON válida pero vacía es determinista; repetirla
            // inmediatamente solo añade latencia y tráfico.
            error.__lfRetryable = false;
            throw error;
          }

          window.LF.__LF_ultimoFalloTarifas = null;
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

      if (shouldTrackTarifasTerminalOutcome(diagnosticReason)) {
        trackTarifasTerminalOutcome('failed', diagnosticReason, attemptsMade);
        trackTarifasFailureImpact(diagnosticReason);
      }
      debugLog('[ERROR] Error cargando tarifas JSON:', lastError);
      // El consumidor silencioso (Calcular) no ve `lastError`: fetchTarifas devuelve un
      // booleano por contrato y cambiarlo romperia el resto de llamadas. Se publica aqui
      // para que lf-app.js pueda describir la MISMA causa sin repetir la clasificacion.
      window.LF.__LF_ultimoFalloTarifas = describirFalloTarifas(lastError);
      if (!silent) {
        const fallo = window.LF.__LF_ultimoFalloTarifas;
        setStatus(fallo.status, 'err');
        toast(fallo.toast, 'err');
      }
      return false;
    })().finally(() => {
      tarifasFetchPromise = null;
      tarifasFetchDiagnosticReason = null;
      sharedImpactReasons.clear();
    });

    return tarifasFetchPromise;
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    renderTarifasUpdated,
    fetchTarifas,
    describirFalloTarifas
  });

  // Compatibilidad
  window.fetchTarifas = fetchTarifas;
  window.renderTarifasUpdated = renderTarifasUpdated;

})();
