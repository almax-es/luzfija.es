import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  MAX_AUTOMATIC_ADDITIONS,
  assertCensusPayloadSane,
  classifyCnmcCommercializersUpdate
} from '../scripts/classify-cnmc-commercializers-update.mjs';

const registry = JSON.parse(fs.readFileSync('data/cnmc-commercializers.json', 'utf8'));

function cloneRegistry() {
  return structuredClone(registry);
}

function addCommercializer(payload, code, entry = { name: `EMPRESA ${code}` }) {
  payload.commercializers[code] = entry;
  payload._meta.count += 1;
  payload._meta.sourceRows += 1;
}

describe('Clasificación de actualizaciones del censo CNMC', () => {
  it('considera sin cambios una sincronización que solo renueva la fecha', () => {
    const next = cloneRegistry();
    next._meta.syncedAt = '2099-01-01';
    expect(classifyCnmcCommercializersUpdate(registry, next)).toMatchObject({
      status: 'unchanged',
      addedCodes: []
    });
  });

  it('autoriza únicamente un lote aditivo pequeño', () => {
    const next = cloneRegistry();
    addCommercializer(next, 'R2-9999', {
      name: 'EMPRESA NUEVA, S.L.',
      phone: '900 111 222',
      website: 'https://nueva.example/'
    });
    expect(classifyCnmcCommercializersUpdate(registry, next)).toMatchObject({
      status: 'safe_additive',
      addedCodes: ['R2-9999'],
      removedCodes: [],
      modifiedCodes: []
    });
  });

  it.each([
    ['renombrado', (next) => { next.commercializers['R2-796'].name = 'BON PREU RENOMBRADA'; }],
    ['baja', (next) => { next._meta.inactiveCodes.push('R2-796'); }],
    ['web inválida nueva', (next) => { next._meta.invalidWebsiteCodes.push('R2-796'); }],
    ['eliminación', (next) => {
      const removableCode = Object.keys(next.commercializers)
        .find(code => !['R2-796', 'R2-1000'].includes(code));
      delete next.commercializers[removableCode];
      next._meta.count -= 1;
      next._meta.sourceRows -= 1;
      next._meta.inactiveCodes = next._meta.inactiveCodes.filter(code => code !== removableCode);
      next._meta.invalidWebsiteCodes = next._meta.invalidWebsiteCodes.filter(code => code !== removableCode);
    }]
  ])('exige revisión manual ante %s', (_label, mutate) => {
    const next = cloneRegistry();
    addCommercializer(next, 'R2-9999');
    mutate(next);
    expect(classifyCnmcCommercializersUpdate(registry, next).status).toBe('manual_review');
  });

  it('exige revisión manual cuando las altas superan el umbral', () => {
    const next = cloneRegistry();
    for (let index = 0; index <= MAX_AUTOMATIC_ADDITIONS; index += 1) {
      addCommercializer(next, `R2-${9000 + index}`);
    }
    expect(classifyCnmcCommercializersUpdate(registry, next)).toMatchObject({
      status: 'manual_review'
    });
  });

  it('falla cerrado si los metadatos no cuadran con el contenido', () => {
    const next = cloneRegistry();
    next._meta.count -= 1;
    expect(() => assertCensusPayloadSane(next)).toThrow(/_meta.count/);
  });

  it('exige revisión si el incremento de filas no coincide con las altas', () => {
    const next = cloneRegistry();
    addCommercializer(next, 'R2-9999');
    next._meta.sourceRows += 1;
    expect(classifyCnmcCommercializersUpdate(registry, next).status).toBe('manual_review');
  });

  it('no deja que una baja quede compensada por una fila duplicada nueva', () => {
    const next = cloneRegistry();
    addCommercializer(next, 'R2-9999');
    const protectedCodes = new Set([
      'R2-796',
      'R2-1000',
      ...next._meta.duplicateCodes,
      ...next._meta.invalidWebsiteCodes,
      ...next._meta.inactiveCodes
    ]);
    const removedCode = Object.keys(next.commercializers).find(code => !protectedCodes.has(code));
    delete next.commercializers[removedCode];
    next._meta.count -= 1;

    // El alta suma una fila, la baja resta otra y una segunda fila para un código
    // ya duplicado vuelve a sumarla. La variación final de sourceRows coincide con
    // las altas aunque exista una eliminación real.
    expect(next._meta.sourceRows - registry._meta.sourceRows).toBe(1);
    expect(classifyCnmcCommercializersUpdate(registry, next)).toMatchObject({
      status: 'manual_review',
      removedCodes: [removedCode]
    });
  });
});
