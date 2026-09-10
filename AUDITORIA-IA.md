# Guia Para Auditorias IA De LuzFija.es

Ultima actualizacion: 2026-09-10

Este documento existe para reducir falsos positivos en auditorias repetidas. No sustituye a
`AGENTS.md` ni a `CAPACIDADES-WEB.md`; los complementa con criterios de clasificacion.

Esta organizado por AREAS, no por fechas. Resume la cobertura ya auditada y enlaza un directorio
generado de decisiones vigentes, falsos positivos conocidos y bugs ya corregidos. La evidencia y
el detalle que permiten reabrir cada entrada viven en `AUDITORIA-REGISTRO.md`. Si vas a auditar,
lee primero `Metodo De Verificacion Exigido` y `Areas Ya Auditadas Y Su Estado` para saber que
terreno esta ya cubierto y con que criterio.

## Lectura Obligatoria Antes De Auditar

Este fichero se lee COMPLETO: metodo, taxonomia, tabla de areas e indice del registro.
`AUDITORIA-REGISTRO.md` NO se lee de forma lineal: se consulta por el area que estes
auditando, siguiendo el enlace desde la tabla de areas o desde el indice.

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
- **Falso positivo documentado**: aparece en `AGENTS.md` o en el area correspondiente de `AUDITORIA-REGISTRO.md` como decision de implementacion.

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
 `js/factura.js` debe pasar todas las facturas disponibles en el banco local —14 a 02/09/2026—
 por la interfaz real comparando candidato contra produccion. Se espera identidad funcional en
 todas salvo el caso que se pretende arreglar. No fijes el gate para siempre en 14: si crece el
 banco, la obligacion crece con el.
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
decision esta en el registro enlazado desde la ultima columna y desde el indice posterior.

| Area | Estado | Donde mirar antes de reportar |
|---|---|---|
| Extractor de factura PDF (texto) | Auditada a fondo y endurecida. Separacion dimensional kW/kWh/EUR/dias, lecturas de contador, maximas demandadas y asociaciones cruzadas al compactar lineas | Extractor De Factura PDF: [Consumos enteros del QR](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-consumos-enteros-del-qr-cnmc), [Lecturas de contador](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-lecturas-de-contador-frente-a-consumo-factura), [Potencia contratada](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-potencia-contratada-frente-a-maximas-demandad), [Separacion dimensional](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-separacion-dimensional-kw-kwh-eur-dias) |
| Compatibilidad PDF.js / WebKit / iPhone | Regresion resuelta el 02/09/2026. Build `legacy`, shims en core y worker, lectura por `getReader()` y watchdog visible; validada con WebKit, las 14 facturas locales y un iPhone real. El mecanismo exacto del spinner original no se dio por demostrado | [Compatibilidad WebKit/iPhone Del Lector PDF](AUDITORIA-REGISTRO.md#compatibilidad-webkit-iphone-del-lector-pdf-resuelta-02-09-2026) |
| QR CNMC | Auditado. Confianza, validacion de host/ruta/unidades, claves case-insensitive, fechas imposibles y PDF multi-factura | [QR CNMC: Confianza, Validacion Y PDF Multi-Factura](AUDITORIA-REGISTRO.md#qr-cnmc-confianza-validacion-y-pdf-multi-factura) |
| Dominio 2.0TD y peajes | Auditado. Bloqueo fail-closed de 3.0TD/6.xTD con deteccion de auto-declaracion | [Peajes Fuera De 2.0TD](AUDITORIA-REGISTRO.md#peajes-fuera-de-2-0td) |
| Importador CSV/XLSX | Auditado. Alias de cabecera, generacion frente a exportacion, duplicados, cambios de hora | [CSV: Generacion Frente A Exportacion](AUDITORIA-REGISTRO.md#csv-generacion-frente-a-exportacion), [Duplicados En CSV/XLSX Rechazados (RESUELTA)](AUDITORIA-REGISTRO.md#duplicados-en-csv-xlsx-rechazados-resuelta) |
| Observatorio PVPC (`/estadisticas/`) | Auditado. Ausencia de datos frente a cero, cobertura parcial, carrera de render | [Observatorio: Ausencia De Datos Frente A Cero](AUDITORIA-REGISTRO.md#observatorio-ausencia-de-datos-frente-a-cero) |
| Simulador solar / bateria virtual | Auditado. Motor economico cerrado (rotacion, ranking, topes y saldo) y UI auditada en estado, validaciones, ciclos de vida, importaciones y renderizado | [Simulador Solar: Rotacion Del Patron Anual Y Ranking](AUDITORIA-REGISTRO.md#simulador-solar-rotacion-del-patron-anual-y-ranking), [UI Del Simulador Solar: Estado, Ciclos De Vida Y Renderizado](AUDITORIA-REGISTRO.md#ui-del-simulador-solar-estado-ciclos-de-vida-y-renderizado-resuelta-20) |
| Motor economico y fiscalidad | Auditado a fondo. Orden de operaciones, bono social, fiscalidad por zona, paridad entre home/BV/desglose y fronteras de redondeo IEEE-754 | [Fiscalidad Y Bono Social](AUDITORIA-REGISTRO.md#fiscalidad-y-bono-social), [Redondeo Exacto De Impuestos Indirectos Y Paridad Entre Motores (RESUELTA 16/08/2026)](AUDITORIA-REGISTRO.md#redondeo-exacto-de-impuestos-indirectos-y-paridad-entre-motores-resuel), `ARQUITECTURA-CALCULOS.md` |
| Arranque, carga parcial y service worker | Auditado. Watchdog, telemetria, recarga automatica | [Cargas Parciales, Watchdog Y Telemetria De QA](AUDITORIA-REGISTRO.md#cargas-parciales-watchdog-y-telemetria-de-qa) |
| UI base y modulos auxiliares (`aecc-banner`, `shell-lite`, `theme`, `error-bootstrap`, `lf-sw-update`) | Auditada. Propiedad de listeners, timers de banner, clasificacion de recursos opcionales y recuperacion del registro SW | [Zonas Huerfanas: Banner AECC, Shell Lite Y Registro Del SW](AUDITORIA-REGISTRO.md#zonas-huerfanas-banner-aecc-shell-lite-y-registro-del-sw-resuelta-20-0) |
| Privacidad y analitica | Auditada la privacidad (taxonomia y datos que nunca se envian) y, en la ronda 11, la CORRECCION y ROBUSTEZ de la capa: autorreporte CSP, ciclo de vida del outbox, listeners/timers y el sender vendorizado | `ANALITICA-GOATCOUNTER.md`, [Autorreporte De Violaciones CSP Del Endpoint Analitico](AUDITORIA-REGISTRO.md#autorreporte-de-violaciones-csp-del-endpoint-analitico-resuelta-25-08), [Entrega Del Outbox De Diagnosticos: Al Menos Una Vez (DELIBERADO)](AUDITORIA-REGISTRO.md#entrega-del-outbox-de-diagnosticos-al-menos-una-vez-deliberado) |
| Accesibilidad transversal | **Auditoria parcial** (27/08/2026). Verificados: anuncio de resultados, `aria-sort`, `aria-expanded`, foco y trampa de tabulacion en modales, validacion, y barrido estatico de las 36 paginas. NO es una evaluacion WCAG completa | [Accesibilidad: Lo Auditado Y Que Salio Bien](AUDITORIA-REGISTRO.md#accesibilidad-lo-auditado-y-que-salio-bien-parcial-27-08-2026), [`animateCounter` Sobre Una Etiqueta, No Un Numero (RESUELTA 27/08/2026)](AUDITORIA-REGISTRO.md#animatecounter-sobre-una-etiqueta-no-un-numero-resuelta-27-08-2026) |
| Accesibilidad funcional y responsive (Ronda 18) | Auditada de forma práctica sobre los defectos reproducidos en teclado, foco, semántica dinámica y contraste. Corregidos retorno de foco al compartir, validación ARIA solar, selector/estados del Observatorio, copia accesible en 25 guías y contraste editorial/buscador. NO equivale a conformidad WCAG completa ni a prueba con lector de pantalla real | [Accesibilidad Funcional Y Responsive (Ronda 18)](AUDITORIA-REGISTRO.md#accesibilidad-funcional-y-responsive-ronda-18-28-08-2026) |
| Foco y colores forzados (Ronda 19) | Auditados a partir de repros con teclado, zoom real y `forced-colors`. Corregidos foco visible de las tarjetas de guías y estado/legibilidad del selector y gráficos del Observatorio. La ausencia de compartir en la barra lateral estrecha sigue siendo una decisión responsive deliberada | [Foco Y Colores Forzados (Ronda 19)](AUDITORIA-REGISTRO.md#foco-y-colores-forzados-ronda-19-28-08-2026) |
| Contratos numericos por procedencia | Auditado en ronda 15 (27/08/2026). Contratos diferenciados para UI, CSV/XLSX y PDF/OCR; cero bugs con impacto demostrado | [Contratos Numericos Por Procedencia](AUDITORIA-REGISTRO.md#contratos-numericos-por-procedencia-ronda-15-27-08-2026) |
| Ciclo de vida de recursos y temas dinamicos | Auditado en ronda 16 (28/08/2026). Repeticion de calculos, modales, filtros y rankings; matriz visual/funcional de 3 aplicaciones x 2 viewports x 2 temas. Corregidos un temporizador obsoleto y dos defectos del grafico PVPC en movil/tema dinamico | [Ciclo De Vida De Recursos Y Temas Dinamicos](AUDITORIA-REGISTRO.md#ciclo-de-vida-de-recursos-y-temas-dinamicos-ronda-16-28-08-2026) |
| Fronteras de renderizado y datos | Auditado en ronda 17 (28/08/2026). PDF/OCR/QR, CSV/XLSX, URL, almacenamiento, catalogos y enlaces externos hasta sus sinks DOM. Cero bugs con impacto demostrado en el modelo de amenaza actual | [Fronteras De Renderizado Y Datos](AUDITORIA-REGISTRO.md#fronteras-de-renderizado-y-datos-ronda-17-28-08-2026) |
| SEO, datos estructurados y CWV | Auditado | [SEO, Datos Estructurados Y Core Web Vitals](AUDITORIA-REGISTRO.md#seo-datos-estructurados-y-core-web-vitals) |
| Vigencia de documentacion y guias (09/09/2026) | Segunda pasada, ronda 34, disparada por los cinco cambios funcionales del mismo dia. 14 docs, 25 guias y el copy verificable de producto. 4 correcciones de copy y fecha, cero funcionales: la calculadora prometia "tu factura real completa", dos guias decian "desglose exacto" y la cabecera del registro iba atrasada. RECHAZADO anhadir al `FAQPage` preguntas visibles fuera del bloque FAQ: el riesgo es marcado invisible, no lo contrario, y duplicaba una entrada. Fiscalidad, bono social, RD 88/2026 y Auto+ verificados vigentes | [Vigencia De Documentacion Y Guias](AUDITORIA-REGISTRO.md#vigencia-docs-y-guias-ronda-34-09-09-2026) |
| Documentacion y vigencia editorial | Auditado 27/08/2026: 10 docs manuales, 7 generados y 25 guias. Corregidos la guia de factura (no reflejaba el import de precios QR a `Mi tarifa`) y 4 fechas de actualizacion desfasadas | [Documentacion Y Vigencia Editorial](AUDITORIA-REGISTRO.md#documentacion-y-vigencia-editorial) |
| Paginas legales (privacidad y aviso legal) | Auditado 27/08/2026, primera vez. Contrastadas todas las afirmaciones contra el codigo. Corregidos: fuente del PVPC (era CNMC, es ESIOS/REE), precios del QR no declarados, alcance del catalogo y fechas | [Paginas Legales Frente Al Comportamiento Real](AUDITORIA-REGISTRO.md#paginas-legales-frente-al-comportamiento-real) |
| Rotulacion de la UI frente al motor | Auditada 05/09/2026 (ronda 20), primera vez. Unidades, magnitudes, placeholders, tooltips, leyendas de tabla y mensajes de estado de las paginas de producto contrastados contra la capa de calculo. Un hallazgo: la columna del ranking rotulada Impuestos agrega conceptos no fiscales | [Rotulacion De La Columna Impuestos Frente Al Motor](AUDITORIA-REGISTRO.md#rotulacion-columna-impuestos-frente-al-motor-resuelta-05-09-2026) |
| Reproducibilidad de enlaces y backups | Auditada 05/09/2026 (ronda 21), primera vez. Contrato serializador/deserializador de enlaces compartidos y backups del simulador solar, y migracion entre versiones de payload/localStorage. Cero hallazgos confirmados; el unico propuesto (perdida de datos en payload version 1) se rechazo por falta de evidencia de que ese formato haya existido nunca | [Reproducibilidad De Enlaces Compartidos Y Backups](AUDITORIA-REGISTRO.md#reproducibilidad-de-enlaces-y-backups-ronda-21-05-09-2026) |
| Mensajes de fallo y cobertura parcial | Auditada 05/09/2026 (ronda 22), primera vez. Texto y estado visual ante fallos de red, timeouts y datos parciales en home, Observatorio, modal PVPC y simulador solar, contrastados contra la causa real capturada en el codigo. 3 hallazgos, los tres CORREGIDOS el 05/09/2026 con regresiones validadas por mutacion: mensaje "Error conexion" para fallos no relacionados con conectividad, comparativa historica sin aviso de anhos con cobertura parcial, y fallo de red indistinguible de "manhana no publicado todavia" | [Mensajes De Fallo Y Cobertura Parcial Frente A La Causa Real](AUDITORIA-REGISTRO.md#mensajes-de-fallo-y-parcialidad-ronda-22-05-09-2026) |
| Paridad de "Mi tarifa" entre productores | Auditada 05/09/2026 (ronda 23), primera vez. Tabla de paridad propiedad a propiedad de los tres productores del objeto (home, desglose y simulador solar). 2 hallazgos CORREGIDOS con regresiones validadas por mutacion: P1=0 aceptado solo por el simulador, y energia 0/0/0 aceptada solo por la home (coronaba el ranking). La invariante fv.bv de la ronda 20 sigue intacta en los tres | [Paridad De "Mi Tarifa" Entre Sus Tres Productores](AUDITORIA-REGISTRO.md#mi-tarifa-paridad-entre-productores-ronda-23-05-09-2026) |
| Catalogo `tarifas.json` frente al motor | Auditada 06/09/2026 (ronda 24), primera vez. Los 9 campos del esquema que mueven importe, orden o exclusion, contrastados celda a celda contra las cinco rutas que los consumen. Cero bugs observables: las 118 filas publicadas son coherentes. Un cambio, clasificado como alineacion defensiva y no como bug: el motor mensual solar no consultaba `fv.tipo` y derivaba la compensacion solo de `fv.exc`. Rechazado en firme endurecer `esTarifaUtilizable()` con campos opcionales: la validacion es ATOMICA y eso convertiria una errata del generador en la web sin ranking | [El Catalogo `tarifas.json` Frente Al Motor](AUDITORIA-REGISTRO.md#catalogo-frente-al-motor-ronda-24-06-09-2026) |
| Dataset vivo -> importe (PVPC y excedentes indexados) | Auditada 07/09/2026 (ronda 25), primera vez. `js/pvpc.js` y `js/lf-surplus-prices.js` y sus cinco consumidores: cobertura parcial, referencia de 0,020 EUR/kWh, zona y reloj, firma de cache, datasets degradados y kWh sin valorar. **Cero hallazgos y cero cambios**. Rechazadas dos propuestas: quitar el ancla diaria de la clave de cache (la rompe la ventana de correccion de seis meses del workflow PVPC) y cambiar el rotulo del EUR/kWh medio | [De Un Dataset Vivo A Un Importe](AUDITORIA-REGISTRO.md#dataset-vivo-a-importe-ronda-25-07-09-2026) |
| Capa comun frente a sus copias locales | Auditada 08/09/2026 (ronda 26), primera vez. Fallbacks ternarios, helpers duplicados y guards que degradan a no-hacer-nada, cruzados con los `<script src>` de cada pagina. 3 riesgos reales CORREGIDOS: sin `lf-config.js` el simulador solar seguia calculando con IEE e impuesto indirecto a 0 (17,81 -> 14,04 EUR), sin `lf-ssaa.js` SSAA desaparecia (20,85 -> 17,81 EUR) y el fallback del Observatorio perdia el redondeo monetario (8,08 -> 8,07 EUR). Ambos proveedores son ya dependencia dura del gate de `bv-ui.js`. NO los anadas a `requiredSimulation`: esa lista se indexa contra `window.BVSim` y mataria el simulador para todos. Los dos hardening (`parseNum` de desglose y los `round2` sin EPSILON) siguen sin ruta de activacion demostrada | [La Capa Comun Frente A Sus Copias Locales](AUDITORIA-REGISTRO.md#capa-comun-frente-a-copias-locales-ronda-26-08-09-2026) |
| Orden y puesto del ranking de la home | Auditada 08/09/2026 (ronda 27), primera vez. Todos los puntos que deciden orden, posicion y pertenencia de una fila, cruzados entre si. 2 bugs CORREGIDOS mas uno encontrado al verificar: el numero pintado era el indice de la vista y no `posicion` (con Total descendente la mas cara lucia `#1` junto a su `+45,95 EUR`), el empate absoluto lo resolvia el orden de `tarifas.json` (hay tres grupos identicos en el catalogo publicado) y las medallas oro/plata/bronce salian de `tr:nth-child(1..3)`. Descartados como falsos positivos la tolerancia `< 0.01` del comparador (todo `totalNum` pasa por `round2`), que `Vs mejor` no se recalcule al filtrar y que el Top 5 del grafico ignore filtro y orden | [El Puesto Del Ranking Frente Al Orden De La Vista](AUDITORIA-REGISTRO.md#puesto-del-ranking-ronda-27-08-09-2026) |
| Cifras del Observatorio (`/estadisticas/`) | Auditada 09/09/2026 (ronda 28), primera vez. Que promedia cada numero publicado y si su rotulo lo describe: medias diarias frente a horarias, ventanas de 7/30 dias, media movil de 12 meses, interanual, percentiles y bloques horarios. Cero bugs aritmeticos. 2 hallazgos CORREGIDOS: el subtitulo del perfil horario decia "del anho" con un mes seleccionado, y la comparativa interanual media el mes en otra unidad que la tendencia (7 de 640 casos del repositorio se veian distintos a tres decimales). No re-reportes que las ventanas horarias no cruzan medianoche ni que los percentiles/heatmap/dia de la semana esten "mal": no publican cifra alguna | [Las Cifras Del Observatorio](AUDITORIA-REGISTRO.md#cifras-del-observatorio-ronda-28-09-09-2026) |
| Importador CSV: del fichero a P1/P2/P3 | Auditada 09/09/2026 (ronda 29), como AREA de correccion. Cabecera y preambulo, mapeo, unidades, base horaria, periodos, agregacion y coherencia con la curva, contrastados contra los seis ficheros reales de `tests/fixtures/`. Cero bugs observables. Un cambio de ALINEACION DEFENSIVA: la unidad de `EHCR`/`EHEX` (kWh por contrato UFD) la decidia el heuristico de magnitud de `detectUnitFactor`, que para esas dos cabeceras solo podia equivocarse. El disparador exige >100 kWh en una hora, imposible en 2.0TD (maximo medido en el fixture real: 3,56 kWh), asi que NO es un importe falso. Rechazado mover el redondeo por mes de Datadis mensual | [De Un Fichero De Distribuidora A P1/P2/P3](AUDITORIA-REGISTRO.md#csv-a-p1-p2-p3-ronda-29-09-09-2026) |
| Ciclo de vida de la curva CSV importada | Auditada 09/09/2026 (ronda 30), primera vez. Nacimiento, invalidacion y adaptacion de `consumosHorarios` + `csvConsumosRef` + `pvpcPeriodoCSV` frente a sus tres puntos de invalidacion y a `pvpc.js`. **Cero hallazgos y cero cambios.** Verificado con la curva real de 7344 horas: la reclasificacion de zona cambia la atribucion P1/P2/P3 pero no la energia (1785,659 kWh en las tres zonas). NO propongas unificar los fallbacks en linea de `clearCsvImportState`: sostienen la invalidacion cuando el helper no ha cargado. Conservar una curva SIN dia DST al cruzar a Canarias es decision documentada | [El Ciclo De Vida De La Curva Importada](AUDITORIA-REGISTRO.md#ciclo-de-vida-curva-importada-ronda-30-09-09-2026) |
| Desglose de factura frente a la fila | Auditada 09/09/2026 (ronda 31), primera vez como area. Las cuatro piezas del desglose contra `lf-calc.js`/`lf-render.js`: `totalRanking` frente al total de la fila, correspondencia concepto a columna, suma de lo impreso, lo que el desglose deriva por su cuenta y las ramas PVPC y libre. **Cero hallazgos.** 576 comparaciones sobre las 119 tarifas publicadas con diferencia maxima 0,00 EUR, mas 5 filas abiertas en Chrome real (dos zonas, dos temas, dos viewports) con coincidencia al centimo. En BV conviven a proposito el coste de ranking y lo que se paga: no los compares entre si. NO retires `reconcileToTarget()` ni sumes literalmente todos los importes del modal | [El Desglose Frente A La Fila](AUDITORIA-REGISTRO.md#desglose-frente-a-la-fila-ronda-31-09-09-2026) |
| Combinatoria de opciones de la home | Auditada 09/09/2026 (ronda 32), primera vez. Que pasa cuando se cruzan vivienda canaria, solar, excedentes, saldo BV y bono social, y sobre todo que valores siguen contando con su bloque oculto. **Cero hallazgos.** Valor oculto no es valor activo oculto: cada economia comprueba su bandera y el control se hace visible en el mismo paso en que empieza a mover el importe (verificado en Chrome real, viaje completo Peninsula-Canarias-Peninsula). Perder una opcion marcada despues del ultimo calculo al recargar es coherente con el contrato de cambios pendientes, no un bug | [Las Opciones De La Home Cruzadas Entre Si](AUDITORIA-REGISTRO.md#opciones-de-la-home-cruzadas-ronda-32-09-09-2026) |
| "Mi tarifa" como formulario | Auditada 09/09/2026 (ronda 33), primera vez como area. Validacion, ciclo guardar/cargar/limpiar de `lf_custom_tarifa`, precios importados del QR, visibilidad y avisos. 1 bug CORREGIDO: un autoguardado pendiente resucitaba la tarifa recien borrada con los campos vacios y devolvia el indicador de datos guardados. Los temporizadores en vuelo se cancelan ahora antes de borrar; NO quites el debounce, su garantia es no escribir en cada pulsacion. Validacion, carga legacy e importacion desde el QR salieron limpias | ["Mi Tarifa" Como Formulario](AUDITORIA-REGISTRO.md#mi-tarifa-como-formulario-ronda-33-09-09-2026) |
| Vista rapida de PVPC y estado local compartido | Auditada 10/09/2026 (ronda 35), primera vez. El estado compartido entre dos pestanas (inputs, "Mi tarifa", cache PVPC por zona y "Limpiar cache") salio limpio. El bug estaba en la vista rapida: en zona Canarias el dia en curso llega SIEMPRE con 23 horas, porque su ultima hora pertenece al dia peninsular siguiente y ESIOS no la ha publicado cuando corre la descarga. `js/index-extra.js` conservaba una copia privada del validador de dia que exigia el dia completo, asi que el modal daba "Error al cargar precios" a diario en Canarias. CORREGIDO delegando en `validatePvpcDayCoverage` con `allowPartial` para los dias `>= hoy`, con aviso de dia incompleto y sin rotular como AHORA una hora ya pasada. NO relajes el contrato de dia CERRADO del ranking: sigue siendo fail-closed | [La Vista Rapida De PVPC Con El Dia En Curso Incompleto](AUDITORIA-REGISTRO.md#vista-rapida-pvpc-dia-en-curso-ronda-35-10-09-2026) |
| Buscador de guias (`js/guides-search.js`) | **Hueco deliberado, no auditado como area** (05/09/2026). Cubiertos por tests dedicados el indice y la resiliencia de red; sin auditar el comportamiento de la UI (orden de resultados, teclado, estados vacios). Techo de impacto cosmetico y sin superficie XSS (todo `textContent`). No lo reportes como zona huerfana sin leer la entrada | [Buscador De Guias: Hueco De Auditoria Deliberado](AUDITORIA-REGISTRO.md#buscador-de-guias-hueco-deliberado-05-09-2026) |

## Directorio Del Registro De Auditorias

Lo que sigue es el directorio de decisiones deliberadas, falsos positivos conocidos y bugs YA
CORREGIDOS. No re-reportes ninguna entrada sin consultar su detalle enlazado y aportar evidencia
nueva: para las decisiones/falsos positivos, evidencia de que el codigo ya no cumple lo descrito;
para las RESUELTAS, evidencia de que el mecanismo original volvio (regresion) o de un caso nuevo
no cubierto por sus tests.

El detalle completo de cada area vive en `AUDITORIA-REGISTRO.md`. Consultalo por el area que
estes auditando; no hace falta leerlo entero.

<!-- Indice generado por scripts/sync-seo-docs.mjs a partir de los titulos y anchors de
     AUDITORIA-REGISTRO.md. NO editar a mano: `npm run sync:repo-docs` lo reescribe. -->
<!-- REGISTRO-INDICE:INICIO -->
- [CSP Y Trusted Types](AUDITORIA-REGISTRO.md#csp-y-trusted-types)
- [CSV/XLSX Grande](AUDITORIA-REGISTRO.md#csv-xlsx-grande)
- [Carga Diferida Del JavaScript De La Home](AUDITORIA-REGISTRO.md#carga-diferida-del-javascript-de-la-home)
- [Cambios De Hora En La Numeracion Horaria (Marzo Y Octubre)](AUDITORIA-REGISTRO.md#cambios-de-hora-en-la-numeracion-horaria-marzo-y-octubre)
- [Escenario Compartido Del Simulador Solar (`?bv=`)](AUDITORIA-REGISTRO.md#escenario-compartido-del-simulador-solar-bv)
- [Guard De Datos Frente A CI De Despliegue](AUDITORIA-REGISTRO.md#guard-de-datos-frente-a-ci-de-despliegue)
- [Duplicados En CSV/XLSX Rechazados (RESUELTA)](AUDITORIA-REGISTRO.md#duplicados-en-csv-xlsx-rechazados-resuelta)
- [XLSX: Formula Sin Resultado Materializado (RESUELTA 30/08/2026)](AUDITORIA-REGISTRO.md#xlsx-formula-sin-resultado-materializado-resuelta-30-08-2026)
- [Contrato De "Cambios Pendientes" Roto Por Auto-Refresh, Race De Edicion Y Modal PVPC (RESUELTA)](AUDITORIA-REGISTRO.md#contrato-de-cambios-pendientes-roto-por-auto-refresh-race-de-edicion-y)
- [Home "Mi Tarifa": Perdida De Datos, Desglose Con Cambios Pendientes Y Opciones Avanzadas (RESUELTA)](AUDITORIA-REGISTRO.md#home-mi-tarifa-perdida-de-datos-desglose-con-cambios-pendientes-y-opci)
- [Factura, Tabla Manual Y "Mi Tarifa": Ceros Explicitos Y Continuidad (RESUELTA)](AUDITORIA-REGISTRO.md#factura-tabla-manual-y-mi-tarifa-ceros-explicitos-y-continuidad-resuel)
- [Escenarios Compartidos: `zonaOrigen` Y "Mi Tarifa" Excluida (RESUELTA)](AUDITORIA-REGISTRO.md#escenarios-compartidos-zonaorigen-y-mi-tarifa-excluida-resuelta)
- ["Limpiar Cache", Blanqueo De La Tabla Manual Y Autocalculo De Factura (RESUELTA)](AUDITORIA-REGISTRO.md#limpiar-cache-blanqueo-de-la-tabla-manual-y-autocalculo-de-factura-res)
- [Orden Del Teardown Con Fake Timers (`tests/bv-ui-zona-grid.test.js`)](AUDITORIA-REGISTRO.md#orden-del-teardown-con-fake-timers-tests-bv-ui-zona-grid-test-js)
- [PVPC Con CSV Y Precios Faltantes](AUDITORIA-REGISTRO.md#pvpc-con-csv-y-precios-faltantes)
- [Excedentes Indexados `fv.exc = -1`](AUDITORIA-REGISTRO.md#excedentes-indexados-fv-exc-1)
- [Validador De Dia Civil Compartido (Home, Observatorio, Excedentes)](AUDITORIA-REGISTRO.md#validador-de-dia-civil-compartido-home-observatorio-excedentes)
- [Frontera Temporal Del Periodo PVPC Estandar (RESUELTA)](AUDITORIA-REGISTRO.md#frontera-temporal-del-periodo-pvpc-estandar-resuelta)
- [PVPC Desaparece Del Ranking, SSAA `unavailable` Y Cache Del Service Worker](AUDITORIA-REGISTRO.md#pvpc-desaparece-del-ranking-ssaa-unavailable-y-cache-del-service-worke)
- [`tarifas.json` No Lleva Test De Esquema En El Repo (Deliberado)](AUDITORIA-REGISTRO.md#tarifas-json-no-lleva-test-de-esquema-en-el-repo-deliberado)
- [`fv.exc` Igual A `cPunta` En `CHC Plan Ahorro Solar`: Compensacion 1:1 (CORRECTO, NO TOCAR)](AUDITORIA-REGISTRO.md#fv-exc-igual-a-cpunta-en-chc-plan-ahorro-solar-compensacion-1-1-correcto)
- [Limites De Consumo Anual (`maxConsumoAnual` / `minConsumoAnualExclusivo`)](AUDITORIA-REGISTRO.md#limites-de-consumo-anual-maxconsumoanual-minconsumoanualexclusivo)
- [Cero Pagado Frente A Coste De Ranking En La Fila BV (Home)](AUDITORIA-REGISTRO.md#cero-pagado-frente-a-coste-de-ranking-en-la-fila-bv-home)
- [Invariante De `fv.bv` En "Mi Tarifa" (RESUELTA 20/08/2026)](AUDITORIA-REGISTRO.md#invariante-de-fv-bv-en-mi-tarifa-resuelta-20-08-2026)
- [Persistencia Y Migracion De Estado Local (RESUELTA 20/08/2026)](AUDITORIA-REGISTRO.md#persistencia-y-migracion-de-estado-local-resuelta-20-08-2026)
- [UI Del Simulador Solar: Estado, Ciclos De Vida Y Renderizado (RESUELTA 20/08/2026)](AUDITORIA-REGISTRO.md#ui-del-simulador-solar-estado-ciclos-de-vida-y-renderizado-resuelta-20)
- [Ranking Del Simulador Solar/BV](AUDITORIA-REGISTRO.md#ranking-del-simulador-solar-bv)
- [Fiscalidad Y Bono Social](AUDITORIA-REGISTRO.md#fiscalidad-y-bono-social)
- [Redondeo Exacto De Impuestos Indirectos Y Paridad Entre Motores (RESUELTA 16/08/2026)](AUDITORIA-REGISTRO.md#redondeo-exacto-de-impuestos-indirectos-y-paridad-entre-motores-resuel)
- [IGIC Canarias Y Default De Vivienda](AUDITORIA-REGISTRO.md#igic-canarias-y-default-de-vivienda)
- [`month.key` En BV](AUDITORIA-REGISTRO.md#month-key-en-bv)
- [Concurrencia Del Calculo Principal](AUDITORIA-REGISTRO.md#concurrencia-del-calculo-principal)
- [Concurrencia Y Privacidad En Factura PDF/OCR](AUDITORIA-REGISTRO.md#concurrencia-y-privacidad-en-factura-pdf-ocr)
- [Extractor De Factura PDF: Consumos Enteros Del QR CNMC](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-consumos-enteros-del-qr-cnmc)
- [QA E2E Con Agentes De Navegador (Falsos Positivos De Interaccion)](AUDITORIA-REGISTRO.md#qa-e2e-con-agentes-de-navegador-falsos-positivos-de-interaccion)
- [Cargas Parciales, Watchdog Y Telemetria De QA](AUDITORIA-REGISTRO.md#cargas-parciales-watchdog-y-telemetria-de-qa)
- [Zonas Huerfanas: Banner AECC, Shell Lite Y Registro Del SW (RESUELTA 20/08/2026)](AUDITORIA-REGISTRO.md#zonas-huerfanas-banner-aecc-shell-lite-y-registro-del-sw-resuelta-20-0)
- [Arranque/SW: Cache Storage E `index-extra.js` Opcional (RESUELTA 30/08/2026)](AUDITORIA-REGISTRO.md#arranque-sw-cache-storage-e-index-extra-opcional-resuelta-30-08-2026)
- [Formato Numerico: Coma En UI, Punto En Mocks De Tests](AUDITORIA-REGISTRO.md#formato-numerico-coma-en-ui-punto-en-mocks-de-tests)
- [Numeros Con Punto De Miles, Validador Asimetrico Y Bypass De `safeUrl` (RESUELTA)](AUDITORIA-REGISTRO.md#numeros-con-punto-de-miles-validador-asimetrico-y-bypass-de-safeurl-re)
- [Dominio 2.0TD Y Validacion De Factura PDF (RESUELTA)](AUDITORIA-REGISTRO.md#dominio-2-0td-y-validacion-de-factura-pdf-resuelta)
- [Rendimiento De Renderizado](AUDITORIA-REGISTRO.md#rendimiento-de-renderizado)
- [Ceros Validamente Contratados, Integracion Por Lineas Y Rango De Dias (RESUELTA)](AUDITORIA-REGISTRO.md#ceros-validamente-contratados-integracion-por-lineas-y-rango-de-dias-r)
- [Extractor De Factura PDF: Separacion Dimensional (kW, kWh, EUR, Dias)](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-separacion-dimensional-kw-kwh-eur-dias)
- [Extractor De Factura PDF: Lecturas De Contador Frente A Consumo Facturado](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-lecturas-de-contador-frente-a-consumo-factura)
- [Extractor De Factura PDF: Potencia Contratada Frente A Maximas Demandadas](AUDITORIA-REGISTRO.md#extractor-de-factura-pdf-potencia-contratada-frente-a-maximas-demandad)
- [QR CNMC: Confianza, Validacion Y PDF Multi-Factura](AUDITORIA-REGISTRO.md#qr-cnmc-confianza-validacion-y-pdf-multi-factura)
- [Dias De Facturacion](AUDITORIA-REGISTRO.md#dias-de-facturacion)
- [Peajes Fuera De 2.0TD](AUDITORIA-REGISTRO.md#peajes-fuera-de-2-0td)
- [Observatorio: Ausencia De Datos Frente A Cero](AUDITORIA-REGISTRO.md#observatorio-ausencia-de-datos-frente-a-cero)
- [Simulador Solar: Rotacion Del Patron Anual Y Ranking](AUDITORIA-REGISTRO.md#simulador-solar-rotacion-del-patron-anual-y-ranking)
- [CSV: Generacion Frente A Exportacion](AUDITORIA-REGISTRO.md#csv-generacion-frente-a-exportacion)
- [Robustez Ante Datos Estaticos Degradados En `data/` (RESUELTA 20/08/2026)](AUDITORIA-REGISTRO.md#robustez-ante-datos-estaticos-degradados-en-data-resuelta-20-08-2026)
- [Autorreporte De Violaciones CSP Del Endpoint Analitico (RESUELTA 25/08/2026)](AUDITORIA-REGISTRO.md#autorreporte-de-violaciones-csp-del-endpoint-analitico-resuelta-25-08)
- [`skipgc` Y El Getter De `localStorage` En El Sender (RESUELTA 25/08/2026)](AUDITORIA-REGISTRO.md#skipgc-y-el-getter-de-localstorage-en-el-sender-resuelta-25-08-2026)
- [Entrega Del Outbox De Diagnosticos: Al Menos Una Vez (DELIBERADO)](AUDITORIA-REGISTRO.md#entrega-del-outbox-de-diagnosticos-al-menos-una-vez-deliberado)
- [Rango De Anyos Del Observatorio: Una Sola Fuente De Verdad (RESUELTA 25/08/2026)](AUDITORIA-REGISTRO.md#rango-de-anyos-del-observatorio-una-sola-fuente-de-verdad-resuelta-25)
- [Precios Del QR Frente A Descuentos De La Factura (RESUELTA 25/08/2026)](AUDITORIA-REGISTRO.md#precios-del-qr-frente-a-descuentos-de-la-factura-resuelta-25-08-2026)
- [Cache Del Censo CNMC: Un Fallo De Red No Puede Durar Toda La Sesion (RESUELTA 25/08/2026)](AUDITORIA-REGISTRO.md#cache-del-censo-cnmc-un-fallo-de-red-no-puede-durar-toda-la-sesion-res)
- [Catalogo Sustituido Durante Un Calculo En Vuelo (RESUELTA 26/08/2026)](AUDITORIA-REGISTRO.md#catalogo-sustituido-durante-un-calculo-en-vuelo-resuelta-26-08-2026)
- [Peticion De Calculo Perdida Durante `__LF_CALC_INFLIGHT` (RESUELTA 26/08/2026)](AUDITORIA-REGISTRO.md#peticion-de-calculo-perdida-durante-lf-calc-inflight-resuelta-26-08-20)
- [`animateCounter` Sobre Una Etiqueta, No Un Numero (RESUELTA 27/08/2026)](AUDITORIA-REGISTRO.md#animatecounter-sobre-una-etiqueta-no-un-numero-resuelta-27-08-2026)
- [Ripple Retirado: Animaba Un Keyframe Inexistente (RESUELTA 27/08/2026)](AUDITORIA-REGISTRO.md#ripple-retirado-animaba-un-keyframe-inexistente-resuelta-27-08-2026)
- [Accesibilidad: Lo Auditado Y Que Salio Bien (Parcial, 27/08/2026)](AUDITORIA-REGISTRO.md#accesibilidad-lo-auditado-y-que-salio-bien-parcial-27-08-2026)
- [Contratos Numericos Por Procedencia (Ronda 15, 27/08/2026)](AUDITORIA-REGISTRO.md#contratos-numericos-por-procedencia-ronda-15-27-08-2026)
- [SEO, Datos Estructurados Y Core Web Vitals](AUDITORIA-REGISTRO.md#seo-datos-estructurados-y-core-web-vitals)
- [Documentacion Y Vigencia Editorial](AUDITORIA-REGISTRO.md#documentacion-y-vigencia-editorial)
- [Paginas Legales Frente Al Comportamiento Real](AUDITORIA-REGISTRO.md#paginas-legales-frente-al-comportamiento-real)
- [Ciclo De Vida De Recursos Y Temas Dinamicos (Ronda 16, 28/08/2026)](AUDITORIA-REGISTRO.md#ciclo-de-vida-de-recursos-y-temas-dinamicos-ronda-16-28-08-2026)
- [Fronteras De Renderizado Y Datos (Ronda 17, 28/08/2026)](AUDITORIA-REGISTRO.md#fronteras-de-renderizado-y-datos-ronda-17-28-08-2026)
- [Accesibilidad Funcional Y Responsive (Ronda 18, 28/08/2026)](AUDITORIA-REGISTRO.md#accesibilidad-funcional-y-responsive-ronda-18-28-08-2026)
- [Foco Y Colores Forzados (Ronda 19, 28/08/2026)](AUDITORIA-REGISTRO.md#foco-y-colores-forzados-ronda-19-28-08-2026)
- [Factura Lifecycle Y Export GoatCounter (31/08/2026)](AUDITORIA-REGISTRO.md#factura-lifecycle-y-export-goatcounter-31-08-2026)
- [SW, Cache, Arranque Y Recuperacion PDF.js (01/09/2026)](AUDITORIA-REGISTRO.md#sw-cache-arranque-y-recuperacion-pdfjs-01-09-2026)
- [Compatibilidad WebKit/iPhone Del Lector PDF (RESUELTA 02/09/2026)](AUDITORIA-REGISTRO.md#compatibilidad-webkit-iphone-del-lector-pdf-resuelta-02-09-2026)
- [Rotulacion De La Columna "Impuestos" Frente Al Motor (RESUELTA 05/09/2026)](AUDITORIA-REGISTRO.md#rotulacion-columna-impuestos-frente-al-motor-resuelta-05-09-2026)
- [Reproducibilidad De Enlaces Compartidos Y Backups (Ronda 21, 05/09/2026)](AUDITORIA-REGISTRO.md#reproducibilidad-de-enlaces-y-backups-ronda-21-05-09-2026)
- [Mensajes De Fallo Y Cobertura Parcial Frente A La Causa Real (Ronda 22, 05/09/2026)](AUDITORIA-REGISTRO.md#mensajes-de-fallo-y-parcialidad-ronda-22-05-09-2026)
- [Paridad De "Mi Tarifa" Entre Sus Tres Productores (Ronda 23, 05/09/2026)](AUDITORIA-REGISTRO.md#mi-tarifa-paridad-entre-productores-ronda-23-05-09-2026)
- [Buscador De Guias: Hueco De Auditoria Deliberado (05/09/2026)](AUDITORIA-REGISTRO.md#buscador-de-guias-hueco-deliberado-05-09-2026)
- [El Catalogo `tarifas.json` Frente Al Motor (Ronda 24, 06/09/2026)](AUDITORIA-REGISTRO.md#catalogo-frente-al-motor-ronda-24-06-09-2026)
- [De Un Dataset Vivo A Un Importe: PVPC Y Excedentes Indexados (Ronda 25, 07/09/2026)](AUDITORIA-REGISTRO.md#dataset-vivo-a-importe-ronda-25-07-09-2026)
- [La Capa Comun Frente A Sus Copias Locales (Ronda 26, 08/09/2026)](AUDITORIA-REGISTRO.md#capa-comun-frente-a-copias-locales-ronda-26-08-09-2026)
- [El Puesto Del Ranking Frente Al Orden De La Vista (Ronda 27, 08/09/2026)](AUDITORIA-REGISTRO.md#puesto-del-ranking-ronda-27-08-09-2026)
- [Las Cifras Del Observatorio: Que Promedia Cada Numero (Ronda 28, 09/09/2026)](AUDITORIA-REGISTRO.md#cifras-del-observatorio-ronda-28-09-09-2026)
- [De Un Fichero De Distribuidora A P1/P2/P3 Y A La Curva (Ronda 29, 09/09/2026)](AUDITORIA-REGISTRO.md#csv-a-p1-p2-p3-ronda-29-09-09-2026)
- [El Ciclo De Vida De La Curva Importada (Ronda 30, 09/09/2026)](AUDITORIA-REGISTRO.md#ciclo-de-vida-curva-importada-ronda-30-09-09-2026)
- [El Desglose De Factura Frente A La Fila Del Ranking (Ronda 31, 09/09/2026)](AUDITORIA-REGISTRO.md#desglose-frente-a-la-fila-ronda-31-09-09-2026)
- [Las Opciones De La Home Cruzadas Entre Si (Ronda 32, 09/09/2026)](AUDITORIA-REGISTRO.md#opciones-de-la-home-cruzadas-ronda-32-09-09-2026)
- ["Mi Tarifa" Como Formulario: Validar, Guardar Y Decir Que Se Ha Guardado (Ronda 33, 09/09/2026)](AUDITORIA-REGISTRO.md#mi-tarifa-como-formulario-ronda-33-09-09-2026)
- [Vigencia De Documentacion Y Guias Al 09/09/2026 (Ronda 34)](AUDITORIA-REGISTRO.md#vigencia-docs-y-guias-ronda-34-09-09-2026)
- [La Vista Rapida De PVPC Con El Dia En Curso Incompleto (Ronda 35, 10/09/2026)](AUDITORIA-REGISTRO.md#vista-rapida-pvpc-dia-en-curso-ronda-35-10-09-2026)
<!-- REGISTRO-INDICE:FIN -->

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

Lee completo AUDITORIA-IA.md; consulta AUDITORIA-REGISTRO.md unicamente por el area relevante,
siguiendo los enlaces de la tabla de areas o del indice. El registro es material de consulta:
no lo leas de forma lineal.

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
Antes de hallazgos SEO/CWV, revisa la seccion `SEO, Datos Estructurados Y Core Web Vitals` de AUDITORIA-REGISTRO.md y valida rendimiento contra una medicion reproducible; distingue datos de laboratorio, datos de campo y cobertura de una pagina concreta.
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
