import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Hucha BV inicial sin tarifa actual a la que asignarla.
 *
 * Caso real (30/10/2026): un usuario escribio su saldo de hucha, no relleno "Mi tarifa" y vio
 * en el ganador "Uso de hucha" y "Saldo BV final 0 €"; creyo que el calculo no cuadraba. El
 * aviso estaba dentro de la nota "¿Como se calcula el ranking?" y el toast desaparece. Debe ir
 * en un bloque visible ENCIMA del ganador.
 */
const src = fs.readFileSync(path.join(process.cwd(), 'js/bv/bv-ui.js'), 'utf8');

describe('saldo BV inicial no aplicado', () => {
  it('se pinta como aviso visible antes del ganador, no dentro de la nota del ranking', () => {
    const m = src.match(/resultsEl\.innerHTML = `[^`]*Resultados de la Simulación<\/h2>([^`]*)`;/g) || [];
    const final = m.find((s) => s.includes('${winnerHTML}'));
    expect(final).toBeTruthy();
    const i = final.indexOf('${saldoSinDestinoMsg}');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(final.indexOf('${winnerHTML}'));
    expect(i).toBeLessThan(final.indexOf('${rankingNote}'));
  });

  it('el aviso usa la caja de avisos, dice que no se ha aplicado y como aplicarlo', () => {
    const def = src.match(/saldoSinDestinoMsg = `([^`]*)`;/);
    expect(def).toBeTruthy();
    expect(def[1]).toContain('class="consumo-limits-notice"');
    expect(def[1]).toContain('no se han aplicado');
    expect(def[1]).toContain('Comparar con mi tarifa actual');
    expect(def[1]).toContain('hucha a 0 €');
  });

  it('el toast de error sigue acompanando al aviso', () => {
    expect(src).toContain('El saldo BV inicial no se ha aplicado: no hay tarifa actual con batería virtual.');
  });
});
