// 功能5 验收: 下载前预览(页缩略图网格 / 箭头展开 / Ctrl·Shift 多选 / 只下勾选的页)
// 用法: node _scripts\jm\verify-preview.mjs [nhentai链接]
// 前置: 启动书库.cmd --remote-debugging-port=9333 (或本项目 _app 下带该参数启动 electron)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { openPage, sleep } = await import('./cdp.mjs');
// 注意: 9333 是禁漫/EH 调试 Chrome 占用的端口, 书库 App 的调试端口用 9445(JM_PORT 可改)
const PORT = Number(process.env.JM_PORT || 9445);
const SELF = fileURLToPath(import.meta.url);
const LIB = path.resolve(path.dirname(SELF), '..', '..');
const LINK = process.argv[2] || 'https://nhentai.net/g/682158/';
const TESTNAME = '__预览验收测试__';
const IMG = /^(\d{4,5}|第)/;
const checks = [];
const ok = (n, v, extra) => { checks.push({ n: n, v: !!v }); console.log((v ? 'PASS  ' : 'FAIL  ') + n + (extra ? '   → ' + extra : '')); };
// 收尾: 删测试书目录 + 从 library.json 里摘掉它(别把测试书留在真实书库里)
const clean = () => {
  try { fs.rmSync(path.join(LIB, '漫画', TESTNAME), { recursive: true, force: true }); } catch (e) {}
  try {
    const f = path.join(LIB, 'library.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const k = '漫画/' + TESTNAME;
    if (j && j.comics && j.comics[k]) { delete j.comics[k]; fs.writeFileSync(f + '.tmp', JSON.stringify(j, null, 2), 'utf8'); fs.renameSync(f + '.tmp', f); }
  } catch (e) {}
};
clean();

// 9333 上可能同时挂着别的调试页(禁漫/EH 的浏览器窗口), 必须挑「书库.html」那个 target
const PAGE_URL = 'file:///' + LIB.replace(/\\/g, '/').replace(/ /g, '%20') + '/%E4%B9%A6%E5%BA%93.html';
let pageTarget = null;
try {
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  pageTarget = list.find((t) => t.type === 'page' && /%E4%B9%A6%E5%BA%93\.html|书库\.html/.test(t.url)) || null;
} catch (e) {}
if (!pageTarget) throw new Error(PORT + ' 上没有找到「书库.html」页面: 先用 --remote-debugging-port=' + PORT + ' 启动 App(见备忘录里 verify-preview 的说明)');
const p = await openPage(PORT, pageTarget.id);
try {
  await p.goto(PAGE_URL);
  await sleep(2500);
  ok('桌面版就绪(mangaLib.dlThumb / dlStart 可用)', await p.ev('!!(window.mangaLib && window.mangaLib.dlThumb && window.mangaLib.dlStart)'));

  await p.ev('(function(){document.getElementById("btn-download").click();return 1;})()');
  await sleep(600);
  ok('下载弹窗打开', await p.ev('!!document.getElementById("dl-url")'));
  await p.ev('(function(){document.getElementById("dl-url").value=' + JSON.stringify(LINK) + ';return 1;})()');
  // 填一个固定书名(--dir 就按它建目录), 免得测试写进真实收藏的书目录里
  const nameSet = await p.ev('(function(){var is=document.querySelectorAll("input");for(var i=0;i<is.length;i++){if(is[i].id==="dl-url"&&is[i+1]&&is[i+1].type==="text"){is[i+1].value=' + JSON.stringify(TESTNAME) + ';is[i+1].dispatchEvent(new Event("input",{bubbles:true}));return "ok";}}return "找不到保存为输入框";})()');
  if (nameSet !== 'ok') console.log('  (提示: ' + nameSet + ')');
  await p.ev('(function(){var bs=document.querySelectorAll("#mfoot button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("开始下载")>=0){bs[i].click();return 1;}}return 0;})()');

  // 等一级预览网格(要起 fetch-book 子进程解析, 给足 90 秒)
  let grid = 0;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    grid = await p.ev('(function(){var n=0;var im=document.querySelectorAll("img");for(var i=0;i<im.length;i++){if((im[i].alt||"").indexOf("第")===0)n++;}return n;})()');
    if (grid > 1) break;
  }
  ok('一级预览: 每页一个缩略图格子', grid > 1, grid + ' 个格子');

  const arrows = await p.ev('(function(){var b=document.querySelectorAll("button");var n=0;for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==="▼"||b[i].textContent.trim()==="▲")n++;}return n;})()');
  ok('页下面没有箭头（箭头只留给容器里的"作品"那一级）', arrows === 0, arrows + ' 个箭头');

  const cnt0 = await p.ev('(function(){var t=document.body.innerText.match(/已选\\s*\\d+\\s*\\/\\s*\\d+\\s*页/);return t?t[0]:"";})()');
  const m0 = String(cnt0).match(/(\d+)\s*\/\s*(\d+)/);
  ok('默认全不勾', m0 && m0[1] === '0' && +m0[2] === grid, cnt0);

  // 缩略图是「滚到眼前才拉」的懒加载: 手动滚一下网格, 等它把图拉回来
  const countLoaded = 'window.__pvw = (function(){var im=document.querySelectorAll("img");var n=0;for(var i=0;i<im.length;i++){if((im[i].alt||"").indexOf("第")===0 && (im[i].src||"").indexOf("data:")===0)n++;}return n;})()';
  let loaded = await p.ev(countLoaded);
  for (let i = 0; i < 12 && loaded < 10; i++) {
    await p.ev('(function(){var im=document.querySelectorAll("img");var g=null;for(var i=0;i<im.length;i++){if((im[i].alt||"").indexOf("第")===0){g=im[i].closest("div").parentNode.parentNode;break;}}if(g)g.scrollTop=g.scrollTop+700;return g?g.scrollTop:-1;})()');
    await sleep(2000);
    loaded = await p.ev(countLoaded);
  }
  ok('缩略图经主进程代理加载(带 Referer / 直连不通自动走代理 worker)', loaded >= 10, loaded + ' 张已加载');
  await p.ev('(function(){var im=document.querySelectorAll("img");for(var i=0;i<im.length;i++){if((im[i].alt||"").indexOf("第")===0){var g=im[i].closest("div").parentNode.parentNode;if(g)g.scrollTop=0;break;}}return 1;})()');
  await sleep(600);

  const ctrl = await p.ev('(function(){var im=document.querySelectorAll("img");var c=null;for(var i=0;i<im.length;i++){if(im[i].alt==="第2页"){c=im[i].closest("div").parentNode;break;}}if(!c)return "no-cell";var r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,ctrlKey:true,clientX:r.left+8,clientY:r.top+8}));var cb=c.querySelector("input");return cb?String(cb.checked):"no-cb";})()');
  ok('Ctrl 点选: 单独勾中一页', ctrl === 'true', '第2页勾选=' + ctrl);

  const shift = await p.ev('(function(){var im=document.querySelectorAll("img");function C(n){for(var i=0;i<im.length;i++){if(im[i].alt==="第"+n+"页")return im[i].closest("div").parentNode;}return null;}var c=C(4);if(!c)return "no-cell";var r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,shiftKey:true,clientX:r.left+8,clientY:r.top+8}));var o=[];for(var k=2;k<=4;k++){var cc=C(k);var cb=cc?cc.querySelector("input"):null;o.push(k+":"+(cb?cb.checked:"?"));}return o.join(",");})()');
  ok('Shift 范围选: 2~4 一起切换', String(shift) === '2:true,3:true,4:true', String(shift));

  // 只勾第 3 页 → 下载
  await p.ev('(function(){var im=document.querySelectorAll("img");for(var i=0;i<im.length;i++){var a=im[i].alt||"";if(a.indexOf("第")!==0)continue;var cell=im[i].closest("div").parentNode;var cb=cell.querySelector("input");var want=(a==="第3页");if(cb.checked!==want)cb.click();}return 1;})()');
  await sleep(500);
  const cnt1 = await p.ev('(function(){var t=document.body.innerText.match(/已选\\s*\\d+\\s*\\/\\s*\\d+\\s*页/);return t?t[0]:"";})()');
  ok('可只勾一页', /已选\s*1\s*\//.test(String(cnt1)), cnt1);
  const cntAll = await p.ev('(function(){var b=document.querySelectorAll(".modal button");for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==="全选"){b[i].click();break;}}var t=document.body.innerText.match(/已选\\s*\\d+\\s*\\/\\s*\\d+\\s*页/);return t?t[0]:"";})()');
  ok('「全选」按钮可用', /已选\s*\d+\s*\//.test(String(cntAll)) && !/已选\s*0\s*\//.test(String(cntAll)), cntAll);

  await p.ev('(function(){var b=document.querySelectorAll("button");for(var i=0;i<b.length;i++){if(b[i].textContent.indexOf("开始下载选中")>=0){b[i].click();return 1;}}return 0;})()');
  let logTail = '';
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    logTail = String(await p.ev('(function(){var e=document.getElementById("dllog");return e?e.textContent.slice(-400):"";})()') || '');
    if (/退出码/.test(logTail) || /按页勾选/.test(logTail) && /完成/.test(logTail)) { await sleep(3000); break; }
  }
  console.log('---- 下载日志尾部 ----');
  console.log(logTail.split('\n').slice(-6).join('\n'));
} finally { p.close(); }

// 磁盘校验: 只下了第 3 页, 且文件名按真实页号(落盘 + 增量重建要点时间, 轮询等)
let files = [], chapterDir = '';
for (let i = 0; i < 30; i++) {
  const metaF = path.join(LIB, '漫画', TESTNAME, '.fetch-meta.json');
  try { const ids = JSON.parse(fs.readFileSync(metaF, 'utf8')).ids || {}; chapterDir = Object.values(ids)[0] || ''; } catch (e) {}
  const chPath = chapterDir ? path.join(LIB, '漫画', TESTNAME, chapterDir) : '';
  try { files = fs.readdirSync(chPath).filter((f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)); } catch (e) { files = []; }
  if (files.length) break;
  await sleep(2000);
}
ok('只下勾选的那一页(磁盘上只有 1 张图)', files.length === 1, '目录=' + (chapterDir || '(无)') + ' 文件=' + (files.join(',') || '(空)'));
ok('文件名按真实页号(00003.xxx, 空档不会顶位)', files.length === 1 && /^0*3\./.test(files[0] || ''), files[0] || '');

clean();
const bad = checks.filter((c) => !c.v).length;
console.log('\n===== 汇总: ' + (checks.length - bad) + ' / ' + checks.length + ' 项通过 =====');
process.exit(bad ? 1 : 0);