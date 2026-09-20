// 缩略图 worker: 主进程按行喂 {"url","referer","cookie"} 进来, 这里串行拉图写盘, 回 {"ok","key","ext","bytes"}
// 为什么要单独一个进程: NODE_USE_ENV_PROXY 必须在进程启动时就在环境里, 主进程起不来第二次
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
if (process.env.JM_PROXY_READY !== '1') {
  const { spawnSync } = await import('node:child_process');
  const r0 = spawnSync(process.execPath, [SELF], {
    stdio: 'inherit',
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', HTTPS_PROXY: 'http://127.0.0.1:7890', HTTP_PROXY: 'http://127.0.0.1:7890', NODE_USE_ENV_PROXY: '1', JM_PROXY_READY: '1' },
  });
  process.exit(r0.status || 0);
}
const LIB = path.resolve(SELF, '..', '..', '..');
const DIR = path.join(LIB, '_thumbs', 'preview');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const key = (u) => crypto.createHash('sha1').update(String(u)).digest('hex').slice(0, 24);
const extOf = (u, ct) => {
  const m = String(u).split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (/png/i.test(ct || '')) return 'png';
  if (/gif/i.test(ct || '')) return 'gif';
  if (/webp/i.test(ct || '')) return 'webp';
  return 'jpg';
};
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const cookieCache = {};
function cookieFor(referer) {
  try {
    const host = new URL(referer).host.replace(/^www\./, '');
    if (host in cookieCache) return cookieCache[host];
    let ck = '';
    try { ck = fs.readFileSync(path.join(LIB, '_scripts', 'sites', 'cookies', host + '.txt'), 'utf8').trim(); } catch (e) {}
    cookieCache[host] = ck;
    return ck;
  } catch (e) { return ''; }
}
async function one(job) {
  const url = String(job.url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, id: job.id, msg: '不是 http(s) 地址' };
  const referer = String(job.referer || '') || (/(t|i)\d*\.nhentai\.net/.test(url) ? 'https://nhentai.net/' : '');
  const k = key(url);
  for (const e of ['webp', 'jpg', 'png', 'gif']) {
    const f = path.join(DIR, k + '.' + e);
    try { if (fs.existsSync(f) && fs.statSync(f).size > 60) return { ok: true, id: job.id, key: k, ext: e, bytes: fs.statSync(f).size, cached: true }; } catch (e2) {}
  }
  const ck = cookieFor(referer || url);
  const headers = { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' };
  if (referer) headers.Referer = referer;
  if (ck) headers.Cookie = ck;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { headers, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) return { ok: false, id: job.id, msg: 'HTTP ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 60) return { ok: false, id: job.id, msg: '响应太小(' + buf.length + ')' };
    const ext = extOf(url, r.headers.get('content-type'));
    fs.mkdirSync(DIR, { recursive: true });
    const dst = path.join(DIR, k + '.' + ext);
    fs.writeFileSync(dst + '.part', buf);
    fs.renameSync(dst + '.part', dst);
    return { ok: true, id: job.id, key: k, ext: ext, bytes: buf.length };
  } catch (e) {
    return { ok: false, id: job.id, msg: String((e && e.message) || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}
let pending = 0, stdinClosed = false;
const maybeExit = () => { if (stdinClosed && pending === 0) process.exit(0); };
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const s = String(line).trim();
  if (!s) return;
  let job = {};
  try { job = JSON.parse(s); } catch (e) { return; }
  if (job.ping) { say({ ok: true, id: job.id, pong: true }); return; }
  pending++;
  one(job).then(say).catch((e) => say({ ok: false, id: job && job.id, msg: String((e && e.message) || e).slice(0, 120) }))
    .finally(() => { pending--; maybeExit(); });
});
process.stdin.on('close', () => { stdinClosed = true; maybeExit(); });
say({ ok: true, ready: true });
