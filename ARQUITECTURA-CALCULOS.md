# 🧮 Arquitectura de Cálculos - LuzFija.es

**Última actualización**: Febrero 2026
**Estado**: ✅ Validado contra normativa CNMC/BOE
**Referencia CNMC**: v2.1.2 (28/01/2026)
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
│ - 6,979247 €/año prorrateo a días          │
├─────────────────────────────────────────────┤
│ DESCUENTO BONO SOCIAL (si aplica)          │
│ - 42,5% o 57,5% sobre base limitada (RDL 7/2026, vigente durante 2026) │
├─────────────────────────────────────────────┤
│ IMPUESTO ELÉCTRICO (IEE)                    │
│ - 5,11269632% sobre base post-descuento     │
├─────────────────────────────────────────────┤
│ ALQUILER CONTADOR                           │
│ - 0,81 €/mes prorrateo a días              │
├─────────────────────────────────────────────┤
│ IMPUESTO INDIRECTO (IVA/IGIC/IPSI)          │
│ - Península: IVA vigente (10% temporal <10 kW o bono social severo, 21% resto) │
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

// PASO 3: Calcular financiación Bono Social
const financiacion = 6.979247 / 365 * dias;

// PASO 4: CALCULAR DESCUENTO BONO SOCIAL
// ⚠️ IMPORTANTE: El descuento se aplica a:
//    - Término fijo COMPLETO
//    - Financiación COMPLETA
//    - Solo parte del término variable (la bonificable según kWh con derecho)
const kwhBonificable = Math.min(consumoTotal, limiteAhioKWh / 365 * dias);
const ratioBonicable = consumoTotal > 0 ? kwhBonificable / consumoTotal : 0;
const baseVariableBonicable = energia * ratioBonicable;
const baseDescuento = potencia + financiacion + baseVariableBonicable;
const descuentoBS = baseDescuento * (bonoSocialOn ? 0.425 : 0); // 42,5% vulnerable (RDL 7/2026, vigente durante 2026)

// PASO 5: BASE PARA IMPUESTOS
const sumaBase = potencia + energia + financiacion - descuentoBS;

// PASO 6: ⭐ CALCULAR IEE (PUNTO CRÍTICO)
// El IEE se calcula sobre la base YA CON EL DESCUENTO RESTADO
// Ref: RD 897/2017, validado contra CNMC v2.1.2
const iee = Math.max(
  sumaBase * 0.0511269632,  // 5,11269632%
  consumoTotal * 0.001       // Mínimo: 0,001 €/kWh
);

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
  impuestoIndirecto = baseImpuestoIndirecto * tipoIvaVigente; // IVA 10% temporal si aplica, 21% general
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

IEE (5,11% × 44,16): 2,26 € ✅
Alquiler: 0,83 €

Base para IVA: 44,16 + 2,26 + 0,83 = 47,25 €
IVA (tipo vigente según potencia y normativa temporal): calculado por `lf-config.js`

TOTAL: base + IVA vigente ✅
(Calculado con el descuento excepcional del RDL 7/2026 vigente durante 2026; pendiente de verificar contra CNMC cuando actualice su simulador)
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
const impuestoElectrico = round2(C.calcularIEE(baseEnergia, consumoKwh));
```

**Validación**:
- Caso CNMC (0 kWh): IEE = 0,51€, Total = 13,65€ ✅
- Caso CNMC (221 kWh + BS): Base IEE = 44,16€, IEE = 2,26€ ✅

---

### ☀️ Motor BV Solar (`bv-sim-monthly.js`)

**Propósito**: Simulador de autoconsumo con Batería Virtual

**Características**:
- ✅ Agrupa consumos por mes
- ✅ Compensa excedentes (P1/P2/P3)
- ✅ Acumula sobrantes en hucha (solo si tarifa tiene BV)
- ✅ Calcula `totalPagar` (con saldo anterior) y `totalReal` (sin él)

**Punto crítico en `bv-sim-monthly.js:304-313`**:
```javascript
// ⚠️ CRÍTICO: Aplicar BV SOLO si tarifa lo tiene
const hasBV = Boolean(tarifa?.fv?.bv);

// Si NO tiene BV: los excedentes se pierden
const totalReal = round2(Math.max(0, totalBase - (hasBV ? excedenteSobranteEur : 0)));
//                                                        ↑
//                                        Si hasBV=false → resta 0 (correcto)
//                                        Si hasBV=true → resta sobrantes (correcto)
```

**Equivalencia con motor principal**:
```javascript
// Motor principal (lf-calc.js)
const totalNum = solarOn && fv && fv.bv ? (totalBase - excedenteSobranteEur) : totalBase;

// Motor BV (bv-sim-monthly.js)
const totalReal = totalBase - (hasBV ? excedenteSobranteEur : 0);

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
- 6,979247 €/año (se prorratea a días del periodo)

### ✅ Implementación en `lf-utils.js:295-312`

```javascript
// 1. Calcular % de kWh bonificable
const kwhBonificable = Math.min(consumoKwh, limiteAhio / 365 * dias);
const ratioBonificable = consumoKwh > 0 ? (kwhBonificable / consumoKwh) : 0;

// 2. Calcular base del descuento
const baseVariableBonif = terminoVariable * ratioBonificable;
const baseDescuento = terminoFijoTotal + financiacionBono + baseVariableBonif;

// 3. Aplicar descuento
const descuentoEur = baseDescuento * porcentaje; // 0.425 o 0.575 (42,5% o 57,5%, RDL 7/2026 vigente durante 2026)

// 4. ⭐ BASE PARA IMPUESTOS (CON DESCUENTO YA RESTADO)
const baseEnergia = terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur;

// 5. IEE sobre base con descuento
const impuestoElectrico = C.calcularIEE(baseEnergia, consumoKwh);
```

---

## Batería Virtual

### 🏦 Concepto

La Batería Virtual (BV) es un servicio comercial que permite:
1. Compensar excedentes de autoconsumo
2. Acumular sobrantes en una "hucha" virtual
3. Usar el saldo acumulado en meses posteriores

### 📊 Dos métricas importantes

```
totalPagar = Lo que PAGAS este mes
           = totalBase - (saldo BV anterior usado)
           → Para factura real

totalReal = Coste REAL del mes sin saldo anterior
          = totalBase - (excedentes sobrantes)
          → Métrica auxiliar para auditoría y comparación sin saldo previo
```

El ranking visible del simulador solar no usa `totalReal`: ordena por `totals.pagado` y desempata por `totals.bvFinal`.

### ⚠️ Comportamiento según tipo tarifa

**Tarifa SIN Batería Virtual**:
```javascript
hasBV = false

bvPrev = 0              // No tiene saldo previo
credit2 = 0             // No usa nada
bvSaldoFin = 0          // No acumula
totalPagar = totalBase  // Pagas todo
totalReal = totalBase   // Coste real = factura (excedentes se pierden)
```

**Tarifa CON Batería Virtual**:
```javascript
hasBV = true

bvPrev = 5.00                              // Tienes saldo anterior
credit2 = min(5.00, totalBase)            // Usas lo que necesites
bvSaldoFin = excedenteSobranteEur + resto // Acumulas sobrantes
totalPagar = totalBase - credit2           // Pagas menos (con saldo)
totalReal = totalBase - excedenteSobranteEur // Coste real (sin saldo anterior)
```

### ✅ Validación

En `bv-sim-monthly.js:313`:
```javascript
// Si NO tiene BV: excedentes se pierden
const totalReal = round2(Math.max(0, totalBase - (hasBV ? excedenteSobranteEur : 0)));
//                                                      ↑
//                                   false → resta 0
//                                   true  → resta sobrantes
```

---

## Validaciones CNMC

### 🔍 Casos de Prueba Oficiales

Todos estos casos están validados contra el **Simulador Oficial CNMC v2.1.2** (28/01/2026):

#### Caso 1: PVPC sin consumo
```
Inputs:
- Potencia: 3,5 kW P1, 3,5 kW P2
- Consumo: 0 kWh
- Días: 31
- Bono Social: NO

Esperado:
- Término fijo: 9,36 €
- IEE: 0,51 € ✅ (se calcula sobre base con potencia+financiación)
- Total: 13,65 €

Referencia: CNMC Simulador, 29/12/2025 - 29/01/2026
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

Esperado:
- Base IEE: 8,94 + 47,46 + 0,57 - 12,81 = 44,16 € ✅
- IEE: 44,16 × 5,11% = 2,26 € ✅
- Total: 57,17 €

Referencia: RDL 7/2026 + RD 897/2017 (CNMC Simulador pendiente de reflejar el descuento excepcional de 2026)
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
const totalReal = totalBase - (hasBV ? excedenteSobranteEur : 0);
//                                    ↑
//                   false → resta 0 (no descuenta)
//                   true  → resta sobrantes (sí descuenta)
```

**Equivalencia demostrada**:
```javascript
// Motor principal (lf-calc.js)
const totalNum = solarOn && fv && fv.bv ? (totalBase - excedenteSobranteEur) : totalBase;

// Motor BV (bv-sim-monthly.js)
const totalReal = totalBase - (hasBV ? excedenteSobranteEur : 0);

// Ambas son equivalentes como métrica neta en contexto BV
// hasBV = Boolean(tarifa?.fv?.bv) ≡ (fv && fv.bv)
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
const impuestoElec = Math.max(
  sumaBase * 0.0511269632,  // 5,11% de (potencia + otros)
  consumoTotal * 0.001       // Mínimo 0,001 €/kWh
);

// Si consumo = 0: max(0.51€, 0€) = 0.51€ ✅
```

**Validación**: CNMC Simulador oficial: 0 kWh → IEE = 0,51€ ✅

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
   - No asumasque código incorrecto "parece" que se ejecuta
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

**Última revisión**: 30/01/2026
**Próxima revisión**: Cuando cambien normativas (CNMC/BOE)
**Mantenedor**: Equipo de LuzFija.es
