// 造/删一本极小的测试书, 用来回归验证(书架->阅读器->图片加载)。
// 抽取模块、改构建之后跑一次, 比"能启动"强得多。
//
//   node _scripts\jm\make-fixture.mjs           造测试书
//   node _scripts\jm\make-fixture.mjs --remove  删测试书
// 造完/删完会自动重建书库数据。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const CAT = path.join(LIB, '漫画');
const BOOK = path.join(CAT, '测试用书');
const BOOK2 = path.join(CAT, '测试用书2');   // 第二本: 多选/批量操作需要库里不止一本书
const SRC_LIB = 'D:/gong zuo qu/漫画书库/漫画';   // 借图源(正式库), 只读不改

if (process.argv.includes('--remove')) {
  for (const b of [BOOK, BOOK2]) { fs.rmSync(b, { recursive: true, force: true }); console.log('已删除: ' + b); }
} else {
  for (const b of [BOOK, BOOK2]) if (fs.existsSync(b)) fs.rmSync(b, { recursive: true, force: true });
  const picks = [];
  const walk = (d) => {
    if (picks.length >= 5 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (picks.length >= 5) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(webp|jpg|png)$/i.test(e.name)) {
        try { const st = fs.statSync(p); if (st.size > 3000 && st.size < 120000) picks.push(p); } catch (x) {}
      }
    }
  };
  walk(SRC_LIB);
  if (picks.length < 5) { console.log('借图源里没找到足够的小图, 无法建测试书'); process.exit(1); }
  const mkIn = (book, ch, files) => {
    const d = path.join(book, ch);
    fs.mkdirSync(d, { recursive: true });
    files.forEach((s, i) => fs.copyFileSync(s, path.join(d, String(i + 1).padStart(5, '0') + path.extname(s))));
  };
  mkIn(BOOK, '第01話', picks.slice(0, 3));
  mkIn(BOOK, '第02話', picks.slice(3, 5));
  mkIn(BOOK2, '全本', picks.slice(0, 2));
  console.log('已建测试书: 「测试用书」2 话 5 页 + 「测试用书2」1 话 2 页');
}

// 清掉测试书的阅读进度。
// .progress.json 是"上次读到第几话第几页", 按书存。测试书的进度不清, "打开这本
// 从哪一话开始"就不确定了 —— 阅读器测试要求从第 1 话开始, 上一次跑留下的"第 2 话"
// 会让它直接挂在"下一话能切"上。造/删测试书时一起清, 测试之间才互不干扰。
const PROG = path.join(LIB, '.progress.json');
try {
  if (fs.existsSync(PROG)) {
    const o = JSON.parse(fs.readFileSync(PROG, 'utf8'));
    let n = 0;
    for (const k of Object.keys(o)) {
      const base = String(k).replace(/\\/g, '/').split('/').pop();
      if (base === '测试用书' || base === '测试用书2') { delete o[k]; n++; }
    }
    if (n) { fs.writeFileSync(PROG, JSON.stringify(o, null, 2)); console.log('已清掉测试书的阅读进度: ' + n + ' 条'); }
  }
} catch (e) { console.log('清进度失败(忽略): ' + (e && e.message)); }

// 重建书库数据
const r = spawnSync(process.execPath, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit' });
process.exit(r.status || 0);
