import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * CLS del footer en escritorio (Core Web Vitals, 22/10/2026).
 *
 * Antes del primer calculo, el bloque `.grid` de la home mide lo que mide el formulario y el
 * footer queda pegado debajo (a ~920 px del inicio). En un monitor alto, o con algo de scroll,
 * ese footer ya esta a la vista. Al pulsar Calcular la tabla de resultados (99 filas) crece y lo
 * empuja fuera de pantalla: Chrome lo cuenta como salto de layout si ocurre mas de 500 ms
 * despues del clic (la red lo hace facil). Medido con un clic real: CLS 0,155 (en campo 0,16 en
 * las 18 URLs, umbral 0,1). Search Console lo marco el 16/10/2026 como "CLS > 0,1 (ordenador)".
 *
 * El arreglo es un `min-height: 100vh` en `.grid` mientras no hay resultados (solo escritorio),
 * para que el footer nazca por debajo del primer pantallazo. Con el mismo caso: 0,019 (0 si el
 * salto cae dentro de los 500 ms del clic).
 *
 * No da error en consola ni falla ningun otro test si alguien lo "limpia" como un hueco inutil:
 * el CLS solo se ve en datos de campo semanas despues. Estos tests existen para evitarlo.
 */

const css = fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'), 'utf8');

// Cuerpo de las reglas dentro del @media (min-width: 769px) que sigue a `.grid.has-results`.
const bloque = css.match(/@media\s*\(min-width:\s*769px\)\s*\{\s*\.grid:not\(\.has-results\)[\s\S]*?\n\s*\}\s*\n\s*\}/);

describe('CLS del footer en escritorio (hueco previo al primer calculo)', () => {
  it('.grid reserva una pantalla antes de calcular, solo en escritorio', () => {
    expect(bloque, 'falta el @media (min-width: 769px) con .grid:not(.has-results)').not.toBeNull();
    expect(bloque[0]).toMatch(/\.grid:not\(\.has-results\)\s*\{\s*min-height:\s*100vh;/);
  });

  it('no se reserva en movil: la tarjeta de datos ya llena el viewport', () => {
    // La regla debe vivir dentro del media de escritorio y no fuera de el.
    const fuera = css.replace(bloque ? bloque[0] : '', '');
    expect(fuera).not.toMatch(/\.grid:not\(\.has-results\)\s*\{[^}]*min-height/);
  });

  it('min-height no se anima al pasar a .has-results (el `transition: all` de .grid lo animaria)', () => {
    // Animarlo movera el footer a cada fotograma, cada uno contado como un salto.
    expect(bloque, 'falta el bloque de escritorio').not.toBeNull();
    expect(bloque[0]).toMatch(/\.grid\.has-results\s*\{\s*transition:[^;]*,\s*min-height\s+0s;/);
  });

  it('el footer sigue siendo hermano posterior del layout, no se oculta ni se saca de flujo', () => {
    // Ocultar el footer hasta calcular tambien evitaria el CLS, pero esconderia los enlaces de
    // privacidad y aviso legal. Se descarto a proposito.
    expect(css).not.toMatch(/\.footer-container\s*\{[^}]*display:\s*none/);
  });
});
