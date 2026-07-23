# 📋 Esquema de Datos JSON — luzfija.es

Documentación precisa de los archivos JSON que alimentan el comparador de tarifas.
Para inventario funcional completo de producto (todas las páginas y flujos), ver `CAPACIDADES-WEB.md`.

---

## 1. `tarifas.json` — Base de Datos de Tarifas Eléctricas

**Ubicación**: `/tarifas.json`
**Tamaño**: ~52 KB
**Estructura**: Objeto raíz con aviso `_meta`, array de tarifas en `tarifas` y sello `updatedAt`
**Última actualización**: 2026-07-23 (`updatedAt`: `2026-07-23T20:16:54.238Z`)
**Total tarifas documentadas**: 101

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
      "incluyeServiciosAjuste": "boolean (optional, false si el precio publicado no incluye SSAA)",
      "fv": {
        "exc": "number (€/kWh compensación excedentes solares; -1 = indexado)",
        "tipo": "string (tipo de compensación: 'NO COMPENSA', 'SIMPLE', 'SIMPLE + BV', etc.)",
        "tope": "string (límite de compensación: 'ENERGIA', 'POTENCIA', '—' si no aplica)",
        "bv": "boolean (true = permite batería virtual)",
        "reglaBV": "string (regla de acumulación: 'NO APLICA', 'BV MES ANTERIOR', etc.)",
        "precioBV": "number (€/mes cuota fija mensual neta por el servicio de batería virtual, antes de IVA/IGIC/IPSI; 0 = sin cuota)"
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
| `p2` | number | ✅ | 0.00–0.50 | 0.090227 | €/kW·día (potencia contratada P2, puede ser 0) |
| `web` | string | ✅ | URL válida | https://endesa.com/... | Enlace a la tarifa (se abre en nueva pestaña) |
| `tipo` | string | ✅ | "1P" \| "3P" | "1P" | 1P = precio uniforme, 3P = discriminación horaria |
| `requisitos` | string | ❌ | — | "Consumo ≤8.000 kWh" | Solo si hay condiciones especiales |
| `incluyeServiciosAjuste` | boolean | ❌ | true \| false | false | Campo recomendado para la Excel/generador: `false` si el precio publicado no incluye SSAA. El comparador suma el valor mensual de `/data/ssaa/` como mayor coste de energía antes de IEE e IVA/IGIC/IPSI. Si falta, se trata como compatible legacy y no se aplica SSAA. |
| `fv.exc` | number | ✅ | -1 o 0.00–0.30 | 0.02 | €/kWh por excedentes volcados a la red. `-1` marca precio indexado: sin curva horaria se usa 0,020 €/kWh como referencia orientativa; con CSV horario el simulador puede usar el indice horario disponible. |
| `fv.tipo` | string | ✅ | Ver notas | "SIMPLE + BV" | Tipo de compensación: cómo se retribuyen excedentes |
| `fv.tope` | string | ✅ | "ENERGIA" \| "ENERGIA_PARCIAL" \| "POTENCIA" \| "—" | "ENERGIA" | Límite de compensación (si aplica) |
| `fv.bv` | boolean | ✅ | true \| false | true | ¿Permite acumular excedentes en batería virtual? |
| `fv.reglaBV` | string | ✅ | Ver notas | "BV MES ANTERIOR" | Cómo se aplica la BV acumulada |
| `fv.precioBV` | number | ✅ | ≥ 0 | 0 | €/mes cuota fija mensual neta por el servicio de batería virtual, antes de IVA/IGIC/IPSI. Se prorratea al período de facturación y tributa como servicio. Si una fuente comercial publica un precio final con impuestos incluidos, debe convertirse previamente a neto o verificarse con la comercializadora. Tarifas sin cuota usan `0`. El comparador principal lo aplica cuando `fv.bv = true` y `fv.tipo = "SIMPLE + BV"`; el simulador solar solo requiere `fv.bv = true`. En el dataset actual ambas condiciones coinciden. |
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
- `-1` — Precio indexado/no fijo. Sin trazabilidad horaria los cálculos usan 0,020 €/kWh como referencia orientativa y la interfaz lo avisa. Con CSV horario, el simulador solar puede calcular el valor mes a mes contra `data/surplus/` segun el indice base disponible. Si el indice mensual tiene huecos, el calculo horario solo se acepta con cobertura residual por horas y por kWh de excedente sin valorar; si no, ese mes usa la referencia orientativa.

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
    "reglaBV": "BV MES ANTERIOR",
    "precioBV": 0
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

## 3. `data/ssaa/index.json` — Servicios De Ajuste Mensuales

**Ubicación**: `/data/ssaa/index.json`
**Fuente**: REE/ESIOS, indicador 10328
**Unidad normalizada**: `EUR/kWh`
**Uso previsto**: sumar una referencia mensual a tarifas cuyo precio publicado no incluye servicios de ajuste.

```json
{
  "schema_version": 1,
  "generated_at_utc": "string (ISO 8601 UTC)",
  "source": "ESIOS",
  "source_url": "https://api.esios.ree.es/indicators/10328",
  "indicator": 10328,
  "name": "Precio medio mensual componente servicios ajuste del sistema",
  "timezone": "Europe/Madrid",
  "unit": "EUR/kWh",
  "from": "YYYY-MM",
  "to": "YYYY-MM",
  "latest_complete_month": "YYYY-MM",
  "latest_value": "number (EUR/kWh)",
  "values": {
    "YYYY-MM": "number (EUR/kWh)"
  },
  "meta": {
    "source_unit": "string or object from ESIOS",
    "unit_suggests_mwh": "boolean",
    "heuristic_applied": "boolean",
    "raw_value_count": "number",
    "parse_error_count": "number"
  }
}
```

Notas:

- ESIOS publica el indicador en `EUR/MWh`; el script `scripts/ssaa_auto_fill.py` lo divide entre 1000.
- `latest_complete_month` excluye el mes en curso y usa el último mes disponible en el dataset.
- No debe aplicarse a PVPC, porque PVPC ya se calcula desde su propio indicador oficial.

---

## 4. `data/guides-search-index.json` — Índice de Búsqueda de Guías

**Ubicación**: `/data/guides-search-index.json`
**Generador**: `scripts/build-guides-search-index.mjs` (invocado por `scripts/sync-seo-docs.mjs`; se regenera con el hook de pre-commit y con `npm run sync:seo-docs`)
**Consumidor**: `js/guides-search.js` (buscador en vivo de `guias.html`; el buscador de `404.html` redirige a `guias.html?q=...`)
**No editar a mano**: se reconstruye desde el HTML de las guías.

```json
{
  "generatedAtUtc": "string (ISO 8601 UTC)",
  "totalGuides": "number",
  "guides": [
    {
      "path": "string (/guias/slug.html)",
      "title": "string",
      "description": "string (subtítulo editorial)",
      "metaDescription": "string (meta description SEO)",
      "intro": "string (primer párrafo)",
      "cardDescription": "string (texto de la tarjeta en guias.html)",
      "categories": ["string (basico|factura|tarifa|solar|ahorro|gestion)"],
      "level": "string (nivel editorial de la guía)",
      "icon": "string (emoji de la tarjeta)",
      "slug": "string (nombre del fichero sin .html, con guiones convertidos a espacios, para matching de búsqueda)",
      "headings": ["string (h2/h3 de la guía)"],
      "faq": ["string (preguntas del bloque FAQ, si existe)"],
      "aliases": ["string (términos adicionales de matching: categorías, nivel, alias editoriales y slug)"],
      "content": "string (texto indexable de la guía)",
      "datePublished": "string (YYYY-MM-DD)",
      "dateModified": "string (YYYY-MM-DD)"
    }
  ]
}
```

La consistencia entre este índice, el HTML de las guías y el buscador se valida en `tests/guides-search.test.js`.

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

- **2026-07-02**: Documentado el esquema de `data/guides-search-index.json` (índice de búsqueda de guías).
- **2026-06-06**: Añadido dataset `/data/ssaa/index.json` para servicios de ajuste mensuales (ESIOS 10328), campo opcional `incluyeServiciosAjuste` y aplicación del coste SSAA en home/simulador solar antes de impuestos.
- **2026-05-30**: Añadido campo `fv.precioBV` (€/mes cuota fija neta de batería virtual, antes de IVA/IGIC/IPSI). Implementado en `lf-calc.js`, `bv-sim-monthly.js`, `desglose-factura.js` y `bv-ui.js`. Las tarifas con cuota no nula se consultan en `tarifas.json`, fuente viva del dataset.
- **2026-05-05**: Documentado `fv.exc = -1` para excedentes indexados y el campo interno `Activa` de la Excel, que filtra publicación sin excluir validación.
- **2026-04-29**: `tarifas.json` añade `_meta` con aviso de derechos y restricciones de reutilización.
- **2026-04-20**: Ajuste de métricas del repo actual (`tarifas.json` con 39 tarifas)
- **2026-02-14**: Actualización de métricas (`tarifas.json` con 36 tarifas, `updatedAt` renovado) y ajuste de tamaño documentado
- **2026-02-06**: Ajuste de métricas reales (33 tarifas), rango de datos PVPC (desde 2021-06) y estrategia de caché actual
- **2026-01-16**: Documentación inicial

---

⚡ Documentación precisa para mantenimiento sin errores.
