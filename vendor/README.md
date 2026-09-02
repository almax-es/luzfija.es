# 📦 Inventario de Dependencias (Vendor)

Este directorio contiene librerías de terceros alojadas localmente para garantizar la privacidad (evitar peticiones a CDNs externos), la estabilidad y el funcionamiento offline.

**Última actualización del inventario:** 29/08/2026

**Última revisión general documentada de vulnerabilidades:** 17/08/2026 — comprobación de GitHub Advisory Database para las versiones exactas vendorizadas cuando existe paquete versionado, más revisión del repositorio upstream para GoatCounter. PDF.js se volvió a contrastar específicamente con GitHub Advisory Database el 29/08/2026 al actualizarlo. Es una comprobación fechada, no una garantía permanente.

### Estado frente a upstream (29/08/2026)

| Librería | Vendorizada | Upstream | Estado |
|---|---|---|---|
| SheetJS / xlsx | 0.20.3 | 0.20.3 | ✅ al día |
| PDF.js (`pdfjs-dist`) | 6.3.289 | 6.3.289 | ✅ al día (actualizada 29/08/2026) |
| Chart.js | 4.5.1 | 4.5.1 | ✅ al día |
| Tesseract.js (wrapper) | 7.0.0 | 7.0.0 | ✅ al día |
| Tesseract core | 7.0.0 | *ver nota* | ✅ correcta |
| jsQR | 1.4.0 | 1.4.0 | ✅ al día |
| GoatCounter | upstream + 4 parches | idéntico | ✅ al día |

### Revisión de advisories (17/08/2026; PDF.js revalidado 29/08/2026)

| Librería | Versión revisada | Fuente / criterio | Resultado |
|---|---|---|---|
| SheetJS / xlsx | 0.20.3 | GitHub Advisory Database; revisión de los advisories publicados para `xlsx` | ✅ no afectada por GHSA-4r6h-8v6p-xvw6 (`<0.19.3`) ni GHSA-5pgg-2g8v-p4x9 (`<0.20.2`) |
| PDF.js (`pdfjs-dist`) | 6.3.289 | GitHub Advisory Database; paquete `pdfjs-dist`, revalidado 29/08/2026 | ✅ no afectada por GHSA-wgrm-67xf-hhpq (`<=4.1.392`) ni por GHSA-hq66-cqwq-w95j / CVE-2026-16633 (rango `>=5.6.83, <6.2.108`); la consulta por la versión exacta 6.3.289 no devolvió advisories aplicables |
| Chart.js | 4.5.1 | GitHub Advisory Database; paquete `chart.js` | ✅ no se localizó un advisory publicado que afecte a 4.5.1 en la revisión fechada |
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
- **Licencia:** SheetJS Community Edition
- **Archivos:**
  - `xlsx/xlsx.full.min.js`
    - **SHA-256:** `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`
    - **Tamaño:** 929.59 KB (951.904 bytes)

## 📄 PDF.js
Renderizado y lectura de documentos PDF en el navegador.

- **Versión:** 6.3.289 (actualizado 29/08/2026 desde 6.2.108; antes 6.1.200 -> 6.2.108 el 03/08/2026 y 5.7.284 -> 6.1.200 el 02/07/2026, cuando `factura.js` se migró al patrón `loadingTask.destroy()` porque 6.x elimina `PDFDocumentProxy.destroy()`)
- **Origen:** tarball oficial de npm `pdfjs-dist@6.3.289`, integridad `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==` verificada contra el registro antes de extraer `legacy/build/pdf.min.mjs` y `legacy/build/pdf.worker.min.mjs`.
- **Compatibilidad de la 6.2 -> 6.3:** minor retrocompatible para el uso de LuzFija. Los cambios marcados `api-minor` convierten a `Map`/`Set` los retornos de `getJSActions`, `getFieldObjects`, `getPermissions`, los datos `Custom` de `documentInfo` y `markInfo`; este proyecto no consume esas APIs. La API realmente usada por `js/factura.js` sigue siendo `getDocument`, `getPage`, `streamTextContent`, `getViewport`, `render`, `cleanup`, `GlobalWorkerOptions` y `loadingTask.destroy()`.
- **Licencia:** Apache License 2.0 (Mozilla Foundation)
- **Compatibilidad de navegador:** se sirve la build oficial `legacy`, no la moderna. PDF.js documenta la build moderna para los ultimos navegadores y Safari 16.4+ solo bajo `legacy`; todos los navegadores de iPhone comparten WebKit. La build moderna 6.x usa APIs recientes (`Promise.try`, `Uint8Array#toHex`, entre otras) que dejan la carga PDF pendiente o rota en iOS 17. La build `legacy` incorpora la traduccion y los polyfills oficiales sin cambiar la API consumida por LuzFija.
- **Texto en Safari:** incluso la build `legacy` 6.3.289 implementa `getTextContent()` con `for await...of` sobre un `ReadableStream`. Hay versiones afectadas de Safari/WebKit que exponen `getReader()` pero no el iterador asíncrono de Web Streams. `js/factura.js` agrega directamente los chunks de `streamTextContent().getReader()` y conserva `getTextContent()` solo como fallback de compatibilidad; no retirar ese workaround hasta que la versión vendorizada deje de depender del iterador ausente y la regresión lo demuestre.
- **Carga:** lazy desde `js/factura.js`. `pdf.min.mjs` se carga con el `?v=` del propio `factura.js`; el worker pasa por `js/pdfjs-worker-bootstrap.mjs` con esa misma query. Antes de evaluar cada realm se instalan compatibilidades defensivas para `Promise.withResolvers` (ausente hasta Safari/iOS 17.4) y `Map#getOrInsertComputed`; el bootstrap importa después el worker `legacy` y reexporta `WorkerMessageHandler` para conservar el fallback fake-worker. El vendor permanece intacto.
- **Core y worker deben ir SIEMPRE en la misma versión exacta.** PDF.js aborta si no coinciden, con un error poco evidente. `tests/pdfjs-real.test.js` lo verifica leyendo la versión de ambos ficheros.
- **Red de seguridad (tests):** `tests/pdfjs-real.test.js` carga el `pdf.min.mjs` **real** de este directorio (no un mock) contra la fixture sintética `tests/fixtures/factura-sintetica.pdf` y recorre el mismo camino que `factura.js`: `getDocument` -> `getPage` -> `getViewport` -> `streamTextContent().getReader()` -> `cleanup` -> `loadingTask.destroy()`. El resto de la suite mockea PDF.js, así que sin este fichero se podría vendorizar una build rota y la suite seguiría en verde.
  - *Límite conocido:* `DOMMatrix` se simula porque Node no incluye el canvas del navegador. **No cubre el renderizado a canvas**, que exigiría la dependencia nativa `canvas`.
  - La regresion elimina `Promise.try`, `Promise.withResolvers`, `URL.parse`, `Map#getOrInsertComputed` y los helpers hex/base64 de `Uint8Array` en un proceso aislado antes de importar core y worker. La aplicación instala explícitamente `Promise.withResolvers` en core y worker; la build `legacy` restaura las demás APIs que necesita. El test exige todas ellas, incluida `Promise.withResolvers`, para que una sustitución accidental por la build moderna o la retirada de un shim vuelva a fallar también con Node local reciente.
  - ⚠️ **Verificar SIEMPRE con la versión de Node del CI (hoy 22), no solo con la local.** El despliegue del 03/08/2026 ya demostro que una suite verde con Node 24 podia ocultar la dependencia de `Promise.try` de la build moderna.
  - *Renderizado verificado en Chrome real el 29/08/2026:* `pdf.min.mjs` 6.3.289 con worker real, sin peticiones externas: la fixture sintética se renderizó a escala 2 en un canvas de 1190×1684 px con **18.081 píxeles no blancos** y texto extraído. Como comprobación adicional, las **13 facturas locales de prueba** cargaron y renderizaron sus **53 páginas**, con texto extraído en los 13 documentos. Resultado: **cero errores de navegador**. No se conservaron nombres, contenido ni copias de esas facturas en el repo.
- **Actualizar:** descargar el tarball de npm de la versión objetivo, verificar su `integrity` y copiar **ambos** ficheros de `package/legacy/build/` —nunca mezclar versiones ni sustituirlos por `package/build/`—. Actualizar aquí la version, el origen/integrity, los dos SHA-256 y tamaños, y `EXPECTED_VERSION` de `tests/pdfjs-real.test.js`. Conservar los shims de core/worker y `streamTextContent().getReader()` salvo que la nueva build demuestre que ya no son necesarios. Ejecutar `npx vitest run tests/pdfjs-real.test.js tests/factura-lifecycle.test.js`, `npm run lint` y la suite completa con Node 22; con navegador disponible, ejecutar también `tests/factura-lifecycle-chromium.test.js` con worker real y fake-worker.
- **Archivos:**
  - `pdfjs/pdf.min.mjs` (Core)
    - **SHA-256:** `f401927e692efc7735e0cd528c490d0dd31b7f0972c122b7040df805be45cce4`
    - **Tamaño:** 506.40 KB (518.555 bytes)
  - `pdfjs/pdf.worker.min.mjs` (Worker)
    - **SHA-256:** `a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e`
    - **Tamaño:** 1.26 MB (1.317.034 bytes)

## 📈 Chart.js
Librería de gráficos interactivos para visualización de datos.

- **Versión:** 4.5.1
- **Paquete npm:** `chart.js` se conserva en `dependencies` como ancla local de versión para comparar y auditar el fichero vendorizado; el frontend no lo importa desde `node_modules`.
- **Licencia:** MIT
- **Archivos:**
  - `chartjs/chart.umd.js`
    - **SHA-256:** `ecc3cd1eeb8c34d2178e3f59fd63ec5a3d84358c11730af0b9958dc886d7652a`
    - **Tamaño:** 203.63 KB (208.518 bytes)

## 🧠 Tesseract.js (OCR)
Motor de reconocimiento óptico de caracteres (WASM + JS).

- **Versión (Wrapper):** 7.0.0
- **Versión (Core):** 7.0.0 (actualizado 02/07/2026 desde 5.1.0; el wrapper 7.x requiere core `^7.0.0`)
- **Licencia:** Apache License 2.0 (Ver `worker.min.js`)
- **Carga:** lazy desde `js/factura.js` sin `?v=` en `workerPath`, `corePath` ni `langPath`; `langPath` es una URL de directorio que Tesseract usa para construir rutas internas.
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

- **Versión:** `count.js` upstream + **cuatro** parches locales (query saneada, confirmación de entrega, privacidad de factura y robustez de `skipgc` ante almacenamiento denegado). Línea base descargada el **03/08/2026** y verificada de nuevo, byte a byte, contra upstream el **29/08/2026**; parche local actualizado el **25/08/2026**. Reaplicar `count.local.patch` sobre la descarga actual reproduce exactamente el `count.js` servido.
- **Upstream es una URL rodante** (`https://gc.zgo.at/count.js`): no publica número de versión ni tag. Por eso se conserva la línea base prístina en `goatcounter/count.upstream.js`, que es lo que convierte una actualización en un *merge* a tres bandas en vez de en arqueología.
- **Parches locales (son CUATRO, hay que reaplicar LOS CUATRO):**
  1. **Privacidad —** `safe_query()` sustituye el envío de la query completa: solo se conservan `utm_source/medium/campaign/content/term` (ver `ANALITICA-GOATCOUNTER.md`, sección 4).
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
    - **SHA-256:** `b9c33bc4f37484953e799e2107d004f3f6c10cc8e6bc4a7c3fb8d13abdb9ca0e`
    - **Tamaño:** 10.80 KB (11.059 bytes)
  - `goatcounter/count.upstream.js` (línea base prístina, **no se sirve**)
    - **SHA-256:** `792b7abd26c1fb6ae62906833e09a301251e2641816e69e4f95aba518f3fe3f0`
    - **Tamaño:** 9.00 KB (9.213 bytes)
    - **Descargado:** 03/08/2026 de `https://gc.zgo.at/count.js`
  - `goatcounter/count.local.patch` (los cuatro parches locales congelados, **no se sirve**)
    - **SHA-256:** `dada2413e1a1f563c1f45ab56147cc364d7d92fbd2cd51d7a94b1fdf3b76ad62`
    - **Tamaño:** 4.56 KB (4.666 bytes)

  Los dos últimos se excluyen del artefacto de Pages **por ruta explícita** (no por patrón global, para no ocultar en silencio un futuro fichero legítimo con sufijo parecido), con guard posterior en `.github/workflows/tests.yml` y asserts en `tests/deploy-artifact.test.js`.
