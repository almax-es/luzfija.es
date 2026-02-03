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

    const close = () => {
      panel.classList.remove('show');
      btn.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');
    };
    const toggle = () => {
      const willOpen = !panel.classList.contains('show');
      panel.classList.toggle('show', willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      panel.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
    };

    panel.setAttribute('aria-hidden', panel.classList.contains('show') ? 'false' : 'true');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('show')) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
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
    btn.dataset.shellBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      clearCacheAndReload();
    });
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
