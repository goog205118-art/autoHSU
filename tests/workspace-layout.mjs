import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createStaticServer } from '../scripts/serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const server = createStaticServer();
const widths = [320, 360, 390, 560, 768, 820, 1024, 1280, 1440, 1920];
let browser;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('#social-tool-workspace').waitFor();
  assert.equal(await page.locator('main').count(), 1);
  assert.equal(await page.locator('.help-modal, .welcome, #social-tool-close-btn, #access-gate').count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/workspace-desktop.png', import.meta.url)), fullPage: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        main: rect('main'), header: rect('.social-tool-head'), nav: rect('.social-tool-workspaces'), body: rect('.social-tool-body'),
        compose: rect('.studio-compose'), results: rect('.studio-results'),
        mainPosition: getComputedStyle(document.querySelector('main')).position,
        shellMaxHeight: getComputedStyle(document.querySelector('.social-tool-shell')).maxHeight
      };
    });
    assert.ok(metrics.scroll <= metrics.viewport, `workspace overflows at ${width}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.mainPosition, 'static');
    assert.equal(metrics.shellMaxHeight, 'none');
    assert.equal(metrics.header.left, metrics.nav.left);
    assert.equal(metrics.header.right, metrics.nav.right);
    assert.ok(Math.abs(metrics.body.left - metrics.compose.left) < 1);
    if (width > 800) {
      assert.equal(metrics.compose.top, metrics.results.top);
      assert.ok(Math.abs(metrics.body.right - metrics.results.right) < 1);
    } else assert.ok(metrics.results.top > metrics.compose.bottom);
    if (width === 390) await page.screenshot({ path: fileURLToPath(new URL('../docs/workspace-mobile.png', import.meta.url)), fullPage: true });
    await page.locator('#social-tool-settings-btn').click();
    assert.equal(await page.locator('#social-tool-settings-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.social-tool-body').isVisible(), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `settings overflows at ${width}`);
    assert.ok(await page.locator('.social-tool-settings-page').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `settings children overflow at ${width}`);
    if (width === 1440) await page.screenshot({ path: fileURLToPath(new URL('../docs/settings-desktop.png', import.meta.url)), fullPage: true });
    if (width === 390) await page.screenshot({ path: fileURLToPath(new URL('../docs/settings-mobile.png', import.meta.url)), fullPage: true });
    await page.locator('#social-tool-settings-back').click();
    assert.equal(await page.locator('#social-tool-settings-btn').getAttribute('aria-expanded'), 'false');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#social-tool-image-count').selectOption('5');
  assert.equal(await page.locator('[data-social-ratio-slot]').count(), 5);
  for (let i = 0; i < 9; i++) await page.locator('#social-tool-workspace-add').click();
  assert.equal(await page.locator('.social-tool-workspace-btn').count(), 10);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('main').isVisible(), true);
  await page.locator('#social-tool-upload').focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.social-tool-progress-fill').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ widths, main: 'document flow', alignment: 'passed', settings: 'passed', workspaces: 10, keyboardUpload: 'passed', reducedMotion: 'passed', externalRequests, errors }));
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
