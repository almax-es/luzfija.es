# Mantenimiento Normativo Y Operativo

Ultima actualizacion: 2026-05-05

Este documento lista las piezas de LuzFija.es que dependen de normativa, fuentes oficiales o datos vivos. Sirve como checklist para que calculos, guias y mensajes publicos no queden desfasados.

## Regla General

- No cambiar fiscalidad, PVPC, bono social, peajes, cargos, autoconsumo, excedentes, derechos regulados ni guias legales por memoria.
- Revisar siempre la fuente oficial y dejar la referencia en el commit, en el comentario de codigo o en la documentacion afectada.
- Si cambia una regla que afecta calculos, actualizar tambien tests antes de publicar.
- Si cambia un texto publico, revisar guias, landings, `novedades.json`, datos estructurados, sitemap e indice de busqueda.

## Checklist Permanente

| Area | Que revisar | Cuando | Fuente principal | Impacto en repo |
| --- | --- | --- | --- | --- |
| IVA Peninsula/Baleares | Tipo vigente, umbral de potencia, excepciones por bono social y fin de medidas temporales | Antes del 30/06/2026 y cada BOE energetico/fiscal | BOE: Ley 37/1992, RDL 7/2026, RDL 10/2026 y normas posteriores | `js/lf-config.js`, `tests/fiscal.test.js`, `tests/calc.test.js`, `tests/pvpc.test.js`, guias de factura, README/CAPACIDADES |
| IEE | Porcentaje vigente, minimo aplicable y duracion de reducciones temporales | Trimestral y cada BOE fiscal/energetico | BOE: Ley 38/1992 y reales decretos temporales | `js/lf-config.js`, desglose, PVPC, tests fiscales |
| IGIC Canarias | Tipos para vivienda, otros usos y contador; umbral de potencia | Trimestral y cada cambio del Gobierno de Canarias | Ley 4/2012 y normativa canaria vigente | `js/lf-config.js`, `js/desglose-factura.js`, tests fiscales, guia factura |
| IPSI Ceuta/Melilla | Tipos de electricidad, contador y servicios | Trimestral y cada ordenanza/cambio local | Normativa local + Ley 8/1991 | `js/lf-config.js`, desglose, tests fiscales |
| Bono social | Descuentos, limites de consumo bonificable, categorias y financiacion | Mensual si hay BOE energetico; obligatorio antes de fin de medidas temporales | BOE: RD 897/2017, RDL 7/2026, Orden TED/1524/2025 y posteriores | `js/lf-config.js`, `js/lf-utils.js`, PVPC, tests de bono social/fiscalidad |
| PVPC regulado | Formula, elegibilidad por potencia, comercializadoras de referencia y metodologia CNMC | Trimestral y cuando CNMC/MITECO publiquen cambios | BOE, CNMC, REE/ESIOS | `js/pvpc.js`, `PVPC-SCHEMA.md`, guias PVPC, tests PVPC |
| Peajes y cargos | Precios de potencia/energia por periodo, calendario y estructura 2.0TD | Anual y cada circular/resolucion CNMC/MITECO | CNMC, BOE, MITECO | `js/lf-config.js`, `js/pvpc.js`, calculo/desglose, guias de potencia |
| Horarios P1/P2/P3 | Calendario peninsular/territorial, festivos nacionales y cambios de hora | Anual, al preparar datasets del nuevo ano | CNMC, BOE calendario laboral, REE | `js/lf-csv-utils.js`, `js/pvpc.js`, tests CSV/PVPC |
| Datos PVPC | Integridad de datasets diarios, zonas 8741-8745, dias de 23/24/25 horas | Diario por automatizacion; revision manual si hay huecos | REE/ESIOS indicador 1001 | `/data/pvpc/`, observatorio, home, tests de integridad |
| Datos excedentes | Integridad y precio horario de compensacion simplificada | Diario por automatizacion; revision manual si hay huecos | REE/ESIOS indicador 1739 | `/data/surplus/`, observatorio, simulador solar |
| Autoconsumo y compensacion | Tope legal de compensacion, modalidades, limites y tratamiento de excedentes | Semestral y cada cambio de autoconsumo | RD 244/2019, IDAE, CNMC, BOE | `js/desglose-factura.js`, simulador BV, guias solares |
| Bateria virtual comercial | Condiciones comerciales, acumulacion, caducidad, segunda vivienda, cuotas | Cada actualizacion de tarifas | Webs/contratos de comercializadoras | `tarifas.json`, Excel privada, guia solar avanzada |
| Tarifas de mercado libre | Precios, servicios obligatorios, permanencias, descuentos, indexadas, excedentes | Cada actualizacion de Excel y antes de publicar post | Webs oficiales de comercializadoras y condiciones PDF | Excel privada, `tarifas.json`, validador privado, post Facebook |
| Campo `Activa` | Que tarifas estan publicadas o retiradas temporalmente | En cada revision de Excel | Excel privada `Tarifas Luz.xlsx` | Generador JSON, generador post, validador privado |
| Excedentes indexados `fv.exc=-1` | Si la estimacion operativa de 0,030 EUR/kWh sigue siendo razonable | Mensual o si cambia mucho el mercado | REE/ESIOS indicador 1739, OMIE y condiciones comerciales | `tarifas.json`, UI de aviso, JSON-SCHEMA, docs |
| Factura PDF/QR CNMC | Formato de URL QR, campos y cambios en modelos de factura | Trimestral y cuando fallen facturas reales | CNMC y facturas reales anonimizadas | `js/factura.js`, tests de factura, guias de factura |
| Consumo horario y lecturas | Acceso a curva horaria, Datadis, portales de distribuidoras, lecturas reales/estimadas y formatos CSV/XLSX | Semestral y cuando cambien formatos de descarga | Datadis, distribuidoras, CNMC | `js/lf-csv-utils.js`, importadores, guias de consumo horario y lecturas |
| Potencia contratada y maximetro | Derechos, excesos, tramos, maximetro y casos domesticos/no domesticos | Semestral y cada cambio regulatorio | BOE, CNMC, distribuidoras | Guia de potencia, calculadora, textos de ayuda |
| Contratacion, cambios y atencion al cliente | Plazos de cambio de comercializadora, respuesta a reclamaciones, desistimiento, canales de atencion y obligaciones de empresa | Semestral y cada cambio de consumidores/energia | BOE, CNMC, RD 88/2026 y normativa posterior | Guias de cambio de compania, reclamaciones, estafas y servicios extra |
| Altas, bajas, CUPS y cambio de titular | Derechos regulados, CUPS inactivos, altas/bajas, mudanzas, alquileres, fallecimientos y cambios de titular | Semestral y cada cambio de normativa de acceso/contratacion | BOE, CNMC, distribuidoras y comercializadoras | Guias de CUPS, mudanza/alquiler, potencia, errores de factura |
| Coche electrico | ITC-BT-52, comunidad de propietarios, potencias y costes orientativos | Semestral | REBT/ITC-BT-52, Ley de Propiedad Horizontal, IDAE | Guia de punto de recarga y coche electrico |
| Equipos, climatizacion y costes orientativos | Consumos, precios medios, ayudas, subvenciones, deducciones fiscales, mantenimiento y vida util de placas, baterias, aerotermia, termo, bombas de calor y coche electrico | Trimestral y antes de actualizar guias de ahorro/inversion | IDAE, MITECO, CCAA/ayuntamientos, mercado y fabricantes | Guias de aerotermia, autoconsumo, coche electrico y potencia |
| Guias legales/reclamaciones | Plazos, organismos, procedimientos y derechos del consumidor | Semestral | CNMC, MITECO, consumo autonomico, BOE | Guias de reclamacion, errores de factura, cambios de compania |
| Estafas, telemarketing y datos personales | Derecho de desistimiento, Lista Robinson, AEPD, suplantaciones y canales de reclamacion | Semestral y ante cambios de consumo/proteccion de datos | AEPD, normativa de consumidores, Lista Robinson, organismos de consumo | Guia de estafas, privacidad, reclamaciones |
| Gas/TUR y novedades energeticas no electricas | Avisos puntuales que aparecen en `novedades.json` o guias relacionadas aunque no sean calculo electrico | Cada novedad publicada y revision trimestral | BOE, MITECO, CNMC, comercializadoras de referencia | `novedades.json`, `novedades.html`, feed, guias relacionadas |
| Privacidad y analitica | GoatCounter, localStorage, CSP, dependencias autoalojadas | Trimestral y al cambiar tracking/dependencias | Politica propia, docs GoatCounter, navegador/CSP | `privacidad.html`, `tracking.js`, tests de privacidad/seguridad |
| Licencia, derechos y reutilizacion | Licencia del codigo, derechos sobre contenido/datasets curados y avisos de uso de datos | Al cambiar licencia, datasets o textos legales | `LICENSE`, `CONTENT-LICENSE.md`, fuentes de terceros | README, aviso legal, `_meta` de `tarifas.json`, docs de esquema |

## Fechas Criticas Conocidas

- Antes del 30/06/2026: revisar si sigue vigente el IVA reducido temporal en Peninsula/Baleares y si el condicionante de IPC publicado por el INE mantiene o corta la rebaja en junio.
- Cada cambio de ano: revisar peajes/cargos, calendario de periodos, festivos nacionales, datasets PVPC/surplus y textos de guias que mencionen importes anuales.
- Cada cambio de Excel de tarifas: ejecutar generador, revisar el informe del validador y confirmar que las inactivas no se publican pero siguen apareciendo en validacion.
- Cada novedad energetica publicada: confirmar si requiere tocar `novedades.json`, `feed.xml`, guias, landings o calculos. No limitar la revision a electricidad si la noticia trata TUR/gas u otro suministro.
- Cada guia con importes orientativos: revisar que los rangos sigan siendo razonables o marcar claramente que son ejemplos no contractuales.

## Protocolo Para Cambios Normativos

1. Identificar la fuente oficial y guardar fecha exacta de consulta.
2. Localizar impacto con `rg` en codigo, tests, guias y documentacion.
3. Cambiar primero la regla fuente (`js/lf-config.js`, motores PVPC/BV o datasets).
4. Actualizar tests que cubran frontera y caso normal.
5. Actualizar copy publico: guias, landings, `novedades.json` si procede y docs internas.
6. Ejecutar `npm test`.
7. Si se tocan guias o SEO, dejar sincronizados sitemap, feed e indice de busqueda.
8. Commit con mensaje que mencione la norma o fuente.

## Puntos Donde Es Facil Meter La Pata

- `10 kW` no siempre significa lo mismo: PVPC tiene elegibilidad `<= 10 kW`; el IVA reducido temporal de 2026 queda `<= 10 kW` tras RDL 10/2026; otras reglas pueden usar limites distintos.
- La fiscalidad vigente se aplica de forma centralizada desde `LF_CONFIG`; no duplicar porcentajes en modulos.
- PVPC no se consulta en vivo desde el navegador: se calcula contra datasets estaticos versionados.
- Una tarifa inactiva en Excel no debe aparecer en `tarifas.json` ni en el post, pero si debe seguir validandose.
- `fv.exc=-1` no es un precio real: es una marca interna para indexado estimado con aviso visible.
- Los textos editoriales pueden quedar obsoletos aunque los calculos esten bien; buscar tanto en `js/` como en `guias/`.
