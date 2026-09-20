// 工作台冒烟测试: 起 App, 切模式, 加一张图, 看图墙和数据落盘
import fs from 'node:fs';
import { startApp, waitBooted } from './appctl.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await startApp(9885);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 3));
let bad = 0;
const chk = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); if (!ok) bad++; };
try {
  await waitBooted(p); await sleep(1200);
  chk('容器 #workbench 存在', await ev('!!document.getElementById("workbench")') === 'true');
  chk('模式开关两个按钮都在', await ev('!!document.getElementById("mode-shelf")&&!!document.getElementById("mode-workbench")') === 'true');
  await ev('document.getElementById("mode-workbench").click()'); await sleep(700);
  chk('切到工作台后容器可见', await ev('!document.getElementById("workbench").classList.contains("hide")') === 'true');
  chk('书架被隐藏', await ev('document.getElementById("shelf").classList.contains("hide")') === 'true');
  chk('工作台有顶栏和图墙', await ev('!!document.querySelector("#workbench .wb-bar")&&!!document.querySelector("#workbench .wb-wall")') === 'true');
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),function(x){return x.textContent==="挑选"});if(b)b.click();})()'); await sleep(600);
  const books = Number(await ev('document.querySelectorAll("#workbench .wb-pick-row").length'));
  chk('挑选页列出了书库的书', books > 0, 'books=' + books);
  // 展开第一本书 -> 整本加入
  await ev('(function(){var r=document.querySelectorAll("#workbench .wb-pick-row");if(r[0])r[0].click();})()'); await sleep(600);
  const hasAll = await ev('!!document.querySelector("#workbench .wb-pick-add")');
  chk('能展开到话列表', hasAll === 'true');
  await ev('document.querySelector("#workbench .wb-pick-add").click()'); await sleep(1500);
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),function(x){return x.textContent==="图墙"});if(b)b.click();})()'); await sleep(900);
  const cells = Number(await ev('document.querySelectorAll("#workbench .wb-cell").length'));
  chk('图墙铺出了图', cells > 0, 'cells=' + cells);
  const stat = await ev('(document.querySelector("#workbench .wb-stat")||{}).textContent');
  chk('统计行有内容', String(stat).indexOf('张') >= 0, String(stat));
  const src = await ev('(function(){var i=document.querySelector("#workbench .wb-cell img");return i?i.getAttribute("src"):"";})()');
  // 路径是百分号编码的(中文/空格都编码了), 所以不能找中文字面量
  chk('图的 src 已生成且已编码', String(src).indexOf('%E6%BC%AB%E7%94%BB') >= 0, decodeURIComponent(String(src)).slice(0, 60));
  await sleep(1200);
  chk('图片真的解码了', Number(await ev('(function(){var i=document.querySelector("#workbench .wb-cell img");return i?i.naturalWidth:0;})()')) > 0);
  await sleep(900);
  const wbFile = 'D:/gong zuo qu/漫画书库重构v0/.workbench.json';
  const exists = fs.existsSync(wbFile);
  chk('数据落盘成 .workbench.json', exists);
  if (exists) { const j = JSON.parse(fs.readFileSync(wbFile, 'utf8')); chk('落盘结构正确', !!j.images && !Array.isArray(j.images) && Array.isArray(j.inbox), Object.keys(j.images).length + ' 张'); }
  await ev('document.getElementById("mode-shelf").click()'); await sleep(600);
  chk('能切回书架', await ev('!document.getElementById("shelf").classList.contains("hide")') === 'true');
  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('零未捕获异常', exs.length === 0, exs.length ? String(exs.length) : '');
  if (exs.length) exs.slice(0,3).forEach((e) => { try { console.log('     ' + String(e.params.exceptionDetails.exception.description).slice(0,200)); } catch (x) {} });
} catch (e) { console.log('  ERR ' + ((e && e.message) || e)); bad++; }
finally { try { p.close(); } catch (e) {} app.stop(); }
console.log(''); console.log(bad ? ('失败 ' + bad + ' 项') : '全部通过'); process.exit(bad ? 1 : 0);
