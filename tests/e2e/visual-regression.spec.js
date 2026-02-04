const { test, expect } = require('@playwright/test');

const VISUAL_CASES = [
  {
    name: 'home-top',
    route: '/',
    mask: ['#tarifasUpdated', '#statusText', '#toast', '#novedadesContainer']
  },
  {
    name: 'guias-index-top',
    route: '/guias.html',
    mask: ['#toast']
  },
  {
    name: 'guia-factura-top',
    route: '/guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html',
    mask: []
  },
  {
    name: 'simulador-solar-top',
    route: '/comparador-tarifas-solares.html',
    mask: ['#toast', '#bv-data-status', '#bv-save-indicator']
  },
  {
    name: 'calcular-factura-top',
    route: '/calcular-factura-luz.html',
    mask: []
  },
  {
    name: 'aviso-legal-top',
    route: '/aviso-legal.html',
    mask: []
  }
];

async function existingMaskLocators(page, selectors) {
  const masks = [];
  for (const selector of selectors || []) {
    const locator = page.locator(selector);
    if (await locator.count()) masks.push(locator.first());
  }
  return masks;
}

test.describe('Visual baseline (desktop)', () => {
  for (const c of VISUAL_CASES) {
    test(`snapshot: ${c.name}`, async ({ page }) => {
      await page.goto(c.route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);

      const masks = await existingMaskLocators(page, c.mask);
      await expect(page).toHaveScreenshot(`${c.name}.png`, {
        fullPage: false,
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.01,
        mask: masks
      });
    });
  }
});
