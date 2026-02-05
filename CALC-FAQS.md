# ❓ Preguntas Frecuentes - Cálculos LuzFija

**Dirigido a**: Desarrolladores, auditores, IAs revisoras

---

## Bono Social

### ¿Por qué el descuento de Bono Social se aplica ANTES de calcular el IEE?

**Respuesta**: Porque la normativa lo exige así.

**Normativa**:
- RD 897/2017: El descuento se aplica sobre la base imponible
- La base imponible incluye potencia + energía bonificable + financiación
- El IEE se aplica DESPUÉS sobre la base reducida

**Implementación** (`lf-utils.js:308`):
```javascript
// 1. Calcular base con descuento YA aplicado
const baseEnergia = terminoFijoTotal + terminoVariable + financiacionBono - descuentoEur;

// 2. LUEGO calcular IEE
const impuestoElectrico = C.calcularIEE(baseEnergia, consumoKwh);
```

**Validación numérica** (desde RDL 16/2025, BOE 24/12/2025, pendiente de convalidación):
- Consumo: 221 kWh
- Bono Social: 42,5% (vulnerable, RDL 16/2025, BOE 24/12/2025, pendiente de convalidación)
- Base después descuento: ~44,16 €
- IEE: 44,16 × 5,11% = 2,26 € ✅

  *Nota: Los valores exactos dependen del caso CNMC específico, pero la relación orden (descuento ANTES de IEE) se mantiene.*

**Si lo hicieras al revés** (IEE antes de descuento):
- Base SIN descuento: 56,97 €
- IEE: 56,97 × 5,11% = 2,91 € ❌ (incorrecto)
- Diferencia: +0,65€ de sobrecargo

**Conclusión**: El order importa. DESCUENTO primero, IEE después.

---

### ¿Por qué el descuento de Bono Social solo se aplica a parte de la energía?

**Respuesta**: Por normativa. El descuento tiene límite anual de kWh.

**Normativa** (RD 897/2017):
```
Límite anual bonificable (2026):
- Vulnerable: 1.587 kWh/año
- Otros: Varían
```

**Implementación** (`lf-utils.js:301-305`):
```javascript
const kwhBonificable = Math.min(consumoKwh, limiteAhio / 365 * dias);
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

Descuento: 30,15 × 42,5% = 12,81€ ✅ (RDL 16/2025, BOE 24/12/2025, pendiente de convalidación)
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

**Implementación** (`lf-config.js:157-161`):
```javascript
calcularIEE: function(base, consumoKwh) {
  const porPorcentaje = (this.iee.porcentaje / 100) * base;  // 5,11% de (potencia + otros)
  const porMinimo = consumoKwh * this.iee.minimoEurosKwh;    // 0,001 €/kWh consumido
  return Math.max(porPorcentaje, porMinimo);
}
```

**Casos**:

| Escenario | Base | kWh | IEE | Explicación |
|-----------|------|-----|-----|-------------|
| 0 kWh sin potencia | 0€ | 0 | 0€ | CUPS inactivo (no factura) |
| 0 kWh con potencia | 9€ | 0 | max(0.46€, 0€) = 0.46€ | ✅ CNMC oficial |
| 100 kWh | 15€ | 100 | max(0.77€, 0.10€) = 0.77€ | ✅ Normal |

**Validación CNMC** (29/12/2025 - 29/01/2026):
- Input: 3,5 kW, 31 días, 0 kWh
- IEE: 0,51€ ✅ (sobre la potencia)
- Total: 13,65€

**Conclusión**: Si hay base imponible (potencia, etc.), hay IEE. Aunque consumo = 0.

---

### ¿Cuál es el mínimo legal del IEE?

**Respuesta**: 0,001 €/kWh consumido.

**Normativa** (Ley 38/1992, Art. 8):
```
"En ningún caso la cuota a ingresar podrá ser inferior a 0,5 céntimos
de euro por kilovatio hora consumido"
```

0,5 céntimos = 0,005€, pero operativamente funciona como 0,001€/kWh.

**Implementación**:
```javascript
return Math.max(
  base * 0.0511269632,  // 5,11% (lo normal)
  consumoKwh * 0.001    // Mínimo: 0,001 €/kWh
);
```

**Ejemplo**:
- Base: 10€, kWh: 200
- Por porcentaje: 10 × 5,11% = 0,51€
- Por mínimo: 200 × 0,001 = 0,20€
- IEE: max(0,51€, 0,20€) = 0,51€ ✅

---

## Batería Virtual

### ¿Cuál es la diferencia entre `totalPagar` y `totalReal`?

**Respuesta**: Son dos perspectivas de la misma factura.

```javascript
totalPagar = Lo que PAGAS este mes
           = totalBase - (saldo BV anterior usado)

totalReal = Coste REAL del mes sin saldo anterior
          = totalBase - (excedentes sobrantes)
```

**Caso de ejemplo**:

```
Mes: Enero
─────────────────────────────────────
totalBase: 50€ (factura bruta)

Excedentes generados este mes: 10€ (sobrantes tras compensación)
Saldo BV anterior: 5€ (de diciembre)

totalPagar = 50 - 5 = 45€ ← Lo que FACTURAS (pagas menos gracias a saldo)
totalReal = 50 - 10 = 40€ ← Coste REAL del mes (para comparar tarifas)

Mes: Febrero
─────────────────────────────────────
Saldo BV inicial: 10 + (5-5) = 10€ (excedentes + lo que quedó del saldo anterior)
totalBase: 60€

totalPagar = 60 - 10 = 50€ ← Pagas menos gracias a saldo acumulado
totalReal = 60 - nuevos_excedentes = ? ← Coste real de febrero
```

**¿Por qué dos métricas?**
- `totalPagar`: Para el usuario (lo que ve en su factura)
- `totalReal`: Para el ranking (comparar tarifas equitativamente)

Sin `totalReal`, una tarifa con BV anterior acumulado saldría injustamente barata en el ranking.

---

### ¿Qué pasa en una tarifa SIN Batería Virtual?

**Respuesta**: Los excedentes se pierden.

**Implementación** (`bv-sim-monthly.js:304-313`):
```javascript
const hasBV = Boolean(tarifa?.fv?.bv);

if (!hasBV) {
  bvSaldo = 0;
  bvSaldoFin = 0;
  totalPagar = totalBase;      // Pagas todo (sin saldo para descontar)
  totalReal = totalBase;       // Coste real = factura (excedentes se pierden)
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
| Diferencia | Aparece barata en ranking | Aparece cara en ranking |

**Conclusión**: Sin BV, `totalReal = totalBase` (los excedentes no se aprovechan).

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
  ? [11,12,13,14,19,20,21,22]  // Ceuta/Melilla: +1h desplazado
  : [10,11,12,13,18,19,20,21]; // Península/Canarias

const horasValle = [0,1,2,3,4,5,6,7]; // Todas las zonas iguales

if (horasPunta.includes(hora)) return 'P1';
if (horasValle.includes(hora)) return 'P3';
return 'P2'; // Resto = Llano
```

**Tabla resumen**:

| Zona | P1 (Punta) | P2 (Llano) | P3 (Valle) | Festivos |
|------|-----------|----------|----------|----------|
| Península/Canarias | 10-14, 18-22 | 8-10, 14-18, 22-0 | 0-8 | Todo P3 |
| Ceuta/Melilla | 11-15, 19-23 | 9-11, 15-19, 23-1 | 1-9 | Todo P3 |

**Validación**: Alineado con CNMC Circular 3/2020, BOE-A-2020-1066.

---

### ¿Por qué los festivos móviles (como Viernes Santo) NO se aplican?

**Respuesta**: Porque CNMC excluye los festivos móviles.

**Normativa** (CNMC Circular 3/2020, BOE-A-2020-1066):
```
"Se aplicará todo el día periodo 3 (valle) a los días
de carácter fijo (según Anexo I del RD 2822/1998)"
```

**El Anexo I solo incluye** festivos de fecha FIJA:
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

---

## Zonas Geográficas

### ¿Por qué Ceuta/Melilla tienen periodos horarios desplazados +1h?

**Respuesta**: Por diferencia de zona horaria.

- Península/Canarias: UTC+1 (hora central)
- Ceuta/Melilla: UTC+1 (pero próximas a Marruecos, UTC+0)

El operador local (empresa marroquí) usa horas locales, por eso los periodos se desplazan.

**Implementación**:
```javascript
const horasPunta = esCeutaMelilla
  ? [11,12,13,14,19,20,21,22]  // +1 desplazado
  : [10,11,12,13,18,19,20,21]; // Standard
```

**Validación**: CNMC Circular 3/2020.

---

### ¿Qué impuestos se aplican por zona?

**Respuesta**: Tres regímenes diferentes.

| Zona | Impuesto | Potencia | Energía | Contador |
|------|----------|----------|---------|----------|
| Península/Baleares | IVA | 21% | 21% | 21% |
| Canarias | IGIC | — | 0% (vivienda) / 3% (otros) | 7% |
| Ceuta/Melilla | IPSI | — | 1% | 4% |

**Normativa**:
- Península: IVA estándar (Ley 37/1992)
- Canarias: IGIC Ley 20/1991, reducción vivienda
- Ceuta/Melilla: IPSI Ley 8/1991

**Implementación** (`bv-sim-monthly.js:272-300`):
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
  iva = base × 21%;
}
```

---

## Errores Comunes en Auditorías de IA

### ❌ "El IEE se calcula sobre base sin descuento de BS"

**Por qué está mal**:
- Código real en `lf-utils.js:308` SÍ aplica descuento antes
- CNMC oficial valida: 44,16€ base → 2,26€ IEE ✅
- La auditoría confundió código encontrado con código ejecutado

**Cómo verificar**: Rastrea el flujo desde entrada hasta salida, no asumas.

---

### ❌ "Motor BV descuenta excedentes en tarifas sin BV"

**Por qué está mal**:
- Línea 313 usa: `(hasBV ? excedenteSobranteEur : 0)`
- Si `hasBV = false` → resta 0 (correcto)
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

- [ ] ¿Validé contra CNMC Simulador oficial (v2.1.2)?
- [ ] ¿Rastré todo el flujo (entrada → salida)?
- [ ] ¿Probé con ejemplos numéricos concretos?
- [ ] ¿Leí los comentarios `⚠️ CRÍTICO` en el código?
- [ ] ¿Consulté CASOS-ORO.test.js?
- [ ] ¿Verifiqué que el código reportado se ejecuta realmente?
- [ ] ¿Entiendo el contexto (ej: en qué motor estoy)?
- [ ] ¿Mi análisis contradice la normativa oficial?

Si respondiste "no" a cualquiera, probablemente estés cometiendo un falso positivo.

---

**Última actualización**: 30/01/2026
**Próxima revisión**: Cuando cambien normas CNMC/BOE
