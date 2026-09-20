#!/usr/bin/env node
/**
 * 通用登录态抓取: 把某个站点在调试浏览器里的 cookie 存下来, 给适配器用。
 * 用法:
 *   node _scripts\jm\site-login.mjs https://www.manhuagui.com/          # 直接抓
 *   node _scripts\jm\site-login.mjs manhuagui.com --wait               # 没登录就先打开页面等你登录(最多 5 分钟)
 *   node _scripts\jm\site-login.mjs komiic.cc --edge                    # 用 Edge(9334)
 * 存到: _scripts\sites\cookies\<域名>.txt   (适配器通过 sites/cookies.mjs 自动读取)
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from './cdp.mjs';
import { hostOf, saveCookies, hasLogin } from '../sites/cookies.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const raw = argv.filter((a) => a.indexOf('--') !== 0)[0] || '';
if (!raw) { console.error('用法: node _scripts\\jm\\site-login.mjs <站点域名或链接> [--wait] [--edge]'); process.exit(1); }
const useEdge = argv.includes('--edge');
const WAIT = argv.includes('--wait');
const PORT = useEdge ? 9334 : 9333;
const url = /^https?:\/\//i.test(raw) ? raw : ('https://' + raw.replace(/^\/+/, '') + '/');
const host = hostOf(url);

async function up() { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(2000) }); return r.ok; } catch (e) { return false; } }
if (!(await up())) {
  console.log('调试浏览器(' + (useEdge ? 'Edge' : 'Chrome') + ', 端口 ' + PORT + ')没开, 正在启动 ...');
  spawnSync(process.execPath, [path.join(HERE, useEdge ? 'open-edge.mjs' : 'open-chrome.mjs'), '--url', url], { stdio: 'inherit', env: { ...process.env, JM_PORT: String(PORT) } });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  if (!(await up())) { console.error('浏览器没起来, 中止'); process.exit(1); }
}

const p = await openPage(PORT);
try { await p.send('Page.navigate', { url: url }); } catch (e) {}
await sleep(3500);

async function grab() {
  const ck = await p.send('Network.getCookies', { urls: [url] });
  const list = ck.cookies || [];
  const str = list.map((c) => c.name + '=' + c.value).join('; ');
  return { list: list, str: str };
}

let g = await grab();
if (WAIT && g.str.indexOf('=') < 0) console.log('页面还没有 cookie, 等你在浏览器里登录 ...');
if (WAIT) {
  const t0 = Date.now();
  while (Date.now() - t0 < 5 * 60 * 1000) {
    if (hasLoginStr(g.str)) break;
    await sleep(5000);
    const g2 = await grab();
    if (g2.str.length > g.str.length) { g = g2; console.log('  cookie 有更新(' + g2.list.length + ' 条), 继续等或按 Ctrl+C 结束 ...'); }
    if (hasLoginStr(g.str)) break;
  }
}
function hasLoginStr(str) { return /(token|session|auth|passport|remember|login|member|user|uid|key)/i.test(str); }

const file = saveCookies(host, g.str);
console.log('站点: ' + host + ' | cookie ' + g.list.length + ' 条, ' + g.str.length + ' 字节');
console.log('cookie 名: ' + g.list.map((c) => c.name).slice(0, 10).join(', '));
console.log('存放: ' + path.relative(path.resolve(HERE, '..', '..'), file));
console.log(hasLoginStr(g.str) ? '登录态: 看着像已登录 ✓' : '登录态: 没看到 token/session 类 cookie —— 若这本要登录才能看, 请先在浏览器里登录再重跑一次');
process.exit(0);
