#!/usr/bin/env node
/**
 * jm-fast.mjs —— 禁漫「快线」：一条命令替代 run-albums.mjs 的整条重链路
 *
 * 老链路（重，18comic 专用）：
 *   Chrome 9333 + 过 CF + 点「免等待」+ 关广告页 + 会话级验证码 OCR + 表单提交 + 收 <id>.zip + tar 解压
 * 新链路（本文件）：
 *   jmcomic(APP/网页接口 + curl_cffi TLS 指纹 + 图片乱序解码 + 章节/图片多线程) → 切页拼合 → 写 library.json → 重建书库
 *
 * 用法：
 *   node _scripts\jm\jm-fast.mjs JM1452133
 *   node _scripts\jm\jm-fast.mjs 1452133 427413 "https://18comic.vip/album/123456"
 *   node _scripts\jm\jm-fast.mjs 1452133 --from 1 --to 20 --photo-workers 4 --image-workers 16
 *   node _scripts\jm\jm-fast.mjs 1452133 --dry            # 只看章节表
 *   node _scripts\jm\jm-fast.mjs 1452133 --no-stitch      # 不做切页拼合
 *   node _scripts\jm\jm-fast.mjs 1452133 --proxy http://127.0.0.1:7890
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 默认书库 = 本脚本所在的 _scripts\jm 往上两级（哪个书库就用哪个，不再写死路径）
const DEFAULT_LIB = path.resolve(HERE, '..', '..');
const IMG_RE = /\.(webp|jpg|jpeg|png|gif)$/i;

const argv = process.argv.slice(2);
const ids = [];
const opts = {
  lib: DEFAULT_LIB,
  cat: '漫画',
  from: 0,
  to: 0,
  photoWorkers: 8,   // 4 -> 8：解析阶段要逐页拉图址，实测单请求 1.2~1.5 秒，并发 4 时一本要 80 秒
  imageWorkers: 16,
  proxy: '',
  impl: 'api',
  dry: false,
  stitch: true,
  build: true,
  jsonOut: path.join(os.tmpdir(), 'jm-fast-' + Date.now() + '.json'),
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  switch (a) {
    case '--lib': opts.lib = next(); break;
    case '--cat': opts.cat = next(); break;
    case '--from': opts.from = parseInt(next(), 10) || 0; break;
    case '--to': opts.to = parseInt(next(), 10) || 0; break;
    case '--photo-workers': opts.photoWorkers = Math.max(1, parseInt(next(), 10) || 4); break;
    case '--image-workers': opts.imageWorkers = Math.max(1, parseInt(next(), 10) || 16); break;
    case '--proxy': opts.proxy = next(); break;
    case '--impl': opts.impl = next(); break;
    case '--dry': opts.dry = true; break;
    case '--no-stitch': opts.stitch = false; break;
    case '--no-build': opts.build = false; break;
    default:
      if (a.startsWith('--')) { console.log('[参数忽略] ' + a); }
      else ids.push(a);
  }
}
if (!ids.length) {
  console.log('用法: node _scripts\\jm\\jm-fast.mjs <JM号|数字|链接> [...] [--from N --to M] [--dry]');
  process.exit(1);
}

function findPython() {
  const cands = [process.env.PYTHON, 'C:\\Users\\终楠\\AppData\\Local\\Programs\\Python\\Python311\\python.exe', 'python', 'python3'];
  for (const p of cands) {
    if (!p) continue;
    const r = spawnSync(p, ['-c', 'import jmcomic, PIL; print(1)'], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0 && String(r.stdout).includes('1')) return p;
  }
  return null;
}
const PY = findPython();
if (!PY) {
  console.log('[致命] 找不到能 import jmcomic 的 Python。装一下: pip install -U jmcomic');
  process.exit(1);
}

const T0 = Date.now();
console.log('=== 禁漫快线 ===');
console.log('[库]   ' + opts.lib);
console.log('[目标] ' + ids.join(', '));
console.log('[Python] ' + PY);
console.log('');

// ---------- 1) 下载 ----------
const pyArgs = [
  path.join(HERE, 'jmcomic_dl.py'),
  ...ids,
  '--lib', opts.lib,
  '--cat', opts.cat,
  '--photo-workers', String(opts.photoWorkers),
  '--image-workers', String(opts.imageWorkers),
  '--impl', opts.impl,
  '--json', opts.jsonOut,
];
if (opts.from) pyArgs.push('--from', String(opts.from));
if (opts.to) pyArgs.push('--to', String(opts.to));
if (opts.proxy) pyArgs.push('--proxy', opts.proxy);
if (opts.dry) pyArgs.push('--dry');

const child = spawnSync(PY, pyArgs, {
  stdio: 'inherit', timeout: 6 * 3600 * 1000,
  env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
});
if (child.status !== 0 && child.status !== null) console.log('[下载进程退出码] ' + child.status);

let result = null;
try { result = JSON.parse(fs.readFileSync(opts.jsonOut, 'utf8')); }
catch (e) { console.log('[致命] 读不到结果清单: ' + e.message); process.exit(1); }
finally { try { fs.unlinkSync(opts.jsonOut); } catch {} }

if (opts.dry) {
  console.log('\n[dry] 只枚举，不下载、不入库。');
  process.exit(0);
}

// ---------- 2) 切页检测 + 按需拼合 ----------
// jmcomic 直取的图已是解码后的完整页；只有站点确实按高度切过块的，才需要拼。
if (opts.stitch) {
  console.log('\n=== 切页检测 / 按需拼合 ===');
  const env2 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
  let stitched = 0, skipped = 0;
  for (const al of result.albums || []) {
    for (const ch of al.chapters || []) {
      if (!(ch.images > 0) || !ch.dir || !fs.existsSync(ch.dir)) continue;
      const tag = '  第' + String(ch.index).padStart(2, '0') + '話 ';
      const dry = spawnSync(PY, [path.join(HERE, 'stitch-pages.py'), ch.dir, '--dry'], { encoding: 'utf8', env: env2, timeout: 600000 });
      const dryOut = String(dry.stdout || '');
      const m = dryOut.match(/合并\s*(\d+)\s*处/);
      const merged = m ? parseInt(m[1], 10) : -1;
      if (merged === 0) {
        const h = dryOut.match(/页高[^=]*=\s*([\d/]+)/);
        console.log(tag + '完整页 ' + ch.images + ' 张，无需拼合' + (h ? '（页高 ' + h[1] + '）' : ''));
        skipped++;
        continue;
      }
      const full = spawnSync(PY, [path.join(HERE, 'stitch-pages.py'), ch.dir], { encoding: 'utf8', env: env2, timeout: 600000 });
      const tail = String(full.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || ('exit ' + full.status);
      console.log(tag + '拼合 ' + merged + ' 处 | ' + tail);
      stitched++;
    }
  }
  console.log('  小计: 拼合 ' + stitched + ' 话, 原样保留 ' + skipped + ' 话');
}

// ---------- 3) 写 library.json ----------
console.log('\n=== library.json ===');
const libFile = path.join(opts.lib, 'library.json');
let lib = { comics: {} };
try { lib = JSON.parse(fs.readFileSync(libFile, 'utf8')); } catch {}
if (!lib.comics) lib.comics = {};

for (const al of result.albums || []) {
  if (!al.dir || !fs.existsSync(al.dir)) continue;
  const title = path.basename(al.dir);
  const key = opts.cat + '/' + title;
  const prev = lib.comics[key] || {};
  const lines = [
    '来源：禁漫天堂（18comic.vip）',
    '专辑页：https://18comic.vip/album/' + al.id,
  ];
  if (al.author) lines.push('作者：' + al.author);
  if (al.tags && al.tags.length) lines.push('标签：' + al.tags.slice(0, 12).join('、'));
  lines.push('', '共 ' + (al.chapters || []).length + ' 话。');
  lib.comics[key] = Object.assign({ favorite: false, categories: [], tags: [], note: '' }, prev, {
    desc: prev.desc || lines.join('\n'),
    author: prev.author || al.author || '',
    source: { site: '18comic.vip', url: 'https://18comic.vip/album/' + al.id },
  });
  console.log('  ' + key + ' (作者: ' + (al.author || '未标注') + ', ' + (al.chapters || []).length + ' 话)');
}
fs.mkdirSync(path.dirname(libFile), { recursive: true });
fs.writeFileSync(libFile, JSON.stringify(lib, null, 2), 'utf8');

// ---------- 4) 重建书库 ----------
if (!opts.build) { console.log('\n[跳过重建] App 结束时会统一重建'); process.exit(0); }
console.log('\n=== 重建书库 ===');
const buildCands = [
  path.join(opts.lib, '_scripts', 'build-library.mjs'),
  path.join(HERE, '..', 'build-library.mjs'),
];
const buildScript = buildCands.find(f => fs.existsSync(f));
if (!buildScript) console.log('[跳过] 找不到 build-library.mjs');
// 增量：只重建本次真正动过的书，其余从 _manifest.json 沿用（全量要扫 12 万个文件）
const bookRels = (result.albums || [])
  .filter(a => a.dir && fs.existsSync(a.dir))
  .map(a => path.relative(opts.lib, a.dir).replace(/\\/g, '/'))
  .filter(Boolean);
const blArgs = buildScript ? [buildScript, '--lib', opts.lib] : null;
if (blArgs && bookRels.length) {
  blArgs.push('--only', bookRels.join(','));
  console.log('  增量范围: ' + bookRels.join(' , '));
}
const bl = blArgs
  ? spawnSync(process.execPath, blArgs, { stdio: 'inherit', timeout: 600000 })
  : { status: 0 };
if (bl.status !== 0) console.log('[build-library 退出码] ' + bl.status);

// ---------- 汇总 ----------
// 失败要显眼：原来只有一行「失败: JM123(原因)」混在汇总里，界面上根本看不见，
// 用户只会觉得"点了没反应"。现在先大字打一遍再走汇总。
{
  const f0 = Object.entries(result.failed || {});
  if (f0.length) {
    console.log('');
    console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.log('  下载失败（' + f0.length + ' 本）');
    for (const [k, v] of f0) console.log('  JM' + k + ' -> ' + String(v).slice(0, 200));
    console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.log('');
  }
}
console.log('\n=== 汇总 (' + ((Date.now() - T0) / 1000).toFixed(1) + 's) ===');
for (const al of result.albums || []) {
  const got = (al.chapters || []).filter(c => c.images > 0);
  console.log('  ' + String(al.title || '').slice(0, 34) + ' -> ' + got.length + '/' + (al.chapters || []).length + ' 话');
}
const failed = Object.entries(result.failed || {});
if (failed.length) console.log('  失败: ' + failed.map(([k, v]) => 'JM' + k + '(' + v + ')').join(', '));
console.log('  代理: ' + (result.proxy || '直连'));

// 成功判定：至少有一话真的落了图，且没有失败的专辑 —— 失败要交给上层回退到浏览器
const anyOk = (result.albums || []).some(a => (a.chapters || []).some(c => c.images > 0));
const failedCount = Object.keys(result.failed || {}).length;
process.exitCode = (failedCount || !anyOk) ? 1 : 0;
