// 把一本书里所有文件夹的图片合并到一个文件夹(_合并/全部), 跨话连续编号
// 用法: node _scripts\merge-book.mjs --dir "漫画/柳醨"        (或 --book "柳醨")
//       node _scripts\merge-book.mjs --dir "漫画/柳醨" --rebuild   合并后顺手重建书库.html
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && argv[i + 1].charAt(0) !== '-' ? argv[i + 1] : (d || ''); };
const MERGEDIR = '全部';
const isImg = (f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f);
const natCmp = (a, b) => String(a).localeCompare(String(b), 'zh', { numeric: true, sensitivity: 'base' });

let dir = arg('dir', '');
if (!dir) { const b = arg('book', ''); if (b) dir = '漫画/' + b; }
if (!dir) { console.log('用法: node _scripts\\merge-book.mjs --dir "漫画/书名" [--rebuild]'); process.exit(1); }
const bookDir = path.resolve(LIB, dir);
if (!bookDir.startsWith(path.resolve(LIB) + path.sep) || !fs.existsSync(bookDir)) { console.log('书目录不存在: ' + dir); process.exit(1); }

// 收集所有图片(含根目录散图和 全部 里的), 按 (相对路径) 自然序 = 先文件夹后文件名
const found = [];
(function walk(d2, rel) {
  let ents = [];
  try { ents = fs.readdirSync(d2, { withFileTypes: true }); } catch (e) { return; }
  for (const en of ents) {
    if (en.name.charAt(0) === '.') continue;
    const r2 = rel ? rel + '/' + en.name : en.name;
    if (en.isDirectory()) walk(path.join(d2, en.name), r2);
    else if (isImg(en.name)) found.push({ p: path.join(d2, en.name), rel: r2, name: en.name });
  }
})(bookDir, '');
found.sort((a, b) => natCmp(a.rel, b.rel));
if (!found.length) { console.log('这本书里没找到图片: ' + dir); process.exit(1); }

const target = path.join(bookDir, MERGEDIR);
fs.mkdirSync(target, { recursive: true });
const pad = Math.max(4, String(found.length).length);
const finals = found.map((f, i) => ({ src: f.p, dst: path.join(target, String(i + 1).padStart(pad, '0') + path.extname(f.name).toLowerCase()) }));
finals.forEach((f, i) => { try { fs.renameSync(f.src, path.join(target, '__tmp_' + i)); } catch (e) {} });   // 两阶段, 避免互相覆盖
let moved = 0;
finals.forEach((f, i) => { try { fs.renameSync(path.join(target, '__tmp_' + i), f.dst); moved++; } catch (e) {} });

// 清掉腾空的文件夹
let removed = 0;
for (const en of fs.readdirSync(bookDir, { withFileTypes: true })) {
  if (!en.isDirectory() || en.name === MERGEDIR) continue;
  const d2 = path.join(bookDir, en.name);
  try { if (!fs.readdirSync(d2).length) { fs.rmdirSync(d2); removed++; } } catch (e) {}
}
console.log('已合并 ' + moved + ' 张图片到 ' + dir + '/' + MERGEDIR + (removed ? '（清掉 ' + removed + ' 个空文件夹）' : ''));
if (argv.includes('--rebuild')) spawnSync(process.execPath, [path.join(HERE, 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit' });
