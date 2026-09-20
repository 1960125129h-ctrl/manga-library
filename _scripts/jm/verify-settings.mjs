// verify-settings.mjs —— 设置面板验收
//
// 设置面板是"下一个要重构的域", 而它此前完全没有测试覆盖。
// 它靠 label+input 成对生成, 控件没有 id, 所以这里按"label 的兄弟 input"来找。
//
// 注意: 改设置会写进 localStorage 并影响其它测试, 所以本工具**改完必须还原**。
//
//   node _scripts\jm\verify-settings.mjs     退出码 0 = 全过

import { startApp, waitBooted } from './appctl.mjs';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await startApp(9900);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 2));
const VARS = ['--card-w', '--cols', '--gap', '--pad', '--t-scale', '--radius', '--sbw'];

try {
  chk('界面核心已启动', await waitBooted(p));
  await sleep(600);

  const lsBefore = await ev("localStorage.getItem('shelfSettings') || ''");
  const varsBefore = JSON.parse(await ev('JSON.stringify(' + JSON.stringify(VARS) + '.map(function(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}))'));
  // 全部 CSS 自定义属性快照: 比只盯几个变量更能反映"设置到底生效没有"
  // (上次就是这个漏了 —— 我改的是 acols, 它映射到 --acols, 不在我的名单里, 结果误判成失败)
  const ALLV = '(function(){var cs=getComputedStyle(document.documentElement);var o={};for(var i=0;i<cs.length;i++){var n=cs[i];if(n.indexOf("--")===0){var v=cs.getPropertyValue(n);if(v!=null)o[n]=String(v).trim();}}return JSON.stringify(o);})()';
  const allBefore = await ev(ALLV);

  // ---- 打开 ----
  await p.ev('document.getElementById("btn-settings").click()', 2);
  await sleep(1800);
  chk('设置面板打开', String(await ev('document.getElementById("modal").classList.contains("on")')) === 'true');
  chk('有"书架设置"标题', (await ev('(function(){var h=document.querySelector("#mbox h3"); return h?h.textContent:"";})()')).indexOf('书架设置') >= 0);

  // ---- 页签 ----
  const tabInfo = JSON.parse(await ev('JSON.stringify((function(){var t=document.querySelectorAll("#mbox .tabpanel"); var btns=Array.prototype.slice.call(document.querySelectorAll("#mbox button")).filter(function(b){return /外观|显示|高级/.test(b.textContent);}); return { panels: t.length, labels: btns.map(function(b){return b.textContent.trim();}) };})())'));
  chk('三个页签齐全', tabInfo.panels === 3 && tabInfo.labels.length === 3, 'panels=' + tabInfo.panels + ' labels=' + tabInfo.labels.join('/'));
  let tabSwitchOk = 0;
  for (let i = 0; i < 3; i++) {
    await p.ev('(function(){var bs=Array.prototype.slice.call(document.querySelectorAll("#mbox button")).filter(function(b){return /^(外观|显示|高级)$/.test(b.textContent.trim());}); if(bs[' + i + ']) bs[' + i + '].click();})()', 2);
    await sleep(500);
    const shown = Number(await ev('Array.prototype.filter.call(document.querySelectorAll("#mbox .tabpanel"), function(p){return getComputedStyle(p).display !== "none";}).length'));
    if (shown === 1) tabSwitchOk++;
    else console.log('     页签 ' + i + ' 显示面板数 = ' + shown);
  }
  chk('页签切换正常(每次恰好 1 个面板可见)', tabSwitchOk === 3, tabSwitchOk + '/3');

  // ---- 控件数量 ----
  const ctl = JSON.parse(await ev('JSON.stringify((function(){var m=document.getElementById("mbox"); return { input: m.querySelectorAll("input").length, select: m.querySelectorAll("select").length, label: m.querySelectorAll("label").length, button: m.querySelectorAll("button").length };})())'));
  chk('控件数量合理', ctl.input >= 20 && ctl.label >= 15, JSON.stringify(ctl));

  // ---- 改一个设置: 找第一个 label 后面的 number input ----
  // 挑一个"映射确定"的设置项: 每行本数上限 -> --cols(applySettings 里直接 setProperty, 不受 autoFit 门控)
  const first = JSON.parse(await ev('JSON.stringify((function(){var m=document.getElementById("mbox"); var ls=m.querySelectorAll("label"); for(var i=0;i<ls.length;i++){ if(ls[i].textContent.indexOf("每行本数上限")<0) continue; var nx=ls[i].nextElementSibling; if(nx && nx.tagName==="INPUT"){ return { label: ls[i].textContent.trim(), key: i, value: nx.value, min: nx.min, max: nx.max }; } } return null;})())'));
  chk('找到"每行本数上限"设置项', !!first, first ? (first.label + ' = ' + first.value) : '没找到');
  if (first) {
    const nv = String(parseFloat(first.value) + (parseFloat(first.value) < 300 ? 17 : -11));
    await p.ev('(function(){var m=document.getElementById("mbox"); var ls=m.querySelectorAll("label"); var nx=ls[' + first.key + '].nextElementSibling; nx.value=' + JSON.stringify(nv) + '; nx.dispatchEvent(new Event("input",{bubbles:true}));})()', 2);
    await sleep(900);
    const lsAfter = await ev("localStorage.getItem('shelfSettings') || ''");
    const varsAfter = JSON.parse(await ev('JSON.stringify(' + JSON.stringify(VARS) + '.map(function(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}))'));
    const varChanged = JSON.stringify(varsBefore) !== JSON.stringify(varsAfter);
    const allAfter = await ev(ALLV);
    let diffVars = [];
    try {
      const a = JSON.parse(allBefore), b2 = JSON.parse(allAfter);
      diffVars = Object.keys(b2).filter((k) => a[k] !== b2[k]).map((k) => k + ':' + a[k] + '->' + b2[k]);
    } catch (e) {}
    chk('改动写进了 localStorage', lsAfter !== lsBefore, lsBefore.slice(0, 40) + ' -> ' + lsAfter.slice(0, 40));
    chk('改动反映到 CSS 变量', varChanged || diffVars.length > 0, diffVars.slice(0, 4).join('  ') || VARS.map((v, i) => v + ':' + varsBefore[i] + '->' + varsAfter[i]).join(' '));

    // ---- 还原 ----
    await p.ev('(function(){var m=document.getElementById("mbox"); var ls=m.querySelectorAll("label"); var nx=ls[' + first.key + '].nextElementSibling; nx.value=' + JSON.stringify(first.value) + '; nx.dispatchEvent(new Event("input",{bubbles:true}));})()', 2);
    await sleep(900);
    const varsRestored = JSON.parse(await ev('JSON.stringify(' + JSON.stringify(VARS) + '.map(function(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}))'));
    chk('还原后 CSS 变量回到原值', JSON.stringify(varsRestored) === JSON.stringify(varsBefore), JSON.stringify(varsRestored));
  }

  // ---- 关闭 ----
  await p.ev('(function(){var bs=Array.prototype.slice.call(document.querySelectorAll("#mbox button")); var c=bs.filter(function(b){return b.textContent.trim()==="取消"||b.textContent.trim()==="关闭";})[0]; if(c) c.click(); else document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));})()', 2);
  await sleep(1200);
  chk('能关掉面板', String(await ev('document.getElementById("modal").classList.contains("on")')) === 'false');

  // ---- 重开: 值应保持 ----
  await p.ev('document.getElementById("btn-settings").click()', 2);
  await sleep(1600);
  chk('能再次打开', String(await ev('document.getElementById("modal").classList.contains("on")')) === 'true');
  await p.ev('(function(){var bs=Array.prototype.slice.call(document.querySelectorAll("#mbox button")); var c=bs.filter(function(b){return b.textContent.trim()==="取消"||b.textContent.trim()==="关闭";})[0]; if(c) c.click();})()', 2);
  await sleep(800);

  const lsEnd = await ev("localStorage.getItem('shelfSettings') || ''");
  chk('最终设置与测试前一致(没污染)', lsEnd === lsBefore, lsEnd === lsBefore ? '' : (lsBefore.slice(0, 50) + ' vs ' + lsEnd.slice(0, 50)));

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
