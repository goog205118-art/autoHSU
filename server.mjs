import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { loadEnv, readConfig, publicConfig } from './server/config.mjs';
import { ApiError, validateInput, generateText, generateImage } from './server/providers.mjs';
import { createSecurity } from './server/security.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const MAX_BODY = 40 * 1024 * 1024;
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
async function readJson(request, maxBody = MAX_BODY) {
  if (!String(request.headers['content-type']).startsWith('application/json')) throw new ApiError('请使用 application/json', 415);
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBody) throw new ApiError('上传内容过大，请压缩参考图', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('请求 JSON 格式无效', 400); }
}
function demoCopy() {
  return { content: '[DEMO / 演示文案]\nMake every day a little more extraordinary. Discover your next favorite product and bring a fresh perspective to the everyday.\n\nExplore the collection today.', hashtags: ['#Demo', '#ProductStory', '#EverydayStyle'], theme: 'Demo product campaign' };
}
function demoImage(ratio) {
  const [a, b] = ratio.split(':').map(Number);
  const width = 960, height = Math.round(960 * b / a);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#dceafa"/><stop offset="1" stop-color="#f7e8d8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="480" cy="${height / 2}" r="220" fill="#fff" opacity=".5"/><rect x="360" y="${height / 2 - 180}" width="240" height="360" rx="65" fill="#7898b9"/><rect x="405" y="${height / 2 - 215}" width="150" height="65" rx="15" fill="#466283"/><text x="480" y="${height / 2 + 10}" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#fff">DEMO</text><text x="480" y="${height - 64}" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#466283">SAMPLE IMAGE / ${ratio}</text></svg>`;
}

async function streamBody(response, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.flushHeaders?.();
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    if (!response.write(bytes.subarray(offset, offset + 64 * 1024))) await once(response, 'drain');
  }
  response.end();
}

export function createHandler(config) {
  const security = createSecurity(config);
  return async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const host = String(request.headers.host || '');
      if (!config.cloud && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new ApiError('仅支持本机访问', 403);
      if (request.method === 'POST') {
        const origin = request.headers.origin;
        if (origin && origin !== `${config.cloud ? 'https' : 'http'}://${host}`) throw new ApiError('来源不匹配', 403);
      }
      if (url.pathname === '/api/session') {
        if (request.method === 'GET') return json(response, 200, { requiresAuth: security.requiresAuth, authenticated: security.isAuthenticated(request), configured: security.configured });
        if (request.method === 'POST') {
          const input = await readJson(request, 4096);
          response.setHeader('Set-Cookie', security.login(input.code));
          return json(response, 200, { authenticated: true });
        }
      }
      if (url.pathname === '/api/config' && request.method === 'GET') return json(response, 200, publicConfig(config));
      if (url.pathname.startsWith('/api/')) security.requireAuth(request);
      if (url.pathname === '/api/demo-image' && request.method === 'GET' && config.demo) {
        const ratio = ['1:1', '4:5', '9:16', '16:9', '2:3', '3:2'].includes(url.searchParams.get('ratio')) ? url.searchParams.get('ratio') : '1:1';
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        return response.end(demoImage(ratio));
      }
      if (url.pathname.startsWith('/api/assets/') && request.method === 'GET') {
        const assetUrl = security.openAsset(url.pathname.slice('/api/assets/'.length));
          const upstream = await fetch(assetUrl, { signal: AbortSignal.timeout(config.timeout), redirect: 'follow' });
          const mime = upstream.headers.get('content-type')?.split(';')[0];
          if (!upstream.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new ApiError('无法读取上游生成图片');
          const body = Buffer.from(await upstream.arrayBuffer());
          if (body.length > MAX_BODY) throw new ApiError('生成图片过大');
        response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        return await streamBody(response, body);
      }
      if (['/api/text', '/api/images'].includes(url.pathname) && request.method === 'POST') {
        const input = validateInput(await readJson(request, config.cloud ? 3500000 : MAX_BODY), url.pathname === '/api/images');
        if (url.pathname === '/api/text') return json(response, 200, config.demo ? demoCopy() : await generateText(input, config));
        let result;
        if (config.demo) result = { url: `/api/demo-image?ratio=${encodeURIComponent(input.ratio)}` };
        else {
          result = await generateImage(input, config);
          if (/^https?:/i.test(result.url)) result = { ...result, url: `/api/assets/${security.sealAsset(result.url)}` };
        }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
        return await streamBody(response, JSON.stringify(result));
      }
      if (url.pathname.startsWith('/api/')) throw new ApiError('接口不存在或方法不支持', 404);
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new ApiError('方法不支持', 405);
      const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(publicDir, '.' + name);
      if (!filename.startsWith(publicDir + path.sep)) throw new ApiError('路径无效', 403);
      let content;
      try { content = await fs.readFile(filename); }
      catch { throw new ApiError('文件不存在', 404); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(filename)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      json(response, error.status || 502, { error: error instanceof ApiError ? error.message : '服务请求失败，请检查上游 API 与网络' });
    }
  };
}

export function createApp(config) {
  return http.createServer(createHandler(config));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  loadEnv(path.join(root, '.env'));
  const config = readConfig(process.env, process.argv.includes('--demo'));
  const server = createApp(config);
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用，请修改 .env 中的 PORT` : error.message); process.exitCode = 1; });
  server.listen(config.port, '127.0.0.1', () => console.log(`社媒工作台 http://127.0.0.1:${config.port} ${config.demo ? '[演示模式：模拟数据]' : '[真实 API 模式]'}`));
}
