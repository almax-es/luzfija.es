# 📦 Inventario de Dependencias (Vendor)

Este directorio contiene librerías de terceros alojadas localmente para garantizar la privacidad (evitar peticiones a CDNs externos), la estabilidad y el funcionamiento offline.

**Última actualización del inventario:** 07/11/2026 (PDF.js 6.4.299 -> 6.5.438). Antes, 02/11/2026 (Chart.js 4.5.1 -> 4.6.1; Tesseract core: tres variantes `-lstm` añadidas y `corePath` pasado a directorio. Antes, 07/10/2026: textos de licencia de terceros)

**Última comprobación de versiones upstream:** 07/11/2026 (todas al día: SheetJS 0.20.3 por CDN propio, Chart.js 4.6.1, Tesseract.js 7.0.0, core 7.0.0, jsQR 1.4.0, PDF.js 6.5.438 incorporada, `count.js` idéntico byte a byte a `count.upstream.js`). Anterior, 02/11/2026 (npm y CDN de SheetJS: SheetJS 0.20.3, Tesseract.js 7.0.0, core 7.0.0 y jsQR 1.4.0 al día; Chart.js 4.6.1, publicada el 22/10/2026, incorporada; PDF.js 6.5.438, publicada el 01/11/2026, **pendiente a propósito**, ver su sección; `gc.zgo.at/count.js` idéntico byte a byte a `count.upstream.js`; tarballs de `chart.js@4.6.1` y `tesseract.js-core@7.0.0` verificados contra su `integrity` de npm). La del 15/10/2026 encontró todas al día. La del 06/10/2026 comparó además byte a byte contra los tarballs oficiales de Tesseract wrapper/core/`spa`, Chart.js y jsQR

**Última revisión general documentada de vulnerabilidades:** 07/11/2026 (mismo endpoint `security/advisories/bulk` con `pdfjs-dist@6.4.299`, `pdfjs-dist@6.5.438`, `chart.js@4.6.1`, `tesseract.js@7.0.0`, `tesseract.js-core@7.0.0` y `jsqr@1.4.0`: cero advisories). Anterior, 02/11/2026 (endpoint `security/advisories/bulk` del registro npm, que sirve los datos de GitHub Advisory Database, con las versiones exactas `pdfjs-dist@6.4.299`, `chart.js@4.6.1`, `tesseract.js@7.0.0`, `tesseract.js-core@7.0.0`, `jsqr@1.4.0` y `xlsx@0.20.3`: cero advisories. Control positivo en la misma consulta: `xlsx@0.18.5` devuelve GHSA-4r6h-8v6p-xvw6 y GHSA-5pgg-2g8v-p4x9, así que una respuesta vacía no es un fallo del método). Revisiones anteriores: 15/10/2026 (igual resultado, con `chart.js@4.5.1`), 06/10/2026, 24/09/2026 y, completa, 17/08/2026 — comprobación de GitHub Advisory Database para las versiones exactas vendorizadas cuando existe paquete versionado, más revisión del repositorio upstream para GoatCounter. PDF.js se volvió a contrastar específicamente con GitHub Advisory Database el 29/08/2026 y el 06/10/2026 al actualizarlo. Es una comprobación fechada, no una garantía permanente.

### Estado frente a upstream (07/11/2026)

| Librería | Vendorizada | Upstream | Estado |
|---|---|---|---|
| SheetJS / xlsx | 0.20.3 | 0.20.3 | ✅ al día |
| PDF.js (`pdfjs-dist`) | 6.5.438 | 6.5.438 | ✅ al día (actualizada 07/11/2026) |
| Chart.js | 4.6.1 | 4.6.1 | ✅ al día (actualizada 02/11/2026) |
| Tesseract.js (wrapper) | 7.0.0 | 7.0.0 | ✅ al día |
| Tesseract core | 7.0.0 | *ver nota* | ✅ correcta |
| jsQR | 1.4.0 | 1.4.0 | ✅ al día |
| GoatCounter | upstream + 4 parches | idéntico | ✅ al día |

### Revisión de advisories (17/08/2026; todas revalidadas 06/10/2026)

| Librería | Versión revisada | Fuente / criterio | Resultado |
|---|---|---|---|
| SheetJS / xlsx | 0.20.3 | GitHub Advisory Database; revisión de los advisories publicados para `xlsx` | ✅ no afectada por GHSA-4r6h-8v6p-xvw6 (`<0.19.3`) ni GHSA-5pgg-2g8v-p4x9 (`<0.20.2`) |
| PDF.js (`pdfjs-dist`) | 6.5.438 | GitHub Advisory Database; paquete `pdfjs-dist`, revalidado 07/11/2026 | ✅ no afectada por GHSA-wgrm-67xf-hhpq (`<=4.1.392`) ni por GHSA-hq66-cqwq-w95j / CVE-2026-16633 (rango `>=5.6.83, <6.2.108`); la consulta por la versión exacta 6.5.438 no devolvió advisories |
| Chart.js | 4.6.1 | GitHub Advisory Database; paquete `chart.js` (4.5.1 revisada 17/08 y 06/10/2026; 4.6.1 el 02/11/2026) | ✅ no se localizó un advisory publicado que afecte a 4.6.1 en la revisión fechada |
| Tesseract.js (wrapper) | 7.0.0 | GitHub Advisory Database + repositorio upstream `naptha/tesseract.js` | ✅ no se localizó un advisory publicado que afecte a 7.0.0 en la revisión fechada |
| Tesseract core | 7.0.0 | GitHub Advisory Database + repositorio upstream `naptha/tesseract.js-core` | ✅ no se localizó un advisory publicado que afecte a 7.0.0 en la revisión fechada |
| jsQR | 1.4.0 | GitHub Advisory Database + repositorio upstream `cozmo/jsQR` | ✅ no se localizó un advisory publicado que afecte a 1.4.0 en la revisión fechada |
| GoatCounter | snapshot upstream del 03/08/2026 + 4 parches locales | Repositorio upstream `arp242/goatcounter`; `count.js` no tiene paquete/versión npm propia | ✅ no se localizó un advisory publicado específico para el script vendorizado en la revisión fechada |

> Alcance: esta tabla registra advisories publicados/localizados a fecha de revisión. No convierte issues sin advisory en CVE, no sustituye una auditoría del código vendorizado y no implica que una ausencia de resultados sea una garantía futura.

**Nota sobre Tesseract core — no "actualizar" a lo que npm llama `latest`:** el dist-tag `latest` de `tesseract.js-core` apunta a **6.1.2**, publicado *diez minutos después* de 7.0.0 (7.0.0 el 15/12/2025 02:37 UTC; 6.1.2 el mismo día a las 02:47) como parche de la línea 6.x, quedándose con el tag. Pero `tesseract.js@7.0.0` declara `tesseract.js-core: ^7.0.0`, así que **7.0.0 es la versión correcta** para nuestro wrapper. Una comprobación automática ingenua de "¿es la latest?" marcaría esto como desactualizado y sería un error: bajar a 6.1.2 rompería la restricción del wrapper.

**Nota sobre SheetJS:** el paquete `xlsx` de npm está congelado en 0.18.5 (abandonado ahí). La distribución viva es la del CDN propio, `https://cdn.sheetjs.com/xlsx-latest/package/package.json`, que hoy sirve 0.20.3 — exactamente la vendorizada. Consultar npm para esta librería da un falso "estamos por delante".

---

## 📊 SheetJS / xlsx
Librería para la manipulación de hojas de cálculo (Excel, CSV).

- **Versión:** 0.20.3 (Versión CDN Secure)
  - *Nota:* Esta versión parchea la vulnerabilidad CVE-2023-30533 presente en versiones npm antiguas (0.18.x).
- **Licencia:** Apache License 2.0 (SheetJS Community Edition)
- **Carga:** lazy desde tres puntos —`js/lf-csv-import.js`, `js/bv/bv-import.js` y `js/pvpc-stats-csv.js`—, los tres con el `?v=` del build. Cada uno resuelve el build con la misma cascada que `js/tracking.js` (`window.__LF_BUILD_ID`, y si no el `?v=` del propio script) **en la evaluacion sincrona del modulo**: dentro de `ensureXLSX()`, que corre tras un gesto del usuario, `document.currentScript` ya vale `null`. Hasta el 03/09/2026 los tres usaban URL estable sin `?v=`: era el unico vendor que no arrastraba la identidad del build, asi que un cliente podia seguir ejecutando la copia anterior tras una actualizacion de SheetJS y el SW no podia saber a que build pertenecia lo que servia.
- **Red de seguridad (tests):** `tests/vendor-xlsx-versioning.test.js` ejecuta los tres modulos en jsdom y mira el `<script>` que **realmente** inyectan en el head, no el literal del fuente: un grep pasaria igual si alguien deja el helper definido pero vuelve a asignar `script.src` a mano en la ruta de carga. Cubre tambien la rama de fallback y que sin build identificable se cargue sin query en vez de romper. Verificado reintroduciendo el fallo en los tres ficheros: 3 de 3 detectados.
- **Archivos:**
  - `xlsx/xlsx.full.min.js`
    - **SHA-256:** `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`
    - **Tamaño:** 929.59 KB (951.904 bytes)

## 📄 PDF.js
Renderizado y lectura de documentos PDF en el navegador.

- **Versión:** 6.5.438 (actualizado 07/11/2026 desde 6.4.299, publicada el 01/11/2026 y adelantada por decisión del promotor frente al plazo de dos semanas; antes 6.3.289 -> 6.4.299 el 06/10/2026, 6.2.108 -> 6.3.289 el 29/08/2026, 6.1.200 -> 6.2.108 el 03/08/2026 y 5.7.284 -> 6.1.200 el 02/07/2026, cuando `factura.js` se migró al patrón `loadingTask.destroy()` porque 6.x elimina `PDFDocumentProxy.destroy()`)
- **Origen:** tarball oficial de npm `pdfjs-dist@6.5.438`, integridad `sha512-vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA==` verificada contra el registro antes de extraer `legacy/build/pdf.min.mjs` y `legacy/build/pdf.worker.min.mjs`.
- **Validación de la 6.5.438 (07/11/2026):** candidata contra la 6.4.299 anterior sobre las 14 facturas del banco local (57 páginas), con el mismo método que la 6.4.299 (hash del texto por `streamTextContent().getReader()`, píxeles no blancos a escala 2 y QR con el `jsQR` vendorizado, worker real y bootstrap de `js/`). **Chrome:** 14/14 idénticas en texto y QR, diferencia máxima de 16 píxeles en una página, cero errores. **WebKit 27.2 (Playwright)** retirando del documento y del realm del worker `Promise.withResolvers`, `Promise.try`, `Map#getOrInsertComputed`, `URL.parse`, el iterador asíncrono de `ReadableStream` y los helpers hex/base64 de `Uint8Array`: 14/14 idénticas, 0 píxeles de diferencia, cero errores. Se confirmó la versión de cada lado (`6.4.299>6.5.438`) y que se crea `Worker`. Suite completa con Node 22 en verde (2.680 tests), lint limpio y `tests/factura-lifecycle-chromium.test.js` en verde. Sin control negativo nuevo: no se retira ningún shim. Los 14 PDF se procesaron sin imprimir ni conservar nombres, contenido ni valores.
- **Compatibilidad de la 6.3 -> 6.4:** minor retrocompatible para el uso de LuzFija. Sus dos cambios `api-minor` son exponer `operatorList` al callback `operationsFilter` (no se usa aqui) y dejar de enviar un mensaje "test" separado durante la carga del worker; este ultimo toca justo la ruta del bootstrap, y por eso se valido con worker real y con fake-worker en Chromium y WebKit (ver abajo). Tambien enruta los mensajes del worker por identificadores estables de pagina, sin cambio de API publica.
- **Compatibilidad de la 6.2 -> 6.3:** minor retrocompatible para el uso de LuzFija. Los cambios marcados `api-minor` convierten a `Map`/`Set` los retornos de `getJSActions`, `getFieldObjects`, `getPermissions`, los datos `Custom` de `documentInfo` y `markInfo`; este proyecto no consume esas APIs. La API realmente usada por `js/factura.js` sigue siendo `getDocument`, `getPage`, `streamTextContent`, `getViewport`, `render`, `cleanup`, `GlobalWorkerOptions` y `loadingTask.destroy()`.
- **Licencia:** Apache License 2.0 (Mozilla Foundation)
- **Compatibilidad de navegador:** se sirve la build oficial `legacy`, no la moderna. PDF.js reserva la build moderna para los navegadores mas recientes y publica la `legacy` para el resto; Safari solo figura cubierto bajo `legacy`. **No se citan aqui versiones concretas de su matriz de soporte porque no se han contrastado**: lo que si esta verificado en este repo es que APIs necesita la build vendorizada, y eso lo fija `tests/pdfjs-real.test.js`. LuzFija no convierte la matriz upstream en una garantia para versiones anteriores: amplia la compatibilidad practica con shims propios, el workaround de texto y pruebas de regresion sobre WebKit. La build moderna 6.x usa APIs recientes (`Promise.try`, `Uint8Array#toHex`, entre otras) que pueden romper la carga en versiones de iOS/WebKit que no las incluyen.
- **Texto en Safari:** incluso la build `legacy` 6.4.299 (revisado al actualizar, igual que 6.3.289; ver validación de la 6.5.438) implementa `getTextContent()` con `for await...of` sobre un `ReadableStream`. Hay versiones afectadas de Safari/WebKit que exponen `getReader()` pero no el iterador asíncrono de Web Streams. `js/factura.js` agrega directamente los chunks de `streamTextContent().getReader()` y conserva `getTextContent()` solo como fallback de compatibilidad; no retirar ese workaround hasta que la versión vendorizada deje de depender del iterador ausente y la regresión lo demuestre.
- **Carga:** queda fuera del arranque general y `js/factura.js` inicia una precarga oportunista, no bloqueante, al abrir el modal. La seleccion del archivo espera la misma promesa y, si la precarga fallo, reintenta con una URL HTTP nueva (`lf_retry=N`, conservando `v`); desde el 17/09/2026 el bootstrap del worker aplica lo mismo a `pdf.worker.min.mjs` en cada reintento, porque en modo fake-worker un `import()` fallido queda memorizado para su URL; `__LF_pdfjsLoading` evita solicitudes duplicadas y un deadline de 60 s impide que una descarga colgada deje esa promesa compartida sin asentar. `pdf.min.mjs` usa el `?v=` del propio `factura.js`; el worker pasa por `js/pdfjs-worker-bootstrap.mjs` con esa misma query. Antes de evaluar cada realm se instalan compatibilidades defensivas para `Promise.withResolvers` y `Map#getOrInsertComputed`, ausentes en versiones de WebKit todavia en uso (no se fija aqui a partir de que version aparecen: no se ha contrastado, y los shims se autodesactivan donde la API ya existe); el bootstrap importa despues el worker `legacy` y reexporta `WorkerMessageHandler` para conservar el fallback fake-worker. El vendor permanece intacto.
- **Core y worker deben ir SIEMPRE en la misma versión exacta.** PDF.js aborta si no coinciden, con un error poco evidente. `tests/pdfjs-real.test.js` lo verifica leyendo la versión de ambos ficheros.
- **Red de seguridad (tests):** `tests/pdfjs-real.test.js` carga el `pdf.min.mjs` **real** de este directorio (no un mock) contra la fixture sintética `tests/fixtures/factura-sintetica.pdf` y recorre el mismo camino que `factura.js`: `getDocument` -> `getPage` -> `getViewport` -> `streamTextContent().getReader()` -> `cleanup` -> `loadingTask.destroy()`. El resto de la suite mockea PDF.js, así que sin este fichero se podría vendorizar una build rota y la suite seguiría en verde.
  - *Límite conocido:* `DOMMatrix` se simula porque Node no incluye el canvas del navegador. **No cubre el renderizado a canvas**, que exigiría la dependencia nativa `canvas`.
  - La regresion elimina `Promise.try`, `Promise.withResolvers`, `URL.parse`, `Map#getOrInsertComputed` y los helpers hex/base64 de `Uint8Array` en un proceso aislado antes de importar core y worker. La aplicación instala explícitamente `Promise.withResolvers` en core y worker; la build `legacy` restaura las demás APIs que necesita. El test exige todas ellas, incluida `Promise.withResolvers`, para que una sustitución accidental por la build moderna o la retirada de un shim vuelva a fallar también con Node local reciente.
  - ⚠️ **Verificar SIEMPRE con la versión de Node del CI (hoy 22), no solo con la local.** El despliegue del 03/08/2026 ya demostro que una suite verde con Node 24 podia ocultar la dependencia de `Promise.try` de la build moderna.
  - *Renderizado verificado en Chrome real el 29/08/2026:* `pdf.min.mjs` 6.3.289 con worker real, sin peticiones externas: la fixture sintética se renderizó a escala 2 en un canvas de 1190×1684 px con **18.081 píxeles no blancos** y texto extraído. Como comprobación adicional, las **13 facturas locales de prueba** cargaron y renderizaron sus **53 páginas**, con texto extraído en los 13 documentos. Resultado: **cero errores de navegador**. No se conservaron nombres, contenido ni copias de esas facturas en el repo.
  - *Validacion de la 6.4.299 (06/10/2026), candidata contra produccion 6.3.289 sobre las 14 facturas del banco local (57 paginas):* para cada pagina se compararon el hash del texto extraido por `streamTextContent().getReader()`, los pixeles no blancos del render a escala 2 y el QR leido con el `jsQR` vendorizado. **Chrome con worker real:** 14/14 identicas en texto, QR y pixeles, cero `pageerror`. **WebKit 26.6 con perfil iPhone 15**, retirando `Promise.withResolvers`, `Promise.try`, `Map#getOrInsertComputed`, `URL.parse`, el iterador asincrono de `ReadableStream` y los helpers hex/base64 de `Uint8Array` del documento y del realm del worker (bootstrap servido con la retirada antepuesta): 14/14 identicas en texto y QR, con worker real (14 `Worker` construidos por version) y tambien en modo hilo principal; la unica diferencia fue 1 pixel sobre 358.930 en una pagina (antialiasing). Control negativo: sin el shim de documento, la 6.4.299 falla con `Promise.withResolvers is not a function`, lo que prueba que la retirada era efectiva y que los shims siguen siendo necesarios. `tests/factura-lifecycle-chromium.test.js` (worker real, fake-worker y corte de red) en verde con Node 22. No se imprimieron ni conservaron nombres, contenido ni valores de las facturas.
  - *Validacion WebKit del 02/09/2026:* WebKit 26.5 con perfil iPhone proceso por la interfaz real las **14 facturas disponibles**: 14/14 en el runtime nativo y 14/14 retirando las APIs objetivo del documento y del worker antes de cargar el bootstrap real. No hubo spinners ni errores de pagina y todos los casos crearon worker. Esta comprobacion valida compatibilidad y finalizacion, no la exactitud semantica de cada campo; un iPhone fisico confirmo despues que una factura descrita por el usuario como complicada completaba la lectura en menos de un minuto. Es una estimacion, no una medicion instrumentada. No se imprimieron ni conservaron nombres, contenido o valores de las facturas.
- **Actualizar:** descargar el tarball de npm de la versión objetivo, verificar su `integrity` y copiar **ambos** ficheros de `package/legacy/build/` —nunca mezclar versiones ni sustituirlos por `package/build/`—. Actualizar aquí la version, el origen/integrity, los dos SHA-256 y tamaños, y `EXPECTED_VERSION` de `tests/pdfjs-real.test.js`. Conservar los shims de core/worker y `streamTextContent().getReader()` salvo que la nueva build demuestre que ya no son necesarios. Ejecutar `npx vitest run tests/pdfjs-real.test.js tests/factura-lifecycle.test.js`, `npm run lint` y la suite completa con Node 22; con navegador disponible, ejecutar también `tests/factura-lifecycle-chromium.test.js` con worker real y fake-worker.
- **Archivos:**
  - `pdfjs/pdf.min.mjs` (Core)
    - **SHA-256:** `522ad2c83bc8a0010e7f0cc60d0892b77c8d2bf2c9702dc12288311d94270f42`
    - **Tamaño:** 525.17 KB (537.769 bytes)
  - `pdfjs/pdf.worker.min.mjs` (Worker)
    - **SHA-256:** `b4c8353ded0d88d2e2009574a29eb4e0c3ff7e942ecdf51ef5f71566a9667f31`
    - **Tamaño:** 1.27 MB (1.327.591 bytes)

## 📈 Chart.js
Librería de gráficos interactivos para visualización de datos.

- **Versión:** 4.6.1 (actualizado 02/11/2026 desde 4.5.1. Cambios de 4.6.0 que tocan lo que usamos —solo gráficos `line`, con y sin relleno, en `js/pvpc-stats-ui.js`—: el filler ya no se sale de la línea con `offset: true` y el canvas usa dimensiones enteras; 4.6.1 solo corrige la publicación. Copiado de `package/dist/chart.umd.js` del tarball verificado contra su `integrity`)
- **Paquete npm:** `chart.js` se conserva en `dependencies` como ancla local de versión para comparar y auditar el fichero vendorizado; el frontend no lo importa desde `node_modules`.
- **Licencia:** MIT
- **Archivos:**
  - `chartjs/chart.umd.js`
    - **SHA-256:** `338399fb5bafe598d21cfc471b0590b61ceb321a985fade4f68499b151f67fbf`
    - **Tamaño:** 205.15 KB (210.078 bytes)

## 🧠 Tesseract.js (OCR)
Motor de reconocimiento óptico de caracteres (WASM + JS).

- **Versión (Wrapper):** 7.0.0
- **Versión (Core):** 7.0.0 (actualizado 02/07/2026 desde 5.1.0; el wrapper 7.x requiere core `^7.0.0`)
- **Licencia:** Apache License 2.0. Los componentes empaquetados (MIT, BSD-3-Clause) estan en los `.LICENSE.txt` que citan las cabeceras de `tesseract.min.js` y `worker.min.js`, copiados del mismo tarball `tesseract.js@7.0.0`
- **Carga:** lazy desde `js/factura.js` sin `?v=` en `workerPath`, `corePath` ni `langPath`; `corePath` y `langPath` son URLs de directorio que Tesseract usa para construir rutas internas.
- **`corePath` es un directorio, no un fichero (02/11/2026).** Con una URL que acaba en `.js`, el worker carga ese fichero tal cual; con un directorio, elige compilación según el navegador (relaxed SIMD, SIMD o básica) y, con el OEM por defecto `LSTM_ONLY` que usa `createWorker('spa', undefined, ...)`, la variante `-lstm`. Hasta esa fecha se apuntaba a `tesseract-core.wasm.js`, así que todos los navegadores cargaban la compilación básica sin SIMD y con el motor legacy incluido (4,47 MB frente a 3,72 MB). La documentación de upstream (`docs/performance.md`) desaconseja expresamente fijar un fichero. Solo hacen falta las tres variantes `-lstm`; `tests/factura-vendor-versioning.test.js` extrae del `worker.min.js` vendorizado las rutas que puede pedir y comprueba que existan todas. Si algún día se fija otro OEM (legacy), habría que vendorizar también `tesseract-core-simd.wasm.js` y `tesseract-core-relaxedsimd.wasm.js`. `tesseract-core.wasm.js` se conserva: es la variante básica no LSTM y la piden los clientes con un `factura.js` anterior hasta que se recargan.
- ⚠️ **Punto ciego conocido de la revisión de advisories (03/09/2026):** `tesseract.js-core` **compila el Tesseract C/C++ original dentro del `.wasm`**. Consultar advisories del paquete npm y del repositorio `naptha/tesseract.js-core` —que es lo que se hizo el 17/08/2026— **NO cubre las vulnerabilidades de ese componente nativo**: una auditoría npm puede quedar en verde con un advisory abierto en el código C/C++ empaquetado. Upstream ha publicado vulnerabilidades en la carga de ficheros `.traineddata` (escrituras fuera de límites en versiones anteriores del motor), y su mitigación declarada es usar modelos de fuente confiable.
  - **Por qué hoy no es explotable aquí:** el usuario aporta la imagen, nunca el modelo. `js/factura.js` fija `langPath` a `vendor/tessdata/`, el idioma a `spa` y `corePath` al fichero local; no hay ninguna ruta por la que un `.traineddata` de terceros llegue al motor. El vector documentado upstream exige justamente eso.
  - **Versión del motor, contrastada el 24/09/2026:** el `.wasm` vendorizado (idéntico byte a byte al de `tesseract.js-core@7.0.0` de npm) incrusta la cadena `5.1.0-288-g2a9c1`: un fork de Tesseract 5.1.0 con 288 commits encima, que es el que compila el propio proyecto (su README declara el fork y sus cambios). No existe un core posterior compatible con el wrapper 7.0.0, así que no hay actualización disponible; el riesgo sigue acotado por lo del punto anterior (modelo propio, nunca de terceros). En la próxima revisión, repetir esta lectura sobre el `.wasm` nuevo si cambia.
- **Archivos JS:**
  - `tesseract/tesseract.min.js`
    - **SHA-256:** `000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e`
    - **Tamaño:** 61.49 KB
  - `tesseract/worker.min.js`
    - **SHA-256:** `576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d`
    - **Tamaño:** 108.61 KB
  - `tesseract/tesseract.esm.min.js`
    - **SHA-256:** `64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29`
    - **Tamaño:** 61.74 KB
- **Archivos Core (WASM):**
  - `tesseract-core/tesseract-core.wasm`
    - **SHA-256:** `c7f5ace62ac0ad065e71e9c6725f1d7cdf82e7eda8fba532cbb9563964da7098`
    - **Tamaño:** 3.29 MB (3.449.168 bytes)
  - `tesseract-core/tesseract-core.wasm.js`
    - **SHA-256:** `0bc6ce3e5fbbd0cd89706cf2fd70960e3372f4f01ee24265b26990808aaeb286`
    - **Tamaño:** 4.47 MB (4.687.944 bytes)
  - `tesseract-core/tesseract-core-lstm.wasm.js` (añadido 02/11/2026; navegadores sin SIMD)
    - **SHA-256:** `eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680`
    - **Tamaño:** 3.72 MB (3.896.484 bytes)
  - `tesseract-core/tesseract-core-simd-lstm.wasm.js` (añadido 02/11/2026; SIMD)
    - **SHA-256:** `c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38`
    - **Tamaño:** 3.72 MB (3.899.472 bytes)
  - `tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js` (añadido 02/11/2026; relaxed SIMD)
    - **SHA-256:** `861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3`
    - **Tamaño:** 3.72 MB (3.905.767 bytes)
  - Los cuatro `.wasm.js` son idénticos byte a byte a los de `tesseract.js-core@7.0.0` (tarball verificado contra su `integrity` de npm el 02/11/2026).
- **Datos de Idioma:**
  - `tessdata/spa.traineddata.gz` (Español)
    - **SHA-256:** `40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb`

## 📱 jsQR
Lector de códigos QR en JavaScript puro.

- **Versión:** 1.4.0 (build local distinta del artefacto npm/jsDelivr actual)
- **Nota de verificación:** la diferencia detectada contra `jsqr@1.4.0/dist/jsQR.js` son dos líneas de código muerto (`lengths`/`size`) en la detección del alignment pattern; `size` no se usa en el retorno ni cambia la API pública.
- **Carga:** lazy desde `js/factura.js` con el `?v=` del propio `factura.js` mediante `__LF_versionedUrl(...)`.
- **Licencia:** Apache License 2.0
- **Archivos:**
  - `jsqr/jsQR.js`
    - **SHA-256:** `3325b0888fa4745c4e6940897d8c4f426fbaae76901fcbfe1871a04e90a51655`
    - **Tamaño:** 250.71 KB

## 🐐 GoatCounter
Script de analítica respetuosa con la privacidad (sin cookies).

- **Versión:** `count.js` upstream + **cuatro** parches locales (query saneada, confirmación de entrega, privacidad de factura y robustez de `skipgc` ante almacenamiento denegado). Línea base descargada el **03/08/2026** y verificada de nuevo, byte a byte, contra upstream el **14/09/2026** y el **06/10/2026**; parche local actualizado el **10/10/2026**. Reaplicar `count.local.patch` sobre la descarga actual reproduce exactamente el `count.js` servido.
- **Upstream es una URL rodante** (`https://gc.zgo.at/count.js`): no publica número de versión ni tag. Por eso se conserva la línea base prístina en `goatcounter/count.upstream.js`, que es lo que convierte una actualización en un *merge* a tres bandas en vez de en arqueología.
- **Parches locales (son CUATRO, hay que reaplicar LOS CUATRO):**
  1. **Privacidad —** `safe_query()` sustituye el envío de la query completa: solo se conservan `utm_source/medium/campaign/content/term` (ver `ANALITICA-GOATCOUNTER.md`, sección 4), y desde el 10/10/2026 `personal_value()` descarta el parámetro entero si su valor lleva `@`, un `%` tras la decodificación (doble codificación) o 6+ cifras en total, estén donde estén (CUPS, teléfono, DNI, IBAN); se comprueba la entrada y el valor ya limpio que se enviaría (rondas 77-79).
  2. **Confirmación de entrega —** `count()` devuelve si `sendBeacon` aceptó el envío, admite la bandera exclusivamente local `force_image` y notifica el resultado del fallback de imagen mediante callbacks locales que `get_data()` no serializa. De esto depende que el outbox de diagnósticos conserve una aparición hasta confirmar su entrega: perder este parche rompe esa garantía **en silencio**.
  3. **Privacidad de factura —** `filter()` rechaza cualquier envío si `__LF_PRIVACY_MODE` o `__LF_FACTURA_BUSY` están activos. Cierra la carrera en la que el pageview automático del sender puede ejecutarse después de abrir el modal si `count.js` termina de cargar de forma asíncrona en ese intervalo.
  4. **Robustez de `skipgc` —** las lecturas y escrituras de `localStorage` usadas por la comodidad `#toggle-goatcounter` están encapsuladas. Si el navegador deniega el almacenamiento y el getter `window.localStorage` lanza `SecurityError`, el sender sigue contando en vez de abortar `filter()` y perder el pageview automático.

  El resto del filtrado de ruido legacy vive en `js/tracking.js` y `js/config.js`, no aquí.
- **Carga:** lazy desde `js/tracking.js` como `/vendor/goatcounter/count.js?v=<buildId>`.
- **Los cuatro parches están congelados en `goatcounter/count.local.patch`** (diff unificado de la línea base al fichero servido). No es documentación decorativa: `tests/vendor-inventory.test.js` lo aplica sobre la línea base y exige que el resultado sea **byte a byte** el `count.js` servido. Mientras ese test pase, está demostrado que `count.js == count.upstream.js + parches`.
- **Actualizar (procedimiento completo):**
  1. `curl -sS https://gc.zgo.at/count.js -o /tmp/count.nuevo.js`
  2. Ver **solo** el delta de upstream: `diff -u vendor/goatcounter/count.upstream.js /tmp/count.nuevo.js`
     Si no hay diferencias, upstream no ha cambiado y **no hay nada que hacer**.
  3. Si hay delta: `cp /tmp/count.nuevo.js vendor/goatcounter/count.upstream.js`, y reaplicar los parches sobre la nueva base:
     `cd vendor/goatcounter && cp count.upstream.js count.js && git apply count.local.patch`
     Si `git apply` rechaza un hunk, upstream ha tocado justo una región parcheada: **revisar a mano**, es exactamente el caso que hay que mirar con calma.
  4. Regenerar el parche golden **conservando las cabeceras `---`/`+++`**, que son las que `git apply` necesita para localizar el fichero destino:
     ```
     cd vendor/goatcounter && diff -u --label a/count.js --label b/count.js \
       count.upstream.js count.js > count.local.patch
     ```
     No recortarlas: un parche sin cabeceras sigue valiendo para el test golden pero rompe el paso 3 con `patch fragment without header`. `tests/vendor-inventory.test.js` lo verifica.
  5. Actualizar en este documento los **tres** SHA-256 y la fecha.
  6. Verificar: `npx vitest run tests/vendor-inventory.test.js tests/tracking-privacy.test.js`. No basta con que el script cargue.
- **Red de seguridad (tests):**
  - `tests/vendor-inventory.test.js` — SHA-256 de cada fichero, que ningún fichero de `vendor/` se quede sin ficha, y sobre todo que **servido == base + parche**. Este último cierra el caso de actualizar `count.js` y su SHA olvidando la línea base: los ficheros seguirían siendo distintos y los parches presentes, pero la base ya no sería la de partida y el merge daría un resultado falso.
  - `tests/tracking-privacy.test.js` — comportamiento real de los parches: `el count.js local no envía query completa con configuraciones o búsquedas` (parche 1), `el sender confirma beacon y notifica el resultado del fallback de imagen` y `force_image evita dar por entregado un diagnóstico solo porque beacon lo aceptó` (parche 2), `el pageview automático del sender respeta la privacidad de factura aunque count.js termine de cargar después` (parche 3), y `el sender sigue contando si el getter de window.localStorage lanza SecurityError` (parche 4).
- **Licencia:** ISC
- **Archivos:**
  - `goatcounter/count.js` (servido)
    - **SHA-256:** `299b1d3724eacf69abd34b3a45f2adeba6dab2df2b8d39019e60be362f5a5112`
    - **Tamaño:** 11.71 KB (11.990 bytes)
  - `goatcounter/count.upstream.js` (línea base prístina, **no se sirve**)
    - **SHA-256:** `792b7abd26c1fb6ae62906833e09a301251e2641816e69e4f95aba518f3fe3f0`
    - **Tamaño:** 9.00 KB (9.213 bytes)
    - **Descargado:** 03/08/2026 de `https://gc.zgo.at/count.js`
  - `goatcounter/count.local.patch` (los cuatro parches locales congelados, **no se sirve**)
    - **SHA-256:** `218d4a21d511183f3826893b965d9c56fc0966e9c33fa355fca773c91d05b934`
    - **Tamaño:** 5.48 KB (5.611 bytes)

  Los dos últimos se excluyen del artefacto de Pages **por ruta explícita** (no por patrón global, para no ocultar en silencio un futuro fichero legítimo con sufijo parecido), con guard posterior en `.github/workflows/tests.yml` y asserts en `tests/deploy-artifact.test.js`.

## 📜 Licencias de terceros

Los ficheros de `vendor/` son software de terceros con su propia licencia: la PolyForm Shield de
`LICENSE` no se les aplica. Apache 2.0, MIT e ISC exigen acompanar las copias redistribuidas con el
texto de la licencia y el aviso de copyright, y `vendor/` se publica en la web, asi que los textos
viajan con los ficheros. Anadido el 07/10/2026: hasta entonces solo PDF.js llevaba su aviso dentro del
fichero. Los textos se tomaron de los tarballs oficiales de npm de cada version (Apache 2.0 identico en
todos salvo el apendice, MIT de `chart.js@4.5.1`, identico en 4.6.1); el ISC de `count.js` con el titular del repositorio
de GoatCounter. **Al anadir o actualizar una libreria, actualizar tambien este fichero.**

- **Archivos:**
  - `THIRD-PARTY-LICENSES.txt`
    - **SHA-256:** `536fd663ef63a374474a6f0e9344d6760d755a8933dbce16d10c308cb3d4942f`
    - **Tamaño:** 15.58 KB
  - `tesseract/tesseract.min.js.LICENSE.txt`
    - **SHA-256:** `cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2`
    - **Tamaño:** 149 bytes
  - `tesseract/worker.min.js.LICENSE.txt`
    - **SHA-256:** `45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac`
    - **Tamaño:** 466 bytes
