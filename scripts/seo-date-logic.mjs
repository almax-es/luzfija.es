// Politica unica para las fechas SEO. Debe ser estable cuando el deploy solo
// cambia artefactos volatiles: la misma sincronizacion se ejecuta antes del
// commit local y despues, en CI, con HEAD apuntando a commits distintos.

const MONTHS_SHORT_TO_NUM = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12'
};

const MONTHS_LONG_TO_NUM = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12'
};

function isValidYmd(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

export function getTodayMadridYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function maskVolatileSeoChanges(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\?v=\d{8}-\d{6}/g, '?v=X')
    .replace(/'sha256-[A-Za-z0-9+/=]+'/g, "'sha256-X'")
    .replace(/("dateModified"\s*:\s*")[^"]*(")/g, '$1X$2')
    .replace(/(<span class="updated-badge">[^<]*Act\.\s*)[^<]+(<\/span>)/g, '$1X$2')
    .replace(/(Última actualización:\s*)[^<]+(<\/em><\/p>)/i, '$1X$2')
    .trim();
}

export function isSignificantlyDirty({ status, currentContent, committedContent }) {
  if (!String(status || '').trim()) return false;
  if (committedContent === null || committedContent === undefined || committedContent === '') return true;
  return maskVolatileSeoChanges(currentContent) !== maskVolatileSeoChanges(committedContent);
}

export function parseSpanishShortDate(raw) {
  const match = String(raw || '').trim().match(/^(\d{1,2})\s+([a-zñ]+)\s+(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS_SHORT_TO_NUM[match[2].toLowerCase()];
  const ymd = month ? `${match[3]}-${month}-${match[1].padStart(2, '0')}` : null;
  return isValidYmd(ymd) ? ymd : null;
}

export function parseSpanishLongDate(raw) {
  const match = String(raw || '').trim().match(/^(\d{1,2})\s+de\s+([a-zñ]+)\s+de\s+(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS_LONG_TO_NUM[match[2].toLowerCase()];
  const ymd = month ? `${match[3]}-${month}-${match[1].padStart(2, '0')}` : null;
  return isValidYmd(ymd) ? ymd : null;
}

export function getSelfStampedDate(content) {
  const text = String(content || '');
  const jsonLd = text.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  if (jsonLd && isValidYmd(jsonLd[1])) return jsonLd[1];

  const badge = text.match(/<span class="updated-badge">[^<]*Act\.\s*([^<]+)<\/span>/);
  if (badge) {
    const parsed = parseSpanishShortDate(badge[1]);
    if (parsed) return parsed;
  }

  const visible = text.match(/Última actualización:\s*([^<]+)<\/em><\/p>/i);
  return visible ? parseSpanishLongDate(visible[1]) : null;
}

function hasSelfDateStamp(content) {
  const text = String(content || '');
  return /"dateModified"\s*:/.test(text) ||
    /<span class="updated-badge">[^<]*Act\./.test(text) ||
    /Última actualización:\s*/i.test(text);
}

export function resolvePageDate({ dirty, content, today, gitLastModifiedDate }) {
  if (dirty) return today;
  return getSelfStampedDate(content) || (hasSelfDateStamp(content) ? today : gitLastModifiedDate || today);
}

export function resolveSitemapLastmod({ dirty, content, existingLastmod, today, gitLastModifiedDate }) {
  if (dirty) return today;
  return getSelfStampedDate(content) || (hasSelfDateStamp(content) ? today : existingLastmod || gitLastModifiedDate || today);
}
