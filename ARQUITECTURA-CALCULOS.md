# 🧮 Arquitectura de Cálculos - LuzFija.es

**Última actualización**: Mayo 2026
**Estado**: ✅ Validado contra normativa CNMC/BOE
**Referencia CNMC**: v2.1.2 (28/01/2026) — fiscalidad configurada a 30/05/2026 para vigencia desde 01/06/2026 (IVA 21% e IEE 5,11269632%)
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
│ TÉRMINO POTENCIA (€/kW·día)                 │
│ - P1 (Punta): 3,5 kW × 0,075901 €/kW·día   │
│ - P2 (Valle): 3,5 kW × 0,001987 €/kW·día   │
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

// PASO 8: BASE PARA IMPUESTO INDIRECTO
const baseImpuestoIndirecto = sumaBase + iee + alquiler;

// PASO 9: IMPUESTO INDIRECTO (IVA/IGIC/IPSI)
let impuestoIndirecto;
if (zona === 'Canarias') {
  impuestoIndirecto = baseImpuestoIndirecto * 0.03; // IGIC 3% (o 0% vivienda ≤10kW)
} else if (zona === 'CeutaMelilla') {
  impuestoIndirecto = baseImpuestoIndirecto * 0.01; // IPSI 1% energía
} else {
  impuestoIndirecto = baseImpuestoIndirecto * tipoIvaVigente; // IVA vigente centralizado en lf-config.js
}

// PASO 10: TOTAL
const total = sumaBase + iee + alquiler + impuestoIndirecto;
```

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

**Excedentes en tarifas indexadas (valor `-1`)**:

En `tarifas.json`, si `fv.exc = -1`, la tarifa es indexada y el precio de excedentes varia hora a hora. En la home, si el usuario solo aporta kWh agregados, no existe curva de vertido y `lf-calc.js` aplica **0,020 €/kWh** como referencia orientativa:

```javascript
// lf-calc.js: getFvExcPrice()
if (raw === -1) return 0.02; // Referencia orientativa sin curva horaria
```

No se usa un perfil solar sintetico porque seguiria inventando el vertido del usuario. Con CSV horario trazable, el simulador solar puede valorar tarifas indexadas mes a mes mediante `js/lf-surplus-prices.js`, multiplicando cada hora vertida por el precio horario disponible en `data/surplus/`. Ese calculo es exacto solo respecto al indice base disponible; si una comercializadora aplica ajustes o formula propia, debe presentarse como calculo segun indice base. Si el valor mensual horario sale negativo, el simulador conserva la trazabilidad horaria pero limita el credito potencial a 0 EUR, no vuelve a la referencia de 0,020 EUR/kWh.

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
- ✅ Carga precios horarios de ESIOS/REE (indicador 1001)
- ✅ Clasifica horas en P1/P2/P3 según CNMC
- ✅ Aplica Bono Social con descuento correcto
- ✅ Calcula IEE DESPUÉS de descuento BS (¡CRÍTICO!)
- ✅ Detecta fines de semana y festivos nacionales

**Punto crítico en `lf-utils.js:308`**:
```javascript
// ⚠️ CRÍTICO: IEE se calcula DESPUÉS de restar descuento BS
// Orden correcto: Fijo + Variable + Financiación - Descuento = Base IEE
const baseEnergia = round2(terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur);
const impuestoElectrico = round2(C.calcularIEE(baseEnergia, consumoKwh, fechaYmd));
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
- Esa rotación trata los datos como patrón anual: no altera los kWh/excedentes de cada mes ni genera fechas futuras reales.

**Punto crítico en `bv-sim-monthly.js:304-313`**:
```javascript
// ⚠️ CRÍTICO: Aplicar BV SOLO si tarifa lo tiene
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

**Tipos de Bono Social vigentes a 12/04/2026 (RDL 7/2026, con carácter excepcional para 2026)**:
- Vulnerable: **42,5%** descuento
- Severo: **57,5%** descuento

**Nota**: Tras la caída del RDL 2/2026 el 26/02/2026 volvió temporalmente el régimen base del RD 897/2017, pero el RDL 7/2026 restauró para todo 2026 el 42,5%/57,5% y ordenó regularizar las facturas afectadas.

**Límite anual bonificable**:
- Vulnerable: 1.587 kWh/año
- Otros: Varían según tipo

**Financiación anual (Orden TED/1524/2025)**:
- 9,011295 €/año (se prorratea a días del periodo)

### ✅ Implementación en `lf-utils.js:295-312`

```javascript
// 1. Calcular % de kWh bonificable
const kwhBonificable = Math.min(consumoKwh, limiteAnual / 365 * dias);
const ratioBonificable = consumoKwh > 0 ? (kwhBonificable / consumoKwh) : 0;

// 2. Calcular base del descuento
const baseVariableBonif = terminoVariable * ratioBonificable;
const baseDescuento = terminoFijoTotal + financiacionBono + baseVariableBonif;

// 3. Aplicar descuento
const descuentoEur = baseDescuento * porcentaje; // 0.425 o 0.575 (42,5% o 57,5%, RDL 7/2026 vigente durante 2026)

// 4. ⭐ BASE PARA IMPUESTOS (CON DESCUENTO YA RESTADO)
const baseEnergia = terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur;

// 5. IEE sobre base con descuento (tasa dinámica centralizada; 5,11% desde 01/06/2026)
const impuestoElectrico = C.calcularIEE(baseEnergia, consumoKwh, fechaYmd);
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

En `bv-sim-monthly.js:313`:
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

### 🔍 Casos de Prueba Oficiales

Todos estos casos están validados contra el **Simulador Oficial CNMC v2.1.2** (28/01/2026).

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
- **Coincide exactamente con CNMC Simulador oficial**

**Por qué la auditoría falló**:
- Encontró código en `pvpc.js:614-615` que parecía incorrecto
- No verificó que ese código no se usa en el flujo de producción
- El código real que se ejecuta está en `lf-utils.js:308` y es correcto

**Lección**: Siempre verificar que el código encontrado se ejecuta realmente, no asumir por apariencia.

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
- **BOE-A-2025-26705**: Orden TED/1524/2025 (Financiación Bono Social 2026)
- **CNMC Simulador**: https://www.cnmc.es/consumidores/simulador (v2.1.2, 28/01/2026)

---

**Última revisión**: 30/05/2026
**Próxima revisión**: Cuando cambien normativas (CNMC/BOE)
**Mantenedor**: Equipo de LuzFija.es
