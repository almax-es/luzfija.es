/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// Antiincrustación: LuzFija.es no funciona dentro de un iframe de otra web.
// GitHub Pages no permite enviar X-Frame-Options ni `frame-ancestors`, y esa
// directiva se ignora en una CSP declarada con <meta>, así que la defensa vive
// aquí. Si algún ancestro del documento es de otro origen, se detiene la carga
// (no se ejecuta ningún script posterior, no se descarga tarifas.json ni se
// cuenta visita) y el iframe pasa a la página estática de aviso.
// Debe cargarse síncrono en el <head>, antes de cualquier hoja de estilo y de
// cualquier otro script salvo error-bootstrap.js (ver ARRANQUE-CARGA.md).
//
// No basta con detener la carga y pintar el aviso en el mismo documento: medido
// el 18/10/2026, tras window.stop() Chrome no vuelve a pintar el iframe (sin
// requestAnimationFrame, queda en blanco) y en WebKit el iframe no llega a
// disparar `load`. La página de aviso es un documento normal en los tres motores
// y se ve incluso si el iframe bloquea los scripts.
(function (win, doc) {
  'use strict';

  if (win.__LF_FRAME_GUARD === true) return;
  win.__LF_FRAME_GUARD = true;

  const NOTICE_PATH = '/pagina-incrustada.html';
  const SOURCE_PARAM = 'desde';

  function isFramedByForeignOrigin() {
    const top = win.top;
    if (!top || top === win.self) return false;

    const ownOrigin = win.location.origin;
    // Chromium y WebKit exponen todos los ancestros; así un iframe propio
    // dentro de una web ajena tampoco pasa.
    const ancestors = win.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      for (let i = 0; i < ancestors.length; i += 1) {
        if (ancestors[i] !== ownOrigin) return true;
      }
      return false;
    }

    // Sin ancestorOrigins se sube eslabón a eslabón: leer la ubicación de una
    // ventana de otro origen lanza SecurityError, así que cualquier ancestro
    // ajeno bloquea, también uno intermedio (propia -> ajena -> propia), que
    // mirando solo la ventana superior pasaría.
    try {
      let current = win;
      while (current !== top) {
        const parent = current.parent;
        if (!parent || parent === current) return false;
        if (parent.location.origin !== ownOrigin) return true;
        current = parent;
      }
      return false;
    } catch (_) {
      return true;
    }
  }

  // El destino llega en la URL del aviso: solo se aceptan páginas del propio
  // origen, para que el aviso no sirva de redirección abierta.
  function sameOriginTarget(raw) {
    const fallback = win.location.origin + '/';
    if (typeof raw !== 'string' || raw.charAt(0) !== '/') return fallback;
    try {
      const url = new URL(raw, win.location.origin);
      if (url.origin !== win.location.origin || url.pathname === NOTICE_PATH) return fallback;
      return url.href;
    } catch (_) {
      return fallback;
    }
  }

  function enhanceNoticeLink(target) {
    const link = doc.getElementById('abrir-luzfija');
    if (!link) return;
    link.href = target;
    // Sin JS el enlace ya lleva target="_top". Con JS se intenta navegar la
    // ventana superior y, si el sandbox del iframe no lo permite (lanza
    // SecurityError), el clic sigue su curso y abre una pestaña nueva.
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', (event) => {
      try {
        win.top.location.href = target;
        event.preventDefault();
      } catch (_) {}
    });
  }

  function runNoticePage() {
    let source = null;
    try {
      source = new URLSearchParams(win.location.search).get(SOURCE_PARAM);
    } catch (_) {}
    const target = sameOriginTarget(source);

    // Abierta fuera de un iframe ajeno (visita directa, historial o iframe
    // propio): no hay nada que avisar, se va a la página pedida.
    if (!isFramedByForeignOrigin()) {
      win.location.replace(target);
      return;
    }

    try {
      if (win.localStorage.getItem('almax_theme') === 'light') {
        doc.documentElement.classList.add('light-mode');
      }
    } catch (_) {}

    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', () => enhanceNoticeLink(target), { once: true });
    } else {
      enhanceNoticeLink(target);
    }
  }

  if (win.location.pathname === NOTICE_PATH) {
    runNoticePage();
    return;
  }

  if (!isFramedByForeignOrigin()) return;

  win.__LF_FRAME_BLOCKED = true;
  try {
    if (typeof win.stop === 'function') win.stop();
  } catch (_) {}
  const source = win.location.pathname + win.location.search + win.location.hash;
  win.location.replace(NOTICE_PATH + '?' + SOURCE_PARAM + '=' + encodeURIComponent(source));
})(window, document);
