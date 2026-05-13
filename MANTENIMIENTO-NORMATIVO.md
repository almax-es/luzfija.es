# Mantenimiento Normativo Y Operativo

Última actualización: 2026-05-12

Este documento lista las piezas de LuzFija.es que dependen de normativa, fuentes oficiales o datos vivos. Sirve como checklist para que cálculos, guías y mensajes publicos no queden desfasados.

## Regla General

- No cambiar fiscalidad, PVPC, bono social, peajes, cargos, autoconsumo, excedentes, derechos regulados ni guías legales por memoria.
- Revisar siempre la fuente oficial y dejar la referencia en el commit, en el comentario de código o en la documentacion afectada.
- Si cambia una regla que afecta cálculos, actualizar también tests antes de publicar.
- Si cambia un texto publico, revisar guías, landings, datos estructurados, sitemap e indice de busqueda.

## Checklist Permanente

| Area | Que revisar | Cuando | Fuente principal | Impacto en repo |
| --- | --- | --- | --- | --- |
| IVA Península/Baleares | Tipo vigente, umbral de potencia, excepciones por bono social y fin de medidas temporales | Antes del 30/06/2026 y cada BOE energetico/fiscal | BOE: Ley 37/1992, RDL 7/2026, RDL 10/2026 y normas posteriores | `js/lf-config.js`, `tests/fiscal.test.js`, `tests/calc.test.js`, `tests/pvpc.test.js`, guías de factura, README/CAPACIDADES |
| IEE | Porcentaje vigente, mínimo aplicable y duracion de reducciones temporales | Trimestral y cada BOE fiscal/energetico | BOE: Ley 38/1992 y reales decretos temporales | `js/lf-config.js`, desglose, PVPC, tests fiscales |
| IGIC Canarias | Tipos para vivienda, otros usos y contador; umbral de potencia | Trimestral y cada cambio del Gobierno de Canarias | Ley 4/2012 y normativa canaria vigente | `js/lf-config.js`, `js/desglose-factura.js`, tests fiscales, guia factura |
| IPSI Ceuta/Melilla | Tipos de electricidad, contador y servicios | Trimestral y cada ordenanza/cambio local | Normativa local + Ley 8/1991 | `js/lf-config.js`, desglose, tests fiscales |
| Bono social | Descuentos, limites de consumo bonificable, categorías y financiación | Mensual si hay BOE energetico; obligatorio antes de fin de medidas temporales | BOE: RD 897/2017, RDL 7/2026, Orden TED/1524/2025 y posteriores | `js/lf-config.js`, `js/lf-utils.js`, PVPC, tests de bono social/fiscalidad |
| PVPC regulado | Formula, elegibilidad por potencia, comercializadoras de referencia y metodologia CNMC | Trimestral y cuando CNMC/MITECO publiquen cambios | BOE, CNMC, REE/ESIOS | `js/pvpc.js`, `PVPC-SCHEMA.md`, guías PVPC, tests PVPC |
| Peajes y cargos | Precios de potencia/energía por periodo, calendario y estructura 2.0TD | Anual y cada circular/resolución CNMC/MITECO | CNMC, BOE, MITECO | `js/lf-config.js`, `js/pvpc.js`, cálculo/desglose, guías de potencia |
| Horarios P1/P2/P3 | Calendario peninsular/territorial, festivos nacionales y cambios de hora | Anual, al preparar datasets del nuevo año | CNMC, BOE calendario laboral, REE | `js/lf-csv-utils.js`, `js/pvpc.js`, tests CSV/PVPC |
| Datos PVPC | Integridad de datasets diarios, zonas 8741-8745, días de 23/24/25 horas | Diario por automatización; revisión manual si hay huecos | REE/ESIOS indicador 1001 | `/data/pvpc/`, observatorio, home, tests de integridad |
| Datos excedentes | Integridad y precio horario de compensación simplificada | Diario por automatización; revisión manual si hay huecos | REE/ESIOS indicador 1739 | `/data/surplus/`, observatorio, simulador solar |
| Autoconsumo y compensación | Tope legal de compensación, modalidades, limites y tratamiento de excedentes | Semestral y cada cambio de autoconsumo | RD 244/2019, IDAE, CNMC, BOE | `js/desglose-factura.js`, simulador BV, guías solares |
| Bateria virtual comercial | Condiciones comerciales, acumulacion, caducidad, segunda vivienda, cuotas | Cada actualización de tarifas | Webs/contratos de comercializadoras | `tarifas.json`, Excel privada, guia solar avanzada |
| Tarifas de mercado libre | Precios, servicios obligatorios, permanencias, descuentos, indexadas, excedentes | Cada actualización de Excel y antes de publicar post | Webs oficiales de comercializadoras y condiciones PDF | Excel privada, `tarifas.json`, validador privado, post Facebook |
| Campo `Activa` | Que tarifas estan publicadas o retiradas temporalmente | En cada revisión de Excel | Excel privada `Tarifas Luz.xlsx` | Generador JSON, generador post, validador privado |
| Excedentes indexados `fv.exc=-1` | Si la estimacion operativa de 0,030 EUR/kWh sigue siendo razonable | Mensual o si cambia mucho el mercado | REE/ESIOS indicador 1739, OMIE y condiciones comerciales | `tarifas.json`, UI de aviso, JSON-SCHEMA, docs |
| Factura PDF/QR CNMC | Formato de URL QR, campos y cambios en modelos de factura | Trimestral y cuando fallen facturas reales | CNMC y facturas reales anonimizadas | `js/factura.js`, tests de factura, guías de factura |
| Consumo horario y lecturas | Acceso a curva horaria, Datadis, portales de distribuidoras, lecturas reales/estimadas y formatos CSV/XLSX | Semestral y cuando cambien formatos de descarga | Datadis, distribuidoras, CNMC | `js/lf-csv-utils.js`, importadores, guías de consumo horario y lecturas |
| Potencia contratada y maximetro | Derechos, excesos, tramos, maximetro y casos domesticos/no domesticos | Semestral y cada cambio regulatorio | BOE, CNMC, distribuidoras | Guia de potencia, calculadora, textos de ayuda |
| Contratación, cambios y atención al cliente | Plazos de cambio de comercializadora, respuesta a reclamaciones, desistimiento, canales de atención y obligaciones de empresa | Semestral y cada cambio de consumidores/energía | BOE, CNMC, RD 88/2026 y normativa posterior | Guías de cambio de compañía, reclamaciones, estafas y servicios extra |
| Altas, bajas, CUPS y cambio de titular | Derechos regulados, CUPS inactivos, altas/bajas, mudanzas, alquileres, fallecimientos y cambios de titular | Semestral y cada cambio de normativa de acceso/contratación | BOE, CNMC, distribuidoras y comercializadoras | Guías de CUPS, mudanza/alquiler, potencia, errores de factura |
| Coche electrico | ITC-BT-52, comunidad de propietarios, potencias y costes orientativos | Semestral | REBT/ITC-BT-52, Ley de Propiedad Horizontal, IDAE | Guia de punto de recarga y coche electrico |
| Equipos, climatizacion y costes orientativos | Consumos, precios medios, ayudas, subvenciones, deducciones fiscales, mantenimiento y vida útil de placas, baterías, aerotermia, termo, bombas de calor y coche electrico | Trimestral y antes de actualizar guías de ahorro/inversion | IDAE, MITECO, CCAA/ayuntamientos, mercado y fabricantes | Guías de aerotermia, autoconsumo, coche electrico y potencia |
| Guías legales/reclamaciones | Plazos, organismos, procedimientos y derechos del consumidor | Semestral | CNMC, MITECO, consumo autonomico, BOE | Guías de reclamacion, errores de factura, cambios de compañía |
| Estafas, telemarketing y datos personales | Derecho de desistimiento, Lista Robinson, AEPD, suplantaciones y canales de reclamacion | Semestral y ante cambios de consumo/protección de datos | AEPD, normativa de consumidores, Lista Robinson, organismos de consumo | Guia de estafas, privacidad, reclamaciones |
| Gas/TUR y avisos energeticos no electricos | Avisos puntuales que aparezcan en guías o landings aunque no sean cálculo electrico | Revisión trimestral y cada cambio normativo relevante | BOE, MITECO, CNMC, comercializadoras de referencia | Guías relacionadas, landings y datos estructurados |
| SEO y datos estructurados | `dateModified`, canonical, OpenGraph/Twitter, JSON-LD, sitemap, indice de busqueda y enlaces internos | Cada cambio de página o guia | Fuentes internas del repo y validadores SEO/Schema | HTML publico, `sitemap.xml`, `data/guides-search-index.json`, tests SEO |
| PWA, cache y dependencias web | Versión de service worker, estrategia de cache, manifest, assetlinks, librerias autoalojadas y compatibilidad de APIs de navegador | Trimestral y al actualizar dependencias o despliegue | Docs de navegadores, upstream de librerias, pruebas e2e/seguridad | `sw.js`, `manifest.webmanifest`, `.well-known/assetlinks.json`, `vendor/`, tests SW/seguridad |
| Privacidad y analítica | GoatCounter, localStorage, CSP, dependencias autoalojadas | Trimestral y al cambiar tracking/dependencias | Politica propia, docs GoatCounter, navegador/CSP | `privacidad.html`, `tracking.js`, tests de privacidad/seguridad |
| Licencia, derechos y reutilizacion | Licencia del código, derechos sobre contenido/datasets curados y avisos de uso de datos | Al cambiar licencia, datasets o textos legales | `LICENSE`, `CONTENT-LICENSE.md`, fuentes de terceros | README, aviso legal, `_meta` de `tarifas.json`, docs de esquema |

## Fechas Críticas Conocidas

- Antes del 30/06/2026: revisar si sigue vigente el IVA reducido temporal en Península/Baleares y si el condicionante de IPC publicado por el INE mantiene o corta la rebaja en junio.
- Cada cambio de año: revisar peajes/cargos, calendario de periodos, festivos nacionales, datasets PVPC/surplus y textos de guías que mencionen importes anuales.
- Cada cambio de Excel de tarifas: ejecutar generador, revisar el informe del validador y confirmar que las inactivas no se publican pero siguen apareciendo en validación.
- Cada cambio energetico relevante: confirmar si requiere tocar guías, landings, datos estructurados o cálculos. No limitar la revisión a electricidad si la noticia trata TUR/gas u otro suministro.
- Cada guia con importes orientativos: revisar que los rangos sigan siendo razonables o marcar claramente que son ejemplos no contractuales.
- Cada despliegue o cambio de assets: revisar service worker, cache y metadatos SEO generados para evitar que produccion sirva contenido antiguo.

## Protocolo Para Cambios Normativos

1. Identificar la fuente oficial y guardar fecha exacta de consulta.
2. Localizar impacto con `rg` en código, tests, guías y documentacion.
3. Cambiar primero la regla fuente (`js/lf-config.js`, motores PVPC/BV o datasets).
4. Actualizar tests que cubran frontera y caso normal.
5. Actualizar copy publico: guías, landings, datos estructurados si procede y docs internas.
6. Ejecutar `npm test`.
7. Si se tocan guías o SEO, dejar sincronizados sitemap e indice de busqueda.
8. Commit con mensaje que mencione la norma o fuente.

## Puntos Donde Es Fácil Meter La Pata

- `10 kW` no siempre significa lo mismo: PVPC tiene elegibilidad `<= 10 kW`; el IVA reducido temporal de 2026 queda `<= 10 kW` tras RDL 10/2026; otras reglas pueden usar limites distintos.
- La fiscalidad vigente se aplica de forma centralizada desde `LF_CONFIG`; no duplicar porcentajes en módulos.
- PVPC no se consulta en vivo desde el navegador: se calcula contra datasets estáticos versionados.
- Una tarifa inactiva en Excel no debe aparecer en `tarifas.json` ni en el post, pero si debe seguir validandose.
- `fv.exc=-1` no es un precio real: es una marca interna para indexado estimado con aviso visible.
- Los textos editoriales pueden quedar obsoletos aunque los cálculos esten bien; buscar tanto en `js/` como en `guías/`.
