# ⚡ Arquitectura PVPC y Excedentes — Documentación Completa

Documentación técnica precisa de la estructura de datos, actualización automática y procesos del **PVPC (Precio Voluntario del Pequeño Consumidor)** en luzfija.es.
Para inventario funcional completo del sitio (incluyendo observatorio, comparador principal y simulador BV), ver `CAPACIDADES-WEB.md`.

**Última actualización**: 2026-08-16

---

## 1. Visión General

### ¿Qué es PVPC?
- **PVPC**: Tarifa regulada de electricidad cuya metodología se fija normativamente
- **Indicador ESIOS**: 1001 (Precio de mercado del PVPC)
- **Fuente**: REE (Red Eléctrica de España) / ESIOS API
- **Actualización**: Diariamente a las 20:00 UTC (21:00 CET / 22:00 CEST en Madrid)
- **Disponibilidad**: Precios horarios (23, 24 o 25 períodos diarios según cambio horario)

### ¿Qué son los Excedentes PVPC?
- **Excedentes PVPC**: Compensación horaria para autoconsumo
- **Indicador ESIOS**: 1739 (Precio de excedentes)
- **Fuente**: REE / ESIOS API
- **Actualización**: Diariamente a las 20:00 UTC (21:00 CET / 22:00 CEST en Madrid)
- **Disponibilidad**: Precios horarios (23, 24 o 25 períodos diarios según cambio horario)

### Arquitectura del Proyecto PVPC
```
┌─────────────────────────────────────────────────────────┐
│  Usuarios del Comparador (navegador)                    │
├─────────────────────────────────────────────────────────┤
│  lf-app.js + pvpc.js (cálculo en cliente)              │
├─────────────────────────────────────────────────────────┤
│  /data/pvpc/{geoId}/{YYYY-MM}.json (estático)          │
│  /data/surplus/{geoId}/{YYYY-MM}.json (estático)       │
├─────────────────────────────────────────────────────────┤
│  GitHub Pages (hosting)                                 │
├─────────────────────────────────────────────────────────┤
│  GitHub Actions (CI/CD)                                 │
│  └─ pvpc_auto_fill.py cada día 20:00 UTC              │
├─────────────────────────────────────────────────────────┤
│  ESIOS API (REE) — datos oficiales                     │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Estructura de Directorio

### Ubicación de Datos PVPC

```
/data/pvpc/
├── index.json                    # Metadatos globales + índice de zonas
├── 8741/                         # Zona Península
│   ├── index.json               # Índice zona (metadatos)
│   ├── 2025-01.json             # Enero 2025
│   ├── 2025-02.json             # Febrero 2025
│   ├── ...
│   └── 2026-01.json             # Enero 2026
├── 8742/                         # Zona Canarias
│   ├── index.json
│   ├── 2025-01.json
│   ├── ...
│   └── 2026-01.json
├── 8743/                         # Zona Baleares
│   ├── index.json
│   ├── 2025-01.json
│   └── ...
├── 8744/                         # Zona Ceuta
│   ├── index.json
│   ├── 2025-01.json
│   └── ...
└── 8745/                         # Zona Melilla
    ├── index.json
    ├── 2025-01.json
    └── ...
```

### Ubicación de Datos Excedentes

```
/data/surplus/
├── index.json                    # Metadatos globales + índice de zonas
├── 8741/                         # Zona Península
│   ├── index.json               # Índice zona (metadatos)
│   ├── 2025-01.json
│   └── ...
├── 8742/                         # Zona Canarias
│   ├── index.json
│   └── ...
├── 8743/                         # Zona Baleares
│   ├── index.json
│   └── ...
├── 8744/                         # Zona Ceuta
│   ├── index.json
│   └── ...
└── 8745/                         # Zona Melilla
    ├── index.json
    └── ...
```

### Identificadores de Zona (GEO_ID)

| GEO_ID | Zona | Timezone | Descripción |
|--------|------|----------|-------------|
| **8741** | Península | Europe/Madrid | Península ibérica (98% de población) |
| **8742** | Canarias | Atlantic/Canary | Islas Canarias (UTC+0) |
| **8743** | Baleares | Europe/Madrid | Islas Baleares |
| **8744** | Ceuta | Europe/Madrid | Ciudad Autónoma de Ceuta |
| **8745** | Melilla | Europe/Madrid | Ciudad Autónoma de Melilla |

**Cobertura Histórica:**
- Desde **Junio 2021** (inicio tarifa 2.0TD) hasta la fecha actual.
- Actualización diaria automática a las 20:00 UTC (21:00 CET / 22:00 CEST en Madrid).

---

## 3. Formato de Datos: Archivo Mensual

### Esquema General

```json
{
  "schema_version": 2,
  "geo_id": 8741,
  "timezone": "Europe/Madrid",
  "indicator": 1001,
  "unit": "EUR/kWh",
  "epoch_unit": "s",
  "from": "2025-01-01",
  "to": "2025-01-31",
  "days": {
    "2025-01-01": [[timestamp1, price1], [timestamp2, price2], ...],
    "2025-01-02": [[timestamp1, price1], ...],
    ...
  },
  "meta": {
    "unit_from_api": [{"name": "Precio €/MWh", "id": 23}],
    "unit_suggests_mwh": true,
    "heuristic_applied": false,
    "max_after_conversion": 0.42314999999999997
  }
}
```

### Campos Detallados

| Campo | Tipo | Valores | Descripción |
|-------|------|--------|-------------|
| `schema_version` | int | 2 | Versión del esquema (actual: 2) |
| `geo_id` | int | 8741-8745 | Identificador geográfico |
| `timezone` | string | "Europe/Madrid", "Atlantic/Canary" | Zona horaria de la región |
| `indicator` | int | 1001 / 1739 | Indicador ESIOS (PVPC / Excedentes) |
| `unit` | string | "EUR/kWh" | Unidad de precios (convertida desde €/MWh) |
| `epoch_unit` | string | "s" | Unidad de timestamp (segundos) |
| `from` | string | "YYYY-MM-DD" | Fecha inicio del mes |
| `to` | string | "YYYY-MM-DD" | Fecha fin del mes |
| `days` | object | { "YYYY-MM-DD": [...] } | Precios horarios por día |
| `meta.unit_from_api` | array | [{"name": ..., "id": ...}] | Unidad original de ESIOS |
| `meta.unit_suggests_mwh` | boolean | true | Indica conversión desde €/MWh |
| `meta.heuristic_applied` | boolean | false | Si se aplicaron heurísticas de relleno |
| `meta.max_after_conversion` | number | 0.423 | Precio máximo en EUR/kWh del mes |

### Estructura de Precios por Día

```json
"2025-01-01": [
  [1735686000, 0.18278999999999998],  // Unix timestamp (segundos) + precio EUR/kWh
  [1735689600, 0.18319],
  [1735693200, 0.18874000000000002],
  ...
  // 23, 24 o 25 entradas según el día y la zona horaria
]
```

**Notas**:
- Normalmente hay **24 precios por día**, pero los cambios de hora generan días de **23 o 25 precios**
- Timestamps en **Unix epoch (segundos)**
- Precios en **EUR/kWh** (convertidos desde €/MWh de ESIOS)
- Horario de la zona geográfica (ver `timezone`)

### Conversión de Unidades

```
ESIOS API proporciona: €/MWh
Luzfija.es convierte a: €/kWh

Fórmula: precio_EUR_kWh = precio_EUR_MWh / 1000

Ejemplo:
  182.79 €/MWh → 0.18279 €/kWh
```

---

## 4. Archivo Index Global

### `/data/pvpc/index.json`

```json
{
  "schema_version": 2,
  "generated_at_utc": "2026-05-15T20:48:39+00:00",
  "indicator": 1001,
  "unit": "EUR/kWh",
  "epoch_unit": "s",
  "geos": [
    {
      "geo_id": 8741,
      "timezone": "Europe/Madrid",
      "path": "8741/index.json"
    },
    {
      "geo_id": 8742,
      "timezone": "Atlantic/Canary",
      "path": "8742/index.json"
    },
    {
      "geo_id": 8743,
      "timezone": "Europe/Madrid",
      "path": "8743/index.json"
    },
    {
      "geo_id": 8744,
      "timezone": "Europe/Madrid",
      "path": "8744/index.json"
    },
    {
      "geo_id": 8745,
      "timezone": "Europe/Madrid",
      "path": "8745/index.json"
    }
  ]
}
```

**Propósito**: Punto de entrada para descubrimiento de zonas geográficas disponibles.
La lista de `geos` refleja exactamente lo publicado en el último build del dataset.

### `/data/surplus/index.json`

Mismo formato que el índice PVPC, pero para excedentes (indicador 1739).
El indicador 1739 es un dato nacional en ESIOS; por eso el generador lo procesa con
`Europe/Madrid` para todas las zonas y evita desplazar los buckets diarios de excedentes.

```json
{
  "schema_version": 2,
  "generated_at_utc": "2026-05-15T20:48:40+00:00",
  "indicator": 1739,
  "unit": "EUR/kWh",
  "epoch_unit": "s",
  "geos": [
    { "geo_id": 8741, "timezone": "Europe/Madrid", "path": "8741/index.json" },
    { "geo_id": 8742, "timezone": "Europe/Madrid", "path": "8742/index.json" },
    { "geo_id": 8743, "timezone": "Europe/Madrid", "path": "8743/index.json" },
    { "geo_id": 8744, "timezone": "Europe/Madrid", "path": "8744/index.json" },
    { "geo_id": 8745, "timezone": "Europe/Madrid", "path": "8745/index.json" }
  ]
}
```

---

## 5. Actualización Automática

### GitHub Actions Workflow

**Archivo**: `.github/workflows/pvpc.yml`

El workflow se ejecuta diariamente a las 20:00 UTC y descarga los tres datasets (PVPC, Excedentes, SSAA). Dispone de un desplegable manual para backfill completo desde la UI de GitHub Actions:

```yaml
on:
  schedule:
    - cron: '0 20 * * *'  # 20:00 UTC = 21:00 CET / 22:00 CEST en Madrid
  workflow_dispatch:
    inputs:
      rango:
        description: 'Rango de descarga'
        required: true
        default: 'automatico'
        type: choice
        options:
          - automatico        # usa ventana de corrección (6 meses)
          - 2021-06-01        # backfill completo desde inicio de la tarifa 2.0TD
```

En la ejecución programada (y en dispatch con `automatico`) `RANGO` queda vacío y el script usa el modo automático. Solo cuando se elige `2021-06-01` se pasa `--from 2021-06-01` al script.

Tras la descarga, el paso `Verificar frescura e integridad temporal de datos` ejecuta `scripts/check_data_freshness.py` (primero su self-test con fixtures sintéticos, después el chequeo real): si el dato más reciente de PVPC supera 1 día de antigüedad, el de Excedentes 2 días o el de SSAA 2 meses, si falta un día intermedio o si un día ya cerrado está incompleto/malformado, el workflow falla y GitHub notifica al propietario, en vez de terminar en verde con datos degradados.

La comprobación de salud operativa basada en la fecha actual vive deliberadamente en `pvpc.yml`. El test Vitest del repositorio (`tests/pvpc-dataset-integrity.test.js`) es independiente del reloj: exige continuidad y completitud de todos los días anteriores al último día publicado de cada zona y permite que únicamente ese último día esté parcial. Esto evita que una incidencia temporal del refresco nocturno bloquee despliegues de código ajenos a los datos, sin relajar la integridad del histórico versionado.

Después, si hay cambios en `data/` (14/08/2026):
- Se instala Node 22 (`actions/setup-node@v6`, misma versión que `tests.yml`) y se ejecuta
  `npm ci`, solo cuando hubo cambios — no en ejecuciones sin novedades.
- Se corren específicamente `tests/pvpc-dataset-integrity.test.js` y `tests/ssaa-dataset.test.js`
  (no `npm test` completo: su `pretest` dispara `sync:seo-docs`, que puede tocar el working tree
  justo antes de un commit de datos) — si fallan, el job aborta antes de comprometer nada en `main`.
- Se hace commit con `git add data/pvpc/ data/surplus/ data/ssaa/`
- Se dispara `tests.yml` mediante la API de GitHub, que repite la suite completa como segunda
  comprobación tras el push (no es redundante: responde a "¿el repositorio completo sigue siendo
  correcto?", no solo "¿estos datos son publicables?").

### Horario de Actualización

| Parámetro | Valor | Notas |
|-----------|-------|-------|
| **Hora UTC** | 20:00 | GitHub Actions usa UTC |
| **Hora Madrid** | 21:00 CET / 22:00 CEST | Después de la ventana habitual de publicación |
| **Frecuencia** | Diaria | Se ejecuta automáticamente |
| **Timezone cron** | UTC | GitHub Actions usa UTC |

### Scripts Python

**`scripts/pvpc_auto_fill.py`** — PVPC (1001) y Excedentes (1739)

```
Flujo (modo automatico):
1. Leer variable entorno ESIOS_API_KEY
2. Para cada indicador y cada zona (8741-8745):
   a. Siempre re-descargar los ultimos 6 meses completos (ventana de corrección)
      → Captura rectificaciones de REE en precios ya publicados
   b. El guard posterior detecta días faltantes o incompletos de cualquier antigüedad;
      si aparecen fuera de la ventana, el workflow falla y se requiere backfill manual
   c. Descargar de ESIOS API, convertir EUR/MWh → EUR/kWh
   d. Merge con fichero mensual existente: sobreescribe el dia si el dato nuevo
      es estructuralmente completo (24/23/25 puntos segun cambio horario)
   e. Guardar en /data/{pvpc|surplus}/{geoId}/{YYYY-MM}.json
   f. Actualizar indices (index.json)
3. Si hay cambios, el workflow los commitea y hace push

Flujo (backfill manual con --from 2021-06-01):
  Mismo proceso pero descargando todo el historico desde esa fecha; es la vía para
  reparar huecos anteriores a la ventana de corrección.
  El merge garantiza que no se pierden datos ya correctos.
```

**`scripts/ssaa_auto_fill.py`** — Servicios de Ajuste (10328)

```
Descarga siempre los ultimos 24 meses en una sola peticion HTTP (dato mensual).
Sobreescribe data/ssaa/index.json completo en cada ejecucion.
Cualquier correccion de REE queda recogida automaticamente.
```

**`scripts/check_data_freshness.py`** — Guardia de frescura e integridad temporal (los tres datasets)

```
Frescura: PVPC ultimo dia con datos >= hoy-1 · Excedentes >= hoy-2 · SSAA mes 'to' >= mes actual-2.
Integridad PVPC/excedentes: todo dia anterior al dia local vigente en la zona del fichero
debe contener exactamente las horas civiles esperadas (23/24/25 por DST), no puede faltar
ningun dia intermedio y los timestamps deben ser horarios, continuos y del mismo dia local.
El dia vigente y los futuros pueden estar parciales, pero nunca superar el maximo esperado ni
contener saltos, duplicados o timestamps de otro dia.
Cada fila `[timestamp, precio]` (14/08/2026) se exige de exactamente 2 elementos, con ambos
numericos y finitos (`math.isfinite`) — un NaN/Infinity que se colara pese a las defensas de
ingesta de `pvpc_auto_fill.py`/`ssaa_auto_fill.py` (que ya lo filtran y serializan con
`allow_nan=False`) se detecta aqui como ultima red antes del commit. Los valores mensuales de
`data/ssaa/index.json` tambien se validan como numericos y finitos, no solo la fecha `to`.
Exit 1 con listado de datasets rancios/incompletos/ilegibles → `pvpc.yml` falla antes
de commitear y GitHub notifica.
--self-test: valida frescura, JSON/ausencias, historico incompleto, dias totalmente ausentes,
parcialidad valida de hoy/futuro, continuidad horaria, DST 23/25h, precio NaN/Infinity y valor
SSAA no finito; pvpc.yml lo ejecuta antes del chequeo real.
--root DIR: apunta el chequeo a otra raiz (util para pruebas).
```

**Requisitos**:
- Python 3.11+
- Token ESIOS API (variable de entorno `ESIOS_API_KEY`)
- Permisos de push en GitHub (token de Actions)

**Ventana de corrección (pvpc_auto_fill.py)**:
- Los ultimos 6 meses se re-descargan siempre, aunque los datos parezcan completos
- Motivo: REE publica rectificaciones de precios pasados que no alteran el numero de puntos horarios pero si sus valores
- Para correcciones mas antiguas: lanzar backfill manual desde GitHub Actions → Run workflow → `2021-06-01`

---

## 6. Cálculo del PVPC en Cliente

### Archivo: `js/pvpc.js`

**Responsabilidades**:
1. Cargar JSONs mensuales desde `/data/pvpc/`
2. Calcular precio promedio por período (punta/llano/valle)
3. Caché local en localStorage (1 día)
4. Interfaz para lf-app.js y lf-calc.js

### Periodificación 2.0 TD (España)

```
┌─────────────────────────────────────────────────────────────┐
│ PERIODO PUNTA (P1)                                          │
│ ├─ Lunes-viernes: 10h-14h y 18h-22h                        │
│ └─ Horas: 10,11,12,13,18,19,20,21                          │
├─────────────────────────────────────────────────────────────┤
│ PERIODO LLANO (P2)                                          │
│ ├─ Lunes-viernes: 8h-10h, 14h-18h, 22h-24h               │
│ └─ Horas: 8,9,14,15,16,17,22,23                           │
├─────────────────────────────────────────────────────────────┤
│ PERIODO VALLE (P3)                                          │
│ ├─ Lunes-viernes: 0h-8h                                    │
│ ├─ Sábados, domingos: todo el día                          │
│ ├─ Festivos nacionales: todo el día                        │
│ └─ Horas: 0,1,2,3,4,5,6,7 (entre semana)                  │
└─────────────────────────────────────────────────────────────┘
```

### Festivos Nacionales (España)

Se consideran **valle** todo el día (criterio CNMC Circular 3/2020, solo festivos nacionales de fecha fija):
- 1 enero (Año Nuevo)
- 6 enero (Reyes Magos)
- 1 mayo (Día del Trabajo)
- 15 agosto (Asunción)
- 12 octubre (Hispanidad)
- 1 noviembre (Todos los Santos)
- 6 diciembre (Constitución)
- 8 diciembre (Inmaculada)
- 25 diciembre (Navidad)

No se incluyen festivos móviles (por ejemplo, Viernes Santo).

### Cálculo de Precios Promedio por Período

```javascript
// Para cada período (punta, llano, valle):
// 1. Identificar horas del período en la fecha
// 2. Obtener precios horarios de /data/pvpc/{geoId}/{YYYY-MM}.json
// 3. Calcular promedio aritmético

Ejemplo (1 enero 2025):
  Valle (festivo):
    - 24 horas (0-23) = precios [0.182, 0.183, ..., 0.189]
    - Promedio = suma / 24 = 0.1625 €/kWh
```

### Caché en localStorage

```
Prefijo de clave: pvpc_cache_v3

`v3` se introdujo con el endurecimiento de agosto de 2026 para invalidar de forma automática
resultados `v2` que pudieran haberse calculado con cobertura mensual parcial antes del contrato
*fail closed*. Las claves antiguas dejan de leerse; no participan en el ranking.

Formato real (firma):
pvpc_cache_v3:{anchorDate}:{zona}:{codigoPostal}:{viviendaCanarias}:{p1}:{p2}:{dias}:{cPunta}:{cLlano}:{cValle}:{bonoSocialOn}:{bonoSocialTipo}:{bonoSocialLimite}:{csvSignature}

Payload típico:
{
  "tarifa": { "...": "..." },
  "meta": { "precioPunta": 0.27, "precioLlano": 0.18, "precioValle": 0.08 },
  "ts": 1707213672000
}
```

**Control de antigüedad**:
- Se usa `anchorDate` (ayer) para invalidez diaria natural.
- Limpieza LRU por prefijo con límite de 30 entradas.

---

## 7. Integración con Comparador

### Interfaz Cliente

**Archivo**: `js/lf-app.js` + `js/lf-calc.js`

```javascript
// 1. Tomar zona fiscal del formulario (Península, Canarias, CeutaMelilla)
// 2. Mapear zona -> geoId (8741..8745; Ceuta usa fallback a 8745 si falta mes)
// 3. Cargar meses necesarios de /data/pvpc/{geoId}/{YYYY-MM}.json
// 4. Calcular precio medio por periodo (P1/P2/P3) y factura PVPC
// 5. Inyectar resultado PVPC en el ranking del comparador
```

### Variables Globales

```javascript
window.PVPC_DATASET_BASE = "/data/pvpc";   // base dataset estático
window.pvpcLastMeta = null;                // meta de cálculo PVPC para UI
window.pvpcPotenciaExcedida = false;       // guardrail > 10 kW
```

---

## 8. Validación y Testing

### Validar Estructura JSON

```bash
# Sintaxis válida
node -e "console.log(JSON.parse(require('fs').readFileSync('data/pvpc/8741/2025-01.json')))"

# Contar horas por día (23/24/25 según cambio horario)
node -e "
  const d = JSON.parse(require('fs').readFileSync('data/pvpc/8741/2025-01.json'));
  Object.entries(d.days).forEach(([date, hours]) => {
    console.log(date, ':', hours.length, 'horas');
  });
"

# Validar el guard operativo de precios (0 <= precio <= 1 EUR/kWh)
node -e "
  const d = JSON.parse(require('fs').readFileSync('data/pvpc/8741/2025-01.json'));
  Object.values(d.days).forEach(hours => {
    hours.forEach(([ts, price]) => {
      if (price < 0 || price > 1) console.warn('ALERTA: precio inválido', price);
    });
  });
"
```

### Validar Timestamps

```bash
# Verificar que los timestamps están en orden y separados por 3600 s (1 hora)
node -e "
  const d = JSON.parse(require('fs').readFileSync('data/pvpc/8741/2025-01.json'));
  const sample = Object.values(d.days)[0];
  for (let i = 1; i < sample.length; i++) {
    const diff = sample[i][0] - sample[i-1][0];
    if (diff !== 3600) console.warn('Gap:', diff, 'segundos');
  }
"
```

### Testing Manual en Browser

```javascript
// En consola del navegador
const geoId = 8741;
const month = '2026-01';
fetch(`/data/pvpc/${geoId}/${month}.json`)
  .then(r => r.json())
  .then(data => {
    console.log('Zona:', data.geo_id, 'Mes:', month);
    console.log('Días:', Object.keys(data.days).length);
    console.log('Precio max:', data.meta.max_after_conversion, '€/kWh');
  });
```

---

## 9. Historial de Versiones

### Schema v2 (Actual)

**Cambios vs v1**:
- Timestamps en segundos (antes: milisegundos)
- Conversión automática €/MWh → €/kWh
- Metadatos mejorados (max_price, heuristic_applied)
- Soporte completo para todas las zonas

### Schema v1 (Obsoleto)

- Timestamps en milisegundos
- Precios en €/MWh (sin conversión)
- Metadatos básicos

---

## 10. Troubleshooting

### Problema: Precios PVPC no cargan

**Causas posibles**:
1. Archivo JSON no existe → comprobar `/data/pvpc/{geoId}/{YYYY-MM}.json`
2. Syntax error en JSON → validar con `jq . <archivo>`
3. Timezone incorrecto → verificar que `timezone` sea válido
4. LocalStorage lleno → limpiar caché en desarrollador

**Solución**:
```javascript
// En consola: eliminar todas las generaciones de caché PVPC
Object.keys(localStorage)
  .filter((k) => k.startsWith('pvpc_cache_v'))
  .forEach((k) => localStorage.removeItem(k));
location.reload();
```

### Problema: Precios no actualizados después de la ejecución diaria

**Causas posibles**:
1. GitHub Actions no se ejecutó → verificar logs en `.github/workflows/`
2. Token ESIOS expiró → renovar en GitHub Secrets
3. API de ESIOS no responde → comprobar status en https://www.esios.ree.es/

**Verificación**:
```bash
# Comprobar timestamp de último cambio
git log --oneline data/pvpc/8741/2026-01.json | head -1

# Comprobar última actualización
head -1 data/pvpc/8741/2026-01.json | grep generated_at
```

### Problema: Precios muy altos o muy bajos (outliers)

**Causas posibles**:
1. Error en conversión €/MWh → €/kWh
2. Dato incorrecto de ESIOS API
3. Evento extraordinario (máxima demanda, generación renovable cero)

**Verificación**:
```javascript
// Comprobar conversión
const mwh = 182.79;  // ESIOS original
const kwh = mwh / 1000;  // Esperado: 0.18279
console.log('Correcto:', kwh === 0.18279);
```

---

## 11. Documentación de Referencia

- **ESIOS API**: https://www.esios.ree.es/
- **Indicador PVPC (1001)**: https://www.esios.ree.es/#/es/indicators/1001
- **Periodificación 2.0 TD**: Circular 3/2020 de la CNMC (BOE-A-2020-1066)
- **Festivos en España**: https://www.boe.es/

---

## 11.1 Garantías de consumo runtime

El guard de GitHub Actions protege el snapshot publicado, pero el navegador debe tratar también
fallos parciales de CDN/red. Desde agosto de 2026 se aplican estas garantías adicionales:

- **PVPC estándar (sin CSV): fail closed.** El periodo acaba en días cerrados y debe existir
  cada día solicitado completo en la zona horaria del dataset. `pvpc.js` valida 23/24/25 puntos
  consecutivos según DST, timestamps dentro del día civil y presencia de primera/última hora.
  Un mes ausente, un 503 o un día incompleto devuelve PVPC no disponible; no se calcula ni se
  persiste una caché parcial.
- **Validador de día civil compartido (12/08/2026).** `validatePvpcDayCoverage`/
  `validateClosedPvpcDay` viven en `js/lf-csv-utils.js` y son la única implementación: home,
  Observatorio (`pvpc-stats-engine.js`, `pvpc-stats-csv.js`) y excedentes (`lf-surplus-prices.js`)
  la consumen igual, sustituyendo tres comprobaciones divergentes que solo verificaban "cada fila
  es un par numérico" (un día con un único punto horario pasaba como sano). Excepción `allowPartial`:
  cualquier día `>= hoy` (según la zona horaria del propio dataset) puede tener menos horas de las
  esperadas, porque REE ya publica el día siguiente sobre las 20:15 y ese día puede llegar incompleto
  dentro del mismo fichero mensual sin que sea un fallo. Con `allowPartial`, lo publicado sigue
  teniendo que ser correcto y contiguo desde medianoche.
- **Completitud mensual (13/08/2026).** El runtime acepta exclusivamente `schema_version: 2`:
  exige `from`/`to` coherentes y todas las fechas diarias consecutivas. Un mes histórico debe
  cubrir del día 1 al último natural; un mes vigente puede terminar en el último día publicado,
  pero no tener huecos, días provisionales ni entrar como caché positiva. Además, el runtime
  aplica la tolerancia de frescura del guard operativo (PVPC: 1 día; excedentes: 2 días).
  Los días aceptados por
  `allowPartial` se conservan como `provisionalDays`: el Observatorio los señaliza en sus KPIs y
  ni éste ni las cachés mensuales de excedentes los retienen, para que la misma sesión reintente
  cuando REE complete la publicación.
- **PVPC con CSV:** conserva su contrato específico de cobertura exacta/híbrida/media. Aquí sí
  puede existir cobertura parcial porque se informa mediante `pvpcCoverage` y se aplican los
  umbrales documentados del 10% de horas y kWh.
- **Service Worker:** ante 408/429/5xx de PVPC, excedentes o SSAA usa una copia `2xx` sana del
  build activo si existe. Un 404/410 nunca se oculta con caché antigua.
- **Payload 200 malformado:** los cargadores de negocio no equiparan `response.ok` con dato válido.
  SSAA, excedentes y Observatorio exigen estructura mínima utilizable; un JSON vacío/malformado
  se rechaza sin *negative-cache* y puede reintentarse en la misma sesión.
- **Excedentes:** un fallo mensual no se hace *negative-cache*; la misma sesión puede reintentar
  al recuperarse la red.
- **Identidad del fichero horario (20/08/2026):** la cobertura temporal no demuestra que el JSON
  corresponda al recurso solicitado. `validateStaticPriceDatasetIdentity` es estricto por defecto:
  las rutas PVPC primarias y el motor anual del Observatorio exigen `schema_version`, `geo_id`,
  `indicator`, `unit`, `epoch_unit` y `timezone` coherentes. Las rutas que ya aceptaban payloads v2
  sin toda esa metadata (excedentes normal/fallback y vista rapida) usan un modo de compatibilidad:
  un campo AUSENTE se tolera, pero cualquier campo PRESENTE y contradictorio invalida el mensual.
  Esa compatibilidad evita convertir metadata historicamente opcional en *negative-cache* sin volver
  a aceptar un fichero que se identifica explicitamente como otra zona/indicador/unidad.
- **Timezone de excedentes y CCH-CONS (20/08/2026):** el generador actual de artefactos 1739 sigue
  publicando `Europe/Madrid` como se documenta arriba, pero el runtime no usa esa metadata como una
  redefinicion del reloj CCH-CONS. En la valoracion horaria se usa la timezone declarada por el
  dataset y, si falta, el geo como fallback. Se mantiene el contrato DST ya cerrado: en el dia corto
  de marzo desaparece la 02:00 en Peninsula y la 01:00 en Canarias; ambos casos siguen teniendo 23h.
- **Manifest del Observatorio (20/08/2026):** `index.json` es ayuda de descubrimiento, NO autoridad
  de completitud. `monthsExpected` se deriva del calendario (desde junio de 2021, sin meses futuros).
  Si el manifest omite un mes historico, el motor igualmente intenta ese mensual; si falta o falla,
  el ano queda `partial:true` y no entra en cache positiva. Esto evita que un indice degradado
  redefina silenciosamente un ano incompleto como completo.
- **SSAA (20/08/2026):** `data/ssaa/index.json` solo entra en cache positiva si conserva su identidad
  (`schema_version:1`, indicador 10328, `EUR/kWh`, `Europe/Madrid`), todos los valores publicados son
  finitos y estan en el rango de plausibilidad ya exigido por el repositorio (`0 <= rate < 0.1`), y
  `latest_complete_month`, `latest_value` y `to` son coherentes. El cero sigue siendo un dato valido;
  un mes historico ausente sigue siendo `unavailable`, no cero ni sustitucion por el ultimo mes.
- **Deadline de JSON completo (20/08/2026):** los loaders monetarios que usan `lf-csv-utils.js`
  mantienen el `AbortController` hasta consumir/parsing de `response.json()`; recibir headers 200 no
  cancela el deadline. La vista rapida `index-extra.js` conserva deliberadamente su llamada historica
  `fetch(url, {cache:'no-cache'})` y aplica un deadline local con `Promise.race`: deja de esperar
  fetch+body y permite reintento, aunque no aborta el request subyacente. La busqueda de guias usa
  un `AbortController` local hasta terminar el JSON y, al fallar, cae a busqueda basica.


---

## 12. Observatorio PVPC

El **Observatorio PVPC** (`/estadisticas/`) es una capa de visualización avanzada construida sobre los mismos datos JSON estáticos documentados aquí.


La carga anual conserva metadatos `monthsExpected`, `monthsLoaded`, `failedMonths` y `partial`.
Si un fichero que el manifiesto declaraba disponible falla, el año puede mostrarse para análisis
exploratorio pero la UI avisa explícitamente de que los indicadores son parciales y enumera los
meses fallidos. Ese resultado parcial **no entra en la caché de sesión**: una nueva carga vuelve
a intentar el mes. El propio manifiesto tampoco se guarda como fallo (`null`) tras un error
transitorio.

El aviso "⚠ parcial" no se limita al pie del gráfico de tendencia: `getKpiPartialFlags()`
(`js/pvpc-stats-ui.js`) lo propaga a los 5 KPIs. Los que dependen solo del año visible (cierre,
media 7 días, media 30 días) se marcan si ese año es parcial; el rolling 12 meses y el YoY leen
además el año anterior (o el año de comparación de YoY), así que se marcan si el año visible O el
año del que dependen está parcial (13/08/2026).

### Funcionalidades
- **Evolución**: Gráfica de tendencia anual (media diaria) para detectar patrones estacionales.
- **Perfil Horario**: Promedio de precios por hora (0-23h) con consejo de mejor bloque 3h.
- **Comparativa**: Superposición de años anteriores (2021-presente) para analizar la tendencia del mercado.
- **KPIs**: Tarjetas con precio medio del último día, semana, mes y año móvil.
- **Selector PVPC/Excedentes** y **selector por mes** para filtrar el perfil horario.
- **CSV Excedentes**: subida CSV/XLSX y cálculo real por mes y total anual (€/kWh, € y ventana 80% de vertido).

### Lógica de Frontend
1. **`js/pvpc-stats-engine.js`**: carga los JSONs mensuales del año seleccionado (y anteriores para comparativa), agrega medias diarias/mensuales/horarias y mantiene caché en memoria (`Map` + LRU simple).
2. **`js/pvpc-stats-csv.js`**: parsea CSV/XLSX de excedentes, indexa las horas CNMC y calcula la compensación personal contra los datasets estáticos.
3. **`js/pvpc-stats-ui.js`**: coordina los controles, renderiza KPIs/tablas y usa `Chart.js` para visualizar los datos procesados.

### Dependencias
- Requiere que los JSONs mensuales (`/data/pvpc/{geoId}/{YYYY-MM}.json`) estén actualizados.
- No utiliza ninguna API externa en tiempo de ejecución (todo es estático).

---

⚡ Arquitectura PVPC: **100% estática, sin backend, actualización automática diaria**

*Documentación precisa para desarrollo y mantenimiento*
