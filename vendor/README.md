# 📦 Inventario de Dependencias (Vendor)

Este directorio contiene librerías de terceros alojadas localmente para garantizar la privacidad (evitar peticiones a CDNs externos), la estabilidad y el funcionamiento offline.

**Última actualización del inventario:** 23/04/2026

---

## 📊 SheetJS / xlsx
Librería para la manipulación de hojas de cálculo (Excel, CSV).

- **Versión:** 0.20.3 (Versión CDN Secure)
  - *Nota:* Esta versión parchea la vulnerabilidad CVE-2023-30533 presente en versiones npm antiguas (0.18.x).
- **Licencia:** SheetJS Community Edition
- **Archivos:**
  - `xlsx.full.min.js`
    - **SHA-256:** `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`
    - **Tamaño:** 929.59 KB

## 📄 PDF.js
Renderizado y lectura de documentos PDF en el navegador.

- **Versión:** 5.4.624
- **Build:** 384c6208b
- **Licencia:** Apache License 2.0 (Mozilla Foundation)
- **Archivos:**
  - `pdf.min.mjs` (Core)
    - **SHA-256:** `5f1177175790dcf5b5b0a888205f132bea690c35194e4613099d421a16423d0b`
    - **Tamaño:** 414.62 KB
  - `pdf.worker.min.mjs` (Worker)
    - **SHA-256:** `f499515a0dc93d97787d693a75218a439675719283f56812067c036dcae1f8d5`
    - **Tamaño:** 1.02 MB

## 📈 Chart.js
Librería de gráficos interactivos para visualización de datos.

- **Versión:** 4.5.1
- **Licencia:** MIT
- **Archivos:**
  - `chartjs/chart.umd.js`
    - **SHA-256:** `ecc3cd1eeb8c34d2178e3f59fd63ec5a3d84358c11730af0b9958dc886d7652a`
    - **Tamaño:** 204 KB

## 🧠 Tesseract.js (OCR)
Motor de reconocimiento óptico de caracteres (WASM + JS).

- **Versión (Wrapper):** 7.0.0
- **Versión (Core):** 5.1.0
- **Licencia:** Apache License 2.0 (Ver `worker.min.js`)
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
    - **SHA-256:** `b47a852b19181ae0999f9d970c368cd351135a320ea978b35bd38602d8bcc0bc`
    - **Tamaño:** 3.30 MB
  - `tesseract-core/tesseract-core.wasm.js`
    - **SHA-256:** `fe68f746dc186bb19e2c55de3514d3d6c4036ede53488b5a4db00dfe3f75e5f1`
    - **Tamaño:** 4.51 MB
- **Datos de Idioma:**
  - `tessdata/spa.traineddata.gz` (Español)
    - **SHA-256:** `40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb`

## 📱 jsQR
Lector de códigos QR en JavaScript puro.

- **Versión:** 1.4.0 (build local distinta del artefacto npm/jsDelivr actual)
- **Nota de verificación:** la diferencia detectada contra `jsqr@1.4.0/dist/jsQR.js` son dos líneas de código muerto (`lengths`/`size`) en la detección del alignment pattern; `size` no se usa en el retorno ni cambia la API pública.
- **Licencia:** Apache License 2.0
- **Archivos:**
  - `jsqr/jsQR.js`
    - **SHA-256:** `3325b0888fa4745c4e6940897d8c4f426fbaae76901fcbfe1871a04e90a51655`
    - **Tamaño:** 250.71 KB

## 🐐 GoatCounter
Script de analítica respetuosa con la privacidad (sin cookies).

- **Versión:** `count.js` upstream sin modificaciones (actualizado: 07/05/2026)
- **Nota:** este archivo debe permanecer lo más cercano al upstream posible. Todo el filtrado de ruido legacy vive en `js/tracking.js` y `js/config.js`, no aquí.
- **Actualizar:** `curl -s https://gc.zgo.at/count.js > vendor/goatcounter/count.js`
- **Licencia:** ISC
- **Archivos:**
  - `goatcounter/count.js`
