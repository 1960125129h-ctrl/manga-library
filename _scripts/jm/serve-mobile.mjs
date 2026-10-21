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

/* 阅读器显示偏好(全局一份): GET 读 / POST 写 书库根目录的 reader-prefs.json
   手机端和桌面端读的是同一个文件, 所以电脑上选的显示方式手机上也是 */
const PREFS_FILE = path.join(ROOT, 'reader-prefs.json');
const PREF_KEYS = ['mode', 'fit', 'dir', 'cover', 'sidebar', 'thumbs', 'wheel', 'rev', 'prevRev', 'theme', 'bright'];
function pickPrefs(src) {
  const s = (src && typeof src === 'object') ? src : {};
  const o = {};
  for (const k of PREF_KEYS) if (s[k] !== undefined) o[k] = s[k];
  return o;
}
function handlePrefs(request, response) {
  if (request.method === 'GET') {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch (e) { data = {}; }
    send(response, 200, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
    return true;
  }
  if (request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16384) { try { request.destroy(); } catch (e) {} }   // 16KB 上限: 这只是几个开关, 不该有这么大
    });
    request.on('end', () => {
      try {
        // 先读旧的再合并: 前端万一只传了部分键, 不能把其余偏好冲成默认
        let old = {};
        try { old = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) || {}; } catch (e) { old = {}; }
        const v = Object.assign(pickPrefs(old), pickPrefs(JSON.parse(body || '{}')));
        fs.writeFileSync(PREFS_FILE, JSON.stringify(v, null, 2), 'utf8');
        send(response, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8' });
      } catch (e) {
        send(response, 400, JSON.stringify({ ok: false, msg: String((e && e.message) || e) }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
    });
    return true;
  }
  send(response, 405, 'Method not allowed');
  return true;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api/reader-prefs') { handlePrefs(request, response); return; }
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
