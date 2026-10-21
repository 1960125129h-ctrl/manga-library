// app-start.mjs —— 启动书库 App 并等到"调试端口真的能提供书库页面"为止。
// 踩过的三个坑:
//   1) 端口可能被"已死进程的残留 socket"占着: LISTEN 但没人应答 -> 新 App 绑不上 -> DevTools 起不来 -> 探针超时
//      所以不写死端口, 先探活找一条能绑的
//   2) 旧实例可能"活着但没有调试端口": 它的单实例锁会把新实例挡回去 -> 启动前先清掉
//   3) 渲染进程的 console 不进主进程 stdout -> App 输出重定向到日志, 采样走 IPC
// 用法: node _scripts\jm\app-start.mjs            启动/复用, 打印 PORT=<端口>
//       node _scripts\jm\app-start.mjs --restart  先清掉在跑的实例再启动(改完代码重建后必须用它)
//       node _scripts\jm\app-start.mjs --status   只查状态
import { spawn, execSync, execFileSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const APP = path.join(LIB, '_app');
const ELECTRON = path.join(APP, 'node_modules/electron/dist/electron.exe');
const JM = path.join(LIB, '_scripts/jm');
const PORTFILE = path.join(JM, '.port');
const PIDFILE = path.join(JM, '.app-pid');   // 记录本工程启动的实例 pid
const LOGFILE = path.join(JM, '.app-out.log');
const BASE = 9546;   // 与正式版(漫画书库)的 9445/9446 错开: 同一台机器上两套可能同时开着

const FORCE = process.argv.includes('--restart');
const STATUS = process.argv.includes('--status');

function portFree(p) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(p, '127.0.0.1');
  });
}
async function httpJson(p, pathPart, timeoutMs = 1200) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch('http://127.0.0.1:' + p + pathPart, { signal: ac.signal });
    clearTimeout(timer);
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
// 必须确认端口上的页面"是本工程的"。
// 只匹配文件名不够: 正式版(漫画书库)跑起来页面也叫 书库.html,
// 会被误判成"已在运行" -> 验收脚本连到用户正在用的那个应用上乱点。
function isOurLibUrl(u) {
  try {
    const dec = decodeURIComponent(String(u || ''));
    return dec.indexOf(LIB.replace(/\\/g, '/')) >= 0 && /(index\.html|书库\.html)/.test(dec);
  } catch (e) { return false; }
}
async function hasLibraryPage(p) {
  const list = await httpJson(p, '/json/list');
  if (!list || !Array.isArray(list)) return false;
  return list.some((x) => x.type === 'page' && isOurLibUrl(x.url));
}
async function aliveOk(p) { return !!(await httpJson(p, '/json/version')) && (await hasLibraryPage(p)); }
function remember(p) { try { fs.writeFileSync(PORTFILE, String(p), 'utf8'); } catch (e) {} }
// 只杀掉"本工程上一次启动的那个实例"。
// 不能再用 taskkill /IM electron.exe: 同一台机器上可能同时跑着别的副本(正式版 / 重构版),
// 按镜像名无差别杀会把它们一起杀掉。
function killOurElectron() {
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$target = [System.IO.Path]::GetFullPath('" + ELECTRON.replace(/'/g, "''") + "')",
    "Get-Process electron | Where-Object { $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq $target) } | Stop-Process -Force"
  ].join('; ');
  try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch (e) {}
}
function killApp() {
  let pid = 0;
  try { pid = parseInt(fs.readFileSync(PIDFILE, 'utf8').trim(), 10) || 0; } catch (e) {}
  if (pid) {
    try {
      const out = execSync('tasklist /FI "PID eq ' + pid + '" /NH /FO CSV', { encoding: 'utf8' });
      if (/electron\.exe/i.test(out)) execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' });
    } catch (e) {}
  }
  killOurElectron();
}

if (FORCE) {
  console.log('--restart: 清掉在跑的实例');
  killApp();
  await new Promise((r) => setTimeout(r, 1800));
}

let lastPort = 0;
try { lastPort = parseInt(fs.readFileSync(PORTFILE, 'utf8').trim(), 10) || 0; } catch (e) {}

if (!FORCE) {
  for (const p of [lastPort, BASE].filter(Boolean)) {
    if (await aliveOk(p)) { remember(p); console.log('OK 已在运行 (有书库页面)'); console.log('PORT=' + p); process.exit(0); }
  }
  if (STATUS) { console.log('NO 没有可用实例'); process.exit(2); }
}

// 走到这里就需要(重新)启动: 清掉可能"活着但没端口"的旧实例
killApp();
await new Promise((r) => setTimeout(r, 1500));

let port = 0;
for (let p = BASE; p < BASE + 30; p++) { if (await portFree(p)) { port = p; break; } }
if (!port) { console.log('FAIL 连续 30 个端口都绑不上'); process.exit(1); }

console.log('启动 App (端口 ' + port + ')…');
const fd = fs.openSync(LOGFILE, 'a');
const child = spawn(ELECTRON, ['.', '--remote-debugging-port=' + port], { cwd: APP, detached: true, stdio: ['ignore', fd, fd] });
child.unref();
try { fs.writeFileSync(PIDFILE, String(child.pid), 'utf8'); } catch (e) {}   // 记住它, 下次只杀它
const t0 = Date.now();
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 300));
  if (await aliveOk(port)) { remember(port); console.log('OK 就绪, 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒'); console.log('PORT=' + port); process.exit(0); }
}
console.log('FAIL 36 秒内端口 ' + port + ' 没有提供书库页面');
try {
  const tail = fs.readFileSync(LOGFILE, 'utf8').split('\n').slice(-12).join('\n');
  console.log('--- App 日志尾部 ---');
  console.log(tail);
} catch (e) {}
process.exit(1);
