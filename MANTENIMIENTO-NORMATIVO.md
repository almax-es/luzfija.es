# Mantenimiento Normativo Y Operativo

Ultima actualizacion: 2026-08-25

Este documento lista las piezas de LuzFija.es que dependen de normativa, fuentes oficiales o datos vivos. Sirve como checklist para que calculos, guias y mensajes publicos no queden desfasados.

## Regla General

- No cambiar fiscalidad, PVPC, bono social, peajes, cargos, autoconsumo, excedentes, derechos regulados ni guias legales por memoria.
- Revisar siempre la fuente oficial y dejar la referencia en el commit, en el comentario de codigo o en la documentacion afectada.
- Si cambia una regla que afecta calculos, actualizar tambien tests antes de publicar.
- Si cambia un texto publico, revisar guias, landings, datos estructurados, sitemap e indice de busqueda.

## Checklist Permanente

| Area | Que revisar | Cuando | Fuente principal | Impacto en repo |
| --- | --- | --- | --- | --- |
| IVA Peninsula/Baleares | Tipo vigente, umbral de potencia, excepciones por bono social y activacion/desactivacion de medidas temporales condicionadas por IPC | Cada BOE energetico/fiscal y tras cada IPC que una norma use como condicion | BOE: Ley 37/1992, RDL 7/2026, RDL 10/2026, RDL 18/2026 (BOE-A-2026-14112) y normas posteriores | `js/lf-config.js`, `tests/fiscal.test.js`, `tests/fiscal-rounding-align.test.js`, `tests/calc.test.js`, `tests/pvpc.test.js`, guias de factura, README/CAPACIDADES |
| IEE | Porcentaje vigente, minimo aplicable y activacion/duracion de reducciones temporales | Cada BOE fiscal/energetico y tras cada IPC que una norma use como condicion | BOE: Ley 38/1992, RDL 7/2026, RDL 18/2026 (BOE-A-2026-14112) y reales decretos posteriores | `js/lf-config.js`, desglose, PVPC, tests fiscales |
| IGIC Canarias | Tipos para vivienda, otros usos y contador; umbral de potencia | Trimestral y cada cambio del Gobierno de Canarias | Ley 4/2012 y normativa canaria vigente | `js/lf-config.js`, `js/desglose-calculo.js`, `js/desglose-render.js`, `tests/fiscal-rounding-align.test.js`, tests fiscales, guia factura |
| IPSI Ceuta/Melilla | Tipos de electricidad, contador y servicios | Trimestral y cada ordenanza/cambio local | Normativa local + Ley 8/1991 | `js/lf-config.js`, desglose, `tests/fiscal-rounding-align.test.js`, tests fiscales |
| Bono social | Descuentos, limites de consumo bonificable, categorias y financiacion | Mensual si hay BOE energetico; obligatorio antes de fin de medidas temporales | BOE: RD 897/2017, RDL 7/2026, Orden TED/634/2026 y posteriores | `js/lf-config.js`, `js/lf-utils.js`, PVPC, tests de bono social/fiscalidad |
| PVPC regulado | Formula, elegibilidad por potencia, comercializadoras de referencia y metodologia CNMC | Trimestral y cuando CNMC/MITECO publiquen cambios | BOE, CNMC, REE/ESIOS | `js/pvpc.js`, `PVPC-SCHEMA.md`, guias PVPC, tests PVPC |
| Peajes y cargos | Precios de potencia/energia por periodo, calendario y estructura 2.0TD | Anual y cada circular/resolucion CNMC/MITECO | CNMC, BOE, MITECO | `js/lf-config.js`, `js/pvpc.js`, calculo/desglose, guias de potencia |
| Horarios P1/P2/P3 | Calendario peninsular/territorial, festivos nacionales y cambios de hora | Anual, al preparar datasets del nuevo ano | CNMC, BOE calendario laboral, REE | `js/lf-csv-utils.js`, `js/pvpc.js`, tests CSV/PVPC |
| Datos PVPC | Integridad de datasets diarios, zonas 8741-8745, dias de 23/24/25 horas | Diario por automatizacion; revision manual si hay huecos | REE/ESIOS indicador 1001 | `/data/pvpc/`, observatorio, home, tests de integridad |
| Datos excedentes | Integridad y precio horario de compensacion simplificada | Diario por automatizacion; revision manual si hay huecos | REE/ESIOS indicador 1739 | `/data/surplus/`, observatorio, simulador solar |
| Servicios de ajuste | Precio medio mensual SSAA para tarifas que no los incluyen en el precio publicado | Diario por automatizacion; usar ultimo mes completo disponible | REE/ESIOS indicador 10328 | `/data/ssaa/`, calculo y ranking de home y simulador solar |
| Autoconsumo y compensacion | Tope legal de compensacion, modalidades, limites y tratamiento de excedentes | Semestral y cada cambio de autoconsumo | RD 244/2019, IDAE, CNMC, BOE | `js/desglose-calculo.js`, `js/desglose-render.js`, simulador BV, guias solares |
| Bateria virtual comercial | Condiciones comerciales, acumulacion, caducidad, segunda vivienda, cuotas | Cada actualizacion de tarifas | Webs/contratos de comercializadoras | `tarifas.json`, guia solar avanzada |
| Tarifas de mercado libre | Precios, servicios obligatorios, permanencias, descuentos, indexadas, excedentes | Cada actualizacion de dataset | Webs oficiales de comercializadoras y condiciones PDF | `tarifas.json` |
| Campo `Activa` | Que tarifas estan publicadas o retiradas temporalmente | En cada revision de tarifas | Dataset | `tarifas.json` |
| Excedentes indexados `fv.exc=-1` | Si la estimacion operativa de 0,020 EUR/kWh sigue siendo razonable | Mensual o si cambia mucho el mercado | REE/ESIOS indicador 1739, OMIE y condiciones comerciales | `tarifas.json`, UI de aviso, JSON-SCHEMA, docs |
| Factura PDF/QR CNMC y censo R2 | Formato de URL QR, campos, codigos de contrato/factura, cambios en modelos y altas/cambios de comercializadoras | Trimestral y cuando fallen facturas reales; regenerar el censo antes de publicar cambios del extractor | Resolucion CNMC publicada en BOE, censo publico CNMC y facturas reales anonimizadas | `js/factura-parsers.js`, `js/factura.js`, `data/cnmc-commercializers.json`, `scripts/sync-cnmc-commercializers.mjs`, tests de factura y guias |
| Consumo horario y lecturas | Acceso a curva horaria, Datadis, portales de distribuidoras, lecturas reales/estimadas y formatos CSV/XLSX | Semestral y cuando cambien formatos de descarga | Datadis, distribuidoras, CNMC | `js/lf-csv-utils.js`, importadores, guias de consumo horario y lecturas |
| Potencia contratada y maximetro | Derechos, excesos, tramos, maximetro y casos domesticos/no domesticos | Semestral y cada cambio regulatorio | BOE, CNMC, distribuidoras | Guia de potencia, calculadora, textos de ayuda |
| Contratacion, cambios y atencion al cliente | Plazos de cambio de comercializadora, respuesta a reclamaciones, desistimiento, canales de atencion y obligaciones de empresa | Semestral y cada cambio de consumidores/energia | BOE, CNMC, RD 88/2026 y normativa posterior | Guias de cambio de compania, reclamaciones, estafas y servicios extra |
| Altas, bajas, CUPS y cambio de titular | Derechos regulados, CUPS inactivos, altas/bajas, mudanzas, alquileres, fallecimientos y cambios de titular | Semestral y cada cambio de normativa de acceso/contratacion | BOE, CNMC, distribuidoras y comercializadoras | Guias de CUPS, mudanza/alquiler, potencia, errores de factura |
| Coche electrico | ITC-BT-52, comunidad de propietarios, potencias y costes orientativos | Semestral | REBT/ITC-BT-52, Ley de Propiedad Horizontal, IDAE | Guia de punto de recarga y coche electrico |
| Equipos, climatizacion y costes orientativos | Consumos, precios medios, ayudas, subvenciones, deducciones fiscales, mantenimiento y vida util de placas, baterias, aerotermia, termo, bombas de calor y coche electrico | Trimestral y antes de actualizar guias de ahorro/inversion | IDAE, MITECO, CCAA/ayuntamientos, mercado y fabricantes | Guias de aerotermia, autoconsumo, coche electrico y potencia |
| Guias legales/reclamaciones | Plazos, organismos, procedimientos y derechos del consumidor | Semestral | CNMC, MITECO, consumo autonomico, BOE | Guias de reclamacion, errores de factura, cambios de compania |
| Estafas, telemarketing y datos personales | Derecho de desistimiento, Lista Robinson, AEPD, suplantaciones y canales de reclamacion | Semestral y ante cambios de consumo/proteccion de datos | AEPD, normativa de consumidores, Lista Robinson, organismos de consumo | Guia de estafas, privacidad, reclamaciones |
| Gas/TUR y avisos energeticos no electricos | Avisos puntuales que aparezcan en guias o landings aunque no sean calculo electrico | Revision trimestral y cada cambio normativo relevante | BOE, MITECO, CNMC, comercializadoras de referencia | Guias relacionadas, landings y datos estructurados |
| SEO y datos estructurados | `dateModified`, canonical, OpenGraph/Twitter, JSON-LD, sitemap, indice de busqueda y enlaces internos | Cada cambio de pagina o guia | Fuentes internas del repo y validadores SEO/Schema | HTML publico, `sitemap.xml`, `data/guides-search-index.json`, tests SEO |
| PWA, cache y dependencias web | Version de service worker, estrategia de cache, manifest, assetlinks, librerias autoalojadas y compatibilidad de APIs de navegador | Trimestral y al actualizar dependencias o despliegue | Docs de navegadores, upstream de librerias, pruebas e2e/seguridad | `sw.js`, `manifest.webmanifest`, `.well-known/assetlinks.json`, `vendor/`, tests SW/seguridad |
| Privacidad y analitica | GoatCounter, localStorage, CSP, dependencias autoalojadas | Trimestral y al cambiar tracking/dependencias | Politica propia, docs GoatCounter, navegador/CSP | `privacidad.html`, `tracking.js`, tests de privacidad/seguridad |
| Licencia, derechos y reutilizacion | Licencia del codigo, derechos sobre contenido/datasets curados y avisos de uso de datos | Al cambiar licencia, datasets o textos legales | `LICENSE`, `CONTENT-LICENSE.md`, fuentes de terceros | README, aviso legal, `_meta` de `tarifas.json`, docs de esquema |

## Fechas Criticas Conocidas

- 30/05/2026: confirmado el condicionante de IPC de abril de 2026; desde el 01/06/2026 se desactiva la rebaja temporal de IVA electrico e IEE en Peninsula/Baleares. `LF_CONFIG` queda preparado con IVA 21% e IEE 5,11269632%.
- 29/06/2026: actualizada la financiacion del bono social a 9,011295 EUR/CUPS en `LF_CONFIG`, conforme a la Orden TED/634/2026 (BOE-A-2026-13759).
- 15/07/2026: el INE publico en la tabla 76128 una variacion anual del 6,0% para la subclase 04.5.10 Electricidad en junio. No supera el umbral de mas del 15% del RDL 18/2026, por lo que en agosto siguen IVA 21% e IEE 5,11269632% en Peninsula/Baleares.
- 13/08/2026: comprobacion cerrada. El INE publico en la tabla 76128 el IPC definitivo de julio de 2026 para la subclase 04.5.10 Electricidad: indice 108,894, variacion mensual 3,4% y variacion anual **8,4%**. No supera el umbral de mas del 15% del RDL 18/2026, asi que durante septiembre NO se activan el IVA 10% de su articulo 11 ni el IEE 0,5% de su articulo 13: siguen IVA 21% e IEE 5,11269632% en Peninsula/Baleares. `LF_CONFIG` no requirio cambios porque ya aplicaba los tipos generales.
- 03/08/2026: cerrado el disparador Auto+. El RD 609/2026 (BOE-A-2026-16010, BOE de 23/07/2026) regula el programa y la convocatoria de la Linea 1 (particulares, BDNS 922783, registrada el 30/07/2026, 350 millones) fija plazo del 04/08/2026 a las 10:00 al 31/12/2026 a las 14:00, por orden de presentacion. Actualizadas las guias de coche electrico y punto de recarga. Ojo al redactar: la ayuda NO es un importe plano, es un porcentaje acumulado del maximo (electrico 50/25, economico 25/15, europeo 15+10 solo para modelos de la Lista Blanca).
- Pendiente Auto+: la convocatoria de la **Linea 2** (autonomos y empresas, 50 millones) no esta publicada a 03/08/2026. Cuando salga, revisar si alguna guia o landing debe mencionarla. El RD fija la vigencia del programa hasta el 31/12/2030, pero NO obliga a convocar cada anio: segun el articulo 5.2, cada convocatoria se aprueba por orden ministerial y solo puede incluir una de las dos lineas. No dar por hecha una convocatoria anual.
- Deducciones IRPF de movilidad electrica: prorrogadas hasta el 31/12/2026 por el RDL 7/2026 (15% en compra de vehiculo y 15% en instalacion de punto de recarga). Ojo: fueron derogadas dos veces en 2026 al no convalidarse el RDL 16/2025 (27/01) y el RDL 2/2026 (26/02), asi que ante cualquier duda hay que confirmar contra la ficha de la AEAT y no contra prensa. Vencen el 31/12/2026: revisar si se prorrogan otra vez.
- Cada cambio de ano: revisar peajes/cargos, calendario de periodos, festivos nacionales, datasets PVPC/surplus y textos de guias que mencionen importes anuales.
- Cada actualizacion del dataset de tarifas: confirmar que las inactivas no se publican.
- Cada cambio energetico relevante: confirmar si requiere tocar guias, landings, datos estructurados o calculos. No limitar la revision a electricidad si la noticia trata TUR/gas u otro suministro.
- Cada guia con importes orientativos: revisar que los rangos sigan siendo razonables o marcar claramente que son ejemplos no contractuales.
- Cada despliegue o cambio de assets: revisar service worker, cache y metadatos SEO generados para evitar que produccion sirva contenido antiguo.

## Protocolo Para Cambios Normativos

1. Identificar la fuente oficial y guardar fecha exacta de consulta.
2. Localizar impacto con `rg` en codigo, tests, guias y documentacion.
3. Cambiar primero la regla fuente (`js/lf-config.js`, motores PVPC/BV o datasets).
4. Actualizar tests que cubran caso normal, frontera de medio centimo y paridad entre motores. Para
   IVA/IGIC/IPSI debe seguir pasando `tests/fiscal-rounding-align.test.js` contra una referencia
   decimal independiente, no solo contra otro motor.
5. Actualizar copy publico: guias, landings, datos estructurados si procede y docs internas.
6. Ejecutar `npm test`.
7. Si se tocan guias o SEO, dejar sincronizados sitemap e indice de busqueda.
8. Commit con mensaje que mencione la norma o fuente.

## Puntos Donde Es Facil Meter La Pata

- `10 kW` no siempre significa lo mismo: PVPC tiene elegibilidad `<= 10 kW`; la rebaja temporal de IVA electrico de 2026 se desactivo desde el 01/06/2026 y el RDL 18/2026 no la reactiva en septiembre porque el IPC anual de electricidad de julio (8,4%) no supero su umbral; otras reglas pueden usar limites distintos.
- La fiscalidad vigente se aplica de forma centralizada desde `LF_CONFIG`; no duplicar porcentajes en modulos.
- IVA, IGIC e IPSI se calculan desde bases monetarias normalizadas a centimos y tipos expresados en
  puntos basicos dentro de `calcularImpuestoIndirecto()`. No sustituir esa ruta por
  `round2(base * tipo)`: puede fallar un centimo en fronteras decimales exactas aunque se use
  `Number.EPSILON`.
- PVPC no se consulta en vivo desde el navegador: se calcula contra datasets estaticos versionados.
- Una tarifa inactiva no debe aparecer en `tarifas.json`, pero si debe seguir validandose a nivel interno.
- `fv.exc=-1` no es un precio real: es una marca interna para indexado estimado con aviso visible.
- Los textos editoriales pueden quedar obsoletos aunque los calculos esten bien; buscar tanto en `js/` como en `guias/`.
