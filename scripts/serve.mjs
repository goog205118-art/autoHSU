import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
export function createStaticServer() {
  return http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
      const url = new URL(request.url, 'http://localhost');
      const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(publicDir, '.' + name);
      if (!filename.startsWith(publicDir)) { response.writeHead(403); return response.end(); }
      const content = await fs.readFile(filename);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(filename)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createStaticServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(8787, '127.0.0.1', () => console.log('社媒工作台：http://127.0.0.1:8787'));
}
