// verify-all.mjs —— 一键跑全套验收
//
// 重构每改一块之后跑这个。它会自己造/删测试书, 不需要手工准备。
//
//   node _scripts\jm\verify\verify-all.mjs
// 退出码 0 = 全过

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK = path.dirname(fileURLToPath(import.meta.url));

// [显示名, 脚本, 需不需要测试书]
const TOOLS = [
  ['契约单元', 'verify-contract.mjs', 0],
  ['注入完整性', 'verify-injections.mjs', 0],
  ['外壳层', 'verify-shell.mjs', 0],
  ['界面结构', 'verify-dom.mjs', 0],
  ['书架交互', 'verify-shelf.mjs', 1],
  ['阅读器', 'verify-reader.mjs', 1],
  ['阅读器侧栏', 'verify-reader-side.mjs', 1],
  ['设置面板', 'verify-settings.mjs', 1],
  ['功能级', 'verify-functional.mjs', 1],
  ['下载链路', 'verify-download.mjs', 1],
  ['文件关联', 'verify-import.mjs', 1]
];

// ---- 模式 ----------------
//   node verify-all.mjs          全套
//   node verify-all.mjs --fast   子集: 只跑最能在早期发现结构性破坏的三组
//
// 为什么要有 --fast: 全套要起 9 次 Electron + 造 14 次测试书, 约 170 秒。
// 日常改一处就跑全套是浪费 —— 大部分改动用 40 秒的子集就够筛掉明显坏了的情况。
const FAST = new Set(['外壳层', '界面结构', '功能级', '注入完整性']);
const fastMode = process.argv.includes('--fast');
const LIST = fastMode ? TOOLS.filter((t) => FAST.has(t[0])) : TOOLS;
if (fastMode) console.log('(--fast 子集: ' + LIST.map((t) => t[0]).join(' / ') + ')');

const run = (file, args) => spawnSync(process.execPath, [path.join(WORK, file)].concat(args || []), { encoding: 'utf8', cwd: path.resolve(WORK, '..', '..', '..') });
const results = [];
let total = 0, passed = 0;

// 测试书只在**最前面**造一次, 只在**最后面**删一次。
// 原来每个工具前后各造删一次(14 次 x 3.5 秒 = 49 秒), 其中 13 次是白费:
// make-fixture 自己就会先把旧书删掉重建, 所以下一个工具并不依赖上一个工具删过。
const anyFx = LIST.some((t) => t[2]);
if (anyFx) run('../probe/make-fixture.mjs');

for (const [name, file, needFx] of LIST) {
  if (needFx && !anyFx) run('../probe/make-fixture.mjs');
  const r = run(file);
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (/结果: 跳过/.test(out)) {
    results.push({ name, ok: true, detail: '跳过' });
    const why = (out.match(/跳过: ([^\n]+)/) || [])[1] || '';
    console.log('  SKIP  ' + name.padEnd(12) + why.slice(0, 60));
    continue;
  }
  const m = out.match(/结果: (\d+) \/ (\d+) 项(全过|失败)/);
  if (m) {
    const good = m[3] === '全过';
    total += Number(m[2]);
    if (good) passed += Number(m[1]);
    results.push({ name, ok: good, detail: m[1] + '/' + m[2] });
    console.log((good ? '  PASS  ' : '  FAIL  ') + name.padEnd(12) + m[1] + ' / ' + m[2]);
  } else {
    results.push({ name, ok: false, detail: '跑不起来' });
    console.log('  FAIL  ' + name.padEnd(12) + '跑不起来 (退出码 ' + r.status + ')');
    console.log('        ' + out.trim().split('\n').slice(-3).join(' / ').slice(0, 200));
  }
}

if (anyFx) run('../probe/make-fixture.mjs', ['--remove']);   // 收尾只删一次

const bad = results.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('总计: ' + bad + ' / ' + results.length + ' 个工具失败') : ('总计: ' + results.length + ' 个工具 / ' + total + ' 项检查, 全过'));
process.exit(bad ? 1 : 0);
