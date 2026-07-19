# 📦 Inventario de Dependencias (Vendor)

Este directorio contiene librerías de terceros alojadas localmente para garantizar la privacidad (evitar peticiones a CDNs externos), la estabilidad y el funcionamiento offline.

**Última actualización del inventario:** 16/07/2026

**Última revisión de versiones y vulnerabilidades:** 15/07/2026 — sin cambios: las 6 librerías siguen en su última versión estable, sin CVEs activas conocidas.

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

- **Versión:** 6.1.200 (actualizado 02/07/2026 desde 5.7.284; `factura.js` migrado al patrón `loadingTask.destroy()` porque 6.x elimina `PDFDocumentProxy.destroy()`)
- **Licencia:** Apache License 2.0 (Mozilla Foundation)
- **Carga:** lazy desde `js/factura.js`. `pdf.min.mjs` y `pdf.worker.min.mjs` se cargan con el `?v=` del propio `factura.js` mediante `__LF_versionedUrl(...)`; mantener core y worker siempre en la misma versión/build.
- **Archivos:**
  - `pdfjs/pdf.min.mjs` (Core)
    - **SHA-256:** `4ba2f15599b03fde8755ad91349920c21dadd3e8fd6b6460a7663d46d4cf21b5`
    - **Tamaño:** 441.70 KB (452.296 bytes)
  - `pdfjs/pdf.worker.min.mjs` (Worker)
    - **SHA-256:** `2ab9e09667296dab1a618868b3ce6e6c23d5b8f48120ae7c5b34e7e335ed01fa`
    - **Tamaño:** 1.20 MB (1.255.067 bytes)

## 📈 Chart.js
Librería de gráficos interactivos para visualización de datos.

- **Versión:** 4.5.1
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

- **Versión:** `count.js` upstream + parche local de privacidad `safe_query()` (actualizado: 14/06/2026)
- **Parche local:** `safe_query()` sustituye el envío de la query completa: solo se conservan `utm_source/medium/campaign/content/term` (ver `ANALITICA-GOATCOUNTER.md`, sección 4). El resto del filtrado de ruido legacy vive en `js/tracking.js` y `js/config.js`.
- **Carga:** lazy desde `js/tracking.js` como `/vendor/goatcounter/count.js?v=<buildId>`.
- **Actualizar:** descargar `https://gc.zgo.at/count.js` y reaplicar el parche `safe_query()` antes de publicar (no sobrescribir sin revisar).
- **Licencia:** ISC
- **Archivos:**
  - `goatcounter/count.js`
    - **SHA-256:** `d60e89d9fab691aef9a8399702dd5f0008d2a989f916897c61665964ed0a22e6`
    - **Tamaño:** 9.67 KB (9.902 bytes)
