# Registro De Auditorias De LuzFija.es

Ultima actualizacion: 2026-09-17

Este fichero es de CONSULTA POR AREA, no de lectura lineal. La lectura obligatoria antes de
auditar es `AUDITORIA-IA.md`: metodo, taxonomia de severidad, tabla de areas y prompt. Aqui
vive el detalle de cada area: decisiones deliberadas, falsos positivos conocidos, bugs ya
corregidos con sus tests, evidencias, mutaciones y trampas metodologicas.

## Areas Auditadas Y Decisiones Firmes


Lo que sigue son decisiones deliberadas, falsos positivos conocidos o bugs YA CORREGIDOS (marcados
RESUELTA en su titulo, con la correccion aplicada y sus tests). No re-reportes ninguna entrada sin
evidencia nueva: para las decisiones/falsos positivos, evidencia de que el codigo ya no cumple lo
descrito; para las RESUELTAS, evidencia de que el mecanismo original volvio (regresion) o de un caso
nuevo no cubierto por sus tests. Cada entrada explica que evidencia haria falta para reabrirla.

<a id="csp-y-trusted-types"></a>
### CSP Y Trusted Types

- Las paginas editoriales no procesan facturas ni archivos CSV/XLSX ni acceden a sus contenidos. Endurecer su `script-src` seria defensa en profundidad general frente a un XSS futuro hipotetico, pero no una proteccion relevante de datos personales en el modelo actual. El almacenamiento compartido contiene unicamente valores numericos de configuracion y agregados (potencias, consumos por periodo, dias, zona fiscal y opciones del comparador), no el PDF, CUPS, texto OCR, nombre del fichero ni curva horaria completa. Estos valores no se envian automaticamente a un backend ni a analitica; solo pueden salir por una accion explicita del usuario, como compartir su configuracion. Sin un vector de inyeccion reproducible, `unsafe-inline` en las paginas editoriales no debe reportarse como bug de privacidad ni como prioridad. Las superficies que procesan archivos (`index.html`, `comparador-tarifas-solares.html` y `estadisticas/index.html`) ya usan `script-src` estricto con hashes.
- **Precision del 03/09/2026 sobre "las paginas editoriales no tienen entrada de datos".** Esa formulacion abreviada circula fuera del repo (guia unica para IAs, seccion 9c) y es INEXACTA para `guias.html`: el indice de guias tiene buscador (`#searchInput`), lee un parametro `q` de la URL y carga `data/guides-search-index.json`. La decision (baja prioridad) no cambia, pero el motivo correcto no es la ausencia de entrada, sino que **esa entrada nunca llega al DOM como HTML**: `js/guides-search.js` construye todos los resultados con `textContent` —incluido el eco del termino buscado en el contador de resultados— y sus unicos `innerHTML` son `= ''` para vaciar el contenedor. Verificado leyendo el fichero el 03/09/2026. Para contraste, `calcular-factura-luz.html` si es una landing sin un solo `<input>` ni `<form>`. Si alguien introduce ahi un render por `innerHTML`, la justificacion de esta entrada deja de sostenerse y hay que revisar la CSP de esa pagina.
- `frame-ancestors` no puede aplicarse desde una CSP declarada mediante `<meta http-equiv="Content-Security-Policy">`: los navegadores deben ignorar esa directiva en politicas entregadas por `meta`. Solo seria efectivo como cabecera HTTP servida por el hosting o por un proxy. LuzFija se publica directamente en GitHub Pages y no incorpora esa capa; no propongas anadir `frame-ancestors` a los `<meta>` porque crearia una falsa sensacion de proteccion sin cambiar el comportamiento del navegador. La ausencia de una cabecera antiframing puede clasificarse como hardening de clickjacking de severidad baja, no como bug funcional ni como proteccion directa de los datos locales del usuario.
- `require-trusted-types-for 'script'` no esta activado por decision consciente: requiere migrar/auditar usos legitimos de `innerHTML`. Clasificalo como hardening futuro, no bug.
- Si recalculas los sha256 de la CSP veras hashes declarados que no coinciden con ningun `<script>` ejecutable: son los bloques `application/ld+json`. El script de deploy hashea todos los inline por uniformidad, incluidos los JSON-LD que no ejecutan. Es inerte y deliberado; verificado computacionalmente el 2026-07-09 que todos los scripts ejecutables SI estan cubiertos. No lo reportes como hash roto ni como script bloqueado.

<a id="csv-xlsx-grande"></a>
### CSV/XLSX Grande

- El parsing CSV/XLSX es local y actualmente sincronico.
- `parseEnergyTableRows` conserva contrato sincronico compartido por home, simulador BV, observatorio y tests.
- No propongas insertar `await` directamente dentro de `parseEnergyTableRows` sin redisenar API async o Web Worker.
- `SIMULADOR-BV.md` ya recoge `Progreso de carga para CSV grandes` y `Web Worker para procesamiento en background` como roadmap.

<a id="carga-diferida-del-javascript-de-la-home"></a>
### Carga Diferida Del JavaScript De La Home

- Medicion local del 23/07/2026: `index.html` carga inicialmente 28 scripts first-party, unos 651 KB sin comprimir y 176 KB con gzip. Aproximadamente 306 KB / 77 KB gzip corresponden a `lf-csv-utils.js`, importacion CSV, factura PDF, desglose y tarifa personalizada, usados solo cuando el usuario entra en esos flujos.
- Las dependencias pesadas (`PDF.js`, `Tesseract`, `jsQR` y `SheetJS`) ya se cargan bajo demanda. El margen pendiente afecta principalmente a modulos first-party relativamente pequenos.
- No presentes esa separacion como un `quick win` ni como bug de rendimiento sin una degradacion reproducible en datos de campo. La instrumentacion INP propia solo esta activa en modo debug; para reabrir esta decision usa CrUX/Search Console u otra telemetria de campo equivalente, no una estimacion basada unicamente en bytes.
- La home no usa hoy un grafo de modulos ESM: sus scripts clasicos publican y consumen APIs en `window.LF`; muchos, pero no todos, estan encapsulados en IIFEs. Varios capturan dependencias al evaluarse y `lf-app.js` espera encontrarlas disponibles al inicializar. El orden de los `<script defer>` forma parte del contrato descrito en `ARRANQUE-CARGA.md`.
- `sw.js` instala como `CORE_ASSETS` la cadena funcional completa de la home y cancela la instalacion si falta una pieza obligatoria. Esto demuestra el requisito atomico actual, pero no prueba por si solo la causa historica de una rotura anterior.
- Cualquier intento futuro exige primero mapear el grafo de dependencias y redisenar explicitamente el contrato de inicializacion. Despues debe cubrir carga fallida/reintento, doble inicializacion, modo offline, clientes con HTML/SW antiguo, watchdogs y estados degradados antes de medir el resultado. Es roadmap de riesgo alto, no una optimizacion local de unas etiquetas `<script>`.

<a id="cambios-de-hora-en-la-numeracion-horaria-marzo-y-octubre"></a>
### Cambios De Hora En La Numeracion Horaria (Marzo Y Octubre)

- `buildCnmcHourEntries` (`js/pvpc.js`) y `buildCnmcHourIndexMap` (`js/lf-surplus-prices.js`) generan claves con un HUECO el dia corto de marzo: Peninsula `1,2,4..24` y Canarias `1,3,4..24`. **Eso es correcto**, no un bug: la clave canonica es `hora local + 1` y la hora que desaparece no existe. Quien vea el hueco y lo reporte como dato corrupto se equivoca. La normalizacion del formato CCH-CONS comprimido (`1..23` consecutivos, segun la especificacion consolidada del BOE) vive en el parser compartido `js/lf-csv-utils.js`, no en los motores.
- La hora que desaparece en marzo y se repite en octubre NO es la misma en todas las zonas: 02:00 en Peninsula y **01:00 en Canarias**. Ceuta/Melilla comparte reloj con Peninsula aunque su horario de periodos este desplazado +1h. Son dos ejes ortogonales y estan separados a proposito en la referencia del CSV: perfil de periodos (`general` / `ceuta-melilla`) y reloj DST (`europa-madrid` / `canarias`). No los colapses en un solo campo.
- El reparto P1/P2/P3 no se ve afectado por los cambios de hora: ambos caen siempre en domingo y `getPeriodoHorarioCSV` devuelve `P3` para todo el dia antes de llegar a la clasificacion horaria.
- **La columna `Periodo` de un CSV importado NUNCA se usa en Ceuta/Melilla, ni para inferir la base horaria (0-23 vs 1-24) ni para el periodo final** (corregido 14/08/2026, auditoria externa cruzada). Antes de esta fecha, `detectHourBase()`/`inferHourBaseFromPeriods()` podian casar por coincidencia la columna `Periodo` de un fichero calculado con limites de OTRA zona contra la interpretacion horaria equivocada, desplazando todas las horas una posicion; y `parseEnergyTableRows()` respetaba esa columna igual para todas las zonas, mientras `bv-sim-monthly.js` ya la ignoraba y recalculaba siempre en Ceuta/Melilla — dos motores podian clasificar el mismo CSV en periodos distintos. Ahora ambos puntos usan `getCsvZoneProfiles(zonaFiscal).perfilPeriodos === 'ceuta-melilla'` para forzar el recalculo por fecha/hora, igual en los dos motores. Datadis mensual queda fuera de este cambio (via `parseDatadisMonthlyRows`, camino de codigo distinto, periodo sintetico fijo P1/P2/P3 sin depender de zona).

<a id="escenario-compartido-del-simulador-solar-bv"></a>
### Escenario Compartido Del Simulador Solar (`?bv=`)

- Un escenario abierto por enlace es una previsualizacion y el autoguardado esta bloqueado a proposito, para las tres claves de la escritura pseudo-atomica (`bv_manual_data_v2`, `bv_custom_tarifa` y `bv_manual_data_timestamp`): `persistManualScenario()` es la unica funcion que las escribe juntas, y el guard de preview corta ANTES de invocarla, asi que ninguna de las tres se toca, timestamp incluido. No lo reportes como "el simulador no guarda los cambios": lo dice el propio indicador ("Vista previa sin guardar") y solo el boton explicito o importar un respaldo adoptan el escenario. Detalle en `SIMULADOR-BV.md`.
- Exportar desde una previsualizacion descarga el estado visible sin tocar `localStorage` ni adoptar el escenario. Es deliberado: el respaldo debe reflejar lo que el usuario ve.
- "Borrar todos los datos" elimina `bv_manual_data_v2`, `bv_manual_data` y `bv_manual_data_timestamp`, pero **no** `bv_custom_tarifa`: "Mi tarifa" tiene su propio boton de borrado. La desincronizacion transitoria del `savedAt` se auto-repara en la siguiente escritura, porque `getScenarioConfig()` relee la tarifa del DOM. Clasificalo como decision de producto, no como bug de coherencia.

<a id="guard-de-datos-frente-a-ci-de-despliegue"></a>
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

<a id="duplicados-en-csv-xlsx-rechazados-resuelta"></a>
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
 octubre se resuelven a horas DISTINTAS (3 y 25) antes de la comprobacion, asi que no colisionan
 con este chequeo.
- **CORREGIDO el 12/09/2026: esa garantia solo era cierta en base 0-23.** Hasta esa fecha
 `buildHourResolver` resolvia la hora repetida de octubre UNICAMENTE cuando el fichero venia en
 base 0-23; en base 1-24 devolvia el numero tal cual. Datadis exporta el año completo en base
 1-24 y REPITE el numero de hora ese dia (...02:00, 03:00, 03:00, 04:00...) sin ninguna columna
 que las distinga, asi que las dos llegaban iguales al chequeo y la importacion se cancelaba
 entera: cualquier año descargado de Datadis que incluyese el ultimo domingo de octubre era
 irrecuperable. Lo detecto el autor con un fichero real suyo, no una auditoria. La frase anterior
 de esta entrada terminaba con "no lo reportes como conflicto con el cambio de hora", y eso
 probablemente desactivo la sospecha en rondas posteriores: cuidado con las notas que cierran una
 linea de investigacion. Cubierto ahora por `tests/csv-hardening.test.js`, describe "Octubre en
 base 1-24: hora repetida sin columna que la distinga".

<a id="xlsx-formula-sin-resultado-materializado-resuelta-30-08-2026"></a>
### XLSX: Formula Sin Resultado Materializado (RESUELTA 30/08/2026)

Auditoria focalizada de la importacion CSV/XLSX de home, con solar y observatorio como consumidores
compartidos. Se confirmo un unico bug de severidad media: un XLSX podia contener en una columna
economica una formula sin resultado cacheado y terminar importandola como celda vacia/0 kWh.

- **Causa raiz.** SheetJS omite esa celda con la lectura anterior. Con `sheetStubs:true` la expone
  como `{t:"z", f:"1/2", v:0}`: ese cero pertenece al stub y no es el resultado de la formula.
  `assertRelevantXlsxFormulasResolved()` tampoco consideraba `t:"z"` no resuelto, por lo que el
  archivo llegaba a preview con un consumo inferior al contenido logico.
- **Correccion.** Home, solar y observatorio mantienen `sheets:0` y añaden `sheetStubs:true`; solo se
  materializa la primera hoja. El guard compartido rechaza `t:"z"` cuando existe `f`. Un stub vacio
  sin `f`, una formula con resultado numerico cacheado y una formula en columna irrelevante conservan
  su comportamiento previo.
- **Evidencia independiente.** El fixture sintetico sin cache fue aceptado antes con 1,00 kWh en vez
  de 1,50 kWh. Tras el cambio, los tres consumidores lo rechazan antes de publicar datos; el fixture
  cacheado se acepta en los tres con 1,50 kWh, `Notas` no produce falso positivo y la celda vacia
  ordinaria sigue importandose como cero con aviso.
- **Cobertura.** `tests/xlsx-formula-guard.test.js` fija el stub con formula, el stub sin `f`, el
  resultado cacheado y el cableado de `sheetStubs:true` en los tres lectores. La prueba roja previa
  fallo en las cuatro mutaciones productivas y quedo verde al aplicar cada contrato.

**No reportar como bugs:** que LuzFija no evalue formulas; que solo consuma la primera hoja; que una
celda realmente vacia se interprete como cero con aviso; o que una formula en una columna ajena al
calculo no bloquee la importacion completa.

**Para reabrir:** aportar un XLSX donde una formula relevante sin resultado materializado vuelva a
publicarse como cero; donde `sheetStubs:true` materialice hojas distintas de la primera; o donde una
formula cacheada, un stub ordinario sin `f` o una columna irrelevante queden bloqueados.

<a id="contrato-de-cambios-pendientes-roto-por-auto-refresh-race-de-edicion-y"></a>
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

<a id="home-mi-tarifa-perdida-de-datos-desglose-con-cambios-pendientes-y-opci"></a>
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

<a id="factura-tabla-manual-y-mi-tarifa-ceros-explicitos-y-continuidad-resuel"></a>
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

<a id="escenarios-compartidos-zonaorigen-y-mi-tarifa-excluida-resuelta"></a>
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

<a id="limpiar-cache-blanqueo-de-la-tabla-manual-y-autocalculo-de-factura-res"></a>
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

<a id="orden-del-teardown-con-fake-timers-tests-bv-ui-zona-grid-test-js"></a>
### Orden Del Teardown Con Fake Timers (`tests/bv-ui-zona-grid.test.js`)

- En el `afterEach`, `vi.restoreAllMocks()` va ANTES de `vi.useRealTimers()`, y el orden no es cosmetico. Los tests de autoguardado activan fake timers antes de `bootSolarUi`, que hace `vi.spyOn(window, 'setTimeout')`: el spy captura entonces la implementacion falsa como si fuera la original. Con el orden inverso, `restoreAllMocks()` la reinstala y los tests posteriores que esperan con `setTimeout` real se cuelgan hasta el timeout de 5 s. Ocurrio de verdad el 12/08/2026. No reordenes esas dos lineas al "limpiar".

<a id="pvpc-con-csv-y-precios-faltantes"></a>
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

<a id="excedentes-indexados-fv-exc-1"></a>
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

<a id="validador-de-dia-civil-compartido-home-observatorio-excedentes"></a>
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

<a id="frontera-temporal-del-periodo-pvpc-estandar-resuelta"></a>
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

<a id="pvpc-desaparece-del-ranking-ssaa-unavailable-y-cache-del-service-worke"></a>
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

<a id="tarifas-json-no-lleva-test-de-esquema-en-el-repo-deliberado"></a>
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

<a id="fv-exc-igual-a-cpunta-en-chc-plan-ahorro-solar-compensacion-1-1-correcto"></a>
### `fv.exc` Igual A `cPunta` En `CHC Plan Ahorro Solar`: Compensacion 1:1 (CORRECTO, NO TOCAR)

- Es la UNICA fila del dataset donde `fv.exc` coincide exactamente con `cPunta`/`cLlano`/`cValle`
  (los cuatro a `0.152352` el 02/09/2026), y ese `fv.exc` es ademas el mas alto del catalogo por un
  factor de 1,5x: el siguiente es `0.1` (`CHC BV`) y el rango habitual va de `0.03` a `0.07`. Un
  barrido de outliers, o una comparacion entre columnas, lo marcara como copia-pega. **NO lo es.**
- Motivo: `Plan Ahorro Solar` **compensa los excedentes al mismo precio al que vende la energia**
  (1:1). Es el gancho comercial del producto ("compensando tus excedentes al mejor precio"), y por
  eso `chcenergia.es/solar/plan-ahorro-solar` y la tarjeta de `/solar` publican **un unico numero**,
  rotulado "Excedentes", que sirve para las dos columnas del Excel. Comparalo con `CHC BV`, en la
  misma pagina de listado: ahi CHC SI rotula dos bloques distintos, "Energia" (`0,159673`) y
  "Excedentes" (`0,10`), porque en ese producto no coinciden.
- Consecuencia sana: los DOS validadores externos leen ese mismo numero, cada uno para su columna,
  y los dos dan OK. No es una casualidad ni un falso positivo.
- **Dos defectos reales de la web de CHC que aparecen en esa pagina y NO deben confundirte:**
  (a) la caja "Potencia" rotula sus valores en `€/kWh` cuando son `€/kW dia` (en el resto de
  paginas de CHC lo rotula bien); (b) el conmutador de "precios con IVA" reescala ese numero de
  excedentes x1,21 (`0,152352` -> `0,184346`), cuando la compensacion de `CHC BV` no se reescala
  (`0,10` -> `0,10`). Son fallos de su plantilla, no informacion sobre el concepto.
- Historial, para que no se repita: el 02/09/2026 se dedujo de (b) que la caja contenia en realidad
  el precio de energia mal rotulado, se bajo `fv.exc` a `0.04` y se anadio la tarifa a
  `EXCEDENTES_PENDIENTES`. Era **incorrecto** y se revirtio el mismo dia al revisar el marcado del
  listado `/solar`, donde se ve que CHC rotula deliberadamente "Excedentes" en esta tarifa y
  "Energia" en la de bateria virtual. Leccion: ante una anomalia asi, mira como rotula la MISMA web
  un producto hermano donde ya conozcas la respuesta, antes de deducir nada de un detalle de
  render.
- Mantenimiento: las dos columnas van ATADAS. Si CHC cambia el precio de este plan, hay que mover
  el consumo y la J a la vez, al mismo valor.

<a id="limites-de-consumo-anual-maxconsumoanual-minconsumoanualexclusivo"></a>
### Limites De Consumo Anual (`maxConsumoAnual` / `minConsumoAnualExclusivo`)

Filtro revisado el 13/08/2026. Las decisiones de abajo son FIRMES y ya fueron litigadas en
revision tecnica; no las reportes como hallazgo.

> **Actualizado el 12/09/2026.** Aplicar los limites paso a ser decision del usuario en TODOS los
> alcances: superar el maximo con kWh registrados ya no excluye por si solo. Lee antes
> [Limites De Consumo Como Decision Del Usuario (12-09-2026)](#limites-de-consumo-como-decision-del-usuario-12-09-2026),
> que dice exactamente que puntos de esta entrada quedan superados y cuales siguen vigentes.

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

<a id="cero-pagado-frente-a-coste-de-ranking-en-la-fila-bv-home"></a>
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

<a id="invariante-de-fv-bv-en-mi-tarifa-resuelta-20-08-2026"></a>
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

<a id="persistencia-y-migracion-de-estado-local-resuelta-20-08-2026"></a>
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

<a id="ui-del-simulador-solar-estado-ciclos-de-vida-y-renderizado-resuelta-20"></a>
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

<a id="ranking-del-simulador-solar-bv"></a>
### Ranking Del Simulador Solar/BV

- El filtro de limites de consumo (arriba) solo retira candidatas; NO altera el criterio de orden.
- El ranking visible ordena por `totals.pagado`.
- En empate usa mayor `totals.bvFinal`.
- `totals.real` es metrica auxiliar, no criterio principal.
- `totals.pagado - totals.bvFinal` puede mostrarse como coste neto secundario si queda saldo final relevante, pero no reordena.

<a id="fiscalidad-y-bono-social"></a>
### Fiscalidad Y Bono Social

- El descuento del bono social se resta antes de calcular IEE.
- El bono social solo aplica a PVPC, no a tarifas de mercado libre.
- El IEE puede existir con consumo 0 kWh si hay base de potencia u otros conceptos imponibles.
- La cuota minima legal del IEE (art. 99 Ley 38/1992) SI esta implementada: `desglosarIEE` en `lf-config.js` aplica `Math.max(porPorcentaje, porMinimo)` con flag `aplicaMinimo`. No reportes "falta la cuota minima del IEE" sin leer esa funcion.
- Los valores fiscales viven centralizados en `js/lf-config.js`; no dupliques reglas por modulo.

<a id="redondeo-exacto-de-impuestos-indirectos-y-paridad-entre-motores-resuel"></a>
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

<a id="igic-canarias-y-default-de-vivienda"></a>
### IGIC Canarias Y Default De Vivienda

- IGIC electricidad: 0% para personas fisicas en su vivienda con potencia <= 10 kW, 3% otros usos, 7% contador (Ley 4/2012 art. 52).
- El checkbox "vivienda en Canarias" de la UI decide entre 0% y 3%; el calculo aplica ambos correctamente (verificado con reconstruccion independiente en `tests/desglose-properties.test.js`).
- `calcularDesglose` tiene `esViviendaCanarias = true` como default de destructuring. No es un bug ni un riesgo fiscal: el llamador real (`desglose-integration.js`) siempre pasa el valor explicito del checkbox, y el default coincide con el caso domestico tipico del producto (hogar canario = 0%). Un default a `false` mostraria facturas infladas al usuario normal si un llamador futuro omitiera el flag, que seria peor.

<a id="month-key-en-bv"></a>
### `month.key` En BV

- El bucketizado mensual genera `YYYY-MM`.
- Si llega un formato inesperado, `bv-sim-monthly.js` emite `console.warn` y conserva fallback centralizado.
- No lo clasifiques como bug real salvo que demuestres una ruta que genere keys invalidas desde datos validos.

<a id="concurrencia-del-calculo-principal"></a>
### Concurrencia Del Calculo Principal

- `__LF_CALC_INFLIGHT` se asigna sin `await` entre lectura y escritura.
- En el navegador actual los handlers JS se ejecutan en un unico hilo; no hay intercalado real entre dos clicks.
- Es deuda futura solo si se introduce concurrencia real o Workers en el calculo principal.

<a id="concurrencia-y-privacidad-en-factura-pdf-ocr"></a>
### Concurrencia Y Privacidad En Factura PDF/OCR

- `factura.js` serializa el procesamiento PDF y OCR mediante identificadores generacionales (`__LF_operationSeq` y `__LF_activeOperation`), no solo con el booleano `__LF_FACTURA_BUSY`.
- Cada operacion asincrona comprueba que su identificador sigue vigente despues de los puntos de espera relevantes. Cerrar el modal invalida la operacion activa antes de limpiar referencias y DOM.
- El `finally` de una operacion invalidada no puede liberar el estado de otra operacion posterior.
- `__LF_pendingOperations` mantiene `__LF_PRIVACY_MODE` activo mientras exista trabajo sensible pendiente, aunque el modal ya se haya cerrado.
- No propongas sustituir este mecanismo por un simple `if (__LF_FACTURA_BUSY) return`: ese guard aislado no cubre correctamente cerrar, reabrir e iniciar otra operacion mientras una promesa anterior sigue finalizando.
- Antes de reportar una carrera en este flujo, demuestra una ruta que eluda `__LF_beginOperation`, los checkpoints de vigencia o la invalidacion de `__LF_closeModal`, y validala contra `tests/factura-integration.test.js`.

<a id="extractor-de-factura-pdf-consumos-enteros-del-qr-cnmc"></a>
### Extractor De Factura PDF: Consumos Enteros Del QR CNMC

- Cuando la factura incluye el QR/link del comparador de la CNMC, `factura.js` da prioridad a sus datos sobre el texto parseado del PDF dentro del flujo de proceso, campo a campo con fallback al parser.
- Los parametros `cfP1/cfP2/cfP3` de esa URL llegan como kWh enteros porque asi los imprime la comercializadora; el codigo hace `parseFloat` sin redondear nada (`__LF_parseQRData`).
- En facturas Octopus, la tabla de lecturas del contador ("Consumo kWh") tambien es entera y se usa a proposito como fuente primaria (comentado en `__LF_extractConsumoOctopus`).
- Por tanto, ver consumos enteros donde el texto de la factura muestra decimales NO es un bug de redondeo: es fidelidad a la fuente estructurada oficial. Desviacion maxima 0,5 kWh por periodo (centimos de euro).
- Decision de producto FIRME (14/07/2026): se prefiere el dato del QR porque es la misma informacion que la comercializadora declara a la CNMC. No proponer "usar el decimal del parser cuando difiera del QR"; ya se evaluo y se descarto.

<a id="qa-e2e-con-agentes-de-navegador-falsos-positivos-de-interaccion"></a>
### QA E2E Con Agentes De Navegador (Falsos Positivos De Interaccion)

**AMPLIACION 26/08/2026 — la pestana automatizada corre OCULTA, y eso falsea tiempos.** Un agente
de navegador trabaja con `document.visibilityState === 'hidden'`, y Chrome estrangula ahi el
trabajo de render. Dos falsos positivos reales en un mismo dia:
  - Los graficos Chart.js del Observatorio **no llegan a pintarse** (sin `requestAnimationFrame`),
    aunque los KPI de texto si aparecen. Parece que el render esta roto y no lo esta.
  - `Factura EP26` (DISA) parecia **colgada para siempre**: medido, 75 s sin terminar con la
    pestana oculta, cuando en primer plano completa en unos segundos. DISA es la mas sensible
    porque va por `Parser PDF` pero **recorre el bucle QR entero rasterizando paginas a canvas**
    antes de descartar el resultado.
**Regla: antes de reportar "se cuelga" o "no pinta" desde un agente, comprueba
`document.visibilityState`.** Si es `hidden`, no es un hallazgo: reproducelo a mano en primer
plano o pideselo al usuario. Lo que SI es fiable desde un agente: el DOM de texto, el estado de
`localStorage`, los datos servidos y la logica ejecutada directamente.

- Verificado el 14/07/2026: un agente QA con Chrome via MCP reporto que "Aplicar datos" del modal de factura no rellenaba la calculadora y arrastraba los valores de la factura anterior (3 casos, "reproducible"). Una reproduccion independiente con puppeteer-core y la misma secuencia exacta contra produccion demostro que el flujo funciona: modal correcto, inputs actualizados, toast de exito y autocalculo.
- Causa probable del falso positivo: el click del agente no llego a impactar el boton (viewport/scroll). Sintomas que lo delatan: no hay toast de exito NI de error, y la barra de estado conserva el texto inicial ("Rellena tus datos y calcula"); es decir, el handler nunca se ejecuto, porque `__LF_applyValues` siempre deja rastro (exito: toast + cierre de modal; validacion fallida: toast de error + campos marcados `.err`).
- Antes de reportar "el boton X no hace nada" desde un agente de navegador: comprueba toasts, clases `.err`, consola JS y que el elemento estaba visible en viewport al clicar; y reproduce con un segundo mecanismo de click antes de confirmarlo.
- Los valores extraidos que muestra el modal se leen de los inputs `#val_p1`, `#val_p2`, `#val_dias`, `#val_consumoPunta/Llano/Valle`; el CUPS no se muestra en la UI por privacidad (no es un campo ausente).

<a id="cargas-parciales-watchdog-y-telemetria-de-qa"></a>
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
- Desde el 22/08/2026 `json-invalid` cubre tambien invariantes de integridad del catalogo, ademas
 de los casos estructurales ya vigentes desde el 13/08/2026: (a) root inesperado (`null`, escalares,
 array raiz, objeto sin `tarifas`, `tarifas` que no es array), (b) `tarifas` vacio, (c) alguna entrada
 inutilizable segun `esTarifaUtilizable` (nombre no vacio, `tipo` 1P/3P y los cinco coeficientes base
 numericos finitos), (d) nombre comercial duplicado, (e) algun coeficiente base negativo y (f), si
 ya existe una copia sana de la misma `updatedAt`, cambio del conjunto de nombres o del contenido
 relevante para calculo/ranking respecto a esa misma generacion. La comparacion ignora el orden de
 filas y de propiedades. El guard de negativos es deliberadamente minimo: 0 sigue siendo valido (`p2`
 puede valer 0 por contrato) y NO se replican los rangos comerciales maximos/minimos del generador.
 La comparacion por `updatedAt` tampoco impone un numero minimo de tarifas: una version nueva puede
 tener menos filas y la misma version puede llegar reordenada. La validacion sigue siendo ATOMICA a
 proposito: una sola incoherencia descarta el dataset entero y conserva la copia sana en memoria. No
 propongas filtrar filas defectuosas y quedarse con el resto: dejaria un ranking incompleto sin que
 el usuario pueda saberlo.
- Las validaciones E2E del 22/07/2026 generaron trafico sintetico en ambas familias. Ventanas CONFIRMADAS: `09:00Z` (build `20260722-091724`) y `11:00Z` (build `20260722-103502`). El primer export mostraba 73 hits y cero eventos de error en `12:00Z`; el siguiente (`2026-07-22T14:53:53Z`) completo la agregacion hasta 83 hits y siguio con cero `error-*` y cero `init-incompleto/*`. La auditoria anunciada en esa hora no dejo senales de diagnostico y `12:00Z` no debe excluirse como ventana sintetica de esas familias. Moraleja practica: verifica en que cubos aparecen realmente los eventos; no heredes una ventana declarada ni des por contaminado todo el build.
- La normalizacion de errores acepta exclusivamente fuentes same-origin con protocolo HTTP(S). `tracking.js` (`sameOriginHttpSource`) y el buffer de `error-bootstrap.js` rechazan `blob:`, `data:` y protocolos distintos aunque aparenten compartir origen; `tests/error-bootstrap.test.js` cubre expresamente el caso `blob:`. Reporta cualquier regresion de este contrato como bug de cardinalidad/privacidad, no como hardening futuro.
- Verificado el 22/07/2026 contra produccion con Chrome real: caminos felices de home/solar/observatorio, diez bloqueos individuales de scripts y offline cortando tambien la red del target del Service Worker. `tracking.js` se recupero desde Cache Storage; no hubo excepciones JS ni violaciones CSP.

<a id="zonas-huerfanas-banner-aecc-shell-lite-y-registro-del-sw-resuelta-20-0"></a>
### Zonas Huerfanas: Banner AECC, Shell Lite Y Registro Del SW (RESUELTA 20/08/2026)

Esta pasada cubre la implementacion tecnica de `aecc-banner.js`, `shell-lite.js`, `theme.js`,
`error-bootstrap.js` y el registro normal de `lf-sw-update.js`. NO reabre la politica ya cerrada de
recarga automatica tras un arranque incompleto, el toast permanente ni el uso de `blob:` en los
loaders que lo necesitan.

- **Propiedad de `btnClearCache` en solar.** `bv-ui.js` ya era propietario de tema/menu y del
  borrado de cache mediante un listener delegado con confirmacion. `shell-lite.js` se diferia para no
  pisar tema/menu, pero registraba ademas un listener DIRECTO sobre `btnClearCache`. En el bubbling,
  ese handler directo corria antes que el delegado: incluso si el usuario cancelaba el `confirm()` de
  bv-ui, shell-lite ya habia empezado a borrar Cache Storage/desregistrar el SW y recargaba despues.
  Corregido haciendo que shell-lite ceda tambien ese control cuando los marcadores `data-bv-bound`
  demuestran que bv-ui termino de enlazar el shell. En Observatorio, donde no existen esos marcadores,
  shell-lite conserva el control.
- **Timer del banner ligado al calculo que lo origino.** Un `lf:results-ready` programa el banner a
  2,8 s. Si antes vence ese plazo empieza un segundo calculo, las filas anteriores pueden seguir en el
  DOM; el timer antiguo podia despertarse bajo el nuevo `requestedAt` y mostrar el banner antes de que
  existiera `results-ready` del segundo calculo. `lf:results-requested` cancela ahora cualquier
  show/retry pendiente y reinicia su contador. No cambia cooldown, texto, Bizum ni reglas de producto.
- **AECC es UI opcional para el watchdog.** Un fallo de descarga de `aecc-banner.js` se sigue
  registrando como `error-script-load`, pero ya no solicita `init-incompleto` ni recarga de pagina. La
  calculadora no depende de ese modulo; tratarlo como esencial podia gastar el unico auto-reload de la
  pestana y mostrar un aviso de carga incompleta por un complemento de donacion ausente.
- **Registro SW tras fallo transitorio.** Si el `navigator.serviceWorker.register()` del `load`
  fallaba y no existia registro previo, los triggers posteriores solo ejecutaban `getRegistration()` y
  `update()`: al obtener `null` no volvian a registrar nada, asi que esa pestana quedaba sin SW hasta
  otra navegacion. Los mismos triggers (`online`, `focus`, visible e intervalo) reintentan ahora
  `register()` cuando no existe registro y enlazan el mismo lifecycle de actualizacion. Los fallos de
  `update()` siguen siendo silenciosos y reintentables, como antes.
- **`theme.js` revisado sin hallazgo accionable.** La preferencia solo acepta `light` de forma
  explicita y cae a oscuro para ausencia/valor desconocido; los accesos a `localStorage` estan
  encapsulados; el listener legacy de `currentYear` lleva guard global contra duplicacion y solo
  intercepta las variantes documentadas de `not defined`; la carga de `inp-debug.js` esta limitada a
  debug y evita inyeccion duplicada. No se cambia este modulo.

**Tests de regresion y mutaciones plausibles:**

- `tests/shell-lite.test.js`: quitar la cesion por `data-bv-bound` vuelve a ejecutar la limpieza del
  shell en solar; el caso complementario impide arreglarlo deshabilitando `btnClearCache` tambien en
  Observatorio.
- `tests/aecc-banner.test.js`: quitar `clearTimeout(showTimer)` de `lf:results-requested` hace que el
  timer del primer calculo publique el banner durante el segundo.
- `tests/error-bootstrap.test.js`: retirar `aecc-banner.js` de la lista opcional vuelve a crear
  `__LF_PENDING_INIT_RECOVERY` por ese fallo.
- `tests/sw-update-timing.test.js`: volver a la implementacion que solo hace `getRegistration()` y no
  re-registra cuando devuelve `null` deja el segundo `register()` sin ocurrir; el test aislado exige
  ademas que el registro recuperado reciba su listener `updatefound`.

**No reportar como bugs:** que el banner no exista en movil/tablet; el cooldown de siete dias; el
texto/Bizum; que errores de AECC sigan apareciendo en telemetria; que los fallos ordinarios de
`registration.update()` no muestren toast; ni las decisiones de recarga automatica ya documentadas en
`Cargas Parciales, Watchdog Y Telemetria De QA`.

**Para reabrir:** demostrar que una pagina vuelve a tener dos propietarios activos para el mismo
control del shell; que un timer/retry del banner sobrevive a una nueva solicitud de resultados; que
una UI opcional vuelve a disparar recuperacion de pagina; o que, tras un fallo inicial de registro y
una oportunidad posterior real (`online`/focus/visible/interval), la pestana sigue sin intentar
registrar el SW.

<a id="arranque-sw-cache-storage-e-index-extra-opcional-resuelta-30-08-2026"></a>
### Arranque/SW: Cache Storage E `index-extra.js` Opcional (RESUELTA 30/08/2026)

Auditoria focalizada sobre el contrato de arranque, los fallos parciales y el Service Worker. Los dos
hallazgos se reprodujeron sobre el codigo vigente antes de integrar el parche externo; no se copiaron
los ficheros completos del paquete porque pertenecian a un build anterior.

- **Cache Storage no bloquea ya la red en runtime.** Las ramas de navegacion, scripts/estilos/workers,
  referencias de guias/asistentes, datasets/CNMC y estaticos abrian `CACHE_NAME` antes de ejecutar
  `fetch()`. Si `caches.open()` rechazaba por cuota, privacidad o indisponibilidad, la peticion
  terminaba sin intentar siquiera la red. `openRuntimeCacheSafe()` degrada ahora a cache nula: se
  conserva la estrategia de red y solo se omiten `match()`/`put()`. El `install` no usa este helper;
  su precache obligatorio sigue fallando de forma atomica si Cache Storage no esta disponible.
- **`index-extra.js` vuelve a respetar su contrato opcional.** `ARRANQUE-CARGA.md` ya documentaba que
  una descarga fallida del complemento del modal PVPC solo debia emitir `error-script-load`. El
  bootstrap, sin embargo, lo trataba como dependencia esencial: creaba una recuperacion inicial,
  mostraba el aviso persistente y podia consumir el unico auto-reload de la pestana. Ahora comparte
  la exclusion de recuperacion con `aecc-banner.js`; la telemetria temprana se conserva.
- **Cobertura reforzada.** `tests/sw-runtime-resilience.test.js` demuestra que las cinco familias
  runtime llegan a red aunque falle `caches.open()` y que `tarifas.json` sigue siendo network-only,
  sin `match()` ni `put()`. `tests/sw-query-fallback.test.js` valida los recursos de solar y
  observatorio dentro de `REQUIRED_ROUTE_GROUPS`, no solo en cualquier parte del worker.
  `tests/sw-update-timing.test.js` cubre fallos de lectura y escritura de `sessionStorage` en el guard
  de recarga automatica; `tests/error-bootstrap.test.js` fija la opcionalidad de `index-extra.js`.

**Mutaciones comprobadas:** reintroducir la apertura estricta de cache corta cinco rutas antes de
`fetch()`; volver esencial `index-extra.js` recrea la recuperacion pendiente; leer cache en la rama de
`tarifas.json`, sacar un asset de su grupo obligatorio o abrir el guard cuando `sessionStorage` falla
hace rojo su test especifico.

**No reportar como bugs:** que una visita sin Cache Storage pierda cache/offline durante esa sesion;
que el `install` del SW siga fallando cerrado; que el modal PVPC no este disponible si no se descarga
`index-extra.js`; o que ese fallo opcional permanezca visible en telemetria.

**Para reabrir:** demostrar una ruta runtime same-origin que no alcanza la red al rechazar
`caches.open()`; que una UI opcional vuelve a solicitar recuperacion de pagina; que `tarifas.json`
intenta leer/escribir Cache Storage; o que un fallo de persistencia permite un bucle de recarga.

<a id="formato-numerico-coma-en-ui-punto-en-mocks-de-tests"></a>
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

<a id="numeros-con-punto-de-miles-validador-asimetrico-y-bypass-de-safeurl-re"></a>
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


<a id="dominio-2-0td-y-validacion-de-factura-pdf-resuelta"></a>
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

<a id="rendimiento-de-renderizado"></a>
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

<a id="ceros-validamente-contratados-integracion-por-lineas-y-rango-de-dias-r"></a>
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

<a id="extractor-de-factura-pdf-separacion-dimensional-kw-kwh-eur-dias"></a>
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

<a id="extractor-de-factura-pdf-lecturas-de-contador-frente-a-consumo-factura"></a>
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

<a id="extractor-de-factura-pdf-potencia-contratada-frente-a-maximas-demandad"></a>
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

<a id="qr-cnmc-confianza-validacion-y-pdf-multi-factura"></a>
### QR CNMC: Confianza, Validacion Y PDF Multi-Factura

El QR de la CNMC es la fuente de mayor confianza del extractor, asi que su validacion es estricta.
`__LF_isTrustedCnmcQrUrl()` exige `https:`, hostname exacto `comparador.cnmc.gob.es` y una de las
dos rutas exactas verificadas en facturas reales: `/comparador/QRE` o `/comparador/QRE2`. No se
aceptan prefijos (`QRE20`), sufijos ni subrutas. Un host parecido
(`comparador.cnmc.gob.es.ejemplo.com`) o cualquier otra ruta se rechaza. Antes de otorgar confianza
100, P1/P2 y los tres consumos deben ser numericos finitos y cumplir rangos basicos.

- Una factura real verificada el 24/08/2026 contiene `QRE2` como anotacion de enlace del PDF. Los
  parametros electricos mantienen el contrato de `QRE`; rechazar la nueva ruta hacia que el flujo
  cayese al parser textual. La regresion cubre tanto la extraccion del enlace como el QR por imagen,
  porque ambos pasan por la misma allowlist exacta antes de parsear sus parametros.
- En ese mismo formato, la tabla `Lectura | Fecha | P1 | P2 | P3` termina en una fila
  `Consumo (kWh) <P1> <P2> <P3>`. Esa fila se reconoce de forma estructural aunque el QR no exista o falle.
  Solo se aceptan exactamente tres magnitudes en la misma linea: no se recortan tablas de cuatro o
  seis columnas ni se cruzan saltos de linea. Antes, el fallback compacto podia asociar P1/P2/P3 con
  componentes de `23/06/2026` y aun declarar 100% de confianza.

- Las unidades se validan dimensionalmente: P1/P2 admiten numero desnudo o sufijo `kW`; cfP1/cfP2/cfP3
 numero desnudo o sufijo `kWh`. Un sufijo de dimension distinta o texto residual invalida el QR.
- Los nombres de parametro se tratan sin distinguir mayusculas, como permite la resolucion CNMC.
- Las fechas `iniF`/`finF` se validan con formato AAAA-MM-DD y comprobacion de ida/vuelta UTC, porque
 `Date` convierte `2026-02-31` en marzo. Si la fecha es imposible, los datos numericos validos se
 conservan y `dias` queda `null` para que lo complete el PDF.
- La semantica `iniF`/`finF` es inicio excluido, fin incluido, distinta del rango textual `del X al Y`
 de la factura, que es inclusivo. Ver la entrada de dias.
- Decision de producto (25/08/2026): cuando el QR CNMC supera la validacion estricta, sus campos son
  la fuente de verdad. El parser textual solo completa ausencias; ya no puede sobrescribir `dias`
  ni otro campo estructurado por una discrepancia con el texto visible. El caso real que motivo el
  cambio tenia `iniF=2026-07-15`, `finF=2026-08-14` (30 dias) y una direccion acabada en `1ºD` que
  el fallback abreviado interpretaba como un dia. Ademas de la prioridad QR, el patron `N d` exige
  ahora espacio y se reconocen `Dies: N` / `(N dies)` en catalan.
- Los parametros contractuales/economicos opcionales se validan por tipo antes de mostrarse. Se
  descartan deliberadamente `cups`, `cp` y la URL completa. Aunque la resolucion de 2022 documenta
  `com=R2-XXX`, el censo vivo ya contiene `R2-1000` y posteriores: parser, resolvedor y sincronizador
  aceptan tres o cuatro cifras. `data/cnmc-commercializers.json` es una copia local regenerable con
  `npm run sync:cnmc-commercializers`; el navegador no consulta a CNMC ni envia datos de factura.
- El censo del 25/08/2026 tiene 937 filas y 936 codigos unicos: 782 de tres cifras y 154 de cuatro.
  `R2-222` aparece como sociedad historica de baja y sucesora activa; el sync elige explicitamente
  la activa y registra el duplicado. Las columnas se resuelven por encabezado, los codigos R2 con
  formato no contemplado hacen abortar y `_meta` conserva fecha/recuento/incidencias. La unica web
  invalida actual (`R2-1123`) se omite sin perder la razon social; una proporcion anomala abortaria.
- El sync registra tambien los codigos cuyo estado seleccionado es `Baja`, para que una transicion
  administrativa no quede oculta si nombre, telefono y web permanecen iguales. El sanity check es
  una funcion exportada y probada contra la regresion exacta de 782 entradas sin codigos de cuatro
  cifras. La Action mensual solo auto-publica hasta 20 altas puramente aditivas; cualquier baja,
  eliminacion, modificacion de una entrada existente o cambio en duplicados/webs invalidas/estados
  falla antes del commit y exige revision manual.
- Decision de producto (03/09/2026): la regla anterior queda SUPERADA. La Action pasa a modo espejo
  y replica lo que sirva la CNMC —altas, bajas, renombrados, contactos y metadatos— sin revision
  previa. Motivo: en tres dias abrio dos issues de revision manual (#17 el 01/09 y #18 el 03/09) por
  cambios que no afectaban a nada. El del 03/09 eran dos comas en la razon social (`WIND TO MARKET
  S.A` -> `WIND TO MARKET, S.A.` y `COLABORA ENERGIA ARGUS SL` -> `COLABORA ENERGIA ARGUS S.L.`) mas
  11 codigos que pasaban a `inactiveCodes`, un metadato que el frontend no consume; ninguna de las 13
  aparecia en `tarifas.json`. Ese ruido recurrente enseña a ignorar los avisos que si importan, y lo
  que interesa del censo es tener el listado replicado. Lo que NO cambia: el scraper sigue abortando
  si cambia el formato de la tabla, el sanity check de volumen/centinelas sigue vigente y los tests
  del censo se ejecutan SIEMPRE antes del commit, ahora sin condicionar al tipo de cambio. Es decir,
  solo detiene la publicacion un fallo propio, nunca el contenido del listado.
  `classify-cnmc-commercializers-update.mjs` se conserva como descripcion del diff para el resumen
  del run y el mensaje de commit; ya no gobierna el flujo, y `TYPICAL_ADDITIONS_BATCH` (antes `MAX_AUTOMATIC_ADDITIONS`) deja de tener
  efecto sobre lo que se publica.
- Hallazgo del 03/09/2026 al revisar ese censo: la validacion de webs solo miraba el protocolo, y
  `new URL('http://https//capturaenergia.com/')` no lanza —da protocolo `http:` y hostname `https`—,
  asi que una errata de la CNMC con el esquema escrito dos veces pasaba el filtro del sync y el de
  `js/factura.js`, y el extractor habria pintado un enlace "Web oficial" que no lleva a ninguna
  parte. Ambos exigen ahora un hostname con al menos un punto y sin etiquetas vacias. Descarta 5
  webs rotas sin perder ninguna legitima: `R2-1081`, `R2-1104`, `R2-1107` y `R2-870` traian el
  esquema escrito dos veces, y `R2-496` un punycode sin TLD (`http://xn--bonreaenergia-rdb/`). Las
  entradas con web pasan de 846 a 841. Cubierto en el parser, con un
  guardrail sobre el censo real publicado y con un test de comportamiento sobre la ficha visible.
- `data/cnmc-commercializers.json` sigue precacheado para disponibilidad offline, pero tiene ruta
  `network-first` propia con fallback sano. Asi un commit mensual llega a un SW ya instalado sin
  depender del siguiente cambio de `CACHE_VERSION`.
- Gate real del 25/08/2026: 11/11 facturas historicas procesadas por la interfaz en Chrome mantienen
  confianza 100%, cero errores de navegador y los mismos campos que el commit limpio salvo
  Plenitude, cuyo dia cambia intencionadamente de 32 a 31 al aplicar la semantica de su QR. Las dos
  facturas Bonpreu verificadas devuelven 30 y 28 dias, `BON PREU, SAU` y ficha CNMC. La ficha se
  reviso ademas en las cuatro combinaciones oscuro/claro por escritorio (1280x900) y movil
  (390x844): sin overflow horizontal, con scroll vertical operativo y sin errores de consola.
- Gate repetido tras ampliar el censo y separar procedencias: las 11/11 mantienen sin diferencias
  confianza, comercializadora, potencias, dias y consumos. La distribucion real queda visible: 9
  `Enlace CNMC + respaldo PDF`, 1 `QR CNMC + respaldo PDF` (Plenitude) y 1 `Parser PDF` (DISA).
  Plenitude conserva 100% y muestra el aviso no bloqueante 32 -> 31. El aviso y el badge se revisaron
  de nuevo en claro/oscuro y escritorio/movil: sin overflow, sin errores y con el scroll de `BODY`
  moviendose en las cuatro combinaciones.

**PDF con varias facturas.** `__LF_extraerTextoPDF()` concatena todas las paginas. Si el PDF trae dos
facturas y solo la segunda lleva QR, el rango textual encontrado puede ser el de la primera mientras
los numeros vienen del QR de la segunda. `__LF_parseQRData()` conserva las fechas ya validadas del QR
como metadatos internos (`_fechaInicio`/`_fechaFin`) y en el modelo informativo saneado; `factura.js`
compara ese rango con el que el parser dice haber usado, con **tolerancia de 2 dias**. Si no casan, se
conservan los dias del QR, la confianza baja a 75% (por debajo del umbral de autocalculo) y se avisa.

La tolerancia evita marcar como multifatura una factura normal con el pequeño desplazamiento entre
lecturas y periodo impreso. Incluso si el texto visible expresa otro numero, un QR valido conserva
sus dias por la semantica CNMC documentada; la tolerancia solo decide si se rebaja la confianza por
posible mezcla de facturas, no que fuente sobrescribe el campo.
Cuando los periodos siguen siendo compatibles pero los dias difieren, la confianza se mantiene y
la UI muestra un aviso no bloqueante con los dias detectados en PDF, los usados desde QR y la
semantica inicio excluido/fin incluido. El badge conserva ademas la procedencia: `Enlace CNMC` para
la URL embebida en texto/anotacion y `QR CNMC` para la ruta rasterizada con jsQR.

**Ojo al construir un PDF de prueba:** una URL de QR en una sola linea a 9pt se sale del ancho de
pagina y pdf.js no extrae el final de la cadena, asi que el QR llega truncado y el caso no se
reproduce. A 5pt cabe entera. No confundir ese artefacto del fixture con un fallo del lector.

**No todo QR en una factura es de la CNMC.** Varias comercializadoras imprimen un QR comercial hacia
su app; se decodifica bien pero se rechaza por no ser de la CNMC, y los datos salen del texto. No es
un fallo del lector de QR ni del limite de paginas.

<a id="dias-de-facturacion"></a>
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

<a id="peajes-fuera-de-2-0td"></a>
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

<a id="observatorio-ausencia-de-datos-frente-a-cero"></a>
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
- RESUELTA (25/08/2026): el mes natural en curso puede ser sano y fresco aunque solo llegue hasta el
 ultimo dia publicado. La tendencia mensual conserva esa media hasta la fecha y la etiqueta como tal,
 pero `Mejor/Peor mes` solo usa meses cerrados y la comparativa interanual deja hueco para el mes
 abierto. Un `provisionalDays` impide considerarlo cerrado incluso si ya existe la ultima fecha natural:
 una media MTD no se presenta como equivalente a un mes completo de otro anyo.
- RESUELTA (25/08/2026): el perfil horario conserva la procedencia de cobertura. Un mes fallido en la
 vista anual marca el consejo como parcial, y un dia `provisionalDays` se cuenta como provisional en
 vez de como dia completo. Al seleccionar un mes concreto solo se conserva el fallo si corresponde a
 ese mismo mes; no se heredan avisos de otros meses.
- RESUELTA (25/08/2026): `computeRolling12m()` exige al menos una observacion del anyo seleccionado
 para anclar la ventana. Si ese anyo falla por completo pero el anterior esta en cache, ya no puede
 aparecer la media del anyo anterior bajo el KPI `Media 12 meses`.
- RESUELTA (25/08/2026): los parametros del Observatorio se normalizan en la frontera de URL.
 `type`, `geo`, `year`, `month` y `trendMode` solo aceptan estados representables; `compareYears`
 elimina duplicados/no enteros/fuera de rango y queda limitado antes de cargar series.

`js/pvpc-stats-csv.js` replica estos campos, pero conviene saber que **todo su cuerpo es un fallback**
que solo corre si `js/lf-surplus-prices.js` no llego a cargarse. Para probarlo hay que forzar esa
ruta. Su filtro de `best`/`worst` es defensivo e inalcanzable (este modulo no crea la fila de un mes
sin horas valoradas) y su test lo documenta: no lo quites creyendo que falta cobertura.

<a id="simulador-solar-rotacion-del-patron-anual-y-ranking"></a>
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

<a id="csv-generacion-frente-a-exportacion"></a>
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

<a id="robustez-ante-datos-estaticos-degradados-en-data-resuelta-20-08-2026"></a>
### Robustez Ante Datos Estaticos Degradados En `data/` (RESUELTA 20/08/2026)

Esta entrada cubre la frontera runtime de `data/pvpc/`, `data/surplus/`, `data/ssaa/` y
`data/guides-search-index.json`. NO reabre el modo hibrido PVPC, el contrato de disponibilidad SSAA,
la ausencia frente a cero del Observatorio ni las reglas de dia/mes y DST ya documentadas.

**Identidad antes de cobertura, con compatibilidad explicita.** Un mensual horario puede tener
23/24/25 horas perfectas y aun ser el fichero equivocado. `validateStaticPriceDatasetIdentity`
(`js/lf-csv-utils.js`) comprueba `schema_version:2` y, cuando corresponde, `geo_id`, indicador
(1001 PVPC / 1739 excedentes), `EUR/kWh`, epoch en segundos y timezone. La politica NO es identica
en todos los consumidores:
- Las rutas PVPC primarias y el motor anual del Observatorio exigen metadata completa y coherente.
- Las rutas que ya admitian payloads v2 sin toda esa metadata (`lf-surplus-prices.js`, el fallback
  `pvpc-stats-csv.js` y la vista rapida de `index-extra.js`) conservan compatibilidad: un campo
  AUSENTE no basta para invalidar el mensual, pero cualquier campo PRESENTE y contradictorio se
  rechaza. Esto evita convertir fixtures/datasets historicamente aceptados en *negative-cache* y, a
  la vez, impide utilizar como precio un fichero que se identifica explicitamente como otra zona,
  indicador, unidad o epoch.

**Timezone de excedentes y CCH-CONS son contratos distintos.** No imponer `Europe/Madrid` desde la
identidad del indicador 1739 sobre la valoracion CCH-CONS. El loader normal de excedentes usa la
`timezone` declarada por el dataset y solo recurre al geo si falta. Se mantiene cerrada la regla DST
ya auditada: el dia corto de marzo tiene 23 horas; desaparece la 02:00 en Peninsula y la 01:00 en
Canarias. El test preexistente de 23 horas en ambas zonas es parte del contrato y no debe adaptarse
a futuras validaciones de metadata. El motor anual del Observatorio puede seguir exigiendo la
metadata completa generada por sus artefactos; eso no redefine el reloj CCH-CONS.

**Manifest del Observatorio.** Los `index.json` por zona descubren ficheros pero no definen la
completitud anual. `monthsExpected` sale del calendario conocido (junio 2021 en adelante y sin meses
futuros). Si un manifest degradado omite febrero de un ano cerrado, febrero se intenta igualmente;
un 404/JSON invalido/mes no utilizable entra en `failedMonths`, deja `partial:true` y evita cachear
el ano. NO re-proponer "pedir solo los meses del manifest" como optimizacion: vuelve a permitir que
un indice incompleto esconda datos ausentes y publique KPIs anuales como completos.

**SSAA.** La carga positiva exige identidad (`schema_version:1`, indicador 10328, `EUR/kWh`,
`Europe/Madrid`), mapa `values` utilizable, coherencia entre `latest_complete_month`, `latest_value`
y `to`, y que TODOS los rates publicados sean finitos y cumplan el rango de plausibilidad que ya
protege `tests/ssaa-dataset.test.js`: `0 <= rate < 0.1 EUR/kWh`. Validar solo el ultimo mes no vale:
un historico corrupto podria llegar despues a un calculo de ese periodo. **Cero es valido** y no debe
confundirse con ausencia. Un mes historico ausente sigue devolviendo `historical-month-unavailable`;
no se sustituye por el ultimo mes completo.

**Red/body.** `fetchWithTimeout()` conserva su API para callers existentes. Los loaders JSON
monetarios que pueden usar `lf-csv-utils.js` llaman a `fetchJsonWithTimeout()`: el mismo
`AbortController` permanece vivo hasta terminar `response.json()`. Antes, el timer se limpiaba al
recibir headers; un 200 cuyo body quedara abierto podia bloquear indefinidamente pese a "tener
timeout". Hay dos excepciones deliberadas:
- `index-extra.js` mantiene exactamente su contrato historico `fetch(url, {cache:'no-cache'})`, que
  ya observan tests preexistentes. Usa un deadline local con `Promise.race` que deja de esperar
  fetch+body y purga la Promise fallida para reintentar, pero NO aborta el request subyacente.
- `guides-search.js`, que no carga `lf-csv-utils.js`, usa un `AbortController` local hasta consumir
  el JSON; ante timeout/HTTP/JSON/esquema invalido cae a busqueda basica y una busqueda posterior
  puede reintentar.

**Valores y estructuras que NO son bugs:**
- Precios PVPC o de excedentes negativos son validos en el mercado y NO deben rechazarse por signo.
  `null`, strings, NaN/Infinity runtime o timestamps fuera del dia civil se rechazan por los
  validadores existentes. No inventar un maximo arbitrario para PVPC/excedentes sin contrato nuevo.
- Un 404/500/timeout nunca equivale a precio cero. Las rutas monetarias fallan cerradas o marcan
  cobertura ausente segun el contrato ya documentado; los fallos no se guardan como cache positiva.
- Metadata de identidad AUSENTE en las rutas de compatibilidad anteriores no es, por si sola, un
  bug ni motivo de *negative-cache*. Metadata PRESENTE y contradictoria si invalida el payload.
- Que el Observatorio intente un mensual que el manifest omitio es deliberado: el manifest no puede
  rebajar la expectativa de completitud.
- `data/guides-search-index.json` degradado no es una cifra economica: la UI usa busqueda basica y
  permite reintento.
- `js/config.js` solo publica las rutas base (`PVPC_DATASET_BASE`, `SSAA_DATASET_URL`); no parsea ni
  normaliza datasets, por lo que no necesita una segunda validacion.

**Criterio de reapertura:** demostrar un consumidor nuevo que publique/cachee un mensual con
metadata explicitamente contradictoria; que una ruta estricta deje de exigir la identidad completa
que su formato garantiza; que vuelva a usar el manifest como autoridad de meses esperados; que
acepte SSAA fuera del contrato anterior; que transforme ausencia/error en cero; o que lea JSON
estatico sin un deadline que cubra tambien el body. Un fallo que acaba honestamente en "dato no
disponible" no se reclasifica como cifra incorrecta.

**Regresiones de referencia nuevas:** `tests/pvpc-day-coverage.test.js`, `tests/pvpc.test.js`,
`tests/index-extra-pvpc-cache.test.js`, `tests/surplus-prices.test.js`,
`tests/pvpc-stats-csv-fallback.test.js`, `tests/pvpc-stats-engine.test.js`,
`tests/ssaa-helper.test.js`, `tests/network-timeout-contract.test.js` y
`tests/guides-search-resilience.test.js`. **Contratos preexistentes que tambien deben seguir verdes:**
`tests/index-extra-pvpc-context.test.js` (opciones exactas de fetch),
`tests/pvpc-stats-ui.test.js` (reintento 503/200 malformado) y el caso CCH-CONS 23h de
`tests/surplus-prices.test.js`.

<a id="autorreporte-de-violaciones-csp-del-endpoint-analitico-resuelta-25-08"></a>
### Autorreporte De Violaciones CSP Del Endpoint Analitico (RESUELTA 25/08/2026)

**Fallo original.** El listener de `securitypolicyviolation` de `js/tracking.js` construia un
evento `error-csp` para CUALQUIER violacion, incluida la del propio endpoint de GoatCounter. Como
`error-csp` es familia persistente (`isPersistentDiagnosticPath`), cada intento escribia ademas en
el outbox `lf_error_outbox_v1`, y las entradas del outbox fuerzan `force_image = true`, asi que el
reenvio creaba un `<img>` hacia el endpoint bloqueado. Esa imagen generaba otra violacion, con un
objeto `Event` nuevo que el `WeakSet` `handledCspEvents` no podia reconocer: realimentacion sin
freno. El comentario del propio upstream de GoatCounter lo anticipa ("This mostly fails due to
being blocked by CSP").

**Alcance real.** NO alcanzable con la CSP propia del sitio: las 35 paginas que cargan
`tracking.js` permiten `https://luzfija.goatcounter.com` en `img-src` y en `connect-src`. La unica
pagina sin esos permisos es `guias/index.html`, que no carga tracking. Un adblocker corriente
tampoco lo dispara, porque bloquea por red (`webRequest`) y eso no emite `securitypolicyviolation`.
Hace falta una CSP externa (proxy corporativo, politica inyectada) o una regresion futura del
repositorio. Por eso la severidad es BAJA pese a la violencia del mecanismo.

**Medicion real del mecanismo** (Chrome, laboratorio local con CSP hostil, 25/08/2026): sin el
guard, **33.061 violaciones CSP en 10 segundos** (~3.300/s, crecimiento lineal sin freno) y el
outbox saturado en su tope de 64 entradas, expulsando diagnosticos utiles. Con el guard, **1
violacion estable y outbox 0**. Control negativo en el mismo laboratorio y repetido despues contra
produccion: una imagen de dominio ajeno sigue generando `error-csp/img-src`.

**Correccion.** `isAnalyticsEndpointCspViolation()` en `js/tracking.js` compara el `origin` de
`blockedURI` con el del endpoint (`getGoatEndpointFromPage()`), y el handler corta antes de
construir el evento y antes de tocar el outbox. El criterio es **el recurso bloqueado, no la
directiva**.

**Descartado a proposito: filtrar por directiva.** La primera propuesta externa descartaba
`img-src`/`default-src` y conservaba `connect-src` "porque aun puede notificarse por imagen". Se
**rechazo**: una CSP que no conoce el endpoint bloquea AMBAS directivas, asi que cada intento
genera dos violaciones y el bucle sigue girando por el eje `connect-src`. La medicion lo confirma:
en el laboratorio aparecen las dos directivas. Tambien se descarto un corte por "N violaciones en
la misma carga": el guard por recurso es determinista y no sacrifica diagnosticos ajenos.

**Guardrail de regresion.** `tests/tracking-html-coverage.test.js` cruza las dos condiciones: toda
pagina que cargue `js/tracking.js` debe permitir el endpoint en `img-src` y `connect-src`,
aplicando la herencia de `default-src` solo cuando falta la directiva especifica. Sustituye a la
comprobacion anterior, que solo miraba `connect-src` y por regex sobre el HTML crudo. Validado
mutando el DATO (quitando el endpoint de cada directiva en `index.html`): el test nombra la pagina
y la directiva exactas.

**No reportar como bug**:
- Que una violacion CSP del endpoint analitico no aparezca en GoatCounter. Es el invariante: un
  canal bloqueado no puede notificar su propio bloqueo. El guardrail estatico cubre el caso interno.
- Que `handledCspEvents` no deduplique violaciones sucesivas. Es un `WeakSet` por objeto `Event`
  para una reevaluacion del modulo, no un antirebote.

**Para reabrirlo** hace falta demostrar una violacion de recurso NO analitico que el guard
descarte, o un camino que vuelva a persistir `error-csp` en el outbox con el endpoint bloqueado.

<a id="skipgc-y-el-getter-de-localstorage-en-el-sender-resuelta-25-08-2026"></a>
### `skipgc` Y El Getter De `localStorage` En El Sender (RESUELTA 25/08/2026)

**Fallo original.** `vendor/goatcounter/count.js` leia `localStorage.getItem('skipgc')` dentro de
`filter()` sin `try/catch`. Cuando la politica del navegador deniega el almacenamiento, el throw
ocurre al ACCEDER a la propiedad `window.localStorage`, asi que el cortocircuito `localStorage &&`
no protege nada: `filter()` lanzaba y el pageview automatico del sender no llegaba a enviarse. Los
eventos explicitos no rompian la web porque `sendPayload()` envuelve la llamada, pero se perdian
en silencio.

**Correccion.** `skipgc_enabled()` y `set_skipgc_enabled()` encapsulan lectura y escritura; si el
almacenamiento no es accesible, el sender continua como si `skipgc` no estuviera activado. De paso
se corrige un fallo del upstream en el toggle (`removeItem('skipgc', 't')` con dos argumentos) y
las alertas solo se muestran si la operacion tuvo exito.

**Frontera y vendor.** El fix vive en el sender porque `skipgc` es una preferencia propia de
GoatCounter y el pageview automatico se origina dentro de el. `vendor/goatcounter/` **si se puede
tocar** para este fichero: el proyecto mantiene `count.local.patch` (ahora cuatro parches locales)
sobre `count.upstream.js`. Comprobacion obligatoria tras cualquier cambio ahi: aplicar el parche
sobre el upstream debe reproducir `count.js` byte a byte, y `tests/vendor-inventory.test.js` exige
ademas SHA-256 y coherencia de inventario.

**No reportar como bug**: que `skipgc` sea inoperante con almacenamiento denegado. Es la decision:
una comodidad de depuracion no puede desactivar la analitica por una excepcion de plataforma. El
opt-out real del proyecto es `goatcounter_optout`, independiente y con su propio `try/catch`.

<a id="entrega-del-outbox-de-diagnosticos-al-menos-una-vez-deliberado"></a>
### Entrega Del Outbox De Diagnosticos: Al Menos Una Vez (DELIBERADO)

`lf_error_outbox_v1` garantiza entrega **al menos una vez**, no exactamente una vez.
`hydrateDiagnosticOutbox()` encola todas las entradas al evaluar el modulo y solo se borran en
`on_sent`; no hay listener `storage` ni lease entre documentos. Una recarga entre el inicio del
envio y su confirmacion (o una segunda pestana) puede reenviar la misma aparicion, sumando dos
veces en el contador `/diferido`.

**Se decide no corregirlo.** Coordinar exactamente entre pestanas exigiria estado compartido nuevo
(lease, `BroadcastChannel`, evento `storage`) y abre el fallo inverso: dar por consumida una
entrada cuya peticion nunca llego. El sufijo `/diferido` ya marca esas filas como aproximadas y
existe la regla editorial de no datarlas por hora. Perder un diagnostico es peor que contarlo dos
veces. No reportar como bug salvo que se demuestre impacto sobre un dato que el autor use como
exacto.

<a id="rango-de-anyos-del-observatorio-una-sola-fuente-de-verdad-resuelta-25"></a>
### Rango De Anyos Del Observatorio: Una Sola Fuente De Verdad (RESUELTA 25/08/2026)

**Fallo original.** El rango de anyos vivia en TRES sitios sin relacion entre si: las
`<option>` cableadas a mano en el `<select id="yearSelector">` de `estadisticas/index.html`
(2021..2026), el `2021 <= year <= now.getFullYear()` de `parseParams()`, y el
`minYear = 2021` de `normalizeSelectedYears()`. Los dos ultimos son dinamicos; el primero
no.

**Consecuencia, con fecha de activacion.** El 1 de enero de 2027, `parseParams()` devuelve
`year: '2027'` (su default es `String(now.getFullYear())`), `applyStateToControls()` hace
`els.year.value = '2027'`, y como esa `<option>` no existe **el navegador descarta la
asignacion**: `value === ''` y `selectedIndex === -1`. El estado interno sigue trabajando
con 2027 y los datos cargan bien, pero **el control aparece vacio para todos los
visitantes**. Reproducido en jsdom antes de corregir:

```
select.value = '2027'  ->  value: ""     selectedIndex: -1     (opciones 2021..2026)
select.value = '2026'  ->  value: "2026"  selectedIndex: 0
```

Hallazgo de Codex en la revision independiente de las rondas 11 y 12. No era alcanzable
antes de que el reloj cruzara el anyo: hoy `?year=2027` se rechaza en `parseParams()` y cae
al default, asi que nadie podia tropezar con el por accidente hasta que afectase a todo el
mundo a la vez.

**Correccion.** `DATASET_MIN_YEAR = 2021` (primer anyo del dataset, que arranca en
`2021-06`) como **fuente unica**, con `getAvailableYearsDesc()` y `populateYearSelector()`.
Las tres consumen la misma constante y el `<select>` del HTML se queda **sin opciones
cableadas**: las genera el JS. `applyStateToControls()` puebla ANTES de asignar el valor,
porque al reves el `<select>` ya habria descartado el `value`. `populateYearSelector()`
solo reconstruye si el rango difiere, para no perder la seleccion en un re-render.

**No cablear anyos en el HTML.** Es la regla que deja este fallo cerrado. Si vuelven a
aparecer `<option>` de anyo en `estadisticas/index.html`, el guardrail
`tests/pvpc-stats-ui.test.js` lo detecta.

**Cobertura.** Cinco tests: HTML sin `<option>`, rango generado desde `DATASET_MIN_YEAR`,
**rollover simulado** (31/12/2026 no ofrece 2027; 01/01/2027 si, y el `value` se acepta),
repoblado que conserva la seleccion, y un guardrail de CABLEADO que comprueba sobre el
cuerpo real de `applyStateToControls()` que se puebla antes de asignar. Este ultimo existe
porque las tres primeras mutaciones (borrar la llamada, invertir el orden) pasaban en verde
sin el: un helper correcto que nadie invoca no arregla nada.

**Trampa al escribir tests de rollover**: el rango sale de `getFullYear()`, que es hora
LOCAL. Una fecha como `2026-12-31T23:00:00Z` ya es 2027 en `Europe/Madrid`, y el test se
vuelve contradictorio consigo mismo. Usar mediodia.

<a id="precios-del-qr-frente-a-descuentos-de-la-factura-resuelta-25-08-2026"></a>
### Precios Del QR Frente A Descuentos De La Factura (RESUELTA 25/08/2026)

**El problema, que no es de calculo sino de significado.** La Resolucion de la CNMC
(BOE-A-2022-16989) define `prE1/prE2/prE3` y `prP1/prP2` como precios **sin impuestos ni
descuentos**, mientras que `impEner` e `impPot` SI incorporan los descuentos asociados a esos
terminos. La casilla que vuelca esos precios a "Mi tarifa" vive bajo un rotulo que promete
"Comparar con mi tarifa **actual**". Para quien tenga un descuento, importar el precio base
haria parecer su tarifa mas cara de lo que paga y lo hundiria en el ranking, con confianza 100
y sin un solo aviso. Detectado por ChatGPT en la revision cruzada del 25/08/2026.

**Por que no basta con mirar `dto`.** La propia resolucion permite que el descuento venga ya
incorporado al importe y NO aparezca en ese campo. Un guard del tipo `if (dto > 0) bloquear`
dejaria pasar justo los casos que no declara.

**Correccion: contrastar, no adivinar.** Los importes ya estaban en el modelo
(`factura-parsers.js` extrae `impPot`, `impEner`, `dto` y `dtoBS`) pero solo se pintaban en la
ficha. `__LF_qrPricesMatchDeclaredAmounts()` cruza lo que se va a importar contra lo que la
factura dice haber cobrado:

    energia:  SUM(consumo_i x precio_i)                 vs  impEner
    potencia: SUM(kW_i x precio_i) x dias               vs  impPot

Si alguno se desvia mas de la tolerancia, **no se ofrece la casilla** y se explica por que. La
ficha completa se sigue mostrando y la confianza NO baja: los consumos, potencias y dias del QR
siguen siendo validos; lo unico que se retira es el volcado de precios. Cuando el QR no trae el
importe con el que contrastar, no se bloquea nada (se conserva el comportamiento anterior).

**Tolerancia y por que ese numero.** 2% relativo o 0,15 EUR absolutos. Los consumos del QR
(`cfP1/2/3`) llegan en kWh ENTEROS, asi que una parte del desvio es redondeo de la fuente, no
descuento. Medido sobre facturas reales del banco de pruebas SIN descuento: la potencia cuadra
al centimo (desvio 0,00%) y la energia se desvia ~0,2%, coherente con hasta 1,5 kWh de redondeo
repartidos en tres periodos. Un descuento real es de otro orden de magnitud (el test de
regresion usa uno del 25%).

**HALLAZGO COLATERAL, y es el mas util a largo plazo: el QR confirma que el divisor es 365.**
Al hacer ese contraste sale que `prP x kW x dias/365` reproduce `impPot` **exactamente**, al
centimo, en las facturas reales. Con 366 no cuadra. Es decir, la base comercial de 365 dias que
usa `__LF_qrAnnualPowerPriceToDaily()` — y con la que el motor prorratea peajes desde siempre —
no es solo una convencion interna del proyecto: **la confirma la propia fuente normativa**. Ese
mismo dia se habia cambiado de "dias reales del anyo" a 365 fijo por coherencia con
`js/pvpc.js`; esta comprobacion lo cierra con evidencia externa.

**Los cuatro bordes que costaron tres iteraciones** (revision cruzada con ChatGPT, 25/08/2026;
cada uno era un falso positivo capaz de acusar de descuento a quien no lo tiene):

1. **`cambio=1` (cambio de precios DENTRO del periodo facturado).** La resolucion dice que en
   ese caso `prE*`/`prP*` traen el precio ACTUALIZADO mientras `impEner`/`impPot` suman los dos
   tramos. El contraste no puede distinguir eso de un descuento, asi que se sale antes con
   `motivo: 'cambio-precios-periodo'` y un aviso propio que **no menciona la palabra descuento**.
2. **Procedencia de `dias`.** Cuando el QR no trae `iniF`/`finF` validos, la combinacion de
   fuentes rellena `dias` desde el PDF. Validar el `impPot` DECLARADO POR EL QR con dias de otra
   fuente no es un contraste homogeneo: la potencia solo se contrasta si `qrInfo.fechaInicio` y
   `qrInfo.fechaFin` existen, que es la senal de que el periodo pasa la validacion estricta.
3. **`Number(null) === 0`.** Tanto en las magnitudes de entrada como en los importes declarados.
   Una ausencia convertida en cero, frente a un calculo positivo, se lee como descuento. Se usa
   un `num()` que solo acepta numeros finitos ya presentes; ausencia -> `NaN` -> `null` -> no
   bloquea. **La falta de evidencia no puede convertirse en evidencia.**
4. **`declarado === 0` no es "incontrastable".** Un subtotal de 0 EUR con precios positivos es
   justo el caso de una bonificacion del 100% sobre ese termino, y debe detectarse. Se separa
   del caso "el importe no viene".

**LA DIRECCION DEL DESVIO IMPORTA — corregido el 25/08/2026 con facturas reales.** La primera
version usaba `Math.abs()` y llamaba "descuento" a cualquier desviacion. Es falso: un descuento
solo puede hacer que se facture MENOS de lo que los precios explican. Si se factura MAS, la causa
es otra. Tres casos reales lo destaparon, ninguno de ellos un descuento:
  - **Endesa**: energia calculada 9,854 EUR frente a 10,11 declarados. Se facturaba mas de lo
    calculado, asi que acusar de descuento era mentir.
  - **Octopus**: su QR publica `prP1=0,093` y `prP2=0,025`, que son EUR/kW/**dia**, no EUR/kW/anyo
    como exige la resolucion (0,093 x 365 = 33,95 EUR/kW/anyo es plausible; al reves da 0,000255,
    absurdo). El bloqueo era correcto, el motivo no.
  - **Plenitude**: `impPot` cuadra con los 32 dias impresos en el PDF, no con los 31 que declara
    su propio QR. Es la discrepancia de dias ya conocida y avisada aparte.

Ahora `comparar()` devuelve `'ok'` / `'descuento'` (calculado > declarado) / `'incoherente'`
(calculado < declarado) / `null`, y solo se acusa de descuento cuando el signo lo respalda. El
resto sale con motivo `qr-incoherente` y su propio aviso, que no menciona descuentos. Ademas, si
el QR y el PDF discrepan en los dias, la potencia se valida con AMBOS recuentos y basta con que
uno reproduzca `impPot`: eso recupera el selector en facturas tipo Plenitude, que antes se
bloqueaban sin motivo. **Con una condicion: esos dias alternativos NO valen si
`periodoQrPdfDiscrepante` es cierto.** En un PDF con varias facturas, los dias del texto son de
OTRA factura y legitimarian los precios de esta por accidente; es la misma mezcla que el resto
del codigo evita al combinar fuentes.

**Politica ante lo no contrastable (deliberada).** Si un termino no se puede contrastar, NO se
bloquea: se prefiere un falso negativo —dejar pasar un descuento que solo afecta a un termino sin
importe declarado— antes que retirar la importacion a todo el que tenga un QR incompleto, que es
mucho mas frecuente. Solo bloquea la evidencia POSITIVA de incoherencia.

**Regresiones que fijan todo esto** (`tests/factura-integration.test.js`): caso limpio,
`importeEnergia` a 0 con energia positiva, magnitudes ausentes sin convertir a cero, importe
ausente que no se lee como descuento, periodo QR invalido con dias del PDF, `cambio=1`, y el
umbral por los dos lados (1% pasa, 3% bloquea). La mutacion que las valida es devolver
`num()` a `Number()`.

**No reportar como bug**:
- Que "Mi tarifa" no se rellene desde una factura con descuento. Es la decision: es preferible
  no ofrecer la comparacion a ofrecerla falseada.
- Que la ficha siga mostrando los precios declarados aunque no se puedan importar. Son el dato
  oficial que el usuario puede cotejar con su contrato; el rotulo dice "antes de descuentos".

**Para reabrirlo** hace falta una factura real donde el contraste marque descuento y NO lo haya
(falso positivo), o al reves. Es el escenario que conviene vigilar cuando aparezcan facturas de
comercializadoras con estructuras de descuento raras.

<a id="cache-del-censo-cnmc-un-fallo-de-red-no-puede-durar-toda-la-sesion-res"></a>
### Cache Del Censo CNMC: Un Fallo De Red No Puede Durar Toda La Sesion (RESUELTA 25/08/2026)

`__LF_resolveCnmcCommercializer()` cachea el censo en `__LF_cnmcRegistryPromise` para no
descargarlo en cada factura. El `.catch()` devolvia `{}` y la promesa quedaba **resuelta para
siempre**: un corte transitorio en la primera factura dejaba a todas las siguientes sin nombre
ni contacto de comercializadora hasta recargar la pagina. Detectado por ChatGPT el 25/08/2026.

Correccion: purgar la promesa fallida dentro del propio `catch`, con **check de identidad**
(`if (__LF_cnmcRegistryPromise === intento)`) para no anular una carga posterior que ya este en
vuelo. Es exactamente el mismo patron —y el mismo fix— que se aplico a `__pvpcLoadMonth` en
`js/index-extra.js` tras la auditoria del 10/07/2026. **Si vuelve a aparecer una cache de
promesa en este repositorio, esa es la forma correcta de escribirla.**

Severidad BAJA: no afecta a calculos ni al QR, solo al nombre mostrado.

<a id="catalogo-sustituido-durante-un-calculo-en-vuelo-resuelta-26-08-2026"></a>
### Catalogo Sustituido Durante Un Calculo En Vuelo (RESUELTA 26/08/2026)

`calculate()` copiaba `baseTarifasCache` y solo capturaba `state.generation`, que cubre las
ediciones del formulario pero **no** el catalogo. Despues del snapshot quedan `await` reales
(PVPC, `requestAnimationFrame`, `setTimeout`, `calculateLocal` con SSAA). Si el auto-refresh
publicaba una version nueva en ese hueco, `lf-cache.js` sustituia el catalogo y
`refreshTarifasAndMaybeRecalc()` adelantaba `__lf_lastTarifasUpdatedAt` **de inmediato**; el
calculo viejo terminaba, limpiaba `pending` y dejaba en pantalla un ranking de la version
anterior rotulado `Resultados actualizados`, sin que ningun refresh posterior volviera a
considerar esa version una novedad. Detectado por ChatGPT el 26/08/2026 (ronda 13).

Correccion: capturar `window.LF.__LF_tarifasMeta?.updatedAt` junto al snapshot y exigir en el
commit que sigan iguales **generation Y version del catalogo**. Si cambio, se conserva el
ranking ya pintado pero se restaura `pending` con aviso propio. `updatedAt` sirve como
identidad porque `lf-cache.js` ya rechaza que el contenido cambie manteniendo la misma version;
no se anade un segundo mecanismo de hash.

Se restaura `state.pending = true` + `setStatus(...)` en lugar de `markPending()`, **a
proposito**: aqui no hay un cambio nuevo que contar, y bumpear `generation` romperia la
serializacion de peticiones. Mismo patron que ya existia en `scheduleCalculateDebounced()`.

Severidad MEDIA: exige coincidencia de actualizacion de catalogo con un calculo largo, pero el
dato mostrado puede ser incorrecto sin aviso.

<a id="peticion-de-calculo-perdida-durante-lf-calc-inflight-resuelta-26-08-20"></a>
### Peticion De Calculo Perdida Durante `__LF_CALC_INFLIGHT` (RESUELTA 26/08/2026)

`runCalculation()` hacia `if (window.__LF_CALC_INFLIGHT) return`. El debounce de inputs
rehabilita el boton a los 200 ms aunque siga un calculo en vuelo (**verificado en Chrome real**:
`btnCalc.disabled === false` con `__LF_CALC_INFLIGHT === true`), asi que el usuario podia pulsar
un boton habilitado y perder el click en silencio, ademas de emitir un `lf:results-requested`
sin calculo asociado. Detectado por ChatGPT el 26/08/2026 (ronda 13).

Correccion: serializar **una sola** peticion pendiente, atada a la `generation` del instante en
que se pidio, y drenarla en el `finally`. Una edicion posterior la invalida en vez de aplicarse
sola. `lf:results-requested` se centraliza en el momento en que la peticion arranca de verdad.

La trampa esta en el ORDEN de eventos: una cola ingenua emite el `requested` encolado antes de
que el calculo anterior publique su `results-ready`, y `aecc-banner.js` reatribuye `requestedAt`.
Por eso `calculateLocal()` devuelve la promesa de `renderAll()` y `renderAll()` la de
`renderTable()`: asi `calculate()` no entra en su `finally` hasta que el `ready` anterior salio.
**Es un unico cable de lifecycle sostenido desde dos ficheros; romper cualquiera de los dos
extremos lo desactiva.** Verificado en Chrome real: `requested -> ready -> requested -> ready`.

Efecto lateral deliberado: un rechazo de `renderTable()` ya no es una unhandled rejection
silenciosa, sino que llega al `catch` de `calculate()`. Antes un render roto podia rotularse
`Resultados actualizados`.

Severidad BAJA: se perdia una accion, no se producia un ranking falso.

**Residual cerrado el mismo dia (Codex).** La cola guardaba la peticion solo
`if (state.pending)`, y eso deja una ventana: `renderAll()` pone `state.pending = false` en
`lf-render.js:886` **antes** de `renderTable()`, y el `setStatus(..., 'ok')` de la linea
siguiente rehabilita el boton. Durante el render por chunks queda
`__LF_CALC_INFLIGHT === true`, `pending === false` y boton pulsable: ese click se perdia
igual que antes del fix.

La correccion propuesta —que `renderAll()` no toque `state.pending`— **no cierra el caso**,
comprobado con un test: la peticion si se encola, pero el drenado del `finally` tambien
exigia `state.pending`, y el commit acababa de ponerlo a `false`. Solo movia el punto de
perdida. Lo que cierra la ventana es **encolar siempre durante inflight y drenar sin exigir
`pending`**; la igualdad de `generation` sigue siendo quien impide aplicar ediciones
posteriores que el usuario no pidio calcular, que es la garantia que importa.

Contrapartida aceptada: un click durante el render sin cambios pendientes produce ahora un
recalculo redundante en vez de descartarse. Es exactamente lo que el usuario pidio al pulsar.

Test: `tests/lf-app-pending-race.test.js`, "un click durante el render (pending ya limpio) no
se pierde".

<a id="animatecounter-sobre-una-etiqueta-no-un-numero-resuelta-27-08-2026"></a>
### `animateCounter` Sobre Una Etiqueta, No Un Numero (RESUELTA 27/08/2026)

`lf-render.js:891-892` pasa a `animateCounter()` dos cosas distintas: el importe (`kpiPrice`)
y el **nombre** de la tarifa mas barata (`kpiBest`). La funcion estaba pensada solo para lo
primero y buscaba el numero con `/[\d,.]+/`, que captura el primer digito que encuentre.

Resultado: cualquier nombre con cifras se animaba desde cero durante 800 ms. `Visalia Fija 24h`
se pintaba como **`Visalia Fija 2,32h`**, `Plenitude +5kW` como `Plenitude +1,35kW`. Afecta a
**79 de las 122 tarifas** del catalogo (64%), que llevan digitos en el nombre. No es solo
estetico: el nombre intermedio es una tarifa que no existe. Matiz de alcance: el KPI **no**
es la region `aria-live`; el anuncio vive en un `role="status"` aparte que recibe el resumen
YA terminado. Que un lector se topase con el nombre intermedio era posible al navegar, pero no
esta demostrado que se anunciase 30 veces. Detectado el 27/08/2026.

Correccion: anclar el numero al PRINCIPIO del texto (`/^\s*(\d[\d.]*(?:,\d+)?)/`). Un
contador empieza por su cifra (`79,12 EUR`); una etiqueta con numeros dentro, no. Si no casa,
se asigna el texto tal cual, que es lo correcto. Se anade tambien respeto a
`prefers-reduced-motion`: son 30 escrituras de `textContent`, asi que el CSS no puede frenarlo
(a diferencia del ripple y las particulas, que si son animacion CSS y ya estaban cubiertas).

Se endurecio ademas el parseo de millares (`1.234,56` se leia como `1,234`), pero **como
defensa, no como fallo observable**: `formatMoney()` no pone separador de millares hoy
(`1080,24 EUR`), asi que ese texto no llega a la funcion.

Verificado en Chrome: antes el KPI mutaba 30 veces mostrando nombres falsos; ahora muta una vez
con el nombre correcto, y el importe sigue animandose.

<a id="ripple-retirado-animaba-un-keyframe-inexistente-resuelta-27-08-2026"></a>
### Ripple Retirado: Animaba Un Keyframe Inexistente (RESUELTA 27/08/2026)

`createRipple()` (`lf-utils.js`) creaba tres `<span>` con `animation: rippleExpand 0.8s`.
**`rippleExpand` no existia en ningun CSS del repositorio**; el unico parecido era
`@keyframes ripple`. Verificado en Chrome contra produccion: los spans salian con
`transform: none`, `opacity: 1` y **cero animaciones activas**. No era una onda, era un
destello de tres discos estaticos de 316 px superpuestos al boton.

Un nombre de animacion inexistente **no da error**: ni en consola, ni en tests, ni en lint.
El navegador simplemente no anima. Por eso duro tanto sin detectarse.

Decision (Codex, 27/08/2026): **retirar el efecto**, no encenderlo. Renombrar a `ripple`
habria introducido movimiento nuevo en ocho puntos (tema, filtros, calcular, menu, compartir
x2, limpiar cache, Enter), y los botones ya dan feedback con `:hover`, `:active` y la
reduccion de escala en movil. El destello actual es un accidente tecnico, no un efecto
disenyado. Coste que se elimina por clic: un `requestAnimationFrame`, tres nodos y **seis**
`setTimeout` (tres para insertar y tres para retirar), que se ejecutaban igualmente con
`prefers-reduced-motion`.

Retirado: la funcion, su export, las dos desestructuraciones en `lf-app.js`, las ocho
llamadas, el `@keyframes ripple` que quedaba huerfano y los mocks de cuatro ficheros de
test (cinco lineas: `render-ui.test.js` tenia declaracion y asignacion).

**Guard: `tests/animaciones-css-existentes.test.js`.** Toda `animation` escrita desde JS debe
tener su `@keyframes` en algun CSS. Cubre las dos formas que conviven en el repo
(`style.animation = 'nombre ...'` y `style.cssText = '...animation:nombre...'`) y la shorthand
con varias animaciones separadas por comas. Al escribirlo comprobe que las dos primeras
versiones del guard tenian huecos: una solo veia el primer nombre de la lista, y la siguiente
dejo de ver el patron `cssText`, que era justo el del ripple.

Si en el futuro se quieren ondas, la nota de Codex: disenyar UNA discreta para el CTA
principal, no reactivar el efecto triple heredado en todos los botones.

**Segundo caso, cerrado el mismo dia sin decision visual.** `js/bv/bv-ui.js` declaraba
`animation: 'slideInScale 0.35s ..., btnPulse 1.5s ...'` sobre `btn-edit-manual-shortcut`.
`slideInScale` existe (`bv-sim.css:39`), `btnPulse` NO. Pero no hacia falta decidir si
disenyarla: **ese boton no existe en ningun HTML** y esta seccion ya lo documentaba mas
arriba ("no existe en el HTML productivo actual; un problema hipotetico de su animacion
diferida no es una ruta de UI alcanzable"). Era codigo inalcanzable, asi que se elimino el
bloque entero, no solo la animacion. `@keyframes slideInScale` se conserva: sigue vivo en
`bv-sim.css:403`.

Al quedar el repo sin ninguna animacion escrita desde JS, el centinela del guard
(`referencias.length > 0`) dejo de tener sentido. **No se conserva codigo muerto para
mantener verde un test**: se sustituyo por un autotest de `extraerAnimaciones()` con
ejemplos sinteticos de los tres patrones. Uno de ellos, `'primera 1s,segunda 2s'` SIN espacio
tras la coma, es el unico que obliga a partir por comas: con espacio, el troceo por espacios
ya separa los nombres y la mutacion resultaba equivalente.

<a id="accesibilidad-lo-auditado-y-que-salio-bien-parcial-27-08-2026"></a>
### Accesibilidad: Lo Auditado Y Que Salio Bien (Parcial, 27/08/2026)

Primera pasada sobre el area. **Estas comprobaciones concretas salieron correctas; no
equivalen a una evaluacion integral de conformidad WCAG.** NO se ha probado con un lector de
pantalla real, ni zoom/reflow al 200-400 %, ni modo de colores forzados, ni visibilidad del
foco, ni un recorrido completo por teclado de todo el sitio. Lo verificado, en Chrome:

- `aria-live`/`role="status"`: el resumen se anuncia con nombre, numero de tarifas y coste.
- `aria-sort` en la tabla: coincide con el orden real y solo marca una columna. El disparador
  es un `<button>` dentro del `<th>`, no el `<th>`.
- `aria-expanded` del menu, coherente al abrir y cerrar.
- Modales: `aria-modal`, `aria-hidden` gestionado, el foco entra, **queda atrapado** (12
  tabulaciones sin escapar), `Escape` cierra y el foco vuelve al disparador.
- Validacion: `aria-invalid` + `aria-describedby` en el input, `role="alert"` en el error.
- Barrido de las 36 paginas: cero IDs duplicados, cero referencias ARIA rotas
  (`aria-controls`/`labelledby`/`describedby`), cero saltos de nivel de encabezado, todas con
  `<main>` y `lang`.

<a id="contratos-numericos-por-procedencia-ronda-15-27-08-2026"></a>
### Contratos Numericos Por Procedencia (Ronda 15, 27/08/2026)

**Resultado: cero bugs con impacto demostrado.** Se auditaron las tres fronteras de parseo
numerico con matriz comun + baterias por procedencia. Aparecieron divergencias, ninguna con
consecuencia real. Lo que se entrega es el CONTRATO fijado con tests.

Las tres fronteras tienen contratos **deliberadamente distintos** y NO deben unificarse. El
`parseNum` de `desglose-integration.js` es un fallback del canonico, no un cuarto parser:

| Frontera | Funcion | Ante lo ilegible | Nota |
|---|---|---|---|
| UI | `LF.parseNum` | **0** | permisivo a proposito; quien rechaza es `esNumericoValido` |
| CSV/XLSX | `parseNumberFlexible(CSV)` | **NaN** ante vacio o texto no numerico ordinario | admite ES y US. La FINITUD no la garantiza el parser: `Infinity` sobrevive como `Infinity` y lo filtran los consumidores con `Number.isFinite` |
| PDF/OCR | `__LF_normNum` | **null** | quita unidades. 22 call sites: 11 extracciones protegidas frente a `null`, 3 conversiones con `?? 0`, 6 lecturas del modal con validacion individual y 2 solares que solo influyen si son `> 0` |

Una divergencia puede ser CORRECTA: `1.234` son 1234 en una factura espanola y 1,234 en un CSV
con decimal de punto. Por eso NO se pidio "hacerlos coincidir" (matiz de Codex al plantear la
ronda).

**Descartado, con la evidencia que lo descarta:**
- `Infinity` sobrevive al parser CSV/XLSX, pero los tres consumidores lo filtran
  (`lf-csv-utils.js:597` y `parseHourlyMatrixRows:50`). Sin impacto.
- El signo negativo se pierde con menos Unicode (U+2212), en/em dash, parentesis contables y
  signo final. Se buscaron esos caracteres en las 13 facturas PDF de ejemplo: los 11 en-dash
  encontrados son separadores tipograficos (direcciones, registro mercantil, incisos como
  `-13,06%-`), NINGUNO es un signo. Los 15 importes negativos reales usan guion ASCII, que se
  parsea bien. Sin impacto demostrado.
- CSV rechaza `1.234.567` (NaN). Todos los CSV de ejemplo usan coma decimal y **ningun**
  separador de miles, y el rechazo falla en alto con error explicito. Sin impacto.
- `1e3`, `12abc34`, `Infinity`, `0x10` y digitos arabes en la UI: `esNumericoValido` los
  rechaza todos antes de llegar al calculo.
- Round-trip `formatValueForDisplay` -> `parseNum`: 0 rotos en 10 valores. El sitio no genera
  separador de miles en ningun punto, lo que explica ademas por que el fallo de millares de
  `animateCounter` era teorico.

**Hueco real cerrado:** el contrato de `__LF_normNum` NO estaba fijado. Cambiar su `null` por
`0` no rompia ningun test, y esa confusion si tiene consecuencia: `null` es "no pude leerlo" y
`0` es "vale cero".

Hay **22 call sites** y no todos reaccionarian igual. Clasificados sin solape (11+3+6+2):
11 extracciones de PDF/OCR protegidas frente a `null`, 3 conversiones con `?? 0`, 6 lecturas
del modal con validacion individual y 2 solares que solo influyen si son `> 0`.
El impacto concreto esta en el **modal de validacion de la factura**: `p1` y los tres consumos
aceptan **0 como valor VALIDO** (rechazan `< 0`; P1 puede ser 0 kW en un segundo suministro
dedicado a recarga). Con `null -> 0`, un campo ilegible pasaria esos guards y se aplicaria al
formulario un consumo de cero en silencio. `p2` y `dias` si lo rechazarian (`<= 0` y `< 1`).

Fijado en dos niveles: `tests/contratos-numericos.test.js` (contrato de cada frontera) y un
test de integracion en `tests/factura-integration.test.js` que llena el modal con todo valido
salvo un consumo ilegible y exige que NO se copie ningun valor al formulario principal.
Verificado mutando `__LF_normNum` por sus dos salidas (entrada nula y texto ilegible): ambas
tumban la suite.

**No auditado a proposito:** fechas, zonas horarias y DST. Estan cerrados con criterio
explicito (CCH-CONS 12/08/2026) y reabrirlos sin evidencia nueva es rendimiento decreciente.
Tampoco se recorrieron las 477 ocurrencias de `parseFloat`/`Number(`: la mayoria procesa JSON
interno o numeros ya normalizados; se empezo por las fronteras de confianza.

<a id="seo-datos-estructurados-y-core-web-vitals"></a>
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

<a id="documentacion-y-vigencia-editorial"></a>
### Documentacion Y Vigencia Editorial

Auditoria del 27/08/2026 sobre los 10 documentos manuales, los 7 generados y las 25 guias.

Que se verifico:

- Documentos generados (`README.md`, `CAPACIDADES-WEB.md`, `JSON-SCHEMA.md`, `llms.txt`, `llms-full.txt`, `sitemap.xml`, `data/guides-search-index.json`): `npm run check:repo-docs` regenera y compara contra el indice de Git. Los derivados son idempotentes: relanzar el sync no introduce cambios nuevos. El comando devuelve 1 mientras haya derivados regenerados sin preparar en el indice, y pasa una vez commiteados.
- Rutas citadas en documentos manuales: todas existen. `tests/tarifas-dataset.test.js` aparece como inexistente, pero es correcto: la entrada dice justamente que no debe crearse.
- Simbolos de codigo citados: sin referencias muertas. Los candidatos de un grep ingenuo son plantillas (`cNNN`, `x.xx5`, `{anchorDate}`), columnas CSV de Datadis (`AE_Autocons_kWh`), parametros de URL (`utm_*`) o advertencias de que algo NO se usa (`document.scrollingElement`).
- Cifras: 122 tarifas en `tarifas.json`, 25 guias, 108 ficheros de test. Coinciden con lo declarado.
- Vigencia de las guias: fechas, bono social (42,5/57,5), composicion del PVPC por anios, ayudas Auto+ acumuladas, plazos abiertos, precios orientativos contra el PVPC real del repo (media de agosto 0,1687 EUR/kWh), enlaces internos y limites SEO. Sin obsolescencias.

Hallazgos corregidos:

1. **La guia de la factura describia el lector QR como era antes del 25/08/2026.** Decia que rellena "potencia, consumos por periodo y fechas del ciclo" y no mencionaba en ningun punto la casilla que traslada los precios del QR a los cinco campos de `Mi tarifa`. Lo que afirmaba era cierto, pero omitia la capacidad mas util de la funcion. Anadido un parrafo en el Paso 2 con la casilla, su caracter opcional, que sustituye la tarifa personalizada guardada y que la ficha explica el motivo cuando no puede ofrecerse.
2. **Cuatro documentos declaraban una fecha de actualizacion anterior a su ultimo cambio real.** `CAPACIDADES-WEB.md` declaraba 2026-08-18 con cambios del 27; `AUDITORIA-IA.md`, 2026-08-20 con 59 lineas anadidas el 27; `ARRANQUE-CARGA.md`, 2026-08-24 con cambios del 27; `ANALITICA-GOATCOUNTER.md`, 2026-08-14 con 18 lineas del 25. Corregidas.

Trampas de medicion encontradas al auditar, para no repetirlas:

- **Medir longitudes bajo un locale que no interpreta UTF-8.** `${#var}` en Bash devuelve la longitud en CARACTERES, pero solo si el locale es UTF-8. En este entorno, sin `LANG` ni `LC_ALL` definidos, un `<title>` con tres acentos midio 66 y parecio superar el limite de 65 cuando mide 63; `LC_ALL=C.UTF-8` devuelve 63 y `LC_ALL=C` vuelve a devolver 66. Es el entorno, no Bash. El limite lo vigila `tests/seo-metadata.test.js`: si ese test pasa y una medicion manual dice lo contrario, sospecha de la medicion antes que del contenido.
- **Buscar la cita normativa en vez de la afirmacion.** Once guias hablan de permanencia sin citar el RD 88/2026, pero varias explican correctamente la regla ("puede rescindirse sin penalizacion salvo la excepcion de un contrato a precio fijo antes de la primera renovacion") sin nombrar la norma. La ausencia de la referencia no prueba contenido desactualizado.
- **`grep -moE` no hace lo que parece.** `-m` consume el token siguiente como su argumento numerico, el patron se pierde y todo sale como "no declara".

<a id="paginas-legales-frente-al-comportamiento-real"></a>
### Paginas Legales Frente Al Comportamiento Real

Auditoria del 27/08/2026 de `privacidad.html` y `aviso-legal.html`. Nunca se habian auditado.
Metodo: medir primero el comportamiento en el codigo y contrastar despues cada afirmacion, para no
leer el codigo buscando confirmacion de lo que el texto ya decia.

Comportamiento medido (util como linea base para futuras revisiones):

- Cero `document.cookie` en todo `js/`. La web no usa cookies.
- `connect-src 'self' https://luzfija.goatcounter.com` confina a un unico destino externo de datos.
- El script de GoatCounter se sirve desde `/vendor/goatcounter/count.js`, no desde un CDN.
- PDF.js es local (`vendor/pdfjs/pdf.worker.min.mjs`): la factura se procesa en el navegador.
- **FALSO POSITIVO RECURRENTE (03/09/2026): "anadir `enableScripting: false` a `getDocument()`".** Lo propuso una auditoria externa como primer commit a hacer, por ser la mitigacion oficial de GHSA-hq66-cqwq-w95j. **No aplica a este proyecto y anadirlo seria un no-op enganoso.** En PDF.js 6.x `enableScripting` no es un parametro de `getDocument`: aparece **una sola vez en todo `pdf.min.mjs` y ninguna en el worker**, en el constructor de `AnnotationElement`, es decir en la capa de anotaciones **del visor**. LuzFija no usa el visor: no monta `AnnotationLayer` ni utiliza `getJSActions`, `annotationStorage` ni `renderForms` (comprobado con grep sobre `js/factura.js`). La unica llamada relacionada es `page.getAnnotations()`, que **devuelve datos** para leer la URL del QR y no ejecuta nada. Lo que impide que se ejecute JavaScript de un PDF aqui no es un flag, es que no existe el componente que lo ejecutaria. Pasar el flag dejaria en el codigo una proteccion aparente que no protege por esa via, que es peor que no ponerlo. La version vendorizada (6.3.289) esta ademas por encima del rango afectado por ese advisory.
- El unico `fetch` de `factura.js` va a `data/cnmc-commercializers.json`, same-origin.
- La sonda de diagnostico de `tracking.js` rechaza cualquier destino que no sea `location.origin`.
- `tracking.js` redacta el CUPS activamente (`/\bES[0-9A-Z]{16,24}\b/gi` a `[cups]`).
- El CUPS del CSV solo aparece en ejemplos de docstring para detectar el separador; su valor no
  viaja en el objeto de consumos.
- Cero referencias a Google Fonts. Cero URLs con marcas de afiliacion en `tarifas.json`.
- Constantes que el texto cita con exactitud: `ERROR_OUTBOX_MAX = 64`, TTL de `7 * 24 * 60 * 60 * 1000`,
  y recorte de dominio con `labels.slice(-2)`.

Hallazgos corregidos:

1. **El aviso legal atribuia el PVPC a la CNMC.** La fuente real es ESIOS/REE: el workflow usa `ESIOS_API_KEY` e indicadores 1001/1739/10328, y `PVPC-SCHEMA.md` lo declara. El texto era ademas incoherente consigo mismo, porque nombraba a Red Electrica solo para declarar que no hay afiliacion. La CNMC si es fuente, pero del censo de comercializadoras (`sede.cnmc.gob.es/listado/censo/2`). Separadas las dos atribuciones.
2. **La politica de privacidad no declaraba los precios importados del QR.** Decia que al pulsar Aplicar solo se guardan "potencias, dias y consumos", pero desde el 25/08/2026 `applyCustomTarifaPrices` llama a `saveCustomTarifaMain`, que persiste los cinco precios en `localStorage` bajo `lf_custom_tarifa`. Declarado en los dos puntos donde se enumeraba lo que se guarda.
3. **El aviso legal no declaraba el alcance del catalogo.** Anadido que el listado es una seleccion revisada manualmente y no un censo exhaustivo del mercado, que es como funciona `tarifas.json`.
4. **El aviso legal no tenia fecha de actualizacion** mientras que la politica si. Anadida, y la de privacidad actualizada del 05/08 al 27/08/2026. Cerrada ademas la causa: `sync-seo-docs.mjs` ya mantenia sola la fecha visible de `privacidad.html` mediante `replaceVisibleUpdatedDate`, y ahora cubre tambien `aviso-legal.html`, con su test en `tests/legal-pages.test.js`. Validado por mutacion en las dos direcciones: con una fecha de 2020 el generador la corrige al ejecutar el sync, y el test la detecta cuando el sync no ha corrido.

Lo verificado que estaba bien: responsable y titular coincidentes con `LICENSE`, PolyForm Shield License 1.0.0, ausencia de cookies, autoalojamiento de tipografias y del script de analitica, procesamiento local de PDF y CSV, categorias cerradas en los diagnosticos, y las tres constantes numericas citadas en el texto.

Trampa de redaccion, pisada dos veces el mismo dia:

- **Confundir lo que el QR TRAE con lo que el comparador APLICA.** El QR declara cinco precios en `E0` y tres en `F0` (un unico precio de energia y dos de potencia). El comparador materializa y persiste siempre cinco campos, replicando en `F0` ese precio unico en punta, llano y valle (`singleEnergyPrice` en `factura-parsers.js`). Por tanto "se aplican" o "se persisten" cinco valores es correcto, y "el QR trae cinco precios" no lo es en general, ni siquiera en documentacion interna. Se colo primero en la guia de la factura y despues en `privacidad.html`.

Trampa de medicion encontrada al auditar:

- **`grep -c $'\r'` no sirve para detectar CRLF en este entorno**: devolvia el total de lineas en ficheros que son LF puro, y llevo a afirmar CRLF donde no lo habia. La comprobacion fiable es binaria: comparar `b.count(b'\r\n')` con `b.count(b'\n')`. `cat -A` tampoco es concluyente cuando `sed` normaliza por el camino. Antes de elegir el fin de linea de una insercion, medir en binario.

<a id="ciclo-de-vida-de-recursos-y-temas-dinamicos-ronda-16-28-08-2026"></a>
### Ciclo De Vida De Recursos Y Temas Dinamicos (Ronda 16, 28/08/2026)

Auditoria transversal del comportamiento al repetir operaciones y cambiar estado visual. Se
probaron la home, el Observatorio y el simulador solar en Chrome real, sin service worker, para
que el navegador sirviera el arbol de trabajo actual. Esta ronda no equivale a una prueba formal
de ausencia de fugas ni a una evaluacion WCAG completa: fija los ciclos y combinaciones concretos
que se ejercitaron.

Hallazgos corregidos:

1. **El aviso movil para saltar a resultados perdia su temporizador mas reciente.** Cada render de
   la home creaba un `setTimeout` de cinco segundos sin cancelar el anterior. Si un segundo calculo
   terminaba antes de que venciera el primer timer, ese timer ocultaba el aviso nuevo: en la
   reproduccion, el segundo resultado quedo listo a los 3266 ms y el aviso desaparecio a los
   5125 ms, tras solo 1,86 s visible. `lf-render.js` conserva ahora un unico timer propietario,
   cancela el anterior y reinicia los cinco segundos en cada render. El test usa reloj falso y
   demuestra que retirar el `clearTimeout` reintroduce la regresion.
2. **Los canvas del Observatorio no seguian un cambio de tema.** La UI buscaba un ID inexistente
   (`themeToggle`) y pretendia alternar una clase cuyo propietario real es `shell-lite.js` mediante
   `btnTheme`. Chart.js conserva los colores con los que construye cada canvas: al pasar de oscuro
   a claro, texto y rejilla seguian usando la paleta blanca. El Observatorio escucha ahora el boton
   real despues del handler propietario y actualiza, sin animacion, ejes, rejilla y leyendas de los
   tres graficos. Hay tests funcionales de la paleta y del cableado al ID real.
3. **Las fechas del grafico de tendencia se solapaban en movil.** Aunque Chart.js aplicaba
   `autoSkip`, cuatro fechas ISO completas no cabian en el ancho util de 390 px y se mostraban
   concatenadas. El limite es ahora responsive (tres fechas diarias o seis etiquetas mensuales por
   debajo de 520 px, ocho/doce en escritorio) y se recalcula tambien al redimensionar el canvas.
   La captura real a 390 px confirma tres fechas separadas en ambos temas.

Resistencia medida, sin crecimiento monotono en los ciclos ejercitados:

- Home: siete calculos completos mantuvieron 560 listeners; tras el primer render, los nodos se
  estabilizaron en 6020. Treinta aperturas/cierres del modal de factura no anadieron listeners ni
  nodos.
- Observatorio: dieciocho cambios rapidos de ano, mes y tipo conservaron 75 listeners, 1176 nodos,
  tres `canvas` y tres instancias activas de Chart.js.
- Simulador solar: siete rankings completos conservaron 179 listeners y 85.852 nodos, con 819 filas
  de resultado en cada render. El volumen es propio del desglose mensual, pero no crecio entre
  ejecuciones.
- La lectura estatica del extractor PDF/OCR confirmo liberacion de pagina/canvas, destruccion de la
  tarea PDF y guards de generacion. Los graficos destruyen la instancia anterior antes de
  reemplazarla.

Matriz visual y funcional ejecutada: home, Observatorio y solar; 1366 x 768 y 390 x 844; modo claro
y oscuro. Las doce combinaciones terminaron sin overflow horizontal, errores de consola ni
violaciones CSP. La home devolvio las mismas 103 filas y el mismo KPI en sus cuatro combinaciones;
el Observatorio creo tres graficos con la paleta correcta; el solar completo su ranking y mostro
resultados. Se inspeccionaron capturas del contenido inicial y de las zonas de resultados/graficos.

Trampas de medicion encontradas durante la prueba:

- Una captura tomada antes de terminar `animateCounter` compara estados intermedios, no importes
  distintos. La matriz espero a que acabara la animacion antes de contrastar el KPI.
- Que exista `BVSim` o que el boton solar este habilitado no demuestra que la tabla mensual haya
  terminado de construirse; el gate correcto comprobo las 48 entradas de la rejilla.
- En la home, un boton habilitado durante el arranque no basta para demostrar que el catalogo ya
  esta disponible. La prueba espero `__LF_tarifasMeta.updatedAt` y ausencia de calculo en vuelo.
- Los contadores de listeners del protocolo de depuracion incluyen infraestructura del navegador;
  aqui se usan para detectar crecimiento entre estados equivalentes, no como inventario semantico
  de listeners propios.

<a id="fronteras-de-renderizado-y-datos-ronda-17-28-08-2026"></a>
### Fronteras De Renderizado Y Datos (Ronda 17, 28/08/2026)

Auditoria de las rutas que reciben datos fuera de los literales de interfaz y terminan en el DOM o
en un enlace navegable. Resultado: **cero bugs con impacto demostrado** en el modelo de amenaza
actual; no se modifico codigo de produccion.

Se inventariaron `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `srcdoc`, `document.write`,
`eval`, `Function`, asignaciones a `href`/`src` y aperturas de ventana. No hay sinks de ejecucion
dinamica en el codigo de produccion. Los `innerHTML` restantes se separan en tres grupos:

- Plantillas completamente constantes o construidas solo con numeros ya normalizados y formateados.
- Render de catalogo/simulador, donde todo texto libre (`nombre`, `promo`, `requisitos`, razones y
  tooltips) pasa por `escapeHtml`; las URLs de tarifas pasan por `safeUrl` antes de entrar en un
  atributo `href`.
- Avisos de factura, que escapan todo el texto y restauran unicamente las etiquetas `<b>` de una
  allowlist cerrada. La ficha QR usa nodos y `textContent`; los valores de QR que se muestran son
  campos tipados/rango-validos, nunca la URL ni el CUPS.

Fronteras revisadas:

- El texto de PDF/OCR no se renderiza como HTML. Los avisos pasan por `__LF_warnHtml`, y la prueba
  de integracion cubre que un mensaje adverso no cree nodos ni manejadores mientras conserva el
  marcado permitido.
- CSV/XLSX solo entrega agregados numericos a las plantillas. Cabeceras, CUPS, nombres de fichero y
  celdas libres se usan para detectar formato o construir errores, no se conservan como contenido
  renderizado.
- La busqueda de guias inserta consulta y contenido mediante `textContent`; las tarjetas normales
  son clones del HTML editorial. Su indice es un artefacto same-origin generado desde esas guias,
  no una entrada que aporte el visitante.
- Los escenarios `?bv=`, `localStorage` y campos manuales terminan en inputs o valores normalizados;
  no llevan strings libres a una plantilla HTML.
- El censo CNMC se descarga antes de publicar, acepta solo webs HTTP(S) y el runtime las abre con
  `noopener noreferrer`. Las URLs comerciales usan la validacion canonica, que rechaza esquemas
  peligrosos, controles y barras invertidas antes de admitir rutas relativas.

Validacion ejecutada con Node 22: `tests/utils.test.js`, `tests/security.test.js`,
`tests/factura-integration.test.js`, `tests/csv-import.test.js`, `tests/csv-parsing.test.js`,
`tests/guides-search-resilience.test.js`, `tests/guides-search.test.js` y
`tests/link-hardening.test.js`: 8 ficheros, 221 tests, todos en verde.

Limite deliberado: un indice de guias, `tarifas.json` o censo local alterado por una publicacion
maliciosa same-origin no equivale a una entrada publica controlada por un visitante. El proyecto
ya trata ese supuesto como integridad de datos/cadena de suministro, no como DOM XSS alcanzable.
Endurecer adicionalmente cada consumidor de esos artefactos puede ser hardening futuro, pero no se
registra como bug sin una ruta que cruce la confianza establecida.

<a id="accesibilidad-funcional-y-responsive-ronda-18-28-08-2026"></a>
### Accesibilidad Funcional Y Responsive (Ronda 18, 28/08/2026)

Continuación acotada de la auditoría parcial de accesibilidad del 27/08/2026. Se reabrieron solo
hallazgos nuevos ya reproducidos en Chromium, sin reinterpretar como regresión los casos previamente
marcados como resueltos. La comprobación se hizo sobre la copia local del ZIP mediante un arnés
efímero `about:blank`, porque la política administrada de Chromium bloquea la navegación incluso a
`localhost` y `file:`. El arnés carga los mismos HTML/CSS/JS locales y no modifica el repositorio.
La entrega externa no ejecutó Vitest ni ESLint; durante la integración, Codex sí validó el resultado
con Node 22, la suite completa y el lint. No hubo prueba con lector de pantalla real; por tanto, el
resultado no afirma conformidad WCAG completa.

Hallazgos confirmados y corregidos:

1. **Compartir perdía el foco al cerrarse desde el menú en Home y Solar.** El disparador guardado era
   `btnShare`, pero ese control quedaba oculto al cerrar el menú. Tras `Escape`, Chromium terminaba
   con foco en `body`. `openShareDialog` acepta ahora un retorno explícito: desde el menú usa
   `btnMenu`, mientras que los CTA de resultados conservan su propio retorno. Se verificaron ambos
   orígenes en las dos aplicaciones.
2. **La tabla manual solar marcaba errores solo de forma visual.** `1,2,3` activaba `.error` pero no
   `aria-invalid`; además los avisos pedían corregir los valores "en rojo". El validador mantiene
   ahora `aria-invalid="true"` y `aria-describedby="bv-manual-invalid-message"` mientras el valor es
   inválido, retira ambos atributos al corregirlo o limpiar la rejilla y los mensajes hablan de
   "valores inválidos".
3. **El selector Diaria/Mensual del Observatorio declaraba tabs sin paneles de pestaña.** Ambos
   controles eran botones independientes que cambian el modo de un único gráfico. Se sustituyó
   `tablist`/`tab`/`aria-selected` por un grupo de botones nativos con `aria-pressed`. Chromium
   confirmó activación con Espacio y actualización mutuamente exclusiva del estado.
4. **Los estados principales del Observatorio no tenían una vía de anuncio accesible.** `trendMeta`
   expone ahora un único `role="status"` atómico para carga, resultado o error del render. La nota de
   importación de excedentes usa otro `status`; el helper evita reescribir el mismo texto y los
   caminos de error no insertan antes el mensaje genérico de estado vacío. Chromium registró en
   `trendMeta` `Cargando…` seguido del resultado y, al sustituir solo en el arnés el loader por un
   fallo sintético, `Cargando…` seguido de `Error cargando dataset local.`. Con un CSV sintético
   demasiado grande se observaron solo `Procesando archivo…` y el error específico.
5. **El fallback de Copiar en las guías dejaba el foco en `body` y la confirmación era solo visual.**
   Las 25 guías afectadas compartían exactamente el mismo bloque. El fallback guarda el elemento
   activo, elimina el textarea temporal y restaura el foco antes de mostrar la confirmación. El aviso
   se inserta primero como `role="status"` atómico y después recibe el texto, para que el cambio se
   produzca ya dentro del árbol accesible. WhatsApp y el resto de destinos no se modificaron.
6. **El morado usado como texto editorial no alcanzaba contraste suficiente en oscuro.** Con el
   fondo renderizado real se midieron aproximadamente 3,83–3,86:1 para enlaces de 16 px/400. No se
   cambió `--accent`, que sigue gobernando fondos y bordes: se añadió `--accent-text`, con `#A78BFA`
   en oscuro y `#6D28D9` en claro, y se aplicó a todos los usos del acento como primer plano en las
   25 guías (artículo, migas, índice activo, categoría, fuentes y elementos equivalentes). El caso
   medido del enlace queda en aproximadamente 5,95–6,01:1 en oscuro y 6,18:1 en claro; el guard usa
   además el peor fondo morado compuesto implicado y conserva los bordes en `--accent`.
7. **El placeholder del buscador de guías también fallaba contraste en ambos temas.** La medición
   compuesta fue aproximadamente 3,36:1 en oscuro y 1,04:1 en claro. Se sustituyó el color fijo
   translúcido por `var(--muted)`, ya definido por tema; Chromium midió aproximadamente 7,37:1 en
   oscuro y 7,21:1 en claro.

Pruebas de regresión añadidas y ejecutadas: contratos funcionales de retorno de foco Home/Solar,
`aria-invalid` y limpieza del estado solar, semántica/estados del Observatorio, guard estructural de
las 25 guías más un caso funcional representativo del fallback, y guards de contraste/placeholder.
La integración terminó con Node 22, 110 ficheros y 1766/1766 tests, ESLint 0 y 9/9 mutaciones
plausibles detectadas. La suite completa descubrió además que los HTML estrictos necesitaban
regenerar sus hashes CSP tras cambiar contenido inline; se actualizaron y el guard CSP quedó verde.

La revisión visual/reflow previa de la misma ronda cubrió 1366 x 768 y 390 x 844, claro/oscuro, zoom
200 % y 400 % cuando Chromium lo permitió, y `forced-colors: active` cuando pudo activarse de forma
fiable. No se demostró overflow horizontal global en esas pasadas. La política de navegación impidió
validar service worker, instalación PWA y comportamientos que dependan de un origen navegable real.

Durante la integración se repitió además el recorrido sobre un servidor HTTP local en Chrome 152,
a 1366 x 768 y 390 x 844, en claro y oscuro. Se confirmó en el DOM real el retorno de foco a
`btnMenu` en Home/Solar, la colocación y retirada de `aria-invalid`/`aria-describedby`, el grupo y
los estados pulsados del Observatorio, sus dos regiones `status`, la restauración de foco y el aviso
de copia en una guía representativa, los colores computados `#A78BFA`/`#6D28D9` y el placeholder
dependiente del tema. Las capturas no mostraron roturas visuales, ninguna superficie medida tuvo
overflow horizontal global y la consola quedó sin errores. Esta pasada tampoco se usó para afirmar
que estén validados la instalación PWA, el ciclo de actualización del service worker o un lector de
pantalla real.

El directorio entre `REGISTRO-INDICE:INICIO` y `REGISTRO-INDICE:FIN` y el resto de documentación
derivada se regeneraron con el sincronizador del repositorio después de integrar los cambios.

<a id="foco-y-colores-forzados-ronda-19-28-08-2026"></a>
### Foco Y Colores Forzados (Ronda 19, 28/08/2026)

Revisión posterior a la Ronda 18, limitada a hallazgos reproducidos mediante teclado, zoom real y
`forced-colors: active`. Dos problemas eran reales y se corrigieron; un tercero se descartó como
decisión responsive ya establecida.

1. **Las tarjetas del índice de guías recibían foco, pero no lo mostraban.** El enlace
   `.guide-card` alcanzaba `:focus-visible`, pero solo conservaba el anillo por defecto del
   navegador, imperceptible sobre la tarjeta. Tiene ahora un `outline` explícito de 3 px, separado
   del borde, y una variante con `Highlight` para colores forzados. Así el principal mecanismo de
   navegación de `guias.html` conserva una referencia visible también con teclado.
2. **El selector Mensual/Diaria y los gráficos del Observatorio perdían información en colores
   forzados.** Al eliminarse los degradados, el botón activo no retenía señal visual. La regla de
   alto contraste usa colores de sistema (`Highlight`/`HighlightText`) y borde propio, sin depender
   del tema elegido en la web. Los `canvas` de Chart.js no heredan la paleta CSS forzada: el tema de
   gráficos pasa a `CanvasText` y `GrayText` cuando `forced-colors` está activo, y se repinta si el
   modo cambia durante la sesión.

La ocultación de acciones de compartir de la barra lateral editorial por debajo de 1200 px se
revisó por el mismo informe, pero **no se cambia**: son acciones secundarias deliberadamente
ausentes en la composición estrecha, no parte del flujo de lectura ni del cálculo. Restaurarlas
exigiría una decisión de producto y de diseño distinta, no un arreglo de accesibilidad mecánico.

Los nuevos contratos de regresión comprueban el foco de las tarjetas y el estado visual del
selector. El helper de gráficos se prueba además con `matchMedia('(forced-colors: active)')`;
la restauración del mock se protege con `try/finally` para no contaminar pruebas posteriores. Las
mutaciones de retirar el outline, borrar el fondo `Highlight` y sustituir el color de sistema del
canvas vuelven rojo el contrato correspondiente.

<a id="factura-lifecycle-y-export-goatcounter-31-08-2026"></a>
### Factura Lifecycle Y Export GoatCounter (31/08/2026)

Se revisó la entrega candidata externa
`luzfija-auditoria-factura-lifecycle-CANDIDATA.zip` (SHA-256
`1f05dc51c1c056b05bb8ebfd93f98007b2b2b6fdb1357c576af50dec989a9eca`). Sus hashes internos
coincidían y los tres ficheros modificados partían exactamente del estado del repositorio. Los
cuatro hallazgos se aceptaron conceptualmente: reintento de `import()` de PDF.js tras fallo,
ausencia de `Map#getOrInsertComputed` en navegadores todavía relevantes, invitación a OCR obsoleta
después de completarlo y falta de cancelación activa de recursos.

La candidata no se aplicó literalmente. Usaba `factura.js` como `workerSrc`; eso funcionaba con un
Worker real, pero su módulo no exportaba `WorkerMessageHandler` y rompía el fallback fake-worker que
PDF.js activa si no puede construirlo. Además, dos checkpoints de cancelación quedaban antes del
`try/finally` propietario de la página: si `getPage()` resolvía después de cerrar, `cleanup()` podía
saltarse. La integración usa `js/pdfjs-worker-bootstrap.mjs`, instala el shim antes del vendor y
reexporta el handler esperado; los checkpoints se movieron dentro de los `finally` propietarios.
El vendor no se modificó. Tesseract usa un único worker por operación, `workerBlobURL:false` y
`terminate()` tanto en salida normal como al cancelar.

Los 21 PDF sintéticos, informes y evidencias del ZIP se conservaron como artefacto externo y no se
incorporaron al repositorio (incluían una fixture artificial de más de 20 MB). Las regresiones
integradas usan las fixtures sintéticas ya versionadas y pruebas de comportamiento propias. En
Chrome 152 se comprobó tanto Worker real como fake-worker forzado con render PDF completo (2/2
casos). ESLint terminó sin errores y la suite completa en Node 22.16.0 pasó 1.791 tests, con 2
omisiones intencionadas y cero fallos (113 ficheros, 1.793 tests totales). La puerta real se cerró
después con 13/13 PDFs del banco local —más de los 11 exigidos— procesados por la interfaz real en
Chrome frente a producción: las huellas de fuente, confianza y campos funcionales fueron idénticas
en todos los casos y no hubo errores de navegador. La comprobación no guardó ni registró datos de
las facturas.

En paralelo se analizó el export GoatCounter
`goatcounter-export-luzfija-20260831T115117Z.zip` para el periodo 24-31/08/2026: 12.110 hits
mezclados, de los que 1.881 eran pageviews y 10.229 eventos. No aparecieron queries, hashes, URLs
completas, CUPS, IBAN, correos ni nombres de fichero en rutas, títulos o referrers activos. El build
`20260831-094944` no mostraba errores first-party de script/promesas; solo una señal CSP atribuible
a una extensión y una entrada descartada sin fichero.

Once navegaciones posteriores llegaban desde la ruta antigua
`/simulador-bateria-virtual.html` y una desde `/simulador`. Se añadieron aliases `noindex` sin
tracking hacia `/comparador-tarifas-solares.html`, evitando pageviews duplicados. Las dimensiones
opcionales de navegador/sistema/ancho, idioma y ubicación permanecen desactivadas por decisión de
privacidad: el export no justifica activarlas. La documentación AECC se corrigió para reflejar el
producto real: no existe botón de copia; solo se miden banner mostrado y cerrado.

<a id="sw-cache-arranque-y-recuperacion-pdfjs-01-09-2026"></a>
### SW, Cache, Arranque Y Recuperacion PDF.js (01/09/2026)

Se revisó e integró selectivamente la entrega externa
`LuzFija-auditoria-SW-cache-arranque-2026-09-01.zip` (SHA-256
`e94455d2f43170ff30de7255cbcca26a6b4022caecffa479cb24e7a254fff199`). Sus hashes internos y
el patch eran íntegros y este aplicaba limpiamente sobre el checkout. La entrega externa no ejecutó
lint ni Vitest; tras la integración, ESLint quedó limpio y Node 22.16.0 pasó la suite completa:
384 ficheros, 1.796 tests correctos, 2 omisiones intencionadas y cero fallos. Se comprobó además
el worker PDF real y el fake-worker en Chrome 152 (2/2).

Se corrigieron tres fallos reproducidos con Chromium y fixtures sintéticas:

- Si un consumidor esencial de arranque no llegaba a invocar el coordinador del SW, la recuperación
  inicial quedaba pendiente sin nadie que la consumiera. `error-bootstrap.js` inicia el coordinador
  al terminar el DOM cuando está disponible; si falla el propio helper, ofrece el botón manual ya
  estilizado y accesible. El coordinador es idempotente, evitando registros, listeners e intervalos
  duplicados.
- Una pestaña creada sin controlador ignoraba cualquier actualización posterior porque la marca de
  primera instalación era inmutable. Ahora solo se ignora el primer `controllerchange`; una
  actualización A→B recarga una vez y el mismo build no vuelve a hacerlo.
- Un fallo transitorio del bootstrap de PDF.js envenenaba el reintento en la misma pestaña. Sin
  tocar el internal `_setupFakeWorkerGlobal`, se descarta solo el namespace fallido y se usa una
  identidad nueva por fragmento para core y bootstrap. El fragmento no viaja por HTTP y conserva
  el `?v=`. El riesgo residual es que PDF.js 6.x cambie su mensaje de error de fake-worker; en ese
  caso el reintento deja de activarse, pero no se corrompe su runtime.
  **Actualizado el 02/09/2026:** esto sigue vigente para el bootstrap del worker, cuyo reintento
  responde a un fallo de evaluacion. Para el CORE ya no: un fragmento no fuerza peticion HTTP nueva
  y no servia cuando la descarga se colgaba a nivel de red, asi que pasa a `lf_retry` en la query.
  Ver "Compatibilidad WebKit/iPhone Del Lector PDF".

La matriz externa confirmó caché fría, offline, fallos de Cache Storage, rutas heredadas y ausencia
de query/hash/nombre de fichero sintético en recuperación y analítica. No cambió `sw.js`,
`CACHE_VERSION`, vendors, orden de scripts, fiscalidad, cálculos ni parsers.
Como `factura.js` cambió, se ejecutó además el gate local contra producción con las 13 facturas del
banco de pruebas: 13/13 huellas de fuente, confianza y campos funcionales coincidieron, sin errores
de navegador ni persistencia de datos de factura.

<a id="compatibilidad-webkit-iphone-del-lector-pdf-resuelta-02-09-2026"></a>
### Compatibilidad WebKit/iPhone Del Lector PDF (RESUELTA 02/09/2026)

Dos usuarios comunicaron que la subida de una factura en iPhone quedaba pensando sin avanzar,
tambien al cambiar entre navegadores habituales del dispositivo. La investigacion encontro tres
incompatibilidades reales y complementarias en la ruta de PDF.js 6.3.289:

- Se estaban sirviendo core y worker desde la build moderna. Se sustituyeron por el par exacto de
  `pdfjs-dist/legacy/build/`, sin mezclar versiones ni editar los artefactos upstream.
- La build `legacy` no cubre por si sola todos los runtimes objetivo: LuzFija instala
  `Promise.withResolvers` y `Map#getOrInsertComputed` antes de evaluar tanto el core como el realm
  del worker. `js/pdfjs-worker-bootstrap.mjs` conserva la query de build y reexporta
  `WorkerMessageHandler` para no romper el fallback fake-worker.
- `getTextContent()` seguia dependiendo internamente de la iteracion asincrona de
  `ReadableStream`. La ruta productiva agrega ahora los chunks de
  `streamTextContent().getReader()`; `getTextContent()` queda solo como fallback defensivo cuando
  la API de stream no existe.

Se añadió ademas un watchdog de 90 s al procesado PDF inicial. Cuando el bucle de eventos puede
ejecutarlo, invalida la operacion, libera la UI, cancela los recursos PDF registrados y muestra un
aviso en vez de mantener una espera asincrona muda. No cubre el OCR opcional y no puede interrumpir
una llamada sincronica que ya este ocupando el hilo; por eso no debe describirse como un deadline
absoluto de todo el extractor.

**Alcance de la reproduccion.** El resultado del control negativo con el codigo anterior y las APIs
retiradas depende del documento. Con la fixture sintetica —una pagina, sin QR— termino con un error
visible en unos 0,5 s y recupero el area de subida. Con facturas reales del banco local reprodujo
el sintoma comunicado: en WebKit con perfil iPhone el loader siguio visible durante los 45 s
muestreados, sin toast, sin error de pagina y sin devolver el area de subida, tanto con la factura
de 128 KB como con la de 5,7 MB. La diferencia esta en que las facturas reales entran al barrido QR
por imagen, camino que el codigo anterior no completaba. Queda demostrado que las incompatibilidades
eran reales, que el codigo nuevo las cubre y que con el codigo anterior una factura real producia
exactamente la espera muda descrita. Lo que no puede demostrarse desde aqui es que la promesa
pendiente concreta en los dispositivos de los usuarios fuese la misma: esos iPhone no se
instrumentaron.

**Validacion de cierre:**

- Instalacion limpia con npm 10, ESLint sin errores y suite completa con Node 22.23.2: 1.803 tests
  correctos, 2 omisiones intencionadas y cero fallos (113 ficheros, 1.805 tests totales). Tras el
  hallazgo posterior de este mismo bloque la suite queda en 1.804 correctos y 1.806 totales, por la
  regresion añadida para el deadline del import.
- `tests/pdfjs-real.test.js` abre la fixture con los vendors reales, elimina APIs recientes antes
  de importar core y bootstrap y exige la superficie restaurada. `tests/factura-lifecycle.test.js`
  valida el shim extraido de la fuente, el orden anterior al vendor, la subclase de `Promise`, la
  lectura por `getReader()`, la liberacion del reader y el comportamiento del watchdog.
- WebKit 26.5 con perfil iPhone proceso las 14 facturas del banco local por la interfaz real: 14/14
  en el runtime nativo y 14/14 retirando las APIs afectadas en documento y worker. En ambos barridos
  hubo cero spinners, cero errores de pagina, workers reales en los 14 casos y todos los campos
  generados quedaron rellenos. El maximo fue 6,6 s en nativo y 6,3 s en compatibilidad. Esta prueba
  verifica finalizacion y estado de UI; no sustituye una comparacion semantica campo a campo.
- Tras añadirse a la version candidata la precarga oportunista del core al abrir el modal, se repitio
  el barrido WebKit nativo sobre esa version exacta: 14/14 facturas procesadas, cero spinners, todos
  los formularios creados y 5,4 s de maximo. La precarga queda fuera del arranque general, no toca
  el archivo del usuario y conserva el reintento normal si su descarga anticipada falla.
- Los SHA-256 de `js/factura.js`, `js/pdfjs-worker-bootstrap.mjs`, `pdf.min.mjs` y
  `pdf.worker.min.mjs` servidos por produccion coincidieron con el checkout del build
  `20260902-000510`.
- Tras desplegar, un usuario confirmo que una factura que probo en un iPhone ya cargaba y leia los
  datos. Estimo una espera inferior a un minuto y advirtio que era una factura especialmente
  complicada; no es una medicion instrumentada ni permite fijar un tiempo representativo. El coste
  del barrido QR/canvas queda como posible mejora de rendimiento, no como fallo funcional de este
  incidente, y la operacion comunicada termino antes del watchdog de 90 s.

**Hallazgo posterior (02/09/2026): promesa de carga envenenada.** Al revisar la precarga
oportunista del core se detecto un fallo PREVIO a ella y mas grave. `import()` no se puede
cancelar; si la red deja la peticion de `pdf.min.mjs` pendiente para siempre, la promesa nunca
se asienta. Como `__LF_pdfjsLoading` solo se limpia en un `finally` que exige que la promesa
termine, quedaba envenenada: el watchdog recuperaba la interfaz a los 90 s, pero cualquier intento
posterior del usuario volvia a esperar a esa misma promesa muerta, otros 90 s, indefinidamente.

Se midio colgando la descarga en WebKit con perfil iPhone y el comportamiento resulto identico con
y sin precarga, lo que descarto que la precarga lo introdujera: el fallo estaba en
`__LF_ensurePdfJs`, que es el mismo codigo en ambos casos. Por eso NO se retiro la precarga, que
habria dejado el bug intacto perdiendo una optimizacion medida.

Correcciones: `__LF_importWithTimeout` acota el `import()` a 60 s
(`__LF_PDFJS_LOAD_TIMEOUT_MS`), por debajo del watchdog para dar un error atribuible, limpiando
siempre el temporizador; y el reintento pasa a cambiar la **query** (`lf_retry=N`) en lugar del
`#fragment`. Este segundo punto no era teorico: medido en WebKit, tras un `import()` colgado a
nivel de red el reintento por fragmento NO emitia peticion HTTP nueva y el segundo intento volvia
a fallar aun con el deadline puesto. Verificado de punta a punta colgando la primera descarga:
antes, recuperacion a los 91 s con el segundo intento atascado y una sola peticion HTTP; despues,
recuperacion a los 61 s y segundo intento procesando en 0,7 s con dos peticiones, la segunda con
`&lf_retry=1`. Las regresiones nuevas se validaron por mutacion. El hallazgo inicial y la revision
del mecanismo son de ChatGPT; la atribucion a la precarga se descarto por medicion.

Nota sobre entradas anteriores: la auditoria del 01/09/2026 describe el reintento por fragmento
para core y bootstrap. Desde este hallazgo eso solo aplica al bootstrap del worker, cuyo reintento
responde a un fallo de evaluacion y no de red. El core usa `lf_retry` en la query.

**Contrato para actualizaciones futuras:** conservar el par `legacy` de la misma version, los shims
en ambos realms y `streamTextContent().getReader()` hasta que la nueva version demuestre que puede
prescindir de cada defensa. Ejecutar la suite con Node 22 y todo el banco real; con navegador
disponible, comprobar worker real y fake-worker y repetir una prueba WebKit con las APIs objetivo
retiradas. `reader.cancel()` ante error y un checkpoint dentro del bucle del reader son mejoras de
liberacion/cancelacion pendientes, no bloqueos del arreglo desplegado.

<a id="rotulacion-columna-impuestos-frente-al-motor-resuelta-05-09-2026"></a>
### Rotulacion De La Columna "Impuestos" Frente Al Motor (RESUELTA 05/09/2026)

**Origen.** Ronda 20 de auditoria externa (ChatGPT, solo ZIP, sin ejecutar tests ni navegador). Es
el primer encargo que ataca el angulo "lo que la UI promete frente a lo que el motor calcula" sobre
el copy de PRODUCTO; el mismo angulo aplicado a las paginas legales el 27/08/2026 ya habia dado
cuatro correcciones reales. El informe llego con libro de candidatos (44 rotulos revisados) y un
unico hallazgo, verificado despues aqui contra el codigo, el dataset y Chrome real.

**Mecanismo.** La columna `impuestosNum` NO es la suma de los impuestos: es el residual de la fila.
En Peninsula, `js/lf-calc.js` la construye como
`tarifaAdj + impuestoElec + alquilerContador + ivaCuota + fvCosteBV`, y en la rama PVPC directamente
como `totalNum - potenciaNum - consumoNum`. Eso es DELIBERADO y no se toca: el comentario del propio
codigo lo llama "blindaje de redondeos (tabla)" porque garantiza que
`Potencia + Consumo + Impuestos = Total` cuadre en pantalla en todas las filas. Recalcular la
columna como IEE+IVA descuadraria las tres columnas frente al total. Lo unico incorrecto era el
rotulo, que atribuia a fiscalidad la financiacion del bono social y el alquiler del contador.

**Cifras verificadas** (4+4 kW, 30 dias, 300 kWh, Peninsula, `Seneo Tarifa 1 Fija 24h`):
potencia 35,76 EUR; energia 24,00 EUR; bono social 0,74 EUR (`9,011295/365*30`); IEE 3,09 EUR
(`60,50 x 5,11269632%`, el minimo de 0,001 EUR/kWh no manda); alquiler 0,80 EUR (`30 x 0,81 x 12/365`);
IVA 13,52 EUR; total 77,91 EUR. La columna mostraba 18,15 EUR con 16,61 EUR de impuestos reales:
1,54 EUR sobreatribuidos. Ni el total ni el ranking estaban afectados; el perjuicio era informativo.

**Precedente interno que zanjo la discusion.** La columna homonima del simulador solar
(`js/bv/bv-ui.js`, `buildTable`) YA declaraba la composicion en su `title`:
"Bono social, IEE, contador e IVA/IGIC/IPSI". Misma agregacion, misma palabra, explicada en una
pantalla y no en la otra. No era una cuestion de criterio sino una incoherencia entre superficies.

**Correccion aplicada.** Rotulo `Impuestos*` en la cabecera de `index.html` con `aria-label`
ampliado, nota al pie bajo la tabla con la composicion y remite al desglose (que si separa los
conceptos), y reescritura de la FAQ de `calcular-factura-luz.html` que enumeraba alquiler de
contador y peajes de acceso dentro de "todos los impuestos vigentes" -- dos conceptos mal
clasificados, no uno. Ningun cambio de calculo.

**Trampa metodologica principal: el rotulo vive en DOS sitios.** En movil (<=768px) `styles.css`
aplica `thead { display: none; }` y la etiqueta de cada celda la pinta
`tbody td:nth-of-type(5)::before { content: "Impuestos"; }`. Consecuencias para quien audite esta
zona: (1) un `title`, un tooltip o cualquier elemento anadido al `<th>` NO existe en movil, porque
la cabecera no se renderiza; (2) un `::before` no recibe foco ni clic, asi que no admite tooltip;
(3) cambiar solo el HTML deja escritorio y movil diciendo cosas distintas. La primera propuesta de
correccion (tooltip en el `<th>`, copiando el patron de `bv-ui.js`) se DESCARTO por esto.

**Segunda trampa: `npm test` invalida el hash CSP al tocar `index.html`.** El `pretest` ejecuta
`sync:seo-docs`, que sube el `dateModified` del JSON-LD de `index.html` al dia del cambio. Eso
altera el cuerpo del script inline y tumba `tests/csp-inline-hash.test.js`. Hay que recalcular el
`sha256` de la CSP en la misma tanda; el fallo no significa que el cambio editorial este mal.

**Verificacion.** Suite 1819/1821 en verde, `npm run lint` limpio, finales de linea LF conservados.
Chrome real (puppeteer-core, perfil limpio por combinacion) en las cuatro combinaciones
tema x viewport: escritorio 1440 muestra `Impuestos*` sin salto de linea y la nota en 818x42 px;
movil 390 oculta la cabecera y su `::before` computa `"Impuestos*"`, con la nota en 308x83 px.
Desborde horizontal 0 px en las cuatro. El color de la nota cambia solo con el tema porque reutiliza
`u-text-muted-13-16`, que tira de `var(--muted)`; no se introdujo ningun color nuevo. La FAQ carga
sin errores de consola y su texto visible coincide byte a byte con el del JSON-LD.

**Para reabrir** hace falta: que la columna deje de ser un residual (y entonces el rotulo deberia
volver a ser literal), que el rotulo de escritorio y el `::before` de movil se separen otra vez, o
que aparezca una tercera superficie con la misma agregacion sin declarar su composicion.

<a id="reproducibilidad-de-enlaces-y-backups-ronda-21-05-09-2026"></a>
### Reproducibilidad De Enlaces Compartidos Y Backups (Ronda 21, 05/09/2026)

**Origen.** Ronda 21 de auditoria externa (ChatGPT, solo ZIP, sin ejecutar tests ni navegador).
Angulo: si un enlace compartido o un backup exportado hoy reconstruye el mismo escenario al
abrirse mas tarde. Barrido completo de `shareConfiguration()` (`js/lf-app.js`), `SERVER_PARAMS`/
`DEFAULTS` (`js/lf-state.js`), y `getSharedScenario()`/`normalizeImportedScenarioPayload()`/
`loadManualData()` (`js/bv/bv-ui.js`). El libro de candidatos (44 mecanismos y claves revisados)
es correcto salvo el unico hallazgo que propuso, que se investigo aqui y se RECHAZO.

**Hallazgo propuesto y rechazado.** El informe afirmaba que un `payload.version: 1` en un enlace
`?bv=` o en un backup JSON usaba el formato antiguo agregado (`{cons, vert}`) y que el codigo
actual, al aceptar `[1, 2].includes(payload.version)` sin migrarlo, perdia en silencio el consumo
mensual (leia `p1/p2/p3` inexistentes como cadenas vacias). La premisa -- que `version: 1` alguna
vez significo ese formato -- no esta soportada por nada en el repo: ninguna de las dos unicas
escrituras de `payload.version` (`js/bv/bv-ui.js:1147` y `2107`) genera nunca `version: 1`, solo
`2`; tras la comprobacion de rango en `js/bv/bv-ui.js:843` y `907` el codigo NO vuelve a mirar el
numero de version para elegir formato, y lee `data[i].p1/p2/p3/vert` igual sea 1 o 2;
`SIMULADOR-BV.md:192` documenta la unica diferencia conocida entre versiones (la aparicion del
campo `config`, no un cambio de nombres de campo); y `git log -S "version: 1" -- js/bv/bv-ui.js`
no encuentra ningun commit que lo haya escrito jamas dentro del historial visible (post-squash,
ver [[project_history_squash_20260704]]).

**La trampa real que produjo el falso positivo.** El repo tiene DOS sistemas de versionado que
comparten vocabulario por casualidad y no tienen relacion entre si:
- `localStorage['bv_manual_data']` (legacy, SIN campo de version -- se distingue solo por el
  nombre de la clave, no por un numero dentro del dato) usa `{cons, vert}` por mes, y SI tiene
  una migracion real al formato detallado (reparto 20/25/55) en `js/bv/bv-ui.js:953-982`. Esa
  migracion solo se dispara al leer `localStorage`, nunca al leer un `payload.version` de una
  URL o un backup.
- `payload.version` (el numero `1` o `2` dentro de un enlace `?bv=` o un JSON de backup) usa
  siempre `{p1, p2, p3, vert}` en ambos valores; el numero nunca selecciona una rama de parseo.

El comentario en `js/bv/bv-ui.js:953` ("Migracion simple de v1 (agregado) a v2 (detallado)") usa
"v1/v2" como apodo informal de ese PRIMER sistema (nombre de clave), no del campo `version` del
segundo. Quien audite este area de nuevo: si un hallazgo depende de que `version: 1` tenga un
formato de mes distinto a `version: 2`, hay que ENSEÑAR donde se escribe ese `version: 1` con ese
formato antes de darlo por real -- no basta con que el comentario mencione "v1".

**Riesgo teorico documentado, no hallazgo.** La comprobacion `[1, 2].includes(payload.version)`
es vestigial: nunca se usa para elegir una rama de parseo, asi que si alguna vez existio (antes
del squash del historial, sin evidencia accesible) un enlace o backup real con `version: 1` y un
formato de mes distinto al actual, se romperia hoy en silencio. No hay ninguna prueba de que tal
formato haya existido. Se documenta como riesgo teorico de bajisima probabilidad, no como bug: no
se abre trabajo de correccion sin evidencia de un caso real.

**Para reabrir** hace falta encontrar, en codigo o en un artefacto real (enlace, fichero de backup
guardado por un usuario), un `payload.version: 1` cuyo `data` use un formato de mes distinto al
`{p1, p2, p3, vert}` actual. Sin eso, no reabrir con el mismo argumento.

<a id="mensajes-de-fallo-y-parcialidad-ronda-22-05-09-2026"></a>
### Mensajes De Fallo Y Cobertura Parcial Frente A La Causa Real (Ronda 22, 05/09/2026)

**Origen.** Ronda 22 de auditoria externa (ChatGPT, solo ZIP, sin ejecutar tests ni navegador).
Angulo: si el texto o estado visual que ve el usuario ante un fallo, demora o dato parcial de una
dependencia describe con precision la causa real. Libro de candidatos de mas de 45 mensajes en
home, Observatorio, modal PVPC, simulador solar y factura. Tres hallazgos confirmados por trazado
estatico linea a linea contra el codigo real; ninguno reproducido en navegador (Chromium no
disponible en el entorno del auditor).

**H-22-01: fallos de catalogo no relacionados con conectividad se presentan como "Error
conexion".** `js/lf-cache.js:214-232` distingue perfectamente la causa real de cada fallo de
`fetchTarifas()` -- HTTP 404/500 (`__lfTarifasStatus`), JSON no parseable
(`__lfTarifasFailureKind = 'json-parse'`), JSON valido pero sin tarifas utilizables
(`'json-invalid'`) -- pero todas esas causas colapsan en el mismo texto generico al agotar
reintentos: `setStatus('Error conexion', 'err')` + `toast('Error cargando tarifas desde el
servidor.', 'err')` en `lf-cache.js:315-317`, y la misma decision se duplica de forma
independiente en `js/lf-app.js:358-366` para la llamada `silent: true` del boton Calcular (que
por ser `silent` nunca pasa por el primer bloque). Un HTTP 404 no es una caida de conectividad
del navegador ni el usuario puede arreglarlo revisando su red; el mensaje le atribuye la causa
equivocada. `tests/dependencias-carga-parcial.test.js:337` fija el texto actual pero solo para el
caso "sin tarifas de sesion con `fetchTarifas` devuelto `false`" -- no es una decision deliberada
sobre unificar los mensajes por tipo de fallo, es cobertura incidental del comportamiento actual;
hay que actualizar ese test si se corrige el texto.

**H-22-02: la comparativa historica por anhos no advierte de anhos con cobertura parcial.** El
motor SI conoce la parcialidad: `js/pvpc-stats-engine.js:222-250` construye
`yearData.meta.failedMonths` y `yearData.meta.partial` por cada mes que falla al cargar. Ese
mismo dato ya alimenta avisos explicitos en el KPI, la tendencia y el perfil horario del anho
PRINCIPAL del Observatorio (el comentario de `pvpc-stats-ui.js:1180-1185` documenta exactamente
por que hace falta ese aviso: "sin este aviso el KPI se ve identico a uno completo"). Pero
`renderComparison()` (`js/pvpc-stats-ui.js:735-762`) descarta el objeto `meta` al construir los
datasets del grafico -- solo usa `computeMonthlyFromYearData()`, que deja el mes fallido en
`null` (`pvpc-stats-ui.js:585-614`) sin propagar ningun aviso a la tarjeta. Resultado: la tarjeta
"Comparativa por anhos" puede mostrar un anho con un mes en blanco sin ningun `⚠ datos
parciales`, mientras el MISMO anho, si es el principal, si lleva ese aviso en otras tres
superficies de la misma pagina. Es la inconsistencia entre superficies del mismo dato, no una
carencia aislada.

**H-22-03: un fallo de red al cargar "Manhana" es indistinguible de "todavia no publicado".**
`js/index-extra.js:400-423` solo muestra la pestanha `tabManana` si `cargarManana()` termina sin
excepcion. El `catch` unico (`index-extra.js:424-426`) trata igual la ausencia real del dia
(`__pvpcFetchDay` lanza `'Sin datos (dataset estatico)'` cuando el dia no esta publicado) que
cualquier fallo de red o HTTP no-ok de `__pvpcLoadMonth` (`index-extra.js:104-122`, que lanza
`Dataset no disponible: <url> (<status>)` o rechaza por timeout/red). En ambos casos la pestanha
simplemente no aparece, sin mensaje en el DOM (el `console.log` es solo debug). Severidad baja:
no bloquea "Hoy" ni el resto del comparador, y reabrir el modal reintenta la carga.

**Correccion aplicada (05/09/2026), los tres.**
- H-22-01: `describirFalloTarifas()` en `js/lf-cache.js` clasifica el fallo en `red`/`servidor`/
  `datos` y es la UNICA fuente del texto. Como `fetchTarifas` devuelve un booleano por contrato y
  el boton Calcular lo llama en `silent`, la clasificacion se publica en
  `window.LF.__LF_ultimoFalloTarifas` para que `js/lf-app.js` describa la misma causa sin
  duplicar la logica; se limpia al primer exito para no arrastrar una causa vieja. Sin
  informacion de causa se conserva el texto historico de red: no se inventa una causa que no se
  ha observado (por eso `tests/dependencias-carga-parcial.test.js`, que mockea `fetchTarifas`,
  sigue pasando sin tocarlo).
- H-22-02: nuevo `#compareMeta` bajo el grafico comparativo (mismo patron y clases que
  `#trendMeta`), poblado desde `renderComparison()` con los anhos que traen `meta.partial` y los
  meses que faltan. Se anhadio tambien el caso que el informe no cubria: un anho cuya carga
  entera falla (`results` con `null`) ya no desaparece del grafico en silencio.
- H-22-03: el "dia no publicado" de `__pvpcFetchDay` va marcado con `__lfPvpcDiaNoPublicado`; el
  `catch` de `cargarManana()` solo calla ante esa marca y ante cualquier otro error escribe en
  `#pvpcMananaAviso`. El aviso se limpia al empezar una carga nueva y respeta `__pvpcTypeToken`
  para no pintar el resultado de un tipo abandonado.

**Regresiones.** `tests/mensajes-causa-fallo.test.js`, 12 casos. Validadas por MUTACION, las tres:
colapsar el clasificador a la rama generica tumba 4 tests; devolver el `catch` de manhana a
"callar siempre" tumba 1; quitar la consulta de `meta.partial` en `renderComparison` tumba 1.
Suite completa 1831/1833 en verde y `npm run lint` limpio.

**Para reabrir** (si se corrige y se quiere volver a auditar esta zona): comprobar que
`fetchTarifas()` distingue el texto mostrado por `error.__lfTarifasFailureKind`/`__lfTarifasStatus`
en vez de colapsar a un unico mensaje; que `renderComparison()` marca visualmente los anhos con
`meta.partial`; y que `cargarManana()` distingue "dia no publicado" de un fallo de red real en el
`catch`.

<a id="mi-tarifa-paridad-entre-productores-ronda-23-05-09-2026"></a>
### Paridad De "Mi Tarifa" Entre Sus Tres Productores (Ronda 23, 05/09/2026)

**Origen.** Ronda 23 y ultima de la serie (ChatGPT, solo ZIP, sin navegador). Angulo: "Mi tarifa"
la construyen TRES productores independientes que leen el DOM por su cuenta --
`agregarMiTarifa()` (`js/lf-tarifa-custom.js`), la reconstruccion paralela de
`js/desglose-integration.js` y `getCustomTarifa()` (`js/bv/bv-ui.js`) -- y la paridad se sostenia
sobre comentarios en prosa, no sobre codigo compartido ni tests. El informe trajo la tabla de
paridad propiedad a propiedad, que hasta ahora no existia en ningun sitio, y dos hallazgos.

**Paridad confirmada.** `fv.exc`, `fv.tipo`, `fv.tope`, `fv.bv`, `fv.reglaBV`, `fv.precioBV`,
`incluyeServiciosAjuste` y los cinco precios coinciden en los tres. En particular la invariante de
la ronda 20 (`fv.bv` = "BV aplicable", no "el checkbox estaba marcado") sigue intacta en los tres:
`tieneBV && compensa` / `mtTieneBV && mtCompensa` / `hasBV && compensa`. Divergencias
estructurales descartadas por no llegar a pantalla: `web` (`'#'` / ausente / `''`),
`esPersonalizada` y `requiereFV` ausentes en el desglose, y `tipo` 1P/3P decidido por igualdad de
precios en home/desglose y por numero de campos rellenos en el simulador (alli `tarifa.tipo` no
participa en calculo ni ranking).

**H-23-01 (P2): `P1 = 0` se rechazaba en la home y se aceptaba en el simulador.** La home lo
bloquea a proposito -- `validateMiTarifa()` documenta que "el contrato del dataset permite p2=0,
pero p1 mantiene minimo positivo" -- mientras `getCustomTarifa()` solo exigia
`filledPower.some(x => x.value > 0)`, que se satisface con P2. Reproducido en produccion: con
Punta/Llano/Valle 0,12/0,10/0,08 y P1=0, P2=0,05 la home responde "Corrige los datos para
calcular" y el simulador construia la tarifa con `p1: 0`. **Manda la home** (su regla es el
contrato del dataset). Un P1 vacio sigue siendo valido: hereda `powerFallback` de P2; lo que se
rechaza es el 0 escrito a proposito.

**Trampa del arreglo de H-23-01: no basta con el manejador del boton.** El primer intento puso el
guard solo dentro del `click` de `bv-simulate`, y en produccion el aviso salia pero el campo NO
quedaba marcado. Un `MutationObserver` sobre `mtP1` lo explico: la clase `error` se anhadia a los
2 ms y desaparecia a los ~110 ms, porque la validacion en vivo (`validateInputFormat`) considera
`0` un valor correcto y se reejecuta despues por otras rutas. El control con un error preexistente
(`P1 = -1`) mantenia la marca, lo que confirmo que el defecto era del arreglo nuevo y no del
formulario. Correccion definitiva: `validateInputFormat()` acepta un cuarto parametro
`minExclusive`, la tabla `mtMinExclusive = { mtP1: 0 }` vive junto a `mtMaxValues`, y se propaga a
los TRES puntos de llamada de "Mi tarifa" (listener de `input`, restauracion de escenario y
validacion del boton). Asi el campo se marca al escribir y la marca persiste, igual que el resto
de errores del formulario. Una regresion cuenta que las tres llamadas lleven el minimo: si una lo
pierde, esa ruta vuelve a borrar la marca.

**H-23-02 (P2, el importante): los tres precios de energia a 0 coronaban "Mi tarifa" en la home.**
El simulador ya lo rechazaba con aviso explicito ("Los datos de 'Mi tarifa actual' estan
incompletos..."), pero la home no tenia ninguna comprobacion de energia positiva. Medido en
produccion antes del arreglo: con Punta=Llano=Valle=0 y P1=0,08 / P2=0,04, "Mi tarifa" salia en el
**puesto 1 con 20,22 EUR**, por delante de 101 tarifas reales. El informe lo planteo como simple
"incoherencia de disponibilidad"; el problema real es que la superficie permisiva era la que
muestra el ranking, y coronaba una tarifa imposible. **Manda el simulador.** Corregido en
`validateMiTarifa()`: los tres periodos a cero bloquean el calculo con "Indica al menos un precio
de energia mayor que 0". La condicion es conjuncion de los tres, no disyuncion: un valle a 0 con
punta positiva sigue siendo valido (verificado: sigue calculando y entrando en el ranking).

**Nota sobre la direccion del arreglo.** No es la misma en los dos hallazgos: en H-23-01 el lado
correcto es la home y en H-23-02 el simulador. "Alinearlos" sin decidir cual manda habria
propagado el error en uno de los dos casos.

**Regresiones.** `tests/mi-tarifa-paridad-productores.test.js`, 8 casos, validados por MUTACION:
desactivar el guard de la home tumba 2 tests, y quitar el minimo de una sola de las tres llamadas
a `validateInputFormat` tumba el que vigila la propagacion. Suite 1839/1841 en verde y
`npm run lint` limpio.

**Verificacion en navegador (Chrome real, service worker puenteado).** Home: P1=0 bloquea con
`mtP1` en rojo; energia 0/0/0 bloquea con los tres campos en rojo; valle=0 con punta positiva
sigue calculando y "Mi tarifa" entra en el puesto 1. Simulador: P1=0 muestra el toast "El precio
de potencia P1 debe ser mayor que 0." con el campo en rojo; P1 vacio y caso normal siguen
calculando con "Mi tarifa" en resultados.

**Para reabrir** hace falta: que un cuarto productor del objeto aparezca sin replicar estas dos
reglas, o que se decida que una tarifa de cuota fija (energia 0 con cuota mensual) debe poder
modelarse -- en cuyo caso el arreglo correcto NO es levantar el guard, sino anhadir el concepto de
cuota al motor, que hoy no existe.

<a id="buscador-de-guias-hueco-deliberado-05-09-2026"></a>
### Buscador De Guias: Hueco De Auditoria Deliberado (05/09/2026)

`js/guides-search.js` (692 lineas) es el unico modulo grande del repo que NO se ha auditado como
area propia al cerrar la serie de rondas 20-23. **Es una decision, no un olvido**, y se documenta
aqui para que nadie lo reporte como zona huerfana sin leer esto antes.

**Que SI esta cubierto hoy.** Dos ficheros de test dedicados, y cubren las dos mitades que
importan:
- `tests/guides-search.test.js`: el INDICE (`data/guides-search-index.json`) -- sincronia con el
  contenido real de las guias, cobertura de todos los documentos publicos, normalizacion de
  acentos y puntuacion, no duplicar items de listas anidadas, encontrar por terminos de FAQ que no
  aparecen en el resumen de la tarjeta, y variantes morfologicas (reclamacion / reclamar).
- `tests/guides-search-resilience.test.js`: la RESILIENCIA de red -- reintento tras 503 en vez de
  conservar una Promise rechazada, abandono de un 200 cuyo body no termina cayendo a busqueda
  basica en vez de quedarse cargando, y reintento de un 200 malformado en vez de fijar el fallback
  hasta recargar la pagina.

**Que NO esta auditado.** El comportamiento de la interfaz: orden y relevancia de los resultados,
navegacion por teclado, estados vacios del buscador y el tratamiento del parametro `q` de la URL
mas alla de que se lea.

**Por que se deja fuera.** El techo de impacto es cosmetico. Es el buscador de un indice
editorial: no calcula importes, no toca el catalogo de tarifas ni los datasets de precios, y no
participa en ninguna decision economica del usuario. El peor resultado observable es que un
resultado no aparezca o aparezca en mal orden en `guias.html`. Comparado con las areas que si se
auditaron en las rondas 20-23 (rotulos frente al motor, reproducibilidad de escenarios, mensajes
de fallo y paridad de "Mi tarifa"), el coste/beneficio no lo justificaba.

**Sobre la superficie XSS, ya resuelta y verificada.** La entrada del buscador nunca llega al DOM
como HTML: los resultados se construyen con `textContent` (13 usos) -- incluido el eco del termino
buscado en el contador -- y sus tres unicos `innerHTML` son `= ''` para vaciar el contenedor.
Verificado leyendo el fichero el 03/09/2026 y de nuevo el 05/09/2026. No hay
`insertAdjacentHTML`, `outerHTML`, `document.write` ni `eval`. Por eso la CSP de las paginas
editoriales sigue siendo de baja prioridad.

**Cuando dejaria de ser un hueco aceptable.** Si alguien introduce un render por `innerHTML` con
contenido interpolado en este fichero, si el buscador pasa a filtrar o a ordenar algo que influya
en una decision economica, o si se le anhade persistencia de estado del usuario. Cualquiera de las
tres cosas convierte esta entrada en obsoleta y obliga a auditar el modulo como area.

**Actualizacion 23/09/2026 (ronda 51): primer hallazgo en la capa de UI del buscador.** Con el
indice real en jsdom, escribir "reclamacion" a 200 ms por tecla enviaba 11 eventos
`guias-busqueda` en vez de 1: el debounce de 80 ms pinta cada prefijo y cada busqueda pintada
contaba. 8 de los 11 caian en `1-3`/`4-8` con `10-plus` resultados, asi que el reparto de buckets
de GoatCounter describia prefijos a medio escribir y no busquedas. Clasificacion: bug de la capa
de analitica (dato publicado falso), no de producto; la UI era correcta. CORREGIDO: el evento sale
una vez al asentarse la consulta (1,5 s), y al momento si el usuario pulsa un resultado, elige una
categoria o abandona la pagina; se descarta si borra la consulta antes. El pintado sigue a 80 ms.
Regresion en `tests/guides-search-tracking.test.js`, validada por mutacion (envio inmediato, sin
descarte, sin envio al pulsar, sin envio en categoria/pagehide: las cuatro la rompen).

**Segundo hallazgo, relevancia (mismo dia).** El prefijo inverso de `matchScalarField`
(`term.startsWith(token)`, pensado para que "facturas" encuentre "factura") aceptaba tokens de
cualquier longitud: "aerotermia" casaba con la palabra "a" del contenido, "alquiler" con "al",
"autoconsumo" con "a" y "estafa" con la stopword "esta". Las cuatro devolvian las 25 guias (el
contador anunciaba "25 resultados" y el estado vacio no podia salir nunca); con el arreglo quedan
en 5, 7, 4 y 3, y cada resultado contiene la palabra. Ademas el bonus de frase se sumaba tambien
con una sola palabra, en cada campo que contuviera el literal, y premiaba la forma exacta
tecleada: "facturas" ponia primero la guia de aerotermia. CORREGIDO: prefijo inverso solo con
token de 4 letras o mas, a 3 como maximo de la consulta y que no sea stopword
(`isShorterFormOf`); bonus de frase solo con dos palabras o mas. Barrido de 34 consultas
tipicas: ninguna guia principal pierde su primer puesto. Consecuencia aceptada: "tarifa nocturna"
pasa de 23 resultados sin relacion a 0 (el indice solo tiene "nocturno"; no se anhaden sufijos
de genero al stemmer porque desalinearian singular y plural, "tarifa"/"tarifas"). Regresiones en
el mismo fichero, validadas por mutacion de las tres condiciones.

**Revision externa del 24/09/2026 (ChatGPT, ejecutando el algoritmo de antes y despues con el
indice real): dos regresiones REALES, CORREGIDAS.** "horario nocturno" pasaba de 17 resultados
(consumo horario, adaptar horarios) a 1 tangencial, y "denunciar comercializadora" de 23 (reclamar
primero) a 1. Barrido propio de 56 consultas: tambien "consumo nocturno", "denuncia compania",
"darse de baja" (0) y "vender excedentes". Causa: con Y logico, una palabra que ninguna guia usa
deja la busqueda vacia; antes "funcionaba" por accidente porque esa palabra casaba con "no" o "de".
Arreglo sin reabrir el ruido: `QUERY_SYNONYMS` (nocturno -> noche, denunciar/queja -> reclamar,
vender -> venta/compensacion; peso 0,85) y, solo en consultas de varias palabras con menos de 3
guias completas, resultados parciales DETRAS, ordenados por palabras encontradas. Las busquedas de
una palabra no cambian. Tambien `init()` idempotente por campo de busqueda (no duplica listeners ni
eventos si se llama dos veces; hoy no era observable). Tests en `guides-search-tracking.test.js`,
validados por mutacion de las tres piezas.

**Segunda revision externa (mismo dia, sobre 3ca31ca): el relleno parcial era ruido. CORREGIDO.**
Error mio: el barrido ya mostraba "darse de baja" con 20 resultados y 0 completos, y lo di por
bueno porque el primero era el correcto. El contador decia "20 resultados" y la analitica lo
contaba en `10-plus`. Ahora los relacionados exigen una coincidencia de una palabra DISTINTIVA
(no "luz", "tarifa", "factura", "precio", "energia", "electricidad") en un campo fuerte (no el
cuerpo de la guia), son como mucho 5, el contador dice "N resultados · M relacionados" y el
bucket de `guias-busqueda` cuenta solo los completos. "darse de baja": 20 -> 4 relacionados;
"cancelar servicio": 14 -> 2; "precio luz hoy": 5 -> 0. Validado por mutacion de las cuatro reglas.

**Tercer hallazgo, el texto "Coincide en contenido" (mismo dia, tras el despliegue 988cadb).**
`formatMatch` recortaba el cuerpo entero de la guia desde el principio (117 caracteres), asi que
el fragmento casi nunca contenia la palabra: en un barrido de 35 consultas, 219 de las 240
tarjetas que coincidian por contenido (el 70 % de todas las tarjetas) ensenhaban texto sin
relacion ("maximetro" mostraba una frase sobre el ICP). CORREGIDO: `snippetAround` muestra
~120 caracteres alrededor de la primera aparicion literal de algun termino, sin distinguir
tildes; si el termino solo coincide por raiz, se muestra "Coincide en el contenido de la guia"
sin fragmento. Resultado del mismo barrido: 222 con la palabra, 18 genericos, 0 sin relacion.
Regresiones validadas por mutacion (pintado sin terminos, fallback al recorte antiguo y rama
desactivada). Revisado sin hallazgos: categorias como botones con `aria-pressed`, resultados como
enlaces, foco estable en el campo y estado vacio visible. Candidato NO verificado con lector de
pantalla real: el contador `aria-live` se actualiza en cada busqueda pintada (cada 80 ms).

**Fallo intermitente del deploy del 23/09/2026.** El primer intento de desplegar la ronda 51 se
paro en `npm test` por 4 tests ajenos al buscador (modal PVPC, cosido Datadis y dos de zona del
simulador) que agotaron el limite por defecto de 5 s con la maquina cargada, sin ninguna asercion
rota; solos pasaban 116/116. Llevan ahora `SLOW_TEST_TIMEOUT_MS` (20 s), como otros tests pesados.

<a id="catalogo-frente-al-motor-ronda-24-06-09-2026"></a>
### El Catalogo `tarifas.json` Frente Al Motor (Ronda 24, 06/09/2026)

**Origen.** Ronda 24 (ChatGPT "luna" en modo pensar, solo ZIP: sin `.git`, sin navegador y sin
poder instalar dependencias, asi que no ejecuto la suite y lo declaro). Angulo transversal que
ninguna fila de la tabla de areas cubria: si cada campo del esquema documentado en
`JSON-SCHEMA.md` llega igual a las cinco rutas que lo consumen -- puerta de entrada
(`lf-cache.js` + `lf-utils.js`), home (`lf-calc.js`), desglose (`desglose-*.js`), simulador solar
(`bv/*`) y "Mi tarifa" (`lf-tarifa-custom.js`). Se acoto a los 9 campos que pueden mover un
importe, un orden o una exclusion, y se exigio cita literal por celda de la tabla.

**Resultado: cero bugs observables y un unico cambio de codigo.** Las 118 filas publicadas son
coherentes; verificado de forma independiente sobre `tarifas.json`: 0 filas con
`fv.tipo = "NO COMPENSA"` y `exc != 0`, 0 con `fv.bv = true` fuera de `SIMPLE + BV`, y 0 con
`fv.tope` fuera del enum.

**El hueco real: el motor mensual solar no consultaba `fv.tipo`.** La home
(`lf-calc.js`, `fv.tipo !== 'NO COMPENSA'`) y el desglose (`desglose-calculo.js`, mismo guard)
bloquean la compensacion por MODALIDAD antes de mirar el precio. El simulador solar la derivaba
solo del PRECIO: el filtro de `loadTarifasBV()` admitia cualquier fila con `exc > 0` o el sentinel
`-1`. Comprobado con grep sobre `js/bv/` entero: `fv.tipo` solo se ESCRIBE alli
(`bv-ui.js:2284`, al construir "Mi tarifa"), nunca se leia. La invariante
"NO COMPENSA => exc = 0" la sostiene el generador local, no la web.

**Clasificacion: alineacion defensiva entre rutas, NO un bug.** Con el catalogo publicado el
resultado observable es nulo -- las 54 filas `NO COMPENSA` tienen `exc = 0` y el filtro por precio
ya las dejaba fuera. Se corrigio igualmente porque el coste es una linea y cierra una divergencia
entre motores que solo un dato externo mantenia a raya. Corregido en `bv-sim-monthly.js`:
`if (tarifa.fv.tipo === 'NO COMPENSA') return false;` dentro del filtro. Un `fv.tipo` AUSENTE no
excluye, a proposito: preferimos una fila de mas en el ranking solar a borrar en silencio una
tarifa valida por un campo que falta.

**Regresiones.** `tests/bv-sim-tipo-no-compensa.test.js`, 5 casos, validados por MUTACION:
comentar el guard tumba 2 (la fila incoherente con precio fijo y la del sentinel `-1`, que esquiva
la comprobacion numerica y necesita caso propio) y deja los otros 3 en verde, que es lo correcto
porque no dependen de el. El caso 5 corre sobre el `tarifas.json` real y exige que el filtro siga
siendo un no-op. Suite 1839 -> 1844 y `npm run lint` limpio.

**Para reabrir** hace falta que el generador publique una fila `NO COMPENSA` con `exc != 0`: el
caso 5 la caza al momento. Entonces la pregunta ya no es este guard, sino cual de los dos campos
manda -- y la respuesta tendria que salir de las condiciones de la comercializadora, no del codigo.

**Lo que se RECHAZO de esta ronda, y por que.** El informe presentaba otros cuatro puntos como
"riesgo real reproducible", todos condicionados a un catalogo que incumple el esquema:
- `fv.bv` interpretado por truthiness (`"false"` es truthy) frente al doble requisito de la home.
 Es una **decision documentada**: `JSON-SCHEMA.md` linea 101 dice literalmente que el comparador
 exige `fv.bv = true` Y `fv.tipo = "SIMPLE + BV"`, y que el simulador solar solo requiere
 `fv.bv = true`. Falso positivo documentado, no riesgo.
- `fv.exc = "-1"` (string) dejando de ser el sentinel indexado, un `fv.tope` desconocido cayendo
 al tope completo, y `incluyeServiciosAjuste` mal tipado invirtiendo la semantica del SSAA:
 **hardening**, no riesgo real. Requieren datos fuera de contrato.
- Su recomendacion de rechazar el catalogo ante esos campos mal tipados se rechaza en firme: la
 validacion de entrada es ATOMICA (una incoherencia descarta el dataset entero), asi que ampliar
 esa puerta con campos opcionales convierte una errata del generador en la web sin ranking para
 todo el mundo. Es la regla 6 del metodo del reves. `esTarifaUtilizable()` no se toca por esto, y
 sigue vigente que la web NO replica los rangos comerciales del generador.
El propio modelo reclasifico los cinco puntos al confrontarlo con la evidencia, sin resistirse.

**Calibracion del auditor.** Los mecanismos que describio eran CIERTOS: verificadas las cinco
citas contra el disco, con lineas correctas +-3, y el `costeBV = 3,87 EUR` que reporto sale exacto
de `4 x 30/31` (`bv-sim-monthly.js:305`), asi que ejecuto de verdad lo que dijo ejecutar. El fallo
no fue de lectura sino de SEVERIDAD -- el patron ya fichado de las auditorias externas -- mas no
consultar `JSON-SCHEMA.md` antes de reportar una divergencia que ese mismo fichero declara
deliberada.

<a id="dataset-vivo-a-importe-ronda-25-07-09-2026"></a>
### De Un Dataset Vivo A Un Importe: PVPC Y Excedentes Indexados (Ronda 25, 07/09/2026)

**Origen.** Ronda 25 (ChatGPT "luna", solo ZIP: sin `.git`, sin navegador y sin poder instalar
dependencias; declaro que no ejecuto la suite y que hizo reproducciones aisladas cargando codigo
real). Angulo: el unico circuito economico que ninguna fila de la tabla de areas cubria -- como
`js/pvpc.js` y `js/lf-surplus-prices.js` convierten un dataset vivo en un importe y en una
posicion del ranking. `/estadisticas/` y `js/pvpc-stats-*` quedaron fuera por estar ya auditados.

**Resultado: CERO hallazgos y CERO cambios de codigo.** Es la primera ronda que se cierra sin
tocar nada. Lo verificado y confirmado contra disco:
- Umbrales del modo hibrido: `pvpc.js:16-17` valen `0.10` y `0.10`, y `pvpc.js:949-950` los
 combina con AND, con el guard de mes completo en `951`. **No hay deriva doc-codigo** respecto a
 la entrada "PVPC Con CSV Y Precios Faltantes".
- Los kWh sin precio no se diluyen: `computeHourlyCompensation` no los suma a `totalKwh` ni a
 `totalEur`, y viajan como `missingKwh` hasta la UI.
- Ninguna ruta presenta los 0,020 EUR/kWh de referencia como si fuera un precio real.

**RECHAZADO: sacar el ancla diaria de la clave de cache PVPC (su hallazgo "M1").** Proponia que
`buildPvpcCacheKey` (`pvpc.js:331`) dejara de incluir `getPvpcAnchorDate()` en los escenarios con
CSV, porque fuerza recalculo al cambiar de dia aunque la traza importada ya este firmada. El
argumento parece razonable y es falso: `.github/workflows/pvpc.yml` reprocesa el dataset con una
**ventana de correccion de seis meses** (el paso se llama "Download PVPC data (six-month
correction window)"), asi que los precios historicos que usa una simulacion con CSV **si pueden
cambiar**. El ancla es lo que hace que un importe cacheado se rehaga solo en 24 horas cuando ESIOS
corrige. Quitarla dejaria a ese usuario con el importe viejo indefinidamente. Cambia una garantia
de frescura por ahorrar un recalculo local: mal negocio. **No reabrir sin desmontar antes esa
ventana de seis meses.**

**RECHAZADO tambien: cambiar como se rotula el EUR/kWh medio de un mes con cobertura residual
(su hallazgo "M2").** Es cierto que `bv-sim-monthly.js:289` divide el credito entre TODO `exKwh`
mientras el credito solo procede de los kWh con precio. Pero `bv-ui.js:3227` ya lo rotula
`Indice horario: X kWh -> Y EUR (media Z EUR/kWh)`: dice "media" y ensena los dos operandos. Y el
numero actual es el mas honesto de los dos posibles, porque los kWh sin valorar cobran 0 EUR y esa
media es lo que el usuario se lleva de verdad; la alternativa sugerida haria creer que cobra el
indice completo por todo lo vertido.

**Hardening anotado, sin actuar.** `lf-surplus-prices.js:52` hace que una `zonaFiscal` desconocida
caiga en Peninsula (`8741`) en silencio. No hay camino de usuario que lo alcance, porque el
selector no entrega esa entrada. Si algun dia la zona pasa a llegar por URL o por un escenario
compartido, esto deja de ser teorico.

**Calibracion del auditor.** Segunda ronda de este modelo y **la severidad ya fue correcta**: cero
bugs declarados como tales, y clasifico como hardening lo que era hardening -- justo el fallo de
la ronda 24. Las citas volvieron a ser exactas. Su punto ciego sigue siendo el mismo: propone
optimizaciones sin comprobar que garantia sostiene el codigo que quiere quitar (M1). Al verificar
sus propuestas, buscar SIEMPRE que protege lo que sobra, no solo si sobra.

<a id="capa-comun-frente-a-copias-locales-ronda-26-08-09-2026"></a>
### La Capa Comun Frente A Sus Copias Locales (Ronda 26, 08/09/2026)

**Origen.** Ronda 26 (ChatGPT "luna", solo ZIP; declara no haber ejecutado suite, lint ni
navegador). Angulo nuevo: el proyecto es JS vanilla sin modulos, cada fichero publica y consume
globals, y muchos consumidores llevan una via alternativa por si su proveedor no cargo. Se audito
que ocurre cuando esa via se usa, en tres clases: fallback ternario, duplicacion permanente del
helper, y guard que degrada a no-hacer-nada. Se le exigio separar la divergencia matematica de la
ruta de activacion real, con el techo de Hardening si solo tenia la primera.

**3 riesgos reales confirmados y CORREGIDOS, 2 hardening documentados.** Las divergencias
numericas se reprodujeron con los ficheros reales del repo, y las dos primeras tambien en la
pagina servida, con Chrome:

1. **Sin `lf-config.js`, el simulador solar seguia dando importes.** `bv-sim-monthly.js` esta
 escrito a la defensiva y con `CFG = window.LF_CONFIG || {}` cae a ramas locales que dejan IEE e
 impuesto indirecto en 0,00. Medido por la API publica `simulateForAllTarifasBV()`: 125 kWh a
 0,10 EUR/kWh en 30 dias pasan de **17,81 EUR a 14,04 EUR**, sin marcar la fila.
2. **Sin `lf-ssaa.js`, SSAA desaparecia.** El fallback devuelve
 `{ aplica:false, available:true }`, que traduce "no se si aplica" por "no aplica", asi que
 tampoco entra en la rama `dataUnavailable` que existe para eso. Una tarifa con
 `incluyeServiciosAjuste:false` pasa de **20,85 EUR a 17,81 EUR** (0,01908 EUR/kWh de 2026-07).
3. **El fallback del Observatorio perdia el redondeo monetario.** `pvpc-stats-csv.js` acumulaba
 `kwh * price` crudo y devolvia `eur` y `totalEur` sin normalizar, mientras
 `lf-surplus-prices.js` pasa por `roundMoneyProducts`. En frontera de medio centimo,
 85 x 0,095 = 8,075 se pintaba **8,07 EUR** por una ruta y **8,08 EUR** por la otra.

**Lo que el gate de `bv-ui.js` NO comprobaba.** Los tres casos eran alcanzables porque
`missingSimulationDependency` exigia `BVSim`, `BVSim.manualUi` y `LF.parseNum`, pero ni
`LF_CONFIG` ni `LF.ssaa`; y ningun modulo revienta al cargar sin ellos, porque todos los accesos
son `?.` o `|| {}`. `lf-config.js` es el unico proveedor de `LF_CONFIG` (`config.js` no lo
define) y los 13 primeros scripts de `comparador-tarifas-solares.html` van sin `defer`.

**La leccion, y es incomoda: la home NO estaba expuesta precisamente por ser menos defensiva.**
`lf-calc.js:20` hace `const CFG = window.LF_CONFIG;` sin fallback y su linea 46 accede a
`CFG.alquilerContador.eurosMes` en duro, asi que sin el proveedor lanza `TypeError` en vez de
devolver un importe rebajado. Un `?.` de mas convierte un fallo ruidoso en un importe falso
silencioso. Por eso el arreglo NO fue repartir fail-closed por el motor.

**Correcciones aplicadas (08/09/2026).**
- `bv-ui.js`: `LF_CONFIG` (con `calcularImpuestoIndirecto` y `calcularIEE`) y `LF.ssaa.calcCharge`
 pasan a dependencia dura del gate ya existente, que llama a `markSolarUnavailable()`. Es el
 mismo camino probado que cubre la falta de `bv-ui-helpers.js`. **Trampa evitada:** NO se pueden
 anadir a `requiredSimulation`, porque esa lista se indexa contra `window.BVSim` y
 `window.BVSim.LF_CONFIG` es `undefined` SIEMPRE: el simulador quedaria muerto para todo el
 mundo. Hay un centinela positivo en los tests justo para esa mutacion.
- `pvpc-stats-csv.js`: el fallback acumula `moneyProducts` y normaliza `monthlyRows[].eur` y
 `totalEur` con la misma `roundMoneyProductsOrFallback` del proveedor comun. `avg` y `avgPrice`
 siguen saliendo del acumulado CRUDO: el redondeo del importe no puede contaminar el EUR/kWh.
 El fallback **no se toca por lo demas**: su razon de existir sigue vigente.
- `styles.css`: el toast y el banner de recuperacion son los dos fijos al borde inferior y se
 tapaban cuando coincidian. Defecto **preexistente** (se reproduce bloqueando
 `bv-ui-helpers.js`), pero el cambio del gate lo hacia visible en dos escenarios mas. Se sube el
 toast con `:has()`; sin soporte queda el solape de antes.

**RECHAZADO: los dos hardening.** El fallback de `parseNum` en `desglose-integration.js` lee
`"0.123"` como `123` (le falta la excepcion `/^-?0\.\d+$/` de `lf-utils.js:88`), y los `round2`
locales de `pvpc.js`, `desglose-calculo.js` y `desglose-render.js` omiten `Number.EPSILON`
(`1.005` da 1,00 en vez de 1,01). Las divergencias son ciertas, pero **nadie demostro una ruta
productiva** que las alcance con la pagina en estado utilizable. No elevar sin esa ruta.

**Verificacion.** Suite 1844 -> 1851 (7 regresiones nuevas), lint 0/0. **6 mutaciones, 6
detectadas**, incluida la que rompe el simulador para todos. QA en Chrome real: 16 combinaciones
(solar normal / sin `lf-config` / sin `lf-ssaa`, y Observatorio) x claro/oscuro x
escritorio/movil, cero errores de consola, cero overflow horizontal, contraste 16,5:1 y 18,5:1
del mensaje y 19,6:1 del banner. En la pagina servida, el motor da 17,81 EUR y 20,85 EUR, y las
dos rutas del Observatorio devuelven identico importe con el dataset real.

**Sobre la defensa de arranque, que el informe original daba por inexistente.** `error-bootstrap.js`
detecta el `<script>` caido en fase `initial` y `lf-sw-update.js` pinta el banner y programa **una
recarga automatica unica a 750 ms** (`sessionStorage`, por pestana). Verificado en Chrome: en un
fallo transitorio la pagina se recupera sola antes de que nadie calcule. El escenario que sostenia
el hallazgo es el **persistente**: tras gastarse esa recarga, el simulador seguia operativo
calculando de menos. Al medir severidad en este repo hay que recorrer la recuperacion de arranque
hasta ver que pasa DESPUES de que se agota.

**QA post-deploy en produccion (08/09/2026, build `20260908-084553`).** 20 combinaciones de carga
(solar normal / sin `lf-config` / sin `lf-ssaa`, Observatorio y home) x claro/oscuro x
escritorio/movil contra luzfija.es, con la analitica bloqueada para no contaminar GoatCounter:
cero errores de consola, cero overflow, sin solape toast/banner, contraste 16,5:1 y 18,5:1.
Flujos reales con clic y tecleo nativos: la home rankea 101 filas y el simulador solar calcula 64
tarifas, ambos sin NaN. **La prueba que demuestra que el arreglo del Observatorio hace algo:** el
mismo CSV de 744 registros (agosto 2026) da hoy `11,86` exacto por las dos rutas, mientras el
build anterior devolvia `11.862597` por el fallback frente a `11,86` del canonico. En ESE CSV el
importe pintado coincidia por casualidad al truncar; en frontera de medio centimo no lo habria
hecho.

**Ampliacion del 08/09/2026: colores forzados.** Al repasar `forced-colors: active` sobre el
estado degradado aparecio un defecto **preexistente** que la ronda 19 no cubrio (miro guias y
Observatorio, no estos controles): al eliminarse degradados y bordes transparentes, tres botones
quedaban como texto suelto, sin forma de boton -- "Recargar ahora" del banner (blanco sobre banner
blanco), el CTA `#bv-simulate` del simulador y `.bv-upload-btn`. Corregido con colores de sistema
(`ButtonText`/`ButtonFace`) en `styles.css` y `bv-sim.css`; el `!important` es obligatorio en los
dos ultimos porque su regla base tambien lo lleva y va en una hoja posterior. Verificacion: barrido
de las 9 paginas principales en `forced-colors` (de 3 controles sin forma a 0) y comparacion del
estilo computado en modo normal contra produccion, identico en los 6 controles medidos por tema.
**Metodo reutilizable:** detectar el defecto comparando `backgroundColor` del control con el de su
padre y exigir borde u outline propio; sin eso, un boton sin forma pasa desapercibido porque su
TEXTO si es legible y el contraste sale perfecto.

**Falso positivo descartado durante ese QA:** tras calcular, `#bv-status` conserva el texto
"Calculando...". No es un defecto: `#bv-status-container` queda con `display:none`, asi que el
usuario no lo ve, y se comporta igual en el build anterior. No lo reportes.

**Criterio de reapertura.** Que un consumidor de `js/bv/` vuelva a leer `window.LF_CONFIG` o
`window.LF.ssaa` con fallback silencioso sin que el gate lo exija, o que
`js/pvpc-stats-csv.js` vuelva a devolver importes sin normalizar. Los tests son
`tests/bv-ui-dependencias-fiscales.test.js` y el bloque "el importe no depende de que ruta lo
calcule" de `tests/pvpc-stats-csv-fallback.test.js`.


<a id="puesto-del-ranking-ronda-27-08-09-2026"></a>
### El Puesto Del Ranking Frente Al Orden De La Vista (Ronda 27, 08/09/2026)

Auditoria de ChatGPT sobre el ORDEN y la POSICION de las filas del ranking de la home: que fila
sale antes que cual, que numero se le pinta, contra que se mide su diferencia y donde acaban las
filas sin total comparable. No es una ronda sobre importes.

**2 bugs confirmados, los dos CORREGIDOS**, mas un tercer defecto encontrado por Claude al
verificar en Chrome. Suite 1852 -> 1863, lint 0/0.

**1. El puesto pintado era el indice de la vista, no el del ranking (RESUELTA).** `lf-calc.js:616`
congela `posicion` al cerrar el ranking economico, pero **nadie la leia**: `lf-render.js` numeraba
con `String(idx + 1)` sobre el array ya filtrado y ordenado. Reproducido contra produccion (build
`20260908-112647`): al ordenar por Total descendente, la tarifa MAS CARA lucia `#1` junto a su
propio `+45,95 EUR` respecto a la mejor, y ninguna fila visible llevaba ya la marca `.best`; con el
filtro 1P, la primera fila era `#1` con `+6,49 EUR`. El chip movil de "Mi tarifa" heredaba el mismo
numero, porque es un espejo de la fila. Corregido con `rankingNumber()` en `lf-render.js`, que lee
`posicion` y cae al indice solo si falta. **La tabla sigue obedeciendo al usuario**: cambia el orden
y el subconjunto visibles; lo que ya no cambia es el numero.

**2. Empate absoluto resuelto por el orden de `tarifas.json` (RESUELTA).** Con el mismo importe y el
mismo saldo BV, el comparador de `lf-calc.js:555` devolvia `0` y el `sort` estable dejaba el puesto
en manos de la posicion en el fichero. **No es teorico:** el catalogo publicado tiene tres grupos
identicos en los cinco precios (`Nordy 24H V` / `Seneo Tarifa 3 Fija 24h`, `Masmovil` / `Jazztel` /
`Yoigo Tarifa de Luz`, y las dos `Endesa Solar Plus`), y en un escenario cualquiera de la home
aparecen ademas cinco o mas coincidencias al centimo entre comercializadoras distintas que no
comparten precios. En pantalla, los tres del grupo Masmovil salian en las filas 79-80-81, en el
mismo orden que ocupan en `tarifas.json`. Corregido con desempate por nombre (`localeCompare`,
`'es'`), que es estable, reproducible y no privilegia a "Mi tarifa" pese a entrar por `unshift()`.
No se demostro un empate en el puesto 1; el riesgo de que el cartel de tarifa mas barata dependiera
del orden del fichero queda como plausible, no reproducido.

**3. Las medallas viajaban con la vista (defecto encontrado por Claude, no por el auditor).** El
oro/plata/bronce de la celda de puesto salia de `tbody tr:nth-child(1..3)` en `styles.css`, que
coincidia con el numero solo mientras el numero ERA el indice. Corregido el punto 1, la primera
captura en Chrome mostro un `#101` dorado. Ahora `lf-render.js` pone `rank-1|2|3` desde `posicion`
y el CSS estiliza esas clases. **Leccion:** al mover un dato de la vista a la fila hay que barrer
tambien el CSS que lo decoraba por posicion; el selector no da error, simplemente miente.

**NO son hallazgos, verificados durante esta ronda:**
- **La tolerancia `< 0.01` del comparador frente a la comparacion en crudo de `applySort()`.** Fue
 la sospecha que abrio la ronda y es un falso positivo: las cuatro rutas asignan `totalNum` via
 `round2()` (`lf-calc.js:198`, `346/357`, `416/427`, `486/496`) y `round2` devuelve siempre
 `Math.round(...)/100`, de modo que dos totales que se ven iguales son bit-identicos. La tolerancia
 equivale a igualdad exacta y ambos ordenadores coinciden con Total ascendente.
- **`Vs mejor` no se recalcula al filtrar.** Correcto: mide contra la mejor tarifa economica global
 del calculo (`lf-calc.js:608-613`), no contra la primera fila visible. Lo que chirriaba era el
 puesto, no la magnitud.
- **El Top 5 del grafico ignora filtro y orden de la tabla.** Deliberado: reconstruye el Top 5
 economico con `sort(totalNum)`, y los filtros declaran `aria-controls="table"`.
- **Las filas no comparables al final.** `applySort()` las manda detras en ambos sentidos y
 `tieneRankingPosition()` les pinta guion; siguen sin recibir numero ni medalla.

**Verificacion.** 11 regresiones nuevas (`tests/ranking-posicion.test.js`, mas un caso en
`tests/mi-tarifa-chip.test.js` y el bloque de empate en `tests/calc.test.js`). **4 mutaciones, 4
detectadas**: volver a `idx + 1` en la celda, volverlo en el chip, devolver `0` en el empate y
repartir medallas por indice de vista. QA en Chrome real (Puppeteer, viewport movil 390x844 y
escritorio 1440x900) x claro/oscuro x tres estados de tabla (Total ascendente, Total descendente y
filtro 3P): 12 combinaciones, numeracion correcta en todas, medallas solo en 1/2/3, badge movil
alineado con la celda, sin overflow horizontal y sin NaN. El tema se siembra en
`localStorage('almax_theme')` ANTES de cargar: `prefers-color-scheme` no decide el tema en este
sitio, asi que emularlo da una matriz falsa con las cuatro capturas en oscuro.

**Calibracion del auditor (ChatGPT "luna", 4a ronda).** Cinco citas verificadas, las cinco exactas.
Declaro con precision que no ejecuto Vitest ni lint. Dos defectos repetidos: **severidad inflada**
(clasifico los tres hallazgos como P1 apoyandose en una frase del propio encargo, cuando el peor
resultado observable es una incoherencia de rotulo, no un importe falso) y **no contrastar contra
los datos reales**: razono los tres sobre escenarios inventados sin abrir `tarifas.json` ni el
sitio. Listar como hallazgo aparte el chip tambien infla el recuento: es la misma causa y se
arregla con el mismo cambio.

**QA post-deploy en produccion (08/09/2026, build `20260908-193520`, commit `dfd1ea0`).** 28
combinaciones de carga (7 paginas x claro/oscuro x movil 390x844/escritorio 1440x900): cero errores
de consola, cero peticiones fallidas, cero overflow horizontal, cero NaN y el tema correcto en las
28. El flujo del ranking en las 4 combinaciones de viewport y tema, con 101 filas reales: Total
ascendente da `1/2/3` con sus medallas y la primera con `—` y `.best`; Total descendente da
`101/100/99/98` sin medallas y la primera con `+50,71 EUR`; el filtro 3P conserva los puestos
globales; y ordenando por Potencia salen `39/52/76/96`, que es la prueba de que el numero ya no
sigue a la vista. El simulador solar sigue calculando sus 64 tarifas en las 4 combinaciones, sin
NaN. Cero balizas a GoatCounter en toda la bateria (opt-out sembrado y trafico observado).

**Chip movil de "Mi tarifa" en produccion (08/09/2026), el hueco que faltaba.** La bateria
anterior media el badge de las tarjetas, no el chip flotante, que solo aparece con "Comparar con mi
tarifa" activo, en movil y con la fila propia fuera de pantalla. Verificado aparte en los dos temas
con una tarifa propia cara a proposito (0,28/0,25/0,22 y 0,15/0,05): el chip anuncia `#102`,
`123,63 EUR`, `+60,89 EUR` en los TRES ordenes (Total ascendente, Total descendente y Potencia),
coincidiendo siempre con la celda y con el badge de su fila, mientras la primera fila de la vista
pasa por `1`, `102` y `39`. Antes del arreglo, en Total descendente el chip habria anunciado `#1`
para la tarifa mas cara del ranking. Cero errores de consola y cero balizas.

**Tres trampas de esta bateria, por si se repite.** (1) `page.setRequestInterception(true)` para
bloquear la analitica **rompe el sitio entero**: con el service worker registrado, Puppeteer no
puede continuar las peticiones y todas acaban en `ERR_FAILED`; el opt-out se siembra en
`localStorage('goatcounter_optout')` con el literal `'true'` (no `'1'`) y las balizas se OBSERVAN,
no se interceptan. (2) Un solo navegador para 34 paginas se cae a mitad con
`Target.createTarget: Session with given id not found`; hay que ir por bloques con
`userDataDir` propio y guardar de forma incremental. (3) Pulsar `#bv-simulate` con el formulario
vacio devuelve "Introduce datos para al menos un mes", que es el comportamiento CORRECTO: hay que
rellenar `#bv-manual-grid` con eventos `input`/`change` reales antes de simular. Y sigue vigente lo
ya sabido: contar el ranking solar por `tbody tr` da 780 porque suma los desgloses mensuales.

**Criterio de reapertura.** Que la celda de puesto, el badge de movil o el chip vuelvan a derivar
el numero del indice del array renderizado, o que alguien anada un criterio de orden que dependa de
la procedencia de la fila (orden del catalogo, insercion de "Mi tarifa") en vez de una magnitud
economica. Los tests son `tests/ranking-posicion.test.js` y el bloque "Empate absoluto" de
`tests/calc.test.js`.


<a id="cifras-del-observatorio-ronda-28-09-09-2026"></a>
### Las Cifras Del Observatorio: Que Promedia Cada Numero (Ronda 28, 09/09/2026)

Auditoria de ChatGPT sobre la CORRECCION ARITMETICA de las cifras publicadas en `/estadisticas/`:
que promedia cada una, sobre que universo, y si el rotulo que la acompana describe eso mismo. Es la
continuacion natural de la ronda 22 (que audito los mensajes) y de la 12 (que audito la cobertura),
sin solaparse con ninguna: aqui se miran los numeros.

**1 hallazgo suyo y 1 mio, los dos CORREGIDOS.** Cero bugs aritmeticos: ninguna cifra publicada esta
mal calculada. Suite 1863 -> 1868, lint 0/0.

**1. El subtitulo del perfil horario seguia hablando del anho con un mes seleccionado (RESUELTA).**
Con `state.month` distinto de `all`, `pvpc-stats-ui.js` filtra el universo del grafico a ese mes y
`hourlyMeta` lo dice (`Perfil promedio · Ago (31 dias)`), pero el subtitulo de la seccion se
escribia una sola vez en `updateCopyForType()` en funcion del TIPO y se quedaba en "Perfil horario
promedio del anho". El numero era correcto; el texto describia otro universo, y ese texto es
precisamente el que invita a mover consumos. Corregido con `buildHourlySubtitle(isSurplus, state)`,
que nombra el mes ("Perfil horario promedio de agosto de 2026") y conserva las dos variantes de
tipo. El HTML estatico sigue diciendo "del anho" porque la vista por defecto es anual.

**2. Dos productores median el mismo mes con unidades distintas (RESUELTA, encontrada por Claude al
verificar).** El auditor identifico el mecanismo pero lo clasifico como no observable: la tendencia
mensual (`buildMonthlyFromDaily`) promedia medias diarias y la comparativa interanual
(`computeMonthlyFromYearData`) promediaba todas las horas del mes. Barriendo las **640
combinaciones de mes x zona x tipo del repositorio**, siete se muestran DISTINTAS con los tres
decimales que usa `fmtCents`: PVPC de octubre de 2021 en Ceuta y Melilla (`0,259` en tendencia
frente a `0,258` en la comparativa) y excedentes de octubre de 2023 en las cinco zonas (`0,089`
frente a `0,088`). Todos son octubres: el dia de 25 horas pesa 25/745 al ponderar por horas y 1/31
al promediar por dias. Los dos tooltips usan el mismo formateador, asi que son dos importes del
mismo mes en la misma pagina. Unificado en la media de medias diarias, que es la unidad que ya
usaban la tendencia, los KPIs, la media movil de 12 meses, el interanual y mejor/peor mes; la
comparativa era la unica pieza que media distinto. La verificacion contra los siete casos reales
da ahora un valor identico en ambos graficos (`0,25850692258064517` en el caso de 8744).

**NO son hallazgos, verificados durante esta ronda:**
- **Las medias de 7 y 30 dias recortan los ultimos N dias DISPONIBLES, no los N dias naturales.**
 Semanticamente son cosas distintas, pero no hay ni un hueco interno de dias en los 320 ficheros
 mensuales del repositorio, asi que no existe caso reproducible. Si algun dia el dataset admite
 huecos internos, esto vuelve a ser una pregunta viva.
- **La media movil de 12 meses no pondera por horas.** Diferencia medida sobre la ventana real
 (2025-09-10 a 2026-09-09, 8760 horas): `2,58 x 10-6 EUR/kWh`, invisible a tres decimales. El
 contrato del sitio es la media diaria y asi lo dice `PVPC-SCHEMA.md`.
- **Las ventanas horarias no dan la vuelta a medianoche.** `computeWindowOptions()` corta en
 `start <= 24 - L`, de modo que un bloque como 23:00-02:00 nunca es candidato. Comprobado sobre los
 60 perfiles anuales y los 640 mensuales de las cinco zonas en PVPC y excedentes: en NINGUNO existe
 un bloque envolvente mejor que el que la pagina anuncia. No se toca.
- **Percentiles, mapa de calor, perfil por dia de la semana, `getWindowStats()` y el eje canonico de
 366 posiciones no publican ninguna cifra.** No tienen consumidor en `/estadisticas/`: la pagina
 calcula sus ventanas en la UI y su comparativa es mensual. No auditar como si se vieran.
- **El rango min-max son extremos HORARIOS, no de medias diarias.** El rotulo dice "Rango
 (min-max)" y no promete otra cosa.

**Verificacion.** 5 regresiones nuevas en `tests/pvpc-stats-ui.test.js` (bloque "Observatorio:
unidad de las medias y universo declarado"). **4 mutaciones, 4 detectadas**: volver a la media
ponderada por horas en la comparativa, fijar el texto del subtitulo, dejar que el mes no llegue al
texto y no pasar `state` a `updateCopyForType()`. QA en Chrome real (Puppeteer) con 12
combinaciones: escritorio 1440x900 y movil 390x844, claro y oscuro, y tres escenarios (mes
seleccionado, vista anual y excedentes con mes). Cero errores de consola, cero overflow horizontal,
cero NaN y graficos con datos en todas. El cambio de mes se comprobo ademas con interaccion real de
teclado sobre `#monthSelector`, no cambiando `.value`.

**Trampa del arnes, nueva.** En esta pagina **el contenedor que scrollea es `body`**, no el
documento: `window.scrollTo()` y `ctrl+Home` no mueven nada y `getBoundingClientRect()` devuelve
coordenadas negativas para elementos que se ven en pantalla. Hay que usar `document.body.scrollTop`.
Con la extension de Chrome, ademas, los clics por coordenada no llegaron al boton de tema; la
activacion real por teclado (foco + Enter) si.

**Criterio de reapertura.** Que alguien vuelva a introducir una segunda unidad para "media
mensual", o que el subtitulo del perfil horario deje de derivar del `state` que filtra el grafico.
Los tests estan en `tests/pvpc-stats-ui.test.js`. Si el dataset pasa a admitir huecos internos de
dias, hay que revisar las ventanas de 7 y 30 dias, que hoy cuentan dias disponibles.


<a id="csv-a-p1-p2-p3-ronda-29-09-09-2026"></a>
### De Un Fichero De Distribuidora A P1/P2/P3 Y A La Curva (Ronda 29, 09/09/2026)

Auditoria de ChatGPT sobre el camino completo del importador: cabecera y preambulo, mapeo de
columnas, numeros y unidades, base horaria, asignacion de periodo, agregacion y coherencia entre los
tres agregados y la curva que consume el PVPC. Se acoto FUERA todo lo ya cerrado (cambios de hora,
duplicados, formula XLSX, generacion frente a exportacion, limites de consumo, contratos numericos)
y tambien la ronda 14, que fue de cobertura de tests y no de correccion.

**Cero bugs observables. Un cambio, clasificado como ALINEACION DEFENSIVA**, igual que `fv.tipo` en
la ronda 24. Suite 1868 -> 1873, lint 0/0.

**1. La unidad de EHCR/EHEX la decidia el tamanho del numero (RESUELTA como alineacion).**
`detectUnitFactor()` (`lf-csv-utils.js:1411`) deduce Wh cuando la cabecera no declara unidad y
alguna de las 20 primeras muestras llega a 100. Las UNICAS cabeceras mapeables sin marca de unidad
son `ehcr` y `ehex` de UFD, que `SIMULADOR-BV.md:853` define en kWh. Reproducido: con
`CUPS;FECHA;HORA;EHCR;EHEX` y valores 128 y 64, el parser devuelve `0,128` y `0,064` kWh y avisa
"Valores en Wh detectados". Es decir, para las dos unicas cabeceras que llegan a ese heuristico,
**el heuristico solo puede equivocarse**. Corregido con `CONTRACT_KWH_HEADERS` (factor 1 para
`ehcr`/`ehex`), sin tocar la deduccion para cabeceras que si carecen de contrato.

**Por que NO es un bug, pese a que el auditor lo clasifico como P1 con un impacto de 24,63 EUR.**
El disparador exige mas de 100 kWh en UNA hora. El sitio solo compara 2.0TD, cuyo tope de potencia
es 15 kW, asi que una hora no puede pasar de ~15 kWh; en el fixture real de 7344 horas
(`tests/fixtures/1.csv`) el maximo horario medido es **3,560 kWh**. El caso que construyo esta
fuera del contrato del dominio, como los cinco "riesgos reales" de la ronda 24. Se corrige igual
porque el coste es una linea y elimina una trampa, no porque hubiera un importe falso.

**2. Redondeo por mes en Datadis mensual: RECHAZADO.** Propuso mover el `r2()` de
`parseDatadisMonthlyRows` (`lf-csv-utils.js:646-648`) al momento de presentar. Su caso son 12 meses
de 0,009 kWh, que no es un consumo domestico: un mes real de Datadis va en decenas o centenas de kWh
con dos decimales en origen, asi que el redondeo pierde como mucho 0,005 kWh por mes sobre miles, y
el formulario muestra dos decimales de todas formas. No se toca sin un fichero real que lo exija.

**Verificado a mano y correcto (con cifras, no por lectura):** los seis fixtures reales dan los
mismos agregados que reporto el auditor. En `1.csv`: P1 **394,698**, P2 **371,794**, P3
**1019,167**, total **1785,659** kWh sobre 7344 filas, con **3056,543** kWh de excedente neto. La
identidad del neteo cuadra: AE bruto 1793,077 menos 7,418 kWh de horas con importacion y
exportacion simultaneas. Cabecera con dos lineas de preambulo, celdas vacias, base 0-23 de i-DE,
alias duplicados y la coherencia curva/agregados salieron limpios.

**Verificacion.** 5 regresiones nuevas en `tests/csv-hardening.test.js` (bloque "Unidad por
contrato de cabecera"). **3 mutaciones, 3 detectadas**: quitar la lista de contrato, anhadir un
alias de energia sin unidad y dejar de convertir una columna que declara Wh. Una de las cinco es un
centinela sobre el propio fichero: si alguien anhade a `HEADER_ALIASES` un alias de energia sin
`wh`/`kwh` ni entrada en la lista de contrato, el test falla, porque ese alias reviviria el
heuristico de magnitud. E2E real en Chrome (Puppeteer): importacion de `1.csv` por el input de
fichero y pulsacion real de `#btnAplicarCSV` en escritorio 1440x900 tema oscuro y movil 390x844
tema claro; los tres campos quedan en 394,70 / 371,79 / 1019,17 y `window.LF.consumosHorarios`
conserva 7344 registros, sin errores de consola ni overflow.

**Trampa del E2E, para la proxima.** El boton de aplicar del CSV es `#btnAplicarCSV` ("Aplicar
consumos"); buscar por texto /aplicar/ encuentra antes el "Aplicar datos" del extractor de factura
PDF, que no hace nada con el CSV y deja los campos con sus valores por defecto. Parecia un fallo del
importador y era el selector.

**Criterio de reapertura.** Que aparezca un formato real de distribuidora con una columna de energia
sin unidad en la cabecera y con valores legitimos por encima de 100, o que el sitio deje de estar
limitado a 2.0TD. Cualquiera de las dos cosas devuelve el heuristico de magnitud a la vida.


<a id="ciclo-de-vida-curva-importada-ronda-30-09-09-2026"></a>
### El Ciclo De Vida De La Curva Importada (Ronda 30, 09/09/2026)

Auditoria de ChatGPT sobre cuando nace, cuando muere y cuando se adapta la curva horaria del CSV, y
si todos sus consumidores ven el mismo estado. El dato parte el calculo en dos: el PVPC se calcula
hora a hora sobre la curva y el resto del ranking sobre los agregados del formulario, asi que una
curva que sobreviva a un cambio que la invalida producira dos consumos distintos en la misma tabla.

**CERO hallazgos y CERO cambios de codigo.** Es la segunda ronda que se cierra sin tocar nada, y se
encargo sabiendolo: el prompt avisaba de que el area ya tenia guards y un test dedicado, y de que un
cero bien documentado era un resultado valido.

**Verificado de forma independiente por Claude, con cifras y no por lectura:**
- La reclasificacion de zona sobre `tests/fixtures/1.csv` (7344 horas reales): Peninsula da P1
 **394,698** / P2 **371,794** / P3 **1019,167**; Ceuta-Melilla da **491,111** / **275,381** /
 **1019,167**; Canarias coincide con Peninsula. El total, **1785,659 kWh**, no cambia en ninguna:
 cambia la atribucion, no la energia.
- `hasDstTransitionRecords()` sobre esa curva devuelve `true`, que es lo que hace que un salto a
 Canarias la retire en vez de conservarla.
- Las cuatro dimensiones de `assessCsvConsumosRef` (`lf-inputs.js:130-152`) recorridas una a una:
 los agregados son la primera frontera, luego el perfil de periodos y luego el reloj. Ninguna
 combinacion se queda sin rama.
- La clave de cache PVPC (`pvpc.js:286-332`) incluye zona, codigo postal, vivienda canaria,
 agregados, bono social y la firma de la curva, y `calculate()` la construye DESPUES de reconciliar
 (`lf-app.js:335-338`), asi que no hay ventana donde se firme el estado viejo.

**Confirmado como decision deliberada, no como hallazgo:** al cruzar entre Canarias y una zona
`Europe/Madrid`, la curva SOLO se retira si contiene un dia de cambio de hora; una curva sin esos
dias se conserva y se reetiqueta la referencia. Esta escrito en `CAPACIDADES-WEB.md` y el comentario
del codigo lo repite. Quien lo mire de nuevo llegara al mismo sitio: es el mismo eje que la ronda
del 12/08/2026 cerro para la numeracion horaria.

**Los duplicados de `clearCsvImportState` NO se unifican.** `lf-app.js:253-260` y `factura.js:2228-2234`
repiten en linea las tres asignaciones como fallback. La garantia que sostiene el duplicado es poder
invalidar el estado aunque el modulo que publica el helper no haya cargado, que es exactamente el
escenario de carga parcial que defiende el resto del arranque. Unificarlos sin sustituir esa garantia
seria una regresion. El auditor lo clasifico bien.

**Tolerancia de redondeo en la referencia (hardening, no se toca).** `buildCsvConsumosRef`
(`lf-inputs.js:110-127`) redondea los tres agregados a dos decimales, asi que una edicion manual por
debajo de 0,005 kWh no invalida la curva. Medido: como mucho 0,015 kWh entre los tres periodos, que
a precio PVPC no llega a la milesima de euro y muere en el `round2` del importe. Estrechar esa
tolerancia haria que reescribir el mismo numero tirase la curva.

**Criterio de reapertura.** Que aparezca una cuarta pieza de estado que acompanhe a la curva y no
entre en `clearCsvImportState`, que `calculate()` deje de reconciliar antes de firmar, o que la
clave de cache PVPC pierda la zona o la firma de la curva. El test vivo es
`tests/imported-curve-regression.test.js`.


<a id="desglose-frente-a-la-fila-ronda-31-09-09-2026"></a>
### El Desglose De Factura Frente A La Fila Del Ranking (Ronda 31, 09/09/2026)

Auditoria de ChatGPT sobre las cuatro piezas del desglose (`desglose-calculo.js`, `desglose-render.js`,
`desglose-integration.js`, `desglose-factura.js`, unas 1700 lineas) frente a `lf-calc.js` y
`lf-render.js`. La pregunta no era si el desglose calcula bien, que ya tiene tests adversarios de
propiedades, sino si la fila y el desglose cuentan la MISMA historia concepto a concepto.

**CERO hallazgos y CERO cambios de codigo.** Segunda ronda consecutiva en cero, y tambien esta se
encargo avisando de que un cero documentado era resultado valido.

**Lo que hizo el auditor:** barrido de las 119 tarifas publicadas por cinco escenarios dentro de
2.0TD (Peninsula, Canarias, Ceuta-Melilla, con y sin solar, con BV con y sin saldo), 576
comparaciones fila contra desglose con diferencia maxima de 0,00 EUR, y comprobacion de que la
jerarquia de conceptos impresos suma el total impreso.

**Lo que verifique yo, y es lo que el no podia hacer: la interfaz real.** Puppeteer sobre Chrome,
cinco filas abiertas de verdad pulsando la celda de total, en escritorio 1440x900 tema oscuro con
Peninsula y en movil 390x844 tema claro con Canarias. En las cinco, el importe de la fila y el
`TOTAL FACTURA` del modal coinciden al centimo: `TE A tu Aire Luz Siempre` 62,74 EUR en Peninsula y
51,91 EUR en Canarias, `Imagina Base Noche y Findes 4000 3P` 64,19 EUR, `Nexus Estable` 69,44 EUR.
La seccion fiscal cambia de rotulo con la zona (`IVA` frente a `IMPUESTOS Y ALQUILER (IGIC)`) y el
cuerpo del modal no desborda en horizontal en movil. Cero errores de consola y cero NaN.

**Confirmado como contrato, no como incoherencia:** en bateria virtual conviven dos importes
distintos a proposito, el coste de ranking y lo que se paga ese mes, y las dos vistas los separan
igual. Comparar el total del desglose contra el importe pagado seria confundir dos contratos.

**No se toca `reconcileToTarget()`** (`desglose-render.js:95-109`), que redondea cada sublinea,
mide el desfase contra el subtotal y corrige la ultima linea cuando la diferencia no pasa de
0,05 EUR. Es lo que hace que la suma de lo IMPRESO cuadre con el subtotal impreso; quitarlo
devolveria el desglose que no suma.

**Falsos positivos que conviene no repetir:** sumar literalmente todos los nodos de importe del
modal cuenta dos veces los subtotales, el total y el precio medio, que es informativo y no una linea
monetaria. La suma correcta es la jerarquia: potencia, consumo a pagar, otros conceptos y seccion
fiscal.

**Trampa del arnes, nueva y cara:** los campos de la home se rehidratan despues de `load`, asi que
escribir con `page.type()` sin vaciar antes produce `3,453,45`, la validacion falla en silencio y la
tabla se queda vacia. Parece que el calculo no funciona y es el arnes. Hay que hacer clic, Control+A,
Backspace y entonces escribir. Ademas el modal solo abre con clic REAL sobre `.total-cell`: un
`.click()` sintetico desde `page.evaluate` no lo abre, y su selector es `.desglose-modal`
con `aria-hidden="false"`, creado en tiempo de ejecucion.

**Criterio de reapertura.** Que aparezca una tercera magnitud monetaria en la fila sin su pareja en
el desglose, que `totalRanking` deje de derivarse del mismo total que publica la fila, o que alguien
retire la reconciliacion de redondeo de las sublineas.


<a id="opciones-de-la-home-cruzadas-ronda-32-09-09-2026"></a>
### Las Opciones De La Home Cruzadas Entre Si (Ronda 32, 09/09/2026)

Auditoria de ChatGPT sobre la combinatoria de opciones de la home, con un angulo concreto: la home
oculta tres bloques segun otras opciones (vivienda canaria, solar y bono social) pero
`getInputValues()` (`lf-inputs.js:63-82`) lee TODOS los campos sin mirar si estan visibles. La
pregunta era si algun valor sigue contando cuando el usuario ya no puede verlo.

**CERO hallazgos y CERO cambios de codigo.** Tercera ronda consecutiva en cero.

**La distincion que deja la ronda, y que conviene citar si alguien vuelve a levantarlo:** valor
oculto no es lo mismo que valor activo oculto. Los campos conservan su contenido, pero cada economia
esta detras de su propia bandera (`solarOn && fv.bv && fv.tipo === 'SIMPLE + BV'` en
`lf-calc.js:310`, `t.esPVPC && bonoSocialOn` en `lf-calc.js:118`), y cuando un valor pasa a ser
economicamente relevante su control ya esta visible.

**Verificado por Claude en Chrome real, que es lo que el auditor no podia hacer.** Recorrido completo
de la vivienda canaria con `TE A tu Aire Luz Siempre` a 3,45 kW y 100/100/100 kWh:

| Paso | Zona | Casilla | Visible | Importe |
|---|---|---|---|---|
| 1 | Peninsula | marcada | no | 62,74 EUR |
| 2 | Canarias | marcada | **si** | 51,91 EUR |
| 3 | Canarias | desmarcada | si | 53,44 EUR |
| 4 | Peninsula | desmarcada | no | 62,74 EUR |
| 5 | Canarias | desmarcada | si | 53,44 EUR |

La casilla se hace visible en el mismo paso en que empieza a mover el importe, y su estado sobrevive
al viaje de ida y vuelta. Los 1,53 EUR de diferencia nunca se aplican sin que el control este a la
vista. Comprobado ademas que con solar apagado los 120 kWh de excedentes y los 50 EUR de saldo
guardados NO tocan el importe (62,74 EUR con y sin ellos) y que al encender solar reaparecen
(52,05 EUR). Cero errores de consola.

**Observacion propia, deliberada y no defecto:** una opcion que se marca DESPUES del ultimo calculo y
antes de recargar se pierde, porque `saveInputs()` viaja con el calculo (`lf-app.js:351`). Es
coherente con el contrato de "cambios pendientes": lo que se guarda es el ultimo estado calculado, no
cada pulsacion. Verificado en navegador: marcar solar y recargar sin calcular devuelve la casilla
apagada, con los seis campos numericos intactos porque si estaban calculados.

**Fronteras confirmadas, no reabrir:** el bono social solo toca filas PVPC y ninguna tarifa libre
cambia de importe al activarlo; con solar encendido la fila PVPC queda fuera de comparacion, asi que
no existe ruta donde bono social y compensacion se resten a la vez sobre el mismo importe.

**Criterio de reapertura.** Que aparezca una economia nueva que no compruebe su propia bandera, que un
bloque deje de hacerse visible cuando su valor pasa a contar, o que `saveInputs()` deje de viajar con
el calculo sin sustituir el contrato de cambios pendientes.


<a id="mi-tarifa-como-formulario-ronda-33-09-09-2026"></a>
### "Mi Tarifa" Como Formulario: Validar, Guardar Y Decir Que Se Ha Guardado (Ronda 33, 09/09/2026)

Auditoria de ChatGPT sobre `js/lf-tarifa-custom.js` (801 lineas, el modulo peor cubierto del repo por
numero de tests que lo referencian) como EDITOR, no como productor del objeto, que se cerro en la
ronda 23. Se acoto fuera todo lo ya resuelto de este modulo, que son ocho entradas del registro.

**1 bug confirmado y CORREGIDO.** Suite 1873 -> 1876, lint 0/0.

**El autoguardado pendiente resucitaba la tarifa recien borrada (RESUELTA).** Cada campo programa su
autoguardado con `setTimeout(..., 800)` y guarda el identificador en una variable LOCAL a su listener
(`lf-tarifa-custom.js:662-665`), de modo que `clearCustomTarifaMain()` no podia cancelarlo. Secuencia:
editar un precio, pulsar "Limpiar datos guardados" antes de que venzan los 800 ms, y aceptar el
confirm. La clave `lf_custom_tarifa` se borra, los campos se vacian y el indicador desaparece; al
vencer el temporizador, `saveCustomTarifaMain()` escribe de nuevo la clave con **todos los campos
vacios** y `updateCustomTarifaIndicatorMain(data)` devuelve el `💾 fecha` a la pantalla. Corregido con
un registro de temporizadores en vuelo (`pendingSaveTimers`) que `clearCustomTarifaMain()` cancela
ANTES de borrar. El debounce se conserva: su garantia es no escribir en `localStorage` en cada
pulsacion.

**Severidad baja, y la clasificacion importa:** el registro resucitado esta vacio, asi que
`validateMiTarifa()` lo rechaza y no llega a producir una fila ni un importe falso. El danho es de
estado y de confianza: el usuario pulsa borrar, ve "✓ Datos eliminados" y un instante despues vuelve
el indicador de datos guardados. El auditor lo clasifico asi por su cuenta, sin inflarlo.

**Verificacion.** 3 regresiones nuevas en `tests/custom-tarifa.test.js` con temporizadores falsos, una
de ellas roja antes del arreglo. **3 mutaciones, 3 detectadas**: quitar la cancelacion, no registrar
el temporizador y vaciar el cuerpo del autoguardado. E2E en Chrome real (escritorio 1440x900 oscuro y
movil 390x844 claro): escribir la tarifa, editar, limpiar antes del debounce aceptando el confirm, y
comprobar a los 2 s que la clave sigue borrada y el indicador oculto; despues volver a escribir y ver
que el autoguardado sigue vivo. Sin errores de consola ni overflow.

**Lo demas salio limpio, comprobado con tablas de casos:** la puerta de validacion distingue vacio de
cero explicito (P2=0 se acepta, P1=0 no, energia 0/0/0 no), rechaza negativos y mas de ocho decimales
y acepta coma y punto; la carga de un registro legacy sin los campos nuevos no rompe nada; la
importacion de precios desde el QR de la factura exige los cinco precios y limpia antes las opciones
solares para no mezclar contratos; lo oculto deja de validarse; y "Mi tarifa" sigue fuera del
escenario compartido.

**Nota de la suite, sin explicar:** en una ejecucion completa fallo una vez
`tests/pvpc-dataset-integrity.test.js` y volvio a pasar en aislado y en la siguiente ejecucion
completa. No se reprodujo y no lo toca este cambio; queda anotado por si reaparece.

**Criterio de reapertura.** Que alguien vuelva a programar un autoguardado sin registrarlo en
`pendingSaveTimers`, o que aparezca otro escritor de `lf_custom_tarifa` que no pase por
`saveCustomTarifaMain()`.


<a id="vigencia-docs-y-guias-ronda-34-09-09-2026"></a>
### Vigencia De Documentacion Y Guias Al 09/09/2026 (Ronda 34)

Segunda auditoria de documentacion y guias, con el disparador que exige el metodo: NO se abrio por
calendario, sino porque las rondas 24 y 28 a 33 del mismo dia cambiaron cinco comportamientos y habia
que comprobar si algun texto los contradecia. Superficie: los 14 `.md` de la raiz, las 25 guias y su
indice, y el copy verificable de las paginas de producto.

**4 correcciones aplicadas, todas de copy o de fecha. Cero cambios funcionales.**

**1. La calculadora prometia una factura, no una estimacion (RESUELTA).**
`calcular-factura-luz.html` decia "El calculo incluye TODO: ... Es tu factura real completa", y dos
parrafos mas abajo la misma pagina se describe como estimacion. Reescrito para decir que es una
estimacion de lo que pagarias con cada tarifa y no la factura que emitira la comercializadora. Es el
hallazgo con mas impacto de la ronda: afecta a como se debe usar el resultado para decidir un
contrato.

**2 y 3. "Desglose exacto" en dos guias (RESUELTAS).** En
`pvpc-vs-mercado-libre-cuando-te-conviene-cada-uno.html` y en
`tarifas-indexadas-pool-cuota-cuando-interesan-y-cuando-no.html`. "Exacto" es claim prohibido en copy
publico. Sustituidos por "desglose estimado" y "desglose de conceptos".

**4. Fecha de cabecera del registro (RESUELTA).** `AUDITORIA-REGISTRO.md` declaraba
`Ultima actualizacion: 2026-09-05` conteniendo ya entradas del 09/09. Este fichero es ENTRADA del
sincronizador, asi que su cabecera se edita a mano; `AUDITORIA-IA.md` si la lleva generada.

**5. FAQ visible fuera del `FAQPage`: RECHAZADO como incidencia, resuelto de otra forma.** El auditor
pidio anhadir al JSON-LD las dos preguntas que hay fuera del bloque `#faq` de la calculadora. No
procede: el riesgo de Google es marcado que NO se ve, no contenido visible sin marcar, y una de las
dos ("¿Es gratis calcular mi factura?") duplica una pregunta que el propio `FAQPage` ya tiene
("¿Es gratis usar la calculadora?"), asi que anhadirla habria creado una entrada duplicada en datos
estructurados. Lo que si era real es la redundancia: la pregunta duplicada se ha retirado de la
pagina. `scripts/check-faq-jsonld-sync.mjs` sigue en 0 incidencias sobre 98 FAQ visibles y 37 HTML.

**Barrido propio de claims prohibidos en TODO el sitio:** 17 apariciones de "exacto/exacta" ademas de
las dos corregidas, todas lenguaje descriptivo legitimo ("los horarios exactos dependen del
calendario", "300 kWh exactos todos los meses", "el tope es exacto para 200"). Ninguna es una promesa
de precision del calculo. Cero apariciones problematicas de "tiempo real". Los usos de "oficial"
atribuyen la fuente a BOE, REE/ESIOS o CNMC; ninguno se autoatribuye oficialidad.

**Verificado y correcto, no tocar:** fiscalidad vigente (IVA 21% e IEE 5,11269632% desde el
01/06/2026, sin activarse la excepcion de septiembre porque el IPC de electricidad de julio quedo en
8,4%), bono social 42,5%/57,5% para todo 2026, rescision sin penalizacion del RD 88/2026, ayudas
Auto+ del RD 609/2026, 119 tarifas, 25 guias, 38 paginas y las fechas visibles y estructuradas de las
guias, que se mueven juntas por `scripts/seo-date-logic.mjs`.

**Trampa de esta ronda, y se repite:** el ZIP del auditor era ANTERIOR al despliegue del mismo dia, y
por eso reporto que el arreglo de "Mi tarifa" no estaba en el codigo y que faltaban las rondas 32 y 33
en la tabla de areas. Ambas cosas ya estaban. **Con este auditor hay que fechar el ZIP: si el dia ha
tenido despliegues, decirle contra que build audita.** Es el mismo patron del ZIP de agosto que
parecia traer 41 ficheros modificados y solo cambiaba los finales de linea.

**Criterio de reapertura.** El mismo de la entrada anterior: cambiar una funcion que la documentacion
describa, no el calendario. Anhadido ahora: cualquier norma citada en `MANTENIMIENTO-NORMATIVO.md`
que caduque el 31/12/2026, empezando por las deducciones de IRPF de movilidad electrica.


<a id="vista-rapida-pvpc-dia-en-curso-ronda-35-10-09-2026"></a>
### La Vista Rapida De PVPC Con El Dia En Curso Incompleto (Ronda 35, 10/09/2026)

Primera auditoria del estado local compartido (dos pestanas, claves de `localStorage`, cache PVPC
por zona y "Limpiar cache"): **cero hallazgos ahi**. El bug salio de un control cruzado que se hizo
de paso, comparando el ranking de Peninsula con el de Canarias.

**1 bug CORREGIDO, visible en produccion todos los dias para toda la zona Canarias.**

**El defecto.** Con zona Canarias, la vista rapida de PVPC (boton de precios por hora de la home)
respondia siempre `❌ Error al cargar precios. Inténtalo de nuevo.`, con `AHORA`, `Min` y `Max` a
rayas y `[PVPC] Error hoy: Error: Sin datos (dataset estatico)` en consola. En Peninsula y en
Ceuta/Melilla la misma vista funcionaba. Reproducido contra `https://luzfija.es/` en Chrome real el
10/09/2026, con la analitica bloqueada.

**Por que pasa, y por que pasa SIEMPRE.** La ultima hora del dia civil canario (23:00 local) cae en
el dia PENINSULAR siguiente, que ESIOS publica sobre las 20:15. El workflow diario descarga hasta
"manana" en la zona del geo, asi que cuando corre (commit sobre las 00:07 de Madrid) esa hora todavia
no existe: el fichero de 8742 se publica cada dia con el dia en curso a 23 horas, y el propio fichero
lo declara en `warnings: ["<dia>: unexpected points=23 expected=24 or 96"]`. Se completa en la
descarga del dia siguiente. Comprobado en cuatro dias consecutivos (07, 08 y 09/09 en el historial de
`git`, y 10/09 en el fichero servido en produccion) y solo en `data/pvpc/8742`: el resto de zonas
comparte reloj con Peninsula y los ficheros de excedentes se guardaban entonces en hora peninsular por
decision del generador. **Superado el 23/09/2026 (ronda 46):** `data/surplus/8742` va ahora en hora
canaria y su dia en curso tambien se publica con 23 horas.

**El dato no estaba mal; lo estaba el consumidor.** `scripts/check_data_freshness.py` (checks 9 y 10)
y `tests/pvpc-dataset-integrity.test.js` aceptan a proposito que el ultimo dia publicado llegue
corto, y `validatePvpcDayCoverage` (`js/lf-csv-utils.js`) tiene para eso la excepcion `allowPartial`
de los dias `>= hoy`. Lo que fallaba es que `js/index-extra.js` conservaba una **copia privada** del
validador de dia, `__pvpcDayPairsUsable`, que exigia el dia completo. La unificacion del 12/08/2026
("Validador De Dia Civil Compartido") alcanzo a `pvpc.js`, `pvpc-stats-engine.js`,
`pvpc-stats-csv.js` y `lf-surplus-prices.js`, pero **se dejo fuera este consumidor**. La entrada de
aquel dia ya avisaba de que el Observatorio se rompio por lo mismo y cita el caso `8742/2026-08-13`.

**Correccion.** `__pvpcDayPairsUsable` delega en el validador compartido con
`allowPartial = dateStr >= hoy` en la zona horaria del DATASET, y conserva una copia local
equivalente para cuando `lf-csv-utils` no ha cargado (hay test que fija esa equivalencia). Se sigue
exigiendo continuidad, pertenencia al dia civil y primera hora presente: `allowPartial` solo tolera
huecos por el extremo final.

**Lo que NO podia quedar asi al aceptar dias parciales.** `__pvpcFindNowIndex` devolvia "la ultima
entrada con `epoch <= now`", asi que entre las 23:00 y las 24:00 en Canarias habria rotulado el
precio de las 22:00 como el de AHORA: un importe falso, peor que el error que se estaba arreglando.
Ahora exige que la entrada cubra el instante (`epoch <= now < epoch+3600`) y devuelve `-1` si
ninguna lo hace; la cabecera muestra entonces `Pendiente de publicar` (o `Sin dato para esta hora` si
el dia esta completo, caso del modal abierto al cruzar la medianoche) y ninguna fila se marca como
AHORA. Ademas la lista avisa de que el dia no esta completo y de que el minimo y el maximo son los de
lo publicado.

**Riesgo de segundo orden, documentado y NO corregido.** El ranking usa dias CERRADOS y un dia
cerrado incompleto debe invalidar PVPC (fail-closed, decision firme). Como el hueco se repara en la
descarga siguiente, el ranking canario solo se ve afectado si esa descarga falla o se retrasa: en ese
caso el dia incompleto pasa a ser el ultimo dia cerrado y **PVPC desaparece entero del ranking**.
Reproducido con la copia local del repositorio, que iba una ejecucion por detras: 100 filas en vez de
101, sin panel de precios y con el toast de error. No se relaja el contrato de dia cerrado; lo que
corresponde es que el dato se repare, como hace hoy.

**Tests.** `tests/index-extra-dia-parcial.test.js` (7) y `tests/pvpc-modal-dia-parcial.test.js` (5).
Cubren aceptar hoy sin la ultima hora y sin gastar el refetch, seguir rechazando un dia historico
incompleto, un dia sin primera hora, un dia con hueco intermedio, la equivalencia de la copia local
sin `lf-csv-utils`, y en el modal: lista pintada con aviso, no rotular como AHORA una hora pasada,
que un dia completo siga mostrando su precio actual, y que la pestanha "Manana" aparezca con el dia
siguiente a medio publicar. Este ultimo caso cubre la rama `>= hoy` del validador, que HOY no tiene
recorrido real porque el fichero nunca trae el dia siguiente (ver mas abajo): sin el test, esa rama
se estrenaria sin cobertura el dia que cambie la cadencia de la descarga. **Validados por mutacion,
6 mutantes, todos detectados**: `allowPartial` fijado a `false` (5 tests caen), fijado a `true` (3),
restringido a `=== hoy` (1), `__pvpcFindNowIndex` sin la cota superior (1), bandera de dia parcial
siempre `false` (4) y guard del precio actual siempre `true` (2).

**Trampas de esta ronda.**
- **El service worker invalida la prueba local.** Sirve `/data/` desde `CacheStorage` y su script NO
  pasa por la interceptacion de peticiones de la pagina, asi que inyectar el fichero de produccion
  parecia no tener efecto: la pagina media el dataset LOCAL cacheado. El sintoma fue un resultado
  intermitente segun cuando activara el SW. Hay que desactivar `navigator.serviceWorker` en la
  pagina antes de medir.
- **`DOMContentLoaded` sobrevive a todo el fichero de test.** Reimportar `index-extra.js` y volver a
  disparar el evento en cada test deja instancias VIEJAS escuchando, y cada una repinta el modal con
  el mes que tenga en su cache. Se detecto porque un test mostraba el precio del fixture del test
  anterior. Por eso el fichero del modal importa el modulo UNA vez y cada test usa un mes distinto.

**Por que el dato no puede llegar completo, medido el 10/09/2026.** Las tres ultimas ejecuciones del
workflow arrancaron a las 22:03, 22:06 y 22:21 UTC (el cron pide las 20:00 y GitHub lo retrasa unas
dos horas). En ese instante en Canarias son las 23:0x, asi que cada ejecucion COMPLETA el dia que
esta terminando y escribe el siguiente con 23 horas. La hora que le falta a ese dia siguiente
(22:00Z) es la primera hora del dia PENINSULAR posterior, que REE publica sobre las 20:15 de la
tarde de ese mismo dia: unas veinte horas despues de la ejecucion. Prueba de que aun no existe, sin
necesitar la clave de ESIOS: el fichero de Peninsula de esa misma ejecucion tampoco trae el dia
siguiente pese a que `auto_detect_range` lo pide (`end = today + 1`). Consecuencia: para un usuario
canario, la ultima hora de SU dia solo puede existir a partir de las 18:15Z de ese mismo dia. No es
un problema de horario del cron: es la ventana de publicacion.

**Segunda ejecucion del workflow por la tarde: EVALUADA Y RECHAZADA (10/09/2026).** Con la cadencia
actual el fichero mensual termina siempre en el dia en curso, en las cinco zonas, asi que
`cargarManana()` no encuentra datos y la pestanha "Manana" del modal no aparece NUNCA. Se estudio
anhadir un `cron` vespertino (`30 19 * * *`) para llenarla y, de paso, completar el dia canario en
sus ultimas horas. La parte de datos aguanta: `check_data_freshness.py` solo exige exactitud a los
dias `< hoy`; `tests/pvpc-dataset-integrity.test.js` solo permite que llegue corto el ULTIMO dia
publicado; el ranking valida unicamente el periodo cerrado que pide (`validateClosedPvpcPeriod`), asi
que un dia futuro no le afecta; y `merge_month_file` nunca sustituye un dia completo por uno mas
corto, de modo que correr dos veces al dia es seguro.

**Lo que lo tumba es el Observatorio, medido con el dataset que dejaria esa ejecucion.** Al entrar
manana en el fichero, el KPI de cabecera cambia de dia CADA TARDE:

| Fichero | KPI "ULTIMO DIA" | Media 7 dias |
|---|---|---|
| Actual (sin manana) | `Media del dia - 2026-09-10`, 0,196 EUR/kWh | 0,189 EUR/kWh |
| Con ejecucion de tarde | `Media del dia - 2026-09-11`, 0,162 EUR/kWh | 0,181 EUR/kWh |

Es decir: el numero mas visible del Observatorio pasaria a describir un dia que todavia no ha
ocurrido, y las ventanas moviles de 7 y 30 dias y el interanual lo incluirian. En Peninsula ademas
SIN aviso ninguno, porque alli manana llega completo y no dispara `provisionalDays`; en Canarias
salen cinco marcas de provisional/parcial. El rotulo lleva la fecha, asi que no miente, pero cambia
lo que significa una cifra publicada segun la hora a la que se mire, justo la clase de incoherencia
que cerro la ronda 28. **No compensa por una pestanha cuyo contenido son precios que el usuario ve
igual al dia siguiente.** Tampoco compensa la variante conservadora (ejecucion de tarde con el rango
topado a `--to <hoy>`, que no meteria dias futuros): solo ganaria un dia canario completo durante las
ultimas tres horas y media de la jornada, a cambio de un commit diario mas.

**OJO: esto puede volver solo, sin que nadie toque nada.** Que hoy el fichero termine en el dia en
curso NO es una decision: es consecuencia de que GitHub esta sirviendo el cron con unas dos horas de
retraso, lo que cruza la medianoche peninsular y desplaza la referencia de "manana" un dia entero.
Antes NO era asi, y hay prueba en el propio repo: la entrada de "Validador De Dia Civil Compartido"
documenta que el dia siguiente "ya puede aparecer en el fichero mensual sobre las 20:15", y el bug
real del 12/08/2026 en `tests/pvpc-stats-engine.test.js` se encontro justamente porque el fichero
contenia `2026-08-13` a las 22:50 del dia 12. Es decir, el escenario evaluado arriba es el
comportamiento HISTORICO del sistema, no una novedad; la maquinaria de `provisionalDays` y
`getKpiPartialFlags` se construyo para el. Si el retraso de GitHub desaparece, el fichero volvera a
traer manana por si solo y el KPI de cabecera del Observatorio volvera a moverse cada tarde. No se
puede medir cuando empezo el retraso: el historial de Actions solo conserva 28 ejecuciones desde el
07/09/2026 y el historial de git esta aplastado a esa misma fecha.

**Si algun dia se reabre** (o si vuelve solo), el orden correcto es al reves: primero decidir que
hace el Observatorio con un dia futuro en "ultimo dia", en las ventanas moviles y en el interanual
-en Peninsula llega COMPLETO, asi que no dispara ninguna marca de provisional-, y solo despues tocar
el cron. No al reves.

**Criterio de reapertura.** Que aparezca otro consumidor con su propia copia del validador de dia, o
que el generador cambie el criterio de "dia en curso" del dataset. Si algun dia el workflow pasa a
correr tambien despues de las 20:15, comprobar si el fichero de 8742 deja de salir corto: el arreglo
sigue siendo correcto, pero el aviso de dia incompleto dejaria de verse a diario.

<a id="limites-de-consumo-como-decision-del-usuario-12-09-2026"></a>
### Limites De Consumo Como Decision Del Usuario (12-09-2026)

- **Cambio de producto, no defecto. Si ves que una tarifa cuyo `maxConsumoAnual` es inferior al
 consumo del usuario SIGUE en el ranking, es deliberado: NO lo reportes como filtro roto.**
 Antes: limite anual superado por los kWh registrados -> exclusion automatica, sin opcion.
 Ahora: la tarifa se muestra, el aviso dice cuantas estan en esa situacion y con que tope cada
 una, y un unico interruptor permite excluirlas. Reversible en los dos sentidos.
- **Motivo.** El comportamiento anterior invertia la logica: la proyeccion de un periodo parcial
 se ofrecia como opcion, mientras que un dato firme excluia sin preguntar, asi que cuanto mejor
 era el dato del usuario menos veia y menos decidia. Ademas los dos errores posibles no pesan
 igual: enseñar una tarifa que quiza no pueda contratar es visible y reparable (su requisito,
 "Consumo inferior a 4.000 kWh/año", viaja en la propia fila), mientras que ocultarla es mudo,
 nadie sabe lo que no vio ni puede ir a negociarlo con la comercializadora. El tope es una
 condicion comercial, no una imposibilidad tecnica.
- **Contrato.** `assessConsumoAnualLimits` (`js/lf-utils.js`) acepta `applyLimits`, el interruptor
 unico, y devuelve `limitsChoiceAvailable` (hay algo que decidir) y `limitsApplied` (esta
 decidido). `excluidasReales` sigue listando las que superan el maximo aunque no se apliquen:
 alimenta el aviso. `useAnnualEstimate` se conserva como nombre heredado de cuando solo gobernaba
 la proyeccion; renombrarlo tocaria cinco ficheros y el estado persistido sin cambiar conducta.
- **La eleccion no se arrastra entre escenarios**: cambiar consumo o dias invalida
 `annualConsumptionEstimateBasis` y reinicia el interruptor. Verificado en produccion el
 12/09/2026 con un año real: 7.182 kWh -> 104 tarifas; al aplicar -> 90; bajando a 4.766 kWh y
 recalculando -> 104 otra vez, con el aviso rehecho de 14 tarifas afectadas a 6.
- **Que queda superado de la entrada del 13/08/2026** (`Limites De Consumo Anual`), que sigue
 marcada como FIRME y en su mayor parte lo es. Dejan de describir el producto dos cosas: que la
 UI solo ofrezca el control "cuando activarla cambiaria candidatas" referido solo a la
 estimacion, porque ahora el interruptor aparece tambien sin estimacion posible; y la asimetria
 entre un maximo ya superado (que excluia solo) y una proyeccion (que se ofrecia). Lo que SIGUE
 vigente de aquella entrada: el maximo se contrasta siempre contra los kWh registrados y es
 monotono, el minimo no excluye nunca, cada simulador define "ano completo" a su manera, los dos
 alcances anuales de solar no se fusionan, no se prorratean los periodos de 365 dias o mas, el
 borde es `consumo > maximo` y un limite ausente o no numerico se ignora.
- **Criterio de reapertura.** Que el ranking pase a ordenarse por algo distinto del coste, o que
 aparezca un limite que no sea una condicion comercial negociable (uno tecnico o regulatorio):
 ahi si tendria sentido volver a excluir sin preguntar.

<a id="mes-cosido-el-ano-que-empieza-a-mitad-de-mes-11-09-2026"></a>
### Mes Cosido: El Ano Que Empieza A Mitad De Mes (11-09-2026)

- **Cambio de comportamiento, no defecto. Si ves que un CSV de 13 meses acaba en 12 filas y que
 una de ellas suma dias de DOS anos distintos, es deliberado: NO lo reportes como duplicado ni
 como mes contado dos veces.** Origen: pregunta en nergiza. Un ano descargado del 11/09/2025 al
 10/09/2026 llega partido en 13 meses y septiembre se mostraba con 11 dias.
- **Antes**: se descartaba el extremo con menos cobertura. Eso tiraba entre 9 y 20 dias de datos
 reales y dejaba el periodo por debajo del ano, con el ranking calculado sobre menos consumo del
 que el usuario habia subido. **Ahora**: los dos tramos del mismo mes natural se cosen en una
 sola fila mensual y se conservan los 365 dias. Caso real medido: 910,47 EUR frente a los 863,23
 EUR que salian descartando el tramo.
- **Reglas del cosido** (`buildEdgeStitchPlan` / `applyEdgeStitchPlan`, `js/lf-csv-utils.js`):
 manda el tramo reciente, asi que un dia presente en los dos anos se recorta del antiguo
 (`olderDaysOverlap`); un dia que no cabe en el mes destino tambien se recorta
 (`olderDaysOverflow`). El recorte se aplica sobre los REGISTROS HORARIOS, que son la misma
 fuente que alimenta la traza de excedentes indexados, no sobre un agregado posterior. El
 Datadis mensual nunca cose.
- **El mes destino no es siempre el reciente**: es el que puede albergar mas dias. Solo difieren
 cuando el corte cae en febrero con un bisiesto por medio, donde elegir el corto obligaba a tirar
 el 29 de febrero y convertia un historico de 365 dias en 364. Con empate gana el reciente, que
 era el criterio anterior.
- **Trampa: los indexados se agregan por ano y mes REAL.** La fila cosida lleva `segments` con los
 dos tramos y de ahi salen sus `sourceKeys`. Dos consumidores economicos los leen: los SSAA
 (`calcChargeForSegments`, `js/lf-ssaa.js`), que ponderan por kWh de cada tramo, caen a dias si no
 hay kWh y fallan CERRADO si a un tramo le falta tasa habiendo consumo; y los excedentes indexados
 (`js/lf-surplus-prices.js`), que valoran cada tramo contra su mes real y suman. Ambos validan la
 procedencia: exactamente dos claves, las dos del mismo mes natural que la clave de la fila.
- **Dos puertas distintas hacia la misma duplicacion, las dos cerradas.** Un escenario compartido
 (`?bv=`) puede traer metadata forjada. Por la primera puerta, una `sourceKeys` con una clave
 ajena hacia que la fila cobrase la compensacion indexada de OTRO mes, que ademas seguia
 cobrandola por su cuenta. Por la segunda, la fila de septiembre podia declarar que su mes era
 marzo: la tabla seguia rotulando "Septiembre" mientras el motor cobraba los dias, la tasa
 regulada y la compensacion indexada de marzo. La cierra `normalizeMonthMeta(meta,
 expectedMonthIndex)` (`js/bv/bv-ui-helpers.js`), que ata la clave a la casilla que la contiene y
 rechaza la metadata cuyo mes no coincide con su ranura.
- **Un tramo sin fila de indice cuenta como cero, nunca como hueco de datos**:
 `computeHourlyCompensation` crea fila para todo mes con algun excedente, asi que su ausencia
 significa que ese tramo no tuvo excedentes.
- **Criterio de reapertura.** Que el importador acepte rangos de mas de 13 meses, o que aparezca un
 tercer consumidor economico de `segments` sin la validacion de procedencia.

<a id="buscador-de-guias-carrera-entre-busqueda-y-categoria-12-09-2026"></a>
### Buscador De Guias: Carrera Entre Busqueda Y Categoria (12-09-2026)

- **Defecto real, corregido.** Reportado en auditoria externa y reproducido. `applySearch()`
 seguia adelante despues de `await ensureIndex()` sin comprobar si esa busqueda seguia siendo la
 vigente. Si el usuario se cansaba de esperar y pulsaba una categoria mientras el indice viajaba,
 la respuesta tardia pisaba el estado que habia dejado la categoria: dejaba tarjetas de resultados
 en un contenedor oculto y anunciaba un recuento que no correspondia a lo que se veia.
- **Arreglo**: un contador `accionVigente` que incrementan TANTO `applySearch()` como
 `applyCategory()`. Cada busqueda guarda su turno y, al volver del `await`, se retira si ya no es
 la vigente. El descarte cubre el render Y la baliza de analitica, y tambien la rama de error, que
 si no caia al `fallbackSearch` de una busqueda ya abandonada.
- **Por que el `AbortController` que ya existia no bastaba**: aborta la peticion de red, pero
 `ensureIndex()` cachea la promesa, asi que una segunda espera sobre el mismo indice se resuelve
 igual y el codigo posterior corre entero.
- **El test va en fichero propio** (`tests/guides-search-race.test.js`) a proposito: el de
 resiliencia usa temporizadores simulados en su `beforeEach`, y aqui hace falta tiempo real para
 soltar la respuesta del indice a mitad. Mezclarlos colgo la suite. Lleva control positivo: sin el
 segundo caso, cancelar SIEMPRE dejaria el primero en verde.

<a id="columna-de-excedentes-vacia-contar-presencias-no-ausencias-12-09-2026"></a>
### Columna De Excedentes Vacia: Contar Presencias, No Ausencias (12-09-2026)

- **Defecto real, corregido, y el arreglo anterior estaba mal razonado.** El aviso de la columna
 de excedentes elegia entre "no se detectaron excedentes" y "N celdas vacias interpretadas como 0"
 comparando `emptyCells.export` con `parsedRows`. Son dos contadores que cuentan cosas distintas:
 el de vacios se incrementa ANTES de que la fila pueda descartarse por rango o por dato invalido.
- Con `===` un archivo legitimo caia en el aviso alarmista. Al cambiarlo a `>=` se abrio el fallo
 contrario, mas grave: un archivo CON excedentes reales podia anunciar que no habia ninguno (fila
 valida con 1,0 kWh + fila descartada por rango + fila vacia = 2 vacios y 2 parseadas). Yo defendi
 el `>=` como necesario antes de que la auditoria lo desmontara; la leccion es que la comparacion
 estaba mal planteada de raiz, no mal calibrada.
- **Arreglo**: `exportValoresPresentes` cuenta cuantos registros ACEPTADOS traen dato de
 excedentes, y el aviso alarmista solo sale si ese contador es cero habiendo filas parseadas. No
 admite la ambiguedad porque las dos magnitudes se miden sobre el mismo conjunto.
- **Criterio de reapertura.** Que aparezca otro aviso que compare un contador acumulado durante el
 parseo contra uno que solo cuenta filas aceptadas.

<a id="vigencia-normativa-guias-ronda-36-14-09-2026"></a>
### Vigencia Normativa De Guias Y Documentacion Al 14/09/2026 (Ronda 36)

Tercera pasada de vigencia, centrada en la normativa que citan las 25 guias tras el RD 88/2026. La
dirigio un auditor externo en varias iteraciones y cada hallazgo se contrasto contra el literal del
BOE antes de tocar nada. Superficie: las 25 guias, los docs de la raiz y `vendor/README.md`.

**Correcciones de guias (5 guias).**

- **Sellos de fecha de bono social y coche electrico** (`7cdd384`). Pasaron a 14/09/2026. Se movieron
 primero sin reverificar el bloque y se reverifico despues: todo resulto vigente. RDL 7/2026
 convalidado el 26/03/2026 (BOE-A-2026-7125), 42,5%/57,5% hasta el 31/12/2026, DA 58 LIRPF (15% por
 vehiculo y por punto de recarga) hasta el 31/12/2026 pese a haber caido dos veces en 2026, y las
 cifras de Auto+ contra el anexo II del RD 609/2026. Un sello "revisada a" certifica todo lo que
 cubre su parrafo: no se mueve sin releer cada afirmacion.
- **FAQ de `errores-tipicos`** (`62e8c9b`). Solo remitia a Consumo/Industria tras 15 dias, cuando el
 cuerpo ya citaba Junta Arbitral y ADR. Alineada con los arts. 55.3, 57 y 58 del Reglamento.
- **Art. 32.4 en `servicios-extra`** (`b211c53`, `e3d2bee`). Los servicios adicionales contratados
 junto con el suministro deben rescindirse con el, salvo indicacion expresa del consumidor en el
 momento de la finalizacion. La primera redaccion decia "se rescinden automaticamente": la norma
 impone un deber a la empresa, no produce el efecto por si sola. Corregido el mismo dia.
- **Arts. 18.5, 18.7 y 6.1.añ en `estafas`** (`4ad1dea`). La guia decia que la comercializadora esta
 "obligada a exhibir" la acreditacion del consentimiento, y eso no figura en la norma. Reescrito
 sobre el literal: consentimiento expreso en soporte duradero conservado cinco anhos (18.5), ningun
 pago sin acreditacion documental de la solicitud (18.7) y acceso a la grabacion integra en veinte
 dias (6.1.añ, con efectos desde el 12/06/2026 por la DF 9.4).

**Documentacion.** La tabla fiscal de `CALC-FAQS.md` decia "21% a 01/08/2026"; pasa a "21% desde
01/06/2026", ya confirmado para agosto y septiembre (IPC de electricidad de julio 8,4%, INE). Cuatro
cabeceras eran anteriores a su propio contenido y se llevan a la fecha de su ultima edicion real:
`ARQUITECTURA-CALCULOS.md` y `CAPACIDADES-WEB.md` al 12/09 (`ccb7b29`), `PVPC-SCHEMA.md` al 09/09
(`13432a1`) y `MANTENIMIENTO-NORMATIVO.md` al 03/09, fecha de su entrada mas reciente, porque su
historial esta aplastado en el checkpoint del 07/09 y no permite afinar mas. El auditor solo senhalo
esta ultima; las otras tres salieron de un barrido propio de cabecera frente a fecha maxima del
contenido. Tambien dijo que este registro terminaba en la ronda 35: tiene cuatro entradas
posteriores del 11 y 12/09 sin numero de ronda, y lo atrasado era su cabecera. `vendor/README.md`
paso a 14/09 tras comprobar cada vendor contra upstream (`3147238`).

**Errores del auditor, descartados.**

- Citar el RDL 2/2026 como base del 42,5%/57,5%: lo derogo el Congreso el 26/02/2026, y la guia ya
 citaba el RDL 7/2026.
- "Art. 6.5 del RD 88/2026" para el consentimiento en soporte duradero: el art. 6 solo tiene
 apartados 1 y 2; es el 18.5.
- Afirmar que la guia de bono social explica la caida del RDL 2/2026: no lo menciona; las
 coincidencias de "2/2026" eran la fecha 31/12/2026.
- Atribuir a GoatCounter la version 2.7.0: es la del servidor. `count.js` es una URL rodante y se
 compara byte a byte contra la linea base (sin delta el 14/09).
- Mover el `Last updated` de `llms.txt` porque "123 tariffs as of 2026-08-28" parece viejo:
 `sync-seo-docs.mjs` ata a proposito el "as of" a la fecha de revision editorial y ya mantiene el
 recuento. Moverla exige revisar `llms.txt` y `llms-full.txt` enteros.

**Constantes reguladas de `js/lf-config.js`: reverificadas, sin cambios.** El auditor propuso mover
`version: '2026.08'`, `ultimaActualizacion: '2026-08-19'` y el comentario "Referencias revisadas:
19/08/2026" porque el fichero aparece en el commit del 07/09. Ese commit es el checkpoint que aplasto
el historial y toca todo el repositorio, asi que no prueba ningun cambio. `version` y
`ultimaActualizacion` no se consumen en produccion (solo `tests/fiscal.test.js` valida el formato de
`version`) y fechan el ultimo cambio de VALORES, que sigue siendo el 19/08: moverlas sin cambiar un
valor las haria falsas. Reverificado el 14/09/2026 contra el literal del BOE: peajes 2.0TD de energia
y potencia (Resolucion CNMC, BOE-A-2025-26348), cargos (Orden TED/1524/2025), financiacion del bono
social de 9,011295 EUR/CUPS (Orden TED/634/2026, aplicable desde la liquidacion 7 de 2026), IEE al
5,11269632% con minimo de 1 EUR/MWh (art. 99 de la Ley 38/1992), descuentos del bono social (RDL
7/2026), IVA al 21% y pesos del PVPC 55/45 (RD 446/2023). Los diez importes de peajes y cargos
coinciden al decimal. NO se reverificaron IGIC, IPSI, alquiler del contador ni CCF, y por eso el
comentario "Referencias revisadas" tampoco se mueve: certificaria esos cuatro. No se toca el JS: un
cambio solo de comentario obligaria a desplegar sin efecto funcional.

**Rechazado sin evidencia de error:** rebajar las cifras orientativas de aerotermia, potencia y
servicios extra. Son juicios editoriales, no afirmaciones normativas.

**Trampa de esta ronda.** WebFetch sobre la web del BOE corta el RD 88/2026 hacia el art. 6-10
aunque se pida un ancla. El literal se obtiene descargando el PDF y extrayendo con
`pdftotext -layout` e `iconv` desde latin1; sin `iconv`, un grep de "Articulo 32" con tilde no
encuentra nada.

**Criterio de reapertura.** El de las rondas anteriores, cambiar una funcion que la documentacion
describa y no el calendario, mas dos disparadores: cualquier modificacion del RD 88/2026 y el
31/12/2026, cuando vencen el bono social excepcional, las deducciones de IRPF y la convocatoria de
Auto+.

<a id="cosido-datadis-octubre-ronda-37-15-09-2026"></a>
### El Mes Cosido Con La Hora Repetida De Octubre De Datadis (Ronda 37, 15/09/2026)

Disparada por cambio de codigo, no por calendario: entre el 11 y el 12/09 entraron 725 lineas en 11
ficheros (mes cosido, octubre de Datadis en base 1-24, SSAA e indexados por tramos, `normalizeMonthMeta`,
limites de consumo) probadas pieza a pieza pero nunca cruzadas. Angulo: un historico real de ~365 dias
que combina varias de esas condiciones, hasta las doce filas del simulador solar.

**Resultado: cero bugs, cero cambios de codigo, doce regresiones nuevas.**

- **El auditor externo no pudo ejecutar nada** (su entorno no resolvia `github.com`) y lo declaro con
 precision: entrego una lectura estatica del `main` y se nego a dar la ronda por cerrada sin ejecucion.
 Es lo que pide la regla 10. Sus afirmaciones sobre el codigo son correctas: el recorte del cosido es
 por dia civil completo sobre los registros horarios (`applyEdgeStitchPlan`), la hora repetida se
 resuelve a 25 antes del control de duplicados, y SSAA e indexados valoran cada tramo contra su mes
 real con sus tests.
- **La ejecucion la hizo Claude** con la cadena real del importador solar (`parseEnergyTableRows` ->
 `validateCsvSpanFromRecords` -> `applyEdgeStitchPlan` -> `bucketizeByMonth` -> `pickLatestMonthData`
 -> `buildSimulationMonths`) sobre ficheros con la forma de Datadis y kWh distinto por anho civil:
 - 15/10/2025-14/10/2026: el 26/10/2025 (25 h) cae en el tramo antiguo conservado. 8760 registros,
   365 dias, octubre de 31 dias con `sourceKeys` `2025-10`/`2026-10`.
 - 26/10/2025-26/10/2026 (366 dias): el dia de 25 horas cae JUSTO en el solape. Sale entero, con sus
   25 filas: 8785 -> 8760 registros, y la energia de las filas baja exactamente 24 x 0,500 + 0,700.
 - 25/10/2025-25/10/2026 (366 dias): el solape es un dia normal y el octubre cosido lleva DOS dias de
   25 horas (26/10/2025 y 25/10/2026). 8761 registros. **No es un duplicado ni un bug**: son dos dias
   distintos que tuvieron 25 horas cada uno. No lo reportes.
 En los tres, la energia de las doce filas coincide con la de los registros conservados y la
 cobertura anual es 365.
- **Por que merecia test propio.** Mutacion: conservar la hora 25 de un dia recortado
 (`|| record.hora === 25` en el filtro de `applyEdgeStitchPlan`). **Los 1975 tests existentes
 siguieron en verde**; el nuevo `tests/bv-cosido-datadis-octubre.test.js` la detecta (8761 frente a
 8760). Los tests de Datadis empiezan el dia 1 y no cosen, y los del cosido usan curvas de 24 horas:
 ninguno ponia el cambio de hora dentro del solape. Fue el primer paso (1975 -> 1978); el cierre
 completo de la ronda esta mas abajo.
- **Cierre de los siete casos del encargo (a-g).** El auditor senhalo, con razon, que el primer
 test solo cubria parte de la ronda, y en una segunda revision que la home y el viaje por el DOM
 seguian probados por piezas. Doce regresiones, todas con codigo real:
 - `tests/bv-cosido-datadis-octubre.test.js` (cadena real): a y c, octubre en tres casos; b, marzo
   de 23 horas en el tramo conservado y en el solape (8783 -> 8760 registros); f, el mismo fichero
   por el flujo COMPLETO de la home (`procesarCSVConsumos`: lectura, periodo y reparto P1/P2/P3),
   que conserva los 366 dias, los 8785 registros y toda la energia, mientras el solar descuenta
   exactamente el dia recortado (12,7 kWh); d-SSAA sobre la fila que sale de la cadena, con tramos
   de 60 y 250,3 kWh (60 x 0,02 + 250,3 x 0,01 = 3,70 EUR, frente a 3,10 con la clave de la fila
   sola); y d-indexado con traza horaria real y dataset con cambio de hora (120 + 625 horas
   valoradas, cero huecos, 6,85 EUR; con el dia recortado dentro saldria 6,975 y sin la hora 25,
   6,84).
 - `tests/bv-ui-zona-grid.test.js` (DOM real): e, una fila cosida abierta por `?bv=`, exportada,
   importada en un navegador limpio, persistida y recargada conserva sus dos tramos, y viaja en el
   enlace compartido con mensuales; e en recorrido unico, con el importador (`bv-import.js`) y la
   agrupacion mensual REALES: fichero Datadis -> cosido -> rejilla (tramos de 60 y 250,3 kWh, 310
   kWh en octubre; con el dia repetido dentro serian 323) -> respaldo -> navegador limpio ->
   recarga; g, `assessConsumoAnualLimits` recibe 3600 kWh, `annualScope` true y 365 dias cubiertos.
- **Mutaciones, nueve de nueve cazadas por los tests nuevos.** "Suite previa" son los tests
 anteriores a cada paso del cierre: 1978 para las seis primeras, 1986 para las tres ultimas. Los
 recuentos de "Tests nuevos" de las seis primeras se midieron antes de anhadir el recorrido unico.

| Mutacion | Tests nuevos | Suite previa |
|---|---|---|
| Compartir y exportar sin `meta` (`collectManualGridData`) | 2 fallan | **0** |
| Importar respaldo sin `meta` (`normalizeImportedScenarioPayload`) | 1 falla | **0** |
| Dias del mes cosido = solo los del tramo reciente (`buildSimulationMonths`) | 6 fallan | 3 |
| SSAA sin tramos (`calcMonthForTarifa`) | 1 falla | 3 |
| Recorte que deja sueltas la hora 25 y las horas 1-2 (`applyEdgeStitchPlan`) | 6 fallan | 1 |
| Indexado con un solo tramo (`mergeIndexedRows`) | 1 falla | 5 |
| Home ignora la hora 25 al repartir P1/P2/P3 (`clasificarConsumosPorPeriodo`) | 1 falla | 1 |
| Home pierde un dia tras validar el periodo (`applySpanValidation`) | 1 falla | 21 |
| Importador solar sin aplicar el recorte (`bv-import.js`) | 1 falla | **0** |

 Tres eran huecos reales. Si compartir o restaurar un respaldo perdiese los tramos, el mes seguiria
 declarando los dias de los dos tramos y pagaria los SSAA a la tasa de uno solo. Y si el importador
 solar dejase de recortar, el dia repetido entraria dos veces en la rejilla: el test de la cadena
 llama al recorte directamente y no pasa por `bv-import.js`. Ninguno de los tres lo veia un test
 previo, y tampoco la variante de recorte que solo deja suelta la hora 25. Nota del arnes:
 `lf-csv-import.js` toma `round2` de `lf-utils.js` al cargarse, asi que el test lo importa antes,
 igual que el orden de scripts de produccion. Suite 1975 -> 1987.
- **Datos generados en el test, no sacados de `tests/fixtures/`, a proposito.** Ningun fixture real
 sirve: `1.csv` abarca 11/02-13/12/2025 (unos 306 dias, sin 13 meses que coser) y numera octubre con
 hora 25 explicita, convencion CNMC, no con la hora repetida de Datadis. Es el mismo criterio del test
 "Año completo con la forma real de Datadis" de `tests/csv-hardening.test.js`.

**Criterio de reapertura.** El de la entrada del mes cosido, mas cualquier cambio en `buildHourResolver`
o en la granularidad del recorte (si pasara a ser por hora en vez de por dia).

<a id="productores-de-datos-ronda-38-15-09-2026"></a>
### Los Productores De Datos: De ESIOS A `data/` (Ronda 38, 15/09/2026)

Primera auditoria de `scripts/pvpc_auto_fill.py` (indicadores 1001 y 1739) y
`scripts/ssaa_auto_fill.py` (10328) como productores; la ronda 25 audito a sus consumidores. El
auditor externo NO podia ejecutar (solo leer el repositorio en GitHub), y el prompt se diseno para
eso: candidatos con traza y la prueba que los confirmaria. Claude ejecuto cada candidato con los
scripts reales y ESIOS simulado.

**Resultado: 2 candidatos, los 2 CONFIRMADOS y CORREGIDOS. Ningun dato publicado estaba mal.**

- **C38-02, el importante: una respuesta parcial de ESIOS borraba el historico SSAA y se
 publicaba.** `ssaa_auto_fill.py` reescribia `data/ssaa/index.json` solo con la respuesta. Ejecutado
 con el `main()` real y un HTTP 200 de un unico mes: codigo de salida 0, 24 meses -> 1,
 `check_data_freshness.py` en OK y `tests/ssaa-dataset.test.js` en verde, asi que `pvpc.yml` lo
 habria commiteado. Efecto: el simulador solar pide la tasa de cada mes del CSV y un mes historico
 ausente devuelve `historical-month-unavailable`, que deja fuera del ranking, con el motivo visible,
 las tarifas con `incluyeServiciosAjuste: false`. La home no se ve afectada: pide la tasa sin mes y
 usa el ultimo mes completo. La misma reescritura tiraba ademas CADA MES el mes mas antiguo de la
 ventana de 24 meses, y un backfill con `--from` solo duraba hasta la ejecucion siguiente.
 - Correccion: `read_published_values` + `merge_monthly_values`. Cada mes descargado sustituye al
   publicado (las rectificaciones de REE siguen entrando) y los que no llegan se conservan. Se
   fusiona DESPUES de comprobar la respuesta: vacia sigue siendo error y no escribe. Un fichero
   ilegible, de otro indicador o de otra unidad se ignora y manda la respuesta.
 - Guardia: `check_data_freshness.py` exige ahora claves de mes validas, historico sin huecos, al
   menos 13 meses (`SSAA_MIN_MONTHS`: un CSV de un anho pide 13 meses naturales porque el mes
   partido aparece dos veces) y `to` igual al ultimo mes publicado. `tests/ssaa-dataset.test.js`
   exige lo mismo sobre el dataset real.
- **C38-01: un dia malformado de 24 puntos sustituia a uno bueno.** La condicion de
 `merge_month_file` era `new_is_complete or not old_is_complete or len(new) >= len(old)`, y la
 tercera rama ignoraba si el nuevo era valido. Ejecutado con el `main()` real sobre una copia de
 `data/`: un 20/10/2025 de 24 puntos con un timestamp duplicado, o con un salto de 7200 s,
 sustituia al dia correcto. La guardia si lo paraba (`salto horario=0s`) y no se publicaba, pero el
 workflow quedaba en rojo cada noche mientras ESIOS lo devolviera, sin actualizar ningun dataset y
 con el dato bueno ya en el repositorio. Corregido a
 `new_is_complete or (not old_is_complete and len(new) >= len(old))`: un dia completo solo lo
 sustituye otro completo. Cambio de conducta asumido: entre dos versiones incompletas ya no gana
 una mas corta.
- **Tras corregir, las mismas reproducciones:** el dia bueno se conserva y la guardia pasa; SSAA
 conserva sus 24 meses y actualiza el que llega. Guardia sobre el `data/` real: OK.
- **Tests nuevos.** `scripts/test_auto_fill.py` (12 pruebas sin red, solo biblioteca estandar) se
 ejecuta en `pvpc.yml` ANTES de descargar y en `tests.yml` en cada push, junto con el self-test de la
 guardia, que hasta ahora solo corria de noche. Self-test 17 -> 20 casos. Suite JS 1987 -> 1988.
- **Mutaciones, seis de seis cazadas:** volver a la condicion antigua (3 pruebas fallan), quitar la
 fusion SSAA (2), quitar de la guardia el minimo de meses, la deteccion de huecos o la coherencia de
 `to` (1 cada una), y el dataset truncado real contra `ssaa-dataset.test.js` (falla el test nuevo; el
 antiguo seguia en verde).

**El auditor.** Las dos trazas eran exactas y la severidad correcta: puso C38-02 por encima de C38-01
porque no encontro una barrera que lo parase, y la ejecucion le dio la razon. Declaro que no pudo
contrastar con ESIOS (bloque C) y no dedujo valores. No vio que la ventana movil de 24 meses borraba
meses aunque ESIOS respondiera bien, ni que la home no depende del historico SSAA. Clasifico como
hardening que `validate_days` acepte dias cuartohorarios que la guardia rechaza: correcto, y NO se
toca, porque la barrera de publicacion es la guardia.

**Limpio:** los datos publicados (dias de 23 y 25 horas en Peninsula y Canarias con pasos de 3600 s,
`heuristic_applied` en false y SSAA entre 0,011 y 0,029 EUR/kWh). El 1739 con la zona de Madrid
tambien para Canarias era deliberado; **revertido en la ronda 46 (23/09/2026)** porque hacia valorar
cada hora canaria con el precio de la anterior.

**Criterio de reapertura.** Cualquier cambio en `merge_month_file`, en la fusion SSAA o en
`--months-back`; que un consumidor necesite mas de 13 meses de SSAA; o que ESIOS pase a publicar el
1001 o el 1739 en cuartos de hora.

<a id="excel-formato-de-celda-ronda-39-15-09-2026"></a>
### Del Excel Al Registro Horario: El Valor De La Celda, No Su Formato (Ronda 39, 15/09/2026)

Primera auditoria como area de la lectura de hojas XLSX en los tres importadores (home, simulador
solar y Observatorio). El auditor externo no ejecutaba (repositorio en GitHub y documentacion de
SheetJS); Claude ejecuto cada candidato con la libreria real (`vendor/xlsx`, 0.20.3), escribiendo y
releyendo XLSX de verdad y pasandolos por los tres importadores.

**Resultado: 3 bugs CONFIRMADOS y CORREGIDOS, 1 candidato descartado por diseno.** No hay en el
banco de pruebas ningun fichero real de distribuidora con esos formatos: son formatos normales de
Excel, no los de un export concreto.

- **Causa comun.** `sheet_to_json(sheet, { header: 1, raw: false })` entrega el texto FORMATEADO de
 cada celda, con convencion en-US. En las celdas de texto es lo correcto; en las numericas el formato
 es presentacion y pasaba a ser el dato. Los tres casos, en los tres importadores y sin aviso:
 - C39-01, fechas: una celda con formato `d/m/yy` llegaba como `"1/4/25"`, no casaba con
   `dd/mm/yyyy` y caia en `new Date()`, que la lee como 4 de enero. Igual con fecha y hora
   `d/m/yy h:mm`. El formato de fecha por defecto de Excel (`m/d/yy`, integrado 14) salia bien, pero
   solo porque V8 interpreta `"4/1/25"` al estilo americano.
 - C39-02, horas: `h:mm AM/PM` llegaba como `"1:00 PM"` y `extractHourNumber` tomaba el 1. Las 13:00
   entraban como la hora 1.
 - C39-03, consumos: 1,2349 kWh con formato `0.0` entraba como 1,2, y 1,6 con formato `0` como 2.
- **Correccion.** `xlsxRowsFromSheet` (`js/lf-csv-utils.js`) conserva la forma de las filas de
 `raw:false` y reescribe solo las celdas numericas desde su valor. Las de fecha u hora pasan a texto
 canonico con `SSF.parse_date_code`, respetando el sistema 1904: `dd/mm/yyyy`, `dd/mm/yyyy HH:MM`,
 `HH:MM` en 24 horas, o `yyyy/mm` si el formato no tiene dia. El resto pasa a `String(v)` con
 precision completa. Las celdas de TEXTO no se tocan: `"1,25"` o `"01/04/2025"` escritos a mano
 siguen llegando tal cual, que era la garantia de `raw:false`. Los tres importadores leen ahora con
 `cellNF: true` (sin el no hay formato que mirar). Si la libreria no expone `decode_range`,
 `decode_cell` o `SSF` (mocks de tests), el helper devuelve lo mismo que `raw:false`.
- **Descartado `rawNumbers`/`raw:true`:** con `cellNF: true`, SheetJS convierte las celdas de fecha en
 cadenas ISO en UTC (`2025-03-31T22:00:00.000Z` para el 1 de abril en Madrid). Cambiaba un fallo por
 otro.
- **C39-04, descartado por diseno:** el Observatorio rechaza la matriz `Fecha + H01..H24` con un
 mensaje claro ("No se identifico la columna obligatoria de hora"). La matriz solo trae consumo y el
 Observatorio valora EXCEDENTES (`pvpc-stats-csv.js`: "los excedentes SON la carga util"), asi que
 aceptarla no le daria nada que calcular.
- **Tests.** `tests/xlsx-formato-celdas.test.js` (10 casos): los tres importadores con XLSX escritos y
 releidos (`d/m/yy`, `m/d/yy`, `d/m/yy h:mm`, sistema 1904, AM/PM, `0.0` y `0`, texto intacto) y el
 helper (rango que no empieza en A1 con una fila vacia, mes sin dia, `[h]:mm` con las 24:00 y la
 degradacion con mocks). Siete mutaciones, las siete cazadas: helper sin reescribir, dia y mes
 cambiados, 1904 ignorado, desplazamiento del rango ignorado, reloj de 12 horas, numeros con el texto
 formateado y la home leyendo sin `cellNF`. Suite 1988 -> 1998.

**Queda sin tocar, a proposito.** Una fecha escrita como TEXTO `d/m/yy` (en un CSV o en una celda de
texto) sigue cayendo en `new Date()`, cuyo resultado depende del navegador. No hay ningun fichero real
con ese formato, y decidir dia y mes de un texto ambiguo sin evidencia seria cambiar un fallo por otro
(regla 6 del metodo). Tampoco se probo en un navegador real: los tests usan la misma libreria
vendorizada que carga la web.

**El auditor.** Las trazas eran exactas y sus predicciones a mano coincidieron con la ejecucion
(`"1/4/25"` -> 4 de enero, `"1:00 PM"` -> hora 1, `"1.2"`). Acerto al no proponer `raw:true` sin saber
que garantia sostenia `raw:false`. No comprobo que el Observatorio necesita excedentes (C39-04) ni vio
que el formato por defecto de Excel salia bien por una casualidad de V8.

**Revision del auditor sobre `c70a926` (15/09/2026).** Sin objeciones a C39-01, 02 y 03 ni al descarte
de C39-04, y dos defectos del clasificador de formatos de `excelDateCellText`, los dos CORREGIDOS:
- C39-05: `mmm`, `mmmm` o `[$-es-ES]mmmm` (solo mes) caian en la rama de hora, porque bastaba con no
 tener dia ni anho: la serie 45748 salia como `"1097952:00"`. Sin impacto observable, porque antes
 llegaba `"Apr"` y ambos textos se rechazan como fecha, pero la semantica era falsa. Ahora es un mes
 (`"2025/04"`).
- C39-06, el que importaba: una duracion `[mm]:ss` de 60 minutos se plegaba a `"01:00"`. Antes
 llegaba `"60:00"` y el parser la rechazaba; el primer arreglo la convertia en una hora 1 valida
 aceptada en silencio, justo lo contrario de la regla 6. El auditor la clasifico como hardening; su
 efecto era un rechazo convertido en dato falso. Ahora la rama de hora exige `h` o `[h]`; sin dia,
 anho ni hora solo es un mes si no hay segundos, y el resto (`mm:ss`, `[mm]:ss`, `[ss]`) conserva el
 texto de Excel.
- Un primer guard especifico para `[mm]`/`[ss]` sobrevivio a su mutacion: la rama siguiente ya lo
 cubria. Se RETIRO en vez de dejar codigo que ningun test puede distinguir.
- Anhadidos tres casos: formato solo de mes, duraciones frente a `hh:mm:ss`, y alineacion con celdas
 vacias materializadas (`t:'z'`) y combinadas, la laguna que senhalo. Mutaciones de las dos
 correcciones cazadas (volver al clasificador antiguo y tratar `mm:ss` como mes). Tests del fichero
 10 -> 13; suite 1998 -> 2001.
- **NO se cambio el fallback** a `sheet_to_json raw:false` cuando falta `xlsxRowsFromSheet`, que el
 auditor proponia volver fail-closed. El helper vive en el mismo fichero que los guards de dimensiones
 y formulas, todos los scripts llevan el mismo `?v=` de build y el service worker cachea por URL: no
 hay mezcla de versiones realista en la que falte solo el helper. Fallar cerrado convertiria ese caso
 hipotetico en "la importacion de Excel no funciona" para todos, y el comportamiento degradado es el
 que tuvo produccion durante meses.
 **Corregido el 17/09/2026 (ronda 42):** la premisa "no hay mezcla de versiones realista" es FALSA
 para recursos cargados despues del arranque (la red sirve el build nuevo a una URL `?v=` antigua).
 La decision se mantiene por otra razon: `xlsxRowsFromSheet` existe en todos los builds desde el
 15/09, asi que una mezcla entre builds posteriores no puede dejar fuera solo el helper. Vuelve a
 importar si se renombra o se retira ese helper.

**Criterio de reapertura.** Actualizar SheetJS (cambios en `SSF` o `sheet_to_json`), pasar a leer mas
de una hoja, o aparecer un fichero real con fechas de texto de dos cifras de anho.

<a id="guard-formulas-xlsx-rango-desplazado-16-09-2026"></a>
### Guard De Formulas XLSX Con Una Hoja Que No Empieza En A1 (RESUELTA 16/09/2026)

- **Defecto real, encontrado al seguir la ronda 39 y corregido.** `assertRelevantXlsxFormulasResolved`
 comparaba direcciones ABSOLUTAS de celda (`__LF_xlsxColumnIndexFromAddress`: A1 = 0,0) con
 `rows`, `headerRowIndex` y las columnas relevantes, que `sheet_to_json` cuenta desde el INICIO DEL
 RANGO (`!ref`). Con una hoja que empieza en B2 todo se desplazaba una columna.
- **Reproducido con un XLSX real escrito y releido** y el importador de la home: con el rango en A1,
 una formula sin resultado en el consumo se rechazaba; con el mismo contenido en B2:D4 el guard no la
 veia y la home ACEPTABA el fichero con esa hora a 0 kWh, justo lo que el guard existe para impedir.
 El efecto contrario tambien era posible: una formula en una columna irrelevante pegada a una
 relevante rechazaba el fichero con la etiqueta de la otra columna.
- **Arreglo.** Se resta el inicio del rango antes de comparar. El mensaje cita la fila REAL de Excel,
 la que el usuario ve en su hoja. Sin `!ref` (mocks de tests) el inicio es A1, como antes.
- **Tests.** Dos casos en `tests/xlsx-formula-guard.test.js` con un XLSX real que empieza en B2: formula
 sin resultado en el consumo (rechazo con "fila 4") y formula en una columna "Notas" (sin rechazo).
 Mutacion (ignorar el inicio del rango): fallan los dos. Suite 2001 -> 2003.
- **Por que no lo vio nadie antes.** Todos los tests del guard usaban hojas que empiezan en A1, y la
 ronda 39 fijo la alineacion en `xlsxRowsFromSheet` sin revisar al otro consumidor de las mismas
 coordenadas.
- **Criterio de reapertura.** Cualquier otro codigo que combine direcciones de celda con indices de
 `rows`.

<a id="censo-cnmc-productor-ronda-40-17-09-2026"></a>
### El Productor Del Censo CNMC En Modo Espejo (Ronda 40, 17/09/2026)

Primera auditoria de `scripts/sync-cnmc-commercializers.mjs` y de su workflow como PRODUCTOR; la
entrada del QR CNMC cubria su contrato con el extractor. Desde el 03/09/2026 publica sin revision
humana, asi que la pregunta fue que respuesta de la sede que NO sea un listado completo puede
publicarse. Auditor externo sin ejecucion (lo declaro); Claude ejecuto los candidatos con el parser
real sobre el HTML vivo de la sede descargado el 17/09/2026 (944 filas, 943 codigos, 403 bajas, una
sola tabla, filas en orden de cadena y la ultima es `R2-999`, una baja que sigue listada).

**Resultado: 2 candidatos, los 2 CONFIRMADOS y CORREGIDOS. El censo publicado estaba bien.**

- **C40-01: una pagina bien formada pero corta se publicaba.** Cortando el HTML vivo justo despues de
 la fila `R2-964` quedaban 908 codigos, los centinelas `R2-796` y `R2-1000` y 161 codigos de cuatro
 cifras: `assertCensusSane` lo aceptaba y el workflow lo habria replicado como 35 "bajas". Efecto
 visible: el extractor de facturas pierde nombre, telefono y web de esos codigos (no toca importes).
 Matiz que el auditor no vio: un corte de RED no es silencioso (la sede manda `Content-Length`,
 `fetch` rechaza un cuerpo incompleto y un corte a mitad de fila aborta con "Fila ... incompleta");
 el caso real es la sede generando una pagina bien cerrada pero incompleta.
 - Correccion: `R2-999` pasa a ser centinela. Como la tabla va en orden de cadena y las bajas no se
   retiran, cualquier corte por el final pierde esa fila, sea del tamanho que sea; un umbral nuevo
   solo habria movido el agujero. Comprobado con el HTML vivo: completo publica (943), cortado tras
   `R2-964` o tras `R2-998` rechaza.
- **C40-02: una fila con contenido y sin codigo desaparecia sin aviso.** `if (!code.startsWith('R2-'))
 continue;` saltaba la fila antes de la comprobacion de anchura y sin anotarla en `rejectedCodes`.
 Vaciando la celda de `R2-964` en el HTML vivo se publicaban 942 codigos sin error. Igual con
 `R2 964`. Hoy la tabla no tiene ninguna fila sin codigo R2.
 - Correccion: una fila con algun texto y sin prefijo `R2-` va a `rejectedCodes` (`(sin código)` si
   esta vacia) y aborta; una fila completamente vacia se sigue saltando.
- **Tests.** Dos casos en `tests/cnmc-commercializers.test.js` que reconstruyen la tabla con el censo
 publicado en el orden de la sede y llaman a `syncCnmcCommercializers` real (control positivo con la
 tabla completa; corte tras `R2-964` y corte de una sola fila; codigo vacio, `R2 964` y fila vacia).
 Mutaciones, tres de tres cazadas: quitar el centinela `R2-999`, volver al `continue` silencioso y
 rechazar tambien la fila vacia. Suite 2003 -> 2005.
- **Hardening no aplicado (clasificacion del auditor, correcta):** el paso del clasificador no lleva
 `continue-on-error`, asi que un fallo suyo detiene la publicacion; es el lado seguro y no hay
 entrada legitima que lo dispare. `git pull --rebase` tras los tests deja una ventana para commits
 ajenos, cubierta por `tests.yml` despues del push. `findRegistryTable` toma la primera tabla
 compatible y la sede solo tiene una. Un estado nuevo distinto de `Baja` cuenta como activo y solo
 afecta a `inactiveCodes`, que el frontend no lee.
- **Residual asumido:** un listado al que le falte un bloque INTERMEDIO conservando la cola sigue
 pasando si deja mas de 900 codigos. No hay evidencia de que la sede falle asi.

**El auditor.** Citas exactas y margenes correctos sobre el censo publicado (936/937/154, holgura 0
en `sourceRows`). Dio "937 filas" para la sede sin notar que el censo vivo ya tenia 7 altas mas desde
el 01/09. Su arreglo sugerido para C40-01 (centinela de fin de documento) no habria cazado una
pagina bien cerrada; el centinela de cola si. No inflo severidad.

**Criterio de reapertura.** Que la sede cambie de orden, retire bajas del listado, llegue a codigos
que ordenen despues de `R2-999` (`R2-9990` en adelante) o pase a paginar.

<a id="zona-horaria-navegador-ronda-41-17-09-2026"></a>
### El Navegador En Otra Zona Horaria (Ronda 41, 17/09/2026)

Primera auditoria transversal de fechas con el navegador en una zona distinta de la del dataset
(Canarias, resto de Europa, America, Asia). El ancla diaria de PVPC ya estaba auditada y quedo
fuera. Auditor externo con micropruebas sobre el codigo real pero sin suite ni navegador; Claude
ejecuto el motor real con la zona cambiada, la suite completa en tres zonas y Chrome real con zona
y reloj emulados.

**Resultado: 1 hallazgo del auditor, CONFIRMADO y CORREGIDO, mas 1 defecto de tests encontrado al
verificar. Ninguna cifra publicada era falsa.**

- **C41-01: el Observatorio tomaba el anyo y el mes vigentes del reloj del navegador.** El motor ya
 calculaba "hoy" en la zona del dataset (`todayLocal`) pero sacaba `currentYear`/`currentMonth` de
 `new Date()`, y la UI hacia lo mismo en SIETE sitios (el auditor cito dos): selector, `parseParams`,
 `normalizeSelectedYears`, arranque, rotulo de anyo en curso y comparativa. Motor real ejecutado:
 - Tokio el 31/12/2026 a las 16:00Z: el navegador ya esta en 2027, la vista por defecto es 2027 y
   solo pide `2027-01.json`, que no existe hasta el workflow de las 20:00Z. En Chrome real: selector
   en 2027 y KPI vacio. Cada fin de mes, en la misma franja, pedia el mes siguiente y el anyo en
   curso salia "parcial".
 - Bogota el 01/01/2027 a las 00:30Z: 2027 no se ofrecia y `?year=2027` se descartaba en silencio.
   Cada dia 1, durante el desfase, no pedia el mes nuevo.
 - Canarias con su propio navegador: coincide con su reloj, no hay efecto visible.
 - Defensas posteriores: ninguna lo reencauzaba. Un mes 404 se marca fallido (aviso visible) y uno
   futuro ya publicado entra como provisional. Nunca produjo una cifra falsa.
 - Correccion: el motor deriva anyo y mes de `todayLocal`; la UI usa `getDatasetCurrentYear(context)`
   con la zona de `PVPC_STATS.getDatasetTimeZone` (Canarias en su hora; excedentes en hora
   peninsular para todas las zonas) y, sin helper de fechas, conserva el reloj local.
   `parseParams` resuelve tipo y geo antes de validar el anyo.
- **Defecto de tests: dos fixtures de `tests/import-robust.test.js` solo pasaban con desfase >= 0.**
 `new Date('2024-01-01')` es medianoche UTC y en America cae en diciembre. El producto no estaba
 afectado (las fechas de fichero se construyen como fecha civil local). Corregido a
 `new Date(2024, 0, 1)`. Nadie lo veia: el runner de CI corre en UTC y los equipos en Madrid.
- **Recorridos limpios (coincido con el auditor):** fecha civil de fichero ida y vuelta, P1/P2/P3 y
 festivos sobre fecha civil, rotacion y claves `YYYY-MM` del simulador, hoy/manana/ahora de la vista
 rapida (zona electrica y epoch), dias de periodo con fechas a mediodia, y formateo de timestamps con
 `timeZone`.
- **Tests.** Cuatro casos de motor en `tests/pvpc-stats-engine.test.js` (Tokio fin de anyo y fin de
 mes, Bogota, Canarias frente a Peninsula) y cuatro de UI en `tests/pvpc-stats-ui.test.js`, incluido
 un guard que solo permite un `getFullYear()` (el fallback) y ningun `getMonth()` en la UI. Cada caso
 fija `process.env.TZ` y lo restaura: Node lo aplica en caliente. Mutaciones, cinco de cinco cazadas:
 motor con reloj del navegador, selector, `normalizeSelectedYears`/`parseParams`, zona fija
 `Europe/Madrid` y `isCurrentYear` con el reloj. Suite 2005 -> 2013.
- **CI.** `tests.yml` ejecuta ademas la suite completa con `TZ=America/Los_Angeles` (unos 70 s). La
 suite pasa tambien con `Atlantic/Canary` y `Asia/Tokyo`.
- **Trampa del arnes.** En Git Bash de Windows `TZ=... npx vitest` NO llega a Node (sale
 `undefined`): una primera pasada "verde en Canarias y Los Angeles" no habia cambiado de zona. Usar
 PowerShell (`$env:TZ`) y comprobar `process.env.TZ` antes de fiarse.

**El auditor.** Mecanismo y ejemplos exactos, sin inflar severidad; inventario incompleto (2 de 7
sitios) y no vio el fixture dependiente de la zona porque no pudo ejecutar la suite.

- **Segunda pasada (17/09/2026): C41-02, regresion introducida por el propio arreglo.** Con la zona
 del dataset, Peninsula y Canarias cambian de anyo con una hora de diferencia. Navegador en Madrid
 a las 00:30 del 01/01/2027 con Peninsula 2027 elegido: al pasar a Canarias PVPC (o de excedentes
 de Canarias a PVPC) el handler conservaba `state.year = 2027`, el motor no pedia ningun mes
 (`year > currentYear`) y la vista quedaba con los KPI en "—" sin explicacion. El codigo anterior
 mostraba el 01/01. Peor: ese anyo sin meses no era parcial ni provisional, asi que se cacheaba
 como completo y, ya pasada la medianoche canaria, seguia vacio hasta recargar. Caso inverso
 menor: abrir en Canarias y pasar a Peninsula no ofrecia 2027 durante esa hora. Reproducido en
 Chrome real con control negativo y con el motor real.
 - Correccion: `alignStateToDataset(state)` limita el anyo y los anyos comparados al anyo en curso
   del dataset nuevo (si no sobrevive ningun comparado, se recalculan) y los handlers de zona y de
   tipo rehacen el selector antes de recargar. El motor ya no cachea un anyo que no ha pedido
   ningun mes. Un anyo pasado y los comparados se conservan al cambiar zona o tipo (verificado).
 - Huecos de cobertura cerrados en la misma pasada: el test de UI no cargaba `PVPC_STATS`, asi que
   solo probaba la zona de reserva (sobrevivia llamar a `getDatasetTimeZone` sin el tipo, con
   2013 tests en verde), y `parseParams` no distinguia excedentes de PVPC en Canarias (sobrevivia
   olvidar el tipo). Ahora hay un bloque con el motor real cargado.
 - Tests: 1 de motor y 4 de UI (delegacion en el motor, `parseParams` excedentes frente a PVPC,
   `alignStateToDataset` y cableado de los handlers). Mutaciones, seis de seis cazadas: rama
   principal sin tipo, `parseParams` sin tipo, handler sin ajuste, handler sin rehacer el
   selector, comparados sin filtrar y motor cacheando un anyo sin meses.
 - Trampa del arnes: tras la primera carga el service worker controla la pagina y sus peticiones
   no pasan por la intercepcion de Puppeteer; los ficheros simulados dejan de llegar y el control
   negativo parece igual al codigo nuevo. `page.setBypassServiceWorker(true)`.
 - Descartado en la misma pasada: `window.currentYear` (index, config, theme, tracking) solo se
   asigna para evitar un ReferenceError heredado; nadie lo lee y en el Observatorio queda tapado
   por constantes locales. El paso nuevo de `tests.yml` no modifica ni crea ficheros (`logs/` esta
   ignorado y "Verify synchronized repo state" paso despues de el en CI).

**Criterio de reapertura.** Cualquier `new Date()`/`getFullYear()`/`getMonth()` nuevo que decida
"anyo o mes en curso" fuera del ancla del dataset, un dataset con una zona horaria nueva, o un
control nuevo que cambie de dataset sin pasar por `alignStateToDataset`.

<a id="reintento-worker-pdfjs-fake-worker-17-09-2026"></a>
### El Reintento Del Worker De PDF.js En Modo Fake-Worker (RESUELTA 17/09/2026)

Encontrado investigando por que `tests/factura-lifecycle-chromium.test.js` paraba de vez en cuando
el `.bat` de despliegue.

- **Defecto real del producto.** En modo fake-worker (el navegador no puede crear el Worker) el
 bootstrap importa `vendor/pdfjs/pdf.worker.min.mjs` en el realm de la PAGINA, y Chromium memoriza
 un `import()` fallido para esa URL. El reintento de `factura.js` solo cambiaba el `#fragmento` del
 bootstrap (decision del 01-02/09/2026, pensada para fallos de evaluacion del propio bootstrap), y
 el bootstrap borra el fragmento y copia la misma `?v=` al vendor: tras UN corte de red de esa
 descarga, todos los intentos siguientes de la sesion fallaban con "Error al procesar factura PDF"
 hasta recargar. Reproducido de forma determinista en Chrome real haciendo fallar una sola vez esa
 peticion (`Fetch.failRequest`): el segundo intento fallaba siempre.
 - Correccion: con `#lf-pdf-worker-retry-N` en su URL, el bootstrap pide el vendor con
   `&lf_retry=N`. El `v` se conserva (guard de build del service worker, cuya rama de scripts es
   network-first con fallback `ignoreSearch`). La URL del propio bootstrap sigue reintentandose por
   fragmento, como estaba documentado. Mismo principio que el core con `lf_retry` desde el 02/09.
 - Tests: un tercer caso en el E2E de Chromium (corte de red del worker, segundo intento lee el PDF,
   segunda peticion con `lf_retry=1` y la misma `v`) y un caso unitario en
   `tests/factura-lifecycle.test.js` que evalua la URL del vendor con y sin fragmento de reintento.
   Mutacion (quitar el `lf_retry` del bootstrap): fallan los dos.
- **Lo que NO se aislo.** Chrome sin interfaz en Windows pierde a veces las primeras peticiones al
 servidor local del test (`net::ERR_FAILED`/`ERR_ABORTED` a los 40-90 ms), con y sin service worker,
 y el fallo desaparece al enganchar instrumentacion de red. Descartados con medicion intercalada:
 el service worker (4/25 sin servir `sw.js`) y el servidor del test. El E2E lleva `retry: 2`, que
 equivale al segundo intento del usuario y ahora si recupera; 30 pasadas seguidas sin fallos.
- **Defecto del arnes corregido de paso:** el servidor del E2E escribia `writeHead(200)` antes de
 leer el fichero, y ante una ruta inexistente el `writeHead(404)` lanzaba `ERR_HTTP_HEADERS_SENT`
 y dejaba la peticion colgada para siempre. No era la causa del fallo intermitente (medido).
- **Otro test intermitente:** "mueve el foco al estado de procesamiento..." de
 `tests/factura-integration.test.js` esperaba 100 ms fijos; con la suite en paralelo el foco seguia
 en el cargador. Ahora espera por condicion (`vi.waitFor`, 5 s). Mutacion (no mover el foco al
 titulo): falla.
- Suite 2013 -> 2020 (con el E2E de Chromium activo). Tres pasadas completas seguidas en verde, y
 en verde tambien con `America/Los_Angeles` y `Atlantic/Canary`.

- **Tercera revision (17/09/2026), candidatos de un prompt de ChatGPT verificados por Claude:**
 - Chip de comparacion obsoleto, CONFIRMADO en Chrome real y CORREGIDO. Tras pasar de Peninsula
   2027 a Canarias a las 00:30 de Madrid del 01/01, los chips del render anterior (con 2027) siguen
   activos mientras se recarga; pulsar "2027" dejaba `compareYears=2027` en la URL y una serie
   2027 vacia en la comparativa, porque `toggleYear` usaba la lista de anyos del dataset anterior
   y el render nuevo no volvia a filtrar. Ahora el render llama a `alignStateToDataset` antes de
   pintar los chips (reescribe la URL si cambia) y `toggleYear` ignora anyos que el dataset actual
   aun no ha empezado. Cada defensa sola basta en Chrome; un test de cableado exige las dos y
   cae con cualquiera de las dos mutaciones.
 - Esperas fijas de 250-500 ms en `tests/factura-integration.test.js` (23): eran esperas de
   condicion disfrazadas. Sustituidas por `waitForFacturaIdle()`, que espera a que
   `__LF_FACTURA_BUSY` se libere. Las de 0-50 ms que miden estados intermedios se conservan.
 - `tests/input-error-style.test.js` agoto 5 s con dos suites a la vez: jsdom calcula la cascada
   de todo `styles.css`. Margen de 20 s.
 - Descartados tras revisar: no hay otra ruta que cambie zona o tipo (sin `popstate`; la URL
   inicial ya se valida en `parseParams`); un anyo sin meses solo se da en anyos futuros (2021
   tiene junio-diciembre y los anteriores no son seleccionables; el manifest no decide los meses);
   `lf_retry` conserva `v` y la rama de scripts del SW cae a `ignoreSearch`; en el Worker real
   solo anhade una descarga en un reintento; el regex del fragmento esta anclado y solo lo genera
   `factura.js`; el `retry: 2` del E2E no oculta un fallo determinista (la mutacion fallo las tres
   veces) y el test nuevo recarga la pagina y limpia `Fetch` y el bypass en cada intento.

**Criterio de reapertura.** Actualizar PDF.js (nombre del vendor, mensaje "Setting up fake worker
failed" o memorizacion del fake worker), cambiar la rama de scripts del service worker, o que el E2E
de Chromium vuelva a necesitar reintentos de forma habitual.

**Actualizacion 24/09/2026: el fallo intermitente del E2E era una carrera DEL TEST.** Paro el
.bat dos veces (23 y 24/09) fallando en sus tres intentos; aislado lo reproducia 1 de cada 2-4
veces. Causa medida en una copia instrumentada: en las ejecuciones fallidas el PRIMER intento no
cargaba ningun recurso de PDF.js. El test esperaba solo `__LF_facturaModuleReady`, que `factura.js`
fija al evaluarse, pero los listeners del modal (incluido el `change` del input) los engancha
despues `lf-app.js` via `__LF_bindFacturaParser`. Si el test llegaba antes, el `change` no tenia
oyente, el corte de red simulado le caia al segundo intento y este fallaba (el reintento SI quedaba
preparado: `window.pdfjsLib === null`). No afecta a usuarios: el boton que abre el modal se
engancha en esa misma funcion. CORREGIDO esperando tambien a `btnSubirFactura.__LF_BOUND`
(`FACTURA_LISTA`): 10/10 en la copia instrumentada, 8/8 el test real y dos suites completas en
verde. Queda sin efecto la nota de que los cortes transitorios "no se aislaron".

<a id="mezcla-de-builds-ronda-42-17-09-2026"></a>
### Una Pagina Con Codigo De Dos Despliegues (Ronda 42, 17/09/2026)

Pregunta: la premisa "todos los scripts llevan el mismo `?v=` y el service worker cachea por URL, asi
que no hay mezcla de versiones realista", en la que se apoyaban decisiones de las rondas 26 y 39.
Auditor externo sin ejecucion; Claude verifico en el codigo y con tests.

**Resultado: la premisa es FALSA para cargas tardias; 1 defecto CORREGIDO; decisiones revisadas.**

- **La mezcla existe (confirmado leyendo `sw.js`).** La rama de scripts es network-first: si
 `fetch()` devuelve 200 se entrega esa respuesta, y la comparacion `requestedBuild !== CACHE_VERSION`
 solo se evalua en el `catch` (fallback offline). GitHub Pages sirve por ruta e ignora la query, asi
 que una pagina N que pide tarde `algo.js?v=N` tras publicarse N+1 recibe bytes N+1, con o sin
 service worker. La guarda protege el fallback de Cache Storage, no la respuesta de red.
- **Exposicion real, medida sobre el codigo:** el codigo propio que se carga tarde es
 `index-extra.js` (lo inyecta su loader al cargar la pagina) y `pdfjs-worker-bootstrap.mjs` (al subir
 un PDF). El resto de cargas tardias son vendors (PDF.js, jsQR, Tesseract, SheetJS), que solo
 cambian al actualizarlos. El riesgo realista es una actualizacion de vendor con pestanhas abiertas.
- **DEFECTO CORREGIDO: pagina que arranca ya controlada por un SW mas nuevo.** Si otra pestanha
 activaba el despliegue mientras esta cargaba, el `controllerchange` llegaba antes de que existiera
 el listener de `lf-sw-update.js`; `hasSeenController` nacia en `true` y la pagina nunca se marcaba
 obsoleta. Ahora, al arrancar, si hay controlador y `window.__LF_BUILD_ID` tiene formato de build,
 se pregunta `GET_VERSION` y, solo si el SW es MAS NUEVO que el HTML (comparacion de texto de
 `AAAAMMDD-HHMMSS`), la pagina pasa a obsoleta y usa la recarga existente (10 s tras la carga, sin
 interaccion reciente, una vez por version). Una pagina mas nueva que su SW no se toca: la resuelve
 la actualizacion normal. Tests en `tests/sw-update-timing.test.js`: recarga una vez, no repite si ya
 recargo para esa version, y no actua con el mismo build, con un HTML mas nuevo ni sin build
 reconocible. Mutaciones: quitar la comprobacion y marcar ante cualquier diferencia; ambas cazadas.
- **RECHAZADO: devolver error cuando la red da 200 con un `?v=` de otro build.** Lo propuso el
 auditor. Romperia la carga de PDF.js o SheetJS en cualquier pestanha antigua aunque ese fichero no
 hubiera cambiado, que es el caso normal, y no hay ningun sitio del que sacar los bytes antiguos una
 vez activo el SW nuevo. La respuesta correcta es recargar la pagina obsoleta, que es lo corregido.
- **Decisiones revisadas.** Ronda 39 (fallback sin `xlsxRowsFromSheet`): se mantiene, con la
 justificacion corregida en su entrada. Ronda 26 (dependencias duras del simulador): sigue siendo
 correcta; su proteccion es la propia puerta de dependencias, no la imposibilidad de mezclar.
- **Correctos segun el auditor y sin cambios:** precache opcional incompleto (el SW nuevo borra las
 caches antiguas al activarse), recarga automatica unica tras un arranque roto, excepcion
 `CROSS_BUILD_RECOVERY_PATHS` y `lf_retry` del worker de PDF.js. No encontro en `sw.js` ni en
 `lf-sw-update.js` un mecanismo para los cortes transitorios del E2E de Chromium.
- **No ejecutado (queda como pendiente con disparador):** la prueba en Chrome real con dos builds
 seguidos (pagina N abierta, publicar N+1, cargar PDF.js). Disparador: la proxima actualizacion de
 un vendor que se cargue tarde; en ese despliegue, comprobar que una pestanha abierta antes se
 recarga sola al volver a ella.

- **Revision del arreglo (17/09/2026, auditor externo sin ejecucion; Claude verifico):**
 - 42-REV-01, CONFIRMADO y CORREGIDO: si `GET_VERSION` no respondia en 1 s al arrancar, la
   comprobacion se abandonaba y ningun disparador la repetia (todos salian por `!pageIsStale`).
   Ahora `checkPageBuildAgainstSw` queda pendiente hasta obtener una version valida y la reintentan
   visible, focus, online e intervalo. Test: el SW tarda 1,1 s la primera vez y `online` recupera la
   recarga. Mutaciones cazadas: quitar el reintento de `online` y abandonar tras el timeout. El test
   va el primero del bloque porque los coordinadores de tests anteriores siguen escuchando `online`.
 - 42-REV-02, REFUTADO: decia que un HTML antiguo servido desde la cache HTTP, con `tracking.js`
   nuevo entregado por el SW, dejaria `__LF_BUILD_ID` en el build nuevo. Falso: `tracking.js` toma
   el build del `?v=` de `document.currentScript.src`, que escribe el HTML. Comprobado en Chrome real
   con un servidor que sirve el HTML con los `?v=` de un build antiguo y los ficheros actuales: el
   build de la pagina queda en el antiguo, la pagina se recarga una vez y no entra en bucle. Nuevo
   test en `tests/tracking-errors.test.js` que fija ese contrato (al final del fichero: el primer
   bootstrap de tracking fija su origen para todos los tests).
 - Correctos: comparacion de texto de los builds, una recarga por version, `controllerchange`
   normal, doble inicializacion, pagina mas nueva que su SW y `CROSS_BUILD_RECOVERY_PATHS`.
   Precision del auditor, correcta: la calculadora tiene su propio registro inline del SW y las
   guias no usan el coordinador, asi que la comprobacion solo aplica a home, solar y Observatorio.
   `inp-debug.js` tambien se carga tarde, pero solo en modo depuracion.

- **Segunda revision del arreglo (17/09/2026):**
 - Candidato del auditor, "rollback del controlador" (SW que vuelve a una version no mas nueva que
   la pagina): no ocurre con el proceso actual, porque `CACHE_VERSION` es la marca de tiempo del
   despliegue y siempre crece. Pero senhalaba un defecto real y frecuente, CONFIRMADO en Chrome y
   CORREGIDO: `tryReloadOnStale` recargaba tras cualquier `controllerchange` aunque la pagina ya
   fuera del build nuevo. En la primera visita tras cada despliegue (HTML nuevo por red, SW nuevo
   activado despues) la pagina se recargaba a los 10 s sin necesidad. Ahora, si
   `version <= pageBuildAtInit`, se da la pagina por actualizada y no recarga. Reproducido con un
   servidor local en dos fases: antes, una recarga; despues, ninguna. Una pestanha realmente antigua
   abierta durante el despliegue sigue recargandose una vez (comprobado en Chrome).
   Tests: sin recarga con el mismo build o con un controlador no mas nuevo, y recarga con un HTML
   anterior. Mutaciones (quitar el guard y aplicarlo siempre) cazadas.
 - Defecto de cobertura del auditor, CORREGIDO: `tests/sw-update-timing.test.js` acumulaba en el
   mismo `window` los listeners de cada coordinador, y el test del timeout tenia que ir el primero.
   El arnes registra y retira ahora esos listeners en cada test; el test ya no depende del orden
   (mutacion: sin retirar listeners, vuelve a fallar).
 - Correctos segun el auditor: `pageBuildCheckInFlight` se libera siempre (getSwVersion tiene su
   propio timeout) y la comprobacion pendiente se reintenta mientras la pagina este visible.

- **Transicion real en produccion (17/09/2026, despliegue 121106 -> 123237):** una pestanha abierta
 antes del despliegue se recargo una vez y paso al build nuevo. Una pestanha abierta segundos DESPUES
 de publicar recibio aun el HTML antiguo (cache del CDN o del navegador): es el caso real que
 justifica comparar builds. Oculta, no se recargo (aplazamiento deliberado); reproducido en local, al
 volver a primer plano se recarga una vez y pasa al build nuevo.

- **Tercera revision del arreglo (17/09/2026):**
 - HALLAZGO del auditor, CONFIRMADO y CORREGIDO: un visitante nuevo (sin SW) que recibe un HTML
   antiguo del CDN mientras el SW que se instala ya es el nuevo quedaba sin detectar. Sin
   controlador, la comprobacion se daba por cerrada, y el primer `controllerchange` se trataba como
   simple instalacion. Ahora la comprobacion sigue pendiente sin controlador y el primer
   `controllerchange` la ejecuta. Reproducido en Chrome con un servidor que sirve el HTML antiguo y
   el `sw.js` actual, con control negativo: el codigo desplegado no recargaba; el nuevo recarga una
   vez y no entra en bucle aunque el servidor siga dando el HTML antiguo. Tests: primera
   instalacion con HTML antiguo (recarga) y con el mismo build (no recarga). Mutaciones cazadas:
   quitar la llamada del primer `controllerchange` y volver a cerrar la comprobacion sin
   controlador.
 - Defecto de cobertura, CORREGIDO: nada impedia publicar una `CACHE_VERSION` menor que otra ya
   publicada, y el guard depende de que crezca. `tests/cache-version-monotonic.test.js` compara la
   version actual con las 40 ultimas del historial de `sw.js` (se omite sin git). Mutacion: bajar
   la version a una ya publicada, cazada.
 - Descartado: el aislamiento del arnes no cubre los listeners de `navigator.serviceWorker`, pero
   cada test crea un objeto nuevo y el falso guarda un solo manejador por tipo, asi que no se
   acumulan. El apartado "Transicion real en produccion" que el auditor no encontro estaba en un
   commit aun no publicado (`b24c180`).

- **Cuarta revision (17/09/2026): sin hallazgos funcionales. RONDA CERRADA.**
 - Prueba de principio a fin en Chrome, con un servidor que da el HTML antiguo solo en la primera
   navegacion (el CDN se pone al dia despues): visitante nuevo visible -> una recarga, pasa al HTML
   nuevo y no hay segunda; con la pestanha oculta al principio -> espera, al hacerse visible recarga
   una vez, pasa al HTML nuevo y no hay mas. Trampa del arnes: la recarga pasa por el SW y llega
   con `Sec-Fetch-Dest: empty`; para contar navegaciones hay que mirar `Sec-Fetch-Mode: navigate`.
 - Limites asumidos de `cache-version-monotonic.test.js`: compara con las versiones que aparecen en
   los ultimos 40 commits que tocan `sw.js` (tras aplastar el historial compara con menos, sin
   fallos en falso) y admite igualdad. Exigir "estrictamente mayor" no es posible: tras el commit de
   despliegue, la version de la rama ES la ultima publicada. Que se publique codigo sin subir la
   version (un push sin el `.bat`) es otra propiedad y no la cubre este test.

**Criterio de reapertura.** Cambiar la rama de scripts de `sw.js`, `CROSS_BUILD_RECOVERY_PATHS`, la
forma de calcular `window.__LF_BUILD_ID` o el formato de `CACHE_VERSION` (el guard nuevo exige que
las versiones crezcan con cada despliegue); o anhadir una carga tardia de codigo propio.

<a id="capa-comun-csv-ronda-43-17-09-2026"></a>
### La Capa Comun Del Importador CSV Como Area (Ronda 43, 17/09/2026)

Primera auditoria como area de lo que quedaba sin cubrir de `js/lf-csv-utils.js`: del texto a filas,
fechas y horas escritas como texto, matriz horaria y Datadis mensual, ventana temporal y festivos,
zona fiscal por defecto y codigos de error. Se dejo fuera todo lo cerrado en las rondas 15, 29, 37 y
39. Auditor externo sin ejecucion (solo lee GitHub); Claude ejecuto cada candidato con el modulo real.

**Resultado del auditor: 0 bugs, 0 alineaciones, 3 candidatos de hardening. Resultado tras ejecutar:
1 defecto de ALINEACION con perdida silenciosa, CORREGIDO, que el auditor no vio.**

- **Defecto, CORREGIDO: filas descartadas sin aviso en la ruta por filas.** `parseEnergyTableRows`
  descartaba con `continue` las filas con fecha u hora no reconocidas, hora fuera de 1-25, consumo o
  excedente no numerico y valores negativos, sin contarlas. Solo abortaba si se perdia mas del 50 %.
  Ejecutado con un anho de 8760 horas y el 30 % de filas estropeadas por cada motivo: entraban 6132
  registros, 3066 kWh de 4380, `validateCsvSpanFromRecords` daba el rango por bueno y no habia
  ningun aviso. La matriz `Fecha + H01..H24` si avisaba de sus descartes, de ahi la clasificacion.
  No hay en el banco ningun fichero real que lo dispare: los seis fixtures descartan 0 filas.
  Correccion: tres contadores y tres avisos con la redaccion de la matriz. Una fila sin fecha ni
  hora (pie con totales, notas) NO cuenta como dato perdido. 7 regresiones en
  `tests/csv-hardening.test.js` (bloque "Filas descartadas por su contenido"), incluida la de que
  `1.csv` sigue sin avisos. **6 mutaciones, 6 cazadas**: sin contar la fecha invalida, la hora
  fuera de rango, el negativo o el no numerico, contar tambien los pies y contar el pie en la
  ruta `FechaHora`. Suite 2035 -> 2042, lint 0/0.
- **43-01, fecha de texto con anho de dos cifras: se mantiene la decision de la ronda 39.** Ya
  estaba registrada como sin tocar a proposito; el auditor no la cito. Dato nuevo: el mismo
  `new Date()` lee tambien `dd.mm.aaaa` y `dd.mm.aa` como mes/dia (`01.04.2026` -> 4 de enero, en
  V8). Pero un fichero de un mes o mas se rechaza entero, porque los dias 13 a 31 no se leen y cae
  por debajo del 50 %. Solo se colaria sin aviso un fichero de 12 dias o menos. Tras esta ronda,
  si un fichero real se quedara en mas de la mitad, lo avisaria el mensaje nuevo.
- **43-02, `FechaHora` con `Z` o desfase: DESCARTADO.** Confirmado que la zona se ignora y se lee
  como hora local. Ninguna exportacion admitida trae instantes UTC, y convertirlos seria inventar
  una semantica sin fichero que la respalde.
- **43-03, `Hora` con minutos distintos de `:00`: DESCARTADO.** Confirmado que `01:30` entra como
  hora 1. Un fichero cuartohorario o semihorario real (varias filas por hora) ya se cancela por el
  guard de duplicados; solo pasaria un fichero horario rotulado con `:30`, y su hora de inicio es
  justo la que se toma.
- **Comprobado y correcto:** CR suelto (rechazo con mensaje), celda entrecomillada con salto de
  linea (la fila rota no produce registro) y pie de totales (se ignora).

**El auditor.** Cobertura completa y trazas correctas, sin inflar severidad. Dos fallos: no leyo la
entrada de la ronda 39 que ya decidia 43-01, pese a pedirselo el encargo, y dio por cerrado el bucle
de `parseEnergyTableRows` sin contar que ramas avisaban. El defecto salio al ejecutar sus
candidatos con ficheros de un anho, no de leer.

**Prueba a fondo en produccion (build `20260917-174420`), dos hallazgos mas, CORREGIDOS.**
Bateria con Chrome real sobre la web publicada: nueve CSV de un anho (cada motivo de descarte por
separado, pie de totales, "Sin dato", mezcla, rechazo por mayoria, columna `FechaHora`) y un XLSX,
en home, simulador solar y Observatorio, mas movil en tema oscuro y un control negativo con el
`lf-csv-utils.js` anterior. Importes, curva y excedentes coincidieron al centimo con los del modulo.
- **En la home NINGUN aviso de importacion llegaba a verse.** `procesarCSVConsumos` lanzaba el
  toast justo antes de abrir la vista previa, y el overlay del modal (z-index 10010/10011) queda
  por encima del toast (9999, 10001 con su regla posterior). Medido en escritorio y en movil: con
  `pointer-events` activado en el toast, el elemento en su centro es el modal, y la captura no lo
  muestra. Afectaba a todos los avisos previos (neteo, Wh, cambio de hora, celdas vacias), no solo
  a los nuevos. Correccion: `buildImportNoticesHTML` los pinta dentro del modal
  (`#csvImportNotices`, texto escapado) y se retira el toast. Regresion con el manejador real en
  `tests/csv-import-avisos-modal.test.js`; 3 mutaciones, 3 cazadas (sin bloque, toast de vuelta,
  sin escapar). Los avisos solo citan cabeceras ya normalizadas, asi que el escapado es defensa
  en profundidad. En el simulador solar el toast SI se ve (no hay modal): comprobado con captura.
- **El Observatorio no mostraba los descartes.** Ahora su nota de resultado anhade las lineas
  "Se descartaron..." (`csvState.discardNotice`, se limpia al fallar). Sin test de UI en jsdom
  (no existe arnes de subida para esa pagina); cubierto por la bateria en Chrome.
- **Mensaje de rechazo por mayoria.** Culpaba al separador aunque la causa fueran valores
  negativos. Si los recuentos explican al menos la mitad de lo perdido, ahora nombra las causas;
  la redaccion evita "valores no numericos" y "columna" para que la analitica siga en
  `filas-invalidas` (2 regresiones). Suite 2042 -> 2048, lint 0/0.
- Trampa del arnes: el toast lleva `pointer-events: none` y `elementFromPoint` lo ignora aunque se
  vea; hay que activarlo antes de medir. Y el primer aviso llega con prefijo `⚠️ `.

**Segunda revision del auditor (sobre `2a721f2` y `b18b1f9`, 17/09/2026): sin hallazgos.** Sus
verificaciones del escape, del transporte de avisos (CSV, XLSX, matriz, Datadis mensual), del estado
del Observatorio y del umbral del mensaje son correctas. Al comprobarlas aparecio un resto: el parser
alternativo propio de `js/pvpc-stats-csv.js` (bucle local para la columna solar) construye registros
saltandose filas sin contarlas. **Es inalcanzable hoy**, verificado ejecutando los cuatro casos con
XLSX reales: con UNA candidata la consume el parser comun via `mapSafeFallbackSolarExport` (y
entonces si cuenta), y con dos el guard `abortarSiQuedaColumnaSolar` cancela la importacion. Se deja
como red de seguridad pero contando lo que descarta, y 2 regresiones fijan por que es inalcanzable
(si alguien cambia esa eleccion, saltan). Suite 2052.

**Revision del auditor sobre `373e3f1` (17/09/2026): sin hallazgos.** Inventario completo de los
`continue` y `throw` del bucle, con veredicto por rama; correcto salvo una afirmacion: dice que un
pie `Total;; ;1,5;0` (hora con un espacio) SI se cuenta como descarte. Ejecutado: `isNoDataCellValue`
hace `trim()`, asi que un espacio es celda vacia y esa fila no se cuenta, que es lo deseable. Los
demas casos que cita se reprodujeron tal cual (fecha valida + hora vacia si cuenta; hora 25 fuera de
octubre gana sobre el negativo de su misma fila; el 50 % justo se acepta y el 60 % se rechaza).
Acepto su unica propuesta de cobertura: 3 regresiones mas para que quede fijado que una fila con dos
motivos se cuenta UNA vez y que la mitad justa se acepta. Mutacion nueva (sumar dos contadores en la
misma rama), cazada. No reviso `2a721f2` porque es posterior a su encargo.

**Criterio de reapertura.** Anhadir o quitar un `continue` en el bucle de `parseEnergyTableRows`
(debe contar o justificar por que no avisa), aparecer un fichero real con avisos de descarte, o con
fechas de texto `dd.mm.aaaa` o de dos cifras de anho. Para la home: volver a mostrar avisos de
importacion fuera del modal.

<a id="csp-esquema-recortado-mismo-origen-22-09-2026"></a>
### Violaciones CSP Con El Esquema Recortado Atribuidas Al Origen Propio (RESUELTA 22/09/2026)

Encontrado leyendo el export de GoatCounter del 10-22/09/2026. La fila mas ruidosa era
`error-csp/script-src/eval/sin-host/same-origin/blob/1/enforce/home/20260919-195217/firefox-156`:
274 eventos de una sola pestaña (un unico `error-recurrencia ... ge10`) el 21/09/2026.

- **Causa.** CSP3 ("strip URL for use in reports") entrega en `sourceFile`/`blockedURI` SOLO EL
 ESQUEMA cuando la URL no es HTTP(S). Firefox manda `"blob"`, `"moz-extension"` y
 `"sandbox eval code"`. `cspSourceDiagnostic` hacia `new URL(raw, location.href)`, asi que la palabra
 se resolvia como ruta relativa (`https://luzfija.es/blob`) y salia `same-origin/<palabra>`: ruido
 de extensiones y userscripts rotulado como codigo propio. Mismo patron en el export:
 `same-origin/moz-extension/5033`, `same-origin/chrome-extension/18`,
 `same-origin/sandbox-20eval-20cod/17`. `cspTargetDiagnostic` ya reconocia `blob`/`data`/`eval`
 sueltos, pero no `moz-extension`/`chrome-extension`. Por ese lado salian los 36
 `font-src/same-origin/propio` de Firefox 155/156 y el `manifest-src/same-origin/propio` de Edge
 139: con `font-src 'self'` y `default-src 'self'` una URL de verdad same-origin NO puede violar la
 CSP, asi que esa fila es imposible como recurso propio y solo puede ser un esquema recortado.
- **No es codigo propio.** Ningun vendor evalua desde un `blob:`: el `new Function` de
 `pdf.worker.min.mjs` es un falso match (`new FunctionBasedShading`), el de `tesseract/worker.min.js`
 es un fallback de `globalThis` inalcanzable y Tesseract corre con `workerBlobURL: false`.
- **Severidad.** Solo telemetria: ni importe ni privacidad (solo viajan categorias cerradas). El
 dano era de triaje: contradecia el contrato de `ANALITICA-GOATCOUNTER.md` (el iniciador distingue
 `extension` y otros protocolos) y apuntaba al codigo propio.
- **Arreglo.** `cspNonAbsoluteKind()` en `js/tracking.js`: un informe CSP de un recurso HTTP(S) trae
 siempre URL absoluta, asi que lo que no lo es no puede ser first-party. Esquema de extension ->
 `extension`; cualquier otro -> `other-protocol`. 7 regresiones en `tests/tracking-errors.test.js`
 (4 de `sourceFile`, 3 de `blockedURI`), las 7 validadas por mutacion restaurando el codigo previo.
 Suite 2059, lint 0/0.
- **Fuera de alcance, deliberado.** El evento primario sigue sin tope por carga: conservar todas las
 apariciones en un path es el diseno de la recurrencia, y el companero `ge10` ya delata la pestaña
 ruidosa. Con la clasificacion corregida ese ruido se lee como `other-protocol`/`extension`.

**Criterio de reapertura.** Un `error-csp` con `same-origin/<fichero>` cuyo basename no exista en
el repo.

<a id="oraculo-independiente-factura-ronda-44-23-09-2026"></a>
### Oraculo Independiente De La Factura De La Home (Ronda 44, 23/09/2026)

Primera re-auditoria de un area ya auditada con un angulo nuevo: caja negra. Todas las rondas
anteriores del motor leyeron el codigo y lo contrastaron consigo mismo y con la documentacion, un
metodo que no puede ver un error que codigo y docs compartan. ChatGPT escribio `oraculo.py`
(Python, `Decimal`, stdlib) desde el BOE SIN leer `js/`, `tests/` ni ningun `.md` (declaro haber
abierto por error JSON-SCHEMA, CAPACIDADES-WEB y PVPC-SCHEMA; sus decisiones divergentes muestran
que no calco el motor). Las convenciones de producto se le dieron cerradas (C1-C12); lo normativo lo
derivo el. Claude ejecuto su oraculo y la web de produccion (Chrome real, entradas por URL, lectura
de `window.LF.state.rows`) sobre sus 50 escenarios con los datos del mismo dia, y resolvio cada
diferencia contra el BOE, no contra el codigo.

**1 bug CONFIRMADO y CORREGIDO: IGIC/IPSI de la energia del PVPC cobrado dos veces.**
- **Mecanismo.** `obtenerPVPC_LOCAL` emite una linea `'IGIC energía'` / `'IPSI energía'` en el canal
  interno `resultadoPVPC`. `parsearRespuestaPVPC` la clasificaba en la rama del termino variable
  (`cabecera.includes('energía')`), evaluada antes que la de IGIC/IPSI. El impuesto entraba en
  `terminoVariable` y `crearTarifaPVPC` -> `computePvpcFiscal` lo volvia a gravar sobre esa base.
- **Alcance.** Solo PVPC en Canarias no-vivienda (IGIC 3%) y Ceuta/Melilla (IPSI 1%). En Peninsula
  la linea se llama `'IVA'`; en Canarias vivienda vale 0,00. Afecta a ranking, desglose y descuento
  del bono social (todos leen `metaPvpc`).
- **Medido en produccion (23/09/2026, 3,45 kW, 30 dias, 300 kWh).** Canarias no-vivienda: 71,91 EUR
  frente a 69,84 (energia 56,04 en vez de 54,03, +2,07 EUR, ~3%). Ceuta/Melilla: 69,58 frente a
  68,90 (energia 55,11 en vez de 54,44). La senal que lo delato: el termino de ENERGIA cambiaba con
  el flag `viviendaCanarias`, que solo es fiscal.
- **Arreglo.** Rama `igic`/`ipsi` antes que la de energia en `parsearRespuestaPVPC`. 2 regresiones
  en `tests/pvpc.test.js` (Canarias no-vivienda y Ceuta/Melilla, precio plano: terminoVariable debe
  ser exactamente 30,00 y el impuesto indirecto una sola vez); ambas fallan con el codigo previo
  (30,96 en vez de 30). Verificado en Chrome real con el sitio servido en local: Canarias 69,84,
  identico al oraculo; Peninsula, Canarias vivienda y bono social sin cambios. Suite 2061, lint 0/0.

**Todo lo demas cuadra.** Tras corregir en una copia del oraculo SOLO sus errores demostrados contra
norma, las 119 tarifas de mercado libre coinciden al centimo en todos los escenarios fuera de
Ceuta/Melilla (energia, potencia, SSAA, financiacion del bono social, contador, IEE, IVA/IGIC,
compensacion con topes ENERGIA y ENERGIA_PARCIAL, excedente indexado, BV con saldo y cuota) y el
PVPC peninsular coincide (energia al centimo: valida ventana, periodos y festivos).

**Errores del oraculo, resueltos contra el BOE (NO son bugs de la web; no reabrir):**
- Margen fijo del PVPC aplicado tambien a P2. RD 216/2014, termino FPU: "termino fijo de los costes
  de comercializacion multiplicado por la potencia del periodo horario punta". La web lo aplica solo
  a P1.
- IEE omitido en Canarias, Ceuta y Melilla. Ley 38/1992 art. 91.1: "El impuesto se aplicara en todo
  el territorio espanol". (Ademas cito la Ley 38/1992 con el identificador de la Ley del IVA,
  BOE-A-1992-28740; el correcto es BOE-A-1992-28741.)
- Financiacion del bono social fuera de la base del descuento. RD 216/2014 art. 8: la facturacion
  del PVPC es la suma de potencia, energia activa y "facturacion de financiacion del bono social";
  RD 897/2017 art. 6.3 aplica el descuento "en todos los terminos que componen el PVPC". La web la
  incluye.
- IVA en dos lineas redondeadas por separado (electricidad y contador al mismo 21%): 875 descuadres
  de 1 centimo que desaparecen con una base por tipo, que es lo que hace la web.
- Convenciones de producto no seguidas: calculo el PVPC con autoconsumo activo (C8 lo excluye) y
  cobro la cuota BV sin placas (la web solo la cobra con `solarOn`; el prompt no lo precisaba).

**Ambiguedades que quedan, sin cambio (impacto <= 0,03 EUR):**
- Prorrateo del contador: la web usa `0,81 x 12/365` por dia (practica habitual de facturacion);
  el oraculo eligio `/30`. Ninguna norma recuperada fija la formula.
- IPSI del contador en Ceuta/Melilla: la web aplica 4%. Ordenanza de Melilla (BOME 5625, 2019):
  electricidad 1%, servicios 4%. Ordenanza de Ceuta (version 2007 consultada): electricidad 1%,
  servicios 3%; y ambas dicen que la distribuidora repercute el impuesto sobre el "importe total
  facturado", lectura que llevaria el contador al 1% (la del oraculo). Diferencia de 1-2 centimos;
  habria que contrastar la ordenanza de Ceuta vigente y una factura real antes de tocar nada.
  **Resuelto en la ronda 45:** la ordenanza de Ceuta vigente (reformada) fija servicios al 4%, como
  Melilla; el 4% de la web es correcto.
- Base del IEE del PVPC: se calcula sobre componentes SIN redondear (`terminoFijo`, margen y
  financiacion), mientras el mercado libre usa las lineas ya redondeadas. Diferencias de +-1 centimo
  en 4 escenarios. El caso CNMC documentado en ARQUITECTURA-CALCULOS.md cuadra con la ruta actual.

**Criterio de reapertura.** Cualquier cambio en las cabeceras del canal `resultadoPVPC` o en el
orden de ramas de `parsearRespuestaPVPC`; un PVPC fuera de Peninsula cuyo termino de energia varie
con un flag fiscal; o una factura real de Ceuta/Melilla que contradiga el 4% del contador.

<a id="oraculo-independiente-simulador-solar-ronda-45-23-09-2026"></a>
### Oraculo Independiente Del Simulador Solar (Ronda 45, 23/09/2026)

Mismo metodo que la ronda 44, sobre `js/bv/bv-sim-monthly.js`: ChatGPT escribio `oraculo_solar.py`
desde la norma sin leer el codigo (solo `tarifas.json` y `data/ssaa/index.json`), con las
convenciones de producto dadas cerradas (C1-C14, contrastadas antes con el codigo: valores
regulados de hoy para todos los meses salvo SSAA por mes, dias con datos, cuota BV por dias
naturales, BV por `fv.bv`, hucha tras impuestos, ranking por `pagado` y desempate por `bvFinal`).
Claude lo ejecuto contra `window.BVSim.simulateForAllTarifasBV` en produccion con sus 57
escenarios (3.933 resultados tarifa-escenario, 69 tarifas del universo solar).

**Resultado: cero bugs en el motor.** Tras igualar una convencion de redondeo, todas las tarifas
de Peninsula cuadran al centimo en `pagado`, `real` y `bvFinal` en todos los escenarios (un mes,
ano completo desde enero y desde julio, hucha que se llena y se vacia, saldo inicial, dias
parciales, topes ENERGIA y ENERGIA_PARCIAL en y por encima del tope, excedente indexado, cuota BV,
SSAA con dato, posterior al ultimo mes y anterior sin dato). Los rankings coinciden salvo el orden
dentro de empates exactos.

**Diferencias resueltas sin cambio en la web:**
- Redondeo por periodo: el oraculo redondea cada linea de potencia y de energia por periodo; la
  web redondea la suma. Hasta 4 centimos por mes. Convencion, el prompt no la fijaba.
- IPSI de los servicios (contador y cuota BV) en Ceuta: el oraculo aplico el 3% de la ordenanza de
  Ceuta de 2007. La ordenanza reformada (texto de 2024, art. 33) dice "Las prestaciones de servicios
  tributaran al tipo general del 4%" y "El consumo de energia electrica tributara al tipo del 1%".
  Melilla (BOME 5625, 2019) coincide: servicios 4%, electricidad 1%. La web (4%) es correcta.

**Inconsistencia menor de la web (BAJO, sin cambio por ahora).** En Canarias y Ceuta/Melilla el
IGIC/IPSI del contador y el de la cuota BV van al mismo tipo (7% / 4%) pero se redondean por
separado (`impuestoContador` + `impuestoServicios`); en Peninsula el IVA usa una sola base. Solo
afecta a tarifas con `precioBV > 0` en esas zonas: 1 centimo por mes (p. ej. 0,0581 + 0,1155 ->
0,06 + 0,12 frente a 0,17 con base unica). Afecta igual a la home.

**Punto normativo abierto: minimo del IEE con compensacion.** Ley 38/1992 art. 94.9 declara exenta
"la energia electrica suministrada que sea objeto de compensacion con la energia horaria
excedentaria" (RD 244/2019). Web y oraculo calculan el minimo de 1 EUR/MWh (art. 99.2.b) sobre
todos los kWh importados de la red, incluidos los compensados. Solo muerde cuando la compensacion
deja una base muy baja (5,11% de la base < 0,001 EUR x kWh), y son centimos. Falta doctrina DGT o
una factura real de autoconsumo en ese caso para decidir que kWh cuentan.

**Criterio de reapertura.** Cambio en la ordenanza del IPSI de Ceuta o Melilla; una consulta DGT o
factura real que fije los kWh del minimo del IEE con compensacion; o unificar la base de servicios
en `calcularImpuestoIndirecto` (debe conservar `tests/fiscal-rounding-align.test.js`).

<a id="oraculo-independiente-camino-horario-ronda-46-23-09-2026"></a>
### Oraculo Independiente Del Camino Horario (Ronda 46, 23/09/2026)

Mismo metodo que las rondas 44 y 45, sobre la curva horaria: M1 `BVSim.bucketizeByMonth` (P1/P2/P3
por mes), M2 `pvpc.obtenerPVPC_LOCAL` con `LF.consumosHorarios` (modos exacto, hibrido y medias) y
M3 `surplusPrices.computeHourlyCompensation` + `applyMonthlyIndexedValues`. ChatGPT escribio el
oraculo y un generador determinista sin leer el codigo. Claude lo ejecuto contra los motores reales
de produccion (las ausencias de precios simuladas se reprodujeron interceptando `/data/pvpc` y
`/data/surplus`) con 52 escenarios sinteticos (56.668 horas) y con las 8 curvas horarias reales del
banco local leidas por `BVSim.importFile`, en las tres zonas (24 escenarios mas).

**Cuadra.** M1 al completo en los sinteticos: periodos por zona incluida la punta desplazada de
Ceuta/Melilla con consumo distinto en cada hora (la ronda 44 no la llego a probar: con consumo
igual por periodo ambas reglas daban lo mismo), festivos nacionales de fecha fija, Jueves y Viernes
Santo como dias ordinarios, y los cuatro cambios de hora de 2025-2026 en Peninsula y Canarias con la
hora 25. M2 en los tres modos y en los bordes del 10%, con medias identicas. M3 en todo lo que el
prompt podia comparar.

**1 bug CONFIRMADO fuera del alcance del oraculo: excedentes indexados de Canarias valorados con
el precio de la hora anterior.**
- `data/surplus/8742` guardaba el indicador 1739 con reloj `Europe/Madrid` (decision deliberada de
  `scripts/pvpc_auto_fill.py` para indicadores nacionales; la serie es identica a la de 8741). Los
  dos consumidores (`js/lf-surplus-prices.js` y `js/pvpc-stats-csv.js:461`) cruzan la hora CNMC del
  CSV, que en Canarias es hora local canaria, con la ETIQUETA horaria del fichero en ese reloj. La
  hora canaria de 12:00 a 13:00 se valora con el precio de 11:00 a 12:00 canarias.
- Referencia correcta: cruzar por instante. El PVPC de Canarias (1001, geo 8742) es identico al
  peninsular en el MISMO instante (743/743 horas de julio de 2025) y su fichero ya esta reetiquetado
  con hora canaria.
- Medido en produccion: hora 13 del 15/07/2025 en Canarias -> 0,04655 EUR/kWh (instante 10:00Z) en
  vez de 0,04542 (11:00Z). Con una curva real de 3.056 kWh vertidos en 11 meses tratada como
  canaria: 62,37 EUR frente a 67,57 EUR, un 7,7% menos, y por debajo en los 11 meses.
- Alcance: simulador solar con curva horaria en Canarias y tarifas de excedente indexado
  (`fv.exc = -1`), y la calculadora de compensacion del Observatorio para Canarias. No afecta a
  Peninsula, Ceuta/Melilla ni al PVPC.
- Por que el oraculo no lo vio: el prompt le dio como convencion "usa el `timezone` del propio
  fichero", que es lo que hace la web. Leccion: una convencion de producto que se da cerrada no se
  puede auditar con el oraculo; hay que revisarla aparte.
- **CORREGIDO el 23/09/2026 reetiquetando el dato.** `scripts/pvpc_auto_fill.py` guarda cada geo en
  su hora civil tambien para indicadores nacionales, y el historico de `data/surplus/8742` se
  reagrupo una vez en hora canaria desde sus propios ficheros (mismos 46.583 pares
  instante-precio, cero alterados; solo se descarta la hora suelta del 31/05/2021, que en hora
  canaria era un dia de un punto). Se descarto cruzar por instante en los dos consumidores porque
  dejaba al Observatorio mostrando las horas de excedentes de Canarias en hora peninsular.
- Consumidores alineados: `pvpc-stats-engine.js` ya no fuerza Madrid para excedentes (antes
  rechazaria el fichero canario por identidad) y los respaldos de reloj de `pvpc-stats-ui.js` y
  `lf-surplus-prices.js` siguen al geo. 5 tests que codificaban la hora peninsular reescritos al
  nuevo contrato, mas 2 de cruce por instante, 1 de rechazo de un fichero canario en hora de Madrid
  y 7 de guardia sobre los datos publicados (`tests/surplus-dataset-clock.test.js`). Mutaciones: los
  datos antiguos, el respaldo Madrid en `lf-surplus-prices.js` y el caso especial del motor tumban
  2, 1 y 5 tests. Suite 2071, lint 0/0, `test_auto_fill.py` y `check_data_freshness.py` en verde.
- Verificado en Chrome real con el sitio servido en local: la curva real tratada como canaria pasa
  de 62,37 a 67,57 EUR, identico al calculo independiente por instante; Peninsula y Ceuta/Melilla
  sin cambios; la bateria de 52 escenarios sigue con las mismas 4 diferencias explicadas; el
  Observatorio carga los excedentes canarios de 2025 (8.760 horas) y de 2026 con el dia en curso
  parcial.
- **Regresion propia detectada al documentar y corregida el mismo dia.** El barrido de consumidores
  no incluyo la vista rapida de la home (`js/index-extra.js`), que forzaba `Europe/Madrid` para los
  excedentes de todas las zonas (`tzOverride` y la clave de `__pvpcBuildQuickViewKey`). Con el dato
  ya en hora canaria, la pestanya Excedentes del modal quedo "Sin datos" en Canarias en produccion
  (build `v20260923-090153`). Corregido: el modal usa el reloj de la zona para los dos tipos.
  Leccion: barrer TODOS los lectores de `/data/surplus` (grep de la ruta en `js/` y `sw.js`), no
  solo los conocidos.
- **Bug previo destapado por esa regresion (corregido):** si la carga de Excedentes fallaba tras
  mostrar el PVPC, el resumen del modal conservaba el precio del PVPC bajo la cabecera de Excedentes
  y la lista se quedaba en "Cargando..." para siempre (se vio en produccion: 0,150 EUR/kWh del PVPC
  como "Excedentes"). `resetModalData()` vacia ahora el resumen y el cambio de tipo muestra el error.
  2 regresiones en `tests/pvpc-modal-type-race.test.js` (Canarias en hora canaria y carga fallida),
  ambas cazadas por mutacion. Verificado en Chrome real con clics: Canarias Excedentes 0,064 EUR/kWh a
  las 10:00 canarias, igual que la Peninsula a las 11:00 (mismo instante).
- **Investigacion DGT del art. 94.9 (encargo al oraculo, verificada).** La consulta vinculante
  V1146-24 (23/05/2024, bateria virtual) dice que la exencion del art. 94.9 solo alcanza a la
  energia compensada en el MISMO periodo de facturacion y que el saldo de BV aplicado en periodos
  posteriores no reduce la base del IEE. Confirma que la web aplique la hucha despues de impuestos.
  No dice nada del minimo de 1 EUR/MWh del art. 99.2: ese punto (ronda 45) sigue abierto.
- **Revision externa de los tres commits (ChatGPT, 23/09/2026): sin regresiones.** Barrio por ruta
  todos los lectores de `/data/surplus` y de 8742, los llamantes de `parsearRespuestaPVPC`, las
  carreras del modal y la fusion del generador. Su unico hallazgo, verificado: `scripts/test_auto_fill.py`
  solo probaba `merge_month_file` en `Europe/Madrid`. Ademas, el paso del workflow que valida los
  datos ANTES de publicarlos no ejecutaba la guardia del reloj, que solo corria despues del push.
  Cerrado: `target_timezone()` en el generador fija el reloj por geo con independencia del
  indicador; 5 pruebas en hora canaria (reloj por geo, agrupacion por dia canario, dias de 23 y 25
  horas, fusion del dia en curso con el siguiente y rechazo de un fichero con otro reloj), dos
  mutaciones cazadas; y `tests/surplus-dataset-clock.test.js` se ejecuta ahora en `pvpc.yml` antes
  del commit de datos. Una ejecucion forzada del workflow con el generador nuevo (run 35843661098)
  reprodujo byte a byte los ficheros de 8742 ya publicados.

**Menores, sin cambio:**
- M1 suma kWh en coma flotante y redondea con `round2`: `19.104999999999997` -> 19,10 cuando la
  suma decimal exacta es 19,105 -> 19,11. 18 diferencias de 0,01 kWh en las curvas reales.
- M2 con consumo cero: la web lo etiqueta `average` (no hay ninguna hora con consumo) y el oraculo
  `exacto`. Termino 0 en ambos.
- M3 del mes en curso: la web solo acepta dias parciales recortados por el final
  (`missing-first-hour` invalida el mes); el prompt decia "pueden estar incompletos" sin precisarlo.

**Criterio de reapertura.** Cualquier cambio en el reloj de `data/surplus` o en el cruce de horas
de `lf-surplus-prices.js`/`pvpc-stats-csv.js`; una curva canaria cuyo valor indexado no coincida
con el cruce por instante.

<a id="pvpc-importes-estructurados-ronda-47-23-09-2026"></a>
### PVPC: Importes Estructurados En Vez De Leer Etiquetas (Ronda 47, 23/09/2026)

Refuerzo de la causa de fondo del bug de la ronda 44. `obtenerPVPC_LOCAL` convertia sus importes
en lineas de texto (`resultadoPVPC`) y `crearTarifaPVPC` los reconstruia leyendo las etiquetas con
`parsearRespuestaPVPC`, y los precios por periodo con una expresion regular sobre la explicacion.
Cualquier etiqueta nueva que contuviera una palabra de otra rama podia volver a clasificarse mal.

- `obtenerPVPC_LOCAL` devuelve ahora `importesFactura`: los MISMOS numeros que imprime en las lineas
  (importes a 2 decimales con el redondeo de cada linea, precios por periodo a 4, `null` si un
  periodo no tiene horas o su media no es positiva, y el rango de fechas).
- `parsearRespuestaPVPC` usa `importesFactura` cuando existe; leer el texto queda como respaldo
  para respuestas sin ese objeto. `crearTarifaPVPC` no cambia. La cache (`pvpc_cache_v3`) guarda la
  tarifa ya construida, no el texto, asi que no le afecta.
- `resultadoPVPC` se conserva: lo consumen tests y es el formato historico del canal.
- Equivalencia: 5 tests comparan campo a campo el camino estructurado con el de texto en
  Peninsula, Canarias vivienda y no vivienda, Ceuta/Melilla y curva CSV exacta, con precios
  distintos por hora; una mutacion (precios sin redondear a 4 decimales) los tumba. La bateria de
  la ronda 44 contra el sitio servido en local da 5.240 filas IDENTICAS a produccion (totales,
  columnas, descuento del bono social y `metaPvpc` completo), y los precios por periodo y el rango
  del PVPC coinciden en cuatro variantes. Suite 2078, lint 0/0.

**Criterio de reapertura.** Un campo nuevo que `crearTarifaPVPC` lea del resultado del parser debe
anadirse a `importesFactura` y al test de equivalencia; si solo existe en el texto, el camino
estructurado lo perderia.

<a id="contratos-de-datos-productor-consumidor-ronda-48-23-09-2026"></a>
### Contratos De Datos Entre Productores Y Consumidores (Ronda 48, 23/09/2026)

Auditoria transversal disparada por el bug de la ronda 46, que era un desacuerdo entre quien
genera `data/surplus` y quien lo lee. Para cada dataset se contrasto lo que declara el fichero con
lo que supone cada lector: zona, reloj, unidades, dias parciales, respaldos y copias en cache.

**Zonas (medido sobre todo el historico, 46.584 horas por geo, comparando por instante):**
- PVPC (1001): Canarias (8742) y Baleares (8743) son identicos a Peninsula (8741). Ceuta (8744) y
  Melilla (8745) son identicos entre si y difieren de Peninsula en 5.416 horas (11,6%), las de su
  horario de periodos desplazado. Excedentes (1739): identicos en las cinco zonas.
- Todos los lectores eligen el mismo geo para cada zona de la web: "Peninsula y Baleares" 8741,
  Canarias 8742, Ceuta/Melilla 8744 (`pvpc.js` y `lf-surplus-prices.js` recurren a 8745 si falta;
  el modal no, sin efecto porque los ficheros son identicos). Usar 8744 para Melilla es correcto.

**Reloj:** cada geo en su hora civil en productor, datos publicados y todos los lectores (ronda 46).
El dia canario en curso llega con 23 horas en PVPC y excedentes; el Observatorio lo trata como
provisional y los demas lectores lo aceptan solo para dias >= hoy.

**Unidades y rangos:** SSAA bien blindado (identidad estricta, rango plausible en el lector, tests
del productor y de los datos publicados). PVPC y excedentes validan identidad (geo, indicador,
unidad, epoch) al leer.

**Unico hueco, CORREGIDO:** `lf-surplus-prices.js`, su copia en `pvpc-stats-csv.js` y el modal de la
home (`index-extra.js`) no exigian el reloj de la zona a los excedentes. Una copia antigua de
`data/surplus/8742` en hora peninsular, servida por el service worker solo cuando falla la red,
se habria aceptado y valorado cada hora canaria con el precio de la anterior (el Observatorio ya la
rechazaba). Ahora los tres exigen `expectedTimeZone` del geo (sin campo `timezone` se asume el del
geo). Regresion en `tests/surplus-prices.test.js`: una copia de 8742 en hora peninsular produce un
hueco, no un precio ajeno; falla con el codigo anterior. Verificado en Chrome real contra el sitio
servido en local: curva canaria 67,57 EUR y peninsular 62,37 EUR sin huecos, modal y Observatorio
sin cambios. Suite 2079, lint 0/0.

**Sin hallazgos:** censo CNMC (auditado en la ronda 40) e indice de guias (sin importes).

**Revision externa de las rondas 47 y 48 (ChatGPT, 23/09/2026): sin regresiones.** Confirmo que
`parsearRespuestaPVPC` solo tiene un llamante funcional, que el calculo fiscal posterior no depende
de los campos fiscales del parser, que ningun 8742 historico declara otro reloj y que el service
worker queda cubierto. Unico apunte, aplicado: los respaldos de reloj de `pvpc-stats-csv.js` y
`lf-surplus-prices.js` comparaban el geo como texto (`=== '8742'`); ahora usan `Number(geo)` como el
resto (sin efecto observable: en el flujo real el geo llega como texto).

**Criterio de reapertura.** Un dataset nuevo o un lector nuevo de `data/`: contrastar zona, reloj y
unidades por instante contra los existentes antes de publicarlo.

<a id="flecos-de-centimos-resueltos-ronda-49-23-09-2026"></a>
### Flecos De Centimos De Las Rondas 45 Y 46, Resueltos (Ronda 49, 23/09/2026)

Los dos redondeos que las rondas 45 y 46 dejaron anotados "sin cambio". Un error conocido no se
deja por pequeno si se puede corregir con la misma verificacion.

**1. Base unica de servicios en IGIC e IPSI.** Contador y cuota BV van al mismo tipo (IGIC 7%, IPSI
4%) y `calcularImpuestoIndirecto` los redondeaba por separado; el IVA ya usaba una sola base.
- `lf-config.js`: `repartirCuotaServicios()` calcula la cuota sobre la base conjunta y la reparte
  para quien la muestre por conceptos (el contador conserva su redondeo; los servicios, el resto).
  Home, desglose y simulador suman los dos campos, asi que todos pasan a la cuota unica.
- `desglose-render.js`: con cuota BV se muestra una sola linea "IGIC/IPSI contador y cuota BV"
  sobre la base conjunta, en vez de dos lineas cuyo importe ya no saldria de su propio porcentaje.
- Tests en `tests/fiscal.test.js` (Canarias 0,83 + 1,65 al 7% -> 0,17; IPSI 0,81 + 1,62 al 4% ->
  0,10; sin cuota BV el contador no cambia). Fallan con el codigo anterior. `fiscal-rounding-align`,
  `bv-fiscal-align`, calculo y desglose en verde. Bateria de la ronda 45 en local: solo cambian 10
  resultados (CEA Estable 24h y 3P, las de cuota BV, en los escenarios de Canarias), que pasan a
  coincidir con el oraculo.

**2. Suma de kWh horarios.** `BVSim.bucketizeByMonth` y el importador de la home
(`lf-csv-import.js`, totales por periodo) sumaban en coma flotante y redondeaban con `round2`:
`19.104999999999997` -> 19,10 (exacto 19,105), y ni siquiera la suma limpia se salvaba, porque
`311.525 * 100 = 31152.499999999996`. Ahora se redondea en millonesimas de kWh con aritmetica entera
(mitad hacia arriba). Tests en `tests/bv-kwh-suma-exacta.test.js` y `tests/csv-import.test.js`
(2,725 -> 2,73 y 311,525 -> 311,53), que fallan con el codigo anterior. Curvas reales de la ronda
46 en local: de 18 diferencias de 0,01 kWh queda 1, en la que acierta la web (Ceuta, P1 de
diciembre: el contador marca 19,815 -> 19,82; el oraculo sumaba los restos de coma flotante de la
curva importada y daba 19,81499...). Bateria sintetica sin cambios.

Suite 2086, lint 0/0.

<a id="minimo-iee-compensacion-revertido-ronda-50-23-09-2026"></a>
### Minimo Del IEE Con Energia Compensada: Cambio Revertido (Ronda 50, 23/09/2026)

**Lo que esta demostrado.** Ley 38/1992 art. 94.9 exime "la energia electrica suministrada que sea
objeto de compensacion con la energia horaria excedentaria", y las instrucciones del modelo 560
(Orden HAC/1433/2024) declaran esa energia en una linea propia ("Exento articulo 94.9 LIE") y calculan
la cuota integra minima sobre la "Cantidad total de energia electrica suministrada o consumida que
sea objeto de liquidacion conforme a lo dispuesto en el apartado 2 del articulo 99". La energia
exenta no deberia entrar en el minimo de 1 EUR/MWh. La web lo aplica sobre todos los kWh de red.

**Lo que NO esta resuelto.** Ninguna norma ni consulta de la DGT fija como se convierte la
compensacion simplificada, que es economica y mensual (RD 244/2019 art. 14), en kWh de suministro
exentos. La V1146-24 solo aclara que la exencion no se traslada a periodos posteriores.

**Cambio probado y revertido el mismo dia.** Se implemento `kwhSujetosMinimoIEE` con kWh exentos =
credito aplicado / precio del excedente (tope: el consumo). Una revision externa (ChatGPT) mostro
que es conceptualmente erroneo: mide el lado del EXCEDENTE, y la exencion es del SUMINISTRO.
Contraejemplo: 300 kWh a 0,20 EUR (60 EUR) y 400 kWh de excedente a 0,05 EUR (20 EUR compensados):
la formula daba los 300 kWh por exentos cuando solo se compensa un tercio del valor. Con excedente
indexado usa la referencia orientativa de 0,020 EUR/kWh, que no puede decidir un dato fiscal; en la
bateria de la ronda 44 el escenario S35 bajaba 1,42 EUR. Se restauraron los cinco ficheros al estado
de `fe03dc7`; la bateria de la ronda 44 en local vuelve a coincidir con produccion salvo las 6 filas
de la base unica de IGIC (ronda 49).

**Incidente de proceso.** El cambio estaba a medio verificar en el arbol de trabajo cuando el usuario
relanzo el `.bat` de despliegue para otro arreglo; el `.bat` hace `git add -A` y lo publico en
`e82eaa5` sin sus tests. No se debe dejar trabajo en curso en el arbol del repo mientras pueda
correr un despliegue.

**Estado.** Se mantiene el minimo sobre todos los kWh de red: puede sobrestimar el IEE en meses con
mucha compensacion y base pequena, y es la opcion que no inventa una regla. Se reabre solo con una
fuente que fije la conversion (consulta DGT o factura real con el desglose de la cantidad exenta).

**Investigacion de fuentes primarias (23/09/2026, tras la reversion).** Se separan las dos preguntas:

1. *La energia exenta del 94.9, lleva minimo?* **No. Resuelto con fuente oficial.** Instrucciones del
   modelo 560 en la Orden HAC/172/2021 (BOE-A-2021-3101), redaccion de la Orden HAC/1433/2024
   (BOE-A-2024-26485, periodos desde 01/01/2025). En el cuadro "Desglose de cuotas y cantidades
   declaradas", fila propia "Exento articulo 94.9 LIE", la columna "Cuota integra minima (10)" dice
   literalmente: "Este dato debe cumplimentarse con el importe autoliquidado. Por consiguiente, no
   debe cumplimentarse por los suministros o consumos exentos ni por los que se hayan autoliquidado
   por el importe de cuota integra". La casilla (4) "Cantidad" del cuadro de liquidacion es la
   "que sea objeto de liquidacion conforme a lo dispuesto en el apartado 2 del articulo 99". Las
   instrucciones forales de Bizkaia (560CastInst.pdf) repiten el mismo texto. Es una orden
   ministerial publicada en el BOE, no una consulta vinculante, pero no deja margen: el minimo de 1
   EUR/MWh se aplica solo sobre los kWh NO exentos.
2. *Cuantos kWh de una factura son "objeto de compensacion"?* **Sin respuesta en ninguna fuente.**
   Revisado sin resultado:
   - RD 244/2019 art. 14.3 (BOE-A-2019-5089): la compensacion es "un saldo en terminos economicos
     de la energia consumida en el periodo de facturacion". Valora la energia en euros y no define
     kWh compensados.
   - Reglamento de los Impuestos Especiales (RD 1165/1995, BOE-A-1995-16761): no desarrolla el 94.9.
   - Modelo de factura de la COR (Resolucion DGPEM 28/04/2021, BOE-A-2021-7120): una sola linea
     "Impuesto de la electricidad", sin regla para el autoconsumo.
   - Consultas de la DGT: V1146-24 (el 94.9 no pasa a periodos posteriores); V0878-25 (quien
     controla el minimo si distribuidor y comercializador no coinciden); V1187-20, V1328-20,
     V1629-20, V3003-20, V3006-20 y V3922-20, todas anteriores a la entrada en vigor del 94.9
     (01/01/2021) o limitadas a "sujeta y exenta".
   - Preguntas frecuentes de la AEAT sobre exenciones del IEE: solo inscripcion registral.
   - Guias de IDAE y CNMC y blogs de comercializadoras (EDP, Som Energia): nada sobre el IEE.
   - Articulos de despacho (Bird & Bird, Mendo, Lopez-Ibor): citan el 94.9 sin cuantificarlo.

   Cada comercializadora puede usar un criterio distinto: minimo horario entre consumo y
   excedente, total mensual, parte proporcional al importe compensado... Ninguna lo publica. Una
   factura en Scribd (Geoatlanter) aplicaba el minimo sobre 0,15 MWh con unos 378 kWh de consumo y
   235 de excedente, pero no se pudo verificar ni sirve como regla.

**Decision (23/09/2026).** Se mantiene el minimo sobre todos los kWh de red. La pregunta 1 daria la
razon a excluir la energia exenta, pero aplicarla exige elegir una conversion de la pregunta 2, y
esa regla seria de LuzFija, no de la norma. Magnitud acotada:
- Solo cambia algo cuando el 5,11269632% de la base queda por debajo de 0,001 EUR x kWh, es
  decir, cuando la compensacion vacia el termino de energia y la potencia es baja.
- La sobrestimacion maxima es 0,001 EUR por kWh exento. Ejemplo: base 4,00 EUR (0,20 EUR por
  porcentaje) con 300 kWh de red da 0,30 EUR en la web, frente a 0,20-0,30 EUR segun la
  conversion, es decir, como mucho 0,10 EUR al mes.
- El error, si existe, es conservador: la web nunca infravalora el IEE.

**No reportar como bug** "el minimo del IEE deberia excluir la energia compensada" salvo que se
aporte la regla de conversion con fuente primaria: consulta DGT, orden o factura real con la
cantidad exenta desglosada y su criterio. La mera cita del 94.9 o del modelo 560 ya esta evaluada
aqui.

<a id="pagina-404-y-urls-antiguas-ronda-52-24-09-2026"></a>
### Pagina 404 Y URLs Antiguas (Ronda 52, 24/09/2026)

**Origen.** Primera auditoria de la 404 y de las URLs antiguas como area. El historial de git
esta aplastado desde el 19/09/2026, asi que no hay registro de que URLs existieron.

**Verificado sin hallazgos (produccion, curl).** Una URL inexistente devuelve un 404 real en
cualquier profundidad (`/no-existe`, `/guias/no/existe/profundo`); las variantes sin `.html` y sin
barra final llegan a su pagina (`/estadisticas` -> 301 a `/estadisticas/`); `/Guias.html` da 404
(Pages distingue mayusculas); los alias del simulador (`/simulador/`,
`/simulador-bateria-virtual.html`) redirigen con `noindex`. `404.html` solo usa rutas absolutas,
asi que se pinta bien servida en cualquier profundidad. El service worker conserva los 404/410
reales (ya auditado).

**Hallazgo: los enlaces rotos no eran medibles.** Pages sirve `404.html` en la URL pedida, pero el
pageview usa el canonical y toda 404 se contaba como `/404.html`. Enviar la ruta literal chocaba
con la politica de no mandar texto libre. CORREGIDO con `js/not-found.js`: busca en
`/sitemap.xml` la pagina existente mas parecida (slug exacto, distancia de edicion, solape de
palabras y, para rutas cortas, palabras contenidas en UNA sola pagina), envia
`pagina-404/<seccion>/<pagina>` o `pagina-404/desconocida` y muestra "Buscabas ...?" con el
titulo real de la pagina. Rutas genericas que encajan en varias (`/tarifas`, `/pvpc`, `/factura`,
`/comparador`) no sugieren nada a proposito. Verificado en Chrome real con un servidor que imita
Pages (status 404, sin errores JS, sin scroll horizontal en movil, enlace legible en ambos temas).
26 tests en `tests/not-found.test.js`, validados por mutacion (ambiguedad, privacidad del detalle,
palabras de la home y stopwords `guia`/`guias`).

**Copy de la 404 (mismo dia).** El "Sabias que..." afirmaba que el 404 viene de una habitacion
del CERN (mito que el propio CERN desmiente), que el PVPC "se actualiza cada hora" (se publica la
vispera, hacia las 20:15) y cifras sin fuente ("hasta un 50 %", "hasta un 70 % en verano", "mas de
350 comercializadoras"). Sustituido por datos que las guias ya verifican (horarios de P1/P3, CUPS,
IGIC/IPSI, tope de la compensacion simplificada, publicacion del PVPC); el texto inicial
"Cargar..." pasa a ser un dato real para quien no ejecute JavaScript. Lo vigila
`tests/not-found.test.js`.

**Revision externa del 24/09/2026 (ChatGPT con acceso al repo, sin ejecucion: lo declaro).**
Veredicto: ningun bug funcional ni de privacidad en los 7 commits del dia. Dos observaciones de
copy, verificadas y CORREGIDAS: el dato de la 404 "los fines de semana todo es P3" omitia el 6 de
enero y los festivos nacionales de fecha fija no sustituibles (la guia de P1/P2/P3 ya lo decia),
y la guia de P1/P2/P3 conservaba un "hasta un 50 % mas que por la noche" sin fuente (y corto: en
una 3P tipica la punta dobla el valle). Al barrer la afirmacion aparecio otra cifra sin fuente
("el consumo fantasma puede suponer hasta un 10 % de tu factura anual"), reformulada sin numero.
La cifra "hasta un 25 %" de Auto+ se conserva: es del RD 609/2026. Tercera observacion: jsdom
30.1.1 (22/09) ya existia; actualizado con npm 10 y suite completa en verde.

**Segunda revision externa (mismo dia, sobre 79603a2).** Confirmo sin hallazgo: la frase de P3
frente a la Circular 3/2020; "la punta es la franja mas cara" en las 52 tarifas 3P de
`tarifas.json` (ninguna con `cPunta` menor que llano o valle); el churn del lockfile (metadatos
`libc` que npm 10 no escribe) y las fechas. CORREGIDO: el pie del consumo fantasma que escribi en
79603a2 era demasiado absoluto ("todas las horas", "nunca baja"); en aerotermia, "ahorras 20-30
EUR/mes" y "burletes: cuesta 50 EUR y ahorra 15-20 EUR/mes" sin condicion ni calculo; los rangos de
servicios extra se rotulan como orientativos. NO se toca "400-800 EUR/ano" de placas: ya se
presenta como orden de magnitud, condicionado y con fecha.

**Para reabrir:** demostrar un detalle de evento que no sea una pagina del sitemap ni una de las
palabras fijas, o una sugerencia equivocada para una ruta real que llegue a produccion.

<a id="taxonomia-analitica-documentada-24-09-2026"></a>
### Taxonomia De Analitica Frente A Su Documentacion (24/09/2026)

**Origen.** Pregunta del usuario tras las rondas 51 y 52: si los cambios de analitica estaban
controlados. `vendor/goatcounter/` y `js/tracking.js` no se tocaron en esas rondas (verificado
con `git log`); los unicos cambios fueron dos emisores sobre la API existente (`guias-busqueda`,
que solo cambia de momento de envio, y `pagina-404`, nuevo), ambos documentados.

**Hallazgo.** No habia ningun test que atara el codigo a `ANALITICA-GOATCOUNTER.md`, y 7 bases
emitidas desde `tracking.js` no aparecian en la doc. Seis son legitimas y de valores cerrados
(`comparador-vivienda-canarias`, `simulador-solar-vivienda-canarias`, `csv-opcion`,
`modal-info-abierto`, `pvpc-modal-abierto`, `pvpc-modal-tipo`): documentadas. La septima,
`csv-exportado`, era codigo muerto: escuchaba `#btnExport`, un boton retirado que no existe en
ninguna pagina (el propio `cleanup-regression` ya lo vigilaba en `lf-state.js`). Retirado el
listener y extendida esa regresion a `tracking.js`.

**Guard nuevo.** `tests/tracking-taxonomy-docs.test.js` recorre `js/` y los HTML y exige que toda
base emitida con nombre literal aparezca en la doc como `base` o `base/...`. Los envoltorios cuyo
primer argumento es un detalle (`trackStatsInitIncomplete`, `trackErrorRecurrence`) se excluyen
por nombre y sus bases reales se comprueban aparte. Validado por mutacion: borrar `pagina-404` de
la doc o reintroducir el listener muerto rompe el test correspondiente.

<a id="escaneo-wcag-axe-ronda-53-24-09-2026"></a>
### Escaneo WCAG Automatico Con axe-core (Ronda 53, 24/09/2026)

**Origen.** La accesibilidad figuraba como auditoria parcial: nunca se habia pasado un escaner
estandar por todo el sitio. axe-core 4.13 en Chrome real sobre las 32 paginas HTML del sitemap mas
la 404, en movil (390 px) y escritorio (1366 px) y en tema claro y oscuro: 132 escaneos, reglas
WCAG 2.0/2.1/2.2 A y AA mas best-practice. Servidor local que imita Pages y GoatCounter bloqueado.

**Limpio desde el principio:** cero fallos de contraste, nombres accesibles, etiquetas de
formulario, ARIA invalido, idioma o titulos en las 132 combinaciones.

**Cinco reglas, todas CORREGIDAS (escaneo final: cero violaciones):**
- `target-size` (unico criterio WCAG, 2.5.8 AA): los dos enlaces sueltos del pie del simulador
  solar median 17 px de alto. La home ya tenia `padding-block:4px` en ese enlace (25 px); el
  arreglo no se habia llevado al simulador. Ahora 25 px en ambos.
- `heading-order`: en el simulador los `h2` del contenido estan ocultos al cargar y el pie
  saltaba de `h1` a `h3`. Los titulos de columna del pie son `h2` en home y simulador; la clase
  `.u-h3-strong-10` fija el estilo y se midio en Chrome que el estilo calculado es identico.
- `empty-table-header`: la esquina de las tablas comparativas de dos guias era `<th></th>`. axe no
  acepta `aria-label` en su lugar (probado); pasa a `<th>Aspecto</th>`, que rotula la columna de
  aspectos comparados y conserva el fondo de cabecera.
- `landmark-unique`: las 25 guias tenian dos `<nav>` sin nombre. Ahora `Ruta de navegacion` y
  `Navegacion entre guias`.
- `region`: la cabecera de home, simulador y Observatorio quedaba fuera de cualquier landmark.
  `role="banner"` en `.topbar` (atributo, sin efecto en el CSS; cajas medidas iguales).

**Fechas SEO.** La sincronizacion habria sellado como actualizadas 25 guias y las 3 aplicaciones
por cambios que no cambian el texto. `maskVolatileSeoChanges` ignora ahora `aria-label`, `role` y
el nivel de un encabezado cuyo texto no cambia; un texto nuevo sigue sellando fecha. Solo cambian
de fecha las dos guias con el rotulo visible nuevo y el simulador (sus enlaces crecen 8 px).

**Vigilancia.** `tests/a11y-axe-regressions.test.js` (estatico, validado por mutacion) y los casos
nuevos de `tests/seo-date-logic.test.js`. No sustituye al escaneo: repetirlo al anadir paginas o
componentes. Sigue sin haberse probado con un lector de pantalla real ni con zoom al 400 %.
