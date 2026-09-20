import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WORK, '..', '..');
const PORT = Number(process.env.PORT || 9580);
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/src/index.html';

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    send(response, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send(response, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': url.pathname === '/_manifest.json' ? 'no-store' : 'no-cache'
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(PORT, HOST, () => {
  console.log('手机端预览: http://127.0.0.1:' + PORT);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const item of nets[name] || []) {
      if (item.family === 'IPv4' && !item.internal) {
        console.log('局域网地址: http://' + item.address + ':' + PORT);
      }
    }
  }
});
