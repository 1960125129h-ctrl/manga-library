// clear-profile-cache.mjs —— 手动清一次"登录用浏览器"的缓存(Chrome/Edge 的 profile)
// 只删缓存类目录, 绝不碰 Cookies / Local Storage / IndexedDB / Preferences(那些是登录态)。
// 根目录的 清理浏览器缓存.cmd 双击就是跑这个。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanProfileCache, profileSizeMB } from './profile-cache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

// 2026-10-21 起 profile 统一放项目根的 _cache/(原来散在 _scripts/jm 下)
const CACHE = path.join(ROOT, '_cache');
const targets = [
  { 名字: 'Chrome(_cache/chrome-profile)', 目录: path.join(CACHE, 'chrome-profile') },
  { 名字: 'Edge(_cache/edge-profile)', 目录: path.join(CACHE, 'edge-profile') }
];

let anyLocked = 0, totalFreed = 0;
for (const t of targets) {
  if (!fs.existsSync(t.目录)) { console.log('  ' + t.名字 + ': 不存在, 跳过'); continue; }
  const before = profileSizeMB(t.目录);
  console.log('  ' + t.名字 + ': 清理前 ' + before.toFixed(0) + ' MB');
  const r = cleanProfileCache(t.目录, { force: true, limitMB: 0, log: function (m) { console.log('    ' + m); } });
  if (r.locked) anyLocked += r.locked;
  if (r.freedMB) totalFreed += r.freedMB;
}

console.log('');
console.log('  ── 合计清掉 ' + totalFreed.toFixed(0) + ' MB ──');
if (anyLocked) {
  console.log('');
  console.log('  提示: 有文件被占用没删净, 说明那个浏览器还开着。');
  console.log('        把那个 Chrome/Edge 窗口完全关掉(任务栏右下角也退), 再跑一次本脚本就行。');
} else {
  console.log('  登录态(Cookies)没有动过, 下次登录脚本照常用。');
}
