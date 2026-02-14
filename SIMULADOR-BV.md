# 🔋 Comparador de Tarifas Solares - Documentación Técnica

**URL**: [https://luzfija.es/comparador-tarifas-solares.html](https://luzfija.es/comparador-tarifas-solares.html)
**Nota de alcance**: Este documento profundiza en el simulador BV. Para el inventario completo de toda la web, ver `CAPACIDADES-WEB.md`.

## 📖 Índice

1. [¿Qué es el Comparador Solar?](#qué-es-el-comparador-solar)
2. [Características Principales](#características-principales)
3. [Arquitectura Técnica](#arquitectura-técnica)
4. [Flujo de Cálculo](#flujo-de-cálculo)
5. [API JavaScript](#api-javascript)
6. [Formatos de Archivo Soportados](#formatos-de-archivo-soportados)
7. [Seguridad y Validaciones](#seguridad-y-validaciones)
8. [UX y Accesibilidad](#ux-y-accesibilidad)
9. [Casos de Uso](#casos-de-uso)

---

## ¿Qué es el Simulador BV?

El **Simulador de Batería Virtual** es una herramienta especializada que permite comparar tarifas con autoconsumo y compensación de excedentes (con y sin BV) utilizando tus **consumos reales mes a mes**.

### Diferencia con el Comparador Principal

| Característica | Comparador Principal | Simulador BV |
|---|---|---|
| **Input** | Datos agregados (días, kWh totales) | Consumos horarios (CSV/XLSX) |
| **Cálculo** | Un periodo único | Mes a mes (histórico) |
| **Batería Virtual** | Estimación simplificada | Simulación exacta mes a mes |
| **Ranking** | Todas las tarifas | Tarifas con excedentes remunerados |
| **Output** | Factura estimada | Evolución mensual completa |

### ¿Por qué es necesario?

Las tarifas con **batería virtual** acumulan los excedentes solares sobrantes (que no se compensan en el mismo mes) en una "hucha" en euros para usarlos en meses futuros. Esta característica hace que:

1. **El ahorro real dependa del histórico**: Un mes malo puede ser compensado por la BV acumulada en meses buenos
2. **La comparación simple no funcione**: Necesitas simular mes a mes para ver el efecto acumulativo
3. **El orden del ranking cambie**: La mejor tarifa con BV puede no ser la mejor sin BV

---

## Características Principales

### ✅ Importación de Datos

- **Formatos soportados**: CSV y XLSX/XLS
- **Fuentes compatibles**:
  - e-distribución (formato estándar)
  - Iberdrola cliente (formato específico)
  - Matriz horaria H01-H24 (Excel)
- **Validaciones de seguridad**:
  - Tamaño máximo: 10 MB
  - Validación de MIME type
  - Validación de rangos (kWh, horas)
- **Requisitos**: El archivo DEBE incluir columna de excedentes/generación

### 🧮 Motor de Cálculo

Para **cada mes** de **cada tarifa**, calcula:

1. **Potencia**: `P1 × días × precio_P1 + P2 × días × precio_P2`
2. **Energía Bruta**: `kWh_P1 × precio_punta + kWh_P2 × precio_llano + kWh_P3 × precio_valle`
3. **Compensación Excedentes**: `min(kWh_excedentes × precio_exc, energía_bruta)`
4. **Energía Neta**: `energía_bruta - compensación`
5. **Impuestos**: IEE + IVA/IGIC/IPSI + bono social + alquiler contador
6. **Subtotal**: `potencia + energía_neta + impuestos`
7. **Excedente Sobrante**: `(kWh_excedentes × precio_exc) - compensación` → **Acumula en BV**
8. **Uso Hucha**: `min(saldo_BV_mes_anterior, subtotal)` (solo si tarifa tiene BV)
9. **A Pagar Este Mes**: `subtotal - uso_hucha`
10. **Saldo BV Final**: `excedente_sobrante + saldo_BV_anterior - uso_hucha`

### 📊 Ranking Inteligente

**Criterio de ordenación**: Lo que **realmente pagas** (con BV aplicada)

```javascript
// Ordena por totalPagar (con BV), en empate por mayor saldo BV final
rankedResults.sort((a, b) => {
  const diffPay = a.totals.pagado - b.totals.pagado;
  if (Math.abs(diffPay) < 0.01) {
    return b.totals.bvFinal - a.totals.bvFinal; // Mayor saldo = mejor
  }
  return diffPay;
});
```

**Diferencia clave**:
- **`totalPagar`**: Lo que pagas este mes (con BV aplicada del mes anterior)
- **`totalReal`**: Coste real del mes (sin contar BV anterior)

El ranking usa `totalPagar` porque refleja lo que **realmente sale de tu bolsillo**.

### 📉 Desglose Detallado

Para cada mes muestra:

| Columna | Descripción | Tooltip |
|---|---|---|
| **Mes** | YYYY-MM | - |
| **Potencia** | Coste término potencia | P1: X kW × Y días × Z € |
| **E. Bruta** | Energía antes de compensar | P1 + P2 + P3 con precios |
| **Compensación** | Excedentes compensados este mes | Generado × precio, límite energía |
| **E. Neta** | Energía después de compensar | Bruta - Compensación |
| **Impuestos** | IEE + IVA + bono + alquiler | Desglose completo |
| **Subtotal** | Factura sin BV | Potencia + E.Neta + Impuestos |
| **Pagar** | Lo que pagas este mes | Subtotal - Uso Hucha |
| **Uso Hucha** | BV usada este mes | Saldo anterior aplicado |
| **Saldo Fin** | BV acumulada al final | Resto + Nuevo excedente |

**Tooltips contextuales**: Cada concepto tiene un tooltip explicando el cálculo exacto con los números reales.

### 🌍 Zonas Fiscales

Soporte para 3 zonas con impuestos diferenciados:

| Zona | IVA/IGIC/IPSI | Alquiler Contador |
|---|---|---|
| **Península/Baleares** | IVA 21% | 21% |
| **Canarias** | IGIC 0% (vivienda ≤10kW) o 3% | IGIC 7% |
| **Ceuta/Melilla** | IPSI 1% | IPSI 4% |

### 🎯 Filtrado Automático

**Solo muestra tarifas con**:
- ✅ Campo `fv` (autoconsumo fotovoltaico)
- ✅ Precio de excedentes numérico (`exc > 0`)

**Razón**: El simulador necesita un precio de excedentes utilizable para calcular la compensación. Si una tarifa indexada se incluye con valor estimado en `tarifas.json`, se muestra con nota informativa.

### 🔄 Modo Híbrido: CSV a Manual

El comparador incluye una funcionalidad única de **"Edición sobre datos reales"**:

1. El usuario sube su CSV.
2. El sistema calcula internamente los totales mensuales (P1, P2, P3 y Excedentes).
3. **Automáticamente rellena la tabla de "Entrada Manual"** con estos datos.
4. El usuario puede cambiar a la pestaña "Manual" y ajustar valores específicos (ej: "este mes estuve de vacaciones, pero el año que viene no").
5. Permite realizar simulaciones "What-If" basadas en datos reales pero ajustados.

---

## Arquitectura Técnica

### Módulos JavaScript (4 archivos clave)

```
js/
├── lf-csv-utils.js     (Nuevo) - Utilidades de parsing CSV compartidas
└── bv/
    ├── bv-import.js        - Orquestación de importación para BV
    ├── bv-sim-monthly.js   - Motor de cálculo mensual
    └── bv-ui.js            - Interfaz de usuario y renderizado
```

#### 0. **lf-csv-utils.js** - Motor de Parsing Compartido

**Responsabilidades**:
- Detección inteligente de separadores (`;` vs `,`)
- Parseo robusto de líneas CSV (manejo de comillas y caracteres escapados)
- Normalización de números (formatos ES/US) y fechas
- Cálculo de festivos nacionales y periodos tarifarios (P1/P2/P3)

#### 1. **bv-import.js** - Importación de Datos (Capa BV)

**Responsabilidades**:
- Lazy loading de XLSX.js
- Delegación del parsing de bajo nivel a `lf-csv-utils.js`
- Validación específica para BV (existencia de columna de excedentes)
- Construcción de metadatos del archivo

**Funciones principales**:

```javascript
window.BVSim.importFile(file)
// Input: File object (CSV o XLSX)
// Output: { ok: true, records: [...], meta: {...} }
//   records: Array de { fecha, hora, kwh, excedente, autoconsumo, esReal }
//   meta: { rows, start, end, months, hasExcedenteColumn }
```

**Algoritmo de detección de separador**:
```javascript
// Cuenta separadores en el header (evita falsos positivos en decimales)
const headerLine = stripBomAndTrim(lines[0]);
const semi = (headerLine.match(/;/g) || []).length;
const comma = (headerLine.match(/,/g) || []).length;
separator = semi >= comma ? ';' : ',';
```

**Festivos nacionales**:
```javascript
getFestivosNacionales(year)
// Devuelve Set con fechas YYYY-MM-DD de festivos nacionales
// Incluye solo festivos de fecha fija (criterio CNMC):
// 1 Ene, 6 Ene, 1 May, 15 Ago, 12 Oct, 1 Nov, 6 Dic, 8 Dic, 25 Dic
// Excluye festivos móviles (como Viernes Santo)
```

#### 2. **bv-sim-monthly.js** - Motor de Cálculo

**Responsabilidades**:
- Agrupación de datos por mes
- Cálculo económico mes a mes
- Simulación de batería virtual (acumulación + uso)
- Aplicación de impuestos por zona fiscal
- Simulación masiva (todas las tarifas)

**Funciones principales**:

```javascript
window.BVSim.bucketizeByMonth(records)
// Input: Array de registros horarios
// Output: Array de meses con totales por periodo
// {
//   key: "2025-01",
//   start: "2025-01-03",
//   end: "2025-01-29",
//   daysWithData: 27,
//   daysInMonth: 31,
//   coveragePct: 87.1,
//   importByPeriod: { P1: 123.4, P2: 234.5, P3: 345.6 },
//   importTotalKWh: 703.5,
//   exportTotalKWh: 456.7
// }
```

```javascript
window.BVSim.calcMonthForTarifa({
  month,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoPrev,
  zonaFiscal,
  esVivienda
})
// Calcula factura de un mes para una tarifa
// Devuelve objeto con todos los conceptos + saldo BV final
```

```javascript
window.BVSim.simulateForTarifaDemo({
  months,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial,
  zonaFiscal,
  esVivienda
})
// Simula todos los meses de una tarifa
// Devuelve: rows (mes a mes) + totals (pagado, real, bvFinal)
```

```javascript
window.BVSim.simulateForAllTarifasBV({
  months,
  tarifasBV,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial,
  zonaFiscal,
  esVivienda
})
// Simula todas las tarifas en paralelo
// Devuelve: { ok: true, results: [...] }
```

```javascript
window.BVSim.loadTarifasBV()
// Carga tarifas.json y filtra tarifas con excedentes remunerados (fv.exc > 0)
// Devuelve: { ok: true, tarifasBV: [...] }
// Error si no hay tarifas con excedentes disponibles
```

#### 3. **bv-ui.js** - Interfaz de Usuario

**Responsabilidades**:
- Drag & drop de archivos
- Sistema de tooltips (desktop hover + móvil táctil)
- Renderizado de resultados (ganador + ranking)
- Responsive: tablas (desktop) vs tarjetas (móvil)
- Accesibilidad: ARIA, focus management, escape key
- Toast notifications

**Sistema de tooltips**:

```javascript
// Desktop: tooltip flotante con posicionamiento automático
updateTooltipPosition(target)
// Calcula posición óptima (evita overflow)

// Móvil: modal bottom-sheet con contenido completo
openTipModal(text)
closeTipModal()
// Guarda/restaura foco para accesibilidad
```

**Renderizado responsive**:

```javascript
// Desktop: tabla con 10 columnas
buildTable(resultItem)
// <table class="bv-table">...</table>

// Móvil: tarjetas mensuales (sin tablas, sin overflow)
buildMobileCards(resultItem)
// <section class="bv-month-card">
//   <header>Mes</header>
//   <div class="bv-month-body">
//     <div class="bv-month-item">
//       <div class="bv-month-label">POTENCIA</div>
//       <span class="bv-month-value">X,XX €</span>
//     </div>
//     ...
//   </div>
// </section>
```

### CSS (`/bv-sim.css` - 1737 líneas)

**Estructura**:
- Grid layout (2 columnas desktop, 1 móvil)
- Drag & drop zone con estados (hover, dragover)
- Winner card con gradientes
- KPI cards para métricas clave
- Tooltips flotantes + modal móvil
- Tablas responsive (desktop) + tarjetas (móvil)
- Pills para indicar BV/No BV
- Modo claro/oscuro

**Media queries**:
```css
@media (max-width: 768px) {
  /* Tablas → Tarjetas */
  .bv-breakdown-desktop { display: none; }
  .bv-breakdown-mobile { display: block; }
}

@media (max-width: 520px) {
  /* Grid 2 cols → 1 col */
  .bv-form-container .form {
    grid-template-columns: 1fr !important;
  }
}
```

---

## Flujo de Cálculo

### Paso 1: Importación

```
Usuario arrastra CSV/XLSX
    ↓
Validación (tamaño, MIME type, extensión)
    ↓
FileReader (readAsText o readAsArrayBuffer)
    ↓
Parseo (CSV o XLSX)
    ↓
Validación de datos (horas, kWh, fechas)
    ↓
Periodificación P1/P2/P3 (festivos + horarios)
    ↓
{ ok: true, records: [...], meta: {...} }
```

### Paso 2: Agrupación Mensual

```
Array de registros horarios (8.760 registros/año)
    ↓
Agrupar por mes (key: "YYYY-MM")
    ↓
Calcular para cada mes:
  - daysWithData (días únicos en el CSV)
  - importByPeriod (suma kWh por P1/P2/P3)
  - exportTotalKWh (suma excedentes)
    ↓
Array de meses [ { key, daysWithData, importByPeriod, ... }, ... ]
```

### Paso 3: Simulación Económica

```
Para cada tarifa BV:
  bvSaldo = saldoInicial

  Para cada mes:
    1. Calcular potencia (P1 + P2)
    2. Calcular energía bruta (punta + llano + valle)
    3. Calcular compensación excedentes (límite: energía bruta)
    4. Calcular energía neta (bruta - compensación)
    5. Calcular impuestos (IEE + IVA/IGIC + bono + alquiler)
    6. Calcular subtotal (potencia + energía_neta + impuestos)
    7. Calcular excedente sobrante → acumular en BV
    8. Usar saldo BV anterior para reducir factura
    9. Actualizar saldo BV final

  Acumular totales (pagado, real, bvFinal)
```

### Paso 4: Ranking y Visualización

```
Array de resultados (todas las tarifas simuladas)
    ↓
Ordenar por totalPagar (ASC)
  - En empate, ordenar por bvFinal (DESC)
    ↓
Renderizar:
  - Winner card (mejor tarifa)
  - KPIs (pagado total, saldo BV final)
  - Desglose mes a mes (con tooltips)
  - Alternativas (resto del ranking)
```

---

## API JavaScript

### `window.BVSim` - Namespace Global

Todos los métodos del simulador están bajo `window.BVSim`.

#### Importación

```javascript
await window.BVSim.importFile(file)
```

**Parámetros**:
- `file` (File): Objeto File del input/drag&drop

**Retorna**: `Promise<Object>`
```javascript
{
  ok: true,
  records: [
    {
      fecha: Date,
      hora: 1-24,
      kwh: Number,
      excedente: Number,
      autoconsumo: Number,
      periodo: "P1"|"P2"|"P3",
      esReal: Boolean
    },
    ...
  ],
  meta: {
    rows: Number,
    start: "YYYY-MM-DD",
    end: "YYYY-MM-DD",
    months: Number,
    hasExcedenteColumn: Boolean,
    hasAutoconsumoColumn: Boolean
  }
}
```

**Errores**:
```javascript
{
  ok: false,
  error: "Mensaje de error"
}
```

#### Agrupación Mensual

```javascript
window.BVSim.bucketizeByMonth(records)
```

**Parámetros**:
- `records` (Array): Array de registros de `importFile`

**Retorna**: `Array<Object>`
```javascript
[
  {
    key: "2025-01",
    start: "2025-01-03",
    end: "2025-01-29",
    spanDays: 27,
    daysWithData: 27,
    daysInMonth: 31,
    coveragePct: 87.1,
    importByPeriod: {
      P1: 123.45,
      P2: 234.56,
      P3: 345.67
    },
    importTotalKWh: 703.68,
    exportTotalKWh: 456.78
  },
  ...
]
```

#### Cálculo Mensual Individual

```javascript
window.BVSim.calcMonthForTarifa({
  month,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoPrev,
  zonaFiscal,
  esVivienda
})
```

**Parámetros**:
- `month` (Object): Objeto mes de `bucketizeByMonth`
- `tarifa` (Object): Objeto tarifa de `tarifas.json`
- `potenciaP1` (Number): Potencia contratada P1 en kW
- `potenciaP2` (Number): Potencia contratada P2 en kW
- `bvSaldoPrev` (Number): Saldo BV del mes anterior en €
- `zonaFiscal` (String): "Península" | "Canarias" | "CeutaMelilla"
- `esVivienda` (Boolean): true si es vivienda (para IGIC Canarias)

**Retorna**: `Object`
```javascript
{
  key: "2025-01",
  dias: 27,
  pot: 12.34,
  consEur: 123.45,
  costeBonoSocial: 0.52,
  impuestoElec: 6.78,
  alquilerContador: 0.72,
  ivaCuota: 27.89,
  totalBase: 150.00,
  exKwh: 456.78,
  precioExc: 0.06,
  credit1: 27.40,
  excedenteSobranteEur: 0.01,
  hasBV: true,
  bvSaldoPrev: 10.00,
  credit2: 10.00,
  bvSaldoFin: 0.01,
  totalPagar: 140.00,
  totalReal: 150.00
}
```

#### Simulación Completa Tarifa

```javascript
window.BVSim.simulateForTarifaDemo({
  months,
  tarifa,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial,
  zonaFiscal,
  esVivienda
})
```

**Parámetros**: (similares a `calcMonthForTarifa`)
- `months` (Array): Array de meses de `bucketizeByMonth`
- `bvSaldoInicial` (Number): Saldo BV inicial en € (default: 0)

**Retorna**: `Object`
```javascript
{
  ok: true,
  tarifa: { ...tarifa },
  rows: [ ...calcMonthForTarifa por cada mes... ],
  totals: {
    pagado: 1234.56,
    real: 1300.00,
    bvFinal: 65.44,
    credit1Total: 300.00,
    credit2Total: 65.44
  }
}
```

#### Simulación Masiva

```javascript
window.BVSim.simulateForAllTarifasBV({
  months,
  tarifasBV,
  potenciaP1,
  potenciaP2,
  bvSaldoInicial,
  zonaFiscal,
  esVivienda
})
```

**Parámetros**:
- `tarifasBV` (Array): Array de tarifas BV de `loadTarifasBV`

**Retorna**: `Object`
```javascript
{
  ok: true,
  results: [
    ...simulateForTarifaDemo para cada tarifa...
  ]
}
```

#### Cargar Tarifas BV

```javascript
await window.BVSim.loadTarifasBV()
```

**Retorna**: `Promise<Object>`
```javascript
{
  ok: true,
  tarifasBV: [ ...tarifas filtradas... ]
}
```

**Error si no hay tarifas**:
```javascript
{
  ok: false,
  error: "No hay tarifas con excedentes remunerados disponibles actualmente."
}
```

#### Utilidades

```javascript
window.BVSim.round2(number)
```
Redondea a 2 decimales (para cálculos monetarios).

---

## Formatos de Archivo Soportados

### CSV - Formato e-distribución (Estándar)

**Estructura**:
```csv
CUPS;Fecha;Hora;AE_kWh;AS_kWh;AE_Autocons_kWh;Estado
ES0000000000000000XX;01/01/2025;1;0,123;0,045;0,000;R
ES0000000000000000XX;01/01/2025;2;0,098;0,050;0,000;R
...
```

**Columnas**:
- `CUPS`: Código único del punto de suministro
- `Fecha`: DD/MM/YYYY
- `Hora`: 1-24 (hora final del periodo)
- `AE_kWh`: Energía activa consumida (kWh)
- `AS_kWh`: Energía activa exportada/excedentes (kWh) **[OBLIGATORIO]**
- `AE_Autocons_kWh`: Autoconsumo instantáneo (opcional)
- `Estado`: R (real) o E (estimado)

**Separador**: Punto y coma (`;`) o coma (`,`) detectado automáticamente

### CSV - Formato Iberdrola Cliente

**Estructura**:
```csv
Fecha y Hora;Dirección;Consumo Wh;Generación Wh
01/01/2025 00:00;Consumo;123;45
01/01/2025 01:00;Consumo;98;50
...
```

**Columnas**:
- `Fecha y Hora`: DD/MM/YYYY HH:MM
- `Dirección`: Siempre "Consumo"
- `Consumo Wh`: Energía consumida en Wh (se convierte a kWh)
- `Generación Wh`: Energía generada en Wh (se convierte a kWh) **[OBLIGATORIO]**

**Separador**: Coma (`,`)

### XLSX - Formato Matriz Horaria

**Estructura**:
```
| Fecha      | H01  | H02  | H03  | ... | H24  |
|------------|------|------|------|-----|------|
| 01/01/2025 | 0.12 | 0.10 | 0.08 | ... | 0.15 |
| 02/01/2025 | 0.13 | 0.11 | 0.09 | ... | 0.14 |
```

**Columnas**:
- `Fecha`: DD/MM/YYYY o YYYY-MM-DD
- `H01` a `H24`: Consumo en kWh para cada hora

**Nota**: Este formato NO incluye excedentes, se asume 0.

### XLSX - Formato Tabla (Iberdrola)

**Estructura**:
```
| Fecha y Hora    | Periodo Tarifario | Consumo (Wh) | Generación (Wh) |
|-----------------|-------------------|--------------|-----------------|
| 01/01/2025 0:00 | VALLE             | 123          | 45              |
| 01/01/2025 1:00 | VALLE             | 98           | 50              |
```

**Columnas**:
- `Fecha y Hora`: DD/MM/YYYY HH:MM
- `Periodo Tarifario`: PUNTA/LLANO/VALLE (opcional)
- `Consumo (Wh)`: Energía consumida en Wh
- `Generación (Wh)`: Energía generada en Wh **[OBLIGATORIO]**

---

## Seguridad y Validaciones

### Validaciones de Entrada

#### 1. Archivo

```javascript
// Tamaño máximo: 10 MB
if (file.size > 10 * 1024 * 1024) {
  return { ok: false, error: "Archivo demasiado grande (max 10 MB)" };
}

// MIME type (CSV)
if (extension === 'csv') {
  if (file.type && !file.type.includes('text/') && !file.type.includes('application/')) {
    return { ok: false, error: "El archivo no parece ser un CSV válido" };
  }
}

// MIME type (XLSX)
if (extension === 'xlsx' || extension === 'xls') {
  const validMimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ];
  if (file.type && !validMimes.some(mime => file.type.includes(mime))) {
    return { ok: false, error: "El archivo no parece ser un Excel válido" };
  }
}
```

#### 2. Datos CSV

```javascript
// Validar hora (1-24)
if (hora < 1 || hora > 24) continue;

// Validar kWh (0-10.000)
if (isNaN(kwh) || kwh < 0 || kwh > 10000) continue;

// Validar consumo Wh (0-10.000.000)
if (isNaN(consumoWh) || consumoWh < 0 || consumoWh > 10000000) continue;

// Validar fecha
const fecha = parseDateFlexible(fechaStr);
if (!fecha) continue;
```

#### 3. Columna de Excedentes

```javascript
if (!parsed.hasExcedenteColumn) {
  return {
    ok: false,
    error: 'El archivo no incluye excedentes/exportación; esta herramienta es solo para autoconsumo con BV.'
  };
}
```

### Sanitización HTML

```javascript
// Escapar HTML en tooltips y contenido dinámico
const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

// Escapar atributos (incluye saltos de línea)
const escapeAttr = (v) => escapeHtml(v).replace(/\n/g, '&#10;');
```

### Sanitización URLs

```javascript
function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url), document.baseURI);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    if (u.origin === location.origin) return u.toString();
  } catch {}
  return '';
}
```

### Procesamiento 100% Local

- **Sin backend**: Todos los cálculos en el navegador
- **Sin uploads**: El archivo nunca se envía a ningún servidor
- **Sin persistencia**: El archivo CSV original **no se guarda** en el navegador. Solo se extraen los totales mensuales necesarios para la simulación.
- **Sin tracking**: Sin analytics en el simulador (solo en página principal)
- **Privacidad total**: Tus datos de consumo NO salen de tu ordenador

---

## UX y Accesibilidad

### Responsive Design

#### Desktop (>768px)

- **Grid 2 columnas**: Upload + Formulario
- **Tablas**: 10 columnas con scroll horizontal
- **Tooltips**: Flotantes con hover

#### Móvil (≤768px)

- **Grid 1 columna**: Upload y formulario apilados
- **Tarjetas**: Sin tablas, layout vertical con etiquetas
- **Tooltips**: Modal táctil (bottom-sheet)

### Accesibilidad (WCAG 2.1 AA)

#### ARIA Labels

```html
<!-- Drop zone -->
<div role="button" aria-label="Zona de carga de archivos" tabindex="0">

<!-- Modal -->
<div role="dialog" aria-modal="true" aria-label="Detalle del cálculo">

<!-- Botón expandir -->
<button aria-expanded="false" aria-controls="menu">
```

#### Focus Management

```javascript
// Guardar foco antes de abrir modal
lastFocusedEl = document.activeElement;

// Restaurar foco al cerrar modal
if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
  lastFocusedEl.focus();
}
```

#### Trampa de Foco

```javascript
// Solo permitir Tab dentro del modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && tipModalEl.classList.contains('show')) {
    e.preventDefault();
    if (tipCloseBtn) tipCloseBtn.focus();
  }
});
```

#### Escape Key

```javascript
// Cerrar modal con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tipModalEl.classList.contains('show')) {
    closeTipModal();
  }
});
```

#### Enter/Space en Drop Zone

```javascript
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
```

### Estados de Carga

```javascript
// Botón deshabilitado con spinner
simulateButton.disabled = true;
btnText.textContent = 'Calculando...';
btnSpinner.style.display = 'inline-block';

// Mensaje de estado
statusEl.innerHTML = '<span class="spinner"></span> Leyendo archivo...';
```

### Toast Notifications

```javascript
showToast('Cálculo completado.', 'ok');   // Verde
showToast('Error al leer archivo', 'err'); // Rojo
showToast('Subiendo archivo...', 'info');  // Azul
```

---

## Casos de Uso

### Caso 1: Usuario con Placas Solares

**Situación**: Tienes placas solares y quieres saber qué tarifa BV te conviene más.

**Paso a paso**:
1. Descarga tu CSV de consumos horarios de la web de tu distribuidora
2. Asegúrate de que incluye la columna de excedentes
3. Arrastra el CSV al simulador
4. Introduce tus potencias P1/P2
5. Selecciona tu zona fiscal
6. Haz clic en "Calcular Ahorro Real →"
7. El simulador te mostrará:
   - **Ganador**: La tarifa que menos pagas en total
   - **Saldo BV final**: Cuánto dinero acumulas al final
   - **Desglose mes a mes**: Evolución mensual de cada tarifa

**Resultado**: Sabrás qué tarifa BV te ahorra más dinero considerando la acumulación mensual.

### Caso 2: Comparar con tu Tarifa Actual

**Situación**: Tienes una tarifa BV pero quieres saber si hay algo mejor.

**Paso a paso**:
1. Sigue los pasos del Caso 1
2. Busca tu tarifa actual en el ranking
3. Compara con el ganador:
   - ¿Cuánto te ahorrarías?
   - ¿Qué saldo BV tendrías al final?
4. Revisa el desglose mes a mes para ver diferencias estacionales

**Resultado**: Decisión informada sobre si merece la pena cambiar de tarifa.

### Caso 3: Estacionalidad y BV

**Situación**: Generas mucho en verano pero poco en invierno. Quieres ver cómo la BV suaviza las diferencias.

**Paso a paso**:
1. Carga tu CSV anual completo
2. Simula con todas las tarifas
3. Abre el desglose mes a mes de varias tarifas
4. Observa:
   - **Verano**: Compensación alta, excedente sobrante → Acumula en BV
   - **Invierno**: Compensación baja, pero usas BV acumulada → Pagas menos
   - **Saldo BV**: Evolución a lo largo del año

**Resultado**: Entiendes cómo la BV equilibra tu factura a lo largo del año.

### Caso 4: Cambio de Instalación Solar

**Situación**: Vas a ampliar tus placas y quieres simular el nuevo escenario.

**Paso a paso**:
1. Modifica tu CSV multiplicando los excedentes por un factor (ej: x1.5)
2. Carga el CSV modificado
3. Simula con las tarifas BV
4. Compara el resultado con el escenario actual

**Resultado**: Proyección de ahorro con la ampliación de la instalación.

---

## Mantenimiento y Actualización

### Actualizar Tarifas

El simulador lee de `tarifas.json` automáticamente. Para añadir/actualizar tarifas BV:

1. Editar `tarifas.json`
2. Asegurarse de que la tarifa tiene:
   ```json
   {
     "nombre": "Tarifa BV",
     "tipo": "FIJA",
     "fv": {
       "exc": 0.06,
       "bv": true,
       "tipo": "compensacionfija"
     }
   }
   ```
3. El simulador la detectará automáticamente

### Añadir Nuevo Formato CSV

1. Editar `bv-import.js`
2. Añadir detección en `parseCSVConsumos()`:
   ```javascript
   const isNuevoFormato = header.includes('campo_distintivo');
   if (isNuevoFormato) {
     return parseCSVNuevoFormato(lines);
   }
   ```
3. Implementar `parseCSVNuevoFormato()`
4. Retornar mismo formato que otras funciones

### Añadir Zona Fiscal

1. Editar `bv-sim-monthly.js` en `calcMonthForTarifa()`
2. Añadir case en cálculo de IVA:
   ```javascript
   if (zonaFiscal === 'NuevaZona') {
     tasaIVA = 0.XX;
   }
   ```
3. Actualizar HTML para añadir opción en select

---

## Comparación con Competencia

| Característica | LuzFija BV | Otros Comparadores |
|---|---|---|
| **Datos reales** | ✅ CSV horarios | ❌ Estimaciones |
| **Mes a mes** | ✅ Evolución completa | ❌ Cálculo único |
| **BV simulada** | ✅ Acumulación exacta | ❌ o simplificada |
| **Todas las tarifas BV** | ✅ Ranking completo | ⚠️ Solo algunas |
| **Privacidad** | ✅ 100% local | ❌ Envía datos |
| **Gratuito** | ✅ Sin coste | ⚠️ De pago |
| **Open source** | ✅ GitHub | ❌ Cerrado |
| **Tooltips detallados** | ✅ Cada concepto | ❌ Limitado |
| **Responsive** | ✅ Desktop + móvil | ⚠️ Solo desktop |

---

## Preguntas Frecuentes (FAQ)

### ¿Por qué filtra tarifas sin precio de excedentes utilizable?

El simulador necesita un valor numérico para `fv.exc`. Por eso solo carga tarifas con `fv.exc > 0`. Esto incluye precios fijos y, en algunos casos, precios indexados ya estimados en `tarifas.json` (mostrados con nota informativa en la UI).

### ¿Qué hago si mi CSV no tiene excedentes?

El simulador es específico para autoconsumo con batería virtual. Si no tienes placas solares o tu CSV no incluye excedentes, usa el **comparador principal** en lugar de este simulador.

### ¿Por qué el ranking es diferente al comparador principal?

El comparador principal calcula un periodo único. El simulador BV calcula mes a mes y considera la acumulación de BV entre meses, lo que puede cambiar el orden del ranking.

### ¿Puedo simular sin saldo BV inicial?

Sí, deja el campo "Saldo BV inicial" en 0. El simulador empezará desde cero y acumulará lo que generes en cada mes.

### ¿Los datos de mi CSV se envían a algún servidor?

**No**. Todo el procesamiento es 100% local en tu navegador. Tu CSV nunca sale de tu ordenador.

### ¿Qué son "días con datos" vs "días del mes"?

- **Días con datos**: Días únicos que aparecen en tu CSV
- **Días del mes**: Días totales del mes (28-31)

El simulador usa **días con datos** para evitar inflar el coste si tu CSV tiene huecos.

### ¿Por qué algunas tarifas no tienen columnas BV?

Porque esas tarifas **no tienen batería virtual**. El desglose solo muestra "Uso Hucha" y "Saldo Fin" para tarifas con BV activa.

---

## Roadmap (Futuras Mejoras)

### Corto Plazo
- [ ] Exportar resultados a CSV
- [ ] Gráfico de líneas comparativo (evolución mensual)
- [ ] Tour inicial para nuevos usuarios
- [ ] Ejemplo de CSV descargable

### Medio Plazo
- [ ] Filtros (min compensación, max BV, etc.)
- [ ] Permalink para compartir configuración
- [ ] Búsqueda de tarifas por nombre
- [ ] Progreso de carga para CSV grandes

### Largo Plazo
- [ ] Web Worker para procesamiento en background
- [ ] Simulación multi-año (concatenar varios CSV)
- [ ] Comparación con/sin ampliación de placas
- [ ] Exportar PDF con informe completo

---

## Soporte y Contribuciones

**Proyecto Open Source**: [github.com/almax-es/luzfija.es](https://github.com/almax-es/luzfija.es)

**Contacto**: hola@luzfija.es

**Issues**: Si encuentras un bug o tienes una sugerencia, abre un issue en GitHub.

**Pull Requests**: Bienvenidas. Por favor, sigue el estilo de código existente y añade tests si es posible.

---

**Última actualización**: 14 de febrero de 2026
**Versión**: 1.1
**Autor**: aLMaX / LuzFija.es
