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

// CSS de pagina = presentacion (12/11/2026), con los limites que pidio la revision de ChatGPT:
// - Solo los bloques <style> del <head>, con apertura y cierre a principio de linea y sin otra
//   etiqueta style ni marcas de comentario HTML dentro: un "<style>" en una cadena de un script
//   del cuerpo o en un comentario no puede tragarse contenido; si algo no encaja, el bloque no se
//   enmascara y cuenta como cambio (el error aceptado es fechar de mas, nunca de menos).
// - El texto que el CSS pinta (content: 'Dato Clave') SIGUE contando: se conservan esos valores.
// - Solo los atributos style="" de dentro de una etiqueta; si ocultan contenido (display:none,
//   visibility:hidden) se conserva esa marca, porque mostrar u ocultar un bloque si cambia lo que
//   se lee.
const PAGE_STYLE_BLOCK = /^[ \t]*<style\b[^>]*>(?:(?!<\/?style\b|<!--|-->)[\s\S])*?^[ \t]*<\/style>/gim;
// Lo que el CSS puede pintar como texto se conserva entero: cada declaracion content: (cadenas,
// var(), counter(), attr()...) y cada propiedad personalizada cuyo valor lleve comillas (puede
// llegar a un content: con var()). Antes se quitan los comentarios CSS (revision de ChatGPT).
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_STR = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;
const CSS_TEXT_DECL = new RegExp(String.raw`(?:^|[;{\s])((?:content|--[\w-]+)\s*:(?:${CSS_STR}|[^;}"'])*)`, 'gi');
function cssTextDecls(css) {
  return [...css.replace(CSS_COMMENT, ' ').matchAll(CSS_TEXT_DECL)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .filter((d) => /^content\s*:/i.test(d) || /["']/.test(d))
    .join(';');
}
// Atributos leidos como atributos (con sus comillas), no por texto suelto: un style="" escrito
// dentro de title='...' no es un atributo style.
const HTML_TAG = /<[a-zA-Z][\w:-]*(?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
const TAG_ATTR = /(\s+)([^\s"'<>\/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
const HIDES_CONTENT = /display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden|(?:^|[;\s])opacity\s*:\s*0*(?:\.0*)?\s*(?:;|$|!)/i;

function maskStyleBlock(block) {
  return '<style>X ' + cssTextDecls(block) + '</style>';
}

function maskStyleAttrs(html) {
  const literales = [];
  const protegido = html.replace(/(<(textarea|title|script)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (m, open, tag, body, close) => { literales.push(body); return open + '\u0000L' + (literales.length - 1) + '\u0000' + close; });
  return maskTags(protegido).replace(/\u0000L(\d+)\u0000/g, (m, i) => literales[Number(i)]);
}

function maskTags(html) {
  return html.replace(HTML_TAG, (tag) => tag.replace(TAG_ATTR, (m, sp, name, eq, value) => {
    if (name.toLowerCase() !== 'style' || value === undefined) return m;
    const raw = value.replace(/^["']|["']$/g, '');
    const css = raw.replace(CSS_COMMENT, ' ');
    const textos = cssTextDecls(raw);
    return sp + 'style="X' + (HIDES_CONTENT.test(css) ? ':oculto' : '') + (textos ? ' ' + textos : '') + '"';
  }));
}

function maskPageCss(text) {
  const headEnd = text.search(/<\/head\s*>/i);
  // Sin </head> (fragmento) se trata todo como cabecera; las paginas reales siempre lo tienen.
  const head = headEnd < 0 ? text : text.slice(0, headEnd);
  const rest = headEnd < 0 ? '' : text.slice(headEnd);
  // Los scripts del <head> se apartan antes: un "<style>" dentro de una plantilla JS no es CSS.
  const scripts = [];
  const headSinScripts = head.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (m) => { scripts.push(m); return '\u0000S' + (scripts.length - 1) + '\u0000'; });
  const maskedHead = headSinScripts.replace(PAGE_STYLE_BLOCK, maskStyleBlock).replace(/\u0000S(\d+)\u0000/g, (m, i) => scripts[Number(i)]);
  return maskStyleAttrs(maskedHead + rest);
}

export function maskVolatileSeoChanges(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\?v=\d{8}-\d{6}/g, '?v=X')
    .replace(/'sha256-[A-Za-z0-9+/=]+'/g, "'sha256-X'")
    .replace(/("dateModified"\s*:\s*")[^"]*(")/g, '$1X$2')
    .replace(/(<span class="updated-badge">[^<]*Act\.\s*)[^<]+(<\/span>)/g, '$1X$2')
    .replace(/(Última actualización:\s*)[^<]+(<\/em><\/p>)/i, '$1X$2')
    // Directivas de indexacion y metadatos de la imagen del Article: son datos
    // para buscadores, no contenido que el lector vea cambiado. Sellar la fecha
    // por tocarlos afirmaria una actualizacion editorial que no ha ocurrido.
    // Una imagen distinta de verdad cambia ademas og:image y el <img> visible,
    // que no estan enmascarados: el fichero seguiria contando como sucio.
    .replace(/[ \t]*<meta\b[^>]*\bname=["']robots["'][^>]*>[ \t]*\n?/gi, '')
    .replace(/("image"\s*:\s*\{\s*"@type"\s*:\s*"ImageObject")[^}]*\}/g, '$1X}')
    // Antiincrustacion (js/frame-guard.js): cargador de infraestructura, no contenido. Darlo
    // de alta en 36 paginas (18/10/2026) las habria fechado todas como actualizadas.
    .replace(/[ \t]*<script\b[^>]*\bsrc=["'][^"']*\/js\/frame-guard\.js[^"']*["'][^>]*><\/script>[ \t]*\n?/gi, '')
    // Preloads: pistas de carga, sin contenido. Los preloads explicitos del head (12/11/2026,
    // meta CSP sin descubrimiento especulativo) habrian fechado como actualizadas las tres
    // aplicaciones. Solo se quita la propia etiqueta (no cruza su ">"), asi que no puede
    // tragarse contenido. Una hoja o un script nuevos (<link rel="stylesheet">, <script>)
    // siguen contando.
    // Los comentarios HTML NO se ignoran, a proposito: una regex no sabe si "<!--" es un
    // comentario o texto dentro de <style>, <textarea>, <title> o un atributo, y equivocarse
    // ocultaria un cambio real (revision de ChatGPT, 12/11/2026). El fallo que se acepta es el
    // inofensivo: tocar solo un comentario fecha la pagina.
    .replace(/[ \t]*<link\b[^>]*\brel=["']preload["'][^>]*>[ \t]*\n?/gi, '')
    // Presentacion, no contenido (12/11/2026): bloques <style> de la pagina y atributos style="".
    // Ajustar colores o maquetacion no es una revision editorial; fecharlo la afirmaria (la pasada
    // de contraste a pixel y la cabecera no fija en movil tocaron el CSS de 27 paginas, la politica
    // de privacidad incluida). El bloque solo se reconoce con <style> y </style> al principio de
    // linea, como los escribe el sitio, asi que un "<style>" dentro de una cadena de un script no
    // se traga contenido. Un texto, enlace o elemento nuevo fuera del CSS sigue contando.
    .replace(/[\s\S]*/, (all) => maskPageCss(all))
    // Semantica de accesibilidad: nombres de landmarks, roles y el NIVEL de un encabezado cuyo
    // texto no cambia. Afectan a como se navega con lector de pantalla, no a lo que se lee: la
    // pasada axe del 24/09/2026 los toco en 25 guias y 3 aplicaciones y, sin esto, las habria
    // fechado todas como actualizadas. Un texto nuevo (p. ej. un rotulo de tabla) sigue contando.
    .replace(/\s(?:aria-label|role)="[^"]*"/g, '')
    .replace(/<(\/?)h[1-6](?=[\s>])/g, '<$1hX')
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
