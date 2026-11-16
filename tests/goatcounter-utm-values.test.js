/**
 * @vitest-environment jsdom
 */

// Ejecuta el count.js REAL (no una copia del algoritmo) y comprueba el campo `q`
// que GoatCounter recibiria. El nombre de los UTM va en lista blanca, pero su
// valor lo escribe quien crea el enlace: un CUPS, email, telefono, DNI o IBAN
// dentro de un UTM no debe viajar (ronda 77 de AUDITORIA-REGISTRO.md).

import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const COUNT_JS = fs.readFileSync(path.resolve(__dirname, '../vendor/goatcounter/count.js'), 'utf8');

function queryFor(search) {
  window.history.replaceState({}, '', `/${search}`);
  return window.goatcounter.get_data({ path: '/', referrer: '', title: '' }).q;
}

describe('count.js: valores de los UTM permitidos', () => {
  beforeAll(() => {
    window.goatcounter = { no_onload: true, no_events: true };
    window.eval(COUNT_JS);
    expect(typeof window.goatcounter.get_data).toBe('function');
  });

  it.each([
    ['CUPS', '?utm_term=ES0021000000000000AB'],
    ['CUPS con frontera', '?utm_content=ES0031405000000000XY0F'],
    ['email', '?utm_source=juan%40example.com'],
    ['telefono con espacios', '?utm_campaign=612%20345%20678'],
    ['telefono con prefijo', '?utm_medium=%2B34-612.345.678'],
    ['DNI', '?utm_term=12345678Z'],
    ['IBAN', '?utm_term=ES9121000418450200051332'],
    // Ronda 78: separadores que la limpieza quita (o deja) y el filtro no miraba.
    ['telefono con comas', '?utm_campaign=612%2C345%2C678'],
    ['CUPS con comas', '?utm_term=ES0021%2C0000%2C0000%2C00AB'],
    ['telefono con ancho cero', '?utm_campaign=612%E2%80%8B345%E2%80%8B678'],
    ['telefono con guion bajo', '?utm_content=612_345_678'],
    ['telefono con dos puntos', '?utm_term=612%3A345%3A678'],
    ['telefono con virgulilla', '?utm_term=612~345~678'],
    // Ronda 79: doble codificacion (URLSearchParams solo decodifica un nivel) y
    // cifras separadas por letras. La regla cuenta cifras en total y rechaza el %.
    ['telefono con comas codificadas dos veces', '?utm_campaign=612%252C345%252C678'],
    ['CUPS con comas codificadas dos veces', '?utm_term=ES0021%252C0000%252C0000%252C00AB'],
    ['email codificado dos veces', '?utm_content=juan%2540example.com'],
    ['telefono con letras intercaladas', '?utm_term=612a345b678'],
  ])('descarta un %s', (_caso, search) => {
    expect(queryFor(search)).toBe('');
  });

  it('conserva las campanas legitimas y quita solo el parametro personal', () => {
    expect(queryFor('?utm_source=forocoches&utm_medium=post&utm_campaign=otono-2026'))
      .toBe('?utm_source=forocoches&utm_medium=post&utm_campaign=otono-2026');
    expect(queryFor('?utm_source=nergiza&utm_term=ES0021000000000000AB'))
      .toBe('?utm_source=nergiza');
  });

  it('sigue sin enviar parametros fuera de la lista blanca', () => {
    expect(queryFor('?cups=ES0021000000000000AB&p1=4.6&utm_source=x')).toBe('?utm_source=x');
  });
});
