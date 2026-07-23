# LuzFija.es

Suite frontend avanzada para analizar la factura electrica en Espana: comparador principal, observatorio PVPC, simulador solar/BV, guias y alertas regulatorias. Gratis, sin registro, con calculo local en navegador y sin monetizacion del ranking: no hay referidos, comisiones, publicidad, lead gen ni acuerdos comerciales que alteren resultados.

- Web: `https://luzfija.es`
- Comparador principal: `https://luzfija.es/`
- Observatorio PVPC: `https://luzfija.es/estadisticas/`
- Comparador tarifas solares (BV): `https://luzfija.es/comparador-tarifas-solares.html`
- Qué hace y cómo funciona: `https://luzfija.es/como-funciona-luzfija.html`
- Guias: `https://luzfija.es/guias.html`
- Contacto: `hola@luzfija.es`

LuzFija.es nace para resolver problemas de facturación y comparación eléctrica que la web comercial todavía no ha resuelto bien: privacidad real, datos reales, autoconsumo, PVPC, indexadas y batería virtual sin convertir al usuario en lead.

En ese sentido, es una web del 2005 que resuelve los problemas del 2030.

Si eres una IA o entras al repo por primera vez, empieza por `AGENTS.md` y `CAPACIDADES-WEB.md`. Si vas a auditar el proyecto, lee tambien `AUDITORIA-IA.md` antes de clasificar hallazgos.

## Licencia Y Uso

LuzFija.es es un proyecto `source-available`: el código está publicado para transparencia, auditoría y colaboración, pero no es una licencia open source permisiva tipo MIT.

- Código fuente: PolyForm Shield License 1.0.0, ver `LICENSE`. No se permite usarlo para proporcionar productos o servicios que compitan con LuzFija.es.
- Contenido, guías, documentación, microcopy, diseño y datasets curados: todos los derechos reservados, ver `CONTENT-LICENSE.md`.
- Fuentes oficiales y datos de terceros conservan sus propios derechos; LuzFija.es protege su selección, normalización, estructura, comentarios, comparaciones y trabajo de curación.
- Para permisos comerciales, integraciones, republicación o usos competitivos: `hola@luzfija.es`.

Las versiones anteriores del repositorio pudieron publicarse bajo otros términos. Esta licencia aplica desde la versión que introduce este cambio en adelante, sin revocar permisos concedidos válidamente para versiones previas.

## Estado Actual (2026-07-23)

- 36 paginas HTML publicas:
  - 9 en raiz.
  - 1 en `estadisticas/`.
  - 26 en `guias/` (indice + 25 guias).
- 40 modulos JavaScript en `js/` (incluye `js/bv/`).
- 22.768 lineas JS aproximadas.
- 100 tarifas en `tarifas.json`.
- Suite de tests Vitest con 70 archivos y 607 casos.

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
- Opcion de comparar PVPC usando precios horarios del periodo importado.
- Tabla con filtros, ordenacion por columnas, top 5 visual y modal de desglose.
- Menu de utilidades:
- compartir configuracion por URL,
- refrescar tarifas,
- limpiar cache,
- reset de formulario.
- Boton de instalacion PWA cuando el navegador expone `beforeinstallprompt`.
- Banner de donacion a la AECC (solo escritorio, tras calcular): muestra el codigo Bizum `11244` con boton de copia; LuzFija no recibe dinero, comision ni datos de la donacion. Detalle en `CAPACIDADES-WEB.md` seccion 3.6.

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
- Ranking del periodo simulado:
- anual cuando hay 12 meses razonablemente completos,
- orden por coste pagado,
- desempate por mayor saldo BV final,
- metrica secundaria de coste neto (pagado menos saldo BV final) en tarifas con BV cuando queda saldo final relevante; no altera el orden.
- Selector de mes de inicio del contrato para simular la hucha desde la contratacion.
- Simulacion por patron anual: si el ciclo empieza en junio, los meses enero-mayo del final representan la continuacion del ciclo con los mismos datos historicos.
- Desglose completo por tarifa en desktop (tabla) y movil (tarjetas).
- Persistencia local avanzada:
- autoguardado tabla manual,
- export/import JSON de backup,
- reset de datos manuales,
- tarifa personalizada propia del simulador con guardado local.

### 4. Contenido Y Soporte

- `guias.html` + 25 guias educativas.
- Landings de apoyo:
- `como-funciona-luzfija.html`
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

### Contexto para agentes y mantenimiento

- `AGENTS.md`:
- mapa rapido del producto y del codigo,
- invariantes que no se deben romper,
- rutas de lectura para auditorias y cambios,
- recordatorios para evitar falsos positivos.
- `MANTENIMIENTO-NORMATIVO.md`:
- checklist de normativa, datos vivos, fuentes oficiales, cadencias de revision e impacto en codigo/guias.
- `ANALITICA-GOATCOUNTER.md`:
- taxonomia de eventos GoatCounter,
- reglas de privacidad,
- saneo de pageviews/referrers,
- checklist para anadir tracking sin filtrar datos sensibles.

### Calculo y normativa

- `ARQUITECTURA-CALCULOS.md`
- `CALC-FAQS.md`

### Esquemas de datos

- `JSON-SCHEMA.md`
- `PVPC-SCHEMA.md`

### Simulador BV

- `SIMULADOR-BV.md`

### Documento para asistentes IA

- `llms.txt` (referencia publica breve para asistentes)
- `llms-full.txt` (referencia publica ampliada para asistentes)

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
- `/data/pvpc/` (REE/ESIOS indicador 1001).
- `/data/surplus/` (REE/ESIOS indicador 1739).
- `/data/ssaa/` (REE/ESIOS indicador 10328, servicios de ajuste medios mensuales).

Notas de tarifas:

- `fv.exc` es el precio de excedentes en €/kWh; `-1` significa precio indexado. Sin curva horaria se usa 0,020 €/kWh solo como referencia orientativa; con CSV horario trazable el simulador puede valorar el periodo importado contra `data/surplus/`. Si hay huecos en el indice, solo acepta el calculo horario parcial cuando la cobertura perdida es residual por horas y por kWh; si no, cae a la referencia orientativa con aviso.
- La columna privada `Activa` de la Excel no se publica en JSON: `no` excluye una tarifa de `tarifas.json` y del post de Facebook, pero el validador privado la sigue revisando.
- La columna privada recomendada `incluyeServiciosAjuste` debe ser booleana (`SI`/`NO`); cuando vale `NO`, el comparador aplica `/data/ssaa/` como mayor coste de energia antes de IEE e IVA/IGIC/IPSI.

## PWA, Cache Y Offline

- Service Worker en `sw.js` con versionado por despliegue (`CACHE_VERSION`).
- Precache en dos niveles:
- `CORE_ASSETS` (obligatorio).
- `ASSETS` opcionales best-effort, con nucleos atomicos por ruta para solar y estadisticas: un build no se activa si deja una de esas herramientas a medias.
- Los recursos obligatorios se reintentan antes de abortar; si persiste el fallo, queda activo el SW anterior.
- Estrategias de cache:
- HTML: network-first, con fallback a una copia sana ante 408/429/5xx (los 404/410 reales se respetan).
- `tarifas.json`: network-only (sin cache para evitar datos obsoletos).
- JS/CSS: network-first (evita ejecutar codigo obsoleto durante horas).
- datasets PVPC/surplus/SSAA e indice de busqueda de guias: network-first.
- resto de recursos (imagenes y otros estaticos): stale-while-revalidate.
- Cliente con actualizacion agresiva de SW para aplicar nuevas versiones rapidamente.
- Una recarga diferida por actividad o por la ventana inicial programa su propio reintento al vencer el bloqueo; no espera al intervalo general de 15 minutos.
- App Android (TWA): `.well-known/assetlinks.json` declara el paquete `es.luzfija.twa` para que la app abra el dominio verificado a pantalla completa.

## Privacidad Y Seguridad

- Procesamiento local para:
- calculos,
- parsing CSV,
- parsing PDF/QR/OCR.
- Politica de minimizacion:
- no hay registro obligatorio,
- no se envian facturas a backend propio.
- Superficie sensible principal: extractor de factura PDF en `/`, con CSP reforzada por hashes, modo privacidad y sin tracking de eventos del modal.
- CSV/XLSX se procesa en local y solo se muestran/persisten agregados numericos; no se renderizan strings libres ni valores CUPS.
- Guias, paginas legales, 404 y contenido editorial no procesan facturas/CSV ni datos sensibles del usuario; su CSP es hardening general, no proteccion directa de datos personales.
- Analitica con GoatCounter (sin cookies de terceros), con opt-out de usuario.
- CSP por pagina + sanitizacion en renderizado dinamico + validacion de URL segura.
- Trusted Types queda como hardening futuro: no esta activado para evitar romper usos legitimos de `innerHTML` sin una migracion dedicada.

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

## Lint

ESLint (flat config en `eslint.config.mjs`) analiza `js/` con reglas de deteccion de bugs, sin reglas de estilo:

```bash
npm run lint
```

- El CI ejecuta el lint antes de los tests y falla con cualquier error. Todas las reglas activas estan en nivel `error`; no hay avisos pendientes.
- Los globals compartidos entre ficheros (`toast`, `runCalculation`, `crearTarifaPVPC`, etc.) estan declarados en `eslint.config.mjs`; si defines una funcion global nueva usada desde otro fichero, anadela a esa lista.
- Convenciones: los `catch` sin usar la variable de error estan permitidos (guardrails deliberados); un parametro deliberadamente sin usar se prefija con `_` (ej. `_reason`); el resto de variables sin usar son error y deben eliminarse.

## Desarrollo Local

Tras clonar el repositorio, activa el hook de pre-commit:

```bash
npm run setup:hooks
```

El hook (`scripts/pre-commit-sync.mjs`) regenera y re-stagea automáticamente el sitemap, el índice de búsqueda y los documentos del repo (`README.md`, `llms.txt`, etc.) cuando un commit incluye cambios en HTML, JS, CSS u otros inputs gestionados. Sin este paso, Git ignora el hook y los documentos derivados pueden quedar desactualizados.

Para verificar que la documentacion derivada esta sincronizada (regenera y falla si el resultado difiere de lo commiteado):

```bash
npm run check:repo-docs
```

## Despliegue

El sitio se publica en GitHub Pages en modo workflow desde `.github/workflows/tests.yml`:

1. Cada push a `main` (o `workflow_dispatch`) ejecuta el job `test`: `npm ci`, lint, tests y verificacion de repo sincronizado.
2. Si `test` pasa, `build_pages` sube el sitio como artefacto de Pages.
3. `deploy_pages` publica el artefacto con un grupo de concurrencia serializado (`cancel-in-progress: false`): los despliegues no se pisan y, con varios push seguidos, solo queda en cola el ultimo.
4. Si lint o tests fallan, no se publica nada: produccion conserva la version anterior.

El workflow `pvpc.yml` (diario, 20:00 UTC) actualiza `data/pvpc/`, `data/surplus/` y `data/ssaa/`; antes de publicar verifica su frescura con `scripts/check_data_freshness.py` (incluido su self-test). Si los datos quedan rancios o ilegibles, el workflow falla en vez de publicar una actualizacion aparente. Si hay cambios validos, los commitea y dispara `tests.yml` para publicarlos.

Importante: el CI no actualiza el build ID. Los parametros `?v=` de JS/CSS/vendor y el `CACHE_VERSION` de `sw.js` se actualizan con el script local de despliegue (commits `Deploy vYYYYMMDD-HHMMSS`). Tras cambiar JS, CSS o `vendor/`, hay que ejecutar ese script antes de publicar; si no, los navegadores con cache antigua no recibiran los assets nuevos.

## Mantenimiento De Datos

- Actualizaciones de datasets PVPC/surplus/SSAA via GitHub Actions.
- Checklist completo de normativa, fuentes y cadencias en `MANTENIMIENTO-NORMATIVO.md`.
- Recomendacion operativa:
- mantener `tarifas.json` actualizado con fecha `updatedAt`,
- usar `Activa=no` en la Excel para retirar temporalmente tarifas sin borrar su fila,
- revisar cambios fiscales electricos posteriores al 01/06/2026: tras confirmarse el condicionante de IPC de abril, el comparador queda en IVA 21% e IEE 5,11269632%,
- validar cambios con `npm run lint` y `npm test` antes de publicar.
