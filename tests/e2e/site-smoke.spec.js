const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'scripts', 'playwright-report', 'test-results']);

function collectHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectHtmlFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(path.relative(ROOT, path.join(dir, entry.name)).replace(/\\/g, '/'));
    }
  }
  return out;
}

function toRoute(relPath) {
  if (relPath === 'index.html') return '/';
  if (relPath.endsWith('/index.html')) return '/' + relPath.slice(0, -'index.html'.length);
  return '/' + relPath;
}

function sanitizeForFilename(route) {
  if (route === '/') return 'home';
  return route.replace(/[\/\\:?*"<>|]+/g, '_').replace(/^_+|_+$/g, '');
}

function isLocalUrl(url, baseUrl) {
  return typeof url === 'string' && url.startsWith(baseUrl);
}

const routes = collectHtmlFiles(ROOT).sort().map(toRoute);

test.describe('Visual smoke over all pages', () => {
  test('route inventory sanity', async () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  for (const route of routes) {
    test(`renders cleanly: ${route}`, async ({ page, baseURL }, testInfo) => {
      const localConsoleErrors = [];
      const localRequestFailures = [];
      const localHttpErrors = [];
      const localPageErrors = [];

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const loc = msg.location();
        const locUrl = loc && loc.url ? String(loc.url) : '';
        if (locUrl && isLocalUrl(locUrl, baseURL)) {
          localConsoleErrors.push(`[console] ${locUrl}: ${msg.text()}`);
          return;
        }
        // Ignore third-party noise in local validation.
        if (msg.text().includes('Failed to load resource')) return;
        if (!locUrl) localConsoleErrors.push(`[console] ${msg.text()}`);
      });

      page.on('requestfailed', (req) => {
        const url = req.url();
        if (!isLocalUrl(url, baseURL)) return;
        localRequestFailures.push(`${url} -> ${req.failure() ? req.failure().errorText : 'request failed'}`);
      });

      page.on('response', (res) => {
        const url = res.url();
        if (!isLocalUrl(url, baseURL)) return;
        if (res.status() >= 400) {
          localHttpErrors.push(`${url} -> HTTP ${res.status()}`);
        }
      });

      page.on('pageerror', (err) => {
        localPageErrors.push(err.message);
      });

      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response, `No response for ${route}`).toBeTruthy();
      expect(response.status(), `Main document status for ${route}`).toBeLessThan(400);

      await page.waitForTimeout(450);

      const bodyChars = await page.locator('body').innerText().then((t) => t.trim().length);
      expect(bodyChars, `Body appears empty on ${route}`).toBeGreaterThan(30);

      await page.screenshot({
        path: testInfo.outputPath(`shot-${sanitizeForFilename(route)}.png`),
        fullPage: true
      });

      expect(localRequestFailures, `Local request failures on ${route}`).toEqual([]);
      expect(localHttpErrors, `Local HTTP errors on ${route}`).toEqual([]);
      expect(localPageErrors, `Unhandled page errors on ${route}`).toEqual([]);
      expect(localConsoleErrors, `Local console errors on ${route}`).toEqual([]);
    });
  }
});
