# ⚡ Arquitectura PVPC — Documentación Completa

Documentación técnica precisa de la estructura de datos, actualización automática y procesos del **PVPC (Precio Voluntario del Pequeño Consumidor)** en luzfija.es.

---

## 1. Visión General

### ¿Qué es PVPC?
- **PVPC**: Tarifa regulada de electricidad fijada por el Gobierno español
- **Indicador ESIOS**: 1001 (Precio de mercado del PVPC)
- **Fuente**: REE (Red Eléctrica de España) / ESIOS API
- **Actualización**: Diariamente a las 21:00 Madrid (20:00 UTC)
- **Disponibilidad**: Precios horarios (24 períodos diarios)

### Arquitectura del Proyecto PVPC
```
┌─────────────────────────────────────────────────────────┐
│  Usuarios del Comparador (navegador)                    │
├─────────────────────────────────────────────────────────┤
│  lf-app.js + pvpc.js (cálculo en cliente)              │
├─────────────────────────────────────────────────────────┤
│  /data/pvpc/{geoId}/{YYYY-MM}.json (estático)          │
├─────────────────────────────────────────────────────────┤
│  GitHub Pages (hosting)                                 │
├─────────────────────────────────────────────────────────┤
│  GitHub Actions (CI/CD)                                 │
│  └─ pvpc_auto_fill.py cada día 21:00 Madrid           │
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
- Actualización diaria automática (21:00 Madrid).

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
| `indicator` | int | 1001 | Indicador ESIOS (PVPC) |
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
  // 24 entradas (una cada hora)
]
```

**Notas**:
- Exactamente **24 precios por día** (uno cada hora)
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
  "generated_at_utc": "2026-01-15T20:18:43+00:00",
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

---

## 5. Actualización Automática

### GitHub Actions Workflow

**Archivo**: `.github/workflows/pvpc.yml`

```yaml
name: PVPC Auto-Update
on:
  schedule:
    - cron: '0 20 * * *'  # 20:00 UTC = 21:00 Madrid

jobs:
  update-pvpc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run PVPC update script
        env:
          ESIOS_API_KEY: ${{ secrets.ESIOS_API_KEY }}
        run: python scripts/pvpc_auto_fill.py
      - name: Commit and push
        run: |
          git config user.email "automation@luzfija.es"
          git config user.name "PVPC Bot"
          git add data/pvpc/
          git commit -m "chore: actualizar precios PVPC - $(date +'%H:%M')" || true
          git push
```

### Horario de Actualización

| Parámetro | Valor | Notas |
|-----------|-------|-------|
| **Hora Madrid** | 21:00 | Después del corte de mercado diario de REE |
| **Hora UTC** | 20:00 | UTC+1 en invierno |
| **Frecuencia** | Diaria | Se ejecuta automáticamente |
| **Timezone cron** | UTC | GitHub Actions usa UTC |

### Script Python: `scripts/pvpc_auto_fill.py`

**Función**: Descargar precios de ESIOS y actualizar JSONs locales

```
Flujo:
1. Leer variable entorno ESIOS_API_KEY
2. Para cada zona (8741-8745):
   a. Detectar huecos en mes actual + anterior
   b. Descargar solo datos faltantes de ESIOS API
   c. Convertir €/MWh → €/kWh
   d. Guardar en /data/pvpc/{geoId}/{YYYY-MM}.json
   e. Actualizar metadatos (max_price, etc.)
3. Si hay cambios, commitear a git
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

Se consideran **valle** todo el día:
- 1 enero (Año Nuevo)
- 6 enero (Reyes Magos)
- Viernes Santo (móvil, Pascua -2)
- 1 mayo (Día del Trabajo)
- 15 agosto (Asunción)
- 12 octubre (Hispanidad)
- 1 noviembre (Todos los Santos)
- 6 diciembre (Constitución)
- 25 diciembre (Navidad)

**Cálculo de Pascua**:
```javascript
// Algoritmo Computus (Meeus)
// Calcula el domingo de Pascua automáticamente cada año
```

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
Estructura: pvpc_cache_{geoId}_{YYYY-MM-DD}

Ejemplo:
{
  "pvpc_cache_8741_2026-01-15": {
    "precios": {"punta": 0.27, "llano": 0.18, "valle": 0.08},
    "timestamp": 1673798400,
    "expiry": 86400  // 1 día en segundos
  }
}
```

**Expiración**: 24 horas desde descarga

---

## 7. Integración con Comparador

### Interfaz Cliente

**Archivo**: `js/lf-app.js` + `js/lf-calc.js`

```javascript
// 1. Cargar zona geográfica (detectar o seleccionar)
const geoId = userSelectedGeo || detectGeoFromIP();

// 2. Obtener precios PVPC para mes actual
const pvpcPrices = await pvpc.getPrices(geoId, yearMonth);
// Retorna: { punta, llano, valle, fecha }

// 3. Calcular factura PVPC
const pvpcBill = lf.calc(
  p1, p2, days,
  pvpcPrices.punta,
  pvpcPrices.llano,
  pvpcPrices.valle,
  geoId  // para aplicar impuestos correctos
);

// 4. Renderizar en tabla de tarifas
table.addRow("PVPC", pvpcBill);
```

### Variables Globales

```javascript
window.PVPC_ZONES = [8741, 8742, 8743, 8744, 8745];
window.PVPC_DATA_PATH = "/data/pvpc";
window.PVPC_INDEX_URL = "/data/pvpc/index.json";
```

---

## 8. Validación y Testing

### Validar Estructura JSON

```bash
# Sintaxis válida
node -e "console.log(JSON.parse(require('fs').readFileSync('data/pvpc/8741/2025-01.json')))"

# Contar horas por día (debe ser 24)
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

### Problema: Precios no actualizados después de las 21:00

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
- **Perfil Horario**: Promedio de precios por hora (0-23h) para identificar las horas más baratas (curva de pato).
- **Comparativa**: Superposición de años anteriores (2021-presente) para analizar la tendencia del mercado.
- **KPIs**: Tarjetas con precio medio del último día, semana, mes y año móvil.

### Lógica de Frontend (`js/pvpc-stats-engine.js`)
1. **Carga**: Descarga todos los JSONs mensuales del año seleccionado (y anteriores para comparativa).
2. **Agregación**: Calcula medias diarias, mensuales y horarias en el cliente.
3. **Cache**: Utiliza `localStorage` para persistir los cálculos costosos y evitar descargas repetitivas.
4. **Renderizado**: Usa `Chart.js` para visualizar los datos procesados.

### Dependencias
- Requiere que los JSONs mensuales (`/data/pvpc/{geoId}/{YYYY-MM}.json`) estén actualizados.
- No utiliza ninguna API externa en tiempo de ejecución (todo es estático).

---

⚡ Arquitectura PVPC: **100% estática, sin backend, actualización automática diaria**

*Documentación precisa para desarrollo y mantenimiento*
