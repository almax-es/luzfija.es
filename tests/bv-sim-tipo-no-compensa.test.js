/**
 * @vitest-environment jsdom
 *
 * 06/09/2026. Ronda 24 (catalogo tarifas.json frente al motor). El universo del ranking
 * solar se derivaba SOLO de `fv.exc`: una fila con `fv.tipo = 'NO COMPENSA'` y un precio
 * de excedentes positivo entraba en `tarifasBV` y se le calculaba compensacion, mientras
 * la home (`lf-calc.js`, guard `fv.tipo !== 'NO COMPENSA'`) y el desglose
 * (`desglose-calculo.js`, mismo guard) NO la compensaban.
 *
 * No es un bug observable con el catalogo publicado: las 118 filas cumplen la invariante
 * "NO COMPENSA => exc = 0" porque la mantiene el generador, no la web. Estos tests fijan
 * que el criterio de compensar sea el mismo en las tres rutas aunque esa invariante se
 * rompa, y que el filtro siga siendo un no-op para el catalogo real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const leer = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

// Monta bv-sim-monthly.js con la red mockeada, igual que tests/red-deadlines.test.js.
function bootSim(tarifas) {
  window.LF = {
    JSON_URL: 'tarifas.json',
    esTarifaUtilizable: () => true,
    csvUtils: {
      fetchJsonWithTimeout: vi.fn(async () => ({
        response: { ok: true, status: 200 },
        data: { updatedAt: '2026-09-06T00:00:00.000Z', tarifas }
      }))
    }
  };
  new Function('window', leer('../js/bv/bv-sim-monthly.js'))(window);
}

const fila = (nombre, fv) => ({
  nombre,
  tipo: '3P',
  cPunta: 0.12, cLlano: 0.10, cValle: 0.08,
  p1: 0.09, p2: 0.02,
  requiereFV: false,
  incluyeServiciosAjuste: true,
  fv
});

const nombres = (r) => r.tarifasBV.map((t) => t.nombre);

describe('Universo del ranking solar: fv.tipo manda sobre fv.exc', () => {
  beforeEach(() => {
    global.window.BVSim = undefined;
    delete global.window.LF;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('una fila NO COMPENSA con precio de excedentes positivo NO entra en el ranking', async () => {
    // La mutacion que mata este test: quitar la linea
    //   if (tarifa.fv.tipo === 'NO COMPENSA') return false;
    // de loadTarifasBV. Sin ella la fila incoherente vuelve a entrar y el simulador le
    // calcula compensacion que la home niega.
    bootSim([
      fila('Incoherente', { exc: 0.05, tipo: 'NO COMPENSA', tope: '—', bv: false, reglaBV: 'NO APLICA', precioBV: 0 }),
      fila('Coherente', { exc: 0.05, tipo: 'SIMPLE', tope: 'ENERGIA', bv: false, reglaBV: 'NO APLICA', precioBV: 0 })
    ]);

    const r = await window.BVSim.loadTarifasBV();

    expect(r.ok).toBe(true);
    expect(nombres(r)).toEqual(['Coherente']);
  });

  it('una fila NO COMPENSA con el sentinel indexado -1 tampoco entra', async () => {
    // El sentinel esquiva la comprobacion numerica del precio, asi que necesita su
    // propio caso: sin el guard de tipo, `exc === -1` bastaba para entrar.
    bootSim([
      fila('Indexada incoherente', { exc: -1, tipo: 'NO COMPENSA', tope: '—', bv: false, reglaBV: 'NO APLICA', precioBV: 0 })
    ]);

    const r = await window.BVSim.loadTarifasBV();

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No hay tarifas remuneradas/i);
  });

  it('las tarifas que SI compensan siguen entrando, incluidas las indexadas y las de BV', async () => {
    bootSim([
      fila('Simple', { exc: 0.06, tipo: 'SIMPLE', tope: 'ENERGIA', bv: false, reglaBV: 'NO APLICA', precioBV: 0 }),
      fila('Indexada', { exc: -1, tipo: 'SIMPLE + BV', tope: 'ENERGIA', bv: true, reglaBV: 'BV MES ANTERIOR', precioBV: 0 }),
      fila('Parcial', { exc: 0.04, tipo: 'SIMPLE + BV', tope: 'ENERGIA_PARCIAL', bv: true, reglaBV: 'BV MES ANTERIOR', precioBV: 3 })
    ]);

    const r = await window.BVSim.loadTarifasBV();

    expect(r.ok).toBe(true);
    expect(nombres(r)).toEqual(['Simple', 'Indexada', 'Parcial']);
  });

  it('un fv.tipo ausente no excluye: falso negativo antes que falso positivo', async () => {
    // Regla 6 del metodo (AUDITORIA-IA.md): un guard demasiado ancho ya ha roto antes
    // funciones que servian a datos validos. Un campo que falta no puede borrar una
    // tarifa del ranking en silencio.
    bootSim([
      fila('Sin tipo', { exc: 0.05, tope: 'ENERGIA', bv: false, reglaBV: 'NO APLICA', precioBV: 0 })
    ]);

    const r = await window.BVSim.loadTarifasBV();

    expect(r.ok).toBe(true);
    expect(nombres(r)).toEqual(['Sin tipo']);
  });

  it('sobre el catalogo real publicado el filtro es un no-op', async () => {
    // El guard se anyade por alineacion entre rutas, no para corregir el dataset. Si
    // algun dia deja de ser no-op es que el generador publico una fila incoherente: este
    // test lo convierte en un fallo ruidoso en vez de una tarifa desaparecida en silencio.
    const catalogo = JSON.parse(leer('../tarifas.json')).tarifas;
    const conExcRemunerado = catalogo.filter((t) => {
      const raw = t?.fv?.exc;
      return (raw === -1) || (Number.isFinite(Number(raw)) && Number(raw) > 0);
    });

    bootSim(catalogo);
    const r = await window.BVSim.loadTarifasBV();

    expect(r.ok).toBe(true);
    expect(r.tarifasBV).toHaveLength(conExcRemunerado.length);
    expect(catalogo.filter((t) => t?.fv?.tipo === 'NO COMPENSA' && Number(t?.fv?.exc) !== 0)).toEqual([]);
  });
});
