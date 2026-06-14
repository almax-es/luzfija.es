# Analitica GoatCounter

Ultima actualizacion: 2026-06-14

Este documento define como se mide el uso de LuzFija.es con GoatCounter. La regla principal es simple: la analitica debe servir para entender producto y errores, no para identificar personas ni reconstruir datos privados del usuario.

## 1. Objetivo

La analitica existe para responder preguntas operativas:

- Que paginas y herramientas se usan realmente.
- Que comparadores generan resultados.
- Que tarifas reciben clicks de informacion/contratacion.
- Que guias se visitan, buscan, filtran o comparten.
- Que flujos CSV/XLSX funcionan o fallan.
- Que errores JavaScript afectan a usuarios reales.

No existe para monetizar, vender leads, crear perfiles personales, atribuir usuarios individuales ni condicionar el ranking de tarifas.

## 2. Principios De Privacidad

- GoatCounter se usa sin cookies.
- El usuario puede desactivar la analitica desde `privacidad.html`; el opt-out se guarda en `localStorage` como `goatcounter_optout=true`.
- Los eventos nunca deben incluir CUPS, emails, telefonos, nombres de archivo, busquedas literales, kWh, euros introducidos, potencias, datos de factura, datos OCR, QR CNMC ni texto libre del usuario.
- Los eventos de interaccion se envian con `no_session: true` por defecto para no inflar visitas ni sesiones.
- Las visitas se cuentan mediante pageviews reales, no mediante eventos.
- El tracking no debe romper nunca la web: si GoatCounter falla o esta bloqueado, la app debe seguir funcionando.

## 3. Zona Prohibida: Factura PDF

La carga y extraccion de factura PDF es el flujo mas sensible de la web. No se trackea.

Protecciones actuales:

- `factura.js` activa `window.__LF_PRIVACY_MODE = true` al abrir/procesar el modal de factura.
- `factura.js` activa `window.__LF_FACTURA_BUSY = true` durante operaciones sensibles.
- `tracking.js` bloquea cualquier evento si alguno de esos flags esta activo.
- `tracking.js` ignora clicks y cambios dentro de `#modalFactura`.
- Los tests cubren que el modal de factura no emite eventos.

Se puede contar el pageview de `calcular-factura-luz.html` como pagina publica, pero no el uso del PDF, OCR, QR, aplicar datos, cancelar, errores internos del fichero ni campos detectados.

## 4. Pageviews

`tracking.js` carga el `count.js` autoalojado en `/vendor/goatcounter/count.js` cuando el DOM esta listo.

Antes de cargarlo, fija valores canonicos:

- `window.goatcounter.path`: ruta canonica sin query ni hash.
- `window.goatcounter.title`: titulo de la pagina.
- `window.goatcounter.referrer`: referrer saneado.

Reglas de saneo:

- Pageview actual: solo `pathname` canonico. Ejemplo: `/guias.html?q=factura&cPunta=123` se cuenta como `/guias.html`.
- Referrer same-origin: `origin + pathname`, sin query ni hash. Ejemplo: `https://luzfija.es/guias.html?q=factura#x` pasa a `https://luzfija.es/guias.html`.
- Referrer externo: solo `origin`. Ejemplo: `https://example.com/post?q=x` pasa a `https://example.com`.
- Sin referrer: cadena vacia.

Ademas, el `count.js` vendorizado usa `safe_query()` para no enviar la query completa. Solo se conservan parametros UTM no personales:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`

## 5. Estructura De Eventos

GoatCounter agrupa los eventos por `path`, no por `title`. Por eso el detalle util debe ir en el path del evento.

Formato:

```text
<familia>/<contexto>/<detalle-1>/<detalle-2>
```

Reglas:

- Usar minusculas, sin acentos, con guiones.
- Mantener cardinalidad acotada: categorias, slugs, estados booleanos o nombres de tarifa del dataset.
- No usar texto libre del usuario.
- Usar el `title` solo como descripcion humana breve, no como dimension de agrupacion.

Funciones centrales:

- `window.__LF_track(eventName, metadata)`
- `window.__LF_trackDetail(baseName, detail, metadata)`
- `window.__LF_trackingUtils.buildEventPath(base, detail)`
- `window.__LF_trackingUtils.eventSegment(value)`

Los modulos de producto deben usar `__LF_trackDetail` cuando necesiten emitir eventos propios.

## 6. Taxonomia Actual

### 6.1 Comparador Principal

Ejemplos:

- `calculo-realizado/home`
- `calculo-resultados/home`
- `tarifa-click-contratar/home/energya-vm`
- `desglose-abierto/home/energya-vm`
- `detalle-tarifa-abierto/home/solar-bv/energya-vm`
- `filtro-tarifas/3p`
- `orden-tarifas/total`
- `comparador-opcion/solar/activado`
- `comparador-opcion/bono-social/desactivado`
- `comparador-bono-social-tipo/vulnerable`
- `comparador-zona-fiscal/canarias`
- `csv-import-iniciado/home`
- `csv-import-preview/home/csv`
- `csv-import-aplicado/home/consumos-excedentes/pvpc-periodo`
- `csv-import-error/home/xlsx`
- `url-compartida/home`
- `accion-interfaz/home/refrescar-tarifas`
- `tema-cambiado/claro`

No se envian importes, consumos, potencias ni valores introducidos. Las opciones se reducen a categorias o estados.

### 6.2 Simulador Solar/BV

Ejemplos:

- `calculo-realizado/solar`
- `calculo-resultados/solar`
- `simulador-solar-resultados/anual/con-mi-tarifa/indexado-horario`
- `simulador-solar-resultados/parcial/sin-mi-tarifa/indexado-referencia`
- `tarifa-click-contratar/solar/nombre-tarifa`
- `desglose-abierto/solar/nombre-tarifa`
- `csv-import-iniciado/solar`
- `csv-import-completado/solar/csv/con-excedentes`
- `csv-import-completado/solar/xlsx/sin-excedentes`
- `csv-import-error/solar/csv`
- `accion-solar/exportar-datos`
- `accion-solar/borrar-datos`
- `simulador-solar-mes-inicio/6`
- `simulador-solar-zona-fiscal/peninsula`
- `simulador-solar-mi-tarifa-bv/activado`

Los enlaces de tarifa generados por el simulador llevan `data-lf-track-context="solar"` y `data-lf-track-tarifa="..."` para evitar inferencias fragiles desde el DOM.

### 6.3 Observatorio PVPC Y Excedentes

Ejemplos:

- `observatorio-tipo/pvpc`
- `observatorio-tipo/surplus`
- `observatorio-zona/8741`
- `observatorio-mes/all`
- `observatorio-year/2026`
- `observatorio-tendencia/monthly`
- `observatorio-comparativa-year/2025`
- `csv-import-iniciado/estadisticas`
- `csv-import-completado/estadisticas/csv`
- `csv-import-error/estadisticas/xlsx`

El CSV del observatorio solo emite extension y estado. No emite energia, precios, importes ni nombres de archivo.

### 6.4 Guias Y Contenido Editorial

Ejemplos:

- `guia-click/como-leer-tu-factura-de-la-luz-paso-a-paso`
- `navegacion-guias/indice`
- `guia-compartida/como-leer-tu-factura-de-la-luz-paso-a-paso/whatsapp`
- `guias-busqueda/index/2-5/9-16`
- `guias-busqueda/fallback/0/4-8`
- `guias-categoria/solar`
- `navegacion-herramienta/comparador`
- `navegacion-herramienta/observatorio`
- `navegacion-recurso/llms-full`
- `enlace-externo/guia/email`

La busqueda de guias se mide por buckets:

- Resultados: `0`, `1`, `2-5`, `6-10`, `10-plus`.
- Longitud de busqueda: `vacia`, `1-3`, `4-8`, `9-16`, `17-plus`.

No se envia la busqueda literal. Tampoco debe viajar por referrer gracias al saneo de `window.goatcounter.referrer`.

### 6.5 Errores

Ejemplos:

- `error-javascript`
- `error-promise`
- `error-legacy-filtrado`

Las descripciones de error se sanitizan con `sanitizeErrorMessageForTracking()`:

- CUPS -> `[cups]`
- emails -> `[email]`
- URLs -> `[url]`
- numeros largos -> `[num]`

Los errores se deduplican por sesion para evitar ruido.

## 7. Cobertura HTML Y CSP

Toda pagina HTML publica real debe cargar `tracking.js` y permitir `connect-src https://luzfija.goatcounter.com` en CSP.

Excepcion conocida:

- `guias/index.html`: redirect inmediato, `noindex`, sin tracking para evitar ruido.

La cobertura se valida con `tests/tracking-html-coverage.test.js`.

## 8. Checklist Para Nuevos Eventos

Antes de anadir un evento:

1. Pregunta que decision permite tomar ese evento.
2. Pon la dimension importante en el `path`, no solo en el `title`.
3. Usa `__LF_trackDetail`.
4. Reduce valores a categorias, slugs, estados o buckets.
5. No envies datos personales, importes, kWh, potencias, busquedas literales, nombres de archivo ni texto libre.
6. No trackees nada dentro de `#modalFactura`.
7. No actives eventos que puedan inflar visitas; deja `no_session: true`.
8. Si la pagina nueva carga tracking, actualiza CSP.
9. Si anades un HTML publico real, debe pasar `tests/tracking-html-coverage.test.js`.
10. Anade o actualiza tests cuando el evento sea nuevo, sensible o compartido por varias paginas.

## 9. Tests Relevantes

- `tests/tracking-events.test.js`: taxonomia de eventos y bloqueo del modal privado.
- `tests/tracking-privacy.test.js`: opt-out, cola/carga de GoatCounter y query saneada.
- `tests/tracking-pageview-eager.test.js`: carga temprana, pageview canonico y referrer saneado.
- `tests/tracking-html-coverage.test.js`: tracking/CSP en HTML publicos.
- `tests/tracking-errors.test.js`: errores y ruido legacy.
- `tests/guides-search.test.js`: buscador de guias y consistencia del indice.
- `tests/security.test.js`: superficie general de seguridad.

Comando recomendado para cambios de tracking:

```powershell
npx vitest run tests\tracking-events.test.js tests\tracking-privacy.test.js tests\tracking-pageview-eager.test.js tests\tracking-html-coverage.test.js tests\tracking-errors.test.js tests\guides-search.test.js
```

Para cambios que toquen CSV/BV/observatorio, completar con:

```powershell
npx vitest run tests\csv-import.test.js tests\csv-parsing.test.js tests\bv-ui.test.js tests\bv-fiscal-align.test.js tests\pvpc-stats-ui.test.js
```

Antes de subir cambios relevantes, ejecutar:

```powershell
npm test
```
