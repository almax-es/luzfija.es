# ❓ Preguntas Frecuentes - Cálculos LuzFija

**Dirigido a**: Desarrolladores, auditores, IAs revisoras
**Nota de alcance**: Este FAQ cubre dudas de cálculo. Para capacidades funcionales completas del sitio (home, observatorio, simulador BV, guías, legal), ver `CAPACIDADES-WEB.md`.

---

## Bono Social

### ¿Por qué el descuento de Bono Social se aplica ANTES de calcular el IEE?

**Respuesta**: Porque la normativa lo exige así.

**Normativa**:
- RD 897/2017: El descuento se aplica sobre la base imponible
- La base imponible incluye potencia + energía bonificable + financiación
- El IEE se aplica DESPUÉS sobre la base reducida

**Implementación** (`lf-utils.js`, función `calcPvpcBonoSocial`):
```javascript
// 1. Calcular base con descuento YA aplicado
const baseEnergia = round2(terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur);

// 2. LUEGO calcular IEE
const impuestoElectrico = (C.calcularIEE && Number.isFinite(consumoKwh))
  ? round2(C.calcularIEE(baseEnergia, consumoKwh, fiscalContext?.fechaYmd || i.fechaYmd))
  : 0;
```

**Validación numérica** (régimen general desde 01/06/2026, IEE al 5,11269632%):
- Consumo: 221 kWh
- Bono Social: 42,5% (vulnerable, RDL 7/2026)
- Base después descuento: ~44,16 €
- IEE: max(44,16 × 5,11269632%, 221 × 0,001) = max(2,26€, 0,22€) = 2,26 € ✅

  *La relación de orden (descuento ANTES de IEE) se mantiene independientemente de la tasa.*

**Si lo hicieras al revés** (IEE antes de descuento, tasa general):
- Base SIN descuento: 56,97 €
- IEE (incorrecto): 56,97 × 5,11269632% = 2,91 € ❌
- IEE (correcto):   44,16 × 5,11269632% = 2,26 €
- Sobrecargo: +0,65€

**Conclusión**: El orden importa. DESCUENTO primero, IEE después.

---

### ¿Por qué el descuento de Bono Social solo se aplica a parte de la energía?

**Respuesta**: Por normativa. El descuento tiene límite anual de kWh.

**Normativa** (RD 897/2017):
```
Límite anual bonificable (2026):
- Vulnerable: 1.587 kWh/año
- Otros: Varían
```

**Implementación** (`lf-utils.js`, función `calcPvpcBonoSocial`):
```javascript
// limitePeriodo = limiteAnual / 365 * dias
const kwhBonificable = Math.max(0, Math.min(consumoKwh, limitePeriodo));
const ratioBonificable = consumoKwh > 0 ? (kwhBonificable / consumoKwh) : 0;

// El descuento se aplica a:
// - Término fijo: COMPLETO
// - Financiación: COMPLETA
// - Término variable: SOLO la parte bonificable (ratioBonificable × energia)
```

**Ejemplo** (CNMC oficial):
```
Consumo total: 221 kWh
Límite anual: 1.587 kWh
Límite periodo (30 días): 1.587 / 365 × 30 = 130,44 kWh

kWh bonificable: min(221, 130,44) = 130,44 kWh
Ratio: 130,44 / 221 = 43,48%

Base descuento:
- Fijo: 8,94€ (completo)
- Financ: 0,57€ (completo)
- Variable bonif: 47,46 × 43,48% = 20,64€ (solo esta parte)
= 30,15€

Descuento: 30,15 × 42,5% = 12,81€ ✅ (RDL 7/2026, vigente durante 2026)
```

---

## Impuesto Eléctrico (IEE)

### ¿El IEE se calcula aunque el consumo sea 0 kWh?

**Respuesta**: Sí. Pero solo si hay facturación de otros conceptos.

**Normativa** (Ley 38/1992, Art. 6):
```
"La base imponible del impuesto estará constituida por el importe total
de todas las contraprestaciones" (potencia, energía, etc.)
```

**Implementación** (`lf-config.js — desglosarIEE`, del que `calcularIEE` devuelve `importe`; simplificado, el código real normaliza los argumentos con `Number.isFinite`):
```javascript
desglosarIEE: function(base, consumoKwh, fechaYmd) {
  // getIEEInfo() devuelve la tasa correcta centralizada
  const info = this.getIEEInfo(fechaYmd);
  const porPorcentaje = (info.porcentaje / 100) * base;   // tasa dinámica
  const porMinimo = consumoKwh * info.minimoEurosKwh;     // 0,001 €/kWh consumido
  return { ...info, importe: Math.max(porPorcentaje, porMinimo) };
}
```

**Casos**:

| Escenario | Base | kWh | IEE | Explicación |
|-----------|------|-----|-----|-------------|
| 0 kWh sin potencia | 0€ | 0 | 0€ | CUPS inactivo (no factura) |
| 0 kWh con potencia | 9€ | 0 | max(0.46€, 0€) = 0.46€ | ✅ lógica correcta (a 5,11269632%) |
| 100 kWh | 15€ | 100 | max(0.77€, 0.10€) = 0.77€ | ✅ Normal (a 5,11269632%) |

**Validación CNMC** (29/12/2025 - 29/01/2026, IEE al 5,11% vigente en esa fecha):
- Input: 3,5 kW, 31 días, 0 kWh
- IEE: 0,51€ ✅ (sobre la potencia; durante la rebaja temporal del RDL 7/2026 ≈ 0,05€)
- Total histórico: 13,65€

**Conclusión**: Si hay base imponible (potencia, etc.), hay IEE. Aunque consumo = 0.

---

### ¿Cuál es el mínimo legal del IEE?

**Respuesta**: 0,001 €/kWh consumido.

**Normativa** (Ley 38/1992, Art. 99):
```
"En ningún caso las cuotas resultantes de la aplicación de los tipos
impositivos podrán ser inferiores a 1 euro por megavatio hora (0,001 €/kWh)
cuando la electricidad suministrada o consumida se destine a otros usos."
```

Para consumidores domésticos, esos "otros usos" equivalen a 1 euro por megavatio hora,
es decir, exactamente 0,001 €/kWh.

**Implementación** (simplificada; la tasa real es dinámica vía `getIEEInfo(fechaYmd)`):
```javascript
// Tasa actual desde 01/06/2026: 5,11269632%
return Math.max(
  base * (tasa / 100),  // tasa dinámica
  consumoKwh * 0.001    // Mínimo: 0,001 €/kWh
);
```

**Ejemplo** (con tasa general 5,11269632%):
- Base: 10€, kWh: 200
- Por porcentaje: 10 × 5,11269632% = 0,51€
- Por mínimo: 200 × 0,001 = 0,20€
- IEE: max(0,51€, 0,20€) = 0,51€ ✅

---

## Batería Virtual

### ¿Cuál es la diferencia entre `totalPagar` y `totalReal`?

**Respuesta**: Son dos perspectivas de la misma factura.

```javascript
totalPagar = Lo que PAGAS este mes
           = totalBaseConCosteBV - (saldo BV anterior usado)

totalReal = Coste auxiliar del mes sin saldo anterior
          = totalBaseConCosteBV - (excedentes sobrantes)
```

**Caso de ejemplo**:

```
Mes: Enero
─────────────────────────────────────
totalBaseConCosteBV: 50€ (factura bruta, incluida cuota BV si aplica)

Excedentes generados este mes: 10€ (sobrantes tras compensación)
Saldo BV anterior: 5€ (de diciembre)

totalPagar = 50 - 5 = 45€ ← Lo que FACTURAS (pagas menos gracias a saldo)
totalReal = 50 - 10 = 40€ ← Métrica auxiliar del mes sin saldo anterior

Mes: Febrero
─────────────────────────────────────
Saldo BV inicial: 10 + (5-5) = 10€ (excedentes + lo que quedó del saldo anterior)
totalBaseConCosteBV: 60€

totalPagar = 60 - 10 = 50€ ← Pagas menos gracias a saldo acumulado
totalReal = 60 - nuevos_excedentes = ? ← Métrica auxiliar de febrero
```

**¿Por qué dos métricas?**
- `totalPagar`: Para el usuario (lo que ve en su factura)
- `totalReal`: Métrica auxiliar para auditar el coste del mes sin saldo BV previo

El ranking visible del simulador solar usa `totals.pagado` y desempata por `totals.bvFinal`. `totalReal` no es el criterio principal de ordenación actual.

Además, la UI muestra una métrica secundaria de coste neto del periodo cuando una tarifa con BV acaba con saldo final relevante:

```javascript
costeNetoPeriodo = totals.pagado - totals.bvFinal
```

Ese coste neto no reordena el ranking. Sirve para corregir el artefacto del mes de corte cuando la hucha queda cargada, pero depende de seguir con la comercializadora y poder consumir ese saldo en facturas futuras. Si sale negativo se presenta como "saldo a favor", no como coste negativo garantizado.

---

### ¿El mes de inicio cambia los datos del CSV?

**Respuesta**: No. Cambia el orden de arrastre de la BV, no los kWh ni los excedentes de cada mes.

Si el usuario sube un año completo enero-diciembre y elige junio como mes de inicio, el simulador recorre:

```text
jun → jul → ago → sep → oct → nov → dic → ene → feb → mar → abr → may
```

Los datos de enero siguen siendo los datos de enero del CSV. En la simulación representan el siguiente enero del patrón anual, porque la BV depende del saldo acumulado en meses anteriores. Su clave `YYYY-MM` se incrementa al año siguiente para que las reglas fiscales se apliquen en orden cronológico; no se inventan nuevos kWh ni excedentes.

---

### ¿Qué pasa en una tarifa SIN Batería Virtual?

**Respuesta**: Los excedentes se pierden.

**Comportamiento** (implementado en `bv-sim-monthly.js`; pseudocódigo equivalente):
```javascript
const hasBV = Boolean(tarifa?.fv?.bv);

if (!hasBV) {
  bvSaldo = 0;
  bvSaldoFin = 0;
  totalPagar = totalBase;      // Pagas todo (sin saldo para descontar)
  totalReal = totalBase;       // Métrica auxiliar = factura (excedentes se pierden)
}

if (hasBV) {
  // Lógica de acumulación
}
```

**Caso de ejemplo**:

| Métrica | Con BV | Sin BV |
|---------|--------|---------|
| totalBase | 50€ | 50€ |
| Excedentes sobrantes | 10€ | 10€ |
| totalReal | 50 - 10 = 40€ | 50 - 0 = 50€ |
| Diferencia | Reduce `totalReal` auxiliar | No reduce `totalReal` auxiliar |

**Conclusión**: Sin BV, `totalReal = totalBase` (los excedentes no se aprovechan).

---

### ¿Qué ocurre si una tarifa solo compensa la energía pura y deja fuera peajes/cargos?

**Respuesta**: La compensación directa se limita a la energía pura, pero si la tarifa tiene BV el sobrante no aplicado pasa a la batería virtual.

En tarifas marcadas como `fv.tope = "ENERGIA_PARCIAL"`:

```javascript
baseCompensable = energiaBruta - peajesYCargosEnergia;
compensacion = min(excedentesValorados, baseCompensable);
excedenteSobrante = excedentesValorados - compensacion;
```

**Caso de ejemplo realista**:

```
Energía bruta: 33,09€
Peajes/cargos energía: 7,23€
Base compensable: 25,86€
Excedentes generados: 29,14€

Compensación directa: 25,86€
Sobrante: 29,14 - 25,86 = 3,28€
```

Si la tarifa tiene BV, esos `3,28€` pasan a saldo BV para próximas facturas. No se pierden por el hecho de proceder del límite de peajes/cargos. Si la tarifa no tiene BV, el sobrante no se acumula.

Esta regla se aplica en los dos motores:
- Comparador principal: `js/lf-calc.js`.
- Simulador solar mensual: `js/bv/bv-sim-monthly.js`.

---

## Periodos Horarios

### ¿Cómo se clasifican las horas en P1/P2/P3?

**Respuesta**: Según CNMC Circular 3/2020, con variación por zona y festivos.

**Implementación** (`lf-csv-utils.js:getPeriodoHorarioCSV`):

```javascript
// PASO 1: ¿Es festivo nacional (fecha fija) o fin de semana?
if (esFestivoNacional(fecha) || esFinDeSemana(fecha)) {
  return 'P3'; // TODO EL DÍA es P3 (valle)
}

// PASO 2: Clasificar por hora según zona
const horasPunta = esCeutaMelilla
  ? [11,12,13,14,19,20,21,22]  // Horario específico de la Circular 3/2020
  : [10,11,12,13,18,19,20,21]; // Península/Baleares/Canarias

const horasValle = [0,1,2,3,4,5,6,7]; // Todas las zonas iguales

if (horasPunta.includes(hora)) return 'P1';
if (horasValle.includes(hora)) return 'P3';
return 'P2'; // Resto = Llano
```

**Tabla resumen**:

| Zona | P1 (Punta) | P2 (Llano) | P3 (Valle) | Festivos |
|------|-----------|----------|----------|----------|
| Península/Baleares/Canarias | 10-14, 18-22 | 8-10, 14-18, 22-24 | 0-8 | Todo P3 |
| Ceuta/Melilla | 11-15, 19-23 | 8-11, 15-19, 23-24 | 0-8 | Todo P3 |

**Validación**: Alineado con CNMC Circular 3/2020, BOE-A-2020-1066.

---

### ¿Por qué los festivos móviles (como Viernes Santo) NO se aplican?

**Respuesta**: Porque CNMC excluye los festivos móviles.

**Normativa**: La Circular 3/2020 (BOE-A-2020-1066) considera P3 todo el sábado, domingo, 6 de enero y festivo nacional, pero excluye los festivos sustituibles y los que no tienen fecha fija.

**La implementación mantiene estas fechas fijas**:
- 1 enero
- 6 enero
- 1 mayo
- 15 agosto
- 12 octubre
- 1 noviembre
- 6 diciembre
- 8 diciembre
- 25 diciembre

**Excluye festivos móviles**:
- ❌ Viernes Santo (varía según año)
- ❌ Corpus Christi (varía según año)

**Implementación** (`lf-csv-utils.js:getFestivosNacionales`):
```javascript
const FESTIVOS_FIJOS = new Set([
  '01-01', '01-06', '05-01', '08-15',
  '10-12', '11-01', '12-06', '12-08', '12-25'
]);
// Viernes Santo NO está aquí
```

**Conclusión**: Hacer que CNMC diga explícitamente qué hace. No es omisión, es norma.

**Nota sobre festivos locales/autonómicos**: Tampoco cambian el periodo a P3. La Circular 3/2020 limita esta regla a los festivos de ámbito nacional y excluye tanto los festivos sustituibles como los que no tienen fecha fija. Por tanto, un festivo autonómico o local solo sería P3 todo el día si además coincidiera con uno de los festivos nacionales fijos listados arriba.

---

## Zonas Geográficas

### ¿Por qué Ceuta/Melilla tienen periodos horarios distintos?

**Respuesta**: Porque la Circular 3/2020 define expresamente para Ceuta y Melilla un horario 2.0TD distinto al de Península, Baleares y Canarias. No se debe atribuir a una diferencia de huso horario: Ceuta, Melilla y la Península usan `Europe/Madrid`.

**Implementación**:
```javascript
const horasPunta = esCeutaMelilla
  ? [11,12,13,14,19,20,21,22]  // Horario específico CNMC
  : [10,11,12,13,18,19,20,21];
```

**Validación**: artículo 7.3 de la CNMC Circular 3/2020.

---

### ¿Qué impuestos se aplican por zona?

**Respuesta**: Tres regímenes diferentes.

| Zona | Impuesto | Potencia | Energía | Contador |
|------|----------|----------|---------|----------|
| Península/Baleares | IVA | 21% desde 01/06/2026 | 21% desde 01/06/2026 | 21% desde 01/06/2026 |
| Canarias | IGIC | — | 0% (vivienda) / 3% (otros) | 7% |
| Ceuta/Melilla | IPSI | — | 1% | 4% |

**Normativa**:
- Península: IVA estándar (Ley 37/1992). La rebaja temporal eléctrica de 2026 queda desactivada desde 01/06/2026.
- Canarias: IGIC Ley 20/1991, reducción vivienda
- Ceuta/Melilla: IPSI Ley 8/1991

**Implementación** (`bv-sim-monthly.js`; simplificado, los tipos reales vienen de `LF_CONFIG` por territorio):
```javascript
const tipoImpuesto = String(terr?.impuestos?.tipo || '').toUpperCase();

if (tipoImpuesto === 'IGIC') {
  // Canarias
  igicEnergia = esViviendaTipoCero ? 0 : (base × 3%);
  igicContador = alquiler × 7%;
} else if (tipoImpuesto === 'IPSI') {
  // Ceuta/Melilla
  ipsiEnergia = base × 1%;
  ipsiContador = alquiler × 4%;
} else {
  // IVA (Península)
  iva = base × tipoIvaVigente; // 21% desde 01/06/2026
}
```

---

## Errores Comunes en Auditorías de IA

### ❌ "El IEE se calcula sobre base sin descuento de BS"

**Por qué está mal**:
- Código real en `lf-utils.js` (función `calcPvpcBonoSocial`) SÍ aplica descuento antes
- Validación: 44,16€ base → 2,26€ IEE (régimen general desde 01/06/2026) ✅
  ← Histórico CNMC 28/01/2026 (5,11%): 2,26€
- La auditoría confundió código encontrado con código ejecutado

**Cómo verificar**: Rastrea el flujo desde entrada hasta salida, no asumas.

---

### ❌ "Motor BV descuenta excedentes en tarifas sin BV"

**Por qué está mal**:
- El motor calcula `totalReal` como `totalBaseConCosteBV - (hasBV ? excedenteSobranteEur : 0)`
- Si `hasBV = false`, resta 0 y no acumula saldo BV
- La auditoría comparó sintaxis sin entender lógica

**Cómo verificar**: Prueba con ejemplos numéricos en ambos casos.

---

### ❌ "IEE debería ser 0 si consumo = 0"

**Por qué está mal**:
- CNMC oficial: 0 kWh → IEE = 0,51€
- Normativa se refiere a CUPS inactivos, no facturas normales
- La auditoría interpretó literalmente sin contexto

**Cómo verificar**: Valida siempre contra CNMC Simulador oficial.

---

## Checklist para Auditorías de IA

### ✅ Antes de reportar un bug:

- [ ] ¿Validé contra CNMC Simulador oficial cuando el caso está cubierto por su versión vigente?
- [ ] ¿Rastré todo el flujo (entrada → salida)?
- [ ] ¿Probé con ejemplos numéricos concretos?
- [ ] ¿Leí los comentarios `⚠️ CRÍTICO` en el código?
- [ ] ¿Consulté suites de referencia (`tests/pvpc.test.js`, `tests/fiscal.test.js`, `tests/bv-fiscal-align.test.js`)?
- [ ] ¿Verifiqué que el código reportado se ejecuta realmente?
- [ ] ¿Entiendo el contexto (ej: en qué motor estoy)?
- [ ] ¿Mi análisis contradice la normativa oficial?

Si respondiste "no" a cualquiera, probablemente estés cometiendo un falso positivo.

---

**Última actualización**: 23/07/2026
**Próxima revisión**: Cuando cambien normas CNMC/BOE
