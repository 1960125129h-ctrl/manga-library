// 工作台冒烟测试: 起 App, 切模式, 加一张图, 看图墙和数据落盘
import fs from 'node:fs';
import { startApp, waitBooted } from './appctl.mjs';
import { humanClick } from './cdp.mjs';
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

  const findFreeCell = `(function(){
    var cells=Array.from(document.querySelectorAll("#workbench .wb-cell"));
    var cell=cells.find(function(x){return !x.classList.contains("onboard");});
    if(!cell) return JSON.stringify(null);
    var r=cell.getBoundingClientRect();
    return JSON.stringify({id:cell.dataset.id,x:r.x,y:r.y,w:r.width,h:r.height});
  })()`;
  const quickInfo = JSON.parse(await ev(findFreeCell));
  chk('图墙有未加入参考板的图', !!quickInfo);
  if (quickInfo) {
    await humanClick(p, quickInfo.x + quickInfo.w / 2, quickInfo.y + quickInfo.h / 2); await sleep(800);
    const quickState = JSON.parse(await ev(`JSON.stringify({
      activeTab:document.querySelector("#workbench .wb-tab.on")?.textContent||"",
      wbHidden:document.getElementById("workbench").classList.contains("hide"),
      shelfHidden:document.getElementById("shelf").classList.contains("hide"),
      onboard:!!document.querySelector('#workbench .wb-cell[data-id="${quickInfo.id}"].onboard')
    })`));
    chk('点击图墙图片加入参考板且不跳书架',
      quickState.activeTab === '图墙' && !quickState.wbHidden && quickState.shelfHidden && quickState.onboard,
      JSON.stringify(quickState));
  }

  const freeForMenu = JSON.parse(await ev(findFreeCell));
  chk('还有图可通过右键加入参考板', !!freeForMenu);
  const addedToBoard = freeForMenu && await ev(`(function(info){
    var cell=document.querySelector('#workbench .wb-cell[data-id="'+info.id+'"]');
    cell.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:info.x+20,clientY:info.y+20}));
    var b=Array.prototype.find.call(document.querySelectorAll("#ctx button"),function(x){return x.textContent.indexOf("加入参考板")>=0;});
    if(b) b.click();
    return !!b;
  })(${JSON.stringify(freeForMenu)})`) === 'true';
  chk('能把图加入参考板', addedToBoard);
  await sleep(700);
  const boardItems = Number(await ev('document.querySelectorAll("#workbench .wb-bitem").length'));
  chk('画板显示已加入的图', boardItems > 0, 'items=' + boardItems);
  const boardImageInfo = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll("#workbench .wb-bitem")).map(function(d){
    var img=d.querySelector("img"),r=d.getBoundingClientRect();
    return {naturalWidth:img.naturalWidth,width:Math.round(r.width),height:Math.round(r.height)};
  }))`));
  const boardImageOk = Array.isArray(boardImageInfo) && boardImageInfo.some((x) => x.naturalWidth > 0 && x.width > 100 && x.height > 100);
  chk('画板图片实际加载且尺寸正常', boardImageOk, JSON.stringify(boardImageInfo));
  await ev('(function(){var item=document.querySelector("#workbench .wb-bitem");if(item){item.dispatchEvent(new PointerEvent("pointerdown",{button:0,bubbles:true,clientX:100,clientY:100}));window.dispatchEvent(new PointerEvent("pointerup",{button:0,bubbles:true,clientX:100,clientY:100}));}})()'); await sleep(300);
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tool"),function(x){return x.textContent.indexOf("调色板")>=0;});if(b)b.click();})()'); await sleep(1500);
  const swatches = Number(await ev('document.querySelectorAll("#workbench .wb-palette-grid .wb-swatch").length'));
  chk('画板能提取调色板', swatches > 0, 'swatches=' + swatches);
  const pickJson = await ev(`(async function(){
    var img=document.querySelector("#workbench .wb-bitem img");
    if(!img) return JSON.stringify({ok:false});
    var r=await window.mangaLib.imageColors(img.getAttribute("src"),{x:.5,y:.5});
    return JSON.stringify(r);
  })()`);
  let pickOk = false, pickHex = '';
  try { const pr = JSON.parse(pickJson); pickOk = !!(pr.ok && pr.color && /^#[0-9a-f]{6}$/.test(pr.color.hex)); pickHex = pr.color ? pr.color.hex : ''; } catch (e) {}
  chk('主进程 IPC 能吸色', pickOk, pickHex);

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
