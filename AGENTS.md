# AGENTS.md

Contexto operativo para agentes que entren al repo de LuzFija.es.

## Que Es Este Proyecto

No es solo "un comparador de tarifas". Es una suite frontend local-first con cuatro bloques principales:

1. `/`: comparador principal de tarifas del mercado libre con PVPC, autoconsumo, bateria virtual, bono social, importacion CSV/XLSX y extraccion de factura PDF.
2. `/estadisticas/`: observatorio PVPC y excedentes con historico, KPIs, graficos y analitica personal desde CSV/XLSX.
3. `/comparador-tarifas-solares.html`: simulador independiente mes a mes para tarifas con excedentes remunerados, con o sin BV.
4. Capa editorial y soporte: `guias/`, `guias.html`, `como-funciona-luzfija.html`, `404.html`, `privacidad.html`, `aviso-legal.html`.

Tambien es importante lo que no es: no monetiza el ranking, no vende leads y no tiene referidos, comisiones, publicidad ni acuerdos comerciales que condicionen el orden de resultados.

## Orden Recomendado De Lectura

1. `CAPACIDADES-WEB.md`
2. `AUDITORIA-IA.md` si vas a hacer revision, auditoria o threat modeling. Lee completo `AUDITORIA-IA.md`; consulta `AUDITORIA-REGISTRO.md` unicamente por el area relevante, no de forma lineal.
3. `ARRANQUE-CARGA.md` **obligatorio antes de tocar el orden de carga**: etiquetas `<script>`, `defer`/`async`, hojas de estilo, preloads o el registro del service worker
4. `README.md`
5. `ARQUITECTURA-CALCULOS.md`
6. `CALC-FAQS.md`
7. `MANTENIMIENTO-NORMATIVO.md`
8. `SIMULADOR-BV.md`
9. `ANALITICA-GOATCOUNTER.md`
10. `JSON-SCHEMA.md`
11. `PVPC-SCHEMA.md`
12. `llms.txt` y `llms-full.txt` para ver como se presenta la herramienta a asistentes externos

`CAPACIDADES-WEB.md` es la fuente de verdad funcional. Si algo parece contradecir otra doc, parte de ahi.

`ARRANQUE-CARGA.md` es la fuente de verdad del contrato de arranque. Varios modulos desestructuran sus dependencias en tiempo de evaluacion, asi que el orden de los recursos en el HTML es contrato de ejecucion, no formato. Algunas regresiones de arranque no producen excepcion ni senal diagnostica automatica, aunque sus consecuencias funcionales si sean observables; las vigila `tests/bootstrap-contract.test.js`.

## Mapa Rapido Del Codigo

- `index.html` + `js/lf-*.js`: comparador principal, estado, inputs, calculo, render, CSV y cache.
- `js/pvpc.js`: motor PVPC usando datasets locales en `data/pvpc/`.
- `js/factura.js`: extraccion PDF, carga de jsQR y OCR opcional con Tesseract; los parsers de texto y QR CNMC viven en `js/factura-parsers.js`.
- `js/desglose-*.js`: desglose detallado de factura en la home.
- `estadisticas/index.html` + `js/pvpc-stats-*.js`: observatorio PVPC/excedentes.
- `comparador-tarifas-solares.html` + `js/bv/*.js`: simulador solar/BV y flujo hibrido CSV -> manual.
- `js/lf-csv-utils.js`: parser horario compartido y clasificacion P1/P2/P3 canonica.
- `js/tracking.js` + `vendor/goatcounter/count.js`: analitica GoatCounter, pageviews canonicos, eventos, privacidad y saneo de referrers. Ver `ANALITICA-GOATCOUNTER.md`.
- `sw.js`: cache/PWA/update flow.
- `scripts/sync-seo-docs.mjs`: sincroniza sitemap e indice de busqueda y, con `--include-repo-docs`, tambien metricas/referencias de README, CAPACIDADES, JSON-SCHEMA y `llms*`, mas el indice de `AUDITORIA-IA.md` generado desde `AUDITORIA-REGISTRO.md`.
- `scripts/check_data_freshness.py`: guardia de frescura de los datasets (pvpc/surplus/ssaa); `pvpc.yml` la ejecuta tras la descarga diaria e incluye self-test (`--self-test`). Detalle en `PVPC-SCHEMA.md`.

### Inventario Completo De Modulos JS

Una linea por modulo para no confundir ficheros con nombres parecidos (`config.js` vs `lf-config.js`) ni asumir que un modulo pequeno es prescindible.

| Modulo | Proposito |
| --- | --- |
| `js/config.js` | Guard global defensivo (define `currentYear` y globals legacy antes que el resto de scripts). No confundir con `lf-config.js`. |
| `js/error-bootstrap.js` | Buffer efimero y sin mensajes para errores first-party tempranos + watchdog visual de ultimo recurso cuando no llega a cargar el coordinador completo de home, factura, desglose, solar u observatorio. Deja ademas una solicitud cerrada de recuperacion para que el coordinador del SW ofrezca recarga aunque falle tracking. Se carga antes de `config.js` en las tres aplicaciones. |
| `js/theme.js` | Guard redundante + tema temprano para entradas legacy que cargan `theme.js` antes que nada. |
| `js/shell-lite.js` | Tema + menu para paginas sin `lf-app`/`bv-ui` (guias, landings, legal, 404). |
| `js/lf-sw-update.js` | Registro + auto-update + guard de recarga del service worker (`window.LF.initSwUpdate`), compartido por `lf-app.js` y `shell-lite.js`; ante una dependencia esencial ausente fuerza `update()`, compara builds y ofrece recarga explicita. Debe cargarse antes que ellos en el HTML. |
| `js/index-extra.js` | Scripts de la home extraidos de `index.html` (modal PVPC, instalacion PWA, compartir) para cacheo y CSP. |
| `js/index-extra-loader.js` | Shim de compatibilidad para clientes con SW/HTML antiguos que aun piden ese fichero; retirable cuando dejen de solicitarlo. |
| `js/inp-debug.js` | Instrumentacion INP, solo activa con `?debug=1` o `lf_debug=1`. |
| `js/lf-config.js` | `LF_CONFIG`: valores regulados centralizados (IVA/IGIC/IPSI, IEE, bono social, alquiler contador). |
| `js/lf-state.js` | Estado global y referencias DOM del comparador principal. |
| `js/lf-utils.js` | Utilidades puras + calculo de factura PVPC (bono social e IEE) + `assessConsumoAnualLimits` (limites de consumo, compartida con el simulador solar). |
| `js/lf-cache.js` | Carga de `tarifas.json` (network-only, sin cache), con un reintento acotado y diagnostico por intento. |
| `js/lf-inputs.js` | Validacion y load/save de inputs del formulario. |
| `js/lf-calc.js` | Motor de calculo principal (mercado libre, excedentes, BV, SSAA). |
| `js/lf-render.js` | Tabla de resultados, grafico top 5, KPIs, filtros y ordenacion (render chunked para INP). |
| `js/lf-ui.js` | Toast, status y errores basicos de UI. |
| `js/lf-tooltips.js` | Sistema de tooltips del comparador. |
| `js/lf-tarifa-custom.js` | Tarifa personalizada "Mi tarifa" de la home. |
| `js/lf-app.js` | Coordinador de inicializacion de la home (orden de modulos, auto-refresh). |
| `js/lf-csv-utils.js` | Parser CSV/XLSX canonico compartido + clasificacion P1/P2/P3 y festivos. |
| `js/lf-csv-import.js` | Importador CSV/XLSX de la home (modal de aplicacion, PVPC del periodo). |
| `js/lf-ssaa.js` | Carga `/data/ssaa/index.json` y expone el coste SSAA mensual al calculo. |
| `js/lf-surplus-prices.js` | Valor horario de excedentes indexados contra `data/surplus/`. |
| `js/pvpc.js` | Motor PVPC de la home (datasets estaticos, cache localStorage, parseo QR CNMC legacy vivo). |
| `js/factura-parsers.js` | Parsers puros de texto de factura y QR CNMC, publicados para el extractor. |
| `js/factura.js` | Extractor de factura PDF (PDF.js + jsQR + OCR Tesseract, modo privacidad). |
| `js/pdfjs-worker-bootstrap.mjs` | Bootstrap lazy del worker PDF.js: instala compatibilidad de `Promise.withResolvers` y `Map#getOrInsertComputed` antes de evaluar el vendor, conserva la query de build y reexporta el handler del fallback sin editar el vendor. |
| `js/desglose-calculo.js` | Calculo puro del desglose detallado de factura. |
| `js/desglose-render.js` | Renderizado y formateo del desglose detallado de factura. |
| `js/desglose-factura.js` | Ciclo de vida y accesibilidad del modal de desglose detallado de factura. |
| `js/desglose-integration.js` | Integracion del desglose con el comparador. |
| `js/guides-search.js` | Buscador de guias sobre `data/guides-search-index.json`. |
| `js/pvpc-stats-engine.js` | Motor de datos del observatorio (carga, agregacion, cache en memoria). |
| `js/pvpc-stats-csv.js` | Parser CSV/XLSX e indexado horario CNMC para la compensacion de excedentes del observatorio. |
| `js/pvpc-stats-ui.js` | UI del observatorio (KPIs, charts, CSV de excedentes del usuario). |
| `js/tracking.js` | GoatCounter: pageviews canonicos, eventos, opt-out, saneo de referrers. |
| `js/aecc-banner.js` | Banner de donacion AECC (solo home, solo escritorio). |
| `js/bv/bv-import.js` | Importacion CSV/XLSX del simulador solar; detecta excedentes y, si no existen, importa el consumo con excedentes a cero. |
| `js/bv/bv-sim-monthly.js` | Motor mensual del simulador BV (compensacion, hucha, impuestos por zona). |
| `js/bv/bv-ui-helpers.js` | Helpers puros de UI manual (meses, saldo BV, coste neto, cobertura anual de consumo y trazabilidad horaria). |
| `js/bv/bv-ui.js` | UI del simulador solar (formulario, tabla manual, ranking, desglose, tooltips). |

## Invariantes Criticos

- No hay backend propio para calculos, parsing de facturas ni importacion de CSV. Todo ocurre en cliente.
- PVPC y excedentes se calculan con datasets estaticos versionados en `data/pvpc/` y `data/surplus/`, no con llamadas live a ESIOS desde el navegador.
- En la home, PVPC no se calcula cuando la potencia contratada supera 10 kW.
- El comparador principal y el simulador solar son herramientas distintas. No comparten la misma logica de ranking.
- En las rutas productivas normales, los impuestos indirectos (IVA, IGIC e IPSI) se aplican en
  `LF_CONFIG.calcularImpuestoIndirecto()` desde bases monetarias normalizadas a centimos y tipos
  expresados en puntos basicos. No sustituyas esa ruta por `round2(base * tipo)` ni tomes la
  igualdad entre motores como prueba suficiente: IEEE-754 puede hacer que ambos coincidan en el
  mismo centimo incorrecto. Toda modificacion fiscal debe conservar
  `tests/fiscal-rounding-align.test.js` y contrastarse con una referencia decimal independiente.
  `lf-utils.js` y `bv-sim-monthly.js` conservan fallbacks defensivos no equivalentes si falta el
  helper; no los trates como referencia ni como bug observable sin demostrar una carga parcial que
  llegue a mostrar el importe.
- En el simulador solar, el ranking visible usa `totals.pagado` y desempata con `totals.bvFinal`. `totals.real` existe como metrica auxiliar, no como criterio principal de ordenacion actual. La UI puede mostrar `totals.pagado - totals.bvFinal` como coste neto secundario si queda saldo BV final relevante, pero no reordena el ranking.
- Si hay importacion horaria y el usuario activa `PVPC con precios del periodo`, la home puede cruzar la curva del CSV con precios PVPC horarios reales del periodo importado. Si no, compara contra el PVPC actual/reciente.
- En la home, `spanDays` (primera→ultima fecha) y `dias` (fechas con registros) son conceptos
  distintos. La importacion mantiene `dias` para el campo economico actual y, cuando
  `spanDays > dias`, el preview avisa expresamente de la discontinuidad y de que los cargos
  diarios usaran `dias`. No sustituyas automaticamente `dias` por `spanDays` sin una decision
  explicita de producto sobre importaciones parciales.
- El parser horario canonico es `window.LF.csvUtils.getPeriodoHorarioCSV`. No dupliques esa logica en otros modulos.
- `tarifas.json` sigue siendo network-only. Tras dos intentos fallidos durante
  un calculo, solo se permite continuar con `baseTarifasCache` si contiene una
  descarga valida de esa misma carga de pagina; no se persiste en disco. Una
  descarga solo cuenta como valida si supera la comprobacion estructural de
  `esTarifaUtilizable` (`js/lf-cache.js`), que es atomica: una sola tarifa rota
  invalida el dataset completo y preserva la copia sana anterior.
- **El scroll de la home vive en `BODY`, no en el elemento raiz.** `html,body{height:100%}`
  junto con `body{overflow-x:hidden}` (que fuerza `overflow-y:auto` computado) hace que el
  contenedor de scroll sea `BODY`. Consecuencia al medir: `window.scrollY` y
  `document.documentElement.scrollTop` valen 0 SIEMPRE y asignarles un valor no mueve nada;
  hay que leer y escribir `document.body.scrollTop`. `document.scrollingElement` engana,
  porque devuelve `HTML` aunque ese elemento no scrollee (`scrollHeight === clientHeight`).
  Medido en Chrome, movil y escritorio (07/08/2026). Es un falso negativo silencioso: una
  comprobacion de "no se ha movido" basada en `window.scrollY` da siempre positiva.
  Los modales de la home deben usar `window.LF.modalScrollLock` (`js/lf-utils.js`) para bloquear
  y restaurar el scroll: el helper guarda `document.body.scrollTop`, preserva los `overflow`
  inline previos de BODY/HTML y mantiene el bloqueo hasta liberar el ultimo modal activo. No
  reintroduzcas locks locales basados en `window.scrollY`/`window.scrollTo()`.
- **El lienzo necesita `background-color` propio en `html`.** Los degradados del `body` son
  `background-image` y quedan anclados a su caja, que mide una pantalla exacta por el
  `height:100%`. Sin un color de fondo solido, el area que se descubre al replegarse la
  barra del navegador o al rebotar el scroll se pinta con el defecto del lienzo, y salia
  BLANCA (visible en Android al scrollear rapido, junto a los botones del sistema). No
  sustituyas `html{background-color: var(--bg0)}` por un degradado ni lo elimines al
  refactorizar fondos; lo vigila `tests/canvas-background.test.js`.
- **En tema web OSCURO, `color-scheme` computa `dark light`, no `dark`.** El
  `<meta name="color-scheme" content="dark light">` de `index.html` gana a
  `html{color-scheme:dark}` de `styles.css`. Consecuencia: al declarar soporte para ambos
  esquemas, el navegador elige los defaults de UA (lienzo, controles de formulario,
  barras de scroll) segun el tema del **SISTEMA**, no segun el tema elegido en la web. Es
  la causa raiz de la clase de bugs "SO != tema web" ya vista en la auditoria del
  28/07/2026. Medido en las cuatro combinaciones el 07/08/2026. En tema web claro si
  computa `light` limpio; la asimetria es solo del modo oscuro.

## Reglas Para Revisiones Y Auditorias

- Antes de cualquier auditoria general, lee completo `AUDITORIA-IA.md`; contiene la taxonomia de severidad, el metodo y el indice. Consulta en `AUDITORIA-REGISTRO.md` solo las areas relevantes: ahi viven los falsos positivos repetidos y las decisiones de implementacion que no deben elevarse como bugs.
- Antes de reportar bugs de fiscalidad o PVPC, lee `ARQUITECTURA-CALCULOS.md` y `CALC-FAQS.md`.
- Antes de reportar bugs de BV, lee `SIMULADOR-BV.md` y revisa `js/bv/bv-ui.js` y `js/bv/bv-sim-monthly.js`.
- Antes de reportar bugs de importacion horaria, revisa `js/lf-csv-utils.js`, `js/lf-csv-import.js` y los tests de CSV.
- Antes de cambiar o auditar analitica, lee `ANALITICA-GOATCOUNTER.md`, `js/tracking.js`, `vendor/goatcounter/count.js` y los tests `tests/tracking-*.test.js`.
- El CI corre con **Node 22** (`.github/workflows/tests.yml`). Una suite verde en local con un Node mas nuevo NO garantiza que pase en remoto: `Promise.try` (Node 23+) tumbo el despliegue del 03/08/2026 tras actualizar PDF.js. Al tocar `vendor/` o cualquier cosa que dependa de APIs recientes del runtime, ejecutar la suite con Node 22 antes de desplegar.
- Antes de actualizar cualquier dependencia de `vendor/`, lee `vendor/README.md`: tiene version, SHA-256 y procedimiento por libreria. Dos trampas ya documentadas ahi que NO hay que volver a pisar: (1) `vendor/goatcounter/count.js` no es upstream limpio, lleva cuatro parches locales y sobrescribirlo con `curl` los destruye en silencio -usar la linea base `count.upstream.js` para el merge-; (2) el dist-tag `latest` de `tesseract.js-core` apunta a la linea 6.x, pero el wrapper 7.x exige core `^7.0.0`, asi que "actualizar a latest" seria una regresion.
- Al actualizar PDF.js, usa siempre el par de la misma version exacta desde `pdfjs-dist/legacy/build/`, no `build/`. No retires por intuicion los shims de `Promise.withResolvers`/`Map#getOrInsertComputed` ni sustituyas `streamTextContent().getReader()` por `getTextContent()`: primero demuestra con la nueva version que ya no son necesarios y actualiza las regresiones. Ejecuta `tests/pdfjs-real.test.js`, `tests/factura-lifecycle.test.js` y la suite con Node 22; cuando haya navegador disponible, ejecuta tambien `tests/factura-lifecycle-chromium.test.js` con worker real y fake-worker.
- Cualquier cambio en `js/factura.js` o `js/factura-parsers.js` debe pasar por la interfaz real todas las facturas disponibles en el banco local —14 a 02/09/2026— comparando candidato contra produccion. No fijes el gate en esa cifra: si el banco crece, deben probarse todas. Para compatibilidad PDF.js/WebKit, conserva ademas un control negativo que falle con el camino retirado y una prueba positiva que ejercite documento y worker; no atribuyas el spinner original a una promesa concreta si esa espera no se ha reproducido.
- Antes de reportar riesgos XSS/privacidad por CSV, ten en cuenta que `CUPS` puede reconocerse como nombre de columna para detectar cabecera/formato, pero sus valores no se guardan ni se renderizan. Los importadores solo muestran agregados numericos derivados (kWh, dias, porcentajes, importes).
- Antes de reportar CSP laxa en guias o paginas editoriales, distingue superficie sensible de superficie editorial. El flujo sensible de datos personales es la extraccion de factura PDF en la home (`index.html` + `js/factura.js`), y ahi `script-src` esta reforzado con hashes. Las guias, paginas legales, 404 y `como-funciona-luzfija.html` no procesan datos sensibles del usuario; endurecer su CSP puede ser higiene tecnica, pero no debe elevarse como hallazgo de privacidad relevante por si solo.
- Antes de reportar `Trusted Types` como problema, ten en cuenta que es hardening futuro, no bug actual: las paginas sensibles usan CSP con hashes y el render dinamico sanea contenido. Activar `require-trusted-types-for 'script'` exige migracion dedicada de los usos legitimos de `innerHTML`.
- Antes de reportar bloqueo por CSV grande como bug critico, distingue mejora de rendimiento de rotura funcional. El parsing CSV/XLSX es local y actualmente sincrono; `SIMULADOR-BV.md` lo recoge como roadmap (`Progreso de carga para CSV grandes`, `Web Worker`). No propongas meter `await` dentro de `parseEnergyTableRows` sin contemplar que cambiaria su contrato sincronico compartido.
- Antes de reportar que el PVPC con CSV trata silenciosamente los precios ausentes, revisa la cobertura generada por `pvpc.js`: con huecos residuales (maximo 10% de horas y 10% de kWh) usa exacto+media solo para los huecos; si falta un mes completo, se supera algun umbral o no hay una media valida, cae a medias completas. Ambos casos se explican en el desglose y en `renderPvpcInfo`.
- No confundas `resultadoPVPC[].explicacion` con copy visible: es un canal interno legacy que `parsearRespuestaPVPC` sigue parseando para recuperar P1/P2/P3. La UI de cobertura vive en `renderPvpcInfo()` y en `desglose-render.js`.
- Antes de reportar race condition en `__LF_CALC_INFLIGHT`, recuerda que el navegador ejecuta los handlers JS en un unico hilo y el guard se asigna sin `await` entre lectura y escritura. Es deuda futura solo si se introduce concurrencia real/Workers en el calculo principal.
- El toast que muestra `error-bootstrap.js` ante un coordinador ausente es persistente por decision deliberada: no es una notificacion ordinaria, sino el unico aviso post-click en los fallos completos de factura y desglose. Home, solar y observatorio mantienen ademas texto persistente en su propia UI.
- La normalizacion de errores solo acepta fuentes same-origin HTTP(S). `tracking.js` y `error-bootstrap.js` rechazan `blob:`, `data:` y otros protocolos aunque aparenten compartir origen; los tests cubren `blob:`. Una regresion de este contrato si es un bug de cardinalidad/privacidad.
- Valida hallazgos contra tests, no solo contra intuicion.

Tests especialmente utiles:

- `tests/pvpc.test.js`
- `tests/fiscal.test.js`
- `tests/fiscal-rounding-align.test.js`
- `tests/bv-fiscal-align.test.js`
- `tests/csv-import.test.js`
- `tests/csv-parsing.test.js`
- `tests/desglose*.test.js`
- `tests/tracking-privacy.test.js`
- `tests/tracking-events.test.js`
- `tests/tracking-pageview-eager.test.js`
- `tests/tracking-html-coverage.test.js`
- `tests/security.test.js`

Falsos positivos ya conocidos y documentados:

- "El IEE de PVPC se calcula sin restar el descuento del bono social." Falso: el descuento se resta antes de calcular el IEE. Ver `ARQUITECTURA-CALCULOS.md` y `CALC-FAQS.md`.
- "La BV se aplica a tarifas que no tienen BV." Falso: el simulador comprueba `tarifa.fv.bv`; sin BV, el sobrante no se acumula. Ver `SIMULADOR-BV.md`.
- "El ranking del simulador solar deberia ordenar por coste neto (`pagado - bvFinal`)." No es un bug actual: el ranking ordena por lo efectivamente pagado en el periodo, usa `bvFinal` solo como desempate y muestra el coste neto como metrica secundaria condicionada a seguir con la comercializadora.
- "Si el consumo es 0 kWh entonces el IEE deberia ser 0 en cualquier factura." Falso: si hay termino de potencia/base imponible, puede haber IEE aunque el consumo sea 0. Ver `CALC-FAQS.md`.
- "Los CSV exponen CUPS o strings libres en la UI y por eso las paginas CSV necesitan CSP mas estricta." Falso: `CUPS` puede reconocerse como cabecera, pero sus valores no se guardan ni se renderizan; la UI muestra agregados numericos.
- "Las guias o paginas editoriales con `unsafe-inline` son un riesgo de privacidad importante." Falso como hallazgo prioritario: esas paginas no procesan facturas, CSV ni datos sensibles. La pagina que procesa la factura PDF es la home y ya tiene CSP reforzada con hashes. En guias/editorial, CSP estricta es una mejora de hardening general, no un problema relevante de proteccion de datos.
- "Los excedentes indexados aceptan meses con huecos sin controlar energia perdida." Falso desde julio 2026: `lf-surplus-prices.js` aplica doble umbral de cobertura parcial, por horas missing y por kWh de excedente sin valorar, y los tests cubren el borde exacto y la concentracion de kWh.
- "El fallback fiscal de `month.key` en BV es una bomba silenciosa." Matizado: `bucketizeByMonth` genera `YYYY-MM`; si llega un formato inesperado, `bv-sim-monthly.js` emite `console.warn` antes de conservar el fallback centralizado.
- "El limite por defecto del bono social esta duplicado." Falso desde julio 2026: `lf-inputs.js` usa `DEFAULTS.bonoSocialLimite` y `DEFAULTS.bonoSocialTipo`.
- "El extractor de factura PDF redondea los consumos a enteros." Falso: los enteros vienen de la fuente (QR CNMC `cfP1/2/3` y tabla del contador en Octopus), no de un redondeo en codigo. Prioridad QR sobre parser es decision firme. Ver seccion dedicada en `AUDITORIA-REGISTRO.md`.
- "Aplicar datos del modal de factura no rellena la calculadora / arrastra la factura anterior." No reproducible: refutado el 14/07/2026 con repro E2E real (puppeteer) tras reportarlo un agente de navegador cuyo click no impactaba el boton. Si no hay toast (ni de exito ni de error) y el status conserva el texto inicial, el handler nunca se ejecuto. Ver `AUDITORIA-REGISTRO.md`.

## Flujo De Trabajo Recomendado

- Entrada rapida en un checkout limpio: `npm install` si faltan dependencias y luego `npm test`.
- Si cambias documentacion derivada o metricas del repo, ejecuta `npm run sync:repo-docs`.
- Si cambias codigo relevante, ejecuta `npm test`.
- Si cambias JS, ejecuta tambien `npm run lint` (ESLint, config en `eslint.config.mjs`; el CI lo ejecuta antes de los tests). Los globals compartidos entre ficheros estan declarados en esa config: si defines una funcion global nueva usada desde otro fichero, anadela a la lista.
- No dejes inicializadores muertos (`let x = 0;` cuando todas las ramas asignan antes de leer): la regla `no-useless-assignment` es error. Los `catch` vacios si estan permitidos (guardrails deliberados), incluida la variable de error sin usar.
- `no-unused-vars` es error: si un parametro debe quedarse sin usar (posicional, API), prefijalo con `_` (ej. `_reason`). No escapes caracteres innecesariamente en regex (`no-useless-escape` es error).
- Antes de borrar una funcion "sin usar" en `js/pvpc.js`, comprueba la cadena del QR CNMC: `parsearRespuestaPVPC`, `stripHtml` y `parseEuro` estan vivos aunque parezcan legacy.
- Para instalar dependencias usa `npx -y npm@10 install ...` y verifica con `npx -y npm@10 ci`: el CI usa npm 10 y un lockfile reescrito por npm 11 puede romper `npm ci`.
- Si tocas fechas, fiscalidad, bono social, impuestos, PVPC, autoconsumo o guias legales, no asumas nada por memoria: contrasta con `MANTENIMIENTO-NORMATIVO.md`, `lf-config.js`, fuentes oficiales y tests.
- `tarifas.json` es un dataset vivo. No asumas que una descripcion comercial antigua sigue siendo correcta sin revisar ese archivo.
- El campo `promo` se informa, nunca se calcula. No propongas aplicarlo al total, ordenar el ranking por precio promocional ni anadir un toggle de "incluir promociones": se evaluo y se descarto el 06/08/2026. Tampoco propongas un campo de caducidad: el usuario no conoce esas fechas. Regla de reparto entre `promo` y `requisitos` y casos ya cerrados (Esluz, Gana Energia, Visalia Primer mes gratis) en `JSON-SCHEMA.md`.

## Como Describir LuzFija.es Sin Quedarte Corto

Resumen corto recomendado:

"LuzFija.es es una suite web local-first para el mercado electrico domestico en Espana: compara tarifas de mercado libre con PVPC, importa facturas PDF y curvas horarias CSV/XLSX, analiza historicos PVPC/excedentes y simula autoconsumo con bateria virtual mes a mes."
