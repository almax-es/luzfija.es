import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const SOURCE_URL = 'https://sede.cnmc.gob.es/listado/censo/2';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'data', 'cnmc-commercializers.json');

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safeWebsite(anchor) {
  if (!anchor) return null;
  try {
    const url = new URL(anchor.href);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

const response = await fetch(SOURCE_URL, {
  headers: { 'user-agent': 'LuzFija.es CNMC registry sync' }
});
if (!response.ok) throw new Error(`CNMC respondió ${response.status}`);

const document = new JSDOM(await response.text()).window.document;
const commercializers = {};

for (const row of document.querySelectorAll('tr')) {
  const cells = [...row.querySelectorAll('td')];
  const code = clean(cells[0]?.textContent).toUpperCase();
  if (!/^R2-\d{3}$/.test(code)) continue;

  const name = clean(cells[1]?.textContent);
  if (!name) throw new Error(`Fila ${code} sin razón social`);

  const phone = clean(cells[6]?.textContent);
  const website = safeWebsite(cells[11]?.querySelector('a'));
  const entry = { name };
  if (phone) entry.phone = phone;
  if (website) entry.website = website;
  commercializers[code] = entry;
}

const sorted = Object.fromEntries(
  Object.entries(commercializers).sort(([a], [b]) => a.localeCompare(b, 'es'))
);
if (Object.keys(sorted).length < 500 || !sorted['R2-796']) {
  throw new Error('El censo descargado no supera las comprobaciones mínimas');
}

const payload = {
  _meta: {
    schema: 1,
    source: SOURCE_URL,
    description: 'Censo público de comercializadores de electricidad de la CNMC. No contiene datos de clientes.'
  },
  commercializers: sorted
};

await writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`CNMC: ${Object.keys(sorted).length} comercializadoras escritas en ${OUTPUT}`);
