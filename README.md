# ⚡ LuzFija.es — Comparador Avanzado de Tarifas Eléctricas (España)

Herramienta **gratuita**, **sin publicidad** y **de código abierto** para comparar tarifas de electricidad en España. Calcula estimaciones precisas de factura según potencia contratada (P1/P2), días de facturación, consumos por periodos (punta/llano/valle), **placas solares**, **compensación de excedentes**, **batería virtual** y **PVPC (tarifa regulada)**.

🔗 **Web**: [https://luzfija.es](https://luzfija.es)  
📧 **Contacto**: [hola@luzfija.es](mailto:hola@luzfija.es)  
📖 **Guías educativas**: [https://luzfija.es/guias.html](https://luzfija.es/guias.html)

---

## 🎯 Características Principales

### 🔋 Comparador de Tarifas
- ✅ Comparación de tarifas **1P** y **3P** (discriminación horaria)
- ✅ **PVPC** incluido cuando está disponible (tarifa regulada)
- ✅ Soporte completo para **placas solares** y **autoconsumo**
- ✅ **Compensación de excedentes** con precios por comercializadora
- ✅ **Batería Virtual** (acumulación en € para meses futuros)
- ✅ **Comparar con tu tarifa actual** (añade precios de tu contrato para comparar)
- ✅ Ranking ordenado por **precio total real**
- ✅ Gráfico visual Top 5
- ✅ Detalles expandibles por tarifa (click en ☀️ dorado)
- ✅ Enlaces directos para contratar
- ✅ Compartir configuración por URL
- ✅ Exportar resultados a CSV
- ✅ Sin registro ni cookies propias

### 📄 Extracción Automática de Facturas
- ✅ **Sube tu factura PDF** y extrae datos automáticamente
- ✅ Reconocimiento de múltiples comercializadoras:
  - Endesa, Iberdrola, Gana Energía, TotalEnergies
  - Octopus Energy, Visalia, Eni Plenitude, Energía XXI
  - Enérgya VM, Imagina Energía, y más
- ✅ Extrae: potencias (P1/P2), días, consumos (punta/llano/valle)
- ✅ Validación con confianza (%)
- ✅ OCR experimental para PDFs escaneados (Tesseract.js)
- ✅ Sistema de advertencias contextuales
- ✅ **Lazy loading**: PDF.js solo se carga cuando subes factura
- ✅ **Auto-cálculo**: Calcula automáticamente tras extraer datos

### 📊 Importador de Datos CSV (e-distribución)
- ✅ **Importa tu CSV de consumo horario** de la distribuidora
- ✅ Compatible con formato estándar de e-distribución
- ✅ Cálculo automático de festivos nacionales (algoritmo de Gauss)
- ✅ Clasificación inteligente por periodos P1/P2/P3:
  - Detecta festivos nacionales automáticamente
  - Considera fines de semana
  - Aplica horarios según RD 148/2021
- ✅ Maneja datos reales y estimados
- ✅ Extrae automáticamente: días, consumo punta/llano/valle
- ✅ **Auto-cálculo**: Calcula automáticamente tras aplicar datos
- ✅ Validación de fechas en zona horaria Madrid (sin bugs UTC)

### 📚 Guías Educativas (20 guías)
- ✅ Cómo leer tu factura paso a paso
- ✅ Qué es P1, P2 y P3
- ✅ PVPC vs mercado libre
- ✅ Qué potencia contratar
- ✅ Autoconsumo y placas solares
- ✅ Compensación de excedentes y batería virtual
- ✅ Bono social eléctrico
- ✅ Coche eléctrico y tarifas
- ✅ Errores típicos en facturas
- ✅ Estafas y llamadas comerciales
- ✅ Y 10 guías más...

### 🎯 Páginas Especializadas
- ✅ **Mejor tarifa para coche eléctrico**
- ✅ **Mejor tarifa con discriminación horaria**
- ✅ **Mejor tarifa con placas solares**
- ✅ Calculadora de factura de luz
- ✅ Comparador PVPC vs tarifa fija

### 🚀 Tecnología y Rendimiento
- ✅ **PWA instalable** (Progressive Web App)
- ✅ **Core Web Vitals optimizados** (diciembre 2025):
  - PDF.js lazy loading (180KB ahorrados)
  - Fix INP móvil < 200ms
  - Google Fonts asíncrono
  - tracking.js con defer
- ✅ **Modo claro/oscuro** automático
- ✅ **Responsive design** perfecto en móvil
- ✅ **Sin frameworks** (Vanilla JavaScript puro)
- ✅ **Tests automáticos** (tests-calculos.html)

---

## 📊 ¿Qué Calculamos?

### Inputs del Usuario

**Básicos:**
- Potencia contratada **P1** y **P2** (kW)
- **Días** de facturación (1–365)
- Consumo por periodos (kWh):
  - **Punta** (10h–14h y 18h–22h laborables)
  - **Llano** (8h–10h, 14h–18h, 22h–24h laborables)
  - **Valle** (0h–8h laborables + todo fin de semana)

**Autoconsumo (opcional):**
- ✅ Checkbox "Tengo placas solares"
- **Excedentes** volcados a red (kWh)
- **Batería Virtual acumulada** del mes anterior (€)
- Cálculo automático de:
  - Compensación según precio de cada comercializadora
  - Batería Virtual para meses futuros
  - Ahorro real vs sin autoconsumo

### Incluye en el Cálculo

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

## 🏆 PVPC (Tarifa Regulada) y Proxy CORS

El PVPC se consulta en la API pública de la CNMC (`comparador.cnmc.gob.es`), pero esa API **no permite CORS** directo desde navegador.

### Solución: Proxy CORS

La web usa un **proxy CORS** desplegado en Vercel con whitelist estricta:

```html
<!-- index.html -->
<script>
  window.PVPC_PROXY_URL = "https://luzfija-es.vercel.app/api/proxy/?url=";
</script>
```

### Sistema de Caché Multinivel

```
Usuario → caché local (localStorage, por día)
   ↓ (miss)
   → Proxy Vercel (caché edge, 1h TTL)
      ↓ (miss)
      → API CNMC (datos oficiales)
```

**Ventajas:**
- ✅ Reduce llamadas a la API oficial
- ✅ Respuestas instantáneas con caché
- ✅ Respeta términos de uso de CNMC
- ✅ User-Agent identificable con contacto

**Referencia oficial CNMC**: [https://facturaluz2.cnmc.es/](https://facturaluz2.cnmc.es/)

---

## 🛠️ Tecnología y Stack

### Frontend
- **HTML5 + CSS3** con variables CSS y design system
- **Vanilla JavaScript** (ES6+, sin frameworks)
- **Chart.js** para gráficos del Top 5
- **PDF.js** (lazy loading) para parseo de facturas
- **Tesseract.js** (on-demand) para OCR experimental

### Arquitectura
- **Diseño responsive** mobile-first
- **PWA** con Service Worker y Web App Manifest
- **Modo oscuro/claro** con persistencia en localStorage
- **Optimizado Core Web Vitals**:
  - LCP < 2.5s
  - INP < 200ms (objetivo)
  - CLS < 0.1

### Hosting
- **Vercel** (producción)
- **GitHub Pages** (alternativa)
- **Hosting estático** sin backend (excepto proxy PVPC)

### Performance
- ✅ **Lazy loading** de recursos pesados (PDF.js ~180KB)
- ✅ **Fonts asíncronas** (Google Fonts con preload)
- ✅ **JavaScript diferido** (tracking.js con defer)
- ✅ **CSS inline crítico** en guías (INP móvil)
- ✅ **Imágenes optimizadas** (og.png 45KB, -77%)

---

## 📁 Estructura del Proyecto

```
luzfija.es/
├── index.html                  # Comparador principal
├── tests-calculos.html         # Tests automáticos de funciones
├── guias.html                  # Índice de guías educativas
├── calcular-factura-luz.html   # Calculadora simple
├── comparar-pvpc-tarifa-fija.html  # Comparador PVPC específico
├── mejor-tarifa-coche-electrico.html
├── mejor-tarifa-discriminacion-horaria.html
├── mejor-tarifa-placas-solares.html
│
├── app.js                      # Lógica principal del comparador
├── factura.js                  # Parser de facturas PDF (con lazy loading)
├── pvpc.js                     # Cliente PVPC + caché
├── tests-calculos.js           # Suite de tests unitarios
├── tracking.js                 # Analytics mínimo (defer)
├── styles.css                  # Estilos globales + fix INP móvil
│
├── tarifas.json                # Base de datos de tarifas
├── guias/                      # 20 guías HTML (CSS inline)
│   ├── como-leer-tu-factura-de-la-luz-paso-a-paso.html
│   ├── que-es-p1-p2-y-p3-en-tu-factura.html
│   ├── autoconsumo-y-placas-solares-lo-basico.html
│   ├── autoconsumo-avanzado-excedentes-compensacion-y-bateria-virtual.html
│   └── ... (16 guías más)
│
├── favicon.svg / .png / .ico   # Favicons multi-formato
├── og.png / og.svg             # Open Graph (optimizado 45KB)
├── manifest.json               # PWA manifest
├── sw.js                       # Service Worker
├── robots.txt                  # SEO
├── sitemap.xml                 # SEO
├── google60cc5bcefe636a81.html # Search Console verificación
├── CNAME                       # Dominio personalizado
└── README.md                   # Este archivo
```

---

## 🧪 Desarrollo Local

> **Importante**: Si abres `index.html` con `file://` fallará la carga de `tarifas.json` y módulos por CORS. Usa un servidor local:

### Opción 1: Python (recomendado)
```bash
python -m http.server 8080
# Abrir: http://localhost:8080
```

### Opción 2: Node.js
```bash
npx serve -l 8080
# Abrir: http://localhost:8080
```

### Opción 3: VS Code Live Server
```bash
# Instalar extensión "Live Server"
# Click derecho en index.html → "Open with Live Server"
```

### Testing
```bash
# Abrir tests en navegador:
# http://localhost:8080/tests-calculos.html

# Verás resultados de tests unitarios:
# ✅ asNumber, parseEuro, parseNum
# ✅ clampNonNeg, clamp01to365Days
# ✅ round2, formatMoney
# ✅ escapeHtml, asBool
# ✅ formatValueForDisplay
```

---

## 🧾 Formato de `tarifas.json`

### Estructura Base

```json
{
  "tarifas": [
    {
      "nombre": "Comercializadora - Nombre Tarifa",
      "tipo": "3P",
      "p1": 0.123456,
      "p2": 0.098765,
      "cPunta": 0.145678,
      "cLlano": 0.123456,
      "cValle": 0.098765,
      "web": "https://url-contratar.com",
      "excedentes": 0.045678,
      "bateriaVirtual": true,
      "requiereFV": false,
      "notas": "Información adicional opcional"
    }
  ]
}
```

### Campos Obligatorios

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `nombre` | string | Nombre completo de la tarifa |
| `tipo` | string | "1P" o "3P" (discriminación horaria) |
| `p1` | number | Precio potencia P1 (€/kW/día) |
| `p2` | number | Precio potencia P2 (€/kW/día) |
| `cPunta` | number | Precio energía punta (€/kWh) |
| `cLlano` | number | Precio energía llano (€/kWh) |
| `cValle` | number | Precio energía valle (€/kWh) |
| `web` | string | URL para contratar |

### Campos Opcionales (Autoconsumo)

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `excedentes` | number | 0 | Precio compensación excedentes (€/kWh) |
| `bateriaVirtual` | boolean | false | ¿Tiene Batería Virtual? |
| `requiereFV` | boolean | false | ¿Requiere tener placas solares? |
| `notas` | string | "" | Información adicional |

### Ejemplo Completo

```json
{
  "tarifas": [
    {
      "nombre": "EjemploEnergia - Solar Plus 3.0",
      "tipo": "3P",
      "p1": 0.112233,
      "p2": 0.089900,
      "cPunta": 0.156789,
      "cLlano": 0.134567,
      "cValle": 0.098765,
      "web": "https://ejemplo.com/contratar",
      "excedentes": 0.055000,
      "bateriaVirtual": true,
      "requiereFV": false,
      "notas": "Sin permanencia. Compensación a precio pool."
    },
    {
      "nombre": "Esluz - Compensación Solar",
      "tipo": "3P",
      "p1": 0.000000,
      "p2": 0.000000,
      "cPunta": 0.123456,
      "cLlano": 0.098765,
      "cValle": 0.078901,
      "web": "https://esluz.com",
      "excedentes": 0.080000,
      "bateriaVirtual": true,
      "requiereFV": true,
      "notas": "Solo para clientes con autoconsumo"
    }
  ]
}
```

### Notas sobre Precios

- Todos los precios **sin IVA** (la app lo añade automáticamente)
- Usar **6 decimales** para máxima precisión
- Si una tarifa no tiene compensación solar: `"excedentes": 0`
- Si requiere placas obligatoriamente: `"requiereFV": true` (solo aparecerá al marcar checkbox)

---

## 🔧 Proxy CORS para PVPC

### Características del Proxy (Vercel)

- ✅ **Whitelist estricta**: solo `comparador.cnmc.gob.es/api/ofertas/pvpc`
- ✅ **Caché edge** con TTL configurable (1 hora por defecto)
- ✅ **Headers CORS** completos (`Access-Control-Allow-Origin: *`)
- ✅ **User-Agent** identificable con contacto
- ✅ **Solo cachea** respuestas 2xx (errores no se cachean)
- ✅ **Timeout** de 10 segundos
- ✅ **Rate limiting** a nivel de Vercel

### Configuración en Frontend

```javascript
// En index.html (línea ~70)
window.PVPC_PROXY_URL = "https://luzfija-es.vercel.app/api/proxy/?url=";
```

Si el proxy no está disponible:
- La web funciona sin PVPC
- Se muestra mensaje: "PVPC no disponible"
- Resto de tarifas funcionan normal

### Testing del Proxy

```bash
# Test directo al proxy:
curl "https://luzfija-es.vercel.app/api/proxy/?url=https://comparador.cnmc.gob.es/api/ofertas/pvpc"

# Debería devolver JSON de CNMC con headers CORS
```

---

## 📄 Sistema de Extracción de Facturas

### Funcionamiento

1. **Usuario sube PDF** (drag & drop o click)
2. **PDF.js se carga dinámicamente** (lazy loading, ~180KB)
3. **Parser multicomercializadora** detecta:
   - Compañía (Endesa, Iberdrola, etc.)
   - Potencias P1 y P2 (kW)
   - Días de facturación
   - Consumos: punta, llano, valle (kWh)
4. **Sistema de confianza** calcula % de campos detectados
5. **Validación interactiva** muestra campos detectados
6. **Advertencias contextuales** según datos extraídos
7. **Aplicar datos** rellena el comparador

### Comercializadoras Soportadas

| Comercializadora | Patrones | Estado |
|------------------|----------|--------|
| Endesa | ✅ Días "(X días)", potencias, consumos P1/P2/P3 | Soportado |
| Iberdrola | ✅ "Días facturados", potencias, consumos específicos | Soportado |
| Gana Energía | ✅ Detección por CIF B98717457 | Soportado |
| TotalEnergies | ✅ "P1: X P2: Y kW", "(31 día(s))" | Soportado |
| Octopus Energy | ✅ Formato fecha "DD-MM-YYYY (X días)" | Soportado |
| Visalia | ✅ "Consumo periodo: X días" | Soportado |
| Eni Plenitude | ✅ "* X días" | Soportado |
| Energía XXI | ✅ Patrones genéricos | Soportado |
| Enérgya VM | ✅ "x 31 días x" encoding corrupto | Soportado |
| Imagina Energía | ✅ "€/kW * X Días" | Soportado |
| Genérico | ✅ Fallback universal | Parcial |

### Patrones de Extracción (Ejemplos)

**Días:**
```javascript
/\(\s*(\d{1,3})\s*días?\s*\)/i  // (31 días)
/días facturados[:\s]*(\d{1,3})/i  // Días facturados: 31
/x\s*(\d{1,3})\s*días\s*x/i  // x 31 días x (Enérgya VM)
```

**Potencias:**
```javascript
/\bp1[:\s]+([0-9][0-9\.,]*)\s*kw\b/i  // P1: 3,45 kW
/potencia\s*contratada[^\n]{0,80}p1[^0-9]{0,60}([0-9][0-9\.,]*)/i
```

**Consumos:**
```javascript
/\bpunta\b[^0-9]{0,40}([0-9][0-9\.,]*)\s*kwh\b/i
/\bp1\b[^\d]{0,50}([0-9][0-9\.,]+)\s*kwh/i
```

### OCR Experimental (Tesseract.js)

Si el PDF es escaneado (sin texto seleccionable):
1. Botón "OCR Experimental" aparece
2. Carga Tesseract.js dinámicamente (~2MB)
3. Renderiza PDF a canvas (2.0 scale)
4. OCR en español (primeras 2 páginas)
5. Aplica mismos patrones de extracción

**Nota**: OCR es experimental y puede fallar. Siempre revisar datos extraídos.

---

## 🎨 Sistema de Diseño

### Variables CSS (Dark Mode por defecto)

```css
:root {
  --bg0: #070A12;
  --bg1: #0B1020;
  --card: rgba(255,255,255,.06);
  --border: rgba(255,255,255,.10);
  --text: #F7F7FB;
  --muted: rgba(247,247,251,.72);
  --accent: #8B5CF6;
  --accent2: #22C55E;
  --warn: #F59E0B;
  --danger: #EF4444;
  --shadow: 0 22px 65px rgba(0,0,0,.52);
  --radius: 18px;
}
```

### Light Mode

```css
body.light-mode {
  --bg0: #F4F6FB;
  --bg1: #FFFFFF;
  --card: rgba(15, 23, 42, .04);
  --text: #0F172A;
  --muted: rgba(15, 23, 42, .68);
  /* ... */
}
```

### Componentes Reutilizables

- `.card` - Tarjetas con glassmorphism
- `.btn` - Botones con variantes (primary, secondary)
- `.pill` - Pills/badges para estados
- `.input` - Inputs con estilos consistentes
- `.modal` - Modales con backdrop blur
- `.heroCard` - Cards destacados

### Animaciones

```css
@keyframes gradientShift { /* Logo animado */ }
@keyframes auroraMove { /* Fondo aurora */ }
@keyframes fadeInUp { /* Entrada de elementos */ }
@keyframes pulse { /* Pulso sutil */ }
```

**Respeta `prefers-reduced-motion`:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
  }
}
```

---

## 🚀 Optimizaciones Core Web Vitals (Diciembre 2025)

### Problema Detectado
- **20 URLs** con INP móvil malo (315ms, threshold >200ms)
- URLs afectadas: principalmente `/guias/*` + index + mejor-tarifa

### Soluciones Aplicadas

#### 1. PDF.js Lazy Loading
```html
<!-- ANTES: Bloqueante en head -->
<script defer src="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js"></script>

<!-- DESPUÉS: Comentario, carga dinámica -->
<!-- PDF.js se carga dinámicamente cuando el usuario sube una factura (ver factura.js) -->
```
**Ahorro**: 180KB en carga inicial

#### 2. tracking.js con defer
```html
<!-- ANTES: Sin defer -->
<script src="tracking.js"></script>

<!-- DESPUÉS: defer añadido -->
<script src="tracking.js" defer></script>
```

#### 3. Google Fonts asíncrono
```html
<link rel="preload" 
      href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" 
      as="style" 
      onload="this.onload=null;this.rel='stylesheet'">
<noscript>
  <link href="..." rel="stylesheet">
</noscript>
```

#### 4. Fix INP Móvil (Critical)
```css
/* styles.css + guías inline */
@media (pointer: coarse), (hover: none) {
  /* Eliminar backdrop-filter (costoso en móvil) */
  .card, .pill, .btn, .modal-content {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  
  /* Simplificar sombras */
  .card, .heroCard, .statCard {
    box-shadow: 0 4px 12px rgba(0,0,0,.3) !important;
  }
  
  /* Desactivar aurora en móvil */
  body::before {
    animation: none !important;
    opacity: 0.3 !important;
  }
  
  /* Simplificar logo */
  .logo {
    animation: none !important;
  }
  .logo::before,
  .logo::after {
    display: none !important;
  }
}
```

**Cobertura**: 100% (styles.css + 21 archivos HTML con CSS inline)

#### 5. og.png Optimizado
- **Antes**: 203KB
- **Después**: 45KB (-77%)
- Método: Paleta 256 colores

#### 6. Bug Esluz Corregido
```javascript
// ANTES: Filtro DESPUÉS de calcular firstValida
const firstValida = resultados.find(...) || resultados[0];
if (!solarOn) {
  processed = processed.filter(r => !r.requiereFV);
}

// DESPUÉS: Filtro ANTES
let resultadosFiltrados = resultados;
if (!solarOn) {
  resultadosFiltrados = resultados.filter(r => !r.requiereFV);
}
const firstValida = resultadosFiltrados.find(...) || resultadosFiltrados[0];
```

### Resultados Esperados

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| **INP móvil** | 315ms | <200ms | ~35-45% |
| **LCP** | - | -30-40% | Fonts + PDF.js |
| **Carga inicial** | +180KB | Base | -180KB |
| **URLs afectadas** | 20 | 0-3 | En 2-4 semanas |

**Fuentes:**
- [Chrome UX Report (CrUX)](https://developer.chrome.com/docs/crux)
- [Core Web Vitals (web.dev)](https://web.dev/articles/vitals)
- [Search Console CWV](https://support.google.com/webmasters/answer/9205520)

---

## 🧪 Suite de Tests (tests-calculos.html)

### Tests Implementados

```javascript
// Conversión de tipos
✅ asNumber(x) - Convierte a número seguro
✅ parseEuro(x) - Parsea €123,45 → 123.45
✅ parseNum(x) - Parsea "123.456,78" → 123456.78

// Validación y límites
✅ clampNonNeg(x) - Clamp a positivo (0 si negativo)
✅ clamp01to365Days(x) - Días válidos (1-365)

// Formato
✅ round2(x) - Redondea a 2 decimales
✅ formatMoney(x) - Formato moneda "123,45 €"
✅ escapeHtml(x) - Escapa HTML entities

// Utilidades
✅ asBool(x) - Convierte a booleano robusto
✅ formatValueForDisplay(x, type) - Formato display según tipo
```

### Ejecutar Tests

```bash
# Abrir en navegador:
http://localhost:8080/tests-calculos.html

# Verás output en consola:
# ✅ Test asNumber: 8/8 passed
# ✅ Test parseEuro: 5/5 passed
# ... etc
```

---

## 🤝 Contribuir

### Reportar Errores
- **GitHub Issues**: [Crear issue](https://github.com/tu-usuario/luzfija.es/issues)
- **Email**: [hola@luzfija.es](mailto:hola@luzfija.es)

### Actualizar Tarifas
```bash
# 1. Fork del repositorio
# 2. Editar tarifas.json
# 3. Verificar formato JSON válido
# 4. Pull request con descripción clara
```

### Añadir Soporte para Nueva Comercializadora (Facturas)

**Editar `factura.js`:**

1. Añadir detección en `__LF_detectarCompania()`:
```javascript
if (t.includes('nuevaenergia') || t.includes('nueva-energia.com')) {
  return 'nuevaenergia';
}
```

2. Añadir patrones en `__LF_extraerDiasCompania()`:
```javascript
case 'nuevaenergia':
  return __LF_extraerNumero(texto, [
    /patrón específico días/i
  ], 1, 200);
```

3. Añadir patrones de potencias si necesario en `__LF_extraerPotenciasCompania()`

4. Probar con facturas reales

### Añadir Nueva Guía

```bash
# 1. Crear guias/nueva-guia.html basándote en una existente
# 2. Copiar estructura HTML y CSS inline
# 3. Asegurar que tiene el fix INP móvil al final del <style>
# 4. Añadir a guias.html en el índice
# 5. Actualizar sitemap.xml
```

### Guidelines de Código

- ✅ **No usar frameworks** - Mantener Vanilla JS
- ✅ **ES6+ syntax** - Usar const/let, arrow functions, etc.
- ✅ **Comentarios claros** - Especialmente en lógica compleja
- ✅ **Mobile-first** - Siempre diseñar primero para móvil
- ✅ **Accesibilidad** - ARIA labels, semántica HTML
- ✅ **Performance** - Lazy loading, defer, async
- ✅ **Tests** - Añadir tests para nuevas funciones

---

## ⚖️ Avisos Legales

### Transparencia y Origen de Datos

Este proyecto opera bajo el principio de **Reutilización de Información del Sector Público** ([Ley 37/2007](https://www.boe.es/buscar/act.php?id=BOE-A-2007-19814)).

**Fuentes de datos:**
- **PVPC**: API pública de la CNMC ([comparador.cnmc.gob.es](https://comparador.cnmc.gob.es))
- **Tarifas mercado libre**: Recopilación manual de webs oficiales de comercializadoras
- **Guías educativas**: Contenido original sin copyright

**Uso autorizado:**
- Estrictamente educativo, informativo y de investigación
- Cumple con el aviso legal de las fuentes citando procedencia
- Sin ánimo de lucro ni publicidad

**Contacto**: [hola@luzfija.es](mailto:hola@luzfija.es)

### Descargo de Responsabilidad

LuzFija.es es un proyecto **educativo** y **sin ánimo de lucro**. Las estimaciones de factura son **orientativas** y se calculan según modelo implementado con datos disponibles públicamente.

**No garantizamos:**
- ❌ Exactitud absoluta de precios (pueden cambiar)
- ❌ Completitud de todas las tarifas del mercado
- ❌ Actualización en tiempo real de precios
- ❌ Que la factura real coincida exactamente

**Para información oficial y vinculante:**
- **CNMC**: [https://facturaluz2.cnmc.es/](https://facturaluz2.cnmc.es/)
- **ESIOS (REE)**: [https://www.esios.ree.es/es/pvpc](https://www.esios.ree.es/es/pvpc)
- **Consulta directa** a comercializadoras para condiciones exactas

### No Afiliación

LuzFija.es **NO está afiliado** con:
- ❌ CNMC (Comisión Nacional de los Mercados y la Competencia)
- ❌ Red Eléctrica de España (REE)
- ❌ Organismos oficiales del sector eléctrico
- ❌ Comercializadoras de electricidad
- ❌ Distribuidoras eléctricas

Proyecto **independiente** y de **código abierto**.

### Privacidad y Datos

**Compromisos de privacidad:**
- ❌ Sin cookies propias de seguimiento
- ❌ Sin registro de usuarios ni cuentas
- ❌ Sin analítica de terceros (Google Analytics, etc.)
- ❌ Sin compartir datos con terceros
- ✅ Solo localStorage para guardar preferencias (local en tu dispositivo)
- ✅ Facturas PDF procesadas 100% en navegador (no se suben a servidor)
- ✅ Sin tracking de usuarios individuales

**Datos que NO recopilamos:**
- Nombre, email, teléfono
- Dirección IP o geolocalización precisa
- Hábitos de navegación
- Datos personales de ningún tipo

**localStorage usado para:**
- Preferencias de tema (claro/oscuro)
- Última configuración del comparador
- Caché de PVPC (por día, no personal)
- Debug mode (activado con ?debug=1)

**Service Worker (PWA):**
- Solo cachea archivos estáticos (HTML, CSS, JS, imágenes)
- No recopila ni transmite datos del usuario
- Mejora velocidad de carga offline

---

## 📊 Estadísticas del Proyecto

### Líneas de Código (aproximado)
- **JavaScript**: ~4,800 líneas
  - app.js: ~2,300 (incluye importador CSV + festivos automáticos)
  - factura.js: ~1,200
  - pvpc.js: ~500
  - tests-calculos.js: ~400
  - tracking.js: ~50
- **CSS**: ~2,100 líneas (styles.css + inline en guías)
- **HTML**: ~30 archivos
- **Total**: ~37,000 líneas de código

### Archivos y Recursos
- 📄 27 archivos HTML
- 🎨 1 archivo CSS principal + CSS inline en guías
- 📜 5 archivos JavaScript
- 📚 20 guías educativas
- 🖼️ 6 imágenes (favicons + og + logo)
- 📋 1 base de datos JSON (tarifas)
- 🔧 Archivos config (manifest, robots, sitemap, etc.)

### Tamaños de Archivos (comprimidos)
- index.html: ~67KB
- app.js: ~72KB (incluye importador CSV + festivos)
- factura.js: ~50KB
- styles.css: ~68KB
- pvpc.js: ~14KB
- tarifas.json: ~15-20KB (depende de tarifas activas)
- **Total bundle inicial**: ~280-310KB (sin PDF.js)
- **Con PDF.js lazy**: ~180KB menos en carga inicial

---

## 📅 Changelog

### Diciembre 2025 - Correcciones Críticas y Mejoras de Calidad
- ✅ **Importador CSV de e-distribución** (consumo horario de distribuidora)
- ✅ **Cálculo automático de festivos** (algoritmo de Gauss - funciona para cualquier año)
- ✅ **Auto-cálculo tras importar** (PDF y CSV calculan automáticamente)
- ✅ **Bug crítico de fechas UTC corregido** (toISOString → zona horaria local/Madrid)
- ✅ **Consola limpia en producción** (sistema de debug mejorado con lfDbg)
- ✅ **Manifest PWA limpiado** (eliminadas referencias rotas a widgets)
- ✅ **Hora consistente en zona Madrid** (modal PVPC)
- ✅ **Breadcrumb "Inicio" oculto** en página principal (UX mejorada)
- ✅ **Título HTML corregido** en guía de cambio de compañía
- ✅ **Error novedades.json silenciado** (sin spam en consola)
- ✅ **Validación completa**: 0 recursos rotos, JSON-LD perfecto, sitemap OK

### Diciembre 2025 - Optimizaciones Core Web Vitals
- ✅ **Comparar con tu tarifa actual** (añade precios personalizados al ranking)
- ✅ PDF.js lazy loading (180KB ahorrados)
- ✅ Fix INP móvil < 200ms (100% cobertura)
- ✅ tracking.js con defer
- ✅ Google Fonts asíncrono
- ✅ og.png optimizado (45KB, -77%)
- ✅ Bug Esluz corregido (filtro requiereFV)
- ✅ Console limpia (debug modal eliminado)
- ✅ README.md actualizado completamente

### Noviembre 2025 - Sistema de Facturas
- ✅ Parser multicomercializadora (10+ soportadas)
- ✅ Sistema de confianza y validación
- ✅ OCR experimental (Tesseract.js)
- ✅ Advertencias contextuales

### Octubre 2025 - Autoconsumo Avanzado
- ✅ Compensación de excedentes por comercializadora
- ✅ Batería Virtual (acumulación €)
- ✅ Detalles expandibles (☀️ dorado)
- ✅ Ranking considera BV correctamente

### Septiembre 2025 - Guías y Contenido
- ✅ 20 guías educativas completas
- ✅ Páginas especializadas (coche, solar, etc.)
- ✅ Diseño responsive mejorado

### Agosto 2025 - PWA y Performance
- ✅ Service Worker implementado
- ✅ Manifest.json para instalación
- ✅ Modo offline básico
- ✅ Optimizaciones de caché

### Julio 2025 - Autoconsumo Básico
- ✅ Soporte inicial para placas solares
- ✅ Checkbox "Tengo placas solares"
- ✅ Filtrado de tarifas con `requiereFV`

### Junio 2025 - PVPC y Caché
- ✅ Integración PVPC con proxy CORS
- ✅ Sistema de caché multinivel
- ✅ Fallback cuando PVPC no disponible

### Mayo 2025 - Lanzamiento
- ✅ Comparador básico 1P y 3P
- ✅ Base de datos de tarifas
- ✅ Diseño dark mode
- ✅ Exportar a CSV

---

## 🎯 Roadmap Futuro

### Corto Plazo
- [ ] Más comercializadoras en parser de facturas
- [ ] Mejorar precisión OCR
- [ ] Tests E2E automatizados
- [ ] Integración directa con Datadis (API oficial distribuidoras)

### Medio Plazo
- [ ] Comparador de gas natural
- [ ] Alertas de cambios de precios
- [ ] Historial de tarifas (gráficos temporales)
- [ ] Comparativa tarifas indexadas (pool)
- [ ] API pública para desarrolladores

### Largo Plazo
- [ ] App móvil nativa (React Native / Flutter)
- [ ] Recomendaciones personalizadas con IA
- [ ] Comunidad de usuarios
- [ ] Soporte multi-idioma (catalán, gallego, euskera)

---

## 💬 Contacto y Soporte

### Canales Oficiales
- 📧 **Email**: [hola@luzfija.es](mailto:hola@luzfija.es)
- 🐛 **Issues**: [GitHub Issues](https://github.com/tu-usuario/luzfija.es/issues)
- 💬 **Sugerencias**: Email o GitHub Discussions

### Tiempo de Respuesta
- Bugs críticos: 24-48h
- Sugerencias: 1-2 semanas
- Actualizaciones tarifas: 3-7 días

### Colaboración
¿Quieres colaborar en el proyecto? Envía email a [hola@luzfija.es](mailto:hola@luzfija.es) explicando:
- En qué te gustaría ayudar
- Tu experiencia relevante
- Ideas o mejoras que propones

---

## 📜 Licencia

**MIT License** - Ver archivo LICENSE para detalles completos.

```
Copyright (c) 2025 LuzFija.es

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

- **CNMC** por proporcionar API pública de PVPC
- **Comunidad open source** por librerías usadas (Chart.js, PDF.js, Tesseract.js)
- **Usuarios** que reportan bugs y sugieren mejoras
- **Contribuidores** que mantienen tarifas actualizadas

---

## ⭐ ¿Te ha sido útil?

Si LuzFija.es te ha ayudado a ahorrar en tu factura de la luz:

- ⭐ Dale una estrella en GitHub
- 📢 Compártelo con amigos y familia
- 💬 Déjanos feedback en [hola@luzfija.es](mailto:hola@luzfija.es)

**Cada persona que ahorra es un éxito para este proyecto.**

---

<div align="center">
  <strong>⚡ Hecho con ❤️ para ayudar a consumidores españoles a ahorrar en la factura de la luz ⚡</strong>
  <br><br>
  <sub>Proyecto independiente, educativo y sin ánimo de lucro</sub>
</div>
