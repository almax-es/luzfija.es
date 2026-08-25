import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SOURCE_URL = 'https://sede.cnmc.gob.es/listado/censo/2';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), '..');
const OUTPUT = resolve(ROOT, 'data', 'cnmc-commercializers.json');
const R2_CODE = /^R2-\d{3,4}$/;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeWebsite(anchor) {
  if (!anchor) return null;
  try {
    // El censo contiene al menos un href con NBSP tras "http://". Los
    // espacios no son significativos en un hostname y JSDOM no los corrige.
    const rawHref = String(anchor.getAttribute('href') ?? '').replace(/\s+/g, '');
    const url = new URL(rawHref);
    return /^https?:$/.test(url.protocol) && url.hostname ? url.href : null;
  } catch (_) {
    return null;
  }
}

function findColumn(headers, predicate, label) {
  const matches = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => predicate(header));
  if (matches.length !== 1) {
    throw new Error(`No se pudo identificar de forma unívoca la columna "${label}" del censo CNMC`);
  }
  return matches[0].index;
}

function findRegistryTable(document) {
  for (const table of document.querySelectorAll('table')) {
    const headerRow = [...table.querySelectorAll('tr')]
      .find(row => row.querySelectorAll('th').length > 0);
    if (!headerRow) continue;
    const headers = [...headerRow.querySelectorAll('th')].map(cell => normalizeHeader(cell.textContent));
    if (headers.some(header => header.includes('orden')) && headers.includes('nombre empresa')) {
      return { table, headers };
    }
  }
  throw new Error('No se encontró la tabla esperada del censo CNMC');
}

function validatePhone(phone, code) {
  if (!phone) return;
  const digitCount = (phone.match(/\d/g) || []).length;
  if (digitCount < 6 || phone.length > 160) {
    throw new Error(`Fila ${code} con teléfono inesperado`);
  }
}

export function parseCnmcCommercializers(html) {
  const document = new JSDOM(html).window.document;
  const { table, headers } = findRegistryTable(document);
  const columns = {
    code: findColumn(headers, header => header.includes('orden'), 'Nº de orden'),
    name: findColumn(headers, header => header === 'nombre empresa', 'Nombre empresa'),
    phone: findColumn(
      headers,
      header => header.includes('telefono') && header.includes('cliente'),
      'Teléfono de atención al cliente'
    ),
    website: findColumn(headers, header => header === 'pagina web', 'Página web'),
    status: findColumn(headers, header => header === 'estado', 'Estado')
  };
  const maxColumn = Math.max(...Object.values(columns));
  const rejectedCodes = [];
  const invalidWebsiteCodes = [];
  const rowsByCode = new Map();

  for (const row of table.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('td')];
    if (!cells.length) continue;
    const code = clean(cells[columns.code]?.textContent).toUpperCase();
    if (!code.startsWith('R2-')) continue;
    if (!R2_CODE.test(code)) {
      rejectedCodes.push(code);
      continue;
    }
    if (cells.length <= maxColumn) throw new Error(`Fila ${code} incompleta`);

    const name = clean(cells[columns.name].textContent);
    if (!name || name.length > 240) throw new Error(`Fila ${code} sin razón social válida`);
    const phone = clean(cells[columns.phone].textContent);
    validatePhone(phone, code);
    const websiteCell = cells[columns.website];
    const websiteAnchor = websiteCell.querySelector('a');
    const website = safeWebsite(websiteAnchor);
    const websiteHref = clean(websiteAnchor?.getAttribute('href'));
    const websiteDeclared = Boolean(
      clean(websiteCell.textContent)
      || (websiteHref && !/^https?:\/{0,2}$/i.test(websiteHref))
    );
    if (websiteDeclared && !website) invalidWebsiteCodes.push(code);

    const entry = { name };
    if (phone) entry.phone = phone;
    if (website) entry.website = website;
    const parsedRow = {
      entry,
      inactive: normalizeHeader(cells[columns.status].textContent) === 'baja'
    };
    const existing = rowsByCode.get(code) || [];
    existing.push(parsedRow);
    rowsByCode.set(code, existing);
  }

  if (rejectedCodes.length) {
    throw new Error(`El censo contiene códigos R2 no reconocidos: ${[...new Set(rejectedCodes)].join(', ')}`);
  }
  const uniqueInvalidWebsiteCodes = [...new Set(invalidWebsiteCodes)].sort();
  if (uniqueInvalidWebsiteCodes.length > Math.max(5, Math.ceil(rowsByCode.size * 0.02))) {
    throw new Error(`El censo contiene demasiadas webs inválidas: ${uniqueInvalidWebsiteCodes.length}`);
  }

  const commercializers = {};
  const duplicateCodes = [];
  let sourceRows = 0;
  for (const [code, rows] of rowsByCode) {
    sourceRows += rows.length;
    let selected = rows[0];
    if (rows.length > 1) {
      duplicateCodes.push(code);
      const activeRows = rows.filter(row => !row.inactive);
      if (activeRows.length !== 1) {
        throw new Error(`El censo contiene un duplicado ambiguo para ${code}`);
      }
      selected = activeRows[0];
    }
    commercializers[code] = selected.entry;
  }

  const sorted = Object.fromEntries(
    Object.entries(commercializers).sort(([a], [b]) => a.localeCompare(b, 'es'))
  );
  return {
    commercializers: sorted,
    sourceRows,
    duplicateCodes: duplicateCodes.sort(),
    invalidWebsiteCodes: uniqueInvalidWebsiteCodes
  };
}

function responseDate(response) {
  const headerDate = response.headers.get('date');
  const date = headerDate ? new Date(headerDate) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

export async function syncCnmcCommercializers() {
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'LuzFija.es CNMC registry sync' }
  });
  if (!response.ok) throw new Error(`CNMC respondió ${response.status}`);

  const parsed = parseCnmcCommercializers(await response.text());
  const count = Object.keys(parsed.commercializers).length;
  const fourDigitCount = Object.keys(parsed.commercializers).filter(code => /^R2-\d{4}$/.test(code)).length;
  if (count < 500 || fourDigitCount === 0 || !parsed.commercializers['R2-796']) {
    throw new Error('El censo descargado no supera las comprobaciones mínimas');
  }

  const payload = {
    _meta: {
      schema: 1,
      source: SOURCE_URL,
      syncedAt: responseDate(response),
      count,
      sourceRows: parsed.sourceRows,
      duplicateCodes: parsed.duplicateCodes,
      invalidWebsiteCodes: parsed.invalidWebsiteCodes,
      description: 'Censo público de comercializadores de electricidad de la CNMC. No contiene datos de clientes.'
    },
    commercializers: parsed.commercializers
  };

  await writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  if (parsed.duplicateCodes.length) {
    console.warn(`CNMC: duplicados resueltos mediante la fila activa: ${parsed.duplicateCodes.join(', ')}`);
  }
  if (parsed.invalidWebsiteCodes.length) {
    console.warn(`CNMC: webs inválidas omitidas: ${parsed.invalidWebsiteCodes.join(', ')}`);
  }
  console.log(`CNMC: ${count} comercializadoras escritas en ${OUTPUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await syncCnmcCommercializers();
}
