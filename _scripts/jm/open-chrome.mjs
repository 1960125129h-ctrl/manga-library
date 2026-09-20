
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanProfileCache } from './profile-cache.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const PROFILE = path.join(WORK, 'chrome-profile');
const PORT = 9333;
const ARGV = process.argv.slice(2);
const argOf = (k, dv) => { const i = ARGV.indexOf('--' + k); return i >= 0 ? ARGV[i + 1] : dv; };
// 默认还是禁漫(给一键下载用); 传 --url <别的站> 就只是"后台开个浏览器/开个标签", 不走禁漫那套进门流程
const START = argOf('url') || process.env.JM_START_URL || 'https://18comic.vip/';
const isJM = /18comic/i.test(START);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(PROFILE, { recursive: true });

async function version() { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(1500) }); return await r.json(); } catch { return null; } }
let v = await version();
if (!v) {
  cleanProfileCache(PROFILE, { limitMB: 400 });   // 超过 400MB 先清一次缓存(只删缓存, 不动登录态)
  spawn(CHROME, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--disk-cache-size=209715200',
    '--proxy-server=http://127.0.0.1:7890',
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1300,950', '--window-position=60,40', '--lang=zh-CN',
    START
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60 && !(await version()); i++) await sleep(500);
}
v = await version();
console.log('chrome=' + (v ? v.Browser : 'NOT-UP') + ' port=' + PORT);
if (!isJM) {   // 非禁漫: 新开一个标签并前置, 不碰已有页面, 也不做 18 岁/弹窗/登录预处理
  const enc = encodeURIComponent(START);
  let t = null;
  try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + enc, { method: 'PUT' }); if (r.ok) t = await r.json(); } catch (e) {}
  if (!t) { try { const r2 = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + enc, { signal: AbortSignal.timeout(4000) }); if (r2.ok) t = await r2.json(); } catch (e) {} }
  console.log('新标签: ' + (t ? String(t.url).slice(0, 70) : '(没开成)'));
  if (t && t.id) { try { await fetch('http://127.0.0.1:' + PORT + '/json/activate/' + t.id); console.log('已前置窗口'); } catch (e) {} }
  console.log('已打开: ' + START);
  process.exit(0);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); },
      close() { try { ws.close(); } catch {} }
    });
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  });
}
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools://')) || list.find(t => t.type === 'page');
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Network.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url: START });
const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result && r.result.value; };
let title = '';
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  title = String(await ev('document.title') || '');
  console.log(i + ' title=' + title + ' href=' + String(await ev('location.href')));
  if (title && !/Just a moment|请稍候|Checking|Attention Required/i.test(title)) break;
}
await cdp.send('Page.bringToFront');
const html = String(await ev('document.documentElement.outerHTML') || '');
fs.writeFileSync(path.join(WORK, 'home.html'), html, 'utf8');
console.log('title=' + title + ' len=' + html.length + ' 已登录=' + (/退出|登出/i.test(html)));
console.log('loginHref=' + JSON.stringify((html.match(/href="[^"]*login[^"]*"/i) || [])[0] || 'none'));
// 顺手把弹窗关掉、过 18 岁、并尝试用浏览器已保存的账号登录
try {
  const mod = await import('./cdp.mjs');
  await mod.preparePage({ ev: ev, send: (m, p2) => cdp.send(m, p2) }, { log: (x) => console.log(x) });
} catch (e2) { console.log('[页面] 预处理跳过: ' + String(e2.message).slice(0, 60)); }
cdp.close();
