#!/usr/bin/env node
/**
 * 造一个「演示书库」——纯色渐变占位内容，用来截图/录屏，不含任何真实书目。
 *
 *   node _scripts\jm\probe\make-demo.mjs           生成 / 重建
 *   node _scripts\jm\probe\make-demo.mjs --clean   删掉整个演示库
 *
 * 产物：<仓库根>/_demo/
 *   library/    书库根（8 本示例书 + 1 本版式演示 + _manifest.json + src/icons 等）
 *   userdata/   独立的 Electron 配置目录（靠 MANGA_USERDATA 隔离，不碰真实书库）
 *
 * 演示模式启动：双击根目录的「演示模式.cmd」
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..', '..');
const DEMO = path.join(LIB, '_demo');
const L = path.join(DEMO, 'library');
const UD = path.join(DEMO, 'userdata');
const BOOKS = path.join(L, '漫画');

if (process.argv.includes('--clean')) {
  fs.rmSync(DEMO, { recursive: true, force: true });
  console.log('已删除演示库: ' + DEMO);
  process.exit(0);
}

const require2 = createRequire(path.join(LIB, '_app', 'package.json'));
let sharp;
try { sharp = require2('sharp'); } catch (e) {
  console.error('需要 sharp（在 _app/node_modules 里）: ' + e.message);
  process.exit(1);
}

for (const d of [DEMO, L, UD, BOOKS]) fs.mkdirSync(d, { recursive: true });

const mk = (w, h, label, sub, hue, light) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},44%,${light}%)"/>
    <stop offset="1" stop-color="hsl(${(hue + 30) % 360},40%,${light + 9}%)"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2" rx="16"/>
  <text x="${w / 2}" y="${h / 2 - 20}" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 14)}" fill="rgba(255,255,255,.6)" text-anchor="middle">${label}</text>
  <text x="${w / 2}" y="${h / 2 + 60}" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 22)}" fill="rgba(255,255,255,.35)" text-anchor="middle">${sub}</text>
</svg>`);

// 8 本常规示例书
const specs = [
  { name: '示例作品 01', author: '示例作者A', tags: ['示例', '全彩'], cat: '示例分类一' },
  { name: '示例作品 02', author: '示例作者A', tags: ['示例', '短篇'], cat: '示例分类二' },
  { name: '示例作品 03', author: '示例作者B', tags: ['示例', '连载'], cat: '示例分类一' },
  { name: '示例作品 04', author: '示例作者B', tags: ['示例', '全彩', '连载'], cat: '示例分类二' },
  { name: '示例作品 05', author: '示例作者C', tags: ['示例'], cat: '示例分类一' },
  { name: '示例作品 06', author: '示例作者C', tags: ['示例', '短篇'], cat: '示例分类二' },
  { name: '示例作品 07', author: '示例作者D', tags: ['示例', '全彩'], cat: '示例分类一' },
  { name: '示例作品 08', author: '示例作者D', tags: ['示例', '连载'], cat: '示例分类二' },
];
const hues = [210, 330, 150, 30, 270, 190, 345, 100];

for (let i = 0; i < specs.length; i++) {
  const b = specs[i];
  const ch = path.join(BOOKS, b.name, '第01话');
  fs.mkdirSync(ch, { recursive: true });
  for (let p = 1; p <= 3; p++) {
    const buf = mk(960, 1400, b.name, '第 ' + p + ' 页', hues[i], 26 + p * 6);
    await sharp(buf).png().toFile(path.join(ch, String(p).padStart(5, '0') + '.png'));
  }
}

// 版式演示：标准页 / 长条页 / 跨页宽图 / 标准页
const layoutDir = path.join(BOOKS, '版式演示', '第01话');
fs.mkdirSync(layoutDir, { recursive: true });
const layoutPages = [
  ['00001.png', 960, 1400, '标准页 1', '960 × 1400', 210, 28],
  ['00002.png', 960, 4200, '长条页', '960 × 4200', 285, 26],
  ['00003.png', 2400, 1300, '跨页宽图', '2400 × 1300', 145, 30],
  ['00004.png', 960, 1400, '标准页 2', '960 × 1400', 30, 27],
];
for (const [name, w, h, label, sub, hue, light] of layoutPages) {
  await sharp(mk(w, h, label, sub, hue, light)).png().toFile(path.join(layoutDir, name));
}

// library.json（source.site 用白名单里的站名，否则会被判成 18+）
const lib = { categories: ['示例分类一', '示例分类二'], comics: {} };
specs.forEach((b, i) => {
  lib.comics['漫画/' + b.name] = {
    author: b.author, tags: b.tags, categories: [b.cat],
    source: { site: 'weibo' }, favorite: i < 3, note: '',
  };
});
lib.comics['漫画/版式演示'] = {
  author: '示例作者E', tags: ['示例', '版式'], categories: ['示例分类一'],
  source: { site: 'weibo' }, favorite: false, note: '含长条页与跨页宽图',
};
fs.writeFileSync(path.join(L, 'library.json'), JSON.stringify(lib, null, 2), 'utf8');

// 前端资源（应用从 <书库根>/src 加载界面）
for (const from of ['src', 'icons']) {
  const s = path.join(LIB, from);
  if (fs.existsSync(s)) fs.cpSync(s, path.join(L, from), { recursive: true });
}
for (const f of ['service-worker.js', 'manifest.webmanifest']) {
  const s = path.join(LIB, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(L, f));
}

// 独立 userData：config.json 指向演示库
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ libraryRoot: L }, null, 2), 'utf8');

// 生成 manifest
const nodeBin = path.join(LIB, '_scripts', 'tools', 'node', 'node.exe');
const nodeExe = fs.existsSync(nodeBin) ? nodeBin : process.execPath;
const r = spawnSync(nodeExe, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', L, '--offline'], {
  cwd: LIB, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
if (r.status !== 0) { console.error('manifest 生成失败'); process.exit(1); }

console.log('');
console.log('演示库已就绪: ' + DEMO);
console.log('  书: ' + (specs.length + 1) + ' 本（含 1 本「版式演示」，有长条页与跨页宽图）');
console.log('  启动: 双击根目录「演示模式.cmd」');
