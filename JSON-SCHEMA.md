# 📋 Esquema de Datos JSON — luzfija.es

Documentación precisa de los archivos JSON que alimentan el comparador de tarifas.
Para inventario funcional completo de producto (todas las páginas y flujos), ver `CAPACIDADES-WEB.md`.

---

## 1. `tarifas.json` — Base de Datos de Tarifas Eléctricas

**Ubicación**: `/tarifas.json`
**Tamaño**: ~18 KB
**Estructura**: Array de objetos dentro de `{ tarifas: [...] }`
**Última actualización**: 2026-04-20 (`updatedAt`: `2026-04-20T12:47:07.025Z`)
**Total tarifas documentadas**: 39

### Esquema de Estructura

```json
{
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
        "exc": "number (€/kWh compensación excedentes solares)",
        "tipo": "string (tipo de compensación: 'NO COMPENSA', 'SIMPLE', 'SIMPLE + BV', etc.)",
        "tope": "string (límite de compensación: 'ENERGIA', 'POTENCIA', '—' si no aplica)",
        "bv": "boolean (true = permite batería virtual)",
        "reglaBV": "string (regla de acumulación: 'NO APLICA', 'BV MES ANTERIOR', etc.)"
      },
      "requiereFV": "boolean (true = requiere obligatoriamente placas solares)"
    }
  ]
}
```

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
| `fv.exc` | number | ✅ | 0.00–0.30 | 0.03 | €/kWh por excedentes volcados a la red |
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

## 2. `novedades.json` — Noticias, Alertas y Avisos

**Ubicación**: `/novedades.json`
**Tamaño**: ~2,7 KB
**Estructura**: Array de objetos (NO envuelto en objeto padre)
**Última actualización**: 2026-04-17
**Total noticias activas**: 4 (histórico ilimitado)

### Esquema de Estructura

```json
[
  {
    "fecha": "string (YYYY-MM-DD)",
    "tipo": "string ('novedad' | 'regulatorio' | 'alerta' | 'info' | 'tip' | 'caso')",
    "titulo": "string (máx 100 caracteres, título visible)",
    "texto": "string (texto plano; se detectan enlaces <a> HTTP/HTTPS, máx 500 caracteres)",
    "enlace": "string (URL absoluta o relativa, puede estar vacío)"
  }
]
```

### Campos Detallados

| Campo | Tipo | Obligatorio | Ejemplos | Notas |
|-------|------|-------------|----------|-------|
| `fecha` | string | ✅ | "2026-01-01" | ISO 8601 (YYYY-MM-DD), se ordena DESC automáticamente |
| `tipo` | string | ✅ | "novedad" | Determina icono y color de la tarjeta |
| `titulo` | string | ✅ | "DISA: 0€ consumo" | Aparece como titular de la noticia |
| `texto` | string | ✅ | "DISA lanza promoción..." | Texto plano; si incluye `<a href=\"https://...\">...</a>` se convierte en enlace seguro |
| `enlace` | string | ✅ | "/guias/..." o "" | URL interna o externa, "" = sin enlace |

### Tipos de Noticia y Comportamiento Visual

```
┌─────────────────────────────────────────────────────────┐
│ Tipo        │ Color      │ Icono  │ Propósito           │
├─────────────────────────────────────────────────────────┤
│ "novedad"   │ Violeta    │ ✨     │ Cambios destacados  │
│ "regulatorio"│ Azul      │ 📜     │ Cambios regulatorios│
│ "alerta"    │ Rojo       │ ⚠️     │ Avisos importantes  │
│ "info"      │ Accent2    │ 📊     │ Información general │
│ "tip"       │ Ámbar      │ 💡     │ Consejo práctico    │
│ "caso"      │ Verde      │ 🎯     │ Caso de uso         │
└─────────────────────────────────────────────────────────┘
```

### Ejemplo de Cada Tipo

#### Novedad
```json
{
  "fecha": "2026-03-31",
  "tipo": "novedad",
  "titulo": "Atulado Energía: la tarifa Milenial pasa a precio fijo único desde el 1 de abril de 2026",
  "texto": "Desde el 01/04/2026 la tarifa Milenial de Atulado Energía pasa a ofrecer 1 periodo hasta 15 kW, con el mismo precio de energía en P1, P2 y P3 para despreocuparse de horarios.",
  "enlace": "https://clientes.atuladoenergia.com/tarifas"
}
```

#### Alerta (Aviso Importante)
```json
{
  "fecha": "2025-12-31",
  "tipo": "alerta",
  "titulo": "El 'modo reforzado' está encareciendo tu factura",
  "texto": "Desde abril, Red Eléctrica opera con más ciclos combinados. Esto eleva los servicios de ajuste, costando a los hogares unos 1,20€ extra al mes.",
  "enlace": "/guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html"
}
```

#### Regulatorio (Cambio Legal)
```json
{
  "fecha": "2026-02-26",
  "tipo": "regulatorio",
  "titulo": "Bono Social: el Congreso rechaza el RDL 2/2026 — bajan los descuentos al 35% y 50%",
  "texto": "El Congreso derogó el 26/02/2026 el RDL 2/2026 (177 votos en contra). Rige el régimen permanente del RD 897/2017: 35% para vulnerable y 50% para vulnerable severo.",
  "enlace": "/guias/bono-social-electrico-quien-puede-pedirlo-y-como.html"
}
```

#### Info (Informativo General)
```json
{
  "fecha": "2025-12-20",
  "tipo": "info",
  "titulo": "Buenas noticias: la TUR del gas baja un 8,7%",
  "texto": "Desde enero, la tarifa regulada de gas (TUR) individual baja un 8,7%. Si tienes calefacción de gas, tu factura será más barata.",
  "enlace": ""
}
```

### Reglas de Validación

1. **Fecha**: Debe ser ISO 8601 (YYYY-MM-DD). El ordenamiento es automático (más reciente primero)
2. **Tipo**: Debe ser exactamente uno de: `"novedad"`, `"regulatorio"`, `"alerta"`, `"info"`, `"tip"`, `"caso"`
3. **Título**: Máximo 100 caracteres recomendado (se trunca visualmente en pantallas pequeñas)
4. **Texto**:
   - Máximo 500 caracteres recomendado
   - Se renderiza como texto plano (sin `innerHTML`)
   - Solo se detectan enlaces en formato `<a href="https://...">texto</a>`
   - Los enlaces válidos se normalizan con `target="_blank" rel="noopener noreferrer"`
5. **Enlace**:
   - URLs internas: `/ruta/local.html`
   - URLs externas: `https://ejemplo.com`
   - Sin enlace: `""` (cadena vacía)

### Límites Prácticos

- **Máximo de noticias activas**: 5 (recomendado), sin límite técnico
- **Antigüedad**: Las noticias antiguas pueden archivarse manualmente
- **Actualización**: El widget se carga vía AJAX (no necesita recarga de página)
- **Caché**: `novedades.json` se sirve con estrategia `stale-while-revalidate` en Service Worker

---

## 3. Esquema de Datos PVPC y Excedentes (Estructura)

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

### Cómo validar `novedades.json`

```bash
# Sintaxis JSON válida
node -e "console.log(JSON.parse(require('fs').readFileSync('novedades.json')))"

# Comprobar tipos
node -e "const n = JSON.parse(require('fs').readFileSync('novedades.json')); n.forEach(x => console.log(x.tipo))"
```

---

## Herramientas Recomendadas para Edición

- **VS Code**: Extensión "JSON Schema Validator"
- **JSONLint**: https://jsonlint.com/
- **Prettier**: Formateador automático

---

## Historial de Cambios

- **2026-04-16**: Sincronización con el repo actual (`tarifas.json` con 40 tarifas y `novedades.json` con 4 entradas activas)
- **2026-02-14**: Actualización de métricas (`tarifas.json` con 36 tarifas, `updatedAt` renovado) y ajuste de tamaño documentado
- **2026-02-06**: Ajuste de métricas reales (33 tarifas), rango de datos PVPC (desde 2021-06) y estrategia de caché actual
- **2026-02-03**: Actualización de `novedades.json` (2 noticias activas)
- **2026-01-16**: Documentación inicial

---

⚡ Documentación precisa para mantenimiento sin errores.
