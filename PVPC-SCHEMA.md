# ⚡ Arquitectura PVPC y Excedentes — Documentación Completa

Documentación técnica precisa de la estructura de datos, actualización automática y procesos del **PVPC (Precio Voluntario del Pequeño Consumidor)** en luzfija.es.
Para inventario funcional completo del sitio (incluyendo observatorio, comparador principal y simulador BV), ver `CAPACIDADES-WEB.md`.

---

## 1. Visión General

### ¿Qué es PVPC?
- **PVPC**: Tarifa regulada de electricidad fijada por el Gobierno español
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

```yaml
name: PVPC Daily Update
on:
  schedule:
    - cron: '0 20 * * *'  # 20:00 UTC = 21:00 CET / 22:00 CEST en Madrid

jobs:
  update-pvpc:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.14'
      - name: Download PVPC data (auto-detect gaps)
        env:
          ESIOS_API_KEY: ${{ secrets.ESIOS_API_KEY }}
        run: |
          python scripts/pvpc_auto_fill.py --out-dir data/pvpc --indicator 1001 --geos 8741 8742 8743 8744 8745
          python scripts/pvpc_auto_fill.py --out-dir data/surplus --indicator 1739 --geos 8741 8742 8743 8744 8745
      - name: Check if there are changes
        id: check_changes
        run: |
          CHANGED_FILES=$(git status --porcelain -- data/ | wc -l)
          if [ "$CHANGED_FILES" -eq 0 ]; then
            echo "has_changes=false" >> $GITHUB_OUTPUT
          else
            echo "has_changes=true" >> $GITHUB_OUTPUT
            git status --short -- data/
          fi
      - name: Commit and push if there are changes
        if: steps.check_changes.outputs.has_changes == 'true'
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          git add data/pvpc/ data/surplus/
          HORA=$(TZ=Europe/Madrid date +%H:%M)
          git commit -m "chore: actualizar precios PVPC y Excedentes - $HORA"
          git pull --rebase
          git push
```

El workflow real también dispara `tests.yml` mediante la API de GitHub cuando publica nuevos datos.

### Horario de Actualización

| Parámetro | Valor | Notas |
|-----------|-------|-------|
| **Hora UTC** | 20:00 | GitHub Actions usa UTC |
| **Hora Madrid** | 21:00 CET / 22:00 CEST | Después de la ventana habitual de publicación |
| **Frecuencia** | Diaria | Se ejecuta automáticamente |
| **Timezone cron** | UTC | GitHub Actions usa UTC |

### Script Python: `scripts/pvpc_auto_fill.py`

**Función**: Descargar precios de ESIOS y actualizar JSONs locales

```
Flujo:
1. Leer variable entorno ESIOS_API_KEY
2. Para cada indicador (1001 PVPC, 1739 excedentes):
   a. Para cada zona (8741-8745), detectar huecos en mes actual + anterior
   b. Descargar solo datos faltantes de ESIOS API
   c. Convertir €/MWh → €/kWh
   d. Guardar en /data/{pvpc|surplus}/{geoId}/{YYYY-MM}.json
   e. Actualizar metadatos e índices (`index.json`)
3. Si hay cambios, commitear y push desde el workflow
```

**Requisitos**:
- Python 3.11+
- Token ESIOS API (variable de entorno `ESIOS_API_KEY`)
- Permisos de push en GitHub (token de Actions)

**Detección de Huecos**:
- Si faltan precios para hoy → descargar
- Si mes anterior incompleto → rellenar
- Si huecos en mes actual → detectar y descargar

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
Prefijo de clave: pvpc_cache_v1
Formato real (firma):
pvpc_cache_v1:{anchorDate}:{zona}:{codigoPostal}:{viviendaCanarias}:{p1}:{p2}:{dias}:{cPunta}:{cLlano}:{cValle}

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

# Validar rango de precios (0 < precio < 1 EUR/kWh)
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
# Verificar que timestamps están en orden y separo de 3600s (1 hora)
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
// En consola
localStorage.removeItem('pvpc_cache_8741_2026-01-15');
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
- **Periodificación 2.0 TD**: Orden TED/712/2019
- **Festivos en España**: https://www.boe.es/

---

## 12. Observatorio PVPC

El **Observatorio PVPC** (`/estadisticas/`) es una capa de visualización avanzada construida sobre los mismos datos JSON estáticos documentados aquí.

### Funcionalidades
- **Evolución**: Gráfica de tendencia anual (media diaria) para detectar patrones estacionales.
- **Perfil Horario**: Promedio de precios por hora (0-23h) con consejo de mejor bloque 3h.
- **Comparativa**: Superposición de años anteriores (2021-presente) para analizar la tendencia del mercado.
- **KPIs**: Tarjetas con precio medio del último día, semana, mes y año móvil.
- **Selector PVPC/Excedentes** y **selector por mes** para filtrar el perfil horario.
- **CSV Excedentes**: subida CSV/XLSX y cálculo real por mes y total anual (€/kWh, € y ventana 80% de vertido).

### Lógica de Frontend (`js/pvpc-stats-engine.js`)
1. **Carga**: Descarga todos los JSONs mensuales del año seleccionado (y anteriores para comparativa).
2. **Agregación**: Calcula medias diarias, mensuales y horarias en el cliente.
3. **Cache**: Utiliza caché en memoria (`Map` + LRU simple) para evitar recalcular y redescargar dentro de la sesión.
4. **Renderizado**: Usa `Chart.js` para visualizar los datos procesados.

### Dependencias
- Requiere que los JSONs mensuales (`/data/pvpc/{geoId}/{YYYY-MM}.json`) estén actualizados.
- No utiliza ninguna API externa en tiempo de ejecución (todo es estático).

---

⚡ Arquitectura PVPC: **100% estática, sin backend, actualización automática diaria**

*Documentación precisa para desarrollo y mantenimiento*
