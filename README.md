# LuzFija.es

Comparador avanzado de tarifas electricas en Espana, gratuito, sin registro y con calculo local en navegador.

- Web: `https://luzfija.es`
- Comparador principal: `https://luzfija.es/`
- Observatorio PVPC: `https://luzfija.es/estadisticas/`
- Comparador tarifas solares (BV): `https://luzfija.es/comparador-tarifas-solares.html`
- Guias: `https://luzfija.es/guias.html`
- Contacto: `hola@luzfija.es`

## Estado Actual (2026-02-08)

- 33 paginas HTML publicas:
- 8 en raiz.
- 1 en `estadisticas/`.
- 24 en `guias/` (indice + 23 guias).
- 28 modulos JavaScript (`js/*.js` + `js/bv/*.js`).
- 14.157 lineas JS aproximadas.
- 33 tarifas en `tarifas.json`.
- Suite de tests Vitest con 26 archivos y ~174 casos.

## Que Incluye La Web (Inventario Completo)

### 1. Comparador Principal (`/`)

- Compara tarifas 1P y 3P del mercado libre.
- Incluye PVPC estimado en el ranking (datos horarios oficiales ya publicados en dataset local).
- Limite de modelo PVPC: no computable cuando potencia contratada > 10 kW.
- Soporta:
- discriminacion horaria,
- placas solares,
- compensacion de excedentes,
- bateria virtual,
- bono social,
- tarifa personalizada del usuario.
- Extrae datos de factura PDF (texto + QR + OCR opcional).
- Importa consumos desde CSV/XLSX (incluye clasificacion P1/P2/P3 y soporte formatos distribuidoras).
- Modal de aplicacion CSV con opcion de aplicar solo consumos o consumos+excedentes.
- Incluye analisis especifico de Octopus Sun Club al aplicar CSV con curva horaria.
- Tabla con filtros, ordenacion por columnas, top 5 visual y modal de desglose.
- Bloque de novedades de mercado cargado desde `novedades.json`.
- Menu de utilidades:
- compartir configuracion por URL,
- refrescar tarifas,
- limpiar cache,
- reset de formulario.
- Boton de instalacion PWA cuando el navegador expone `beforeinstallprompt`.

### 2. Observatorio PVPC (`/estadisticas/`)

- Selector de tipo de dato: `pvpc` o `surplus`.
- Selector geografia (8741..8745), ano y mes.
- KPIs dinamicos (ultimo dia, medias/ extremos, rolling 12m, YoY).
- Graficos:
- evolucion (diaria o mensual),
- perfil horario promedio,
- comparativa multianual por chips.
- Importador CSV/XLSX de excedentes del usuario con:
- KPIs anuales,
- tabla mensual con energia/precio/importe,
- tramo horario principal (80% del vertido),
- hora pico.
- Esta seccion CSV se habilita en modo `surplus`.

### 3. Simulador BV Independiente (`/comparador-tarifas-solares.html`)

- Simulacion mes a mes con datos reales de autoconsumo.
- Modo hibrido:
- importas CSV/XLSX,
- se auto-rellena tabla manual mensual,
- puedes editar y simular escenarios.
- Ranking anual:
- orden por coste anual pagado,
- desempate por mayor saldo BV final.
- Desglose completo por tarifa en desktop (tabla) y movil (tarjetas).
- Persistencia local avanzada:
- autoguardado tabla manual,
- export/import JSON de backup,
- reset de datos manuales,
- tarifa personalizada propia del simulador con guardado local.

### 4. Contenido Y Soporte

- `guias.html` + 23 guias educativas.
- Landings de apoyo:
- `calcular-factura-luz.html`
- `comparar-pvpc-tarifa-fija.html`
- `404.html` con enlaces rapidos y buscador hacia guias.
- `aviso-legal.html` y `privacidad.html` (incluye opt-out de analitica GoatCounter).

## Documentacion De Referencia

### Inventario funcional (fuente de verdad)

- `CAPACIDADES-WEB.md`:
- mapa pagina por pagina,
- flujos completos de usuario,
- capacidades para asistentes IA,
- reglas anti-lagunas.

### Calculo y normativa

- `ARQUITECTURA-CALCULOS.md`
- `CALC-FAQS.md`

### Esquemas de datos

- `JSON-SCHEMA.md`
- `PVPC-SCHEMA.md`

### Simulador BV

- `SIMULADOR-BV.md`

### Documento para asistentes IA

- `llms.txt`

## Arquitectura Tecnica

- Stack: HTML + CSS + Vanilla JS modular.
- Hosting: GitHub Pages (sitio estatico).
- Dependencias autoalojadas en `vendor/`:
- PDF.js (lazy),
- Tesseract (lazy),
- jsQR,
- SheetJS/xlsx (lazy),
- Chart.js.
- Sin backend para calculos: todo se ejecuta en cliente.

### Datasets versionados

- `tarifas.json` (ofertas comerciales).
- `novedades.json` (avisos/noticias de home).
- `/data/pvpc/` (REE/ESIOS indicador 1001).
- `/data/surplus/` (REE/ESIOS indicador 1739).

## PWA, Cache Y Offline

- Service Worker en `sw.js` con versionado por despliegue (`CACHE_VERSION`).
- Precache en dos niveles:
- `CORE_ASSETS` (obligatorio).
- `ASSETS` opcionales best-effort.
- Estrategias de cache:
- HTML: network-first.
- `tarifas.json`: network-only (sin cache para evitar datos obsoletos).
- `novedades.json`: stale-while-revalidate.
- datasets PVPC/surplus: network-first.
- resto de recursos: stale-while-revalidate.
- Cliente con actualizacion agresiva de SW para aplicar nuevas versiones rapidamente.

## Privacidad Y Seguridad

- Procesamiento local para:
- calculos,
- parsing CSV,
- parsing PDF/QR/OCR.
- Politica de minimizacion:
- no hay registro obligatorio,
- no se envian facturas a backend propio.
- Analitica con GoatCounter (sin cookies de terceros), con opt-out de usuario.
- CSP por pagina + sanitizacion en renderizado dinamico + validacion de URL segura.

## Testing

Ejecutar:

```bash
npm test
```

Cobertura principal:

- motor de calculo e impuestos,
- PVPC y cache,
- importadores CSV/XLSX,
- factura PDF + QR/OCR,
- desglose e integraciones UI,
- seguridad URL/XSS,
- privacidad/tracking.

## Mantenimiento De Datos

- Actualizaciones de datasets PVPC/surplus via GitHub Actions.
- Recomendacion operativa:
- mantener `tarifas.json` actualizado con fecha `updatedAt`,
- revisar `novedades.json` para avisos regulatorios,
- validar cambios con `npm test` antes de publicar.
