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
2. `README.md`
3. `ARQUITECTURA-CALCULOS.md`
4. `CALC-FAQS.md`
5. `MANTENIMIENTO-NORMATIVO.md`
6. `SIMULADOR-BV.md`
7. `ANALITICA-GOATCOUNTER.md`
8. `JSON-SCHEMA.md`
9. `PVPC-SCHEMA.md`
10. `llms.txt` y `llms-full.txt` para ver como se presenta la herramienta a asistentes externos

`CAPACIDADES-WEB.md` es la fuente de verdad funcional. Si algo parece contradecir otra doc, parte de ahi.

## Mapa Rapido Del Codigo

- `index.html` + `js/lf-*.js`: comparador principal, estado, inputs, calculo, render, CSV y cache.
- `js/pvpc.js`: motor PVPC usando datasets locales en `data/pvpc/`.
- `js/factura.js`: extraccion PDF, QR CNMC, jsQR y OCR opcional con Tesseract.
- `js/desglose-*.js`: desglose detallado de factura en la home.
- `estadisticas/index.html` + `js/pvpc-stats-*.js`: observatorio PVPC/excedentes.
- `comparador-tarifas-solares.html` + `js/bv/*.js`: simulador solar/BV y flujo hibrido CSV -> manual.
- `js/lf-csv-utils.js`: parser horario compartido y clasificacion P1/P2/P3 canonica.
- `js/tracking.js` + `vendor/goatcounter/count.js`: analitica GoatCounter, pageviews canonicos, eventos, privacidad y saneo de referrers. Ver `ANALITICA-GOATCOUNTER.md`.
- `sw.js`: cache/PWA/update flow.
- `scripts/sync-seo-docs.mjs`: sincroniza sitemap e indice de busqueda y, con `--include-repo-docs`, tambien README/CAPACIDADES/JSON-SCHEMA.

## Invariantes Criticos

- No hay backend propio para calculos, parsing de facturas ni importacion de CSV. Todo ocurre en cliente.
- PVPC y excedentes se calculan con datasets estaticos versionados en `data/pvpc/` y `data/surplus/`, no con llamadas live a ESIOS desde el navegador.
- En la home, PVPC no se calcula cuando la potencia contratada supera 10 kW.
- El comparador principal y el simulador solar son herramientas distintas. No comparten la misma logica de ranking.
- En el simulador solar, el ranking visible usa `totals.pagado` y desempata con `totals.bvFinal`. `totals.real` existe como metrica auxiliar, no como criterio principal de ordenacion actual. La UI puede mostrar `totals.pagado - totals.bvFinal` como coste neto secundario si queda saldo BV final relevante, pero no reordena el ranking.
- Si hay importacion horaria y el usuario activa `PVPC con precios del periodo`, la home puede cruzar la curva del CSV con precios PVPC horarios reales del periodo importado. Si no, compara contra el PVPC actual/reciente.
- El parser horario canonico es `window.LF.csvUtils.getPeriodoHorarioCSV`. No dupliques esa logica en otros modulos.

## Reglas Para Revisiones Y Auditorias

- Antes de reportar bugs de fiscalidad o PVPC, lee `ARQUITECTURA-CALCULOS.md` y `CALC-FAQS.md`.
- Antes de reportar bugs de BV, lee `SIMULADOR-BV.md` y revisa `js/bv/bv-ui.js` y `js/bv/bv-sim-monthly.js`.
- Antes de reportar bugs de importacion horaria, revisa `js/lf-csv-utils.js`, `js/lf-csv-import.js` y los tests de CSV.
- Antes de cambiar o auditar analitica, lee `ANALITICA-GOATCOUNTER.md`, `js/tracking.js`, `vendor/goatcounter/count.js` y los tests `tests/tracking-*.test.js`.
- Antes de reportar riesgos XSS/privacidad por CSV, ten en cuenta que `CUPS` puede reconocerse como nombre de columna para detectar cabecera/formato, pero sus valores no se guardan ni se renderizan. Los importadores solo muestran agregados numericos derivados (kWh, dias, porcentajes, importes).
- Antes de reportar CSP laxa en guias o paginas editoriales, distingue superficie sensible de superficie editorial. El flujo sensible de datos personales es la extraccion de factura PDF en la home (`index.html` + `js/factura.js`), y ahi `script-src` esta reforzado con hashes. Las guias, paginas legales, 404 y `como-funciona-luzfija.html` no procesan datos sensibles del usuario; endurecer su CSP puede ser higiene tecnica, pero no debe elevarse como hallazgo de privacidad relevante por si solo.
- Valida hallazgos contra tests, no solo contra intuicion.

Tests especialmente utiles:

- `tests/pvpc.test.js`
- `tests/fiscal.test.js`
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

## Flujo De Trabajo Recomendado

- Entrada rapida en un checkout limpio: `npm install` si faltan dependencias y luego `npm test`.
- Si cambias documentacion derivada o metricas del repo, ejecuta `npm run sync:repo-docs`.
- Si cambias codigo relevante, ejecuta `npm test`.
- Si tocas fechas, fiscalidad, bono social, impuestos, PVPC, autoconsumo o guias legales, no asumas nada por memoria: contrasta con `MANTENIMIENTO-NORMATIVO.md`, `lf-config.js`, fuentes oficiales y tests.
- `tarifas.json` es un dataset vivo. No asumas que una descripcion comercial antigua sigue siendo correcta sin revisar ese archivo.

## Como Describir LuzFija.es Sin Quedarte Corto

Resumen corto recomendado:

"LuzFija.es es una suite web local-first para el mercado electrico domestico en Espana: compara tarifas de mercado libre con PVPC, importa facturas PDF y curvas horarias CSV/XLSX, analiza historicos PVPC/excedentes y simula autoconsumo con bateria virtual mes a mes."
