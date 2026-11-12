import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * En movil (<= 768 px) la cabecera de los modales es sticky con z-index propio. La X
 * (`.modal-x`, position:absolute) iba sin z-index y quedaba debajo: en los modales de
 * factura, placas y PVPC no se podia cerrar con ella (medido el 12/11/2026 con
 * elementFromPoint en Pixel 5: el toque lo recibia `.head`). Este test fija que la X
 * quede siempre por encima de esa cabecera.
 */

const css = fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'), 'utf8');
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

function zIndexDe(bloque) {
  const m = bloque.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

describe('La X de los modales queda por encima de la cabecera sticky en movil', () => {
  it('.modal-x tiene z-index mayor que .modal-content .head', () => {
    const x = sinComentarios.match(/\.modal-x\s*\{([^}]*)\}/);
    expect(x, 'falta la regla base de .modal-x').toBeTruthy();
    const head = sinComentarios.match(/\.modal-content \.head\s*\{([^}]*position:\s*sticky[^}]*)\}/);
    expect(head, 'falta la cabecera sticky de los modales en movil').toBeTruthy();
    const zx = zIndexDe(x[1]);
    const zh = zIndexDe(head[1]);
    expect(zx, '.modal-x necesita z-index propio').not.toBeNull();
    expect(zh).not.toBeNull();
    expect(zx).toBeGreaterThan(zh);
  });
});
