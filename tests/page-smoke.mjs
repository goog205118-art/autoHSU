import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createStaticServer } from '../scripts/serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const copy = { content: 'A fresh product story.', hashtags: ['#Brand'], theme: 'Everyday product' };
const calls = [], images = [], errors = [];
let rejectImage = false;
const upstream = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
  response.setHeader('Content-Type', 'application/json');
  try {
    calls.push({ path: request.url, auth: request.headers.authorization });
    if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'vision-mock' }] }));
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (request.url === '/v1/responses') {
      const body = JSON.parse(bytes);
      assert.equal(body.input[0].content.filter(part => part.type === 'input_image').length, 5);
      return response.end(JSON.stringify({ output_text: JSON.stringify(copy) }));
    }
    if (request.url === '/v1/images/edits') {
      const form = await new Response(bytes, { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
      assert.equal(form.getAll('image').length, 5);
      for (const file of form.getAll('image')) assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(pixel, 'base64'));
      images.push({ size: form.get('size'), model: form.get('model'), quality: form.get('quality') });
      if (rejectImage) { rejectImage = false; response.statusCode = 429; return response.end(JSON.stringify({ error: { message: 'mock rate limit' } })); }
      return response.end(JSON.stringify({ data: [{ b64_json: pixel }] }));
    }
    response.statusCode = 404; response.end('{}');
  } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: { message: error.message } })); }
});
const server = createStaticServer();
let browser;
try {
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const apiBase = 'http://127.0.0.1:' + upstream.address().port + '/v1';
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, permissions: ['clipboard-read', 'clipboard-write'] });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#social-tool-modal.show').waitFor();
  assert.equal(await page.locator('#access-gate').count(), 0);
  assert.equal(calls.length, 0);
  await page.locator('#social-tool-image-input').setInputFiles(Array.from({ length: 5 }, (_, i) => ({ name: `product-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') })));
  await page.locator('.social-tool-preview').first().waitFor();
  await page.locator('#social-tool-product-desc').fill('Travel bottle for everyday use.');
  await page.locator('#social-tool-generate-btn').click();
  await page.locator('#social-tool-settings.show').waitFor();
  assert.equal(calls.length, 0);
  await page.locator('#social-tool-api-base').fill(apiBase);
  await page.locator('#social-tool-api-key').fill('browser-test-key');
  await page.locator('#social-tool-text-model').fill('vision-mock');
  await page.locator('#social-tool-fetch-models').click();
  await page.waitForFunction(() => document.getElementById('social-tool-api-status').textContent.includes('已读取 2 个模型'));
  assert.equal(await page.locator('#social-tool-image-models option').count(), 1);
  await page.locator('#social-tool-show-key').click();
  assert.equal(await page.locator('#social-tool-api-key').getAttribute('type'), 'text');
  await page.locator('#social-tool-show-key').click();
  await page.locator('#social-tool-settings-save').click();
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(localStorage)), /browser-test-key/);
  await page.locator('[data-social-ratio-slot]').nth(1).selectOption('4:5');
  await page.locator('[data-social-ratio-slot]').nth(2).selectOption('9:16');
  await page.locator('#social-tool-workspace-add').click();
  assert.equal(await page.locator('#social-tool-product-desc').inputValue(), '');
  await page.locator('.social-tool-workspace-btn').first().click();
  assert.match(await page.locator('#social-tool-product-desc').inputValue(), /Travel bottle/);
  await page.locator('#social-tool-generate-btn').click();
  await page.locator('.social-tool-image-item.success').nth(2).waitFor();
  await page.locator('#social-tool-generate-btn:not([disabled])').waitFor();
  assert.deepEqual(images.map(item => item.size), ['1024x1024', '1024x1280', '720x1280']);
  assert.match(await page.locator('#social-tool-text-output').innerText(), /fresh product/);
  await page.locator('#social-tool-copy-btn').click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /#Brand/);
  await page.locator('.social-tool-image-item.success img').first().dblclick();
  await page.locator('.social-tool-image-viewer.show').waitFor();
  await page.locator('#social-tool-image-viewer-close').click();
  rejectImage = true;
  await page.locator('[data-social-rerun-mode="regenerate"]').first().click();
  await page.locator('.social-tool-image-item.failed').waitFor();
  await page.locator('#social-tool-generate-btn:not([disabled])').waitFor();
  assert.equal(images.length, 4);
  await page.locator('[data-social-rerun-mode="retry"]').click();
  await page.locator('.social-tool-image-item.success').nth(2).waitFor();
  await page.locator('#social-tool-generate-btn:not([disabled])').waitFor();
  assert.equal(images.length, 5);
  await page.evaluate(() => {
    window.__exportFiles = [];
    window.showDirectoryPicker = async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async name => ({ createWritable: async () => ({ write: async blob => window.__exportFiles.push({ name, type: blob.type, size: blob.size }), close: async () => {} }) }) }) });
  });
  await page.locator('#social-tool-export-btn').click();
  await page.waitForFunction(() => window.__exportFiles.length === 4);
  assert.equal((await page.evaluate(() => window.__exportFiles)).filter(file => file.name.endsWith('.png')).length, 3);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/preview-desktop.png', import.meta.url)) });
  await page.locator('#social-tool-settings-btn').click();
  await page.locator('#social-tool-text-shared').uncheck();
  await page.locator('#social-tool-text-base').fill(apiBase);
  await page.locator('#social-tool-text-key').fill('independent-test-key');
  await page.locator('#social-tool-remember-key').check();
  await page.locator('#social-tool-settings-save').click();
  await page.reload();
  await page.locator('#social-tool-settings-btn').click();
  assert.equal(await page.locator('#social-tool-api-key').inputValue(), 'browser-test-key');
  assert.equal(await page.locator('#social-tool-text-key').inputValue(), 'independent-test-key');
  await page.locator('#social-tool-remember-key').uncheck();
  await page.locator('#social-tool-settings-save').click();
  await page.reload();
  await page.locator('#social-tool-settings-btn').click();
  assert.equal(await page.locator('#social-tool-api-key').inputValue(), '');
  assert.equal(await page.locator('#social-tool-text-key').inputValue(), '');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.evaluate(() => document.querySelector('.social-tool-settings-page').scrollWidth <= innerWidth));
  await page.screenshot({ path: fileURLToPath(new URL('../docs/preview-mobile.png', import.meta.url)) });
  await page.locator('#social-tool-settings-back').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  assert.ok(calls.every(call => call.auth === 'Bearer browser-test-key'));
  console.log(JSON.stringify({ pageErrors: errors, imageRequests: images.length, selectedSizes: images.slice(0, 3).map(item => item.size), originalReferencesPerRequest: 5, keyPersistence: 'passed', export: '3 PNG + copy.txt', mobileOverflow: false }));
} finally {
  await browser?.close();
  for (const service of [server, upstream]) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
}
