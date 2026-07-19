import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const uiCode = fs.readdirSync(path.resolve(__dirname, '../js/bv'))
  .filter((file) => /^bv-ui.*\.js$/.test(file))
  .sort()
  .map((file) => fs.readFileSync(path.resolve(__dirname, '../js/bv', file), 'utf8'))
  .join('\n');
const loadBvUi = new Function('window', uiCode);

describe('BV UI manual month helpers', () => {
  let domContentLoadedHandlers;
  let addEventListenerSpy;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.BVSim = {};
    window.LF = window.LF || {};
    window.LF.parseNum = (val) => {
      if (val === null || val === undefined) return 0;
      return parseFloat(String(val).replace(',', '.'));
    };

    domContentLoadedHandlers = [];
    const nativeAddEventListener = document.addEventListener.bind(document);
    addEventListenerSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      nativeAddEventListener(type, listener, options);
      if (type === 'DOMContentLoaded') {
        domContentLoadedHandlers.push({ listener, options });
      }
    });

    loadBvUi(window);
    window.BVSim._hourlyTraceState = {
      records: null,
      zonaFiscal: null,
      dirty: false,
      reason: '',
      stats: null
    };
    window.BVSim._hourlyTraceControls = window.BVSim.manualUi.createHourlyTraceControls(
      window.BVSim._hourlyTraceState,
      (value) => String(value || '')
    );
  });

  afterEach(() => {
    domContentLoadedHandlers.forEach(({ listener, options }) => {
      document.removeEventListener('DOMContentLoaded', listener, options);
    });
    addEventListenerSpy.mockRestore();
    document.body.innerHTML = '';
    window.BVSim = {};
  });

  it('pickLatestMonthData conserva el mes más reciente y su metadata real', () => {
    const { monthDataMap, yearsFound } = window.BVSim.manualUi.pickLatestMonthData([
      {
        key: '2024-01',
        daysWithData: 31,
        daysInMonth: 31,
        importByPeriod: { P1: 1, P2: 2, P3: 3 },
        exportTotalKWh: 4
      },
      {
        key: '2025-01',
        daysWithData: 10,
        daysInMonth: 31,
        importByPeriod: { P1: 12, P2: 8, P3: 5 },
        exportTotalKWh: 3
      }
    ]);

    expect(Array.from(yearsFound).sort()).toEqual([2024, 2025]);
    expect(monthDataMap.get(0)).toEqual({
      year: 2025,
      p1: 12,
      p2: 8,
      p3: 5,
      vert: 3,
      meta: {
        key: '2025-01',
        daysWithData: 10,
        daysInMonth: 31
      }
    });
  });

  it('buildSimulationMonths conserva key y daysWithData importados al simular desde la tabla manual', () => {
    const months = window.BVSim.manualUi.buildSimulationMonths([
      { p1: 12, p2: 8, p3: 5, vert: 3 }
    ], {
      currentYear: 2026,
      monthMetaByIndex: {
        0: { key: '2025-01', daysWithData: 10, daysInMonth: 31 }
      }
    });

    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({
      key: '2025-01',
      daysWithData: 10,
      daysInMonth: 31,
      importTotalKWh: 25,
      exportTotalKWh: 3,
      importByPeriod: { P1: 12, P2: 8, P3: 5 }
    });
  });

  it('buildSimulationMonths usa año actual y mes completo cuando no existe metadata CSV', () => {
    const months = window.BVSim.manualUi.buildSimulationMonths([
      { p1: 12, p2: 8, p3: 5, vert: 3 }
    ], {
      currentYear: 2026
    });

    expect(months).toHaveLength(1);
    expect(months[0].key).toBe('2026-01');
    expect(months[0].daysWithData).toBe(31);
    expect(months[0].daysInMonth).toBe(31);
  });

  it('rotateMonthsByStart rota un ciclo anual desde el mes elegido sin mutar el original', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      key: `2026-${String(i + 1).padStart(2, '0')}`
    }));

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-05');

    expect(rotated.map((month) => month.key)).toEqual([
      '2026-05', '2026-06', '2026-07', '2026-08',
      '2026-09', '2026-10', '2026-11', '2026-12',
      '2026-01', '2026-02', '2026-03', '2026-04'
    ]);
    expect(months[0].key).toBe('2026-01');
    expect(rotated).not.toBe(months);
    expect(rotated[0]).toBe(months[4]);
  });

  it('rotateMonthsByStart funciona con periodos parciales', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
      .map((key) => ({ key }));

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-08');

    expect(rotated.map((month) => month.key)).toEqual([
      '2026-08', '2026-09', '2026-10', '2026-05', '2026-06', '2026-07'
    ]);
  });

  it('rotateMonthsByStart no cambia el orden si el mes no existe o no se elige', () => {
    const months = [{ key: '2026-03' }, { key: '2026-04' }];

    expect(window.BVSim.manualUi.rotateMonthsByStart(months, '').map((month) => month.key))
      .toEqual(['2026-03', '2026-04']);
    expect(window.BVSim.manualUi.rotateMonthsByStart(months, '2026-08').map((month) => month.key))
      .toEqual(['2026-03', '2026-04']);
  });

  it('rotateMonthsByStart conserva los datos enriquecidos de cada mes', () => {
    const months = [
      { key: '2026-01', indexedSurplusEur: 1.23 },
      { key: '2026-02', indexedSurplusEur: 4.56 }
    ];

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-02');

    expect(rotated[0]).toMatchObject({
      key: '2026-02',
      indexedSurplusEur: 4.56
    });
    expect(rotated[0]).toBe(months[1]);
  });

  it('setHourlyTraceFromImport limpia el trace cuando meta.hasExcedenteColumn es false', () => {
    const { setFromImport, canUse, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 3 }],
      meta: { hasExcedenteColumn: false }
    }, 'Península');

    expect(window.BVSim._hourlyTraceState.records).toBeNull();
    expect(window.BVSim._hourlyTraceState.reason).toBe('no-hourly-surplus-column');
    expect(canUse('Península')).toBe(false);
    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('no tiene columna de excedentes');
  });

  it('invalidateHourlyTrace no pisa el motivo no-hourly-surplus-column cuando no hay records', () => {
    const { setFromImport, invalidate } = window.BVSim._hourlyTraceControls;

    setFromImport({ ok: true, records: [], meta: { hasExcedenteColumn: false } }, 'Península');
    invalidate('manual-edit');

    expect(window.BVSim._hourlyTraceState.records).toBeNull();
    expect(window.BVSim._hourlyTraceState.reason).toBe('no-hourly-surplus-column');
    expect(window.BVSim._hourlyTraceState.dirty).toBe(false);
  });

  it('reimportar un CSV sin excedentes limpia records y stats previos', () => {
    const { setFromImport } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 3 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = { totalKwh: 3, missing: 0 };

    setFromImport({ ok: true, records: [], meta: { hasExcedenteColumn: false } }, 'Península');

    expect(window.BVSim._hourlyTraceState.records).toBeNull();
    expect(window.BVSim._hourlyTraceState.stats).toBeNull();
    expect(window.BVSim._hourlyTraceState.reason).toBe('no-hourly-surplus-column');
  });

  it('buildIndexedFallbackMsg distingue CSV activo con excedentes a cero de ausencia de CSV', () => {
    const { setFromImport, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('Sin CSV con excedentes activo');

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 0 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = { totalKwh: 0, missing: 0 };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('no registra excedentes');
  });

  it('buildIndexedFallbackMsg prioriza zona distinta y missing total sobre ramas nuevas', () => {
    const { setFromImport, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 2 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = { totalKwh: 0, missing: 0 };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Canarias'))
      .toContain('El CSV importado es de <strong>Península</strong>');

    window.BVSim._hourlyTraceState.zonaFiscal = 'Canarias';
    window.BVSim._hourlyTraceState.stats = { totalKwh: 0, missing: 2 };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Canarias'))
      .toContain('No hay precios del índice disponibles');
  });

  it('buildIndexedFallbackMsg explica fallback por cobertura parcial rechazada', () => {
    const { setFromImport, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 0, 1), hora: 12, excedente: 2 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');
    window.BVSim._hourlyTraceState.stats = {
      totalKwh: 2,
      missing: 8,
      partialCoverageRejected: true,
      partialCoverageRejectedMonths: 1,
      partialCoverageTotalMonths: 2
    };

    expect(buildIndexedFallbackMsg(true, 'reference', 'Península'))
      .toContain('en 1 de 2 meses');
    expect(buildIndexedFallbackMsg(true, 'hourly-index-base', 'Península'))
      .toContain('en 1 de 2 meses');
  });

  describe('resolveSaldoConfig: saldo BV inicial solo para "Mi tarifa" con BV', () => {
    const customConBV = { nombre: 'Mi tarifa ⭐', esPersonalizada: true, fv: { exc: 0.05, bv: true } };
    const customSinBV = { nombre: 'Mi tarifa ⭐', esPersonalizada: true, fv: { exc: 0.05, bv: false } };
    const candidataBV = { nombre: 'Candidata', fv: { exc: 0.05, bv: true } };

    it('con Mi tarifa con BV: aplica el saldo solo a ella, candidatas a 0', () => {
      const cfg = window.BVSim.manualUi.resolveSaldoConfig(customConBV, 50);
      expect(cfg.aplicado).toBe(true);
      expect(cfg.sinDestino).toBe(false);
      expect(cfg.resolver(customConBV)).toBe(50);
      expect(cfg.resolver(candidataBV)).toBe(0);
    });

    it('saldo sin destino: hay saldo pero no Mi tarifa, o Mi tarifa sin BV', () => {
      const sinCustom = window.BVSim.manualUi.resolveSaldoConfig(null, 50);
      expect(sinCustom.aplicado).toBe(false);
      expect(sinCustom.sinDestino).toBe(true);
      expect(sinCustom.resolver(candidataBV)).toBe(0);

      const customNoBV = window.BVSim.manualUi.resolveSaldoConfig(customSinBV, 50);
      expect(customNoBV.aplicado).toBe(false);
      expect(customNoBV.sinDestino).toBe(true);
      expect(customNoBV.resolver(customSinBV)).toBe(0);
    });

    it('saldo 0, negativo o no numérico: ni aplicado ni aviso', () => {
      [0, -25, NaN, undefined].forEach((saldo) => {
        const cfg = window.BVSim.manualUi.resolveSaldoConfig(customConBV, saldo);
        expect(cfg.aplicado).toBe(false);
        expect(cfg.sinDestino).toBe(false);
        expect(cfg.resolver(customConBV)).toBe(0);
      });
    });
  });

  describe('resolveCosteNeto: métrica secundaria pagado − saldo BV final', () => {
    it('con BV y saldo final: muestra el coste neto como resta exacta', () => {
      const r = window.BVSim.manualUi.resolveCosteNeto({ pagado: 320, bvFinal: 60 }, true);
      expect(r.mostrar).toBe(true);
      expect(r.neto).toBe(260);
      expect(r.aFavor).toBe(false);
      expect(r.importe).toBe(260);
      expect(r.label).toBe('Coste neto si aprovechas el saldo final');
    });

    it('neto negativo: se presenta como saldo a favor con importe positivo', () => {
      const r = window.BVSim.manualUi.resolveCosteNeto({ pagado: 40, bvFinal: 55.5 }, true);
      expect(r.mostrar).toBe(true);
      expect(r.neto).toBe(-15.5);
      expect(r.aFavor).toBe(true);
      expect(r.importe).toBe(15.5);
      expect(r.label).toBe('Saldo a favor tras cubrir el periodo');
    });

    it('sin BV o con saldo final residual no se muestra (sería redundante con pagado)', () => {
      expect(window.BVSim.manualUi.resolveCosteNeto({ pagado: 320, bvFinal: 60 }, false).mostrar).toBe(false);
      expect(window.BVSim.manualUi.resolveCosteNeto({ pagado: 320, bvFinal: 0 }, true).mostrar).toBe(false);
      expect(window.BVSim.manualUi.resolveCosteNeto({ pagado: 320, bvFinal: 0.004 }, true).mostrar).toBe(false);
    });

    it('totales ausentes o no numéricos: no rompe y no se muestra', () => {
      [null, undefined, {}, { pagado: NaN, bvFinal: 'x' }].forEach((totals) => {
        const r = window.BVSim.manualUi.resolveCosteNeto(totals, true);
        expect(r.mostrar).toBe(false);
        expect(r.neto).toBe(0);
        expect(r.aFavor).toBe(false);
      });
    });
  });

  it('inicializa DOMContentLoaded sin usar variables antes de inicializarlas', () => {
    document.body.innerHTML = `
      <div id="toast"><span id="toastText"></span><span id="toastDot"></span></div>
      <input id="bv-file" type="file">
      <button id="upload-csv-btn"></button>
      <span id="file-name"></span>
      <div id="file-selected-msg"></div>
      <button id="remove-file"></button>
      <input id="bv-p1" value="3.45">
      <input id="bv-p2" value="3.45">
      <input id="bv-saldo-inicial" value="0">
      <div class="bv-cs" id="bv-mes-inicio"><button type="button" id="bv-mes-inicio-btn" disabled aria-haspopup="listbox" aria-expanded="false"><span class="bv-cs-value">Orden de la tabla (por defecto)</span></button><ul id="bv-mes-inicio-list"></ul></div>
      <select id="bv-zona-fiscal"><option value="Península" selected>Península</option></select>
      <div id="bv-vivienda-canarias-wrapper"></div>
      <input id="bv-vivienda-canarias" type="checkbox">
      <button id="bv-simulate"><span class="bv-btn-text"></span><span class="spinner"></span></button>
      <div id="bv-results-container"></div>
      <div id="bv-results"></div>
      <div id="bv-status-container"></div>
      <div id="bv-status"></div>
      <div id="bv-manual-grid"></div>
      <div id="bv-data-status"></div>
    `;
    expect(domContentLoadedHandlers).toHaveLength(1);
    expect(() => document.dispatchEvent(new Event('DOMContentLoaded'))).not.toThrow();
    expect(window.BVSim._hourlyTraceControls).toBeTruthy();
  });
});
