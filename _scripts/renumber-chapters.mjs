#!/usr/bin/env node
/**
 * 把已下载的章节目录改名成"站点真实标题", 并按站点的分组(连载/单行本/番外篇/其他系列)拆成多本书。
 * 只动目录名和 library.json 的条目, 图片文件一个都不动。
 * 用法: node renumber-chapters.mjs --dir "漫画/琉璃龙龙" [--lib "..."] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pick } from './sites/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);

const LIB = arg('lib') || path.resolve(HERE, '..');
const DIR = String(arg('dir') || '').trim();
const DRY = has('dry');
if (!DIR) { console.error('用法: node renumber-chapters.mjs --dir "漫画/书名" [--dry]'); process.exit(1); }
const CAT = DIR.split('/')[0] || '漫画';
const BOOK = DIR.split('/').pop();
const root = path.join(LIB, CAT, BOOK);
if (!fs.existsSync(root)) { console.error('目录不存在: ' + root); process.exit(1); }

const libFile = path.join(LIB, 'library.json');
const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
const ent = (lib.comics || {})[DIR];
if (!ent || !ent.source || !ent.source.url) { console.error('library.json 里没有 ' + DIR + ' 的来源链接, 没法知道章节表'); process.exit(1); }
const adapter = pick(ent.source.url);
if (!adapter) { console.error('来源链接没有对应适配器: ' + ent.source.url); process.exit(1); }

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);
const list = await adapter.chapters(ent.source.url);
console.log('站点: ' + adapter.id + ' | 章表 ' + list.length + ' 条 | 来源: ' + ent.source.url);

// 现在磁盘上的章节目录(带图的)
const cur = fs.readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.readdirSync(path.join(root, e.name)).some((f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)))
  .map((e) => e.name)
  .sort((a, b) => {
    const na = parseInt((a.match(/^(\d+)/) || [])[1] || '0', 10);
    const nb = parseInt((b.match(/^(\d+)/) || [])[1] || '0', 10);
    return na - nb || a.localeCompare(b, 'zh');
  });
console.log('磁盘上已有的章节目录: ' + cur.length + ' 个');
if (cur.length !== list.length) {
  console.error('数量对不上(' + cur.length + ' vs ' + list.length + '), 不敢乱改名。先补齐/删掉多出来的再跑。');
  process.exit(1);
}

// 命名规则: 第N话/第N卷沿用; 番外/插图/附录等用真实标题 + 两位序号
function chDirName(c, n) {
  const t = String(c.title || '').trim();
  const m = t.match(/^第?\s*(\d{1,4})\s*[话話卷]$/);
  if (m) return '第' + String(parseInt(m[1], 10)).padStart(2, '0') + (/卷$/.test(t) ? '卷' : '話');
  if (t) return String(n).padStart(2, '0') + ' ' + safe(t).slice(0, 60);
  return '第' + String(n).padStart(2, '0') + '話';
}
const groupOf = (c) => String(c.group || '').trim();
const groups = [];
for (const c of list) { const g = groupOf(c); if (groups.indexOf(g) < 0) groups.push(g); }
const countOf = (g) => list.filter((c) => groupOf(c) === g).length;
const mainGroup = groups.slice().sort((a, b) => countOf(b) - countOf(a))[0] || '';
const bookOf = (g) => ((g === mainGroup || !g) ? BOOK : BOOK + ' · ' + safe(g));

const sorted = list.slice().sort((a, b) => a.order - b.order || a.index - b.index);
const usedName = {};
const plan = [];
for (const g of groups) {
  const inGroup = sorted.filter((c) => groupOf(c) === g);
  const bdir = path.join(LIB, CAT, bookOf(g));
  inGroup.forEach((c, i) => {
    let name = chDirName(c, i + 1);
    if (usedName[bookOf(g) + '/' + name]) { let k = 2; while (usedName[bookOf(g) + '/' + name + ' (' + k + ')']) k++; name += ' (' + k + ')'; }
    usedName[bookOf(g) + '/' + name] = 1;
    plan.push({ from: path.join(root, cur[sorted.indexOf(c)]), book: bookOf(g), dir: path.join(bdir, name), name: name, title: c.title, group: g });
  });
}
for (const g of groups) console.log('  组「' + (g || '未分组') + '」' + countOf(g) + ' 话 → ' + CAT + '/' + bookOf(g));
console.log('--- 改名计划(前 6 条 / 共 ' + plan.length + ' 条) ---');
plan.slice(0, 6).forEach((p) => console.log('  ' + path.basename(p.from) + '  →  ' + path.basename(path.dirname(p.dir)) + '/' + p.name));
if (DRY) { console.log('(--dry 预览模式, 没动任何东西)'); process.exit(0); }

// 两阶段改名: 先全部挪到临时名, 再挪到目标名 —— 否则"甲的新名字=乙的旧名字"时会互相占位, 改名被跳过
let moved = 0;
const tmpOf = (i) => path.join(root, '__tmp_' + i);
for (let i = 0; i < plan.length; i++) {
  const p = plan[i];
  if (!fs.existsSync(p.from)) continue;
  fs.renameSync(p.from, tmpOf(i));
}
for (let i = 0; i < plan.length; i++) {
  const p = plan[i];
  if (!fs.existsSync(tmpOf(i))) continue;
  fs.mkdirSync(path.dirname(p.dir), { recursive: true });
  if (fs.existsSync(p.dir)) { console.log('  跳过(目标已存在): ' + p.dir); fs.rmSync(tmpOf(i), { recursive: true, force: true }); continue; }
  fs.renameSync(tmpOf(i), p.dir);
  moved++;
}
console.log('已改名 ' + moved + ' 个章节目录');

// library.json: 给每个分书建/更新条目(继承作者/简介/来源)
const booksUsed = [];
for (const p of plan) if (booksUsed.indexOf(p.book) < 0) booksUsed.push(p.book);
for (const b of booksUsed) {
  const key = CAT + '/' + b;
  const prev = lib.comics[key] || {};
  lib.comics[key] = Object.assign({ favorite: false, categories: [], tags: [], note: '' }, prev, {
    author: prev.author || ent.author || '',
    desc: prev.desc || ent.desc || '',
    source: ent.source,
  });
}
fs.writeFileSync(libFile, JSON.stringify(lib, null, 2), 'utf8');
console.log('library.json 条目: ' + booksUsed.join(' / '));
spawnSync(process.execPath, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit' });
console.log('完成, 书库已重建。');
process.exit(0);   // 直接退: 免得 Windows 上 fetch 的连接句柄在退出时触发 libuv 断言
