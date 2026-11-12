// 找 Chrome / Edge 的可执行文件 —— 调试浏览器(禁漫 / 推特 / 抖音枚举) 靠它
//
// 【为什么要单独一个模块】
//   以前三处写死:
//     open-chrome.mjs  'C:\Program Files\Google\Chrome\Application\chrome.exe'
//     open-edge.mjs    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
//     visual-mobile.mjs 同上
//   用户机器上 Chrome 装在 %LOCALAPPDATA%、装在 D 盘、或者装的是 32 位,
//   这些写死路径全部落空 —— 表现是"点开浏览器没反应", 因为 spawn 直接 ENOENT。
//
// 解析顺序: 环境变量(MANGA_CHROME / MANGA_EDGE) -> 各种常见安装位置 -> 注册表 App Paths -> PATH

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }

function envDir(name) { return process.env[name] || ''; }

// 注册表 App Paths: 覆盖"装在自定义目录/32 位装到 WOW64"的情况
function regLookup(exe) {
  const roots = ['HKCU', 'HKLM'];
  for (const root of roots) {
    try {
      const key = root + '\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exe;
      const out = execSync('reg query "' + key + '" /ve', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      const m = String(out || '').match(/REG_SZ\s+(.+?)\s*$/m);
      if (m) {
        const p = m[1].trim().replace(/^"|"$/g, '');
        if (exists(p)) return p;
      }
    } catch (e) {}
  }
  return null;
}

function where(exe) {
  try {
    const out = execSync('where ' + exe, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const p = String(out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (exists(p)) return p;
  } catch (e) {}
  return null;
}

function pick(list) {
  for (const p of list) { if (exists(p)) return p; }
  return null;
}

export function findChrome() {
  const out = [];
  if (process.env.MANGA_CHROME) out.push(process.env.MANGA_CHROME);
  const pfs = [envDir('ProgramFiles'), envDir('ProgramFiles(x86)'), envDir('ProgramW6432')].filter(Boolean);
  for (const b of pfs) out.push(path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (envDir('LOCALAPPDATA')) out.push(path.join(envDir('LOCALAPPDATA'), 'Google', 'Chrome', 'Application', 'chrome.exe'));
  const hit = pick(out);
  if (hit) return hit;
  const r = regLookup('chrome.exe');
  if (r) return r;
  return where('chrome.exe');
}

export function findEdge() {
  const out = [];
  if (process.env.MANGA_EDGE) out.push(process.env.MANGA_EDGE);
  const pfs = [envDir('ProgramFiles(x86)'), envDir('ProgramFiles'), envDir('ProgramW6432')].filter(Boolean);
  for (const b of pfs) out.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (envDir('LOCALAPPDATA')) out.push(path.join(envDir('LOCALAPPDATA'), 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  const hit = pick(out);
  if (hit) return hit;
  const r = regLookup('msedge.exe');
  if (r) return r;
  return where('msedge.exe');
}

export function requireBrowser(kind, what) {
  const p = kind === 'edge' ? findEdge() : findChrome();
  if (p) return p;
  console.error('');
  console.error('  [找不到 ' + (kind === 'edge' ? 'Edge' : 'Chrome') + '] ' + (what || '这个功能') + ' 需要它。');
  console.error('  装一个 Chrome/Edge, 或指定: set MANGA_' + (kind === 'edge' ? 'EDGE' : 'CHROME') + '=D:\\somewhere\\chrome.exe');
  console.error('');
  process.exit(2);
}
