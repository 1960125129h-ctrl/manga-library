
// 用 Edge 跑调试会话(禁漫登录态在 Edge 里)
// 关键: Edge 136+ 在"默认用户数据目录"下会静默忽略 --remote-debugging-port,
// 所以这里把 Edge 的登录态(profile)复制一份到 _scripts\jm\edge-profile, 用副本启动。
// 复制需要 Edge 没在运行(否则 Cookies 被独占锁)。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireBrowser } from '../lib/browser.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.JM_PORT || '9334', 10);
const ARGV = process.argv.slice(2);
const argOf = (k, dv) => { const i = ARGV.indexOf('--' + k); return i >= 0 ? ARGV[i + 1] : dv; };
// 默认还是禁漫首页(一键下载用); 传 --url <别的站> 就直接开那一页, 不走禁漫的 18 岁/登录预处理
const START = argOf('url') || 'https://18comic.vip/';
const isJM = /18comic|jmcomic/i.test(START);
// 不再写死安装位置(Edge 现在也会装到 Program Files / %LOCALAPPDATA%); 找不到就明确报错退出
const EDGE = requireBrowser('edge', 'Edge 调试会话(禁漫登录态)');
const SRC = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data');
const DST = path.join(HERE, '..', '..', '_cache', 'edge-profile');   // 与 chrome-profile 一起放项目根的 _cache/
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 同 open-chrome.mjs: Node 24 的 fetch 连接没关干净就 exit 会踩 libuv 断言(0xC0000409)
const quit = async (code) => { await sleep(400); process.exit(code); };

function activeProfile() {
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(SRC, 'Local State'), 'utf8'));
    return (ls.profile && ls.profile.last_used) || 'Default';
  } catch (e) { return 'Default'; }
}
async function portUp() { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(1200) }); return r.ok; } catch (e) { return false; } }

if (await portUp()) { console.log('[edge] 调试端口 ' + PORT + ' 已经在跑'); await quit(0); }

const prof = activeProfile();
fs.mkdirSync(path.join(DST, prof, 'Network'), { recursive: true });
const files = [
  ['Local State', 'Local State'],
  [prof + '\\Preferences', prof + '\\Preferences'],
  [prof + '\\Secure Preferences', prof + '\\Secure Preferences'],
  [prof + '\\Network\\Cookies', prof + '\\Network\\Cookies'],
];
let copied = 0, locked = '';
for (const [a, b] of files) {
  const s = path.join(SRC, a), d = path.join(DST, b);
  try { if (fs.existsSync(s)) { fs.copyFileSync(s, d); copied++; } } catch (e) { if (String(e.message).indexOf('EBUSY') >= 0 || String(e.message).indexOf('busy') >= 0) locked = a; }
}
if (locked) {
  console.log('[edge] 无法复制登录态: ' + locked + ' 被占用 —— 说明 Edge 正在运行。');
  console.log('       请先完全关闭 Edge 窗口(任务栏右下角也要退), 再重跑本脚本一次。');
  await quit(2);
}
console.log('[edge] 已从 Edge 的 ' + prof + ' 复制登录态(' + copied + ' 个文件)');

const { cleanProfileCache } = await import('./profile-cache.mjs');
cleanProfileCache(DST, { limitMB: 400 });   // 超过 400MB 先清一次缓存(只删缓存, 不动登录态)
spawn(EDGE, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + DST,
  '--disk-cache-size=209715200',
  '--profile-directory=' + prof,
  '--proxy-server=http://127.0.0.1:7890',
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1300,950', '--lang=zh-CN',
  START
], { detached: true, stdio: 'ignore' }).unref();

for (let i = 0; i < 60 && !(await portUp()); i++) await sleep(500);
const up = await portUp();
console.log('[edge] 调试端口 ' + PORT + ': ' + (up ? '已就绪' : '没起来(检查 Edge 路径/杀软拦截)'));
if (isJM) {
  // 顺手: 关弹窗 / 过 18 岁 / 尝试用已保存账号登录
  try {
    const { openPage, preparePage } = await import('./cdp.mjs');
    const pg = await openPage(PORT);
    await new Promise((r) => setTimeout(r, 1500));
    await preparePage(pg, { log: (x) => console.log(x) });
    pg.close();
  } catch (e2) { console.log('[edge] 页面预处理跳过: ' + String(e2.message).slice(0, 60)); }
} else {
  console.log('[edge] 已打开: ' + START);
}
await quit(up ? 0 : 1);
