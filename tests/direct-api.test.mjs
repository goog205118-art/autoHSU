import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { once } from 'node:events';
import { createStaticServer } from '../scripts/serve.mjs';

const source = fs.readFileSync(new URL('../public/js/direct-api.js', import.meta.url), 'utf8');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const image = 'data:image/png;base64,' + pixel;
const input = { prompt: 'Return JSON with content, hashtags and theme.', images: [image, image], ratio: '4:5' };
const copy = { content: 'A product story', hashtags: ['#Brand'], theme: 'Premium' };
const plain = value => JSON.parse(JSON.stringify(value));
function setup(fetcher = () => { throw Error('Unexpected API call'); }, storage = new Map()) {
  const requests = [];
  const window = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  } };
  vm.runInNewContext(source, { window, URL, FormData, Blob, Uint8Array, atob, AbortSignal, TypeError,
    fetch: async (url, options) => { requests.push({ url, ...options }); return fetcher(url, options); }
  });
  return { api: window.SocialApi, requests, storage, window };
}
function configure(api, changes = {}) { return api.saveConnection({ ...api.getConnection(), key: 'sample-key', ...changes }); }

test('workspace configuration works offline and missing keys never trigger requests', async () => {
  const { api, requests } = setup();
  assert.equal(api.getConnection().base, 'https://api.openlux.ai/v1');
  assert.equal(api.getConnection().rememberKey, false);
  assert.equal((await api.getConfig()).image.ready, false);
  await assert.rejects(api.ensureReady(), /API Key/);
  assert.equal(requests.length, 0);
});

test('keys stay in memory unless remembered; unchecking clears both saved keys', () => {
  const { api, storage } = setup();
  configure(api, { textKey: 'separate-key' });
  assert.doesNotMatch([...storage.values()].join(''), /sample-key|separate-key/);
  assert.equal(api.getConnection().key, 'sample-key');
  assert.equal(setup(undefined, storage).api.getConnection().key, '');
  configure(api, { textKey: 'separate-key', rememberKey: true });
  assert.equal(setup(undefined, storage).api.getConnection().textKey, 'separate-key');
  configure(api, { rememberKey: false });
  assert.doesNotMatch([...storage.values()].join(''), /sample-key|separate-key/);
  assert.equal(setup(undefined, storage).api.getConnection().key, '');
});

test('invalid connections and storage errors do not overwrite the working connection', () => {
  const { api, window } = setup();
  configure(api, { base: 'https://provider.example/v1/images/edits', key: 'Bearer sample-key' });
  assert.equal(api.getConnection().base, 'https://provider.example/v1');
  for (const base of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com?a=1']) assert.throws(() => configure(api, { base }), /API 地址/);
  assert.throws(() => configure(api, { key: 'a\nb' }), /空格或换行/);
  assert.throws(() => configure(api, { timeout: 0 }), /30–1800/);
  window.localStorage.setItem = () => { throw Error('quota'); };
  assert.throws(() => configure(api, { key: 'changed-key' }), /未能保存/);
  assert.equal(api.getConnection().key, 'sample-key');
});

test('Responses sends all references with the configured model and parses message output', async () => {
  const { api, requests } = setup(() => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(copy) }] }] }));
  configure(api);
  assert.deepEqual(plain(await api.generateText(input)), copy);
  const request = requests[0], body = JSON.parse(request.body);
  assert.equal(request.url, 'https://api.openlux.ai/v1/responses');
  assert.equal(request.headers.Authorization, 'Bearer sample-key');
  assert.equal(request.credentials, 'omit');
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.store, false); assert.equal(body.stream, false);
  assert.deepEqual(body.input[0].content.slice(1).map(part => part.image_url), input.images);
  assert.equal(body.text.format.type, 'json_object');
});

test('Chat Completions can use an independent text connection and strips JSON fences', async () => {
  const { api, requests } = setup(() => Response.json({ choices: [{ message: { content: '```json\n' + JSON.stringify(copy) + '\n```' } }] }));
  configure(api, { useImageConnection: false, textBase: 'https://text.example/v1', textKey: 'text-key', textProtocol: 'chat', textModel: 'vision-model' });
  assert.deepEqual(plain(await api.generateText(input)), copy);
  assert.equal(requests[0].url, 'https://text.example/v1/chat/completions');
  assert.equal(requests[0].headers.Authorization, 'Bearer text-key');
  const body = JSON.parse(requests[0].body);
  assert.equal(body.model, 'vision-model');
  assert.deepEqual(body.messages[0].content.slice(1).map(part => part.image_url.url), input.images);
});

test('GPT Image uses repeated image fields, original bytes, selected sizes and OpenLux format rules', async () => {
  const { api, requests } = setup(() => Response.json({ data: [{ b64_json: pixel }] }));
  configure(api);
  assert.equal((await api.generateImage(input)).url, image);
  const request = requests[0], form = request.body;
  assert.equal(request.url, 'https://api.openlux.ai/v1/images/edits');
  assert.equal(request.headers['Content-Type'], undefined);
  assert.equal(form.get('model'), 'gpt-image-2');
  assert.equal(form.get('n'), '1'); assert.equal(form.get('size'), '1024x1280');
  assert.equal(form.get('quality'), 'high'); assert.equal(form.get('format'), 'png');
  assert.equal(form.get('response_format'), 'b64_json');
  assert.equal(form.getAll('image').length, 2); assert.equal(form.has('image[]'), false);
  assert.deepEqual(Buffer.from(await form.getAll('image')[1].arrayBuffer()), Buffer.from(pixel, 'base64'));
  await api.generateImage({ ...input, ratio: '9:16' });
  assert.equal(requests[1].body.get('size'), '720x1280');
});

test('legacy image sizes, fidelity, output formats and explicit format overrides follow the reference', async () => {
  const { api, requests } = setup(() => Response.json({ output_format: 'webp', data: [{ b64_json: pixel }] }));
  configure(api, { imageModel: 'gpt-image-1.5', format: 'webp' });
  assert.match((await api.generateImage(input)).url, /^data:image\/webp/);
  assert.equal(requests[0].body.get('size'), '1024x1536');
  assert.equal(requests[0].body.get('input_fidelity'), 'high');
  assert.equal(requests[0].body.get('output_format'), 'webp');
  assert.equal(requests[0].body.has('response_format'), false);
  configure(api, { imageModel: 'gpt-image-2.5-flare', quality: 'xhigh', formatField: 'format' });
  await api.generateImage(input);
  assert.equal(requests[1].body.get('format'), 'webp');
  await assert.rejects(api.generateImage({ ...input, prompt: 'x'.repeat(1001) }), /1000/);
});

test('failed, timed out and disconnected requests never retry automatically and redact keys', async () => {
  for (const failure of [
    () => Response.json({ error: { message: 'invalid sample-key' } }, { status: 401 }),
    () => { throw new DOMException('expired', 'TimeoutError'); },
    () => { throw new TypeError('Failed to fetch'); }
  ]) {
    const { api, requests } = setup(failure); configure(api);
    await assert.rejects(api.generateImage(input), error => {
      assert.doesNotMatch(error.message, /sample-key/);
      assert.match(error.message, /401|等待中断|CORS/); return true;
    });
    assert.equal(requests.length, 1);
  }
});

test('invalid image inputs and invalid copy output produce useful errors', async () => {
  const { api, requests } = setup(() => Response.json({ output_text: '{}' })); configure(api);
  await assert.rejects(api.generateImage({ ...input, images: [] }), /1–5/);
  await assert.rejects(api.generateImage({ ...input, images: ['javascript:alert(1)'] }), /PNG/);
  await assert.rejects(api.generateImage({ ...input, ratio: '100:1' }), /比例/);
  assert.equal(requests.length, 0);
  await assert.rejects(api.generateText(input), /字段/);
});

test('model lookup uses a read-only authenticated request without changing saved settings', async () => {
  const { api, requests } = setup(() => Response.json({ data: [{ id: 'gpt-image-2' }, { id: 'vision' }, { id: 'vision' }] }));
  const models = await api.listModels({ base: 'https://provider.example/v1/images/edits', key: 'lookup-key' });
  assert.deepEqual(plain(models), ['gpt-image-2', 'vision']);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, 'https://provider.example/v1/models');
  assert.equal(requests[0].headers.Authorization, 'Bearer lookup-key');
  assert.equal(api.getConnection().key, '');
});

test('deployment contains only a static page, no login, environment config or API handlers', async () => {
  const server = createStaticServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await (await fetch(base)).text();
    assert.match(page, /社媒内容工作台/); assert.doesNotMatch(page, /access-gate|access-code/);
    for (const asset of ['styles.css', 'js/direct-api.js', 'js/social-media-tool.js', 'js/boot.js']) assert.equal((await fetch(base + '/' + asset)).status, 200);
    assert.equal((await fetch(base + '/api/session')).status, 404);
    const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url)));
    assert.equal(config.functions, undefined); assert.equal(config.rewrites, undefined);
    for (const file of ['api/gateway.mjs', 'server/security.mjs', '.env.example']) assert.equal(fs.existsSync(new URL('../' + file, import.meta.url)), false);
    const runtime = source + fs.readFileSync(new URL('../public/js/boot.js', import.meta.url)) + fs.readFileSync(new URL('../public/js/social-media-tool.js', import.meta.url));
    assert.doesNotMatch(runtime, /APP_ACCESS_CODE|DEMO_MODE|process\.env|\/api\/session|\/api\/config|\/api\/images/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
