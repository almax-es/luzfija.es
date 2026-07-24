# Guia Para Auditorias IA De LuzFija.es

Ultima actualizacion: 2026-07-24

Este documento existe para reducir falsos positivos en auditorias repetidas. No sustituye a `AGENTS.md` ni a `CAPACIDADES-WEB.md`; los complementa con criterios de clasificacion.

## Lectura Obligatoria Antes De Auditar

1. `AGENTS.md`
2. `CAPACIDADES-WEB.md`
3. `README.md`
4. `ARRANQUE-CARGA.md` si revisas rendimiento inicial, orden de scripts, `defer`/`async`, CSS, fuentes, preloads o service worker.
5. `ARQUITECTURA-CALCULOS.md` y `CALC-FAQS.md` si revisas calculos, PVPC, fiscalidad o bono social.
6. `SIMULADOR-BV.md` si revisas bateria virtual, autoconsumo, excedentes o tarifas indexadas.
7. `ANALITICA-GOATCOUNTER.md` si revisas tracking, privacidad analitica o CSP asociada.
8. `JSON-SCHEMA.md` y `PVPC-SCHEMA.md` si revisas datasets.
9. `MANTENIMIENTO-NORMATIVO.md` si revisas normativa, fechas, impuestos, PVPC, bono social, guias legales o datos vivos.

Si no has leido la documentacion especifica de un area, no marques hallazgos de esa area como bug confirmado.

## Como Clasificar Hallazgos

Usa estas categorias de forma estricta:

- **Bug**: contradice una regla documentada, falla tests existentes, produce calculo incorrecto o rompe una funcionalidad comprometida.
- **Mejora UX/rendimiento**: mejora experiencia o tiempos, pero la funcionalidad actual es correcta y esta dentro del modelo documentado.
- **Hardening**: reduce riesgo teorico de seguridad/privacidad sin evidencia de vulnerabilidad explotable en el modelo actual.
- **Roadmap**: ya esta reconocido como idea o deuda no comprometida.
- **Falso positivo documentado**: aparece en `AGENTS.md` o en este documento como decision de implementacion.

No eleves a severidad alta algo que sea hardening, roadmap o cambio de preferencia salvo que demuestres impacto real y reproducible.

## Decisiones Que No Deben Reportarse Como Bugs

### CSP Y Trusted Types

- Las paginas editoriales no procesan facturas ni archivos CSV/XLSX ni acceden a sus contenidos. Endurecer su `script-src` seria defensa en profundidad general frente a un XSS futuro hipotetico, pero no una proteccion relevante de datos personales en el modelo actual. El almacenamiento compartido contiene unicamente valores numericos de configuracion y agregados (potencias, consumos por periodo, dias, zona fiscal y opciones del comparador), no el PDF, CUPS, texto OCR, nombre del fichero ni curva horaria completa. Estos valores no se envian automaticamente a un backend ni a analitica; solo pueden salir por una accion explicita del usuario, como compartir su configuracion. Sin un vector de inyeccion reproducible, `unsafe-inline` en las paginas editoriales no debe reportarse como bug de privacidad ni como prioridad. Las superficies que procesan archivos (`index.html`, `comparador-tarifas-solares.html` y `estadisticas/index.html`) ya usan `script-src` estricto con hashes.
- `require-trusted-types-for 'script'` no esta activado por decision consciente: requiere migrar/auditar usos legitimos de `innerHTML`. Clasificalo como hardening futuro, no bug.
- Si recalculas los sha256 de la CSP veras hashes declarados que no coinciden con ningun `<script>` ejecutable: son los bloques `application/ld+json`. El script de deploy hashea todos los inline por uniformidad, incluidos los JSON-LD que no ejecutan. Es inerte y deliberado; verificado computacionalmente el 2026-07-09 que todos los scripts ejecutables SI estan cubiertos. No lo reportes como hash roto ni como script bloqueado.

### CSV/XLSX Grande

- El parsing CSV/XLSX es local y actualmente sincronico.
- `parseEnergyTableRows` conserva contrato sincronico compartido por home, simulador BV, observatorio y tests.
- No propongas insertar `await` directamente dentro de `parseEnergyTableRows` sin redisenar API async o Web Worker.
- `SIMULADOR-BV.md` ya recoge `Progreso de carga para CSV grandes` y `Web Worker para procesamiento en background` como roadmap.

### Carga Diferida Del JavaScript De La Home

- Medicion local del 23/07/2026: `index.html` carga inicialmente 28 scripts first-party, unos 651 KB sin comprimir y 176 KB con gzip. Aproximadamente 306 KB / 77 KB gzip corresponden a `lf-csv-utils.js`, importacion CSV, factura PDF, desglose y tarifa personalizada, usados solo cuando el usuario entra en esos flujos.
- Las dependencias pesadas (`PDF.js`, `Tesseract`, `jsQR` y `SheetJS`) ya se cargan bajo demanda. El margen pendiente afecta principalmente a modulos first-party relativamente pequenos.
- No presentes esa separacion como un `quick win` ni como bug de rendimiento sin una degradacion reproducible en datos de campo. La instrumentacion INP propia solo esta activa en modo debug; para reabrir esta decision usa CrUX/Search Console u otra telemetria de campo equivalente, no una estimacion basada unicamente en bytes.
- La home no usa hoy un grafo de modulos ESM: sus scripts clasicos publican y consumen APIs en `window.LF`; muchos, pero no todos, estan encapsulados en IIFEs. Varios capturan dependencias al evaluarse y `lf-app.js` espera encontrarlas disponibles al inicializar. El orden de los `<script defer>` forma parte del contrato descrito en `ARRANQUE-CARGA.md`.
- `sw.js` instala como `CORE_ASSETS` la cadena funcional completa de la home y cancela la instalacion si falta una pieza obligatoria. Esto demuestra el requisito atomico actual, pero no prueba por si solo la causa historica de una rotura anterior.
- Cualquier intento futuro exige primero mapear el grafo de dependencias y redisenar explicitamente el contrato de inicializacion. Despues debe cubrir carga fallida/reintento, doble inicializacion, modo offline, clientes con HTML/SW antiguo, watchdogs y estados degradados antes de medir el resultado. Es roadmap de riesgo alto, no una optimizacion local de unas etiquetas `<script>`.

### PVPC Con CSV Y Precios Faltantes

- Si el usuario activa PVPC con precios del periodo importado, `pvpc.js` intenta cruce exacto hora a hora.
- Si la cobertura perdida es residual, aplica un modo hibrido: conserva el precio exacto de las horas disponibles y estima solo las ausentes con la media P1/P2/P3 canonica de su periodo.
- El modo hibrido exige simultaneamente un maximo del 10% de horas sin precio y del 10% de kWh sin precio. Un mes completo ausente nunca se considera un hueco residual.
- Si se supera cualquiera de los umbrales, falta un mes completo con consumo o no existe una media valida para alguna hora, cae a medias P1/P2/P3 para todo el consumo.
- Tanto el desglose como `renderPvpcInfo()` muestran la cobertura; el modal distingue exacto, hibrido y medias completas, y aclara que sus lineas P1/P2/P3 son referencias cuando el total procede del cruce horario.
- Los resultados con precios ausentes no se persisten en la cache PVPC, para que puedan mejorar en cuanto se publique nueva cobertura durante el mismo dia.
- `resultadoPVPC[].explicacion` es un canal interno legacy, no contenido visible por si solo. `parsearRespuestaPVPC` sigue extrayendo de esas cadenas los precios P1/P2/P3; la cobertura visible se renderiza expresamente en `renderPvpcInfo()` y `desglose-render.js`.

### Excedentes Indexados `fv.exc = -1`

- Sin curva horaria trazable se usa `0,020 EUR/kWh` como referencia orientativa.
- Con CSV horario conservado se calcula contra `data/surplus/`.
- Si faltan precios horarios del indice, se aplica doble umbral de cobertura parcial:
  - horas missing,
  - kWh de excedente sin valorar.
- Si la cobertura perdida no es residual, ese mes cae a referencia orientativa con aviso.
- Los tests cubren missing por horas, missing por kWh, borde exacto del umbral y precios negativos.

### `tarifas.json` No Lleva Test De Esquema En El Repo (Deliberado)

- `tarifas.json` es el unico dataset SIN test de integridad en `tests/`, a diferencia de PVPC/surplus (`pvpc-dataset-integrity.test.js`) y SSAA (`ssaa-dataset.test.js`). NO lo reportes como carencia.
- La diferencia es legitima por origen: PVPC/surplus/SSAA los genera un script del repo en CI, sin humano en el bucle, por eso necesitan red de seguridad en el repo. `tarifas.json` NO se edita a mano ni lo genera CI: lo produce una herramienta de escritorio del autor ("Actualizador de JSON") a partir de una Excel privada.
- Ademas el autor pasa a diario, varias veces, sus propios validadores de escritorio ("Validador tarifas", "Validador excedentes") que ya le han avisado de errores reales. Esa es la red de seguridad, y es MAS efectiva que un test de repo: sus validadores corren cuando trabaja los datos (cuando puede colarse el error), mientras que un test en `tests/` solo correria en CI al commitear, tarde y redundante.
- Cualquier validacion de esquema de tarifas pertenece a esas herramientas externas, no a este repo. Decision FIRME (23/07/2026); no re-proponer `tests/tarifas-dataset.test.js`.

### Ranking Del Simulador Solar/BV

- El ranking visible ordena por `totals.pagado`.
- En empate usa mayor `totals.bvFinal`.
- `totals.real` es metrica auxiliar, no criterio principal.
- `totals.pagado - totals.bvFinal` puede mostrarse como coste neto secundario si queda saldo final relevante, pero no reordena.

### Fiscalidad Y Bono Social

- El descuento del bono social se resta antes de calcular IEE.
- El bono social solo aplica a PVPC, no a tarifas de mercado libre.
- El IEE puede existir con consumo 0 kWh si hay base de potencia u otros conceptos imponibles.
- La cuota minima legal del IEE (art. 99 Ley 38/1992) SI esta implementada: `desglosarIEE` en `lf-config.js` aplica `Math.max(porPorcentaje, porMinimo)` con flag `aplicaMinimo`. No reportes "falta la cuota minima del IEE" sin leer esa funcion.
- Los valores fiscales viven centralizados en `js/lf-config.js`; no dupliques reglas por modulo.

### IGIC Canarias Y Default De Vivienda

- IGIC electricidad: 0% para personas fisicas en su vivienda con potencia <= 10 kW, 3% otros usos, 7% contador (Ley 4/2012 art. 52).
- El checkbox "vivienda en Canarias" de la UI decide entre 0% y 3%; el calculo aplica ambos correctamente (verificado con reconstruccion independiente en `tests/desglose-properties.test.js`).
- `calcularDesglose` tiene `esViviendaCanarias = true` como default de destructuring. No es un bug ni un riesgo fiscal: el llamador real (`desglose-integration.js`) siempre pasa el valor explicito del checkbox, y el default coincide con el caso domestico tipico del producto (hogar canario = 0%). Un default a `false` mostraria facturas infladas al usuario normal si un llamador futuro omitiera el flag, que seria peor.

### `month.key` En BV

- El bucketizado mensual genera `YYYY-MM`.
- Si llega un formato inesperado, `bv-sim-monthly.js` emite `console.warn` y conserva fallback centralizado.
- No lo clasifiques como bug real salvo que demuestres una ruta que genere keys invalidas desde datos validos.

### Concurrencia Del Calculo Principal

- `__LF_CALC_INFLIGHT` se asigna sin `await` entre lectura y escritura.
- En el navegador actual los handlers JS se ejecutan en un unico hilo; no hay intercalado real entre dos clicks.
- Es deuda futura solo si se introduce concurrencia real o Workers en el calculo principal.

### Concurrencia Y Privacidad En Factura PDF/OCR

- `factura.js` serializa el procesamiento PDF y OCR mediante identificadores generacionales (`__LF_operationSeq` y `__LF_activeOperation`), no solo con el booleano `__LF_FACTURA_BUSY`.
- Cada operacion asincrona comprueba que su identificador sigue vigente despues de los puntos de espera relevantes. Cerrar el modal invalida la operacion activa antes de limpiar referencias y DOM.
- El `finally` de una operacion invalidada no puede liberar el estado de otra operacion posterior.
- `__LF_pendingOperations` mantiene `__LF_PRIVACY_MODE` activo mientras exista trabajo sensible pendiente, aunque el modal ya se haya cerrado.
- No propongas sustituir este mecanismo por un simple `if (__LF_FACTURA_BUSY) return`: ese guard aislado no cubre correctamente cerrar, reabrir e iniciar otra operacion mientras una promesa anterior sigue finalizando.
- Antes de reportar una carrera en este flujo, demuestra una ruta que eluda `__LF_beginOperation`, los checkpoints de vigencia o la invalidacion de `__LF_closeModal`, y validala contra `tests/factura-integration.test.js`.

### Extractor De Factura PDF: Consumos Enteros Del QR CNMC

- Cuando la factura incluye el QR/link del comparador de la CNMC, `factura.js` da prioridad a sus datos sobre el texto parseado del PDF dentro del flujo de proceso, campo a campo con fallback al parser.
- Los parametros `cfP1/cfP2/cfP3` de esa URL llegan como kWh enteros porque asi los imprime la comercializadora; el codigo hace `parseFloat` sin redondear nada (`__LF_parseQRData`).
- En facturas Octopus, la tabla de lecturas del contador ("Consumo kWh") tambien es entera y se usa a proposito como fuente primaria (comentado en `__LF_extractConsumoOctopus`).
- Por tanto, ver consumos enteros donde el texto de la factura muestra decimales NO es un bug de redondeo: es fidelidad a la fuente estructurada oficial. Desviacion maxima 0,5 kWh por periodo (centimos de euro).
- Decision de producto FIRME (14/07/2026): se prefiere el dato del QR porque es la misma informacion que la comercializadora declara a la CNMC. No proponer "usar el decimal del parser cuando difiera del QR"; ya se evaluo y se descarto.

### QA E2E Con Agentes De Navegador (Falsos Positivos De Interaccion)

- Verificado el 14/07/2026: un agente QA con Chrome via MCP reporto que "Aplicar datos" del modal de factura no rellenaba la calculadora y arrastraba los valores de la factura anterior (3 casos, "reproducible"). Una reproduccion independiente con puppeteer-core y la misma secuencia exacta contra produccion demostro que el flujo funciona: modal correcto, inputs actualizados, toast de exito y autocalculo.
- Causa probable del falso positivo: el click del agente no llego a impactar el boton (viewport/scroll). Sintomas que lo delatan: no hay toast de exito NI de error, y la barra de estado conserva el texto inicial ("Rellena tus datos y calcula"); es decir, el handler nunca se ejecuto, porque `__LF_applyValues` siempre deja rastro (exito: toast + cierre de modal; validacion fallida: toast de error + campos marcados `.err`).
- Antes de reportar "el boton X no hace nada" desde un agente de navegador: comprueba toasts, clases `.err`, consola JS y que el elemento estaba visible en viewport al clicar; y reproduce con un segundo mecanismo de click antes de confirmarlo.
- Los valores extraidos que muestra el modal se leen de los inputs `#val_p1`, `#val_p2`, `#val_dias`, `#val_consumoPunta/Llano/Valle`; el CUPS no se muestra en la UI por privacidad (no es un campo ausente).

### Cargas Parciales, Watchdog Y Telemetria De QA

- `error-bootstrap.js` se carga antes de `config.js` en home, solar y observatorio. Ademas de encolar errores first-party tempranos, actua como watchdog cuando falta por completo un coordinador que no podria ejecutar su propio guard.
- El toast del watchdog no se cierra automaticamente por decision firme. En home, solar y observatorio hay tambien un estado persistente en la pagina; si faltan factura o `desglose-integration.js`, el toast es el unico aviso post-click. Clasificalo como decision UX, no como bug, salvo que demuestres que bloquea una accion recuperable concreta.
- `init-incompleto/*` significa que una defensa ha detectado dependencias ausentes y ha degradado la UI de forma controlada. Desde el 22/07/2026 lleva el build como ultimo segmento (lo sella `trackDetailedEvent`, no los emisores), asi que se atribuye solo y ya no depende de correlacionar por hora. Sigue siendo util cruzarlo con `error-script-load/*` para saber QUE fichero falto; por si solo no prueba que haya escapado una excepcion.
- Las validaciones E2E del 22/07/2026 generaron trafico sintetico en ambas familias. Ventanas CONFIRMADAS: `09:00Z` (build `20260722-091724`) y `11:00Z` (build `20260722-103502`). El primer export mostraba 73 hits y cero eventos de error en `12:00Z`; el siguiente (`2026-07-22T14:53:53Z`) completo la agregacion hasta 83 hits y siguio con cero `error-*` y cero `init-incompleto/*`. La auditoria anunciada en esa hora no dejo senales de diagnostico y `12:00Z` no debe excluirse como ventana sintetica de esas familias. Moraleja practica: verifica en que cubos aparecen realmente los eventos; no heredes una ventana declarada ni des por contaminado todo el build.
- Una fuente de error `blob:` same-origin podria crear cardinalidad por UUID. Hoy no es alcanzable en tracking porque los unicos workers `blob:` son PDF.js/Tesseract dentro del modo privacidad de factura. Si aparece un worker `blob:` fuera de ese flujo, exigir allowlist de protocolos HTTP(S) en `sameOriginSource()` y tests; hasta entonces es hardening futuro.
- Verificado el 22/07/2026 contra produccion con Chrome real: caminos felices de home/solar/observatorio, diez bloqueos individuales de scripts y offline cortando tambien la red del target del Service Worker. `tracking.js` se recupero desde Cache Storage; no hubo excepciones JS ni violaciones CSP.

### Formato Numerico: Coma En UI, Punto En Mocks De Tests

- Toda cifra visible usa coma decimal (helpers `formatMoney`, `fmtNum`, `numComa`, `toComma`, `fmtPrecio` segun modulo). Un punto decimal visible para el usuario seria un bug real (se corrigio el ultimo caso en `lf-render.js` el 14/07/2026).
- OJO con los tests: `tests/render-ui.test.js` mockea `formatMoney` como `n + ' EUR'` sin conversion a coma; los importes con punto en los asserts de tests son artefacto del mock, no reflejo de la UI real. No reportes "la UI muestra punto decimal" citando un assert de tests como evidencia.

### SEO, Datos Estructurados Y Core Web Vitals

- La ausencia de `<meta name="robots" content="index,follow">` no es una carencia: `index,follow` es el comportamiento por defecto. Solo reporta `robots` si una directiva concreta bloquea o limita una URL indebidamente.
- No propongas `meta keywords`: Google no las usa para ranking. Tampoco propongas `hreflang` por completitud cuando solo existe una variante equivalente en espanol; se usa para URLs equivalentes por idioma o region.
- `FAQPage` puede conservarse como marcado semantico, pero no se debe prometer ni medir como fuente de rich snippets para LuzFija. El marcado `Organization` ayuda a desambiguar la entidad y su logo, no garantiza un knowledge panel.
- En el sitemap, lo relevante es que `lastmod` sea veraz y se mantenga sincronizado. `changefreq` y `priority` no deben presentarse como senales de ranking.
- Las guias ya tienen fecha de actualizacion visible y sincronizada con `dateModified`; la home muestra la fecha del dataset de tarifas tras cargarlo. No reportes una ausencia general de fecha visible sin revisar ambas superficies.
- CSP y la estrategia `network-first` del service worker son buenas practicas de seguridad y actualizacion para usuarios, respectivamente, pero no prueban una mejora directa de ranking ni garantizan por si solas que Googlebot vea una version concreta.
- **Las Metricas Web Principales de campo se superan en la captura revisada.** CrUX del 24/07/2026, ventana del 25/06 al 22/07 y percentil 75: LCP 1,3 s movil y 1,2 s escritorio, INP 163/95 ms y CLS 0,01 en ambos. Son agregados de campo, no una garantia para cada visita ni evidencia causal sobre un recurso. `ARRANQUE-CARGA.md` seccion 8 conserva el informe y el contexto.
- No confundas laboratorio con campo. El informe PageSpeed `6b20tubb7z` contiene dos ejecuciones Lighthouse independientes: movil puntua 89 y escritorio 100; el ahorro estimado de `Solicitudes que bloquean el renderizado` es 630 ms y 150 ms, respectivamente. La diferencia muestra sensibilidad al perfil y a la ejecucion; no prueba por si sola ni un defecto de orden ni que el escenario movil sea irreal. La cifra historica de 50 ms del 11/07/2026 pertenece a otra ejecucion y no debe compararse sin conservar informe, version, despliegue y perfil.
- Un arbol de dependencias describe relaciones y tiempos de una ejecucion, no independencia causal entre ramas. Que los scripts del `<head>` terminen antes que otra rama no demuestra que diferirlos sea incapaz de cambiar el resultado: comparten recursos de red y CPU. No se difieren porque su ejecucion temprana sostiene invariantes documentadas en `ARRANQUE-CARGA.md` seccion 4 y no existe una alternativa segura con mejora reproducible, no porque Lighthouse demuestre una imposibilidad tecnica.
- Antes de recomendar CSS critico inline, `media=print`, `preload` duplicado de una hoja o carga diferida de CSS de un modal, ejecuta Lighthouse/PageSpeed y revisa la cascada real. Un recurso render-blocking por si solo no es un hallazgo de alta prioridad.
- Los preloads de fuentes deben corresponder a pesos usados por el elemento LCP medido. Tras desplegar un preload, compara varias pasadas en frio contra una baseline equivalente y revisa la cadena de dependencias: eliminar el descubrimiento via `fonts.css` confirma el mecanismo, pero no demuestra por si solo una mejora estadisticamente atribuible de LCP.
- No propongas preloadar los pesos 600 y 700 de Outfit solo porque aparezcan encadenados tras `fonts.css`: no son los pesos del elemento LCP medido y no hay beneficio demostrado; nuevas precargas pueden competir por ancho de banda. `font-display: swap` permite mostrar una fuente alternativa, pero no garantiza ausencia de cambios de layout o de efecto sobre LCP. El CLS de campo de 0,01 demuestra buena estabilidad agregada en el percentil 75, no la ausencia de saltos atribuibles a una fuente concreta.
- `unused-css-rules` de Lighthouse describe la cobertura de una pagina y estado concretos; no prueba que el CSS sea globalmente muerto. No ejecutes PurgeCSS ni borres reglas compartidas sin cubrir tema, responsive, modales y clases dinamicas.
- Si GitHub Pages entrega estaticos con cache corta, una mejora de `Cache-Control` puede requerir CDN/infraestructura. Clasificala como decision operativa, no como cambio minimo de codigo ni como prioridad sin valorar visitas repetidas, DNS y riesgo de despliegue.

## Hallazgos Que Si Serian Relevantes

Reporta como bug o riesgo real si puedes demostrar alguno de estos puntos:

- Descuento de bono social aplicado despues de IEE.
- PVPC calculado para potencia contratada superior a 10 kW.
- BV aplicada a tarifa sin `tarifa.fv.bv`.
- Ranking BV reordenado por coste neto en vez de `totals.pagado`.
- Datos de CUPS, nombres de fichero, kWh personales o importes enviados a analitica.
- Valores libres de CSV/PDF/tarifas renderizados sin escape/sanitizacion.
- Dataset PVPC/surplus con integridad rota para dias historicos completos.
- `tarifas.json` cacheado por service worker en vez de tratarse como dato vivo.
- Cambios de fiscalidad, bono social, peajes, cargos o normativa sin fuente oficial ni tests.

## Tests De Referencia

Antes de confirmar un hallazgo, revisa o ejecuta los tests relevantes:

- `tests/fiscal.test.js`
- `tests/pvpc.test.js`
- `tests/bv.test.js`
- `tests/bv-ui.test.js`
- `tests/bv-fiscal-align.test.js`
- `tests/surplus-prices.test.js`
- `tests/csv-import.test.js`
- `tests/csv-parsing.test.js`
- `tests/tracking-privacy.test.js`
- `tests/tracking-events.test.js`
- `tests/tracking-html-coverage.test.js`
- `tests/security.test.js`
- `tests/pvpc-dataset-integrity.test.js`
- `tests/desglose-properties.test.js` (invariantes matematicos con entradas adversarias: finitud, monotonia, tope de compensacion, reconstruccion fiscal independiente por zona)

## Prompt Recomendado Para Auditorias Externas

```text
Audita LuzFija.es despues de leer AGENTS.md, AUDITORIA-IA.md y CAPACIDADES-WEB.md.

No reportes como bug algo documentado como decision de implementacion o falso positivo conocido.
Si discrepas con una decision documentada pero el codigo la cumple, clasificalo como mejora, hardening o cambio de producto. Si el codigo contradice la decision documentada, puede ser un bug.
Antes de hallazgos de fiscalidad/PVPC lee ARQUITECTURA-CALCULOS.md y CALC-FAQS.md.
Antes de hallazgos BV/indexados lee SIMULADOR-BV.md.
Antes de hallazgos CSP/privacidad distingue superficie sensible vs editorial.
Antes de hallazgos SEO/CWV, revisa la seccion `SEO, Datos Estructurados Y Core Web Vitals` de este documento y valida rendimiento contra una medicion reproducible; distingue datos de laboratorio, datos de campo y cobertura de una pagina concreta.
Valida cada hallazgo contra codigo y tests. Si no hay test, propon el test que faltaria.

Devuelve findings con esta taxonomia:
- Bug confirmado
- Riesgo real reproducible
- Mejora UX/rendimiento
- Hardening
- Roadmap ya documentado
- Falso positivo documentado
```
