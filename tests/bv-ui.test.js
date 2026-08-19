import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../js/lf-csv-utils.js';

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
    window.LF.assessConsumoAnualLimits = (tarifas) => ({
      compatibles: Array.isArray(tarifas) ? tarifas : [],
      excluidas: []
    });

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

  const totalsOf = (over) => Object.assign(
    { pagado: 10, real: 10, bvFinal: 2, credit1Total: 0, credit2Total: 0 },
    over
  );

  it('separa resultados con totales no finitos para que no entren al ranking', () => {
    const valid = { tarifa: { nombre: 'Correcta' }, totals: totalsOf() };
    const customInvalid = { tarifa: { nombre: 'Mi tarifa ⭐' }, totals: totalsOf({ pagado: NaN }) };
    const infinite = { tarifa: { nombre: 'Infinita' }, totals: totalsOf({ bvFinal: Infinity }) };
    const sinTotals = { tarifa: { nombre: 'Sin totales' } };
    const creditRoto = { tarifa: { nombre: 'Credito roto' }, totals: totalsOf({ credit2Total: NaN }) };

    const result = window.BVSim.manualUi.partitionRankableResults(
      [valid, customInvalid, infinite, sinTotals, creditRoto]
    );

    expect(result.rankable).toEqual([valid]);
    expect(result.invalid).toEqual([customInvalid, infinite, sinTotals, creditRoto]);
  });

  it('una propiedad descriptiva en totals no invalida la tarifa', () => {
    // Con la comprobacion generica sobre Object.values(totals), añadir a totals un campo no
    // numerico habria mandado TODAS las tarifas a invalid y el ranking habria desaparecido
    // entero. El saneado mira solo los campos numericos del contrato.
    const conEtiqueta = {
      tarifa: { nombre: 'Con etiqueta' },
      totals: totalsOf({ etiqueta: 'texto informativo', esParcial: false })
    };

    const result = window.BVSim.manualUi.partitionRankableResults([conEtiqueta]);

    expect(result.rankable).toEqual([conEtiqueta]);
    expect(result.invalid).toEqual([]);
  });

  it('solo considera cambio horario el eje Ceuta/Melilla frente a Península o Canarias', () => {
    const normalizeZona = window.LF.csvUtils.normalizeZonaFiscal;

    expect(window.BVSim.manualUi.changesSchedulingZone('Península', 'Canarias', normalizeZona)).toBe(false);
    expect(window.BVSim.manualUi.changesSchedulingZone('Península', 'Ceuta-Melilla', normalizeZona)).toBe(true);
    expect(window.BVSim.manualUi.changesSchedulingZone('Ceuta Melilla', 'Canarias', normalizeZona)).toBe(true);
  });

  it('bloquea el cálculo si el reparto de la tabla es de otra zona horaria', () => {
    const normalizeZona = window.LF.csvUtils.normalizeZonaFiscal;
    const mismatch = (state, zona) => window.BVSim.manualUi.getManualGridZoneMismatchError(
      state, zona, normalizeZona
    );

    // Editada a mano: no se puede rehacer sin pisar el trabajo del usuario.
    expect(mismatch({ zonaFiscal: 'Península', dirty: true, result: {} }, 'CeutaMelilla'))
      .toContain('has editado la tabla a mano');

    // Sin fichero en memoria (caso tipico: recarga de pagina). Este era el hueco: antes solo
    // se miraba `dirty`, asi que tras recargar no se recalculaba NI se bloqueaba.
    expect(mismatch({ zonaFiscal: 'Península', dirty: false, result: null }, 'CeutaMelilla'))
      .toContain('no se ha podido rehacer el reparto');

    // Ambos mensajes tienen que ofrecer las dos salidas reales.
    ['Península'].forEach(() => {
      const msg = mismatch({ zonaFiscal: 'Península', dirty: false, result: null }, 'CeutaMelilla');
      expect(msg).toContain('importar');
      expect(msg).toContain('selecciona de nuevo la zona');
    });

    // Sin cruzar el eje horario no pasa nada: Península y Canarias comparten horario CNMC.
    expect(mismatch({ zonaFiscal: 'Canarias', dirty: true, result: null }, 'Península')).toBe('');

    // Sin procedencia conocida (tabla rellenada a mano desde cero) no hay nada que proteger:
    // los periodos los tecleo el usuario y no dependen de ninguna zona.
    expect(mismatch({ zonaFiscal: null, dirty: true, result: null }, 'CeutaMelilla')).toBe('');
  });

  it('falla CERRADO si falta el normalizador canónico de zona', () => {
    // Carga parcial de la pagina: sin lf-csv-utils no se puede decidir si la zona nueva cruza
    // el eje horario. Devolver '' desactivaria la proteccion en silencio.
    const sinNormalizador = window.BVSim.manualUi.getManualGridZoneMismatchError(
      { zonaFiscal: 'Península', dirty: false, result: null }, 'CeutaMelilla', undefined
    );

    expect(sinNormalizador).toContain('no cargó completa');

    // Pero sin procedencia conocida sigue sin haber nada que bloquear.
    expect(window.BVSim.manualUi.getManualGridZoneMismatchError(
      { zonaFiscal: null, dirty: false, result: null }, 'CeutaMelilla', undefined
    )).toBe('');
  });

  it('aceptar el ajuste manual reapunta la procedencia y descarta el fichero', () => {
    const state = { result: { records: [{}] }, zonaFiscal: 'Península', dirty: true };

    expect(window.BVSim.manualUi.acceptManualZoneAdjustment(state, 'CeutaMelilla')).toBe(true);

    expect(state.zonaFiscal).toBe('CeutaMelilla');
    // El fichero ya no describe la tabla: no puede volver a usarse para recalcular repartos.
    expect(state.result).toBeNull();
    expect(window.BVSim.manualUi.getManualGridZoneMismatchError(
      state, 'CeutaMelilla', window.LF.csvUtils.normalizeZonaFiscal
    )).toBe('');
  });

  it('limpia toda la procedencia de la importación al resetear el grid', () => {
    const state = { result: { records: [{}] }, zonaFiscal: 'Península', dirty: true };

    window.BVSim.manualUi.clearGridImportState(state);

    expect(state).toEqual({ result: null, zonaFiscal: null, dirty: false });
  });

  it('limpia la procedencia solo en los resets que sustituyen o vacian el grid', () => {
    // Dos: loadManualData (que ademas restaura la zona persistida) y "borrar todos". La
    // restauracion de respaldo JSON pasa por loadManualData, asi que limpiar alli otra vez
    // borraria la zona recien recuperada del respaldo.
    expect(uiCode.match(/clearGridImportState\(manualGridImportState\)/g)).toHaveLength(2);

    // "Quitar archivo" NO es un reset del grid: retira la seleccion de fichero pero deja los
    // P1/P2/P3 en pantalla y en localStorage. Limpiar ahi la procedencia dejaba el reparto de
    // la zona antigua sin recalculo ni bloqueo, y se calculaba con horario de una zona y
    // fiscalidad de otra. Cobertura funcional del ciclo completo en bv-ui-zona-grid.test.js.
    const start = uiCode.indexOf('removeFileBtn.addEventListener');
    const end = uiCode.indexOf('simulateButton.addEventListener', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(uiCode.slice(start, end)).not.toContain('clearGridImportState(');
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

  it('solo considera anual la cobertura real de al menos 365 días, no doce meses al 80 %', () => {
    const annual = Array.from({ length: 12 }, (_, i) => {
      const daysInMonth = new Date(2026, i + 1, 0).getDate();
      return {
        key: `2026-${String(i + 1).padStart(2, '0')}`,
        daysWithData: daysInMonth
      };
    });
    const partial = annual.map((month) => ({
      ...month,
      daysWithData: Math.ceil(new Date(2026, Number(month.key.slice(-2)), 0).getDate() * 0.8)
    }));

    expect(window.BVSim.manualUi.hasFullAnnualConsumptionCoverage(partial)).toBe(false);
    expect(window.BVSim.manualUi.hasFullAnnualConsumptionCoverage(annual)).toBe(true);
    expect(window.BVSim.manualUi.hasFullAnnualConsumptionCoverage(annual.map((month) => ({ ...month, key: '2026-01' })))).toBe(false);
    expect(window.BVSim.manualUi.hasFullAnnualConsumptionCoverage(annual.map((month, index) => (
      index === 11 ? { ...month, key: '2027-02' } : month
    )))).toBe(false);
  });

  it('suma los días reales para proyectar sin duplicar un mismo mes', () => {
    expect(window.BVSim.manualUi.getConsumptionCoverageDays([
      { key: '2026-01', daysWithData: 10 },
      { key: '2026-01', daysWithData: 20 },
      { key: '2026-02', daysWithData: 40 },
      { key: 'sin-fecha', daysWithData: 31 }
    ])).toBe(48);
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

  // Contrato deliberado (SIMULADOR-BV.md, 13/08/2026). NO REABRIR.
  //
  // La tabla del simulador son 12 casillas enero-diciembre: un PATRON de consumo y produccion de
  // la vivienda, no un historico fechado. Elegir "empiezo en abril" pide recorrer ese mismo patron
  // en otro orden (abr..dic, ene..mar) con las cantidades de la tabla; no pide predecir marzo del
  // año siguiente. Por eso marzo sigue siendo marzo y conserva su clave YYYY-MM.
  //
  // Rechazado 16/08/2026 (auditoria Codex, hallazgo "fiscalKey"): proyectar enero-mayo al año
  // siguiente obligaria a SSAA a caer al fallback del ultimo mes completo publicado, con dos
  // consecuencias medidas: (a) sustituye cinco tarifas reales publicadas (recorrido 0,01329
  // EUR/kWh) por una unica constante, y (b) el mismo escenario guardado o compartido cambiaria de
  // importe cada vez que se publica un mes nuevo — hasta 23,43 EUR de oscilacion, casi el triple
  // del error de 8,26 EUR que decia corregir.
  it('rotateMonthsByStart conserva el año original de los meses que pasan detras de diciembre', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      key: `2026-${String(i + 1).padStart(2, '0')}`
    }));

    const rotated = window.BVSim.manualUi.rotateMonthsByStart(months, '2026-06');

    expect(rotated.map((month) => month.key)).toEqual([
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'
    ]);
    expect(rotated.every((month) => month.fiscalKey === undefined)).toBe(true);
  });

  it('resolveMonthStartKey conserva el mes de inicio al cambiar el año de una tabla manual', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      key: `2027-${String(i + 1).padStart(2, '0')}`
    }));

    expect(window.BVSim.manualUi.resolveMonthStartKey(months, '2026-06')).toBe('2027-06');
    expect(window.BVSim.manualUi.resolveMonthStartKey(months, '2027-08')).toBe('2027-08');
  });

  it('resolveMonthStartKey falla cerrado si el mismo mes existe en dos años', () => {
    expect(window.BVSim.manualUi.resolveMonthStartKey([
      { key: '2026-06' },
      { key: '2027-06' }
    ], '2025-06')).toBe('');
  });

  it('compareRankedResultsByPaid no trata una diferencia real de 0,01 EUR como empate', () => {
    const masCara = { totals: { pagado: 145.23, bvFinal: 999 } };
    const masBarata = { totals: { pagado: 145.22, bvFinal: 0 } };

    const ranked = [masCara, masBarata].sort(window.BVSim.manualUi.compareRankedResultsByPaid);

    expect(ranked).toEqual([masBarata, masCara]);
  });

  it('compareRankedResultsByPaid desempata por mayor saldo BV solo si pagado es exactamente igual', () => {
    const saldoBajo = { totals: { pagado: 145.22, bvFinal: 5 } };
    const saldoAlto = { totals: { pagado: 145.22, bvFinal: 20 } };

    const ranked = [saldoBajo, saldoAlto].sort(window.BVSim.manualUi.compareRankedResultsByPaid);

    expect(ranked).toEqual([saldoAlto, saldoBajo]);
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

  it('invalida la traza DST al cambiar entre Canarias y una zona Europe/Madrid', () => {
    const { setFromImport, retargetZone, canUse, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 2, 29), hora: 3, excedente: 2 }],
      meta: { hasExcedenteColumn: true }
    }, 'Canarias');

    expect(retargetZone('CeutaMelilla')).toBe(false);
    expect(window.BVSim._hourlyTraceState.dirty).toBe(true);
    expect(window.BVSim._hourlyTraceState.reason).toBe('zone-hour-shift');
    expect(canUse('CeutaMelilla')).toBe(false);
    expect(buildIndexedFallbackMsg(true, 'reference', 'CeutaMelilla'))
      .toContain('Reimporta el CSV con la zona correcta');
  });

  it('conserva la traza al cruzar Canarias si el CSV no contiene un cambio DST', () => {
    const { setFromImport, retargetZone, canUse } = window.BVSim._hourlyTraceControls;
    const records = [{ fecha: new Date(2026, 5, 2), hora: 12, excedente: 2 }];

    setFromImport({
      ok: true,
      records,
      meta: { hasExcedenteColumn: true }
    }, 'Canarias');

    expect(retargetZone('CeutaMelilla')).toBe(true);
    expect(window.BVSim._hourlyTraceState.records).toBe(records);
    expect(window.BVSim._hourlyTraceState.dirty).toBe(false);
    expect(canUse('CeutaMelilla')).toBe(true);
  });

  // Eje Peninsula<->Canarias: comparte horario de periodos pero NO reloj. Es el caso comun y
  // el que quedaba sin procesar cuando el retarget vivia dentro del bloque de
  // `changesSchedulingZone`, que solo detecta el cruce de Ceuta/Melilla.
  it('invalida la traza al pasar de Península a Canarias si el CSV contiene un cambio DST', () => {
    const { setFromImport, retargetZone, canUse, buildIndexedFallbackMsg } = window.BVSim._hourlyTraceControls;

    setFromImport({
      ok: true,
      records: [{ fecha: new Date(2026, 2, 29), hora: 3, excedente: 2 }],
      meta: { hasExcedenteColumn: true }
    }, 'Península');

    expect(retargetZone('Canarias')).toBe(false);
    expect(window.BVSim._hourlyTraceState.dirty).toBe(true);
    expect(window.BVSim._hourlyTraceState.reason).toBe('zone-hour-shift');
    expect(canUse('Canarias')).toBe(false);
    expect(buildIndexedFallbackMsg(true, 'reference', 'Canarias'))
      .toContain('Reimporta el CSV con la zona correcta');
  });

  it('conserva la traza de Península a Canarias si el CSV no contiene un cambio DST', () => {
    const { setFromImport, retargetZone, canUse } = window.BVSim._hourlyTraceControls;
    const records = [{ fecha: new Date(2026, 5, 2), hora: 12, excedente: 2 }];

    setFromImport({ ok: true, records, meta: { hasExcedenteColumn: true } }, 'Península');

    expect(retargetZone('Canarias')).toBe(true);
    expect(window.BVSim._hourlyTraceState.records).toBe(records);
    expect(window.BVSim._hourlyTraceState.dirty).toBe(false);
    expect(window.BVSim._hourlyTraceState.zonaFiscal).toBe('Canarias');
    // Sin este re-apuntado la traza se quedaba clavada en la zona de importacion y
    // `canUse` la descartaba, cayendo a precio de referencia sin motivo real.
    expect(canUse('Canarias')).toBe(true);
  });

  it('el cambio de zona procesa la traza FUERA del bloque de cambio de reparto', () => {
    // El recalculo de la tabla P1/P2/P3 sigue condicionado al eje Ceuta/Melilla, pero la traza
    // horaria debe procesarse en cualquier cambio de zona. Si esta llamada vuelve a caer dentro
    // del `if (changesSchedule ...)`, Peninsula<->Canarias deja de re-apuntarse.
    const handler = uiCode.slice(uiCode.indexOf('zonaFiscalInput.addEventListener'));
    const bloque = handler.slice(0, handler.indexOf('saveManualData();'));

    expect(bloque).toMatch(
      /showToast\('✓ Reparto P1\/P2\/P3[^\n]*\n\s*\}\n[\s\S]{0,1200}?retargetHourlyTraceZone\(zonaFiscalInput\.value\);\s*$/
    );
    expect(bloque.match(/retargetHourlyTraceZone\(/g)).toHaveLength(1);
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
    window.BVSim.loadTarifasBV = vi.fn();
    window.BVSim.simulateForAllTarifasBV = vi.fn();
    window.BVSim.simulateMonthly = vi.fn();
    expect(domContentLoadedHandlers).toHaveLength(1);
    expect(() => document.dispatchEvent(new Event('DOMContentLoaded'))).not.toThrow();
    expect(window.BVSim._hourlyTraceControls).toBeTruthy();

    const monthSelector = document.getElementById('bv-mes-inicio');
    expect(monthSelector.hasAttribute('aria-disabled')).toBe(false);
    expect(monthSelector.hasAttribute('aria-expanded')).toBe(false);
    expect(document.getElementById('bv-mes-inicio-btn').getAttribute('aria-expanded')).toBe('false');

    const manualInputs = Array.from(document.querySelectorAll('#bv-manual-grid .manual-input'));
    const accessibleNames = manualInputs.map((input) => input.getAttribute('aria-label'));
    expect(manualInputs).toHaveLength(48);
    expect(new Set(accessibleNames)).toHaveLength(48);
    expect(accessibleNames.every((name) => name && name.includes('(kWh)'))).toBe(true);
    expect(accessibleNames).toContain('Enero: consumo en punta (kWh)');
    expect(accessibleNames).toContain('Diciembre: excedentes vertidos a la red (kWh)');
  });
});
