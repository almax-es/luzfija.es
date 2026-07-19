// Configuracion ESLint (flat config, ESLint 9) - Fase 1: solo deteccion de bugs.
// Alcance: js/ (codigo de produccion). Sin reglas de estilo.
// no-unused-vars queda desactivada hasta la fase 2 de limpieza.
import js from '@eslint/js';
import globals from 'globals';

// API interna entre ficheros: funciones definidas a nivel superior en un
// fichero y usadas desde otros (todos comparten el scope global del navegador).
const projectGlobals = {
  // js/lf-ui.js
  toast: 'readonly',
  setStatus: 'readonly',
  hideResultsToInitialState: 'readonly',
  // js/lf-inputs.js
  validateInputs: 'readonly',
  saveInputs: 'readonly',
  updateKwhHint: 'readonly',
  __LF_getFiscalContext: 'readonly',
  // js/lf-app.js
  runCalculation: 'readonly',
  // js/pvpc.js
  crearTarifaPVPC: 'readonly',
  // js/pvpc-stats-engine.js
  PVPC_STATS: 'readonly',
  // js/desglose-integration.js
  mostrarDesglose: 'readonly',
  // js/lf-utils.js
  lfDbg: 'readonly',
};

// Vendors cargados via <script> (no importados)
const vendorGlobals = {
  Chart: 'readonly',
  Tesseract: 'readonly',
  pdfjsLib: 'readonly',
  XLSX: 'readonly',
  jsQR: 'readonly',
  goatcounter: 'readonly',
};

export default [
  {
    ignores: ['vendor/**', 'node_modules/**', 'data/**', 'logs/**'],
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...vendorGlobals,
        ...projectGlobals,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Limpiado el 2026-07-02. catch defensivos sin variable usada son
      // deliberados; params/descartes con prefijo _ se ignoran a proposito
      'no-unused-vars': ['error', {
        caughtErrors: 'none',
        argsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // Los catch vacios son deliberados (guardrails defensivos)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Limpiado el 2026-07-02 (escapes redundantes eliminados); como error
      // para cazar escapes genuinamente erroneos en las regex de los parsers
      'no-useless-escape': 'error',
      // Limpiado el 2026-07-02 (22 casos revisados a mano); como error
      // para que no vuelvan a acumularse
      'no-useless-assignment': 'error',
    },
  },
  {
    // Estos ficheros DEFINEN el global que la config declara para el resto
    files: ['js/pvpc-stats-engine.js'],
    languageOptions: { globals: { PVPC_STATS: 'off' } },
  },
  {
    files: ['js/pvpc.js'],
    languageOptions: { globals: { crearTarifaPVPC: 'off' } },
  },
  {
    // Guard UMD: usa module.exports si existe (entorno CommonJS/tests)
    files: ['js/guides-search.js'],
    languageOptions: {
      globals: { module: 'readonly' },
    },
  },
];
