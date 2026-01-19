# 📦 Inventario de Dependencias (Vendor)

Este directorio contiene librerías de terceros alojadas localmente para garantizar la privacidad (evitar peticiones a CDNs externos), la estabilidad y el funcionamiento offline.

**Última actualización del inventario:** 18/01/2026

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

- **Versión:** 5.4.530
- **Build:** 50cc4adac
- **Licencia:** Apache License 2.0 (Mozilla Foundation)
- **Archivos:**
  - `pdf.min.mjs` (Core)
    - **SHA-256:** `9bf7819e37acc02ddff252e0253e1839e3a7b8085e9e36f85186d067c004e8ae`
    - **Tamaño:** 416.62 KB
  - `pdf.worker.min.mjs` (Worker)
    - **SHA-256:** `e833e0e7445b975c6f678c1294f2a8dfd47c0bb16634582945e0280b1f1c544a`
    - **Tamaño:** 1.02 MB

## 🧠 Tesseract.js (OCR)
Motor de reconocimiento óptico de caracteres (WASM + JS).

- **Versión (Wrapper):** 5.1.1
- **Licencia:** Apache License 2.0 (Ver `worker.min.js`)
- **Archivos JS:**
  - `tesseract/tesseract.min.js`
    - **SHA-256:** `a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8`
  - `tesseract/worker.min.js`
    - **SHA-256:** `aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc`
  - `tesseract/tesseract.esm.min.js`
    - **SHA-256:** `2537be686335e4b2637e933cdc85a52dd80267a592689c1bd63235c8591540ae`
- **Archivos Core (WASM):**
  - `tesseract-core/tesseract-core.wasm`
    - **SHA-256:** `b47a852b19181ae0999f9d970c368cd351135a320ea978b35bd38602d8bcc0bc`
    - **Tamaño:** 3.30 MB
  - `tesseract-core/tesseract-core.wasm.js`
    - **SHA-256:** `2b8c8c92b8788807061fb4bb16c5acdf000c149e100255f879f78d2c58ca9969`
- **Datos de Idioma:**
  - `tessdata/spa.traineddata.gz` (Español)
    - **SHA-256:** `40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb`

## 📱 jsQR
Lector de códigos QR en JavaScript puro.

- **Versión Detectada:** ~1.4.0 (Latest npm)
- **Archivos:**
  - `jsQR.js`
    - **SHA-256:** `3325b0888fa4745c4e6940897d8c4f426fbaae76901fcbfe1871a04e90a51655`
    - **Tamaño:** 250.71 KB

## 🐐 GoatCounter
Script de analítica respetuosa con la privacidad (sin cookies).

- **Licencia:** EUPL-1.2
- **Archivos:**
  - `count.js`
    - **SHA-256:** `fc4097aa2f8ba0712dd066852843ebe8b00fc6579b8a5b7c6afeae877b2bc54d`
    - **Tamaño:** 5.95 KB
