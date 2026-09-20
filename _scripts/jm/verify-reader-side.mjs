// verify-reader-side.mjs —— 阅读器侧栏验收(重构 Block 4a 的安全网)
//
// 4a 把"章节列表 / 书签 / 右键菜单 / 图片管理器"从 core.js 的闭包里搬到了
// src/reader/panel.js, 依赖改由 initReaderPanel(ctx) 注入。
// 这几块原来没有任何自动化覆盖(verify-reader 只测了模式×适配和上一话/下一话),
// 而它们恰恰是"注入漏了 / 注入了 undefined"最容易炸的地方 —— 所以单独测一遍,
// 并且是**从界面点进去**测, 而不是直接调函数。
//
//   node _scripts\jm\verify-reader-side.mjs
// 前置: 书库里要有书(先跑 make-fixture.mjs), 退出码 0 = 全过

import { startApp, waitBooted } from './appctl.mjs';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await startApp(9860);
const { p } = app;

const ev = async (js) => String(await p.ev(js, 2));

// 在页面里对某个选择器命中的元素派发一次 contextmenu
const rclick = async (sel, idx) => {
  const js = '(function(){var a=document.querySelectorAll(' + JSON.stringify(sel) + ');' +
    'var el=a[' + (idx || 0) + ']; if(!el) return "no-el";' +
    'el.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:300,clientY:300}));' +
    'return "ok";})()';
  const r = await ev(js);
  await sleep(350);
  return r === 'ok';
};
const ctxOn = async () =>
  String(await ev('document.getElementById("ctx").classList.contains("on")')) === 'true';
const ctxText = async () =>
  String(await ev('Array.prototype.map.call(document.querySelectorAll("#ctx button"),function(b){return b.textContent;}).join("|")'));
const ctxClick = async (label) => {
  const js = '(function(){var bs=document.querySelectorAll("#ctx button");' +
    'for(var i=0;i<bs.length;i++){ if(bs[i].textContent.indexOf(' + JSON.stringify(label) + ')>=0){ bs[i].click(); return "ok"; } }' +
    'return "no-btn";})()';
  const r = await ev(js);
  await sleep(600);
  return r === 'ok';
};

try {
  chk('界面核心已启动', await waitBooted(p));
  const cards = Number(await ev('document.querySelectorAll("#grid > *").length'));
  chk('书库里有书', cards > 0, 'cards=' + cards);
  if (!cards) throw new Error('先跑 node _scripts\jm\make-fixture.mjs');

  // ---------- 1. 书架右键菜单 + 图片管理器(openImageManager 经 import 走通) ----------
  await rclick('#grid > *', 0);
  chk('右键书本弹出上下文菜单', await ctxOn());
  const items = await ctxText();
  chk('菜单里有「管理图包…」', items.indexOf('管理图包') >= 0, items.slice(0, 60) + '…');

  await ctxClick('管理图包');
  const modalOn = String(await ev('document.getElementById("modal").classList.contains("on")')) === 'true';
  const mboxTitle = String(await ev('(function(){var h=document.querySelector("#mbox h3");return h?h.textContent:"";})()'));
  chk('点「管理图包…」打开图片管理器', modalOn && mboxTitle.indexOf('管理图包') >= 0, mboxTitle.slice(0, 40));

  const imgCells = Number(await ev('document.querySelectorAll("#mbox img").length'));
  chk('图片管理器列出了图片', imgCells > 0, 'imgs=' + imgCells);

  // 关掉(按钮文案是「取消」)
  await ev('(function(){var bs=document.querySelectorAll("#mbox button");for(var i=0;i<bs.length;i++){if(bs[i].textContent==="取消"){bs[i].click();return "ok";}}return "no";})()');
  await sleep(700);
  chk('图片管理器能关掉', String(await ev('document.getElementById("modal").classList.contains("on")')) === 'false');

  // ---------- 2. 进入阅读器 ----------
  await p.ev('(function(){var c=document.querySelector("#grid > *"); if(c) c.click();})()', 2);
  await sleep(2500);
  chk('已进入阅读器', String(await ev('!document.getElementById("reader").classList.contains("hide")')) === 'true');

  // ---------- 3. 章节列表(renderChapters / chOrder / isBigPlat 注入) ----------
  const nCh = Number(await ev('document.querySelectorAll("#chapters .ch").length'));
  chk('章节列表渲染出条目', nCh > 0, 'n=' + nCh);
  const nOn = Number(await ev('document.querySelectorAll("#chapters .ch.on").length'));
  chk('当前话恰好一个高亮', nOn === 1, 'on=' + nOn);
  const ch0txt = await ev('(function(){var e=document.querySelector("#chapters .ch.on");return e?e.textContent:"";})()');
  chk('章节条目有文字(话名+页数)', String(ch0txt).trim().length > 0, String(ch0txt).slice(0, 30));

  // 点第 2 话应该切过去(chOrder/chStep 路径)
  if (nCh > 1) {
    await rclick('#chapters .ch', 1);
    const okCtx = await ctxOn();
    const t2 = await ctxText();
    chk('右键章节弹出菜单', okCtx, t2.slice(0, 50) + '…');
    chk('章节菜单里有「打开这一话」和「删除这一话」',
      t2.indexOf('打开这一话') >= 0 && t2.indexOf('删除这一话') >= 0);
    await ctxClick('打开这一话');
    await sleep(900);
    const nOn2 = Number(await ev('document.querySelectorAll("#chapters .ch.on").length'));
    const sel2 = Number(await ev('(function(){var a=document.querySelectorAll("#chapters .ch");for(var i=0;i<a.length;i++)if(a[i].classList.contains("on"))return i;return -1;})()'));
    chk('「打开这一话」切到该话', nOn2 === 1 && sel2 === 1, 'idx=' + sel2);
  } else {
    chk('右键章节弹出菜单', false, '只有 1 话, 无法测切换');
    chk('章节菜单里有「打开这一话」和「删除这一话」', false, '只有 1 话');
    chk('「打开这一话」切到该话', false, '只有 1 话');
  }

  // ---------- 4. 书签(bmToggle / bmFind / bmSync) ----------
  const bm0 = String(await ev('document.getElementById("bbm").textContent'));
  chk('书签按钮初始是未加', bm0.indexOf('☆') >= 0, bm0);

  await ev('document.getElementById("bbm").click()');
  await sleep(500);
  const bm1 = String(await ev('document.getElementById("bbm").textContent'));
  chk('点一下变成已书签', bm1.indexOf('★') >= 0, bm1);

  const saved = String(await ev('(function(){try{var a=JSON.parse(localStorage.getItem("bookmarks")||"[]");return a.length+"|"+(a[0]?(a[0].dir||"")+"|"+a[0].ci+"|"+a[0].pi:"");}catch(e){return "err";}})()'));
  chk('书签落盘到 localStorage', saved.indexOf('|') > 0 && !/^0\|/.test(saved), saved);

  await ev('document.getElementById("bbm").click()');
  await sleep(500);
  const bm2 = String(await ev('document.getElementById("bbm").textContent'));
  chk('再点一下取消书签', bm2.indexOf('☆') >= 0, bm2);

  // ---------- 5. 缩略图栏右键菜单(showImgCtx) ----------
  await ev('(function(){var b=document.getElementById("thumbtoggle"); if(b) b.click();})()');
  await sleep(900);
  const nT = Number(await ev('document.querySelectorAll("#thumblist .titem").length'));
  chk('缩略图栏列出了页面', nT > 0, 'n=' + nT);
  if (nT > 0) {
    await rclick('#thumblist .titem', 0);
    const ok3 = await ctxOn();
    const t3 = await ctxText();
    chk('右键缩略图弹出菜单', ok3, t3.slice(0, 50) + '…');
    chk('缩略图菜单里有「删除这张图」', t3.indexOf('删除这张图') >= 0);
    // 注意: 这一项是**直接删文件**的(delImage 里没有二次确认框), 所以只验证菜单内容,
    // 绝不点它 —— 否则每跑一次测试就真删掉一张测试图(踩过了)。
    // 改为"点空白处收起菜单", 顺便验证收起菜单没有副作用。
    await ev('document.body.dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    await sleep(400);
    chk('点空白处菜单收起', String(await ev('document.getElementById("ctx").classList.contains("on")')) === 'false');
    const stillT = Number(await ev('document.querySelectorAll("#thumblist .titem").length'));
    chk('收起菜单后缩略图数量不变', stillT === nT, stillT + '/' + nT);
  } else {
    chk('右键缩略图弹出菜单', false, '无缩略图');
    chk('缩略图菜单里有「删除这张图」', false, '无缩略图');
    chk('点空白处菜单收起', false, '无缩略图');
    chk('收起菜单后缩略图数量不变', false, '无缩略图');
  }

  // ---------- 6. 回书架 ----------
  await ev('document.getElementById("bback").click()');
  await sleep(1200);
  chk('能回到书架', String(await ev('document.getElementById("reader").classList.contains("hide")')) === 'true');

  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('零未捕获异常', exs.length === 0, exs.length ? String(exs.length) + ' 个' : '');
  if (exs.length) exs.slice(0, 3).forEach((e) => { try { console.log('     ' + String(e.params.exceptionDetails.exception.description).slice(0, 160)); } catch (x) {} });
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
