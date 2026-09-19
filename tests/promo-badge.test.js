/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Promociones: se INFORMAN, nunca se calculan.
 *
 * El riesgo que vigilan estos tests no es visual: es que alguien acabe metiendo
 * el descuento en el importe. El ranking debe seguir ordenando por coste real.
 * Regla completa y casos cerrados en JSON-SCHEMA.md.
 */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const render = read('js/lf-render.js');
const desgloseRender = read('js/desglose-render.js');
const desgloseFactura = read('js/desglose-factura.js');
const desgloseIntegration = read('js/desglose-integration.js');
const bvUi = read('js/bv/bv-ui.js');
const calc = read('js/lf-calc.js');
const styles = read('styles.css');
const desgloseCss = read('desglose-factura.css');
const tarifas = JSON.parse(read('tarifas.json'));

describe('promo: etiqueta en el ranking', () => {
  it('solo pinta la etiqueta cuando la tarifa trae promo', () => {
    expect(render).toMatch(/const promoBadge = r\.promo\s*\n\s*\?/);
    expect(render).toMatch(/class="tooltip promo-badge"/);
    expect(render).toMatch(/data-tip="\$\{escapeHtml\(r\.promo\)\}"/);
  });

  it('inyecta la etiqueta dentro de .tarifa-title', () => {
    expect(render).toMatch(/\$\{icons\}` \+\s*\n\s*`\$\{promoBadge\}`/);
  });

  it('engancha el tooltip de la etiqueta al render', () => {
    expect(render).toMatch(/querySelectorAll\('\.promo-badge'\)\.forEach\(t => bindTooltipElement\(t\)\)/);
  });

  it('escapa el texto de la promo en atributo y en aria-label', () => {
    const bloque = render.slice(render.indexOf('const promoBadge'), render.indexOf('const promoBadge') + 900);
    const crudas = bloque.match(/\$\{r\.promo\}/g) || [];
    expect(crudas).toHaveLength(0);
  });

  it('no repite el texto de la promo en aria-label (el tooltip ya lo da por aria-describedby)', () => {
    expect(render).toMatch(/aria-label="Promoción disponible"/);
  });

  it('conserva la clase "tooltip", de la que depende que no se abra el desglose', () => {
    // desglose-integration.js ignora los clics dentro de `.tooltip`. Si alguien
    // quita esa clase del badge, pulsar la oferta abrira el modal encima del tooltip.
    expect(render).toMatch(/class="tooltip promo-badge"/);
    expect(desgloseIntegration).toMatch(/closest\('a, button, input, select, textarea, \.tooltip/);
  });
});

// El XSS del campo `promo` se prueba extremo a extremo en tests/security.test.js,
// que carga lf-render.js de verdad y ejecuta renderTable(). Reconstruir aqui la
// plantilla a mano daria un verde enganoso si el render sufriera una regresion.

describe('promo: nunca entra en el calculo', () => {
  it('lf-calc.js no lee el campo promo', () => {
    expect(calc).not.toMatch(/\bpromo\b/);
  });

  it('el desglose deja claro que el total no la incluye', () => {
    expect(desgloseRender).toMatch(/No incluida en este c[aá]lculo/);
    expect(bvUi).toMatch(/No incluida en este c[aá]lculo/);
  });
});

describe('promo: desglose de factura', () => {
  it('el contenedor existe y arranca oculto', () => {
    expect(desgloseFactura).toMatch(/class="desglose-promo" style="display:none;"/);
  });

  it('integration propaga el campo desde la tarifa', () => {
    expect(desgloseIntegration).toMatch(/promo: tarifa\.promo \|\| null/);
  });

  it('render lo muestra solo si hay dato y usa textContent', () => {
    expect(desgloseRender).toMatch(/querySelector\('\.desglose-promo'\)/);
    expect(desgloseRender).toMatch(/promoEl\.textContent = /);
    expect(desgloseRender).toMatch(/promoEl\.style\.display = 'none'/);
  });
});

describe('promo: simulador solar', () => {
  it('tiene helper propio y lo pinta en ganadora y alternativas', () => {
    expect(bvUi).toMatch(/const getPromoAviso = \(tarifa\) =>/);
    expect(bvUi).toMatch(/const winnerPromoNote = getPromoAviso\(winner\.tarifa\)/);
    expect(bvUi).toMatch(/const altPromoNote = getPromoAviso\(r\.tarifa\)/);
    expect(bvUi).toMatch(/\$\{winnerPromoNote\}/);
    expect(bvUi).toMatch(/\$\{altPromoNote\}/);
  });

  it('escapa el texto de la promo', () => {
    expect(bvUi).toMatch(/escapeHtml\(promo\)/);
  });
});

describe('promo: estilos legibles en los dos temas', () => {
  it('anula el font-size:0 que .tooltip impone para dibujar la "i"', () => {
    // Sin esto la etiqueta se renderiza vacia (22x6 px). Regresion real, 06/08/2026.
    expect(styles).toMatch(/\.tooltip\.promo-badge\{[\s\S]*?font-size: 10px !important/);
    expect(styles).toMatch(/\.tooltip\.promo-badge::before,\s*\n\s*\.tooltip\.promo-badge::after\{ content: none !important; \}/);
  });

  it('usa el verde con contraste AA y no lo cambia por tema', () => {
    expect(styles).toMatch(/\.tooltip\.promo-badge\{[\s\S]*?background: #15803D; color: #FFFFFF/);
    expect(desgloseCss).toMatch(/\.desglose-promo \{[\s\S]*?border-left: 3px solid #15803D/);
  });
});

describe('promo: coherencia del dataset', () => {
  it('promo siempre es texto no vacio cuando existe', () => {
    for (const t of tarifas.tarifas) {
      if (!('promo' in t)) continue;
      expect(typeof t.promo, `${t.nombre}`).toBe('string');
      expect(t.promo.trim().length, `${t.nombre}`).toBeGreaterThan(0);
    }
  });

  it('promo y requisitos no repiten el mismo texto', () => {
    for (const t of tarifas.tarifas) {
      if (!t.promo || !t.requisitos) continue;
      expect(t.promo.trim(), `${t.nombre}`).not.toBe(t.requisitos.trim());
    }
  });
});
