# Test de Verificación: Hora 25 (Cambio Horario Octubre)

## 🎯 Objetivo

Verificar que el cálculo de periodos horarios maneja correctamente la **hora 25** del cambio horario de octubre, clasificándola como **P3 (valle)** equivalente a las 02:00-03:00.

## 🐛 Bug Original

**Antes del fix:**
- La implementación duplicada en `bv-sim-monthly.js` calculaba: `horaInicio = hora - 1`
- Para hora 25: `horaInicio = 24` → fuera de rango → clasificación incorrecta
- Podía clasificarse como **P2** en lugar de **P3**

**Después del fix:**
- Implementación canónica en `lf-csv-utils.js`: `horaInicio = (hora === 25) ? 2 : (hora - 1)`
- Para hora 25: `horaInicio = 2` → 02:00-03:00 → **P3 (valle)** ✅
- BV y Home usan la misma implementación (consistencia garantizada)

## 🧪 Cómo Ejecutar el Test

### Método 1: En el navegador (recomendado)

1. Abre la página del comparador solar: `http://localhost/comparador-tarifas-solares.html`
2. Abre la consola del navegador (F12)
3. Copia y pega el contenido de `hora25-test.js`
4. Presiona Enter

### Método 2: Como módulo ES6

```javascript
// En la consola del navegador:
await import('./tests/hora25-test.js')
```

### Método 3: Incluir en el HTML temporalmente

```html
<!-- Al final del body, después de los otros scripts -->
<script src="/tests/hora25-test.js"></script>
```

## 📊 Resultado Esperado

```
🧪 Iniciando test de HORA 25 (cambio horario octubre)...

Test 1: Hora normal (hora 3)
  Fecha: 28/10/2024
  Resultado: P3
  Esperado: P3
  ✅ PASADO

Test 2: HORA 25 (cambio horario octubre)
  Fecha: 27/10/2024
  Hora: 25 (cambio horario)
  Resultado: P3
  Esperado: P3
  ✅ PASADO

Test 3: Hora punta (hora 20)
  Fecha: 28/10/2024
  Resultado: P1
  Esperado: P1
  ✅ PASADO

Test 4: Fin de semana (sábado hora 20)
  Fecha: 26/10/2024
  Resultado: P3
  Esperado: P3
  ✅ PASADO

═══════════════════════════════════════
📊 Resumen: 4/4 tests pasados
✅ TODOS LOS TESTS PASARON
   El manejo de hora 25 funciona correctamente
═══════════════════════════════════════
```

## 🔍 Qué Verifica el Test

1. **Hora normal (3)**: Verifica que las horas normales funcionan (02:00-03:00 → P3)
2. **Hora 25**: Verifica específicamente el caso del cambio horario (25 → P3)
3. **Hora punta (20)**: Verifica clasificación correcta de punta (19:00-20:00 → P1)
4. **Fin de semana**: Verifica que fin de semana siempre es P3

## 📝 Notas Importantes

- El test usa fechas de octubre 2024 (cambio horario 27/10/2024)
- La hora 25 solo aparece en CSVs de distribuidoras el día del cambio horario
- Si el test falla, **NO uses** el simulador BV hasta corregir el bug
- Este test se puede ejecutar en cualquier momento sin afectar datos

## 🔗 Referencias

- Bug detectado por ChatGPT en revisión de código
- Fix aplicado en commit: [añadir hash cuando hagas commit]
- Archivos modificados:
  - `js/bv/bv-sim-monthly.js` (eliminó código duplicado)
  - `js/lf-csv-utils.js` (asignación automática de periodo)
  - `comparador-tarifas-solares.html` (comentario de orden crítico)

## ✅ Verificación en Producción

Para verificar en producción (opcional):

1. Importa un CSV real de octubre con hora 25
2. Compara consumo por periodos entre Home y BV
3. Deben coincidir exactamente

Si no tienes CSV con hora 25, este test es suficiente para verificar la corrección.
