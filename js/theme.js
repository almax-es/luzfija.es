// Sistema de tema claro/oscuro (carga antes del render para evitar flash)
(function(){
  const key = 'almax_theme';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
    window.__ALMAX_THEME_SAVED = saved;
  } catch(e) {
    // localStorage no disponible (modo privado, etc.)
  }
  window.__ALMAX_THEME_KEY = key;

  // Cargar INP debug solo en modo debug (sin ensuciar producción)
  try {
    const params = new URLSearchParams(location.search);
    const debug = params.get('debug') === '1' ||
      localStorage.getItem('lf_debug') === '1' ||
      window.__LF_DEBUG === true;
    if (debug) {
      window.__LF_DEBUG = true;
      const loadDebug = () => {
        if (window.__LF_INP_DEBUG_ACTIVE) return;
        if (document.querySelector('script[data-lf-inp-debug]')) return;
        const s = document.createElement('script');
        s.src = '/js/inp-debug.js';
        s.defer = true;
        s.dataset.lfInpDebug = '1';
        document.head.appendChild(s);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDebug, { once: true });
      } else {
        loadDebug();
      }
    }
  } catch (_) {}
})();
