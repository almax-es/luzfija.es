/**
 * 27/08/2026. `createRipple()` referenciaba `animation: rippleExpand`, un keyframe que NO
 * existia en ningun CSS del proyecto: los tres spans se creaban sin animarse (verificado en
 * Chrome: 0 animaciones activas, `transform: none`) y solo dejaban un destello. Nadie se
 * entero porque un nombre de animacion inexistente no da error, ni en consola ni en tests:
 * el navegador simplemente no anima.
 *
 * Este guard ataca la CLASE de fallo, no el caso: una `animation` escrita desde JS debe
 * tener su `@keyframes` en algun CSS del repositorio.
 *
 * ALCANCE: cubre los dos patrones que han existido en el repo:
 *     element.style.animation = 'nombre 1s'
 *     element.style.cssText   = '...;animation:nombre 1s;...'
 * incluida la shorthand con varias animaciones separadas por comas. NO detecta (hoy no se
 * usan; si alguien los introduce, hay que ampliar `extraerAnimaciones`):
 *     element.style.setProperty('animation', 'nombre 1s')
 *     Object.assign(element.style, { animation: 'nombre 1s' })
 *     element.style.animationName = 'nombre'
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const raiz = path.resolve(__dirname, '..');

function listar(dir, ext, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listar(p, ext, acc);
    else if (entrada.name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

// Nombres que CSS reserva y no son keyframes.
const PALABRAS_CSS = new Set([
  'none', 'inherit', 'initial', 'unset', 'revert', 'linear', 'ease', 'ease-in', 'ease-out',
  'ease-in-out', 'infinite', 'alternate', 'forwards', 'backwards', 'both', 'running',
  'paused', 'normal', 'reverse', 'step-start', 'step-end',
  'cubic-bezier', 'steps', 'linear-gradient', 'var', 'calc'
]);

/** Nombres de keyframes referenciados desde un fuente JavaScript. */
export function extraerAnimaciones(texto) {
  const valores = [
    ...[...texto.matchAll(/animation\s*=\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]),
    ...[...texto.matchAll(/animation\s*:\s*([^;'"`\n}]+)/g)].map((m) => m[1])
  ];
  const nombres = [];
  for (const valor of valores) {
    for (const parte of valor.split(',')) {
      for (const token of parte.trim().split(/\s+/)) {
        // Descarta duraciones (0.35s), porcentajes, numeros y funciones de easing.
        if (!/^[A-Za-z_][\w-]*$/.test(token)) continue;
        if (PALABRAS_CSS.has(token)) continue;
        nombres.push(token);
      }
    }
  }
  return nombres;
}

describe('Toda animacion referenciada desde JS existe en el CSS', () => {
  const keyframes = new Set();
  for (const css of listar(raiz, '.css')) {
    const texto = fs.readFileSync(css, 'utf8');
    for (const m of texto.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) keyframes.add(m[1]);
  }

  const referencias = [];
  for (const js of listar(path.join(raiz, 'js'), '.js')) {
    const texto = fs.readFileSync(js, 'utf8');
    for (const nombre of extraerAnimaciones(texto)) {
      referencias.push({ fichero: path.relative(raiz, js).split(path.sep).join('/'), nombre });
    }
  }

  // Excepciones por PAREJA fichero:nombre, nunca por nombre suelto. Vacio a proposito:
  // btnPulse era la unica y se retiro el 27/08/2026 al eliminar su bloque muerto.
  const PENDIENTES = new Set();
  const clave = (r) => `${r.fichero}:${r.nombre}`;

  it('el extractor reconoce los patrones que se usan en el repo', () => {
    // Autotest del parser. Sustituye al viejo centinela `referencias.length > 0`: hoy no
    // queda ninguna animacion escrita desde JS, y no se conserva codigo muerto solo para
    // mantener verde un guard. Asi el extractor sigue probado aunque el repo este limpio.
    expect(extraerAnimaciones(`el.style.animation = 'fadeIn 1s ease-out';`)).toEqual(['fadeIn']);
    expect(extraerAnimaciones(`el.style.cssText = 'width:10px;animation:ripple 0.8s ease-out;';`)).toEqual(['ripple']);
    expect(extraerAnimaciones(`el.style.animation = 'slideInScale 0.35s ease-out, btnPulse 1.5s ease-in-out 0.5s';`))
      .toEqual(['slideInScale', 'btnPulse']);
    // Sin espacio tras la coma. Este es el caso que obliga a partir por comas: troceando
    // solo por espacios, "1s,segunda" queda pegado, no casa el patron de identificador y la
    // segunda animacion se pierde en silencio.
    expect(extraerAnimaciones(`el.style.animation = 'primera 1s,segunda 2s';`))
      .toEqual(['primera', 'segunda']);
    // Ni duraciones, ni easings, ni `none` cuentan como nombre de keyframe.
    expect(extraerAnimaciones(`el.style.animation = 'none';`)).toEqual([]);
    expect(extraerAnimaciones(`el.style.animation = 'x 1s cubic-bezier(0.4, 0, 0.2, 1) infinite';`)).toEqual(['x']);
    expect(extraerAnimaciones(`const t = 'sin animaciones aqui';`)).toEqual([]);
  });

  it('hay keyframes definidos que comprobar', () => {
    expect(keyframes.size).toBeGreaterThan(10);
  });

  it('ninguna animacion escrita desde JS apunta a un keyframe inexistente', () => {
    const rotas = referencias
      .filter((r) => !keyframes.has(r.nombre) && !PENDIENTES.has(clave(r)))
      .map((r) => `${r.fichero}: animation "${r.nombre}" sin @keyframes`);
    expect(rotas).toEqual([]);
  });

  // La excepcion caduca sola: si se retira la referencia, se define el keyframe o alguien
  // usa ese nombre desde OTRO fichero, este test obliga a revisarla. Una excepcion por
  // nombre suelto perdonaria las tres cosas en silencio.
  it('las excepciones pendientes siguen siendo necesarias y siguen acotadas', () => {
    for (const pendiente of PENDIENTES) {
      const corte = pendiente.lastIndexOf(':');
      const fichero = pendiente.slice(0, corte);
      const nombre = pendiente.slice(corte + 1);

      expect(
        referencias.some((r) => r.fichero === fichero && r.nombre === nombre),
        `${pendiente}: ya no existe esa referencia, retira la excepcion`
      ).toBe(true);

      expect(
        keyframes.has(nombre),
        `${pendiente}: ya existe @keyframes ${nombre}, retira la excepcion`
      ).toBe(false);
    }
  });
});
