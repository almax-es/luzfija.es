# Arranque Y Orden De Carga

Ultima actualizacion: 2026-07-24

Contrato de arranque de las tres aplicaciones de LuzFija.es. Documenta QUE orden
existe, POR QUE existe y QUE se rompe si se altera.

Este documento no describe preferencias de estilo: describe dependencias reales
verificadas contra el codigo. El orden de los recursos en el HTML forma parte del
contrato de ejecucion, no del formato del fichero.

Lectura relacionada:

- `AGENTS.md`: mapa operativo e inventario de modulos.
- `AUDITORIA-IA.md`: seccion `Carga Diferida Del JavaScript De La Home` y seccion
  `SEO, Datos Estructurados Y Core Web Vitals`.
- `CAPACIDADES-WEB.md` seccion 8: service worker y resiliencia ante cargas parciales.

Los tests que vigilan este contrato viven en `tests/bootstrap-contract.test.js`.
Deliberadamente NO usan numeros de linea: el contrato son relaciones entre
ficheros, no posiciones concretas.

## 1. Por Que Existe Este Contrato

La home no usa un grafo de modulos ESM. Sus ficheros son IIFEs que publican y
consumen APIs sobre `window.LF` (y `window.BVSim`, `window.PVPC_STATS`,
`window.__LF_DesgloseFactura`, `window.__LF_FacturaParsers`).

Varios modulos **desestructuran sus dependencias en tiempo de evaluacion**:

```js
// js/lf-calc.js
const {
  clampNonNeg, round2, formatMoney,
  __LF_getFiscalContext, getInputValues
} = window.LF;
```

Esa lectura ocurre UNA sola vez, cuando el navegador ejecuta el fichero. Si el
productor todavia no se ha ejecutado, el consumidor captura `undefined` de forma
permanente. No lanza excepcion, no hay reintento y no hay recuperacion posible
sin recargar la pagina.

Por eso el orden de las etiquetas `<script>` y el atributo `defer` son parte del
contrato, no detalles cosmeticos.

## 2. Orden Real De Arranque

### 2.1 `/` (home)

Todos los scripts del `<body>` llevan `defer`, asi que se ejecutan en orden de
documento despues del parseo y antes de `DOMContentLoaded`.

```
HEAD (bloqueante, sin defer)
  <meta CSP>                      script-src 'self' + sha256 (inline + JSON-LD)
  <script inline>                 currentYear + filtro unhandledrejection legacy
  js/error-bootstrap.js           buffer de errores tempranos + watchdog
  js/config.js                    currentYear, guard GoatCounter, PVPC_DATASET_BASE
  [bloques application/ld+json]   inertes, tambien hasheados en la CSP
  js/theme.js                     aplica .light-mode a <html>
  styles.css                      \
  pro.css                          | cascada estricta (ver seccion 5)
  desglose-factura.css            /
  preload outfit-latin-400.woff2  peso del elemento LCP en movil
  preload outfit-latin-900.woff2  peso del elemento LCP en escritorio
  fonts.css

BODY (todos con defer, en orden de documento)
  js/tracking.js                  drena __LF_EARLY_ERRORS, publica __LF_trackDetail
  js/lf-config.js                 window.LF_CONFIG
  js/lf-utils.js                  crea window.LF; utilidades puras
  js/lf-ssaa.js
  js/lf-csv-utils.js              window.LF.csvUtils
  js/lf-state.js                  el, state, DEFAULTS, JSON_URL, LS_KEY, THEME_KEY, $
  js/lf-ui.js                     [desestructura en eval]
  js/lf-tooltips.js               [desestructura en eval]
  js/lf-cache.js                  [desestructura en eval]
  js/lf-inputs.js                 [desestructura en eval]
  js/lf-calc.js                   [desestructura en eval]
  js/lf-render.js                 [desestructura en eval]
  js/lf-csv-import.js             [desestructura en eval]
  js/lf-tarifa-custom.js          [desestructura en eval]
  js/pvpc.js                      acceso perezoso, tolerante al orden
  js/factura-parsers.js           window.__LF_FacturaParsers
  js/factura.js                   [lo consume en eval, con guard]
  js/desglose-calculo.js          \
  js/desglose-render.js            | namespace compartido `|| {}`,
  js/desglose-factura.js           | tolerantes entre si
  js/desglose-integration.js      /
  js/lf-sw-update.js              window.LF.initSwUpdate
  js/lf-app.js                    [lo consume en eval] + destructuring de 26 simbolos
  js/index-extra.js               modal PVPC, autonomo
  js/aecc-banner.js

DOMContentLoaded
  lf-app.js        initElements(), listeners, fetchTarifas, auto-refresh
  index-extra.js   modal PVPC
  error-bootstrap  applyFailedScriptFallbacks() si algun <script> fallo
```

### 2.2 `/comparador-tarifas-solares.html`

Los scripts del `<body>` NO llevan `defer` salvo los dos ultimos, asi que el
orden real de ejecucion mezcla parseo y cola diferida.

```
HEAD
  <meta CSP> -> error-bootstrap.js -> config.js -> [JSON-LD] -> theme.js
  -> styles.css -> pro.css -> desglose-factura.css -> preload woff2 400
  -> fonts.css -> bv-sim.css -> comparador-solar-mejorado.css

BODY (sin defer, durante el parseo)
  tracking.js -> lf-config.js -> lf-utils.js -> lf-ssaa.js -> lf-csv-utils.js
  -> lf-surplus-prices.js -> bv/bv-import.js -> bv/bv-sim-monthly.js
  -> bv/bv-ui-helpers.js -> bv/bv-ui.js

BODY (con defer, despues de todo lo anterior)
  lf-sw-update.js -> shell-lite.js

DOMContentLoaded
  bv-ui.js registra su listener durante el parseo, asi que corre PRIMERO.
  shell-lite.js corre despues y ademas difiere con setTimeout(0).
  Doble garantia: shell-lite nunca pisa los bindings de bv-ui.
```

Esta pagina no lleva el guard inline de `currentYear` en el `<head>`; lo cubre
`config.js`.

### 2.3 `/estadisticas/`

```
HEAD
  <meta CSP> -> <script inline> -> error-bootstrap.js -> config.js -> theme.js
  -> fonts.css -> styles.css -> pro.css
  -> estadisticas/estadisticas.css -> estadisticas/estadisticas-mejorado.css

BODY
  tracking.js (sin defer)
  lf-sw-update.js (defer)
  shell-lite.js (defer)
  vendor/chartjs/chart.umd.js (sin defer)
  lf-csv-utils.js, lf-surplus-prices.js,
  pvpc-stats-engine.js, pvpc-stats-csv.js, pvpc-stats-ui.js (sin defer)

Orden REAL de ejecucion
  tracking -> chart -> lf-csv-utils -> lf-surplus-prices -> pvpc-stats-engine
  -> pvpc-stats-csv -> pvpc-stats-ui -> [cola defer] lf-sw-update -> shell-lite
```

Aqui `fonts.css` va antes que `styles.css`, al reves que en las otras dos
entradas. Es inocuo porque `fonts.css` solo declara `@font-face` y la variable
`--lf-font-sans`, sin selectores en conflicto. Sigue siendo una asimetria real:
no la tomes como precedente para reordenar el resto.

## 3. Grafo Productor -> Consumidor

Un consumidor "en eval" captura el valor al ejecutarse el fichero. Un consumidor
"perezoso" lo resuelve mas tarde y puede avisar.

### 3.1 Home

| Productor | Consumidor | Simbolos | Momento | Se rompe |
| --- | --- | --- | --- | --- |
| `lf-config.js` | `lf-calc.js` | `window.LF_CONFIG` | eval | fiscalidad: IVA/IGIC/IPSI, IEE, bono social |
| `lf-utils.js` | `lf-inputs.js`, `lf-calc.js`, `lf-render.js`, `lf-tarifa-custom.js` | `parseNum`, `clampNonNeg`, `round2`, `formatMoney`, `escapeHtml`, `esNumericoValido`, `animateCounter`, `createSuccessParticles`, `formatValueForDisplay` | eval | utilidades puras y formateo de toda la UI |
| `lf-state.js` | `lf-ui.js`, `lf-tooltips.js`, `lf-cache.js`, `lf-inputs.js`, `lf-render.js`, `lf-tarifa-custom.js` | `el`, `state`, `DEFAULTS`, `SERVER_PARAMS`, `LS_KEY`, `JSON_URL`, `THEME_KEY`, `$` | eval | referencias DOM y estado global del comparador |
| `lf-csv-utils.js` | `lf-csv-import.js` | `window.LF.csvUtils` | eval | importacion CSV/XLSX y clasificacion P1/P2/P3 |
| `lf-ui.js` | `lf-cache.js`, `lf-inputs.js`, `lf-render.js`, `lf-csv-import.js`, `lf-tarifa-custom.js` | `toast`, `setStatus`, `showError`, `clearErrorStyles`, `applyButtonState` | eval | avisos, estado de carga y marcado de errores |
| `lf-tooltips.js` | `lf-render.js` | `initTooltips`, `bindTooltipElement` | eval | tooltips de la tabla de resultados |
| `lf-inputs.js` | `lf-calc.js` | `__LF_getFiscalContext`, `getInputValues` | eval | contexto fiscal del motor de calculo |
| `factura-parsers.js` | `factura.js` | `window.__LF_FacturaParsers` | eval, con guard | extraccion de factura PDF |
| `lf-sw-update.js` | `lf-app.js` | `window.LF.initSwUpdate` | eval, **sin aviso** | registro del SW, PWA, offline y auto-update |
| todos los `lf-*` | `lf-app.js` | 26 simbolos | eval | coordinador completo de la home |

`lf-utils.js`, `lf-ssaa.js`, `lf-csv-utils.js` y `lf-state.js` ejecutan cada uno
`window.LF = window.LF || {}`. Los cuatro preceden a `lf-ui.js`, que es el primer
consumidor que desestructura. Esa redundancia es la razon de que
`const { el } = window.LF` no pueda lanzar `TypeError` en produccion salvo que
fallen los cuatro a la vez. **Es una propiedad del orden actual, no del codigo:
adelantar `lf-ui.js` la destruiria.**

Los cuatro ficheros de desglose se montan sobre
`window.__LF_DesgloseFactura = window.__LF_DesgloseFactura || {}` y resuelven sus
funciones de forma perezosa. Ese grupo si es reordenable internamente. No hay
motivo para hacerlo.

### 3.2 Solar

| Productor | Consumidor | Simbolos | Momento | Se rompe |
| --- | --- | --- | --- | --- |
| `lf-csv-utils.js` | `bv/bv-import.js` | `window.LF.csvUtils` | eval | importacion CSV del simulador |
| `lf-csv-utils.js` | `bv/bv-sim-monthly.js` | `csvUtils.getPeriodoHorarioCSV` | perezoso, error explicito | clasificacion horaria del motor mensual |
| `bv/bv-ui-helpers.js` | `bv/bv-ui.js` | `window.BVSim.manualUi` | DOM ready, con guard | tabla manual, saldo BV y coste neto |
| `lf-surplus-prices.js` | `bv/bv-ui.js` | `window.LF.surplusPrices` | perezoso | excedentes indexados contra `data/surplus/` |
| `lf-sw-update.js` | `shell-lite.js` | `window.LF.initSwUpdate` | eval, **sin aviso** | registro del SW en la ruta solar |

### 3.3 Observatorio

| Productor | Consumidor | Simbolos | Momento | Se rompe |
| --- | --- | --- | --- | --- |
| `pvpc-stats-csv.js` | `pvpc-stats-ui.js` | `window.__LF_PvpcStatsCsv` | eval, con guard | CSV de excedentes del usuario |
| `pvpc-stats-engine.js` | `pvpc-stats-ui.js` | `window.PVPC_STATS` | perezoso, con guard | carga y agregacion de datos |
| `vendor/chartjs/chart.umd.js` | `pvpc-stats-ui.js` | `window.Chart` | perezoso, con guard | graficos de evolucion y perfil horario |
| `lf-csv-utils.js` | `pvpc-stats-csv.js` | `window.LF.csvUtils` | perezoso, error explicito | parseo del CSV de excedentes |
| `lf-sw-update.js` | `shell-lite.js` | `window.LF.initSwUpdate` | eval, **sin aviso** | registro del SW en el observatorio |

## 4. Invariantes

### 4.1 Cadena temprana del `<head>`

`error-bootstrap.js` -> `config.js` -> `theme.js`, los tres **sin `defer` ni
`async`**, en las tres aplicaciones.

- `error-bootstrap.js` debe ser el primer script externo. Registra el listener de
  `error` en fase de captura, asi que solo ve los fallos de los scripts que se
  cargan DESPUES de el. Ademas actua como watchdog cuando un coordinador entero
  no llega a ejecutarse y por tanto no puede mostrar su propio guard.
- `config.js` publica `currentYear`, `PVPC_DATASET_BASE` y `SSAA_DATASET_URL`, y
  envuelve `goatcounter.count` antes de que `tracking.js` cree ese objeto.
- Ponerles `defer` los moveria detras del parseo completo: perderian la ventana
  de errores tempranos que existen para capturar.

El script inline del `<head>` esta hasheado en la CSP. Moverlo o editarlo sin
regenerar los hashes hace fallar `tests/csp-inline-hash.test.js`.

### 4.2 Tema antes del CSS

`theme.js` debe ir **antes del primer `<link rel="stylesheet">`** y **sin `defer`
ni `async`**, en todas las paginas que lo cargan.

Aplica la clase `.light-mode` sobre `<html>` antes de que se construya el CSSOM.
Con `defer`, o colocado detras de las hojas de estilo, la clase puede llegar
despues del primer pintado: eso **puede permitir un primer pintado con el tema
predeterminado y provocar un flash de tema, segun el momento de carga y
pintado**. No esta garantizado en todas las cargas (depende de red, cache y de
cuando decida pintar el navegador), pero es un riesgo real que no se puede
descartar por observacion puntual, y el coste de mantener la invariante es cero.

Es ademas una regresion puramente visual: ningun calculo falla, ninguna consola
avisa y ninguna telemetria la registra. Si aparece, solo se detecta mirando.

### 4.3 Coherencia de `defer`

Para cada par productor -> consumidor de la seccion 3:

1. el productor precede al consumidor en orden de documento, y
2. **ambos tienen el mismo `defer`**.

La segunda condicion es la que se olvida. Los scripts diferidos se ejecutan todos
despues de los no diferidos, sin importar su posicion en el HTML. Quitarle
`defer` solo al consumidor lo adelanta por delante de su productor; ponerselo
solo al productor lo atrasa por detras de su consumidor. En ambos casos el
resultado es un `undefined` capturado en eval.

En la home, ademas, **todos** los `<script src>` del `<body>` llevan `defer`.
Mezclar ahi un script sin `defer` lo adelantaria por delante de los 28 restantes.

### 4.4 Cascada CSS

El orden real y necesario es:

```
styles.css  ->  pro.css  ->  CSS especifico de pagina
```

`pro.css` es una capa de correccion sobre `styles.css`, y el CSS especifico de
cada aplicacion es una capa de identidad sobre `pro.css`. Los tres solapamientos
conocidos tienen especificidad identica, asi que el ganador lo decide solo el
orden de carga:

| Selector | Regla en la capa previa | Regla en la capa posterior | Gana |
| --- | --- | --- | --- |
| `.container` | `styles.css`: `max-width:1400px` | `pro.css`: `max-width:100%` | `pro.css` |
| `.container` | `pro.css`: `max-width:100%` | `estadisticas.css`: `max-width:1480px` | `estadisticas.css` |
| `.desglose-modal` | `pro.css`: `max-width:calc(100vw - 32px)` | `desglose-factura.css`: `max-width:900px` | `desglose-factura.css` |

Consecuencias de invertir el orden: el observatorio pierde su ancho maximo y el
modal de desglose pasa a ocupar casi toda la pantalla en escritorio.

Nota de estado: por la primera fila, en la home y en el simulador solar el tope
de `1400px` de `styles.css` esta anulado hoy. Queda registrado como hecho
verificado, no como propuesta de cambio.

### 4.5 Service Worker

`lf-sw-update.js` debe preceder a sus dos consumidores: `lf-app.js` en la home y
`shell-lite.js` en solar y observatorio.

Ambos consumidores hacen:

```js
if (window.LF && typeof window.LF.initSwUpdate === 'function') { ... }
```

El `if` es correcto como defensa, pero convierte el error de orden en un no-op
**absolutamente silencioso**: sin excepcion, sin consola, sin evento
`init-incompleto/*`. El sitio se queda sin registro de SW, sin precache, sin
modo offline y sin auto-update, y no hay ninguna senal de que haya pasado.

Es la unica invariante de esta lista cuyo incumplimiento no produce ningun
sintoma observable en tiempo de ejecucion. Por eso tiene test propio.

### 4.6 Privacidad durante el arranque

`error-bootstrap.js` encola unicamente `{ kind, source, line, col }`. No guarda
mensajes, ni stacks, ni URLs completas, y descarta cualquier fuente que no sea
del mismo origen. `tracking.js` drena esa cola y aplica opt-out y saneo.

Cualquier cambio en el buffer temprano debe conservar esa forma: es lo que
permite diagnosticar cargas parciales sin enviar datos del usuario.

## 5. Fallos Ruidosos Y Fallos Silenciosos

Distincion util al revisar un cambio de carga: si algo se rompe, hay que saber si
alguien se va a enterar.

### 5.1 Ruidosos (hay guard, aviso o telemetria)

| Que falta | Que ocurre |
| --- | --- |
| `lf-app.js` completo | watchdog de `error-bootstrap`: `btnCalc` deshabilitado, `statusText` y toast |
| namespace `LF` o modulos parciales | `lf-app.js` degrada por `appDependenciesReady`, emite `init-incompleto/home/app-core` |
| `factura.js` | watchdog: el boton de factura responde con toast |
| `factura-parsers.js` | `factura.js` no continua, deja aviso accionable y emite `init-incompleto/home/factura-parsers` |
| `desglose-integration.js` | watchdog: las celdas de la tabla responden con toast |
| `desglose-calculo` / `desglose-render` | el modal sustituye "Calculando desglose..." por un aviso con boton |
| `bv-ui-helpers.js` | `bv-ui.js` avisa y emite `init-incompleto/solar/manual-ui` |
| `bv-ui.js` completo | watchdog: controles del simulador deshabilitados |
| `pvpc-stats-csv.js` / Chart.js | `pvpc-stats-ui.js` retira los "Cargando..." y emite `init-incompleto/estadisticas/*` |
| `pvpc-stats-ui.js` completo | watchdog: KPIs y selectores en estado degradado |

### 5.2 Silenciosos (no hay ninguna senal)

| Que falta o se descoloca | Que ocurre |
| --- | --- |
| `lf-sw-update.js` despues de sus consumidores | **sin service worker**, sin PWA, sin offline, sin auto-update |
| `theme.js` con `defer` o detras del CSS | primer pintado posible con el tema predeterminado y flash de tema, segun el momento de carga y pintado |
| orden de CSS invertido | cambios de layout (seccion 4.4) |
| `index-extra.js` | el modal PVPC deja de abrirse; no hay watchdog ni evento |
| un `<script>` de la home sin `defer` | se adelanta a todos los demas; puede matar la calculadora |

Los de la segunda tabla son los que justifican `tests/bootstrap-contract.test.js`:
sin el, se rompen con la suite en verde.

## 6. Checklist Para Cualquier Cambio De Carga

Antes de tocar `<script>`, `<link>`, `defer`, `async` o `preload`:

1. Identifica si el fichero es productor o consumidor en la seccion 3. Si es
   productor, todos sus consumidores deben quedar por detras.
2. Comprueba si el consumidor desestructura en eval. Si lo hace, no hay guard
   posible: el orden es la unica defensa.
3. Verifica que productor y consumidor conservan el mismo `defer`.
4. Si anades un modulo a la home, ponle `defer` como el resto y decide si debe
   entrar en `CORE_ASSETS` de `sw.js` o quedarse en `ASSETS`.
5. Si tocas el `<head>`, confirma que `theme.js` sigue delante del primer
   stylesheet y sin `defer`.
6. Si tocas CSS, confirma la cadena `styles.css -> pro.css -> especifico`.
7. Si tocas el script inline del `<head>`, regenera los hashes de la CSP con el
   script de despliegue.
8. Ejecuta `npm run lint` y `npm test`.
9. Pasa la lista manual de la seccion 7. Los tests cubren relaciones en el HTML;
   no cubren el resultado visual ni el registro real del service worker.

## 7. Comprobacion Manual Tras Un Cambio De Carga

| # | Prueba | Como | Observable |
| --- | --- | --- | --- |
| 1 | Tema sin flash | modo claro, cache fria, **varias** recargas de las tres entradas (el flash es intermitente: una pasada limpia no lo descarta) | cero frames con el tema predeterminado en las capturas de Performance |
| 2 | Cadena `lf-*` intacta | rellenar datos y pulsar Calcular | tabla con resultados, consola limpia |
| 3 | Watchdog de home | bloquear `/js/lf-app.js` en Network y recargar | `btnCalc` deshabilitado + aviso + toast |
| 4 | Watchdog de factura | bloquear `/js/factura.js`, pulsar "Subir factura" | toast de aviso |
| 5 | Watchdog de desglose | bloquear `/js/desglose-integration.js`, calcular, clic en un total | toast de aviso |
| 6 | **Service worker registrado** | Application > Service Workers tras carga limpia | worker `activated`, con la `CACHE_VERSION` del deploy |
| 7 | Auto-update del SW | desplegar con pestana abierta e inactiva mas de 30 s | recarga automatica; `__LF_SW_RELOADED_VERSION__` en sessionStorage |
| 8 | Precache | Application > Cache Storage | cadena `CORE_ASSETS` completa |
| 9 | Layout del contenedor | home y observatorio a 1920 px | comparar con captura previa |
| 10 | Modal de desglose | abrirlo en escritorio ancho | ancho maximo 900 px |
| 11 | Privacidad de factura | subir un PDF con Network filtrado por `goatcounter` | cero peticiones |
| 12 | Errores tempranos | bloquear `/js/config.js` y recargar | `error-script-load/config/...` sin datos de usuario |

El punto 6 es el unico que detecta la rotura de la invariante 4.5 en produccion.

## 8. Decision: No Reordenar Recursos Para Perseguir Lighthouse

Decision firme (2026-07-24). No se reordenan scripts, hojas de estilo, fuentes ni
preloads con el objetivo de mejorar una puntuacion de laboratorio.

Estado medido: Lighthouse/PageSpeed movil 89-92, escritorio 100, con TBT 0 ms y
CLS practicamente nulo. El punto debil observado es LCP, que es **texto** en
ambos formatos: tagline en peso 400 en movil, `h1` en peso 900 en escritorio.
Ambos pesos ya llevan `preload`.

Razones para no mover nada:

- Los tres scripts bloqueantes del `<head>` suman unos 6,7 KB gzip y van por
  delante de cualquier hoja de estilo, asi que no sufren el bloqueo
  script-tras-CSS. En las mediciones actuales tampoco aparecen como causa del
  LCP.
- Los navegadores modernos utilizan descubrimiento especulativo de recursos y,
  en las mediciones actuales, mover los preloads dentro del `<head>` no ha
  mostrado un beneficio demostrable. No se descarta como palanca por teoria,
  sino por ausencia de efecto medido: si alguien quiere reabrirlo, que traiga
  una medicion, no un razonamiento sobre como parsea el navegador.
- El peso render-blocking real esta en el CSS, unos 34 KB gzip repartidos en
  cuatro hojas. Las opciones sobre ese frente (CSS critico inline, `media=print`,
  diferir `desglose-factura.css`, purgar CSS no usado) ya se evaluaron y
  descartaron con datos; ver `AUDITORIA-IA.md`.
- La separacion o carga diferida de los modulos JS de la home es roadmap de
  riesgo alto, no una optimizacion de etiquetas; ver la seccion dedicada de
  `AUDITORIA-IA.md`.

Para reabrir la decision hace falta:

1. telemetria de campo (CrUX / Search Console), no una estimacion de bytes ni una
   pasada suelta de Lighthouse;
2. varias pasadas en frio contra una baseline equivalente;
3. una estrategia de regresion completa que cubra carga fallida y reintento,
   doble inicializacion, modo offline, clientes con HTML o SW antiguo, watchdogs
   y estados degradados.

Un recurso render-blocking, por si solo, no es un hallazgo.
