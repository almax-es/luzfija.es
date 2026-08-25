# Analitica GoatCounter

Ultima actualizacion: 2026-08-14

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
- Los errores de importacion CSV/XLSX se reportan como codigo normalizado (`csvErrorCodeForTracking` en `lf-csv-utils.js`), nunca como mensaje literal: los mensajes de error pueden interpolar contenido del archivo del usuario.
- La extension de archivo en eventos CSV pasa por allowlist (`safeFileExtensionForTracking`: csv/xlsx/xls, resto `desconocido`): sin ella, un nombre de archivo sin punto viajaria entero como segmento del path.
- Defensa en profundidad: `trackEvent` pasa todo `title` por `sanitizeErrorMessageForTracking` (enmascara CUPS, emails, URLs y numeros de 8+ digitos) antes de enviarlo.
- Los eventos de interaccion se envian con `no_session: true` por defecto para contar cada accion repetida como evento independiente.
- En GoatCounter, `no_session: true` no oculta el hit del total mixto del panel. Para ver trafico humano real hay que filtrar por pageviews (`is:pageview`).
- Las visitas reales del sitio se interpretan mediante pageviews canonicos, no mediante el total mixto pageviews+eventos.
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
- Referrers con esquemas no HTTP/HTTPS u origen opaco se descartan.
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
- `detalle-tarifa-abierto/home/promocion/chc-plan-estrella-duo`
- `filtro-tarifas/3p`
- `orden-tarifas/total`
- `comparador-opcion/solar/activado`
- `comparador-opcion/bono-social/desactivado`
- `comparador-bono-social-tipo/vulnerable`
- `comparador-bono-social-limite/nivel-4`
- `comparador-zona-fiscal/canarias`
- `csv-import-iniciado/home`
- `csv-import-preview/home/csv`
- `csv-import-aplicado/home/consumos-excedentes/pvpc-periodo`
- `csv-import-error/home/xlsx/valor-invalido` (tercer segmento: codigo de error normalizado de `csvErrorCodeForTracking`, nunca el mensaje literal)
- `compartir-abierto/home`
- `url-compartida/home/minimo` (solo tras compartir o copiar con éxito)
- `url-compartida/home/consumo`, `url-compartida/home/privado` o `url-compartida/home/completo` según el alcance confirmado
- `accion-interfaz/home/refrescar-tarifas`
- `tema-cambiado/claro`

No se envian importes, consumos, potencias ni valores introducidos. Las opciones se reducen a categorias o estados.
Los limites anuales predefinidos del bono social se reducen a `nivel-1`..`nivel-4`;
el path nunca incluye su cifra en kWh.

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
- `csv-import-error/solar/csv/cabecera-no-detectada` (tercer segmento: codigo de error normalizado)
- `compartir-abierto/solar`
- `url-compartida/solar/minimo` (solo tras compartir o copiar con éxito)
- `url-compartida/solar/consumo`, `url-compartida/solar/privado` o `url-compartida/solar/completo` según el alcance confirmado
- `accion-solar/exportar-datos`
- `accion-solar/borrar-datos`
- `simulador-solar-mes-inicio/6`
- `simulador-solar-zona-fiscal/peninsula`
- `simulador-solar-mi-tarifa-bv/activado`

Los enlaces de tarifa generados por el simulador llevan `data-lf-track-context="solar"` y `data-lf-track-tarifa="..."` para evitar inferencias fragiles desde el DOM.
El mes de inicio se reduce a `1`..`12` o `orden-tabla`; nunca incluye el año
`YYYY-MM` procedente del periodo importado.

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
- `csv-import-error/estadisticas/xlsx/columna-solar` (tercer segmento: codigo de error
  normalizado, igual que home y solar. Hasta el 25/07/2026 este emisor NO lo incluia y en
  analitica no se podia saber por que fallaba una importacion en el observatorio)

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

Cada fallo de codigo conserva un evento primario estable para no romper el
historico y, cuando procede, añade un unico evento compañero `error-context/*`
con dimensiones cerradas. El primario lleva fichero, linea y build:

- `error-javascript/<fichero>/<linea>/<build>` (ej. `error-javascript/bv-ui/1187/20260721-075326`)
- `error-script-load/<fichero>/0/<build>` para fallos de carga de `<script src>`; el titulo indica ademas si el navegador estaba online y bajo control del service worker
- `error-promise/<fichero-o-familia>/<linea>/<build>` (ej. `error-promise/pvpc/554/20260721-075326`). Si el navegador no aporta stack, el segundo segmento usa una familia cerrada y no sensible (`network`, `dynamic-import`, `not-a-function`, `property-access`, etc.) en vez de agrupar todo bajo `desconocido`.
- Los rechazos sin stack con firma `runtime.sendMessage` se descartan como ruido
  de extensiones: LuzFija no usa `browser.runtime`, y WebKit puede omitir el
  stack que permitiria atribuirlos directamente a la extension.
- `error-resource-load/<fichero>/0/<build>` para estilos, preloads, imagenes y
  medios first-party que no llegan a cargar.
- `error-network/<familia>/<fichero>/<estado>/<aplicacion>/<build>/<motivo>/<intento>/<visibilidad>/<ciclo-vida>/<familia-error>/<online>/<sw>/<navegador>`
  para `fetch` first-party rechazados y HTTP 408/429/5xx que afecten a una
  operación activa. No se envia query ni URL completa. No se emiten para una
  página que ya está en `pagehide`/`unloading`/`frozen` ni para los refrescos
  silenciosos de tarifas (`focus`, `visible`, `online`, `interval`): no son un
  fallo observable por el usuario y contaminarían la señal.
  Motivo, intento, visibilidad, ciclo de vida y familia se escriben ya en este primario
  sincronico para que sobrevivan aunque la pagina se cierre antes de completar
  el contexto asincrono. Cada aparicion genera ademas el contexto `fetch`
  descrito mas abajo.
- `error-csp/<directiva>/<recurso-bloqueado>/<dominio-bloqueado>/<origen-source>/<fichero-source>/<linea-source>/<disposicion>/<aplicacion>/<build>/<navegador>`
  para violaciones CSP. Son DOS EJES deliberadamente separados:
  - **objetivo** (`recurso-bloqueado` + `dominio-bloqueado`): que se bloqueo.
    `recurso-bloqueado` distingue `same-origin`, `cross-origin`, `extension`,
    `inline`, `eval`, `wasm-eval`, `data`, `blob`, `filesystem`,
    `trusted-types-policy`, `trusted-types-sink`, `other-protocol`, `uri-invalido`
    o ausencia. `dominio-bloqueado` solo se rellena en `cross-origin`: categoria
    cerrada para hosts conocidos (`gstatic`, `googleapis`, `goatcounter`,
    `github`, `cloudflare`, `jsdelivr`, `unpkg`, `google`), o los DOS ultimos
    labels del hostname para el resto, o los buckets `ip` / `localhost` /
    `host-invalido`. Nunca viaja ruta, query, puerto, usuario ni subdominio: un
    subdominio puede transportar un identificador (`cliente-123.example.com`).
  - **iniciador** (`origen-source` + `fichero-source` + `linea-source`): quien lo
    pidio. Distingue `same-origin`, `cross-origin`, `extension`, otros protocolos
    o ausencia. Si `sourceFile` es first-party se conserva exclusivamente su
    basename saneado y linea; para terceros/extensiones no se conserva ruta ni
    identificador.

  NO colapsar ambos ejes en un unico veredicto "propio/ajeno": un CSS PROPIO
  puede pedir por error una fuente EXTERNA (iniciador propio, objetivo externo) y
  un veredicto unico lo archivaria como ruido ajeno, escondiendo el bug. Ademas
  el iniciador es senal de triaje, no prueba: el navegador no rellena `sourceFile`
  en violaciones de recurso (`font-src`), y una extension puede provocar
  violaciones atribuidas al documento.

  Excepcion de robustez: una violacion cuyo recurso bloqueado sea el propio
  endpoint de GoatCounter NO se autorreporta, con independencia de que la
  directiva efectiva sea `connect-src`, `img-src` o `default-src`. Intentar
  registrar ese bloqueo mediante el mismo endpoint puede generar otra violacion
  CSP y autorrealimentar el handler; ademas cada vuelta persistiria otro
  `error-csp` en el outbox. Las violaciones de otros recursos se conservan.
- `error-legacy-filtrado/<tipo>/<build>` para ruido conocido de cache antigua.
  `tipo` es `index-extra-compat` o `currentyear-stale`. Antes era un path sin
  segmentos y ambos tipos quedaban sumados en una sola fila, con el detalle solo
  en el `title`, que es el canal que GoatCounter solo actualiza tras 10+ repeticiones.
- `error-descartado/<motivo>/<build>` cuando `shouldTrackError()` (o el filtro de
  promesas) descarta un error. NO relaja ningun filtro: el error se sigue
  descartando, solo queda constancia de por que, para poder afirmar con datos que
  el ruido no es nuestro. Motivos con PRECEDENCIA FIJA (se solapan entre si, ver
  `discardReasonFor`): `linea-imposible`, `sin-filename`, `sin-posicion`,
  `inline-sin-origen`, `origen-no-fiable`; desde promesas, `extension` y
  `stack-cross-origin`. Tope determinista, no muestreo: un motivo por carga de
  documento y 4 motivos como maximo, asi que el contador se lee como "cargas
  afectadas por este ruido", no como "numero de excepciones". No se persiste en
  el outbox.
- `error-recurrencia/<familia>/<clasificacion>/<build>/ge2|ge4|ge10` como evento
  companero que se emite UNA sola vez al cruzar cada umbral. Existe porque
  GoatCounter cuenta por path y 11 apariciones de una pestaña y 11 visitantes
  distintos producen la misma cifra. El evento primario conserva todas sus
  apariciones en un unico path (no se fragmenta el historico); el companero
  responde "una pestaña ruidosa o un fallo extendido". El contador vive en
  `sessionStorage` (`lf_err_rec_*`, maximo 24 claves), muere con la pestaña y NO
  se transmite: solo salen la categoria y el umbral. Deliberadamente NO se uso un
  id de correlacion por carga: dejaria cada path con `count=1` y destruiria la
  agrupacion que hace util el panel.
- `init-incompleto/<aplicacion>/<dependencia>/<build>` cuando un guard detecta que falta una dependencia esencial y deja la UI en estado degradado. Ejemplos: `init-incompleto/home/app-core/20260722-121753`, `init-incompleto/home/factura-module/...`, `init-incompleto/home/desglose-integration/...`, `init-incompleto/solar/manual-ui/...` e `init-incompleto/estadisticas/stats-csv/...`.

Los primarios `error-network` y `error-csp` acotan cada segmento antes de unirlo
y validan el limite final de 180 caracteres. Si una ampliacion futura rompiera
el contrato, emiten `network-schema-overflow` o `csp-schema-overflow` en vez de
crear una fila truncada e inclasificable.

Formato del compañero para JavaScript, promesas e inicializacion:

```text
error-context/<tipo>/<fichero-o-dependencia>/<linea>/<build>/c<columna>/<aplicacion>/<familia>/<navegador>/<fase>
```

La familia es cerrada (`syntax`, `reference`, `property-access`,
`not-a-function`, `network`, `security`, `quota`, `abort`, etc.); nunca es el
mensaje libre.

Los fallos de carga usan un esquema compacto especifico para garantizar que
ninguna dimension se pierda por el limite de 180 caracteres de GoatCounter:

```text
error-context/<jsl|cssl|prel|imgl|medl>/<fichero>/<linea>/<build>/c<columna>/<aplicacion>/<e|r>/<navegador>/<on|off>/<sw1|sw0>/<version-sw>/<cache>/<version-cache>/<performance>/<probe>
```

`e|r` significa temprano/runtime y el navegador se codifica como `cNNN`,
`fNNN`, `sNNN`, `eNNN`, `o` o `u`. Cache usa `ca` (activa hit), `co` (otra
hit), `cm` (miss) y codigos cerrados equivalentes para estados no disponibles.
Performance usa `s|c|n` mas el estado HTTP; la sonda usa `p<status><j|c|h|d|o>`
(`d` es JSON), `pt` (timeout) o `pn` (red). El contrato exige exactamente 16 segmentos y no
trunca el path final. Contiene:

- estado online y presencia de controlador;
- version efectiva del SW obtenida mediante `GET_VERSION`;
- `cache-activa-hit`, `cache-otra-hit`, `cache-miss` o estado no disponible;
- version de la cache que contenia el recurso, si existe;
- via/estado observado por Resource Timing (`sw`, cache o red);
- resultado de una unica sonda GET same-origin acotada (`probe-200-js`,
  `probe-404-html`, `probe-network-error`, `probe-timeout`, etc.).

El estado de Cache Storage se captura **antes** de la sonda. La sonda añade la
marca interna `__lfprobe=1`; `sw.js` la intercepta antes de cualquier estrategia
de cache y ejecuta un fetch de red puro con `cache: no-store`, sin leer ni
escribir Cache Storage. La query sirve solo para el enrutado local del SW, no se
incluye en GoatCounter ni se reutiliza como dato diagnostico.

Esto permite distinguir, por ejemplo, codigo que lanza una excepcion de una
descarga fallida; una respuesta HTML servida como JS; un SW distinto al build de
la pagina; un recurso presente solo en otra cache; o una caida de red sin
fallback. El evento primario se emite aunque la recogida asincrona de contexto
no llegue a completarse.

Los fallos de `fetch` usan su propio compañero cerrado de exactamente 18
segmentos:

```text
error-context/fetch/<familia>/<fichero>/<estado>/<build>/<aplicacion>/<motivo>/<intento>/<visibilidad>/<ciclo-vida>/<familia-error>/<on|off>/<sw1|sw0>/<version-sw>/<performance>/<probe>/<navegador>
```

- `motivo` es `startup`, `calculate`, `focus`, `visible`, `online`, `interval`
  o `direct`; cualquier valor no reconocido cae a `direct`;
- `intento` es `a1` o `a2` para `tarifas.json`; `a0` identifica llamadas sin
  contador explicito;
- `visibilidad` es `visible`, `hidden`, `prerender` o `unknown`;
- `ciclo-vida` conserva el esquema histórico (`active`, `pagehide`, `unloading` y
  `frozen`), aunque desde 2026-08-07 los nuevos `error-network` solo se emiten en
  estado `active`; los demás estados delatan cancelaciones de navegación y se
  descartan antes de persistir;
- `familia-error` es cerrada (`network`, `type`, `security`, `http`, etc.);
- se incluye la version efectiva del controlador SW, Resource Timing y una
  unica sonda same-origin de 1,5 s; `p200d`, por ejemplo, significa que la
  repeticion inmediata obtuvo HTTP 200 con JSON.

`lf-cache.js` etiqueta las peticiones de `tarifas.json` con el disparador real,
el intento y la marca que permite distinguir un timeout interno de un
`AbortError` intencionado por otro consumidor. La envoltura de `fetch` elimina
esas propiedades diagnosticas antes de invocar la API nativa, por lo que no
altera la peticion ni llegan al service worker. Hace como maximo dos intentos,
separados por 600 ms, solo para rechazo/timeout, fallo de parseo JSON o HTTP
408/429/5xx; un HTTP definitivo como 404 y un JSON valido pero sin tarifas no se
reintentan. Un `AbortError` al leer el cuerpo se clasifica como `timeout`, no
como `json-parse`. Todos los timers de abort se limpian en `finally`.

Si el segundo intento de `tarifas.json` funciona durante una carga inicial o un
cálculo explícito, `network-recovered` deja una senal cerrada de recuperación. Al
terminar el segundo intento se emite ademas un
unico resultado terminal
`error-context/fetch-terminal/tarifas/<recovered|failed>/<motivo>/<a1|a2>/<build>`:
`recovered` si el reintento funciona y `failed` si terminan sin exito todos los
intentos aplicables. Los
refrescos silenciosos no emiten este resultado terminal. Al usar el prefijo
persistente `error-context`, este resultado sobrevive en el outbox
aunque la pestana se cierre. Si ambos fallan durante un calculo y ya existe una
lista valida descargada en memoria en esa misma carga de pagina, la home continua
con ella y avisa al usuario. No se persisten ni reviven tarifas desde localStorage
o Cache Storage: `tarifas.json` sigue siendo network-only.

Un fallo terminal de `startup` o `calculate` emite ademas una unica senal de
impacto funcional, tambien persistente:

```text
error-context/tarifas-impacto/startup/<sin-datos-iniciales|fallback-sesion>/<build>
error-context/tarifas-impacto/calculate/<bloqueado-sin-datos|fallback-sesion>/<build>
```

`sin-datos-iniciales` significa que la precarga de entrada termino sin una lista
valida, pero no presupone que el usuario intentara calcular;
`bloqueado-sin-datos` se reserva para un calculo solicitado que no pudo continuar
porque no habia ninguna descarga valida disponible;
`fallback-sesion` significa que el calculo puede continuar con la ultima descarga
valida obtenida en esa misma carga de pagina. Esto permite distinguir un fallo de
red de un bloqueo real sin inferirlo por build, hora o eventos companeros. Los
fallos deterministas que no admiten reintento (por ejemplo, HTTP 404 o JSON valido
sin tarifas) conservan igualmente un resultado terminal con `a1`.
Si el usuario pulsa calcular mientras sigue en curso una precarga o refresco,
ambas llamadas reutilizan la misma peticion; si termina fallando, se conserva
ademas el impacto `calculate` correspondiente sin iniciar una segunda descarga.

No existe deduplicacion por fingerprint o por sesion: tres apariciones reales
identicas producen tres primarios y tres contextos. Solo se marca mediante un
`WeakSet` el mismo objeto `Event` para evitar que una reinstalacion accidental
de listeners contabilice artificialmente una sola aparicion varias veces. Un
fallo real posterior recibe otro objeto `Event` y se conserva.

### 6.5.1 Entrega Resiliente De Diagnosticos

Los errores de codigo, carga, red, CSP, contexto e inicializacion usan un outbox
local acotado (`lf_error_outbox_v1`):

- guarda como maximo 64 entradas durante 7 dias;
- cada entrada contiene exclusivamente `{ path, at }`;
- no persiste title, mensaje, stack, URL, query ni valores del usuario;
- conserva cada aparicion por separado, incluso si varias comparten el mismo
  path, y se reintenta al volver online o en la siguiente carga;
- elimina solo la aparicion cuya entrega confirma el fallback de imagen;
- si el fallback falla, permanece pendiente;
- al reenviarse, el path sale marcado con el sufijo `/diferido`. GoatCounter sella
  hora y referrer CUANDO RECIBE, no cuando ocurrio el error: sin la marca, un pico
  reenviado tras recuperar conectividad se lee como si acabara de pasar y se
  atribuye a la sesion equivocada. El outbox se sigue indexando por la ruta
  ORIGINAL sin marcar (es la clave con la que se elimina al confirmarse), y el
  marcador es idempotente: nunca produce `/diferido/diferido`;
- el opt-out elimina el outbox antes de salir;
- privacidad de factura bloquea el evento antes de que pueda persistirse y, en
  los diagnosticos de recursos/red, evita tambien la lectura de Cache Storage,
  el mensaje `GET_VERSION` y la sonda.
- el `filter()` del sender autoalojado comprueba tambien `__LF_PRIVACY_MODE` y
  `__LF_FACTURA_BUSY`. Es necesario porque el pageview automatico de `count.js` no pasa por
  `trackEvent()`: si el modal de factura se abre mientras el script asincrono termina de cargar,
  el propio sender debe cancelar ese pageview para mantener el contrato de cero tracking.

La cola en memoria admite 128 entradas: 64 para hidratar el maximo completo del
outbox y otras 64 de holgura para la carga actual. Si llegara a llenarse, se
expulsa primero el evento ordinario mas antiguo; un evento de producto no
desplaza un diagnostico pendiente mientras quede alguno ordinario.

El sender autoalojado trata `skipgc` como una preferencia opcional: sus lecturas y
escrituras de `localStorage` estan encapsuladas porque el propio getter de
`window.localStorage` puede lanzar `SecurityError`. Si el almacenamiento esta
denegado, el sender continua como si `skipgc` no estuviera activado; esta defensa
es independiente del opt-out principal `goatcounter_optout` de `tracking.js`.

El `count.js` autoalojado expone el resultado de entrega sin alterar el payload
que recibe GoatCounter: devuelve `true` si `sendBeacon` acepta, `false` mientras
espera el fallback y llama a callbacks locales `on_sent`/`on_error`. Los
diagnosticos pendientes añaden la bandera exclusivamente local `force_image`
para obtener confirmacion observable mediante `load`/`error`: que `sendBeacon`
devuelva `true` solo acredita que el navegador acepto encolar la peticion. La
bandera y los callbacks no forman parte de los datos serializados por
`get_data()`.

Limite inevitable: ningun sistema puramente cliente puede garantizar telemetria
al 100 %. No se puede observar un fallo que impida ejecutar incluso
`error-bootstrap.js`, un navegador que bloquee por completo GoatCounter y no
vuelva, ni una pestaña destruida antes de poder escribir el outbox. El objetivo
es que todo fallo first-party observable por el bootstrap/tracking deje una
senal accionable y recuperable sin debilitar la privacidad.

El sello de build de esta familia NO lo ponen los emisores: lo anade
`trackDetailedEvent()` a cualquier evento cuya base normalizada este en
`BUILD_STAMPED_EVENT_BASES`, con la misma validacion `YYYYMMDD-HHMMSS` que usan
los errores. El constructor reserva el espacio del sufijo antes de aplicar el
limite de 180 caracteres, de modo que un detalle largo tampoco puede eliminar el
build. Es un unico punto de verdad, y asi un emisor nuevo no puede olvidarlo.
Hasta el 22/07/2026 esta familia no llevaba build y GoatCounter sumaba
en una sola fila degradaciones de builds distintos (el export de ese dia mezclaba
`091724` y `103502` bajo `init-incompleto/estadisticas/stats-csv`), obligando a
atribuirlas correlacionando por hora, que es aproximado. El alcance es deliberado:
`csv-import-error/*` NO se sella, porque ahi el eje relevante es el fichero del
usuario, no la version del codigo.

### 6.5.2 Codigos de error del importador CSV/XLSX

El tercer segmento de `csv-import-error/*` sale de `csvErrorCodeForTracking()`
(`js/lf-csv-utils.js`), que devuelve solo slugs de una lista cerrada, nunca texto
del fichero del usuario. Las reglas se evaluan EN ORDEN y la primera que casa gana,
asi que el orden es parte del contrato:

- `columna-solar` y `agregado-por-periodo` van antes de `datos-inconsistentes`
  porque el mensaje del centinela nombra la columna sospechosa y, si esa columna se
  llama `energia_generada_kwh`, casaria con el fragmento `energia_generada`.
- `filas-invalidas` y `cabecera-no-detectada` van antes del cajon `cabecera`.

Cambio del 25/07/2026: hasta esa fecha `cabecera` agrupaba tres causas distintas
(no se encontro fila de cabecera en CSV, idem en Excel, y "la mayoria de filas no se
pudo interpretar" — este ultimo mensaje contiene a la vez "cabecera" y "separador").
En GoatCounter no habia forma de distinguir un formato no reconocido de un separador
mal detectado. Ahora:

- `cabecera-no-detectada`: no se identifico ninguna fila de cabecera en las primeras
  30 filas, o la matriz horaria no traia ningun valor numerico.
- `filas-invalidas`: la cabecera si se reconocio, pero mas de la mitad de las filas
  (o de las celdas de la matriz) no se pudieron interpretar.
- `columna-solar`: el fichero trae una columna que parece energia solar sin reconocer
  y el flujo exige excedentes (solar y observatorio). Ver seccion siguiente.
- `agregado-por-periodo`: el fichero esta agregado por P1/P2/P3 y no trae hora, asi
  que no es una curva horaria.
- `cabecera`: se conserva como fallback legacy para mensajes no reclasificados. Para
  ver tendencia historica hay que sumar `cabecera` + `cabecera-no-detectada` +
  `filas-invalidas`: el reparto retroactivo de las filas antiguas no es posible.

Los slugs nuevos no llevan sello de build, igual que el resto de errores CSV.
`isLegacyErrorPath()` (`js/config.js`) no afecta a `csv-import-error`: solo filtra
`error-javascript`, `error-script-load` y `error-promise`.

Por que el detalle va en el path y no solo en el title: GoatCounter agrupa por
`path` y **solo sustituye el `title` de una ruta cuando el titulo nuevo se repite
mas de 10 veces** (ver `updateTitle` en `path.go` de GoatCounter). Con todos los
errores bajo un unico path, el titulo mostrado puede quedar congelado en un error
antiguo y un fallo nuevo queda escondido bajo su contador, sin forma de saber si
pertenece al codigo actual o a clientes con cache vieja. Esto se detecto en julio
de 2026 investigando `error-javascript`, cuyo titulo apuntaba a un build de un mes
antes.

Construccion del path (`buildErrorEventPath`, expuesto en `__LF_trackingUtils`):

- **fichero**: solo el basename, sin ruta, sin query/hash y sin extension. Se
  redacta con `sanitizeErrorMessageForTracking()` y se acota a 40 caracteres antes
  de pasar por `eventSegment()` (que solo normaliza a minusculas, no redacta).
  Si no hay fichero en un error JS -> `desconocido`; en una promesa sin stack se
  usa una de las familias cerradas descritas arriba.
- **linea**: entero positivo; cualquier otra cosa -> `0`.
- **build**: se valida contra `YYYYMMDD-HHMMSS`; si no encaja -> `desconocido`.

Al path NUNCA van: mensaje libre, URL completa, stack, query, CUPS, email ni
ningun dato del usuario. Desde 14/08/2026 el `title` TAMPOCO lleva ya el mensaje, ni siquiera
sanitizado. El `title` puede incluir build, fichero/origen, ruta y navegador, pero la CAUSA del
error se representa exclusivamente mediante categorias cerradas de `closedErrorKind()` /
`stacklessPromiseKind()` (network, type, reference, abort, generic, etc.), nunca texto libre.
Antes de esa fecha el `title` si llevaba un fragmento saneado de hasta 48 caracteres del mensaje,
lo cual contradecia la promesa de `privacidad.html` de "categorias cerradas, sin mensajes libres"
— un sanitizador de patrones no garantiza cero texto libre. Corregido tras una auditoria externa cruzada.

Las cargas de recursos solo aceptan URL `http:`/`https:` same-origin; `blob:`,
`data:` y esquemas de extensiones se descartan antes de construir el path. Los
workers `blob:` actuales pertenecen a PDF.js/Tesseract y siguen ademas cubiertos
por `__LF_PRIVACY_MODE`/`__LF_FACTURA_BUSY`.

Las descripciones de error se sanitizan con `sanitizeErrorMessageForTracking()`:

- CUPS -> `[cups]`
- emails -> `[email]`
- URLs -> `[url]`
- numeros largos -> `[num]`

Los errores atribuidos a la URL del propio documento solo se aceptan si su
posición puede pertenecer al HTML servido. GitHub Pages conserva los saltos de
línea del repositorio y la línea 1 es el `DOCTYPE`, no JavaScript ejecutable. Por
eso se descartan eventos como `/:1:219`: extensiones, webviews o automatizaciones
pueden inyectar código y atribuir su error a la página, lo que antes producía un
falso positivo first-party. El guard conserva los errores inline de líneas
posteriores y los errores de ficheros JS propios, incluidos los minificados que
fallen legítimamente en su propia línea 1. La regla se aplica tanto en el
listener completo de `tracking.js` como en el buffer temprano de
`error-bootstrap.js`; al vaciar la cola se valida de nuevo para cubrir mezclas
de caché antigua/nueva.

Este caso se confirmó con el export del 28/07/2026: un único
`Unexpected token 'else'` en `/:1:219`, build `20260727-162833`. El HTML exacto
del build tenía `<!DOCTYPE html>` en una primera línea de 15 caracteres, el
primer script ejecutable comenzaba en la línea 18 y no contenía `else`; los
módulos pasaban además la validación ES2020. No era un fallo sintáctico del
código de LuzFija, sino una clasificación demasiado permisiva del origen.

Los errores no se deduplican por huella: cada aparicion real cuenta, incluso si
fichero, linea y build coinciden. Un `WeakSet` compartido solo evita procesar dos
veces el mismo objeto `Event` si `tracking.js` se reinstala accidentalmente; no
silencia eventos posteriores.

Las tres aplicaciones instalan `error-bootstrap.js` antes de `config.js`. Este
buffer conserva en memoria como maximo 12 fallos first-party tempranos de JS,
scripts, estilos, preloads, imagenes o medios y solo guarda tipo, pathname y
posicion: nunca mensaje, stack ni datos del usuario.
Si el opt-out esta activo, `tracking.js` elimina el outbox persistente y sale
antes de consumir este buffer. En el resto de arranques lo vacia y añade al titulo la aplicacion actual como
categoria cerrada (`origen:home|solar|estadisticas`), el estado online, si la
pagina estaba bajo control de un service worker y la familia/version del
navegador. Las entradas pasan por los mismos guardrails de privacidad y saneo
que el resto de eventos; el opt-out ya se ha resuelto antes. Estos datos se consultan al vaciar
el buffer, durante el mismo arranque; no se amplia la forma minima de las
entradas `{ kind, source, line, col }`.

El bootstrap tambien mantiene un watchdog visual acotado para los coordinadores
de home, factura, desglose, simulador solar y observatorio. Es necesario porque
un fichero no puede ejecutar su propio guard cuando falla la descarga del
fichero completo. En ese caso deshabilita los controles afectados o instala un
aviso de recarga; el error de carga sigue viajando como `error-script-load`.
El toast de este watchdog es deliberadamente persistente: representa una carga
incompleta critica y, cuando faltan por completo factura o la integracion del
desglose, es el unico aviso visible despues del click. En home, solar y
observatorio se complementa con un estado persistente dentro de la pagina.
Ademas, cada fallo de script del arranque o `init-incompleto` deja en memoria una
solicitud cerrada `{ app, dependency, build, phase }`. `phase` es siempre
`initial` o `runtime`; solo la primera permite recarga automatica. Los scripts
dinamicos posteriores (PDF.js, XLSX, OCR) conservan `error-script-load`, pero su
cargador especifico controla el reintento y no solicita recargar toda la pagina.
`lf-sw-update.js` consume la solicitud funcional, fuerza
`registration.update()`, compara mediante `GET_VERSION` el build de la pagina y
el del worker disponible y muestra un aviso persistente con boton
`Recargar ahora`. Si los builds difieren, el texto identifica expresamente una
pestana obsoleta; si coinciden o no pueden leerse, sigue ofreciendo la recarga
para repetir una descarga incompleta. Cuando la solicitud procede de un script
del arranque, la pagina sigue visible y online y no hubo interaccion, el
coordinador programa ademas una sola recarga automatica. El guard
`__LF_INIT_RECOVERY_AUTO_RELOAD__:<pathname>` vive en `sessionStorage`: si el
segundo arranque vuelve a fallar no recarga otra vez y conserva el boton manual;
un arranque posterior sano limpia la marca al completar `load`, despues de que
tambien hayan podido fallar los scripts iniciales situados tras el coordinador.
La recarga automatica emite el
companero cerrado
`error-context/client-recovery-auto/<dependencia>/<build-pagina>/<build-sw>`.
Esta cola y el guard son funcionales, no contienen URL, mensaje, stack ni datos
del usuario. Su consumo no espera a que termine `serviceWorker.register()` y
las consultas auxiliares al SW estan acotadas: si la API no responde, continua
con build desconocido en lugar de dejar la pagina degradada indefinidamente.
Si el recurso que falla es `theme.js`, el bootstrap aplica antes del CSS la parte
visual minima del tema guardado y deja el fallo igualmente registrado; evita una
regresion visible sin ocultar la señal diagnostica.

Si el sender autoalojado `vendor/goatcounter/count.js` falla de forma transitoria,
`tracking.js` retira el elemento fallido, conserva una cola acotada y realiza hasta
tres intentos con espera creciente. Un evento `online` abre una nueva oportunidad.
Los diagnosticos sobreviven ademas a la recarga mediante el outbox seguro de la
seccion 6.5.1; los eventos ordinarios de producto siguen siendo solo memoria.
El service worker mantiene el sender como network-only, pero permite recuperar
`tracking.js` desde la cache del build activo para no perder la captura de errores.
El precache fuerza `cache: reload` al descargar cada asset sin version en la URL,
evitando que el HTTP cache (`max-age`) introduzca bytes de un deploy anterior en
una cache cuyo nombre ya corresponde al build nuevo.

Cardinalidad: el build multiplica rutas por despliegue, pero en errores el volumen
es pequeno y es justo lo que permite distinguir codigo actual de cache antigua.

`tracking.js` y `/vendor/goatcounter/count.js` son dependencias opcionales de
observabilidad. El cargador del sender puede reintentar y su fallo queda
diagnosticado mientras `tracking.js` siga operativo; un fallo total del propio
`tracking.js` no puede autorreportarse. En ambos casos,
`error-bootstrap.js` los excluye expresamente de la recuperacion funcional del
Service Worker: nunca debe ofrecer una recarga de la aplicacion solo porque la
analitica este bloqueada o no haya cargado.

Limite historico (RESUELTO 03/08/2026): los `error-csp/font-src/cross-origin/...`
del 01-02/08/2026 no eran atribuibles porque el esquema bucketizaba `blockedURI`
a `cross-origin` y descartaba el host. El export del 03/08 confirmo que tampoco
llegaba `sourceFile`: el navegador no lo rellena en violaciones de recurso
(`font-src`), solo en script/eval. Con un unico eje no habia forma de separar
"un CDN que se nos colo" de "una extension inyectando", que es lo que motivo el
eje `dominio-bloqueado` y la separacion objetivo/iniciador descritos arriba.

Cautela al leer picos historicos: hasta que se anadio el sufijo `/diferido`, un
grupo de eventos concentrado en una hora podia ser tanto una sesion real como un
lote reenviado desde el outbox al recuperar conectividad, porque GoatCounter
sella la hora y el referrer al recibir. Las agrupaciones por hora/referrer
anteriores al 03/08/2026 son hipotesis, no hechos.

Tests: `tests/tracking-errors.test.js` (separacion por fichero/linea/build/familia,
privacidad del path, dos ejes de CSP, tope de descartes y umbrales de recurrencia),
`tests/tracking-privacy.test.js` (cola y reintento del sender, marca `/diferido` y
coherencia entre `privacidad.html` y `ERROR_OUTBOX_MAX`: si se cambia la constante,
el test falla hasta actualizar la politica publicada),
`tests/error-bootstrap.test.js` (entrega de errores tempranos y watchdog de
coordinadores ausentes) y
`tests/bv-ui-tooltip-textnode.test.js` (regresion del
`e.target.closest is not a function` con target que no es Element).

### 6.6 Trafico QA Sintetico Conocido

Las validaciones E2E del 22/07/2026 bloquearon intencionadamente scripts en
produccion y generaron tanto `error-script-load/*` como `init-incompleto/*`.
GoatCounter exporta `hit_stats.jsonl` agregado por hora. Ventanas sinteticas y
cubos de control contrastados con los exports de `2026-07-22T12:57:08Z` y
`2026-07-22T14:53:53Z`:

- `09:00Z`: bateria E2E completa sobre el build `20260722-091724` (cinco
  `error-script-load` mas `init-incompleto` de solar, estadisticas y factura).
- `11:00Z`: re-test sobre el build `20260722-103502` (`lf-utils` y
  `pvpc-stats-csv`, mas `init-incompleto/home/app-core`).
- `12:00Z`: el primer export mostraba 73 hits y cero eventos de error. El export
  posterior de `2026-07-22T14:53:53Z` completo la agregacion hasta 83 hits y
  siguio mostrando cero `error-*` y cero `init-incompleto/*`. La auditoria final
  anunciada sobre `20260722-121753` no dejo senales de diagnostico en GoatCounter;
  por tanto, esta hora NO debe excluirse como ventana sintetica de esas familias.

La ventana declarada inicialmente para esa auditoria (`12:00:00Z`) resulto no
coincidir con el dato, ni siquiera tras completarse la agregacion: por eso la
regla es comprobar en que horas aparecen ambas familias y ampliar o mover la
exclusion segun el export, en vez de heredar una ventana anunciada. No se debe
asumir que todo el build esta contaminado.

## 7. Cobertura HTML Y CSP

Toda pagina HTML publica real debe cargar `tracking.js` y, si lo carga, permitir
`https://luzfija.goatcounter.com` tanto en `img-src` como en `connect-src`. Si una
de esas directivas no aparece, se aplica la herencia de `default-src`. El test
`tests/tracking-html-coverage.test.js` cruza ambas condiciones para impedir que
una pagina copie una CSP que bloquee la baliza y active tracking a la vez.

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
7. Deja `no_session: true` salvo que quieras deduplicar clicks repetidos en la misma ruta. Recuerda que el total mixto de GoatCounter incluye eventos; usa `is:pageview` para visitas reales.
8. Si la pagina nueva carga tracking, actualiza CSP.
9. Si anades un HTML publico real, debe pasar `tests/tracking-html-coverage.test.js`.
10. Anade o actualiza tests cuando el evento sea nuevo, sensible o compartido por varias paginas.

## 9. Guard Legacy: prepareGoatCounterGuard Y wrapGoatCounterCount

`js/config.js` define `prepareGoatCounterGuard` y `wrapGoatCounterCount`, que
interceptan `goatcounter.count()` para filtrar ruido legacy (errores
`currentYear is not defined` y ruido de `index-extra-compat`). El orden real es
`config.js` -> `tracking.js` -> `count.js`: tracking puede crear primero
`window.goatcounter = {}` y el sender anadir el metodo `.count` mas tarde sobre
ese mismo objeto. Por eso el guard vigila tanto la asignacion de
`window.goatcounter` como la primera asignacion tardia de `.count`.

Mecanismo:

- Cuando `goatcounter.count()` recibe un payload de error, `getLegacyGoatPayloadKind` comprueba si es ruido conocido.
- Si es ruido, `remapLegacyGoatPayload` reescribe el path a
  `error-legacy-filtrado/<tipo>/<build>` -el mismo esquema segmentado que emite
  `legacyNoiseEventPath` en `js/tracking.js`- y estructura el titulo con tipo,
  origen, evento original y build ID. `js/config.js` se carga antes que
  `tracking.js` y no comparte sus helpers, asi que replica el saneado de segmento
  en `legacyNoiseSegment`: si se toca el formato hay que tocar LOS DOS ficheros.
- Si no es ruido, el payload pasa sin modificar.
- Tras recibir una funcion `.count`, el accessor temporal se sustituye por una propiedad de datos normal y se envuelve una sola vez; los eventos ordinarios conservan su comportamiento.

`isLegacyErrorPath` reconoce las rutas de error peladas y las variantes con
segmentos (`error-javascript/...`, `error-script-load/...`, `error-promise/...`), para que el
guard siga filtrando ruido legacy tras el cambio de taxonomia de la seccion 6.5.

Esto garantiza que el ruido de errores tempranos (antes de que `tracking.js` cargue) no contamine las estadisticas. Es un guard transparente: no afecta a eventos de producto ni pageviews normales.

## 10. Tests Relevantes

- `tests/tracking-events.test.js`: taxonomia de eventos y bloqueo del modal privado.
- `tests/tracking-privacy.test.js`: opt-out, cola/carga de GoatCounter y query saneada.
- `tests/tracking-pageview-eager.test.js`: carga temprana, pageview canonico y referrer saneado.
- `tests/tracking-html-coverage.test.js`: tracking/CSP en HTML publicos.
- `tests/tracking-errors.test.js`: errores y ruido legacy.
- `tests/config-legacy-rejection-filter.test.js`: orden real objeto-primero/metodo-despues del sender y transparencia para eventos normales.
- `tests/error-bootstrap.test.js`: buffer temprano y watchdog de coordinadores ausentes.
- `tests/sw-runtime-resilience.test.js`: recuperacion offline y precache con `cache: reload`.
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
