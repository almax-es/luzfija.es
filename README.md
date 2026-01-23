# ⚡ LuzFija.es — Comparador Avanzado de Tarifas Eléctricas (España)

Herramienta **gratuita**, **sin publicidad** y **de código abierto** para comparar tarifas de electricidad en España. Calcula estimaciones precisas de factura según potencia contratada (P1/P2), días de facturación, consumos por periodos (punta/llano/valle), **placas solares**, **compensación de excedentes**, **batería virtual** y **PVPC (tarifa regulada)**.

🔗 **Web**: [https://luzfija.es](https://luzfija.es)  
📧 **Contacto**: [hola@luzfija.es](mailto:hola@luzfija.es)  
📖 **Guías educativas**: [https://luzfija.es/guias.html](https://luzfija.es/guias.html)

---

## 🎯 Funcionalidades

### 🔋 Comparador de Tarifas
- Comparación de tarifas **1P** y **3P** (discriminación horaria) + filtros rápidos (todas / 1P / 3P)
- **PVPC** incluido (tarifa regulada) cuando la API está disponible
- Tarjeta PVPC en portada con **precios de hoy** y acceso a **detalle horario** (hoy/mañana) cuando está disponible
- Bloque de **novedades/avisos** cargado desde `novedades.json`
- Soporte completo para **placas solares** y **autoconsumo** (consumo + excedentes)
- **Compensación de excedentes** con precio por comercializadora
- **Batería Virtual** (acumulación en € para meses futuros) y visualización de:
  - **Coste real** (sin aplicar saldo BV anterior)
  - **Pagas este mes** (aplicando saldo BV acumulado previo)
- **Tarifa personalizada** (introduce precios de tu contrato para compararte)
- Ranking ordenado por **coste real** (y tooltip explicativo cuando hay BV)
- Tabla con **ordenación por columnas** (nombre, potencia, energía, impuestos, total, vs mejor)
- **Gráfico Top 5** (visual rápido)
- **Desglose detallado** por tarifa en modal (clic en nombre/total; PVPC muestra tarjeta específica)
- Enlaces directos para contratar (si la tarifa aporta URL)
- Compartir configuración por URL (querystring)
- Utilidades: reset de inputs, refrescar tarifas y limpiar cachés locales (menú)

### 📄 Extracción Automática de Facturas
- **Sube tu factura PDF** y extrae datos automáticamente
- **Extracción de código QR** (CNMC) con jsQR en 3 pasos:
  - Paso 1: Extracción URL desde texto PDF
  - Paso 2: Escaneo imagen con jsQR (múltiples escalas)
  - Paso 3: Combinación inteligente datos QR + PDF
- Reconocimiento de múltiples comercializadoras:
  - Endesa, Iberdrola, Gana Energía, TotalEnergies
  - Octopus Energy, Visalia, Eni Plenitude, Energía XXI
  - Enérgya VM, Imagina Energía, y más
- Extrae: potencias (P1/P2), días, consumos (punta/llano/valle), CUPS
- Validación con confianza (%)
- OCR para PDFs escaneados (Tesseract.js)
- Sistema de advertencias contextuales
- **Lazy loading**: PDF.js y OCR solo se cargan cuando subes factura
- **Auto-cálculo**: Calcula automáticamente tras extraer datos

### 📊 Importador de Datos CSV (e-distribución)
- Importa consumos horarios desde **CSV** y **XLSX/Excel** (e-distribución y formatos equivalentes)
- Maneja datos reales y estimados, con validación de fechas en zona horaria Madrid
- Clasifica automáticamente por periodos P1/P2/P3:
  - Detecta festivos nacionales (cálculo de Pascua + calendario fijo)
  - Considera fines de semana
  - Aplica horarios según RD 148/2021
- Extrae y aplica al comparador: **días**, consumo punta/llano/valle
- Si el fichero incluye **generación/excedentes**, rellena excedentes y activa solar automáticamente
- Muestra **periodo analizado** en función de los días con datos (si hay huecos en el CSV, se refleja)
- **⚡ Octopus Sun Club**: análisis de Sun Club con consumos horarios (se presenta como tarjeta independiente)
- **Auto-cálculo**: recalcula automáticamente tras aplicar datos

### 🔋 Simulador de Batería Virtual
- **Simulación mes a mes** con tus consumos reales (CSV/XLSX de distribuidora)
- Compara todas las tarifas con batería virtual del mercado
- Cálculo detallado para cada mes:
  - **Compensación de excedentes** limitada a energía bruta del mes
  - **Acumulación en batería virtual** (€) del excedente sobrante
  - **Aplicación de saldo BV** del mes anterior para reducir factura
  - Diferencia clave: **Coste real** vs **Lo que pagas** (con BV aplicada)
- **Ranking inteligente**: ordena por lo que realmente pagas (con BV)
- **Desglose mes a mes** con tooltips explicativos de cada concepto
- Soporte para 3 zonas fiscales (IVA/IGIC/IPSI diferenciados)
- Detección automática de festivos nacionales (algoritmo de Gauss para Pascua)
- Filtra automáticamente tarifas indexadas (solo muestra precio fijo)
- **Responsive**: Desktop (tablas), Móvil (tarjetas sin scroll horizontal)
- **Accesibilidad**: ARIA labels, focus management, tooltips táctiles

### 📚 Guías Educativas
23 guías completas sobre:
- Cómo leer tu factura paso a paso
- Qué es P1, P2 y P3
- PVPC vs mercado libre
- Qué potencia contratar
- Autoconsumo y placas solares
- Compensación de excedentes y batería virtual
- Bono social eléctrico
- Coche eléctrico y tarifas
- Errores típicos en facturas
- Estafas y llamadas comerciales
- Y más...

### 🎯 Páginas Especializadas
- **[Comparador de Tarifas Solares](https://luzfija.es/comparador-tarifas-solares.html)**: **Herramienta independiente** para análisis avanzado con CSV y Batería Virtual.
- **[Calculadora de Factura](https://luzfija.es/calcular-factura-luz.html)**: Guía y acceso directo al simulador principal.
- **[Comparar PVPC vs Fija](https://luzfija.es/comparar-pvpc-tarifa-fija.html)**: Artículo informativo sobre el mercado regulado.

---

## 📊 Cálculo de Factura

### Inputs del Usuario

**Básicos:**
- Potencia contratada **P1** y **P2** (kW)
- **Días** de facturación (1–365)
- **Zona fiscal**: Península/Baleares, Canarias, o Ceuta/Melilla (diferentes impuestos)
- Consumo por periodos (kWh):
  - **Punta** (10h–14h y 18h–22h laborables)
  - **Llano** (8h–10h, 14h–18h, 22h–24h laborables)
  - **Valle** (0h–8h laborables + todo fin de semana)

**Autoconsumo (opcional):**
- Checkbox "Tengo placas solares"
- **Excedentes** volcados a red (kWh)
- **Batería Virtual acumulada** del mes anterior (€)
- Cálculo automático de:
  - Compensación según precio de cada comercializadora
  - Batería Virtual para meses futuros
  - Ahorro real vs sin autoconsumo

### Fórmula de Cálculo

**Término de potencia:**
- P1 × precio/kW·día × días
- P2 × precio/kW·día × días

**Término de energía:**
- Consumo punta × precio punta
- Consumo llano × precio llano
- Consumo valle × precio valle

**Compensación solar (si aplica):**
- Excedentes × precio compensación
- Acumulación en Batería Virtual (€)
- Uso de BV anterior para reducir factura

**Impuestos:**
- Impuesto eléctrico (IEE): 5,11269632%
- IVA / IGIC / IPSI según zona fiscal:
  - Península/Baleares: IVA 21%
  - Canarias: IGIC 0% (vivienda ≤10kW si marcas la opción) o 3% (resto); contador al 7%
  - Ceuta/Melilla: IPSI 1% (electricidad) y 4% (alquiler contador)
- Alquiler contador (~0,81€/mes)

> **Nota**: Es una **estimación orientativa**. La factura real puede variar por redondeos, condiciones contractuales, cambios regulatorios y otros conceptos específicos de cada comercializadora.

---

## 🏆 PVPC (Tarifa Regulada)

Este proyecto muestra el PVPC como **referencia** en el ranking (comparador de tarifas fijas).

### Arquitectura de datos

**Frontend (100% estático, sin backend):**
- Carga precios horarios desde JSONs locales: `/data/pvpc/{geoId}/{YYYY-MM}.json`
- Calcula el PVPC completamente en el navegador
- Los JSONs contienen datos oficiales de REE/ESIOS (indicador 1001)

**Actualización automática (GitHub Actions):**
- Se ejecuta diariamente a las 21:00 Madrid
- Script: `scripts/pvpc_auto_fill.py`
- Detecta huecos en mes actual + anterior
- Descarga SOLO datos nuevos/faltantes de ESIOS API
- Guarda en JSONs del repo (versionados en git)

**Requisitos:**
- Token ESIOS API (variable de entorno `ESIOS_API_KEY`)
- Configurado en GitHub Actions secrets

### Metodología de cálculo (estimación)

- **Precios horarios oficiales**: REE/ESIOS (indicador PVPC 1001)
- **Periodificación 2.0TD**: punta/llano/valle (fines de semana + festivos = todo valle)
- **Precio medio por periodo**: media horaria dentro del periodo (aproximación neutral)
- **Zonas soportadas**: Península (8741), Canarias (8742), Baleares (8743), Ceuta (8744), Melilla (8745)

> Nota: El PVPC mostrado es una estimación. La factura real puede diferir ligeramente por perfiles de consumo y redondeos de distribuidoras.

---

## 🛠️ Stack Técnico

### Frontend
- **HTML5 + CSS3** con variables CSS y design system
- **Vanilla JavaScript** (ES6+, sin frameworks)
- **Arquitectura modular** (20 módulos separados)
- **Gráfico Top 5** (implementación propia en JS/SVG/CSS, sin librerías externas)
- **PDF.js 5.x** (lazy loading) para parseo de facturas
- **jsQR** (en precache) para escaneo de códigos QR
- **Tesseract.js** (on-demand) para OCR
- **SheetJS (xlsx)** (lazy loading) para importación CSV

### Arquitectura
- **PWA** con Service Worker (caché versionada) y Web App Manifest
- **Precache optimizado**: 1 MB (jsQR + HTML + CSS + JS propio)
- **Lazy loading**: PDF.js, Tesseract, Excel se cargan bajo demanda
- **Diseño responsive** mobile-first
- **Modo oscuro/claro** con persistencia en localStorage

### Hosting y Datos
- **GitHub Pages** (hosting estático, producción principal)
- **100% estático sin backend**: Todo cálculo (tarifas, PVPC, facturas) ocurre en el navegador
- **Datos PVPC**: JSONs versionados en `/data/pvpc/` (actualización diaria)
  - Actualizados automáticamente por GitHub Actions (21:00 Madrid)
  - Descarga de ESIOS API y detección de huecos
  - Token ESIOS en secrets (no expuesto en repo)

---

### Seguridad
- **Content Security Policy** en 31/31 páginas (100% cobertura)
- **frame-ancestors 'none'** (anti-clickjacking)
- **form-action 'self'** (anti-exfiltración)
- **Mitigación XSS**: escapeHtml() en inserciones de texto dinámico (tarifas/datos), y uso preferente de textContent cuando aplica
- **Dependencias auto-hospedadas** en `/vendor/`
- **Same-origin enforcement**
- **wasm-unsafe-eval** solo en 2 páginas que usan OCR/PDF

### Rendimiento y Optimizaciones
- **Service Worker v5.8** con precache 1 MB (optimizado -93%)
- **jsQR en precache** (251 KB, escaneo QR instantáneo offline)
- **Lazy loading** de recursos pesados (PDF.js ~1.5 MB, Tesseract ~8 MB, Excel ~1 MB)
- **INP Optimizado (Chunking)**: El cálculo de tarifas se procesa en lotes de 8 elementos con `yieldControl()` para evitar bloquear el hilo principal (Main Thread), manteniendo la interfaz fluida incluso en móviles de gama baja.
- **Fuentes autoalojadas** (sin peticiones a terceros)
- **JavaScript diferido** (tracking.js con defer)

### Lógica Especial
- **Octopus Sun Club**: Detección automática de horas solares (distintas a P1/P2/P3) al importar CSV para calcular esta tarifa específica (configurada en `js/lf-config.js`, no en el JSON estándar).

### Accesibilidad
- **WCAG 2.1 nivel AA**
- aria-labels en inputs de búsqueda
- Semántica HTML correcta
- Navegación por teclado funcional

---

## 📁 Estructura del Código

```
luzfija.es/
├── index.html                  # Comparador principal
├── calcular-factura-luz.html   # Calculadora simple
├── comparar-pvpc-tarifa-fija.html
├── comparador-tarifas-solares.html  # Comparador Solar (CSV/Manual)
├── guias.html                  # Índice de guías
├── 404.html                    # Página de error
├── aviso-legal.html
├── privacidad.html
│
├── js/                         # Arquitectura modular
│   ├── config.js               # Config global (URLs, flags)
│   ├── lf-app.js               # Orquestador principal
│   ├── lf-state.js             # Estado + persistencia (localStorage)
│   ├── lf-config.js            # Valores regulados (IEE/IVA/IGIC/IPSI, etc.)
│   ├── lf-calc.js              # Motor de cálculo de tarifas
│   ├── lf-render.js            # Render tabla + gráfico Top 5
│   ├── lf-inputs.js            # Inputs, validación, autosuma, ayudas
│   ├── lf-tooltips.js          # Tooltips y micro-ayuda contextual
│   ├── lf-ui.js                # Modales, menú, UX
│   ├── lf-cache.js             # Caché (tarifas/PVPC) y utilidades offline
│   ├── lf-tarifa-custom.js     # Tarifa personalizada (tu contrato)
│   ├── lf-csv-import.js        # Import CSV/XLSX (e-distribución) + Sun Club
│   ├── pvpc.js                 # Cliente PVPC + caché (localStorage)
│   ├── index-extra.js          # Widget PVPC + novedades en home
│   ├── theme.js                # Gestión tema claro/oscuro
│   ├── tracking.js             # Analytics (GoatCounter, defer)
│   ├── factura.js              # Extractor factura PDF + QR/OCR
│   ├── desglose-factura.js     # Modal desglose detallado
│   ├── desglose-integration.js # Integración desglose con tabla
│   └── bv/                     # Simulador Batería Virtual
│       ├── bv-import.js        # Importador CSV/XLSX para BV
│       ├── bv-sim-monthly.js   # Motor cálculo mes a mes
│       └── bv-ui.js            # UI y renderizado

├── css/
│   └── bv-sim.css              # Estilos simulador BV
├── styles.css                  # Estilos globales (~121 KB)
├── desglose-factura.css        # CSS modal desglose
├── sw.js                       # Service Worker (PWA/offline)
├── tarifas.json                # Base de datos de tarifas
│
├── vendor/                     # Dependencias auto-hospedadas
│   ├── jsqr/                  # jsQR 1.4.0 (escaneo QR, 251 KB, EN PRECACHE)
│   ├── pdfjs/                 # PDF.js 5.x (~1.5 MB, lazy loading)
│   ├── tesseract/             # Tesseract.js (lazy loading)
│   ├── tesseract-core/        # WASM core OCR (lazy loading)
│   ├── tessdata/              # Language data español (~2 MB, lazy loading)
│   └── xlsx/                  # SheetJS (~1 MB, lazy loading)
│
├── guias/                      # 23 guías educativas HTML
│
├── favicon.svg / .png / .ico   # Favicons
├── og.png / og.svg             # Open Graph
├── manifest.webmanifest        # PWA manifest
├── robots.txt                  # SEO
├── sitemap.xml                 # Mapa del sitio
└── llms.txt                    # Documentación para LLMs
```

### Arquitectura Modular

**Separación de concerns (23 módulos):**
- **config.js** (4 LOC): Config global (URLs, flags)
- **lf-config.js** (213 LOC): Valores regulados y reglas fiscales por territorio
- **lf-calc.js** (498 LOC): Motor de cálculo (potencia, energía, impuestos, solar, BV)
- **lf-state.js** (187 LOC): Estado + persistencia (localStorage) + ordenación
- **lf-app.js** (561 LOC): Coordinación general (carga, eventos, recalcular)
- **lf-render.js** (534 LOC): Renderizado tabla + gráfico Top 5 + estados visuales
- **lf-utils.js** (273 LOC): Utilidades puras (parseNum, escapeHtml, formatMoney, etc.)
- **lf-inputs.js** (607 LOC): Inputs (validación, formato, autosuma, ayudas contextuales)
- **lf-tooltips.js** (147 LOC): Tooltips contextuales
- **lf-ui.js** (155 LOC): UX (menús, modales, animaciones, accesibilidad)
- **lf-cache.js** (175 LOC): Caché de tarifas/PVPC y utilidades offline
- **lf-tarifa-custom.js** (242 LOC): Tarifa personalizada (compara con tu contrato)
- **lf-csv-import.js** (956 LOC): Importador CSV/XLSX con detección festivos + Sun Club
- **pvpc.js** (924 LOC): Cliente PVPC con caché local y validación
- **index-extra.js** (677 LOC): Widget PVPC + bloque novedades en home
- **theme.js** (16 LOC): Gestión tema claro/oscuro
- **factura.js** (1,756 LOC): Parser PDF + QR + OCR (lazy loading, módulo más grande)
- **desglose-factura.js** (606 LOC): Modal desglose detallado de tarifas
- **desglose-integration.js** (407 LOC): Integración desglose con tabla principal
- **tracking.js** (236 LOC): Analytics (GoatCounter, defer attribute)
- **bv/bv-import.js** (580 LOC): Importador CSV/XLSX para simulador BV
- **bv/bv-sim-monthly.js** (400 LOC): Motor simulación mensual BV (cálculo económico)
- **bv/bv-ui.js** (655 LOC): UI simulador BV (tooltips, responsive, accesibilidad)

**Ventajas:**
- Cambios aislados por módulo
- Testing más fácil (funciones puras)
- Debug simplificado (módulos pequeños)
- Reutilización de código

---

## 🔒 Privacidad y Seguridad

### Sin Tracking Personal
- Solo GoatCounter (analytics agregadas, sin cookies de terceros)
- localStorage solo para preferencias locales
- **Facturas procesadas 100% en navegador** (nunca se suben)
- Sin cookies de terceros

### Ciclo de Vida de los Datos

| Tipo de Dato | Dónde vive | ¿Se guarda? | ¿Se envía fuera? |
|--------------|------------|-------------|------------------|
| **Inputs numéricos** (Potencia, Consumo) | Memoria navegador | ✅ Sí (localStorage) | ❌ Nunca |
| **Preferencias** (Zona fiscal, Tema) | Memoria navegador | ✅ Sí (localStorage) | ❌ Nunca |
| **Datos sensibles PDF** (Nombre, DNI, IBAN) | Memoria temporal | ❌ NO (Efímero) | ❌ Nunca |
| **Archivos CSV** (Curvas de carga) | Memoria temporal | ❌ NO (Efímero) | ❌ Nunca |
| **IP / User Agent** | Logs servidor (GitHub) | ✅ Logs estándar | ❌ No (salvo requerimiento legal) |

**Datos que NO recopilamos:**
- Nombre, email, teléfono
- Dirección IP o geolocalización (más allá de logs técnicos)
- Hábitos de navegación
- Datos personales

**localStorage usado para:**
- Tema (claro/oscuro)
- Última configuración del comparador
- Caché de PVPC (por día)
- Debug mode (?debug=1)

### Seguridad Enterprise-Level

**Content Security Policy (CSP):**
- 31/31 páginas con CSP (100% cobertura)
- Políticas diferenciadas según necesidad
- `frame-ancestors 'none'` (anti-clickjacking)
- `form-action 'self'` (anti-exfiltración)
- `wasm-unsafe-eval` solo en 2 páginas (index + calculadora factura)
- Mínimo privilegio aplicado

**Protección XSS:**
- Sanitización con `escapeHtml()` en todos los innerHTML
- Sin eval() ni innerHTML sin sanitizar
- Validación estricta de inputs

**Dependencias:**
- Todas auto-hospedadas en `/vendor/`
- Sin CDNs externos
- Control total de versiones

---

## 📊 Métricas del Proyecto

### Archivos
- 33 archivos HTML (10 páginas principales + 23 guías educativas)
- 20 módulos JavaScript
- 3 archivos CSS (incluye fonts.css)
- 2 bases de datos JSON (tarifas + novedades)

### Tamaños
- **Precache Service Worker**: ~1 MB
  - HTML: 187 KB
  - CSS: 134 KB
  - JavaScript propio: 288 KB
  - jsQR: 251 KB
  - Imágenes: 144 KB
  - Manifest: 2.5 KB

- **Lazy loading** (no en precache):
  - PDF.js: ~1.5 MB
  - Tesseract + core + data: ~8 MB
  - Excel (xlsx): ~1 MB

### Líneas de Código
- **JavaScript**: ~12,035 líneas (23 módulos)
  - factura.js: 1,756
  - lf-csv-import.js: 956
  - pvpc.js: 924
  - index-extra.js: 677
  - **bv/bv-ui.js: 655**
  - lf-inputs.js: 607
  - desglose-factura.js: 606
  - **bv/bv-import.js: 580**
  - lf-app.js: 561
  - lf-render.js: 534
  - lf-calc.js: 498
  - desglose-integration.js: 407
  - **bv/bv-sim-monthly.js: 400**
  - lf-utils.js: 273
  - lf-tarifa-custom.js: 242
  - tracking.js: 236
  - lf-config.js: 213
  - lf-state.js: 187
  - lf-cache.js: 175
  - lf-ui.js: 155
  - lf-tooltips.js: 147
  - theme.js: 16
  - config.js: 4
- **CSS**: ~3,334 líneas (4 archivos)
  - styles.css: ~2,500
  - **bv-sim.css: 834**
- **HTML**: ~6,000 líneas (32 páginas, incluye simulador-bateria-virtual.html)
- **Total proyecto**: ~42,000+ líneas

---

## 🛡️ Service Worker v5.8

### Estrategias de Caché

**Precache (instalación):**
- HTML principal
- CSS completo
- JavaScript propio
- jsQR (escaneo QR instantáneo offline)
- Imágenes y manifest

**Network-first (HTML):**
- Siempre intenta red para contenido actualizado
- Fallback a caché si offline

**Stale-while-revalidate (tarifas.json):**
- Respuesta inmediata desde caché
- Actualización en segundo plano

**Cache-first (imágenes):**
- Caché permanente para assets estáticos

**Lazy loading (bajo demanda):**
- PDF.js se descarga y cachea al subir primera factura
- Tesseract OCR al activar OCR
- Excel (xlsx) al importar primer CSV

### Optimizaciones

- **Precache**: 1 MB (vs 14 MB original, -93%)
- **jsQR incluido**: Feature principal, disponible offline
- **Recursos pesados excluidos**: Se cargan solo cuando se necesitan
- **Limpieza automática**: Versión antigua se elimina al actualizar

---

## 💬 Contacto

- 📧 **Email**: [hola@luzfija.es](mailto:hola@luzfija.es)
- 🐛 **Issues**: GitHub Issues
- 💬 **Sugerencias**: Email

---

## 📜 Licencia

**MIT License**

```
Copyright (c) 2026 LuzFija.es

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Agradecimientos

- **REE/ESIOS** por API oficial de PVPC (indicador 1001)
- **Comunidad open source** por librerías (PDF.js, Tesseract.js, jsQR, SheetJS)

---

⚡ **Herramienta independiente para ayudar a consumidores españoles a comparar tarifas de luz** ⚡

*Proyecto educativo y sin ánimo de lucro*

✅ CSP completo • ✅ PWA • ✅ Sin cookies de terceros • ✅ Accesibilidad (ARIA/focus) • ✅ Rendimiento optimizado


<!-- Updated 2026-01-19 -->
