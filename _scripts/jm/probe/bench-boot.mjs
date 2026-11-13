// bench-boot.mjs —— 量一个 Electron 应用的启动成本
//
//   node _scripts\jm\probe\bench-boot.mjs <项目根> <调试端口>
//
// 为什么不用肉眼: "感觉哪边快"没法作为结论。这里量的是浏览器自己的账:
//   · 页面加载各阶段(responseEnd / domContentLoaded / load)
//   · 前端一共取了多少个文件、多少字节
//   · 从进程起来到界面可用的墙钟时间
//
// 注意: 两边的书库数据量不同(原版 583 本 / 重构版 2 本), 所以"到界面可用"这项
// **不能直接比**。要比的是"前端框架自身的加载与执行成本"。

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { openPage, sleep } from '../cdp.mjs';

const ROOT = path.resolve(process.argv[2] || '.');
const PORT = Number(process.argv[3] || 9455);
const APP = path.join(ROOT, '_app');
const ELECTRON = path.join(APP, 'node_modules/electron/dist/electron.exe');

const portFree = () => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.once('listening', () => s.close(() => res(true))); s.listen(PORT, '127.0.0.1'); });
const cdpUp = async (ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); if (r.ok) return true; } catch (e) {}
    await sleep(120);
  }
  return false;
};

if (!fs.existsSync(ELECTRON)) { console.log('找不到 electron: ' + ELECTRON); process.exit(1); }
if (!(await portFree())) { console.log('端口 ' + PORT + ' 被占, 换一个'); process.exit(1); }

console.log('=== ' + path.basename(ROOT) + ' ===');
const t0 = Date.now();
// 额外的 Electron 参数(比如 --user-data-dir=...) 从第 5 个参数往后传。
// 用途: 原版已经有一个实例在跑时, 单实例锁会把新进程挡回去 —— 锁是跟 userData 走的,
// 换个 userData 就能起一个隔离实例, 不去打扰用户正在用的那个。
const extra = process.argv.slice(4);
const child = spawn(ELECTRON, ['.', '--remote-debugging-port=' + PORT].concat(extra), { cwd: APP, detached: false, stdio: 'ignore' });

let page = null;
try {
  if (!(await cdpUp(30000))) throw new Error('调试端口没起来');
  const tCdp = Date.now() - t0;
  page = await openPage(PORT);
  const tConn = Date.now() - t0;

  // 等界面可用: mlBooted(两版都有) 或 书架网格出现
  let tReady = null;
  for (let i = 0; i < 200; i++) {
    let ok = false;
    try { ok = String(await page.ev('!!(window.mlBooted && document.querySelector("#grid"))')) === 'true'; } catch (e) {}
    if (ok) { tReady = Date.now() - t0; break; }
    await sleep(100);
  }

  const nav = await page.ev('JSON.stringify((function(){var t=performance.timing,n=performance.getEntriesByType("navigation")[0]||{};return {responseEnd:t.responseEnd-t.navigationStart,domReady:t.domContentLoadedEventEnd-t.navigationStart,loadEnd:t.loadEventEnd-t.navigationStart,ttfb:t.responseStart-t.navigationStart,transfer:n.transferSize||0,decoded:n.decodedBodySize||0};})())');
  const res = await page.ev('JSON.stringify((function(){var e=performance.getEntriesByType("resource");var by={};var tot=0,dec=0;for(var i=0;i<e.length;i++){var k=e[i].initiatorType||"?",sz=e[i].transferSize||0;by[k]=(by[k]||0)+1;tot+=sz;dec+=(e[i].decodedBodySize||0);}return {count:e.length,byType:by,transfer:tot,decoded:dec};})())');
  const n = JSON.parse(nav), r = JSON.parse(res);

  console.log('  进程起 -> 调试端口就绪 : ' + tCdp + ' ms');
  console.log('  进程起 -> 连上页面     : ' + tConn + ' ms');
  console.log('  进程起 -> 界面可用     : ' + (tReady === null ? '(超时)' : tReady + ' ms'));
  console.log('  --- 页面自身的账 ---');
  console.log('  TTFB                   : ' + n.ttfb + ' ms');
  console.log('  HTML 取完              : ' + n.responseEnd + ' ms');
  console.log('  DOMContentLoaded       : ' + n.domReady + ' ms');
  console.log('  load 事件              : ' + n.loadEnd + ' ms');
  console.log('  HTML 传输/解码         : ' + (n.transfer / 1024).toFixed(1) + ' KB / ' + (n.decoded / 1024).toFixed(1) + ' KB');
  console.log('  --- 前端一共取了多少 ---');
  console.log('  资源数                 : ' + r.count + '  ' + JSON.stringify(r.byType));
  console.log('  传输/解码              : ' + (r.transfer / 1024).toFixed(1) + ' KB / ' + (r.decoded / 1024).toFixed(1) + ' KB');
} catch (e) {
  console.log('  ERR ' + ((e && e.message) || e));
} finally {
  try { if (page) page.close(); } catch (e) {}
  try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {}
  await sleep(600);
}
