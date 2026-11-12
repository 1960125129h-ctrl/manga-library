// 找真实 Node 解释器 —— 下载 / 探测 / 重建 全走它
//
// 【为什么单独一个模块】
//   以前四处在写 'node', 靠 PATH。换台机器(或装个便携版)就全废, 表现是
//   "点下载没反应 / 一闪而过", 因为 spawn 直接 ENOENT, 界面只看到任务失败。
//   而且 **不能用 Electron 内置的 Node 顶替**: Electron 44 带的是 Node 22,
//   而漫画站走代理要靠 NODE_USE_ENV_PROXY(Node 24 才有) —— 顶替会静默失效。
//
// 解析顺序(先到先用):
//   ① 环境变量 MANGA_NODE                     —— 显式指定最优先
//   ② <书库根>/_scripts/tools/node/node.exe    —— 随包副本首启会拷到这里
//   ③ <resources>/_scripts/tools/node/node.exe —— 还没拷进书库时的打包内副本
//   ④ PATH 上的 node
//
// findNode() 返回可用的 node 路径或 'node'(最后兜底) 或 null

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));        // <书库根>/_scripts/lib
const LIB = path.resolve(HERE, '..', '..');                        // 书库根

let cached;

export function findNode() {
  if (cached !== undefined) return cached;
  const cands = [];
  if (process.env.MANGA_NODE) cands.push(process.env.MANGA_NODE);
  cands.push(path.join(LIB, '_scripts', 'tools', 'node', 'node.exe'));
  try {
    if (process.resourcesPath) cands.push(path.join(process.resourcesPath, '_scripts', 'tools', 'node', 'node.exe'));
  } catch (e) {}
  for (const c of cands) {
    try { if (c && fs.existsSync(c)) { cached = c; return cached; } } catch (e) {}
  }
  try { execSync('node -v', { stdio: 'ignore', timeout: 5000 }); cached = 'node'; return cached; } catch (e) {}
  cached = null;
  return cached;
}

// 必须要有 node 的地方用它: 找不到就明确报错, 别静默跳过
export function requireNode(what) {
  const n = findNode();
  if (n) return n;
  console.error('');
  console.error('  [找不到 Node] ' + (what || '这个功能') + ' 需要它(而且必须是 Node 24+)。');
  console.error('  装一个:  https://nodejs.org/   (装完可能要重开一次终端)');
  console.error('  或指定:  set MANGA_NODE=D:\\somewhere\\node.exe');
  console.error('');
  process.exit(2);
}
