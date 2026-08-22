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

Si eres una IA o entras al repo por primera vez, empieza por `AGENTS.md` y `CAPACIDADES-WEB.md`. Si vas a auditar el proyecto, lee tambien `AUDITORIA-IA.md` antes de clasificar hallazgos. Antes de tocar scripts, `defer`/`async`, CSS, preloads o el service worker, lee `ARRANQUE-CARGA.md`.

## Licencia Y Uso

LuzFija.es es un proyecto `source-available`: el código está publicado para transparencia, auditoría y colaboración, pero no es una licencia open source permisiva tipo MIT.

- Código fuente: PolyForm Shield License 1.0.0, ver `LICENSE`. No se permite usarlo para proporcionar productos o servicios que compitan con LuzFija.es.
- Contenido, guías, documentación, microcopy, diseño y datasets curados: todos los derechos reservados, ver `CONTENT-LICENSE.md`.
- Fuentes oficiales y datos de terceros conservan sus propios derechos; LuzFija.es protege su selección, normalización, estructura, comentarios, comparaciones y trabajo de curación.
- Para permisos comerciales, integraciones, republicación o usos competitivos: `hola@luzfija.es`.

Las versiones anteriores del repositorio pudieron publicarse bajo otros términos. Esta licencia aplica desde la versión que introduce este cambio en adelante, sin revocar permisos concedidos válidamente para versiones previas.

## Estado Actual (2026-08-22)

- 36 paginas HTML publicas:
  - 9 en raiz.
  - 1 en `estadisticas/`.
  - 26 en `guias/` (indice + 25 guias).
- 40 modulos JavaScript en `js/` (incluye `js/bv/`).
- 30.129 lineas JS aproximadas.
- 119 tarifas en `tarifas.json`.
- Suite de tests Vitest con 101 archivos y 1562 casos.

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
- `ARRANQUE-CARGA.md`:
- contrato de ejecucion de las tres aplicaciones,
- dependencias eager, DOM ready y perezosas,
- invariantes de scripts, tema, cascada CSS y service worker,
- criterio medido para no reordenar recursos persiguiendo Lighthouse.
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
- jsQR (lazy),
- SheetJS/xlsx (lazy),
- Chart.js.
- Inventario, versiones, SHA-256 y procedimiento de actualizacion de cada una: `vendor/README.md`.
  Ojo con GoatCounter: su `count.js` NO es upstream limpio, lleva dos parches locales
  (privacidad de la query y confirmacion de entrega). Se conserva la linea base pristina en
  `vendor/goatcounter/count.upstream.js` para poder reaplicarlos; nunca sobrescribir con un
  `curl` directo. `tests/vendor-inventory.test.js` vigila que el inventario no se desalinee.
- Sin backend para calculos: todo se ejecuta en cliente.

### Datasets versionados

- `tarifas.json` (ofertas comerciales).
- `/data/pvpc/` (REE/ESIOS indicador 1001).
- `/data/surplus/` (REE/ESIOS indicador 1739).
- `/data/ssaa/` (REE/ESIOS indicador 10328, servicios de ajuste medios mensuales).

Notas de tarifas:

- `fv.exc` es el precio de excedentes en €/kWh; `-1` significa precio indexado. Sin curva horaria se usa 0,020 €/kWh solo como referencia orientativa; con CSV horario trazable el simulador puede valorar el periodo importado contra `data/surplus/`. Si hay huecos en el indice, solo acepta el calculo horario parcial cuando la cobertura perdida es residual por horas y por kWh; si no, cae a la referencia orientativa con aviso.
- El campo interno `Activa` no se exporta a JSON: el generador exige literalmente `SI` o `NO` (tras `trim`); `NO` excluye la tarifa y cualquier otro valor aborta la generación para no publicar un dataset ambiguo. Ver `JSON-SCHEMA.md`.
- El flag `incluyeServiciosAjuste` debe ser booleano (`SI`/`NO`); cuando vale `NO`, el comparador aplica `/data/ssaa/` como mayor coste de energia antes de IEE e IVA/IGIC/IPSI.
- El campo `promo` marca las tarifas con oferta vigente: la web pinta una etiqueta "OFERTA" en la fila y una nota en el desglose, pero **la promocion nunca se aplica al calculo**. Un descuento que dure menos de 12 meses no debe estar dentro del precio: se guarda el precio base y la oferta se cuenta aparte. Detalle y casos resueltos en `JSON-SCHEMA.md`.

## PWA, Cache Y Offline

- Service Worker en `sw.js` con versionado por despliegue (`CACHE_VERSION`).
- Precache en dos niveles:
- `CORE_ASSETS` (obligatorio).
- `ASSETS` opcionales best-effort, con nucleos atomicos por ruta para solar y estadisticas: un build no se activa si deja una de esas herramientas a medias.
- Los recursos obligatorios se reintentan antes de abortar; si persiste el fallo, queda activo el SW anterior.
- Estrategias de cache:
- HTML: network-first, con fallback a una copia sana ante 408/429/5xx (los 404/410 reales se respetan).
- `tarifas.json`: network-only (sin cache para evitar datos obsoletos).
- La descarga de tarifas reintenta una vez los fallos transitorios. Si ambos
  intentos fallan durante un calculo, solo puede reutilizar una lista valida ya
  descargada en memoria por esa misma pestaña; nunca una copia persistida.
- JS/CSS: network-first (evita ejecutar codigo obsoleto durante horas).
- datasets PVPC/surplus/SSAA e indice de busqueda de guias: network-first.
- resto de recursos (imagenes y otros estaticos): stale-while-revalidate.
- Cliente con actualizacion agresiva de SW para aplicar nuevas versiones rapidamente.
- Una recarga diferida por actividad o por la ventana inicial programa su propio reintento al vencer el bloqueo; no espera al intervalo general de 15 minutos.
- Si falta una dependencia esencial, el cliente fuerza una comprobacion de
  version del SW y ofrece una recarga explicita persistente, indicando si la
  pestaña ejecuta un build anterior.
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

Entorno de referencia: Node.js 22 y npm 10, iguales al CI. Tras clonar en un
checkout limpio, instala con `npx -y npm@10 ci`.

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

1. Cada push a `main` (o `workflow_dispatch`) ejecuta el job `test`: `npm ci`, audit bloqueante de dependencias de produccion HIGH/CRITICAL, lint, tests y verificacion de repo sincronizado.
2. Si `test` pasa, `build_pages` construye `_site` con recursos publicos. Excluye por defecto Markdown interno, tests, scripts, configuracion y metadatos del repositorio; conserva deliberadamente `llms.txt`, `llms-full.txt`, `LICENSE`, `CONTENT-LICENSE.md`, `.well-known` y los assets/runtime de la web.
3. `deploy_pages` publica el artefacto con un grupo de concurrencia serializado (`cancel-in-progress: false`): los despliegues no se pisan y, con varios push seguidos, solo queda en cola el ultimo.
4. Si el audit de produccion, lint o tests fallan, no se publica nada: produccion conserva la version anterior.

El workflow `pvpc.yml` (diario, 20:00 UTC) actualiza `data/pvpc/`, `data/surplus/` y `data/ssaa/`; antes de publicar verifica frescura e integridad temporal con `scripts/check_data_freshness.py` (incluido su self-test). Para PVPC/excedentes, cualquier dia anterior al dia local vigente en la zona horaria del fichero debe estar completo (23/24/25 puntos por DST), no puede faltar ningun dia intermedio y el dia local vigente/futuros ya publicados pueden estar parciales sin saltos, duplicados ni timestamps de otro dia local. Si los datos quedan rancios, incompletos o ilegibles, `pvpc.yml` falla antes del commit. Si hay cambios validos, los commitea y dispara `tests.yml` para publicarlos.

La suite normal de `tests.yml` no usa el reloj para decidir si el dataset vivo esta fresco: su test de integridad exige que el historico sea continuo y completo hasta el penultimo dia publicado y permite que solo el ultimo dia publicado este parcial. Asi una incidencia nocturna del pipeline de datos queda visible y bloqueante en `pvpc.yml`, pero no impide desplegar un cambio de codigo no relacionado mientras el ultimo snapshot del repo siga siendo internamente coherente.


En runtime hay una segunda barrera: PVPC estándar falla cerrado si falta cualquier día cerrado;
las tarifas que necesitan SSAA quedan fuera del ranking si el dato regulado no está disponible
(`0` publicado explícitamente sigue siendo un valor válido); y el Service Worker usa caché sana
ante 408/429/5xx sin ocultar 404/410. Un HTTP 200 con JSON vacío o estructuralmente inválido no
se fija como dato válido en los cargadores endurecidos: se rechaza y puede reintentarse. Los
resultados parciales del Observatorio se etiquetan y no se cachean de forma pegajosa, y los fallos
de excedentes o del índice de guías son reintentables dentro de la misma sesión. La caché de
resultados PVPC usa `pvpc_cache_v3`, invalidando resultados `v2` creados antes de estas garantías.

Importante: el CI no actualiza el build ID. Los parametros `?v=` de JS/CSS/vendor y el `CACHE_VERSION` de `sw.js` se actualizan con el script local de despliegue (commits `Deploy vYYYYMMDD-HHMMSS`). Tras cambiar JS, CSS o `vendor/`, hay que ejecutar ese script antes de publicar; si no, los navegadores con cache antigua no recibiran los assets nuevos.

Nota: ese mecanismo local de despliegue es una herramienta privada y no se distribuye con este repositorio. Si necesitas publicar una version, solicita al mantenedor el procedimiento de despliegue vigente.

## Mantenimiento De Datos

- Actualizaciones de datasets PVPC/surplus/SSAA via GitHub Actions.
- Checklist completo de normativa, fuentes y cadencias en `MANTENIMIENTO-NORMATIVO.md`.
- Recomendacion operativa:
- mantener `tarifas.json` actualizado con fecha `updatedAt`,
- usar un flag de inactividad interno para retirar temporalmente tarifas sin borrar su registro completo,
- revisar cambios fiscales electricos: a 13/08/2026 ni el IPC de electricidad de junio (6,0%) ni el definitivo de julio (8,4%) alcanzan el umbral de mas del 15% del RDL 18/2026, asi que el comparador sigue en IVA 21% e IEE 5,11269632% en agosto y septiembre,
- validar cambios con `npm run lint` y `npm test` antes de publicar.
