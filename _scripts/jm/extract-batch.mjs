// extract-batch.mjs —— 按 spec 把一个"批次"从 core.js 搬到新模块(带全套自检)
//
//   node _scripts\jm\extract-batch.mjs _batch.json
//
// spec 字段:
//   module        目标模块路径(相对项目根)
//   header        模块头部注释(字符串数组)
//   fns           要搬走的 core 顶层函数名
//   deleteLines   [{line, contains}] 额外要删的 core 行(1-based)
//   ownState      字符串数组: 由新模块自己持有的状态声明(原样写进模块)
//   inject        由 core 注入的名字(函数或只读状态)
//   initName      init 函数名
//   initAnchor    在 core 里, 把这句 init 调用插到哪一行**之前**(精确文本)
//   coreImportAt  在 core 里, 把 import 插到哪一行**之后**(精确文本)
//
// 把踩过的坑都固化在这: 函数体必须断言是真函数声明 / 大括号配平; 全部 export(有些名字
// 在 core 里是"被当值传出去"而不是被调用); 生成后做 ESM 语法检查; 残留扫描。

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spec = JSON.parse(fs.readFileSync(path.resolve(ROOT, process.argv[2]), 'utf8'));
const CORE = path.join(ROOT, 'src/legacy/core.js');
let core = fs.readFileSync(CORE, 'utf8');
const CRLF = /\r\n/.test(core);
if (CRLF) core = core.replace(/\r\n/g, '\n');
const L = core.split('\n');

const FNRE = /^\s{0,2}(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const decl = {};
L.forEach((l, i) => { const f = l.match(FNRE); if (f) decl[f[1]] = i; });
function body(n) {
  const i = decl[n];
  if (i === undefined) throw new Error('未声明: ' + n);
  const m = L[i].match(FNRE);
  if (!m || m[1] !== n) throw new Error(n + ' 不是函数声明(L' + (i + 1) + '): ' + L[i].trim().slice(0, 60));
  let d = 0, s = false, o = [];
  for (let j = i; j < L.length; j++) { o.push(L[j]); for (const c of L[j]) { if (c === '{') { d++; s = true; } else if (c === '}') d--; } if (s && d === 0) break; }
  if (!s) throw new Error(n + ' 大括号没配平');
  return { from: i, end: i + o.length - 1, text: o.join('\n') };
}

const FNS = spec.fns;
const B = {};
for (const n of FNS) B[n] = body(n);
const segs = FNS.map((n) => [B[n].from, B[n].end]);

// ---- 组装模块文本 ----
const ordered = [...FNS].sort((a, b) => B[a].from - B[b].from);
let moved = ordered.map((n) => B[n].text).join('\n');
if (moved.indexOf(String.fromCharCode(96)) >= 0) throw new Error('搬走的代码里有模板字符串, 缩进需人工确认');
let modBody = moved.split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n');
for (const n of FNS) {
  // 必须带上 (?:async\s+)? —— core 里有 7 个 async 顶层函数(renameBookDir/mergeBook/
  // multiUpdate/checkUpdate/doRebuild/delImage/delChapter), 漏了它们加不上 export。
  // 这个坑在依赖分析里踩过一次, 写这个生成器时又踩了一次。
  const re = new RegExp('(^|\\n)((?:async\\s+)?function\\s+' + n + '\\s*\\()');
  if (!re.test(modBody)) throw new Error('加 export 失败: ' + n);
  modBody = modBody.replace(re, '$1export $2');
}
for (const n of FNS) if (!new RegExp('(^|\\n)export\\s+(?:async\\s+)?function\\s+' + n + '\\s*\\(').test(modBody)) throw new Error('export 校验失败: ' + n);

// import 映射 **自动扫描** src/ 得到 —— 手写表必然跟不上(已经漏过一次:
// book-actions 里的 deleteMany/keepScroll 没被认出, 靠静态守卫才抓回来)。
// 只认 export 出去的名字, 只在这些模块里找: 排除 legacy/(被抽的源头)、lib/、main.js。
const stripLite = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:\\.|[^'\\])*'/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""');
// 按**顶层逗号**切。不能直接 split(','): export const S = { ci: 0, pi: 0, ... } 里的
// 对象键会被当成导出名 —— 这一版就因此把 q/dir 认成了 app/state.js 的导出(踩过)。
const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const OWNER = new Map();                 // 名字 -> 模块路径(相对 src/)
{
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['legacy', 'lib', 'node_modules'].includes(e.name)) walk(p); continue; }
      if (!e.name.endsWith('.js') || e.name === 'main.js') continue;
      const rel = path.relative(path.join(ROOT, 'src'), p).replace(/\\/g, '/');
      if (rel === spec.module.replace(/^src\//, '')) continue;   // 别 import 自己
      const t = stripLite(fs.readFileSync(p, 'utf8'));
      const add = (n) => { if (!OWNER.has(n)) OWNER.set(n, rel); };
      for (const m of t.matchAll(/(?:^|\n)\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
      for (const m of t.matchAll(/(?:^|\n)\s*export\s+(?:var|let|const)\s+([^;\n]*)/g))
        for (const q of splitTop(String(m[1]))) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) add(n[1]); }
      for (const m of t.matchAll(/(?:^|\n)\s*export\s*\{([^}]*)\}/g))
        for (const q of String(m[1]).split(',')) { const n = q.trim().replace(/^.*\s+as\s+/, '').match(/^([A-Za-z_$][\w$]*)/); if (n) add(n[1]); }
    }
  };
  walk(path.join(ROOT, 'src'));
}
const strip = (t) => stripLite(t).replace(/`(?:\\.|[^`\\])*`/g, '""');
const ids = new Set();
for (const m of strip(modBody).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
const byMod = new Map();
for (const n of ids) { const owner = OWNER.get(n); if (!owner) continue; if (!byMod.has(owner)) byMod.set(owner, []); byMod.get(owner).push(n); }
const imports = [...byMod.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([mod, names]) => "import { " + names.join(', ') + " } from '" + (mod.startsWith('shared/') || mod.startsWith('app/') || mod.startsWith('shelf/') || mod.startsWith('reader/') || mod.startsWith('settings/') || mod.startsWith('download/') || mod.startsWith('library/') || mod.startsWith('shell/') ? '../' + mod : mod) + "';");
const injNames = spec.inject || [];
const H = (spec.header || []).join('\n');
const OWN = (spec.ownState || []).join('\n');
const INJL = injNames.length ? ('let ' + injNames.join(', ') + ';') : '';
const INIT = [
  '',
  '// ---- 由 core 注入 ----',
  INJL,
  '',
  'export function ' + spec.initName + '(ctx) {',
  '  ' + injNames.map((n) => n + ' = ctx.' + n).join('; '),
  '}',
  '',
].join('\n');
const modText = H + '\n\n' + imports.join('\n') + '\n\n' + (OWN ? OWN + '\n\n' : '') + modBody + '\n' + INIT;
const modPath = path.join(ROOT, spec.module);
fs.mkdirSync(path.dirname(modPath), { recursive: true });
fs.writeFileSync(modPath, modText);
console.log('  写出 ' + spec.module + ': ' + (modText.length / 1024).toFixed(1) + ' KB, ' + modText.split('\n').length + ' 行');

// ---- 从 core 删掉 ----
for (const d of (spec.deleteLines || [])) {
  const ln = d.line - 1;
  if (L[ln].indexOf(d.contains) < 0) throw new Error('L' + d.line + ' 不含 "' + d.contains + '": ' + L[ln].trim().slice(0, 70));
  if (segs.some(([a, b]) => ln >= a && ln <= b)) throw new Error('L' + d.line + ' 落在要删的函数里了');
  segs.push([ln, ln]);
}
// 改写一行(多变量声明里只拿走其中几个时用): 原行**保留**, 内容换成 to。
// 注意不能把它也塞进 delSet —— 那样换完内容又会被删掉(第一版就是这么错的)。
const rwMap = new Map();
for (const d of (spec.rewriteLines || [])) {
  const ln = d.line - 1;
  if (L[ln].indexOf(d.contains) < 0) throw new Error('L' + d.line + ' 不含 "' + d.contains + '"');
  if (segs.some(([a, b]) => ln >= a && ln <= b)) throw new Error('L' + d.line + ' 落在要删的函数里了');
  rwMap.set(ln, d.to);
}
const sortedChk = [...segs].sort((a, b) => a[0] - b[0]);
for (let i = 1; i < sortedChk.length; i++) if (sortedChk[i][0] <= sortedChk[i - 1][1]) throw new Error('删除段重叠: ' + JSON.stringify(sortedChk[i - 1]) + '/' + JSON.stringify(sortedChk[i]));
const delSet = new Set();
for (const [a, b] of segs) for (let i = a; i <= b; i++) delSet.add(i);
core = L.map((l, i) => (rwMap.has(i) ? rwMap.get(i) : l)).filter((_, i) => !delSet.has(i)).join('\n');
console.log('  删除 ' + delSet.size + ' 行' + (rwMap.size ? (' / 改写 ' + rwMap.size + ' 行') : ''));

// 锚点按**行子串**找, 不按精确缩进 —— 数空格太容易错(踩过)
function insertAfterLine(needle, text, tag) {
  const idx = core.split('\n').findIndex((l) => l.indexOf(needle) >= 0);
  if (idx < 0) throw new Error('[' + tag + '] 找不到含 "' + needle.slice(0, 50) + '" 的行');
  const ls = core.split('\n'); ls.splice(idx + 1, 0, text); core = ls.join('\n');
  console.log('  ok  ' + tag + '  (插在 L' + (idx + 1) + ' 之后)');
}
function insertBeforeLine(needle, text, tag) {
  const idx = core.split('\n').findIndex((l) => l.indexOf(needle) >= 0);
  if (idx < 0) throw new Error('[' + tag + '] 找不到含 "' + needle.slice(0, 50) + '" 的行');
  const ls = core.split('\n'); ls.splice(idx, 0, text); core = ls.join('\n');
  console.log('  ok  ' + tag + '  (插在 L' + (idx + 1) + ' 之前)');
}
insertAfterLine(spec.coreImportAt, "import { " + spec.initName + ", " + FNS.join(', ') + " } from '" + spec.module.replace(/^src\//, '../') + "';", 'core import');
insertBeforeLine(spec.initAnchor, '    ' + spec.initName + '({ ' + injNames.map((n) => n + ': ' + n).join(', ') + ' });', 'init 调用');

core = core.replace(/\n{4,}/g, '\n\n\n');
// 残留检查: 这些名字不该再在 core 里被定义
let bad = 0;
core.split('\n').forEach((l, i) => { for (const n of FNS) if (new RegExp('^\\s{0,2}(?:async\\s+)?function\\s+' + n + '\\s*\\(').test(l)) { console.log('  !! 仍在定义 ' + n + ' @L' + (i + 1)); bad++; } });
if (bad) throw new Error('有函数没搬干净');
if (CRLF) core = core.replace(/\n/g, '\r\n');
fs.writeFileSync(CORE, core);
console.log('  core: ' + L.length + ' -> ' + core.split('\n').length + ' 行');

// ---- ESM 语法检查 ----
for (const f of [spec.module, 'src/legacy/core.js']) {
  try { new vm.SourceTextModule(fs.readFileSync(path.join(ROOT, f), 'utf8')); console.log('  语法 OK  ' + f); }
  catch (e) { throw new Error('语法错 ' + f + ': ' + e.message); }
}
console.log('完成');
