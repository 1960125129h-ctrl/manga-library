// 从 src/data/changelog.js 生成 GitHub Release 正文
//
// 用法：node _scripts/release/gen-notes.mjs 1.1.7
//       node _scripts/release/gen-notes.mjs 1.1.7 > _dist/RELEASE-1.1.7.md
//
// 目的：应用内更新日志和发布页说明只用维护一份数据，避免两边不一致。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = path.join(ROOT, 'src', 'data', 'changelog.js');

const ver = String(process.argv[2] || '').replace(/^v/, '');
if (!ver) {
  console.error('用法: node _scripts/release/gen-notes.mjs <version>   例: 1.1.7');
  process.exit(2);
}

// changelog.js 是 ES 模块但扩展名是 .js，直接 import 会被当成 CommonJS。
// 用 data: URL 现场加载，避免为了这个脚本去改项目 type。
const code = fs.readFileSync(SRC, 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'));
const CHANGELOG = mod.CHANGELOG || [];

const rel = CHANGELOG.find(function (x) { return String(x.v) === ver; });
if (!rel) {
  console.error('changelog.js 里没有版本 ' + ver + '。现有：' + CHANGELOG.map(function (x) { return x.v; }).join(', '));
  process.exit(1);
}

const ORDER = ['新增', '改进', '修复', '其他'];
const buckets = {};
ORDER.forEach(function (k) { buckets[k] = []; });
(rel.items || []).forEach(function (it) {
  var k = ORDER.indexOf(it.t) >= 0 ? it.t : '其他';
  buckets[k].push(String(it.x || '').trim());
});

const out = [];
out.push('## 书库 ' + rel.v);
out.push('');
out.push('> 仓库：https://github.com/1960125129h-ctrl/manga-library');
out.push('> 全部版本：https://github.com/1960125129h-ctrl/manga-library/releases');
out.push('');
out.push('---');
out.push('');
if (rel.tag) { out.push('**' + rel.tag + '**'); out.push(''); }

ORDER.forEach(function (k) {
  if (!buckets[k].length) return;
  out.push('### ' + k);
  out.push('');
  buckets[k].forEach(function (x) { out.push('- ' + x); });
  out.push('');
});

process.stdout.write(out.join('\n'));
