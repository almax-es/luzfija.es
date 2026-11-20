/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// CLS de carga de quien vuelve (20/11/2026). lf-inputs.js restaura lo guardado DESPUES del primer
// pintado: con placas solares, bono social o Canarias, sus bloques aparecian entonces y el indicador
// "Total kWh" pasaba de "—" a dos pastillas, empujando el footer visible en pantallas altas
// (0,012 a 1920x1080 y 0,077 a 1280x1440). theme.js, antes del CSS, marca <html> con lo que restaurara
// loadInputs() y pinta el indicador con los textos que saveInputs() guardo en el mismo JSON. Aqui se vigila que esa
// prediccion temprana coincida SIEMPRE con lo que luego pinta la aplicacion: si no coincide, el arreglo
// se convierte en otro salto (o en un bloque abierto que no corresponde).

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const themeCode = read('js/theme.js');
const indexHtml = read('index.html');
const cuerpo = indexHtml.slice(indexHtml.indexOf('<body'), indexHtml.lastIndexOf('</body>'))
  .replace(/^<body[^>]*>/, '')
  .replace(/<script\b[\s\S]*?<\/script>/g, '');

const LS = 'almax_comparador_v6_inputs';
const root = document.documentElement;
const MARCAS = ['lf-pre-solar', 'lf-pre-bono', 'lf-pre-canarias'];
let ancho = 1280;
window.matchMedia = (q) => {
  const m = /min-width:\s*(\d+)px/.exec(q);
  return { matches: m ? ancho >= Number(m[1]) : false, media: q, addEventListener() {}, removeEventListener() {} };
};

function ejecutarTheme() {
  new Function(themeCode)();
}

// Serializacion estructural: ignora los nodos de solo espacios (no pintan dentro de los flex de las
// pastillas) y compara etiqueta, clases, atributos relevantes y texto.
function forma(node) {
  if (node.nodeType === 3) return node.textContent.trim() ? JSON.stringify(node.textContent) : '';
  const hijos = [...node.childNodes].map(forma).filter(Boolean).join(',');
  const attrs = ['class', 'data-placeholder'].filter((a) => node.hasAttribute(a))
    .map((a) => `${a}=${node.getAttribute(a)}`).join(' ');
  return `<${node.nodeName.toLowerCase()} ${attrs}>[${hijos}]`;
}

function hintInicial() {
  const hint = document.getElementById('kwhHint');
  hint.setAttribute('data-placeholder', '');
  hint.textContent = '—';
  return hint;
}

function rellenar(valores) {
  const { el } = window.LF;
  for (const [k, v] of Object.entries(valores)) {
    if (el.inputs[k].type === 'checkbox') el.inputs[k].checked = v;
    else el.inputs[k].value = v;
  }
}

beforeAll(async () => {
  document.body.innerHTML = cuerpo;
  await import('../js/lf-utils.js');
  await import('../js/lf-state.js');
  window.LF.initElements();
  Object.assign(window.LF, {
    showError() {}, clearErrorStyles() {}, applyButtonState() {}, toast() {}
  });
  await import('../js/lf-inputs.js');
});

beforeEach(() => {
  localStorage.clear();
  ancho = 1280;
  root.classList.remove(...MARCAS);
  history.replaceState(null, '', '/');
  hintInicial();
});

describe('theme.js: marca temprana de los bloques del formulario', () => {
  it('marca solar, bono y Canarias segun lo guardado', () => {
    localStorage.setItem(LS, JSON.stringify({ solarOn: true, bonoSocialOn: 'true', zonaFiscal: 'Canarias' }));
    ejecutarTheme();
    expect(MARCAS.every((c) => root.classList.contains(c))).toBe(true);
  });

  it('no marca nada sin datos guardados, con las opciones apagadas o con el JSON roto', () => {
    ejecutarTheme();
    expect(MARCAS.some((c) => root.classList.contains(c))).toBe(false);
    localStorage.setItem(LS, JSON.stringify({ solarOn: false, bonoSocialOn: 'no', zonaFiscal: 'Península' }));
    ejecutarTheme();
    expect(MARCAS.some((c) => root.classList.contains(c))).toBe(false);
    localStorage.setItem(LS, '{roto');
    expect(() => ejecutarTheme()).not.toThrow();
    expect(MARCAS.some((c) => root.classList.contains(c))).toBe(false);
  });

  it('un enlace con configuracion compartida manda sobre lo guardado, como en loadInputs()', () => {
    localStorage.setItem(LS, JSON.stringify({ solarOn: true, bonoSocialOn: true }));
    history.replaceState(null, '', '/?p1=4&bonoSocialOn=1');
    ejecutarTheme();
    expect(root.classList.contains('lf-pre-solar')).toBe(false);
    expect(root.classList.contains('lf-pre-bono')).toBe(true);
  });

  it('los parametros de tracking no cuentan como configuracion compartida', () => {
    localStorage.setItem(LS, JSON.stringify({ solarOn: true }));
    history.replaceState(null, '', '/?utm_source=foro&fbclid=x');
    ejecutarTheme();
    expect(root.classList.contains('lf-pre-solar')).toBe(true);
  });

  it('en movil (<= 520 px) no marca ni pinta nada: alli el salto no se veia y retrasaba el FCP', () => {
    rellenar({ solarOn: true, cPunta: '120', cLlano: '110', cValle: '150', exTotal: '85' });
    window.LF.saveInputs();
    for (const w of [360, 430, 520]) {
      ancho = w;
      const hint = hintInicial();
      ejecutarTheme();
      expect(MARCAS.some((c) => root.classList.contains(c))).toBe(false);
      expect(hint.textContent).toBe('—');
    }
    // Tablet o ventana estrecha: 768x1024 tambien saltaba (0,002-0,023).
    ancho = 521;
    ejecutarTheme();
    expect(root.classList.contains('lf-pre-solar')).toBe(true);
  });

  it('fuera de la home no hace nada', () => {
    localStorage.setItem(LS, JSON.stringify({ solarOn: true }));
    history.replaceState(null, '', '/comparador-tarifas-solares.html');
    ejecutarTheme();
    expect(root.classList.contains('lf-pre-solar')).toBe(false);
  });

  it('su lista de claves compartibles es exactamente la de DEFAULTS (SHAREABLE_INPUT_KEYS)', () => {
    const lista = themeCode.match(/CLAVES_COMPARTIBLES = \[([\s\S]*?)\]/)[1]
      .match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    expect(lista.sort()).toEqual([...window.LF.SHAREABLE_INPUT_KEYS].sort());
  });

  it('el JS retira cada marca al tomar el control', () => {
    root.classList.add(...MARCAS);
    window.LF.updateSolarUI();
    window.LF.updateBonoSocialUI();
    window.LF.updateZonaFiscalUI();
    expect(MARCAS.some((c) => root.classList.contains(c))).toBe(false);
  });

  it('si lf-inputs no llega a ejecutarse, la marca se retira en load', () => {
    localStorage.setItem(LS, JSON.stringify({ solarOn: true, bonoSocialOn: true, zonaFiscal: 'Canarias' }));
    ejecutarTheme();
    window.dispatchEvent(new Event('load'));
    expect(MARCAS.some((c) => root.classList.contains(c))).toBe(false);
  });

  it('styles.css muestra los bloques marcados por encima del display:none en linea', () => {
    const css = read('styles.css').replace(/\s+/g, ' ');
    expect(css).toContain('html.lf-pre-solar #solarFields, html.lf-pre-bono #bonoSocialFields { display: grid !important; }');
    expect(css).toContain('html.lf-pre-canarias #viviendaCanariasGroup { display: flex !important; }');
    // Y el display que pone el JS al mostrarlos es el mismo: '' en los bloques (.form = grid) y 'flex'.
    expect(read('js/lf-inputs.js')).toContain("el.viviendaGroup.style.display = isCanarias ? 'flex' : 'none';");
    expect(css).toMatch(/\.form\{ display:grid;/);
  });
});

describe('indicador "Total kWh" pintado antes del primer fotograma', () => {
  const CASOS = [
    ['solar con cifras normales', { solarOn: true, cPunta: '120', cLlano: '110,5', cValle: '150', exTotal: '85.5' }],
    ['solar con cifras grandes y miles con punto', { solarOn: true, cPunta: '12.345', cLlano: '11000,25', cValle: '0.123', exTotal: '99999,99' }],
    ['solar con todo vacio', { solarOn: true, cPunta: '', cLlano: '', cValle: '', exTotal: '' }],
    ['sin solar con consumo', { solarOn: false, cPunta: '1.234,5', cLlano: '7', cValle: '8,25', exTotal: '3' }],
    ['sin solar con consumo cero', { solarOn: false, cPunta: '0', cLlano: '0', cValle: '0', exTotal: '0' }],
    ['valores negativos o basura', { solarOn: true, cPunta: '-5', cLlano: 'abc', cValle: '1 000', exTotal: '-3' }]
  ];

  for (const [nombre, valores] of CASOS) {
    it(`coincide con lo que pinta loadInputs() al volver: ${nombre}`, () => {
      rellenar(valores);
      window.LF.saveInputs();
      // Recarga: el indicador vuelve a su HTML original y theme.js corre antes que nada.
      const hint = hintInicial();
      ejecutarTheme();
      const temprano = forma(hint);
      window.LF.loadInputs();
      expect(temprano).toBe(forma(hint));
    });
  }

  it('lo guardado por una version anterior (sin vistaKwh) no pinta nada; el siguiente guardado la anade', () => {
    localStorage.setItem(LS, JSON.stringify({ solarOn: true, cPunta: '120', cLlano: '110', cValle: '150', exTotal: '85' }));
    let hint = hintInicial();
    ejecutarTheme();
    expect(hint.textContent).toBe('—');
    expect(hint.hasAttribute('data-placeholder')).toBe(true);
    window.LF.loadInputs();
    window.LF.saveInputs();
    hint = hintInicial();
    ejecutarTheme();
    expect(hint.querySelectorAll('.kwh-pill')).toHaveLength(2);
  });

  it('vistaKwh no sale en lo que devuelve saveInputs() (enlaces de Compartir) y loadInputs() la ignora', () => {
    rellenar({ solarOn: true, cPunta: '120', cLlano: '110', cValle: '150', exTotal: '85' });
    const devuelto = window.LF.saveInputs();
    expect(devuelto).not.toHaveProperty('vistaKwh');
    expect(Object.keys(devuelto).sort()).toEqual([...window.LF.SHAREABLE_INPUT_KEYS].sort());
    expect(JSON.parse(localStorage.getItem(LS)).vistaKwh).toEqual({ solar: true, total: true, t: '380,00', ex: '85,00' });
    window.LF.loadInputs();
    expect(window.LF.getInputValues()).not.toHaveProperty('vistaKwh');
  });

  it('no pinta nada con un enlace compartido ni con una vista manipulada', () => {
    rellenar({ solarOn: true, cPunta: '120', cLlano: '110', cValle: '150', exTotal: '85' });
    window.LF.saveInputs();
    history.replaceState(null, '', '/?solarOn=true');
    let hint = hintInicial();
    ejecutarTheme();
    expect(hint.textContent).toBe('—');

    history.replaceState(null, '', '/');
    const datos = JSON.parse(localStorage.getItem(LS));
    for (const vista of [
      { ...datos.vistaKwh, t: '<img src=x onerror=alert(1)>' },
      { ...datos.vistaKwh, solar: 'true' },
      'texto'
    ]) {
      localStorage.setItem(LS, JSON.stringify({ ...datos, vistaKwh: vista }));
      hint = hintInicial();
      ejecutarTheme();
      expect(hint.textContent).toBe('—');
      expect(hint.querySelector('img')).toBeNull();
    }
  });

  it('espera a que el parser cierre #kwhHint (llega #btnCalc) y pinta antes del siguiente fotograma', async () => {
    rellenar({ solarOn: true, cPunta: '120', cLlano: '110', cValle: '150', exTotal: '85' });
    window.LF.saveInputs();
    const guardado = document.body.innerHTML;
    document.body.innerHTML = '';
    ejecutarTheme();
    // El parser inserta el indicador, pero aun no ha llegado al boton: no se toca.
    const pill = document.createElement('div');
    pill.innerHTML = '<div class="kwhValue" id="kwhHint" data-placeholder>—</div>';
    document.body.appendChild(pill);
    await Promise.resolve();
    expect(document.getElementById('kwhHint').textContent).toBe('—');
    const btn = document.createElement('button');
    btn.id = 'btnCalc';
    document.body.appendChild(btn);
    await Promise.resolve();
    expect(document.querySelectorAll('#kwhHint .kwh-pill')).toHaveLength(2);
    expect(document.getElementById('kwhHint').hasAttribute('data-placeholder')).toBe(false);
    document.body.innerHTML = guardado;
    window.LF.initElements();
  });
});
