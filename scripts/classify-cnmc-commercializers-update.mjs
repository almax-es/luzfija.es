import { appendFile, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCensusSane } from './sync-cnmc-commercializers.mjs';

const SOURCE_URL = 'https://sede.cnmc.gob.es/listado/censo/2';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const TYPICAL_ADDITIONS_BATCH = 20;
const REVIEWED_META_LISTS = ['duplicateCodes', 'invalidWebsiteCodes', 'inactiveCodes'];

function payloadToParsed(payload) {
  return {
    commercializers: payload?.commercializers,
    sourceRows: payload?._meta?.sourceRows,
    duplicateCodes: payload?._meta?.duplicateCodes,
    invalidWebsiteCodes: payload?._meta?.invalidWebsiteCodes,
    inactiveCodes: payload?._meta?.inactiveCodes
  };
}

export function assertCensusPayloadSane(payload) {
  if (payload?._meta?.schema !== 1 || payload?._meta?.source !== SOURCE_URL) {
    throw new Error('El censo versionado no conserva su esquema o fuente CNMC');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload._meta.syncedAt ?? ''))) {
    throw new Error('El censo versionado no contiene una fecha de sincronización válida');
  }
  const result = assertCensusSane(payloadToParsed(payload));
  if (payload._meta.count !== result.count) {
    throw new Error('El recuento _meta.count no coincide con las comercializadoras');
  }
  return result;
}

function sortedCodes(codes) {
  return [...codes].sort((a, b) => a.localeCompare(b, 'es'));
}

function changedMetaLists(previous, next) {
  return REVIEWED_META_LISTS.filter(key => !isDeepStrictEqual(previous._meta[key], next._meta[key]));
}

export function classifyCnmcCommercializersUpdate(previous, next, options = {}) {
  assertCensusPayloadSane(previous);
  assertCensusPayloadSane(next);

  const additionsBatch = options.additionsBatch ?? TYPICAL_ADDITIONS_BATCH;
  const previousCodes = new Set(Object.keys(previous.commercializers));
  const nextCodes = new Set(Object.keys(next.commercializers));
  const addedCodes = sortedCodes([...nextCodes].filter(code => !previousCodes.has(code)));
  const removedCodes = sortedCodes([...previousCodes].filter(code => !nextCodes.has(code)));
  const modifiedCodes = sortedCodes(
    [...previousCodes].filter(code => nextCodes.has(code)
      && !isDeepStrictEqual(previous.commercializers[code], next.commercializers[code]))
  );
  const changedMeta = changedMetaLists(previous, next);
  const sourceRowsDelta = next._meta.sourceRows - previous._meta.sourceRows;

  if (!addedCodes.length && !removedCodes.length && !modifiedCodes.length
      && !changedMeta.length && sourceRowsDelta === 0) {
    return {
      status: 'unchanged',
      summary: 'Sin cambios materiales en el censo CNMC.',
      addedCodes,
      removedCodes,
      modifiedCodes,
      changedMeta
    };
  }

  // Desde el 03/09/2026 esto DESCRIBE el diff, no decide si se publica: la Action
  // funciona como espejo del censo CNMC y su salida solo alimenta el resumen del
  // run y el mensaje de commit. Por eso los estados se llaman por lo que son
  // —`simple_additive` / `complex_change`— y no por una acción que ya nadie toma:
  // `additionsBatch` señala un lote grande, no lo frena. Lo único que puede detener
  // la publicación es un fallo propio (assertCensusPayloadSane, o los tests).
  const changeNotes = [];
  if (removedCodes.length) changeNotes.push(`${removedCodes.length} bajas o códigos eliminados`);
  if (modifiedCodes.length) changeNotes.push(`${modifiedCodes.length} entradas existentes modificadas`);
  if (changedMeta.length) changeNotes.push(`metadatos modificados: ${changedMeta.join(', ')}`);
  if (addedCodes.length > additionsBatch) {
    changeNotes.push(`${addedCodes.length} altas, por encima del lote habitual de ${additionsBatch}`);
  }
  if (sourceRowsDelta !== addedCodes.length) {
    changeNotes.push(`la variación de filas (${sourceRowsDelta}) no coincide con las altas (${addedCodes.length})`);
  }
  if (!addedCodes.length) changeNotes.push('sin altas nuevas');

  if (changeNotes.length) {
    return {
      status: 'complex_change',
      summary: `Cambios más allá de altas simples: ${changeNotes.join('; ')}.`,
      addedCodes,
      removedCodes,
      modifiedCodes,
      changedMeta
    };
  }

  return {
    status: 'simple_additive',
    summary: `${addedCodes.length} altas nuevas sin modificar entradas existentes.`,
    addedCodes,
    removedCodes,
    modifiedCodes,
    changedMeta
  };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function runCli() {
  const beforePath = readArgument('--before');
  const afterPath = readArgument('--after');
  const githubOutput = readArgument('--github-output');
  if (!beforePath || !afterPath) {
    throw new Error('Uso: --before <json> --after <json> [--github-output <fichero>]');
  }

  const previous = JSON.parse(await readFile(resolve(beforePath), 'utf8'));
  const next = JSON.parse(await readFile(resolve(afterPath), 'utf8'));
  const result = classifyCnmcCommercializersUpdate(previous, next);
  console.log(result.summary);
  console.log(JSON.stringify(result, null, 2));

  if (githubOutput) {
    const lines = [
      `status=${result.status}`,
      `summary=${result.summary}`,
      `added_count=${result.addedCodes.length}`,
      `added_codes=${result.addedCodes.join(',')}`,
      `removed_codes=${result.removedCodes.join(',')}`,
      `modified_codes=${result.modifiedCodes.join(',')}`
    ];
    await appendFile(githubOutput, `${lines.join('\n')}\n`, 'utf8');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await runCli();
}
