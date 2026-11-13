// 通用: 检查某本是否有新话  node check-update.mjs --url <来源链接> --dir <书名>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SELF = fileURLToPath(import.meta.url);
// 部分漫画站(如 xmanhua)必须走代理; 没设代理就带代理重跑一遍自己
if (process.env.JM_PROXY_READY !== '1') {   // 保证代理环境在进程启动时就位(NODE_USE_ENV_PROXY 必须启动时存在)
  const r = spawnSync(process.execPath, [SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:7890', HTTP_PROXY: 'http://127.0.0.1:7890', NODE_USE_ENV_PROXY: '1', JM_PROXY_READY: '1' },
  });
  process.exit(r.status || 0);
}
const LIB = path.resolve(SELF, '..', '..', '..', '..');
const CAT = '漫画';
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const url = arg('url'), dir = arg('dir') || '';
const out = (o) => console.log('@@RESULT@@ ' + JSON.stringify(o));
const { pick } = await import('../sites/index.mjs');
const adapter = pick(url);
if (!adapter) { out({ ok: false, unsupported: true, msg: '暂不支持该站点: ' + (url || '(空)') }); process.exit(0); }
let local = 0;
if (dir) {
  const bp = path.join(LIB, CAT, dir);
  if (fs.existsSync(bp)) for (const d of fs.readdirSync(bp)) {
    const dp = path.join(bp, d);
    try { if (fs.statSync(dp).isDirectory() && fs.readdirSync(dp).some((f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f))) local++; } catch (e) {}
  }
}
try {
  const list = await adapter.chapters(url);
  // 每话是否已下载: 先按 .fetch-meta.json 的话 id 认, 老引擎的书没有 id 记录就按预期话目录名兜底
  let doneIds = new Set(), existingDirs = new Set();
  if (dir) {
    const bp = path.join(LIB, CAT, dir);
    try { Object.keys(JSON.parse(fs.readFileSync(path.join(bp, '.fetch-meta.json'), 'utf8')).ids || {}).forEach((k) => doneIds.add(String(k))); } catch (e) {}
    try { for (const d of fs.readdirSync(bp)) { if (fs.statSync(path.join(bp, d)).isDirectory()) existingDirs.add(d); } } catch (e) {}
  }
  const expectedName = (c, i) => {
    const t = String(c.title || '').trim();
    const m = t.match(/^第?\s*(\d{1,4})\s*[话話卷]$/);
    if (m) return '第' + String(parseInt(m[1], 10)).padStart(2, '0') + (/卷$/.test(t) ? '卷' : '話');
    if (t) return String(i).padStart(2, '0') + ' ' + t.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    return '第' + String(i).padStart(2, '0') + '話';
  };
  const isDone = (c, i) => !!(c.id && doneIds.has(String(c.id))) || existingDirs.has(expectedName(c, i));
  out({ ok: true, site: adapter.id, total: list.length, local: local, newCount: Math.max(0, list.length - local), lastTitle: list.length ? list[list.length - 1].title : '',
        chapterList: list.map((c, i) => ({ i: i + 1, title: c.title || '', done: isDone(c, i + 1) })) });
} catch (e) { out({ ok: false, msg: String(e.message || e).slice(0, 140) }); }
process.exit(0);