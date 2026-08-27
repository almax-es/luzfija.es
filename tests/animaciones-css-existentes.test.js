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
 * ALCANCE: cubre los dos patrones que existen HOY en el repo:
 *     element.style.animation = 'nombre 1s'
 *     element.style.cssText   = '...;animation:nombre 1s;...'
 * incluida la shorthand con varias animaciones separadas por comas. NO detecta (hoy no se
 * usan; si alguien los introduce, hay que ampliar esto):
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

describe('Toda animacion referenciada desde JS existe en el CSS', () => {
  const keyframes = new Set();
  for (const css of listar(raiz, '.css')) {
    const texto = fs.readFileSync(css, 'utf8');
    for (const m of texto.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) keyframes.add(m[1]);
  }

  // Referencias vivas: `animation: ...` escrito desde JavaScript. Se procesa la
  // declaracion ENTERA, no solo el primer nombre: la shorthand admite varias animaciones
  // separadas por comas ("slideInScale 0.35s, btnPulse 1.5s") y quedarse con la primera
  // deja ciegas a las demas.
  const referencias = [];
  for (const js of listar(path.join(raiz, 'js'), '.js')) {
    const texto = fs.readFileSync(js, 'utf8');
    // Dos formas conviven en el repo y hay que cubrir las dos:
    //   style.animation = 'slideInScale 0.35s, btnPulse 1.5s'   -> valor entre comillas
    //   style.cssText  = '...;animation:rippleExpand 0.8s;...'  -> valor DENTRO de la cadena
    // El ripple usaba la segunda: un patron que solo mirase la primera lo habria dejado pasar.
    const valores = [
      ...[...texto.matchAll(/animation\s*=\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]),
      ...[...texto.matchAll(/animation\s*:\s*([^;'"`\n}]+)/g)].map((m) => m[1])
    ];
    for (const valor of valores) {
      for (const parte of valor.split(',')) {
        for (const token of parte.trim().split(/\s+/)) {
          // Descarta duraciones (0.35s), porcentajes, numeros y funciones de easing.
          if (!/^[A-Za-z_][\w-]*$/.test(token)) continue;
          if (PALABRAS_CSS.has(token)) continue;
          referencias.push({ fichero: path.relative(raiz, js).split(path.sep).join('/'), nombre: token });
        }
      }
    }
  }

  // Excepciones por PAREJA fichero:nombre, no por nombre suelto.
  // btnPulse (js/bv/bv-ui.js:2458) esta PENDIENTE de decision: mismo patron que el ripple,
  // detectado el 27/08/2026 y aun sin reproducir en Chrome. Se excluye para que el guard
  // entre en vigor ya, en vez de esperar a esa decision.
  const PENDIENTES = new Set(['js/bv/bv-ui.js:btnPulse']);
  const clave = (r) => `${r.fichero}:${r.nombre}`;

  it('hay keyframes y referencias que comprobar (el guard no esta vacio)', () => {
    expect(keyframes.size).toBeGreaterThan(10);
    expect(referencias.length).toBeGreaterThan(0);
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
