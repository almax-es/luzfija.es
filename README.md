# ⚡ LuzFija.es — Comparador Avanzado de Tarifas Eléctricas (España)

Herramienta **gratuita**, **sin publicidad** y **de código abierto** para comparar tarifas de electricidad en España. Calcula estimaciones precisas de factura según potencia contratada (P1/P2), días de facturación, consumos por periodos (punta/llano/valle), **placas solares**, **compensación de excedentes**, **batería virtual** y **PVPC (tarifa regulada)**.

🔗 **Web**: [https://luzfija.es](https://luzfija.es)  
📧 **Contacto**: [hola@luzfija.es](mailto:hola@luzfija.es)  
📖 **Guías educativas**: [https://luzfija.es/guias.html](https://luzfija.es/guias.html)

---

## 🎯 Funcionalidades

### 🔋 Comparador de Tarifas
- Comparación de tarifas **1P** y **3P** (discriminación horaria)
- **PVPC** incluido cuando está disponible (tarifa regulada)
- Soporte completo para **placas solares** y **autoconsumo**
- **Compensación de excedentes** con precios por comercializadora
- **Batería Virtual** (acumulación en € para meses futuros)
- **Comparar con tu tarifa actual** (añade precios de tu contrato para comparar)
- Ranking ordenado por **precio total real**
- Gráfico visual Top 5
- Detalles expandibles por tarifa (click en ☀️ dorado)
- Enlaces directos para contratar
- Compartir configuración por URL
- Exportar resultados a CSV

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
- OCR experimental para PDFs escaneados (Tesseract.js)
- Sistema de advertencias contextuales
- **Lazy loading**: PDF.js y OCR solo se cargan cuando subes factura
- **Auto-cálculo**: Calcula automáticamente tras extraer datos

### 📊 Importador de Datos CSV (e-distribución)
- **Importa tu CSV de consumo horario** de la distribuidora
- Compatible con formato estándar de e-distribución
- Cálculo automático de festivos nacionales (algoritmo de Gauss)
- Clasificación inteligente por periodos P1/P2/P3:
  - Detecta festivos nacionales automáticamente
  - Considera fines de semana
  - Aplica horarios según RD 148/2021
- Maneja datos reales y estimados
- Extrae automáticamente: días, consumo punta/llano/valle
- **Auto-cálculo**: Calcula automáticamente tras aplicar datos
- Validación de fechas en zona horaria Madrid

### 📚 Guías Educativas
21 guías completas sobre:
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
- **Mejor tarifa para coche eléctrico**
- **Mejor tarifa con discriminación horaria**
- **Mejor tarifa con placas solares**
- Calculadora de factura de luz
- Comparador PVPC vs tarifa fija

---

## 📊 Cálculo de Factura

### Inputs del Usuario

**Básicos:**
- Potencia contratada **P1** y **P2** (kW)
- **Días** de facturación (1–365)
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
- P1 × precio/kW/día × días
- P2 × precio/kW/día × días

**Término de energía:**
- Consumo punta × precio punta
- Consumo llano × precio llano
- Consumo valle × precio valle

**Compensación solar (si aplica):**
- Excedentes × precio compensación
- Acumulación en Batería Virtual (€)
- Uso de BV anterior para reducir factura

**Impuestos:**
- Impuesto eléctrico (5,1127%)
- IVA (21%)
- Alquiler contador (~0,81€/mes)

> **Nota**: Es una **estimación orientativa**. La factura real puede variar por redondeos, condiciones contractuales, cambios regulatorios y otros conceptos específicos de cada comercializadora.

---

## 🏆 PVPC (Tarifa Regulada)

### Problema: API sin CORS

La CNMC proporciona API pública en `comparador.cnmc.gob.es`, pero **no permite CORS** directo desde navegador.

### Solución: Proxy CORS en Vercel

```html
<script>
  window.PVPC_PROXY_URL = "https://luzfija-es.vercel.app/api/proxy/?url=";
</script>
```

### Sistema de Caché Multinivel

```
Usuario → localStorage (por día)
   ↓ (miss)
   → Proxy Vercel (edge cache, 1h TTL)
      ↓ (miss)
      → API CNMC (datos oficiales)
```

**Ventajas:**
- Reduce llamadas a la API oficial
- Respuestas instantáneas con caché
- Respeta términos de uso de CNMC
- User-Agent identificable con contacto

**API oficial CNMC**: [https://facturaluz2.cnmc.es/](https://facturaluz2.cnmc.es/)

---

## 🛠️ Stack Técnico

### Frontend
- **HTML5 + CSS3** con variables CSS y design system
- **Vanilla JavaScript** (ES6+, sin frameworks)
- **Arquitectura modular** (10+ módulos separados)
- **Chart.js** para gráficos del Top 5
- **PDF.js 5.x** (lazy loading) para parseo de facturas
- **jsQR** (en precache) para escaneo de códigos QR
- **Tesseract.js** (on-demand) para OCR experimental
- **SheetJS (xlsx)** (lazy loading) para importación CSV

### Arquitectura
- **PWA** con Service Worker v5.8 y Web App Manifest
- **Precache optimizado**: 1 MB (jsQR + HTML + CSS + JS propio)
- **Lazy loading**: PDF.js, Tesseract, Excel se cargan bajo demanda
- **Diseño responsive** mobile-first
- **Modo oscuro/claro** con persistencia en localStorage

### Hosting
- **GitHub Pages** (producción principal con dominio propio)
- **Vercel** (proxy CORS para PVPC)
- Hosting estático sin backend (excepto proxy PVPC)

### Seguridad
- **Content Security Policy** en 31/31 páginas (100% cobertura)
- **frame-ancestors 'none'** (anti-clickjacking)
- **form-action 'self'** (anti-exfiltración)
- **Sanitización XSS** con escapeHtml() en todos los innerHTML
- **Dependencias auto-hospedadas** en `/vendor/`
- **Same-origin enforcement**
- **wasm-unsafe-eval** solo en 2 páginas que usan OCR/PDF

### Rendimiento
- **Service Worker v5.8** con precache 1 MB (optimizado -93%)
- **jsQR en precache** (251 KB, escaneo QR instantáneo offline)
- **Lazy loading** de recursos pesados (PDF.js ~1.5 MB, Tesseract ~8 MB, Excel ~1 MB)
- **Preconnect a Google Fonts** (reduce FCP 100-300ms)
- **JavaScript diferido** (tracking.js con defer)
- **Core Web Vitals optimizados**: LCP < 2.5s, INP < 200ms, CLS < 0.1

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
├── mejor-tarifa-coche-electrico.html
├── mejor-tarifa-discriminacion-horaria.html
├── mejor-tarifa-placas-solares.html
├── guias.html                  # Índice de guías
├── 404.html                    # Página de error
├── aviso-legal.html
├── privacidad.html
│
├── js/                         # Arquitectura modular
│   ├── lf-app.js              # Lógica principal (552 líneas)
│   ├── lf-render.js           # Renderizado tabla de resultados
│   ├── lf-utils.js            # Utilidades + escapeHtml (XSS protection)
│   ├── lf-inputs.js           # Gestión de inputs y validación
│   ├── lf-ui.js               # UI/UX (modales, animaciones)
│   ├── lf-tarifa-custom.js    # Tarifa personalizada
│   ├── lf-csv-import.js       # Importador CSV e-distribución
│   ├── factura.js             # Parser PDF + QR (1663 líneas)
│   ├── pvpc.js                # Cliente PVPC con caché multinivel
│   ├── tracking.js            # Analytics mínimo (defer)
│   └── desglose-factura.js    # Modal desglose detallado (461 líneas)
│
├── styles.css                  # Estilos globales (~121 KB)
├── desglose-factura.css        # CSS modal desglose
├── sw.js                       # Service Worker v5.8
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
├── guias/                      # 21 guías educativas HTML
│
├── favicon.svg / .png / .ico   # Favicons
├── og.png / og.svg             # Open Graph
├── manifest.webmanifest        # PWA manifest
├── robots.txt                  # SEO
├── sitemap.xml                 # Mapa del sitio
└── llms.txt                    # Documentación para LLMs
```

### Arquitectura Modular

**Separación de concerns:**
- **lf-app.js**: Lógica de negocio y coordinación general
- **lf-render.js**: Renderizado de tabla de resultados (sin lógica de cálculo)
- **lf-utils.js**: Funciones puras reutilizables (parseNum, escapeHtml, formatMoney)
- **lf-inputs.js**: Gestión de UI de inputs (validación, formato)
- **lf-ui.js**: Animaciones, modales, efectos visuales
- **lf-tarifa-custom.js**: Gestión de tarifa personalizada
- **lf-csv-import.js**: Importador CSV con detección de festivos
- **factura.js**: Parser de PDF + QR (aislado, 1663 líneas)
- **pvpc.js**: Cliente API PVPC con caché multinivel
- **desglose-factura.js**: Modal de desglose independiente (461 líneas)
- **tracking.js**: GoatCounter analytics (diferido)

**Ventajas:**
- Cambios aislados por módulo
- Testing más fácil (funciones puras)
- Debug simplificado (módulos pequeños)
- Reutilización de código

---

## 🔒 Privacidad y Seguridad

### Sin Tracking Personal
- Solo GoatCounter (analytics agregadas sin IPs)
- localStorage solo para preferencias locales
- **Facturas procesadas 100% en navegador** (nunca se suben)
- Sin cookies de terceros

**Datos que NO recopilamos:**
- Nombre, email, teléfono
- Dirección IP o geolocalización
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
- Sin CDNs externos (excepto Google Fonts)
- Control total de versiones

---

## 📊 Métricas del Proyecto

### Archivos
- 31 archivos HTML (10 páginas + 21 guías)
- 10+ módulos JavaScript
- 2 archivos CSS
- 1 base de datos JSON (tarifas)

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
- **JavaScript**: ~5,500 líneas
  - lf-app.js: 552
  - factura.js: 1,663
  - desglose-factura.js: 461
  - Otros módulos: ~2,800
- **CSS**: ~2,500 líneas
- **Total proyecto**: ~40,000 líneas

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
- Tesseract OCR al activar OCR experimental
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

- **CNMC** por API pública de PVPC
- **Comunidad open source** por librerías (Chart.js, PDF.js, Tesseract.js, jsQR, SheetJS)

---

<div align="center">
  <strong>⚡ Herramienta independiente para ayudar a consumidores españoles a comparar tarifas de luz ⚡</strong>
  <br><br>
  <sub>Proyecto educativo y sin ánimo de lucro</sub>
  <br><br>
  <sub>✅ CSP completo • ✅ WCAG 2.1 AA • ✅ Core Web Vitals optimizados • ✅ PWA • ✅ Sin tracking personal</sub>
</div>
