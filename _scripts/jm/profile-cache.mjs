// profile-cache.mjs —— 浏览器配置目录的"缓存"清理
// 为什么按"大小"触发而不是按"关闭次数": 那个浏览器常被用户手动叉掉, 脚本收不到关闭事件;
// 而且真正会长大的是 Service Worker 的 CacheStorage(网站自己存的), --disk-cache-size 管不到它。
// 调用时机: 在打开浏览器**之前**(此时没有进程占用, 删得干净)。
// 只删缓存类目录, 绝不动 Network(Cookies) / Local Storage / IndexedDB / Preferences —— 那些是登录态。
import fs from 'node:fs';
import path from 'node:path';

const CACHE_SUBS = [
  'Default/Cache', 'Default/Cache_Data', 'Default/Code Cache', 'Default/Media Cache',
  'Default/Service Worker/CacheStorage', 'Default/Application Cache',
  'Default/GPUCache', 'GPUPersistentCache',
  'Default/DawnGraphiteCache', 'Default/DawnWebGPUCache', 'ShaderCache', 'GrShaderCache'
];

function dirBytes(p) {
  let s = 0;
  let ents = [];
  try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of ents) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) s += dirBytes(f);
    else { try { s += fs.statSync(f).size; } catch (err) {} }
  }
  return s;
}

export function profileSizeMB(profileDir) { return dirBytes(profileDir) / 1048576; }

export function cleanProfileCache(profileDir, opts) {
  opts = opts || {};
  const limitMB = opts.limitMB || 400;
  const log = opts.log || function (m) { console.log(m); };
  if (!profileDir || !fs.existsSync(profileDir)) return { skipped: true, reason: '目录不存在' };
  const before = profileSizeMB(profileDir);
  if (!opts.force && before < limitMB) return { skipped: true, mb: before };
  let freed = 0, locked = 0;
  for (const sub of CACHE_SUBS) {
    const full = path.join(profileDir, sub.split('/').join(path.sep));
    if (!fs.existsSync(full)) continue;
    const b = dirBytes(full);
    try { fs.rmSync(full, { recursive: true, force: true, maxRetries: 2 }); } catch (e) {}
    const a = fs.existsSync(full) ? dirBytes(full) : 0;
    freed += (b - a);
    if (a > 0) locked++;
  }
  const after = profileSizeMB(profileDir);
  log('[缓存] ' + path.basename(profileDir) + ': ' + before.toFixed(0) + ' MB -> ' + after.toFixed(0) + ' MB (清掉 ' + (freed / 1048576).toFixed(0) + ' MB)' + (locked ? '; 有 ' + locked + ' 处被占用没删净(浏览器可能还开着)' : ''));
  return { beforeMB: before, afterMB: after, freedMB: freed / 1048576, locked: locked };
}
