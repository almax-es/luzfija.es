// Guard global defensivo: definir currentYear antes que nada
// Esto evita errores "currentYear is not defined" en código asíncrono
try {
  if (typeof window.currentYear !== 'number') {
    window.currentYear = new Date().getFullYear();
  }
} catch (_) {
  // Si falla, continuar silenciosamente
}

// Configuración PVPC - Dataset estático
// PVPC se calcula 100% en local a partir del dataset en /data/pvpc.
// Dataset actualizado diariamente por GitHub Actions desde ESIOS API.
window.PVPC_DATASET_BASE = "/data/pvpc";
