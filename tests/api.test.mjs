import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { readConfig } from '../server/config.mjs';
import { extractImage, generateImage, parseCopy, validateInput } from '../server/providers.mjs';
import { createSecurity } from '../server/security.mjs';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const image = `data:image/png;base64,${pixel}`;
const input = { prompt: 'A product campaign', images: [image], ratio: '4:5', size: '1024x1280' };
const copy = { content: 'A story for your brand.', hashtags: ['#Brand'], theme: 'Premium product' };

async function serve(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
async function read(request) { let body = ''; for await (const part of request) body += part; return body; }
function respond(response, data, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); }
async function post(base, path, body = input) { return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function config(base, provider = 'gemini') {
  return readConfig({ TEXT_PROVIDER: provider, IMAGE_PROVIDER: provider, TEXT_API_BASE_URL: base, IMAGE_API_BASE_URL: base, TEXT_API_KEY: 'text-secret', IMAGE_API_KEY: 'image-secret', TEXT_MODEL: 'vision-model', IMAGE_MODEL: 'image-model', POLL_INTERVAL_MS: '1', POLL_TIMEOUT_MS: '500', API_TIMEOUT_MS: '1000' });
}

test('demo works without credentials, static assets are self contained, secrets stay private', async () => {
  const server = createApp(readConfig({ TEXT_API_KEY: 'private', IMAGE_API_KEY: 'private-2' }, true));
  const base = await serve(server);
  try {
    const publicData = await (await fetch(base + '/api/config')).text();
    assert.equal(JSON.parse(publicData).demo, true);
    assert.ok(!publicData.includes('private'));
    const page = await (await fetch(base)).text();
    assert.match(page, /社媒内容工作台/);
    for (const file of ['styles.css', 'js/api-client.js', 'js/social-media-tool.js', 'js/boot.js']) assert.equal((await fetch(base + '/' + file)).status, 200);
    const runtime = await (await fetch(base + '/js/social-media-tool.js')).text();
    assert.doesNotMatch(runtime, /n8n|api\.wally|VeoApi|stable_channel/);
    assert.equal((await fetch(base + '/.env')).status, 404);
    const text = await (await post(base, '/api/text')).json();
    assert.match(text.content, /DEMO/);
    const generated = await (await post(base, '/api/images')).json();
    const asset = await fetch(base + generated.url);
    assert.match(asset.headers.get('content-type'), /image\/svg/);
    assert.match(await asset.text(), /4:5/);
  } finally { await close(server); }
});

test('real mode never silently falls back to demo', async () => {
  const server = createApp(readConfig({})); const base = await serve(server);
  try { const result = await post(base, '/api/text'); assert.equal(result.status, 503); assert.match((await result.json()).error, /未配置/); }
  finally { await close(server); }
});

test('native Gemini text and image calls send every product reference and selected ratio', async () => {
  const requests = [];
  const upstream = http.createServer(async (request, response) => {
    const body = JSON.parse(await read(request)); requests.push({ url: request.url, key: request.headers['x-goog-api-key'], body });
    respond(response, { candidates: [{ content: { parts: request.url.includes('vision-model') ? [{ text: JSON.stringify(copy) }] : [{ inlineData: { mimeType: 'image/png', data: pixel } }] } }] });
  });
  const upstreamUrl = await serve(upstream); const server = createApp(config(upstreamUrl)); const base = await serve(server);
  try {
    assert.deepEqual(await (await post(base, '/api/text', { ...input, images: [image, image] })).json(), copy);
    assert.deepEqual(await (await post(base, '/api/images')).json(), { url: image });
    assert.equal(requests[0].key, 'text-secret');
    assert.equal(requests[1].key, 'image-secret');
    assert.equal(requests[0].body.contents[0].parts.length, 3);
    assert.equal(requests[1].body.contents[0].parts[1].inlineData.data, pixel);
    assert.equal(requests[1].body.generationConfig.imageConfig.aspectRatio, '4:5');
  } finally { await close(server); await close(upstream); }
});

test('compatible protocol preserves reference images via multipart edits and normalizes responses', async () => {
  const requests = [];
  const upstream = http.createServer(async (request, response) => {
    requests.push({ url: request.url, auth: request.headers.authorization, type: request.headers['content-type'], body: await read(request) });
    respond(response, request.url.endsWith('/chat/completions') ? { choices: [{ message: { content: '```json\n' + JSON.stringify(copy) + '\n```' } }] } : { data: [{ b64_json: pixel }] });
  });
  const upstreamUrl = await serve(upstream); const server = createApp(config(upstreamUrl + '/v1', 'compatible')); const base = await serve(server);
  try {
    assert.deepEqual(await (await post(base, '/api/text')).json(), copy);
    assert.deepEqual(await (await post(base, '/api/images')).json(), { url: image });
    const text = JSON.parse(requests[0].body);
    assert.equal(text.messages[0].content[1].image_url.url, image);
    assert.equal(requests[1].url, '/v1/images/edits');
    assert.match(requests[1].type, /multipart\/form-data; boundary=/);
    assert.match(requests[1].body, /name="image\[\]"; filename="reference-1.png"/);
    assert.match(requests[1].body, /1024x1536/);
    assert.equal(requests[1].auth, 'Bearer image-secret');
  } finally { await close(server); await close(upstream); }
});

test('custom async jobs poll with encoded IDs, and returned images use a same-origin asset URL', async () => {
  let polls = 0; let submitted;
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/submit') { submitted = JSON.parse(await read(request)); return respond(response, { task_id: 'job/one', status: 'processing' }); }
    if (request.url === '/poll/job%2Fone') { polls++; return respond(response, polls === 1 ? { status: 'processing' } : { url: upstreamUrl + '/result.png', status: 'completed' }); }
    response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(Buffer.from(pixel, 'base64'));
  });
  const upstreamUrl = await serve(upstream); const settings = config(upstreamUrl);
  settings.image = { ...settings.image, provider: 'custom', submitUrl: upstreamUrl + '/submit', pollUrl: upstreamUrl + '/poll/{taskId}' };
  const server = createApp(settings); const base = await serve(server);
  try {
    const response = await post(base, '/api/images'); assert.equal(response.status, 200);
    const result = await response.json(); assert.match(result.url, /^\/api\/assets\//);
    assert.equal(polls, 2); assert.equal(submitted.ratio, '4:5'); assert.deepEqual(submitted.images, [image]);
    const asset = await fetch(base + result.url); assert.equal(asset.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(pixel, 'base64'));
  } finally { await close(server); await close(upstream); }
});

test('failed jobs, invalid model output, and upstream auth errors are surfaced without leaking keys', async () => {
  let mode = 'auth';
  const upstream = http.createServer(async (request, response) => {
    await read(request);
    if (mode === 'auth') return respond(response, { error: { message: 'invalid text-secret' } }, 401);
    if (mode === 'failed') return respond(response, { status: 'failed', url: 'https://example.com/stale.png' });
    if (mode === 'pending') return respond(response, { task_id: 'job', status: 'processing' });
    respond(response, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
  });
  const upstreamUrl = await serve(upstream); const settings = config(upstreamUrl);
  const server = createApp(settings); const base = await serve(server);
  try {
    let result = await post(base, '/api/text'); assert.equal(result.status, 502); assert.doesNotMatch(await result.text(), /text-secret/);
    mode = 'invalid'; result = await post(base, '/api/text'); assert.equal(result.status, 502); assert.match((await result.json()).error, /字段/);
    settings.image = { ...settings.image, provider: 'custom', submitUrl: upstreamUrl, pollUrl: upstreamUrl + '/{taskId}' };
    mode = 'failed'; result = await post(base, '/api/images'); assert.equal(result.status, 502); assert.match((await result.json()).error, /任务失败/);
    mode = 'pending'; settings.pollTimeout = 10; settings.pollInterval = 2; result = await post(base, '/api/images'); assert.equal(result.status, 502); assert.match((await result.json()).error, /轮询超时/);
  } finally { await close(server); await close(upstream); }
});

test('poll deadline timeouts remain distinct from shorter API timeouts and upstream failures', async (t) => {
  // Fix the clock and inject failures so this regression needs no millisecond race.
  t.mock.method(Date, 'now', () => 1000);
  const timeouts = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  const settings = config('https://upstream.invalid');
  settings.image = { ...settings.image, provider: 'custom', submitUrl: 'https://upstream.invalid/submit', pollUrl: 'https://upstream.invalid/poll/{taskId}' };
  settings.pollTimeout = 100;
  let phase, failure, calls;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    if (url.endsWith('/submit')) return new Response(JSON.stringify({ task_id: 'job', status: 'processing' }));
    if (phase === 'headers') throw failure;
    return { text: async () => { throw failure; } };
  });
  for (phase of ['headers', 'body']) {
    for (const scenario of [
      { timeout: 1000, failure: new DOMException('expired', 'TimeoutError'), expected: /任务轮询超时/ },
      { timeout: 20, failure: new DOMException('expired', 'TimeoutError'), expected: /上游 API 请求超时/ },
      { timeout: 1000, failure: new TypeError('connection failed'), expected: /无法连接上游 API/ }
    ]) {
      settings.timeout = scenario.timeout;
      failure = scenario.failure; calls = 0; timeouts.length = 0;
      await assert.rejects(generateImage(input, settings), (error) => {
        assert.equal(error.status, 502);
        assert.match(error.message, scenario.expected);
        return true;
      });
      assert.equal(calls, 2);
      assert.deepEqual(timeouts, [scenario.timeout, Math.min(scenario.timeout, settings.pollTimeout)]);
    }
  }
});

test('invalid requests are rejected before making any model calls', async () => {
  assert.throws(() => validateInput({ ...input, images: [] }), /1–5/);
  assert.throws(() => validateInput({ ...input, images: ['data:image/svg+xml;base64,AAAA'] }), /PNG/);
  assert.throws(() => validateInput({ ...input, ratio: '100:1' }, true), /比例/);
  assert.throws(() => parseCopy('{}'), /字段/);
  assert.equal(extractImage({ candidates: [{ content: { parts: [{ thought: true, inlineData: { data: 'bad' } }, { inline_data: { data: pixel, mime_type: 'image/png' } }] } }] }), image);
  const server = createApp(readConfig({}, true)); const base = await serve(server);
  try {
    assert.equal((await post(base, '/api/images', { ...input, images: [] })).status, 400);
    const invalid = await fetch(base + '/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(invalid.status, 400);
    const origin = await fetch(base + '/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify(input) }); assert.equal(origin.status, 403);
    assert.equal((await fetch(base + '/api/unknown')).status, 404);
  } finally { await close(server); }
});

test('cloud mode requires a configured access code and issues stateless HttpOnly sessions', async () => {
  const missing = createApp(readConfig({ VERCEL: '1' })); const missingBase = await serve(missing);
  try {
    assert.equal((await post(missingBase, '/api/text')).status, 503);
    const session = await (await fetch(missingBase + '/api/session')).json();
    assert.deepEqual(session, { requiresAuth: true, authenticated: false, configured: false });
  } finally { await close(missing); }
  const settings = readConfig({ VERCEL: '1', DEMO_MODE: 'true', APP_ACCESS_CODE: 'test-access-code-12345' });
  let server = createApp(settings); let base = await serve(server); let cookie;
  try {
    assert.equal((await post(base, '/api/images')).status, 401);
    assert.equal((await post(base, '/api/session', { code: 'wrong' })).status, 401);
    const login = await post(base, '/api/session', { code: settings.accessCode });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.doesNotMatch(cookie, /test-access-code/);
    const result = await fetch(base + '/api/images', { method: 'POST', headers: { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(result.status, 200);
    const invalidOrigin = await fetch(base + '/api/images', { method: 'POST', headers: { Cookie: cookie.split(';')[0], Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(invalidOrigin.status, 403);
    await close(server); server = createApp(settings); base = await serve(server);
    const session = await (await fetch(base + '/api/session', { headers: { Cookie: cookie.split(';')[0], Host: 'studio.example.com' } })).json();
    assert.equal(session.authenticated, true);
  } finally { await close(server); }
});

test('encrypted image links survive a new function instance and reject tampering', () => {
  const config = readConfig({ VERCEL: '1', APP_ACCESS_CODE: 'test-access-code-12345' });
  const first = createSecurity(config); const second = createSecurity(config);
  const url = 'https://images.example.com/a.png?token=private-upstream-token';
  const token = first.sealAsset(url);
  assert.doesNotMatch(token, /private-upstream-token/);
  assert.equal(second.openAsset(token), url);
  assert.throws(() => second.openAsset(token.slice(0, -5) + 'AAAAA'), /无效或已过期/);
});

test('large generated base64 images use a streamed response without truncating image quality', async () => {
  const large = 'A'.repeat(6 * 1024 * 1024);
  const upstream = http.createServer(async (request, response) => {
    await read(request); respond(response, { data: [{ b64_json: large }] });
  });
  const upstreamUrl = await serve(upstream); const server = createApp(config(upstreamUrl, 'compatible')); const base = await serve(server);
  try {
    const response = await post(base, '/api/images');
    assert.equal(response.status, 200); assert.equal(response.headers.get('transfer-encoding'), 'chunked'); assert.equal(response.headers.get('content-length'), null);
    const result = await response.json(); assert.equal(result.url, 'data:image/png;base64,' + large);
  } finally { await close(server); await close(upstream); }
});

test('Vercel gateway maps rewritten API paths and preserves demo image query parameters', async () => {
  const previous = { VERCEL: process.env.VERCEL, DEMO_MODE: process.env.DEMO_MODE, APP_ACCESS_CODE: process.env.APP_ACCESS_CODE };
  delete process.env.VERCEL; process.env.DEMO_MODE = 'true'; process.env.APP_ACCESS_CODE = '';
  const { default: gateway } = await import('../api/gateway.mjs?smoke');
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST') {
      const parsed = JSON.parse(await read(request));
      Object.defineProperty(request, 'body', { get: () => parsed });
    }
    return gateway(request, response);
  }); const base = await serve(server);
  try {
    const cfg = await (await fetch(base + '/api/gateway?route=config')).json(); assert.equal(cfg.cloud, true); assert.equal(cfg.demo, true);
    const result = await fetch(base + '/api/gateway?route=demo-image&ratio=9%3A16'); assert.equal(result.status, 200); assert.match(await result.text(), /9:16/);
    const text = await post(base, '/api/gateway?route=text'); assert.equal(text.status, 200); assert.match((await text.json()).content, /DEMO/);
  } finally { await close(server); }
});
