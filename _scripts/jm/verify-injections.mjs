// verify-injections.mjs —— 静态检查: 每个抽出来的模块, 它用到的 core 顶层名字是否都注入了
//
// 为什么需要这个: 动态测试只覆盖走到的路径。Block 4a 搬走 showImgCtx 之后,
// 它调的 delImage 没被注入 —— 点"删除这张图"就 ReferenceError, 而当时 119 项
// 全过(没有一项会真的去删图片)。同理 Block 2 搬下载面板时漏了 doRebuild
// (只有"非增量重建"那条路会走到)。
//
// 这类漏注入是纯静态问题, 不需要跑 App 就能查出来, 所以在这里一次查干净:
//   对每个模块, 算出"自由标识符"里命中 core 顶层名字的那些;
//   减去它自己声明的、import 进来的、init* 注入的;
//   剩下命中 core 顶层名 -> 忘了注入; 命中别的模块声明的名字 -> 忘了 import。
//
//   node _scripts\jm\verify-injections.mjs
// 退出码 0 = 全过

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };

// ---------- 1. 解析 core 顶层声明(必须支持 async function, 这是踩过的坑) ----------
const coreText = fs.readFileSync(path.join(ROOT, 'src/legacy/core.js'), 'utf8');
const FNRE = /^\s{0,2}(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const VARRE = /^\s{0,2}(?:var|let|const)\s+(.*?);\s*(?:\/\/.*)?$/;
const topFns = new Set(), topVars = new Set();
for (const l of coreText.split('\n')) {
  const f = l.match(FNRE);
  if (f) { topFns.add(f[1]); continue; }
  const m = l.match(VARRE);
  if (!m) continue;
  let d = 0, cur = '';
  const push = (s) => { const n = (s.trim().match(/^([A-Za-z_$][\w$]*)/) || [])[1]; if (n) topVars.add(n); };
  for (const ch of m[1]) {
    if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { push(cur); cur = ''; } else cur += ch;
  }
  push(cur);
}
// 自洽校验: 解析结果必须恰好覆盖文件里所有"函数声明行"。
// 别写死数量(99 那次撞翻了 >100 的门槛)、也别写死函数名(render 被搬走后又撞翻一次) ——
// 这类断言会随着 core 被抽空而自己烂掉。自洽校验永远不会腐坏。
const fnLines = [...coreText.matchAll(/^\s{0,2}(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
chk('core 顶层声明解析正常', fnLines.length === topFns.size && fnLines.every((n) => topFns.has(n)),
  topFns.size + ' 个函数 / ' + topVars.size + ' 个状态(与函数声明行一一对应)');
// 别拿"core 里还有某个 async 函数"当断言 —— 全搬走之后它就不成立了(又烂一次)。
// 直接拿一个合成样本测正则本身, 永远成立。
chk('解析器认识 async function', FNRE.exec('  async function foo() {}')?.[1] === 'foo' && VARRE.test('  var a = 1;'),
  'async function / 生成器 / 多变量声明');

// ---------- 2. 自动发现 src/ 下的模块(不要手写清单 —— 手写早晚会漏掉新加的模块) ----------
// 排除: legacy/(被抽的源头)、main.js + lib/(启动装配层, 不参与按域抽取)
function listModules() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['legacy', 'lib', 'node_modules'].includes(e.name)) continue;
        walk(p);
      } else if (e.name.endsWith('.js') && e.name !== 'main.js') {
        out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.sort();
}
const MODULES = listModules();
chk('自动发现到模块', MODULES.length >= 8, MODULES.length + ' 个: ' + MODULES.join(' '));

// ---------- 3. 每个模块 export 了哪些名字(别的模块要用就必须 import) ----------
// 只收 export 出去的: 那才是模块之间的 API 面。把所有顶层声明都收进来会有大量噪音
// (各模块内部同名的小局部变量), 检查会淹没在误报里 —— 试过, 18/22 全红。
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:\\.|[^'\\])*'/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '""');

// 按**顶层逗号**切 —— export const S = { ci: 0, pi: 0, ... } 直接 split(',') 会把对象键
// 当成导出名(生成器那边就是这么认错 q/dir 的, 同一个坑)。
const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const OWNERS = new Map();   // 名字 -> [export 它的模块...]
function exportNames(text) {
  const out = new Set();
  const t = strip(text);
  for (const m of t.matchAll(/(?:^|\n)\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of t.matchAll(/(?:^|\n)\s*export\s+(?:var|let|const)\s+([^;\n]*)/g)) {
    for (const q of splitTop(String(m[1]))) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) out.add(n[1]); }
  }
  for (const m of t.matchAll(/(?:^|\n)\s*export\s*\{([^}]*)\}/g)) {
    for (const q of String(m[1]).split(',')) { const n = q.trim().replace(/^.*\s+as\s+/, '').match(/^([A-Za-z_$][\w$]*)/); if (n) out.add(n[1]); }
  }
  return out;
}
for (const f of MODULES) {
  for (const n of exportNames(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
    if (!OWNERS.has(n)) OWNERS.set(n, []);
    OWNERS.get(n).push(f);
  }
}
chk('各模块 export 名收集完成', OWNERS.size > 50, OWNERS.size + ' 个不同的导出名');

// ---------- 4. 逐个模块查漏注入 ----------

for (const f of MODULES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { chk(f + ' 存在', false); continue; }
  const raw = fs.readFileSync(p, 'utf8');
  const s = strip(raw);

  // 自己声明的(含函数参数、catch、以及任何位置的 var/let/const —— 都算局部)
  const local = new Set();
  for (const m of raw.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  // 声明目标要收全 —— 收不全就会有误报。这里覆盖: 行首声明、行内声明(for/if 里)、
  // 多声明符(let a, b;)、箭头函数参数、赋值式声明。
  for (const m of raw.matchAll(/(^|\n)\s*(?:export\s+)?(?:var|let|const)\s+([^;\n]*)/g)) {
    for (const q of String(m[2]).split(',')) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) local.add(n[1]); }
  }
  for (const m of raw.matchAll(/\b(?:var|let|const)\s+([^;=\n]*)/g)) {
    for (const q of String(m[1]).split(',')) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) local.add(n[1]); }
  }
  for (const m of raw.matchAll(/\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=[^,;)]*,\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of raw.matchAll(/\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) local.add(m[1]);
  for (const m of raw.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
    for (const q of String(m[1]).split(',')) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) local.add(n[1]); }
  }
  for (const m of raw.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  // import 进来的。注意 `X as Y` 要把**两边都**记上:
  //   · Y 是本模块可用的名字
  //   · X 是对源模块导出的引用 —— 它在源码里以裸标识符出现, 不记就会被当成"忘了 import"
  //     (第一版只记 Y, 于是 import { refresh as initViewRefresh } 被误报成漏了 refresh)
  for (const m of raw.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const q of String(m[1]).split(',')) {
      const raw2 = q.trim();
      const orig = raw2.match(/^([A-Za-z_$][\w$]*)/);
      const alias = raw2.match(/\sas\s+([A-Za-z_$][\w$]*)/);
      if (orig) local.add(orig[1]);
      if (alias) local.add(alias[1]);
    }
  }
  // 注入进来的: 模块顶层 let 行 + 从 ctx/o/c 赋值的
  const inj = new Set();
  for (const m of raw.matchAll(/(?:^|\n)\s*let\s+([^;\n]+);/g)) {
    for (const q of String(m[1]).split(',')) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) inj.add(n[1]); }
  }
  for (const m of raw.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*(?:ctx|o|c)\.[A-Za-z_$][\w$]*/g)) inj.add(m[1]);
  for (const m of raw.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:ctx|o|c)\./g)) inj.add(m[1]);

  // 自由标识符 = 用到了, 但本模块没声明 / 没 import / 没注入的。
  // (?![\w$:]) 用来排除 {prog: true} 这种对象键(那是误报)。
  //
  // 两类都要查:
  //   (a) 命中 core 顶层名          -> 忘了注入
  //   (b) 命中【别的模块】声明的名字 -> 忘了 import
  // (b) 是补上的: library/store.js 的 cur() 用了 comic(已搬到 reader/state.js)却没
  // import, 而旧版守卫用 MOVED.has(x) 把"已搬走的名字"一律放行 -> 漏报, 直到运行时
  // 才炸 ReferenceError: comic is not defined。
  const miss = new Set();
  for (const m of s.matchAll(/(?<![.\w$-])([A-Za-z_$][\w$]*)(?![\w$:])/g)) {
    const x = m[1];
    if (local.has(x) || inj.has(x)) continue;
    if (topFns.has(x) || topVars.has(x)) { miss.add(x + ' ←core(忘了注入)'); continue; }
    const owners = OWNERS.get(x);
    if (owners && !owners.includes(f)) miss.add(x + ' ←' + owners.join('/') + '(忘了 import)');
  }
  const list = [...miss].sort();
  chk(f + ' 注入完整', list.length === 0, list.length ? ('漏: ' + list.join(', ')) : ('注入 ' + inj.size + ' 项'));
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
