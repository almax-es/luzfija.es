# 📋 Esquema de Datos JSON — luzfija.es

Documentación precisa de los archivos JSON que alimentan el comparador de tarifas.
Para inventario funcional completo de producto (todas las páginas y flujos), ver `CAPACIDADES-WEB.md`.

---

## 1. `tarifas.json` — Base de Datos de Tarifas Eléctricas

**Ubicación**: `/tarifas.json`
**Tamaño**: ~65 KB
**Estructura**: Objeto raíz con aviso `_meta`, array de tarifas en `tarifas` y sello `updatedAt`
**Última actualización**: 2026-09-01 (`updatedAt`: `2026-09-01T09:41:48.389Z`)
**Total tarifas documentadas**: 120

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
      "minConsumoAnualExclusivo": "number (optional, mínimo anual comercial del tramo en kWh; informativo, no filtra)",
      "maxConsumoAnual": "number (optional, consumo máximo anual admisible en kWh)",
      "promo": "string (optional, oferta temporal NO incluida en el precio ni en el calculo)",
      "incluyeServiciosAjuste": "boolean (optional, false si el precio publicado no incluye SSAA)",
      "fv": {
        "exc": "number (€/kWh compensación excedentes solares; -1 = indexado)",
        "tipo": "string ('NO COMPENSA' | 'SIMPLE' | 'SIMPLE + BV')",
        "tope": "string ('ENERGIA' | 'ENERGIA_PARCIAL' | '—' si no aplica)",
        "bv": "boolean (true = permite batería virtual)",
        "reglaBV": "string ('NO APLICA' | 'BV MES ANTERIOR')",
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
| `requisitos` | string | ❌ | — | "Consumo ≤8.000 kWh" | Condición o matiz **del precio que ya se muestra**. Solo si hay condiciones especiales |
| `minConsumoAnualExclusivo` | number | ❌ | > 0 | 4000 | Mínimo anual comercial del tramo (`consumo > 4.000`). Se conserva como dato estructurado y debe acompañarse del texto explicativo en `requisitos`, pero **no excluye ni propone excluir tarifas** en la home ni en el simulador solar, tampoco con un año completo o una estimación activada. Un valor vacío se ignora (el campo no se incluye). Desde 14/08/2026, un valor relleno pero no numérico, no positivo, o sin el texto correspondiente en `requisitos`, aborta la generación de `tarifas.json` en vez de ignorarse en silencio. |
| `maxConsumoAnual` | number | ❌ | > 0 | 4000 | Máximo anual de consumo admisible en kWh. Si los kWh ya introducidos lo superan, la tarifa queda fuera del ranking **en cualquier periodo**: el dato registrado por sí solo ya hace imposible cumplir el límite. En un periodo parcial que aún no lo supera, la proyección solo filtra si el usuario la activa. Un valor vacío se ignora (el campo no se incluye). Desde 14/08/2026, un valor relleno pero no numérico, no positivo, o sin el texto correspondiente en `requisitos`, aborta la generación de `tarifas.json` en vez de ignorarse en silencio (ver `minConsumoAnualExclusivo` para la misma regla; además, si ambos campos están rellenos, `minConsumoAnualExclusivo` debe ser estrictamente menor que `maxConsumoAnual`). |

**Cómo se usan los dos campos**

`LF.assessConsumoAnualLimits(tarifas, { consumoKwh, annualScope, coveredDays,
useAnnualEstimate })` evalúa exclusivamente `maxConsumoAnual` en
`js/lf-utils.js`, compartida por el comparador (`js/lf-calc.js`) y el simulador solar
(`js/bv/bv-ui.js`). Devuelve las compatibles, las exclusiones reales y las que produciría la
estimación. Esta última es `consumoKwh * 365 / coveredDays`, no se aplica por defecto y la UI solo
la ofrece si alteraría el conjunto. Las exclusiones efectivas no entran en ranking, KPIs ni
gráfico, y la UI las lista con su motivo.

La diferencia es deliberada: **el máximo es monótono y el mínimo no**. Si el usuario ya registró
4.001 kWh, ningún dato futuro lo devuelve por debajo de 4.000, así que excluir por máximo es seguro.
El mínimo queda como información comercial y no interviene en el ranking. La validación preventiva
de valores incoherentes corresponde al generador/Excel: este JSON no se edita a mano y el
repositorio no lleva test de esquema (ver `AUDITORIA-REGISTRO.md`).
| `promo` | string | ❌ | — | "50 € de descuento repartidos en 5 facturas consecutivas." | Oferta temporal **NO incluida en el precio ni en el cálculo**. Su sola presencia marca la tarifa: el comparador pinta la etiqueta verde "🎁 OFERTA" en la fila y añade la nota en el desglose y en el simulador solar. Nunca se aplica al importe. Ver "Promoción vs Requisitos" más abajo |
| `incluyeServiciosAjuste` | boolean | ❌ | `true` \| `false` | `true` | Campo recomendado internamente: `false` si el precio publicado no incluye SSAA. El comparador suma el valor mensual de `/data/ssaa/` como mayor coste de energía antes de IEE e IVA/IGIC/IPSI. Si falta, se trata como compatible legacy y no se aplica SSAA. |
| `fv.exc` | number | ✅ | -1 o 0.00–0.30 | 0.02 | €/kWh por excedentes volcados a la red. `-1` marca precio indexado: sin curva horaria se usa 0,020 €/kWh como referencia orientativa; con CSV horario el simulador puede usar el indice horario disponible. |
| `fv.tipo` | string | ✅ | Ver notas | "SIMPLE + BV" | Tipo de compensación: cómo se retribuyen excedentes |
| `fv.tope` | string | ✅ | "ENERGIA" \| "ENERGIA_PARCIAL" \| "—" | "ENERGIA" | Límite de compensación (si aplica) |
| `fv.bv` | boolean | ✅ | true \| false | true | ¿Permite acumular excedentes en batería virtual? |
| `fv.reglaBV` | string | ✅ | Ver notas | "BV MES ANTERIOR" | Cómo se aplica la BV acumulada |
| `fv.precioBV` | number | ✅ | ≥ 0 | 0 | €/mes cuota fija mensual neta por el servicio de batería virtual, antes de IVA/IGIC/IPSI. Se prorratea al período de facturación y tributa como servicio. Si una fuente comercial publica un precio final con impuestos incluidos, debe convertirse previamente a neto o verificarse con la comercializadora. Tarifas sin cuota usan `0`. El comparador principal lo aplica cuando `fv.bv = true` y `fv.tipo = "SIMPLE + BV"`; el simulador solar solo requiere `fv.bv = true`. En el dataset actual ambas condiciones coinciden. |
| `requiereFV` | boolean | ✅ | true \| false | false | ¿La tarifa requiere obligatoriamente placas solares? |

### Valores Permitidos

#### `fv.tipo` (Tipo de Compensación)
- `"NO COMPENSA"` — No permite volcar excedentes
- `"SIMPLE"` — Compensación simple (precio fijo por kWh)
- `"SIMPLE + BV"` — Compensación + acumulación mensual
- Estos 3 son los ÚNICOS valores que el generador acepta hoy (`validar_contrato_excel()` aborta
  con cualquier otro).
- **Reservado, NO aceptado hoy:** `"NETO"` (neteo excedentes contra consumo). Ningún consumidor
  JS (`lf-calc.js`, `desglose-calculo.js`, `bv-sim-monthly.js`) implementa esta semántica
  todavía — antes de aceptarlo hay que implementar el cálculo Y ampliar el contrato del
  generador a la vez, nunca solo uno de los dos.

#### `fv.exc` (Precio de Excedentes)
- `0` — Solo permitido con `fv.tipo = "NO COMPENSA"`. Para cualquier otro `fv.tipo`, `0` está
  prohibido y el generador aborta la generación.
- Número positivo — Precio fijo publicado en €/kWh.
- `-1` — Precio indexado/no fijo. Sin trazabilidad horaria los cálculos usan 0,020 €/kWh como referencia orientativa y la interfaz lo avisa. Con CSV horario, el simulador solar puede calcular el valor mes a mes contra `data/surplus/` segun el indice base disponible. Si el indice mensual tiene huecos, el calculo horario solo se acepta con cobertura residual por horas y por kWh de excedente sin valorar; si no, ese mes usa la referencia orientativa.

#### `fv.tope` (Límite de Compensación)
- `"ENERGIA"` — Limitada al coste total de energía consumida (incluye peajes y cargos)
- `"ENERGIA_PARCIAL"` — Limitada al coste de energía pura (excluye peajes y cargos regulados). Solo se puede compensar sobre `consumo − peajesyCargos`. Ej.: Visalia, TotalEnergies
- `"—"` — Sin límite (tarifa lo especifica)
- Estos 3 son los ÚNICOS valores que el generador acepta hoy (`validar_contrato_excel()` aborta
  con cualquier otro).
- **Reservado, NO aceptado hoy:** `"POTENCIA"` (limitada a potencia contratada). Ningún
  consumidor JS implementa esta semántica todavía — antes de aceptarlo hay que implementar el
  cálculo Y ampliar el contrato del generador a la vez.

#### `fv.reglaBV` (Regla de Batería Virtual)
- `"NO APLICA"` — No tiene batería virtual
- `"BV MES ANTERIOR"` — Usa la BV acumulada del mes anterior
- Estos 2 son los ÚNICOS valores que el generador acepta hoy (`validar_contrato_excel()` aborta
  con cualquier otro).
- **Reservado, NO aceptado hoy:** `"BV ACUMULADA"` (suma todos los meses desde el inicio).
  `reglaBV` se lee y se reenvía como metadato en varios sitios del código JS pero nunca se usa
  en una condición que cambie el cálculo — hoy "BV MES ANTERIOR" y "BV ACUMULADA" producirían
  exactamente el mismo resultado numérico si el contrato la aceptara, lo cual sería incorrecto.
  Antes de aceptarla hay que implementar la semántica real Y ampliar el contrato a la vez.

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

### Campo interno `Activa`

El dataset de origen puede incluir un campo interno `Activa` que no forma parte de `tarifas.json`.

- El generador exige literalmente `SI` o `NO` tras el saneo/trim (`safe_str(val).strip()`); **no**
  normaliza mayúsculas/minúsculas, así que `si`, `no`, `Si`, etc. tampoco son válidos para el
  contrato. Cualquier otro valor, incluida una celda vacía, aborta la generación completa de
  `tarifas.json` — no se publica nada hasta corregirla.
- `SI`: la tarifa se incluye en `tarifas.json`. `NO`: la tarifa se omite.
- El parser interno `parse_activa()` reconoce además variantes como `N`/`FALSE`/`FALSO`/`0` como
  equivalentes a "NO", pero esa rama es hoy inalcanzable en la práctica porque
  `validar_contrato_excel()` las rechaza antes por no ser exactamente `SI`/`NO`.

- **Orden de precio: las inactivas NO están exentas** (corregido 24/08/2026). Hasta esa fecha este apartado afirmaba lo contrario ("las tarifas marcadas como inactivas están exentas de las validaciones estrictas de orden por precio"), y el generador tampoco lo comprobaba: `validar_contrato_excel()` solo alimentaba su lista de orden con las filas `Activa=SI`. Los datos desmentían la exención — 17 de las 18 filas inactivas ya seguían el criterio correcto —, así que la documentación describía una exención que nunca se usó. Hoy el generador valida el orden en los **dos bloques por separado** (activas e inactivas), con la misma clave (1P antes que 3P, y dentro de cada tipo por precio ascendente con desempate por P1+P2), y aborta indicando en cuál de los dos está el fallo. Las inactivas siguen agrupadas al final de la hoja, pero ordenadas entre sí.
- Se puede añadir libremente un campo extra **"Motivo Inactiva"** (o similar) para uso interno. Jamás se exportará a `tarifas.json`.

### `promo` vs `requisitos`: en qué se diferencian

Los dos campos son texto libre y se gestionan independientemente en el dataset de origen
(`Promoción` y `Requisitos`). La regla que decide dónde va cada cosa:

| | Significa | Ejemplo |
|---|---|---|
| `promo` | Un beneficio que **NO está** en el precio mostrado: algo extra que el usuario puede conseguir | "50 € de descuento repartidos en 5 facturas consecutivas." |
| `requisitos` | Una condición o un matiz **del precio que ya se está viendo** | "Consumo ≤ 6.000 kWh/año." · "20% descuento durante 12 meses incluido en el precio." |

Dos matices para los casos que parecen caber en las dos columnas:

**Si el descuento es incorporable al término de energía, la duración decide qué precio se publica.**
Si cubre los 12 meses del horizonte de comparación, se publica el precio ya descontado y su condición
va en `requisitos` (Imagina, Endesa, Bualá). Si se agota antes, se publica el precio base y el
beneficio va en `promo` (Energya VM). Ojo: esto vale solo para descuentos que se pueden meter en el
precio; no convierte la duración en criterio universal, porque un regalo o un descuento en euros
sigue yendo a `promo` aunque dure un año.

**Un servicio incluido en el contrato no es una promoción, es una característica de la tarifa**, y va
en `requisitos` con su duración y su coste posterior. Es el caso del monedero gratuito de Gana
Energía durante 12 facturas: no es un regalo separable, es parte de lo que se contrata, y además
cubre el horizonte completo de comparación.

Consecuencias prácticas de la regla:

- **Las promociones nunca se calculan.** El ranking ordena siempre por coste real sin
  descuentos temporales. `promo` solo produce la etiqueta y las notas informativas.
- **Un descuento ya incorporado al precio va en `requisitos`, no en `promo`.** Es el caso de
  las tarifas con descuento a 12 meses (Imagina, Bualá, Endesa): su precio publicado ya lleva
  el descuento aplicado, así que marcarlas como oferta afirmaría que hay algo pendiente de
  conseguir cuando ya se está cobrando descontado.
- **Un descuento de menos de 12 meses obliga a poner el precio base**, porque el precio con
  descuento deja de ser cierto antes de que acabe el año y falsea el ranking. Es el caso de
  Energya VM (25% durante 3 meses): el dataset guarda 0,1391 €/kWh y la oferta se cuenta en `promo`.
- **No hay campo de caducidad.** El usuario rara vez conoce la fecha de fin. La frescura del
  dato la da la fecha de `updatedAt`, que la web ya muestra como "Actualizado el …", junto al
  enlace a la comercializadora que lleva cada fila.

Casos resueltos que conviene no reabrir: un precio garantizado N meses con revisión posterior
desconocida **no es una promoción** sino una tarifa revisable (Esluz, Clarity, Bonpreu,
Atulado); un servicio incluido durante un tiempo tampoco lo es (el monedero de Gana Energía);
y una tarifa cuyo precio está inflado para autofinanciar el regalo lleva etiqueta pero jamás
cálculo, porque aplicarlo sería contarlo dos veces (Visalia Primer mes gratis, con el término
de energía un 9% por encima de su tarifa hermana).

## Herramientas Recomendadas para Edición

- **VS Code**: Extensión "JSON Schema Validator"
- **JSONLint**: https://jsonlint.com/
- **Prettier**: Formateador automático

---

## Historial de Cambios

- **2026-08-24**: Corregido el apartado del campo interno `Activa`, que afirmaba que las tarifas inactivas estaban exentas de la validación de orden por precio. Ni era cierto en los datos (17 de 18 ya lo cumplían) ni lo es en el código: `validar_contrato_excel()` valida ahora el orden de los dos bloques por separado y aborta si alguno está descolocado.
- **2026-08-13**: Los periodos parciales muestran, solo cuando un máximo cambia candidatas, una estimación anual orientativa y reversible. Sigue desactivada por defecto; los máximos ya superados por kWh reales continúan siendo exclusiones obligatorias. `minConsumoAnualExclusivo` deja de filtrar en todos los alcances.
- **2026-08-10**: Añadidos campos opcionales `minConsumoAnualExclusivo` y `maxConsumoAnual` (límites de consumo anual en kWh, columnas T/U del Excel). Desde el 13/08/2026, `assessConsumoAnualLimits` solo filtra por `maxConsumoAnual`; el mínimo se conserva como información comercial.
- **2026-08-06**: Añadido campo opcional `promo` (ofertas temporales que se informan pero nunca se aplican al cálculo). Etiqueta "🎁 OFERTA" en el ranking (`lf-render.js`), nota en el modal de desglose (`desglose-render.js`) y en el simulador solar (`bv-ui.js`). Energya VM y Energya VM 3P pasan a precio base porque su descuento dura solo 3 meses.
- **2026-07-02**: Documentado el esquema de `data/guides-search-index.json` (índice de búsqueda de guías).
- **2026-06-06**: Añadido dataset `/data/ssaa/index.json` para servicios de ajuste mensuales (ESIOS 10328), campo opcional `incluyeServiciosAjuste` y aplicación del coste SSAA en home/simulador solar antes de impuestos.
- **2026-05-30**: Añadido campo `fv.precioBV` (€/mes cuota fija neta de batería virtual, antes de IVA/IGIC/IPSI). Implementado en `lf-calc.js`, `bv-sim-monthly.js`, `desglose-factura.js` y `bv-ui.js`. Las tarifas con cuota no nula se consultan en `tarifas.json`, fuente viva del dataset.
- **2026-05-05**: Documentado `fv.exc = -1` para excedentes indexados y el campo interno `Activa`, que filtra publicación sin excluir validación.
- **2026-04-29**: `tarifas.json` añade `_meta` con aviso de derechos y restricciones de reutilización.
- **2026-04-20**: Ajuste de métricas del repo actual (`tarifas.json` con 39 tarifas)
- **2026-02-14**: Actualización de métricas (`tarifas.json` con 36 tarifas, `updatedAt` renovado) y ajuste de tamaño documentado
- **2026-02-06**: Ajuste de métricas reales (33 tarifas), rango de datos PVPC (desde 2021-06) y estrategia de caché actual
- **2026-01-16**: Documentación inicial

---

⚡ Documentación precisa para mantenimiento sin errores.
