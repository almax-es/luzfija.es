/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Contrato del validador de dia civil COMPARTIDO por home (js/pvpc.js), el Observatorio
// (js/pvpc-stats-engine.js, js/pvpc-stats-csv.js) y excedentes (js/lf-surplus-prices.js).
// Antes del 12/08/2026 cada uno tenia su propia implementacion, todas debiles: solo
// comprobaban "cada fila es un par numerico", asi que un dia con un unico punto horario
// pasaba como sano. Este fichero prueba el helper compartido de forma aislada, para que
// los cuatro consumidores no puedan divergir en silencio.
const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-csv-utils.js'), 'utf8');
const win = { LF: {} };
new Function('window', code)(win);
const { validateClosedPvpcDay, validatePvpcDayCoverage, formatYmdInTimeZone } = win.LF.csvUtils;

function fullMadridDay(dateStr, price = 0.1) {
  const baseTs = Date.parse(`${dateStr}T00:00:00+01:00`) / 1000; // invierno, Europe/Madrid
  return Array.from({ length: 24 }, (_, h) => [baseTs + h * 3600, price]);
}

function madridMonthPrefix(ym, lastDay) {
  const days = {};
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    days[date] = fullMadridDay(date);
  }
  return { schema_version: 2, from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}`, days };
}

// Mismos anclajes ya verificados en tests/pvpc.test.js.
function dstSpringForwardDay() {
  // 00:00 local del 29/03/2026 (Europe/Madrid): 23 horas, la 02:00 no existe.
  const baseTs = Date.parse('2026-03-28T23:00:00Z') / 1000;
  return Array.from({ length: 23 }, (_, i) => [baseTs + i * 3600, 0.1]);
}

function dstFallbackDay() {
  // 00:00 local del 27/10/2024 (Europe/Madrid): 25 horas, la 02:00 se repite.
  const baseTs = Date.parse('2024-10-26T22:00:00Z') / 1000;
  return Array.from({ length: 25 }, (_, i) => [baseTs + i * 3600, 0.1]);
}

describe('validatePvpcDayCoverage / validateClosedPvpcDay (js/lf-csv-utils.js)', () => {
  it('acepta un día normal completo de 24 horas contiguas', () => {
    expect(validateClosedPvpcDay('2025-02-28', fullMadridDay('2025-02-28'), 'Europe/Madrid'))
      .toMatchObject({ ok: true, points: 24 });
  });

  it('rechaza un día histórico con un único punto horario (el bug que reportó Codex)', () => {
    const oneHour = [fullMadridDay('2025-02-28')[0]];
    expect(validateClosedPvpcDay('2025-02-28', oneHour, 'Europe/Madrid'))
      .toMatchObject({ ok: false, reason: 'point-count' });
  });

  it('rechaza un día con timestamps duplicados (hueco + duplicado)', () => {
    const day = fullMadridDay('2025-02-28');
    day.splice(4, 1, day[3]); // duplica la hora 3, elimina la hora 4 → hueco de contigüidad
    expect(validateClosedPvpcDay('2025-02-28', day, 'Europe/Madrid'))
      .toMatchObject({ ok: false, reason: 'non-contiguous' });
  });

  it('rechaza un día con una fila cuyo timestamp pertenece a OTRO día', () => {
    const day = fullMadridDay('2025-02-28');
    const otroDia = fullMadridDay('2025-03-01')[0];
    day[12] = otroDia;
    expect(validateClosedPvpcDay('2025-02-28', day, 'Europe/Madrid'))
      .toMatchObject({ ok: false, reason: 'wrong-local-day' });
  });

  it('acepta el día corto de DST (23 horas, cambio de marzo)', () => {
    expect(validateClosedPvpcDay('2026-03-29', dstSpringForwardDay(), 'Europe/Madrid'))
      .toMatchObject({ ok: true, points: 23 });
  });

  it('acepta el día largo de DST (25 horas, cambio de octubre)', () => {
    expect(validateClosedPvpcDay('2024-10-27', dstFallbackDay(), 'Europe/Madrid'))
      .toMatchObject({ ok: true, points: 25 });
  });

  it('validateClosedPvpcDay NUNCA admite parcialidad, ni siquiera con pocas horas válidas', () => {
    const day = fullMadridDay('2025-02-28').slice(0, 5); // 5 horas contiguas desde medianoche
    expect(validateClosedPvpcDay('2025-02-28', day, 'Europe/Madrid'))
      .toMatchObject({ ok: false, reason: 'point-count' });
  });

  it('con allowPartial, un día aún publicándose (pocas horas contiguas desde medianoche) es válido', () => {
    const day = fullMadridDay('2025-02-28').slice(0, 5);
    expect(validatePvpcDayCoverage('2025-02-28', day, 'Europe/Madrid', { allowPartial: true }))
      .toMatchObject({ ok: true, points: 5 });
  });

  it('con allowPartial, sigue exigiendo que empiece en medianoche (no admite huecos al inicio)', () => {
    const day = fullMadridDay('2025-02-28').slice(2, 5); // horas 2,3,4 — falta el arranque
    expect(validatePvpcDayCoverage('2025-02-28', day, 'Europe/Madrid', { allowPartial: true }))
      .toMatchObject({ ok: false, reason: 'missing-first-hour' });
  });

  it('con allowPartial, nunca acepta MÁS puntos de los que caben en el día civil', () => {
    // 26 puntos: por encima del maximo absoluto (25, el dia DST mas largo posible). La
    // comprobacion de cardinalidad va ANTES que cualquier otra, asi que basta con superar
    // el limite para que se rechace, sin importar si el contenido seria valido o no.
    const day = fullMadridDay('2025-02-28');
    day.push([day[day.length - 1][0] + 3600, 0.1]);
    day.push([day[day.length - 1][0] + 3600, 0.1]);
    expect(validatePvpcDayCoverage('2025-02-28', day, 'Europe/Madrid', { allowPartial: true }))
      .toMatchObject({ ok: false, reason: 'point-count' });
  });

  it('formatYmdInTimeZone usa la zona del dataset, no la del runtime', () => {
    // 2026-08-12T23:30 UTC es ya 2026-08-13 en Atlantic/Canary (UTC+1 en verano) pero
    // sigue siendo 2026-08-12 en la UTC pura: confirma que se respeta la zona pedida.
    const ts = Date.parse('2026-08-12T23:30:00Z') / 1000;
    expect(formatYmdInTimeZone(ts, 'Atlantic/Canary')).toBe('2026-08-13');
    expect(formatYmdInTimeZone(ts, 'UTC')).toBe('2026-08-12');
  });

  it('rechaza un mes versionado truncado aunque su único día presente sea perfecto', () => {
    const { validatePvpcMonthCoverage } = win.LF.csvUtils;
    const result = validatePvpcMonthCoverage({
      schema_version: 2,
      from: '2025-01-01',
      to: '2025-01-01',
      days: { '2025-01-01': fullMadridDay('2025-01-01') }
    }, '2025-01', 'Europe/Madrid', { todayLocal: '2026-08-13' });
    expect(result).toMatchObject({ ok: false, reason: 'incomplete-month' });
  });

  it.each([undefined, 1, '2'])('rechaza el esquema mensual no v2: %j', (schemaVersion) => {
    const { validatePvpcMonthCoverage } = win.LF.csvUtils;
    const data = {
      from: '2025-01-01', to: '2025-01-31',
      days: { '2025-01-01': fullMadridDay('2025-01-01') }
    };
    if (schemaVersion !== undefined) data.schema_version = schemaVersion;
    expect(validatePvpcMonthCoverage(data, '2025-01', 'Europe/Madrid', { todayLocal: '2026-08-13' }))
      .toMatchObject({ ok: false, reason: 'unsupported-schema' });
  });

  it('rechaza un mes vigente integro pero demasiado antiguo segun la tolerancia del consumidor', () => {
    const { validatePvpcMonthCoverage } = win.LF.csvUtils;
    expect(validatePvpcMonthCoverage(
      madridMonthPrefix('2025-01', 10), '2025-01', 'Europe/Madrid',
      { todayLocal: '2025-01-13', freshnessDays: 1 }
    )).toMatchObject({ ok: false, reason: 'stale-month' });
    expect(validatePvpcMonthCoverage(
      madridMonthPrefix('2025-01', 11), '2025-01', 'Europe/Madrid',
      { todayLocal: '2025-01-13', freshnessDays: 2 }
    )).toMatchObject({ ok: true });
  });
});
