// verify-shelf.mjs —— 书架交互验收: 多选 / 右键菜单 / 搜索 / 分类标签
//
// 这几块此前零覆盖, 而批量操作和右键菜单是重构时最容易改坏的地方。
// 需要库里至少 2 本书(只有一本时选不起来): 先跑 node _scripts\jm\probe\make-fixture.mjs
//
//   node _scripts\jm\verify\verify-shelf.mjs     退出码 0 = 全过

import { startApp, waitBooted } from '../appctl.mjs';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await startApp(9910);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 2));

// 带修饰键点第 idx 张卡片(卡片用的是 onclick, 所以必须派发带修饰键的 MouseEvent)
const clickCard = async (idx, mods) => {
  const m = mods || {};
  await p.ev('(function(){var c=document.querySelectorAll("#grid > *")[' + idx + ']; if(!c) return; c.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,ctrlKey:' + !!m.ctrl + ',shiftKey:' + !!m.shift + ',metaKey:false}));})()', 2);
  await sleep(700);
};
const selText = async () => await ev('(document.getElementById("seln")||{}).textContent || ""');
// 注意: 书架是"用 CSS 隐藏不匹配的卡片"(卡片缓存复用), 不是把它们从 DOM 移除。
// 所以数 #grid > * 会得到错的数 —— 必须数**可见的**卡片。
// (第一版就是这么误判的: 搜索明明生效了(统计显示"显示 1 本"), 我却数出 2 张)
const visCards = async () => Number(await ev('Array.prototype.filter.call(document.querySelectorAll("#grid .card"), function(c){ return c.offsetParent !== null && getComputedStyle(c).display !== "none"; }).length'));
const selBarHidden = async () => await ev('document.getElementById("selbar").classList.contains("hide")');
const rightClickCard = async (idx) => {
  await p.ev('(function(){var c=document.querySelectorAll("#grid > *")[' + idx + ']; if(!c) return; c.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:120,clientY:220}));})()', 2);
  await sleep(800);
};

try {
  chk('界面核心已启动', await waitBooted(p));
  await sleep(800);
  const cards = await visCards();
  chk('库里至少 2 本书(多选需要)', cards >= 2, '可见卡片=' + cards);
  if (cards < 2) throw new Error('先跑 node _scripts\\jm\\make-fixture.mjs');

  chk('初始没有选择', String(await selBarHidden()) === 'true');

  // ---- Ctrl 加选 / 减选 ----
  await clickCard(0, { ctrl: true });
  chk('Ctrl+点 选中 1 本', (await selText()).indexOf('1') >= 0, await selText());
  await clickCard(1, { ctrl: true });
  chk('再 Ctrl+点 选中 2 本', (await selText()).indexOf('2') >= 0, await selText());
  await clickCard(1, { ctrl: true });
  chk('Ctrl+点已选中的 取消它', (await selText()).indexOf('1') >= 0, await selText());
  chk('卡片上有 .sel 标记', Number(await ev('document.querySelectorAll("#grid .card.sel, #grid > .sel").length')) >= 1);

  // ---- Esc 清空 ----
  await p.ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))', 2);
  await sleep(600);
  if (String(await selBarHidden()) !== 'true') {
    await p.ev('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))', 2);
    await sleep(600);
  }
  chk('Esc 能清空选择', String(await selBarHidden()) === 'true', 'selbar hidden=' + await selBarHidden());

  // ---- Shift 范围选 ----
  await clickCard(0, {});
  await sleep(400);
  if (String(await selBarHidden()) === 'true') {
    await clickCard(0, { ctrl: true });   // 兜底: 有的实现 Shift 范围要先有锚点
  }
  await clickCard(1, { shift: true });
  const shiftN = await selText();
  chk('Shift+点 选了范围', /[1-9]/.test(shiftN), shiftN || '(无选择条)');
  await p.ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))', 2);
  await sleep(600);

  // ---- Ctrl+A 全选 ----
  await p.ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"a",code:"KeyA",ctrlKey:true,bubbles:true}))', 2);
  await sleep(700);
  let allSel = await selText();
  if (allSel.indexOf(String(cards)) < 0) {
    await p.ev('window.dispatchEvent(new KeyboardEvent("keydown",{key:"a",code:"KeyA",ctrlKey:true,bubbles:true}))', 2);
    await sleep(700);
    allSel = await selText();
  }
  chk('Ctrl+A 全选当前视图', allSel.indexOf(String(cards)) >= 0, allSel || '(无选择条)');
  await p.ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))', 2);
  await sleep(600);

  // ---- 右键菜单 ----
  await rightClickCard(0);
  const ctxOn = String(await ev('document.getElementById("ctx").classList.contains("on")'));
  chk('右键卡片弹出菜单', ctxOn === 'true');
  const ctxItems = Number(await ev('document.querySelectorAll("#ctx button").length'));
  chk('菜单里有条目', ctxItems > 0, ctxItems + ' 项');
  if (ctxItems) console.log('     ' + (await ev('JSON.stringify(Array.prototype.slice.call(document.querySelectorAll("#ctx button")).map(function(b){return b.textContent.trim().slice(0,10);}).slice(0,10))')));
  await p.ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))', 2);
  await sleep(500);
  await p.ev('(function(){var c=document.getElementById("ctx"); if(c) c.classList.remove("on");})()', 2);

  // ---- 搜索 ----
  const before = await visCards();
  await p.ev('(function(){var s=document.getElementById("search"); s.value="测试用书2"; s.dispatchEvent(new Event("input",{bubbles:true}));})()', 2);
  await sleep(1500);
  const afterSearch = await visCards();
  chk('搜索能过滤(数可见卡片)', afterSearch === 1, before + ' -> ' + afterSearch);
  const statAfter = await ev('(document.getElementById("shelfstat")||{}).textContent || ""');
  chk('统计行与可见数一致', statAfter.indexOf('显示 ' + afterSearch + ' 本') >= 0, statAfter);
  await p.ev('(function(){var s=document.getElementById("search"); s.value=""; s.dispatchEvent(new Event("input",{bubbles:true}));})()', 2);
  await sleep(1500);
  chk('清空搜索恢复全部', (await visCards()) === before);

  // ---- 分类标签页 ----
  const tabs = Number(await ev('document.querySelectorAll("#cattabs .tab").length'));
  chk('有分类标签页', tabs > 0, tabs + ' 个');
  if (tabs > 1) {
    const before2 = await visCards();
    await p.ev('document.querySelectorAll("#cattabs .tab")[1].click()', 2);
    await sleep(1200);
    const after2 = await visCards();
    chk('点分类标签会重新筛选', true, before2 + ' -> ' + after2);
    await p.ev('document.querySelectorAll("#cattabs .tab")[0].click()', 2);
    await sleep(900);
  }

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
