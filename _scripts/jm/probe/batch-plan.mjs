// batch-plan.mjs —— 抽取之前先量: 这一批要注入什么、谁能搬
//
//   node _scripts\jm\probe\batch-plan.mjs                 列出剩余函数按"注入数"升序
//   node _scripts\jm\probe\batch-plan.mjs a b c ...       分析指定函数集合(判断能不能作为一个批次搬)
//
// "注入数" = 该函数要从 core 拿多少个名字(函数 + 状态)。这是判断可搬性的**唯一**指标:
// 传递闭包只说明会牵出谁, 而牵出的东西注入就行、不用一起搬。
//
// 退出码 0 = 集合自检通过

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = path.join(ROOT, 'src/legacy/core.js');
const coreText = fs.readFileSync(CORE, 'utf8');
const L = coreText.split('\n');

const FNRE = /^\s{0,2}(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const VARRE = /^\s{0,2}(?:var|let|const)\s+(.*?);\s*(?:\/\/.*)?$/;
const declLine = {};
const topFns = new Set(), topVars = new Set();
for (const [i, l] of L.entries()) {
  const f = l.match(FNRE);
  if (f) { topFns.add(f[1]); declLine[f[1]] = i; continue; }
  const m = l.match(VARRE);
  if (!m) continue;
  let d = 0, cur = '';
  const push = (s) => { const n = (s.trim().match(/^([A-Za-z_$][\w$]*)/) || [])[1]; if (n) { topVars.add(n); declLine[n] = i; } };
  for (const ch of m[1]) {
    if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { push(cur); cur = ''; } else cur += ch;
  }
  push(cur);
}

// 取函数体: 带断言, 防止把 var 声明当函数配平(踩过: 范围一路跑到文件尾)
function body(n) {
  const i = declLine[n];
  if (i === undefined) return null;
  const m = L[i].match(FNRE);
  if (!m || m[1] !== n) return null;
  let d = 0, s = false, o = [];
  for (let j = i; j < L.length; j++) { o.push(L[j]); for (const c of L[j]) { if (c === '{') { d++; s = true; } else if (c === '}') d--; } if (s && d === 0) break; }
  if (!s) return null;
  return { from: i, end: i + o.length - 1, text: o.join('\n') };
}
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:\\.|[^'\\])*'/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '""');
const idsOf = (t) => { const s = new Set(); for (const m of strip(t).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) s.add(m[1]); return s; };

// 已经搬出去的模块里 export 了什么(那些是 import, 不算注入)
const MOVED = new Set();
const walkMod = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['legacy', 'lib', 'node_modules'].includes(e.name)) walkMod(p); }
    else if (e.name.endsWith('.js') && e.name !== 'main.js') {
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/(?:^|\n)\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) MOVED.add(m[1]);
      for (const m of t.matchAll(/(?:^|\n)\s*export\s+(?:var|let|const)\s+([^;\n]*)/g))
        for (const q of String(m[1]).split(',')) { const n = q.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) MOVED.add(n[1]); }
      for (const m of t.matchAll(/(?:^|\n)\s*export\s*\{([^}]*)\}/g))
        for (const q of String(m[1]).split(',')) { const n = q.trim().replace(/^.*\s+as\s+/, '').match(/^([A-Za-z_$][\w$]*)/); if (n) MOVED.add(n[1]); }
    }
  }
};
walkMod(path.join(ROOT, 'src'));

const ALL = [...topFns].filter((n) => body(n));
const profile = (n) => {
  const b = body(n);
  const ids = idsOf(b.text);
  const f = [...ids].filter((x) => topFns.has(x) && x !== n);
  const v = [...ids].filter((x) => topVars.has(x));
  return { n, size: b.text.length, lines: b.end - b.from + 1, from: b.from, end: b.end, fns: f, vars: v, tot: f.length + v.length };
};

const argv = process.argv.slice(2);
if (!argv.length) {
  const rows = ALL.map(profile).sort((a, b) => a.tot - b.tot);
  console.log('core 剩余 ' + ALL.length + ' 个顶层函数, 按"注入数"升序:');
  console.log('  名字'.padEnd(26) + '体积   行   函数 状态 合计');
  for (const r of rows) console.log('  ' + r.n.padEnd(24) + (r.size / 1024).toFixed(2).padStart(5) + 'K ' + String(r.lines).padStart(4) + String(r.fns.length).padStart(5) + String(r.vars.length).padStart(5) + String(r.tot).padStart(5));
  process.exit(0);
}

const S = new Set(argv);
const missing = argv.filter((n) => !body(n));
if (missing.length) { console.log('不是 core 顶层函数: ' + missing.join(', ')); process.exit(1); }
let tot = 0, lines = 0;
for (const n of argv) { const b = body(n); tot += b.text.length; lines += b.end - b.from + 1; }
console.log('批次: ' + argv.length + ' 个函数, 函数体 ' + (tot / 1024).toFixed(1) + ' K, 覆盖 ' + lines + ' 行');
console.log('');
const needFn = new Set(), needVar = new Set();
for (const n of argv) for (const x of idsOf(body(n).text)) {
  if (S.has(x) || MOVED.has(x)) continue;
  if (topFns.has(x)) needFn.add(x); else if (topVars.has(x)) needVar.add(x);
}
console.log('注入函数 (' + needFn.size + '): ' + ([...needFn].sort().join(', ') || '(无)'));
console.log('注入状态 (' + needVar.size + '):');
const initLine = L.findIndex((l) => /initLibraryStore\(/.test(l));
for (const v of [...needVar].sort()) {
  const re = new RegExp('(^|[^.\\w$])' + v + '\\s*(=(?!=)|\\+=|-=|\\*=|/=|%=|\\+\\+|--)(?![=])');
  const assg = [];
  L.forEach((l, i) => { if (!re.test(l)) return; if (i === declLine[v] && /^\s{0,2}(var|let|const)\b/.test(l)) return; assg.push('L' + (i + 1)); });
  console.log('  ' + v.padEnd(16) + '声明L' + String(declLine[v] + 1).padStart(5) + (assg.length ? ('  赋值 ' + assg.join(',')) : '  只读') + (declLine[v] > initLine ? '   声明在 init 之后' : ''));
}
console.log('');
const mustExport = [];
for (const n of argv) {
  const b = body(n);
  const re = new RegExp('(?<![.\\w$])' + n.replace(/[$]/g, '\\$&') + '(?![\\w$])');
  let cnt = 0;
  L.forEach((l, i) => {
    if (i >= b.from && i <= b.end) return;
    if (!re.test(l)) return;
    if (argv.some((c) => { const cb = body(c); return i >= cb.from && i <= cb.end; })) return;
    cnt++;
  });
  if (cnt) mustExport.push(n + '(' + cnt + ')');
}
console.log('需 export (' + mustExport.length + '/' + argv.length + '): ' + mustExport.join(', '));
const priv = argv.filter((n) => !mustExport.some((x) => x.startsWith(n + '(')));
if (priv.length) console.log('  只在批内用(不必 export): ' + priv.join(', '));
console.log('');
const bad = [...needFn, ...needVar].filter((x) => !topFns.has(x) && !topVars.has(x) && !MOVED.has(x));
console.log(bad.length ? ('X 有名字既不在 core 也不在已抽模块: ' + bad.join(', ')) : 'OK 自检通过(所有外部名字都有来源)');
process.exit(bad.length ? 1 : 0);
