/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// LuzFija - Shell lite (para páginas sin lf-app/bv-ui)
// - Toggle tema (btnTheme)
// - Menú simple (btnMenu + menuPanel)
// - Limpiar caché opcional (btnClearCache)

(function () {
  'use strict';

  const THEME_KEY = window.__ALMAX_THEME_KEY || 'almax_theme';

  function applyTheme(isLight) {
    document.documentElement.classList.toggle('light-mode', isLight);
    if (document.body) document.body.classList.toggle('light-mode', isLight);
    try { localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark'); } catch (_) {}
  }

  function bindThemeToggle() {
    const btn = document.getElementById('btnTheme');
    if (!btn || btn.dataset.shellBound === '1' || btn.dataset.bvBound === '1') return;
    btn.dataset.shellBound = '1';

    // Icono/labels coherentes con el resto del sitio
    btn.textContent = '🌓';
    const updateLabels = () => {
      const isLight = document.documentElement.classList.contains('light-mode');
      const actionText = isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
      btn.setAttribute('title', actionText);
      btn.setAttribute('aria-label', actionText);
      btn.setAttribute('aria-pressed', isLight ? 'false' : 'true');
    };
    updateLabels();

    btn.addEventListener('click', () => {
      const isLight = !document.documentElement.classList.contains('light-mode');
      applyTheme(isLight);
      updateLabels();
    });
  }

  function bindMenu() {
    const btn = document.getElementById('btnMenu');
    const panel = document.getElementById('menuPanel');
    if (!btn || !panel || btn.dataset.shellBound === '1' || btn.dataset.bvBound === '1') return;
    btn.dataset.shellBound = '1';

    const items = () => Array.from(panel.querySelectorAll('[role="menuitem"]'));
    const focusItem = (which = 'first') => {
      const menuItems = items();
      if (!menuItems.length) return;
      const target = which === 'last' ? menuItems[menuItems.length - 1] : menuItems[0];
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
    };
    const moveFocus = (dir) => {
      const menuItems = items();
      if (!menuItems.length) return;
      let index = menuItems.indexOf(document.activeElement);
      if (index < 0) index = 0;
      index = (index + dir + menuItems.length) % menuItems.length;
      try { menuItems[index].focus({ preventScroll: true }); } catch (_) { menuItems[index].focus(); }
    };

    const close = (returnFocus = false) => {
      panel.classList.remove('show');
      btn.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');
      if (returnFocus) {
        try { btn.focus({ preventScroll: true }); } catch (_) { btn.focus(); }
      }
    };
    const toggle = (force, focus) => {
      const willOpen = !panel.classList.contains('show');
      const open = typeof force === 'boolean' ? force : willOpen;
      panel.classList.toggle('show', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open && focus) focusItem(focus);
      return open;
    };

    panel.setAttribute('aria-hidden', panel.classList.contains('show') ? 'false' : 'true');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const opened = toggle();
      if (opened && e.detail === 0) focusItem('first');
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        toggle(true, e.key === 'ArrowUp' ? 'last' : 'first');
      } else if (e.key === 'Escape' && panel.classList.contains('show')) {
        e.preventDefault();
        close(true);
      }
    });

    panel.addEventListener('keydown', (e) => {
      if (!panel.classList.contains('show')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
      else if (e.key === 'Home') { e.preventDefault(); focusItem('first'); }
      else if (e.key === 'End') { e.preventDefault(); focusItem('last'); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') { close(false); }
    });

    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('show')) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('show')) {
        close(panel.contains(document.activeElement));
      }
    });

    const root = document.getElementById('menuRoot');
    root?.addEventListener('focusout', () => {
      if (!panel.classList.contains('show')) return;
      setTimeout(() => {
        if (!root.contains(document.activeElement)) close(false);
      }, 0);
    });
  }

  async function clearCacheAndReload() {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (_) {}
    try { location.reload(); } catch (_) {}
  }

  function bindClearCache() {
    const btn = document.getElementById('btnClearCache');
    if (!btn || btn.dataset.shellBound === '1') return;

    // En el simulador, bv-ui.js es el propietario de "Limpiar caché": usa un
    // handler delegado con confirmación y semántica específica. Los botones de
    // tema/menú ya llevan bvBound cuando ese coordinador terminó de enlazarse;
    // usar esa misma señal evita registrar aquí un segundo handler directo que
    // se ejecutaría ANTES que la confirmación del listener delegado.
    const pageTheme = document.getElementById('btnTheme');
    const pageMenu = document.getElementById('btnMenu');
    const pageOwnsShell = pageTheme?.dataset.bvBound === '1' || pageMenu?.dataset.bvBound === '1';
    if (pageOwnsShell) return;

    btn.dataset.shellBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      clearCacheAndReload();
    });
  }

  // ===== SERVICE WORKER UPDATE (agresivo, compartido) =====
  // Lógica extraída a js/lf-sw-update.js (compartida con lf-app.js).
  // Este fichero debe cargarse después de lf-sw-update.js en el HTML.
  if (window.LF && typeof window.LF.initSwUpdate === 'function') {
    window.LF.initSwUpdate({ swUrl: '/sw.js' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Defer to allow page-specific handlers (e.g., BVSim) to bind first.
    setTimeout(() => {
      bindThemeToggle();
      bindMenu();
      bindClearCache();
    }, 0);
  });
})();
