/**
 * Ronda 15 (27/08/2026): contratos numericos por PROCEDENCIA.
 *
 * El repo tiene tres fronteras de parseo con contratos DELIBERADAMENTE distintos. No son
 * cuatro implementaciones de lo mismo y NO deben unificarse (matiz de Codex al plantear la
 * ronda; el `parseNum` de desglose-integration.js es un fallback del canonico, no un cuarto
 * parser):
 *
 *   UI      LF.parseNum              -> 0 ante invalido. Trabaja junto a esNumericoValido,
 *                                       que es quien rechaza de verdad la entrada.
 *   CSV     parseNumberFlexible(CSV) -> NaN ante vacio o texto no numerico ordinario.
 *                                       Admite ES y US. La FINITUD no la garantiza el
 *                                       parser: `Infinity` sobrevive y lo filtran los
 *                                       consumidores con Number.isFinite.
 *   PDF     __LF_normNum             -> null ante ilegible. Permisivo: quita unidades.
 *
 * Una divergencia entre ellas puede ser CORRECTA: "1.234" son 1234 en una factura espanola
 * y 1,234 en un CSV con decimal de punto. Lo que este fichero fija es el CONTRATO DE
 * RETORNO de cada frontera, porque confundirlos si tiene consecuencias.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

let UI, CSV, XLSX, PDF, esNumericoValido;

beforeAll(() => {
  const cargar = (rel) => new Function('window', fs.readFileSync(path.resolve(__dirname, rel), 'utf8'))(window);
  window.LF = window.LF || {};
  cargar('../js/lf-utils.js');
  cargar('../js/lf-csv-utils.js');
  cargar('../js/factura-parsers.js');
  UI = window.LF.parseNum;
  esNumericoValido = window.LF.esNumericoValido;
  CSV = window.LF.csvUtils.parseNumberFlexibleCSV;
  XLSX = window.LF.csvUtils.parseNumberFlexible;
  PDF = window.__LF_FacturaParsers.__LF_normNum;
});

const ILEGIBLES = [null, undefined, '', '   ', 'abc', '---'];

describe('Contratos numericos por procedencia', () => {
  it('UI (parseNum): 0 ante lo ilegible, NUNCA NaN', () => {
    // La UI opera con el resultado directamente (sumas, comparaciones). Un NaN se
    // propagaria en silencio a todo el calculo.
    for (const v of ILEGIBLES) {
      expect(UI(v), `parseNum(${JSON.stringify(v)})`).toBe(0);
      expect(Number.isNaN(UI(v))).toBe(false);
    }
  });

  it('UI: quien rechaza la entrada rara es esNumericoValido, no parseNum', () => {
    // parseNum es permisivo a proposito: "12abc34" da 1234. Lo que impide que eso llegue
    // al calculo es el validador, asi que su veredicto forma parte del contrato.
    for (const v of ['1e3', '12abc34', 'Infinity', '--5', '0x10']) {
      expect(esNumericoValido(v), `esNumericoValido(${JSON.stringify(v)})`).toBe(false);
    }
    expect(esNumericoValido('1.234')).toBe(true);   // miles en formato ES: si es valido
  });

  it('CSV/XLSX: NaN ante vacio o texto no numerico, NUNCA 0', () => {
    // Un 0 silencioso en una celda ilegible falsearia el consumo. Ojo al alcance: esto NO
    // dice que el parser garantice un numero FINITO. `Infinity` sobrevive como Infinity;
    // de eso se encargan los consumidores (parseEnergyTableRows, parseHourlyMatrixRows)
    // filtrando por Number.isFinite.
    for (const v of ILEGIBLES) {
      expect(Number.isNaN(CSV(v)), `CSV(${JSON.stringify(v)})`).toBe(true);
      expect(Number.isNaN(XLSX(v)), `XLSX(${JSON.stringify(v)})`).toBe(true);
    }
  });

  it('PDF (__LF_normNum): null ante lo ilegible, NUNCA 0', () => {
    // 22 call sites, y no todos reaccionan igual: 11 extracciones protegidas frente a
    // `null`, 3 conversiones con `?? 0`, 6 lecturas del modal con validacion individual y
    // 2 solares que solo influyen si son `> 0`. El impacto concreto esta en el modal:
    // p1 y los tres consumos aceptan 0 como VALIDO (rechazan `< 0`), asi que un campo
    // ilegible convertido en cero se aplicaria en silencio. Cubierto de punta a punta en
    // tests/factura-integration.test.js.
    for (const v of ILEGIBLES) {
      expect(PDF(v), `__LF_normNum(${JSON.stringify(v)})`).toBeNull();
    }
    expect(PDF('0')).toBe(0);        // un cero REAL si debe devolverse
    expect(PDF('0,00 €')).toBe(0);
  });

  it('el dominio compartido se lee igual en las tres fronteras', () => {
    // Donde no hay ambiguedad, las tres deben coincidir.
    for (const [entrada, esperado] of [['12,34', 12.34], ['0,123', 0.123], ['150', 150], ['1.234,56', 1234.56]]) {
      expect(UI(entrada), `UI ${entrada}`).toBeCloseTo(esperado, 6);
      expect(CSV(entrada), `CSV ${entrada}`).toBeCloseTo(esperado, 6);
      expect(PDF(entrada), `PDF ${entrada}`).toBeCloseTo(esperado, 6);
    }
  });

  it('las divergencias ambiguas son deliberadas y quedan documentadas', () => {
    // "1.234" no tiene lectura unica. La UI y el PDF asumen formato espanol (miles); el
    // parser de CSV asume decimal, porque un CSV puede venir en formato US. Fijarlo evita
    // que alguien "corrija" una de las dos creyendo que es un bug.
    expect(UI('1.234')).toBe(1234);
    expect(PDF('1.234')).toBe(1234);
    expect(CSV('1.234')).toBeCloseTo(1.234, 6);
  });
});
