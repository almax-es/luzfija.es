const { test, expect } = require('@playwright/test');
const path = require('path');

const csvFixture = path.resolve(__dirname, '..', 'fixtures', '3.csv');
const invalidPdfFixture = path.resolve(__dirname, '..', 'fixtures', 'datadis_nuevo.csv');

async function fillMainFormAndCalculate(page) {
  await page.fill('#p1', '3,45');
  await page.fill('#p2', '3,45');
  await page.fill('#dias', '30');
  await page.fill('#cPunta', '120');
  await page.fill('#cLlano', '80');
  await page.fill('#cValle', '150');

  await page.click('#btnCalc');

  await expect.poll(async () => page.locator('#tbody tr').count(), { timeout: 35_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await page.locator('#kpiBest').textContent())?.trim() || '', { timeout: 35_000 }).not.toBe('—');
}

test.describe('Deep user flows', () => {
  test('home: cálculo manual completo y render de ranking', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#btnCalc')).toBeVisible();

    await fillMainFormAndCalculate(page);

    await expect(page.locator('#table')).toBeVisible();
    await expect(page.locator('#statusText')).not.toContainText('Corrige');
  });

  test('home: comparar con mi tarifa actual', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#btnCalc')).toBeVisible();

    await page.check('#compararMiTarifa');
    await expect(page.locator('#mtP1')).toBeVisible();

    await page.fill('#mtP1', '0,0891');
    await page.fill('#mtP2', '0,0445');
    await page.fill('#mtPunta', '0,1543');
    await page.fill('#mtLlano', '0,1234');
    await page.fill('#mtValle', '0,0899');

    await fillMainFormAndCalculate(page);

    await expect(page.locator('#tbody')).toContainText('Mi tarifa');
  });

  test('home: importar CSV y aplicar consumos al comparador', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#btnSubirCSV')).toBeVisible({ timeout: 15_000 });

    await page.setInputFiles('#csvConsumoInput', csvFixture);
    await expect(page.locator('#btnAplicarCSV')).toBeVisible({ timeout: 30_000 });
    await page.click('#btnAplicarCSV');

    await expect.poll(async () => (await page.inputValue('#dias')).trim(), { timeout: 20_000 }).not.toBe('');
    await expect.poll(async () => (await page.inputValue('#cPunta')).trim(), { timeout: 20_000 }).not.toBe('');
    await expect.poll(async () => (await page.inputValue('#cLlano')).trim(), { timeout: 20_000 }).not.toBe('');
    await expect.poll(async () => (await page.inputValue('#cValle')).trim(), { timeout: 20_000 }).not.toBe('');
    await expect.poll(async () => page.locator('#tbody tr').count(), { timeout: 35_000 }).toBeGreaterThan(0);
  });

  test('home: validación de factura rechaza archivo no PDF', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.click('#btnSubirFactura');
    await expect(page.locator('#modalFactura')).toHaveAttribute('aria-hidden', 'false');

    await page.setInputFiles('#fileInputFactura', invalidPdfFixture);
    await expect(page.locator('#toast')).toHaveClass(/show/, { timeout: 10_000 });
    await expect(page.locator('#toastText')).toContainText('Sube un PDF válido');

    await page.keyboard.press('Escape');
    await expect(page.locator('#modalFactura')).toHaveAttribute('aria-hidden', 'true');
  });

  test('guía: botón copiar muestra feedback no bloqueante', async ({ page }) => {
    await page.goto('/guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      if (typeof window.share === 'function') window.share('copy');
    });

    const copyFeedback = page.getByText(/link copiado/i);
    await expect(copyFeedback).toBeVisible({ timeout: 5_000 });
    await expect(copyFeedback).toBeHidden({ timeout: 5_000 });
  });

  test('estadísticas: carga de datos y cambios de controles', async ({ page }) => {
    await page.goto('/estadisticas/', { waitUntil: 'domcontentloaded' });

    await expect.poll(async () => (await page.locator('#kpiLast').textContent())?.trim() || '', { timeout: 35_000 }).not.toBe('—');
    await expect.poll(async () => (await page.locator('#kpiLastSub').textContent())?.trim() || '', { timeout: 35_000 }).not.toContain('Cargando');

    const typeOptions = await page.locator('#typeSelector option').count();
    if (typeOptions > 1) {
      const current = await page.inputValue('#typeSelector');
      const candidate = await page.locator('#typeSelector option').nth(1).getAttribute('value');
      if (candidate && candidate !== current) {
        await page.selectOption('#typeSelector', candidate);
      }
    }

    await page.click('#trendModeMonthly');
    await expect(page.locator('#trendModeMonthly')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#trendChart')).toBeVisible();
    await expect(page.locator('#compareChart')).toBeVisible();
  });

  test('simulador solar: entrada manual y cálculo completo', async ({ page }) => {
    await page.goto('/comparador-tarifas-solares.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#bv-simulate')).toBeVisible();

    await page.fill('#bv-p1', '3,45');
    await page.fill('#bv-p2', '3,45');
    await page.fill('input[data-month="0"][data-type="p1"]', '120');
    await page.fill('input[data-month="0"][data-type="p2"]', '80');
    await page.fill('input[data-month="0"][data-type="p3"]', '150');
    await page.fill('input[data-month="0"][data-type="vert"]', '50');

    await page.click('#bv-simulate');

    await expect(page.locator('#bv-results-container')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#bv-results')).toContainText('Resultados de la Simulación');
    await expect(page.locator('#bv-results')).toContainText('Ranking completo');
  });
});
