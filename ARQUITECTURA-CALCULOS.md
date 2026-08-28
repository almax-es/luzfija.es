# 🧮 Arquitectura de Cálculos - LuzFija.es

**Última actualización**: 23/08/2026
**Estado**: ✅ Validado contra normativa CNMC/BOE
**Referencia CNMC**: v2.1.2 (28/01/2026) — fiscalidad revisada a 13/08/2026: en agosto y septiembre siguen IVA 21% e IEE 5,11269632%, porque el IPC anual definitivo de electricidad de julio (8,4%) no alcanza el umbral de mas del 15% del RDL 18/2026
**Nota de alcance**: Este documento cubre el motor de cálculo. Para inventario funcional completo de la web (todas las páginas y flujos), ver `CAPACIDADES-WEB.md`.

---

## 📋 Tabla de Contenidos

1. [Estructura de Factura](#estructura-de-factura)
2. [Orden de Operaciones (CRÍTICO)](#orden-de-operaciones-crítico)
3. [Motores de Cálculo](#motores-de-cálculo)
4. [Bono Social](#bono-social)
5. [Batería Virtual](#batería-virtual)
6. [Validaciones CNMC](#validaciones-cnmc)
7. [Falsos Positivos Conocidos](#falsos-positivos-conocidos)

---

## Estructura de Factura

### 📊 Componentes (BOE-A-1992-28147, Ley 38/1992)

Una factura de electricidad en España contiene:

```
┌─────────────────────────────────────────────┐
│ TÉRMINO POTENCIA (PVPC: €/kW·año prorrateado)│
│ - P1: kW × 27,704413 €/kW·año × días/365   │
│ - P2: kW × 0,725423 €/kW·año × días/365    │
├─────────────────────────────────────────────┤
│ TÉRMINO ENERGÍA (€/kWh por periodo)         │
│ - P1: 100 kWh × 0,2223 €/kWh               │
│ - P2: 100 kWh × 0,1403 €/kWh               │
│ - P3: 100 kWh × 0,112 €/kWh                │
├─────────────────────────────────────────────┤
│ FINANCIACIÓN BONO SOCIAL (si aplica)       │
│ - 9,011295 €/año                           │
│ - prorrateo a días                         │
├─────────────────────────────────────────────┤
│ DESCUENTO BONO SOCIAL (si aplica)          │
│ - 42,5% o 57,5% sobre base limitada (RDL 7/2026, vigente durante 2026) │
├─────────────────────────────────────────────┤
│ IMPUESTO ELÉCTRICO (IEE)                    │
│ - 5,11269632% (regimen general desde 01/06/2026) │
│   sobre base post-descuento                 │
├─────────────────────────────────────────────┤
│ ALQUILER CONTADOR                           │
│ - 0,81 €/mes prorrateo a días              │
├─────────────────────────────────────────────┤
│ IMPUESTO INDIRECTO (IVA/IGIC/IPSI)          │
│ - Península: IVA vigente (21% desde 01/06/2026) │
│ - Canarias: 0-7% (IGIC)                     │
│ - Ceuta/Melilla: 1-4% (IPSI)                │
└─────────────────────────────────────────────┘
Total = Potencia + Energía + Financ - Desc + IEE + Alquiler + Impuesto
```

---

## Orden de Operaciones (CRÍTICO)

### ⚠️ LA SECUENCIA IMPORTA

```javascript
// PASO 1: Calcular potencia
const potencia = (p1 * dias * tarifaP1) + (p2 * dias * tarifaP2);

// PASO 2: Calcular energía
const energia = (kwhP1 * precioP1) + (kwhP2 * precioP2) + (kwhP3 * precioP3);

// PASO 2B: Añadir SSAA si el precio publicado NO los incluye
// Se tratan como mayor coste de energía antes de impuestos, no como impuesto.
// Entran en base del IEE y después en base del IVA/IGIC/IPSI.
const ssaa = tarifa.incluyeServiciosAjuste === false ? consumoTotal * ssaaMensualEurKwh : 0;
const energiaConSsaa = energia + ssaa;


**Contrato de disponibilidad SSAA (agosto 2026):** `0 €` solo significa coste cero cuando
los SSAA no aplican a la tarifa, el consumo es cero o el dataset publica explícitamente una
tasa mensual `0`. Si `incluyeServiciosAjuste === false` y falta el dataset mensual necesario,
`lf-ssaa.js` devuelve `available:false`; `lf-calc.js` marca esa tarifa como no comparable
(`totalNum = Infinity`, importe `—`) y el simulador BV la excluye del ranking con motivo visible.
Un HTTP 200 vacío/malformado no queda cacheado como dataset. Un mes histórico ausente nunca se
sustituye por el último valor publicado. El último mes completo solo se usa como fallback
deliberado para un mes futuro o todavía parcial.

// PASO 3: Calcular financiación Bono Social
const financiacion = 9.011295 / 365 * dias;

// PASO 4: CALCULAR DESCUENTO BONO SOCIAL
// ⚠️ IMPORTANTE: El descuento se aplica a:
//    - Término fijo COMPLETO
//    - Financiación COMPLETA
//    - Solo parte del término variable (la bonificable según kWh con derecho)
const kwhBonificable = Math.min(consumoTotal, limiteAnualKWh / 365 * dias);
const ratioBonificable = consumoTotal > 0 ? kwhBonificable / consumoTotal : 0;
const baseVariableBonificable = energia * ratioBonificable;
const baseDescuento = potencia + financiacion + baseVariableBonificable;
const descuentoBS = baseDescuento * (bonoSocialOn ? 0.425 : 0); // 42,5% vulnerable (RDL 7/2026, vigente durante 2026)

// PASO 5: BASE PARA IMPUESTOS
const sumaBase = potencia + energiaConSsaa + financiacion - descuentoBS;

// PASO 6: ⭐ CALCULAR IEE (PUNTO CRÍTICO)
// El IEE se calcula sobre la base YA CON EL DESCUENTO RESTADO
// Tasa centralizada vigente configurada: 5,11269632% desde 01/06/2026
// C.calcularIEE(fechaYmd) conserva la fecha por compatibilidad/trazabilidad,
// pero no reconstruye tipos históricos de IEE/IVA por fecha de factura.
// Ref: Ley 38/1992 + RDL 7/2026
const iee = C.calcularIEE(sumaBase, consumoTotal, fechaFactura);
// Implementación interna: Math.max(sumaBase × (tasa/100), consumoTotal × 0,001 €/kWh)

// PASO 7: Alquiler contador
const alquiler = dias * 0.81 * 12 / 365;

// PASOS 8 Y 9: BASE E IMPUESTO INDIRECTO (IVA/IGIC/IPSI)
// La seleccion territorial, composicion de bases y aritmetica de redondeo
// pertenecen al helper fiscal comun; los motores no las reimplementan.
const fiscal = LF_CONFIG.calcularImpuestoIndirecto({
  zona,
  usoFiscal,
  baseEnergia: sumaBase,
  impuestoElectrico: iee,
  baseContador: alquiler,
  baseServicios: costeServicios
});
const impuestoIndirecto = fiscal.impuestoTotal;

// PASO 10: TOTAL
const total = sumaBase + iee + alquiler + impuestoIndirecto;
```

### Contrato De Redondeo Monetario Y Fiscal

Los conceptos monetarios que forman una base fiscal representan centimos, aunque JavaScript pueda
almacenarlos como aproximaciones binarias (`97,51` puede aparecer internamente como
`97.50999999999999`). Antes de aplicar IVA, IGIC o IPSI, `calcularImpuestoIndirecto()` normaliza la
base monetaria a centimos y aplica el tipo desde esos enteros. Para los importes positivos del
comparador, una frontera decimal exacta de medio centimo se redondea hacia arriba: por ejemplo,
`142,50 EUR x 3% = 4,275 EUR` produce `4,28 EUR`.

No sustituyas esa ruta por `round2(base * tipo)`. `Number.EPSILON` no garantiza corregir el error
introducido por una multiplicacion previa: el producto binario puede quedar por debajo del medio
centimo antes de que `round2()` lo reciba. Los tipos indirectos deben seguir centralizados en
`js/lf-config.js`; en la carga productiva normal, home, PVPC, desglose y simulador BV consumen el
mismo resultado fiscal. `js/lf-utils.js` y `js/bv/bv-sim-monthly.js` conservan fallbacks defensivos
si falta `calcularImpuestoIndirecto()`, pero no son la ruta fiscal canonica y mantienen la antigua
aritmetica flotante. El orden de carga normal coloca `lf-config.js` antes de esos consumidores; una
auditoria que atribuya impacto a los fallbacks debe demostrar que una carga parcial alcanza un
importe visible. Ver `ARRANQUE-CARGA.md`.

La igualdad entre motores es una condicion necesaria, no una demostracion de exactitud. Una
regresion puede hacer que todos coincidan en el mismo centimo incorrecto. Las fronteras se validan
tambien contra una referencia decimal construida desde centimos y puntos basicos. El contrato esta
protegido por `tests/fiscal-rounding-align.test.js`, que incluye la reproduccion real de
`CHC VE 3P` y fronteras exactas de IVA, IGIC e IPSI.

Para **productos monetarios primarios** donde todavía se conocen los operandos decimales
(`kWh × €/kWh`, `kW × días × €/kW·día`, SSAA o crédito de excedentes), la ruta canónica es
`LF_CONFIG.roundMoneyProducts()`. Cada factor se conserva como entero + escala decimal antes de
multiplicar y el resultado se redondea una sola vez al céntimo mediante `HALF_AWAY_FROM_ZERO`.
Ejemplos de contrato: `85 × 0,095 = 8,075 -> 8,08 EUR` y `-85 × 0,095 = -8,075 -> -8,08 EUR`.
Cuando el importe incluye además un prorrateo por divisor entero, la variante canónica es
`LF_CONFIG.roundMoneyProductsDividedBy(products, divisor)`: mantiene numerador y divisor como
enteros hasta el mismo redondeo final. El caso frontera regulado
`5 × 3,113 × 365 / 365 = 15,565 -> 15,57 EUR` forma parte del contrato PVPC.
No uses este helper para kWh, porcentajes de presentación, datos extraídos de PDF o métricas no
monetarias, ni para intentar reparar un `Number` que ya sea el producto binario de otros factores.
La cobertura específica vive en `tests/monetary-product-rounding.test.js`.

### Potencia PVPC 2026: conservar magnitudes anuales

Los componentes oficiales de potencia 2.0TD de 2026 se publican en €/kW·año. El motor conserva
`anualP1 = 27,704413`, `anualP2 = 0,725423` y `anualMargen = 3,113`, y para 2026 prorratea por
`días/365` con numerador/divisor decimal exacto, sin redondear primero el cociente diario ni
materializar el producto intermedio como `Number`. Los campos `p1`, `p2` y
`margen` diarios siguen existiendo por compatibilidad y se derivan de esas magnitudes anuales.
`diasAnio = 365` pertenece a la configuración 2026: no debe generalizarse a años bisiestos ni a
periodos históricos que crucen ejercicios con términos regulados distintos sin segmentarlos.

### ✅ Validación: Caso CNMC (221 kWh con Bono Social)

```
Potencia fija: 8,94 € (peajes + margen)
Energía: 47,46 €
Financiación: 0,57 €
─────────────────
Subtotal antes descuento: 56,97 €

Descuento BS (42,5% sobre base limitada): -12,81 € (RDL 7/2026, vigente durante 2026)
─────────────────
Base para IEE: 44,16 € ✅

IEE con regimen general desde 01/06/2026: max(44,16 × 5,11269632%, 221 × 0,001) = max(2,26€, 0,22€) = 2,26 € ✅
Alquiler: 0,83 €

Base para IVA: 44,16 + 2,26 + 0,83 = 47,25 €
IVA vigente: calculado por `lf-config.js`

TOTAL: base + IVA vigente ✅
(Calculado con el descuento excepcional del bono social del RDL 7/2026 vigente durante 2026; pendiente de verificar contra CNMC cuando actualice su simulador)
```

---

## Motores de Cálculo

### 🏭 Motor Principal (`lf-calc.js`)

**Propósito**: Comparador de tarifas de mercado libre

**Características**:
- ✅ Calcula potencia, energía, impuestos
- ✅ Compensa excedentes (autoconsumo)
- ✅ Aplica Bono Social
- ✅ Soporta Batería Virtual
- ❌ **NO aplica promociones** (campo `promo`): ver más abajo

**Filtrado final: qué tarifas llegan al ranking**

`calculateLocal()` calcula **todas** las tarifas y las ordena por total; el filtrado va después
del `sort` y antes de construir `processed`, en este orden:

1. `requiereFV`: si el usuario no tiene solar, fuera las que exigen autoconsumo.
2. Límites de consumo: `LF.assessConsumoAnualLimits(candidatas, { consumoKwh, annualScope,
   coveredDays, useAnnualEstimate })` con `consumoKwh = cPunta + cLlano + cValle`,
   `annualScope = dias >= 365` y `coveredDays = dias`.

El orden importa. Al filtrar antes de `processed`, se recalculan sobre el conjunto compatible la
`posicion`, el `esMejor`, el `vsMejor` y las `stats` (mínimo/máximo/medio), y `resumen.mejor` sale
de `resultadosFiltrados`. Así ninguna tarifa excluida puede aparecer como "mejor opción" ni
distorsionar el precio medio. El objeto `limitesConsumo` viaja a `renderAll` para pintar el aviso.

En periodos cortos se conserva el modo prudente por defecto: el máximo se contrasta contra los kWh
ya registrados. Además se calcula una estimación orientativa `consumoKwh * 365 / coveredDays`;
solo se ofrece si algún máximo cambiaría candidatas y solo filtra después de que el usuario la
active. `minConsumoAnualExclusivo` no filtra nunca. Las exclusiones demostradas por superar un
máximo real no se pueden desactivar. El razonamiento está en `JSON-SCHEMA.md` y `AUDITORIA-REGISTRO.md`.

**Promociones: fuera del cálculo, siempre**

El campo `promo` de `tarifas.json` no entra en ninguna operación de `lf-calc.js`. Las ofertas
temporales (descuentos de bienvenida, euros sobre las primeras facturas, meses gratis) solo se
informan: etiqueta en la fila del ranking y nota en el desglose y en el simulador solar.

El motivo es que el comparador simula **una factura de N días**, no un año. Una promoción que
dura 3 o 5 facturas no tiene un valor único que quepa en ese número: aplicarla obligaría a
saber qué factura concreta se está simulando. Y ordenar por un precio con descuento temporal
hunde la comparación, que es justo lo que el ranking existe para evitar.

Corolario para el dataset: un descuento que dure **menos de 12 meses** no puede estar dentro
del precio del dataset, porque dejaría de ser cierto antes de acabar el año. En ese caso se
guarda el precio base y la oferta se cuenta en `promo`. Un descuento de 12 meses sí puede ir
en el precio, porque es el que se paga durante todo el horizonte de comparación, y entonces se
documenta en `requisitos`. Regla completa y casos resueltos en `JSON-SCHEMA.md`.

**Excedentes en tarifas indexadas (valor `-1`)**:

En `tarifas.json`, si `fv.exc = -1`, la tarifa es indexada y el precio de excedentes varia hora a hora. En la home, si el usuario solo aporta kWh agregados, no existe curva de vertido y `lf-calc.js` aplica **0,020 €/kWh** como referencia orientativa:

```javascript
// lf-calc.js: getFvExcPrice() — INDEXED_SURPLUS_REFERENCE_PRICE = 0.02
if (raw === -1) return INDEXED_SURPLUS_REFERENCE_PRICE; // Referencia orientativa sin curva horaria
```

No se usa un perfil solar sintetico porque seguiria inventando el vertido del usuario. Con CSV horario trazable, el simulador solar puede valorar tarifas indexadas mes a mes mediante `js/lf-surplus-prices.js`, multiplicando cada hora vertida por el precio horario disponible en `data/surplus/`. Ese calculo es exacto solo respecto al indice base disponible; si una comercializadora aplica ajustes o formula propia, debe presentarse como calculo segun indice base. Si faltan precios horarios, el mes solo conserva el calculo horario cuando la cobertura perdida es residual por horas y por kWh de excedente sin valorar; si no, cae a la referencia orientativa. Si el valor mensual horario sale negativo, el simulador conserva la trazabilidad horaria pero limita el credito potencial a 0 EUR, no vuelve a la referencia de 0,020 EUR/kWh.

Esta referencia y el modo horario estan documentados tambien en `JSON-SCHEMA.md` y `CAPACIDADES-WEB.md`.

**Validación normativa**:
- Estructura factura: ✅ BOE-A-1992-28147
- Compensación: ✅ RD 244/2019 (no supera energía)
- Bono Social: ✅ RD 897/2017
- Periodos horarios: ✅ CNMC Circular 3/2020

---

### 🔌 Motor PVPC (`pvpc.js` + `lf-utils.js`)

**Propósito**: Tarifa regulada con precios horarios

**Características**:
- ✅ Carga datasets horarios locales versionados, generados desde ESIOS/REE (indicador 1001)
- ✅ Clasifica horas en P1/P2/P3 según CNMC
- ✅ Con CSV y precios del periodo, cruza cada consumo con su precio horario
- ✅ Una curva importada conservada mantiene activo el cruce exacto mientras
  `window.LF.consumosHorarios` tenga registros y `window.LF.pvpcPeriodoCSV === true`.
  Cambiar entre Peninsula y Ceuta/Melilla reclasifica sus agregados P1/P2/P3, pero no
  elimina la curva porque comparten reloj; `pvpc.js` cruza por fecha/hora y no depende
  del `record.periodo` que traia la importacion.
- ✅ En modo CSV, si falta como máximo el 10% de horas y el 10% de kWh, conserva el cruce disponible y estima solo los huecos con la media P1/P2/P3 canónica
- ✅ En modo CSV, si falta un mes completo, se supera algún umbral o no hay media válida, usa medias completas con aviso
- ✅ En modo estándar (sin CSV), el periodo termina en días cerrados: cualquier mes ausente o día civil incompleto invalida PVPC. Se exigen 23/24/25 horas consecutivas según DST, incluida la primera y la última hora; nunca se calcula ni se cachea una factura parcial silenciosa
- ✅ Ese validador de día civil (`validatePvpcDayCoverage`/`validateClosedPvpcDay`) vive en `js/lf-csv-utils.js` y es la ÚNICA implementación: la home, el Observatorio (`pvpc-stats-engine.js`, `pvpc-stats-csv.js`) y excedentes (`lf-surplus-prices.js`) la comparten (12/08/2026), en vez de tener cada uno su propia comprobación débil de "cada fila es un par numérico"
- ✅ Aplica Bono Social con descuento correcto
- ✅ Calcula IEE DESPUÉS de descuento BS (¡CRÍTICO!)
- ✅ Detecta fines de semana y festivos nacionales

**Punto crítico en `lf-utils.js` (función `calcPvpcBonoSocial`)**:
```javascript
// ⚠️ CRÍTICO: IEE se calcula DESPUÉS de restar descuento BS
// Orden correcto: Fijo + Variable + Financiación - Descuento = Base IEE
const baseEnergia = round2(terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur);
// ...
const impuestoElectrico = (C.calcularIEE && Number.isFinite(consumoKwh))
  ? round2(C.calcularIEE(baseEnergia, consumoKwh, fiscalContext?.fechaYmd || i.fechaYmd))
  : 0;
```

**Validación** (histórica, CNMC 28/01/2026, IEE al 5,11%):
- Caso CNMC (0 kWh): IEE = 0,51€, Total = 13,65€ ✅
- Caso CNMC (221 kWh + BS): Base IEE = 44,16€, IEE = 2,26€ ✅

Con la rebaja temporal del RDL 7/2026 activa (22/03/2026-31/05/2026): IEE caso 0 kWh ≈ 0,05€; caso 221 kWh ≈ 0,22€.

---

### ☀️ Motor BV Solar (`bv-sim-monthly.js`)

**Propósito**: Simulador de autoconsumo con Batería Virtual

**Características**:
- ✅ Agrupa consumos por mes
- ✅ Compensa excedentes (P1/P2/P3)
- ✅ Acumula sobrantes en hucha (solo si tarifa tiene BV)
- ✅ Calcula `totalPagar` (con saldo anterior) y `totalReal` (sin él)

**Orden mensual y mes de inicio**:
- El motor arrastra la BV siguiendo el orden del array `months` recibido.
- La UI del simulador puede rotar ese array para modelar un contrato iniciado en un mes concreto.
- Esa rotación trata los datos como patrón anual: no altera los kWh/excedentes ni inventa meses.
  Los meses que pasan detrás de diciembre conservan su clave `YYYY-MM` original; solo cambia el
  orden de simulacion que determina el arrastre del saldo BV. Asi SSAA y fiscalidad siguen usando
  el dato regulado realmente publicado para cada casilla mensual, sin proyectar un año inexistente.

### Invariante de `fv.bv`: "BV aplicable", no "el usuario marcó la casilla" (20/08/2026)

`fv.bv === true` significa que la bateria virtual es **economicamente aplicable**, no que el
checkbox estuviera marcado. Sin compensacion no hay excedente remunerado que alimente la hucha,
asi que marcar BV no puede activarla. Los tres productores del `fv` de "Mi tarifa" imponen la
condicion en el punto donde se construye el objeto:

| Productor | Fichero |
|---|---|
| Home / ranking | `js/lf-tarifa-custom.js` |
| Simulador solar | `js/bv/bv-ui.js` |
| Desglose | `js/desglose-integration.js` |

```javascript
// Los tres, con su propia variable de checkbox y de compensacion:
bv: tieneBV && compensa,
reglaBV: (tieneBV && compensa) ? 'BV MES ANTERIOR' : 'NO APLICA',
// compensa = excFinal > 0 || excFinal === -1   (el centinela -1 es compensacion indexada)
```

**Por que en el productor y no en cada consumidor.** Antes, `bv: tieneBV` a secas podia emitir
`bv:true` junto a `tipo:'NO COMPENSA'`. Ese objeto contradictorio se leia distinto en cada motor:
`lf-calc.js` y `desglose-calculo.js` exigen ademas `tipo === 'SIMPLE + BV'` y desactivaban la BV,
mientras `bv-sim-monthly.js` la activaba solo por `fv.bv` y cobraba la cuota mensual. La misma
configuracion del usuario daba importes distintos en la home y en el simulador. Normalizar en los
tres productores elimina el estado imposible en origen y no cambia el comportamiento de la UI.

**Compatibilidad del estado persistido.** El `bv` guardado en `lf_custom_tarifa`,
`bv_custom_tarifa` o en `config.customTarifa` pertenece al estado del formulario, no al `fv`
economico. Los registros anteriores al checkbox BV no tenian ese campo: en aquel esquema una
compensacion fija positiva implicaba BV. La compatibilidad se resuelve en la frontera de lectura
(`js/lf-tarifa-custom.js` y `js/bv/bv-ui.js`): solo se infiere BV desde `exc > 0` cuando `bv` esta
realmente ausente/null. Un `bv:false` explicito prevalece siempre, incluso si `exc` es positivo.
Despues de restaurar el formulario, los tres productores aplican normalmente el invariante
economico `checkbox && compensa`.

**Consecuencia para este documento.** Con el invariante vigente, `hasBV = Boolean(tarifa?.fv?.bv)`
en el motor mensual y "la cuota solo aplica con `fv.bv = true` y `fv.tipo = 'SIMPLE + BV'`" (ver
seccion `precioBV`) dejan de ser dos criterios distintos: son equivalentes, porque los productores
derivan tanto `fv.bv = true` como `fv.tipo = 'SIMPLE + BV'` de la misma condicion
`checkbox && compensa`. Un `fv` construido a mano fuera de estos tres productores —por ejemplo en
un fixture de test— debe respetar la misma coherencia.

Nota: una BV **gratuita** (`precioBV = 0`) sigue siendo una BV activa. La cuota no es requisito de
activacion; solo `checkbox && compensa` lo es.

**Punto crítico en `bv-sim-monthly.js`** (`hasBV` se define antes de aplicar la BV):
```javascript
// ⚠️ CRÍTICO: Aplicar BV SOLO si tarifa lo tiene
// Correcto porque fv.bv ya llega normalizado como "BV aplicable" (ver invariante arriba).
const hasBV = Boolean(tarifa?.fv?.bv);

// Si NO tiene BV: los excedentes se pierden
const totalBaseConCosteBV = totalBase; // totalBase ya incluye costeBV y su IVA/IGIC/IPSI si aplica
const totalReal = round2(Math.max(0, totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0)));
//                                                                  ↑
//                                                  Si hasBV=false → resta 0 (correcto)
//                                                  Si hasBV=true → resta sobrantes (correcto)
```

**Equivalencia con motor principal**:
```javascript
// Motor principal (lf-calc.js)
const totalNum = solarOn && fv && fv.bv ? (totalBaseConCosteBV - excedenteSobranteEur) : totalBaseConCosteBV;

// Motor BV (bv-sim-monthly.js)
const totalReal = totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0);

// En contexto BV, ambas son equivalentes:
// hasBV = Boolean(tarifa?.fv?.bv) ≡ (fv && fv.bv)
// solarOn siempre es true en simulador BV
```

---

## Bono Social

### 📜 Normativa (RD 897/2017)

**Tipos de Bono Social vigentes a 23/07/2026 (RDL 7/2026, con carácter excepcional para 2026)**:
- Vulnerable: **42,5%** descuento
- Severo: **57,5%** descuento

**Nota**: Tras la caída del RDL 2/2026 el 26/02/2026 volvió temporalmente el régimen base del RD 897/2017, pero el RDL 7/2026 restauró para todo 2026 el 42,5%/57,5% y ordenó regularizar las facturas afectadas.

**Límite anual bonificable**:
- Vulnerable: 1.587 kWh/año
- Otros: Varían según tipo

**Financiación anual (Orden TED/634/2026)**:
- 9,011295 €/año (se prorratea a días del periodo)
- Sustituye para este valor a la Orden TED/1524/2025 y se aplica desde la liquidación 7 de 2026.

### ✅ Implementación en `lf-utils.js` (función `calcPvpcBonoSocial`)

```javascript
// 1. Calcular % de kWh bonificable (limitePeriodo = limiteAnual / 365 * dias)
const kwhBonificable = Math.max(0, Math.min(consumoKwh, limitePeriodo));
const ratioBonificable = consumoKwh > 0 ? (kwhBonificable / consumoKwh) : 0;

// 2. Calcular base del descuento
const baseVariableBonif = terminoVariable * ratioBonificable;
const baseDescuento = terminoFijoTotal + financiacionBono + baseVariableBonif;

// 3. Aplicar descuento (porcentaje via C.getBonoSocialDiscountRate: 0.425 o 0.575, RDL 7/2026 vigente durante 2026)
const descuentoEur = (bonoSocialOn && baseDescuento > 0) ? round2(baseDescuento * porcentaje) : 0;

// 4. ⭐ BASE PARA IMPUESTOS (CON DESCUENTO YA RESTADO)
const baseEnergia = round2(terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur);

// 5. IEE sobre base con descuento (tasa dinámica centralizada; 5,11% desde 01/06/2026)
const impuestoElectrico = (C.calcularIEE && Number.isFinite(consumoKwh))
  ? round2(C.calcularIEE(baseEnergia, consumoKwh, fiscalContext?.fechaYmd || i.fechaYmd))
  : 0;
```

---

## Batería Virtual

### 🏦 Concepto

La Batería Virtual (BV) es un servicio comercial que permite:
1. Compensar excedentes de autoconsumo
2. Acumular sobrantes en una "hucha" virtual
3. Usar el saldo acumulado en meses posteriores

### 📊 Métricas importantes

```
totalPagar = Lo que PAGAS este mes
           = totalBaseConCosteBV - (saldo BV anterior usado)
           → Para factura real

totalReal = Coste auxiliar del mes sin saldo anterior
          = totalBaseConCosteBV - (excedentes sobrantes)
          → Métrica auxiliar para auditoría y comparación sin saldo previo
```

El ranking visible del simulador solar no usa `totalReal`: ordena por `totals.pagado` y desempata por `totals.bvFinal`.

La UI también muestra una métrica secundaria para tarifas con BV cuando queda saldo final relevante:

```javascript
costeNetoPeriodo = totals.pagado - totals.bvFinal
```

No altera el orden del ranking. Indica cuánto quedaría si el usuario aprovecha el saldo final en facturas futuras; por eso es valor condicionado a seguir con la comercializadora y a sus reglas de uso/caducidad. Si sale negativo se muestra como saldo a favor, no como coste negativo garantizado.

### ⚠️ Comportamiento según tipo tarifa

**Tarifa SIN Batería Virtual**:
```javascript
hasBV = false

bvPrev = 0              // No tiene saldo previo
credit2 = 0             // No usa nada
bvSaldoFin = 0          // No acumula
totalPagar = totalBase  // Pagas todo
totalReal = totalBase   // Métrica auxiliar = factura (excedentes se pierden)
```

**Tarifa CON Batería Virtual**:
```javascript
hasBV = true

bvPrev = 5.00                                          // Tienes saldo anterior
credit2 = min(5.00, totalBaseConCosteBV)             // Usas lo que necesites
bvSaldoFin = excedenteSobranteEur + resto             // Acumulas sobrantes
totalPagar = totalBaseConCosteBV - credit2            // Pagas menos (con saldo)
totalReal = totalBaseConCosteBV - excedenteSobranteEur // Métrica auxiliar sin saldo anterior
```

### 💳 Cuota fija mensual de BV (`precioBV`)

Algunas tarifas con BV cobran una cuota mensual por el servicio. Se define en `tarifas.json` como `fv.precioBV` (€/mes netos, antes de IVA/IGIC/IPSI). Solo aplica cuando `fv.bv = true` y `fv.tipo = "SIMPLE + BV"`.

```javascript
// lf-calc.js (home, período arbitrario en días)
fvCosteBV = precioBV * dias * 12 / 365

// bv-sim-monthly.js (simulador, mes calendario exacto)
costeBV = precioBV * min(dias, daysInMonth) / daysInMonth
```

La cuota se suma como servicio antes de calcular el impuesto indirecto de la zona. No forma parte de la base del IEE, pero sí de IVA/IGIC/IPSI. El saldo BV anterior se aplica después sobre la factura bruta, por lo que puede cubrir también la cuota y su impuesto:

```javascript
totalBaseConCosteBV = totalBase // potencia + energía neta + IEE + alquiler + costeBV + IVA/IGIC/IPSI
credit2 = min(bvPrev, totalBaseConCosteBV)
totalPagar = totalBaseConCosteBV - credit2
```

Las tarifas con cuota BV no nula se consultan directamente en `tarifas.json`, que es la fuente viva del dataset. Esta documentación define la semántica de `fv.precioBV`, no el inventario actualizado de tarifas.

### ☀️ Compensación parcial y BV

Algunas tarifas FV no permiten compensar peajes/cargos de energía en la factura del mes. En `tarifas.json` se modelan con:

```json
{
  "fv": {
    "tope": "ENERGIA_PARCIAL",
    "bv": true
  }
}
```

La compensación directa se calcula así:

```javascript
baseCompensable = energiaBruta - peajesYCargosEnergia;
credit1 = min(creditoPotencial, baseCompensable);
excedenteSobranteEur = creditoPotencial - credit1;
```

Si `fv.bv = true`, **todo** `excedenteSobranteEur` se acumula en BV, incluida la parte que no se pudo aplicar por el límite de peajes/cargos. Si `fv.bv = false`, no se acumula.

Ejemplo: energía bruta `33,09€`, peajes/cargos `7,23€`, base compensable `25,86€`, excedentes `29,14€`. La factura compensa `25,86€` y los `3,28€` restantes pasan a BV si la tarifa tiene batería virtual.

### ✅ Validación

En `bv-sim-monthly.js`, al aplicar el saldo BV:
```javascript
// Si NO tiene BV: excedentes se pierden
const totalBaseConCosteBV = totalBase; // totalBase ya incluye costeBV y su IVA/IGIC/IPSI si aplica
const totalReal = round2(Math.max(0, totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0)));
//                                                                ↑
//                                                false → resta 0
//                                                true  → resta sobrantes
```

---

## Validaciones CNMC

### 🔍 Casos de Prueba Y Referencias Oficiales

Los importes históricos identificados como CNMC se contrastaron con el **Simulador Oficial CNMC v2.1.2** (28/01/2026). Las adaptaciones regulatorias posteriores de 2026 —como los descuentos del 42,5%/57,5% y el valor actualizado de financiación— se validan contra BOE y tests del repo; no se presentan como resultados del simulador CNMC mientras esa versión no las incorpore.

> ⚠️ **Nota fiscal**: Los valores de IEE en los casos siguientes corresponden a la validación de enero 2026 (IEE al 5,11%). Desde el 01/06/2026 el motor vuelve al tipo general, por lo que estos importes vuelven a ser la referencia fiscal vigente para IEE. La lógica del **orden de operaciones** (descuento BS antes de IEE) sigue siendo válida.

#### Caso 1: PVPC sin consumo
```
Inputs:
- Potencia: 3,5 kW P1, 3,5 kW P2
- Consumo: 0 kWh
- Días: 31
- Bono Social: NO

Histórico CNMC 28/01/2026 (IEE al 5,11%):
- Término fijo: 9,36 €
- IEE: 0,51 € (a 5,11%; durante la rebaja temporal del RDL 7/2026 ≈ 0,05 €)
- Total: 13,65 €

Referencia: CNMC Simulador, 29/12/2025 - 29/01/2026
Nota: Válido para verificar que IEE > 0 aunque consumo = 0.
```

#### Caso 2: PVPC con Bono Social
```
Inputs:
- Potencia: 3,5 kW
- Consumo: 221 kWh (64 P1, 54 P2, 103 P3)
- Días: 31
- Bono Social: Vulnerable (42,5%, RDL 7/2026, vigente durante 2026)

Descuento BS:
- Base: 8,94 + 0,57 + (47,46 × 43,48%) = 30,15 €
- Descuento: 30,15 × 42,5% = 12,81 €

Con fiscalidad configurada desde 01/06/2026 (IEE al 5,11269632%):
- Base IEE: 8,94 + 47,46 + 0,57 - 12,81 = 44,16 € ✅
- IEE: max(44,16 × 5,11269632%, 221 × 0,001) = max(2,26€, 0,22€) = 2,26 € ✅

Referencia: RDL 7/2026 + RD 897/2017
```

---

## Falsos Positivos Conocidos

### ⚠️ ERRORES DETECTADOS EN AUDITORÍAS DE IA

Este documento lista explícitamente los falsos positivos encontrados en auditorías previas para **evitar que se repitan**.

### ❌ Falso Positivo #1: "IEE se calcula sobre base incorrecta en PVPC"

**Lo que dijo la auditoría**:
> El IEE se calcula sin restar el descuento del Bono Social. Esto causa un sobrecargo de ~0.30-0.70€ por factura.

**La realidad**:
```javascript
// ✅ CORRECTO: IEE se calcula DESPUÉS de descuento BS
const baseEnergia = terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur;
const impuestoElectrico = C.calcularIEE(baseEnergia, consumoKwh);
```

**Validación**:
- Caso CNMC 221 kWh: Base IEE = 44,16€, IEE = 2,26€ ✅
- El orden de operaciones coincide con el caso histórico de CNMC; el porcentaje de descuento vigente se valida contra el RDL 7/2026.

**Por qué la auditoría falló**:
- Encontró el cálculo de IEE de `obtenerPVPC_LOCAL` en `js/pvpc.js` (hacia la línea 805), que no resta ningún descuento
- No verificó que esa ruta solo produce la factura PVPC **sin** bono social: ahí el descuento es 0 y la base es correcta
- Cuando el usuario activa el bono social, `lf-calc.js` recalcula la factura PVPC con `LF.calcPvpcBonoSocial` en `lf-utils.js`, que sí resta el descuento antes del IEE

**Lección**: Siempre verificar que el código encontrado se ejecuta realmente en el escenario reportado, no asumir por apariencia.

---

### ❌ Falso Positivo #2: "Motor BV descuenta excedentes en tarifas sin BV"

**Lo que dijo la auditoría**:
> Si una tarifa NO tiene BV, el código sigue descontando los excedentes sobrantes, haciendo que aparezca artificialmente más barata.

**La realidad**:
```javascript
// ✅ CORRECTO: Solo descuenta si hasBV es true
const totalBaseConCosteBV = totalBase; // totalBase ya incluye costeBV y su IVA/IGIC/IPSI si aplica
const totalReal = totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0);
//                                              ↑
//                               false → resta 0 (no descuenta)
//                               true  → resta sobrantes (sí descuenta)
```

**Equivalencia demostrada**:
```javascript
// Motor principal (lf-calc.js)
const totalNum = solarOn && fv && fv.bv ? (totalBaseConCosteBV - excedenteSobranteEur) : totalBaseConCosteBV;

// Motor BV (bv-sim-monthly.js)
const totalReal = totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0);

// Ambas son equivalentes como métrica neta en contexto BV
// hasBV = Boolean(tarifa?.fv?.bv) ≡ (fv && fv.bv)
// costeBV = 0 cuando fv.precioBV = 0 (tarifa sin cuota mensual)
```

**Por qué la auditoría falló**:
- Comparó sintaxis sin considerar el contexto
- No vio que `hasBV` lleva implícito `fv && fv.bv`
- No probó con ejemplos numéricos

**Lección**: Comparar lógica, no sintaxis. Probar con ejemplos numéricos.

---

### ❌ Falso Positivo #3: "IEE a 0 cuando consumo = 0 kWh"

**Lo que dijo la auditoría**:
> Si consumo de red = 0 kWh, el IEE debería ser 0. La ley dice "en periodos sin consumo real no se exige impuesto".

**La realidad**:
La ley se refiere a CUPS inactivos sin facturación de ningún concepto. En una factura normal:
- Hay potencia contratada → hay base imponible
- El IEE se aplica sobre esa base aunque consumo sea 0

```javascript
// ✅ CORRECTO: IEE se calcula aunque consumo sea 0
// Tasa dinámica centralizada. Nunca hardcodear la tasa.
const impuestoElec = C.calcularIEE(sumaBase, consumoTotal, fechaYmd);
// Implementación: Math.max(sumaBase × tasa, consumoTotal × 0,001 €/kWh)

// Si consumo = 0 y base ≈ 10€: IEE = max(10 × 0,0511269632, 0) ≈ 0,51€ (tipo general)
//                               IEE ≠ 0, porque hay base imponible por potencia contratada
```

**Validación histórica**: CNMC Simulador oficial (28/01/2026, IEE 5,11%): 0 kWh → IEE = 0,51€ ✅
Con el tipo general desde 01/06/2026: mismo razonamiento, IEE ≈ 0,51€ — sigue siendo > 0 ✅

**Por qué la auditoría falló**:
- Interpretó la normativa de forma literal sin contexto
- No validó contra CNMC oficial
- Confundió "sin consumo real" (CUPS inactivos) con "0 kWh en una factura"

**Lección**: Siempre validar contra CNMC oficial cuando hay duda.

---

## 📞 Guía para Auditorías Futuras

Si eres una IA revisando este código:

### ✅ CHECKS OBLIGATORIOS

1. **Valida contra CNMC Simulador Oficial** (v2.1.2 o posterior)
   - Usa como referencia `tests/pvpc.test.js`, `tests/fiscal.test.js` y `tests/bv-fiscal-align.test.js`
   - Compara números exactos

2. **Lee los comentarios `⚠️ CRÍTICO`** en el código
   - Están ahí por una razón
   - Marcan puntos que confunden a IAs

3. **Verifica que el código se ejecuta realmente**
   - No asumas que código incorrecto "parece" que se ejecuta
   - Rastrea el flujo completo

4. **Prueba con ejemplos numéricos**
   - No solo analices sintaxis
   - Calcula resultados esperados

5. **Consulta las suites de referencia**
   - `tests/pvpc.test.js`, `tests/fiscal.test.js`, `tests/bv-fiscal-align.test.js`
   - Si tu análisis contradice esos tests, probablemente estés equivocado

### ❌ ERRORES COMUNES

- ❌ Comparar sintaxis sin entender lógica
- ❌ Asumir que "parece mal" significa "está mal"
- ❌ Ignorar comentarios explicativos en código
- ❌ No validar contra fuente oficial (CNMC)
- ❌ Confundir casos edge teóricos con casos reales

---

## 📚 Referencias Legales

- **BOE-A-1992-28147**: Ley 38/1992 de Impuesto especial sobre la electricidad
- **BOE-A-2019-5089**: RD 244/2019 (Autoconsumo y compensación)
- **BOE-A-2020-1066**: CNMC Circular 3/2020 (Periodos horarios 2.0TD)
- **BOE-A-2017-12382**: RD 897/2017 (Bono Social)
- **BOE-A-2025-26705**: Orden TED/1524/2025 (valor inicial de financiación del Bono Social 2026)
- **BOE-A-2026-13759**: Orden TED/634/2026 (valor actualizado de financiación del Bono Social 2026)
- **CNMC Simulador**: https://www.cnmc.es/consumidores/simulador (v2.1.2, 28/01/2026)

---

**Última revisión**: 10/08/2026
**Próxima revisión**: Cuando cambien normativas (CNMC/BOE)
**Mantenedor**: Equipo de LuzFija.es
