import { appendFile, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCensusSane } from './sync-cnmc-commercializers.mjs';

const SOURCE_URL = 'https://sede.cnmc.gob.es/listado/censo/2';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const MAX_AUTOMATIC_ADDITIONS = 20;
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

  const maxAdditions = options.maxAdditions ?? MAX_AUTOMATIC_ADDITIONS;
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

  const reviewReasons = [];
  if (removedCodes.length) reviewReasons.push(`${removedCodes.length} bajas o códigos eliminados`);
  if (modifiedCodes.length) reviewReasons.push(`${modifiedCodes.length} entradas existentes modificadas`);
  if (changedMeta.length) reviewReasons.push(`metadatos sensibles modificados: ${changedMeta.join(', ')}`);
  if (addedCodes.length > maxAdditions) {
    reviewReasons.push(`${addedCodes.length} altas superan el límite automático de ${maxAdditions}`);
  }
  if (sourceRowsDelta !== addedCodes.length) {
    reviewReasons.push(`la variación de filas (${sourceRowsDelta}) no coincide con las altas (${addedCodes.length})`);
  }
  if (!addedCodes.length) reviewReasons.push('no es una actualización puramente aditiva');

  if (reviewReasons.length) {
    return {
      status: 'manual_review',
      summary: `Revisión manual necesaria: ${reviewReasons.join('; ')}.`,
      addedCodes,
      removedCodes,
      modifiedCodes,
      changedMeta
    };
  }

  return {
    status: 'safe_additive',
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
