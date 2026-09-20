
// 看门狗: 盯着浏览器的下载目录, 一旦出现 <id>.zip 就自动入库(不用手点)
// 用法: node watch-downloads.mjs [间隔秒, 默认5]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..');
const NODE = process.execPath;
const DL = path.join(process.env.USERPROFILE || '', 'Downloads');
const GAP = (parseInt(process.argv[2] || '5', 10) || 5) * 1000;

console.log('监视 ' + DL + ' —— 出现 <id>.zip 就自动入库 (Ctrl+C 退出)');
const seen = new Map();
const norm = (f) => f.replace(/ \(\d+\)\.zip$/, '.zip');
for (;;) {
  let fresh = [];
  try {
    for (const f of fs.readdirSync(DL)) {
      if (!/^\d+( \(\d+\))?\.zip$/.test(f)) continue;
      const full = path.join(DL, f);
      const sz = fs.statSync(full).size;
      if (sz < 20000) continue;
      const key = norm(f);
      if (seen.get(key) === sz) fresh.push(key);
      else if (!fresh.includes(key)) seen.set(key, sz);
    }
  } catch (e) {}
  if (fresh.length) {
    console.log('[' + new Date().toLocaleTimeString() + '] 发现 ' + fresh.join(', ') + ' -> 导入');
    spawnSync(NODE, [path.join(HERE, 'import-zips.mjs'), '--dir', DL], { stdio: 'inherit', cwd: LIB });
    spawnSync(NODE, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit', cwd: LIB });
    for (const k of fresh) seen.delete(k);
  }
  await new Promise(r => setTimeout(r, GAP));
}
