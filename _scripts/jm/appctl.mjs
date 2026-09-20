// 起/停被验收的 App —— 各验收脚本共用
//
// 为什么单独抽出来: 原先每个脚本各自 spawn 实例, 但都不管"上一次留下的实例"。
// 残留实例占着单实例锁, 新实例一起来就被挡回去 -> 探针连不上, 报成"App 没起来"(排查了半天)。
// 这里统一: 起之前先按 .app-pid 精确清掉本项目上一个实例(绝不按镜像名杀, 免得误伤别的 Electron)。

import { spawn, spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from './cdp.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
export const LIB = path.resolve(WORK, '..', '..');
export const APP = path.join(LIB, '_app');
const ELECTRON = path.join(APP, 'node_modules/electron/dist/electron.exe');
const PIDFILE = path.join(WORK, '.app-pid');
export const APPLOG = path.join(WORK, '.verify-app.log');

/* ---------- 把测试窗口甩到副屏 ----------
   验收会反复起窗口, 如果在主屏会挡住用户正在做的事(而且抢焦点)。
   布局用 PowerShell 查: 只挑非主屏那块。找不到副屏(单屏机器)就什么都不做。
   顺带好处: 窗口尺寸固定 -> 阅读器那些尺寸断言变成可复现的。 */
const TEST_W = 1400, TEST_H = 900;
export function parkOnSecondary() {
  try {
    const ps = 'Add-Type -AssemblyName System.Windows.Forms -EA SilentlyContinue; '
      + '[System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1 | '
      + 'ForEach-Object { "$($_.Bounds.X),$($_.Bounds.Y),$($_.Bounds.Width),$($_.Bounds.Height)" }';
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 8000 });
    const m = String(r.stdout || '').trim().match(/^(-?\d+),(-?\d+),(\d+),(\d+)$/);
    if (!m) return null;   // 没副屏 -> 不动
    const sx = Number(m[1]), sy = Number(m[2]), sw = Number(m[3]), sh = Number(m[4]);
    const W = Math.min(TEST_W, sw - 80), H = Math.min(TEST_H, sh - 80);
    const dir = path.join(process.env.APPDATA || '', 'manga-library-v0');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'config.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    cfg.winBounds = { x: sx + 60, y: sy + 60, width: W, height: H };
    fs.writeFileSync(f, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg.winBounds;
  } catch (e) { return null; }
}

function killRecorded() {
  let pid = 0;
  try { pid = parseInt(fs.readFileSync(PIDFILE, 'utf8').trim(), 10) || 0; } catch (e) {}
  if (!pid) return;
  try {
    const out = execSync('tasklist /FI "PID eq ' + pid + '" /NH /FO CSV', { encoding: 'utf8' });
    if (!/electron\.exe/i.test(out)) return;   // pid 被别的进程复用了 -> 不杀
    execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' });
    console.log('(已清掉上次留下的实例 pid=' + pid + ')');
  } catch (e) {}
}

function portFree(p) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(p, '127.0.0.1');
  });
}

export function stopApp(child) {
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
}

// 起一个干净的实例并连上它的调试端口。返回 { child, port, page, p, stop() }
export async function startApp(basePort, extraArgs) {
  killRecorded();
  const parked = parkOnSecondary();
  if (parked) console.log('  (测试窗口已甩到副屏: ' + parked.x + ',' + parked.y + ' ' + parked.width + 'x' + parked.height + ')');
  await sleep(1200);
  let port = 0;
  for (let p = basePort; p < basePort + 40; p++) { if (await portFree(p)) { port = p; break; } }
  if (!port) throw new Error('连续 40 个端口都绑不上');

  const fd = fs.openSync(APPLOG, 'a');
  const argv = ['.', '--remote-debugging-port=' + port].concat(extraArgs || []);
  const child = spawn(ELECTRON, argv, { cwd: APP, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  try { fs.writeFileSync(PIDFILE, String(child.pid), 'utf8'); } catch (e) {}

  let page = null;
  for (let i = 0; i < 70; i++) {
    await sleep(500);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      page = l.find((x) => x.type === 'page');
      if (page) break;
    } catch (e) {}
  }
  if (!page) {
    stopApp(child);
    let tail = '';
    try { tail = fs.readFileSync(APPLOG, 'utf8').slice(-800); } catch (e) {}
    throw new Error('App 没起来。日志尾部:\n' + tail);
  }
  const p = await openPage(port, page.id);
  return { child, port, page, p, stop: () => stopApp(child) };
}

// 等界面核心启动完成
export async function waitBooted(p, tries) {
  const n = tries || 50;
  for (let i = 0; i < n; i++) {
    await sleep(400);
    try { if (await p.ev('!!window.mlBooted', 2)) return true; } catch (e) {}
  }
  return false;
}
