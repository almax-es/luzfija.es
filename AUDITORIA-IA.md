# Guia Para Auditorias IA De LuzFija.es

Ultima actualizacion: 2026-08-20

Este documento existe para reducir falsos positivos en auditorias repetidas. No sustituye a
`AGENTS.md` ni a `CAPACIDADES-WEB.md`; los complementa con criterios de clasificacion.

Esta organizado por AREAS, no por fechas. No es un registro de sesiones: cada entrada describe una
decision vigente, un falso positivo conocido o un bug ya corregido, junto con la evidencia que haria
falta para reabrirlo. Si vas a auditar, lee primero `Metodo De Verificacion Exigido` y
`Areas Ya Auditadas Y Su Estado` para saber que terreno esta ya cubierto y con que criterio.

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

## Metodo De Verificacion Exigido

Estas reglas nacen de errores reales cometidos al integrar auditorias anteriores. Aplicarlas evita
repetirlos.

1. **Reproduce contra el codigo desplegado ANTES de proponer nada.** No basta con leer el codigo y
 razonar el fallo: hay que ejecutarlo. Varias veces un razonamiento correcto sobre el codigo
 describia un fallo que un guard posterior ya neutralizaba.
2. **Un baseline "el despliegue anterior" no vale por si solo.** Si ese despliegue ya contiene la
 regresion, ambos lados fallan igual y la comparacion diferencial no ve nada. Para cambios de
 parser hay que contrastar ademas contra las facturas reales del banco de pruebas y contra los
 informes de QA historicos, que si registran los valores correctos.
3. **Gate obligatorio de facturas reales.** Cualquier cambio que toque `js/factura-parsers.js` o
 `js/factura.js` debe pasar las 11 facturas reales por la interfaz real comparando candidato
 contra produccion. Se espera 11/11 identicas salvo el caso que se pretende arreglar.
4. **Valida las regresiones nuevas por mutacion.** Un test que pasa no demuestra que detecte nada:
 hay que romper el arreglo a proposito y comprobar que el test falla. Si no falla, el test no
 cubre lo que dice cubrir (o el codigo es defensivo e inalcanzable, lo cual conviene documentar en
 el propio test para que nadie lo "arregle" creyendo que falta cobertura).
5. **Si dos documentos se contradicen, decide por cronologia, no por precedencia.** La regla de que
 `CAPACIDADES-WEB.md` es la fuente de verdad funcional dice donde mirar primero, no cual de dos
 frases esta vigente. Localiza el commit de cada afirmacion con `git log -S "<frase>" -- <fichero>`:
 la edicion mas reciente que QUITA una afirmacion y pone la contraria es la decision deliberada; la
 otra es el resto sin actualizar. Si la doc caducada es la que manda por precedencia, lo que se
 corrige es **la doc**, no el codigo.
6. **Ante la duda, falso negativo antes que falso positivo.** No detectar algo devuelve el
 comportamiento anterior; detectar de mas inutiliza una funcion que hoy funciona para usuarios
 validos. Un guard demasiado ancho ha roto ya la extraccion de facturas legitimas mas de una vez.
7. **La severidad se mide por el peor resultado OBSERVABLE.** No basta con demostrar que se viola un
 contrato interno: hay que llevar el caso hasta el final atravesando guards, validadores
 fail-closed, `try/catch`, redondeos y caches. Un fallo que termina en "no se muestra el dato" no
 equivale a uno que muestra un importe falso.
8. **Comprueba la reproducibilidad de lo que propones.** Un cambio que hace depender el resultado de
 datos que cambian con el tiempo rompe los escenarios guardados y los enlaces compartidos: el mismo
 escenario daria importes distintos segun el dia en que se abra. Eso es peor que el error que
 pretenda corregir.
9. **Higiene de entrega.** Respeta el fin de linea original de cada fichero y ejecuta `npm run lint`.
 El error recurrente en regex nuevos es `no-useless-escape` por escapar `/`, `.` o `-` dentro de
 una clase de caracteres (`[\/.\-]` debe ser `[/.-]`).
10. **Declara con precision lo que no has podido ejecutar.** No presentes como test pasado algo que
 no corrio, y no atribuyas a los cambios un fallo de instalacion del entorno.

## Areas Ya Auditadas Y Su Estado

Resumen de cobertura para no repetir trabajo ni volver a levantar lo ya cerrado. El detalle de cada
decision esta en la seccion siguiente.

| Area | Estado | Donde mirar antes de reportar |
|---|---|---|
| Extractor de factura PDF (texto) | Auditada a fondo y endurecida. Separacion dimensional kW/kWh/EUR/dias, lecturas de contador, maximas demandadas y asociaciones cruzadas al compactar lineas | `Extractor De Factura PDF: ...` (varias entradas) |
| QR CNMC | Auditado. Confianza, validacion de host/ruta/unidades, claves case-insensitive, fechas imposibles y PDF multi-factura | `QR CNMC: Confianza, Validacion Y PDF Multi-Factura` |
| Dominio 2.0TD y peajes | Auditado. Bloqueo fail-closed de 3.0TD/6.xTD con deteccion de auto-declaracion | `Peajes Fuera De 2.0TD` |
| Importador CSV/XLSX | Auditado. Alias de cabecera, generacion frente a exportacion, duplicados, cambios de hora | `CSV: Generacion Frente A Exportacion`, `Duplicados En CSV/XLSX...` |
| Observatorio PVPC (`/estadisticas/`) | Auditado. Ausencia de datos frente a cero, cobertura parcial, carrera de render | `Observatorio: Ausencia De Datos Frente A Cero` |
| Simulador solar / bateria virtual | Auditado. Motor economico cerrado (rotacion, ranking, topes y saldo) y UI auditada en estado, validaciones, ciclos de vida, importaciones y renderizado | `Simulador Solar: Rotacion Del Patron Anual Y Ranking`, `UI Del Simulador Solar: Estado, Ciclos De Vida Y Renderizado` |
| Motor economico y fiscalidad | Auditado a fondo. Orden de operaciones, bono social, fiscalidad por zona, paridad entre home/BV/desglose y fronteras de redondeo IEEE-754 | `Fiscalidad Y Bono Social`, `Redondeo Exacto De Impuestos Indirectos...`, `ARQUITECTURA-CALCULOS.md` |
| Arranque, carga parcial y service worker | Auditado. Watchdog, telemetria, recarga automatica | `Cargas Parciales, Watchdog Y Telemetria De QA` |
| Privacidad y analitica | Auditado. Taxonomia de eventos y datos que nunca se envian | `ANALITICA-GOATCOUNTER.md` |
| SEO, datos estructurados y CWV | Auditado | `SEO, Datos Estructurados Y Core Web Vitals` |

## Decisiones Que No Deben Reportarse Como Bugs

Lo que sigue son decisiones deliberadas, falsos positivos conocidos o bugs YA CORREGIDOS (marcados
RESUELTA en su titulo, con la correccion aplicada y sus tests). No re-reportes ninguna entrada sin
evidencia nueva: para las decisiones/falsos positivos, evidencia de que el codigo ya no cumple lo
descrito; para las RESUELTAS, evidencia de que el mecanismo original volvio (regresion) o de un caso
nuevo no cubierto por sus tests. Cada entrada explica que evidencia haria falta para reabrirla.

### CSP Y Trusted Types

- Las paginas editoriales no procesan facturas ni archivos CSV/XLSX ni acceden a sus contenidos. Endurecer su `script-src` seria defensa en profundidad general frente a un XSS futuro hipotetico, pero no una proteccion relevante de datos personales en el modelo actual. El almacenamiento compartido contiene unicamente valores numericos de configuracion y agregados (potencias, consumos por periodo, dias, zona fiscal y opciones del comparador), no el PDF, CUPS, texto OCR, nombre del fichero ni curva horaria completa. Estos valores no se envian automaticamente a un backend ni a analitica; solo pueden salir por una accion explicita del usuario, como compartir su configuracion. Sin un vector de inyeccion reproducible, `unsafe-inline` en las paginas editoriales no debe reportarse como bug de privacidad ni como prioridad. Las superficies que procesan archivos (`index.html`, `comparador-tarifas-solares.html` y `estadisticas/index.html`) ya usan `script-src` estricto con hashes.
- `frame-ancestors` no puede aplicarse desde una CSP declarada mediante `<meta http-equiv="Content-Security-Policy">`: los navegadores deben ignorar esa directiva en politicas entregadas por `meta`. Solo seria efectivo como cabecera HTTP servida por el hosting o por un proxy. LuzFija se publica directamente en GitHub Pages y no incorpora esa capa; no propongas anadir `frame-ancestors` a los `<meta>` porque crearia una falsa sensacion de proteccion sin cambiar el comportamiento del navegador. La ausencia de una cabecera antiframing puede clasificarse como hardening de clickjacking de severidad baja, no como bug funcional ni como proteccion directa de los datos locales del usuario.
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

### Cambios De Hora En La Numeracion Horaria (Marzo Y Octubre)

- `buildCnmcHourEntries` (`js/pvpc.js`) y `buildCnmcHourIndexMap` (`js/lf-surplus-prices.js`) generan claves con un HUECO el dia corto de marzo: Peninsula `1,2,4..24` y Canarias `1,3,4..24`. **Eso es correcto**, no un bug: la clave canonica es `hora local + 1` y la hora que desaparece no existe. Quien vea el hueco y lo reporte como dato corrupto se equivoca. La normalizacion del formato CCH-CONS comprimido (`1..23` consecutivos, segun la especificacion consolidada del BOE) vive en el parser compartido `js/lf-csv-utils.js`, no en los motores.
- La hora que desaparece en marzo y se repite en octubre NO es la misma en todas las zonas: 02:00 en Peninsula y **01:00 en Canarias**. Ceuta/Melilla comparte reloj con Peninsula aunque su horario de periodos este desplazado +1h. Son dos ejes ortogonales y estan separados a proposito en la referencia del CSV: perfil de periodos (`general` / `ceuta-melilla`) y reloj DST (`europa-madrid` / `canarias`). No los colapses en un solo campo.
- El reparto P1/P2/P3 no se ve afectado por los cambios de hora: ambos caen siempre en domingo y `getPeriodoHorarioCSV` devuelve `P3` para todo el dia antes de llegar a la clasificacion horaria.
- **La columna `Periodo` de un CSV importado NUNCA se usa en Ceuta/Melilla, ni para inferir la base horaria (0-23 vs 1-24) ni para el periodo final** (corregido 14/08/2026, auditoria externa cruzada). Antes de esta fecha, `detectHourBase()`/`inferHourBaseFromPeriods()` podian casar por coincidencia la columna `Periodo` de un fichero calculado con limites de OTRA zona contra la interpretacion horaria equivocada, desplazando todas las horas una posicion; y `parseEnergyTableRows()` respetaba esa columna igual para todas las zonas, mientras `bv-sim-monthly.js` ya la ignoraba y recalculaba siempre en Ceuta/Melilla — dos motores podian clasificar el mismo CSV en periodos distintos. Ahora ambos puntos usan `getCsvZoneProfiles(zonaFiscal).perfilPeriodos === 'ceuta-melilla'` para forzar el recalculo por fecha/hora, igual en los dos motores. Datadis mensual queda fuera de este cambio (via `parseDatadisMonthlyRows`, camino de codigo distinto, periodo sintetico fijo P1/P2/P3 sin depender de zona).

### Escenario Compartido Del Simulador Solar (`?bv=`)

- Un escenario abierto por enlace es una previsualizacion y el autoguardado esta bloqueado a proposito, para las tres claves de la escritura pseudo-atomica (`bv_manual_data_v2`, `bv_custom_tarifa` y `bv_manual_data_timestamp`): `persistManualScenario()` es la unica funcion que las escribe juntas, y el guard de preview corta ANTES de invocarla, asi que ninguna de las tres se toca, timestamp incluido. No lo reportes como "el simulador no guarda los cambios": lo dice el propio indicador ("Vista previa sin guardar") y solo el boton explicito o importar un respaldo adoptan el escenario. Detalle en `SIMULADOR-BV.md`.
- Exportar desde una previsualizacion descarga el estado visible sin tocar `localStorage` ni adoptar el escenario. Es deliberado: el respaldo debe reflejar lo que el usuario ve.
- "Borrar todos los datos" elimina `bv_manual_data_v2`, `bv_manual_data` y `bv_manual_data_timestamp`, pero **no** `bv_custom_tarifa`: "Mi tarifa" tiene su propio boton de borrado. La desincronizacion transitoria del `savedAt` se auto-repara en la siguiente escritura, porque `getScenarioConfig()` relee la tarifa del DOM. Clasificalo como decision de producto, no como bug de coherencia.

### Guard De Datos Frente A CI De Despliegue

- Son dos comprobaciones distintas a proposito. `tests/pvpc-dataset-integrity.test.js` corre en cada push y es **independiente del reloj**: usa el ultimo dia publicado del propio dataset como referencia y solo permite que ese dia este parcial. `scripts/check_data_freshness.py` corre en `pvpc.yml` despues de la descarga y **si** usa la fecha real, porque ahi es donde importa. No unifiques ambos: acoplar el CI de despliegue al reloj haria que una noche fallida de ESIOS bloqueara cualquier push.
- Desde 14/08/2026, `pvpc.yml` TAMBIEN ejecuta `pvpc-dataset-integrity.test.js` y `ssaa-dataset.test.js`
 directamente (solo si `data/` cambio), justo antes del commit/push, ademas del guard de frescura.
 Esto no rompe la distincion de arriba: sigue siendo el mismo test independiente del reloj, solo
 que ahora corre tambien fail-before-push en vez de esperar a que `tests.yml` lo repita despues del
 push. `tests.yml` sigue corriendo la suite completa tras el push como segunda comprobacion; no es
 redundancia eliminable, es la diferencia entre "¿estos datos son publicables?" (antes) y "¿el
 repositorio completo sigue siendo correcto?" (despues). Deliberadamente NO se ejecuta `npm test`
 completo en `pvpc.yml`: su `pretest` dispara `sync:seo-docs`, que puede tocar el working tree justo
 antes de un commit de datos.
- Que un dia `>= hoy` (en la zona horaria del propio dataset) llegue con menos puntos horarios de los esperados es normal y transitorio, no solo en Canarias: REE/ESIOS publican progresivamente, y el dia siguiente ya puede aparecer en el fichero mensual sobre las 20:15 aunque aun no este completo. `scripts/check_data_freshness.py` tolera explicitamente "hoy parcial" y "futuro ya publicado parcial" (checks 9 y 10), con la misma condicion `date >= hoy` que usa el validador de dia civil compartido en runtime (ver seccion "Validador De Dia Civil Compartido" mas abajo). Los dias historicos y los meses cerrados si tienen que estar completos.

### Duplicados En CSV/XLSX Rechazados (RESUELTA)

- Los tres parsers de `js/lf-csv-utils.js` que agregan consumo (`parseEnergyTableRows`,
 `parseHourlyMatrixRows`, `parseDatadisMonthlyRows`) rechazan hoy cualquier fecha (+hora, cuando
 aplica) repetida entre filas, con `throw` fail-closed (aborta toda la importacion, no deduplica
 ni suma en silencio). Antes de esta fecha, un CSV/XLSX con filas duplicadas (export repetido,
 merge accidental) inflaba el consumo sin ningun aviso — bug real detectado por auditoria
 cruzada externa, verificado y reproducido contra el codigo antes de corregirlo.
- La clave de duplicado se registra SOLO cuando la fila ya genero al menos un registro
 importable (despues de superar validaciones de rango/formato), nunca antes: una fila
 descartada por otro motivo (texto invalido, fuera de rango) NO cuenta como "vista" y no
 bloquea una fila valida posterior con la misma fecha/hora. Si reportas esto como bug, verifica
 primero contra `tests/csv-parsing.test.js`, describe "Deteccion de periodos duplicados".
- La clave de duplicado en `parseEnergyTableRows` usa la hora YA RESUELTA (post-`resolveHour`),
 no la hora cruda del fichero: las dos ocurrencias legitimas de la hora repetida del cambio de
 octubre se resuelven a horas DISTINTAS (ej. 3 y 25) antes de la comprobacion, asi que nunca
 colisionan con este chequeo. No lo reportes como conflicto con el cambio de hora.

### Contrato De "Cambios Pendientes" Roto Por Auto-Refresh, Race De Edicion Y Modal PVPC (RESUELTA)

Novena ronda, planteada como auditoria de riesgo (no exhaustiva): solo bugs con impacto
material reproducible, centrada en compatibilidad de estados, refrescos en caliente,
navegacion/preview y caminos donde la UI pudiera mostrar un resultado calculado con un
estado distinto del que el usuario cree. Los tres hallazgos comparten la misma causa raiz:
nada comparaba el estado "que se acaba de pintar" contra el estado "que el usuario ve ahora"
antes de dar el resultado por bueno.

- **El auto-refresh de tarifas ignoraba `state.pending`.** `refreshTarifasAndMaybeRecalc()`
 (`lf-app.js`) llama a `runCalculation(true)` en segundo plano cuando `tarifas.json` cambia
 de `updatedAt`, sin comprobar si el usuario tenia cambios sin confirmar ("Cambios
 pendientes. Pulsa Calcular"). Un refresco en background podia aplicar en silencio una
 edicion que el usuario todavia no habia pedido calcular. Corregido: con `state.pending`
 activo, el auto-refresh ya no recalcula solo — solo avisa por toast que las tarifas se
 han actualizado y que hace falta pulsar Calcular (las tarifas ya quedan cacheadas, asi que
 el proximo Calcular las usa igualmente).
- **Race real editando durante un calculo en curso (el mas serio de los tres).**
 `calculate()` capturaba `values` UNA sola vez al principio y hacia varios `await` (red,
 PVPC, render por chunks) antes de terminar. Si el usuario editaba el formulario durante
 ese hueco, `renderAll()` pintaba el resultado con los valores VIEJOS y ademas hacia
 `setStatus('Resultados actualizados', 'ok')`, mientras `calculate()` limpiaba
 `state.pending` sin comparar con el estado actual — borrando en silencio el aviso de
 pendiente que el propio edit ya habia activado. El usuario veia "Resultados actualizados"
 con un ranking que no correspondia a lo que sus inputs mostraban en ese momento. Corregido
 comparando la firma de los inputs en vivo contra la firma capturada al empezar: si difieren
 (hubo edicion durante el calculo), no se limpia `pending` — se vuelve a marcar, prevaleciendo
 sobre el "Resultados actualizados" que acaba de pintar el render.
- **Simulador solar: una simulacion podia mezclar potencia, tabla mensual y "Mi tarifa" de
 tres instantes distintos.** El click de Calcular captura `p1Val`/`p2Val` al principio, la
 tabla manual tras un `setTimeout(100)`, y (antes de este fix) "Mi tarifa" DESPUES de
 `await window.BVSim.loadTarifasBV()` — un fetch de red sin duracion acotada, durante el
 cual el formulario sigue completamente editable (solo el boton se deshabilita). Si el
 usuario editaba potencia/tabla/Mi tarifa mientras esa espera seguia en curso, el calculo
 final combinaba datos de instantes distintos sin ningun aviso — el peor caso: potencia y
 meses de ANTES del edit junto con una "Mi tarifa" leida DESPUES, ya con los cambios
 nuevos. Corregido en dos frentes: (1) "Mi tarifa" se captura ahora en el mismo instante
 sincronico que potencia/tabla, ANTES del primer await sin duracion acotada, eliminando la
 posibilidad de mezcla; (2) por si el usuario edita algo durante el resto de la espera
 (SSAA, traza horaria indexada), se compara al final una firma del snapshot inicial contra
 el estado en vivo del formulario, y si difieren se avisa explicitamente ("has cambiado
 datos mientras se calculaba... pulsa Calcular de nuevo") en vez de presentar el resultado
 como vigente en silencio.
- **Modal PVPC/Excedentes: cambiar el selector rapido mezclaba datos de un tipo abandonado.**
 `cargarHoy()`/`cargarManana()` (`index-extra.js`) son async y podian solaparse si el
 usuario cambiaba PVPC⇄Excedentes antes de que la carga anterior resolviera: sin ningun
 token, una respuesta VIEJA (del tipo ya abandonado) podia resolver despues de la nueva y
 sobrescribir `pvpcHoy`/`pvpcManana`, dejando precios de un tipo bajo la cabecera del otro.
 El guard `myOpenSeq !== modalOpenSeq` que ya protegia abrir/cerrar el modal NO cubria este
 caso (cambiar de tipo sin cerrar el modal). Corregido con un token de tipo
 (`__pvpcTypeToken`, incrementado en `resetModalData()`) que descarta cualquier respuesta
 resuelta despues de que el tipo haya cambiado.
- Los cuatro se verificaron primero contra el codigo real (lectura linea a linea, sin aceptar
 la hipotesis externa a ciegas), luego con test que se confirmo que fallaba revirtiendo
 el fix antes de darlo por bueno (no solo que "pasara en verde"): `tests/pvpc-modal-type-race.test.js`,
 `tests/lf-app-pending-race.test.js`, y el describe "Calcular no mezcla potencia/tabla/Mi
 tarifa..." en `tests/bv-ui-zona-grid.test.js`. El auto-refresh (home) se verifico solo en
 Chrome real contra codigo sin desplegar, por la complejidad de arrancar el init completo de
 `lf-app.js` de forma aislada — igual de valido, mismo criterio "revertir y ver fallar"
 aplicado a mano en el navegador. El del simulador solar tambien se repitio en Chrome real
 (con `loadTarifasBV()` retrasado en el propio codigo de la pagina, ya que el service
 worker sirve `tarifas.json` desde CacheStorage y hace inutil retrasar la respuesta de red
 por CDP).
- **Segunda pasada externa sobre estos mismos cuatro fixes (mismo dia): 3 de 4 NO-GO,
 todos con razon.** Auditoria "como si nada hubiera pasado ningun filtro previo", pedida
 explicitamente por el usuario tras detectar que el primer cierre se habia implementado sin
 esperar el analisis externo completo.
 - **A (auto-refresh):** el guard `if (state.pending)` solo se comprobaba UNA vez, antes de
 programar `tryRecalc()` en idle; si el usuario editaba DESPUES de esa comprobacion pero
 ANTES de que el idle disparara (o durante los reintentos por `__LF_CALC_INFLIGHT`), la
 edicion se aplicaba igual. Corregido revalidando `state.pending` al INICIO de
 `tryRecalc()`, en cada intento.
 - **B (`calculate()`):** `signatureFromValues()` solo cubre los inputs "normales"
 (p1/p2/dias/consumos/zona/...), nunca cubrio "Mi tarifa" ni la identidad de la curva CSV.
 Editar SOLO "Mi tarifa" durante el calculo no cambiaba la firma, asi que `pending` se
 limpiaba en silencio con un resultado que ya no correspondia a "Mi tarifa" visible.
 Corregido sustituyendo la firma por un contador de generacion (`state.generation`,
 incrementado en `markPending()`): como TODOS los caminos que invalidan el calculo (inputs
 normales, "Mi tarifa" via `scheduleCalculateDebounced()` en `lf-tarifa-custom.js`, los
 inputs que acompañan a una nueva curva CSV) ya convergen en `markPending()`, el contador
 los cubre todos sin tener que enumerarlos.
 - **C (modal PVPC):** aprobado sin cambios de logica — el contador de tipo cubre por si
 solo cualquier invalidacion, sin necesitar guardar el `type` aparte. Residual
 independiente encontrado y corregido: `resetModalData()` no ocultaba el boton "Mañana"
 (`tabManana.style.display='none'`), asi que cambiar a un tipo/zona sin datos de "mañana"
 todavia podia dejarlo visible de la carga anterior.
 - **D (simulador solar):** el "snapshot" original seguia sin ser un snapshot real —
 `manualEntries`/`customTarifa` se capturaban tras un `setTimeout(100)` (potencia y zona
 seguian capturandose antes), y la comparacion de "desactualizado" solo se hacia DESPUES
 de haber pintado ya el ranking en pantalla, sin cubrir zona/vivienda/mesInicio, y con una
 rama de salida temprana ("no quedan tarifas compatibles") que la esquivaba por completo.
 Corregido de raiz: TODO el estado sincronico relevante (potencia, tabla, "Mi tarifa",
 zona, vivienda) se captura ahora en un unico bloque antes del primer `await`, incluido el
 propio `setTimeout(100)`; los `throw` de validacion (sin meses, hueco mensual) se dejaron
 deliberadamente DESPUES de ese `setTimeout` para no cambiar el comportamiento observable
 ya cubierto por un test existente. La comprobacion de "desactualizado" se convirtio en un
 guard (`isCalcResultStale()`) que se ejecuta ANTES de cada punto donde el codigo pinta
 algo en pantalla (el render de exito Y el render de "no quedan tarifas compatibles"), y
 si el formulario cambio, NO se publica ese resultado: se pinta un aviso persistente
 pidiendo recalcular, en vez de solo un toast tras haber pintado ya el resultado viejo.
 `mesInicioVal` se capturo temprano para USARSE en el calculo (cerrando la mezcla de
 instantes) pero se excluyo deliberadamente de la comparacion de "desactualizado": el
 propio `updateMesInicioSelector()` puede reasignarlo como parte normal del calculo, sin
 que el usuario lo haya tocado, y compararlo habria dado falsos positivos.
 - Tests nuevos: 1 test adicional en `tests/lf-app-pending-race.test.js` (editar "Mi tarifa"
 sin tocar los inputs normales, reproduciendo exactamente el agujero de B), y 4 tests
 adicionales en el describe de `tests/bv-ui-zona-grid.test.js` (cambio de zona durante la
 espera, edicion en el mismo tick antes del `setTimeout(100)`, y la rama "no quedan
 tarifas" respetando el aviso). Todos confirmados fallando al revertir su fix
 correspondiente antes de darlos por buenos. El residual de C (tab "Mañana") no tiene
 test dedicado (cambio visual menor, cubierto solo por lectura de codigo).
 - El guard de A no se pudo verificar con un E2E fiable: el monkey-patch de
 `window.LF.fetchTarifas` no intercepta la llamada real porque `lf-app.js` la
 desestructura de `window.LF` una sola vez, al cargar la pagina (`const { ...,
 fetchTarifas, ... } = window.LF`), copiando la referencia — reasignar
 `window.LF.fetchTarifas` despues no afecta a esa copia. Se dejo solo con verificacion de
 codigo (el fix es un guard de una linea, mecanicamente identico al guard ya verificado
 seis lineas mas arriba en la misma funcion) mas la suite completa.
- **Tercera pasada externa sobre B y D (mismo dia): 2 residuales mas, ambos reales.**
 Contra el ZIP ya desplegado tras la segunda pasada. A y C quedaron confirmados GO sin mas
 cambios; solo B y D tenian un agujero mas.
 - **B (`calculate()`):** `state.generation` (y `state.pending`) solo se actualizaban al
 VENCER el debounce de `scheduleCalculateDebounced()` (200ms despues de la edicion), no en
 el momento de editar. Dos ventanas de falso resultado: (1) si el usuario pulsaba Calcular
 ANTES de que venciera ese debounce, `calculate()` capturaba `startGeneration` sin el bump
 todavia aplicado, y cuando el debounce vencia DURANTE el propio calculo (con un cambio que
 ese mismo calculo ya reflejaba) marcaba "pendiente" en falso; (2) si el usuario editaba
 justo DESPUES de pulsar Calcular, el bump no llegaba a tiempo de que `calculate()` lo
 capturara como distinto, y el resultado se limpiaba como si no hubiera pasado nada.
 Corregido incrementando `state.pending`/`state.generation` de forma SINCRONICA al
 principio de `scheduleCalculateDebounced()` (ya no en el callback de 200ms, que ahora solo
 actualiza el texto visual), y cancelando cualquier debounce vivo al arrancar `calculate()`
 (`clearTimeout(state.debounce)`), para que su callback tardio no reintroduzca "pendiente"
 sobre un calculo que ya incluia ese cambio.
 - **D (simulador solar):** `mesInicioValCapturado` ya entraba en el calculo, pero seguia
 EXCLUIDO de la comparacion de "desactualizado" (motivo de la version anterior:
 `updateMesInicioSelector()` puede reasignarlo por su cuenta). Un usuario que cambiaba "Mes
 de inicio" durante la espera obtenia un ranking distinto sin ningun aviso. Corregido
 haciendo la comprobacion (`isCalcResultStale()`) UNA sola vez, justo despues del ultimo
 `await` posible y ANTES de llamar a `updateMesInicioSelector()` — en ese punto exacto el
 DOM todavia no ha sido tocado por el propio calculo, asi que comparar `mesInicio` ya no da
 falsos positivos, y un cambio real del usuario si se detecta. Ademas, la curva horaria
 indexada (`hourlyTraceState`) tampoco formaba parte del snapshot: un cambio como "quitar
 archivo" durante la espera no tocaba potencia/tabla/zona/Mi tarifa y pasaba inadvertido.
 Añadido un contador (`hourlyTraceState.rev`), incrementado en los cuatro puntos que
 invalidan la traza (`clearHourlyTraceState`, `setHourlyTraceFromImport`,
 `invalidateHourlyTrace`, `retargetHourlyTraceZone`), y sumado a la comparacion de
 "desactualizado".
 - Tests nuevos: 2 en `tests/lf-app-pending-race.test.js` (pulsar Calcular antes de los 200ms
 del debounce no deja pendiente en falso positivo; editar justo despues de pulsar Calcular
 si lo deja, como regresion) usando la funcion real `scheduleCalculateDebounced()`, no un
 mock de `markPending()`. 2 en `tests/bv-ui-zona-grid.test.js` (cambiar "Mes de inicio"
 durante la espera se detecta como desactualizado, conduciendo el desplegable real via
 click en sus `<li>`; quitar el archivo importado durante la espera tambien se detecta,
 como via aislada para probar solo `hourlyTraceState.rev` sin tocar ningun otro campo del
 snapshot). Los cuatro confirmados fallando al revertir su mecanismo correspondiente antes
 de darlos por buenos (los dos de D se revirtieron juntos y por separado: sin
 `mesInicioValCapturado` en la comparacion Y sin el contador de `hourlyTraceState.rev`,
 ambos tests nuevos fallan). Suite completa: 1323/1323.
- **Cuarta pasada externa (mismo dia): A, C y D GO definitivo. B con un ultimo agujero de
 cobertura de `generation`, real.** Contra el ZIP con las correcciones de la 3a pasada (asi
 que A/C/D ya no cambiaron: la propia revision externa los cerro sin mas comentarios). El unico
 residual: dos rutas que mutan datos economicos de forma PROGRAMATICA (`el.value = ...` sin
 disparar `input`) y luego intentan `runCalculation()` directamente, sin haber pasado nunca
 por `markPending()`/`scheduleCalculateDebounced()`. Si ya habia un calculo en vuelo, ese
 `runCalculation()` se descartaba en silencio por `__LF_CALC_INFLIGHT`, y el calculo antiguo
 terminaba sin enterarse de que el formulario habia cambiado — la misma carrera que
 `generation` debia impedir, pero por una ruta que nunca la tocaba.
 - **Ruta 1: aplicar datos de factura.** `factura.js::__LF_applyValues()` escribe
 P1/P2/dias/consumos con `el.value = ...` y despues, si la confianza del parseo es
 suficiente, llama a `runCalculation()`. Corregido con `window.markPending()` justo despues
 de aplicar los valores (y de limpiar la curva CSV), antes de decidir si autocalcula —
 cubre tambien las ramas que NO autocalculan (bloqueadas por "Mi tarifa" o por excedentes
 pendientes), donde el bug era igual de real aunque no se llegara a intentar
 `runCalculation()` en ese momento.
 - **Ruta 2: el toggle de "estimacion de consumo anual".** El listener de
 `lf:annual-consumption-estimate-change` (`lf-app.js`) muta `state.useAnnualConsumptionEstimate`
 directamente y llama a `runCalculation(false)`, sin pasar por ningun input real. Ese flag
 si afecta al filtrado de tarifas por limite anual en `calculateLocal()`. Corregido
 añadiendo `markPending()` al principio del listener, antes de `runCalculation()`.
 - Tests nuevos: 2 en `tests/factura-integration.test.js` (aplicar factura bumpea
 `markPending()` tanto si autocalcula como si el autocalculo queda bloqueado), 1 en
 `tests/lf-app-pending-race.test.js` (el toggle durante un calculo en curso deja `pending`
 en `true`; requirio disparar `DOMContentLoaded` de verdad para registrar el listener real,
 en vez de reimplementar su efecto a mano, añadiendo `btnMenu`/`menuPanel`/`btnShare` como
 stubs minimos al harness para que el resto del cableado de esa misma funcion no lance
 excepciones). Los tres confirmados fallando al revertir cada `markPending()` por separado.
 Suite completa: 1326/1326.
 - Verificado tambien en Chrome real (local, pre-deploy: estos dos fixes no estaban aun en
 produccion en el momento de esta pasada). El primer intento de E2E fallo por dos motivos
 de entorno, no del fix: (1) contra produccion, con un CDN real, la latencia natural hizo
 que la interceptacion CDP pareciera funcionar por casualidad — pero el fix que se estaba
 probando ni siquiera estaba desplegado todavia, dando un falso "FAIL" que en realidad era
 "el codigo viejo sigue en produccion"; (2) contra un servidor local (`python -m http.server`),
 tanto `Network.setRequestInterception` (legacy) como `Fetch.enable` (moderno) resultaron
 poco fiables para retrasar `tarifas.json` — la respuesta local es tan rapida (varias
 decenas de ms) que la ventana de carrera real es demasiado corta para depender de
 temporizadores. Resuelto disparando la mutacion (evento del toggle / clic en "Aplicar
 datos") en el MISMO `page.evaluate()` que arranca `calculate()`, justo despues de
 invocarlo sin esperar su promesa: como `calculate()` es sincronico hasta su primer `await`
 (`fetchTarifas`), esto reproduce la carrera de forma determinista, sin depender de si la
 red (real o interceptada) tarda lo suficiente.

### Home "Mi Tarifa": Perdida De Datos, Desglose Con Cambios Pendientes Y Opciones Avanzadas (RESUELTA)

- **Perdida de datos al activar/desactivar solar.** `updateMiTarifaForm()` (home)
 reconstruye `#miTarifaPrecios` entero via `innerHTML` cuando cambia el checkbox solar, y
 recarga desde `localStorage` 50ms despues. Dos bugs reales de aqui: (1) un guardado con
 debounce (800ms) todavia pendiente en el momento del toggle sobrevivia a la reconstruccion
 y, al disparar, leia el DOM NUEVO en vez del valor recien tecleado que lo origino — se
 perdia en silencio; (2) `saveCustomTarifaMain()` leia `mtPrecioExc`/`mtBV`/`mtPrecioBV`
 incondicionalmente, y con solar desactivado esos campos no existen en el DOM, asi que
 editar solo Punta con solar OFF sobrescribia la compensacion/BV ya guardadas con vacio.
 Corregido con un flush sincronico ANTES de destruir los inputs (`updateMiTarifaForm`), y
 distinguiendo "campo no montado" (preservar lo guardado) de "campo vaciado" en
 `saveCustomTarifaMain()` mirando la presencia REAL del campo en el DOM, no el checkbox de
 solar (que en el momento del flush ya puede reflejar el nuevo estado mientras el DOM
 todavia tiene los inputs del anterior). Tambien se añadio `mtPrecioBV` a `MT_CAMPOS`
 (residual visual: quedaba en rojo tras corregir el valor porque no formaba parte de la
 limpieza de estilos de error).
- **El desglose podia calcular con datos distintos de los de la fila del ranking.** Tras
 Calcular, editar un input marca `state.pending = true` ("Cambios pendientes. Pulsa
 Calcular..."), pero las filas del ranking seguian siendo clicables y `mostrarDesglose()`
 releia los inputs del DOM ACTUAL, no un snapshot de los que generaron esa fila — podia
 mezclar consumos/precios nuevos con metadatos viejos de la fila (SSAA, precio FV usado),
 produciendo un desglose que nunca existio en el ranking visible. Corregido con un guard al
 inicio de `mostrarDesglose()`: si `window.LF.state.pending` es true, bloquea y avisa.
- **"Mi tarifa" no podia reproducir 17 tarifas del dataset de entonces** que usan al menos una de
 tres condiciones economicas que el formulario personalizado no exponia: servicios de
 ajuste no incluidos en el precio (`incluyeServiciosAjuste: false`, ver `mustApply()` en
 `lf-ssaa.js`), tope de compensacion `ENERGIA_PARCIAL` en vez de `ENERGIA`
 (`desglose-calculo.js`/`bv-sim-monthly.js`), y compensacion a precio indexado (centinela
 `fv.exc = -1`, ya soportado por el motor para tarifas del dataset). Añadidas tres opciones
 avanzadas (checkboxes, con un `<details>` colapsado para SSAA) tanto en home
 (`lf-tarifa-custom.js`) como en el simulador solar (`bv-ui.js` +
 `comparador-tarifas-solares.html`), propagadas a la tercera reconstruccion independiente en
 `desglose-integration.js`, a la persistencia de ambos formularios, y a la whitelist de
 `normalizeImportedScenarioPayload()` (backup/enlace compartido del simulador solar). Los
 defaults preservan el comportamiento historico (`incluyeServiciosAjuste: true`,
 `tope: 'ENERGIA'`, compensacion fija): una "Mi tarifa" ya guardada no cambia de resultado
 sin que el usuario marque explicitamente alguna de las tres casillas nuevas. No se toco la
 politica de compartir la home (Mi tarifa no viaja en sus enlaces; decision ya documentada
 aparte).
- Las tres son de la octava pasada de auditoria externa cruzada. Verificadas contra el
 codigo real antes de corregir, con tests en `tests/custom-tarifa.test.js`,
 `tests/bv-ui-mi-tarifa-decimales.test.js` y `tests/desglose-integration-ux.test.js`, y en
 Chrome real contra codigo sin desplegar (`http.server` local) para las piezas de UI:
 persistencia del formulario al alternar solar, bloqueo del desglose con `state.pending`, y
 los tres checkboxes nuevos (ocultar precio fijo al marcar indexada, `fv.exc=-1`,
 `fv.tope='ENERGIA_PARCIAL'`) tanto en home como en el simulador solar.
- **Residual detectado tras cerrar las tres (mismo dia, misma fuente externa):** al marcar
 "compensacion indexada", el precio fijo (`mtPrecioExc`/`mtExc`) queda oculto visualmente y
 se ignora en el calculo (`fv.exc` se fuerza a `-1`), pero seguia formando parte de la
 validacion de Calcular en ambos formularios — un valor invalido en ese campo oculto
 bloqueaba igual, aunque nunca fuera a usarse. Corregido excluyendolo de la validacion
 cuando indexada esta marcada (`validateMiTarifa()` en home, `miTarifaIds` en `bv-ui.js`), y
 quitando la marca `.error` al marcar la casilla (mismo criterio que `mtPrecioBV` al
 desactivar BV). Tests en `tests/custom-tarifa.test.js` y `tests/bv-ui-zona-grid.test.js`
 (describe "...mtExc no bloquea el calculo con compensacion indexada..."), y verificado en
 Chrome real contra codigo sin desplegar en ambos formularios.
- **Segundo residual (mismo cierre, autoinfligido por alcance de llave):** al meter la
 validacion de `mtPrecioExc` dentro de `if (tieneSolar && !compensacionIndexada)` en HOME
 (`validateMiTarifa()`), la validacion de cuota BV (bloque "5.") quedo anidada dentro por
 error, asi que con compensacion indexada activa la cuota BV dejaba de validarse — una
 cuota vacia o invalida se colaba como `precioBV: 0` en `agregarMiTarifa()`. Real: existe
 `Nordy 24H V` en el dataset, que combina compensacion indexada con BV y cuota 2,99€/mes. El
 simulador solar (`bv-ui.js`) nunca tuvo este bug (su validacion de BV siempre fue
 independiente de la de `mtExc`). Corregido separando los dos bloques (`if (tieneSolar &&
 $('mtBV')?.checked)` para BV, sin depender de `compensacionIndexada`). Tests añadidos en
 `tests/custom-tarifa.test.js` (indexada+BV+cuota vacia bloquea, indexada+BV+cuota valida da
 `fv.precioBV` correcto, indexada+BV+cuota con formato invalido bloquea), y verificado en
 Chrome real contra codigo sin desplegar reproduciendo exactamente el caso Nordy 24H V.

### Factura, Tabla Manual Y "Mi Tarifa": Ceros Explicitos Y Continuidad (RESUELTA)

- `factura-parsers.js` ya NO inventa un reparto P1/P2/P3 (`0/total/0`) cuando solo se
 detecto un consumo total sin desglose horario. Antes de esta fecha, ese reparto sintetico
 inflaba la confianza del parseo a 100% con datos que el usuario nunca introdujo. Ahora
 `consumoTotalDetectado` viaja aparte y `factura.js` avisa explicitamente de que falta el
 reparto manual. Verificar contra `tests/factura-integration.test.js`.
- La tabla manual del simulador solar (`bv-ui.js`) ya no clampa en silencio valores invalidos
 (negativos a 0, mayores que 10000 a 10000) ni acepta formatos ambiguos tipo `1.2.3`:
 `validateManualGridInput()` bloquea el calculo con `manualGridHasInvalidInputs()` como gate,
 revalidando TODOS los inputs en el momento de pulsar Calcular (no solo confiando en la clase
 `.error` puesta por el listener de `input`, que puede faltar si el valor se puso sin disparar
 el evento).
 Nota historica: en la correccion del 14/08 `esNumericoValido()` todavia tenia la asimetria
 punto/coma descrita entonces. La auditoria del 15/08 (seccion especifica mas abajo) la corrigio
 en `lf-utils.js`; el validador de la tabla se mantiene como defensa redundante.
- "Mes sin datos" y "mes con los 4 campos explicitamente a 0" ya no colapsan al mismo caso.
 `buildSimulationMonths()` (`bv-ui-helpers.js`) usa presencia de entrada (`entries[i] !==
 undefined`), no positividad, para decidir si un mes participa. `loadManualData()`
 (`bv-ui.js`) tenia el mismo bug sin corregir en su propio calculo de `hasData` — un mes
 unico con los 4 campos a 0 explicito no marcaba `hasData`, y por tanto no restauraba
 `zonaOrigen` al recargar, dejando sin activar el guardrail de zona-mismatch. Corregido con
 el mismo criterio (presencia del string crudo). La tabla manual tambien exige ahora
 continuidad de meses (`monthsAreConsecutive`, exportado en `window.LF.csvUtils`), igual que
 ya exigia el importador CSV.
- "Mi tarifa" (simulador solar y home) ya no usa una cadena de `||` que sustituye un `0`
 explicito de un periodo/potencia por el valor de otro campo relleno: `getCustomTarifa()`
 distingue "campo vacio" de "campo puesto a 0" con los valores RAW del DOM antes de parsear,
 y solo cae al valor de otro campo relleno cuando el propio esta realmente vacio.
- Se añadio el campo `precioBV` (cuota mensual de la bateria virtual) al modelo de "Mi
 tarifa", ausente hasta ahora aunque el motor de calculo ya lo soportaba para tarifas del
 dataset: HTML (`comparador-tarifas-solares.html` y la plantilla inyectada de
 `lf-tarifa-custom.js`), lectura/escritura/autosave en `bv-ui.js` y `lf-tarifa-custom.js`,
 reconstruccion independiente en `desglose-integration.js` (una tercera copia del mismo
 objeto `fv`, distinta de las otras dos), y whitelist de `normalizeImportedScenarioPayload()`
 para que sobreviva a exportar/restaurar un backup. Es obligatorio rellenarlo (aunque sea con
 `0`) cuando la BV esta activa; nunca se aplica si la BV no esta activa, sea cual sea su
 contenido.
- Los 6 hallazgos de esta tanda vinieron de una auditoria externa cruzada en modo
 "profundo", verificados uno a uno contra el codigo real antes de corregir (metodologia
 habitual, ver "Lectura Obligatoria..."). El ultimo matiz (perdida de `zonaOrigen` en el
 caso borde de mes-unico-todo-cero) se detecto en la revision final del diff, tambien
 desde fuera, y se verifico y corrigio en la misma tanda.
- **Residual detectado tras cerrar los 6 (mismo dia, misma fuente externa):** en `bv-ui.js`, el
 bloque de validacion de "Mi tarifa" al pulsar Calcular (`miTarifaIds`) incluia `mtPrecioBV`
 sin condicion, así que un valor invalido en esa cuota (p.ej. `"abc"`) bloqueaba el calculo
 aunque la BV estuviera desmarcada — pese a que `getCustomTarifa()` ya ponia `precioBV: 0`
 en ese caso y el campo no participa en absoluto en la economia. Asimetrico con
 `lf-tarifa-custom.js` (home), que ya envolvia esa validacion en `if (mtBV.checked)`.
 Corregido excluyendo `mtPrecioBV` de `miTarifaIds` (y por tanto de `miTarifaHasContent`)
 cuando BV esta desactivada, y limpiando la marca `.error` del campo al desmarcar BV. Test
 en `tests/bv-ui-zona-grid.test.js`, describe `Simulador solar - "Mi tarifa": precioBV no
 bloquea el calculo con BV desactivada`.

### Escenarios Compartidos: `zonaOrigen` Y "Mi Tarifa" Excluida (RESUELTA)

- `shareScenario()` (`bv-ui.js`) construia `payload.data` con `collectManualGridData()` a
 secas, sin pasar por `buildManualScenarioPayload()` (que si añade `zonaOrigen` cuando hay
 datos importados por CSV). Consecuencia real, no solo de metadata: el receptor de un enlace
 compartido con datos mensuales no tenia forma de saber con que eje horario se genero el
 reparto P1/P2/P3 de la tabla, asi que el guardrail de zona-mismatch (bloquear el calculo si
 la zona activa no coincide con la de origen del reparto) quedaba desactivado en la
 previsualizacion. Corregido añadiendo `zonaOrigen` a `payload.data` con el mismo criterio
 que el guardado local. Verificado ademas en Chrome real contra codigo sin desplegar,
 importando un CSV real y decodificando el enlace copiado al portapapeles.
- El bloque de carga inicial de "Mi tarifa" (`if (sharedScenarioConfig?.customTarifa) {...}
 else { loadCustomTarifa(); }`) caia al `else` tanto si NO habia enlace compartido (correcto:
 cargar la tarifa local del usuario) como si HABIA un enlace compartido que excluia
 deliberadamente "Mi tarifa y saldo BV" (`customTarifa: null` por no marcar el opt-in) —
 en ese segundo caso, `loadCustomTarifa()` cargaba de todos modos `bv_custom_tarifa` del
 receptor y la metia en el ranking, haciendo que el mismo enlace diera resultados distintos
 segun el navegador que lo abriera. Corregido distinguiendo con `isSharedPreview`: si el
 enlace es una previsualizacion sin `customTarifa`, se deja el formulario vacio (sin tocar
 `bv_custom_tarifa` en localStorage) en vez de caer al `else`.
- Ambos hallazgos son de la sexta pasada de auditoria externa cruzada (comparacion
 diferencial de 300+300 escenarios aleatorios entre motores, 0 divergencias matematicas
 encontradas — esta tanda es puramente de persistencia/transporte, no de calculo).
 Verificados contra el codigo real antes de corregir. Tests en
 `tests/bv-ui-zona-grid.test.js`: "compartir mensuales preserva zonaOrigen" y los tres tests
 del describe de enlaces que excluyen/incluyen Mi tarifa.

### "Limpiar Cache", Blanqueo De La Tabla Manual Y Autocalculo De Factura (RESUELTA)

- **"Limpiar cache" (home y solar) hacia `localStorage.clear()`** con una lista blanca minima
 (`goatcounter_optout`, `lf_aecc_banner_dismissed_at`) que restauraba despues. Eso borraba
 tambien `almax_comparador_v6_inputs`, `lf_custom_tarifa`, `bv_manual_data_v2`,
 `bv_custom_tarifa`, `bv_manual_data_timestamp` y `almax_theme` — ningun texto del dialogo de
 confirmacion avisaba de que esto perdia Mi tarifa o el escenario mensual, a diferencia de
 los botones "Limpiar datos guardados"/"Borrar", que si avisan. Corregido para que solo
 borre las claves de cache tecnica real (`pvpc_cache_v3:*`), sin lista blanca de restauracion
 porque ya no hace falta: todo lo demas simplemente no se toca.
- **La tabla manual "curaba" en silencio un valor rechazado por Calcular.** `1,2,3` se
 bloqueaba correctamente en el boton Calcular, pero `collectManualGridData()` guarda el
 `.value` crudo tal cual, y exportar/compartir se llevaban ese string sin revalidar. Al
 restaurarlo, `loadManualData()` hacia `parseInput("1,2,3") = 12.3` seguido de
 `formatNumberES(...)`, convirtiendo el valor invalido en `"12,3"` — un numero DISTINTO y
 valido que el usuario nunca escribio ni confirmo, y que ya pasaba Calcular en la siguiente
 visita. Corregido en dos frentes: (1) exportar, compartir mensuales y "Guardar escenario"
 ahora revalidan la tabla igual que Calcular (`manualGridHasInvalidInputs()`) y bloquean si
 hay algo invalido; (2) importar un backup valida los valores ANTES de `persistManualScenario()`
 (nunca sobrescribe el escenario anterior con un backup invalido); (3) `loadManualData()` ya
 NO reformatea un raw invalido — lo deja tal cual llego, marcado en rojo, en vez de convertirlo
 en otro numero. Se extrajo el nucleo de `validateManualGridInput()` a una funcion pura
 (`parseManualGridRaw`) reutilizable sobre datos que aun no estan en el DOM.
- **Autocalcular una factura de 100% de confianza podia mezclar datos nuevos con estado
 economico viejo que el parser no toca.** `__LF_applyValues()` solo actualiza P1/P2/dias/
 consumos; si `solarOn` tenia excedentes/saldo BV de un periodo anterior, o "Mi tarifa" ya
 tenia precios rellenados, el autocalculo (activado con confianza ≥99,5%) los combinaba con
 los datos de la factura nueva sin que el usuario lo confirmara — en el caso de "Mi tarifa" el
 propio toast decia "rellena los precios manualmente" y acto seguido calculaba ya con los
 precios viejos. Corregido: el autocalculo se desactiva si hay contenido previo real en esos
 campos (`customTarifaActiva`/`solarStateNotParsed`), con un mensaje de estado especifico
 pidiendo revisarlos antes de calcular. Verificado con las 11 facturas reales de
 `Ejemplos Facturas/` (todas llegan a 100% de confianza) en los tres escenarios.
- Los tres hallazgos son de la septima pasada de auditoria externa cruzada, sin nuevas
 divergencias del motor matematico (solo persistencia/flujos de entrada). Verificados contra
 el codigo real antes de corregir y en Chrome real contra codigo sin desplegar (`http.server`
 local). Tests en `tests/bv-ui-zona-grid.test.js` (describes "Limpiar cache..." y "...no cura
 valores invalidos...") y `tests/tracking-privacy.test.js`.
- **Residual detectado tras cerrar los tres (mismo dia, misma fuente externa):** el Fix 3 de
 factura condicionaba `customTarifaActiva` a que "Mi tarifa" ya tuviera ALGUN precio
 relleno, asi que con el checkbox "Comparar con mi tarifa actual" recien marcado y los
 campos aun vacios, el autocalculo SI se disparaba — justo cuando el propio toast le acababa
 de decir al usuario "rellena los precios manualmente". El bloqueo debe depender del
 checkbox, no de si ya hay contenido (a diferencia de excedentes/saldo BV, donde el checkbox
 solo NO implica ningun dato viejo que mezclar). Corregido a
 `customTarifaActiva = Boolean(compararMiTarifa?.checked)`. Tests en
 `tests/factura-integration.test.js`, describe "Autocalculo tras aplicar factura de 100%
 confianza", con una factura sintetica que reconstruye P1/P2/dias/Punta/Llano/Valle desde
 coordenadas PDF (igual que el test DISA ya existente) para alcanzar 100% de confianza sin
 mockear `__LF_lastParsedConfianza` directamente (variable privada del modulo). Verificado
 ademas con una factura real (`Endesa.pdf`) en Chrome contra codigo sin desplegar.

### Orden Del Teardown Con Fake Timers (`tests/bv-ui-zona-grid.test.js`)

- En el `afterEach`, `vi.restoreAllMocks()` va ANTES de `vi.useRealTimers()`, y el orden no es cosmetico. Los tests de autoguardado activan fake timers antes de `bootSolarUi`, que hace `vi.spyOn(window, 'setTimeout')`: el spy captura entonces la implementacion falsa como si fuera la original. Con el orden inverso, `restoreAllMocks()` la reinstala y los tests posteriores que esperan con `setTimeout` real se cuelgan hasta el timeout de 5 s. Ocurrio de verdad el 12/08/2026. No reordenes esas dos lineas al "limpiar".

### PVPC Con CSV Y Precios Faltantes

- Si el usuario activa PVPC con precios del periodo importado, `pvpc.js` intenta cruce exacto hora a hora.
- La home distingue dos ejes al cambiar de zona despues de importar: perfil de periodos
 (`general` frente a `ceuta-melilla`) y reloj DST (`Europe/Madrid` frente a Canarias).
 Entrar o salir de Ceuta/Melilla recalcula los agregados P1/P2/P3 desde fecha/hora e
 ignora el `record.periodo` anterior, pero conserva `consumosHorarios` y el modo PVPC
 exacto porque el reloj es el mismo. Cruzar Canarias solo invalida la traza si contiene
 un dia de cambio horario; sin DST se conserva. No reportar esa conservacion como uso de
 una curva de la zona anterior: las claves horarias siguen siendo validas.
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
- `-1` es el UNICO valor centinela admitido: el generador externo tenia hasta el 14/08/2026 una
 ruta de codigo para texto libre ("OMIE"/"INDEXADA" en la celda) que ninguna fila del dataset
 llego a usar nunca; se elimino esa ruta en el generador tras una auditoria externa cruzada, asi
 que `fv.exc` esta garantizado como `number` en origen, coherente con el tipo documentado arriba.

### Validador De Dia Civil Compartido (Home, Observatorio, Excedentes)

- `validatePvpcDayCoverage`/`validateClosedPvpcDay` viven en `js/lf-csv-utils.js` y son la unica
 implementacion: la usan por igual `pvpc.js` (home), `pvpc-stats-engine.js` y `pvpc-stats-csv.js`
 (Observatorio) y `lf-surplus-prices.js` (excedentes). No reportes como bug que "cada uno tenga su
 propia validacion": ya no es asi (12/08/2026).
- Exige 23/24/25 puntos horarios contiguos segun DST, sin huecos/duplicados, todos dentro del dia
 civil declarado en la zona horaria del propio dataset (no la del navegador).
- Excepcion deliberada `allowPartial`: cualquier dia `>= hoy` (segun la zona del dataset) puede
 llegar con menos horas de las esperadas, porque REE publica el dia siguiente sobre las 20:15 y ese
 dia puede aparecer incompleto dentro del mismo fichero mensual sin que sea un fallo real. No lo
 reportes como "el validador acepta dias incompletos": solo lo hace para hoy/manana, y exige que lo
 publicado sea correcto y contiguo desde medianoche. Un dia HISTORICO incompleto sigue rechazando el
 mes entero.
- La garantia mensual tambien es fail-closed: solo se acepta `schema_version: 2`, con `from`/`to`
 coincidentes con las claves diarias y sin dias omitidos. Un mes historico debe cubrir completo
 del dia 1 al ultimo natural. Un dia `allowPartial` se registra como `provisionalDays` y no se
 guarda en las caches de sesion del Observatorio ni de excedentes, para permitir reintento.
- La integridad mensual no sustituye la frescura: durante el mes vigente, el runtime rechaza una
 copia 2xx que quede mas atras que la tolerancia del guard operativo (PVPC: 1 dia; excedentes:
 2 dias), incluso si sus dias presentes son correctos.
- El aviso visual "parcial" no se limita al pie del grafico: `getKpiPartialFlags()` en
 `js/pvpc-stats-ui.js` lo propaga a los 5 KPIs del Observatorio, incluidos rolling 12 meses y YoY,
 que ademas del anyo visible dependen del anyo anterior o del anyo de comparacion (13/08/2026).
- `PVPC_CACHE_PREFIX` paso de `pvpc_cache_v2` a `pvpc_cache_v3` (`js/pvpc.js`). Es una invalidacion
 deliberada, no un descuido de version: v3 invalida resultados calculados antes del endurecimiento
 de cobertura fail-closed. Una entrada v2 podia haberse generado con cobertura mensual o diaria
 parcial que el contrato actual ya no considera valida. La separacion posterior de la ruta CSV
 (bloqueante 1) no cambia esta razon principal: las claves tambien distinguen calculos CSV mediante
 `csvSignature`, pero la frontera CSV no es el motivo del cambio de version. Cambiar el prefijo la vuelve simplemente ilegible para el codigo nuevo (nunca
 hace `match`), sin necesitar limpieza manual ni migracion. No reportes el cambio de version como
 ruido; reportalo como bug solo si encuentras una entrada NUEVA que use el prefijo viejo.

### Frontera Temporal Del Periodo PVPC Estandar (RESUELTA)

**Historial del finding, conservado como conocimiento util:**

- En el calculo PVPC sin CSV, `obtenerPVPC_LOCAL` decidia "ultimos N dias hasta ayer" con
 `startOfDayLocal(new Date())`, que usaba la zona horaria del NAVEGADOR, y solo despues fijaba
 `dataTimezone` segun el geoId. Si esa zona diferia de la zona electrica elegida, el dia tomado
 como "ayer" podia no ser el ultimo dia cerrado de la zona.
- Mecanismo e impacto monetario CONFIRMADOS el 13/08/2026, con fixture controlado (host
 `Europe/Madrid`, zona Canarias, `dias=1`, instante `2026-08-13T22:30Z`, dias 12 y 13 completos
 con precios 0,10 y 0,30 EUR/kWh): el codigo viejo usaba el 13, que en Canarias seguia en curso, y
 devolvia 95,07 EUR; el ultimo dia cerrado (12) devuelve 32,01 EUR. Magnitud realista (no la del
 fixture): variacion absoluta entre medias horarias de dias consecutivos en agosto de 2026, 12,44%
 (geo 8741) y 13,00% (geo 8742), maximos ~50%; no equivale a esa misma desviacion en la factura
 final, porque potencia, impuestos y reparto P1/P2/P3 la amortiguan.
- `validateClosedPvpcPeriod` NO protegia este caso: `validatePvpcDayCoverage` valida cobertura
 estructural del dia (puntos, finitud, contiguidad, primera/ultima hora), no compara con "hoy". Un
 dia EN CURSO con 24 puntos pasaba como valido; el fail-closed solo cubria el dia incompleto.
- Alcanzable en produccion: el dia canario llegaba a 24 puntos unas 2,5 h ANTES de cerrarse (commit
 `03e279f`, `2026-08-12T20:30Z`), y la franja divergente Madrid-Canarias caia dentro de esa
 ventana. La franja no era de 1 h en general: con un host en otra zona es del tamano del desfase
 horario (unas 7 h desde `Asia/Tokyo`), y afectaba en ambos sentidos (dia sin cerrar hacia
 adelante, dia mas viejo hacia atras).

**Correccion aplicada el 13/08/2026 (`js/pvpc.js`, `js/lf-csv-utils.js`):**

- La zona ELECTRICA seleccionada (nunca la del host/navegador) es ahora la unica fuente de verdad
 para decidir el dia civil "hoy"/"ayer", tanto en la seleccion del periodo estandar como en el
 anchor de cache: **las dos piezas se corrigieron JUNTAS**, porque un fix parcial de una sola
 habria dejado servir el periodo anterior bajo la misma clave hasta ~23 h despues de la medianoche
 de la zona elegida (peor que el bug original).
- `pvpcElectricTimeZone(zonaFiscal)` (`js/pvpc.js`) mapea la zona fiscal ya normalizada a su
 timezone PVPC (Canarias -> `Atlantic/Canary`, resto -> `Europe/Madrid`), fuente unica que ya no
 se duplica en ningun otro literal.
 `getClosedPvpcPeriodYmd(timeZone, dias, now)` resuelve el dia civil "hoy" con
 `Intl.DateTimeFormat` (via `window.LF.csvUtils.formatYmdInTimeZone`) y resta dias con aritmetica
 PURA de calendario (`window.LF.csvUtils.addDaysYmd`, exportada el mismo dia; antes existia en
 `js/lf-csv-utils.js` pero no se exponia). Ninguna de las dos toca
 `Date.getFullYear/getMonth/getDate`, que reflejan la zona del PROCESO, no la electrica pedida.
 `dateFromYmd(ymd)` lleva el YMD ya resuelto de vuelta a un `Date` (round-trip host-neutral,
 documentado en el propio codigo) para el resto del pipeline (iteracion de meses,
 `validateClosedPvpcPeriod`), sin volver a preguntarle "que dia es hoy" al host.
- `getPvpcAnchorDate(zonaFiscal, now)` reutiliza el mismo mecanismo (`getLastClosedPvpcDayYmd`) y
 ahora acepta `zonaFiscal` como parametro; su unico call site (`buildPvpcCacheKey`) le pasa la
 `zonaFiscal` ya normalizada que calcula unas lineas antes.
- `PVPC_CACHE_PREFIX` se mantuvo en `pvpc_cache_v3` (decision deliberada, no descuido): cuando host
 y zona electrica COINCIDEN (la inmensa mayoria de sesiones), el anchor viejo y el nuevo son
 identicos byte a byte, asi que las entradas existentes se leen igual de bien. Cuando DIVERGEN, el
 anchor nuevo apunta a una fecha DISTINTA de la que el codigo viejo habria escrito, asi que una
 entrada antigua con el anchor incorrecto simplemente queda huerfana (la elimina el LRU de
 `enforcePvpcCacheLimit`) y nunca puede leerse como si fuera el resultado correcto de otra fecha:
 no hay ningun escenario de colision entre una clave vieja y una nueva que signifiquen cosas
 distintas.
- Regresiones nuevas en `tests/pvpc.test.js`, describe "Frontera temporal del periodo PVPC estandar
 (zona electrica, no del host)", 10 casos: Canarias `dias=1`/`dias=7` en la franja divergente con
 Madrid, Peninsula en el mismo instante, prueba de que el resultado depende solo de
 `(now, timeZone)` con una tercera zona (`Asia/Tokyo`) sin relacion con Espana, fin de mes, cambio
 de anyo, DST primavera/otonyo (el dia de 23/25 horas se resta como UN dia civil, no como 24h), y los
 dos anchors de cache (Canarias/Peninsula) en la misma frontera. El caso #10 atraviesa
 `obtenerPVPC_LOCAL` de verdad (no solo el helper puro): con `vi.setSystemTime` fijando el instante
 y dias 12/13 estructuralmente completos con precios distintos, confirma que el motor real usa el
 12 (ultimo cerrado), no el 13 (en curso pero ya con 24 puntos). Validado por MUTACION: revertir la
 seleccion del periodo a `Date.getFullYear/getMonth/getDate` del host tumba el caso #10; revertir
 solo `getPvpcAnchorDate` a la TZ del host tumba el caso #8 (anchor Canarias), confirmando que las
 dos piezas estan realmente conectadas y no solo declaradas.
- Ruta CSV, fuera de alcance en su seleccion/parsing/calculo: `parseDateFlexible` ->
 `makeStrictDate` construye la fecha desde componentes civiles locales y el posterior
 `startOfDayLocal` -> `formatYMD` conserva esos mismos componentes; no hay conversion de instante
 absoluto que pueda divergir por zona. Matiz honesto: `buildPvpcCacheKey` se llama SIEMPRE, con o
 sin CSV, asi que el anchor (ahora zone-aware) tambien forma parte de la clave de cache de un
 calculo CSV, no solo del estandar. Esto no afecta la correccion CSV (su propio `csvSignature`
 ya desambigua el rango real importado), como mucho cambia que rango de dias divergentes
 reutiliza la misma entrada cacheada.

**No reportes esta frontera temporal como bug de nuevo mientras el mecanismo descrito arriba
(seleccion + anchor con `pvpcElectricTimeZone`) siga vigente.** Si vuelve a fallar, sera por una
regresion puntual (localizable con los 10 tests de arriba) o por un caso nuevo no cubierto por
ellos, no por el mecanismo original ya corregido.

### PVPC Desaparece Del Ranking, SSAA `unavailable` Y Cache Del Service Worker

- Si `crearTarifaPVPC()` devuelve `null` (cobertura invalida, fail-closed), `js/lf-app.js` hace
 `window.LF.cachedTarifas = pvpc ? [...base, pvpc] : base`: PVPC sencillamente NO se anyade como
 fila. No es una fila "PVPC no disponible" ni un error visual permanente; es la ausencia total de
 esa fila en ranking, KPIs y grafico, con un toast puntual la primera vez. Es la misma logica de
 "mejor ausente que incorrecto" que rige el resto del fail-closed de PVPC.
- SSAA distingue `unavailable` de `0` a proposito (`js/lf-ssaa.js`). `unavailableRate()` devuelve
 `{available:false, rate:null, ...}` cuando el dataset no cubre el mes pedido; `asPublishedRate()`
 acepta `value >= 0` (no `> 0`), asi que un `0` que el dataset publica de verdad es
 `{available:true, rate:0}`. No colapses ambos casos: tratar `unavailable` como `0` cobraria de
 menos por error; tratar un `0` publicado como `unavailable` rechazaria un dato valido.
- El Service Worker (`sw.js`) distingue error transitorio de error permanente para PVPC/excedentes/
 SSAA: ante 408/429/5xx (linea 314) sirve una copia `2xx` sana del build activo si existe, como
 fallback de red inestable. Un 404/410 real NUNCA se enmascara con cache antigua (comentarios en
 `sw.js` lineas 367 y 393): revivir una pagina retirada con una copia vieja seria peor que el error.
 No reportes que "el SW no reintenta 404" como inconsistencia: es la distincion correcta entre
 "puede que vuelva" y "ya no existe".

### `tarifas.json` No Lleva Test De Esquema En El Repo (Deliberado)

- `tarifas.json` es el unico dataset SIN test general de esquema en `tests/`, a diferencia de PVPC/surplus (`pvpc-dataset-integrity.test.js`) y SSAA (`ssaa-dataset.test.js`). NO lo reportes como carencia. Si existen asserts puntuales sobre el dataset atados a una funcionalidad concreta (por ejemplo `promo-badge.test.js` comprueba que el campo `promo` es texto no vacio y no duplica `requisitos`), eso no contradice esta decision: son invariantes de esa funcionalidad, no una validacion de esquema del dataset.
- La diferencia es legitima por origen: PVPC/surplus/SSAA los genera un script del repo en CI, sin humano en el bucle, por eso necesitan red de seguridad en el repo. `tarifas.json` NO se edita a mano ni lo genera CI: se genera externamente antes de subirlo al repositorio.

- Cualquier validacion de esquema de tarifas se realiza fuera del repositorio. Decision FIRME (23/07/2026); no re-proponer `tests/tarifas-dataset.test.js`.
- La validacion estructural minima de `fetchTarifas` (`esTarifaUtilizable` en `js/lf-cache.js`,
 13/08/2026) NO contradice esta decision ni es un test de esquema: se ejecuta en runtime sobre lo
 DESCARGADO, no sobre el fichero del repo, y su unico proposito es que un artefacto corrupto no
 pise en memoria una copia sana. No la borres por coherencia con este apartado ni la amplies con
 rangos o reglas comerciales del generador.
- Reforzado 14/08/2026 (auditoria externa cruzada, verificada linea a linea antes de aplicar):
 el contrato del generador externo (`validar_contrato_excel()`) ahora tambien rechaza NaN/Infinity
 y valores fuera de dominio en `fv.exc` (antes solo `NO COMPENSA` estaba blindado; `SIMPLE`,
 `SIMPLE + BV` y `NETO` aceptaban en silencio un no-finito o negativo distinto de `-1`), y la
 escritura de `tarifas.json` es atomica (temporal + `os.replace`) para que un rechazo del contrato
 nunca deje el fichero real a medias. Esto es evidencia adicional de que la validacion "fuera del
 repositorio" de este apartado es real y se mantiene al dia, no solo una afirmacion de intencion.
- Reforzado de nuevo el mismo dia (14/08/2026, segunda tanda de la misma auditoria cruzada): el
 contrato tambien exige, si `minConsumoAnualExclusivo`/`maxConsumoAnual` (columnas T/U) tienen
 contenido, que sean numeros finitos positivos, que `T < U` cuando ambos existan, y que
 `Requisitos` no este vacio — antes de esto, `parse_float_any()` convertia un valor invalido
 (ej. "4000 aprox") a `0.0` y lo descartaba en silencio sin abortar la generacion.
- Reforzado una tercera vez el mismo dia (14/08/2026, tercera tanda de la misma auditoria
 cruzada): el contrato ya no acepta `fv.tipo = "NETO"`, `fv.tope = "POTENCIA"` ni
 `fv.reglaBV = "BV ACUMULADA"` — verificado que ningun consumidor JS los implementa (grep sobre
 `lf-calc.js`, `desglose-calculo.js`, `bv-sim-monthly.js`: cero apariciones) y que las 136 filas
 reales del Excel maestro (118 activas + 18 inactivas) tienen 0 filas con esos valores.
 Documentados como reservados en `JSON-SCHEMA.md`, no como aceptados.

### Limites De Consumo Anual (`maxConsumoAnual` / `minConsumoAnualExclusivo`)

Filtro revisado el 13/08/2026. Las decisiones de abajo son FIRMES y ya fueron litigadas en
revision tecnica; no las reportes como hallazgo.

- **Los periodos cortos no se anualizan automaticamente para excluir.** Se mantiene visible el
 conjunto prudente por defecto. La UI solo ofrece una estimacion `consumo * 365 / dias` cuando
 activarla cambiaria candidatas, explica su base y permite aplicarla o deshacerla. Asi un mes
 estacional no elimina opciones en silencio y el usuario puede pedir expresamente el filtro. Se
 advierte que calefaccion, aire acondicionado y la epoca del ano pueden desviarla; con menos de
 28 dias se refuerza el aviso, pero no se oculta porque la entrada admite cualquier periodo.
- **La estimacion es estado efimero.** No se persiste en `localStorage`, no viaja en enlaces
 compartidos y vuelve a desactivada al recargar o al cambiar los kWh/dias que la sustentan. En
 solar se avisa ademas del sesgo estacional.
- **El maximo se contrasta siempre contra los kWh registrados, con cualquier periodo.** No es una
 estimacion: es monotono. Si ya hay 4.001 kWh registrados, ningun dato futuro baja de 4.000.
- **El minimo exclusivo no excluye nunca**, ni con ano completo ni por estimacion. Las dos tarifas
 Imagina 8000 quedan visibles por decision de producto; el campo conserva la condicion comercial
 estructurada y `requisitos` la explica, pero no interviene en `compatibles` ni `excluidas`.
- **Cada simulador define "ano completo" a su manera y es correcto.** Home: `dias >= 365` (campo
 del formulario). Solar: `hasFullAnnualConsumptionCoverage` (12 meses consecutivos, sin
 duplicados, >= 365 dias cubiertos). NO lo reportes como incoherencia ni propongas unificarlos:
 son entradas distintas (un campo declarado frente a meses medidos).
- **En solar hay DOS alcances anuales a proposito.** `isAnnualPresentationScope` (12 meses al 80%)
 solo elige etiquetas de coste; `isAnnualConsumptionScope` exige 12 meses consecutivos y al menos
 365 dias para decidir que el consumo ya es anual y no necesita extrapolacion. Ninguno habilita
 exclusiones por minimo. No los vuelvas a fusionar.
- **No se prorratean los periodos de 365 dias o mas.** Son alcance anual real. El importador puede
 tolerar hasta 370 dias y el filtro usa los kWh registrados sin reducirlos a una base de 365.
- **Borde exacto del unico filtro activo**: `consumo > maximo` excluye; 4.000 clavados siguen en la
 tarifa de maximo 4.000. El minimo no se evalua.
- **Limite ausente, cero o no numerico se ignora y la tarifa se muestra.** Es el fallo seguro
 correcto para un comparador. No lo reportes como validacion que falta: la coherencia del
 dataset se valida en el generador/Excel (ver la seccion de `tarifas.json` mas arriba).
- **"Mi tarifa" del simulador solar nunca puede quedar excluida**: `getCustomTarifa()` la
 construye sin campos de limite. Es un dato del usuario, no una recomendacion.
- **`avisoConsumoEstimado` sigue eliminado.** Era un campo legacy del dataset y una segunda logica
 sin contrato. La opcion actual no lo reintroduce: deriva exclusivamente de los campos
 estructurados, los dias cubiertos y `assessConsumoAnualLimits`.

Semantica de los campos en `JSON-SCHEMA.md`; pipeline del comparador en
`ARQUITECTURA-CALCULOS.md`; Paso 3.5 del simulador en `SIMULADOR-BV.md`.

### Cero Pagado Frente A Coste De Ranking En La Fila BV (Home)

- En `js/lf-render.js`, el importe "Pagas este mes" sale de `fvTotalFinal` y el de "Ranking (coste
 real)" de `totalNum`. Son magnitudes DISTINTAS a proposito (`totalPagar` vs `totalReal`, ver
 `ARQUITECTURA-CALCULOS.md`): la primera descuenta el saldo BV heredado y la segunda no, para que
 el ranking no premie a una tarifa por ahorros de meses anteriores. No lo reportes como
 incoherencia; ya se reporto y se descarto varias veces.
- El fallback de `fvTotalFinal` a `totalNum` esta escrito con comprobacion EXPLICITA de
 `null`/`undefined`/cadena vacia mas `Number.isFinite`, y NO con `||`. No es verbosidad: un 0 es un
 importe valido (BV que cubre la factura entera) y `||` lo trataba como ausencia, mostrando el
 coste de ranking como cantidad pagada. Bug real corregido el 13/08/2026; alimenta a la vez el
 tooltip, el `title` de la celda de total y los atributos `data-pagas`/`data-ranking`.
- `Number.isFinite` a secas tampoco basta: `Number(null)` es 0 y finito, asi que un `fvTotalFinal`
 nulo pasaria a mostrarse como 0,00 en lugar de caer al coste de ranking. Si "simplificas" ese
 guard, `tests/render-bv-total.test.js` debe fallar; si no falla, el test se ha roto antes.

### Invariante De `fv.bv` En "Mi Tarifa" (RESUELTA 20/08/2026)

**Fallo original.** El checkbox "Tengo bateria virtual" y el campo "Precio compensacion" son
controles independientes y contiguos. Marcando el primero y dejando el segundo vacio (o a `0`),
los productores de "Mi tarifa" emitian `fv.bv = true` junto a `fv.tipo = 'NO COMPENSA'`. Ese
objeto se interpretaba distinto en cada motor: `js/lf-calc.js` y `js/desglose-calculo.js` exigen
ademas `tipo === 'SIMPLE + BV'` y desactivaban la BV, mientras `js/bv/bv-sim-monthly.js` la
activaba solo por `fv.bv` y cobraba la cuota mensual mas su impuesto. La misma configuracion daba
importes distintos en la home y en el simulador solar.

**Alcance real.** Solo afectaba a "Mi tarifa" (tarifa introducida a mano). Las tarifas de
`tarifas.json` nunca tuvieron el estado contradictorio: verificado sobre el catalogo, las entradas
con `fv.bv === true` llevan todas compensacion (`>0` o el centinela `-1`) y `tipo = 'SIMPLE + BV'`.

**Correccion.** Normalizacion en los **tres** productores del objeto (`js/lf-tarifa-custom.js`,
`js/bv/bv-ui.js`, `js/desglose-integration.js`): `bv: <checkbox> && compensa`, con `reglaBV`
acorde. La compatibilidad de registros anteriores al checkbox BV se resuelve aparte, en la frontera
de persistencia; ver la seccion "Persistencia Y Migracion De Estado Local" mas abajo y
`ARQUITECTURA-CALCULOS.md`, seccion "Invariante de `fv.bv`".

**Descartado a proposito: validar/bloquear en la UI.** Se evaluo anadir un gate que impidiera esa
combinacion en los formularios y **se rechazo**. `js/lf-app.js` aborta el calculo COMPLETO si
`validateMiTarifa()` falla, asi que un usuario con esa combinacion ya guardada en `localStorage`
(`lf_custom_tarifa` / `bv_custom_tarifa`) habria dejado de ver el ranking entero —no solo su
tarifa— hasta corregir el campo. La solucion correcta conserva el formulario legado, lo normaliza
al reconstruir el estado economico y no bloquea el ranking. Verificado en produccion con Chrome
real durante la ronda del invariante.

**No reportar como bug**:
- Que marcar BV sin compensacion no active la bateria virtual. Es el invariante, no un fallo.
- Que `fv.precioBV` conserve su valor cuando `fv.bv` queda en `false`. Los consumidores lo
  protegen siempre tras `bv`/`hasBV`, asi que es un dato contractual latente, no un importe vivo.
- Que `bv-sim-monthly.js` use `hasBV = Boolean(tarifa?.fv?.bv)` sin comprobar `tipo`. Es correcto
  precisamente porque `fv.bv` llega normalizado.

**Para reabrirlo** hace falta demostrar un CUARTO productor de ese `fv` que no imponga la
condicion, o un consumidor que derive un importe de `fv.precioBV` sin comprobar antes la BV.

### Persistencia Y Migracion De Estado Local (RESUELTA 20/08/2026)

**`bv` ausente en "Mi tarifa" legacy.** Los registros anteriores al checkbox de bateria virtual no
tenian campo `bv`: una compensacion fija positiva implicaba BV. La home ya inferia esa semantica al
cargar, pero al volver a guardar con los campos solares desmontados trataba la ausencia como un
booleano ordinario; podia materializarse como `false` y perder para siempre la informacion legacy.
El simulador tampoco aplicaba la inferencia de forma uniforme a `bv_custom_tarifa`, al
`customTarifa` embebido en `bv_manual_data_v2` ni a respaldos antiguos.

**Correccion en la frontera de persistencia.** `js/lf-tarifa-custom.js` usa el mismo resolver al
leer y al preservar/re-escribir. `js/bv/bv-ui.js` normaliza cualquier `customTarifa`
persistido/importado antes de aplicarlo. Solo se infiere BV desde `exc > 0` cuando `bv` esta
realmente ausente/null. Un `bv:false` explicito prevalece aunque `exc` sea positivo; booleanos
antiguos serializados como string se interpretan con `LF.asBool`. Esto restaura la intencion del
formulario; despues, los tres productores del `fv` siguen imponiendo `checkbox && compensa`.

**Precedencia `bv_manual_data_v2` / `bv_manual_data`.** `bv_manual_data_v2` es la generacion actual y
`bv_manual_data` solo es fallback legacy cuando la clave v2 NO existe. Si v2 existe pero contiene
JSON invalido, una cadena vacia o un tipo incompatible, no se cae a v1: hacerlo podria resucitar un
escenario antiguo que el usuario ya habia sustituido. Se informa del problema y las claves se
dejan intactas para no destruir la unica copia recuperable.

**Fallos de almacenamiento.** El autoguardado de `lf_custom_tarifa` avisa de forma no bloqueante si
`localStorage` rechaza la escritura; el aviso se limita a una vez mientras persista el fallo y una
escritura posterior correcta rearma el aviso. El simulador sigue funcionando en memoria si no puede
acceder al almacenamiento y explica que los datos guardados no se restauraran. Un escenario v2
corrupto tampoco se borra silenciosamente.

**Metadata del escenario.** `config.customTarifa` viaja embebido en `bv_manual_data_v2` sin
`savedAt` por diseno. La existencia del boton Borrar depende de que haya datos de "Mi tarifa", no de
esa metadata; `bv_manual_data_timestamp` completa el indicador temporal. Timestamps invalidos no se
representan como fechas `NaN` y se toleran epochs numericos legacy serializados como string.

**Decision cerrada: `lf_custom_tarifa` y `bv_custom_tarifa` NO se unifican.** Aunque ambas pantallas
llamen "Mi tarifa" a su formulario, son herramientas distintas y el simulador mantiene campos y
semantica de escenario propios. La home conserva `lf_custom_tarifa`; el simulador conserva
`bv_custom_tarifa` y su copia dentro del escenario. No hay migracion cruzada ni precedencia global a
proposito. Un fallback del tipo "si falta A, cargar B" seria peligroso: la ausencia tambien puede
significar que el usuario pulso Borrar, y el fallback resucitaria datos eliminados expresamente.
Unificar exigiria una nueva clave canonica mas tombstones/semantica de borrado, sin un beneficio de
producto solicitado.

**No reportar como bugs:**
- Que `bv_manual_data` siga existiendo fisicamente junto a v2: mientras v2 exista, v1 no gana.
- Que la migracion v1 se haga en memoria y no se escriba inmediatamente: la siguiente persistencia
  normal ya usa v2.
- Que el reset del escenario no elimine `bv_custom_tarifa`: "Mi tarifa" del simulador tiene su
  propio boton de borrado, decision ya documentada.
- Que `lf_custom_tarifa` y `bv_custom_tarifa` puedan contener valores distintos: es la decision
  cerrada anterior, no una desincronizacion que deba repararse automaticamente.
- Que `pvpc_cache_v3:*` invalide generaciones de cache previas: es cache tecnica versionada, no
  configuracion del usuario.
- Que `luzfija_tarifas_v1` pueda quedar en un navegador antiguo: no tiene lector ni escritor
  productivo actual.
- `lf_err_rec_*` no pertenece a `localStorage`; la implementacion actual usa `sessionStorage`.

**Para reabrir:** demostrar un nuevo lector/escritor que interprete la ausencia de un campo legacy
como su valor falso sin aplicar la migracion correspondiente; que una clave legacy pueda ganar a su
sucesora vigente; que un fallo de escritura/restauracion vuelva a presentarse al usuario como
"guardado correctamente"; o que se adopte explicitamente una decision de producto para unificar las
dos "Mi tarifa" con una clave canonica y semantica de borrado definida.

### UI Del Simulador Solar: Estado, Ciclos De Vida Y Renderizado (RESUELTA 20/08/2026)

Esta entrada cubre `js/bv/bv-ui.js` como capa de UI. NO reabre el motor economico de
`bv-sim-monthly.js`: rotacion anual, ranking, topes, arrastre de saldo y fiscalidad siguen cerrados
por sus entradas especificas.

**Publicacion asincrona de importaciones.** CSV/XLSX y respaldos JSON son productores asincronos del
mismo grid. Antes, una lectura A podia terminar despues de una seleccion B y publicar de nuevo
fichero, tabla, procedencia o traza del contexto viejo. El mismo mecanismo permitia que un parseo
terminase despues de "Quitar archivo" o "Borrar". Ademas, CSV/XLSX publicaba nombre/fichero antes de
saber si el parseo era valido, de modo que un reemplazo invalido podia mostrar el nombre B mientras
la tabla seguia siendo A. La correccion usa generaciones separadas para importacion de fichero y
FileReader de backup, invalida productores incompatibles al sustituir/resetear y hace commit solo de
la operacion vigente y exitosa. Seleccionar CSV invalida un backup pendiente y seleccionar backup
invalida un CSV pendiente: la accion mas reciente gana. Si un CSV nuevo falla, no sustituye el
fichero activo. La rama de error tambien limpia defensivamente el `<input type=file>` no publicado;
el handler de `change` ya lo reseteaba de forma diferida, por lo que esa limpieza no se considera un
invariante independiente del arreglo.

**Autosave y reset.** El debounce de 800 ms de la tabla manual vivia dentro del listener y el reset no
podia cancelarlo. Editar una celda y pulsar Borrar antes de vencer el timer eliminaba localStorage y,
800 ms despues, el callback viejo volvia a guardar el escenario. El timer es ahora estado de modulo y
todo reset/restauracion que reemplaza contexto lo cancela antes de mutar el grid.

**Vista compartida.** `?bv=` es una previsualizacion hasta que el usuario pulsa "Guardar escenario".
El autosave ya respetaba esa frontera, pero el boton Borrar eliminaba incondicionalmente las claves
locales ocultas. En preview, Borrar limpia solo el estado visible y deja intactos
`bv_manual_data_v2`, `bv_manual_data` y `bv_manual_data_timestamp`; fuera de preview conserva el
borrado persistente historico.

**Restaurar significa sustituir (hardening).** El loader acepta payloads con meses ausentes; si uno
se aplica sobre un grid ya poblado, dejar esos indices intactos mezclaria dos escenarios y un
autosave posterior podria persistir la mezcla. El repo actual no demuestra que su exportador actual
o uno historico haya generado ese formato disperso, por lo que no se clasifica como bug confirmado.
La frontera de carga se endurece vaciando primero tabla, metadata, traza/seleccion de fichero y
trabajo pendiente, y despues aplicando el payload. Los primeros backups v2 sin `config` siguen
conservando deliberadamente la configuracion visible, tal como documenta
`normalizeImportedScenarioPayload()`; este hardening se refiere solo a la tabla mensual.

**Validacion visual tras cambios programaticos.** Restaurar valores mediante `.value = ...` no dispara
los listeners de `input`, por lo que una clase `.error` del escenario anterior podia quedar pegada a
un valor restaurado valido. `applyScenarioConfig()` y `applyCustomTarifaData()` vuelven a ejecutar la
validacion de formato, y el borrado correcto de "Mi tarifa" elimina las marcas de campos que ya no
bloquean ningun dato. Esto es coherencia de UI; Calcular ya revalidaba y no se ha cambiado el modelo
economico.

**Resultados publicados y cambios posteriores.** Un ranking ya renderizado podia seguir visible como
si fuese actual despues de editar potencia, tabla mensual, zona fiscal, mes de inicio o "Mi tarifa".
Ahora todos los productores de escenario invalidan el resultado visible y muestran un aviso
persistente para recalcular. No se inventa ese aviso antes del primer calculo: solo se considera
publicado un contenedor que la propia instancia haya puesto en `display:block`. El commit visual
diferido de 10 ms lleva generacion propia para que una edicion/reset en esa ventana no vuelva a
mostrar el ranking ni emita `lf:results-ready` de un resultado invalidado.

**Snapshot al compartir.** `shareScenario()` validaba y luego podia esperar red en
`loadTarifasBV()` antes de leer el DOM. Una edicion hecha durante ese `await` entraba en el enlace
aunque no perteneciese al estado que el usuario habia confirmado. Datos mensuales, configuracion y
texto de disclosure se congelan ahora antes del primer `await`; el sello `tarifasUpdatedAt` puede
completarse despues porque es metadata del catalogo, no una entrada del escenario.

**Traza horaria indexada.** `computeHourlyCompensation()` es asincrono. Si la curva se quitaba o
reemplazaba durante el `await`, el calculo viejo podia escribir sus `stats` en el estado de la traza
nueva/vacia incluso aunque el resultado economico acabara descartado por el guard de stale. La
escritura en `hourlyTraceState.stats` queda condicionada a la misma revision de traza capturada al
iniciar el calculo.

**Tests de regresion añadidos.** Cubren importaciones CSV/backup solapadas y cruzadas, reemplazo
invalido, reset durante parse/FileReader, autosave pendiente, borrado en preview, backup mensual
disperso, sincronizacion de `.error`, snapshot de Compartir, invalidacion del ranking por productores
distintos, la ventana de 10 ms y stats horarios que terminan tarde. Estan planteados contra
mutaciones plausibles (quitar la generacion, publicar antes del parseo, no cancelar el timer,
borrar storage sin mirar preview, no vaciar el grid, capturar despues del `await`, escribir stats sin
revision o quitar la invalidacion de un productor), no solo contra una reversion literal del bug.

**No reportar como bugs:**
- El motor `bv-sim-monthly.js` no se ha modificado en esta ronda; sus invariantes economicos siguen
  gobernados por las entradas ya cerradas.
- Los listeners de nodos reconstruidos por `innerHTML` se revisaron: la tabla manual y los resultados
  usan delegacion donde corresponde, y los nodos transitorios restantes se enlazan al crearse. No se
  encontro un listener duplicado alcanzable.
- Los timers de "Mi tarifa" que puedan vencer despues de Borrar leen el DOM ya vacio; no conservan
  una copia de los valores antiguos y por tanto no resucitan la tarifa eliminada.
- `btn-edit-manual-shortcut` no existe en el HTML productivo actual; un problema hipotetico de su
  animacion diferida no es una ruta de UI alcanzable.

**Para reabrir:** demostrar un nuevo productor asincrono que pueda publicar estado despues de haber
sido sustituido/resetado; un nuevo timer/debounce no cancelado que conserve y reinyecte estado viejo;
un reset que limpie solo parte de los estados auxiliares; un cambio de entrada que deje visible como
actual un ranking calculado con valores anteriores; o una restauracion programatica que deje
validacion visual contradictoria con el valor efectivo.

### Ranking Del Simulador Solar/BV

- El filtro de limites de consumo (arriba) solo retira candidatas; NO altera el criterio de orden.
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

### Redondeo Exacto De Impuestos Indirectos Y Paridad Entre Motores (RESUELTA 16/08/2026)

**Fallo original reproducido.** Con la tarifa real `CHC VE 3P`, P1 contratada `0 kW`, P2
`6,37 kW`, 30 dias de septiembre de 2026, consumos `208,37/122,73/95,27 kWh`, excedentes
`4,99 kWh`, Canarias no-vivienda, sin BV ni bono social, la home daba `106,43 EUR`, el simulador
BV `106,44 EUR` y el desglose `106,43 EUR`. Era observable: el simulador muestra directamente su
total mensual. Home y modal permanecian alineados en ese caso.

**Causa completa.** Los conceptos monetarios formaban una base decimal conceptual de `97,51 EUR`,
pero home/desglose conservaban la aproximacion binaria `97.50999999999999`; BV normalizaba antes
esa suma. Al sumar `4,99 EUR` de IEE y aplicar IGIC del 3%, las rutas caian a lados distintos de la
frontera `3,075 EUR`. La investigacion adversarial demostro ademas que normalizar solo `sumaBase` no
resolvia el contrato general: un producto como `142,50 x 3%` puede evaluarse como
`4.2749999999999995`, y el `round2()` generico puede devolver `4,27` aunque el resultado decimal
correcto sea `4,28`. Por eso BV tampoco era una referencia universalmente correcta; se encontraron
casos reales en los que home acertaba y BV quedaba un centimo por debajo.

**Alternativas descartadas.** Se midieron por separado (A) `round2(sumaBase)` en home/desglose y
(B) redondear solo la base de la rama IGIC. Ambas alineaban la reproduccion inicial, pero dejaban
303 resultados fiscalmente incorrectos en una busqueda dirigida de 500.000 combinaciones de
Canarias no-vivienda. La coincidencia entre motores ocultaba esos errores; no era prueba de
exactitud.

**Correccion aplicada.** `calcularImpuestoIndirecto()` en `js/lf-config.js` normaliza la base
monetaria a centimos y aplica los tipos de IVA, IGIC e IPSI mediante enteros (centimos y puntos
basicos), con redondeo hacia arriba en medios centimos positivos. No se cambiaron `sumaBase`, IEE,
topes de compensacion, cuota BV ni la semantica temporal de SSAA. El desglose sigue usando su ajuste
visual de sublineas exclusivamente para presentacion; ese helper no decide el impuesto.

**Alcance medido antes de elegir la correccion:**

- Busqueda dirigida, 500.000 combinaciones de centimos con tarifas reales y Canarias no-vivienda:
  332 divergencias home/BV; frente a la referencia decimal exacta, home fallo en 539 resultados y
  BV en 303. Las alternativas A/B conservaron 303 fallos; la correccion fiscal comun, 0.
- Barridos independientes de 125.000 casos en Peninsula/Baleares, Canarias no-vivienda y
  Ceuta/Melilla, mas 62.415 casos canarios que cumplian el supuesto de vivienda al 0%: antes del
  arreglo home y BV fallaron 240 veces cada uno en Peninsula/Baleares, 143 y 99 respectivamente en
  Canarias no-vivienda, y 5 veces cada uno en Ceuta/Melilla. Canarias vivienda no presento esta
  clase de error. La correccion comun dio 0 en todas las ramas.
- Matriz estructurada de 1.296 escenarios y 118 tarifas (`152.928` resultados): 0 divergencias
  home/modal antes y despues. Matriz PVPC separada de 144 combinaciones: 0 divergencias home/modal.
- Barrido de ranking de 20.000 escenarios con las 118 tarifas: cambiaron 3.396 importes en 2.785
  escenarios, siempre como maximo `0,01 EUR`; hubo 6 cambios de posicion en 2 escenarios y 4
  relaciones de orden afectadas por empates/desempates. No se observo una inversion estricta de
  menor a mayor. El ranking resultante sigue usando sus criterios documentados.

**Regresion y mutacion.** `tests/fiscal-rounding-align.test.js` fija el caso `CHC VE 3P` en
`106,44 EUR` para home, BV y desglose, y las fronteras exactas de IVA (`21,50 x 21%`), IGIC
(`68,50 x 3%`) e IPSI (`401,50 x 1%`). La regresion fallo antes del arreglo, paso despues y volvio a
fallar al sustituir deliberadamente la aritmetica exacta por la multiplicacion flotante anterior.
Restaurado el arreglo, pasaron lint y la suite completa en Node 22: 93 ficheros, 1.445 tests.

**No confundir con no-paridades deliberadas.** El prorrateo de la cuota BV y la seleccion temporal
de SSAA entre home y simulador conservan sus contratos propios; no se tocaron ni son evidencia de
esta regresion.

**Fallbacks residuales.** En la carga productiva normal, todos los motores delegan el impuesto
indirecto en `LF_CONFIG`. `js/lf-utils.js` y `js/bv/bv-sim-monthly.js` conservan ramas defensivas con
la antigua multiplicacion flotante si falta `calcularImpuestoIndirecto()`. El HTML carga
`lf-config.js` antes de ambos consumidores y no se ha demostrado una ruta valida que permita seguir
hasta mostrar un importe calculado por esos fallbacks. No los uses como referencia matematica ni
los eleves a bug economico sin atravesar recuperacion/bootstrap y demostrar el resultado visible.

**Para reabrirlo** hace falta demostrar una entrada valida que atraviese el helper fiscal comun y
difiera de una referencia decimal exacta, un nuevo tipo que no pueda representarse con los puntos
basicos admitidos por el helper, una nueva ruta independiente que calcule IVA/IGIC/IPSI por su
cuenta, o que uno de los fallbacks conocidos sea alcanzable hasta un importe visible desde una
carga productiva valida.

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
- Desde agosto de 2026, `init-incompleto` y los fallos tempranos de scripts
 activan ademas una recuperacion funcional: comprobacion forzada del SW,
 comparacion de build por `GET_VERSION`, aviso persistente y un unico reintento
 automatico si fallo un script inicial antes de cualquier interaccion. El
 guard de `sessionStorage` impide un segundo reload fallido y conserva la
 recarga explicita. No confundas esa cola efimera
 `{ app, dependency, build, phase }` con el
 outbox de GoatCounter ni la reportes como persistencia de datos del usuario.
- `tarifas.json` sigue siendo network-only. El fallback de disponibilidad usa
 exclusivamente `baseTarifasCache` descargado en memoria durante la misma
 carga de pagina, tras dos intentos de red; no revive precios de disco ni cambia
 la politica del service worker.
- El timeout de `lf-cache.js` cubre tambien la lectura de `response.json()`. Si
 el abort aflora durante el cuerpo se etiqueta `timeout`; no lo reclasifiques
 como `json-parse`. Un JSON sintacticamente valido pero inservible es
 `json-invalid` y no se reintenta porque el resultado es determinista.
- Desde el 13/08/2026 `json-invalid` cubre tres casos, no solo el array vacio: (a) un root que no
 es el objeto esperado (`null`, escalares, array raiz, objeto sin `tarifas`, `tarifas` que no es
 array), (b) `tarifas` vacio, y (c) `tarifas` con alguna entrada estructuralmente inutilizable
 segun `esTarifaUtilizable` (nombre no vacio, `tipo` 1P/3P y `p1`/`p2`/`cPunta`/`cLlano`/`cValle`
 numericos finitos). El criterio es de ESTRUCTURA, no comercial: un precio 0 es valido (`p2` puede
 valer 0 por contrato) y no se comprueba ningun rango. La validacion es ATOMICA a proposito: una
 sola fila rota descarta el dataset entero y conserva la copia sana en memoria. No propongas
 filtrar las filas defectuosas y quedarse con el resto: dejaria un ranking incompleto sin que el
 usuario pueda saberlo.
- Las validaciones E2E del 22/07/2026 generaron trafico sintetico en ambas familias. Ventanas CONFIRMADAS: `09:00Z` (build `20260722-091724`) y `11:00Z` (build `20260722-103502`). El primer export mostraba 73 hits y cero eventos de error en `12:00Z`; el siguiente (`2026-07-22T14:53:53Z`) completo la agregacion hasta 83 hits y siguio con cero `error-*` y cero `init-incompleto/*`. La auditoria anunciada en esa hora no dejo senales de diagnostico y `12:00Z` no debe excluirse como ventana sintetica de esas familias. Moraleja practica: verifica en que cubos aparecen realmente los eventos; no heredes una ventana declarada ni des por contaminado todo el build.
- La normalizacion de errores acepta exclusivamente fuentes same-origin con protocolo HTTP(S). `tracking.js` (`sameOriginHttpSource`) y el buffer de `error-bootstrap.js` rechazan `blob:`, `data:` y protocolos distintos aunque aparenten compartir origen; `tests/error-bootstrap.test.js` cubre expresamente el caso `blob:`. Reporta cualquier regresion de este contrato como bug de cardinalidad/privacidad, no como hardening futuro.
- Verificado el 22/07/2026 contra produccion con Chrome real: caminos felices de home/solar/observatorio, diez bloqueos individuales de scripts y offline cortando tambien la red del target del Service Worker. `tracking.js` se recupero desde Cache Storage; no hubo excepciones JS ni violaciones CSP.

### Formato Numerico: Coma En UI, Punto En Mocks De Tests

- Toda cifra visible usa coma decimal (helpers `formatMoney`, `fmtNum`, `numComa`, `toComma`, `fmtPrecio` segun modulo). Un punto decimal visible para el usuario seria un bug real (se corrigio el ultimo caso en `lf-render.js` el 14/07/2026).
- OJO con los tests: `tests/render-ui.test.js` mockea `formatMoney` como `n + ' EUR'` sin conversion a coma; los importes con punto en los asserts de tests son artefacto del mock, no reflejo de la UI real. No reportes "la UI muestra punto decimal" citando un assert de tests como evidencia.
- `tests/render-bv-total.test.js` hace lo contrario A PROPOSITO: replica el `formatMoney` real (dos
 decimales y coma) porque comprueba el importe tal y como lo ve el usuario cuando la BV cubre la
 factura entera. Ojo al motivo exacto: el mock simplificado del otro fichero SI distingue un valor
 de otro; lo que no puede es reproducir el formato de dos decimales con coma, que es justo lo que
 ahi se asevera. Los dos mocks conviven por diseno; no los unifiques por coherencia.
- Notacion de este documento: es ASCII y translitera el simbolo del euro como `EUR`. En el codigo y
 en los asserts reales aparece el simbolo, asi que no copies estas cadenas literalmente para
 grepear el repo.

### Numeros Con Punto De Miles, Validador Asimetrico Y Bypass De `safeUrl` (RESUELTA)

**Historial del finding, conservado como conocimiento util:**

- Auditoria externa (entregada como ZIP con los ficheros ya corregidos, sin acceso directo al repo) reporto 4 problemas en `js/lf-utils.js` e `index.html`. Verificado linea por linea contra el codigo real antes de aplicar nada; los 4 eran reales:
 1. **`formatValueForDisplay()` corrompia valores con punto de miles al perder el foco.** Convertia el PRIMER punto de cualquier string a coma sin distinguir "punto de miles" de "punto decimal". `parseNum('1.234')` = 1234 (miles), pero `formatValueForDisplay('1.234')` devolvia `'1,234'`, que `parseNum` reinterpreta como 1,234 (decimal) — el valor cambiaba de 1234 a 1,234 en un solo ciclo de formateo. Con `'1.234.567'` era peor: `'1,234.567'` se reinterpretaba como 1234,567 en vez de 1234567. Afectaba a los campos del comparador principal y "Mi tarifa" en blur/carga de valores guardados (`js/lf-app.js:462`, `js/lf-inputs.js:427/454`, `js/lf-tarifa-custom.js:153`).
 2. **`esNumericoValido()` tenia una asimetria real entre punto y coma.** Con coma, el limite `maxDecimales` SI se aplicaba; con punto, NO se aplicaba en absoluto (no habia ninguna rama que comprobara la longitud de la parte decimal cuando el separador era un punto sin coma). `esNumericoValido('0.123456789', 8)` devolvia `true` (9 decimales colandose con limite 8) mientras que `esNumericoValido('0,123456789', 8)` correctamente devolvia `false`. Ademas aceptaba formatos multi-punto mal agrupados (`'1.2.3'`, `'12.34.567'`, `'1..234'`) que despues `parseNum` reinterpretaba con un valor distinto al validado (`'1.2.3'` validaba OK pero `parseNum` lo convertia en 12.3). Esta asimetria ya estaba documentada como conocida en una version anterior de este fichero.
 3. **Bypass real de `safeUrl()`.** El filtro aceptaba cualquier cadena que empezara por `/` (no `//`) y la devolvia SIN pasar por el parser `URL()`. Una cadena como `/\evil.com` supera ese filtro tal cual, y el parser WHATWG de esquemas "especiales" (http/https) normaliza la barra invertida como si fuera una barra normal al resolverla en un navegador real — `/\evil.com` puede acabar resolviendose como `//evil.com`, es decir, origen cruzado. Lo mismo con controles ASCII como TAB insertado tras el primer `/`. Superficie de explotacion actual baja (los enlaces de tarifas vienen del dataset controlado del proyecto), pero el contrato de la funcion era incorrecto y reproduciblemente evadible.
 4. **Placeholder desincronizado con el limite real.** `index.html` decia `placeholder="1 a 365"` en el campo "Dias factura", mientras `clamp01to365Days()` (pese al nombre) clampa a 370, igual que el importador CSV y la documentacion funcional. Solo cosmetico/UI, sin impacto en calculo.

**Correccion aplicada el 15/08/2026 (`js/lf-utils.js`, `index.html`):**

- `formatValueForDisplay` ahora solo convierte el punto a coma cuando es inequivocamente decimal: si el string entero cumple el patron estricto de miles con punto (`\d{1,3}(\.\d{3})+`, excluyendo el caso `0.xxx` que siempre es decimal) lo deja intacto; si tiene mas de un punto sin cumplir ese patron, tambien lo deja intacto (para que `esNumericoValido` lo rechace en vez de "arreglarlo" visualmente). Verificado el roundtrip `parseNum(formatValueForDisplay(x)) === parseNum(x)` para miles con punto, miles con espacio y decimales con punto.
- `esNumericoValido` se reescribio para aplicar la MISMA logica de `maxDecimales` independientemente de si el separador decimal es coma o punto, y para rechazar cualquier formato con mas de un punto que no sea estrictamente una agrupacion de miles (grupos completos de 3 digitos). Verificado a mano: `'1.2.3'`, `'12.34.567'`, `'1..234'`, `'0.123456789'` (limite 8) ahora rechazan; `'0.12345678'` (limite 8, borde exacto) sigue aceptando; `'1.234'`, `'1.234.567'`, `'1.234,56'` (miles+decimal combinados) siguen aceptando igual que antes.
- `safeUrl` bloquea explicitamente controles ASCII (`\u0000`-`\u001F`, `\u007F`) y backslash ANTES de aceptar una ruta relativa (`js/lf-utils.js:692`, con `eslint-disable-next-line no-control-regex` justificado porque la deteccion de esos controles es el proposito deliberado de la linea).
- `index.html:382` cambiado a `placeholder="1 a 370"`.
- Regresiones anadidas en `tests/utils.test.js` (formatValueForDisplay, esNumericoValido, safeUrl) y `tests/custom-tarifa.test.js` (limite de 8 decimales tambien con punto). Suite completa 1336/1337 tras aplicar (unico fallo: `tests/csp-inline-hash.test.js`, consecuencia ESPERADA de tocar `index.html` — el hook `pretest` bump-ea `dateModified` del JSON-LD a la fecha del dia, cambiando su hash inline; el `.bat` de deploy lo recalcula solo, no es un defecto del fix). Lint `eslint js` en 0 errores.
- Revision de call sites existentes de `esNumericoValido` (`js/lf-inputs.js`, `js/lf-tarifa-custom.js`, `js/bv/bv-ui.js`) para descartar regresion: el caso mas sensible, `esNumericoValido(diasRaw, 0)` (0 decimales), mejora con el fix — antes aceptaba `'30.5'` como valido (colandose como 305 dias tras `parseNum`), ahora lo rechaza correctamente, igual que ya rechazaba `'30,5'`.

**Mecanica del ciclo (relevante para futuras auditorias externas):** informe en texto + ZIP con los ficheros ya corregidos (la auditoria externa no tiene acceso directo al repo, solo a un ZIP descargado por el usuario). Al integrarla se verifica cada hallazgo contra el codigo real ANTES de mirar el ZIP, se diffea cada fichero del ZIP contra su version en el repo para confirmar que el cambio es exactamente el descrito y sin efectos colaterales, se aplica y se corren la suite y el lint completos, que la auditoria externa no suele poder ejecutar en su entorno.


### Dominio 2.0TD Y Validacion De Factura PDF (RESUELTA)

Auditoria externa de cierre sobre el ZIP de produccion ya desplegado. Solo se registran aqui
fallos reproducibles; las pistas descartadas se conservan en el informe de la auditoria, no como bugs.

- **Limite de potencia fuera del dominio 2.0TD.** `LF_CONFIG.POTENCIA_MAX_KW` estaba en 20 kW y
 los formularios de home, factura PDF y simulador solar usaban ese valor. Sin embargo todo el
 comparador trabaja con estructura 2.0TD (dos periodos de potencia y tres de energia), cuyo ambito
 es baja tension con potencia contratada <=15 kW en todos los periodos. Una entrada de 15,01-20 kW
 podia por tanto recibir un ranking calculado con estructura regulatoria que no le corresponde.
 Corregido centralmente a 15 kW en `js/lf-config.js` y los fallbacks defensivos de
 `js/lf-inputs.js`, `js/factura.js` y `js/bv/bv-ui.js`.
- **Factura PDF bloqueaba 367-370 dias.** El formulario principal y los importadores aceptan hasta
 370 dias, pero `__LF_applyValues()` rechazaba cualquier `dias > 366`. Corregido a 370 y cubierto
 por regresion en `tests/factura-integration.test.js`.
- **Factura PDF imponia un suelo aislado de 0,5 kW.** El modal rechazaba potencias positivas
 inferiores a 0,5 kW mediante `POTENCIA_MIN_KW`, aunque el formulario principal y el simulador
 solo exigen potencia positiva. Ese suelo no formaba parte del contrato funcional y excluia
 valores bajos que el propio formulario admite. Se elimina el suelo aislado y el modal comparte
 ahora la regla `> 0` con la home; el limite superior sigue centralizado.
- **Higiene de la documentacion de auditoria.** La descripcion del regex de `safeUrl` contenia bytes
 de control reales (incluido NUL), por lo que herramientas como ripgrep trataban este Markdown
 como binario. Se sustituyeron por escapes de texto `\u0000`-`\u001F`/`\u007F`. Tambien se corrigio
 una nota historica que seguia diciendo que `esNumericoValido()` aceptaba multi-punto pese a que
 el propio documento registra su correccion posterior.
- **Comentario de test QR CNMC.** Se corrigio el comentario que llamaba inclusivo al inicio `iniF`.
 La semantica oficial vigente es inicio no incluido y fin incluido; el comportamiento del parser
 ya era correcto y no se modifico.

Regresiones anadidas: borde 15/15,01 kW en `tests/inputs.test.js`; aplicacion de factura con 370 dias,
potencias 0,1/0,4 kW y rechazo de >15 kW en `tests/factura-integration.test.js`.

### Rendimiento De Renderizado

Esta revision se hizo sobre el DOM y CSS reales del repo cargados en Chromium sin red,
porque el entorno de auditoria bloquea la navegacion a `localhost`/`file://`. Las
mediciones son de laboratorio y sirven como A/B causal dentro del mismo navegador; no
sustituyen CrUX ni permiten extrapolar milisegundos absolutos a todos los equipos.

- **Tarjetas grandes (`.card`) y `backdrop-filter: blur(24px)`.** En escritorio el blur
 estaba activo sobre tarjetas grandes mientras el fondo fijo permanecia detras. En un
 recorrido de scroll real sobre `body` (1366x768, 60 frames ida/vuelta, tres pasadas),
 la version previa tuvo mediana de frame de ~17,24 ms, maximo ~33,4 ms y 1-3 frames
 por pasada por encima de 20/33 ms. Quitando solo el blur de `.card`, el mismo harness
 quedo en ~16,67 ms, p95 ~16,8 ms y 0 frames >20 ms en las tres pasadas. El tiempo
 agregado `RunTask` de la traza bajo de ~955 ms a ~408-417 ms de mediana. El blur de
 botones/pills no explicaba por si solo el problema. La captura A/B estatica mostro
 una diferencia media de ~0,22 niveles RGB por canal (p95 1/255), por lo que se
 conserva el fondo translucido, borde y sombras pero se elimina el blur de la tarjeta.
- **`body::before` no era la causa principal.** Aunque es una capa fija grande con
 gradientes, quitarla sin tocar el blur de la tarjeta siguio dejando frames de ~33 ms
 y ademas cambio la estrategia de rasterizado de Chromium. No se elimina: el hallazgo
 reproducible era la combinacion de tarjeta grande con backdrop blur, no una supuesta
 animacion de aurora (la animacion del fondo sigue en `none`).
- **Observatorio: KPI con `box-shadow` infinito.** El primer KPI mantenia
 `obs-goldenPulse` para siempre. Una traza de 3 s en reposo registro unas 180
 actualizaciones de estilo y ~124 ms de `RunTask`; sustituyendo el pulso por la misma
 sombra dorada estatica, las actualizaciones continuas desaparecieron y `RunTask`
 bajo a ~14-16 ms en el mismo harness. Se conserva la animacion unica de entrada
 `obs-fadeInUp` y el destacado visual, pero no trabajo permanente en idle.

Regresiones estaticas: `tests/performance-css.test.js` impide reintroducir el blur de
24 px de `.card` y el pulso infinito `obs-goldenPulse`.

### Ceros Validamente Contratados, Integracion Por Lineas Y Rango De Dias (RESUELTA)

Auditoria externa posterior a la ronda de rendimiento. Los hallazgos se reprodujeron contra las
funciones publicas de produccion antes de modificar el codigo. La regla regulatoria que origina la
primera familia de casos esta documentada por la CNMC: para un segundo punto de suministro de
recarga de vehiculo electrico puede contratarse **0 kW en punta (P1)** y una potencia positiva en
valle. Se mantiene deliberadamente P2 > 0 porque esta auditoria no encontro una base equivalente
para generalizar tambien P2=0 kW.

- **Home y simulador solar rechazaban P1=0 kW.** `js/lf-inputs.js` y `js/bv/bv-ui.js` exigian
 `P1 > 0` individualmente. Se cambia el contrato a `P1 >= 0`, `P2 > 0` y ambos <=15 kW. El motor
 de calculo ya soportaba P1=0 por multiplicacion directa; el bloqueo estaba en la UI.
- **El modal de factura tambien rechazaba P1=0 kW.** `js/factura.js::__LF_applyValues()` seguia
 exigiendo `v.p1 > 0`. Ahora permite 0 en P1 con el mismo limite superior 2.0TD y mantiene P2
 estrictamente positiva.
- **Varios extractores PDF descartaban el cero correcto y podian capturar un consumo como
 potencia.** DISA, TotalEnergies, Imagina, Octopus, Plenitude y el fallback generico filtraban P1
 con minimos estrictamente positivos. En una reproduccion minima con `P1: 0 kW`, `P2: 7,4 kW`
 y despues `Punta 10 kWh`, el parser podia acabar devolviendo **P1=10 kW**. Se acepta 0 solo en
 patrones de potencia suficientemente acotados (`kW`, nunca `kWh`) y se mantienen los demas
 filtros/rangos. Tambien se cubren las variantes genericas `P1: 0 kW` y `Potencia P1: 0 kW`.
- **Endesa/Energia XXI: extractor correcto aislado pero inutilizado por texto compactado.**
 `__LF_extractPotenciasEndesa()` depende de saltos de linea para el formato de detalle
 `Pot. Punta-Llano X kW` seguido de `Pot. Valle Y kW`, pero `__LF_parsearDatos()` le entregaba
 exclusivamente `tAll`, que ya habia eliminado esos saltos. Con `Pot. Punta-Llano 0 kW`,
 `Pot. Valle 7,400 kW` y `Punta 10 kWh`, produccion devolvia P1=10. Ahora Endesa/Energia XXI
 prueban primero `textLines` y conservan `tAll` como fallback para formatos de una sola linea.
- **Octopus multi-periodo: el helper de suma perdia la estructura que necesitaba.**
 `__LF_extractConsumoOctopus()` busca `Punta/Llano/Valle` a inicio de linea para sumar varios
 bloques, pero el parser publico le pasaba el texto compactado. Un ejemplo 18,15+16,85 kWh
 devolvia solo 18,15. Ahora se usa primero `textLines`; la ruta publica devuelve 35/28/56 en el
 fixture de regresion.
- **Octopus deduplicaba bloques distintos por igualdad numerica.** El helper mantenia un `Set`
 de valores, por lo que dos bloques legitimos de 10 kWh se contaban una sola vez. Se elimina la
 deduplicacion por valor: cada linea facturada es una observacion independiente.
- **Octopus multi-periodo fallaba si un periodo era 0 kWh en todos los bloques.** La suma solo
 marcaba coincidencias para valores `>0`, de modo que `Punta 0 + 0`, `Llano 10 + 5`,
 `Valle 20 + 10` anulaba el helper multi-periodo y el fallback se quedaba con el primer bloque
 (0/10/20). Ahora 0 es una coincidencia valida y la ruta publica devuelve 0/15/30.
- **El parser PDF seguia limitado internamente a 200 dias aunque la aplicacion acepta 370.** Los
 extractores por compania y el fallback de dias llamaban a `__LF_extraerNumero(..., 1, 200)`.
 En reproducciones publicas, `201 dias`, `365 dias` y `370 dias` no solo se descartaban: un patron
 posterior demasiado permisivo podia capturar el `1` de `P1` y devolver **1 dia**, alterando el
 prorrateo completo. Se centraliza `FACTURA_MAX_DIAS = 370` y se usa en todos los extractores de
 dias.
- **Un valor explicitamente fuera de rango tambien podia degradarse a otro numero.** El patron
 `dias ... <numero dentro de 30 caracteres>` podia saltar desde `371 dias` hasta `P1` y producir
 1 dia. Se restringe a formatos reales `Dias: 31` / `Dias 31`; `371 dias` queda como `null` para
 que el usuario lo corrija, nunca convertido silenciosamente en otro campo.
- **"Mi tarifa" rechazaba `p2=0 EUR/kW dia` pese a que el contrato interno lo permite.** Esto es
 un precio de potencia de una tarifa personalizada, no potencia contratada. `tarifas.json` y los
 tests de cache permiten P2 de precio igual a cero; el simulador solar ya distinguia cero de
 vacio. `js/lf-tarifa-custom.js` conserva P1 de precio estrictamente positivo pero deja de marcar
 `mtP2=0` como error.

Regresiones anadidas en `tests/inputs.test.js`, `tests/factura-integration.test.js`,
`tests/custom-tarifa.test.js`, `tests/parsers.test.js` y `tests/bv-ui-zona-grid.test.js`. Las pruebas
nuevas de parser llaman a `window.__LF_FacturaParsers` real: no replican regex dentro del test.

**HALLAZGO RECHAZADO EN LA VERIFICACION (no aplicar, no re-reportar): quitar el `+1` de
`__LF_daysInclusive()`.** La auditoria propuso ademas cambiar `Math.floor(ms/86400000) + 1` por la
diferencia pura, citando la regla CNMC de "lectura inicial excluida, final incluida", y reescribio
cuatro expectativas de test para encajar (junio entero pasaba a 29 dias, 01/01-31/01 a 30, y un
periodo de un solo dia pasaba a `null`). Es una REGRESION y se descarto con esta evidencia:

1. Ese helper NO recibe fechas de lectura de contador. Sus unicas entradas son `fIni`/`fFin`,
 capturadas por `reRango` (`(?:del|desde) FECHA (?:al|hasta|a) FECHA`) y `reRango2`
 (`(?:periodo|facturacion) ... FECHA - FECHA`) en `__LF_parsearDatos()`. Es el rango de
 facturacion en lenguaje natural, que en castellano incluye ambos extremos: "del 1 al 30 de
 junio" son 30 dias, no 29.
2. La semantica CNMC que cita SI esta implementada, pero en OTRA ruta: el parser del QR
 (`iniF`/`finF`) calcula `Math.floor((fin - inicio)/86400000)` SIN `+1`, unas lineas mas abajo.
 Las dos rutas conviven a proposito con semanticas distintas y ambas son correctas. La propia
 auditoria anterior (misma IA, 15/08/2026) habia corregido justo el comentario que documenta esa
 diferencia; aqui la generalizo indebidamente a la ruta de texto.
3. Revierte una correccion deliberada del 09/07/2026, donde otra auditoria detecto que este helper
 restaba un dia y se anadio el `+1`, actualizando dos tests de 30 a 31 como valor correcto.
4. Impacto de haberlo aceptado: toda factura cuyos dias se resuelvan por esta via (fallback cuando
 no se encuentra un "X dias" explicito) infravaloraria el periodo en 1 dia, y los dias alimentan
 los costes fijos (potencia y alquiler de contador) de TODAS las tarifas comparadas. Ademas un
 periodo de un solo dia pasaba a rechazarse como invalido.

Para reabrirlo haria falta evidencia de que `reRango`/`reRango2` capturan fechas de LECTURA y no el
rango de facturacion; el `+1` lleva un comentario en el codigo con este mismo razonamiento.

**Falsos positivos descartados durante la misma auditoria:** `data.p2 || ''` en la restauracion de
"Mi tarifa" no pierde el cero porque `saveCustomTarifaMain()` persiste los inputs como strings y
`"0"` es truthy; tampoco `if (!p1)` del QR CNMC descarta `pP1=0`, porque `URLSearchParams.get()`
devuelve la cadena `"0"`. Ambos flujos se ejecutaron completos antes de decidir no modificarlos.

### Extractor De Factura PDF: Separacion Dimensional (kW, kWh, EUR, Dias)

La familia de fallo mas trabajada del proyecto: una magnitud tomada como otra. Todas estas rutas
estan corregidas y cubiertas por regresiones en `tests/parsers.test.js`. **No re-reportes ninguna sin
una entrada concreta que el guard actual no cubra.**

- Un precio de potencia (`Termino de potencia P1 0,15 EUR/kW dia`) no puede convertirse en potencia
 contratada, ni un precio de energia (`Energia activa P1 0,15 EUR/kWh`) en consumo. Los patrones sin
 unidad rechazan contextos de precio (`EUR`, simbolo de euro, `/kW`, `/kWh`).
- Un valor decimal no puede esquivar el guard por backtracking: `Punta 10,5 kWh` no da P1=10 kW. El
 token numerico no puede terminar justo antes de `,` o `.`.
- Los nueve guards de CONSUMO excluyen tambien `kw\b`, porque al compactar el documento un encabezado
 de seccion pegado al bloque de potencia hacia leer los kW contratados como kWh consumidos. **Los
 guards de POTENCIA no llevan esa exclusion**: ahi un valor en kW es justo lo que se busca. Detalle
 que hace seguro el cambio: `kw\b` no casa `kWh`, porque tras la `w` viene una `h` y no hay limite
 de palabra.
- En una fila con cantidad, precio e importe (`P1 100 kWh 0,15 EUR/kWh 15,00 EUR`) gana la cantidad
 seguida de `kWh`, no el importe.
- Los digitos de las propias etiquetas no son datos: `Energia (kWh) P1 P2 P3 100 200 300` da
 100/200/300, y la variante con cabecera y valores en lineas distintas tambien. Una fila solo se
 interpreta como fila Endesa si contiene exactamente una etiqueta de periodo.
- Al compactar lineas, los patrones amplios de potencia trabajan solo sobre texto estructurado por
 lineas; los formatos locales `P1: valor` pueden usar texto compacto. Sin esto, `Potencia contratada
 3,45 kW / ... / Punta 100 kWh` devolvia `p1=5` cruzando campos de lineas distintas.
- Los patrones `P1 ... kWh ... valor` se acotan al segmento anterior a la siguiente etiqueta de
 periodo y no aceptan dias, precios ni importes.
- Produccion, generacion, autoconsumo, vertido, inyeccion, exportacion y excedente **no son consumo
 de red** y se excluyen localmente de los fallbacks de consumo.
- El techo por periodo de la tabla Endesa esta alineado con el maximo general del parser
 (2.000.000 kWh). Un techo local mas bajo hacia que consumos de 6.000-8.000 kWh se descartaran y el
 parser retrocediera hasta un `0,00`, fabricando consumo cero.

**Decision firme sobre el fallback compacto de `__LF_extractTripleConsumo()`: se conserva.** Se
propuso desactivarlo cuando el documento conserva saltos de linea, por miedo a que compactar alinee
datos de lineas distintas. Ese riesgo ya lo neutralizan los guards anteriores, y desactivarlo rompia
un formato real y frecuente: etiquetas y valores en lineas alternas (`Punta\n100\nLlano\n200\nValle\n300`),
que pasaba de 100/200/300 a no detectar nada. Para reabrirlo haria falta un caso real que los guards
actuales no cubran Y que no sacrifique ese formato.

### Extractor De Factura PDF: Lecturas De Contador Frente A Consumo Facturado

Las lecturas acumuladas del contador no son consumo del periodo. Se priorizan las secciones
explicitas de consumo/energia facturada; si solo hay contexto de lecturas, el fallback individual no
degrada esos acumulados a consumo.

**El guard exige PLURAL y articulo obligatorio, y esto es deliberado:**

```
\blecturas\s+(?:del\s+|de\s+la\s+)(?:contador|distribuidora)\b
```

**No ampliarlo a `lecturas?` ni hacer opcional el articulo.** Dos versiones mas anchas rompieron
facturas reales:

- `lectura\s+(actual|anterior)` aparece de pasada en casi cualquier factura española y desactivaba la
 extraccion de consumos del documento ENTERO. Una factura con `Lectura anterior: 15/01/2026` pasaba
 de 100/200/300 a `null/null/null`.
- Con articulo opcional y singular, la frase `Consumo Ajuste lectura distribuidora` de una factura
 DISA real casaba el guard y la factura dejaba de extraer consumos: perdia 346/310/313 al 100% de
 confianza y devolvia los tres vacios al 50%. `Ajuste lectura distribuidora` NO es el encabezado de
 una tabla de lecturas.

Casos que deben cumplirse a la vez: solo lecturas -> `null` (protegido); lecturas + `Consumo
facturado` -> gana el consumo; mencion suelta de lectura anterior -> consumos intactos. Tambien se
cubren la fila `Lectura en Pn` + `Consumo en Pn` (gana la etiqueta explicita de consumo), las filas
locales de lectura sin encabezado global, y la tabla `Desde/Hasta/Lectura anterior/Lectura
actual/Ajuste/Consumo`, donde el dia de una fecha (`13/09/2023`) llegaba a tomarse como 13 kWh y
13 kW a la vez.

Una ruta activada por `Consumo total` podia atravesar despues el encabezado de lecturas: la seccion
generica se corta ahi. El total se conserva solo como `consumoTotalDetectado`, nunca como sustituto
inventado del reparto por periodos.

### Extractor De Factura PDF: Potencia Contratada Frente A Maximas Demandadas

Son magnitudes distintas, y la especificacion del QR CNMC tambien las separa (`pP1/pP2` frente a
`pmaxP1/pmaxP2`). Si no hay potencia contractual reconocible, aparece explicitamente
`potencia(s) maxima(s) demandada(s)` y no hay bloque de potencia contratada, P1/P2 quedan vacios en
lugar de adoptar los maximos.

`__LF_extractContractPowerPair()` recupera la potencia real cuando esta bajo encabezados
contractuales inequivocos (`Potencia contratada`, `Datos del contrato`, `Condiciones del contrato`,
`Datos del suministro`) y corta la seccion al empezar `Potencias maximas demandadas`. Un encabezado
contractual vacio no legitima los maximos que vengan despues. Los extractores especificos de
compania que corrian antes del fallback generico usan tambien esa seccion acotada.

**Limitacion conocida, no es un bug:** si la potencia real viene bajo un encabezado no contemplado y
convive con maximas demandadas, el resultado es `null` en vez del valor. Es fail-closed y preferible
a devolver un dato falso; es una mejora incompleta, no un retroceso.

### QR CNMC: Confianza, Validacion Y PDF Multi-Factura

El QR de la CNMC es la fuente de mayor confianza del extractor, asi que su validacion es estricta.
`__LF_isTrustedCnmcQrUrl()` exige `https:`, hostname exacto `comparador.cnmc.gob.es` y ruta exacta
`/comparador/QRE`. Un host parecido (`comparador.cnmc.gob.es.ejemplo.com`) o una ruta distinta se
rechazan. Antes de otorgar confianza 100, P1/P2 y los tres consumos deben ser numericos finitos y
cumplir rangos basicos.

- Las unidades se validan dimensionalmente: P1/P2 admiten numero desnudo o sufijo `kW`; cfP1/cfP2/cfP3
 numero desnudo o sufijo `kWh`. Un sufijo de dimension distinta o texto residual invalida el QR.
- Los nombres de parametro se tratan sin distinguir mayusculas, como permite la resolucion CNMC.
- Las fechas `iniF`/`finF` se validan con formato AAAA-MM-DD y comprobacion de ida/vuelta UTC, porque
 `Date` convierte `2026-02-31` en marzo. Si la fecha es imposible, los datos numericos validos se
 conservan y `dias` queda `null` para que lo complete el PDF.
- La semantica `iniF`/`finF` es inicio excluido, fin incluido, distinta del rango textual `del X al Y`
 de la factura, que es inclusivo. Ver la entrada de dias.

**PDF con varias facturas.** `__LF_extraerTextoPDF()` concatena todas las paginas. Si el PDF trae dos
facturas y solo la segunda lleva QR, el rango textual encontrado puede ser el de la primera mientras
los numeros vienen del QR de la segunda. `__LF_parseQRData()` conserva las fechas ya validadas del QR
como metadatos internos (`_fechaInicio`/`_fechaFin`, ni se muestran ni se aplican) y `factura.js`
compara ese rango con el que el parser dice haber usado, con **tolerancia de 2 dias**. Si no casan, se
conservan los dias del QR, la confianza baja a 75% (por debajo del umbral de autocalculo) y se avisa.

Esa tolerancia es la que evita el falso positivo que importa: una factura normal de una pagina cuyo
QR dice 29 dias y cuyo texto dice 31 sigue dando 31 dias al 100%, porque la diferencia es la semantica
CNMC ya documentada. No cambia la prioridad del QR para potencias y consumos.

**Ojo al construir un PDF de prueba:** una URL de QR en una sola linea a 9pt se sale del ancho de
pagina y pdf.js no extrae el final de la cadena, asi que el QR llega truncado y el caso no se
reproduce. A 5pt cabe entera. No confundir ese artefacto del fixture con un fallo del lector.

**No todo QR en una factura es de la CNMC.** Varias comercializadoras imprimen un QR comercial hacia
su app; se decodifica bien pero se rechaza por no ser de la CNMC, y los datos salen del texto. No es
un fallo del lector de QR ni del limite de paginas.

### Dias De Facturacion

- **`__LF_daysInclusive()` suma 1 deliberadamente.** El rango textual `del X al Y` de una factura es
 inclusivo; `iniF`/`finF` del QR tiene semantica distinta (inicio excluido). No reabrir ese `+1` sin
 evidencia nueva de que `reRango`/`reRango2` esten leyendo fechas de contador y no el periodo
 expresado en la factura.
- El rango admitido es 1-370 y **entero**. Un valor decimal no se aplica al formulario principal y
 emite aviso de revision, porque la validacion principal exige enteros y bloquearia el calculo
 despues, comunicando un exito falso.
- Los regex de dias trabajan sobre una copia del texto con los tokens decimales neutralizados, para
 que `30,5 dias` no se degrade a 5 ni a 30 por un match parcial. Esa copia se usa SOLO para dias: no
 altera potencias, precios, consumos ni fechas. Si el documento trae ademas `Total dias facturados:
 31`, se recupera 31.

### Peajes Fuera De 2.0TD

LuzFija modela exclusivamente 2.0TD (dos periodos de potencia, tres de energia). Una factura 3.0TD
podia aportar P1/P2/P3 de potencia y quedarse solo con P1/P2, produciendo una entrada aparentemente
valida pero con estructura tarifaria equivocada; eso altera importes, no es solo UX.

La deteccion usa unicamente etiquetas inequivocas de acceso (`Peaje de acceso`, `Tarifa de acceso`,
`ATR`) para 3.0TD y 6.1TD-6.4TD. En ese caso: `peajeNoSoportado=true`, confianza 0 y no se exponen
datos para aplicar. El bloqueo domina tambien la rama QR+PDF: un QR con numeros validos no reabre una
factura cuyo PDF declara un peaje fuera de 2.0TD.

**Dos precauciones aprendidas, ambas cubiertas por regresiones:**

1. **Auto-declaracion.** Una mencion informativa a 3.0TD no bloquea. Una factura que declara
 `Peaje de acceso: 2.0TD` y ademas incluye la letra pequeña habitual *"si su potencia supera los
 15 kW se le aplicara el peaje de acceso 3.0TD"* quedaba BLOQUEADA, es decir, el lector dejaba de
 funcionar para un usuario perfectamente valido. Si el documento declara su propio peaje 2.0TD con
 la misma etiqueta, esa declaracion manda. Una factura solo tiene un peaje.
2. **La marca vive en el formulario, no en el modulo.** Estuvo en una variable de modulo que se
 fijaba al renderizar y solo se limpiaba al abrir/cerrar el modal, de modo que podia sobrevivir al
 formulario que la origino y bloquear una factura 2.0TD posterior. Ahora es
 `form.dataset.peajeNoSoportado`, puesta o borrada en cada render.

**Nota de alcance:** el bloqueo es un CAMBIO DE COMPORTAMIENTO, no solo una correccion. Una factura
de esos peajes ya no rellena el formulario, algo coherente con el dominio modelado pero que un
usuario puede reportar como "ya no me lee la factura".

### Observatorio: Ausencia De Datos Frente A Cero

Regla general de esta area: **la ausencia de dato nunca se representa como cero**, porque un cero se
presenta al usuario como un precio real y puede llegar a recomendarse como el mas barato.

- Las horas aun no publicadas del dia vigente son `null`, no `0`, y un bloque horario solo se
 considera si todas sus horas son finitas. Si no hay tres horas completas, el consejo dice `sin
 datos suficientes` en lugar de inventar un bloque.
- Un mes sin una sola hora valorada tiene `avg` a `null`, queda fuera de mejor/peor mes y muestra
 `—`. Antes figuraba como `0,0000 EUR/kWh`, y con precios reales negativos podia salir como el
 "mejor" mes.
- Con cobertura parcial, la energia aportada se informa completa. `totalKwh`/`row.kwh` conservan su
 semantica historica (kWh realmente valorados, que usa tambien el motor indexado) y se añaden
 `inputKwh` global y por fila que suman los kWh sin precio. La compensacion y el precio medio siguen
 calculandose solo sobre la energia con precio, y la nota lo declara.
- Si no hay ninguna observacion, `avgPrice`/`minPrice`/`maxPrice` son `null`: antes esos ceros se
 presentaban como un rango real `0,000-0,000 EUR/kWh`.
- El `catch` de una carga antigua comprueba `_rerenderToken` antes de pintar el error, para que una
 peticion obsoleta no sustituya por `Error cargando dataset local.` una seleccion nueva ya correcta.

`js/pvpc-stats-csv.js` replica estos campos, pero conviene saber que **todo su cuerpo es un fallback**
que solo corre si `js/lf-surplus-prices.js` no llego a cargarse. Para probarlo hay que forzar esa
ruta. Su filtro de `best`/`worst` es defensivo e inalcanzable (este modulo no crea la fila de un mes
sin horas valoradas) y su test lo documenta: no lo quites creyendo que falta cobertura.

### Simulador Solar: Rotacion Del Patron Anual Y Ranking

**La tabla son 12 casillas enero-diciembre: un PATRON de consumo y produccion de la vivienda, no un
historico fechado.** Elegir el mes de inicio pide recorrer ese mismo patron en otro orden (por
ejemplo abr..dic, ene..mar) con las cantidades de la tabla; no pide predecir el año siguiente. Marzo
sigue siendo marzo.

**Decision firme: `rotateMonthsByStart()` reordena y conserva la clave `YYYY-MM` de cada mes. NO
REABRIR.** Se propuso proyectar los meses que quedan detras de diciembre al año siguiente para
consultar SSAA y fiscalidad. Se rechazo por cuatro razones:

1. Parte de un eje temporal que la herramienta no tiene.
2. Se apoyaba en una linea de `CAPACIDADES-WEB.md` que ya estaba caducada: `SIMULADOR-BV.md` se
 habia editado despues, a proposito, para afirmar lo contrario. Ver el punto 5 del metodo de
 verificacion.
3. SSAA del año siguiente no existe, asi que `resolveRate()` caeria a `latest-complete-fallback`:
 cinco tarifas reales publicadas (recorrido de 0,01329 EUR/kWh) pasarian a ser la misma constante
 repetida.
4. Rompe la reproducibilidad. Ese valor de relleno cambia cada mes, de modo que el mismo escenario
 guardado o el mismo enlace `?bv=` daria un total distinto segun el dia en que se abra: hasta
 23,43 EUR de oscilacion, casi el triple del error de 8,26 EUR que pretendia corregir.

Lo fija `tests/bv-ui.test.js`, con un test que falla si la rotacion vuelve a asignar años. La mitad
fiscal de aquella propuesta era ademas inerte: no queda ninguna rama por fecha en `js/lf-config.js`.

**Mes de inicio y cambio de año.** Una tabla manual no lleva `meta` mensual, asi que
`buildSimulationMonths()` reconstruye las claves con el año en curso. Un escenario guardado o
compartido en un año y abierto en otro perdia su mes de inicio en silencio y la simulacion arrancaba
en enero, cambiando el arrastre de BV, el coste y el ranking. Agravante: asignar a un `<select>` un
valor sin `<option>` no crea la opcion, asi que el valor efectivo quedaba vacio sin error ni aviso.
`resolveMonthStartKey()` da prioridad a la clave exacta y, si ya no existe, traslada la eleccion al
mismo mes natural; falla cerrado ante ambiguedad (dos junios de años distintos dejan el orden por
defecto).

**Orden del ranking.** Manda `totals.pagado` y solo en empate el mayor `totals.bvFinal`.
`totals.real` y el coste neto no reordenan: el saldo final es valor condicionado a seguir con la
comercializadora. Como `totals.pagado` ya viene redondeado a centimos, el empate se compara por
igualdad exacta. Un umbral del tipo `Math.abs(diff) < 0.01` **no vale**: en IEEE-754
`7.87 - 7.86` da `0.00999999999999978`, de modo que una diferencia real de un centimo entraba como
empate y la tarifa mas cara podia colocarse delante por su saldo. Medido sobre todos los pares
consecutivos de un centimo entre 0 y 2.000 EUR, el 88,7% caia del lado equivocado.

**Descartado tras investigar, no reabrir sin evidencia nueva:** arrastre mensual y saldo inicial,
topes `ENERGIA`/`ENERGIA_PARCIAL`, meses con cero consumo y cero excedentes (conservan costes fijos),
mezcla de referencia y horario en indexadas dentro de un mismo mes, cambio de zona fiscal con datos
cargados, y aislamiento de un escenario compartido frente a `localStorage`.

**Trampas al probar esta pagina en navegador:** `#bv-results` contiene 64 tablas (una por tarifa) con
12 filas de detalle mensual cada una, asi que contar `tbody tr` da 768 y no el numero de tarifas; el
ranking visible vive en `.bv-alt-rank`; y el selector de mes de inicio no es un `<select>` nativo sino
un control propio (`#bv-mes-inicio-btn` / `#bv-mes-inicio-list`).

### CSV: Generacion Frente A Exportacion

**Decision firme: `generacion_kwh` y `generacion_wh` se mantienen en los alias de exportacion. No
re-proponer su retirada sin un fichero real donde el comportamiento actual haga daño.**

El razonamiento para quitarlos ("generacion puede incluir autoconsumo") es correcto para un fichero
de INVERSOR, pero no para uno de DISTRIBUIDORA: el contador solo puede medir lo que lo cruza, asi que
ahi "generacion" es energia exportada. Retirarlos rompia un formato real ya cubierto por
`tests/import-robust.test.js` con el fixture `tests/fixtures/ide_bruto.csv`
(`CUPS;FechaHora;CONSUMO Wh;GENERACION Wh`), que pasaba a devolver 0,6 en vez de 0,3.

Ademas la premisa no aplicaba al formato real de Datadis: su cabecera es `Energia_generada_kWh`, que
NO esta en la lista de alias (`findHeaderMatches` compara por igualdad exacta, no difusa), asi que
nunca se mapeo como vertido. En los CSV reales, Datadis trae `Energia_vertida_kWh` y
`Energia_generada_kWh` como columnas distintas. El codigo ya modela esa distincion con
`SOLAR_GENERATION_TOKENS`: si ya hay una exportacion mapeada, esas columnas son auxiliares.

### SEO, Datos Estructurados Y Core Web Vitals

- La ausencia de `<meta name="robots" content="index,follow">` no es una carencia: `index,follow` es el comportamiento por defecto. Solo reporta `robots` si una directiva concreta bloquea o limita una URL indebidamente.
- No propongas `meta keywords`: Google no las usa para ranking. Tampoco propongas `hreflang` por completitud cuando solo existe una variante equivalente en espanol; se usa para URLs equivalentes por idioma o region.
- `FAQPage` puede conservarse como marcado semantico, pero no se debe prometer ni medir como fuente de rich snippets para LuzFija. El marcado `Organization` ayuda a desambiguar la entidad y su logo, no garantiza un knowledge panel.
- En el sitemap, lo relevante es que `lastmod` sea veraz y se mantenga sincronizado. `changefreq` y `priority` no deben presentarse como senales de ranking.
- Las guias ya tienen fecha de actualizacion visible y sincronizada con `dateModified`; la home muestra la fecha del dataset de tarifas tras cargarlo. No reportes una ausencia general de fecha visible sin revisar ambas superficies.
- CSP y la estrategia `network-first` del service worker son buenas practicas de seguridad y actualizacion para usuarios, respectivamente, pero no prueban una mejora directa de ranking ni garantizan por si solas que Googlebot vea una version concreta.
- **Las Metricas Web Principales de campo se superan en la captura revisada.** CrUX del 24/07/2026, ventana del 25/06 al 22/07 y percentil 75: LCP 1,3 s movil y 1,2 s escritorio, INP 163/95 ms y CLS 0,01 en ambos. Son agregados de campo, no una garantia para cada visita ni evidencia causal sobre un recurso. `ARRANQUE-CARGA.md` seccion 8 conserva el informe y el contexto.
- No confundas laboratorio con campo. El informe PageSpeed `6b20tubb7z` contiene dos ejecuciones Lighthouse independientes: movil puntua 89 y escritorio 100; el ahorro estimado de `Solicitudes que bloquean el renderizado` es 630 ms y 150 ms, respectivamente. La diferencia muestra sensibilidad al perfil y a la ejecucion; no prueba por si sola ni un defecto de orden ni que el escenario movil sea irreal. No compares estimaciones de auditorias distintas sin conservar informe, version, despliegue y perfil.
- Un arbol de dependencias describe relaciones y tiempos de una ejecucion, no independencia causal entre ramas. Que los scripts del `<head>` terminen antes que otra rama no demuestra que diferirlos sea incapaz de cambiar el resultado: comparten recursos de red y CPU. No se difieren porque su ejecucion temprana sostiene invariantes documentadas en `ARRANQUE-CARGA.md` seccion 4 y no consta una alternativa segura con mejora reproducible, no porque Lighthouse demuestre una imposibilidad tecnica.
- Antes de recomendar CSS critico inline, `media=print`, `preload` duplicado de una hoja o carga diferida de CSS de un modal, ejecuta Lighthouse/PageSpeed y revisa la cascada real. Un recurso render-blocking por si solo no es un hallazgo de alta prioridad.
- En este sitio, cualquier preload nuevo de una fuente debe justificarse por uso critico visible y beneficio medido; los actuales pesos 400 y 900 corresponden a los elementos LCP observados. Tras desplegar un preload, compara varias pasadas en frio contra una baseline equivalente y revisa la cadena de dependencias: que el recurso deje de aparecer como descubierto via `fonts.css` es compatible con el mecanismo esperado, pero no demuestra por si solo una mejora estadisticamente atribuible de LCP.
- No propongas preloadar los pesos 600 y 700 de Outfit solo porque aparezcan encadenados tras `fonts.css`: no son los pesos del elemento LCP medido y esta captura no demuestra un beneficio; nuevas precargas pueden competir por ancho de banda. `font-display: swap` permite mostrar una fuente alternativa, pero no garantiza ausencia de cambios de layout o de efecto sobre LCP. El CLS de campo de 0,01 demuestra buena estabilidad agregada en el percentil 75, no la ausencia de saltos atribuibles a una fuente concreta.
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
- `tests/fiscal-rounding-align.test.js` (paridad home/BV/desglose y medios centimos exactos de IVA/IGIC/IPSI)
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
- `tests/pvpc-day-coverage.test.js` (contrato del validador compartido: dia 1/24, duplicado, timestamp ajeno, DST 23/25, allowPartial)
- `tests/pvpc-stats-engine.test.js` (cobertura mensual del Observatorio, frontera hoy/manana)
- `tests/desglose-properties.test.js` (invariantes matematicos con entradas adversarias: finitud, monotonia, tope de compensacion, reconstruccion fiscal independiente por zona)
- `tests/cache.test.js` (contrato completo de `fetchTarifas`: timeout, reintentos, clasificacion de fallos y validacion estructural atomica del dataset descargado)
- `tests/render-bv-total.test.js` (cero pagado frente a coste de ranking en la fila BV, con `formatMoney` real)

## Prompt Recomendado Para Auditorias Externas

```text
Audita LuzFija.es despues de leer AGENTS.md, AUDITORIA-IA.md y CAPACIDADES-WEB.md.

En AUDITORIA-IA.md lee primero `Metodo De Verificacion Exigido` y `Areas Ya Auditadas Y Su Estado`:
la primera fija como se prueba un hallazgo en este proyecto, la segunda dice que terreno ya esta
cubierto. Las reglas del metodo son obligatorias, no orientativas; en particular reproducir contra
el codigo desplegado antes de proponer nada, validar por mutacion las regresiones que anadas, y
resolver cualquier contradiccion entre documentos por cronologia (`git log -S`) y no por precedencia.

No reportes como bug algo documentado como decision de implementacion o falso positivo conocido.
Si discrepas con una decision documentada pero el codigo la cumple, clasificalo como mejora, hardening o cambio de producto. Si el codigo contradice la decision documentada, puede ser un bug.
Antes de hallazgos de fiscalidad/PVPC lee ARQUITECTURA-CALCULOS.md y CALC-FAQS.md.
Antes de hallazgos BV/indexados lee SIMULADOR-BV.md.
Antes de hallazgos CSP/privacidad distingue superficie sensible vs editorial.
Antes de hallazgos SEO/CWV, revisa la seccion `SEO, Datos Estructurados Y Core Web Vitals` de este documento y valida rendimiento contra una medicion reproducible; distingue datos de laboratorio, datos de campo y cobertura de una pagina concreta.
Valida cada hallazgo contra codigo y tests. Si no hay test, propon el test que faltaria.
Para asignar severidad no basta con demostrar que se viola un contrato: lleva el caso hasta el peor resultado OBSERVABLE, atravesando todas las defensas posteriores (guards, validadores fail-closed, try/catch, redondeos, caches). Un fallo que termina en "no se muestra el dato" no es equivalente a uno que muestra un importe falso al usuario, y el orden de prioridades debe reflejarlo.

Devuelve findings con esta taxonomia:
- Bug confirmado
- Riesgo real reproducible
- Mejora UX/rendimiento
- Hardening
- Roadmap ya documentado
- Falso positivo documentado
```
