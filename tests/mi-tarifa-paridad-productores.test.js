import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment node
 */

// Ronda 23 (05/09/2026). "Mi tarifa" la construyen TRES productores independientes que leen el
// DOM por su cuenta (agregarMiTarifa en lf-tarifa-custom.js, la reconstruccion de
// desglose-integration.js y getCustomTarifa en bv/bv-ui.js). La paridad se sostenia solo en
// comentarios en prosa. Estos tests fijan las dos divergencias que SI llegaban a pantalla:
//  - P1 escrito a 0: la home lo rechazaba (contrato del dataset) y el simulador lo aceptaba.
//  - Punta/Llano/Valle a 0: el simulador lo rechazaba con aviso y la home coronaba "Mi tarifa"
//    en el puesto 1 (medido en produccion: 20,22 EUR por delante de 101 tarifas reales).
// La direccion del arreglo NO es la misma en los dos: en el primero manda la home, en el
// segundo manda el simulador.

function readJs(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', 'js', ...parts), 'utf8');
}

describe('Mi tarifa: P1 = 0 se rechaza en los dos rankings', () => {
  it('la home mantiene el minimo positivo de P1', () => {
    const code = readJs('lf-tarifa-custom.js');
    expect(code).toContain("El precio de potencia P1 debe ser mayor que 0");
    // La condicion solo aplica a un P1 con contenido, no a uno vacio.
    expect(code).toMatch(/p1Val && p1 === 0/);
  });

  it('el simulador solar aplica el mismo minimo antes de construir la tarifa', () => {
    const code = readJs('bv', 'bv-ui.js');
    const idx = code.indexOf('const customTarifa = miTarifaError ? null : getCustomTarifa();');
    expect(idx).toBeGreaterThan(-1);
    // El guard tiene que estar ANTES de construir el objeto, no despues.
    const antes = code.slice(Math.max(0, idx - 900), idx);
    expect(antes).toContain('El precio de potencia P1 debe ser mayor que 0');
    expect(antes).toMatch(/mtP1Raw && parseInput\(mtP1Raw\) === 0/);
  });

  it('un P1 vacio sigue siendo valido en el simulador (hereda el fallback de P2)', () => {
    const code = readJs('bv', 'bv-ui.js');
    const idx = code.indexOf('mtP1Raw && parseInput(mtP1Raw) === 0');
    expect(idx).toBeGreaterThan(-1);
    // La guarda exige contenido: sin `mtP1Raw &&` rechazaria tambien el campo vacio, que es
    // un caso legitimo resuelto por powerFallback en getCustomTarifa().
    expect(code.slice(idx - 60, idx + 60)).toContain('mtP1Raw &&');
    expect(code).toContain('powerFallback');
  });
});

describe('Mi tarifa: energia a cero en los tres periodos', () => {
  it('el simulador solar exige al menos un precio de energia positivo', () => {
    const code = readJs('bv', 'bv-ui.js');
    expect(code).toMatch(/hasEnergy = filledEnergy\.some\(x => x\.value > 0\)/);
    expect(code).toContain('if (!hasEnergy || !hasPower) return null;');
  });

  it('la home ya no acepta los tres periodos a 0', () => {
    const code = readJs('lf-tarifa-custom.js');
    expect(code).toContain('Indica al menos un precio de energía mayor que 0');
    expect(code).toMatch(/punta === 0 && llano === 0 && valle === 0/);
  });

  it('la home solo bloquea cuando los TRES son cero, no cuando uno lo es', () => {
    const code = readJs('lf-tarifa-custom.js');
    const idx = code.indexOf('Indica al menos un precio de energía mayor que 0');
    expect(idx).toBeGreaterThan(-1);
    const bloque = code.slice(Math.max(0, idx - 500), idx);
    // Un valle a 0 con punta positiva es legitimo y debe seguir pasando: la condicion es una
    // conjuncion de los tres, no una disyuncion.
    expect(bloque).toMatch(/punta === 0 && llano === 0 && valle === 0/);
    expect(bloque).not.toMatch(/punta === 0 \|\| llano === 0/);
  });
});

describe('Mi tarifa: la invariante fv.bv sigue igual en los tres productores', () => {
  // Cierre de la ronda 20: fv.bv significa "BV aplicable", no "el checkbox estaba marcado".
  // Si un productor emitiera bv:true con tipo 'NO COMPENSA', bv-sim-monthly.js la activaria
  // por fv.bv mientras home y desglose la desactivarian por tipo, dando importes distintos.
  it('los tres exigen ademas que la tarifa compense', () => {
    expect(readJs('lf-tarifa-custom.js')).toMatch(/bv: tieneBV && compensa/);
    expect(readJs('bv', 'bv-ui.js')).toMatch(/bv: hasBV && compensa/);
    const desglose = readJs('desglose-integration.js');
    expect(desglose).toMatch(/bv: mt\w* && mt\w*/);
  });
});
