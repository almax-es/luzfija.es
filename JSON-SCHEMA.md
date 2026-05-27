# 📋 Esquema de Datos JSON — luzfija.es

Documentación precisa de los archivos JSON que alimentan el comparador de tarifas.
Para inventario funcional completo de producto (todas las páginas y flujos), ver `CAPACIDADES-WEB.md`.

---

## 1. `tarifas.json` — Base de Datos de Tarifas Eléctricas

**Ubicación**: `/tarifas.json`
**Tamaño**: ~32 KB
**Estructura**: Objeto raíz con aviso `_meta`, array de tarifas en `tarifas` y sello `updatedAt`
**Última actualización**: 2026-05-27 (`updatedAt`: `2026-05-27T05:38:40.134Z`)
**Total tarifas documentadas**: 71

### Esquema de Estructura

```json
{
  "_meta": {
    "copyright": "string (titular de derechos)",
    "license": "string (aviso de derechos reservados para selección, normalización, estructura, anotaciones y curación)",
    "usage": "string (restricciones de reutilización comercial y servicios competidores)"
  },
  "tarifas": [
    {
      "nombre": "string (nombre comercial de la tarifa)",
      "cPunta": "number (€/kWh periodo punta)",
      "cLlano": "number (€/kWh periodo llano)",
      "cValle": "number (€/kWh periodo valle)",
      "p1": "number (€/kW·día potencia P1)",
      "p2": "number (€/kW·día potencia P2)",
      "web": "string (URL de contratación)",
      "tipo": "string ('1P' para uniforme, '3P' para discriminación horaria)",
      "requisitos": "string (optional, condiciones especiales si aplican)",
      "fv": {
        "exc": "number (€/kWh compensación excedentes solares; -1 = indexado)",
        "tipo": "string (tipo de compensación: 'NO COMPENSA', 'SIMPLE', 'SIMPLE + BV', etc.)",
        "tope": "string (límite de compensación: 'ENERGIA', 'POTENCIA', '—' si no aplica)",
        "bv": "boolean (true = permite batería virtual)",
        "reglaBV": "string (regla de acumulación: 'NO APLICA', 'BV MES ANTERIOR', etc.)"
      },
      "requiereFV": "boolean (true = requiere obligatoriamente placas solares)"
    }
  ],
  "updatedAt": "string (ISO 8601 UTC, momento de generación del dataset)"
}
```

### Campos Raíz

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| `_meta` | object | ✅ | Aviso operativo de titularidad y restricciones de reutilización del dataset curado. No forma parte del cálculo. |
| `tarifas` | array | ✅ | Lista de tarifas comparables. Es la fuente que consumen el comparador principal y el simulador solar. |
| `updatedAt` | string | ✅ | Fecha/hora UTC de generación del JSON, usada por la web para mostrar el estado de actualización. |

### Campos Detallados

| Campo | Tipo | Obligatorio | Rango | Ejemplo | Notas |
|-------|------|-------------|-------|---------|-------|
| `nombre` | string | ✅ | — | "Endesa Conecta" | Nombre comercial único |
| `cPunta` | number | ✅ | 0.01–0.50 | 0.0988 | €/kWh (10h-14h + 18h-22h laborables) |
| `cLlano` | number | ✅ | 0.01–0.50 | 0.0988 | €/kWh (8h-10h + 14h-18h + 22h-24h laborables) |
| `cValle` | number | ✅ | 0.01–0.40 | 0.0988 | €/kWh (0h-8h laborables + todo fin de semana) |
| `p1` | number | ✅ | 0.01–0.50 | 0.090227 | €/kW·día (potencia contratada P1) |
| `p2` | number | ✅ | 0.01–0.50 | 0.090227 | €/kW·día (potencia contratada P2, puede ser 0) |
| `web` | string | ✅ | URL válida | https://endesa.com/... | Enlace a la tarifa (se abre en nueva pestaña) |
| `tipo` | string | ✅ | "1P" \| "3P" | "1P" | 1P = precio uniforme, 3P = discriminación horaria |
| `requisitos` | string | ❌ | — | "Consumo ≤8.000 kWh" | Solo si hay condiciones especiales |
| `fv.exc` | number | ✅ | -1 o 0.00–0.30 | 0.03 | €/kWh por excedentes volcados a la red. `-1` marca precio indexado: sin curva horaria se usa 0,030 €/kWh como referencia orientativa; con CSV horario el simulador puede usar el indice horario disponible. |
| `fv.tipo` | string | ✅ | Ver notas | "SIMPLE + BV" | Tipo de compensación: cómo se retribuyen excedentes |
| `fv.tope` | string | ✅ | "ENERGIA" \| "ENERGIA_PARCIAL" \| "POTENCIA" \| "—" | "ENERGIA" | Límite de compensación (si aplica) |
| `fv.bv` | boolean | ✅ | true \| false | true | ¿Permite acumular excedentes en batería virtual? |
| `fv.reglaBV` | string | ✅ | Ver notas | "BV MES ANTERIOR" | Cómo se aplica la BV acumulada |
| `requiereFV` | boolean | ✅ | true \| false | false | ¿La tarifa requiere obligatoriamente placas solares? |

### Valores Permitidos

#### `fv.tipo` (Tipo de Compensación)
- `"NO COMPENSA"` — No permite volcar excedentes
- `"SIMPLE"` — Compensación simple (precio fijo por kWh)
- `"SIMPLE + BV"` — Compensación + acumulación mensual
- `"NETO"` — Neteo (excedentes contra consumo)
- Otros tipos según evolución regulatoria

#### `fv.exc` (Precio de Excedentes)
- `0` — No remunera excedentes o no se usa en una tarifa sin compensación.
- Número positivo — Precio fijo publicado en €/kWh.
- `-1` — Precio indexado/no fijo. Sin trazabilidad horaria los cálculos usan 0,030 €/kWh como referencia orientativa y la interfaz lo avisa. Con CSV horario, el simulador solar puede calcular el valor mes a mes contra `data/surplus/` segun el indice base disponible.

#### `fv.tope` (Límite de Compensación)
- `"ENERGIA"` — Limitada al coste total de energía consumida (incluye peajes y cargos)
- `"ENERGIA_PARCIAL"` — Limitada al coste de energía pura (excluye peajes y cargos regulados). Solo se puede compensar sobre `consumo − peajesyCargos`. Ej.: Visalia, TotalEnergies
- `"POTENCIA"` — Limitada a potencia contratada
- `"—"` — Sin límite (tarifa lo especifica)

#### `fv.reglaBV` (Regla de Batería Virtual)
- `"NO APLICA"` — No tiene batería virtual
- `"BV MES ANTERIOR"` — Usa la BV acumulada del mes anterior
- `"BV ACUMULADA"` — Suma todos los meses desde el inicio
- Otras variaciones según comercializadora

### Ejemplo Completo (Tarifa Solar)

```json
{
  "nombre": "Nufri Calma",
  "cPunta": 0.103386,
  "cLlano": 0.103386,
  "cValle": 0.103386,
  "p1": 0.094533,
  "p2": 0.046371,
  "web": "https://www.energianufri.com/es/landing/mas-tarifas-luz-gas",
  "tipo": "1P",
  "requisitos": "Ratio consumo/potencia ≤ 0,75 MWh/kW. Consumo anual ≤ 8.000 kWh/año.",
  "fv": {
    "exc": 0.03,
    "tipo": "SIMPLE + BV",
    "tope": "ENERGIA",
    "bv": true,
    "reglaBV": "BV MES ANTERIOR"
  },
  "requiereFV": false
}
```

---

## 2. Esquema de Datos PVPC y Excedentes (Estructura)

**Ubicaciones**:
- `/data/pvpc/{geoId}/{YYYY-MM}.json` (PVPC, indicador 1001)
- `/data/surplus/{geoId}/{YYYY-MM}.json` (Excedentes, indicador 1739)
**Tamaño**: ~20-30 KB por mes
**Total de zonas**: 5 (8741, 8742, 8743, 8744, 8745)
**Rango de datos**: 2021-06 a presente

Véase `PVPC-SCHEMA.md` para documentación completa de la estructura PVPC.

---

## Validación y Testing

### Cómo validar `tarifas.json`

```bash
# Sintaxis JSON válida
node -e "console.log(JSON.parse(require('fs').readFileSync('tarifas.json')))"

# Comprobar estructura
node -e "const t = JSON.parse(require('fs').readFileSync('tarifas.json')); console.log('Tarifas:', t.tarifas.length)"
```

### Campo interno `Activa` de la Excel

La hoja privada `Tarifas Luz.xlsx` puede incluir una columna `Activa`. Esta columna no forma parte de `tarifas.json`.

- Vacío, `sí` o cualquier valor no negativo: la tarifa se publica.
- `no`, `n`, `false`, `falso` o `0`: la tarifa se omite al generar `tarifas.json` y el post de Facebook.
- El validador privado sigue revisando también las tarifas inactivas y marca su estado de publicación en el informe.

## Herramientas Recomendadas para Edición

- **VS Code**: Extensión "JSON Schema Validator"
- **JSONLint**: https://jsonlint.com/
- **Prettier**: Formateador automático

---

## Historial de Cambios

- **2026-05-05**: Documentado `fv.exc = -1` para excedentes indexados y el campo interno `Activa` de la Excel, que filtra publicación sin excluir validación.
- **2026-04-29**: `tarifas.json` añade `_meta` con aviso de derechos y restricciones de reutilización.
- **2026-04-20**: Ajuste de métricas del repo actual (`tarifas.json` con 39 tarifas)
- **2026-02-14**: Actualización de métricas (`tarifas.json` con 36 tarifas, `updatedAt` renovado) y ajuste de tamaño documentado
- **2026-02-06**: Ajuste de métricas reales (33 tarifas), rango de datos PVPC (desde 2021-06) y estrategia de caché actual
- **2026-01-16**: Documentación inicial

---

⚡ Documentación precisa para mantenimiento sin errores.
