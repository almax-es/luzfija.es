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
})();
