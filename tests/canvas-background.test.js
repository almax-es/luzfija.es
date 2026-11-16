import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Fondo del lienzo.
 *
 * Los degradados del `body` son `background-image` y quedan anclados a su caja,
 * que mide una pantalla exacta por el `height:100%`. Sin un `background-color`
 * solido, el area que se descubre al replegarse la barra del navegador o al
 * rebotar el scroll se pinta con el defecto del lienzo, que con
 * `color-scheme: dark light` sale BLANCO cuando el sistema esta en tema claro.
 *
 * Se vio en Android al scrollear rapido, como una franja blanca junto a los
 * botones del sistema. Estos tests existen para que un refactor de fondos no lo
 * reintroduzca en silencio: no da error en consola ni falla ningun otro test.
 */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const hojas = [
  'styles.css',
  'comparador-solar-mejorado.css'
];

describe('fondo del lienzo', () => {
  it('html declara un background-color solido, no solo degradados', () => {
    const css = read('styles.css');
    expect(css).toMatch(/html\{\s*background-color:\s*var\(--bg0\)/);
  });

  it('ese color usa una variable de tema, para cubrir claro y oscuro con una regla', () => {
    const css = read('styles.css');
    const regla = css.match(/html\{\s*background-color:\s*([^;]+);/);
    expect(regla).not.toBeNull();
    // Un color fijo aqui rompeeria uno de los dos temas.
    expect(regla[1].trim()).toMatch(/^var\(--bg/);
  });

  it('sigue existiendo la variable de tema en ambos modos', () => {
    const css = read('styles.css');
    expect(css).toMatch(/:root\{[^}]*--bg0:\s*#/);
    expect(css).toMatch(/html\.light-mode\s*\{[\s\S]{0,400}--bg0:\s*#/);
  });

  it('ninguna hoja deja el fondo del lienzo solo en background-image del body', () => {
    // El body puede (y debe) seguir teniendo sus degradados; lo que no puede es
    // ser el UNICO responsable de pintar el area visible.
    const css = read('styles.css');
    const iHtml = css.search(/html\{\s*background-color:/);
    const iBody = css.search(/\n\s*body\{[^}]*background:/);
    expect(iHtml).toBeGreaterThan(-1);
    expect(iBody).toBeGreaterThan(-1);
    // El color del lienzo debe declararse ANTES o junto al body, no despues de
    // reglas que pudieran pisarlo sin querer.
    expect(iHtml).toBeLessThan(iBody);
  });

  it('las hojas revisadas siguen presentes (guarda contra renombrados)', () => {
    hojas.forEach((h) => {
      expect(() => read(h), `falta ${h}`).not.toThrow();
    });
  });
});
