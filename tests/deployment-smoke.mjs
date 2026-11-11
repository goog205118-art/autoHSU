import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const base = process.env.DEPLOYMENT_URL;
assert.ok(base, 'Set DEPLOYMENT_URL to the production deployment being verified');
const hashes = {};
for (const name of ['index.html', 'styles.css', 'js/boot.js', 'js/social-media-tool.js', 'js/direct-api.js']) {
  const response = await fetch(new URL(name === 'index.html' ? '/' : name, base), { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  assert.equal(response.status, 200, name);
  const deployed = Buffer.from(await response.arrayBuffer());
  const local = await fs.readFile(new URL('../public/' + name, import.meta.url));
  assert.deepEqual(deployed, local, `${name}: production must match this checkout`);
  hashes[name] = createHash('sha256').update(deployed).digest('hex');
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
const errors = [], failed = [], unexpectedRequests = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1080 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failed.push(request.url()));
    page.on('request', request => {
      if (new URL(request.url()).origin !== new URL(base).origin) unexpectedRequests.push(request.url());
    });
    const response = await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.locator('#social-tool-workspace').waitFor();
    assert.equal((await page.locator('h1').innerText()).replace(/\s+/g, ''), 'S社媒工作室内容工作台');
    assert.equal(await page.locator('.help-modal, #access-gate, #access-code, .welcome').count(), 0);
    assert.equal(await page.locator('main').evaluate(node => getComputedStyle(node).position), 'static');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.locator('#social-tool-product-desc').fill('Deployment workspace check');
    await page.locator('#social-tool-settings-btn').click();
    await page.locator('#social-tool-api-base').waitFor();
    assert.equal(await page.locator('#social-tool-api-key').getAttribute('type'), 'password');
    assert.equal(await page.locator('.social-tool-body').isVisible(), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.locator('#social-tool-settings-back').click();
    assert.equal(await page.locator('#social-tool-product-desc').inputValue(), 'Deployment workspace check');
    await page.locator('#social-tool-workspace-add').click();
    assert.equal(await page.locator('#social-tool-product-desc').inputValue(), '');
    await page.locator('.social-tool-workspace-btn').first().click();
    assert.equal(await page.locator('#social-tool-product-desc').inputValue(), 'Deployment workspace check');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('main').isVisible(), true);
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log(JSON.stringify({ url: base, status: 200, exactAssetHashes: hashes, desktop: 'passed', touchMobile: 'passed', apiSettings: 'passed', errors, failed, unexpectedRequests }));
} finally { await browser.close(); }
