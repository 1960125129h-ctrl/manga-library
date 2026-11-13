// 容器(三级套娃)验收: EH tag / pixiv 作者主页 → 作品列表 → ▼ 展开某作品的页缩略图 → 只下勾选
// 用法: node _scripts\jm\verify\verify-container.mjs "<tag或作者主页链接>" [--download]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { openPage, sleep } = await import('./cdp.mjs');
const PORT = Number(process.env.JM_PORT || 9445);
const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const URL_IN = process.argv[2] || '';
const DO_DL = process.argv.includes('--download');
if (!URL_IN) { console.log('用法: node verify-container.mjs "<链接>" [--download]'); process.exit(1); }
const checks = [];
const ok = (n, v, extra) => { checks.push(!!v); console.log((v ? 'PASS  ' : 'FAIL  ') + n + (extra ? '   → ' + extra : '')); };

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const t = list.find((x) => x.type === 'page' && /%E4%B9%A6%E5%BA%93\.html/.test(x.url));
if (!t) throw new Error('没找到书库页面 target (App 要用 --remote-debugging-port=' + PORT + ' 启动)');
const p = await openPage(PORT, t.id);
try {
  await p.goto('file:///' + LIB.replace(/\\/g, '/').replace(/ /g, '%20') + '/%E4%B9%A6%E5%BA%93.html');
  await sleep(2500);
  await p.ev('(function(){document.getElementById("btn-download").click();return 1;})()');
  await sleep(600);
  await p.ev('(function(){document.getElementById("dl-url").value=' + JSON.stringify(URL_IN) + ';return 1;})()');
  await p.ev('(function(){var bs=document.querySelectorAll("#mfoot button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("开始下载")>=0){bs[i].click();return 1;}}return 0;})()');

  // 等容器列表(解析 tag/作者页比较慢)
  let cards = 0, arrows = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    cards = await p.ev('(function(){return document.querySelectorAll("button").length && Array.prototype.filter.call(document.querySelectorAll("button"), function(b){return b.textContent.trim()==="下载整本";}).length;})()');
    arrows = await p.ev('(function(){return Array.prototype.filter.call(document.querySelectorAll("button"), function(b){return b.textContent.trim()==="▼";}).length;})()');
    if (cards > 0) break;
  }
  ok('容器列表渲染出作品卡片', cards > 0, cards + ' 张卡片（首屏最多 60）');
  ok('每张作品卡片下有 ▼ 箭头', arrows > 0, arrows + ' 个箭头');
  const cnt0 = await p.ev('(function(){var t=document.body.innerText.match(/已选\\s*\\d+\\s*本[^\\n]*/);return t?t[0]:"";})()');
  ok('作品默认全不勾', /已选\s*0\s*本/.test(String(cnt0)), cnt0);
  const more = await p.ev('(function(){var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("加载更多")>=0)return bs[i].textContent;}return "(没有加载更多, 说明总数<=60)";})()');
  console.log('      加载更多按钮: ' + more);

  // 展开第一本: 应出现页缩略图网格 + 页级 全选/全不选/反选
  await p.ev('(function(){var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==="▼"){bs[i].click();return 1;}}return 0;})()');
  let pg = 0, upArrow = 0, sel3 = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    pg = await p.ev('(function(){var im=document.querySelectorAll("img");var n=0;for(var i=0;i<im.length;i++){if((im[i].alt||"").indexOf("第")===0)n++;}return n;})()');
    upArrow = await p.ev('(function(){return Array.prototype.filter.call(document.querySelectorAll("button"), function(b){return b.textContent.trim()==="▲";}).length;})()');
    sel3 = await p.ev('(function(){var o=0;["全选","全不选","反选"].forEach(function(x){o += Array.prototype.filter.call(document.querySelectorAll("button"), function(b){return b.textContent.trim()===x;}).length;});return o;})()');
    if (pg > 0) break;
  }
  ok('展开作品后出现该作品的页缩略图', pg > 0, pg + ' 页缩略图');
  ok('展开状态箭头变成 ▲（不写"收起"两字）', upArrow > 0, upArrow + ' 个 ▲');
  ok('页级保留 全选/全不选/反选', sel3 >= 3, sel3 + ' 个按钮');

  // sprite 缩略图检查: EH 的格子应该是 <img> 带 background-position(整张 sprite + 位置裁切)
  // 懒加载: 页网格的东西都在滚动容器里, 每轮把它滚到眼前再数, 图才会被拉回来
  // 懒加载: 得把「页网格」滚进视野(外层作品列表 + 网格自己要滚), 图才会被拉回来
  let spriteN = 0, loadedN = 0;
  for (let i = 0; i < 16; i++) {
    await p.ev('(function(){var im=document.querySelectorAll("img");var g=null;for(var i=0;i<im.length;i++){if((im[i].alt||"")==="第2页"){g=im[i].parentNode;break;}}if(!g)return 0;try{g.scrollIntoView({block:"center"});}catch(e){}var list=g.closest("div[style*=overflow-y]");if(list&&list!==g)list.scrollTop=list.scrollTop+400;g.scrollTop=0;return 1;})()');
    await sleep(2500);
    // 判定只看 DOM 结果: 页图拿到 data: 图源(或带了 sprite 位置)就算加载成功
    const st = await p.ev('(function(){var im=document.querySelectorAll("img");var l=0;for(var i=0;i<im.length;i++){var a=im[i].alt||"";if(a.indexOf("第")!==0)continue;if((im[i].src||"").indexOf("data:")===0||/px/.test(im[i].style.backgroundPosition||""))l++;}return l;})()');
    loadedN = parseInt(String(st), 10) || 0;
    spriteN = loadedN;
    if (loadedN > 0) break;
  }
  const dbg = await p.ev('(function(){var im=document.querySelectorAll("img");var n=0,l=0;for(var i=0;i<im.length;i++){if((im[i].alt||"").indexOf("第")!==0)continue;n++;if((im[i].src||"").indexOf("data:")===0)l++;}return "页图 " + n + " 张, 已加载 " + l;})()');
  ok('展开后的页缩略图能加载出来(EH 的 sprite 会带位置)', spriteN > 0, spriteN + ' 张已加载 ｜ ' + dbg);

  // 只勾这一本里第 1 页 + 勾一本整本
  await sleep(700);
  await p.ev('(function(){var im=document.querySelectorAll("img");for(var i=0;i<im.length;i++){if((im[i].alt||"")==="第2页"){var g=im[i].parentNode;if(g)g.scrollTop=0;break;}}return 1;})()');
  await sleep(1200);
  // 只点「第一个展开作品里」的第 2 页(先确认勾选框在, 再点, 再读计数)(页可能来自多个作品, 用第一张命中的即可)
  await p.ev('(function(){var im=document.querySelectorAll("img");for(var i=0;i<im.length;i++){if((im[i].alt||"")==="第2页"){var cell=im[i].closest("div").parentNode;var cb=cell.querySelector("input");if(cb&&!cb.checked){cb.click();}return 1;}}return 0;})()');
  await sleep(700);
  const cntPage = await p.ev('(function(){var t=document.body.innerText.match(/已选\\s*\\d+\\s*本[^\\n]*/);return t?t[0]:"";})()');
  ok('可只勾某作品里的某一页(勾的是页, 不动作品勾选)', /单独勾了\s*\d+\s*页/.test(String(cntPage)), cntPage);
  await sleep(700);
  const cntBook = await p.ev('(function(){var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==="下载整本"){var card=bs[i].closest("div").parentNode.parentNode;var cb=card.querySelector("input");if(cb&&!cb.checked)cb.click();break;}}var t=document.body.innerText.match(/已选\\s*\\d+\\s*本[^\\n]*/);return t?t[0]:"";})()');
  ok('可勾整本', /已选\s*1\s*本/.test(String(cntBook)), cntBook);

  if (DO_DL) {
    await p.ev('(function(){var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("下载选中")>=0){bs[i].click();return 1;}}return 0;})()');
    let tail = '';
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      tail = String(await p.ev('(function(){var e=document.getElementById("dlworks");var l=document.getElementById("dllog");return (e?e.textContent:"")+" || "+(l?l.textContent.slice(-200):"");})()') || '');
      if (/全部结束|批量结束/.test(tail)) break;
    }
    console.log('      批量进度尾部: ' + tail.slice(-400).replace(/\n/g, ' | '));
    ok('串行批量跑完并报总账', /全部结束|批量结束/.test(tail));
  } else {
    console.log('      （没加 --download, 只验界面不下载）');
  }
} finally { p.close(); }
const bad = checks.filter((c) => !c).length;
console.log('\n===== 容器验收: ' + (checks.length - bad) + ' / ' + checks.length + ' 项通过 =====');
process.exit(bad ? 1 : 0);